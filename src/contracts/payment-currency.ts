import { normalizeCurrencyCode } from './international-domain';

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

function safeCurrency(raw?: string | null): string | undefined {
  try {
    return normalizeCurrencyCode(raw);
  } catch {
    return undefined;
  }
}

/** ISO 4217. PAYMENT_CURRENCY overrides tenant, then tenant, then USD. Never defaults to ARS. */
export function resolveChargeCurrency(input: { tenantCurrency?: string | null; envCurrency?: string | null }): string {
  return safeCurrency(input.envCurrency) || safeCurrency(input.tenantCurrency) || 'USD';
}

export function toStripeIntegerAmount(amount: number, currency: string): number {
  const code = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(amount);
  return Math.round(amount * 100);
}

export function fromStripeIntegerAmount(amount: number, currency: string): number {
  const code = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return amount;
  return Math.round((amount / 100) * 100) / 100;
}
