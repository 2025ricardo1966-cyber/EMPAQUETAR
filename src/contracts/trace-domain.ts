/** B1-19: domain events vs operational notifications. Retention is indefinite until a later policy is configured. */
export const TRACE_RETENTION_POLICY = 'indefinite' as const;

export type DomainActorType = 'CUSTOMER' | 'ADMIN_PRINCIPAL' | 'ADMIN' | 'OPERATOR' | 'SYSTEM' | 'SUPER_ADMIN';

export type DomainEntityType =
  | 'order'
  | 'workflow'
  | 'job'
  | 'artifact'
  | 'approval'
  | 'config'
  | 'notification'
  | 'tenant'
  | 'permission';

export type OrderDomainEventType =
  | 'ORDER_CREATED'
  | 'ORDER_SUBMITTED'
  | 'ORDER_REVIEW_STARTED'
  | 'ORDER_EDITING_STARTED'
  | 'ORDER_APPROVAL_REQUESTED'
  | 'ORDER_APPROVED'
  | 'ORDER_CHANGE_REQUESTED'
  | 'ORDER_PRINTING_STARTED'
  | 'ORDER_PRODUCTION_STARTED'
  | 'ORDER_READY'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'ORDER_BLOCKED'
  | 'ORDER_OVERDUE'
  | 'ORDER_DUE_SOON'
  | 'ORDER_STATUS_CHANGED';

export type WorkflowDomainEventType =
  | 'WORKFLOW_STARTED'
  | 'WORKFLOW_CHANGED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_BLOCKED'
  | 'STEP_FAILED'
  | 'STEP_SKIPPED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_CANCELLED';

export type JobDomainEventType =
  | 'JOB_CREATED'
  | 'JOB_STARTED'
  | 'JOB_SUCCEEDED'
  | 'JOB_FAILED'
  | 'JOB_RETRIED'
  | 'JOB_CANCELLED';

export type ArtifactDomainEventType =
  | 'ARTIFACT_UPLOADED'
  | 'ARTIFACT_VERSION_CREATED'
  | 'ARTIFACT_APPROVED'
  | 'ARTIFACT_REPLACED';

export type ApprovalDomainEventType =
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_APPROVED'
  | 'APPROVAL_REJECTED'
  | 'CHANGE_REQUESTED';

export type ConfigDomainEventType =
  | 'MATERIAL_CHANGED'
  | 'PRICE_CHANGED'
  | 'PRODUCT_CHANGED'
  | 'SCHEMA_CHANGED'
  | 'WORKFLOW_CHANGED'
  | 'PERMISSION_CHANGED'
  | 'TENANT_SUSPENDED'
  | 'TENANT_REACTIVATED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DEACTIVATED'
  | 'MATERIAL_CREATED'
  | 'MATERIAL_UPDATED'
  | 'WORKFLOW_CONFIG_UPDATED'
  | 'PRODUCT_PRICE_UPDATED'
  | 'MATERIAL_COST_UPDATED'
  | 'COMMERCIAL_CONFIG_UPDATED';

export type MessageDomainEventType =
  | 'CLIENT_MESSAGE_CREATED'
  | 'CLIENT_MESSAGE_REPLIED'
  | 'ADMIN_MESSAGE_REPLIED'
  | 'MESSAGE_STATUS_CHANGED'
  | 'FULFILLMENT_UPDATED';

export type ClientPortalEventType =
  | 'CUSTOMER_REGISTERED'
  | 'CUSTOMER_TRUST_ACTIVATED'
  | 'PAYMENT_VOUCHER_UPLOADED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_REJECTED'
  | 'PAYMENT_CHECKOUT_CREATED'
  | 'PAYMENT_REFUNDED'
  | 'PROJECT_NAME_CHANGED'
  | 'ROSTER_APPROVED'
  | 'CONFIGURATION_CHANGED'
  | 'PRODUCTION_APPROVED'
  | 'OUTPUT_GENERATED'
  | 'OUTPUT_FAILED'
  | 'OJO_EVALUATED';

