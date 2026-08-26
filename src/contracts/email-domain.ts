export type EmailStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  tenantId: string;
  eventType: string;
  orderId?: string;
  recipientId?: string;
  from?: string;
}

export interface EmailLogRecord {
  id: string;
  tenantId: string;
  recipientId?: string | null;
  recipientEmail: string;
  eventType: string;
  orderId?: string | null;
  status: EmailStatus;
  resendId?: string | null;
  attempts: number;
  lastAttempt?: number | null;
  sentAt?: number | null;
  error?: string | null;
  createdAt: number;
  subject?: string;
  html?: string;
  fromAddress?: string;
}

export interface EmailTransportResult {
  id: string;
}

export interface EmailTransport {
  send(input: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<EmailTransportResult>;
}

export const DEFAULT_RETRY_DELAYS_MS = [60_000, 300_000, 900_000];
export const MAX_EMAIL_ATTEMPTS = 3;

export const CLIENT_EMAIL_FORBIDDEN = ['internalCost', 'costBreakdown', 'supplierPrice', 'internalUnitCost'];
