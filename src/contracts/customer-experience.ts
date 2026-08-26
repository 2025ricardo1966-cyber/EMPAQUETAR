import type { DeadlineKind, OrderApprovalStatus, OrderStatus, PersistedOrder } from './order-domain';
export type { OrderAttachmentRef as OrderAttachment, OrderApprovalRecord as OrderApproval, OrderApprovalStatus as ApprovalStatus } from './order-domain';

export interface CustomerProfile {
  customerId: string;
  tenantId: string;
  userId?: string;
  name: string;
  contact: string;
  login: string;
  email?: string;
  phone?: string;
  preferredLanguage?: string;
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  address?: string;
  status?: 'active' | 'disabled';
  isTrust?: boolean;
  trustCode?: string;
  creditLimit?: number | null;
  currentDebt?: number;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt?: number;
}

export type FileStatus = 'PENDING' | 'VALIDATED' | 'REJECTED';

export type ConversionStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED' | 'FAILED';

export interface OrderFileRecord {
  id: string;
  tenantId: string;
  orderId: string;
  customerId: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  uploadedAt: number;
  convertedKey?: string;
  conversionStatus?: ConversionStatus;
  colorProfileKey?: string;
}

export interface OrderAssignmentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  assignedTo: string;
  assignedBy: string;
  assignedAt: number;
}

export interface InternalCommentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  authorId: string;
  content: string;
  createdAt: number;
}

export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'WAIVED' | 'FAILED';

export interface PaymentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  customerId: string;
  requiredPct: number;
  amountDue: number;
  amountPaid: number;
  status: PaymentStatus;
  voucherKey?: string;
  confirmedAt?: number;
  confirmedBy?: string;
  gateway?: 'MERCADOPAGO' | 'STRIPE' | 'MANUAL';
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  checkoutUrl?: string;
  failureReason?: string | null;
  exceptionAuthorized?: boolean;
  exceptionBy?: string;
  exceptionAt?: number;
  exceptionNote?: string;
  exceptionCondition?: {
    requiredPct: number;
    amountDue: number;
    amountPaid: number;
    authorizedBelowMinimum: boolean;
  };
}

export const CREDIT_BLOCK_MESSAGE =
  'Para continuar realizando nuevos pedidos necesitamos regularizar la situación de cuenta. Por favor, comuníquese con los administradores del taller.';

export class PaymentRequiredError extends Error {
  readonly code = 'PAYMENT_REQUIRED';
  readonly httpStatus = 402;
  constructor(message: string) {
    super(message);
    this.name = 'PaymentRequiredError';
  }
}

export type OrderNotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_RECEIVED'
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_NEAR_DEADLINE'
  | 'ORDER_EXPIRED'
  | 'ORDER_READY'
  | 'ORDER_COMPLETED'
  | 'ORDER_REVISION_REQUESTED';

export interface OrderNotificationEvent {
  id: string;
  type: OrderNotificationType;
  tenantId: string;
  orderId: string;
  customerId: string;
  at: number;
  message: string;
  channelHints: Array<'email' | 'whatsapp' | 'push' | 'in_app'>;
}

export const CUSTOMER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  received: 'Pedido recibido',
  reviewing: 'En revisión',
  editing: 'En preparación',
  approved: 'Pedido aprobado',
  preparing: 'Preparando producción',
  printing: 'En impresión',
  printing_in_progress: 'En impresión',
  production: 'En producción',
  ready: 'Listo',
  completed: 'Finalizado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  expired: 'Plazo vencido',
};

/** Longer copy for the portal UI — statusLabel stays short for B1-09. */
export const CUSTOMER_STATUS_MESSAGES: Record<OrderStatus, string> = {
  pending: 'Estamos recibiendo tu pedido',
  received: 'Pedido recibido',
  reviewing: 'El taller está revisando tu pedido',
  editing: 'El taller está preparando tu diseño',
  approved: 'Tu pedido fue aprobado',
  preparing: 'El taller está preparando tu pedido',
  printing: 'Tu pedido está en impresión',
  printing_in_progress: 'Tu pedido está siendo impreso',
  production: 'Tu pedido está en producción',
  ready: 'Tu pedido está listo',
  completed: 'Pedido terminado',
  delivered: 'Pedido entregado',
  cancelled: 'Pedido cancelado',
  expired: 'Plazo vencido',
};

export const DEADLINE_LABELS: Record<DeadlineKind, string> = {
  normal: 'En plazo',
  approaching_deadline: 'Próximo a vencer',
  deadline_today: 'Vence hoy',
  expired: 'Plazo vencido',
};

