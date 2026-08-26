import { randomUUID } from 'crypto';
import type { ControlPlaneStore } from '../../../cloud/store/ControlPlaneStore';
import {
  DEFAULT_RETRY_DELAYS_MS,
  MAX_EMAIL_ATTEMPTS,
  type EmailLogRecord,
  type EmailPayload,
  type EmailTransport,
} from '../../../contracts/email-domain';

export class EmailService {
  retryDelaysMs = [...DEFAULT_RETRY_DELAYS_MS];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private transport: EmailTransport | null;

  constructor(
    private store: ControlPlaneStore,
    transport: EmailTransport | null,
    private defaultFrom: string
  ) {
    this.transport = transport;
  }

  setTransport(transport: EmailTransport | null): void {
    this.transport = transport;
  }

  getTransport(): EmailTransport | null {
    return this.transport;
  }

  /** Best-effort: never throws. */
  async send(payload: EmailPayload): Promise<void> {
    try {
      const to = (Array.isArray(payload.to) ? payload.to : [payload.to]).map((s) => s.trim()).filter(Boolean);
      if (!to.length) return;
      const log: EmailLogRecord = {
        id: randomUUID(),
        tenantId: payload.tenantId,
        recipientId: payload.recipientId || null,
        recipientEmail: to.join(','),
        eventType: payload.eventType,
        orderId: payload.orderId || null,
        status: 'PENDING',
        attempts: 0,
        createdAt: Date.now(),
        subject: payload.subject,
        html: payload.html,
        fromAddress: payload.from || this.defaultFrom,
      };
      await this.store.saveEmailLog(log);
      await this.runAttempts(log, payload, to);
    } catch {
      /* never propagate */
    }
  }

  async processDue(now = Date.now()): Promise<void> {
    const pending = await this.store.listEmailLogsByStatus('PENDING');
    for (const log of pending) {
      if (log.attempts >= MAX_EMAIL_ATTEMPTS) {
        log.status = 'FAILED';
        await this.store.saveEmailLog(log);
        continue;
      }
      const delay = this.retryDelaysMs[Math.max(0, log.attempts - 1)] ?? this.retryDelaysMs[this.retryDelaysMs.length - 1];
      if (log.lastAttempt && now - log.lastAttempt < delay) continue;
      const to = String(log.recipientEmail || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await this.attempt(log, to, log.fromAddress || this.defaultFrom, undefined);
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private async runAttempts(log: EmailLogRecord, payload: EmailPayload, to: string[]): Promise<void> {
    const from = payload.from || this.defaultFrom;
    await this.attempt(log, to, from, payload.replyTo);
    while (log.status === 'PENDING' && log.attempts < MAX_EMAIL_ATTEMPTS) {
      const delay = this.retryDelaysMs[log.attempts - 1] ?? 0;
      if (delay > 0) {
        this.schedule(log.id, delay);
        return;
      }
      await this.attempt(log, to, from, payload.replyTo);
    }
  }

  private schedule(logId: string, delay: number): void {
    const t = setTimeout(() => {
      void this.processDue();
    }, delay);
    this.timers.push(t);
    void logId;
  }

  private async attempt(log: EmailLogRecord, to: string[], from: string, replyTo?: string): Promise<void> {
    if (log.attempts >= MAX_EMAIL_ATTEMPTS) {
      log.status = 'FAILED';
      await this.store.saveEmailLog(log);
      return;
    }
    log.attempts += 1;
    log.lastAttempt = Date.now();
    if (!this.transport) {
      log.status = 'FAILED';
      log.error = 'EMAIL_DISABLED';
      await this.store.saveEmailLog(log);
      return;
    }
    try {
      const result = await this.transport.send({
        from,
        to,
        subject: log.subject || '',
        html: log.html || '',
        replyTo,
      });
      log.status = 'SENT';
      log.resendId = result.id;
      log.sentAt = Date.now();
      log.error = null;
    } catch (error) {
      log.error = error instanceof Error ? error.message : String(error);
      log.status = log.attempts >= MAX_EMAIL_ATTEMPTS ? 'FAILED' : 'PENDING';
    }
    await this.store.saveEmailLog(log);
  }
}