export type DomainEventType =
  | OrderDomainEventType
  | WorkflowDomainEventType
  | JobDomainEventType
  | ArtifactDomainEventType
  | ApprovalDomainEventType
  | ConfigDomainEventType
  | ClientPortalEventType
  | MessageDomainEventType
  | 'FILE_CONVERSION_REQUESTED'
  | 'FILE_CONVERSION_COMPLETED'
  | 'FILE_CONVERSION_FAILED'
  | 'ORDER_ASSIGNED'
  | 'INTERNAL_COMMENT_ADDED'
  | 'ARTIFACT_REJECTED'
  | 'ARTIFACT_VALIDATED'
  | 'TRUST_CODE_GENERATED';

export interface DomainEvent {
  eventId: string;
  tenantId: string;
  entityType: DomainEntityType;
  entityId: string;
  eventType: DomainEventType | string;
  actorType: DomainActorType;
  actorId: string;
  timestamp: number;
  metadata: Record<string, unknown>;
  correlationId: string;
}

export type NotificationAudience = 'customer' | 'workshop' | 'platform';

export type OperationalNotificationType =
  | 'ORDER_RECEIVED'
  | 'APPROVAL_REQUIRED'
  | 'CHANGE_REQUESTED'
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_READY'
  | 'ORDER_COMPLETED'
  | 'ORDER_OVERDUE'
  | 'ORDER_DUE_SOON'
  | 'ORDER_PRODUCTION_STARTED'
  | 'JOB_FAILED'
  | 'WORKFLOW_BLOCKED'
  | 'TENANT_SUSPENDED'
  | 'CLIENT_MESSAGE_CREATED'
  | 'CLIENT_MESSAGE_REPLIED'
  | 'ADMIN_MESSAGE_REPLIED'
  | 'MESSAGE_STATUS_CHANGED'
  | 'COMMERCIAL_CONFIG_UPDATED'
  | 'SECURITY_ALERT';

export interface OperationalNotification {
  notificationId: string;
  tenantId: string;
  recipientId: string;
  type: OperationalNotificationType | string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  read: boolean;
  createdAt: number;
  metadata: Record<string, unknown>;
  dedupeKey: string;
  audience: NotificationAudience;
  readAt?: number;
}

export interface TimelineItem {
  eventId: string;
  eventType: string;
  at: number;
  displayAt: string;
  actorLabel: string;
  actorType: DomainActorType;
  title: string;
  detail?: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  workflowStepId?: string;
  workflowVersion?: number;
  artifactVersion?: number;
  orderStatus?: string;
  nextHint?: string;
}

export interface NotificationListQuery {
  unread?: boolean;
  type?: string;
  entityId?: string;
  from?: number;
  to?: number;
  cursor?: string;
  limit?: number;
  /** Ignored unless Admin Principal; backend never trusts client recipientId for customers. */
  recipientId?: string;
}

export interface NotificationListPage {
  items: OperationalNotification[];
  nextCursor?: string;
  unreadCount: number;
}

export const CUSTOMER_VISIBLE_EVENT_TYPES = new Set<string>([
  'ORDER_CREATED',
  'ORDER_SUBMITTED',
  'ORDER_REVIEW_STARTED',
  'ORDER_EDITING_STARTED',
  'ORDER_APPROVAL_REQUESTED',
  'ORDER_APPROVED',
  'ORDER_CHANGE_REQUESTED',
  'ORDER_PRINTING_STARTED',
  'ORDER_PRODUCTION_STARTED',
  'ORDER_READY',
  'ORDER_COMPLETED',
  'FULFILLMENT_UPDATED',
  'ORDER_CANCELLED',
  'ORDER_OVERDUE',
  'ORDER_DUE_SOON',
  'ARTIFACT_UPLOADED',
  'ARTIFACT_VERSION_CREATED',
  'ARTIFACT_APPROVED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'CHANGE_REQUESTED',
  'STEP_STARTED',
  'STEP_COMPLETED',
  'WORKFLOW_STARTED',
  'WORKFLOW_COMPLETED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_VOUCHER_UPLOADED',
  'PROJECT_NAME_CHANGED',
  'ROSTER_APPROVED',
  'CONFIGURATION_CHANGED',
  'PRODUCTION_APPROVED',
  'OUTPUT_GENERATED',
  'OUTPUT_FAILED',
  'OJO_EVALUATED',
]);

export const OPERATOR_HIDDEN_EVENT_TYPES = new Set<string>([
  'PRICE_CHANGED',
  'PERMISSION_CHANGED',
]);

