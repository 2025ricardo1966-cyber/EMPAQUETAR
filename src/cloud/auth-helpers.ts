import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import type { AuthContext, Permission } from '../contracts/admin-domain';
import { AccessDeniedError, ALL_PERMISSIONS, hasPermission, toPublicUser } from '../contracts/admin-domain';
import { effectivePermissions, operadorPermissionList } from '../contracts/auth-rbac';
import { redactOrderForViewer } from '../contracts/order-lifecycle';
import { TenantScopedAdminRepository } from '../main/services/JsonFilePlatformRepository';
import { AdminService } from '../main/services/AdminService';
import { OrderService } from '../main/services/OrderService';
import { TenantControlService } from '../main/services/TenantControlService';
import { ProductionOrchestrator } from '../main/services/ProductionOrchestrator';
import { ProductionCenterService } from '../main/services/ProductionCenterService';
import { CustomerPortalService } from '../main/services/CustomerPortalService';
import { JobDispatcher, LocalExecutionWorker, CloudExecutionWorker } from '../main/services/JobDispatcher';
import { hashPassword, verifyPassword } from '../main/services/passwordHash';
import type { AdminRepository } from '../main/services/AdminRepository';
import type { Tenant, TenantConfig, PersistedUser, AuditEntry } from '../contracts/admin-domain';
import { ControlPlaneStore } from './store/ControlPlaneStore';
import { PLATFORM_SCOPE } from '../contracts/platform-domain';
import type { CreateOrderRequest, OrderStatus, PersistedOrder } from '../contracts/order-domain';

export class ActivateAdminRepository implements AdminRepository {
  constructor(private store: ControlPlaneStore) {}
  async getTenant(): Promise<Tenant | undefined> {
    return undefined;
  }
  async saveTenant(tenant: Tenant): Promise<void> {
    await this.store.saveTenant(tenant);
  }
  async getUser(userId: string) {
    return this.store.getUser(userId);
  }
  async getUserByLogin(tenantId: string, login: string) {
    return this.store.getUserByLogin(tenantId, login);
  }
  async saveUser(user: PersistedUser) {
    await this.store.saveUser(user);
  }
  async deleteUser(userId: string) {
    await this.store.deleteUser(userId);
  }
  async listUsers(tenantId: string) {
    return this.store.listUsers(tenantId);
  }
  async getConfig(tenantId: string) {
    return this.store.getConfig(tenantId);
  }
  async saveConfig(config: TenantConfig) {
    await this.store.saveConfig(config);
  }
  async appendAudit(entry: AuditEntry) {
    await this.store.appendTenantAudit(entry);
  }
  async listAudit(tenantId: string) {
    return this.store.listTenantAudit(tenantId);
  }
}

export class WorkshopAdminRepository implements AdminRepository {
  constructor(private store: ControlPlaneStore) {}
  async getTenant(): Promise<Tenant | undefined> {
    const all = await this.store.listTenants();
    return all[0];
  }
  async saveTenant(tenant: Tenant): Promise<void> {
    await this.store.saveTenant(tenant);
  }
  async getUser(userId: string) {
    const user = await this.store.getUser(userId);
    const tenant = await this.getTenant();
    if (!user || (tenant && user.tenantId !== tenant.tenantId && user.roleId !== 'SUPER_ADMIN')) return undefined;
    return user;
  }
  async getUserByLogin(tenantId: string, login: string) {
    return this.store.getUserByLogin(tenantId, login);
  }
  async saveUser(user: PersistedUser) {
    await this.store.saveUser(user);
  }
  async deleteUser(userId: string) {
    await this.store.deleteUser(userId);
  }
  async listUsers(tenantId: string) {
    return this.store.listUsers(tenantId);
  }
  async getConfig(tenantId: string) {
    return this.store.getConfig(tenantId);
  }
  async saveConfig(config: TenantConfig) {
    await this.store.saveConfig(config);
  }
  async appendAudit(entry: AuditEntry) {
    await this.store.appendTenantAudit(entry);
  }
  async listAudit(tenantId: string) {
    return this.store.listTenantAudit(tenantId);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function adminForTenant(store: ControlPlaneStore, tenantId: string, orders: OrderService, control: TenantControlService) {
  return new AdminService(new TenantScopedAdminRepository(store, tenantId), orders, control);
}

export function probe(ctx: AuthContext) {
  return {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    login: '',
    displayCode: '',
    roleId: ctx.roleId,
    permissions: effectivePermissions(ctx.roleId, ctx.permissions),
    status: 'active' as const,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function signAccessToken(
  ctx: AuthContext,
  ttlMs: number,
  secret: string
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: ctx.userId,
      tid: ctx.tenantId,
      role: ctx.roleId,
      jti: randomUUID(),
      iat: now,
      exp: now + Math.max(1, Math.floor(ttlMs / 1000)),
    })
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function assertPerm(ctx: AuthContext, permission: Permission): void {
  if (!hasPermission(probe(ctx), permission)) throw new AccessDeniedError();
}

export async function persistSession(
  store: ControlPlaneStore,
  ctx: AuthContext,
  sessionTtlMs: number,
  refreshTtlMs: number,
  jwtSecret?: string
) {
  const normalized: AuthContext = {
    ...ctx,
    permissions:
      ctx.roleId === 'OPERATOR' ? operadorPermissionList() : ctx.roleId === 'ADMIN_PRINCIPAL' ? [...ALL_PERMISSIONS] : ctx.permissions,
  };
  const access = jwtSecret ? signAccessToken(normalized, sessionTtlMs, jwtSecret) : normalized.token || newToken();
  const refresh = newToken();
  const now = Date.now();
  await store.saveSession(
    hashToken(access),
    { ...normalized, token: access },
    now + sessionTtlMs,
    hashToken(refresh),
    now + refreshTtlMs
  );
  return { token: access, refreshToken: refresh, session: { ...normalized, token: access } };
}

export function redactOrder(order: PersistedOrder, ctx: AuthContext): PersistedOrder {
  if (ctx.roleId === 'CUSTOMER') return redactOrderForViewer(order, 'customer');
  if (!hasPermission(probe(ctx), 'costs.view')) {
    return redactOrderForViewer({ ...order, visibility: { ...order.visibility, internalCost: false, purchasePrice: false, margin: false } }, 'subadmin');
  }
  return order;
}

export function buildCreateOrder(ctx: AuthContext, body: Partial<CreateOrderRequest>): CreateOrderRequest {
  return {
    tenantId: ctx.tenantId,
    customerId: String(body.customerId || ctx.userId),
    customerName: String(body.customerName || ''),
    summary: body.summary,
    priority: body.priority,
    dueAt: Number(body.dueAt),
    actor: { actorId: ctx.userId, role: ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin' },
    configurationSnapshot: body.configurationSnapshot,
    formValues: body.formValues,
    initialStatus: body.initialStatus,
    catalogLines: Array.isArray(body.catalogLines)
      ? body.catalogLines
      : Array.isArray((body as { lines?: unknown }).lines)
        ? ((body as { lines: CreateOrderRequest['catalogLines'] }).lines)
        : undefined,
    productId: body.productId,
  };
}

export { randomUUID, verifyPassword, hashPassword, toPublicUser, PLATFORM_SCOPE };
export type { OrderStatus };