export const CUSTOMER_FLOW_STATUS_KEYS = [
  'RECIBIDO',
  'EN_COLA_IMPRESION',
  'EN_TALLER_COSTURA',
  'PEDIDO_RETIRADO',
  'PEDIDO_A_ENVIAR',
] as const;
export type CustomerFlowStatus = (typeof CUSTOMER_FLOW_STATUS_KEYS)[number];

export const DEFAULT_CUSTOMER_FLOW_LABELS: Record<CustomerFlowStatus, string> = {
  RECIBIDO: 'RECIBIDO',
  EN_COLA_IMPRESION: 'EN COLA DE IMPRESIÓN',
  EN_TALLER_COSTURA: 'EN TALLER DE COSTURA',
  PEDIDO_RETIRADO: 'PEDIDO RETIRADO',
  PEDIDO_A_ENVIAR: 'PEDIDO A ENVIAR',
};

/** Presentation only — does not replace OrderStatus. Labels are overridable per tenant. */
export function presentCustomerOrderStatus(
  order: Pick<PersistedOrder, 'status' | 'fulfillment'>,
  labels?: Partial<Record<CustomerFlowStatus, string>>
): { key: CustomerFlowStatus | 'CANCELLED' | 'EXPIRED'; label: string } {
  const names = { ...DEFAULT_CUSTOMER_FLOW_LABELS, ...labels };
  if (order.status === 'cancelled') return { key: 'CANCELLED', label: CUSTOMER_STATUS_LABELS.cancelled };
  if (order.status === 'expired') return { key: 'EXPIRED', label: CUSTOMER_STATUS_LABELS.expired };
  if (order.status === 'printing' || order.status === 'printing_in_progress') {
    return { key: 'EN_COLA_IMPRESION', label: names.EN_COLA_IMPRESION };
  }
  if (order.status === 'production') {
    return { key: 'EN_TALLER_COSTURA', label: names.EN_TALLER_COSTURA };
  }
  const delivery = order.fulfillment?.mode === 'DELIVERY';
  if (order.status === 'ready' && delivery) {
    return { key: 'PEDIDO_A_ENVIAR', label: names.PEDIDO_A_ENVIAR };
  }
  if (order.status === 'ready' || order.status === 'completed' || order.status === 'delivered') {
    return { key: 'PEDIDO_RETIRADO', label: names.PEDIDO_RETIRADO };
  }
  return { key: 'RECIBIDO', label: names.RECIBIDO };
}

export function paymentMeetsRequired(payment: PaymentRecord | undefined): boolean {
  if (!payment) return false;
  if (payment.status === 'WAIVED') return true;
  if (payment.exceptionAuthorized) return true;
  return Number(payment.amountPaid || 0) + 0.009 >= Number(payment.amountDue || 0);
}

export interface CustomerTimelineItem {
  status: OrderStatus;
  label: string;
  at: number;
  state: 'done' | 'current' | 'upcoming';
}

