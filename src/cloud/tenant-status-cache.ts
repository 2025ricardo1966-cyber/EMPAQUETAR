import type { TenantStatus } from '../contracts/admin-domain';

const TTL_MS = 2_000;
const cache = new Map<string, { status: TenantStatus; exp: number }>();

export function forgetTenantStatus(tenantId: string): void {
  cache.delete(tenantId);
}

export function rememberTenantStatus(tenantId: string, status: TenantStatus, now = Date.now()): void {
  cache.set(tenantId, { status, exp: now + TTL_MS });
}

export async function getCachedTenantStatus(
  tenantId: string,
  loader: () => Promise<TenantStatus | undefined>,
  now = Date.now()
): Promise<TenantStatus | undefined> {
  const hit = cache.get(tenantId);
  if (hit && hit.exp > now) return hit.status;
  const status = await loader();
  if (status) rememberTenantStatus(tenantId, status, now);
  return status;
}
