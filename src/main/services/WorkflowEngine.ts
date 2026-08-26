import { randomUUID } from 'crypto';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import type { AuthContext } from '../../contracts/admin-domain';
import { ConfigConflictError, ConfigValidationError, RequestInvalidError } from '../../contracts/configuration-schema';
import { OrderConflictError } from '../../contracts/order-lifecycle';
import type { PersistedOrder } from '../../contracts/order-domain';
import type { ProcessInstance } from '../../contracts/production-orchestration';
import {
  canTransitionStep,
  defaultStepsForKey,
  processStatusFromRuntime,
  processTypeForStep,
  publicJobStatus,
  runtimeFromProcessStatus,
  type WorkflowActorType,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowPrecondition,
  type WorkflowStepDefinition,
  type WorkflowStepRuntimeStatus,
} from '../../contracts/workflow-domain';
import type { AdminRepository } from './AdminRepository';
import type { OrderService } from './OrderService';
import type { ProductionOrchestrator } from './ProductionOrchestrator';
import type { ProductionStore } from './ProductionStore';
import type { TraceService } from './TraceService';
import { WORKFLOW_ACTION_TO_EVENT } from './TraceService';
import { actorTypeFromRole } from '../../contracts/trace-domain';

export class WorkflowEngine {
  private tracer?: TraceService;

