import es from './es.json';
import pt from './pt.json';
import en from './en.json';

export const DEFAULT_LANGUAGE = 'es';
export const SUPPORTED_LANGUAGES = ['es', 'pt', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number] | string;

type Catalog = Record<string, unknown>;

const CATALOGS: Record<string, Catalog> = {
  es: es as Catalog,
  pt: pt as Catalog,
  en: en as Catalog,
};

function lookup(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function normalizeLanguage(raw?: string | null): string {
  if (!raw) return DEFAULT_LANGUAGE;
  const primary = String(raw).trim().toLowerCase().split(/[-_,;]/)[0];
  if (!primary) return DEFAULT_LANGUAGE;
  return primary;
}

export function parseAcceptLanguage(header?: string | null): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.trim();
  if (!first || first === '*') return undefined;
  const code = normalizeLanguage(first);
  if (!/^[a-z]{2,8}$/.test(code)) return undefined;
  return code;
}

export function detectLanguage(input: {
  preferredLanguage?: string | null;
  acceptLanguage?: string | null;
  tenantDefaultLanguage?: string | null;
}): string {
  if (input.preferredLanguage) return normalizeLanguage(input.preferredLanguage);
  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return fromHeader;
  if (input.tenantDefaultLanguage) return normalizeLanguage(input.tenantDefaultLanguage);
  return DEFAULT_LANGUAGE;
}

export function interpolate(template: string, vars?: Record<string, string | number | boolean | null | undefined>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

/** Translate a catalog key. Missing keys and unknown langs fall back to Spanish. */
export function t(
  key: string,
  lang?: string | null,
  vars?: Record<string, string | number | boolean | null | undefined>
): string {
  const code = normalizeLanguage(lang);
  const catalog = CATALOGS[code] || CATALOGS[DEFAULT_LANGUAGE];
  const value = lookup(catalog, key);
  const fallback = lookup(CATALOGS[DEFAULT_LANGUAGE], key);
  const raw = typeof value === 'string' ? value : typeof fallback === 'string' ? fallback : key;
  return interpolate(raw, vars);
}

export function getCatalog(lang?: string | null): Catalog {
  return CATALOGS[normalizeLanguage(lang)] || CATALOGS[DEFAULT_LANGUAGE];
}

export function catalogHas(lang: string, key: string): boolean {
  return typeof lookup(CATALOGS[normalizeLanguage(lang)] || {}, key) === 'string';
}

export function loadI18nCatalogs(): { languages: string[]; baseKeys: number } {
  const walk = (obj: unknown): number => {
    if (typeof obj === 'string') return 1;
    if (!obj || typeof obj !== 'object') return 0;
    return Object.values(obj as Record<string, unknown>).reduce((n: number, v) => n + walk(v), 0);
  };
  return { languages: Object.keys(CATALOGS), baseKeys: walk(CATALOGS.es) };
}

loadI18nCatalogs();
