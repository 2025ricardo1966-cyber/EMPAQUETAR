import { randomBytes, randomUUID } from 'crypto';
import type { AuthContext, PersistedUser, PublicUser, Tenant } from '../../contracts/admin-domain';
import {
  AccessDeniedError,
  ALL_PERMISSIONS,
  normalizeTenant,
  toPublicUser,
} from '../../contracts/admin-domain';
import type {
  PlatformAuditEntry,
  TenantDashboard,
  TenantLifecycleStatus,
  TenantListFilter,
  TenantOperation,
  TenantRestrictionNotice,
} from '../../contracts/platform-domain';
import {
  ACCESS_POLICY_BY_STATUS,
  assertSuperAdmin,
  operationAllowed,
  PLATFORM_PERMISSIONS,
  PLATFORM_SCOPE,
  policyForStatus,
  restrictionNoticeForPrincipal,
  TenantRestrictedError,
  TENANT_SUSPENDED_MESSAGE,
} from '../../contracts/platform-domain';
import {
  customerProductUi,
  defaultProductMetadata,
  workshopProductUi,
  type ProductMetadata,
} from '../../contracts/product-version';
import type { PlatformRepository } from './PlatformRepository';
import { hashPassword, verifyPassword } from './passwordHash';
import type { OrderService } from './OrderService';
import { computeDeadline } from '../../contracts/order-lifecycle';
import { DEFAULT_DEADLINE_POLICY } from '../../contracts/order-domain';
import type { AdminRepository } from './AdminRepository';
import type { TraceService } from './TraceService';
import { forgetTenantStatus } from '../../cloud/tenant-status-cache';

export class TenantControlService {
  private sessions = new Map<string, AuthContext>();
  private tracer?: TraceService;

  constructor(
    private platform: PlatformRepository,
    private orders?: OrderService,
    private localAdmin?: AdminRepository
  ) {}

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async ensureSuperAdmin(input: { login: string; password: string }): Promise<{ user: PublicUser; created: boolean }> {
    const existing = await this.platform.listSuperAdmins();
    if (existing.length > 0) return { user: toPublicUser(existing[0]), created: false };
    return { user: await this.bootstrapSuperAdmin(input), created: true };
  }

  async bootstrapSuperAdmin(input: { login: string; password: string }): Promise<PublicUser> {
    const existing = await this.platform.listSuperAdmins();
    if (existing.length > 0) throw new Error('SUPER_ADMIN already exists');
    const now = Date.now();
    const user: PersistedUser = {
      userId: randomUUID(),
      tenantId: PLATFORM_SCOPE,
      login: input.login.trim(),
      displayCode: 'SUPER-ADMIN',
      roleId: 'SUPER_ADMIN',
      permissions: [...PLATFORM_PERMISSIONS],
      status: 'active',
      password: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    };
    await this.platform.saveSuperAdmin(user);
    await this.platformAudit(user.userId, PLATFORM_SCOPE, 'platform.bootstrap', undefined, undefined, undefined, 'ok');
    return toPublicUser(user);
  }

  async loginSuperAdmin(login: string, password: string): Promise<{ token: string; session: AuthContext; user: PublicUser }> {
    const user = await this.platform.getSuperAdminByLogin(login);
    if (!user || user.status !== 'active' || user.roleId !== 'SUPER_ADMIN') throw new AccessDeniedError();
    const ok = await verifyPassword(password, user.password);
    if (!ok) throw new AccessDeniedError();
    const token = randomBytes(32).toString('hex');
    const session: AuthContext = {
      token,
      userId: user.userId,
      tenantId: PLATFORM_SCOPE,
      roleId: 'SUPER_ADMIN',
      permissions: [...PLATFORM_PERMISSIONS],
    };
    this.sessions.set(token, session);
    await this.platformAudit(user.userId, PLATFORM_SCOPE, 'platform.login', undefined, undefined, undefined, 'ok');
    return { token, session, user: toPublicUser(user) };
  }

  resolve(token?: string): AuthContext | undefined {
    if (!token) return undefined;
    return this.sessions.get(token);
  }

