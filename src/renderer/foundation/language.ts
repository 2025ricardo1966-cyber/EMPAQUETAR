import { detectLanguage, type AppLanguage } from '../../i18n';

export function resolveUiLanguage(input: {
  preferredLanguage?: string | null;
  sessionLanguage?: string | null;
  browserLanguage?: string | null;
  tenantDefaultLanguage?: string | null;
}): AppLanguage {
  return detectLanguage({
    preferredLanguage: input.preferredLanguage || input.sessionLanguage || undefined,
    acceptLanguage: input.browserLanguage || undefined,
    tenantDefaultLanguage: input.tenantDefaultLanguage || undefined,
  });
}
