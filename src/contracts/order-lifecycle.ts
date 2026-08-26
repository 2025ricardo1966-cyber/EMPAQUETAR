import type {
  CreateOrderRequest,
  DeadlineKind,
  DeadlinePolicy,
  MaterialConsumption,
  OrderDashboard,
  OrderDeadlineInfo,
  OrderStatus,
  PersistedOrder,
} from './order-domain';
import { DEFAULT_CUSTOMER_VISIBILITY, DEFAULT_DEADLINE_POLICY as DEFAULT_POLICY } from './order-domain';

export class OrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus
  ) {
    super(`Invalid order transition: ${from} → ${to}`);
    this.name = 'OrderTransitionError';
  }
}

export class OrderConflictError extends Error {
  readonly code = 'ORDER_CONFLICT';
  constructor(
    public readonly currentRevision: number,
    public readonly expectedRevision: number
  ) {
    super('ORDER_CONFLICT');
    this.name = 'OrderConflictError';
  }
}

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending: ['received', 'cancelled', 'expired'],
  received: ['reviewing', 'editing', 'cancelled', 'expired'],
  reviewing: ['editing', 'approved', 'cancelled', 'expired'],
  editing: ['reviewing', 'approved', 'preparing', 'printing', 'cancelled', 'expired'],
  approved: ['preparing', 'cancelled', 'expired'],
  preparing: ['printing', 'production', 'cancelled', 'expired'],
  printing: ['printing_in_progress', 'production', 'cancelled', 'expired'],
  printing_in_progress: ['production', 'ready', 'cancelled', 'expired'],
  production: ['ready', 'completed', 'cancelled', 'expired'],
  ready: ['completed', 'delivered', 'cancelled', 'expired'],
  completed: ['delivered'],
  delivered: [],
  cancelled: [],
  expired: ['cancelled'],
};

export const ORDER_PENDING_STATUSES: OrderStatus[] = ['pending', 'received'];

export const ORDER_IN_PROGRESS_STATUSES: OrderStatus[] = [
  'reviewing',
  'editing',
  'approved',
  'preparing',
  'printing',
  'printing_in_progress',
  'production',
];

export const ORDER_FINISHED_STATUSES: OrderStatus[] = ['ready', 'completed', 'delivered'];

export const ORDER_CLOSED_FOR_EXPIRY: OrderStatus[] = [
  'completed',
  'delivered',
  'cancelled',
  'expired',
];

export function findOrderStatusPath(from: OrderStatus, to: OrderStatus): OrderStatus[] {
  if (from === to) return [];
  const queue: OrderStatus[][] = [[from]];
  const seen = new Set<OrderStatus>([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of ALLOWED[current] || []) {
      if (seen.has(next)) continue;
      if (next === to) return [...path.slice(1), next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [];
}

/** Operational workflow status. `expired` is a deadline overlay, not a production stage. */
export function operationalOrderStatus(order: PersistedOrder): OrderStatus {
  if (order.status !== 'expired') return order.status;
  const history = order.history || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.to && h.to !== 'expired') return h.to;
    if (h.from && h.from !== 'expired') return h.from;
  }
  return 'received';
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new OrderTransitionError(from, to);
  }
}

