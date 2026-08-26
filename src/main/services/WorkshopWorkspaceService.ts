import { randomBytes, randomUUID } from 'crypto';
import type { AuthContext } from '../../contracts/admin-domain';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import { computeDeadline, operationalOrderStatus } from '../../contracts/order-lifecycle';
import { DEFAULT_DEADLINE_POLICY, type OrderStatus, type PersistedOrder } from '../../contracts/order-domain';
import { t } from '../../i18n';
import { resolveConfiguredCurrency } from '../../contracts/international-domain';
import { fulfillmentView } from './FulfillmentService';
import type { DeadlineClass } from '../../contracts/production-center';
import type {
  ConversionStatus,
  InternalCommentRecord,
  OrderAssignmentRecord,
  OrderFileRecord,
} from '../../contracts/customer-experience';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { OrderService } from './OrderService';
import type { ProductionCenterService } from './ProductionCenterService';
import type { TraceService } from './TraceService';
import type { ClientPortalService } from './ClientPortalService';
import { MembershipService } from './MembershipService';
import { toOperationalStatus } from '../../contracts/operational-order';
import type { MembershipStatus } from '../../contracts/membership-domain';
import { convertCdrToPdf, extractColorProfile, isCorelDraw } from './CdrConversion';
import { agreedOrderAmount, nextPaymentRemaining, paymentFullySettled } from '../../contracts/commercial-terms';

