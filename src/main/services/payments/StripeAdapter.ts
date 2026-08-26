import { randomUUID } from 'crypto';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  ParsedPaymentEvent,
  PaymentGatewayAdapter,
} from '../../../contracts/payment-gateway';
import { signStripe, verifyStripeSignature } from './crypto';

export class StripeAdapter implements PaymentGatewayAdapter {
  kind = 'STRIPE' as const;
  paymentIntents: Array<{ id: string; amount: number; currency: string; status: string }> = [];

  constructor(
    private secretKey: string,
    private live = false
  ) {}

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const amountCents = Math.round(params.amount * 100);
    if (this.live && this.secretKey && this.secretKey.startsWith('sk_live')) {
      const body = new URLSearchParams({
        mode: 'payment',
        success_url: params.successUrl,
        cancel_url: params.failureUrl,
        'line_items[0][price_data][currency]': params.currency.toLowerCase(),
        'line_items[0][price_data][product_data][name]': params.description,
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][quantity]': '1',
        'payment_intent_data[metadata][orderId]': params.orderId,
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
    const gatewayOrderId = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    this.paymentIntents.push({ id: gatewayOrderId, amount: amountCents, currency: params.currency.toLowerCase(), status: 'requires_payment_method' });
    const result: CheckoutResult = {
      checkoutUrl: `https://checkout.stripe.com/c/pay/${gatewayOrderId}`,
      gatewayOrderId,
    };
    return result;
  }

  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    return verifyStripeSignature(payload, signature, secret);
  }

  parseWebhookEvent(payload: unknown): ParsedPaymentEvent {
    const raw = payload as Record<string, unknown>;
    const type = String(raw.type || raw.eventType || '');
    const obj = ((raw.data as Record<string, unknown> | undefined)?.object || raw.data || raw) as Record<string, unknown>;
    const meta = (obj.metadata || {}) as Record<string, unknown>;
    let status: ParsedPaymentEvent['status'] = 'pending';
    if (type.includes('succeeded') || raw.sandboxStatus === 'approved' || obj.status === 'succeeded') status = 'approved';
    if (type.includes('failed') || raw.sandboxStatus === 'rejected' || obj.status === 'requires_payment_method') status = 'rejected';
    if (type.includes('canceled') || type.includes('cancelled') || raw.sandboxStatus === 'cancelled') status = 'cancelled';
    if (raw.sandboxStatus === 'approved' || raw.sandboxStatus === 'rejected' || raw.sandboxStatus === 'cancelled' || raw.sandboxStatus === 'pending') {
      status = raw.sandboxStatus as ParsedPaymentEvent['status'];
    }
    const amount =
      raw.amount != null ? Number(raw.amount) : Number(obj.amount_received || obj.amount || 0) / (obj.amount != null ? 100 : 1);
    return {
      gatewayPaymentId: String(obj.id || raw.gatewayPaymentId || ''),
      gatewayOrderId: String(raw.gatewayOrderId || meta.gatewayOrderId || obj.id || ''),
      status,
      amount,
      currency: String(obj.currency || raw.currency || 'USD').toUpperCase(),
      eventId: String(raw.id || raw.gatewayEventId || randomUUID()),
      eventType: type || 'payment_intent.succeeded',
    };
  }
}

export { signStripe };