export interface CustomerProgressStep {
  id: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

export interface CustomerOrderView {
  orderId: string;
  number: string;
  summary: string;
  product?: string;
  quantity?: number;
  status: OrderStatus;
  statusLabel: string;
  statusMessage: string;
  createdAt: number;
  dueAt: number;
  deadlineKind: DeadlineKind;
  deadlineLabel: string;
  consumption?: Array<{ name: string; quantity: number; unit: string }>;
  amount?: number;
  subtotal?: number;
  total?: number;
  currency?: string;
  timeline: CustomerTimelineItem[];
  progress: CustomerProgressStep[];
  files: Array<{ fileId: string; filename: string; version: number; current: boolean; mimeType?: string; size?: number }>;
  history: Array<{ at: number; label: string; note?: string }>;
  events: Array<{ type: string; at: number; message: string }>;
  approvalStatus: OrderApprovalStatus;
  needsApproval: boolean;
  approvals?: Array<{ at: number; decision: string; note?: string; schemaVersion?: number; fileVersion?: number }>;
  processing?: boolean;
  progressLabel?: string;
  confirmationMessage?: string;
}

export interface OrderPreviewSummary {
  disciplineId: string;
  schemaVersion: number;
  product?: string;
  quantity?: number;
  materialName?: string;
  unit?: string;
  consumption?: string;
  amount?: number;
  dueAt: number;
  fields: Array<{ label: string; value: string }>;
}

export function buildCustomerTimeline(order: PersistedOrder): CustomerTimelineItem[] {
  return (order.history || []).map((entry, index, all) => ({
    status: entry.to,
    label: CUSTOMER_STATUS_LABELS[entry.to] || entry.to,
    at: entry.at,
    state: index === all.length - 1 ? 'current' : 'done',
  }));
}

export function toCustomerOrderView(
  order: PersistedOrder,
  deadlineKind: DeadlineKind,
  events: OrderNotificationEvent[] = [],
  extras: {
    progress?: CustomerProgressStep[];
    currency?: string;
    workshopName?: string;
  } = {}
): CustomerOrderView {
  const showAmount = order.visibility?.customerAmount !== false && order.visibility?.estimatedCost !== false;
  const showConsumption = order.visibility?.consumption !== false;
  const qtyRaw = order.formValues?.quantity ?? order.formValues?.qty;
  const quantity = Number(qtyRaw);
  const product =
    String(order.formValues?.product || order.formValues?.productName || order.summary || '').trim() || undefined;
  const currentFile = (order.attachments || []).find((f) => f.current);
  const needsApproval = order.approvalStatus === 'pending' || order.orchestration?.phase === 'approval';
  const amount = showAmount ? order.totalCustomerAmount : undefined;
  return {
    orderId: order.orderId,
    number: order.displayNumber || order.orderId,
    summary: order.summary,
    product,
    quantity: Number.isFinite(quantity) ? quantity : undefined,
    status: order.status,
    statusLabel: CUSTOMER_STATUS_LABELS[order.status] || order.status,
    statusMessage: CUSTOMER_STATUS_MESSAGES[order.status] || CUSTOMER_STATUS_LABELS[order.status] || order.status,
    createdAt: order.createdAt,
    dueAt: order.dueAt,
    deadlineKind,
    deadlineLabel: DEADLINE_LABELS[deadlineKind],
    consumption: showConsumption
      ? (order.consumptions || []).map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: String(line.unit),
        }))
      : undefined,
    amount,
    subtotal: amount,
    total: amount,
    currency: extras.currency || order.economicSnapshot?.currency,
    timeline: buildCustomerTimeline(order),
    progress: extras.progress || fallbackProgress(order),
    files: (order.attachments || []).map((f) => ({
      fileId: f.fileId,
      filename: f.filename,
      version: f.version,
      current: f.current,
      mimeType: f.mimeType,
      size: f.size,
    })),
    history: (order.history || []).map((h) => ({
      at: h.at,
      label: CUSTOMER_STATUS_MESSAGES[h.to] || CUSTOMER_STATUS_LABELS[h.to] || h.to,
      note: friendlyHistoryNote(h.note),
    })),
    events: events.map((e) => ({ type: e.type, at: e.at, message: e.message })),
    approvalStatus: order.approvalStatus || 'not_required',
    needsApproval: needsApproval && order.approvalStatus === 'pending',
    approvals: (order.approvals || []).map((a) => ({
      at: a.at,
      decision: a.decision,
      note: a.note,
      schemaVersion: a.schemaVersion,
      fileVersion: a.fileVersion ?? currentFile?.version,
    })),
    processing:
      ['preparing', 'printing', 'printing_in_progress', 'production'].includes(order.status) ||
      order.orchestration?.phase === 'processing' ||
      order.orchestration?.phase === 'production',
    progressLabel: order.orchestration?.customerLabel,
    confirmationMessage: order.status === 'received' ? 'Pedido recibido' : undefined,
  };
}

function friendlyHistoryNote(note?: string): string | undefined {
  if (!note || note === 'created') return undefined;
  if (note === 'pipeline') return undefined;
  return note;
}

function fallbackProgress(order: PersistedOrder): CustomerProgressStep[] {
  const sequence: Array<{ id: string; label: string; statuses: string[] }> = [
    { id: 'received', label: 'Pedido recibido', statuses: ['received', 'pending'] },
    { id: 'review', label: 'Revisión', statuses: ['reviewing'] },
    { id: 'edit', label: 'Edición', statuses: ['editing'] },
    { id: 'approval', label: 'Aprobación', statuses: ['approved'] },
    { id: 'print', label: 'Impresión', statuses: ['printing', 'printing_in_progress'] },
    { id: 'production', label: 'Producción', statuses: ['preparing', 'production'] },
    { id: 'ready', label: 'Listo', statuses: ['ready', 'completed', 'delivered'] },
  ];
  const idx = sequence.findIndex((s) => s.statuses.includes(order.status));
  return sequence.map((s, i) => ({
    id: s.id,
    label: s.label,
    state: order.status === 'cancelled' ? 'upcoming' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming',
  }));
}

export function assertNoInternalLeak(view: unknown): void {
  const raw = JSON.stringify(view);
  if (
    raw.includes('"internalUnitCost"') ||
    raw.includes('"calculatedInternalCost"') ||
    raw.includes('"totalInternalCost"') ||
    raw.includes('"jobId"') ||
    raw.includes('"jobIds"') ||
    raw.includes('"jobs"')
  ) {
    throw new Error('INTERNAL_DATA_LEAK');
  }
}
