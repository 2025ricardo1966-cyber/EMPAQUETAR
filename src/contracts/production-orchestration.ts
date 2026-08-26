import type { OrderPriority } from './order-domain';

/** Control plane: pipeline definition. Execution plane: jobs/workers/artifacts. */

export type ProcessType =
  | 'review'
  | 'prepare'
  | 'edit'
  | 'separate'
  | 'generate'
  | 'scale'
  | 'print_prep'
  | 'print'
  | 'production'
  | 'control'
  | 'finish';

export type ProcessInstanceStatus =
  | 'pending'
  | 'active'
  | 'waiting_approval'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'skipped'
  | 'failed';

export type ProductionJobStatus =
  | 'queued'
  | 'dispatched'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionTarget = 'local' | 'cloud';
export type WorkerKind = 'LOCAL' | 'CLOUD';
export type WorkerRuntimeStatus = 'idle' | 'busy' | 'offline';

export type PipelinePhase =
  | 'pending'
  | 'in_progress'
  | 'waiting_customer'
  | 'processing'
  | 'production'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export interface ProcessDefinition {
  processId: string;
  name: string;
  type: ProcessType;
  order: number;
  required: boolean;
  enabled: boolean;
  requiresApproval?: boolean;
  requiredPermission?: string;
  config?: Record<string, unknown>;
  customerLabel: string;
}

export interface ProcessInstance {
  instanceId: string;
  processId: string;
  orderId: string;
  tenantId: string;
  name: string;
  type: ProcessType;
  order: number;
  required: boolean;
  requiresApproval: boolean;
  status: ProcessInstanceStatus;
  jobIds: string[];
  currentArtifactId?: string;
  createdAt: number;
  updatedAt: number;
  history: Array<{ at: number; from: ProcessInstanceStatus | null; to: ProcessInstanceStatus; note?: string }>;
}

export interface ProductionJob {
  jobId: string;
  tenantId: string;
  orderId: string;
  processInstanceId: string;
  status: ProductionJobStatus;
  executionTarget: ExecutionTarget;
  assignedWorkerId?: string;
  assignedWorkerKind?: WorkerKind;
  priority: OrderPriority;
  retryCount: number;
  maxRetries: number;
  dependsOnJobIds: string[];
  capability: string;
  createdAt: number;
  updatedAt: number;
  dispatchedAt?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  resultArtifactIds: string[];
  currentArtifactId?: string;
  workflowInstanceId?: string;
  stepId?: string;
  type?: string;
}

export interface ProductionArtifact {
  artifactId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageReference: string;
  createdAt: number;
  sourceJobId: string;
  orderId: string;
  tenantId: string;
  version: number;
  current: boolean;
}

export interface WorkerDescriptor {
  workerId: string;
  type: WorkerKind;
  capabilities: string[];
  status: WorkerRuntimeStatus;
  lastHeartbeat: number;
  implementation: 'local-adapter' | 'cloud-abstract';
  tenantId?: string;
  version?: string;
}

export interface QueueItem {
  jobId: string;
  orderId: string;
  tenantId: string;
  priority: OrderPriority;
  queuedAt: number;
  blockedReason?: 'worker' | 'priority' | 'dependency' | 'approval';
}

export interface DispatchAssignment {
  jobId: string;
  workerId: string;
  workerKind: WorkerKind;
  executionTarget: ExecutionTarget;
  plane: 'execution';
  cloudProvisioned: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3 };

export const PRIORITY_RANK: Record<OrderPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const CUSTOMER_PROCESS_LABELS: Record<ProcessType, string> = {
  review: 'En revisión',
  prepare: 'Preparando pedido',
  edit: 'En preparación',
  separate: 'En preparación',
  generate: 'En procesamiento',
  scale: 'En procesamiento',
  print_prep: 'Preparando impresión',
  print: 'En impresión',
  production: 'En producción',
  control: 'En control',
  finish: 'Finalizado',
};

