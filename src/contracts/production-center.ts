import type { DeadlineKind, OrderPriority, OrderStatus } from './order-domain';
import type { PipelinePhase, ProcessInstanceStatus, ProductionJobStatus } from './production-orchestration';

export type DeadlineClass = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE';

export type WorkspaceView =
  | 'all'
  | 'active'
  | 'pending'
  | 'production'
  | 'due_soon'
  | 'overdue'
  | 'finished'
  | 'cancelled';

export type ProductionSort =
  | 'urgency'
  | 'dueAt'
  | 'priority'
  | 'createdAt'
  | 'status'
  | 'customer';

export interface KanbanColumnDef {
  id: string;
  label: string;
  statuses?: OrderStatus[];
  waitingApproval?: boolean;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumnDef[] = [
  { id: 'received', label: 'Recibidos', statuses: ['received'] },
  { id: 'reviewing', label: 'En revisión', statuses: ['reviewing'] },
  { id: 'editing', label: 'En edición', statuses: ['editing'] },
  { id: 'waiting_approval', label: 'Esperando aprobación', waitingApproval: true },
  { id: 'preparing', label: 'Preparando', statuses: ['preparing', 'approved'] },
  { id: 'printing', label: 'En impresión', statuses: ['printing', 'printing_in_progress'] },
  { id: 'production', label: 'En producción', statuses: ['production'] },
  { id: 'ready', label: 'Listos', statuses: ['ready'] },
  { id: 'finished', label: 'Terminados', statuses: ['completed', 'delivered'] },
];

export interface ProductionQuery {
  status?: OrderStatus | OrderStatus[];
  priority?: OrderPriority;
  disciplineId?: string;
  customerId?: string;
  customer?: string;
  product?: string;
  productId?: string;
  assignedTo?: string;
  fromDueAt?: number;
  toDueAt?: number;
  fromCreatedAt?: number;
  toCreatedAt?: number;
  deadline?: DeadlineKind | 'approaching' | 'expired' | 'today';
  deadlineClass?: DeadlineClass;
  process?: string;
  error?: boolean;
  waitingApproval?: boolean;
  view?: WorkspaceView;
  q?: string;
  sort?: ProductionSort;
  offset?: number;
  limit?: number;
}

export interface ConsumptionLineView {
  name: string;
  quantity: number;
  unit: string;
  customerAmount?: number;
  internalCost?: number;
}

export interface FinanceView {
  cost?: number;
  price?: number;
  margin?: number;
}

export interface ProductionCard {
  orderId: string;
  number: string;
  customerId: string;
  customerName: string;
  disciplineId?: string;
  product?: string;
  summary: string;
  quantity?: number;
  createdAt: number;
  dueAt: number;
  remainingMs: number;
  overdueMs?: number;
  deadlineKind: DeadlineKind;
  deadlineClass: DeadlineClass;
  deadlineLabel: string;
  priority: OrderPriority;
  status: OrderStatus;
  assignedTo?: string;
  assignedToLabel?: string;
  revision: number;
  columnId: string;
  progress?: { done: number; total: number };
  waitingApproval?: boolean;
  blockedReason?: string;
  hasJobError?: boolean;
  consumption?: ConsumptionLineView[];
  finance?: FinanceView;
}

export interface ProductionCounters {
  active: number;
  pending: number;
  inProgress: number;
  waiting: number;
  printing: number;
  production: number;
  ready: number;
  finished: number;
  approachingDeadline: number;
  expired: number;
  cancelled: number;
  all: number;
}

export interface ProductionProcessView {
  instanceId: string;
  name: string;
  type: string;
  status: ProcessInstanceStatus;
  marker: 'done' | 'current' | 'blocked' | 'waiting' | 'upcoming';
  waitingPrevious?: boolean;
}

export interface ProductionJobView {
  jobId: string;
  processName: string;
  status: ProductionJobStatus;
  priority: OrderPriority;
  retryCount: number;
  executionTarget: string;
  error?: string;
  currentArtifact?: string;
}

export interface ProductionDetail {
  card: ProductionCard;
  customerName: string;
  customerId: string;
  files: Array<{
    fileId: string;
    filename: string;
    version: number;
    current: boolean;
    mimeType?: string;
    size?: number;
    status?: string;
  }>;
  form?: Record<string, unknown>;
  consumption: ConsumptionLineView[];
  consumptionByUnit: Record<string, ConsumptionLineView[]>;
  finance?: FinanceView;
  processes: ProductionProcessView[];
  jobs?: ProductionJobView[];
  workflow?: {
    instanceId: string;
    workflowId: string;
    workflowVersion: number;
    name: string;
    key: string;
    status: string;
    currentStepId?: string;
    blockedReason?: string;
    revision: number;
    steps: Array<{
      stepId: string;
      name: string;
      type: string;
      status: string;
      marker: ProductionProcessView['marker'];
      processStatus?: string;
      startedAt?: number;
      completedAt?: number;
    }>;
    jobs?: Array<{
      jobId: string;
      stepId?: string;
      type?: string;
      status: string;
      attempt: number;
      error?: string;
      priority?: string;
      createdAt: number;
      startedAt?: number;
      completedAt?: number;
    }>;
    events: Array<{ at: number; type: string; stepId?: string; actorId: string; actorType: string; result?: string }>;
  };
  approvals?: Array<{
    at: number;
    decision: string;
    note?: string;
    actorId?: string;
    schemaVersion?: number;
    fileVersion?: number;
  }>;
  changeRequests?: Array<{ at: number; note?: string; fileVersion?: number }>;
  internalComments?: Array<{ commentId: string; actorId: string; actorLabel?: string; at: number; body: string }>;
  history: Array<{ at: number; from: string | null; to: string; note?: string; actorId?: string }>;
  timeline?: import('./trace-domain').TimelineItem[];
  phase?: PipelinePhase;
  revision: number;
  generatedAt: number;
}

export interface CalendarBucket {
  date: string;
  due: ProductionCard[];
  approaching: ProductionCard[];
  expired: ProductionCard[];
}

export interface ProductionBoard {
  counters: ProductionCounters;
  columns: KanbanColumnDef[];
  kanban: Record<string, ProductionCard[]>;
  page: { items: ProductionCard[]; total: number; offset: number; limit: number };
  generatedAt: number;
  tenantStatus?: string;
}
