import { randomUUID } from 'crypto';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import type { AuthContext, TenantConfig } from '../../contracts/admin-domain';
import type {
  DeadlineKind,
  DeadlinePolicy,
  OrderPriority,
  OrderStatus,
  PersistedOrder,
} from '../../contracts/order-domain';
import { DEFAULT_DEADLINE_POLICY } from '../../contracts/order-domain';
import {
  computeDeadline,
  findOrderStatusPath,
  OrderConflictError,
  operationalOrderStatus,
} from '../../contracts/order-lifecycle';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import type { OrderActor } from '../../contracts/order-domain';
import {
  DEFAULT_KANBAN_COLUMNS,
  type CalendarBucket,
  type ConsumptionLineView,
  type DeadlineClass,
  type FinanceView,
  type KanbanColumnDef,
  type ProductionBoard,
  type ProductionCard,
  type ProductionCounters,
  type ProductionDetail,
  type ProductionJobView,
  type ProductionProcessView,
  type ProductionQuery,
} from '../../contracts/production-center';
import { PRIORITY_RANK } from '../../contracts/production-orchestration';
import type { ProcessInstance, ProductionJob } from '../../contracts/production-orchestration';
import { TenantRestrictedError, type TenantLifecycleStatus } from '../../contracts/platform-domain';
import type { AdminRepository } from './AdminRepository';
import type { ProductionStore } from './ProductionStore';
import type { OrderService } from './OrderService';
import type { ProductionOrchestrator } from './ProductionOrchestrator';
import type { WorkflowEngine } from './WorkflowEngine';
import type { TraceService } from './TraceService';

const UNIT_LABEL: Record<string, string> = {
  METRO: 'm',
  M2: 'm²',
  UNIDAD: 'u',
  HOJA: 'hojas',
  KG: 'kg',
  ROLLO: 'rollos',
  LITRO: 'l',
};

const WAITING = new Set<OrderStatus>(['approved']);
const PRODUCTION = new Set<OrderStatus>(['production']);
const READY = new Set<OrderStatus>(['ready']);
const FINISHED = new Set<OrderStatus>(['completed', 'delivered']);
const PENDING = new Set<OrderStatus>(['pending', 'received']);
const IN_PROGRESS = new Set<OrderStatus>([
  'reviewing',
  'editing',
  'preparing',
  'printing',
  'printing_in_progress',
]);

export class ProductionCenterService {
  private workflows?: WorkflowEngine;
  private tracer?: TraceService;

  constructor(
    private orders: OrderService,
    private orchestrator: ProductionOrchestrator,
    private store: ProductionStore,
    private adminRepo: AdminRepository
  ) {}

  setWorkflows(workflows: WorkflowEngine): void {
    this.workflows = workflows;
  }

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async query(ctx: AuthContext, query: ProductionQuery = {}): Promise<ProductionBoard> {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') {
      const probeUser = {
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
      if (!hasPermission(probeUser, 'orders.view')) throw new AccessDeniedError();
    }
    const all = await this.buildCards(ctx, {});
    const filtered = hasWorkspaceFilters(query) ? await this.buildCards(ctx, query) : all;
    const sorted = this.sortCards(filtered.cards, query.sort || 'urgency');
    const offset = Math.max(0, query.offset || 0);
    const limit = Math.min(200, Math.max(1, query.limit || 50));
    const pageItems = sorted.slice(offset, offset + limit);
    const kanban: Record<string, ProductionCard[]> = {};
    for (const col of filtered.columns) kanban[col.id] = [];
    for (const card of sorted) {
      if (!kanban[card.columnId]) kanban[card.columnId] = [];
      kanban[card.columnId].push(card);
    }
    const tenant = await this.resolveTenant(ctx.tenantId);
    return {
      counters: this.counters(all.cards),
      columns: filtered.columns,
      kanban,
      page: { items: pageItems, total: sorted.length, offset, limit },
      generatedAt: Date.now(),
      tenantStatus: tenant && tenant.tenantId === ctx.tenantId ? tenant.status : undefined,
    };
  }