const STATUS_ALIAS: Record<string, OrderStatus> = {
  RECEIVED: 'received',
  REVIEWING: 'reviewing',
  EDITING: 'editing',
  WAITING_APPROVAL: 'approved',
  APPROVED: 'approved',
  PRINTING: 'printing',
  PRODUCTION: 'production',
  READY: 'ready',
  COMPLETED: 'completed',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  received: 'received',
  reviewing: 'reviewing',
  editing: 'editing',
  approved: 'approved',
  preparing: 'preparing',
  printing: 'printing',
  printing_in_progress: 'printing_in_progress',
  production: 'production',
  ready: 'ready',
  completed: 'completed',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

export class WorkshopWorkspaceService {
  constructor(
    private store: ControlPlaneStore,
    private orders: OrderService,
    private center: ProductionCenterService,
    private tracer: TraceService,
    private clientPortal: ClientPortalService
  ) {}

  async list(ctx: AuthContext, query: Record<string, string | undefined>) {
    this.assertStaff(ctx, 'orders.view');
    const seeCosts = this.canSeeCosts(ctx);
    const now = Date.now();
    const listed = await this.orders.peekOrders(ctx.tenantId);
    const statusFilter = query.status ? STATUS_ALIAS[query.status] || (query.status.toLowerCase() as OrderStatus) : undefined;
    const deadlineFilter = (query.deadline || '').toUpperCase() as DeadlineClass | '';
    const search = (query.search || query.q || '').trim().toLowerCase();
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const sortBy = query.sortBy || 'createdAt';
    const sortDir = (query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const rows = [];
    for (const order of listed) {
      if (order.tenantId !== ctx.tenantId) continue;
      const operational = operationalOrderStatus(order);
      if (statusFilter && operational !== statusFilter && order.status !== statusFilter) continue;
      const deadlineStatus = this.deadlineStatus(order.dueAt, now);
      if (deadlineFilter === 'OVERDUE' && deadlineStatus !== 'OVERDUE') continue;
      if (deadlineFilter === 'DUE_SOON' && deadlineStatus !== 'DUE_SOON') continue;
      if (deadlineFilter === 'ON_TIME' && deadlineStatus !== 'ON_TIME') continue;
      if (query.assignedTo && order.assignedTo !== query.assignedTo) continue;
      if (query.customerId && order.customerId !== query.customerId) continue;
      const customer = await this.store.getCustomer(order.customerId);
      if (search) {
        const blob = `${order.orderId} ${order.displayNumber} ${order.customerName} ${customer?.name || ''}`.toLowerCase();
        if (!blob.includes(search)) continue;
      }
      rows.push({ order, customer, deadlineStatus, operational });
    }
    rows.sort((a, b) => {
      const av =
        sortBy === 'dueDate' || sortBy === 'dueAt'
          ? a.order.dueAt
          : sortBy === 'updatedAt'
            ? a.order.updatedAt
            : a.order.createdAt;
      const bv =
        sortBy === 'dueDate' || sortBy === 'dueAt'
          ? b.order.dueAt
          : sortBy === 'updatedAt'
            ? b.order.updatedAt
            : b.order.createdAt;
      return (av - bv) * sortDir;
    });
    const total = rows.length;
    const slice = rows.slice((page - 1) * limit, page * limit);
    const items = [];
    for (const row of slice) {
      items.push(await this.toListItem(row.order, row.customer?.name, row.deadlineStatus, seeCosts, row.operational));
    }
    return { items, total, page, limit };
  }

  async detail(ctx: AuthContext, orderId: string) {
    this.assertStaff(ctx, 'orders.view');
    const order = await this.requireOrder(ctx, orderId);
    const seeCosts = this.canSeeCosts(ctx);
    const seePaymentAmounts = this.canSeeCosts(ctx);
    const customer = await this.store.getCustomer(order.customerId);
    const files = await this.presentFiles(ctx, order);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    const assignment = await this.presentAssignment(ctx, order);
    const comments = await this.listComments(ctx, orderId);
    const deadlineStatus = this.deadlineStatus(order.dueAt);
    const productId = String(order.formValues?.productId || '');
    const config = await this.store.getConfig(ctx.tenantId);
    const product = (config?.products || []).find((p) => p.productId === productId);
    const consumption = order.consumptions?.[0];
    const pricing: Record<string, unknown> = {
      totalPrice: order.totalCustomerAmount,
      currency: resolveConfiguredCurrency({
        currency: order.economicSnapshot?.currency || config?.currency,
      }),
    };
    if (seeCosts) pricing.internalCost = order.totalInternalCost;
    const paymentView = payment
      ? seePaymentAmounts
        ? {
            status: payment.status,
            requiredPct: payment.requiredPct,
            amountDue: payment.amountDue,
            amountPaid: payment.amountPaid,
            remaining: nextPaymentRemaining({
              amountDue: Number(payment.amountDue || 0),
              amountPaid: Number(payment.amountPaid || 0),
              agreed: agreedOrderAmount(order),
            }),
            remainingBalance: Math.max(0, Math.round((agreedOrderAmount(order) - Number(payment.amountPaid || 0)) * 100) / 100),
            settled: paymentFullySettled(agreedOrderAmount(order), Number(payment.amountPaid || 0)),
            voucherUrl: payment.voucherKey ? `/workspace/orders/${orderId}/payment` : null,
            exceptionAuthorized: !!payment.exceptionAuthorized,
            exceptionBy: payment.exceptionBy,
            exceptionAt: payment.exceptionAt,
            exceptionNote: payment.exceptionNote,
            exceptionCondition: payment.exceptionCondition,
          }
        : { status: payment.status }
      : null;
    const extraTerms = await this.clientPortal.priceDecisionPayload(ctx, orderId);
    return {
      id: order.orderId,
      orderId: order.orderId,
      orderNumber: order.displayNumber || order.orderId,
      customer: {
        id: order.customerId,
        displayName: customer?.name || order.customerName,
        isTrust: !!customer?.isTrust,
      },
      product: {
        id: productId || product?.productId,
        name: product?.name || String(order.formValues?.product || order.summary || ''),
        rubro: product?.rubricId || config?.rubro,
      },
      quantity: Number(order.formValues?.quantity || consumption?.requestedQuantity || 0),
      formData: order.formValues || {},
      notes: String(order.formValues?.notes || order.summary || ''),
      status: operationalOrderStatus(order),
      deadlineStatus,
      dueDate: new Date(order.dueAt).toISOString(),
      dueAt: order.dueAt,
      consumption: consumption
        ? { value: consumption.quantity, unit: consumption.unit, lines: order.consumptions.map((c) => ({ name: c.name, quantity: c.quantity, unit: c.unit })) }
        : { value: 0, unit: 'U' },
      pricing,
      payment: paymentView,
      files,
      assignment,
      workflow: { currentStep: operationalOrderStatus(order), steps: order.orchestration ? [order.orchestration] : [] },
      internalComments: comments,
      createdAt: new Date(order.createdAt).toISOString(),
      updatedAt: new Date(order.updatedAt).toISOString(),
      fulfillment: fulfillmentView(order, 'es'),
      commercialTerms: extraTerms.commercialTerms,
      priceDecisionRequired: extraTerms.priceDecisionRequired,
      priceDecisionPrompt: extraTerms.priceDecisionPrompt,
      fullyPaid: extraTerms.fullyPaid,
    };
  }

  async listFiles(ctx: AuthContext, orderId: string) {
    this.assertStaff(ctx, 'orders.view');
    await this.requireOrder(ctx, orderId);
    return this.presentFiles(ctx, await this.orders.getOrder(orderId, 'admin') as PersistedOrder);
  }

  async convert(ctx: AuthContext, orderId: string, fileId: string) {
    this.assertStaff(ctx, 'orders.edit');
    await this.requireOrder(ctx, orderId);
    const file = await this.store.getOrderFile(fileId);
    if (!file || file.tenantId !== ctx.tenantId || file.orderId !== orderId) throw new AccessDeniedError();
    if (!isCorelDraw(file.filename, file.mimeType)) throw new RequestInvalidError('NOT_CDR');
    if (file.conversionStatus === 'COMPLETED' && file.convertedKey) {
      return { conversionStatus: 'COMPLETED' as ConversionStatus, fileId, reused: true };
    }
    file.conversionStatus = 'PENDING';
    await this.store.saveOrderFile(file);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'artifact',
      entityId: fileId,
      eventType: 'FILE_CONVERSION_REQUESTED',
      actorType: ctx.roleId === 'OPERATOR' ? 'OPERATOR' : 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId, fileId },
      correlationId: orderId,
    });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const bytes = await this.store.readBlob(file.id);
      if (!bytes?.length) throw new Error('ORIGINAL_MISSING');
      const converted = convertCdrToPdf(file.filename, bytes);
      const pdfId = randomUUID();
      const convertedKey = await this.store.writeBlob(pdfId, converted.pdf);
      const profileId = randomUUID();
      const colorProfileKey = await this.store.writeBlob(
        profileId,
        Buffer.from(JSON.stringify({ ...converted.profile, warnings: converted.warnings, equivalent: false }), 'utf8')
      );
      const originalStill = await this.store.readBlob(file.id);
      if (!originalStill?.length) throw new Error('ORIGINAL_LOST');
      file.convertedKey = convertedKey;
      file.colorProfileKey = colorProfileKey;
      file.conversionStatus = 'COMPLETED';
      await this.store.saveOrderFile(file);
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'artifact',
        entityId: fileId,
        eventType: 'FILE_CONVERSION_COMPLETED',
        actorType: 'SYSTEM',
        actorId: 'system',
        metadata: { orderId, fileId, convertedKey },
        correlationId: orderId,
      });
    } catch {
      file.conversionStatus = 'FAILED';
      await this.store.saveOrderFile(file);
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'artifact',
        entityId: fileId,
        eventType: 'FILE_CONVERSION_FAILED',
        actorType: 'SYSTEM',
        actorId: 'system',
        metadata: { orderId, fileId },
        correlationId: orderId,
      });
    }
    return { conversionStatus: 'PENDING' as ConversionStatus, fileId };
  }

  async colorProfile(ctx: AuthContext, orderId: string, fileId: string) {
    this.assertStaff(ctx, 'orders.view');
    await this.requireOrder(ctx, orderId);
    const file = await this.store.getOrderFile(fileId);
    if (!file || file.tenantId !== ctx.tenantId || file.orderId !== orderId) throw new AccessDeniedError();
    if (!file.colorProfileKey) {
      const bytes = await this.store.readBlob(file.id);
      if (!bytes) throw new RequestInvalidError('NO_COLOR_PROFILE');
      return extractColorProfile(bytes);
    }
    const key = file.colorProfileKey.replace('cloud://artifacts/', '');
    const buf = (await this.store.readBlob(key)) || (await this.store.readBlob(file.colorProfileKey));
    if (!buf) return extractColorProfile((await this.store.readBlob(file.id)) || Buffer.alloc(0));
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return extractColorProfile(buf);
    }
  }

  async setFileStatus(ctx: AuthContext, orderId: string, fileId: string, status: string, reason?: string) {
    this.assertStaff(ctx, 'orders.edit');
    const order = await this.requireOrder(ctx, orderId);
    const file = await this.store.getOrderFile(fileId);
    if (!file || file.orderId !== orderId || file.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const next = status.toUpperCase();
    if (next !== 'VALIDATED' && next !== 'REJECTED') throw new RequestInvalidError('INVALID_FILE_STATUS');
    if (next === 'REJECTED' && !String(reason || '').trim()) throw new RequestInvalidError('REASON_REQUIRED');
    file.status = next as 'VALIDATED' | 'REJECTED';
    await this.store.saveOrderFile(file);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'artifact',
      entityId: fileId,
      eventType: next === 'REJECTED' ? 'ARTIFACT_REJECTED' : 'ARTIFACT_VALIDATED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId, reason },
      correlationId: orderId,
    });
    if (next === 'REJECTED') {
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'CHANGE_REQUESTED',
        title: 'Archivo rechazado',
        customerMessage: reason || 'Un archivo de tu pedido necesita corrección.',
        workshopMessage: `Archivo rechazado en ${order.displayNumber || orderId}.`,
        entityType: 'order',
        entityId: orderId,
        order,
        dedupeKey: `${orderId}:FILE_REJECTED:${fileId}`,
        includeCustomer: true,
        includeWorkshop: true,
        comment: reason,
      });
    }
    return file;
  }

  async setStatus(ctx: AuthContext, orderId: string, statusRaw: string, reason?: string) {
    this.assertStaff(ctx, 'orders.edit');
    const to = STATUS_ALIAS[statusRaw] || STATUS_ALIAS[statusRaw.toUpperCase()];
    if (!to) throw new RequestInvalidError('INVALID_STATUS');
    if (to === 'cancelled' && !String(reason || '').trim()) throw new RequestInvalidError('REASON_REQUIRED');
    const before = await this.requireOrder(ctx, orderId);
    const actor = { actorId: ctx.userId, role: 'admin' as const, label: ctx.roleId };
    let updated;
    try {
      updated = await this.orders.walkToStatus(orderId, to, actor, reason);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.startsWith('NO_STATUS_PATH') || msg.includes('Invalid order transition')) {
        throw new RequestInvalidError('INVALID_TRANSITION');
      }
      throw error;
    }
    if (to === 'ready') {
      const mode = updated.fulfillment?.mode === 'DELIVERY' ? 'order_ready_delivery' : 'order_ready_pickup';
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'ORDER_READY',
        title: t('notifications.order_ready', 'es', { orderNumber: updated.displayNumber || orderId }),
        customerMessage: t(`notifications.${mode}`, 'es', { orderNumber: updated.displayNumber || orderId }),
        workshopMessage: t(`notifications.${mode}`, 'es', { orderNumber: updated.displayNumber || orderId }),
        entityType: 'order',
        entityId: orderId,
        order: updated,
        dedupeKey: `${orderId}:READY_PICKUP`,
        includeCustomer: true,
        includeWorkshop: true,
      });
    }
    if (to === 'delivered') {
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'ORDER_COMPLETED',
        title: t('notifications.order_delivered', 'es', { orderNumber: updated.displayNumber || orderId }),
        customerMessage: t('notifications.order_delivered', 'es', { orderNumber: updated.displayNumber || orderId }),
        workshopMessage: t('notifications.order_delivered', 'es', { orderNumber: updated.displayNumber || orderId }),
        entityType: 'order',
        entityId: orderId,
        order: updated,
        dedupeKey: `${orderId}:DELIVERED`,
        includeCustomer: true,
        includeWorkshop: true,
      });
    }
    if (to === 'cancelled') {
      const customer = await this.store.getCustomer(before.customerId);
      if (customer?.isTrust) {
        customer.currentDebt = Math.max(0, Number(customer.currentDebt || 0) - Number(before.totalCustomerAmount || 0));
        customer.updatedAt = Date.now();
        await this.store.saveCustomer(customer);
      }
    }
    return updated;
  }

  async assign(ctx: AuthContext, orderId: string, userId: string) {
    this.assertStaff(ctx, 'orders.edit');
    const order = await this.requireOrder(ctx, orderId);
    const users = await this.store.listUsers(ctx.tenantId);
    const user = users.find((u) => u.userId === userId);
    if (!user || user.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (user.roleId === 'CUSTOMER' || user.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    const updated = await this.center.assign(ctx, orderId, userId);
    const row: OrderAssignmentRecord = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      orderId,
      assignedTo: userId,
      assignedBy: ctx.userId,
      assignedAt: Date.now(),
    };
    await this.store.saveAssignment(row);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'ORDER_ASSIGNED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId, assignedTo: userId },
      correlationId: orderId,
    });
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Pedido asignado',
      workshopMessage: `Se te asignó el pedido ${order.displayNumber || orderId}.`,
      entityType: 'order',
      entityId: orderId,
      order: updated,
      dedupeKey: `${orderId}:ASSIGNED:${userId}`,
      includeWorkshop: true,
      includeOperators: true,
    });
    return { assignment: row, order: updated };
  }

  async getPayment(ctx: AuthContext, orderId: string) {
    this.assertStaff(ctx, 'orders.view');
    const order = await this.requireOrder(ctx, orderId);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    if (!this.canSeeCosts(ctx)) return { status: payment.status };
    const agreed = agreedOrderAmount(order);
    return {
      ...payment,
      remaining: nextPaymentRemaining({
        amountDue: Number(payment.amountDue || 0),
        amountPaid: Number(payment.amountPaid || 0),
        agreed,
      }),
      remainingBalance: Math.max(0, Math.round((agreed - Number(payment.amountPaid || 0)) * 100) / 100),
      settled: paymentFullySettled(agreed, Number(payment.amountPaid || 0)),
      voucherUrl: payment.voucherKey ? `cloud://${payment.voucherKey}` : null,
    };
  }

  async confirmPayment(
    ctx: AuthContext,
    orderId: string,
    amountPaid?: number,
    options?: { authorizeException?: boolean; exceptionNote?: string }
  ) {
    this.assertStaff(ctx, 'orders.edit');
    await this.requireOrder(ctx, orderId);
    return this.clientPortal.confirmPayment(ctx, orderId, amountPaid, options);
  }

  async addComment(ctx: AuthContext, orderId: string, content: string) {
    this.assertStaff(ctx, 'orders.view');
    await this.requireOrder(ctx, orderId);
    if (!content?.trim()) throw new RequestInvalidError('COMMENT_REQUIRED');
    const row: InternalCommentRecord = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      orderId,
      authorId: ctx.userId,
      content: content.trim(),
      createdAt: Date.now(),
    };
    await this.store.saveInternalComment(row);
    await this.orders.addInternalComment(orderId, { actorId: ctx.userId, actorLabel: ctx.roleId, body: content.trim() });
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'INTERNAL_COMMENT_ADDED',
      actorType: ctx.roleId === 'OPERATOR' ? 'OPERATOR' : 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId },
      correlationId: orderId,
    });
    return row;
  }

  async listComments(ctx: AuthContext, orderId: string) {
    this.assertStaff(ctx, 'orders.view');
    await this.requireOrder(ctx, orderId);
    const sql = await this.store.listInternalComments(ctx.tenantId, orderId);
    const order = await this.orders.getOrder(orderId, 'admin');
    const fromOrder = (order?.internalComments || []).map((c) => ({
      id: c.commentId,
      tenantId: ctx.tenantId,
      orderId,
      authorId: c.actorId,
      content: c.body,
      createdAt: c.at,
    }));
    const seen = new Set(sql.map((c) => c.content + c.createdAt));
    return [...sql, ...fromOrder.filter((c) => !seen.has(c.content + c.createdAt))];
  }

  async listCustomers(
    ctx: AuthContext,
    query?: { membershipStatus?: string; messageStatus?: string; recent?: boolean }
  ) {
    this.assertStaff(ctx, 'customers.view');
    const customers = await this.store.listCustomers(ctx.tenantId);
    const orders = await this.orders.listOrders(ctx.tenantId, 'admin');
    const memberships = await this.store.listMemberships(ctx.tenantId);
    const memByCustomer = new Map(memberships.filter((m) => m.tenantId === ctx.tenantId).map((m) => [m.customerId, m]));
    const messages = await this.store.listClientMessages(ctx.tenantId);
    let rows = customers
      .filter((c) => c.tenantId === ctx.tenantId)
      .map((c) => {
        const own = orders.filter((o) => o.customerId === c.customerId);
        const last = own.sort((a, b) => b.createdAt - a.createdAt)[0];
        const mem = memByCustomer.get(c.customerId);
        const comms = messages.filter((m) => m.customerId === c.customerId);
        const lastMsg = comms.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const lastActivity = Math.max(last?.createdAt || 0, lastMsg?.updatedAt || 0, c.updatedAt || 0);
        return {
          id: c.customerId,
          displayName: c.name,
          email: c.email || c.login,
          isTrust: !!c.isTrust,
          currentDebt: c.isTrust ? Number(c.currentDebt || 0) : undefined,
          orderCount: own.length,
          lastOrderAt: last ? new Date(last.createdAt).toISOString() : null,
          membershipStatus: mem?.status || null,
          lastMessageStatus: lastMsg?.status || null,
          lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
        };
      });
    if (query?.membershipStatus) {
      rows = rows.filter((r) => r.membershipStatus === query.membershipStatus);
    }
    if (query?.messageStatus) {
      rows = rows.filter((r) => r.lastMessageStatus === query.messageStatus);
    }
    if (query?.recent) {
      const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
      rows = rows.filter((r) => r.lastActivityAt && new Date(r.lastActivityAt).getTime() >= week);
    }
    return rows;
  }

  async getCustomer(ctx: AuthContext, customerId: string) {
    this.assertStaff(ctx, 'customers.view');
    const customer = await this.store.getCustomer(customerId);
    if (!customer || customer.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const orders = (await this.orders.listOrders(ctx.tenantId, 'admin')).filter((o) => o.customerId === customerId);
    const membership = await new MembershipService(this.store, this.orders).getForAdmin(ctx, customerId);
    const messages = await this.store.listClientMessages(ctx.tenantId, { customerId });
    const comms = messages
      .filter((m) => m.tenantId === ctx.tenantId)
      .flatMap((m) =>
        m.entries.map((e) => ({
          messageId: m.id,
          subject: m.subject,
          status: m.status,
          category: m.category,
          authorRole: e.authorRole,
          content: e.content,
          createdAt: e.createdAt,
          createdAtIso: new Date(e.createdAt).toISOString(),
        }))
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    return {
      id: customer.customerId,
      displayName: customer.name,
      email: customer.email || customer.login,
      phone: customer.phone,
      country: customer.country,
      region: customer.region,
      postalCode: customer.postalCode,
      preferredLanguage: customer.preferredLanguage,
      isTrust: !!customer.isTrust,
      creditLimit: customer.isTrust ? customer.creditLimit : undefined,
      currentDebt: customer.isTrust ? customer.currentDebt : undefined,
      membership,
      orders: orders.map((o) => ({
        id: o.orderId,
        number: o.displayNumber,
        status: o.status,
        operationalStatus: toOperationalStatus(o.status),
        total: o.totalCustomerAmount,
        createdAt: new Date(o.createdAt).toISOString(),
      })),
      communications: comms,
    };
  }

  async createCustomer(
    ctx: AuthContext,
    body: {
      email: string;
      password: string;
      name: string;
      phone?: string;
      preferredLanguage?: string;
      country?: string;
      region?: string;
      city?: string;
      postalCode?: string;
      membershipStatus?: MembershipStatus;
    }
  ) {
    this.assertStaff(ctx, 'customers.view');
    const created = await this.clientPortal.register({
      tenantId: ctx.tenantId,
      email: body.email,
      password: body.password,
      name: body.name,
      phone: body.phone,
      preferredLanguage: body.preferredLanguage,
      country: body.country,
      region: body.region,
      city: body.city,
      postalCode: body.postalCode,
    });
    const user = await this.store.getUser(created.userId);
    if (user) {
      user.emailVerified = true;
      user.verificationToken = null;
      user.updatedAt = Date.now();
      await this.store.saveUser(user);
    }
    const membership = await new MembershipService(this.store, this.orders).assign(ctx, created.customerId, {
      status: body.membershipStatus || 'TRIAL',
    });
    return { ...created, membership };
  }

  async generateTrustCode(ctx: AuthContext, customerId: string) {
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    const customer = await this.store.getCustomer(customerId);
    if (!customer || customer.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const code = `T-${randomBytes(4).toString('hex').toUpperCase()}`;
    const creditLimit = Number(customer.creditLimit || 1000000);
    customer.trustCode = code;
    customer.updatedAt = Date.now();
    await this.store.saveCustomer(customer);
    const config = await this.store.getConfig(ctx.tenantId);
    if (config) {
      config.trustCodes = [
        ...(config.trustCodes || []).filter((c) => c.customerId !== customerId),
        { code, creditLimit, customerId },
      ];
      config.updatedAt = Date.now();
      await this.store.saveConfig(config);
    }
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'tenant',
      entityId: customerId,
      eventType: 'TRUST_CODE_GENERATED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { customerId },
      correlationId: customerId,
    });
    return { code, customerId, creditLimit };
  }

  private async presentFiles(ctx: AuthContext, order: PersistedOrder) {
    const files = await this.store.listOrderFiles(ctx.tenantId, order.orderId);
    const fromAttachments = (order.attachments || []).filter((a) => !files.some((f) => f.id === a.fileId));
    const all: OrderFileRecord[] = [
      ...files,
      ...fromAttachments.map((a) => ({
        id: a.fileId,
        tenantId: ctx.tenantId,
        orderId: order.orderId,
        customerId: order.customerId,
        filename: a.filename,
        storageKey: a.storageReference,
        mimeType: a.mimeType,
        sizeBytes: a.size,
        status: 'PENDING' as const,
        uploadedAt: a.createdAt,
        conversionStatus: 'NOT_REQUIRED' as ConversionStatus,
      })),
    ];
    return all.map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      status: f.status,
      uploadedAt: new Date(f.uploadedAt).toISOString(),
      downloadUrl: `/workspace/orders/${order.orderId}/files/${f.id}`,
      convertedPdfUrl: f.convertedKey ? `/workspace/orders/${order.orderId}/files/${f.id}/pdf` : null,
      conversionStatus: f.conversionStatus || 'NOT_REQUIRED',
      colorProfileAvailable: !!f.colorProfileKey,
    }));
  }

  private async presentAssignment(ctx: AuthContext, order: PersistedOrder) {
    const row = await this.store.getAssignmentByOrder(order.orderId);
    const assignedTo = order.assignedTo || row?.assignedTo;
    if (!assignedTo) return null;
    const users = await this.store.listUsers(ctx.tenantId);
    const assigned = users.find((u) => u.userId === assignedTo);
    const by = users.find((u) => u.userId === (row?.assignedBy || ''));
    return {
      assignedTo: assigned ? { id: assigned.userId, name: assigned.name || assigned.login } : { id: assignedTo, name: order.assignedToLabel },
      assignedBy: by ? { id: by.userId, name: by.name || by.login } : null,
      assignedAt: new Date(row?.assignedAt || order.assignedAt || Date.now()).toISOString(),
    };
  }

  private async toListItem(
    order: PersistedOrder,
    customerName: string | undefined,
    deadlineStatus: DeadlineClass,
    seeCosts: boolean,
    operational = operationalOrderStatus(order)
  ) {
    const files = await this.store.listOrderFiles(order.tenantId, order.orderId);
    const payment = await this.store.getPaymentRecordByOrder(order.orderId);
    const item: Record<string, unknown> = {
      id: order.orderId,
      orderId: order.orderId,
      orderNumber: order.displayNumber || order.orderId,
      customer: { id: order.customerId, displayName: customerName || order.customerName },
      product: { id: String(order.formValues?.productId || ''), name: String(order.formValues?.product || order.summary || '') },
      quantity: Number(order.formValues?.quantity || 0),
      status: operational,
      deadlineStatus,
      dueDate: new Date(order.dueAt).toISOString(),
      assignedTo: order.assignedTo ? { id: order.assignedTo, name: order.assignedToLabel } : null,
      totalPrice: order.totalCustomerAmount,
      paymentStatus: payment?.status || null,
      createdAt: new Date(order.createdAt).toISOString(),
      filesCount: files.length || (order.attachments || []).length,
      fulfillmentMode: order.fulfillment?.mode || 'PICKUP',
      fulfillment: fulfillmentView(order, 'es'),
    };
    if (seeCosts) item.internalCost = order.totalInternalCost;
    return item;
  }

  private deadlineStatus(dueAt: number, now = Date.now()): DeadlineClass {
    const info = computeDeadline(dueAt, now, DEFAULT_DEADLINE_POLICY);
    if (info.kind === 'expired') return 'OVERDUE';
    if (info.kind === 'approaching_deadline' || info.kind === 'deadline_today') return 'DUE_SOON';
    return 'ON_TIME';
  }

  private async requireOrder(ctx: AuthContext, orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return order;
  }

  private assertStaff(ctx: AuthContext, permission: 'orders.view' | 'orders.edit' | 'customers.view') {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return;
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
    if (ctx.roleId === 'OPERATOR') {
      if (permission === 'orders.view') return;
      throw new AccessDeniedError();
    }
    if (!hasPermission(probe, permission === 'customers.view' ? 'customers.view' : permission)) throw new AccessDeniedError();
  }

  private canSeeCosts(ctx: AuthContext): boolean {
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return true;
    if (ctx.roleId === 'OPERATOR') return false;
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
    return hasPermission(probe, 'costs.view');
  }
}