export const DEFAULT_PIPELINES: Record<string, ProcessDefinition[]> = {
  textile: [
    { processId: 'review', name: 'Revisión', type: 'review', order: 1, required: true, enabled: true, customerLabel: 'En revisión' },
    { processId: 'edit', name: 'Edición', type: 'edit', order: 2, required: true, enabled: true, requiresApproval: true, customerLabel: 'En preparación' },
    { processId: 'prepare', name: 'Preparación', type: 'prepare', order: 3, required: true, enabled: true, customerLabel: 'Preparando pedido' },
    { processId: 'print', name: 'Impresión', type: 'print', order: 4, required: true, enabled: true, customerLabel: 'En impresión' },
    { processId: 'production', name: 'Producción', type: 'production', order: 5, required: true, enabled: true, customerLabel: 'En producción' },
    { processId: 'finish', name: 'Finalización', type: 'finish', order: 6, required: true, enabled: true, customerLabel: 'Finalizado' },
  ],
  tpu: [
    { processId: 'review', name: 'Revisión', type: 'review', order: 1, required: true, enabled: true, customerLabel: 'En revisión' },
    { processId: 'prepare', name: 'Preparación', type: 'prepare', order: 2, required: true, enabled: true, customerLabel: 'Preparando pedido' },
    { processId: 'process', name: 'Procesamiento', type: 'generate', order: 3, required: true, enabled: true, customerLabel: 'En procesamiento' },
    { processId: 'cut', name: 'Corte/Producción', type: 'production', order: 4, required: true, enabled: true, customerLabel: 'En producción' },
    { processId: 'finish', name: 'Finalización', type: 'finish', order: 5, required: true, enabled: true, customerLabel: 'Finalizado' },
  ],
  dtf: [
    { processId: 'review', name: 'Revisión', type: 'review', order: 1, required: true, enabled: true, customerLabel: 'En revisión' },
    { processId: 'prepare', name: 'Preparación', type: 'prepare', order: 2, required: true, enabled: true, customerLabel: 'Preparando pedido' },
    { processId: 'print', name: 'Impresión', type: 'print', order: 3, required: true, enabled: true, customerLabel: 'En impresión' },
    { processId: 'production', name: 'Producción', type: 'production', order: 4, required: true, enabled: true, customerLabel: 'En producción' },
    { processId: 'finish', name: 'Finalización', type: 'finish', order: 5, required: true, enabled: true, customerLabel: 'Listo' },
  ],
};

export const JOB_TRANSITIONS: Record<ProductionJobStatus, ProductionJobStatus[]> = {
  queued: ['dispatched', 'processing', 'cancelled'],
  dispatched: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: [],
};

export function canTransitionProductionJob(from: ProductionJobStatus, to: ProductionJobStatus): boolean {
  if (from === to) return true;
  return JOB_TRANSITIONS[from].includes(to);
}

export function derivePipelinePhase(processes: ProcessInstance[]): PipelinePhase {
  if (!processes.length) return 'pending';
  if (processes.every((p) => p.status === 'cancelled')) return 'cancelled';
  if (processes.some((p) => p.status === 'blocked' || p.status === 'failed')) return 'blocked';
  if (processes.some((p) => p.status === 'waiting_approval')) return 'waiting_customer';
  if (processes.every((p) => p.status === 'completed' || (!p.required && p.status === 'pending'))) {
    const required = processes.filter((p) => p.required);
    if (required.length && required.every((p) => p.status === 'completed')) return 'completed';
  }
  const active = processes.find((p) => p.status === 'active');
  if (active?.type === 'production') return 'production';
  if (active && ['generate', 'scale', 'print', 'print_prep'].includes(active.type)) return 'processing';
  if (active || processes.some((p) => p.status === 'completed')) return 'in_progress';
  return 'pending';
}

export function orderStatusForPhase(phase: PipelinePhase, processType?: ProcessType): import('./order-domain').OrderStatus | undefined {
  if (phase === 'completed') return 'completed';
  if (phase === 'waiting_customer') return 'editing';
  if (phase === 'production') return 'production';
  if (phase === 'processing') {
    if (processType === 'print' || processType === 'print_prep') return 'printing';
    return 'preparing';
  }
  if (phase === 'in_progress') {
    if (processType === 'review') return 'reviewing';
    if (processType === 'edit') return 'editing';
    if (processType === 'prepare') return 'preparing';
    return 'reviewing';
  }
  return undefined;
}