  constructor(
    private store: ProductionStore,
    private orders: OrderService,
    private adminRepo: AdminRepository,
    private orchestrator: ProductionOrchestrator
  ) {}

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async ensureDefaults(tenantId: string): Promise<WorkflowDefinition[]> {
    const existing = await this.store.listWorkflowDefinitions(tenantId);
    const out: WorkflowDefinition[] = [];
    for (const key of ['textile', 'tpu', 'dtf'] as const) {
      const published = existing.filter((w) => w.tenantId === tenantId && w.key === key && w.status === 'PUBLISHED');
      if (published.length) {
        out.push(published.sort((a, b) => b.version - a.version)[0]);
        continue;
      }
      const now = Date.now();
      const def: WorkflowDefinition = {
        id: randomUUID(),
        tenantId,
        key,
        rubricId: key,
        name: `Workflow ${key.toUpperCase()}`,
        version: 1,
        status: 'PUBLISHED',
        steps: defaultStepsForKey(key),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.saveWorkflowDefinition(def);
      await this.audit(tenantId, 'system', 'workflow.published', def.id, { version: 1, key });
      out.push(def);
    }
    return out;
  }

  async ensureDefaultForTenant(ctx: AuthContext): Promise<WorkflowDefinition> {
    const list = await this.ensureDefaults(ctx.tenantId);
    const config = await this.adminRepo.getConfig(ctx.tenantId);
    const key = config?.rubro === 'TPU' ? 'tpu' : config?.rubro === 'DTF' ? 'dtf' : 'textile';
    const match = list.find((w) => w.key === key) || list[0];
    if (!match) throw new RequestInvalidError('WORKFLOW_NOT_FOUND');
    match.isDefault = true;
    return match;
  }

  async patchPublishedPresentation(ctx: AuthContext, patches: Array<Record<string, unknown>>): Promise<WorkflowDefinition> {
    if (ctx.roleId === 'OPERATOR' || ctx.roleId === 'CUSTOMER' || ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    const def = await this.ensureDefaultForTenant(ctx);
    const active = (await this.store.listWorkflowInstances(ctx.tenantId)).some(
      (i) => i.status === 'ACTIVE' || i.status === 'PENDING' || i.status === 'BLOCKED'
    );
    const byId = new Map(def.steps.map((s) => [s.stepId, s]));
    for (const patch of patches) {
      const id = String(patch.id || patch.stepId || '');
      const step = byId.get(id);
      if (!step) throw new RequestInvalidError(`UNKNOWN_STEP:${id}`);
      const apiName = String(step.configuration.orderStatus || step.stepId).toUpperCase();
      if (patch.name != null && String(patch.name).toUpperCase() !== apiName) {
        throw new ConfigValidationError({
          name: 'No se puede cambiar el name de un step; es el identificador del estado.',
        });
      }
      if (patch.order != null && Number(patch.order) !== step.order && active) {
        throw new ConfigConflictError('No se puede reordenar steps con instancias de workflow activas.');
      }
      if (patch.label != null) step.configuration.workshopLabel = String(patch.label);
      if (patch.labelForClient != null) {
        step.configuration.customerLabel = String(patch.labelForClient);
        step.configuration.labelForClient = String(patch.labelForClient);
      }
      if (patch.notifyClient != null) step.configuration.notifyClient = Boolean(patch.notifyClient);
      if (patch.notifyAdmin != null) step.configuration.notifyAdmin = Boolean(patch.notifyAdmin);
    }
    def.updatedAt = Date.now();
    def.updatedBy = ctx.userId;
    def.isDefault = true;
    await this.store.saveWorkflowDefinition(def);
    return def;
  }

  async list(ctx: AuthContext): Promise<WorkflowDefinition[]> {
    this.assertWorkshop(ctx, 'production.view');
    await this.ensureDefaults(ctx.tenantId);
    return this.store.listWorkflowDefinitions(ctx.tenantId);
  }

  async publish(ctx: AuthContext, input: Partial<WorkflowDefinition> & { key: string; steps: WorkflowStepDefinition[]; name?: string }): Promise<WorkflowDefinition> {
    this.assertWorkshop(ctx, 'production.edit');
    if (ctx.roleId === 'OPERATOR') throw new AccessDeniedError();
    const list = await this.store.listWorkflowDefinitions(ctx.tenantId);
    const current = list
      .filter((w) => w.key === input.key && w.tenantId === ctx.tenantId)
      .sort((a, b) => b.version - a.version)[0];
    const now = Date.now();
    if (current && current.status === 'PUBLISHED') {
      current.status = 'ARCHIVED';
      current.updatedAt = now;
      await this.store.saveWorkflowDefinition(current);
    }
    const def: WorkflowDefinition = {
      id: current?.id && input.id === current.id ? randomUUID() : input.id || randomUUID(),
      tenantId: ctx.tenantId,
      key: input.key,
      rubricId: input.rubricId || input.key,
      productId: input.productId,
      name: input.name || current?.name || `Workflow ${input.key}`,
      version: (current?.version || 0) + 1,
      status: 'PUBLISHED',
      steps: input.steps,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    await this.store.saveWorkflowDefinition(def);
    await this.audit(ctx.tenantId, ctx.userId, def.version === 1 ? 'workflow.created' : 'workflow.versioned', def.id, {
      version: def.version,
      key: def.key,
    });
    await this.audit(ctx.tenantId, ctx.userId, 'workflow.published', def.id, { version: def.version });
    return def;
  }

  async resolveDefinition(tenantId: string, productId?: string, rubricId?: string): Promise<WorkflowDefinition> {
    await this.ensureDefaults(tenantId);
    const list = await this.store.listWorkflowDefinitions(tenantId);
    const published = list.filter((w) => w.tenantId === tenantId && w.status === 'PUBLISHED');
    if (productId) {
      const config = await this.adminRepo.getConfig(tenantId);
      const product = (config?.products || []).find((p) => p.productId === productId);
      const bound = product?.metadata?.workflowId ? String(product.metadata.workflowId) : undefined;
      if (bound) {
        const byId = published.find((w) => w.id === bound) || list.find((w) => w.id === bound);
        if (byId) return byId;
      }
      if (product?.rubricId) {
        const byRubric = published.filter((w) => w.rubricId === product.rubricId || w.key === product.rubricId);
        if (byRubric.length) return byRubric.sort((a, b) => b.version - a.version)[0];
      }
    }
    if (rubricId) {
      const byRubric = published.filter((w) => w.rubricId === rubricId || w.key === rubricId);
      if (byRubric.length) return byRubric.sort((a, b) => b.version - a.version)[0];
    }
    return published.filter((w) => w.key === 'textile').sort((a, b) => b.version - a.version)[0] || published[0];
  }

  async ensureInstance(ctx: AuthContext, orderId: string): Promise<WorkflowInstance> {
    const existing = await this.store.getWorkflowInstanceByOrder(orderId);
    if (existing) {
      if (existing.tenantId !== ctx.tenantId) throw new AccessDeniedError();
      return existing;
    }
    const order = await this.requireOrder(ctx, orderId);
    const rubricId = order.configurationSnapshot?.disciplineId || String(order.formValues?.discipline || 'textile');
    const productId = String(order.formValues?.productId || '');
    const def = await this.resolveDefinition(ctx.tenantId, productId || undefined, rubricId);
    const now = Date.now();
    const snapshot: WorkflowDefinition = JSON.parse(JSON.stringify(def));
    const instance: WorkflowInstance = {
      instanceId: randomUUID(),
      tenantId: ctx.tenantId,
      orderId,
      workflowId: def.id,
      workflowVersion: def.version,
      snapshot,
      status: 'ACTIVE',
      startedAt: now,
      revision: 1,
      events: [
        { at: now, type: 'workflow.started', actorId: ctx.userId, actorType: this.actorType(ctx), note: `${def.key}@v${def.version}` },
      ],
    };
    await this.store.saveWorkflowInstance(instance);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'workflow',
        entityId: orderId,
        eventType: 'WORKFLOW_STARTED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId, workflowVersion: def.version, workflowKey: def.key, status: order.status },
        correlationId: orderId,
      });
    }
    const processes = await this.store.listProcesses(orderId);
    if (!processes.length) {
      for (const step of snapshot.steps) {
        if (step.configuration.skipProcess) continue;
        const proc: ProcessInstance = {
          instanceId: randomUUID(),
          processId: step.stepId,
          orderId,
          tenantId: ctx.tenantId,
          name: step.name,
          type: processTypeForStep(step),
          order: step.order,
          required: step.required,
          requiresApproval: !!step.configuration.requiresApproval,
          status: 'pending',
          jobIds: [],
          createdAt: now,
          updatedAt: now,
          history: [{ at: now, from: null, to: 'pending', note: 'created' }],
        };
        await this.store.saveProcess(proc);
      }
    }
    await this.advanceAuto(ctx, instance, order);
    return (await this.store.getWorkflowInstanceByOrder(orderId)) || instance;
  }

