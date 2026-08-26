import { randomUUID } from 'crypto';
import type {
  CreateOrderRequest,
  DeadlinePolicy,
  MaterialConsumption,
  OrderActor,
  OrderAttachmentRef,
  OrderApprovalRecord,
  OrderApprovalStatus,
  OrderBoardFilter,
  OrderDashboard,
  OrderDeadlineInfo,
  OrderStatus,
  PersistedOrder,
  ViewerRole,
} from '../../contracts/order-domain';
import { DEFAULT_DEADLINE_POLICY } from '../../contracts/order-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import { assertHumanProjectName } from '../../contracts/commercial-terms';
import {
  applyExpiryIfDue,
  assertOrderTransition,
  buildCreatedOrder,
  calculateConsumptionLine,
  classifyDashboard,
  computeDeadline,
    findOrderStatusPath,
    operationalOrderStatus,
    newOrderId,
  OrderConflictError,
  redactOrderForViewer,
  sumOrderCosts,
} from '../../contracts/order-lifecycle';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { ResourceNotFoundError } from '../../contracts/http-errors';
import type { OrderRepository } from './OrderRepository';
import type { JobRepository } from './JobRepository';
import type { TenantOperation } from '../../contracts/platform-domain';

export type TenantOperationGuard = {
  assert(tenantId: string, operation: TenantOperation): Promise<void>;
};

export type OrderLifecycleHook = (payload: { type: string; order: PersistedOrder }) => Promise<void> | void;

export class OrderService {
  private tenantGuards: TenantOperationGuard[] = [];
  private lifecycleHook?: OrderLifecycleHook;

  constructor(
    private orders: OrderRepository,
    private jobs?: JobRepository,
    private deadlinePolicy: DeadlinePolicy = DEFAULT_DEADLINE_POLICY
  ) {}

  setTenantGuard(guard: TenantOperationGuard): void {
    this.tenantGuards.push(guard);
  }

  setLifecycleHook(hook: OrderLifecycleHook): void {
    const previous = this.lifecycleHook;
    this.lifecycleHook = async (payload) => {
      await previous?.(payload);
      await hook(payload);
    };
  }

  async createOrder(request: CreateOrderRequest): Promise<PersistedOrder> {
    if (!request.tenantId?.trim()) throw new Error('tenantId is required');
    if (!request.customerId?.trim()) throw new Error('customerId is required');
    if (!request.dueAt || !Number.isFinite(request.dueAt)) throw new Error('dueAt is required');
    await this.assertTenant(request.tenantId, 'orders.create');
    const order = buildCreatedOrder(request, newOrderId());
    const existing = await this.orders.list(request.tenantId);
    order.displayNumber = `#EMP-${String(existing.length + 1).padStart(6, '0')}`;
    await this.orders.create(order);
    await this.emitLifecycle(order.status === 'received' ? 'ORDER_RECEIVED' : 'ORDER_CREATED', order);
    if (order.status === 'received') {
      await this.emitLifecycle('ORDER_CREATED', order);
    }
    return order;
  }

  async setFulfillment(
    orderId: string,
    fulfillment: import('../../contracts/fulfillment-domain').OrderFulfillment,
    actor: OrderActor
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = {
      ...order,
      fulfillment,
      updatedAt: Date.now(),
      revision: nextRevision(order),
      history: [
        ...order.history,
        {
          from: order.status,
          to: order.status,
          at: Date.now(),
          actor,
          note: `fulfillment:${fulfillment.mode}`,
        },
      ],
    };
    await this.orders.update(updated);
    return updated;
  }

  async getOrder(
    orderId: string,
    role: ViewerRole = 'admin',
    now: number = Date.now()
  ): Promise<PersistedOrder | undefined> {
    const raw = await this.orders.get(orderId);
    if (!raw) return undefined;
    const withExpiry = await this.persistExpiry(raw, now);
    if (role === 'customer') return redactOrderForViewer(withExpiry, 'customer');
    return withExpiry;
  }

