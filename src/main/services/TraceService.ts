import { randomUUID } from 'crypto';
import { AccessDeniedError, hasPermission, type AuthContext, type AuditEntry, type PersistedUser, type Tenant } from '../../contracts/admin-domain';
import { DEFAULT_DEADLINE_POLICY, type PersistedOrder } from '../../contracts/order-domain';
import { computeDeadline } from '../../contracts/order-lifecycle';
import type { PlatformAuditEntry } from '../../contracts/platform-domain';
import {
  actorLabel,
  actorTypeFromRole,
  CUSTOMER_VISIBLE_EVENT_TYPES,
  decodeNotificationCursor,
  encodeNotificationCursor,
  eventTitle,
  formatTimestamp,
  nextHintFor,
  OPERATOR_HIDDEN_EVENT_TYPES,
  publicNotificationMetadata,
  sanitizeEventMetadata,
  type DomainActorType,
  type DomainEntityType,
  type DomainEvent,
  type NotificationListPage,
  type NotificationListQuery,
  type OperationalNotification,
  type OperationalNotificationType,
  type TimelineItem,
} from '../../contracts/trace-domain';
import { t } from '../../i18n';
import type { OrderService } from './OrderService';

export interface TracePersistence {
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(tenantId: string): Promise<AuditEntry[]>;
  saveNotification(row: OperationalNotification): Promise<'created' | 'exists'>;
  listNotifications(filter: {
    tenantId: string;
    recipientId?: string;
    audience?: OperationalNotification['audience'];
  }): Promise<OperationalNotification[]>;
  getNotification(notificationId: string): Promise<OperationalNotification | undefined>;
  markNotificationRead(notificationId: string, readAt: number): Promise<OperationalNotification | undefined>;
  listUsers(tenantId: string): Promise<PersistedUser[]>;
  getTenant(tenantId: string): Promise<Tenant | undefined>;
  listTenants?(): Promise<Tenant[]>;
  listSuperAdmins?(): Promise<PersistedUser[]>;
  appendPlatformAudit?(entry: PlatformAuditEntry): Promise<void>;
}

const CLOSED = new Set(['completed', 'delivered', 'cancelled']);

export class TraceService {
  private afterRecord?: (event: DomainEvent) => Promise<void>;

  constructor(
    private persist: TracePersistence,
    private orders: OrderService
  ) {}

  setAfterRecord(hook: (event: DomainEvent) => Promise<void>): void {
    this.afterRecord = hook;
  }

  async record(input: Omit<DomainEvent, 'eventId' | 'timestamp'> & { eventId?: string; timestamp?: number }): Promise<DomainEvent> {
    const event: DomainEvent = {
      eventId: input.eventId || randomUUID(),
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      timestamp: input.timestamp || Date.now(),
      metadata: sanitizeEventMetadata(input.metadata),
      correlationId: input.correlationId,
    };
    await this.persist.appendAudit({
      id: event.eventId,
      timestamp: event.timestamp,
      tenantId: event.tenantId,
      actorId: event.actorId,
      action: event.eventType,
      target: event.entityId,
      result: 'ok',
      detail: JSON.stringify(event),
    });
    if (this.afterRecord) {
      try {
        await this.afterRecord(event);
      } catch {
        /* subscribers (email) must not fail the domain event */
      }
    }
    return event;
  }

  async onOrderLifecycle(type: string, order: PersistedOrder, extra?: Record<string, unknown>): Promise<void> {
    const actor = extra?.actorType
      ? (extra.actorType as DomainActorType)
      : actorTypeFromRole(order.history[order.history.length - 1]?.actor.role, order.history[order.history.length - 1]?.actor.actorId);
    const actorId = String(extra?.actorId || order.history[order.history.length - 1]?.actor.actorId || 'system');
    const correlationId = order.orderId;
    const baseMeta = {
      orderId: order.orderId,
      displayNumber: order.displayNumber,
      status: order.status,
      workflowStepId: extra?.workflowStepId,
      workflowVersion: extra?.workflowVersion,
      artifactVersion: extra?.artifactVersion,
    };
    const map: Record<string, string[]> = {
      ORDER_CREATED: ['ORDER_CREATED'],
      ORDER_RECEIVED: ['ORDER_SUBMITTED'],
      ORDER_STATUS_CHANGED: ['ORDER_STATUS_CHANGED', ...specificOrderEvents(order.status)],
      ORDER_READY: ['ORDER_READY'],
      ORDER_COMPLETED: ['ORDER_COMPLETED'],
      ORDER_EXPIRED: ['ORDER_OVERDUE'],
    };
    const types = map[type] || [type];
    for (const eventType of [...new Set(types)]) {
      await this.record({
        tenantId: order.tenantId,
        entityType: 'order',
        entityId: order.orderId,
        eventType,
        actorType: actor,
        actorId,
        metadata: { ...baseMeta, ...extra },
        correlationId,
      });
    }
    await this.notifyOrderLifecycle(type, order);
  }