  async peek(orderId: string): Promise<WorkflowInstance | undefined> {
    return this.store.getWorkflowInstanceByOrder(orderId);
  }

  async getByOrder(ctx: AuthContext, orderId: string): Promise<WorkflowInstance> {
    this.assertWorkshop(ctx, 'production.view');
    const inst = await this.store.getWorkflowInstanceByOrder(orderId);
    if (!inst || inst.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return inst;
  }

  async view(ctx: AuthContext, orderId: string) {
    const inst = await this.ensureInstance(ctx, orderId);
    const processes = await this.store.listProcesses(orderId);
    const jobs = await this.store.listJobs({ orderId, tenantId: ctx.tenantId });
    const steps = inst.snapshot.steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((step) => {
        const process = processes.find((p) => p.processId === step.stepId);
        const current = inst.snapshot.steps.find((s) => s.stepId === inst.currentStepId);
        let runtime: WorkflowStepRuntimeStatus;
        if (process) runtime = runtimeFromProcessStatus(process.status);
        else if (step.configuration.skipProcess) {
          runtime = !current || step.order <= current.order ? (step.order < (current?.order || 0) || step.configuration.autoComplete ? 'COMPLETED' : 'PENDING') : 'PENDING';
          if (current && step.order < current.order) runtime = 'COMPLETED';
          if (!current && step.configuration.autoComplete) runtime = 'COMPLETED';
        } else runtime = 'PENDING';
        let marker: 'done' | 'current' | 'waiting' | 'blocked' | 'upcoming' = 'upcoming';
        if (runtime === 'COMPLETED' || runtime === 'SKIPPED') marker = 'done';
        else if (runtime === 'ACTIVE') marker = process?.status === 'waiting_approval' ? 'waiting' : 'current';
        else if (runtime === 'BLOCKED' || runtime === 'FAILED') marker = 'blocked';
        return {
          stepId: step.stepId,
          name: step.name,
          type: step.type,
          status: runtime,
          marker,
          processStatus: process?.status,
          startedAt: process?.history.find((h) => h.to === 'active' || h.to === 'waiting_approval')?.at,
          completedAt: process?.history.find((h) => h.to === 'completed')?.at,
        };
      });
    const jobViews = ctx.roleId === 'CUSTOMER' ? undefined : jobs.map((j) => ({
      jobId: j.jobId,
      stepId: j.stepId || processes.find((p) => p.instanceId === j.processInstanceId)?.processId,
      type: j.type,
      status: publicJobStatus(j.status),
      attempt: (j.retryCount || 0) + 1,
      error: j.error,
      priority: j.priority,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
    }));
    return {
      instanceId: inst.instanceId,
      workflowId: inst.workflowId,
      workflowVersion: inst.workflowVersion,
      name: inst.snapshot.name,
      key: inst.snapshot.key,
      status: inst.status,
      currentStepId: inst.currentStepId,
      blockedReason: inst.blockedReason,
      revision: inst.revision,
      steps,
      jobs: jobViews,
      events: inst.events,
    };
  }

  async startStep(ctx: AuthContext, orderId: string, stepId: string, expectedRevision?: number) {
    const inst = await this.ensureInstance(ctx, orderId);
    this.assertRevision(inst, expectedRevision);
    const step = this.stepOf(inst, stepId);
    this.assertStepRole(ctx, step);
    const process = await this.processOf(orderId, stepId);
    const from = runtimeFromProcessStatus(process.status);
    if (!canTransitionStep(from, 'ACTIVE', step.configuration)) throw new RequestInvalidError(`NO_STEP_PATH:${from}:ACTIVE`);
    const blocked = await this.preconditionFailure(ctx, inst, step);
    if (blocked) {
      await this.block(ctx, inst, process, step, blocked.internal, blocked.customer);
      throw new RequestInvalidError(`WORKFLOW_BLOCKED:${blocked.internal}`);
    }
    const requiresApproval = !!step.configuration.requiresApproval;
    await this.setRuntime(process, 'ACTIVE', 'step started', requiresApproval);
    inst.currentStepId = stepId;
    inst.status = 'ACTIVE';
    inst.blockedReason = undefined;
    this.pushEvent(inst, ctx, 'step.started', stepId);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.audit(ctx.tenantId, ctx.userId, 'step.started', orderId, { stepId });
    await this.applyOrderStatus(ctx, orderId, step);
    if ((step.configuration.postconditions || []).includes('create_job')) {
      await this.ensureJob(ctx, orderId, process, step);
    }
    return this.view(ctx, orderId);
  }

  async completeStep(ctx: AuthContext, orderId: string, stepId: string, result?: string, expectedRevision?: number) {
    const inst = await this.ensureInstance(ctx, orderId);
    this.assertRevision(inst, expectedRevision);
    const step = this.stepOf(inst, stepId);
    this.assertStepRole(ctx, step);
    const process = await this.processOf(orderId, stepId);
    const from = runtimeFromProcessStatus(process.status);
    if (from === 'COMPLETED') return this.view(ctx, orderId);
    if (!canTransitionStep(from, 'COMPLETED', step.configuration)) {
      throw new RequestInvalidError(`NO_STEP_PATH:${from}:COMPLETED`);
    }
    await this.setRuntime(process, 'COMPLETED', result || 'step completed');
    this.pushEvent(inst, ctx, 'step.completed', stepId, result);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.audit(ctx.tenantId, ctx.userId, 'step.completed', orderId, { stepId, result });
    await this.applyOrderStatus(ctx, orderId, step);
    const order = await this.requireOrder(ctx, orderId);
    await this.advanceAuto(ctx, inst, order);
    if (step.type === 'COMPLETED' || step.type === 'FINISH') {
      inst.status = 'COMPLETED';
      inst.completedAt = Date.now();
      await this.store.saveWorkflowInstance(inst);
      if (this.tracer) {
        await this.tracer.record({
          tenantId: ctx.tenantId,
          entityType: 'workflow',
          entityId: orderId,
          eventType: 'WORKFLOW_COMPLETED',
          actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
          actorId: ctx.userId,
          metadata: { orderId, workflowVersion: inst.workflowVersion, workflowStepId: stepId },
          correlationId: orderId,
        });
      }
    }
    return this.view(ctx, orderId);
  }

  async qc(ctx: AuthContext, orderId: string, result: 'PASS' | 'FAIL', expectedRevision?: number) {
    const inst = await this.ensureInstance(ctx, orderId);
    const qcStep = inst.snapshot.steps.find((s) => s.type === 'QC') || this.stepOf(inst, inst.currentStepId || '');
    if (result === 'PASS') return this.completeStep(ctx, orderId, qcStep.stepId, 'PASS', expectedRevision);
    this.assertStepRole(ctx, qcStep);
    const process = await this.processOf(orderId, qcStep.stepId);
    await this.setRuntime(process, 'FAILED', 'QC FAIL');
    this.pushEvent(inst, ctx, 'step.failed', qcStep.stepId, 'FAIL');
    const target = qcStep.configuration.failTargetStepId || 'editing';
    await this.returnTo(ctx, inst, target, 'qc fail');
    await this.audit(ctx.tenantId, ctx.userId, 'workflow.transition', orderId, { from: qcStep.stepId, to: target, result: 'FAIL' });
    return this.view(ctx, orderId);
  }

  async onChangeRequest(orderId: string, tenantId: string, actorId: string): Promise<void> {
    const inst = await this.store.getWorkflowInstanceByOrder(orderId);
    if (!inst || inst.tenantId !== tenantId) return;
    const approval = inst.snapshot.steps.find((s) => s.configuration.requiresApproval && inst.currentStepId === s.stepId)
      || inst.snapshot.steps.find((s) => s.configuration.requiresApproval);
    if (!approval) return;
    const target = approval.configuration.changeRequestStepId || 'editing';
    const ctx: AuthContext = { token: '', userId: actorId, tenantId, roleId: 'CUSTOMER', permissions: [] };
    await this.returnTo(ctx, inst, target, 'change request');
    await this.audit(tenantId, actorId, 'workflow.transition', orderId, { from: approval.stepId, to: target, result: 'CHANGE_REQUESTED' });
  }

  async onApproved(orderId: string, tenantId: string, actorId: string): Promise<void> {
    const inst = await this.store.getWorkflowInstanceByOrder(orderId);
    if (!inst || inst.tenantId !== tenantId) return;
    const approval = inst.snapshot.steps.find((s) => s.configuration.requiresApproval);
    if (!approval) return;
    const ctx: AuthContext = { token: '', userId: actorId, tenantId, roleId: 'CUSTOMER', permissions: ['orders.view'] };
    const process = await this.processOf(orderId, approval.stepId).catch(() => undefined);
    if (process && runtimeFromProcessStatus(process.status) !== 'COMPLETED') {
      await this.setRuntime(process, 'COMPLETED', 'customer approved');
      this.pushEvent(inst, ctx, 'step.completed', approval.stepId, 'APPROVED');
      inst.revision += 1;
      await this.store.saveWorkflowInstance(inst);
    }
    const order = await this.orders.getOrder(orderId, 'admin');
    if (order) await this.advanceAuto(ctx, inst, order);
  }

  async cancel(ctx: AuthContext, orderId: string, reason: string) {
    this.assertWorkshop(ctx, 'production.edit');
    const inst = await this.ensureInstance(ctx, orderId);
    const processes = await this.store.listProcesses(orderId);
    for (const p of processes) {
      if (p.status !== 'completed' && p.status !== 'cancelled') {
        await this.setRuntime(p, 'CANCELLED', reason);
      }
    }
    const jobs = await this.store.listJobs({ orderId, tenantId: ctx.tenantId });
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'dispatched' || job.status === 'processing') {
        try {
          await this.orchestrator.cancelJob(ctx, job.jobId);
        } catch {
          /* already terminal */
        }
      }
    }
    inst.status = 'CANCELLED';
    inst.cancelReason = reason;
    inst.completedAt = Date.now();
    this.pushEvent(inst, ctx, 'workflow.cancelled', inst.currentStepId, reason);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.orders.forceTransition(orderId, 'cancelled', { actorId: ctx.userId, role: 'admin', label: ctx.roleId }, reason);
    await this.audit(ctx.tenantId, ctx.userId, 'workflow.transition', orderId, { to: 'CANCELLED', reason });
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'workflow',
        entityId: orderId,
        eventType: 'WORKFLOW_CANCELLED',
        actorType: actorTypeFromRole(ctx.roleId, ctx.userId),
        actorId: ctx.userId,
        metadata: { orderId, reason },
        correlationId: orderId,
      });
    }
    return this.view(ctx, orderId);
  }

  async retryJob(ctx: AuthContext, jobId: string) {
    const job = await this.orchestrator.retryJob(ctx, jobId);
    await this.audit(ctx.tenantId, ctx.userId, 'retry', job.orderId, { jobId, attempt: job.retryCount + 1 });
    return { ...job, attempt: job.retryCount + 1, publicStatus: publicJobStatus(job.status) };
  }

  async failJob(ctx: AuthContext, jobId: string, error: string) {
    const job = await this.orchestrator.failJob(ctx, jobId, error);
    const inst = await this.store.getWorkflowInstanceByOrder(job.orderId);
    if (inst) {
      inst.status = 'BLOCKED';
      inst.blockedReason = error;
      inst.blockedCustomerReason = 'Hay un problema técnico en el taller. Ya estamos trabajando en ello.';
      this.pushEvent(inst, ctx, 'job.failed', job.stepId, error);
      await this.store.saveWorkflowInstance(inst);
    }
    await this.audit(ctx.tenantId, ctx.userId, 'job.failed', job.orderId, { jobId, error });
    return job;
  }

  async override(ctx: AuthContext, orderId: string, stepId: string, to: WorkflowStepRuntimeStatus, reason: string) {
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    const inst = await this.ensureInstance(ctx, orderId);
    const process = await this.processOf(orderId, stepId);
    await this.setRuntime(process, to, `ADMIN_OVERRIDE: ${reason}`);
    this.pushEvent(inst, ctx, 'administrative override', stepId, reason);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.audit(ctx.tenantId, ctx.userId, 'administrative override', orderId, { stepId, to, reason });
    return this.view(ctx, orderId);
  }

  private async advanceAuto(ctx: AuthContext, inst: WorkflowInstance, order: PersistedOrder): Promise<void> {
    const steps = inst.snapshot.steps.slice().sort((a, b) => a.order - b.order);
    for (const step of steps) {
      const process = await this.processOf(order.orderId, step.stepId).catch(() => undefined);
      if (step.configuration.skipProcess) {
        if (step.configuration.autoComplete) {
          const blocked = await this.preconditionFailure(ctx, inst, step);
          if (blocked) {
            inst.status = 'BLOCKED';
            inst.blockedReason = blocked.internal;
            inst.blockedCustomerReason = blocked.customer;
            inst.currentStepId = step.stepId;
            this.pushEvent(inst, ctx, 'step.blocked', step.stepId, blocked.internal);
            inst.revision += 1;
            await this.store.saveWorkflowInstance(inst);
            return;
          }
          await this.applyOrderStatus(ctx, order.orderId, step);
          continue;
        }
        continue;
      }
      if (!process) continue;
      const runtime = runtimeFromProcessStatus(process.status);
      if (runtime === 'COMPLETED' || runtime === 'SKIPPED' || runtime === 'CANCELLED') continue;
      if (runtime === 'ACTIVE' || runtime === 'BLOCKED' || runtime === 'FAILED') {
        inst.currentStepId = step.stepId;
        await this.store.saveWorkflowInstance(inst);
        return;
      }
      const blocked = await this.preconditionFailure(ctx, inst, step);
      if (blocked) {
        if (step.configuration.autoComplete || step.configuration.autoActivate !== false) {
          await this.block(ctx, inst, process, step, blocked.internal, blocked.customer);
        }
        return;
      }
      if (step.configuration.autoComplete) {
        await this.setRuntime(process, 'COMPLETED', 'auto', !!step.configuration.requiresApproval);
        this.pushEvent(inst, { ...ctx, userId: 'pipeline' }, 'step.completed', step.stepId, 'auto');
        await this.applyOrderStatus(ctx, order.orderId, step);
        continue;
      }
      if (step.configuration.autoActivate === false) {
        inst.currentStepId = step.stepId;
        await this.store.saveWorkflowInstance(inst);
        return;
      }
      await this.setRuntime(process, 'ACTIVE', 'activated', !!step.configuration.requiresApproval);
      inst.currentStepId = step.stepId;
      inst.status = 'ACTIVE';
      this.pushEvent(inst, ctx, 'step.started', step.stepId);
      await this.store.saveWorkflowInstance(inst);
      await this.applyOrderStatus(ctx, order.orderId, step);
      if ((step.configuration.postconditions || []).includes('create_job')) {
        await this.ensureJob(ctx, order.orderId, process, step);
      }
      return;
    }
    inst.status = inst.snapshot.steps.some((s) => s.type === 'COMPLETED') ? 'ACTIVE' : 'COMPLETED';
    await this.store.saveWorkflowInstance(inst);
  }

  private async returnTo(ctx: AuthContext, inst: WorkflowInstance, targetStepId: string, note: string) {
    const steps = inst.snapshot.steps.slice().sort((a, b) => a.order - b.order);
    const target = steps.find((s) => s.stepId === targetStepId);
    if (!target) throw new RequestInvalidError('STEP_NOT_FOUND');
    for (const step of steps) {
      if (step.order < target.order) continue;
      if (step.configuration.skipProcess) continue;
      const process = await this.processOf(inst.orderId, step.stepId);
      if (step.stepId === target.stepId) {
        await this.setRuntime(process, 'ACTIVE', note);
      } else if (runtimeFromProcessStatus(process.status) !== 'PENDING') {
        await this.setRuntime(process, 'PENDING', `reset after ${note}`);
      }
    }
    inst.currentStepId = target.stepId;
    inst.status = 'ACTIVE';
    inst.blockedReason = undefined;
    this.pushEvent(inst, ctx, 'workflow.transition', target.stepId, note);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.applyOrderStatus(ctx, inst.orderId, target);
  }

  private async ensureJob(ctx: AuthContext, orderId: string, process: ProcessInstance, step: WorkflowStepDefinition) {
    const jobs = await this.store.listJobs({ orderId, processInstanceId: process.instanceId, tenantId: ctx.tenantId });
    const live = jobs.find((j) => j.status !== 'cancelled');
    if (live) return live;
    const workshopCtx: AuthContext = {
      ...ctx,
      userId: 'pipeline',
      roleId: 'ADMIN_PRINCIPAL',
      permissions: ['production.edit', 'production.view'],
    };
    const created = await this.orchestrator.enqueueJobs(workshopCtx, process.instanceId, 1, 'cloud');
    const job = created[0];
    if (job) {
      job.type = String(step.configuration.jobType || step.type);
      job.stepId = step.stepId;
      job.workflowInstanceId = (await this.store.getWorkflowInstanceByOrder(orderId))?.instanceId;
      const order = await this.orders.getOrder(orderId, 'admin');
      if (order) job.priority = order.priority;
      await this.store.saveJob(job);
      await this.audit(ctx.tenantId, ctx.userId, 'job.created', orderId, { jobId: job.jobId, stepId: step.stepId });
    }
    return job;
  }

  private async applyOrderStatus(ctx: AuthContext, orderId: string, step: WorkflowStepDefinition) {
    const to = step.configuration.orderStatus;
    if (!to) return;
    try {
      await this.orders.walkToStatus(orderId, to, { actorId: ctx.userId, role: ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin' }, `workflow:${step.stepId}`);
    } catch {
      /* keep current if path blocked */
    }
  }

  private async preconditionFailure(
    ctx: AuthContext,
    inst: WorkflowInstance,
    step: WorkflowStepDefinition
  ): Promise<{ internal: string; customer: string } | undefined> {
    const checks = step.configuration.preconditions || ['previous_completed'];
    const order = await this.requireOrder(ctx, inst.orderId);
    const processes = await this.store.listProcesses(inst.orderId);
    for (const check of checks) {
      const hit = await this.evalPrecondition(check, inst, step, order, processes);
      if (hit) return hit;
    }
    return undefined;
  }

  private async evalPrecondition(
    check: WorkflowPrecondition,
    inst: WorkflowInstance,
    step: WorkflowStepDefinition,
    order: PersistedOrder,
    processes: ProcessInstance[]
  ): Promise<{ internal: string; customer: string } | undefined> {
    if (check === 'previous_completed') {
      const prev = inst.snapshot.steps.filter((s) => s.order < step.order && s.required);
      const ok = prev.every((s) => {
        if (s.configuration.skipProcess) return true;
        const p = processes.find((x) => x.processId === s.stepId);
        const st = p ? runtimeFromProcessStatus(p.status) : 'PENDING';
        return st === 'COMPLETED' || st === 'SKIPPED';
      });
      if (!ok) return { internal: 'previous step incomplete', customer: 'El taller sigue trabajando en una etapa anterior.' };
    }
    if (check === 'approved_file') {
      const hasFile = (order.attachments || []).some((f) => f.current);
      const approved = order.approvalStatus === 'approved' || (order.approvals || []).some((a) => a.decision === 'approved');
      if (!hasFile && !approved) return { internal: 'approved file missing', customer: 'Falta un archivo aprobado para continuar.' };
    }
    if (check === 'material_selected') {
      const has = (order.consumptions || []).length > 0 || order.formValues?.material || order.formValues?.tpu_film || order.formValues?.dtf_film;
      if (!has) return { internal: 'material not selected', customer: 'Falta seleccionar el material.' };
    }
    if (check === 'quantity_valid') {
      const qty = Number(order.formValues?.quantity || order.formValues?.meters || order.formValues?.sheets);
      if (!(qty > 0) && !(order.consumptions || []).length) return { internal: 'quantity invalid', customer: 'La cantidad no es válida.' };
    }
    if (check === 'customer_approved') {
      const approved = order.approvalStatus === 'approved' || (order.approvals || []).some((a) => a.decision === 'approved');
      if (!approved) return { internal: 'customer approval pending', customer: 'Esperamos tu aprobación para continuar.' };
    }
    if (check === 'material_active') {
      const config = await this.adminRepo.getConfig(order.tenantId);
      const ids = [
        ...(order.consumptions || []).map((c) => c.materialId),
        String(order.formValues?.material || ''),
        String(order.formValues?.tpu_film || ''),
        String(order.formValues?.dtf_film || ''),
      ].filter(Boolean);
      const inactive = (config?.materials || []).filter((m) => ids.includes(m.materialId) && m.active === false);
      if (inactive.length) {
        return { internal: `material inactive:${inactive[0].materialId}`, customer: 'Un material de tu pedido no está disponible.' };
      }
    }
    return undefined;
  }

  private async block(
    ctx: AuthContext,
    inst: WorkflowInstance,
    process: ProcessInstance,
    step: WorkflowStepDefinition,
    internal: string,
    customer: string
  ) {
    await this.setRuntime(process, 'BLOCKED', internal);
    inst.status = 'BLOCKED';
    inst.blockedReason = internal;
    inst.blockedCustomerReason = customer;
    inst.currentStepId = step.stepId;
    this.pushEvent(inst, ctx, 'step.blocked', step.stepId, internal);
    inst.revision += 1;
    await this.store.saveWorkflowInstance(inst);
    await this.audit(ctx.tenantId, ctx.userId, 'step.blocked', inst.orderId, { stepId: step.stepId, reason: internal });
  }

  private async setRuntime(process: ProcessInstance, to: WorkflowStepRuntimeStatus, note: string, requiresApproval?: boolean) {
    const mapped = processStatusFromRuntime(to, requiresApproval || process.requiresApproval);
    process.history = [...process.history, { at: Date.now(), from: process.status, to: mapped, note }];
    process.status = mapped;
    process.updatedAt = Date.now();
    await this.store.saveProcess(process);
    if (mapped === 'waiting_approval' && this.tracer) {
      const order = await this.orders.getOrder(process.orderId, 'admin');
      if (order) {
        await this.tracer.record({
          tenantId: process.tenantId,
          entityType: 'approval',
          entityId: process.orderId,
          eventType: 'APPROVAL_REQUESTED',
          actorType: 'SYSTEM',
          actorId: 'system',
          metadata: {
            orderId: order.orderId,
            displayNumber: order.displayNumber,
            workflowStepId: process.processId,
            artifactVersion: (order.attachments || []).find((f) => f.current)?.version,
            status: order.status,
          },
          correlationId: order.orderId,
        });
        await this.tracer.notifyOperational({
          tenantId: order.tenantId,
          type: 'APPROVAL_REQUIRED',
          title: 'Aprobación requerida',
          customerMessage: 'Tu pedido necesita aprobación.',
          workshopMessage: `El pedido ${order.displayNumber || order.orderId} espera aprobación.`,
          entityType: 'order',
          entityId: order.orderId,
          order,
          dedupeKey: `${order.orderId}:APPROVAL_REQUIRED:${process.processId}`,
          includeCustomer: true,
          includeWorkshop: true,
          metadata: { route: `/orders/${(order.displayNumber || order.orderId).replace(/^#/, '')}` },
        });
      }
    }
  }

  private pushEvent(inst: WorkflowInstance, ctx: AuthContext, type: string, stepId?: string, result?: string) {
    inst.events.push({
      at: Date.now(),
      type,
      stepId,
      actorId: ctx.userId,
      actorType: this.actorType(ctx),
      result,
    });
  }

  private actorType(ctx: AuthContext): WorkflowActorType {
    if (ctx.userId === 'pipeline' || ctx.roleId === 'SUPER_ADMIN') return 'SYSTEM';
    return 'USER';
  }

  private stepOf(inst: WorkflowInstance, stepId: string): WorkflowStepDefinition {
    const step = inst.snapshot.steps.find((s) => s.stepId === stepId);
    if (!step) throw new RequestInvalidError('STEP_NOT_FOUND');
    return step;
  }

  private async processOf(orderId: string, stepId: string): Promise<ProcessInstance> {
    const processes = await this.store.listProcesses(orderId);
    const process = processes.find((p) => p.processId === stepId);
    if (!process) throw new RequestInvalidError('STEP_NOT_FOUND');
    return process;
  }

  private assertRevision(inst: WorkflowInstance, expected?: number) {
    if (expected == null) return;
    if (inst.revision !== expected) throw new OrderConflictError(inst.revision, expected);
  }

  private assertStepRole(ctx: AuthContext, step: WorkflowStepDefinition) {
    if (ctx.userId === 'pipeline') return;
    if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return;
    const roles = step.roles || [];
    if (ctx.roleId === 'CUSTOMER' && roles.includes('CUSTOMER')) return;
    if (ctx.roleId === 'ADMIN' && (roles.includes('ADMIN') || roles.includes('SUBADMIN'))) return;
    if (ctx.roleId === 'OPERATOR' && roles.includes('OPERATOR')) return;
    throw new AccessDeniedError();
  }

  private async requireOrder(ctx: AuthContext, orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return order;
  }

  private assertWorkshop(ctx: AuthContext, permission: 'production.view' | 'production.edit') {
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
    if (permission === 'production.view' && (hasPermission(probe, 'production.view') || hasPermission(probe, 'production.edit'))) return;
    if (!hasPermission(probe, permission)) throw new AccessDeniedError();
  }

  private async audit(tenantId: string, actorId: string, action: string, target: string, payload: Record<string, unknown>) {
    if (this.tracer && (action === 'job.created' || action === 'job.failed' || action === 'retry')) {
      return;
    }
    const eventType = WORKFLOW_ACTION_TO_EVENT[action] || action;
    if (this.tracer) {
      await this.tracer.record({
        tenantId,
        entityType: action.startsWith('job') ? 'job' : 'workflow',
        entityId: target,
        eventType,
        actorType: actorTypeFromRole(undefined, actorId),
        actorId,
        metadata: { ...payload, orderId: target, workflowStepId: payload.stepId },
        correlationId: String(payload.orderId || target),
      });
      if (eventType === 'STEP_BLOCKED') {
        const order = await this.orders.getOrder(target, 'admin');
        if (order) {
          await this.tracer.notifyOperational({
            tenantId,
            type: 'WORKFLOW_BLOCKED',
            title: 'Workflow bloqueado',
            workshopMessage: `El workflow del pedido ${order.displayNumber || order.orderId} quedó bloqueado.`,
            entityType: 'order',
            entityId: order.orderId,
            order,
            dedupeKey: `${order.orderId}:WORKFLOW_BLOCKED:${payload.stepId || 'step'}`,
            includeWorkshop: true,
            includeOperators: true,
          });
          await this.tracer.record({
            tenantId,
            entityType: 'order',
            entityId: order.orderId,
            eventType: 'ORDER_BLOCKED',
            actorType: actorTypeFromRole(undefined, actorId),
            actorId,
            metadata: { orderId: order.orderId, status: order.status, workflowStepId: payload.stepId },
            correlationId: order.orderId,
          });
        }
      }
      if (eventType === 'JOB_FAILED') {
        const order = await this.orders.getOrder(target, 'admin');
        if (order) {
          await this.tracer.notifyOperational({
            tenantId,
            type: 'JOB_FAILED',
            title: 'Trabajo fallido',
            workshopMessage: `Falló un trabajo del pedido ${order.displayNumber || order.orderId}.`,
            entityType: 'job',
            entityId: String(payload.jobId || target),
            order,
            dedupeKey: `${order.orderId}:JOB_FAILED:${payload.jobId || 'job'}`,
            includeWorkshop: true,
            includeOperators: true,
          });
        }
      }
      return;
    }
    await this.adminRepo.appendAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      tenantId,
      actorId,
      action,
      target,
      result: 'ok',
      detail: JSON.stringify(payload),
    });
  }
}
