import type { ControlPlaneStore } from '../../../cloud/store/ControlPlaneStore';
import type { DomainEvent } from '../../../contracts/trace-domain';
import type { TenantConfig } from '../../../contracts/admin-domain';
import type { PersistedOrder } from '../../../contracts/order-domain';
import { operationalOrderStatus } from '../../../contracts/order-lifecycle';
import type { EmailService } from './EmailService';
import { TEMPLATES } from './templates';
import { t } from '../../../i18n';
import { formatMoney } from '../../../contracts/currency';

const SKIP = new Set([
  'INTERNAL_COMMENT_ADDED',
  'STEP_STARTED',
  'TENANT_RUBRO_SELECTED',
  'USER_CREATED',
  'USER_DEACTIVATED',
]);

export class EmailDispatcher {
  constructor(
    private store: ControlPlaneStore,
    private email: EmailService,
    private defaults: { from: string; appUrl: string }
  ) {}

  async onEvent(event: DomainEvent): Promise<void> {
    try {
      if (event.eventType.startsWith('AUDIT_')) return;
      if (SKIP.has(event.eventType) && event.eventType !== 'STEP_STARTED') return;
      if (event.eventType === 'STEP_STARTED' && !this.isReadyStep(event)) return;
      const config = await this.store.getConfig(event.tenantId);
      if (!this.emailsOn(config)) return;
      const tenant = await this.store.getTenant(event.tenantId);
      const tenantName = tenant?.identity?.commercialName || tenant?.name || 'Taller';
      const from = this.fromOf(config);
      const replyTo = this.replyToOf(config);
      const adminTo = await this.adminInbox(event.tenantId, config);
      const orderId = String(event.metadata.orderId || event.correlationId || (event.entityType === 'order' ? event.entityId : '') || '');
      const order = orderId ? await this.store.get(orderId) : undefined;
      const ctx = { tenantName, from, replyTo, adminTo, config, appUrl: this.defaults.appUrl };

      switch (event.eventType) {
        case 'CUSTOMER_REGISTERED':
          await this.verifyEmail(event, ctx);
          return;
        case 'ORDER_SUBMITTED':
          if (order) await this.orderSubmitted(event, order, ctx);
          return;
        case 'PAYMENT_VOUCHER_UPLOADED':
          if (order) await this.voucher(event, order, ctx);
          return;
        case 'PAYMENT_CONFIRMED':
          if (order) await this.paymentOk(event, order, ctx);
          return;
        case 'ARTIFACT_REJECTED':
          if (order) await this.rejected(event, order, ctx);
          return;
        case 'CHANGE_REQUESTED':
          if (order) await this.changes(event, order, ctx);
          return;
        case 'ORDER_APPROVED':
          if (order) await this.approved(event, order, ctx);
          return;
        case 'ORDER_ASSIGNED':
          if (order) await this.assigned(event, order, ctx);
          return;
        case 'ORDER_READY':
        case 'STEP_STARTED':
          if (order) await this.ready(event, order, ctx);
          return;
        case 'ORDER_COMPLETED':
          if (order) await this.delivered(event, order, ctx);
          return;
        case 'ORDER_OVERDUE':
        case 'DEADLINE_OVERDUE':
          if (order) await this.overdue(event, order, ctx);
          return;
        case 'JOB_FAILED':
          if (order) await this.jobFailed(event, order, ctx);
          return;
        case 'WORKFLOW_BLOCKED':
        case 'STEP_BLOCKED':
          if (order) await this.blocked(event, order, ctx);
          return;
        default:
          return;
      }
    } catch {
      /* never break callers */
    }
  }

  private emailsOn(config?: TenantConfig): boolean {
    if (!config) return true;
    if (config.emailsEnabled === false) return false;
    if (config.config && config.config.emailsEnabled === false) return false;
    return true;
  }

  private fromOf(config?: TenantConfig): string {
    const nested = config?.config && typeof config.config.emailFrom === 'string' ? config.config.emailFrom : '';
    return (config?.emailFrom || nested || this.defaults.from).trim();
  }

  private replyToOf(config?: TenantConfig): string | undefined {
    const nested = config?.config && typeof config.config.emailReplyTo === 'string' ? config.config.emailReplyTo : '';
    return (config?.emailReplyTo || nested || undefined) || undefined;
  }

  private async adminInbox(tenantId: string, config?: TenantConfig): Promise<string> {
    const nested = config?.config && typeof config.config.adminEmail === 'string' ? config.config.adminEmail : '';
    if (config?.adminEmail) return config.adminEmail;
    if (nested) return nested;
    const users = await this.store.listUsers(tenantId);
    const admin = users.find((u) => u.roleId === 'ADMIN_PRINCIPAL');
    return String(admin?.email || admin?.login || '');
  }

