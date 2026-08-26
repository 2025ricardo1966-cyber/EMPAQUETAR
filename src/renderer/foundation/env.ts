export type FrontendEnvName = 'development' | 'production';

export function resolveFrontendEnv(mode?: string | null): FrontendEnvName {
  return String(mode || '').toLowerCase() === 'production' ? 'production' : 'development';
}

/** Public API base. Never put secrets in VITE_* vars. */
export function getApiBaseUrl(env: Record<string, string | undefined> = {}): string {
  const raw = env.VITE_API_URL || env.MASCAYL_API_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

export function joinUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
