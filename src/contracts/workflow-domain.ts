import type { OrderStatus } from './order-domain';
import type { ProcessType } from './production-orchestration';

export type WorkflowDefinitionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type WorkflowInstanceStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'BLOCKED';
export type WorkflowStepRuntimeStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED';
export type WorkflowActorType = 'USER' | 'SYSTEM';
export type WorkflowJobPublicStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type WorkflowPrecondition =
  | 'previous_completed'
  | 'approved_file'
  | 'material_selected'
  | 'quantity_valid'
  | 'customer_approved'
  | 'material_active';
export type WorkflowPostcondition = 'set_order_status' | 'create_job' | 'snapshot' | 'emit_event';

export interface WorkflowStepDefinition {
  stepId: string;
  name: string;
  type: string;
  order: number;
  required: boolean;
  roles: string[];
  configuration: {
    autoComplete?: boolean;
    autoActivate?: boolean;
    requiresApproval?: boolean;
    allowSkip?: boolean;
    failTargetStepId?: string;
    changeRequestStepId?: string;
    orderStatus?: OrderStatus;
    jobType?: string;
    processType?: ProcessType;
    preconditions?: WorkflowPrecondition[];
    postconditions?: WorkflowPostcondition[];
    customerLabel?: string;
    skipProcess?: boolean;
    [key: string]: unknown;
  };
}

export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  key: string;
  rubricId?: string;
  productId?: string;
  name: string;
  version: number;
  status: WorkflowDefinitionStatus;
  steps: WorkflowStepDefinition[];
  createdAt: number;
  updatedAt: number;
  isDefault?: boolean;
  updatedBy?: string;
}

export interface WorkflowEvent {
  at: number;
  type: string;
  stepId?: string;
  actorId: string;
  actorType: WorkflowActorType;
  result?: string;
  note?: string;
}

export interface WorkflowInstance {
  instanceId: string;
  tenantId: string;
  orderId: string;
  workflowId: string;
  workflowVersion: number;
  snapshot: WorkflowDefinition;
  currentStepId?: string;
  status: WorkflowInstanceStatus;
  startedAt: number;
  completedAt?: number;
  revision: number;
  blockedReason?: string;
  blockedCustomerReason?: string;
  cancelReason?: string;
  events: WorkflowEvent[];
}

export const STEP_RUNTIME_TRANSITIONS: Record<WorkflowStepRuntimeStatus, WorkflowStepRuntimeStatus[]> = {
  PENDING: ['ACTIVE', 'SKIPPED', 'CANCELLED', 'BLOCKED'],
  ACTIVE: ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'PENDING'],
  COMPLETED: [],
  SKIPPED: [],
  BLOCKED: ['ACTIVE', 'CANCELLED', 'FAILED'],
  FAILED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionStep(from: WorkflowStepRuntimeStatus, to: WorkflowStepRuntimeStatus, opts?: { autoComplete?: boolean; allowSkip?: boolean }): boolean {
  if (from === to) return true;
  if (from === 'PENDING' && to === 'COMPLETED') return Boolean(opts?.autoComplete);
  if (from === 'PENDING' && to === 'SKIPPED') return Boolean(opts?.allowSkip);
  return (STEP_RUNTIME_TRANSITIONS[from] || []).includes(to);
}

export function runtimeFromProcessStatus(status: string): WorkflowStepRuntimeStatus {
  if (status === 'waiting_approval') return 'ACTIVE';
  if (status === 'pending') return 'PENDING';
  if (status === 'active') return 'ACTIVE';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'skipped') return 'SKIPPED';
  if (status === 'failed') return 'FAILED';
  if (status === 'blocked') return 'BLOCKED';
  return 'PENDING';
}

export function processStatusFromRuntime(status: WorkflowStepRuntimeStatus, requiresApproval?: boolean): import('./production-orchestration').ProcessInstanceStatus {
  if (status === 'ACTIVE' && requiresApproval) return 'waiting_approval';
  if (status === 'PENDING') return 'pending';
  if (status === 'ACTIVE') return 'active';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'SKIPPED') return 'skipped';
  if (status === 'FAILED') return 'failed';
  return 'blocked';
}

