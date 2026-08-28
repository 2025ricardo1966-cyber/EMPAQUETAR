import { randomUUID } from 'crypto';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  ParsedPaymentEvent,
  PaymentGatewayAdapter,
} from '../../../contracts/payment-gateway';
import { fromStripeIntegerAmount, toStripeIntegerAmount } from '../../../contracts/payment-currency';
import { signStripe, verifyStripeSignature } from './crypto';

export class StripeAdapter implements PaymentGatewayAdapter {
  kind = 'STRIPE' as const;
  paymentIntents: Array<{ id: string; amount: number; currency: string; status: string; tenantId?: string; orderId?: string }> = [];

  constructor(
    private secretKey: string,
    private live = false,
    private mode: 'checkout' | 'payment_intent' = 'checkout'
  ) {}

  private get remoteEnabled(): boolean {
    return !!this.secretKey && this.secretKey.startsWith('sk_');
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const currency = String(params.currency || 'USD').toUpperCase();
    const amountInteger = toStripeIntegerAmount(params.amount, currency);
    const metadata = {
      tenantId: params.tenantId,
      orderId: params.orderId,
      customerEmail: params.customerEmail,
    };
    if (this.remoteEnabled) {
      if (this.mode === 'payment_intent') return this.createRemotePaymentIntent(params, currency, amountInteger, metadata);
      return this.createRemoteCheckoutSession(params, currency, amountInteger, metadata);
    }
    const gatewayOrderId = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    this.paymentIntents.push({
      id: gatewayOrderId,
      amount: amountInteger,
      currency: currency.toLowerCase(),
      status: 'requires_payment_method',
      tenantId: params.tenantId,
      orderId: params.orderId,
    });
    return {
      checkoutUrl: `https://checkout.stripe.com/c/pay/${gatewayOrderId}`,
      gatewayOrderId,
    };
  }

  async refund(input: { paymentIntentId: string; amount?: number; currency?: string }): Promise<{ refundId: string; status: string }> {
    if (this.remoteEnabled) {
      const body = new URLSearchParams({ payment_intent: input.paymentIntentId });
      if (input.amount != null && input.currency) {
        body.set('amount', String(toStripeIntegerAmount(input.amount, input.currency)));
      }
      const res = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = (await res.json()) as { id?: string; status?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message || 'STRIPE_REFUND_FAILED');
      return { refundId: String(json.id || ''), status: String(json.status || 'pending') };
    }
    const found = this.paymentIntents.find((p) => p.id === input.paymentIntentId);
    if (found) found.status = 'refunded';
    return { refundId: `re_${randomUUID().replace(/-/g, '').slice(0, 24)}`, status: 'succeeded' };
  }

  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    return verifyStripeSignature(payload, signature, secret);
  }

  parseWebhookEvent(payload: unknown): ParsedPaymentEvent {
    const raw = payload as Record<string, unknown>;
    const type = String(raw.type || raw.eventType || '');
    const obj = ((raw.data as Record<string, unknown> | undefined)?.object || raw.data || raw) as Record<string, unknown>;
    const meta = (obj.metadata || raw.metadata || {}) as Record<string, unknown>;
    let status: ParsedPaymentEvent['status'] = 'pending';
    if (
      type.includes('succeeded') ||
      type === 'checkout.session.completed' ||
      raw.sandboxStatus === 'approved' ||
      obj.status === 'succeeded' ||
      obj.payment_status === 'paid'
    ) {
      status = 'approved';
    }
    if (type.includes('failed') || raw.sandboxStatus === 'rejected' || obj.status === 'requires_payment_method') {
      status = 'rejected';
    }
    if (type.includes('canceled') || type.includes('cancelled') || type.includes('refund') || raw.sandboxStatus === 'cancelled') {
      status = 'cancelled';
    }
    if (raw.sandboxStatus === 'approved' || raw.sandboxStatus === 'rejected' || raw.sandboxStatus === 'cancelled' || raw.sandboxStatus === 'pending') {
      status = raw.sandboxStatus as ParsedPaymentEvent['status'];
    }
    const currency = String(obj.currency || raw.currency || meta.currency || 'USD').toUpperCase();
    const rawAmount = obj.amount_received ?? obj.amount_total ?? obj.amount ?? raw.amount;
    const amount =
      raw.amount != null && !obj.amount_received && !obj.amount_total && !obj.amount
        ? Number(raw.amount)
        : fromStripeIntegerAmount(Number(rawAmount || 0), currency);
    return {
      gatewayPaymentId: String(obj.payment_intent || obj.id || raw.gatewayPaymentId || ''),
      gatewayOrderId: String(raw.gatewayOrderId || meta.orderId || obj.payment_intent || obj.id || ''),
      status,
      amount,
      currency,
      eventId: String(raw.id || raw.gatewayEventId || randomUUID()),
      eventType: type || 'payment_intent.succeeded',
      tenantId: meta.tenantId ? String(meta.tenantId) : undefined,
      orderId: meta.orderId ? String(meta.orderId) : undefined,
    };
  }

  private async createRemoteCheckoutSession(
    params: CreateCheckoutParams,
    currency: string,
    amountInteger: number,
    metadata: Record<string, string>
  ): Promise<CheckoutResult> {
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: params.successUrl,
      cancel_url: params.failureUrl,
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': params.description,
      'line_items[0][price_data][unit_amount]': String(amountInteger),
      'line_items[0][quantity]': '1',
      'payment_intent_data[metadata][orderId]': metadata.orderId,
      'payment_intent_data[metadata][tenantId]': metadata.tenantId,
      'payment_intent_data[metadata][customerEmail]': metadata.customerEmail,
      'metadata[orderId]': metadata.orderId,
      'metadata[tenantId]': metadata.tenantId,
      customer_email: params.customerEmail,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as { id?: string; url?: string; payment_intent?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message || 'STRIPE_CHECKOUT_FAILED');
    return { checkoutUrl: json.url || '', gatewayOrderId: String(json.payment_intent || json.id), gatewayPaymentId: json.payment_intent };
  }

  private async createRemotePaymentIntent(
    params: CreateCheckoutParams,
    currency: string,
    amountInteger: number,
    metadata: Record<string, string>
  ): Promise<CheckoutResult> {
    const body = new URLSearchParams({
      amount: String(amountInteger),
      currency: currency.toLowerCase(),
      receipt_email: params.customerEmail,
      'automatic_payment_methods[enabled]': 'true',
      'metadata[orderId]': metadata.orderId,
      'metadata[tenantId]': metadata.tenantId,
      'metadata[customerEmail]': metadata.customerEmail,
    });
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as { id?: string; client_secret?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message || 'STRIPE_PAYMENT_INTENT_FAILED');
    return {
      checkoutUrl: params.successUrl,
      gatewayOrderId: String(json.id || ''),
      gatewayPaymentId: json.id,
      clientSecret: json.client_secret,
    };
  }
}

export { signStripe };