  async listOrders(
    tenantId: string,
    role: ViewerRole = 'admin',
    now: number = Date.now(),
    customerId?: string
  ): Promise<PersistedOrder[]> {
    if (role === 'customer' && !customerId) {
      throw new AccessDeniedError();
    }
    const listed = await this.orders.list(tenantId);
    const next: PersistedOrder[] = [];
    for (const raw of listed) {
      if (customerId && raw.customerId !== customerId) continue;
      if (raw.tenantId !== tenantId) continue;
      next.push(await this.persistExpiry(raw, now));
    }
    return next.map((order) =>
      role === 'customer' ? redactOrderForViewer(order, 'customer') : order
    );
  }

  async peekOrders(tenantId: string): Promise<PersistedOrder[]> {
    return (await this.orders.list(tenantId)).filter((order) => order.tenantId === tenantId);
  }

  async getOrderForCustomer(
    orderId: string,
    tenantId: string,
    customerId: string,
    now: number = Date.now()
  ): Promise<PersistedOrder> {
    const raw = await this.orders.get(orderId);
    if (!raw) throw new ResourceNotFoundError('ORDER_NOT_FOUND');
    if (raw.tenantId !== tenantId || raw.customerId !== customerId) {
      throw new AccessDeniedError();
    }
    return this.persistExpiry(raw, now);
  }

  async transition(
    orderId: string,
    to: OrderStatus,
    actor: OrderActor,
    note?: string,
    now: number = Date.now()
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    await this.assertTenant(order.tenantId, 'production.process');
    const current = applyExpiryIfDue(order, now);
    const from = operationalOrderStatus(current);
    assertOrderTransition(from, to);
    if (from === to && current.status !== 'expired') return current;
    const updated: PersistedOrder = {
      ...current,
      status: to,
      updatedAt: now,
      revision: nextRevision(current),
      history: [
        ...current.history,
        { from, to, at: now, actor, note },
      ],
    };
    await this.orders.update(updated);
    await this.emitLifecycle('ORDER_STATUS_CHANGED', updated);
    if (to === 'ready') await this.emitLifecycle('ORDER_READY', updated);
    if (to === 'completed' || to === 'delivered') await this.emitLifecycle('ORDER_COMPLETED', updated);
    if (to === 'expired') await this.emitLifecycle('ORDER_EXPIRED', updated);
    return updated;
  }

  async forceTransition(
    orderId: string,
    to: OrderStatus,
    actor: OrderActor,
    reason: string,
    expectedRevision?: number
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    this.assertRevision(order, expectedRevision);
    const now = Date.now();
    const updated: PersistedOrder = {
      ...order,
      status: to,
      updatedAt: now,
      revision: nextRevision(order),
      history: [
        ...order.history,
        {
          from: order.status,
          to,
          at: now,
          actor,
          note: `ADMIN_OVERRIDE: ${reason}`,
        },
      ],
    };
    await this.orders.update(updated);
    await this.emitLifecycle('ORDER_STATUS_CHANGED', updated);
    return updated;
  }

  async assign(
    orderId: string,
    assignedTo: string,
    assignedToLabel: string,
    expectedRevision?: number
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    this.assertRevision(order, expectedRevision);
    const updated: PersistedOrder = {
      ...order,
      assignedTo,
      assignedToLabel,
      assignedAt: Date.now(),
      updatedAt: Date.now(),
      revision: nextRevision(order),
    };
    await this.orders.update(updated);
    return updated;
  }

  async addInternalComment(
    orderId: string,
    comment: { actorId: string; actorLabel?: string; body: string },
    expectedRevision?: number
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    this.assertRevision(order, expectedRevision);
    const updated: PersistedOrder = {
      ...order,
      updatedAt: Date.now(),
      revision: nextRevision(order),
      internalComments: [
        ...(order.internalComments || []),
        {
          commentId: randomUUID(),
          actorId: comment.actorId,
          actorLabel: comment.actorLabel,
          at: Date.now(),
          body: comment.body,
        },
      ],
    };
    await this.orders.update(updated);
    return updated;
  }

