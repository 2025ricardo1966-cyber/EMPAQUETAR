import { randomUUID } from 'crypto';
import { AccessDeniedError } from '../../contracts/admin-domain';
import type { AuthContext } from '../../contracts/admin-domain';
import {
  defaultContextKind,
  isMessageCategory,
  isMessageContextKind,
  normalizeMessageStatus,
  SUGGESTION_EVAL_STATUSES,
  type ClientMessage,
  type MessageCategory,
  type MessageStatus,
  type SuggestionEvalStatus,
} from '../../contracts/client-message-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import { t } from '../../i18n';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { EmailService } from './email/EmailService';
import { TEMPLATES } from './email/templates';
import type { TraceService } from './TraceService';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function roleLabel(role: string): string {
  if (role === 'CUSTOMER') return 'CLIENTE';
  return role;
}

export class ClientMessageService {
  constructor(
    private store: ControlPlaneStore,
    private tracer: TraceService,
    private email?: EmailService
  ) {}

  async create(ctx: AuthContext, body: Record<string, unknown>) {
    const profile = await this.requireCustomer(ctx);
    const subject = String(body.subject || '').trim();
    const content = String(body.content || '').trim();
    if (!subject) throw new RequestInvalidError('SUBJECT_REQUIRED');
    if (!content) throw new RequestInvalidError('CONTENT_REQUIRED');
    const category = String(body.category || 'CONSULTA').toUpperCase();
    if (!isMessageCategory(category)) throw new RequestInvalidError('INVALID_CATEGORY');
    const now = Date.now();
    const id = randomUUID();
    const entryId = randomUUID();
    const { context, orderId } = await this.resolveContext(ctx, profile.customerId, category, body);
    const message: ClientMessage = {
      id,
      tenantId: ctx.tenantId,
      customerId: profile.customerId,
      category,
      status: 'NEW',
      subject,
      orderId,
      context,
      evaluation: category === 'SUGERENCIA' || category === 'NUEVA_FUNCIONALIDAD' ? { status: 'PENDING' } : null,
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          id: entryId,
          messageId: id,
          authorId: ctx.userId,
          authorRole: 'CUSTOMER',
          authorName: profile.name,
          content,
          createdAt: now,
        },
      ],
    };
    await this.store.saveClientMessage(message);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: id,
      eventType: 'CLIENT_MESSAGE_CREATED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { subject, category, customerId: profile.customerId, contextKind: context?.kind, channel: 'IN_APP' },
      correlationId: id,
    });
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'CLIENT_MESSAGE_CREATED',
      title: t('notifications.new_client_message', 'es', { customerName: profile.name, subject }),
      workshopMessage: t('notifications.new_client_message', 'es', { customerName: profile.name, subject }),
      entityType: 'config',
      entityId: id,
      dedupeKey: `${id}:CLIENT_MESSAGE_CREATED`,
      includeWorkshop: true,
      workshopOnlyAdmins: true,
    });
    return this.threadDto(message, ctx.lang || 'es');
  }

  async listMine(ctx: AuthContext) {
    const profile = await this.requireCustomer(ctx);
    const rows = await this.store.listClientMessages(ctx.tenantId, { customerId: profile.customerId });
    return rows.map((m) => this.listDto(m, ctx.lang || profile.preferredLanguage || 'es'));
  }

  async getMine(ctx: AuthContext, id: string) {
    const profile = await this.requireCustomer(ctx);
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (row.customerId !== profile.customerId) throw new AccessDeniedError();
    return this.threadDto(row, ctx.lang || 'es');
  }

  async replyMine(ctx: AuthContext, id: string, content: string) {
    const profile = await this.requireCustomer(ctx);
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId || row.customerId !== profile.customerId) throw new AccessDeniedError();
    if (row.status === 'RESOLVED') throw new RequestInvalidError('MESSAGE_RESOLVED');
    const text = content.trim();
    if (!text) throw new RequestInvalidError('CONTENT_REQUIRED');
    const now = Date.now();
    row.entries.push({
      id: randomUUID(),
      messageId: row.id,
      authorId: ctx.userId,
      authorRole: 'CUSTOMER',
      authorName: profile.name,
      content: text,
      createdAt: now,
    });
    row.status = 'NEW';
    row.updatedAt = now;
    await this.store.saveClientMessage(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: row.id,
      eventType: 'CLIENT_MESSAGE_REPLIED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { subject: row.subject },
      correlationId: row.id,
    });
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'CLIENT_MESSAGE_REPLIED',
      title: t('notifications.new_client_message', 'es', { customerName: profile.name, subject: row.subject }),
      workshopMessage: t('notifications.new_client_message', 'es', { customerName: profile.name, subject: row.subject }),
      entityType: 'config',
      entityId: row.id,
      dedupeKey: `${row.id}:CLIENT_MESSAGE_REPLIED:${now}`,
      includeWorkshop: true,
      workshopOnlyAdmins: true,
    });
    return this.threadDto(row, ctx.lang || 'es');
  }

  async listAdmin(
    ctx: AuthContext,
    query: { status?: string; category?: string; customerId?: string; q?: string; evaluationStatus?: string }
  ) {
    this.assertStaff(ctx);
    const status = query.status ? normalizeMessageStatus(query.status) : undefined;
    const lang = ctx.lang || 'es';
    const rows = await this.store.listClientMessages(ctx.tenantId, { ...query, status });
    const out = [];
    for (const m of rows) {
      const customer = await this.store.getCustomer(m.customerId);
      out.push({
        ...this.listDto(m, lang),
        ...this.customerPublic(customer),
      });
    }
    return out;
  }

  async getAdmin(ctx: AuthContext, id: string) {
    this.assertStaff(ctx);
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const customer = await this.store.getCustomer(row.customerId);
    return { ...this.threadDto(row, ctx.lang || 'es'), ...this.customerPublic(customer) };
  }

  async classify(ctx: AuthContext, id: string, categoryRaw: string) {
    this.assertStaff(ctx);
    const category = String(categoryRaw || '').toUpperCase();
    if (!isMessageCategory(category)) throw new RequestInvalidError('INVALID_CATEGORY');
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    row.category = category as MessageCategory;
    if ((category === 'SUGERENCIA' || category === 'NUEVA_FUNCIONALIDAD') && !row.evaluation) {
      row.evaluation = { status: 'PENDING' };
    }
    row.updatedAt = Date.now();
    await this.store.saveClientMessage(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: row.id,
      eventType: 'MESSAGE_STATUS_CHANGED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { category, channel: 'IN_APP' },
      correlationId: row.id,
    });
    const customer = await this.store.getCustomer(row.customerId);
    return { ...this.threadDto(row, ctx.lang || 'es'), ...this.customerPublic(customer) };
  }

  async replyAdmin(ctx: AuthContext, id: string, content: string) {
    this.assertStaff(ctx);
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const text = content.trim();
    if (!text) throw new RequestInvalidError('CONTENT_REQUIRED');
    const now = Date.now();
    const user = await this.store.getUser(ctx.userId);
    row.entries.push({
      id: randomUUID(),
      messageId: row.id,
      authorId: ctx.userId,
      authorRole: ctx.roleId,
      authorName: user?.name || user?.login || 'Admin',
      content: text,
      createdAt: now,
    });
    row.status = 'RESPONDED';
    row.updatedAt = now;
    await this.store.saveClientMessage(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: row.id,
      eventType: 'ADMIN_MESSAGE_REPLIED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { subject: row.subject },
      correlationId: row.id,
    });
    const customer = await this.store.getCustomer(row.customerId);
    const lang = customer?.preferredLanguage || 'es';
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'ADMIN_MESSAGE_REPLIED',
      title: t('notifications.admin_replied', lang, { subject: row.subject }),
      customerMessage: t('notifications.admin_replied', lang, { subject: row.subject }),
      entityType: 'config',
      entityId: row.id,
      dedupeKey: `${row.id}:ADMIN_MESSAGE_REPLIED:${now}`,
      includeCustomer: true,
      customerId: row.customerId,
      metadata: { messageId: row.id, channel: 'IN_APP', status: 'RESPONDED' },
    });
    const email = customer?.email || customer?.login;
    if (email && this.email) {
      await this.email.send({
        to: email,
        subject: t('emails.subject.message_replied', lang, { subject: row.subject }),
        html: TEMPLATES.messageReplied({
          subject: row.subject,
          body: t('emails.body.message_replied_body', lang, { subject: row.subject }),
          content: text,
        }),
        tenantId: ctx.tenantId,
        eventType: 'ADMIN_MESSAGE_REPLIED',
        recipientId: customer?.customerId,
      });
    }
    return this.threadDto(row, 'es');
  }

  async setStatus(ctx: AuthContext, id: string, statusRaw: string) {
    this.assertStaff(ctx);
    const status = normalizeMessageStatus(statusRaw);
    if (!status || status === 'NEW') throw new RequestInvalidError('INVALID_STATUS');
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    row.status = status as MessageStatus;
    row.updatedAt = Date.now();
    if (status === 'RESOLVED') {
      row.resolvedAt = row.updatedAt;
      row.resolvedBy = ctx.userId;
    }
    await this.store.saveClientMessage(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: row.id,
      eventType: 'MESSAGE_STATUS_CHANGED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { status, channel: 'IN_APP' },
      correlationId: row.id,
    });
    const customer = await this.store.getCustomer(row.customerId);
    const lang = customer?.preferredLanguage || ctx.lang || 'es';
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'MESSAGE_STATUS_CHANGED',
      title: t('notifications.message_status', lang, {
        subject: row.subject,
        status: t(`messages.status.${status}`, lang),
      }),
      customerMessage: t('notifications.message_status', lang, {
        subject: row.subject,
        status: t(`messages.status.${status}`, lang),
      }),
      entityType: 'config',
      entityId: row.id,
      dedupeKey: `${row.id}:MESSAGE_STATUS_CHANGED:${status}:${row.updatedAt}`,
      includeCustomer: true,
      customerId: row.customerId,
      metadata: { messageId: row.id, status, channel: 'IN_APP' },
    });
    return { ...this.threadDto(row, ctx.lang || 'es'), ...this.customerPublic(customer) };
  }

  async evaluate(ctx: AuthContext, id: string, body: Record<string, unknown>) {
    this.assertStaff(ctx);
    const row = await this.store.getClientMessage(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (row.category !== 'SUGERENCIA' && row.category !== 'NUEVA_FUNCIONALIDAD') {
      throw new RequestInvalidError('NOT_A_SUGGESTION');
    }
    const status = String(body.status || '').toUpperCase() as SuggestionEvalStatus;
    if (!(SUGGESTION_EVAL_STATUSES as readonly string[]).includes(status)) {
      throw new RequestInvalidError('INVALID_EVALUATION');
    }
    row.evaluation = {
      status,
      note: body.note != null ? String(body.note).trim() : row.evaluation?.note,
      at: Date.now(),
      by: ctx.userId,
    };
    row.updatedAt = Date.now();
    await this.store.saveClientMessage(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: row.id,
      eventType: 'MESSAGE_STATUS_CHANGED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { evaluation: status, autoImplemented: false },
      correlationId: row.id,
    });
    return this.threadDto(row, ctx.lang || 'es');
  }

  async stats(ctx: AuthContext) {
    this.assertStaff(ctx);
    const rows = await this.store.listClientMessages(ctx.tenantId);
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    }
    return { total: rows.length, byStatus, byCategory };
  }

  private assertStaff(ctx: AuthContext): void {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'OPERATOR' || ctx.roleId === 'SUPER_ADMIN') {
      throw new AccessDeniedError();
    }
  }

  private customerPublic(customer: Awaited<ReturnType<ControlPlaneStore['getCustomer']>>) {
    return {
      customerName: customer?.name || '',
      customerLogin: customer?.login || '',
      customerCountry: customer?.country || null,
      customerRegion: customer?.region || null,
      customerCity: customer?.city || null,
      customerPhone: customer?.phone || null,
      customerLanguage: customer?.preferredLanguage || null,
    };
  }

  private async resolveContext(
    ctx: AuthContext,
    customerId: string,
    category: string,
    body: Record<string, unknown>
  ) {
    const raw = body.context && typeof body.context === 'object' ? (body.context as Record<string, unknown>) : {};
    let kind = String(raw.kind || body.contextKind || '').trim().toUpperCase();
    let ref = String(raw.ref || body.contextRef || body.orderId || '').trim();
    if (!kind) kind = defaultContextKind(category as MessageCategory) || '';
    if (kind && !isMessageContextKind(kind)) throw new RequestInvalidError('INVALID_CONTEXT');
    const orderId = body.orderId ? String(body.orderId) : kind === 'ORDER' && ref ? ref : null;
    if (kind === 'ORDER' && orderId) {
      const order = await this.store.get(orderId);
      if (!order || order.tenantId !== ctx.tenantId || order.customerId !== customerId) {
        throw new AccessDeniedError();
      }
      ref = orderId;
    }
    if (kind === 'PAYMENT' || category === 'PAGO_DEUDA') {
      const mem = await this.store.getMembershipByCustomer(customerId);
      if (!mem || mem.tenantId !== ctx.tenantId) {
        throw new RequestInvalidError('MEMBERSHIP_REQUIRED');
      }
      if (ref && ref !== mem.id) throw new AccessDeniedError();
      ref = mem.id;
      kind = 'PAYMENT';
    } else if (kind === 'COMMERCIAL' || category === 'COMERCIAL') {
      const mem = await this.store.getMembershipByCustomer(customerId);
      if (mem && mem.tenantId === ctx.tenantId) {
        if (ref && ref !== mem.id) throw new AccessDeniedError();
        ref = mem.id;
        kind = kind || 'COMMERCIAL';
      }
    }
    const context = kind || ref ? { kind: kind || undefined, ref: ref || undefined } : null;
    return { context, orderId };
  }

  private async requireCustomer(ctx: AuthContext) {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    const profile = await this.store.getCustomer(ctx.userId);
    if (!profile || profile.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return profile;
  }

  private listDto(m: ClientMessage, lang: string) {
    const last = m.entries[m.entries.length - 1];
    const lastCustomerAt = [...m.entries].reverse().find((e) => e.authorRole === 'CUSTOMER')?.createdAt || 0;
    const unreadReplies = m.entries.filter((e) => e.authorRole !== 'CUSTOMER' && e.createdAt > lastCustomerAt).length;
    return {
      id: m.id,
      subject: m.subject,
      category: m.category,
      categoryLabel: t(`messages.categories.${m.category}`, lang),
      status: m.status,
      statusLabel: t(`messages.status.${m.status}`, lang),
      orderId: m.orderId || null,
      customerId: m.customerId,
      context: m.context || null,
      evaluation: m.evaluation || null,
      createdAt: iso(m.createdAt),
      updatedAt: iso(m.updatedAt),
      lastEntry: last
        ? { content: last.content, authorRole: roleLabel(last.authorRole), createdAt: iso(last.createdAt) }
        : null,
      unreadReplies,
    };
  }

  private threadDto(m: ClientMessage, lang: string) {
    return {
      id: m.id,
      subject: m.subject,
      category: m.category,
      categoryLabel: t(`messages.categories.${m.category}`, lang),
      status: m.status,
      statusLabel: t(`messages.status.${m.status}`, lang),
      orderId: m.orderId || null,
      customerId: m.customerId,
      context: m.context || null,
      evaluation: m.evaluation || null,
      createdAt: iso(m.createdAt),
      updatedAt: iso(m.updatedAt),
      resolvedAt: m.resolvedAt ? iso(m.resolvedAt) : null,
      resolvedBy: m.resolvedBy || null,
      entries: m.entries.map((e) => ({
        id: e.id,
        content: e.content,
        authorRole: roleLabel(e.authorRole),
        authorName: e.authorName || '',
        createdAt: iso(e.createdAt),
      })),
    };
  }
}
