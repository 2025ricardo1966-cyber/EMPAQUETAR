import { randomUUID } from 'crypto';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import type { AuthContext } from '../../contracts/admin-domain';
import type { OrderActor, PersistedOrder } from '../../contracts/order-domain';
import type {
  DispatchAssignment,
  ExecutionTarget,
  PipelinePhase,
  ProcessDefinition,
  ProcessInstance,
  ProcessInstanceStatus,
  ProductionArtifact,
  ProductionJob,
  ProductionJobStatus,
  QueueItem,
  WorkerDescriptor,
} from '../../contracts/production-orchestration';
import {
  CUSTOMER_PROCESS_LABELS,
  DEFAULT_PIPELINES,
  DEFAULT_RETRY_POLICY,
  PRIORITY_RANK,
  canTransitionProductionJob,
  derivePipelinePhase,
  orderStatusForPhase,
} from '../../contracts/production-orchestration';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import type { ProductionStore } from './ProductionStore';
import { JobDispatcher } from './JobDispatcher';
import type { OrderService } from './OrderService';
import type { AdminRepository } from './AdminRepository';
import type { WorkflowEngine } from './WorkflowEngine';
import type { TraceService } from './TraceService';
import { actorTypeFromRole } from '../../contracts/trace-domain';

const SYSTEM_ACTOR: OrderActor = { actorId: 'pipeline', role: 'system', label: 'pipeline' };

export class ProductionOrchestrator {
  private workflows?: WorkflowEngine;
  private tracer?: TraceService;

  constructor(
    private store: ProductionStore,
    private orders: OrderService,
    private dispatcher: JobDispatcher,
    private adminRepo?: AdminRepository
  ) {}

  setWorkflows(workflows: WorkflowEngine): void {
    this.workflows = workflows;
  }

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async ensureWorkers(): Promise<WorkerDescriptor[]> {
    const listed = this.dispatcher.listWorkers();
    for (const w of listed) await this.store.saveWorker({ ...w, lastHeartbeat: Date.now() });
    return listed;
  }

  pipelineFor(disciplineId: string): ProcessDefinition[] {
    return (DEFAULT_PIPELINES[disciplineId] || DEFAULT_PIPELINES.textile).filter((p) => p.enabled);
  }