  private isReadyStep(event: DomainEvent): boolean {
    const status = String(event.metadata.status || event.metadata.step || event.metadata.workflowStepId || '').toLowerCase();
    return status === 'ready' || status.includes('ready');
  }

  private dateOf(tenantId: string, config: TenantConfig | undefined, ms = Date.now()): string {
    const zone = config?.identity?.timezone || 'UTC';
    try {
      return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: zone }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString();
    }
  }

  private workshopUrl(orderId: string): string {
    return `${this.defaults.appUrl}/workspace/orders/${orderId}`;
  }

  private trackingUrl(orderId: string): string {
    return `${this.defaults.appUrl}/client/orders/${orderId}`;
  }

  private async verifyEmail(event: DomainEvent, ctx: Ctx): Promise<void> {
    const user = (await this.store.getUser(event.entityId)) || (await this.store.getUser(event.actorId));
    const email = String(user?.email || user?.login || event.metadata.email || '');
    if (!email) return;
    const byLogin = !user?.verificationToken && email ? await this.store.getUserByLogin(event.tenantId, email) : undefined;
    const resolved = byLogin || user;
    const token = String(resolved?.verificationToken || event.metadata.verificationToken || '');
    const customer = await this.store.getCustomer(event.entityId);
    const lang = customer?.preferredLanguage || resolved?.preferredLanguage || this.tenantLang(ctx);
    await this.email.send({
      to: email,
      subject: t('emails.subject.verify_email', lang, { tenantName: ctx.tenantName }),
      html: TEMPLATES.verify({
        tenantName: ctx.tenantName,
        customerName: customer?.name || resolved?.name || user?.name || email,
        intro: t('emails.body.verify_email_intro', lang, { tenantName: ctx.tenantName }),
        cta: t('emails.body.verify_email_cta', lang),
        expiry: t('emails.body.verify_email_expiry', lang),
        verifyUrl: `${ctx.appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`,
        verificationToken: token,
        date: this.dateOf(event.tenantId, ctx.config),
        orderNumber: '',
      }),
      tenantId: event.tenantId,
      eventType: 'CUSTOMER_REGISTERED',
      recipientId: user?.userId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async orderSubmitted(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const customer = await this.store.getCustomer(order.customerId);
    const files = await this.store.listOrderFiles(event.tenantId, order.orderId);
    const payment = await this.store.getPaymentRecordByOrder(order.orderId);
    const productId = String(order.formValues?.productId || '');
    const product = (ctx.config?.products || []).find((p) => p.productId === productId);
    const material = (ctx.config?.materials || []).find((m) => m.materialId === product?.materialIds?.[0]);
    const consumption = (order.consumptions || [])
      .map((c) => `${c.quantity} ${c.unit}${c.name ? ` (${c.name})` : ''}`)
      .join(', ') || String(order.formValues?.quantity || '');
    const fileNames = [
      ...files.map((f) => f.filename),
      ...(order.attachments || []).map((a) => a.filename),
    ].filter(Boolean);
    const vars = {
      tenantName: ctx.tenantName,
      orderNumber: order.displayNumber || order.orderId,
      customerName: customer?.name || order.customerName,
      customerEmail: customer?.email || customer?.login || '',
      customerPhone: customer?.phone ? ` / ${customer.phone}` : '',
      customerType: customer?.isTrust ? 'confianza' : 'estándar',
      productName: product?.name || String(order.formValues?.materialName || order.formValues?.product || order.summary || ''),
      projectName: order.projectName || String(order.formValues?.projectName || order.summary || ''),
      rubro: String(product?.rubricId || order.configurationSnapshot?.disciplineId || ctx.config?.rubro || ''),
      quantity: String(order.formValues?.quantity || ''),
      consumption,
      material: material?.name || material?.materialId || String(order.formValues?.materialName || product?.materialIds?.[0] || ''),
      totalPrice: formatMoney(Number(order.totalCustomerAmount || 0), ctx.config?.currency || ctx.config?.identity?.currency),
      paymentStatus: payment?.status || 'PENDIENTE',
      amountDue: formatMoney(Number(payment?.amountDue || 0), ctx.config?.currency || ctx.config?.identity?.currency),
      amountPaid: formatMoney(Number(payment?.amountPaid || 0), ctx.config?.currency || ctx.config?.identity?.currency),
      amountRemaining: formatMoney(
        Math.max(0, Number(payment?.amountDue || 0) - Number(payment?.amountPaid || 0)),
        ctx.config?.currency || ctx.config?.identity?.currency
      ),
      hasVoucher: payment?.voucherKey ? 'Sí' : 'No',
      notes: String(order.formValues?.notes || ''),
      fileNames: fileNames.join(', ') || 'Sin archivos',
      filesHtml:
        files.map((f) => `<div>${f.filename} — ${ctx.appUrl}/workspace/orders/${order.orderId}/files/${f.id}</div>`).join('') ||
        (order.attachments || []).map((a) => `<div>${a.filename}</div>`).join('') ||
        'Sin archivos',
      workshopUrl: this.workshopUrl(order.orderId),
      trackingUrl: this.trackingUrl(order.orderId),
      date: this.dateOf(event.tenantId, ctx.config, order.createdAt),
      paymentHint: payment && payment.status !== 'COMPLETED' ? 'Hace falta confirmar el pago para continuar.' : 'Condición de pago cumplida.',
    };
    if (ctx.adminTo) {
      await this.email.send({
        to: ctx.adminTo,
        subject: t('emails.subject.order_submitted_admin', this.tenantLang(ctx), {
          orderNumber: String(vars.orderNumber),
          customerName: String(vars.customerName),
        }),
        html: TEMPLATES.orderToWorkshop(vars),
        tenantId: event.tenantId,
        eventType: 'ORDER_SUBMITTED',
        orderId: order.orderId,
        from: ctx.from,
        replyTo: ctx.replyTo,
      });
    }
    const customerEmail = customer?.email || customer?.login;
    if (customerEmail) {
      await this.email.send({
        to: customerEmail,
        subject: t('emails.subject.order_submitted_client', customer?.preferredLanguage || this.tenantLang(ctx), {
          orderNumber: String(vars.orderNumber),
        }),
        html: TEMPLATES.orderToCustomer(vars),
        tenantId: event.tenantId,
        eventType: 'ORDER_SUBMITTED',
        orderId: order.orderId,
        recipientId: customer?.customerId,
        from: ctx.from,
        replyTo: ctx.replyTo,
      });
    }
  }

  private async voucher(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const customer = await this.store.getCustomer(order.customerId);
    if (!ctx.adminTo) return;
    await this.email.send({
      to: ctx.adminTo,
      subject: t('emails.subject.voucher_received_admin', this.tenantLang(ctx), {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.voucherReceived({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name || order.customerName,
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'PAYMENT_VOUCHER_UPLOADED',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async paymentOk(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const customer = await this.store.getCustomer(order.customerId);
    const payment = await this.store.getPaymentRecordByOrder(order.orderId);
    const email = customer?.email || customer?.login;
    if (!email) return;
    const lang = customer?.preferredLanguage || this.tenantLang(ctx);
    const money = formatMoney(Number(event.metadata.amountPaid ?? payment?.amountPaid ?? 0), ctx.config?.currency || ctx.config?.identity?.currency);
    await this.email.send({
      to: email,
      subject: t('emails.subject.payment_confirmed', lang, { orderNumber: order.displayNumber || order.orderId }),
      html: TEMPLATES.paymentConfirmed({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name,
        amountPaid: money,
        status: operationalOrderStatus(order),
        dueHint: order.dueAt ? `Estimación de entrega: ${this.dateOf(event.tenantId, ctx.config, order.dueAt)}.` : '',
        trackingUrl: this.trackingUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'PAYMENT_CONFIRMED',
      orderId: order.orderId,
      recipientId: customer?.customerId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async rejected(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const customer = await this.store.getCustomer(order.customerId);
    const file = await this.store.getOrderFile(event.entityId);
    const email = customer?.email || customer?.login;
    if (!email) return;
    await this.email.send({
      to: email,
      subject: t('emails.subject.file_rejected', customer?.preferredLanguage || this.tenantLang(ctx), {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.artifactRejected({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name,
        filename: file?.filename || String(event.metadata.filename || 'archivo'),
        reason: String(event.metadata.reason || event.metadata.comment || ''),
        trackingUrl: this.trackingUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'ARTIFACT_REJECTED',
      orderId: order.orderId,
      recipientId: customer?.customerId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async changes(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (!ctx.adminTo) return;
    const customer = await this.store.getCustomer(order.customerId);
    await this.email.send({
      to: ctx.adminTo,
      subject: `El cliente solicitó cambios en el pedido #${order.displayNumber || order.orderId}`,
      html: TEMPLATES.changeRequested({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name || order.customerName,
        message: String(event.metadata.comment || event.metadata.message || ''),
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'CHANGE_REQUESTED',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async approved(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (!ctx.adminTo) return;
    await this.email.send({
      to: ctx.adminTo,
      subject: `Cliente aprobó el pedido #${order.displayNumber || order.orderId}`,
      html: TEMPLATES.orderApproved({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'ORDER_APPROVED',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async assigned(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const assignedTo = String(event.metadata.assignedTo || order.assignedTo || '');
    const user = assignedTo ? await this.store.getUser(assignedTo) : undefined;
    const email = user?.email || user?.login;
    if (!email) return;
    const customer = await this.store.getCustomer(order.customerId);
    await this.email.send({
      to: email,
      subject: `Se te asignó el pedido #${order.displayNumber || order.orderId}`,
      html: TEMPLATES.orderAssigned({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name || order.customerName,
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'ORDER_ASSIGNED',
      orderId: order.orderId,
      recipientId: user?.userId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async ready(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    const customer = await this.store.getCustomer(order.customerId);
    const email = customer?.email || customer?.login;
    if (!email) return;
    const productId = String(order.formValues?.productId || '');
    const product = (ctx.config?.products || []).find((p) => p.productId === productId);
    const visAddr = (ctx.config?.config?.clientVisibility || {}) as {
      deliveryAddress?: string;
      deliveryHours?: string;
    };
    const pickup =
      [
        visAddr.deliveryAddress,
        visAddr.deliveryHours,
        typeof ctx.config?.config?.pickupInfo === 'string' ? ctx.config.config.pickupInfo : '',
        ctx.config?.identity?.contact || '',
      ]
        .filter((x) => x && String(x).trim())
        .join(' — ') || '';
    const lang = customer?.preferredLanguage || this.tenantLang(ctx);
    const delivery = order.fulfillment?.mode === 'DELIVERY';
    const subjectKey = delivery ? 'emails.subject.order_ready_delivery' : 'emails.subject.order_ready_pickup';
    const bodyKey = delivery ? 'emails.body.order_ready_delivery' : 'emails.body.order_ready_pickup';
    await this.email.send({
      to: email,
      subject: t(subjectKey, lang, {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.orderReady({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name,
        productName: product?.name || String(order.formValues?.product || order.summary || ''),
        pickupInfo: pickup,
        body: t(bodyKey, lang),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: delivery ? 'ORDER_READY_DELIVERY' : 'ORDER_READY',
      orderId: order.orderId,
      recipientId: customer?.customerId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async delivered(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (order.fulfillment?.mode !== 'DELIVERY') return;
    const customer = await this.store.getCustomer(order.customerId);
    const email = customer?.email || customer?.login;
    if (!email) return;
    const lang = customer?.preferredLanguage || this.tenantLang(ctx);
    await this.email.send({
      to: email,
      subject: t('emails.subject.order_delivered', lang, {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.orderReady({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name,
        productName: String(order.formValues?.product || order.summary || ''),
        pickupInfo: order.fulfillment?.destination?.address || '',
        body: t('emails.body.order_delivered', lang),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'ORDER_DELIVERED',
      orderId: order.orderId,
      recipientId: customer?.customerId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async overdue(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (!ctx.adminTo) return;
    const customer = await this.store.getCustomer(order.customerId);
    await this.email.send({
      to: ctx.adminTo,
      subject: t('emails.subject.order_overdue_admin', this.tenantLang(ctx), {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.deadlineOverdue({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        customerName: customer?.name || order.customerName,
        status: operationalOrderStatus(order),
        dueDate: this.dateOf(event.tenantId, ctx.config, order.dueAt),
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'DEADLINE_OVERDUE',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async jobFailed(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (!ctx.adminTo) return;
    await this.email.send({
      to: ctx.adminTo,
      subject: t('emails.subject.job_failed_admin', this.tenantLang(ctx), {
        orderNumber: order.displayNumber || order.orderId,
      }),
      html: TEMPLATES.jobFailed({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        jobName: String(event.metadata.jobName || event.metadata.jobId || event.entityId || 'job'),
        error: String(event.metadata.error || event.metadata.message || 'error'),
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'JOB_FAILED',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private async blocked(event: DomainEvent, order: PersistedOrder, ctx: Ctx): Promise<void> {
    if (!ctx.adminTo) return;
    await this.email.send({
      to: ctx.adminTo,
      subject: `⚠ Workflow bloqueado — pedido #${order.displayNumber || order.orderId}`,
      html: TEMPLATES.workflowBlocked({
        tenantName: ctx.tenantName,
        orderNumber: order.displayNumber || order.orderId,
        status: operationalOrderStatus(order),
        workshopUrl: this.workshopUrl(order.orderId),
        date: this.dateOf(event.tenantId, ctx.config),
      }),
      tenantId: event.tenantId,
      eventType: 'WORKFLOW_BLOCKED',
      orderId: order.orderId,
      from: ctx.from,
      replyTo: ctx.replyTo,
    });
  }

  private tenantLang(ctx: Ctx): string {
    return ctx.config?.defaultLanguage || ctx.config?.identity?.locale || 'es';
  }

  setAppUrl(url: string): void {
    this.defaults.appUrl = url;
  }
}

type Ctx = {
  tenantName: string;
  from: string;
  replyTo?: string;
  adminTo: string;
  config?: TenantConfig;
  appUrl: string;
};
