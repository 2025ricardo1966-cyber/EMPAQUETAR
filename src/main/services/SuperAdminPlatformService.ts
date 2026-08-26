import { randomBytes, randomUUID } from 'crypto';
import type { AuthContext, Tenant } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { assertSuperAdmin } from '../../contracts/platform-domain';
import type { ControlPlaneStore, TenantActivationCodeRow } from '../../cloud/store/ControlPlaneStore';
import type { OrderService } from './OrderService';
import type { TraceService } from './TraceService';
import { resolveConfiguredCurrency } from '../../contracts/international-domain';

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateActivationCodePlain(): string {
  const bytes = randomBytes(16);
  let raw = '';
  for (let i = 0; i < 16; i += 1) raw += ALPHANUM[bytes[i] % ALPHANUM.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function obfuscateActivationCode(code: string): string {
  const compact = code.replace(/-/g, '');
  const prefix = compact.slice(0, 4) || 'XXXX';
  return `${prefix}-****-****-****`;
}

function iso(ms?: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function activationStatus(row: TenantActivationCodeRow, now: number): 'AVAILABLE' | 'USED' | 'EXPIRED' {
  if (row.usedAt) return 'USED';
  if (row.invalidatedAt || row.expiresAt <= now) return 'EXPIRED';
  return 'AVAILABLE';
}

export class SuperAdminPlatformService {
  constructor(
    private store: ControlPlaneStore,
    private orders: OrderService,
    private tracer: TraceService
  ) {}

  async createActivationCode(
    ctx: AuthContext,
    input: { expiresInDays?: number; ttlMs?: number; notes?: string }
  ): Promise<{ code: string; expiresAt: string; warning: string }> {
    assertSuperAdmin(ctx.roleId);
    const ttlMs =
      input.ttlMs != null && Number.isFinite(Number(input.ttlMs))
        ? Number(input.ttlMs)
        : Math.max(1, Number(input.expiresInDays || 30)) * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + ttlMs;
    let code = generateActivationCodePlain();
    for (let i = 0; i < 8; i += 1) {
      if (!(await this.store.getActivationCode(code))) break;
      code = generateActivationCodePlain();
    }
    await this.store.createActivationCode({
      id: randomUUID(),
      code,
      expiresAt,
      notes: input.notes?.trim() || null,
      generatedBy: ctx.userId,
    });
    return {
      code,
      expiresAt: iso(expiresAt) as string,
      warning: 'Este código solo se muestra una vez. Guardalo antes de continuar.',
    };
  }

  async listActivationCodes(ctx: AuthContext, now = Date.now()) {
    assertSuperAdmin(ctx.roleId);
    const rows = await this.store.listActivationCodes();
    const tenants = await this.store.listTenants();
    const byId = new Map(tenants.map((t) => [t.tenantId, t.name]));
    return rows.map((row) => ({
      id: row.id,
      code: obfuscateActivationCode(row.code),
      status: activationStatus(row, now),
      expiresAt: iso(row.expiresAt),
      usedAt: iso(row.usedAt),
      tenantName: row.tenantId ? byId.get(row.tenantId) || null : null,
      notes: row.notes || null,
    }));
  }

  async invalidateActivationCode(ctx: AuthContext, id: string): Promise<{ ok: true }> {
    assertSuperAdmin(ctx.roleId);
    const row = await this.store.getActivationCodeById(id);
    if (!row) throw new AccessDeniedError();
    if (row.usedAt) throw new Error('CODE_ALREADY_USED');
    await this.store.invalidateActivationCode(id, Date.now());
    return { ok: true };
  }

  async listTenants(
    ctx: AuthContext,
    query: { status?: string; search?: string; page?: number; limit?: number }
  ) {
    assertSuperAdmin(ctx.roleId);
    let rows = [];
    for (const tenant of await this.store.listTenants()) {
      rows.push(await this.toListItem(tenant));
    }
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.adminEmail.toLowerCase().includes(q)
      );
    }
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(200, Math.max(1, query.limit || rows.length || 50));
    const start = (page - 1) * limit;
    return rows.slice(start, start + limit);
  }

  async getTenantDetail(ctx: AuthContext, tenantId: string) {
    assertSuperAdmin(ctx.roleId);
    const tenant = await this.store.getTenant(tenantId);
    if (!tenant) throw new AccessDeniedError();
    const list = await this.toListItem(tenant);
    const orders = await this.orders.peekOrders(tenantId);
    const users = await this.store.listUsers(tenantId);
    const customers = await this.store.listCustomers(tenantId);
    const admin = users.find((u) => u.roleId === 'ADMIN_PRINCIPAL');
    return {
      ...list,
      adminName: admin?.name || admin?.displayCode || '',
      currency: resolveConfiguredCurrency({ currency: tenant.currency || tenant.identity?.currency }),
      suspensionReason: tenant.suspensionReason || tenant.restriction?.reason || null,
      completedOrdersCount: orders.filter((o) => o.status === 'completed' || o.status === 'delivered').length,
      customersCount: customers.length,
    };
  }

  async platformStats(ctx: AuthContext, now = Date.now()) {
    assertSuperAdmin(ctx.roleId);
    const tenants = await this.store.listTenants();
    const codes = await this.store.listActivationCodes();
    return {
      tenants: {
        total: tenants.length,
        active: tenants.filter((t) => t.status === 'ACTIVE').length,
        suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
      },
      activationCodes: {
        available: codes.filter((c) => activationStatus(c, now) === 'AVAILABLE').length,
        used: codes.filter((c) => activationStatus(c, now) === 'USED').length,
        expired: codes.filter((c) => activationStatus(c, now) === 'EXPIRED').length,
      },
    };
  }

  async evaluateDeadlines(ctx: AuthContext, tenantId?: string) {
    assertSuperAdmin(ctx.roleId);
    return this.tracer.evaluateDeadlines(ctx, Date.now(), tenantId);
  }

  private async toListItem(tenant: Tenant) {
    const config = await this.store.getConfig(tenant.tenantId);
    const users = await this.store.listUsers(tenant.tenantId);
    const orders = await this.orders.peekOrders(tenant.tenantId);
    const admin = users.find((u) => u.roleId === 'ADMIN_PRINCIPAL');
    return {
      id: tenant.tenantId,
      tenantId: tenant.tenantId,
      name: tenant.name,
      status: tenant.status,
      contractualStatus: tenant.contractualStatus,
      rubro: config?.rubro || 'CUSTOM',
      setupDone: Boolean(config?.setupDone),
      adminEmail: admin?.email || admin?.login || '',
      activatedAt: iso(tenant.activatedAt),
      suspendedAt: iso(tenant.suspendedAt || tenant.restriction?.at),
      lastActivityAt: iso(tenant.lastAccessAt),
      lastAccessAt: tenant.lastAccessAt,
      ordersCount: orders.length,
      orderCount: orders.length,
      usersCount: users.length,
      userCount: users.length,
      productVersion: tenant.productVersion,
      releaseChannel: tenant.releaseChannel,
      restrictionReason: tenant.suspensionReason || tenant.restriction?.reason,
      restrictionAt: tenant.suspendedAt || tenant.restriction?.at,
    };
  }
}