  async walkToStatus(
    orderId: string,
    to: OrderStatus,
    actor: OrderActor,
    note?: string
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const from = operationalOrderStatus(order);
    if (from === to) return order;
    const steps = findOrderStatusPath(from, to);
    if (!steps.length) throw new Error(`NO_STATUS_PATH:${from}:${to}`);
    let current = order;
    for (const step of steps) {
      current = await this.transition(orderId, step, actor, note);
    }
    return current;
  }

  async setOrchestration(
    orderId: string,
    orchestration: PersistedOrder['orchestration']
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = { ...order, orchestration, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  async attachJob(
    orderId: string,
    jobId: string,
    label?: string
  ): Promise<PersistedOrder> {
    if (!jobId?.trim()) throw new Error('jobId is required');
    const order = await this.requireOrder(orderId);
    await this.assertTenant(order.tenantId, 'production.process');
    if (order.jobIds.includes(jobId)) return order;
    let technicalStatus = undefined;
    if (this.jobs) {
      const job = await this.jobs.get(jobId);
      technicalStatus = job?.status;
    }
    const updated: PersistedOrder = {
      ...order,
      jobIds: [...order.jobIds, jobId],
      jobs: [...order.jobs, { jobId, label, technicalStatus }],
      updatedAt: Date.now(),
      revision: nextRevision(order),
    };
    await this.orders.update(updated);
    return updated;
  }

  async addConsumption(
    orderId: string,
    line: Omit<MaterialConsumption, 'calculatedInternalCost' | 'calculatedCustomerAmount' | 'lineId'> & {
      lineId?: string;
    }
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    await this.assertTenant(order.tenantId, 'orders.edit');
    const calculated = calculateConsumptionLine({
      ...line,
      lineId: line.lineId || randomUUID(),
    });
    const consumptions = [...order.consumptions, calculated];
    const totals = sumOrderCosts(consumptions);
    const updated: PersistedOrder = {
      ...order,
      consumptions,
      ...totals,
      updatedAt: Date.now(),
    };
    await this.orders.update(updated);
    return updated;
  }

  async replaceConsumptions(
    orderId: string,
    lines: MaterialConsumption[],
    economicSnapshot?: PersistedOrder['economicSnapshot'],
    options?: { allowFrozenReplace?: boolean }
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    await this.assertTenant(order.tenantId, 'orders.create');
    if (order.economicSnapshot?.frozen && !options?.allowFrozenReplace) {
      throw new RequestInvalidError('PRICE_FROZEN');
    }
    const unique = new Map<string, MaterialConsumption>();
    for (const line of lines) {
      unique.set(`${line.materialId}:${line.unitId || line.unit}`, line);
    }
    const consumptions = [...unique.values()];
    const totals = sumOrderCosts(consumptions);
    const updated: PersistedOrder = {
      ...order,
      consumptions,
      ...totals,
      economicSnapshot: economicSnapshot
        ? { ...order.economicSnapshot, ...economicSnapshot }
        : order.economicSnapshot,
      updatedAt: Date.now(),
    };
    await this.orders.update(updated);
    return updated;
  }

  async setEconomicSnapshot(
    orderId: string,
    economicSnapshot: PersistedOrder['economicSnapshot']
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = {
      ...order,
      economicSnapshot,
      updatedAt: Date.now(),
      revision: nextRevision(order),
    };
    await this.orders.update(updated);
    return updated;
  }

  async dashboard(
    tenantId: string,
    now: number = Date.now()
  ): Promise<OrderDashboard> {
    const orders = await this.listOrders(tenantId, 'admin', now);
    return classifyDashboard(orders, now, this.deadlinePolicy);
  }

  deadlineFor(order: PersistedOrder, now: number = Date.now()): OrderDeadlineInfo {
    return computeDeadline(order.dueAt, now, this.deadlinePolicy);
  }

  setDeadlinePolicy(policy: DeadlinePolicy): void {
    this.deadlinePolicy = policy;
  }

  filterBoard(dashboard: OrderDashboard, filter: OrderBoardFilter): PersistedOrder[] {
    if (filter === 'pending') return dashboard.pending;
    if (filter === 'in_progress') return dashboard.inProgress;
    if (filter === 'finished') return dashboard.finished;
    if (filter === 'expired') return dashboard.expired;
    if (filter === 'approaching_deadline') return dashboard.approachingDeadline;
    return [
      ...dashboard.pending,
      ...dashboard.inProgress,
      ...dashboard.finished,
      ...dashboard.expired,
    ];
  }

  async replaceAttachments(orderId: string, attachments: OrderAttachmentRef[]): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = { ...order, attachments, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  async patchCustomerDraft(
    orderId: string,
    actor: OrderActor,
    patch: { projectName?: string; formValues?: Record<string, unknown> }
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const projectName =
      patch.projectName != null ? assertHumanProjectName(patch.projectName, false) || order.projectName : order.projectName;
    const updated: PersistedOrder = {
      ...order,
      projectName: projectName || order.projectName,
      formValues: { ...(order.formValues || {}), ...(patch.formValues || {}), projectName: projectName || order.formValues?.projectName },
      summary: projectName || order.summary,
      updatedAt: Date.now(),
      revision: nextRevision(order),
      history: [
        ...order.history,
        { from: order.status, to: order.status, at: Date.now(), actor, note: 'draft_updated' },
      ],
    };
    await this.orders.update(updated);
    return updated;
  }

  async appendHistoryNote(
    orderId: string,
    actor: OrderActor,
    note: string,
    now: number = Date.now()
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = {
      ...order,
      updatedAt: now,
      revision: nextRevision(order),
      history: [
        ...order.history,
        { from: order.status, to: order.status, at: now, actor, note },
      ],
    };
    await this.orders.update(updated);
    return updated;
  }

  async appendAttachments(orderId: string, files: OrderAttachmentRef[]): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = {
      ...order,
      attachments: [...(order.attachments || []), ...files],
      updatedAt: Date.now(),
      revision: nextRevision(order),
    };
    await this.orders.update(updated);
    return updated;
  }

  async recordApproval(
    orderId: string,
    record: OrderApprovalRecord,
    status: OrderApprovalStatus
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = {
      ...order,
      approvalStatus: status,
      approvals: [...(order.approvals || []), record],
      updatedAt: Date.now(),
      revision: nextRevision(order),
    };
    await this.orders.update(updated);
    return updated;
  }

  async setApprovalStatus(orderId: string, status: OrderApprovalStatus): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = { ...order, approvalStatus: status, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  async setDueAt(orderId: string, dueAt: number, expectedRevision?: number): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    this.assertRevision(order, expectedRevision);
    const updated: PersistedOrder = { ...order, dueAt, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  async setPriority(orderId: string, priority: PersistedOrder['priority'], expectedRevision?: number): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    this.assertRevision(order, expectedRevision);
    const updated: PersistedOrder = { ...order, priority, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  async setVisibility(
    orderId: string,
    visibility: PersistedOrder['visibility']
  ): Promise<PersistedOrder> {
    const order = await this.requireOrder(orderId);
    const updated: PersistedOrder = { ...order, visibility, updatedAt: Date.now(), revision: nextRevision(order) };
    await this.orders.update(updated);
    return updated;
  }

  private async assertTenant(tenantId: string, operation: TenantOperation): Promise<void> {
    if (!this.tenantGuards.length) return;
    let lastError: unknown;
    for (const guard of this.tenantGuards) {
      try {
        await guard.assert(tenantId, operation);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async requireOrder(orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.get(orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    return order;
  }

  private async persistExpiry(order: PersistedOrder, now: number): Promise<PersistedOrder> {
    const next = applyExpiryIfDue(order, now);
    if (next.status !== order.status) {
      next.revision = nextRevision(order);
      await this.orders.update(next);
      await this.emitLifecycle('ORDER_EXPIRED', next);
    }
    return next;
  }

  private assertRevision(order: PersistedOrder, expected?: number): void {
    if (expected == null) return;
    const current = order.revision || 1;
    if (current !== expected) throw new OrderConflictError(current, expected);
  }

  private async emitLifecycle(type: string, order: PersistedOrder): Promise<void> {
    await this.lifecycleHook?.({ type, order });
  }
}

function nextRevision(order: PersistedOrder): number {
  return (order.revision || 1) + 1;
}