export function publicJobStatus(status: string): WorkflowJobPublicStatus {
  if (status === 'completed') return 'SUCCEEDED';
  if (status === 'failed') return 'FAILED';
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'processing' || status === 'dispatched') return 'RUNNING';
  return 'QUEUED';
}

export function processTypeForStep(step: WorkflowStepDefinition): ProcessType {
  if (step.configuration.processType) return step.configuration.processType;
  const t = step.type.toUpperCase();
  if (t === 'EDIT' || t === 'EDITING') return 'edit';
  if (t === 'APPROVAL' || t === 'WAITING_APPROVAL') return 'edit';
  if (t === 'PRINT' || t === 'PRINTING') return 'print';
  if (t === 'PRODUCTION') return 'production';
  if (t === 'QC' || t === 'CONTROL') return 'control';
  if (t === 'READY' || t === 'COMPLETED' || t === 'FINISH') return 'finish';
  if (t === 'PROCESS' || t === 'GENERATE') return 'generate';
  if (t === 'PREPARE') return 'prepare';
  return 'review';
}

function step(
  stepId: string,
  name: string,
  type: string,
  order: number,
  extra: Partial<WorkflowStepDefinition['configuration']> & { roles?: string[]; required?: boolean } = {}
): WorkflowStepDefinition {
  const { roles, required, ...configuration } = extra;
  return {
    stepId,
    name,
    type,
    order,
    required: required !== false,
    roles: roles || ['ADMIN_PRINCIPAL', 'ADMIN', 'OPERATOR'],
    configuration,
  };
}

const WORKSHOP = ['ADMIN_PRINCIPAL', 'ADMIN', 'OPERATOR'];
const REVIEWERS = ['ADMIN_PRINCIPAL', 'ADMIN'];
const APPROVERS = ['CUSTOMER', 'ADMIN_PRINCIPAL', 'ADMIN'];

export function textileWorkflowSteps(): WorkflowStepDefinition[] {
  return [
    step('received', 'Recibido', 'RECEIVED', 1, {
      autoComplete: true,
      skipProcess: true,
      orderStatus: 'received',
      roles: ['SYSTEM', ...WORKSHOP],
    }),
    step('reviewing', 'Revisión', 'REVIEW', 2, { orderStatus: 'reviewing', processType: 'review', roles: REVIEWERS, preconditions: ['previous_completed'] }),
    step('editing', 'Edición', 'EDIT', 3, {
      autoComplete: true,
      orderStatus: 'editing',
      processType: 'edit',
      preconditions: ['previous_completed'],
    }),
    step('waiting_approval', 'Aprobación', 'APPROVAL', 4, {
      requiresApproval: true,
      orderStatus: 'editing',
      processType: 'edit',
      roles: APPROVERS,
      preconditions: ['previous_completed'],
      changeRequestStepId: 'editing',
    }),
    step('approved', 'Aprobado', 'APPROVED', 5, {
      autoComplete: true,
      skipProcess: true,
      orderStatus: 'approved',
      preconditions: ['previous_completed', 'customer_approved'],
    }),
    step('printing', 'Impresión', 'PRINT', 6, {
      orderStatus: 'printing',
      processType: 'print',
      jobType: 'print',
      postconditions: ['create_job', 'set_order_status'],
      preconditions: ['previous_completed', 'approved_file'],
    }),
    step('production', 'Producción', 'PRODUCTION', 7, {
      orderStatus: 'production',
      processType: 'production',
      jobType: 'production',
      postconditions: ['create_job', 'set_order_status'],
      preconditions: ['previous_completed', 'material_selected', 'quantity_valid', 'material_active'],
    }),
    step('ready', 'Listo', 'READY', 8, { orderStatus: 'ready', processType: 'finish', preconditions: ['previous_completed'], customerLabel: 'Tu pedido está listo.' }),
    step('completed', 'Finalizado', 'COMPLETED', 9, { autoActivate: false, orderStatus: 'completed', processType: 'finish', preconditions: ['previous_completed'], roles: REVIEWERS }),
  ];
}