export function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function calendarDay(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function computeDeadline(
  dueAt: number,
  now: number = Date.now(),
  policy: DeadlinePolicy = DEFAULT_POLICY
): OrderDeadlineInfo {
  const remainingMs = dueAt - now;
  const isExpired = remainingMs < 0;
  let kind: DeadlineKind = 'normal';
  if (isExpired) {
    kind = 'expired';
  } else if (calendarDay(dueAt, policy.timeZone) === calendarDay(now, policy.timeZone)) {
    kind = 'deadline_today';
  } else if (remainingMs <= policy.approachingWithinMs) {
    kind = 'approaching_deadline';
  }
  return { kind, dueAt, remainingMs, isExpired };
}

export function applyExpiryIfDue(
  order: PersistedOrder,
  now: number = Date.now()
): PersistedOrder {
  if (ORDER_CLOSED_FOR_EXPIRY.includes(order.status)) return order;
  if (dueAtIsPast(order.dueAt, now) && canTransitionOrder(order.status, 'expired')) {
    return {
      ...order,
      status: 'expired',
      updatedAt: now,
      history: [
        ...order.history,
        {
          from: order.status,
          to: 'expired',
          at: now,
          actor: { actorId: 'system', role: 'system', label: 'deadline' },
          note: 'dueAt exceeded',
        },
      ],
    };
  }
  return order;
}

function dueAtIsPast(dueAt: number, now: number): boolean {
  return dueAt < now;
}

/** Quantity is already expressed in the material unit (m, m², units, sheets). */
export function calculateMaterialCost(quantity: number, unitPrice: number): number {
  return roundMoney(Number(quantity) * Number(unitPrice));
}

export function calculateConsumptionLine(
  line: Omit<MaterialConsumption, 'calculatedInternalCost' | 'calculatedCustomerAmount'>
): MaterialConsumption {
  const quantity = Number(line.quantity);
  const internalUnitCost = Number(line.internalUnitCost);
  const customerUnitPrice = Number(line.customerUnitPrice);
  return {
    ...line,
    quantity,
    internalUnitCost,
    customerUnitPrice,
    calculatedInternalCost: calculateMaterialCost(quantity, internalUnitCost),
    calculatedCustomerAmount: calculateMaterialCost(quantity, customerUnitPrice),
  };
}

export function sumOrderCosts(consumptions: MaterialConsumption[]): {
  totalInternalCost: number;
  totalCustomerAmount: number;
} {
  return {
    totalInternalCost: roundMoney(
      consumptions.reduce((sum, line) => sum + line.calculatedInternalCost, 0)
    ),
    totalCustomerAmount: roundMoney(
      consumptions.reduce((sum, line) => sum + line.calculatedCustomerAmount, 0)
    ),
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function redactOrderForViewer(
  order: PersistedOrder,
  role: 'admin' | 'subadmin' | 'customer'
): PersistedOrder {
  const visibility =
    role === 'customer' ? { ...DEFAULT_CUSTOMER_VISIBILITY, ...order.visibility } : order.visibility;
  const clone: PersistedOrder = {
    ...order,
    consumptions: order.consumptions.map((line) => ({
      ...line,
      internalUnitCost: visibility.purchasePrice ? line.internalUnitCost : 0,
      calculatedInternalCost: visibility.internalCost ? line.calculatedInternalCost : 0,
      customerUnitPrice: visibility.customerAmount ? line.customerUnitPrice : line.customerUnitPrice,
      calculatedCustomerAmount: visibility.customerAmount ? line.calculatedCustomerAmount : 0,
    })),
    totalInternalCost: visibility.internalCost ? order.totalInternalCost : 0,
    totalCustomerAmount: visibility.customerAmount ? order.totalCustomerAmount : 0,
    jobs: visibility.jobs ? order.jobs : [],
    jobIds: visibility.jobs ? order.jobIds : [],
  };
  if (!visibility.consumption) {
    clone.consumptions = [];
  }
  if (role === 'customer' && clone.configurationSnapshot) {
    const snap = clone.configurationSnapshot;
    clone.configurationSnapshot = {
      ...snap,
      fields: Array.isArray(snap.fields)
        ? (snap.fields as { sensitive?: boolean }[]).filter((f) => !f.sensitive)
        : [],
      materials: Array.isArray(snap.materials)
        ? (snap.materials as Record<string, unknown>[]).map((m) => {
            const next = { ...m };
            delete next.internalUnitCost;
            return next;
          })
        : [],
      rules: [],
    };
  }
  if (role === 'customer') {
    delete (clone as { totalInternalCost?: number }).totalInternalCost;
    delete (clone as { internalComments?: unknown }).internalComments;
    delete (clone as { assignedTo?: string }).assignedTo;
    delete (clone as { assignedToLabel?: string }).assignedToLabel;
    clone.consumptions = clone.consumptions.map((line) => {
      const next = { ...line };
      delete (next as { internalUnitCost?: number }).internalUnitCost;
      delete (next as { calculatedInternalCost?: number }).calculatedInternalCost;
      if (next.snapshot) {
        const snap = { ...next.snapshot };
        delete snap.internalUnitCost;
        next.snapshot = snap;
      }
      return next;
    });
    if (clone.economicSnapshot) {
      clone.economicSnapshot = {
        ...clone.economicSnapshot,
        totals: { internal: 0, customer: clone.economicSnapshot.totals.customer },
      };
    }
  }
  return clone;
}

export function classifyDashboard(
  orders: PersistedOrder[],
  now: number = Date.now(),
  policy: DeadlinePolicy = DEFAULT_POLICY
): OrderDashboard {
  const pending: PersistedOrder[] = [];
  const inProgress: PersistedOrder[] = [];
  const finished: PersistedOrder[] = [];
  const approachingDeadline: PersistedOrder[] = [];
  const expired: PersistedOrder[] = [];

  for (const raw of orders) {
    const order = applyExpiryIfDue(raw, now);
    const kind = computeDeadline(order.dueAt, now, policy).kind;

    if (ORDER_PENDING_STATUSES.includes(order.status)) pending.push(order);
    if (ORDER_IN_PROGRESS_STATUSES.includes(order.status)) inProgress.push(order);
    if (ORDER_FINISHED_STATUSES.includes(order.status)) finished.push(order);

    if (order.status === 'expired' || (kind === 'expired' && !ORDER_CLOSED_FOR_EXPIRY.includes(raw.status))) {
      expired.push(order);
    }

    if (
      (kind === 'approaching_deadline' || kind === 'deadline_today') &&
      !ORDER_CLOSED_FOR_EXPIRY.includes(order.status)
    ) {
      approachingDeadline.push(order);
    }
  }

  const unique = (list: PersistedOrder[]) => {
    const seen = new Set<string>();
    return list.filter((o) => {
      if (seen.has(o.orderId)) return false;
      seen.add(o.orderId);
      return true;
    });
  };

  return {
    counts: {
      pending: unique(pending).length,
      inProgress: unique(inProgress).length,
      finished: unique(finished).length,
      approachingDeadline: unique(approachingDeadline).length,
      expired: unique(expired).length,
      all: orders.length,
    },
    pending: unique(pending),
    inProgress: unique(inProgress),
    finished: unique(finished),
    approachingDeadline: unique(approachingDeadline),
    expired: unique(expired),
  };
}

export function newOrderId(): string {
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCreatedOrder(
  request: CreateOrderRequest,
  orderId: string,
  now: number = Date.now()
): PersistedOrder {
  return {
    orderId,
    tenantId: request.tenantId,
    customerId: request.customerId,
    customerName: request.customerName,
    summary: request.summary?.trim() || 'Order',
    projectName: request.projectName?.trim() || undefined,
    priority: request.priority ?? 'normal',
    status: request.initialStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
    dueAt: request.dueAt,
    jobIds: [],
    jobs: [],
    consumptions: [],
    totalInternalCost: 0,
    totalCustomerAmount: request.totalCustomerAmount ?? 0,
    visibility: { ...DEFAULT_CUSTOMER_VISIBILITY, ...request.visibility },
    history: [
      {
        from: null,
        to: request.initialStatus ?? 'pending',
        at: now,
        actor: request.actor,
        note: 'created',
      },
    ],
    configurationSnapshot: request.configurationSnapshot,
    formValues: request.formValues,
    attachments: request.attachments || [],
    approvalStatus: request.approvalStatus || 'not_required',
    approvals: [],
    revision: 1,
    internalComments: [],
    fulfillment: request.fulfillment,
  };
}
