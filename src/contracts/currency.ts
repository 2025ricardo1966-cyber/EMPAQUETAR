/** ISO 4217 display helpers. Unknown codes stay valid — never assume ARS. */
const SYMBOLS: Record<string, string> = {
  ARS: '$',
  USD: 'US$',
  EUR: '€',
  BRL: 'R$',
  MXN: 'MX$',
  CLP: '$',
  UYU: '$',
  GBP: '£',
  PYG: '₲',
};

export function currencySymbol(code?: string | null): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  return SYMBOLS[c] || c;
}

export function formatMoney(amount: number, currency?: string | null, locale?: string): string {
  const code = String(currency || '').trim().toUpperCase() || 'XXX';
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    }).format(Number(amount) || 0);
  } catch {
    const symbol = currencySymbol(code);
    return `${symbol} ${Number(amount) || 0}`.trim();
  }
}
