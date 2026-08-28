import { randomUUID } from 'crypto';
import type { AuthContext, TenantConfig } from '../../../contracts/admin-domain';
import { AccessDeniedError } from '../../../contracts/admin-domain';
import { RequestInvalidError } from '../../../contracts/configuration-schema';
import type { PaymentRecord, PaymentStatus } from '../../../contracts/customer-experience';
import type {
  ParsedPaymentEvent,
  PaymentAttemptRecord,
  PaymentGatewayAdapter,
  PaymentGatewayKind,
  TenantPaymentsConfig,
} from '../../../contracts/payment-gateway';
import type { ControlPlaneEnv } from '../../../cloud/env';
import type { ControlPlaneStore } from '../../../cloud/store/ControlPlaneStore';
import type { ClientPortalService } from '../ClientPortalService';
import type { OrderService } from '../OrderService';
import type { TraceService } from '../TraceService';
import { decryptSecret } from './crypto';
import { MercadoPagoAdapter } from './MercadoPagoAdapter';
import { StripeAdapter } from './StripeAdapter';
import { agreedOrderAmount, nextPaymentRemaining, paymentFullySettled } from '../../../contracts/commercial-terms';
import { resolveChargeCurrency } from '../../../contracts/payment-currency';

export class OnlinePaymentService {
  stripeAdapter: StripeAdapter;
  mpAdapter: MercadoPagoAdapter;

  constructor(
    private store: ControlPlaneStore,
    private client: ClientPortalService,
    private orders: OrderService,
    private tracer: TraceService,
    private env: ControlPlaneEnv
  ) {
    const live = env.paymentLive === true;
    this.mpAdapter = new MercadoPagoAdapter(env.mpAccessToken || '', live);
    this.stripeAdapter = new StripeAdapter(env.stripeSecretKey || '', live, env.stripeMode);
  }

