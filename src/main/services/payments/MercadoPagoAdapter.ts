import { randomUUID } from 'crypto';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  ParsedPaymentEvent,
  PaymentGatewayAdapter,
} from '../../../contracts/payment-gateway';
import { signMercadoPago, verifyMercadoPagoSignature } from './crypto';

export class MercadoPagoAdapter implements PaymentGatewayAdapter {
  kind = 'MERCADOPAGO' as const;
  created: CheckoutResult[] = [];

  constructor(
    private accessToken: string,
    private live = false
  ) {}

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    if (this.live && this.accessToken && !this.accessToken.includes('TEST')) {
      const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ title: params.description, quantity: 1, unit_price: params.amount, currency_id: params.currency }],
          payer: { email: params.customerEmail },
          external_reference: params.orderId,
          back_urls: { success: params.successUrl, failure: params.failureUrl, pending: params.pendingUrl },
          auto_return: 'approved',
        }),
      });
      const body = (await res.json()) as { id?: string; init_point?: string; sandbox_init_point?: string; message?: string };
      if (!res.ok || !body.id) throw new Error(body.message || 'MP_CHECKOUT_FAILED');
      return { checkoutUrl: body.init_point || body.sandbox_init_point || '', gatewayOrderId: body.id };
    }
    const gatewayOrderId = `pref_${randomUUID().slice(0, 12)}`;
    const result: CheckoutResult = {
      checkoutUrl: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${gatewayOrderId}`,
      gatewayOrderId,
    };
    this.created.push(result);
    return result;
  }

  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    return verifyMercadoPagoSignature(payload, signature, secret);
  }

  parseWebhookEvent(payload: unknown): ParsedPaymentEvent {
    const raw = payload as Record<string, unknown>;
    const data = (raw.data || raw) as Record<string, unknown>;
    const nested = (data.object || data) as Record<string, unknown>;
    const statusRaw = String(raw.sandboxStatus || raw.status || nested.status || '').toLowerCase();
    let status: ParsedPaymentEvent['status'] = 'pending';
    if (statusRaw.includes('approv')) status = 'approved';
    else if (statusRaw.includes('reject') || statusRaw.includes('fail')) status = 'rejected';
    else if (statusRaw.includes('cancel')) status = 'cancelled';
    const amount = Number(raw.amount || nested.transaction_amount || nested.amount || 0);
    return {
      gatewayPaymentId: String(nested.id || data.id || raw.gatewayPaymentId || ''),
      gatewayOrderId: String(raw.gatewayOrderId || nested.preference_id || nested.external_reference || raw.external_reference || ''),
      status,
      amount,
      currency: String(raw.currency || nested.currency_id || 'ARS'),
      eventId: String(raw.id || raw.gatewayEventId || nested.id || randomUUID()),
      eventType: String(raw.type || raw.action || raw.eventType || 'payment.updated'),
    };
  }
}

export { signMercadoPago };
