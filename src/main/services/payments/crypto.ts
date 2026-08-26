import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const PREFIX = 'enc:v1:';

export function encryptSecret(plain: string, secret: string): string {
  const key = createHmac('sha256', 'mascayl-payments').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(value: string, secret: string): string {
  if (!value || !value.startsWith(PREFIX)) return value;
  const [ivB, tagB, dataB] = value.slice(PREFIX.length).split('.');
  const key = createHmac('sha256', 'mascayl-payments').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
}

export function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Stripe-compatible: `t=<unix>,v1=<hmac>` over `${t}.${payload}` */
export function signStripe(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const v1 = hmacSha256(secret, `${ts}.${payload}`);
  return `t=${ts},v1=${v1}`;
}

export function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parts = Object.fromEntries(
    String(signature || '')
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()) as [string, string])
  );
  if (!parts.t || !parts.v1) return false;
  const expected = hmacSha256(secret, `${parts.t}.${payload}`);
  return safeEqual(parts.v1, expected);
}

/** MercadoPago-style `ts=,v1=` over the raw body (sandbox) or manifest. */
export function signMercadoPago(payload: string, secret: string, ts = Date.now()): string {
  const v1 = hmacSha256(secret, `${ts}.${payload}`);
  return `ts=${ts},v1=${v1}`;
}

export function verifyMercadoPagoSignature(payload: string, signature: string, secret: string): boolean {
  const parts = Object.fromEntries(
    String(signature || '')
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()) as [string, string])
  );
  if (!parts.ts || !parts.v1) {
    return safeEqual(hmacSha256(secret, payload), String(signature || ''));
  }
  const expected = hmacSha256(secret, `${parts.ts}.${payload}`);
  return safeEqual(parts.v1, expected);
}
