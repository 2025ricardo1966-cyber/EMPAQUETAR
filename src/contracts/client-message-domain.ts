export const MESSAGE_CATEGORIES = [
  'CONSULTA',
  'SUGERENCIA',
  'RECLAMO',
  'SOPORTE',
  'PEDIDO',
  'PAGO_DEUDA',
  'ERROR',
  'COMERCIAL',
  'NUEVA_FUNCIONALIDAD',
  'OTRO',
] as const;

export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const MESSAGE_STATUSES = ['NEW', 'IN_REVIEW', 'RESPONDED', 'WAITING_CLIENT', 'RESOLVED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

const STATUS_ALIASES: Record<string, MessageStatus> = {
  NEW: 'NEW',
  NUEVO: 'NEW',
  IN_REVIEW: 'IN_REVIEW',
  EN_REVISION: 'IN_REVIEW',
  RESPONDED: 'RESPONDED',
  RESPONDIDO: 'RESPONDED',
  WAITING_CLIENT: 'WAITING_CLIENT',
  ESPERANDO_CLIENTE: 'WAITING_CLIENT',
  RESOLVED: 'RESOLVED',
  RESUELTO: 'RESOLVED',
};

export function normalizeMessageStatus(raw: string): MessageStatus | undefined {
  const key = String(raw || '').trim().toUpperCase();
  return STATUS_ALIASES[key];
}

export const SUGGESTION_EVAL_STATUSES = ['PENDING', 'REVIEWED', 'BACKLOG', 'DECLINED'] as const;
export type SuggestionEvalStatus = (typeof SUGGESTION_EVAL_STATUSES)[number];

export interface MessageEvaluation {
  status: SuggestionEvalStatus;
  note?: string;
  at?: number;
  by?: string;
}

export const MESSAGE_CONTEXT_KINDS = ['ORDER', 'PAYMENT', 'REQUEST', 'COMMERCIAL'] as const;
export type MessageContextKind = (typeof MESSAGE_CONTEXT_KINDS)[number];

export function isMessageContextKind(raw: string): raw is MessageContextKind {
  return (MESSAGE_CONTEXT_KINDS as readonly string[]).includes(raw);
}

export function defaultContextKind(category: MessageCategory): MessageContextKind | undefined {
  if (category === 'PEDIDO') return 'ORDER';
  if (category === 'PAGO_DEUDA') return 'PAYMENT';
  if (category === 'COMERCIAL') return 'COMMERCIAL';
  if (category === 'SUGERENCIA' || category === 'NUEVA_FUNCIONALIDAD') return 'REQUEST';
  return undefined;
}

export interface MessageContext {
  kind?: MessageContextKind | string;
  ref?: string;
}

export interface MessageEntry {
  id: string;
  messageId: string;
  authorId: string;
  authorRole: string;
  authorName?: string;
  content: string;
  createdAt: number;
}

export interface ClientMessage {
  id: string;
  tenantId: string;
  customerId: string;
  category: MessageCategory;
  status: MessageStatus;
  subject: string;
  orderId?: string | null;
  context?: MessageContext | null;
  evaluation?: MessageEvaluation | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  entries: MessageEntry[];
}

export function isMessageCategory(raw: string): raw is MessageCategory {
  return (MESSAGE_CATEGORIES as readonly string[]).includes(raw);
}

export function isMessageStatus(raw: string): raw is MessageStatus {
  return Boolean(normalizeMessageStatus(raw));
}
