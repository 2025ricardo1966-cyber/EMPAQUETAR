export type AppRole =
  | 'CUSTOMER'
  | 'OPERATOR'
  | 'ADMIN'
  | 'SUBADMIN'
  | 'ADMIN_PRINCIPAL'
  | 'SUPER_ADMIN';

export type RouteArea = 'studio' | 'public' | 'client' | 'workspace' | 'admin' | 'platform' | 'unknown';

export type AccessDecision = 'allow' | 'unauthenticated' | 'forbidden';

export function normalizePath(raw: string): string {
  const trimmed = String(raw || '/').split('?')[0];
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || '/';
}

export function classifyPath(raw: string): { area: RouteArea; path: string } {
  const path = normalizePath(raw);
  if (path === '/') return { area: 'studio', path };
  if (path === '/login' || path === '/verify') return { area: 'public', path };
  if (path === '/client' || path.startsWith('/client/')) return { area: 'client', path };
  if (path === '/workspace' || path.startsWith('/workspace/')) return { area: 'workspace', path };
  if (path === '/admin' || path.startsWith('/admin/')) return { area: 'admin', path };
  if (path === '/platform' || path.startsWith('/platform/')) return { area: 'platform', path };
  return { area: 'unknown', path };
}

export function decideAccess(area: RouteArea, role: AppRole | null | undefined): AccessDecision {
  if (area === 'studio' || area === 'public' || area === 'unknown') return 'allow';
  if (!role) return 'unauthenticated';
  if (area === 'client') return role === 'CUSTOMER' ? 'allow' : 'forbidden';
  if (area === 'workspace') {
    return role === 'ADMIN_PRINCIPAL' || role === 'SUBADMIN' || role === 'ADMIN' || role === 'OPERATOR' ? 'allow' : 'forbidden';
  }
  if (area === 'admin') {
    return role === 'ADMIN_PRINCIPAL' || role === 'SUBADMIN' || role === 'ADMIN' ? 'allow' : 'forbidden';
  }
  if (area === 'platform') return role === 'SUPER_ADMIN' ? 'allow' : 'forbidden';
  return 'unauthenticated';
}

/** Post-login landing for the hash EMPAQUETAR shell. Never returns studio `#/`. */
export function homePathForRole(role: AppRole | null | undefined): string {
  if (role === 'CUSTOMER') return '/client';
  if (role === 'SUPER_ADMIN') return '/platform';
  if (role === 'OPERATOR') return '/workspace';
  if (role === 'ADMIN' || role === 'SUBADMIN' || role === 'ADMIN_PRINCIPAL') return '/admin';
  return '/login';
}

/** Forbidden area: client token on admin → client; platform without SUPER_ADMIN → login. */
export function redirectPathForForbidden(area: RouteArea, role: AppRole | null | undefined): string {
  if (area === 'platform') return '/login';
  if (role === 'CUSTOMER') return '/client';
  return homePathForRole(role);
}

export function hashToPath(hash: string): string {
  const raw = String(hash || '').replace(/^#/, '');
  return normalizePath(raw || '/');
}

export function pathToHash(path: string): string {
  return `#${normalizePath(path)}`;
}