export const SENSITIVE_META_KEY = /cost|margin|password|token|secret|internal|hash|authorization|apikey|credit/i;

export function actorLabel(actorType: DomainActorType): string {
  if (actorType === 'CUSTOMER') return 'Cliente';
  if (actorType === 'ADMIN_PRINCIPAL') return 'Admin Principal';
  if (actorType === 'ADMIN') return 'Subadmin';
  if (actorType === 'OPERATOR') return 'Operador';
  if (actorType === 'SUPER_ADMIN') return 'Super Admin';
  return 'Sistema';
}

export function actorTypeFromRole(roleId?: string, actorId?: string): DomainActorType {
  if (!roleId || roleId === 'SYSTEM' || actorId === 'pipeline' || actorId === 'system') return 'SYSTEM';
  if (roleId === 'CUSTOMER') return 'CUSTOMER';
  if (roleId === 'ADMIN_PRINCIPAL') return 'ADMIN_PRINCIPAL';
    if (roleId === 'SUBADMIN') return 'ADMIN';
  if (roleId === 'OPERATOR') return 'OPERATOR';
  if (roleId === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  return 'SYSTEM';
}

export function sanitizeEventMetadata(input?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (SENSITIVE_META_KEY.test(key)) continue;
    if (key === 'contentBase64' || key === 'bytes' || key === 'binary') continue;
    if (typeof value === 'string' && value.length > 400) continue;
    out[key] = value;
  }
  return out;
}

export function publicNotificationMetadata(input?: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    'orderId',
    'displayNumber',
    'route',
    'comment',
    'artifactVersion',
    'workflowStepId',
    'dueAt',
    'messageId',
    'category',
    'status',
    'channel',
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sanitizeEventMetadata(input))) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