  async requireSuperAdmin(token: string): Promise<AuthContext> {
    const ctx = this.sessions.get(token);
    if (!ctx) throw new AccessDeniedError();
    assertSuperAdmin(ctx.roleId);
    const user = await this.platform.getSuperAdmin(ctx.userId);
    if (!user || user.status !== 'active') throw new AccessDeniedError();
    return ctx;
  }

  async registerLocalTenant(tenant: Tenant): Promise<void> {
    await this.platform.saveTenant(normalizeTenant(tenant));
  }

  async getTenantStatus(tenantId: string): Promise<TenantLifecycleStatus> {
    const tenant = await this.requireTenantRecord(tenantId);
    return tenant.status;
  }

  async getTenant(ctx: AuthContext, tenantId: string): Promise<Tenant> {
    this.assertCanReadTenant(ctx, tenantId);
    return this.requireTenantRecord(tenantId);
  }

  async listTenants(ctx: AuthContext, filter: TenantListFilter = {}): Promise<TenantDashboard[]> {
    assertSuperAdmin(ctx.roleId);
    const tenants = await this.platform.listTenants();
    const dashboards: TenantDashboard[] = [];
    for (const tenant of tenants) {
      dashboards.push(await this.toDashboard(tenant));
    }
    return this.applyFilter(dashboards, filter);
  }

  async getTenantDashboard(ctx: AuthContext, tenantId: string): Promise<TenantDashboard> {
    assertSuperAdmin(ctx.roleId);
    return this.toDashboard(await this.requireTenantRecord(tenantId));
  }

  async activateTenant(ctx: AuthContext, tenantId: string, reason?: string): Promise<Tenant> {
    return this.transition(ctx, tenantId, 'ACTIVE', reason, 'ok');
  }

  async suspendTenant(ctx: AuthContext, tenantId: string, reason: string, reasonCategory = 'operational'): Promise<Tenant> {
    if (!reason?.trim()) throw new Error('reason is required');
    const current = await this.requireTenantRecord(tenantId);
    if (current.status !== 'ACTIVE') throw new Error('TENANT_NOT_ACTIVE');
    return this.transition(ctx, tenantId, 'SUSPENDED', reason.trim(), 'restricted', reasonCategory);
  }

  async reactivateTenant(ctx: AuthContext, tenantId: string): Promise<Tenant> {
    const current = await this.requireTenantRecord(tenantId);
    if (current.status !== 'SUSPENDED') throw new Error('TENANT_NOT_SUSPENDED');
    return this.transition(ctx, tenantId, 'ACTIVE', 'reactivated', 'ok', 'operational');
  }

  async blockTenant(ctx: AuthContext, tenantId: string, reason: string, reasonCategory = 'contractual'): Promise<Tenant> {
    if (!reason?.trim()) throw new Error('reason is required');
    return this.transition(ctx, tenantId, 'BLOCKED', reason.trim(), 'blocked', reasonCategory);
  }

  async unblockTenant(ctx: AuthContext, tenantId: string, reason?: string): Promise<Tenant> {
    const current = await this.requireTenantRecord(tenantId);
    const restore =
      current.restriction?.previousStatus === 'SETUP_INCOMPLETE' ? 'SETUP_INCOMPLETE' : 'ACTIVE';
    return this.transition(ctx, tenantId, restore, reason?.trim() || 'unblocked', restore === 'ACTIVE' ? 'ok' : 'ok');
  }

  async deactivateTenant(ctx: AuthContext, tenantId: string, reason: string): Promise<Tenant> {
    if (!reason?.trim()) throw new Error('reason is required');
    return this.transition(ctx, tenantId, 'DEACTIVATED', reason.trim(), 'blocked', 'service');
  }

  async assertOperation(tenantId: string, operation: TenantOperation, roleId?: string): Promise<Tenant> {
    const tenant = await this.requireTenantRecord(tenantId);
    const policy = policyForStatus(tenant.status);
    if (!operationAllowed(policy, operation)) {
      throw new TenantRestrictedError(tenant.status);
    }
    if (roleId === 'CUSTOMER' && !policy.allowCustomerAccess && operation !== 'admin.limited_read') {
      throw new TenantRestrictedError(tenant.status);
    }
    return tenant;
  }

