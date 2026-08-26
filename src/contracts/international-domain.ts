/**
 * Launch defaults are configuration, not structural.
 * Argentina / es / ARS may seed a new tenant; they must not reject other values.
 */
export const LAUNCH_DEFAULTS = {
  country: 'AR',
  language: 'es',
  currency: 'ARS',
  timezone: 'UTC',
} as const;

export type ContactFields = {
  phone?: string;
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  address?: string;
};

export type CommercialContext = {
  defaultMarket?: string;
  defaultCurrency?: string;
  defaultLanguage?: string;
};

/** ISO 3166-1 alpha-2 when provided. Empty is allowed. */
export function normalizeCountryCode(raw?: string | null): string | undefined {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return undefined;
  if (!/^[A-Z]{2}$/.test(v)) throw new Error('INVALID_COUNTRY');
  return v;
}

/** BCP-47 primary tag (es, pt, en, …). Empty allowed. */
export function normalizeLanguageTag(raw?: string | null): string | undefined {
  const v = String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
  if (!v) return undefined;
  if (!/^[a-z]{2,8}$/.test(v)) throw new Error('INVALID_LANGUAGE');
  return v;
}

/** ISO 4217 alphabetic. Empty allowed. Any valid code — not an ARS-only list. */
export function normalizeCurrencyCode(raw?: string | null): string | undefined {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return undefined;
  if (!/^[A-Z]{3}$/.test(v)) throw new Error('INVALID_CURRENCY');
  return v;
}

export function normalizePostalCode(raw?: string | null): string | undefined {
  const v = String(raw || '').trim();
  return v || undefined;
}

export function normalizePhone(raw?: string | null): string | undefined {
  const v = String(raw || '').trim();
  return v || undefined;
}

export function normalizeRegion(raw?: string | null): string | undefined {
  const v = String(raw || '').trim();
  return v || undefined;
}

export function sanitizeContact(input: ContactFields): ContactFields {
  return {
    phone: normalizePhone(input.phone),
    country: input.country != null && String(input.country).trim() ? normalizeCountryCode(input.country) : undefined,
    region: normalizeRegion(input.region),
    city: input.city != null ? String(input.city).trim() || undefined : undefined,
    postalCode: normalizePostalCode(input.postalCode),
    address: input.address != null ? String(input.address).trim() || undefined : undefined,
  };
}

/** Display/persist fallback for tenants that never set currency. Launch default only. */
export function resolveConfiguredCurrency(config?: { currency?: string; commercial?: CommercialContext } | null): string {
  return normalizeCurrencyCode(config?.currency || config?.commercial?.defaultCurrency) || LAUNCH_DEFAULTS.currency;
}

export function resolveConfiguredLanguage(config?: { defaultLanguage?: string; commercial?: CommercialContext } | null): string {
  return normalizeLanguageTag(config?.defaultLanguage || config?.commercial?.defaultLanguage) || LAUNCH_DEFAULTS.language;
}

export function isLaunchDefaultMarket(country?: string, currency?: string, language?: string): boolean {
  return (
    (country || LAUNCH_DEFAULTS.country) === LAUNCH_DEFAULTS.country &&
    (currency || LAUNCH_DEFAULTS.currency) === LAUNCH_DEFAULTS.currency &&
    (language || LAUNCH_DEFAULTS.language) === LAUNCH_DEFAULTS.language
  );
}