  async timeline(ctx: AuthContext, orderId: string): Promise<TimelineItem[]> {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (ctx.roleId === 'CUSTOMER' && order.customerId !== ctx.userId) throw new AccessDeniedError();
    if (ctx.roleId !== 'CUSTOMER') {
      if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
      const probe = {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        login: '',
        displayCode: '',
        roleId: ctx.roleId,
        permissions: ctx.permissions,
        status: 'active' as const,
        createdAt: 0,
        updatedAt: 0,
      };
      if (!hasPermission(probe, 'production.view') && ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    }
    const tenant = await this.persist.getTenant(ctx.tenantId);
    const zone = tenant?.identity?.timezone || tenant?.timezone || 'UTC';
    const events = (await this.persist.listAudit(ctx.tenantId))
      .map(parseDomainEvent)
      .filter((e): e is DomainEvent => !!e)
      .filter((e) => e.correlationId === orderId || e.entityId === orderId || e.metadata.orderId === orderId)
      .sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId));
    const seeSensitive = ctx.roleId === 'ADMIN_PRINCIPAL' || hasPermission({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      login: '',
      displayCode: '',
      roleId: ctx.roleId,
      permissions: ctx.permissions,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    }, 'costs.view');
    return events
      .filter((e) => {
        if (ctx.roleId === 'CUSTOMER') return CUSTOMER_VISIBLE_EVENT_TYPES.has(e.eventType);
        if (ctx.roleId === 'OPERATOR' || !seeSensitive) return !OPERATOR_HIDDEN_EVENT_TYPES.has(e.eventType);
        return true;
      })
      .map((e) => ({
        eventId: e.eventId,
        eventType: e.eventType,
        at: e.timestamp,
        displayAt: formatTimestamp(e.timestamp, zone),
        actorLabel: actorLabel(e.actorType),
        actorType: e.actorType,
        title: eventTitle(e.eventType),
        detail: customerSafeDetail(ctx.roleId, e),
        entityType: e.entityType,
        entityId: e.entityId,
        correlationId: e.correlationId,
        workflowStepId: e.metadata.workflowStepId ? String(e.metadata.workflowStepId) : undefined,
        workflowVersion: typeof e.metadata.workflowVersion === 'number' ? e.metadata.workflowVersion : undefined,
        artifactVersion: typeof e.metadata.artifactVersion === 'number' ? e.metadata.artifactVersion : Number(e.metadata.fileVersion) || undefined,
        orderStatus: e.metadata.status ? String(e.metadata.status) : undefined,
        nextHint: nextHintFor(e.eventType),
      }));
  }

  async listNotifications(ctx: AuthContext, query: NotificationListQuery = {}): Promise<NotificationListPage> {
    if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    const tenant = await this.persist.getTenant(ctx.tenantId);
    if (query.recipientId && query.recipientId !== ctx.userId && ctx.roleId !== 'ADMIN_PRINCIPAL') {
      throw new AccessDeniedError();
    }
    const recipientId =
      ctx.roleId === 'ADMIN_PRINCIPAL' && query.recipientId ? query.recipientId : ctx.roleId === 'ADMIN_PRINCIPAL' && !query.recipientId ? undefined : ctx.userId;
    const all = await this.persist.listNotifications({
      tenantId: ctx.tenantId,
      recipientId,
      audience: ctx.roleId === 'CUSTOMER' ? 'customer' : 'workshop',
    });
    const scoped = all.filter((n) => {
      if (n.audience === 'platform') return false;
      if (n.tenantId !== ctx.tenantId) return false;
      if (ctx.roleId === 'CUSTOMER' && n.recipientId !== ctx.userId) return false;
      if (ctx.roleId === 'OPERATOR' || ctx.roleId === 'ADMIN') {
        if (n.recipientId !== ctx.userId) return false;
      }
      if (ctx.roleId === 'ADMIN_PRINCIPAL' && recipientId && n.recipientId !== recipientId) return false;
      if (query.unread && n.read) return false;
      if (query.unread === false && !n.read) return false;
      if (query.type && n.type !== query.type) return false;
      if (query.entityId && n.entityId !== query.entityId) return false;
      if (query.from && n.createdAt < query.from) return false;
      if (query.to && n.createdAt > query.to) return false;
      return true;
    });
    scoped.sort((a, b) => b.createdAt - a.createdAt || b.notificationId.localeCompare(a.notificationId));
    const unreadCount = scoped.filter((n) => !n.read).length;
    const limit = Math.min(Math.max(query.limit || 30, 1), 100);
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : undefined;
    const sliced = cursor
      ? scoped.filter(
          (n) => n.createdAt < cursor.createdAt || (n.createdAt === cursor.createdAt && n.notificationId < cursor.notificationId)
        )
      : scoped;
    const items = sliced.slice(0, limit).map((n) => this.presentNotification(n, tenant));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: sliced.length > limit && last ? encodeNotificationCursor(last.createdAt, last.notificationId) : undefined,
      unreadCount,
    };
  }

  async listPlatformNotifications(ctx: AuthContext, query: NotificationListQuery = {}): Promise<NotificationListPage> {
    if (ctx.roleId !== 'SUPER_ADMIN') throw new AccessDeniedError();
    const all = await this.persist.listNotifications({
      recipientId: ctx.userId,
      audience: 'platform',
      tenantId: 'platform',
    });
    const items = all
      .filter((n) => n.audience === 'platform' && n.recipientId === ctx.userId)
      .filter((n) => (query.unread ? !n.read : true))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { items, unreadCount: items.filter((n) => !n.read).length };
  }

  async markRead(ctx: AuthContext, notificationId: string, bodyRecipientId?: string): Promise<OperationalNotification> {
    void bodyRecipientId;
    const row = await this.persist.getNotification(notificationId);
    if (!row) throw new AccessDeniedError();
    if (row.tenantId !== ctx.tenantId && row.audience !== 'platform') throw new AccessDeniedError();
    if (row.audience === 'platform' && ctx.roleId !== 'SUPER_ADMIN') throw new AccessDeniedError();
    if (row.recipientId !== ctx.userId && ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    if (ctx.roleId === 'CUSTOMER' && row.recipientId !== ctx.userId) throw new AccessDeniedError();
    const updated = (await this.persist.markNotificationRead(notificationId, Date.now())) || { ...row, read: true, readAt: Date.now() };
    await this.persist.appendAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      tenantId: row.tenantId,
      actorId: ctx.userId,
      action: 'notification.read',
      target: notificationId,
      result: 'ok',
      detail: JSON.stringify({ notificationId, type: row.type, entityId: row.entityId }),
    });
    return updated;
  }

  async evaluateDeadlines(
    ctx: AuthContext,
    now = Date.now(),
    tenantId?: string
  ): Promise<{ dueSoon: number; overdue: number; ordersEvaluated: number; tenantsEvaluated: number }> {
    if (ctx.roleId !== 'SUPER_ADMIN') throw new AccessDeniedError();
    const scoped: string[] = [];
    if (tenantId) {
      scoped.push(tenantId);
    } else if (ctx.tenantId && ctx.tenantId !== '__platform__') {
      scoped.push(ctx.tenantId);
    } else {
      const all = (await this.persist.listTenants?.()) || [];
      scoped.push(...all.filter((t) => t.status === 'ACTIVE').map((t) => t.tenantId));
    }
    let dueSoon = 0;
    let overdue = 0;
    let ordersEvaluated = 0;
    for (const id of scoped) {
      const one = await this.evaluateDeadlinesForTenant(id, now);
      dueSoon += one.dueSoon;
      overdue += one.overdue;
      ordersEvaluated += one.ordersEvaluated;
    }
    return { dueSoon, overdue, ordersEvaluated, tenantsEvaluated: scoped.length };
  }

  private async evaluateDeadlinesForTenant(
    scopedTenant: string,
    now: number
  ): Promise<{ dueSoon: number; overdue: number; ordersEvaluated: number }> {
    const tenant = await this.persist.getTenant(scopedTenant);
    const zone = tenant?.identity?.timezone || tenant?.timezone;
    const policy = {
      ...DEFAULT_DEADLINE_POLICY,
      timeZone: zone,
    };
    const listed = await this.orders.peekOrders(scopedTenant);
    const prior = (await this.persist.listAudit(scopedTenant)).map(parseDomainEvent).filter((e): e is DomainEvent => !!e);
    let dueSoon = 0;
    let overdue = 0;
    let ordersEvaluated = 0;
    for (const order of listed) {
      if (CLOSED.has(order.status)) continue;
      ordersEvaluated += 1;
      const info = computeDeadline(order.dueAt, now, policy);
      if (info.kind === 'expired') {
        overdue += 1;
        const already = prior.some(
          (e) => e.eventType === 'ORDER_OVERDUE' && e.entityId === order.orderId && e.metadata.dueAt === order.dueAt
        );
        if (!already) {
          await this.record({
            tenantId: order.tenantId,
            entityType: 'order',
            entityId: order.orderId,
            eventType: 'ORDER_OVERDUE',
            actorType: 'SYSTEM',
            actorId: 'system',
            metadata: { orderId: order.orderId, displayNumber: order.displayNumber, dueAt: order.dueAt, status: order.status },
            correlationId: order.orderId,
          });
        }
        await this.notifyOperational({
          tenantId: order.tenantId,
          type: 'ORDER_OVERDUE',
          title: 'Pedido vencido',
          customerMessage: 'Tu pedido está vencido.',
          workshopMessage: `El pedido ${order.displayNumber || order.orderId} está vencido.`,
          entityType: 'order',
          entityId: order.orderId,
          order,
          dedupeKey: `${order.orderId}:ORDER_OVERDUE:${order.dueAt}`,
          includeCustomer: true,
          includeWorkshop: true,
        });
      } else if (info.kind === 'approaching_deadline' || info.kind === 'deadline_today') {
        dueSoon += 1;
        const alreadySoon = prior.some(
          (e) => e.eventType === 'ORDER_DUE_SOON' && e.entityId === order.orderId && e.metadata.dueAt === order.dueAt
        );
        if (!alreadySoon) {
          await this.record({
            tenantId: order.tenantId,
            entityType: 'order',
            entityId: order.orderId,
            eventType: 'ORDER_DUE_SOON',
            actorType: 'SYSTEM',
            actorId: 'system',
            metadata: { orderId: order.orderId, displayNumber: order.displayNumber, dueAt: order.dueAt, status: order.status },
            correlationId: order.orderId,
          });
        }
        await this.notifyOperational({
          tenantId: order.tenantId,
          type: 'ORDER_DUE_SOON',
          title: 'Pedido próximo a vencer',
          customerMessage: 'Tu pedido está próximo a vencer.',
          workshopMessage: `El pedido ${order.displayNumber || order.orderId} está próximo a vencer.`,
          entityType: 'order',
          entityId: order.orderId,
          order,
          dedupeKey: `${order.orderId}:ORDER_DUE_SOON:${order.dueAt}`,
          includeCustomer: true,
          includeWorkshop: true,
        });
      }
    }
    return { dueSoon, overdue, ordersEvaluated };
  }

  async notifyOperational(input: {
    tenantId: string;
    type: OperationalNotificationType;
    title: string;
    customerMessage?: string;
    workshopMessage?: string;
    platformMessage?: string;
    entityType: string;
    entityId: string;
    order?: PersistedOrder;
    dedupeKey: string;
    includeCustomer?: boolean;
    includeWorkshop?: boolean;
    includeOperators?: boolean;
    workshopOnlyAdmins?: boolean;
    comment?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
    customerId?: string;
  }): Promise<void> {
    const tenant = await this.persist.getTenant(input.tenantId);
    if (tenant?.status === 'SUSPENDED' && input.type !== 'TENANT_SUSPENDED') return;
    const displayNumber = input.order?.displayNumber || input.entityId;
    const route = `/orders/${displayNumber.replace(/^#/, '')}`;
    const meta = publicNotificationMetadata({
      orderId: input.order?.orderId || input.entityId,
      displayNumber,
      route,
      comment: input.comment,
      channel: 'IN_APP',
      ...input.metadata,
    });
    const customerRecipient = input.order?.customerId || input.customerId;
    if (input.includeCustomer && customerRecipient && input.customerMessage) {
      await this.insertNotification({
        tenantId: input.tenantId,
        recipientId: customerRecipient,
        type: input.type,
        title: input.title,
        message: input.customerMessage,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: meta,
        dedupeKey: `${input.dedupeKey}:customer:${customerRecipient}`,
        audience: 'customer',
        actorId: input.actorId,
      });
    }
    if (input.includeWorkshop && input.workshopMessage) {
      const users = await this.persist.listUsers(input.tenantId);
      for (const user of users) {
        if (user.status !== 'active') continue;
        if (user.roleId === 'CUSTOMER' || user.roleId === 'SUPER_ADMIN') continue;
        const probe = user;
        const canOps = user.roleId === 'ADMIN_PRINCIPAL' || hasPermission(probe, 'production.view');
        if (!canOps) continue;
        if (input.workshopOnlyAdmins && user.roleId === 'OPERATOR') continue;
        if (user.roleId === 'OPERATOR' && input.type === 'ORDER_RECEIVED' && !input.includeOperators) continue;
        if (user.roleId === 'OPERATOR' && (input.type === 'ORDER_DUE_SOON' || input.type === 'ORDER_OVERDUE' || input.type === 'JOB_FAILED' || input.type === 'WORKFLOW_BLOCKED' || input.type === 'CHANGE_REQUESTED' || input.type === 'ORDER_PRODUCTION_STARTED')) {
          /* operators receive function-relevant alerts */
        } else if (user.roleId === 'OPERATOR' && input.type === 'ORDER_RECEIVED') {
          continue;
        }
        await this.insertNotification({
          tenantId: input.tenantId,
          recipientId: user.userId,
          type: input.type,
          title: input.title,
          message: input.workshopMessage,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: meta,
          dedupeKey: `${input.dedupeKey}:workshop:${user.userId}`,
          audience: 'workshop',
          actorId: input.actorId,
        });
      }
    }
  }

  async notifyPlatform(input: {
    tenantId: string;
    type: OperationalNotificationType;
    title: string;
    message: string;
    entityId: string;
    dedupeKey: string;
  }): Promise<void> {
    const supers = (await this.persist.listSuperAdmins?.()) || [];
    for (const user of supers) {
      await this.insertNotification({
        tenantId: input.tenantId,
        recipientId: user.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: 'tenant',
        entityId: input.entityId,
        metadata: { route: `/platform/tenants/${input.entityId}` },
        dedupeKey: `${input.dedupeKey}:platform:${user.userId}`,
        audience: 'platform',
      });
    }
  }

  private async notifyOrderLifecycle(type: string, order: PersistedOrder): Promise<void> {
    if (type === 'ORDER_CREATED' || type === 'ORDER_RECEIVED') {
      await this.notifyOperational({
        tenantId: order.tenantId,
        type: 'ORDER_RECEIVED',
        title: 'Pedido recibido',
        customerMessage: 'Tu pedido fue recibido.',
        workshopMessage: `Entró un nuevo pedido ${order.displayNumber || order.orderId}.`,
        entityType: 'order',
        entityId: order.orderId,
        order,
        dedupeKey: `${order.orderId}:ORDER_RECEIVED`,
        includeCustomer: true,
        includeWorkshop: true,
        includeOperators: false,
      });
    }
    if (type === 'ORDER_READY') {
      const key = order.fulfillment?.mode === 'DELIVERY' ? 'notifications.order_ready_delivery' : 'notifications.order_ready_pickup';
      const msg = t(key, 'es', { orderNumber: order.displayNumber || order.orderId });
      await this.notifyOperational({
        tenantId: order.tenantId,
        type: 'ORDER_READY',
        title: t('notifications.order_ready', 'es', { orderNumber: order.displayNumber || order.orderId }),
        customerMessage: msg,
        workshopMessage: msg,
        entityType: 'order',
        entityId: order.orderId,
        order,
        dedupeKey: `${order.orderId}:ORDER_READY`,
        includeCustomer: true,
        includeWorkshop: true,
      });
    }
    if (order.status === 'production' && type === 'ORDER_STATUS_CHANGED') {
      await this.notifyOperational({
        tenantId: order.tenantId,
        type: 'ORDER_PRODUCTION_STARTED',
        title: 'En producción',
        customerMessage: 'Tu pedido entró en producción.',
        workshopMessage: `Nuevo trabajo de producción: ${order.displayNumber || order.orderId}.`,
        entityType: 'order',
        entityId: order.orderId,
        order,
        dedupeKey: `${order.orderId}:PRODUCTION_STARTED`,
        includeCustomer: true,
        includeWorkshop: true,
        includeOperators: true,
      });
    }
    if (type === 'ORDER_STATUS_CHANGED' && !['pending', 'received'].includes(order.status)) {
      await this.notifyOperational({
        tenantId: order.tenantId,
        type: 'ORDER_STATUS_CHANGED',
        title: 'Estado del pedido',
        customerMessage: 'El estado de tu pedido se actualizó.',
        entityType: 'order',
        entityId: order.orderId,
        order,
        dedupeKey: `${order.orderId}:STATUS:${order.status}`,
        includeCustomer: true,
      });
    }
  }

  private async insertNotification(row: Omit<OperationalNotification, 'notificationId' | 'read' | 'createdAt'> & { actorId?: string }): Promise<void> {
    const notification: OperationalNotification = {
      notificationId: randomUUID(),
      tenantId: row.tenantId,
      recipientId: row.recipientId,
      type: row.type,
      title: row.title,
      message: row.message,
      entityType: row.entityType,
      entityId: row.entityId,
      read: false,
      createdAt: Date.now(),
      metadata: row.metadata || {},
      dedupeKey: row.dedupeKey,
      audience: row.audience,
    };
    const result = await this.persist.saveNotification(notification);
    if (result !== 'created') return;
    await this.persist.appendAudit({
      id: randomUUID(),
      timestamp: notification.createdAt,
      tenantId: notification.tenantId,
      actorId: row.actorId || 'system',
      action: 'notification.created',
      target: notification.notificationId,
      result: 'ok',
      detail: JSON.stringify({
        notificationId: notification.notificationId,
        type: notification.type,
        entityId: notification.entityId,
        recipientId: notification.recipientId,
      }),
    });
  }

  private presentNotification(n: OperationalNotification, tenant?: Tenant): OperationalNotification {
    const zone = tenant?.identity?.timezone || tenant?.timezone || 'UTC';
    return {
      ...n,
      metadata: {
        ...publicNotificationMetadata(n.metadata),
        displayAt: formatTimestamp(n.createdAt, zone),
      },
    };
  }
}