  async calendar(ctx: AuthContext, query: ProductionQuery = {}): Promise<CalendarBucket[]> {
    this.assertAccess(ctx, 'production.view');
    const { cards } = await this.buildCards(ctx, query);
    const map = new Map<string, CalendarBucket>();
    for (const card of cards) {
      const date = utcDate(card.dueAt);
      if (!map.has(date)) map.set(date, { date, due: [], approaching: [], expired: [] });
      const bucket = map.get(date)!;
      bucket.due.push(card);
      if (card.deadlineKind === 'expired') bucket.expired.push(card);
      if (card.deadlineKind === 'approaching_deadline' || card.deadlineKind === 'deadline_today') {
        bucket.approaching.push(card);
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async getDetail(ctx: AuthContext, orderId: string): Promise<ProductionDetail> {
    this.assertAccess(ctx, 'production.view');
    const order = await this.requireTenantOrder(ctx, orderId);
    const seeCosts = this.canSeeCosts(ctx);
    const seeJobs = this.canSeeJobs(ctx);
    const processes = await this.store.listProcesses(orderId);
    const jobs = await this.store.listJobs({ orderId, tenantId: ctx.tenantId });
    const { cards } = await this.buildCards(ctx, { q: order.orderId, limit: 1 });
    const card =
      cards.find((c) => c.orderId === orderId) ||
      this.toCard(order, processes, jobs, seeCosts, this.canSeeMargin(ctx), DEFAULT_KANBAN_COLUMNS, Date.now());
    const consumption = this.consumptionLines(order, seeCosts);
    const seeMargin = this.canSeeMargin(ctx);
    await this.audit(ctx, 'order.viewed', orderId, {});
    let workflow: Awaited<ReturnType<WorkflowEngine['view']>> | undefined;
    try {
      workflow = this.workflows ? await this.workflows.view(ctx, orderId) : undefined;
    } catch {
      workflow = undefined;
    }
    const processViews = workflow
      ? workflow.steps.map((s) => ({
          instanceId: s.stepId,
          name: s.name,
          type: s.type,
          status: (s.processStatus || 'pending') as ProductionProcessView['status'],
          marker: s.marker as ProductionProcessView['marker'],
          waitingPrevious: s.marker === 'upcoming',
        }))
      : this.processViews(processes, jobs);
    return {
      card,
      customerName: order.customerName,
      customerId: order.customerId,
      files: (order.attachments || []).map((f) => ({
        fileId: f.fileId,
        filename: f.filename,
        version: f.version,
        current: f.current,
        mimeType: f.mimeType,
        size: f.size,
        status: f.current ? 'actual' : 'reemplazada',
      })),
      form: order.formValues,
      consumption,
      consumptionByUnit: groupByUnit(consumption),
      finance: seeCosts ? financeOf(order, seeMargin) : undefined,
      processes: processViews,
      jobs: seeJobs ? this.jobViews(processes, jobs) : undefined,
      workflow,
      approvals: (order.approvals || [])
        .filter((a) => a.decision === 'approved')
        .map((a) => ({
          at: a.at,
          decision: a.decision,
          note: a.note,
          actorId: a.actorId,
          schemaVersion: a.schemaVersion,
          fileVersion: a.fileVersion,
        })),
      changeRequests: (order.approvals || [])
        .filter((a) => a.decision === 'rejected')
        .map((a) => ({ at: a.at, note: a.note, fileVersion: a.fileVersion })),
      internalComments: order.internalComments || [],
      history: order.history.map((h) => ({
        at: h.at,
        from: h.from,
        to: h.to,
        note: h.note,
        actorId: h.actor.actorId,
      })),
      timeline: this.tracer ? await this.tracer.timeline(ctx, orderId).catch(() => []) : undefined,
      phase: processes.length
        ? (order.orchestration?.phase as ProductionDetail['phase'])
        : undefined,
      revision: order.revision || 1,
      generatedAt: Date.now(),
    };
  }

  async setPriority(ctx: AuthContext, orderId: string, priority: OrderPriority, expectedRevision?: number): Promise<PersistedOrder> {
    this.assertAccess(ctx, 'production.edit');
    const order = await this.requireTenantOrder(ctx, orderId);
    const before = order.priority;
    const updated = await this.orders.setPriority(orderId, priority, expectedRevision);
    await this.audit(ctx, 'production.priority', orderId, { before, after: priority });
    await this.audit(ctx, 'order.priority_changed', orderId, { before, after: priority });
    return updated;
  }

  async transition(ctx: AuthContext, orderId: string, to: OrderStatus, expectedRevision?: number): Promise<PersistedOrder> {
    this.assertAccess(ctx, 'production.edit');
    await this.assertTenantActive(ctx);
    const order = await this.requireTenantOrder(ctx, orderId);
    const from = operationalOrderStatus(order);
    const path = findOrderStatusPath(from, to);
    if (from !== to && !path.length) {
      throw new Error(`NO_STATUS_PATH:${from}:${to}`);
    }
    if (expectedRevision != null && (order.revision || 1) !== expectedRevision) {
      throw new OrderConflictError(order.revision || 1, expectedRevision);
    }
    const actor: OrderActor = { actorId: ctx.userId, role: 'admin', label: ctx.roleId };
    const updated = await this.orders.walkToStatus(orderId, to, actor, 'production-center');
    await this.audit(ctx, 'order.status_changed', orderId, { before: from, after: to });
    return updated;
  }

  async forceTransition(ctx: AuthContext, orderId: string, to: OrderStatus, reason: string, expectedRevision?: number) {
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantActive(ctx);
    const order = await this.requireTenantOrder(ctx, orderId);
    const actor: OrderActor = { actorId: ctx.userId, role: 'admin', label: ctx.roleId };
    const updated = await this.orders.forceTransition(orderId, to, actor, reason, expectedRevision);
    await this.audit(ctx, 'order.administrative_override', orderId, {
      before: order.status,
      after: to,
      reason,
    });
    return updated;
  }

  async assign(ctx: AuthContext, orderId: string, userId: string, expectedRevision?: number) {
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') {
      const probeUser = {
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
      if (!hasPermission(probeUser, 'orders.edit')) throw new AccessDeniedError();
    }
    await this.assertTenantActive(ctx);
    const order = await this.requireTenantOrder(ctx, orderId);
    const users = await this.adminRepo.listUsers(ctx.tenantId);
    const user = users.find((u) => u.userId === userId && u.tenantId === ctx.tenantId);
    if (!user || user.roleId === 'CUSTOMER' || user.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    const updated = await this.orders.assign(orderId, user.userId, user.displayCode || user.login, expectedRevision);
    await this.audit(ctx, order.assignedTo ? 'order.reassigned' : 'order.assigned', orderId, {
      before: order.assignedTo,
      after: userId,
    });
    return updated;
  }

  async addComment(ctx: AuthContext, orderId: string, body: string, expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    await this.assertTenantActive(ctx);
    await this.requireTenantOrder(ctx, orderId);
    if (!body?.trim()) throw new Error('COMMENT_REQUIRED');
    const updated = await this.orders.addInternalComment(
      orderId,
      { actorId: ctx.userId, actorLabel: ctx.roleId, body: body.trim() },
      expectedRevision
    );
    await this.audit(ctx, 'order.comment_created', orderId, {});
    return updated;
  }

  async setDueAt(ctx: AuthContext, orderId: string, dueAt: number, expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    await this.assertTenantActive(ctx);
    await this.requireTenantOrder(ctx, orderId);
    const updated = await this.orders.setDueAt(orderId, dueAt, expectedRevision);
    await this.audit(ctx, 'order.deadline_changed', orderId, { after: dueAt });
    return updated;
  }

  async downloadFile(ctx: AuthContext, orderId: string, fileId: string) {
    this.assertAccess(ctx, 'production.view');
    const order = await this.requireTenantOrder(ctx, orderId);
    const file = (order.attachments || []).find((f) => f.fileId === fileId);
    if (!file) throw new AccessDeniedError();
    const bytes = this.store.readBlob ? await this.store.readBlob(fileId) : undefined;
    if (!bytes) throw new AccessDeniedError();
    await this.audit(ctx, 'order.file_downloaded', orderId, { fileId });
    return { fileId, filename: file.filename, mimeType: file.mimeType, contentBase64: bytes.toString('base64') };
  }

  async selectVersion(ctx: AuthContext, orderId: string, fileId: string, expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    await this.assertTenantActive(ctx);
    const order = await this.requireTenantOrder(ctx, orderId);
    const attachments = (order.attachments || []).map((f) => ({ ...f, current: f.fileId === fileId }));
    if (!attachments.some((f) => f.fileId === fileId)) throw new AccessDeniedError();
    if (expectedRevision != null && (order.revision || 1) !== expectedRevision) {
      throw new OrderConflictError(order.revision || 1, expectedRevision);
    }
    const updated = await this.orders.replaceAttachments(orderId, attachments);
    await this.audit(ctx, 'order.version_selected', orderId, { fileId });
    return updated;
  }

  async startProduction(ctx: AuthContext, orderId: string) {
    this.assertAccess(ctx, 'production.edit');
    await this.requireTenantOrder(ctx, orderId);
    const result = await this.orchestrator.startProduction(ctx, orderId);
    await this.audit(ctx, 'production.start', orderId, { after: result.phase });
    return result;
  }

  async startWorkflowStep(ctx: AuthContext, orderId: string, stepId: string, expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    if (!this.workflows) throw new RequestInvalidError('WORKFLOW_UNAVAILABLE');
    return this.workflows.startStep(ctx, orderId, stepId, expectedRevision);
  }

  async completeWorkflowStep(ctx: AuthContext, orderId: string, stepId: string, result?: string, expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    if (!this.workflows) throw new RequestInvalidError('WORKFLOW_UNAVAILABLE');
    return this.workflows.completeStep(ctx, orderId, stepId, result, expectedRevision);
  }

  async qcWorkflow(ctx: AuthContext, orderId: string, result: 'PASS' | 'FAIL', expectedRevision?: number) {
    this.assertAccess(ctx, 'production.edit');
    if (!this.workflows) throw new RequestInvalidError('WORKFLOW_UNAVAILABLE');
    return this.workflows.qc(ctx, orderId, result, expectedRevision);
  }

  async cancelWorkflow(ctx: AuthContext, orderId: string, reason: string) {
    this.assertAccess(ctx, 'production.edit');
    if (!this.workflows) throw new RequestInvalidError('WORKFLOW_UNAVAILABLE');
    return this.workflows.cancel(ctx, orderId, reason);
  }

  async retryJob(ctx: AuthContext, jobId: string) {
    this.assertAccess(ctx, 'production.edit');
    const job = await this.store.getJob(jobId);
    if (!job || job.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const updated = await this.orchestrator.retryJob(ctx, jobId);
    await this.audit(ctx, 'production.job.retry', job.orderId, {
      before: 'failed',
      after: updated.status,
      jobId,
    });
    return updated;
  }

  async cancelJob(ctx: AuthContext, jobId: string) {
    this.assertAccess(ctx, 'production.edit');
    const job = await this.store.getJob(jobId);
    if (!job || job.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const updated = await this.orchestrator.cancelJob(ctx, jobId);
    await this.audit(ctx, 'production.job.cancel', job.orderId, {
      before: job.status,
      after: updated.status,
      jobId,
    });
    return updated;
  }

  async markProduction(ctx: AuthContext, orderId: string, stage: 'started' | 'finished') {
    const to: OrderStatus = stage === 'started' ? 'production' : 'ready';
    const updated = await this.transition(ctx, orderId, to);
    await this.audit(ctx, stage === 'started' ? 'production.begin' : 'production.finish', orderId, {
      after: to,
    });
    return updated;
  }

  private async buildCards(
    ctx: AuthContext,
    query: ProductionQuery
  ): Promise<{ cards: ProductionCard[]; columns: KanbanColumnDef[] }> {
    const now = Date.now();
    const policy = await this.deadlinePolicyFor(ctx);
    const orders = await this.orders.listOrders(ctx.tenantId, 'admin', now);
    const processes = await this.store.listProcessesByTenant(ctx.tenantId);
    const jobs = await this.store.listJobs({ tenantId: ctx.tenantId });
    const columns = await this.columnsFor(ctx);
    const seeCosts = this.canSeeCosts(ctx);
    const seeMargin = this.canSeeMargin(ctx);
    const byOrderProc = group(processes, (p) => p.orderId);
    const byOrderJob = group(jobs, (j) => j.orderId);
    const cards: ProductionCard[] = [];
    for (const order of orders) {
      const card = this.toCard(
        order,
        byOrderProc.get(order.orderId) || [],
        byOrderJob.get(order.orderId) || [],
        seeCosts,
        seeMargin,
        columns,
        now,
        policy
      );
      if (this.matches(card, order, byOrderProc.get(order.orderId) || [], query)) {
        cards.push(card);
      }
    }
    return { cards, columns };
  }

  private toCard(
    order: PersistedOrder,
    processes: ProcessInstance[],
    jobs: ProductionJob[],
    seeCosts: boolean,
    seeMargin: boolean,
    columns: KanbanColumnDef[],
    now: number,
    policy: DeadlinePolicy = DEFAULT_DEADLINE_POLICY
  ): ProductionCard {
    const deadline = computeDeadline(order.dueAt, now, policy);
    const waitingApproval =
      order.approvalStatus === 'pending' ||
      processes.some((p) => p.status === 'waiting_approval') ||
      order.orchestration?.phase === 'waiting_customer';
    const failed = jobs.find((j) => j.status === 'failed');
    const blockedPending = processes
      .slice()
      .sort((a, b) => a.order - b.order)
      .find((p) => p.status === 'pending');
    const previousIncomplete =
      blockedPending &&
      processes.some((p) => p.order < blockedPending.order && p.status !== 'completed');
    let blockedReason: string | undefined;
    if (failed) blockedReason = `Error: ${failed.error || 'Job fallido'}`;
    else if (waitingApproval) blockedReason = 'Esperando aprobación del cliente';
    else if (previousIncomplete) blockedReason = 'Esperando proceso anterior';
    else if (order.orchestration?.blockedReason) blockedReason = order.orchestration.blockedReason;
    const done = processes.filter((p) => p.status === 'completed').length;
    const qty = Number(order.formValues?.quantity);
    const consumption = this.consumptionLines(order, seeCosts);
    const deadlineClass = toDeadlineClass(deadline.kind);
    const operational = operationalOrderStatus(order);
    return {
      orderId: order.orderId,
      number: order.displayNumber || shortNumber(order.orderId),
      customerId: order.customerId,
      customerName: order.customerName,
      disciplineId: order.configurationSnapshot?.disciplineId,
      product: String(order.formValues?.product || order.summary || ''),
      summary: order.summary,
      quantity: Number.isFinite(qty) ? qty : undefined,
      createdAt: order.createdAt,
      dueAt: order.dueAt,
      remainingMs: deadline.remainingMs,
      overdueMs: deadline.remainingMs < 0 ? Math.abs(deadline.remainingMs) : undefined,
      deadlineKind: deadline.kind,
      deadlineClass,
      deadlineLabel: deadlineLabel(deadline.kind, deadline.remainingMs),
      priority: order.priority,
      status: operational,
      assignedTo: order.assignedTo,
      assignedToLabel: order.assignedToLabel,
      revision: order.revision || 1,
      columnId: columnFor({ ...order, status: operational }, waitingApproval, columns),
      progress: processes.length ? { done, total: processes.length } : undefined,
      waitingApproval,
      blockedReason,
      hasJobError: !!failed,
      consumption,
      finance: seeCosts ? financeOf(order, seeMargin) : undefined,
    };
  }

  private matches(
    card: ProductionCard,
    order: PersistedOrder,
    processes: ProcessInstance[],
    query: ProductionQuery
  ): boolean {
    if (query.status) {
      const list = Array.isArray(query.status) ? query.status : [query.status];
      if (!list.includes(card.status)) return false;
    }
    if (query.priority && card.priority !== query.priority) return false;
    if (query.disciplineId && card.disciplineId !== query.disciplineId) return false;
    if (query.customerId && card.customerId !== query.customerId) return false;
    if (query.customer && !card.customerName.toLowerCase().includes(query.customer.toLowerCase())) {
      return false;
    }
    if (query.product && !(card.product || '').toLowerCase().includes(query.product.toLowerCase())) return false;
    if (query.productId && String(order.formValues?.productId || '') !== query.productId) return false;
    if (query.assignedTo && card.assignedTo !== query.assignedTo) return false;
    if (query.fromCreatedAt && card.createdAt < query.fromCreatedAt) return false;
    if (query.toCreatedAt && card.createdAt > query.toCreatedAt) return false;
    if (query.deadlineClass && card.deadlineClass !== query.deadlineClass) return false;
    if (query.view && !matchesView(card, query.view)) return false;
    if (query.fromDueAt && card.dueAt < query.fromDueAt) return false;
    if (query.toDueAt && card.dueAt > query.toDueAt) return false;
    if (query.deadline === 'expired' && card.deadlineKind !== 'expired') return false;
    if (query.deadline === 'today' && card.deadlineKind !== 'deadline_today') return false;
    if (
      query.deadline === 'approaching' &&
      card.deadlineKind !== 'approaching_deadline' &&
      card.deadlineKind !== 'deadline_today'
    ) {
      return false;
    }
    if (query.waitingApproval && !card.waitingApproval) return false;
    if (query.error && !card.hasJobError) return false;
    if (query.process) {
      const needle = query.process.toLowerCase();
      const hit = processes.some(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.processId.toLowerCase().includes(needle) ||
          (p.status === 'active' && p.name.toLowerCase().includes(needle))
      );
      if (!hit) return false;
    }
    if (query.q?.trim()) {
      const q = query.q.trim().toLowerCase();
      const blob = [
        order.orderId,
        card.number,
        order.customerName,
        order.summary,
        order.customerId,
        JSON.stringify(order.formValues || {}),
        JSON.stringify(order.metadata || {}),
      ]
        .join(' ')
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }

  private sortCards(cards: ProductionCard[], sort: ProductionQuery['sort']): ProductionCard[] {
    const copy = [...cards];
    copy.sort((a, b) => {
      if (sort === 'dueAt') return a.dueAt - b.dueAt;
      if (sort === 'createdAt') return a.createdAt - b.createdAt;
      if (sort === 'status') return a.status.localeCompare(b.status);
      if (sort === 'customer') return a.customerName.localeCompare(b.customerName);
      if (sort === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      const urg =
        deadlineRank(a.deadlineKind) - deadlineRank(b.deadlineKind) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.dueAt - b.dueAt;
      return urg;
    });
    return copy;
  }

  private counters(cards: ProductionCard[]): ProductionCounters {
    const closed = new Set(['completed', 'delivered', 'cancelled']);
    return {
      active: cards.filter((c) => !closed.has(c.status) && c.status !== 'expired').length,
      pending: cards.filter((c) => PENDING.has(c.status)).length,
      inProgress: cards.filter((c) => IN_PROGRESS.has(c.status) || WAITING.has(c.status)).length,
      waiting: cards.filter((c) => c.waitingApproval || WAITING.has(c.status)).length,
      printing: cards.filter((c) => c.status === 'printing' || c.status === 'printing_in_progress').length,
      production: cards.filter((c) => PRODUCTION.has(c.status)).length,
      ready: cards.filter((c) => READY.has(c.status)).length,
      finished: cards.filter((c) => FINISHED.has(c.status)).length,
      approachingDeadline: cards.filter(
        (c) => c.deadlineClass === 'DUE_SOON'
      ).length,
      expired: cards.filter((c) => c.deadlineClass === 'OVERDUE').length,
      cancelled: cards.filter((c) => c.status === 'cancelled').length,
      all: cards.length,
    };
  }

  private processViews(processes: ProcessInstance[], jobs: ProductionJob[]): ProductionProcessView[] {
    const sorted = [...processes].sort((a, b) => a.order - b.order);
    return sorted.map((p) => {
      const prevDone = sorted
        .filter((x) => x.order < p.order)
        .every((x) => x.status === 'completed' || !x.required);
      const waitingPrevious = p.status === 'pending' && !prevDone;
      const failed = jobs.some((j) => j.processInstanceId === p.instanceId && j.status === 'failed');
      let marker: ProductionProcessView['marker'] = 'upcoming';
      if (p.status === 'completed' || p.status === 'skipped') marker = 'done';
      else if (p.status === 'active') marker = 'current';
      else if (p.status === 'waiting_approval') marker = 'waiting';
      else if (p.status === 'blocked' || p.status === 'failed' || failed || waitingPrevious) marker = 'blocked';
      return {
        instanceId: p.instanceId,
        name: p.name,
        type: p.type,
        status: p.status,
        marker,
        waitingPrevious,
      };
    });
  }

  private jobViews(processes: ProcessInstance[], jobs: ProductionJob[]): ProductionJobView[] {
    return jobs.map((j) => {
      const process = processes.find((p) => p.instanceId === j.processInstanceId);
      return {
        jobId: j.jobId,
        processName: process?.name || '',
        status: j.status,
        priority: j.priority,
        retryCount: j.retryCount,
        executionTarget: j.executionTarget,
        error: j.error,
        currentArtifact: j.currentArtifactId,
      };
    });
  }

  private consumptionLines(order: PersistedOrder, seeCosts: boolean): ConsumptionLineView[] {
    return (order.consumptions || []).map((line) => {
      const view: ConsumptionLineView = {
        name: line.name,
        quantity: line.quantity,
        unit: UNIT_LABEL[line.unit] || line.unit,
      };
      if (seeCosts) {
        view.customerAmount = line.calculatedCustomerAmount;
        view.internalCost = line.calculatedInternalCost;
      }
      return view;
    });
  }

  private async columnsFor(ctx: AuthContext): Promise<KanbanColumnDef[]> {
    let config: TenantConfig | undefined;
    try {
      config = await this.adminRepo.getConfig(ctx.tenantId);
    } catch {
      config = undefined;
    }
    const labels = new Map((config?.statusPresentation || []).map((s) => [s.status, s.label]));
    return DEFAULT_KANBAN_COLUMNS.map((col) => {
      const fromStatus = col.statuses?.[0];
      return {
        ...col,
        label: (fromStatus && labels.get(fromStatus)) || col.label,
      };
    });
  }

  private async requireTenantOrder(ctx: AuthContext, orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return order;
  }

  private assertAccess(ctx: AuthContext, permission: 'production.view' | 'production.edit'): void {
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
    if (
      permission === 'production.view' &&
      (hasPermission(probe, 'production.view') ||
        hasPermission(probe, 'production.edit') ||
        hasPermission(probe, 'orders.view'))
    ) {
      return;
    }
    if (permission === 'production.edit' && (hasPermission(probe, 'production.edit') || hasPermission(probe, 'orders.edit'))) {
      return;
    }
    if (!hasPermission(probe, permission)) throw new AccessDeniedError();
  }

  private canSeeCosts(ctx: AuthContext): boolean {
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return true;
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
    return hasPermission(probe, 'costs.view');
  }

  private canSeeMargin(ctx: AuthContext): boolean {
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return ctx.permissions.includes('margin.view');
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
    return hasPermission(probe, 'margin.view') && ctx.permissions.includes('margin.view');
  }

  private async deadlinePolicyFor(ctx: AuthContext): Promise<DeadlinePolicy> {
    const config = await this.adminRepo.getConfig(ctx.tenantId).catch(() => undefined);
    const tenant = await this.resolveTenant(ctx.tenantId);
    return {
      approachingWithinMs: config?.deadlineApproachingWithinMs || DEFAULT_DEADLINE_POLICY.approachingWithinMs,
      timeZone: tenant?.timezone || DEFAULT_DEADLINE_POLICY.timeZone,
    };
  }

  private async resolveTenant(tenantId: string) {
    const local = await this.adminRepo.getTenant().catch(() => undefined);
    if (local?.tenantId === tenantId) return local;
    const store = this.store as ProductionStore & {
      getTenant?: (id: string) => Promise<{ tenantId: string; status?: string; timezone?: string } | undefined>;
    };
    if (store.getTenant) return store.getTenant(tenantId);
    return local;
  }

  private async assertTenantActive(ctx: AuthContext): Promise<void> {
    const tenant = await this.resolveTenant(ctx.tenantId);
    if (!tenant) return;
    if (tenant.status && tenant.status !== 'ACTIVE') {
      throw new TenantRestrictedError(tenant.status as TenantLifecycleStatus);
    }
  }

  private canSeeJobs(ctx: AuthContext): boolean {
    return ctx.roleId !== 'CUSTOMER';
  }

  private async audit(
    ctx: AuthContext,
    action: string,
    orderId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.adminRepo.appendAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action,
      target: orderId,
      result: 'ok',
      detail: JSON.stringify({ orderId, ...payload }),
    });
  }
}

function shortNumber(orderId: string): string {
  return `#${orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;
}

function utcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function deadlineLabel(kind: DeadlineKind, remainingMs: number): string {
  if (kind === 'expired') return 'Entrega vencida';
  if (kind === 'deadline_today') return 'Entrega: hoy';
  if (kind === 'approaching_deadline') {
    const hours = Math.max(1, Math.round(remainingMs / 3600000));
    return `Próximo a vencer (${hours} h)`;
  }
  const days = Math.max(0, Math.ceil(remainingMs / 86400000));
  return `Entrega en ${days} d`;
}

function deadlineRank(kind: DeadlineKind): number {
  if (kind === 'expired') return 0;
  if (kind === 'deadline_today') return 1;
  if (kind === 'approaching_deadline') return 2;
  return 3;
}

function hasWorkspaceFilters(query: ProductionQuery): boolean {
  return Boolean(
    query.status ||
      query.priority ||
      query.disciplineId ||
      query.customerId ||
      query.customer ||
      query.product ||
      query.productId ||
      query.assignedTo ||
      query.fromDueAt ||
      query.toDueAt ||
      query.fromCreatedAt ||
      query.toCreatedAt ||
      query.deadline ||
      query.deadlineClass ||
      query.process ||
      query.error ||
      query.waitingApproval ||
      query.view ||
      query.q
  );
}

function matchesView(card: ProductionCard, view: ProductionQuery['view']): boolean {
  if (!view || view === 'all') return true;
  const closed = new Set(['completed', 'delivered', 'cancelled']);
  if (view === 'active') return !closed.has(card.status);
  if (view === 'pending') return card.status === 'pending' || card.status === 'received' || card.status === 'reviewing';
  if (view === 'production') {
    return (
      card.status === 'preparing' ||
      card.status === 'printing' ||
      card.status === 'printing_in_progress' ||
      card.status === 'production' ||
      card.status === 'editing' ||
      card.status === 'approved'
    );
  }
  if (view === 'due_soon') return card.deadlineClass === 'DUE_SOON';
  if (view === 'overdue') return card.deadlineClass === 'OVERDUE';
  if (view === 'finished') return card.status === 'completed' || card.status === 'delivered';
  if (view === 'cancelled') return card.status === 'cancelled';
  return true;
}

function toDeadlineClass(kind: DeadlineKind): DeadlineClass {
  if (kind === 'expired') return 'OVERDUE';
  if (kind === 'approaching_deadline' || kind === 'deadline_today') return 'DUE_SOON';
  return 'ON_TIME';
}

function columnFor(
  order: PersistedOrder,
  waitingApproval: boolean,
  columns: KanbanColumnDef[]
): string {
  if (order.status === 'expired' || order.status === 'cancelled') {
    return columns.find((c) => c.id === 'finished')?.id || 'finished';
  }
  if (waitingApproval) {
    const wait = columns.find((c) => c.waitingApproval);
    if (wait) return wait.id;
  }
  const match = columns.find((c) => c.statuses?.includes(order.status));
  return match?.id || 'received';
}

function financeOf(order: PersistedOrder, seeMargin: boolean): FinanceView {
  const cost = order.totalInternalCost;
  const price = order.totalCustomerAmount;
  const view: FinanceView = { cost, price };
  if (seeMargin && cost != null && price != null) {
    view.margin = price - cost;
  }
  return view;
}

function groupByUnit(lines: ConsumptionLineView[]): Record<string, ConsumptionLineView[]> {
  const out: Record<string, ConsumptionLineView[]> = {};
  for (const line of lines) {
    if (!out[line.unit]) out[line.unit] = [];
    out[line.unit].push(line);
  }
  return out;
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) || [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