  async startProduction(
    ctx: AuthContext,
    orderId: string,
    options?: { jobCount?: number }
  ): Promise<{ processes: ProcessInstance[]; phase: PipelinePhase }> {
    this.assertWorkshop(ctx, 'production.edit');
    await this.ensureWorkers();
    const order = await this.requireOrder(ctx, orderId);
    if (this.workflows) {
      await this.workflows.ensureInstance(ctx, orderId);
      const processes = await this.store.listProcesses(orderId);
      const active = processes.find((p) => p.status === 'active' || p.status === 'waiting_approval');
      if (active) {
        const jobs = await this.store.listJobs({ processInstanceId: active.instanceId, tenantId: ctx.tenantId });
        const live = jobs.filter((j) => j.status !== 'cancelled');
        const wanted = options?.jobCount ?? (live.length ? live.length : 1);
        const needed = wanted - live.length;
        if (needed > 0) await this.enqueueJobsInternal(order.tenantId, active.instanceId, needed, 'local', []);
      }
      return this.snapshot(orderId);
    }
    const existing = await this.store.listProcesses(orderId);
    if (existing.length) {
      const active = existing.find((p) => p.status === 'active' || p.status === 'waiting_approval');
      if (active && options?.jobCount) {
        const jobs = await this.store.listJobs({ processInstanceId: active.instanceId, tenantId: ctx.tenantId });
        const live = jobs.filter((j) => j.status !== 'cancelled');
        const needed = options.jobCount - live.length;
        if (needed > 0) await this.enqueueJobsInternal(order.tenantId, active.instanceId, needed, 'local', []);
      }
      return this.snapshot(orderId);
    }
    const discipline = order.configurationSnapshot?.disciplineId || 'textile';
    const defs = this.pipelineFor(discipline);
    const now = Date.now();
    const processes: ProcessInstance[] = [];
    for (const def of defs) {
      const instance: ProcessInstance = {
        instanceId: randomUUID(),
        processId: def.processId,
        orderId,
        tenantId: order.tenantId,
        name: def.name,
        type: def.type,
        order: def.order,
        required: def.required,
        requiresApproval: !!def.requiresApproval,
        status: 'pending',
        jobIds: [],
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, from: null, to: 'pending', note: 'created' }],
      };
      await this.store.saveProcess(instance);
      processes.push(instance);
    }
    await this.activateNext(ctx, order, processes, options?.jobCount ?? 1);
    return this.snapshot(orderId);
  }

  async enqueueJobs(
    ctx: AuthContext,
    processInstanceId: string,
    count: number,
    executionTarget: ExecutionTarget = 'local',
    dependsOnJobIds: string[] = []
  ): Promise<ProductionJob[]> {
    this.assertWorkshop(ctx, 'production.edit');
    return this.enqueueJobsInternal(ctx.tenantId, processInstanceId, count, executionTarget, dependsOnJobIds);
  }

  async queue(ctx: AuthContext, orderId?: string): Promise<QueueItem[]> {
    this.assertWorkshop(ctx, 'production.view');
    const jobs = await this.store.listJobs({ tenantId: ctx.tenantId, orderId });
    const processes = orderId ? await this.store.listProcesses(orderId) : [];
    return jobs
      .filter((j) => j.status === 'queued')
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt)
      .map((j) => ({
        jobId: j.jobId,
        orderId: j.orderId,
        tenantId: j.tenantId,
        priority: j.priority,
        queuedAt: j.createdAt,
        blockedReason: this.blockedReason(j, processes),
      }));
  }

  async dispatchJob(ctx: AuthContext, jobId: string): Promise<{ job: ProductionJob; assignment: DispatchAssignment }> {
    this.assertWorkshop(ctx, 'production.edit');
    const job = await this.requireJob(ctx.tenantId, jobId);
    await this.assertDependencies(job);
    const process = await this.requireProcess(ctx.tenantId, job.processInstanceId);
    if (process.status === 'waiting_approval') throw new RequestInvalidError('WAITING_APPROVAL');
    if (!canTransitionProductionJob(job.status, 'dispatched')) throw new RequestInvalidError('JOB_TRANSITION');
    const assignment = await this.dispatcher.dispatch(job);
    job.status = 'dispatched';
    job.assignedWorkerId = assignment.workerId;
    job.assignedWorkerKind = assignment.workerKind;
    job.dispatchedAt = Date.now();
    job.updatedAt = Date.now();
    await this.store.saveJob(job);
    const worker = (await this.store.listWorkers()).find((w) => w.workerId === assignment.workerId);
    if (worker) {
      worker.status = 'busy';
      worker.lastHeartbeat = Date.now();
      await this.store.saveWorker(worker);
    }
    return { job, assignment };
  }

  async runLocal(ctx: AuthContext, jobId: string, filename = 'resultado.png'): Promise<ProductionJob> {
    const { job } = await this.dispatchJob(ctx, jobId);
    if (job.executionTarget !== 'local') throw new RequestInvalidError('NOT_LOCAL');
    return this.completeJob(ctx, jobId, {
      filename,
      mimeType: 'image/png',
      contentBase64: Buffer.from(`local-result:${jobId}`).toString('base64'),
    });
  }

  async acknowledgeCloud(ctx: AuthContext, jobId: string, filename = 'cloud-result.bin'): Promise<ProductionJob> {
    const job = await this.requireJob(ctx.tenantId, jobId);
    if (job.executionTarget !== 'cloud') throw new RequestInvalidError('NOT_CLOUD');
    if (job.status === 'queued') {
      await this.dispatchJob(ctx, jobId);
    }
    return this.completeJob(ctx, jobId, {
      filename,
      mimeType: 'application/octet-stream',
      contentBase64: Buffer.from(`cloud-abstract:${jobId}`).toString('base64'),
    });
  }

  async startProcessing(ctx: AuthContext, jobId: string): Promise<ProductionJob> {
    this.assertWorkshop(ctx, 'production.edit');
    const job = await this.requireJob(ctx.tenantId, jobId);
    const next: ProductionJobStatus = 'processing';
    if (!canTransitionProductionJob(job.status, next)) throw new RequestInvalidError('JOB_TRANSITION');
    job.status = next;
    job.startedAt = Date.now();
    job.updatedAt = Date.now();
    await this.store.saveJob(job);
    await this.syncOrder(ctx, job.orderId);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'job',
        entityId: job.jobId,
        eventType: 'JOB_STARTED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: job.orderId, jobId: job.jobId },
        correlationId: job.orderId,
      });
    }
    return job;
  }

  async completeJob(
    ctx: AuthContext,
    jobId: string,
    file: { filename: string; mimeType: string; contentBase64: string }
  ): Promise<ProductionJob> {
    this.assertWorkshop(ctx, 'production.edit');
    let job = await this.requireJob(ctx.tenantId, jobId);
    if (job.status === 'queued') {
      await this.dispatchJob(ctx, jobId);
      job = await this.requireJob(ctx.tenantId, jobId);
    }
    if (job.status === 'dispatched') {
      job.status = 'processing';
      job.startedAt = Date.now();
    }
    if (!canTransitionProductionJob(job.status, 'completed') && job.status !== 'processing') {
      throw new RequestInvalidError('JOB_TRANSITION');
    }
    const bytes = Buffer.from(file.contentBase64, 'base64');
    const artifactId = randomUUID();
    const storageReference = await this.store.writeBlob(artifactId, bytes);
    const existing = (await this.store.listArtifacts(job.orderId)).filter((a) => a.sourceJobId === job.jobId);
    const version = existing.length + 1;
    for (const old of existing) {
      old.current = false;
      await this.store.saveArtifact(old);
    }
    const artifact: ProductionArtifact = {
      artifactId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: bytes.length,
      storageReference,
      createdAt: Date.now(),
      sourceJobId: job.jobId,
      orderId: job.orderId,
      tenantId: job.tenantId,
      version,
      current: true,
    };
    await this.store.saveArtifact(artifact);
    job.status = 'completed';
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    job.resultArtifactIds = [...job.resultArtifactIds, artifactId];
    job.currentArtifactId = artifactId;
    job.error = undefined;
    await this.store.saveJob(job);
    await this.idleWorker(job.assignedWorkerId);
    await this.onJobSettled(ctx, job);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'job',
        entityId: job.jobId,
        eventType: 'JOB_SUCCEEDED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: job.orderId, jobId: job.jobId, artifactVersion: version },
        correlationId: job.orderId,
      });
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'artifact',
        entityId: artifact.artifactId,
        eventType: 'ARTIFACT_VERSION_CREATED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: job.orderId, artifactVersion: version, filename: artifact.filename },
        correlationId: job.orderId,
      });
    }
    return job;
  }

  async failJob(ctx: AuthContext, jobId: string, error: string): Promise<ProductionJob> {
    this.assertWorkshop(ctx, 'production.edit');
    const job = await this.requireJob(ctx.tenantId, jobId);
    if (job.status === 'queued') await this.dispatchJob(ctx, jobId);
    const fresh = await this.requireJob(ctx.tenantId, jobId);
    if (fresh.status === 'dispatched') {
      fresh.status = 'processing';
    }
    if (!canTransitionProductionJob(fresh.status, 'failed') && fresh.status !== 'processing') {
      throw new RequestInvalidError('JOB_TRANSITION');
    }
    fresh.status = 'failed';
    fresh.error = error;
    fresh.updatedAt = Date.now();
    await this.store.saveJob(fresh);
    await this.idleWorker(fresh.assignedWorkerId);
    const process = await this.requireProcess(ctx.tenantId, fresh.processInstanceId);
    await this.setProcessStatus(process, 'blocked', `job failed: ${fresh.jobId}`);
    const inst = await this.store.getWorkflowInstanceByOrder(fresh.orderId);
    if (inst) {
      inst.status = 'BLOCKED';
      inst.blockedReason = error;
      inst.blockedCustomerReason = 'Hay un problema técnico en el taller. Ya estamos trabajando en ello.';
      inst.events.push({
        at: Date.now(),
        type: 'job.failed',
        stepId: fresh.stepId,
        actorId: ctx.userId,
        actorType: ctx.userId === 'pipeline' ? 'SYSTEM' : 'USER',
        result: error,
      });
      await this.store.saveWorkflowInstance(inst);
    }
    await this.syncOrder(ctx, fresh.orderId, 'Job fallido — el pedido no se completa');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: fresh.tenantId,
        entityType: 'job',
        entityId: fresh.jobId,
        eventType: 'JOB_FAILED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: fresh.orderId, jobId: fresh.jobId, error },
        correlationId: fresh.orderId,
      });
      const order = await this.orders.getOrder(fresh.orderId, 'admin');
      if (order) {
        await this.tracer.notifyOperational({
          tenantId: order.tenantId,
          type: 'JOB_FAILED',
          title: 'Trabajo fallido',
          workshopMessage: `Falló un trabajo del pedido ${order.displayNumber || order.orderId}.`,
          entityType: 'job',
          entityId: fresh.jobId,
          order,
          dedupeKey: `${order.orderId}:JOB_FAILED:${fresh.jobId}`,
          includeWorkshop: true,
          includeOperators: true,
        });
      }
    }
    return fresh;
  }

  async retryJob(ctx: AuthContext, jobId: string): Promise<ProductionJob> {
    this.assertWorkshop(ctx, 'production.edit');
    const job = await this.requireJob(ctx.tenantId, jobId);
    if (job.status !== 'failed') throw new RequestInvalidError('RETRY_NOT_FAILED');
    if (job.retryCount >= (job.maxRetries || DEFAULT_RETRY_POLICY.maxRetries)) {
      throw new RequestInvalidError('RETRY_LIMIT');
    }
    if (!canTransitionProductionJob(job.status, 'queued')) throw new RequestInvalidError('JOB_TRANSITION');
    job.retryCount += 1;
    job.status = 'queued';
    job.error = undefined;
    job.updatedAt = Date.now();
    await this.store.saveJob(job);
    const process = await this.requireProcess(ctx.tenantId, job.processInstanceId);
    await this.setProcessStatus(process, 'active', 'retry');
    const inst = await this.store.getWorkflowInstanceByOrder(job.orderId);
    if (inst) {
      inst.status = 'ACTIVE';
      inst.blockedReason = undefined;
      inst.blockedCustomerReason = undefined;
      inst.events.push({
        at: Date.now(),
        type: 'retry',
        stepId: job.stepId,
        actorId: ctx.userId,
        actorType: ctx.userId === 'pipeline' ? 'SYSTEM' : 'USER',
        result: String(job.retryCount + 1),
      });
      await this.store.saveWorkflowInstance(inst);
    }
    await this.syncOrder(ctx, job.orderId);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'job',
        entityId: job.jobId,
        eventType: 'JOB_RETRIED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: job.orderId, jobId: job.jobId, attempt: job.retryCount + 1 },
        correlationId: job.orderId,
      });
    }
    return job;
  }

  async cancelJob(ctx: AuthContext, jobId: string): Promise<ProductionJob> {
    this.assertWorkshop(ctx, 'production.edit');
    const job = await this.requireJob(ctx.tenantId, jobId);
    if (!canTransitionProductionJob(job.status, 'cancelled')) throw new RequestInvalidError('JOB_TRANSITION');
    job.status = 'cancelled';
    job.updatedAt = Date.now();
    await this.store.saveJob(job);
    await this.idleWorker(job.assignedWorkerId);
    await this.syncOrder(ctx, job.orderId);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'job',
        entityId: job.jobId,
        eventType: 'JOB_CANCELLED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId: job.orderId, jobId: job.jobId },
        correlationId: job.orderId,
      });
    }
    return job;
  }

  async cancelProcess(ctx: AuthContext, processInstanceId: string): Promise<ProcessInstance> {
    this.assertWorkshop(ctx, 'production.edit');
    const process = await this.requireProcess(ctx.tenantId, processInstanceId);
    const jobs = await this.store.listJobs({ processInstanceId });
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'dispatched' || job.status === 'processing') {
        job.status = 'cancelled';
        job.updatedAt = Date.now();
        await this.store.saveJob(job);
      }
    }
    await this.setProcessStatus(process, 'cancelled', 'cancelled by admin');
    await this.syncOrder(ctx, process.orderId);
    return process;
  }

  async resumeProcess(ctx: AuthContext, processInstanceId: string): Promise<ProcessInstance> {
    this.assertWorkshop(ctx, 'production.edit');
    const process = await this.requireProcess(ctx.tenantId, processInstanceId);
    if (process.status !== 'blocked' && process.status !== 'cancelled') {
      throw new RequestInvalidError('RESUME_INVALID');
    }
    await this.setProcessStatus(process, 'active', 'resumed');
    await this.syncOrder(ctx, process.orderId);
    return process;
  }

  async onCustomerApproval(orderId: string, tenantId: string, decision: 'approved' | 'rejected'): Promise<void> {
    if (this.workflows) {
      if (decision === 'approved') await this.workflows.onApproved(orderId, tenantId, 'customer');
      else await this.workflows.onChangeRequest(orderId, tenantId, 'customer');
      return;
    }
    const processes = await this.store.listProcesses(orderId);
    const waiting = processes.find((p) => p.status === 'waiting_approval' && p.tenantId === tenantId);
    if (!waiting) return;
    const ctx: AuthContext = {
      token: '',
      userId: 'customer',
      tenantId,
      roleId: 'CUSTOMER',
      permissions: [],
    };
    if (decision !== 'approved') {
      await this.setProcessStatus(waiting, 'blocked', 'customer rejected');
      await this.syncOrder(ctx, orderId);
      return;
    }
    await this.setProcessStatus(waiting, 'completed', 'customer approved');
    const order = await this.orders.getOrder(orderId, 'admin');
    if (order) await this.activateNext(ctx, order, await this.store.listProcesses(orderId), 1);
  }

  async getBoard(ctx: AuthContext, orderId: string) {
    this.assertWorkshop(ctx, 'production.view');
    const order = await this.requireOrder(ctx, orderId);
    const processes = await this.store.listProcesses(orderId);
    const jobs = await this.store.listJobs({ orderId, tenantId: ctx.tenantId });
    const artifacts = await this.store.listArtifacts(orderId);
    const workers = await this.store.listWorkers();
    const queue = await this.queue(ctx, orderId);
    const trace = jobs.map((j) => {
      const process = processes.find((p) => p.instanceId === j.processInstanceId);
      const artifact = artifacts.find((a) => a.artifactId === j.currentArtifactId);
      return {
        orderId,
        process: process?.name,
        jobId: j.jobId,
        worker: j.assignedWorkerId,
        artifact: artifact?.filename,
        storageReference: artifact?.storageReference,
      };
    });
    return {
      orderId,
      orderStatus: order.status,
      phase: derivePipelinePhase(processes),
      processes,
      jobs,
      artifacts,
      workers,
      queue,
      trace,
      controlPlane: true,
      executionPlane: true,
    };
  }

  async snapshot(orderId: string) {
    const processes = await this.store.listProcesses(orderId);
    return { processes, phase: derivePipelinePhase(processes) };
  }

  private async createJob(
    order: PersistedOrder,
    process: ProcessInstance,
    executionTarget: ExecutionTarget,
    dependsOnJobIds: string[]
  ): Promise<ProductionJob> {
    const job: ProductionJob = {
      jobId: `pjob_${randomUUID()}`,
      tenantId: order.tenantId,
      orderId: order.orderId,
      processInstanceId: process.instanceId,
      status: 'queued',
      executionTarget,
      priority: order.priority,
      retryCount: 0,
      maxRetries: DEFAULT_RETRY_POLICY.maxRetries,
      dependsOnJobIds,
      capability: executionTarget === 'cloud' ? 'heavy-processing' : 'file-processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resultArtifactIds: [],
    };
    await this.store.saveJob(job);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: job.tenantId,
        entityType: 'job',
        entityId: job.jobId,
        eventType: 'JOB_CREATED',
        actorType: 'SYSTEM',
        actorId: 'pipeline',
        metadata: { orderId: job.orderId, jobId: job.jobId },
        correlationId: job.orderId,
      });
    }
    return job;
  }

  private async activateNext(
    ctx: AuthContext,
    order: PersistedOrder,
    processes: ProcessInstance[],
    jobCount: number
  ): Promise<void> {
    const next = processes.filter((p) => p.status === 'pending').sort((a, b) => a.order - b.order)[0];
    if (await this.store.getWorkflowInstanceByOrder(order.orderId)) {
      await this.syncOrder(ctx, order.orderId);
      return;
    }
    if (!next) {
      await this.syncOrder(ctx, order.orderId);
      return;
    }
    await this.setProcessStatus(next, 'active', 'activated');
    await this.enqueueJobsInternal(order.tenantId, next.instanceId, jobCount, 'local', []);
    await this.syncOrder(ctx, order.orderId);
  }

  async startProductionForSubmit(orderId: string, tenantId: string): Promise<{ processes: ProcessInstance[]; phase: PipelinePhase }> {
    const ctx: AuthContext = {
      token: '',
      userId: 'pipeline',
      tenantId,
      roleId: 'ADMIN_PRINCIPAL',
      permissions: [],
    };
    return this.startProduction(ctx, orderId);
  }

  private async onJobSettled(ctx: AuthContext, job: ProductionJob): Promise<void> {
    const process = await this.requireProcess(job.tenantId, job.processInstanceId);
    const jobs = await this.store.listJobs({ processInstanceId: process.instanceId });
    const required = jobs.filter((j) => j.status !== 'cancelled');
    if (required.some((j) => j.status === 'failed')) {
      await this.setProcessStatus(process, 'blocked', 'job failed');
      await this.syncOrder(ctx, job.orderId);
      return;
    }
    if (required.some((j) => j.status !== 'completed')) {
      await this.syncOrder(ctx, job.orderId);
      return;
    }
    if (this.workflows) {
      if (process.requiresApproval) {
        await this.setProcessStatus(process, 'waiting_approval', 'waiting customer');
        const order = await this.orders.getOrder(job.orderId, 'admin');
        if (order) await this.orders.setApprovalStatus(order.orderId, 'pending');
        await this.syncOrder(ctx, job.orderId);
        return;
      }
      try {
        await this.workflows.completeStep(ctx, job.orderId, process.processId, 'job');
      } catch {
        await this.setProcessStatus(process, 'completed', 'jobs completed');
        await this.syncOrder(ctx, job.orderId);
      }
      return;
    }
    const current = required.map((j) => j.currentArtifactId).find(Boolean);
    process.currentArtifactId = current;
    if (process.requiresApproval) {
      await this.setProcessStatus(process, 'waiting_approval', 'waiting customer');
      const order = await this.orders.getOrder(job.orderId, 'admin');
      if (order) {
        await this.orders.setApprovalStatus(order.orderId, 'pending');
      }
      await this.syncOrder(ctx, job.orderId);
      return;
    }
    await this.setProcessStatus(process, 'completed', 'jobs completed');
    const order = await this.requireOrder(ctx, job.orderId);
    await this.activateNext(ctx, order, await this.store.listProcesses(job.orderId), 1);
  }

  private async setProcessStatus(
    process: ProcessInstance,
    to: ProcessInstanceStatus,
    note?: string
  ): Promise<void> {
    const from = process.status;
    process.status = to;
    process.updatedAt = Date.now();
    process.history.push({ at: Date.now(), from, to, note });
    await this.store.saveProcess(process);
  }

  private async syncOrder(ctx: AuthContext, orderId: string, blockedReason?: string): Promise<void> {
    const processes = await this.store.listProcesses(orderId);
    const phase = derivePipelinePhase(processes);
    const active = processes.find((p) => p.status === 'active' || p.status === 'waiting_approval');
    const customerLabel = active
      ? active.status === 'waiting_approval'
        ? 'Esperando tu aprobación'
        : CUSTOMER_PROCESS_LABELS[active.type]
      : phase === 'completed'
        ? 'Finalizado'
        : undefined;
    if (phase === 'completed' && processes.some((p) => p.required && p.status !== 'completed')) {
      throw new Error('INCOHERENT_COMPLETED');
    }
    await this.orders.setOrchestration(orderId, {
      phase,
      currentProcessName: active?.name,
      customerLabel,
      blockedReason,
    });
    if (await this.store.getWorkflowInstanceByOrder(orderId)) return;
    const target = orderStatusForPhase(phase, active?.type);
    const order = await this.orders.getOrder(orderId, 'admin');
    if (target && order && order.status !== target && order.status !== 'expired' && order.status !== 'cancelled') {
      try {
        await this.orders.walkToStatus(orderId, target, SYSTEM_ACTOR, 'pipeline');
      } catch {
        /* keep current status if path blocked (e.g. expired) */
      }
    }
  }

  private blockedReason(
    job: ProductionJob,
    processes: ProcessInstance[]
  ): QueueItem['blockedReason'] {
    const process = processes.find((p) => p.instanceId === job.processInstanceId);
    if (process?.status === 'waiting_approval') return 'approval';
    if (job.dependsOnJobIds.length) return 'dependency';
    return undefined;
  }

  private async assertDependencies(job: ProductionJob): Promise<void> {
    for (const depId of job.dependsOnJobIds) {
      const dep = await this.store.getJob(depId);
      if (!dep || dep.status !== 'completed') throw new RequestInvalidError('DEPENDENCY_UNMET');
    }
  }

  private async idleWorker(workerId?: string): Promise<void> {
    if (!workerId) return;
    const workers = await this.store.listWorkers();
    const worker = workers.find((w) => w.workerId === workerId);
    if (!worker) return;
    worker.status = 'idle';
    worker.lastHeartbeat = Date.now();
    await this.store.saveWorker(worker);
  }

  private async requireOrder(ctx: AuthContext, orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.tenantId !== ctx.tenantId && ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    if (ctx.roleId === 'CUSTOMER' && order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return order;
  }

  private async requireProcess(tenantId: string, instanceId: string): Promise<ProcessInstance> {
    const process = await this.store.getProcess(instanceId);
    if (!process || process.tenantId !== tenantId) throw new AccessDeniedError();
    return process;
  }

  private async requireJob(tenantId: string, jobId: string): Promise<ProductionJob> {
    const job = await this.store.getJob(jobId);
    if (!job || job.tenantId !== tenantId) throw new AccessDeniedError();
    return job;
  }

  private assertWorkshop(ctx: AuthContext, permission: 'production.view' | 'production.edit'): void {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return;
    const probe = {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      login: '',
      displayCode: '',
      roleId: ctx.roleId,
      permissions: ctx.permissions,
      status: 'active' as const,
      createdAt: 0,
      updatedAt: 0,
    };
    if (permission === 'production.view' && (hasPermission(probe, 'production.view') || hasPermission(probe, 'production.edit'))) {
      return;
    }
    if (!hasPermission(probe, permission)) throw new AccessDeniedError();
  }

  private async enqueueJobsInternal(
    tenantId: string,
    processInstanceId: string,
    count: number,
    executionTarget: ExecutionTarget,
    dependsOnJobIds: string[]
  ): Promise<ProductionJob[]> {
    const process = await this.requireProcess(tenantId, processInstanceId);
    const order = await this.orders.getOrder(process.orderId, 'admin');
    if (!order || order.tenantId !== tenantId) throw new AccessDeniedError();
    const created: ProductionJob[] = [];
    for (let i = 0; i < count; i++) {
      created.push(await this.createJob(order, process, executionTarget, dependsOnJobIds));
    }
    process.jobIds = [...new Set([...process.jobIds, ...created.map((j) => j.jobId)])];
    process.updatedAt = Date.now();
    await this.store.saveProcess(process);
    for (const job of created) {
      await this.orders.attachJob(order.orderId, job.jobId, process.name);
    }
    return created;
  }
}