  getPolicy(status: TenantLifecycleStatus) {
    return ACCESS_POLICY_BY_STATUS[status];
  }

  async getRestrictionNotice(tenantId: string): Promise<TenantRestrictionNotice> {
    const tenant = await this.requireTenantRecord(tenantId);
    return restrictionNoticeForPrincipal(tenant);
  }

  async productMetadata(): Promise<ProductMetadata> {
    const override = await this.platform.getProductOverride();
    const base = defaultProductMetadata();
    return {
      ...base,
      releaseChannel: (override?.releaseChannel as ProductMetadata['releaseChannel']) || base.releaseChannel,
      versionStatus: (override?.versionStatus as ProductMetadata['versionStatus']) || base.versionStatus,
    };
  }

  async getWorkshopProductUi() {
    return workshopProductUi(await this.productMetadata());
  }

  async getCustomerProductUi() {
    return customerProductUi(await this.productMetadata());
  }

  async listPlatformAudit(ctx: AuthContext): Promise<PlatformAuditEntry[]> {
    assertSuperAdmin(ctx.roleId);
    return this.platform.listPlatformAudit();
  }

  async deletePlatformAudit(ctx: AuthContext): Promise<never> {
    if (ctx.roleId !== 'SUPER_ADMIN' && ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    throw new AccessDeniedError();
  }

  async touchLastAccess(tenantId: string): Promise<void> {
    const tenant = await this.requireTenantRecord(tenantId);
    tenant.lastAccessAt = Date.now();
    tenant.updatedAt = tenant.lastAccessAt;
    await this.persistTenant(tenant);
  }

  private assertCanReadTenant(ctx: AuthContext, tenantId: string): void {
    if (ctx.roleId === 'SUPER_ADMIN') return;
    if (ctx.tenantId !== tenantId) throw new AccessDeniedError();
  }

  private async transition(
    ctx: AuthContext,
    tenantId: string,
    next: TenantLifecycleStatus,
    reason: string | undefined,
    contractual: Tenant['contractualStatus'],
    reasonCategory?: string
  ): Promise<Tenant> {
    assertSuperAdmin(ctx.roleId);
    const tenant = await this.requireTenantRecord(tenantId);
    const previous = tenant.status;
    const meta = await this.productMetadata();
    tenant.status = next;
    tenant.activated = next === 'ACTIVE';
    tenant.contractualStatus = contractual;
    tenant.restriction = {
      status: next,
      previousStatus: previous,
      reason,
      reasonCategory,
      actorId: ctx.userId,
      actorRole: ctx.roleId,
      at: Date.now(),
    };
    tenant.productVersion = meta.productVersion;
    tenant.releaseChannel = meta.releaseChannel;
    tenant.updatedAt = Date.now();
    if (next === 'ACTIVE' && !tenant.activatedAt) tenant.activatedAt = tenant.updatedAt;
    if (next === 'SUSPENDED') {
      tenant.suspendedAt = tenant.updatedAt;
      tenant.suspendedBy = ctx.userId;
      tenant.suspensionReason = reason;
    }
    if (next === 'ACTIVE' && previous === 'SUSPENDED') {
      tenant.reactivatedAt = tenant.updatedAt;
      tenant.reactivatedBy = ctx.userId;
    }
    await this.persistTenant(tenant);
    forgetTenantStatus(tenantId);
    if (next === 'SUSPENDED') {
      await this.platform.invalidateRefreshTokensForTenant?.(tenantId);
    }
    await this.platformAudit(ctx.userId, tenantId, `tenant.${next.toLowerCase()}`, previous, next, reason, 'ok');
    if (this.tracer && next === 'SUSPENDED') {
      await this.tracer.record({
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        eventType: 'TENANT_SUSPENDED',
        actorType: 'SUPER_ADMIN',
        actorId: ctx.userId,
        metadata: { previous, reason, message: TENANT_SUSPENDED_MESSAGE },
        correlationId: tenantId,
      });
      await this.tracer.notifyPlatform({
        tenantId,
        type: 'TENANT_SUSPENDED',
        title: 'Tenant suspendido',
        message: `El tenant ${tenant.name || tenantId} fue suspendido.`,
        entityId: tenantId,
        dedupeKey: `${tenantId}:TENANT_SUSPENDED:${tenant.updatedAt}`,
      });
    }
    if (this.tracer && next === 'ACTIVE' && previous === 'SUSPENDED') {
      await this.tracer.record({
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        eventType: 'TENANT_REACTIVATED',
        actorType: 'SUPER_ADMIN',
        actorId: ctx.userId,
        metadata: { previous },
        correlationId: tenantId,
      });
    }
    return tenant;
  }

  private async persistTenant(tenant: Tenant): Promise<void> {
    const normalized = normalizeTenant(tenant);
    await this.platform.saveTenant(normalized);
    if (this.localAdmin) {
      const local = await this.localAdmin.getTenant();
      if (local?.tenantId === normalized.tenantId) {
        await this.localAdmin.saveTenant({ ...local, ...normalized });
      }
    }
  }

  private async requireTenantRecord(tenantId: string): Promise<Tenant> {
    const fromPlatform = await this.platform.getTenant(tenantId);
    if (fromPlatform) return normalizeTenant(fromPlatform);
    if (this.localAdmin) {
      const local = await this.localAdmin.getTenant();
      if (local && local.tenantId === tenantId) {
        const normalized = normalizeTenant(local);
        await this.platform.saveTenant(normalized);
        return normalized;
      }
    }
    throw new AccessDeniedError();
  }

  private async toDashboard(tenant: Tenant): Promise<TenantDashboard> {
    const users = await this.platform.listUsers(tenant.tenantId);
    let orderCount = 0;
    let overdueCount = 0;
    if (this.orders) {
      const listed = await this.orders.listOrders(tenant.tenantId, 'admin');
      orderCount = listed.length;
      const now = Date.now();
      overdueCount = listed.filter((o) => computeDeadline(o.dueAt, now, DEFAULT_DEADLINE_POLICY).isExpired).length;
    }
    const meta = await this.productMetadata();
    return {
      tenantId: tenant.tenantId,
      name: tenant.name,
      status: tenant.status,
      contractualStatus: tenant.contractualStatus,
      activatedAt: tenant.activatedAt,
      productVersion: tenant.productVersion || meta.productVersion,
      releaseChannel: tenant.releaseChannel || meta.releaseChannel,
      lastAccessAt: tenant.lastAccessAt,
      userCount: users.length,
      orderCount,
      overdueCount,
      restrictionReason: tenant.restriction?.reason,
      restrictionAt: tenant.restriction?.at,
    };
  }

  private applyFilter(rows: TenantDashboard[], filter: TenantListFilter): TenantDashboard[] {
    const statuses = filter.status ? (Array.isArray(filter.status) ? filter.status : [filter.status]) : undefined;
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows.filter((row) => {
      if (statuses && !statuses.includes(row.status)) return false;
      if (filter.contractualStatus && row.contractualStatus !== filter.contractualStatus) return false;
      if (filter.releaseChannel && row.releaseChannel !== filter.releaseChannel) return false;
      if (filter.activity === 'recent' && !(row.lastAccessAt && row.lastAccessAt >= recentCutoff)) return false;
      if (filter.query) {
        const q = filter.query.toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !row.tenantId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  private async platformAudit(
    actorId: string,
    tenantId: string,
    action: string,
    previousStatus: TenantLifecycleStatus | undefined,
    newStatus: TenantLifecycleStatus | undefined,
    reason: string | undefined,
    result: PlatformAuditEntry['result']
  ): Promise<void> {
    await this.platform.appendPlatformAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      actorId,
      actorRole: 'SUPER_ADMIN',
      tenantId,
      action,
      previousStatus,
      newStatus,
      reason,
      result,
    });
  }
}

export const TENANT_ALL_PERMISSIONS = ALL_PERMISSIONS;