  async checkout(ctx: AuthContext, orderId: string) {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment || payment.tenantId !== ctx.tenantId) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    const agreed = agreedOrderAmount(order);
    if (order.status === 'cancelled' || order.status === 'expired') {
      throw new RequestInvalidError('CHECKOUT_NOT_ALLOWED');
    }
    if (paymentFullySettled(agreed, Number(payment.amountPaid || 0)) || payment.status === 'COMPLETED') {
      throw new RequestInvalidError('ALREADY_PAID');
    }
    const cfg = await this.paymentsConfig(ctx.tenantId);
    const kind = this.resolveGateway(cfg);
    const adapter = this.adapter(kind, cfg);
    const amount = nextPaymentRemaining({
      amountDue: Number(payment.amountDue || 0),
      amountPaid: Number(payment.amountPaid || 0),
      agreed,
    });
    if (amount <= 0) throw new RequestInvalidError('ALREADY_PAID');
    const tenantCfg = await this.store.getConfig(ctx.tenantId);
    const currency = resolveChargeCurrency({
      tenantCurrency: cfg.currency || tenantCfg?.currency,
      envCurrency: this.env.paymentCurrency,
    });
    const customer = await this.store.getCustomer(ctx.userId);
    const urls = this.returnUrls(orderId);
    const result = await adapter.createCheckout({
      orderId,
      tenantId: ctx.tenantId,
      amount,
      currency,
      description: `Pedido ${order.displayNumber || orderId}`,
      customerEmail: customer?.email || customer?.login || ctx.userId,
      ...urls,
    });
    payment.gateway = kind;
    payment.gatewayOrderId = result.gatewayOrderId;
    payment.checkoutUrl = result.checkoutUrl;
    payment.gatewayPaymentId = result.gatewayPaymentId;
    await this.store.savePaymentRecord(payment);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'PAYMENT_CHECKOUT_CREATED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId, gateway: kind, gatewayOrderId: result.gatewayOrderId },
      correlationId: orderId,
    });
    return {
      checkoutUrl: result.checkoutUrl,
      gateway: kind,
      gatewayOrderId: result.gatewayOrderId,
      clientSecret: result.clientSecret,
      currency,
      amount,
    };
  }

  async status(ctx: AuthContext, orderId: string) {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment || payment.tenantId !== ctx.tenantId) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    const status: PaymentStatus | 'FAILED' = payment.status === 'FAILED' ? 'FAILED' : payment.status;
    return {
      status,
      amountDue: payment.amountDue,
      amountPaid: payment.amountPaid,
      gateway: payment.gateway || 'MANUAL',
      failureReason: payment.failureReason || null,
    };
  }

  async handleWebhook(kind: 'MERCADOPAGO' | 'STRIPE', raw: string, signature: string | undefined): Promise<{ status: number; body: unknown }> {
    if (!signature) return { status: 400, body: { error: 'MISSING_SIGNATURE' } };
    let parsedJson: unknown = {};
    try {
      parsedJson = raw ? JSON.parse(raw) : {};
    } catch {
      return { status: 400, body: { error: 'INVALID_JSON' } };
    }
    const adapter = this.adapter(kind);
    let peek: ParsedPaymentEvent;
    try {
      peek = adapter.parseWebhookEvent(parsedJson);
    } catch {
      return { status: 400, body: { error: 'INVALID_EVENT' } };
    }
    let payment = peek.gatewayOrderId
      ? await this.store.getPaymentRecordByGatewayOrderId(peek.gatewayOrderId)
      : undefined;
    if (!payment && peek.orderId) {
      const byOrder = await this.store.getPaymentRecordByOrder(peek.orderId);
      if (byOrder && (!peek.tenantId || byOrder.tenantId === peek.tenantId)) payment = byOrder;
    }
    const tenantId = payment?.tenantId;
    const cfg = tenantId ? await this.paymentsConfig(tenantId) : undefined;
    const secret =
      kind === 'STRIPE'
        ? cfg?.stripe?.webhookSecret || this.env.stripeWebhookSecret || ''
        : cfg?.mercadopago?.webhookSecret || this.env.mpWebhookSecret || '';
    if (!secret || !adapter.verifyWebhook(raw, signature, secret)) {
      return { status: 400, body: { error: 'INVALID_SIGNATURE' } };
    }
    const event = adapter.parseWebhookEvent(parsedJson);
    if (!payment) return { status: 200, body: { ignored: true } };
    const existing = await this.store.getPaymentAttempt(kind, event.eventId);
    if (existing) return { status: 200, body: { duplicate: true, attemptId: existing.id } };
    const attempt: PaymentAttemptRecord = {
      id: randomUUID(),
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentRecordId: payment.id,
      gateway: kind,
      gatewayEventId: event.eventId,
      eventType: event.eventType,
      status: event.status,
      rawPayload: parsedJson,
      processedAt: Date.now(),
    };
    const saved = await this.store.savePaymentAttempt(attempt);
    if (!saved) return { status: 200, body: { duplicate: true } };
    if (event.status === 'approved') {
      payment.gateway = kind;
      payment.gatewayPaymentId = event.gatewayPaymentId || payment.gatewayPaymentId;
      payment.gatewayOrderId = event.gatewayOrderId || payment.gatewayOrderId;
      payment.failureReason = null;
      await this.store.savePaymentRecord(payment);
      const ctx = this.gatewayCtx(payment.tenantId);
      await this.client.confirmPayment(ctx, payment.orderId, event.amount || payment.amountDue);
      const fresh = await this.store.getPaymentRecordByOrder(payment.orderId);
      const liveOrder = await this.orders.getOrder(payment.orderId, 'admin');
      const settledAgreed = agreedOrderAmount(liveOrder || { totalCustomerAmount: Number(payment.amountDue || 0) });
      if (fresh && paymentFullySettled(settledAgreed, Number(fresh.amountPaid || 0)) && fresh.status !== 'COMPLETED') {
        fresh.status = 'COMPLETED';
        await this.store.savePaymentRecord(fresh);
      }
    } else if (event.status === 'rejected' || event.status === 'cancelled') {
      payment.gateway = kind;
      payment.status = 'FAILED';
      payment.failureReason = event.status === 'cancelled' ? 'Pago cancelado' : 'Pago rechazado';
      await this.store.savePaymentRecord(payment);
      await this.tracer.record({
        tenantId: payment.tenantId,
        entityType: 'order',
        entityId: payment.orderId,
        eventType: 'PAYMENT_REJECTED',
        actorType: 'SYSTEM',
        actorId: 'payment-gateway',
        metadata: { orderId: payment.orderId, gateway: kind, reason: payment.failureReason },
        correlationId: payment.orderId,
      });
    }
    return { status: 200, body: { ok: true, status: event.status } };
  }

  async refund(ctx: AuthContext, orderId: string, amount?: number) {
    if (!['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'].includes(ctx.roleId)) throw new AccessDeniedError();
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment || payment.tenantId !== ctx.tenantId) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    const intentId = payment.gatewayPaymentId || payment.gatewayOrderId;
    if (!intentId || payment.gateway !== 'STRIPE') throw new RequestInvalidError('STRIPE_PAYMENT_REQUIRED');
    const cfg = await this.paymentsConfig(ctx.tenantId);
    const tenantCfg = await this.store.getConfig(ctx.tenantId);
    const currency = resolveChargeCurrency({
      tenantCurrency: cfg.currency || tenantCfg?.currency,
      envCurrency: this.env.paymentCurrency,
    });
    const stripe = this.adapter('STRIPE', cfg) as StripeAdapter;
    const refunded = await stripe.refund({
      paymentIntentId: intentId,
      amount,
      currency,
    });
    const paid = Number(payment.amountPaid || 0);
    payment.amountPaid = amount != null ? Math.max(0, paid - amount) : 0;
    payment.status = payment.amountPaid > 0 ? payment.status : 'FAILED';
    payment.failureReason = 'Refunded';
    await this.store.savePaymentRecord(payment);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'PAYMENT_REFUNDED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId, refundId: refunded.refundId, amount: amount ?? paid },
      correlationId: orderId,
    });
    return { ok: true, refundId: refunded.refundId, status: refunded.status, orderId };
  }

  private resolveGateway(cfg: TenantPaymentsConfig): 'MERCADOPAGO' | 'STRIPE' {
    if (cfg.gateway === 'STRIPE') return 'STRIPE';
    if (cfg.gateway === 'MERCADOPAGO') return 'MERCADOPAGO';
    if (this.env.stripeSecretKey || cfg.stripe?.secretKey) return 'STRIPE';
    return 'MERCADOPAGO';
  }

  private adapter(kind: 'MERCADOPAGO' | 'STRIPE', cfg?: TenantPaymentsConfig): PaymentGatewayAdapter {
    if (kind !== 'STRIPE') return this.mpAdapter;
    const secret = cfg?.stripe?.secretKey || this.env.stripeSecretKey || '';
    if (secret && secret !== (this.env.stripeSecretKey || '')) {
      return new StripeAdapter(secret, this.env.paymentLive === true, this.env.stripeMode);
    }
    return this.stripeAdapter;
  }

  private gatewayCtx(tenantId: string): AuthContext {
    return {
      token: 'gateway',
      userId: 'payment-gateway',
      tenantId,
      roleId: 'ADMIN_PRINCIPAL',
      permissions: [],
    };
  }

  private returnUrls(orderId: string) {
    const success = (this.env.paymentSuccessUrl || 'https://app.empaquetar.app/pedidos/:orderId?payment=success').replace(
      ':orderId',
      orderId
    );
    const failure = (this.env.paymentFailureUrl || 'https://app.empaquetar.app/pedidos/:orderId?payment=failure').replace(
      ':orderId',
      orderId
    );
    const pending = (this.env.paymentPendingUrl || 'https://app.empaquetar.app/pedidos/:orderId?payment=pending').replace(
      ':orderId',
      orderId
    );
    return { successUrl: success, failureUrl: failure, pendingUrl: pending };
  }

  private async paymentsConfig(tenantId: string): Promise<TenantPaymentsConfig> {
    const config = await this.store.getConfig(tenantId);
    return readPaymentsConfig(config, this.env.jwtSecret);
  }
}

export function readPaymentsConfig(config: TenantConfig | undefined, jwtSecret: string): TenantPaymentsConfig {
  const raw = (config?.config?.payments || {}) as TenantPaymentsConfig;
  const mp = { ...(raw.mercadopago || {}) };
  const stripe = { ...(raw.stripe || {}) };
  if (mp.accessToken) mp.accessToken = decryptSecret(mp.accessToken, jwtSecret);
  if (mp.webhookSecret) mp.webhookSecret = decryptSecret(mp.webhookSecret, jwtSecret);
  if (stripe.secretKey) stripe.secretKey = decryptSecret(stripe.secretKey, jwtSecret);
  if (stripe.webhookSecret) stripe.webhookSecret = decryptSecret(stripe.webhookSecret, jwtSecret);
  return {
    gateway: raw.gateway,
    allowManual: raw.allowManual !== false,
    currency: raw.currency,
    mercadopago: mp,
    stripe,
  };
}