export function formatTimestamp(ts: number, timeZone?: string): string {
  return new Date(ts).toLocaleString('es-AR', {
    timeZone: timeZone || 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function eventTitle(eventType: string): string {
  const map: Record<string, string> = {
    ORDER_CREATED: 'Pedido creado',
    ORDER_SUBMITTED: 'Pedido recibido',
    ORDER_REVIEW_STARTED: 'Revisión iniciada',
    ORDER_EDITING_STARTED: 'Diseño editado',
    ORDER_APPROVAL_REQUESTED: 'Aprobación solicitada',
    ORDER_APPROVED: 'Pedido aprobado',
    ORDER_CHANGE_REQUESTED: 'Cambio solicitado',
    ORDER_PRINTING_STARTED: 'Impresión iniciada',
    ORDER_PRODUCTION_STARTED: 'Producción iniciada',
    ORDER_READY: 'Pedido listo',
    ORDER_COMPLETED: 'Pedido completado',
    ORDER_CANCELLED: 'Pedido cancelado',
    ORDER_BLOCKED: 'Pedido bloqueado',
    ORDER_OVERDUE: 'Pedido vencido',
    ORDER_DUE_SOON: 'Pedido próximo a vencer',
    ORDER_STATUS_CHANGED: 'Estado actualizado',
    WORKFLOW_STARTED: 'Workflow iniciado',
    STEP_STARTED: 'Etapa iniciada',
    STEP_COMPLETED: 'Etapa completada',
    STEP_BLOCKED: 'Etapa bloqueada',
    STEP_FAILED: 'Etapa fallida',
    STEP_SKIPPED: 'Etapa omitida',
    WORKFLOW_COMPLETED: 'Workflow completado',
    WORKFLOW_CANCELLED: 'Workflow cancelado',
    JOB_CREATED: 'Trabajo creado',
    JOB_STARTED: 'Trabajo iniciado',
    JOB_SUCCEEDED: 'Trabajo finalizado',
    JOB_FAILED: 'Trabajo fallido',
    JOB_RETRIED: 'Trabajo reintentado',
    JOB_CANCELLED: 'Trabajo cancelado',
    ARTIFACT_UPLOADED: 'Archivo cargado',
    ARTIFACT_VERSION_CREATED: 'Nueva versión de archivo',
    ARTIFACT_APPROVED: 'Archivo aprobado',
    ARTIFACT_REPLACED: 'Archivo reemplazado',
    APPROVAL_REQUESTED: 'Aprobación requerida',
    APPROVAL_APPROVED: 'Aprobación concedida',
    APPROVAL_REJECTED: 'Aprobación rechazada',
    CHANGE_REQUESTED: 'Cambio solicitado',
    MATERIAL_CHANGED: 'Material actualizado',
    PRICE_CHANGED: 'Precio actualizado',
    PRODUCT_CHANGED: 'Producto actualizado',
    SCHEMA_CHANGED: 'Schema actualizado',
    WORKFLOW_CHANGED: 'Workflow actualizado',
    PERMISSION_CHANGED: 'Permisos actualizados',
    TENANT_SUSPENDED: 'Tenant suspendido',
    TENANT_REACTIVATED: 'Tenant reactivado',
    PRODUCT_CREATED: 'Producto creado',
    PRODUCT_UPDATED: 'Producto actualizado',
    PRODUCT_DEACTIVATED: 'Producto desactivado',
    MATERIAL_CREATED: 'Material creado',
    MATERIAL_UPDATED: 'Material actualizado',
    WORKFLOW_CONFIG_UPDATED: 'Workflow de taller actualizado',
    PRODUCT_PRICE_UPDATED: 'Precio de producto actualizado',
    MATERIAL_COST_UPDATED: 'Costo de material actualizado',
    COMMERCIAL_CONFIG_UPDATED: 'Configuración comercial actualizada',
    CLIENT_MESSAGE_CREATED: 'Mensaje de cliente',
    CLIENT_MESSAGE_REPLIED: 'Cliente respondió un mensaje',
    ADMIN_MESSAGE_REPLIED: 'Administración respondió un mensaje',
    MESSAGE_STATUS_CHANGED: 'Estado de mensaje actualizado',
    FULFILLMENT_UPDATED: 'Fulfillment actualizado',
    PAYMENT_CONFIRMED: 'Pago confirmado',
    PAYMENT_REJECTED: 'Pago rechazado',
    PAYMENT_CHECKOUT_CREATED: 'Checkout de pago creado',
    PAYMENT_REFUNDED: 'Pago reembolsado',
    PROJECT_NAME_CHANGED: 'Nombre de pedido modificado',
    ROSTER_APPROVED: 'Plantel aprobado',
    CONFIGURATION_CHANGED: 'Configuración de pedido actualizada',
    PRODUCTION_APPROVED: 'Producción aprobada',
    OUTPUT_GENERATED: 'Salida de producción generada',
    OUTPUT_FAILED: 'Falló la generación de salida de producción',
    OJO_EVALUATED: 'OJO interpretó el material',
  };
  return map[eventType] || eventType;
}

export function nextHintFor(eventType: string): string | undefined {
  const map: Record<string, string> = {
    ORDER_SUBMITTED: 'El taller revisará el pedido.',
    ORDER_REVIEW_STARTED: 'Sigue la edición o aprobación según el workflow.',
    ORDER_APPROVAL_REQUESTED: 'El cliente debe aprobar o solicitar cambios.',
    APPROVAL_REQUESTED: 'El cliente debe aprobar o solicitar cambios.',
    ORDER_APPROVED: 'Continúa impresión o producción.',
    APPROVAL_APPROVED: 'El workflow continúa.',
    CHANGE_REQUESTED: 'El taller debe aplicar los cambios y generar una nueva versión.',
    ORDER_PRINTING_STARTED: 'Sigue producción.',
    ORDER_PRODUCTION_STARTED: 'Al terminar, el pedido quedará listo.',
    ORDER_READY: 'Entrega o cierre del pedido.',
    STEP_BLOCKED: 'Resolver el bloqueo para continuar.',
    JOB_FAILED: 'Reintentar o corregir el trabajo.',
    ORDER_DUE_SOON: 'Priorizar para no vencer.',
    ORDER_OVERDUE: 'Atender el vencimiento.',
  };
  return map[eventType];
}

export function encodeNotificationCursor(createdAt: number, notificationId: string): string {
  return Buffer.from(`${createdAt}|${notificationId}`, 'utf8').toString('base64url');
}

export function decodeNotificationCursor(cursor: string): { createdAt: number; notificationId: string } | undefined {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, notificationId] = raw.split('|');
    const n = Number(createdAt);
    if (!notificationId || !Number.isFinite(n)) return undefined;
    return { createdAt: n, notificationId };
  } catch {
    return undefined;
  }
}
