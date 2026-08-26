import type { OrchestrationJobStatus } from './processing-port';
import type { CommercialEconomicSnapshot } from './commercial-terms';

/** Business/production order — not a technical Job. OS-agnostic. */
export type OrderStatus =
  | 'pending'
  | 'received'
  | 'reviewing'
  | 'editing'
  | 'approved'
  | 'preparing'
  | 'printing'
  | 'printing_in_progress'
  | 'production'
  | 'ready'
  | 'completed'
  | 'delivered'
  | 'cancelled'
  | 'expired';

export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export type DeadlineKind = 'normal' | 'approaching_deadline' | 'deadline_today' | 'expired';

export type ViewerRole = 'admin' | 'subadmin' | 'customer' | 'system';

/** Extensible unit codes. Built-ins are conventions, not a closed enum in storage. */
export type MaterialUnitCode =
  | 'METRO'
  | 'UNIDAD'
  | 'M2'
  | 'KG'
  | 'ROLLO'
  | 'LITRO'
  | 'HOJA'
  | 'OTRA'
  | string;

export interface DeadlinePolicy {
  /** Remaining ms at or below this (and not today/expired) → approaching_deadline */
  approachingWithinMs: number;
  /** IANA timezone of the Tenant; deadlines use this calendar day when set. */
  timeZone?: string;
}

export const DEFAULT_DEADLINE_POLICY: DeadlinePolicy = {
  approachingWithinMs: 2 * 24 * 60 * 60 * 1000,
};

export interface OrderActor {
  actorId: string;
  role: ViewerRole;
  label?: string;
}

export interface OrderStatusHistoryEntry {
  from: OrderStatus | null;
  to: OrderStatus;
  at: number;
  actor: OrderActor;
  note?: string;
}

export interface OrderVisibility {
  consumption: boolean;
  customerAmount: boolean;
  estimatedCost: boolean;
  internalCost: boolean;
  margin: boolean;
  purchasePrice: boolean;
  jobs: boolean;
}

export const DEFAULT_CUSTOMER_VISIBILITY: OrderVisibility = {
  consumption: true,
  customerAmount: true,
  estimatedCost: true,
  internalCost: false,
  margin: false,
  purchasePrice: false,
  jobs: false,
};

export const DEFAULT_ADMIN_VISIBILITY: OrderVisibility = {
  consumption: true,
  customerAmount: true,
  estimatedCost: true,
  internalCost: true,
  margin: true,
  purchasePrice: true,
  jobs: true,
};

export interface MaterialConsumption {
  lineId: string;
  materialId: string;
  name: string;
  /** textile | tpu | dtf | custom — not a separate order type */
  discipline?: string;
  unit: MaterialUnitCode;
  unitId?: string;
  quantity: number;
  requestedQuantity?: number;
  consumption?: number;
  calculationSource?: string;
  costType?: string;
  currency?: string;
  productId?: string;
  internalUnitCost: number;
  customerUnitPrice: number;
  calculatedInternalCost: number;
  calculatedCustomerAmount: number;
  snapshot?: Record<string, unknown>;
}

export interface OrderAttachmentRef {
  fileId: string;
  storageReference: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
  version: number;
  current: boolean;
  replacesFileId?: string;
}

export type OrderApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface OrderApprovalRecord {
  actorId: string;
  at: number;
  schemaVersion?: number;
  fileVersion?: number;
  decision: 'approved' | 'rejected';
  note?: string;
}

export interface LinkedJobRef {
  jobId: string;
  label?: string;
  technicalStatus?: OrchestrationJobStatus;
}

export interface PersistedOrder {
  orderId: string;
  /** Legible, e.g. #EMP-000001 — not a substitute for orderId. */
  displayNumber?: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  summary: string;
  /** First-class project title. Not a substitute for summary/product. */
  projectName?: string;
  priority: OrderPriority;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  jobIds: string[];
  jobs: LinkedJobRef[];
  consumptions: MaterialConsumption[];
  totalInternalCost: number;
  totalCustomerAmount: number;
  visibility: OrderVisibility;
  history: OrderStatusHistoryEntry[];
  metadata?: Record<string, string | number | boolean | null>;
  configurationSnapshot?: {
    schemaId: string;
    schemaVersion: number;
    disciplineId: string;
    capturedAt: number;
    fields: unknown[];
    materials: unknown[];
    rules?: unknown[];
  };
  formValues?: Record<string, unknown>;
  attachments?: OrderAttachmentRef[];
  approvalStatus?: OrderApprovalStatus;
  approvals?: OrderApprovalRecord[];
  economicSnapshot?: CommercialEconomicSnapshot;
  orchestration?: {
    phase: string;
    currentProcessName?: string;
    customerLabel?: string;
    blockedReason?: string;
  };
  assignedTo?: string;
  assignedToLabel?: string;
  assignedAt?: number;
  revision?: number;
  internalComments?: OrderInternalComment[];
  fulfillment?: import('./fulfillment-domain').OrderFulfillment;
}

export interface OrderInternalComment {
  commentId: string;
  actorId: string;
  actorLabel?: string;
  at: number;
  body: string;
}

export interface CreateOrderRequest {
  tenantId: string;
  customerId: string;
  customerName: string;
  summary?: string;
  projectName?: string;
  priority?: OrderPriority;
  dueAt: number;
  visibility?: Partial<OrderVisibility>;
  actor: OrderActor;
  configurationSnapshot?: PersistedOrder['configurationSnapshot'];
  disciplineId?: string;
  formValues?: Record<string, unknown>;
  initialStatus?: OrderStatus;
  attachments?: OrderAttachmentRef[];
  approvalStatus?: OrderApprovalStatus;
  catalogLines?: import('./catalog-domain').CatalogLineInput[];
  productId?: string;
  fulfillment?: import('./fulfillment-domain').OrderFulfillment;
  totalCustomerAmount?: number;
  economicSnapshot?: CommercialEconomicSnapshot;
}

export interface OrderDeadlineInfo {
  kind: DeadlineKind;
  dueAt: number;
  remainingMs: number;
  isExpired: boolean;
}

export interface OrderDashboardCounts {
  pending: number;
  inProgress: number;
  finished: number;
  approachingDeadline: number;
  expired: number;
  all: number;
}

export interface OrderDashboard {
  counts: OrderDashboardCounts;
  pending: PersistedOrder[];
  inProgress: PersistedOrder[];
  finished: PersistedOrder[];
  approachingDeadline: PersistedOrder[];
  expired: PersistedOrder[];
}

export type OrderBoardFilter =
  | 'all'
  | 'in_progress'
  | 'pending'
  | 'finished'
  | 'expired'
  | 'approaching_deadline';
