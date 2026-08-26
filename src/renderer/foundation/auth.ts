import type { AppRole } from './router';

export type AuthUser = {
  userId: string;
  tenantId: string;
  roleId: AppRole;
  permissions: string[];
  preferredLanguage?: string;
  lang?: string;
  email?: string;
  name?: string;
};

export type AuthSnapshot = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
};

export function mapSessionUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const session = (row.session && typeof row.session === 'object' ? row.session : row) as Record<string, unknown>;
  const userId = String(session.userId || row.userId || '');
  const roleId = String(session.roleId || row.roleId || '') as AppRole;
  if (!userId || !roleId) return null;
  const perms = session.permissions || row.permissions;
  return {
    userId,
    tenantId: String(session.tenantId || row.tenantId || ''),
    roleId,
    permissions: Array.isArray(perms) ? perms.map(String) : [],
    preferredLanguage: session.preferredLanguage ? String(session.preferredLanguage) : undefined,
    lang: session.lang ? String(session.lang) : undefined,
    email: row.email ? String(row.email) : undefined,
    name: row.name ? String(row.name) : undefined,
  };
}

export function tokensFromLogin(raw: unknown): { accessToken: string; refreshToken: string; tenantId: string | null; user: AuthUser | null } {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const accessToken = String(row.accessToken || row.token || '');
  const refreshToken = String(row.refreshToken || '');
  const user = mapSessionUser(row.user || row.session || row);
  const tenantId = user?.tenantId || (row.tenantId ? String(row.tenantId) : null);
  return { accessToken, refreshToken, tenantId, user };
}
