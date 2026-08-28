export type PaymentGatewayKind = 'MERCADOPAGO' | 'STRIPE' | 'MANUAL';

export interface CreateCheckoutParams {
  orderId: string;
  tenantId: string;
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  gatewayOrderId: string;
  gatewayPaymentId?: string;
  clientSecret?: string;
}

export interface ParsedPaymentEvent {
  gatewayPaymentId: string;
  gatewayOrderId: string;
  status: 'approved' | 'pending' | 'rejected' | 'cancelled';
  amount: number;
  currency: string;
  eventId: string;
  eventType: string;
  tenantId?: string;
  orderId?: string;
}

export interface PaymentGatewayAdapter {
  kind: 'MERCADOPAGO' | 'STRIPE';
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
  verifyWebhook(payload: string, signature: string, secret: string): boolean;
  parseWebhookEvent(payload: unknown): ParsedPaymentEvent;
}

export interface PaymentAttemptRecord {
  id: string;
  tenantId: string;
  orderId: string;
  paymentRecordId: string;
  gateway: PaymentGatewayKind;
  gatewayEventId: string;
  eventType: string;
  status: string;
  rawPayload: unknown;
  processedAt: number;
}

export interface TenantPaymentsConfig {
  gateway?: PaymentGatewayKind;
  allowManual?: boolean;
  /** ISO 4217. Optional per-tenant override; not hardcoded to a single market. */
  currency?: string;
  mercadopago?: { accessToken?: string; publicKey?: string; webhookSecret?: string };
  stripe?: { secretKey?: string; publishableKey?: string; webhookSecret?: string };
}