export function tpuWorkflowSteps(): WorkflowStepDefinition[] {
  return [
    step('received', 'Recibido', 'RECEIVED', 1, {
      autoComplete: true,
      skipProcess: true,
      orderStatus: 'received',
      roles: ['SYSTEM', ...WORKSHOP],
    }),
    step('reviewing', 'Revisión', 'REVIEW', 2, { orderStatus: 'reviewing', processType: 'review', roles: REVIEWERS, preconditions: ['previous_completed'] }),
    step('editing', 'Edición', 'EDIT', 3, { orderStatus: 'editing', processType: 'edit', preconditions: ['previous_completed'] }),
    step('approved', 'Aprobado', 'APPROVED', 4, { orderStatus: 'approved', roles: REVIEWERS, preconditions: ['previous_completed'] }),
    step('process', 'Procesamiento', 'PROCESS', 5, { processType: 'generate', jobType: 'process', postconditions: ['create_job'], preconditions: ['previous_completed'] }),
    step('production', 'Producción', 'PRODUCTION', 6, {
      orderStatus: 'production',
      processType: 'production',
      jobType: 'production',
      postconditions: ['create_job', 'set_order_status'],
      preconditions: ['previous_completed', 'material_selected', 'material_active'],
    }),
    step('qc', 'Control de calidad', 'QC', 7, {
      processType: 'control',
      failTargetStepId: 'editing',
      roles: REVIEWERS,
      preconditions: ['previous_completed'],
    }),
    step('ready', 'Listo', 'READY', 8, { orderStatus: 'ready', processType: 'finish', preconditions: ['previous_completed'], customerLabel: 'Tu pedido está listo.' }),
    step('completed', 'Finalizado', 'COMPLETED', 9, { autoActivate: false, orderStatus: 'completed', processType: 'finish', preconditions: ['previous_completed'], roles: REVIEWERS }),
  ];
}

export function dtfWorkflowSteps(): WorkflowStepDefinition[] {
  return [
    step('received', 'Recibido', 'RECEIVED', 1, {
      autoComplete: true,
      skipProcess: true,
      orderStatus: 'received',
      roles: ['SYSTEM', ...WORKSHOP],
    }),
    step('reviewing', 'Revisión', 'REVIEW', 2, { orderStatus: 'reviewing', processType: 'review', roles: REVIEWERS, preconditions: ['previous_completed'] }),
    step('editing', 'Edición', 'EDIT', 3, { autoComplete: true, orderStatus: 'editing', processType: 'edit', preconditions: ['previous_completed'] }),
    step('waiting_approval', 'Aprobación', 'APPROVAL', 4, {
      requiresApproval: true,
      processType: 'edit',
      roles: APPROVERS,
      preconditions: ['previous_completed'],
      changeRequestStepId: 'editing',
    }),
    step('approved', 'Aprobado', 'APPROVED', 5, { autoComplete: true, skipProcess: true, orderStatus: 'approved', preconditions: ['previous_completed'] }),
    step('printing', 'Impresión', 'PRINT', 6, {
      orderStatus: 'printing',
      processType: 'print',
      jobType: 'print',
      postconditions: ['create_job', 'set_order_status'],
      preconditions: ['previous_completed'],
    }),
    step('production', 'Producción', 'PRODUCTION', 7, {
      orderStatus: 'production',
      processType: 'production',
      jobType: 'production',
      postconditions: ['create_job', 'set_order_status'],
      preconditions: ['previous_completed', 'material_active'],
    }),
    step('ready', 'Listo', 'READY', 8, { orderStatus: 'ready', processType: 'finish', preconditions: ['previous_completed'], customerLabel: 'Tu pedido está listo.' }),
    step('completed', 'Finalizado', 'COMPLETED', 9, { autoActivate: false, orderStatus: 'completed', processType: 'finish', preconditions: ['previous_completed'], roles: REVIEWERS }),
  ];
}

export const DEFAULT_WORKFLOW_KEYS = ['textile', 'tpu', 'dtf'] as const;

export function defaultStepsForKey(key: string): WorkflowStepDefinition[] {
  if (key === 'tpu') return tpuWorkflowSteps();
  if (key === 'dtf') return dtfWorkflowSteps();
  return textileWorkflowSteps();
}