function specificOrderEvents(status: string): string[] {
  if (status === 'reviewing') return ['ORDER_REVIEW_STARTED'];
  if (status === 'editing') return ['ORDER_EDITING_STARTED'];
  if (status === 'approved') return ['ORDER_APPROVED'];
  if (status === 'printing' || status === 'printing_in_progress') return ['ORDER_PRINTING_STARTED'];
  if (status === 'production') return ['ORDER_PRODUCTION_STARTED'];
  if (status === 'ready') return ['ORDER_READY'];
  if (status === 'completed' || status === 'delivered') return ['ORDER_COMPLETED'];
  if (status === 'cancelled') return ['ORDER_CANCELLED'];
  if (status === 'expired') return ['ORDER_OVERDUE'];
  return [];
}

export function parseDomainEvent(entry: AuditEntry): DomainEvent | undefined {
  try {
    const parsed = JSON.parse(entry.detail || '{}') as Partial<DomainEvent>;
    if (parsed.eventType && parsed.eventId) return parsed as DomainEvent;
  } catch {
    /* legacy audit row */
  }
  if (!entry.action) return undefined;
  return {
    eventId: entry.id,
    tenantId: entry.tenantId,
    entityType: 'order',
    entityId: entry.target,
    eventType: entry.action,
    actorType: actorTypeFromRole(undefined, entry.actorId),
    actorId: entry.actorId,
    timestamp: entry.timestamp,
    metadata: {},
    correlationId: entry.target,
  };
}

function customerSafeDetail(roleId: string, event: DomainEvent): string | undefined {
  if (roleId === 'CUSTOMER') {
    if (event.eventType === 'JOB_FAILED' || event.eventType === 'STEP_FAILED') return undefined;
    if (event.metadata.comment) return String(event.metadata.comment);
    return undefined;
  }
  if (event.metadata.comment) return String(event.metadata.comment);
  if (event.eventType === 'JOB_FAILED' && event.metadata.error && roleId !== 'CUSTOMER') return String(event.metadata.error);
  return undefined;
}

export const WORKFLOW_ACTION_TO_EVENT: Record<string, string> = {
  'step.started': 'STEP_STARTED',
  'step.completed': 'STEP_COMPLETED',
  'step.blocked': 'STEP_BLOCKED',
  'step.failed': 'STEP_FAILED',
  'step.skipped': 'STEP_SKIPPED',
  'workflow.published': 'WORKFLOW_CHANGED',
  'workflow.created': 'WORKFLOW_CHANGED',
  'workflow.versioned': 'WORKFLOW_CHANGED',
  'job.created': 'JOB_CREATED',
  'job.failed': 'JOB_FAILED',
  retry: 'JOB_RETRIED',
};
