import { randomBytes, randomUUID } from 'crypto';
import type {
  ActivationState,
  AuditEntry,
  AuthContext,
  ConfiguredMaterial,
  FormFieldConfig,
  Permission,
  StatusPresentation,
  PersistedUser,
  PublicUser,
  Tenant,
  TenantConfig,
  TenantIdentity,
  TenantOnboardingState,
} from '../../contracts/admin-domain';
import {
  AccessDeniedError,
  ALL_PERMISSIONS,
  hasPermission,
  normalizeTenant,
  toPublicUser,
} from '../../contracts/admin-domain';
import {
  DEFAULT_TENANT_LIMITS,
  mapPermissionInput,
  normalizeSystemRole,
  operadorPermissionList,
  stripSensitiveData,
  type Rubro,
  type TenantLimits,
} from '../../contracts/auth-rbac';
import type { TenantOperation } from '../../contracts/platform-domain';
import {
  operationAllowed,
  policyForStatus,
  restrictionNoticeForPrincipal,
  TenantRestrictedError,
} from '../../contracts/platform-domain';
import { customerProductUi, defaultProductMetadata, workshopProductUi } from '../../contracts/product-version';
import type { AdminRepository } from './AdminRepository';
import { defaultTenantConfig, emptySetupConfig } from './defaultTenantConfig';
import { applyRubro } from './rubroAdapters';
import { hashPassword, verifyPassword } from './passwordHash';
import type { OrderService } from './OrderService';
import type { DeadlinePolicy } from '../../contracts/order-domain';
import { ConfigurationEngine } from './ConfigurationEngine';
import { CostEngine } from './CostEngine';
import { LAUNCH_DEFAULTS, resolveConfiguredCurrency } from '../../contracts/international-domain';
import type { CompiledForm, FormViewer } from '../../contracts/configuration-schema';
import type { TenantControlService } from './TenantControlService';
import type { TraceService } from './TraceService';

export class AdminService {
  private sessions = new Map<string, AuthContext>();
  readonly configuration: ConfigurationEngine;
  readonly catalog: CostEngine;
  private tracer?: TraceService;

  constructor(
    private repo: AdminRepository,
    private orders?: OrderService,
    private control?: TenantControlService
  ) {
    this.configuration = new ConfigurationEngine(repo, orders);
    this.catalog = new CostEngine(repo, orders);
    this.orders?.setTenantGuard({
      assert: (tenantId, operation) => this.assertTenantOperation(tenantId, operation),
    });
  }

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async peekConfig(tenantId: string): Promise<TenantConfig> {
    return this.requireConfig(tenantId);
  }

  async persistConfig(config: TenantConfig): Promise<void> {
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
  }

  async getActivationState(): Promise<ActivationState & {
    status?: string;
    restriction?: ReturnType<typeof restrictionNoticeForPrincipal>;
    workshopProductUi?: ReturnType<typeof workshopProductUi>;
  }> {
    const tenant = await this.repo.getTenant();
    if (!tenant) return { activated: false, phase: 'needed' };
    const normalized = normalizeTenant(tenant);
    if (normalized.status === 'SETUP_INCOMPLETE') {
      return {
        activated: false,
        phase: 'onboarding',
        tenantId: normalized.tenantId,
        tenantName: normalized.name,
        status: normalized.status,
        restriction: restrictionNoticeForPrincipal(normalized),
        workshopProductUi: workshopProductUi(defaultProductMetadata()),
      };
    }
    if (normalized.status === 'ACTIVE' || normalized.status === 'SUSPENDED' || normalized.status === 'BLOCKED') {
      return {
        activated: true,
        phase: 'ready',
        tenantId: normalized.tenantId,
        tenantName: normalized.name,
        status: normalized.status,
        restriction: restrictionNoticeForPrincipal(normalized),
        workshopProductUi: workshopProductUi(defaultProductMetadata()),
      };
    }
    return {
      activated: false,
      phase: 'needed',
      tenantId: normalized.tenantId,
      tenantName: normalized.name,
      status: normalized.status,
    };
  }

  async activate(input: {
    organizationName: string;
    principalLogin: string;
    principalPassword: string;
    credential?: string;
  }): Promise<{ tenant: Tenant; principal: PublicUser }> {
    const existing = await this.repo.getTenant();
    if (existing?.activated || existing?.status === 'ACTIVE' || existing?.status === 'SETUP_INCOMPLETE') {
      throw new Error('Tenant already activated');
    }
    if (!input.organizationName?.trim()) throw new Error('organizationName is required');
    const now = Date.now();
    const tenantId = randomUUID();
    const meta = defaultProductMetadata();
    const tenant: Tenant = {
      tenantId,
      name: input.organizationName.trim(),
      activated: false,
      primaryDisciplineId: 'textile',
      createdAt: now,
      updatedAt: now,
      status: 'SETUP_INCOMPLETE',
      contractualStatus: 'ok',
      productVersion: meta.productVersion,
      releaseChannel: meta.releaseChannel,
      currency: LAUNCH_DEFAULTS.currency,
      timezone: LAUNCH_DEFAULTS.timezone,
    };
    const principal: PersistedUser = {
      userId: randomUUID(),
      tenantId,
      login: (input.principalLogin || 'ADMIN').trim(),
      displayCode: 'ADMIN-PRINCIPAL',
      roleId: 'ADMIN_PRINCIPAL',
      permissions: [...ALL_PERMISSIONS],
      status: 'active',
      password: await hashPassword(input.principalPassword),
      createdAt: now,
      updatedAt: now,
      firstLogin: true,
      email: (input.principalLogin || 'ADMIN').trim(),
      name: input.organizationName.trim(),
      emailVerified: false,
    };
    await this.repo.saveTenant(tenant);
    await this.repo.saveUser(principal);
    await this.repo.saveConfig(defaultTenantConfig(tenantId, now));
    await this.control?.registerLocalTenant(tenant);
    await this.audit(tenantId, principal.userId, 'tenant.activate', tenantId, 'ok', input.credential);
    this.syncDeadlinePolicy(await this.repo.getConfig(tenantId));
    return { tenant, principal: toPublicUser(principal) };
  }

  async activateTenantBootstrap(input: {
    tenantName: string;
    adminEmail: string;
    adminPassword: string;
    adminName: string;
  }): Promise<{ tenant: Tenant; principal: PersistedUser }> {
    if (!input.tenantName?.trim()) throw new Error('tenantName is required');
    if (!input.adminEmail?.trim()) throw new Error('adminEmail is required');
    if (!input.adminPassword) throw new Error('adminPassword is required');
    const now = Date.now();
    const tenantId = randomUUID();
    const meta = defaultProductMetadata();
    const tenant: Tenant = {
      tenantId,
      name: input.tenantName.trim(),
      activated: false,
      primaryDisciplineId: 'textile',
      createdAt: now,
      updatedAt: now,
      status: 'SETUP_INCOMPLETE',
      contractualStatus: 'ok',
      productVersion: meta.productVersion,
      releaseChannel: meta.releaseChannel,
      currency: LAUNCH_DEFAULTS.currency,
      timezone: LAUNCH_DEFAULTS.timezone,
    };
    const email = input.adminEmail.trim().toLowerCase();
    const principal: PersistedUser = {
      userId: randomUUID(),
      tenantId,
      login: email,
      email,
      name: input.adminName.trim() || email,
      displayCode: 'ADMIN-PRINCIPAL',
      roleId: 'ADMIN_PRINCIPAL',
      permissions: [...ALL_PERMISSIONS],
      status: 'active',
      password: await hashPassword(input.adminPassword),
      createdAt: now,
      updatedAt: now,
      firstLogin: true,
      emailVerified: false,
      verificationToken: randomBytes(24).toString('hex'),
      verificationExpiresAt: now + 24 * 60 * 60 * 1000,
    };
    await this.repo.saveTenant(tenant);
    await this.repo.saveUser(principal);
    await this.repo.saveConfig(emptySetupConfig(tenantId, now));
    await this.control?.registerLocalTenant(tenant);
    await this.audit(tenantId, principal.userId, 'tenant.activate', tenantId, 'ok');
    return { tenant, principal };
  }

  async login(
    login: string,
    password: string
  ): Promise<{ token: string; session: AuthContext; user: PublicUser }> {
    const tenant = await this.requirePresentTenant();
    const user = await this.repo.getUserByLogin(tenant.tenantId, login);
    if (!user) throw new AccessDeniedError();
    if (user.status !== 'active') throw new AccessDeniedError();
    const ok = await verifyPassword(password, user.password);
    if (!ok) throw new AccessDeniedError();
    const loginOp: TenantOperation =
      user.roleId === 'ADMIN_PRINCIPAL'
        ? 'login.principal'
        : user.roleId === 'CUSTOMER'
          ? 'login.customer'
          : 'login.operator';
    await this.assertTenantOperation(tenant.tenantId, loginOp);
    tenant.lastAccessAt = Date.now();
    await this.repo.saveTenant(normalizeTenant(tenant));
    await this.control?.touchLastAccess(tenant.tenantId);
    const token = randomBytes(32).toString('hex');
    const ctx: AuthContext = {
      token,
      userId: user.userId,
      tenantId: user.tenantId,
      roleId: user.roleId,
      permissions: user.roleId === 'ADMIN_PRINCIPAL' ? [...ALL_PERMISSIONS] : [...user.permissions],
    };
    this.sessions.set(token, ctx);
    await this.audit(user.tenantId, user.userId, 'auth.login', user.userId, 'ok');
    return { token, session: ctx, user: toPublicUser(user) };
  }

  resolve(token?: string): AuthContext | undefined {
    if (!token) return undefined;
    return this.sessions.get(token);
  }

  async require(token: string): Promise<AuthContext> {
    const ctx = this.sessions.get(token);
    if (!ctx) throw new AccessDeniedError();
    if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    const user = await this.repo.getUser(ctx.userId);
    if (!user || user.status !== 'active') throw new AccessDeniedError();
    if (user.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return ctx;
  }

  assert(ctx: AuthContext, permission: Permission): void {
    const probe: PublicUser = {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      login: '',
      displayCode: '',
      roleId: ctx.roleId,
      permissions: ctx.permissions,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    };
    if (!hasPermission(probe, permission)) {
      throw new AccessDeniedError();
    }
  }

  async createAdmin(
    ctx: AuthContext,
    input: { password?: string; permissions: Permission[]; login?: string; generatePassword?: boolean }
  ): Promise<PublicUser & { initialPassword?: string }> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.create');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    const permissions = [...new Set(input.permissions)].filter((p) => !String(p).startsWith('platform.'));
    this.assertAssignablePermissions(ctx, permissions);
    const users = await this.repo.listUsers(tenant.tenantId);
    const nextIndex = users.filter((u) => u.roleId === 'ADMIN').length + 1;
    const displayCode = `ADMIN-${String(nextIndex).padStart(3, '0')}`;
    const now = Date.now();
    const reveal = Boolean(input.generatePassword) || !input.password;
    const plain = input.password || randomBytes(12).toString('base64url');
    const user: PersistedUser = {
      userId: randomUUID(),
      tenantId: tenant.tenantId,
      login: (input.login || displayCode).trim(),
      displayCode,
      roleId: 'ADMIN',
      permissions,
      status: 'active',
      password: await hashPassword(plain),
      createdAt: now,
      updatedAt: now,
      firstLogin: true,
    };
    await this.repo.saveUser(user);
    await this.audit(tenant.tenantId, ctx.userId, 'users.create', user.userId, 'ok');
    const publicUser = toPublicUser(user);
    return reveal ? { ...publicUser, initialPassword: plain } : publicUser;
  }

  async disableAdmin(ctx: AuthContext, userId: string): Promise<PublicUser> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const user = await this.requireNonPrincipal(ctx, userId);
    user.status = 'disabled';
    user.updatedAt = Date.now();
    await this.repo.saveUser(user);
    this.dropSessions(userId);
    await this.audit(ctx.tenantId, ctx.userId, 'users.disable', userId, 'ok');
    return toPublicUser(user);
  }

  async deleteAdmin(ctx: AuthContext, userId: string): Promise<void> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.delete');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    await this.requireNonPrincipal(ctx, userId);
    await this.repo.deleteUser(userId);
    this.dropSessions(userId);
    await this.audit(ctx.tenantId, ctx.userId, 'users.delete', userId, 'ok');
  }

  async updatePermissions(ctx: AuthContext, userId: string, permissions: Permission[]): Promise<PublicUser> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    if (permissions.some((p) => String(p).startsWith('platform.'))) throw new AccessDeniedError();
    this.assertAssignablePermissions(ctx, permissions);
    const user = await this.requireNonPrincipal(ctx, userId);
    user.permissions = [...new Set(permissions)];
    user.updatedAt = Date.now();
    await this.repo.saveUser(user);
    this.refreshSessionPermissions(user);
    await this.audit(ctx.tenantId, ctx.userId, 'users.permissions', userId, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'permission',
        entityId: userId,
        eventType: 'PERMISSION_CHANGED',
        actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
        actorId: ctx.userId,
        metadata: { userId },
        correlationId: ctx.tenantId,
      });
    }
    return toPublicUser(user);
  }

  async assignRole(ctx: AuthContext, userId: string, roleId: string): Promise<PublicUser> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    if (roleId === 'SUPER_ADMIN' || roleId === 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    if (roleId !== 'ADMIN' && roleId !== 'SUBADMIN' && roleId !== 'OPERATOR' && roleId !== 'CUSTOMER') {
      throw new AccessDeniedError();
    }
    const user = await this.requireNonPrincipal(ctx, userId);
    user.roleId = roleId;
    user.updatedAt = Date.now();
    await this.repo.saveUser(user);
    this.refreshSessionPermissions(user);
    await this.audit(ctx.tenantId, ctx.userId, 'users.assign_role', userId, 'ok', roleId);
    return toPublicUser(user);
  }

  async resetCredentials(
    ctx: AuthContext,
    userId: string,
    newPassword?: string
  ): Promise<PublicUser & { initialPassword?: string }> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const user = await this.repo.getUser(userId);
    if (!user || user.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (user.roleId === 'ADMIN_PRINCIPAL' && ctx.roleId !== 'ADMIN_PRINCIPAL') {
      throw new AccessDeniedError();
    }
    const plain = newPassword || randomBytes(12).toString('base64url');
    user.password = await hashPassword(plain);
    user.updatedAt = Date.now();
    await this.repo.saveUser(user);
    this.dropSessions(userId);
    await this.audit(ctx.tenantId, ctx.userId, 'users.reset_credentials', userId, 'ok');
    return { ...toPublicUser(user), initialPassword: plain };
  }

  async listUsers(ctx: AuthContext): Promise<PublicUser[]> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const users = await this.repo.listUsers(ctx.tenantId);
    return users.map(toPublicUser);
  }

  async listStaffUsers(ctx: AuthContext): Promise<PublicUser[]> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const users = await this.repo.listUsers(ctx.tenantId);
    return users
      .filter((u) => u.roleId === 'SUBADMIN' || u.roleId === 'OPERATOR' || u.roleId === 'ADMIN')
      .map(toPublicUser);
  }

  async createStaffUser(
    ctx: AuthContext,
    input: {
      email: string;
      name: string;
      role: string;
      password?: string;
      permissions?: Record<string, boolean> | Permission[];
    }
  ): Promise<PublicUser & { initialPassword?: string; verificationToken: string }> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const role = normalizeSystemRole(input.role);
    if (role !== 'SUBADMIN' && role !== 'OPERATOR') throw new AccessDeniedError();
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) throw new Error('EMAIL_REQUIRED');
    const existing = await this.repo.listUsers(ctx.tenantId);
    if (existing.some((u) => String(u.email || u.login).toLowerCase() === email)) throw new Error('EMAIL_IN_USE');
    const mapped = mapPermissionInput(input.permissions);
    const permissions = role === 'OPERATOR' ? operadorPermissionList() : mapped.list;
    const permissionMap = role === 'OPERATOR' ? undefined : mapped.map;
    const now = Date.now();
    const verificationToken = randomBytes(24).toString('hex');
    const plain = input.password || randomBytes(12).toString('base64url');
    const user: PersistedUser = {
      userId: randomUUID(),
      tenantId: ctx.tenantId,
      login: email,
      email,
      name: String(input.name || email).trim(),
      displayCode: role === 'OPERATOR' ? `OP-${String(existing.filter((u) => u.roleId === 'OPERATOR').length + 1).padStart(3, '0')}` : `SUB-${String(existing.filter((u) => u.roleId === 'SUBADMIN').length + 1).padStart(3, '0')}`,
      roleId: role,
      permissions,
      permissionMap,
      status: 'active',
      password: await hashPassword(plain),
      createdAt: now,
      updatedAt: now,
      firstLogin: true,
      emailVerified: false,
      verificationToken,
      verificationExpiresAt: now + 24 * 60 * 60 * 1000,
      createdBy: ctx.userId,
    };
    await this.repo.saveUser(user);
    await this.audit(ctx.tenantId, ctx.userId, 'users.create', user.userId, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'permission',
        entityId: user.userId,
        eventType: 'USER_CREATED',
        actorType: 'ADMIN_PRINCIPAL',
        actorId: ctx.userId,
        metadata: { userId: user.userId, role },
        correlationId: ctx.tenantId,
      });
    }
    return { ...toPublicUser(user), initialPassword: plain, verificationToken };
  }

  async deactivateStaffUser(ctx: AuthContext, userId: string): Promise<PublicUser> {
    const user = await this.disableAdmin(ctx, userId);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'permission',
        entityId: userId,
        eventType: 'USER_DEACTIVATED',
        actorType: 'ADMIN_PRINCIPAL',
        actorId: ctx.userId,
        metadata: { userId },
        correlationId: ctx.tenantId,
      });
    }
    return user;
  }

  async setupRubro(ctx: AuthContext, rubro: Rubro): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    if (config.setupDone) throw new Error('SETUP_ALREADY_COMPLETE');
    const next = applyRubro(config, rubro);
    await this.repo.saveConfig(next);
    const enabled = next.disciplines.find((d) => d.enabled);
    if (enabled && enabled.id !== 'publicidad') {
      try {
        await this.configuration.publishSchema(ctx.tenantId, enabled.id);
      } catch {
        /* schema may already exist */
      }
    }
    await this.audit(ctx.tenantId, ctx.userId, 'tenant.rubro', rubro, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'config',
        entityId: ctx.tenantId,
        eventType: 'TENANT_RUBRO_SELECTED',
        actorType: 'ADMIN_PRINCIPAL',
        actorId: ctx.userId,
        metadata: { rubro },
        correlationId: ctx.tenantId,
      });
    }
    return this.sanitizeConfig(ctx, await this.requireConfig(ctx.tenantId));
  }

  async completeSetup(ctx: AuthContext): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(ctx.tenantId);
    if (config.setupDone) return this.sanitizeConfig(ctx, config);
    const now = Date.now();
    if (!tenant.identity?.commercialName) {
      tenant.identity = {
        commercialName: tenant.name,
        currency: tenant.currency || LAUNCH_DEFAULTS.currency,
        timezone: tenant.timezone || LAUNCH_DEFAULTS.timezone,
      };
    }
    tenant.status = 'ACTIVE';
    tenant.activated = true;
    tenant.activatedAt = tenant.activatedAt || now;
    tenant.updatedAt = now;
    await this.repo.saveTenant(tenant);
    config.setupDone = true;
    config.updatedAt = now;
    config.onboarding = { ...(config.onboarding || { step: 7, adminSlots: 1 }), step: 7, completed: true };
    await this.repo.saveConfig(config);
    await this.control?.registerLocalTenant(tenant);
    this.syncDeadlinePolicy(config, tenant.timezone);
    await this.audit(ctx.tenantId, ctx.userId, 'tenant.setup.complete', tenant.tenantId, 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async getTenantConfigView(ctx: AuthContext): Promise<unknown> {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, ctx.roleId === 'CUSTOMER' ? 'login.customer' : 'admin.limited_read');
    const config = await this.requireConfig(ctx.tenantId);
    if (ctx.roleId === 'CUSTOMER') {
      return {
        rubro: config.rubro,
        products: (config.products || [])
          .filter((p) => p.active !== false && p.visibleToClient !== false)
          .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((p) => ({
          productId: p.productId,
          name: p.name,
          rubricId: p.rubricId,
          unitId: p.unitId,
          active: p.active,
        })),
        units: config.units || [],
      };
    }
    if (ctx.roleId === 'SUBADMIN' || ctx.roleId === 'ADMIN') {
      this.assert(ctx, 'configuration.view');
    }
    const sanitized = this.sanitizeConfig(ctx, config);
    if (ctx.roleId === 'OPERATOR') return stripSensitiveData(sanitized, 'OPERATOR');
    return sanitized;
  }

  async updateLimits(ctx: AuthContext, limits: Partial<TenantLimits> & { currency?: string }): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    config.limits = {
      ...DEFAULT_TENANT_LIMITS,
      ...(config.limits || {}),
      maxFilesPerOrder: limits.maxFilesPerOrder ?? config.limits?.maxFilesPerOrder ?? DEFAULT_TENANT_LIMITS.maxFilesPerOrder,
      maxUnitsPerOrder: limits.maxUnitsPerOrder ?? config.limits?.maxUnitsPerOrder ?? DEFAULT_TENANT_LIMITS.maxUnitsPerOrder,
      maxMetersPerOrder: limits.maxMetersPerOrder ?? config.limits?.maxMetersPerOrder ?? DEFAULT_TENANT_LIMITS.maxMetersPerOrder,
      maxFileBytes: limits.maxFileBytes ?? config.limits?.maxFileBytes ?? DEFAULT_TENANT_LIMITS.maxFileBytes,
      maxFileSizeMb:
        limits.maxFileSizeMb ??
        config.limits?.maxFileSizeMb ??
        DEFAULT_TENANT_LIMITS.maxFileSizeMb,
      allowedMimeTypes: limits.allowedMimeTypes ?? config.limits?.allowedMimeTypes ?? DEFAULT_TENANT_LIMITS.allowedMimeTypes,
      requiredPaymentPct:
        limits.requiredPaymentPct ?? config.limits?.requiredPaymentPct ?? DEFAULT_TENANT_LIMITS.requiredPaymentPct,
    };
    if (limits.requiredPaymentPct != null) {
      config.requiredPaymentPct = Number(limits.requiredPaymentPct);
    }
    if (limits.currency) {
      config.currency = limits.currency;
      const tenant = await this.requirePresentTenant();
      tenant.currency = limits.currency;
      tenant.updatedAt = Date.now();
      await this.repo.saveTenant(tenant);
    }
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return this.sanitizeConfig(ctx, config);
  }

  async getInternalCosts(ctx: AuthContext, orderId: string) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'costs.view');
    this.assert(ctx, 'sensitive_data.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    if (!this.orders) throw new Error('Order service unavailable');
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return {
      orderId: order.orderId,
      totalInternalCost: order.totalInternalCost,
      lines: order.consumptions.map((line) => ({
        lineId: line.lineId,
        calculatedInternalCost: line.calculatedInternalCost,
        internalUnitCost: line.internalUnitCost,
      })),
    };
  }

  async upsertMaterial(ctx: AuthContext, material: ConfiguredMaterial): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'materials.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    const config = await this.requireConfig(ctx.tenantId);
    const previous = config.materials.find((m) => m.materialId === material.materialId);
    await this.catalog.upsertMaterial(
      ctx.tenantId,
      { ...material, tenantId: ctx.tenantId, disciplineId: material.disciplineId || tenant.primaryDisciplineId },
      resolveConfiguredCurrency({ currency: tenant.currency || tenant.identity?.currency })
    );
    if (previous && previous.customerUnitPrice !== material.customerUnitPrice) {
      await this.audit(ctx.tenantId, ctx.userId, 'materials.price', material.materialId, 'ok');
    }
    if (previous && previous.unit !== material.unit && material.unit) {
      await this.audit(ctx.tenantId, ctx.userId, 'materials.unit', material.materialId, 'ok');
    }
    await this.audit(ctx.tenantId, ctx.userId, previous ? 'materials.update' : 'materials.create', material.materialId, 'ok');
    await this.audit(ctx.tenantId, ctx.userId, 'materials.upsert', material.materialId, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'config',
        entityId: material.materialId,
        eventType: 'MATERIAL_CHANGED',
        actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
        actorId: ctx.userId,
        metadata: { materialId: material.materialId },
        correlationId: ctx.tenantId,
      });
      if (previous && (previous.customerUnitPrice !== material.customerUnitPrice || previous.internalUnitCost !== material.internalUnitCost)) {
        await this.tracer.record({
          tenantId: ctx.tenantId,
          entityType: 'config',
          entityId: material.materialId,
          eventType: 'PRICE_CHANGED',
          actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
          actorId: ctx.userId,
          metadata: { materialId: material.materialId },
          correlationId: ctx.tenantId,
        });
      }
    }
    return this.sanitizeConfig(ctx, await this.requireConfig(ctx.tenantId));
  }

  async listUnits(ctx: AuthContext) {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const config = await this.requireConfig(ctx.tenantId);
    return this.catalog.listUnits(config);
  }

  async listProducts(ctx: AuthContext, activeOnly = false) {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'OPERATOR' && ctx.roleId !== 'CUSTOMER') {
      /* GET /products is open to tenant roles; SUBADMIN does not need materials.view */
    }
    await this.assertTenantOperation(ctx.tenantId, ctx.roleId === 'CUSTOMER' ? 'login.customer' : 'admin.limited_read');
    const products = await this.catalog.listProducts(ctx.tenantId, activeOnly);
    if (ctx.roleId === 'OPERATOR' || ctx.roleId === 'CUSTOMER' || !this.allows(ctx, 'costs.view')) {
      return stripSensitiveData(products, ctx.roleId === 'ADMIN_PRINCIPAL' ? 'OPERATOR' : ctx.roleId);
    }
    return products;
  }

  async createProduct(ctx: AuthContext, input: Parameters<CostEngine['createProduct']>[1]) {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const product = await this.catalog.createProduct(ctx.tenantId, input);
    await this.audit(ctx.tenantId, ctx.userId, 'product.create', product.productId, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'config',
        entityId: product.productId,
        eventType: 'PRODUCT_CHANGED',
        actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
        actorId: ctx.userId,
        metadata: { productId: product.productId },
        correlationId: ctx.tenantId,
      });
    }
    return product;
  }

  async updateProduct(ctx: AuthContext, productId: string, patch: Parameters<CostEngine['updateProduct']>[2]) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'materials.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const product = await this.catalog.updateProduct(ctx.tenantId, productId, patch);
    await this.audit(
      ctx.tenantId,
      ctx.userId,
      patch.active === false ? 'product.deactivate' : 'product.update',
      productId,
      'ok'
    );
    return product;
  }

  async quoteCatalog(ctx: AuthContext, lines: Parameters<CostEngine['calculateQuote']>[0]['lines']) {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(ctx.tenantId);
    const quote = this.catalog.calculateQuote({ tenant, config, lines });
    const includeInternal = this.allows(ctx, 'costs.view') && this.allows(ctx, 'sensitive_data.view');
    return {
      currency: quote.currency,
      totals: {
        customer: quote.totals.customer,
        internal: includeInternal ? quote.totals.internal : undefined,
      },
      lines: quote.lines.map((line) => ({
        ...line,
        internalUnitCost: includeInternal ? line.internalUnitCost : undefined,
        calculatedInternalCost: includeInternal ? line.calculatedInternalCost : undefined,
      })),
    };
  }

  async confirmCatalogOrder(
    ctx: AuthContext,
    orderId: string,
    lines: Parameters<CostEngine['calculateQuote']>[0]['lines'],
    claimedTotal?: number,
    options?: { allowFrozenReplace?: boolean }
  ) {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    const order = await this.catalog.confirmOrderLines(ctx.tenantId, orderId, lines, claimedTotal, options);
    if (order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return order;
  }

  async getMaterials(ctx: AuthContext): Promise<ConfiguredMaterial[]> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'materials.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const config = await this.requireConfig(ctx.tenantId);
    const rows = config.materials.map((m) => this.sanitizeMaterial(ctx, m));
    return ctx.roleId === 'OPERATOR' ? stripSensitiveData(rows, 'OPERATOR') : rows;
  }

  async upsertField(ctx: AuthContext, field: FormFieldConfig): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    const next: FormFieldConfig = {
      ...field,
      key: field.key || field.name || field.fieldId,
      customerVisible: field.customerVisible ?? (field.visible && !field.sensitive),
      adminVisible: field.adminVisible ?? true,
      active: field.active !== false,
    };
    const existing = config.fields.find((f) => f.fieldId === next.fieldId && f.disciplineId === next.disciplineId);
    this.configuration.assertProtectedFieldWrite(ctx, existing, next);
    const index = config.fields.findIndex((f) => f.fieldId === next.fieldId && f.disciplineId === next.disciplineId);
    if (index >= 0) config.fields[index] = next;
    else config.fields.push(next);
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    await this.audit(
      ctx.tenantId,
      ctx.userId,
      existing ? 'field.modified' : 'field.created',
      next.fieldId,
      'ok'
    );
    await this.audit(ctx.tenantId, ctx.userId, 'configuration.changed', next.disciplineId, 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async deactivateField(ctx: AuthContext, disciplineId: string, fieldId: string): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.configuration.deactivateField(ctx.tenantId, disciplineId, fieldId);
    await this.audit(ctx.tenantId, ctx.userId, 'field.removed', fieldId, 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async reorderFields(ctx: AuthContext, disciplineId: string, fieldIds: string[]): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.configuration.reorderFields(ctx.tenantId, disciplineId, fieldIds);
    await this.audit(ctx.tenantId, ctx.userId, 'field.modified', disciplineId, 'ok', 'reorder');
    return this.sanitizeConfig(ctx, config);
  }

  async setPrimaryDiscipline(ctx: AuthContext, disciplineId: string): Promise<Tenant> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    const config = await this.requireConfig(tenant.tenantId);
    if (!config.disciplines.some((d) => d.id === disciplineId && d.enabled)) {
      throw new Error('Unknown or disabled discipline');
    }
    tenant.primaryDisciplineId = disciplineId;
    tenant.updatedAt = Date.now();
    await this.repo.saveTenant(tenant);
    await this.audit(ctx.tenantId, ctx.userId, 'discipline.set', disciplineId, 'ok');
    return tenant;
  }

  async getFormSchema(ctx: AuthContext, disciplineId?: string): Promise<FormFieldConfig[]> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(tenant.tenantId);
    const id = disciplineId || tenant.primaryDisciplineId;
    return this.visibleFields(ctx, config.fields.filter((f) => f.disciplineId === id && f.visible));
  }

  async getCustomerFormSchema(): Promise<FormFieldConfig[]> {
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(tenant.tenantId);
    const allow = new Set(config.customerFieldAllowlist);
    return config.fields.filter((f) => {
      if (f.disciplineId !== tenant.primaryDisciplineId || !f.visible || f.sensitive) return false;
      if (allow.size === 0) return true;
      return allow.has(f.fieldId) || allow.has(f.name);
    });
  }

  async validateSubmission(
    ctx: AuthContext | { roleId: 'CUSTOMER'; tenantId: string },
    values: Record<string, unknown>,
    disciplineId?: string
  ): Promise<void> {
    const tenantId = 'tenantId' in ctx ? ctx.tenantId : (await this.requirePresentTenant()).tenantId;
    await this.assertTenantOperation(
      tenantId,
      ctx.roleId === 'CUSTOMER' ? 'orders.create' : 'admin.configure'
    );
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(tenant.tenantId);
    const id = disciplineId || tenant.primaryDisciplineId;
    const fields = config.fields.filter((f) => f.disciplineId === id && f.visible);
    for (const field of fields) {
      if (!field.required) continue;
      const value = values[field.fieldId] ?? values[field.name];
      if (value === undefined || value === null || value === '') {
        throw new Error(`REQUIRED_FIELD:${field.fieldId}`);
      }
    }
  }

  async getFieldValue(
    ctx: AuthContext,
    fieldId: string,
    values: Record<string, unknown>
  ): Promise<unknown> {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    this.assertTenant(ctx, ctx.tenantId);
    const tenant = await this.requirePresentTenant();
    const config = await this.requireConfig(tenant.tenantId);
    const field = config.fields.find((f) => f.fieldId === fieldId);
    if (!field) throw new Error('FIELD_NOT_FOUND');
    if (field.sensitive && !this.allows(ctx, 'sensitive_data.view')) {
      throw new AccessDeniedError();
    }
    return values[fieldId];
  }

  async updateStatusPresentation(
    ctx: AuthContext,
    statuses: StatusPresentation[]
  ): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    config.statusPresentation = statuses;
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    await this.audit(ctx.tenantId, ctx.userId, 'statuses.update', 'config', 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async updateCustomerFieldAllowlist(ctx: AuthContext, fieldIds: string[]): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    config.customerFieldAllowlist = [...new Set(fieldIds)];
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    await this.audit(ctx.tenantId, ctx.userId, 'customer.visibility', 'config', 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async updateDeadlinePolicy(ctx: AuthContext, policy: DeadlinePolicy): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    config.deadlineApproachingWithinMs = policy.approachingWithinMs;
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    this.syncDeadlinePolicy(config);
    await this.audit(ctx.tenantId, ctx.userId, 'deadline.policy', 'config', 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async getConfig(ctx: AuthContext): Promise<TenantConfig> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const config = await this.requireConfig(ctx.tenantId);
    return this.sanitizeConfig(ctx, config);
  }

  async listAudit(ctx: AuthContext): Promise<AuditEntry[]> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'reports.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    return this.repo.listAudit(ctx.tenantId);
  }

  async deleteAudit(): Promise<never> {
    throw new AccessDeniedError();
  }

  async getRestrictionNotice(): Promise<ReturnType<typeof restrictionNoticeForPrincipal>> {
    const tenant = await this.requirePresentTenant();
    return restrictionNoticeForPrincipal(tenant);
  }

  async getWorkshopProductUi() {
    if (this.control) return this.control.getWorkshopProductUi();
    return workshopProductUi(defaultProductMetadata());
  }

  async getCustomerProductUi() {
    if (this.control) return this.control.getCustomerProductUi();
    return customerProductUi(defaultProductMetadata());
  }

  async getTenantSnapshot(ctx: AuthContext, tenantId: string): Promise<Tenant> {
    this.forbidPlatformActor(ctx);
    if (ctx.tenantId !== tenantId) throw new AccessDeniedError();
    const tenant = await this.repo.getTenant();
    if (!tenant || tenant.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return normalizeTenant(tenant);
  }

  async unblockOwnTenant(_ctx: AuthContext): Promise<never> {
    throw new AccessDeniedError();
  }

  async elevateToSuperAdmin(_ctx: AuthContext): Promise<never> {
    throw new AccessDeniedError();
  }

  async upsertDiscipline(
    ctx: AuthContext,
    input: { id: string; label: string; enabled?: boolean }
  ) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.configuration.upsertDiscipline(ctx.tenantId, input);
    await this.audit(ctx.tenantId, ctx.userId, 'discipline.upsert', input.id, 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async setDisciplineEnabled(ctx: AuthContext, disciplineId: string, enabled: boolean) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.configuration.setDisciplineEnabled(ctx.tenantId, disciplineId, enabled);
    await this.audit(ctx.tenantId, ctx.userId, enabled ? 'discipline.enable' : 'discipline.disable', disciplineId, 'ok');
    return this.sanitizeConfig(ctx, config);
  }

  async publishSchema(ctx: AuthContext, disciplineId: string) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const schema = await this.configuration.publishSchema(ctx.tenantId, disciplineId);
    await this.audit(ctx.tenantId, ctx.userId, schema.version === 1 ? 'schema.created' : 'schema.modified', `${disciplineId}:v${schema.version}`, 'ok');
    await this.audit(ctx.tenantId, ctx.userId, 'schema.published', `${disciplineId}:v${schema.version}`, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'config',
        entityId: `${disciplineId}:v${schema.version}`,
        eventType: 'SCHEMA_CHANGED',
        actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
        actorId: ctx.userId,
        metadata: { disciplineId, version: schema.version },
        correlationId: ctx.tenantId,
      });
    }
    return schema;
  }

  async archiveSchema(ctx: AuthContext, disciplineId: string, version?: number) {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const schema = await this.configuration.archiveSchema(ctx.tenantId, disciplineId, version);
    await this.audit(ctx.tenantId, ctx.userId, 'schema.archived', `${disciplineId}:v${schema.version}`, 'ok');
    return schema;
  }

  async getPublishedSchema(ctx: AuthContext, disciplineId: string) {
    if (ctx.roleId !== 'CUSTOMER') {
      this.forbidPlatformActor(ctx);
      this.assert(ctx, 'configuration.view');
    }
    await this.assertTenantOperation(ctx.tenantId, ctx.roleId === 'CUSTOMER' ? 'login.customer' : 'admin.limited_read');
    return this.configuration.getPublishedSchema(ctx.tenantId, disciplineId);
  }

  async validateForm(
    ctx: AuthContext,
    input: { disciplineId: string; values: Record<string, unknown>; productId?: string }
  ) {
    const viewer = ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin';
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    await this.configuration.validateForm(ctx.tenantId, input.disciplineId, input.values, viewer, input.productId);
    return { ok: true };
  }

  async createFormInstance(
    ctx: AuthContext,
    input: { rubricId: string; productId?: string; values?: Record<string, unknown> }
  ) {
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    return this.configuration.createFormInstance(ctx.tenantId, {
      rubricId: input.rubricId,
      productId: input.productId,
      customerId: ctx.userId,
      values: input.values,
    });
  }

  async saveFormResponse(ctx: AuthContext, instanceId: string, values: Record<string, unknown>) {
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    const viewer = ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin';
    return this.configuration.saveFormResponse(ctx.tenantId, instanceId, values, viewer);
  }

  async getCompiledForm(
    ctx: AuthContext,
    input: { tenantId?: string; disciplineId: string; viewer: FormViewer; version?: number }
  ): Promise<CompiledForm> {
    const tenantId = input.tenantId || ctx.tenantId;
    if (ctx.roleId !== 'SUPER_ADMIN' && tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (input.viewer === 'customer') {
      await this.assertTenantOperation(tenantId, 'login.customer');
    } else {
      this.forbidPlatformActor(ctx);
      this.assert(ctx, 'configuration.view');
      await this.assertTenantOperation(tenantId, 'admin.limited_read');
    }
    if (input.viewer !== 'admin' && input.viewer !== 'customer' && ctx.roleId === 'CUSTOMER') {
      throw new AccessDeniedError();
    }
    return this.configuration.getFormSchema(tenantId, input.disciplineId, input.viewer, {}, input.version);
  }

  async getFormForProduct(ctx: AuthContext, productId: string, viewer?: FormViewer) {
    const roleViewer = viewer || (ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin');
    if (roleViewer === 'customer') {
      await this.assertTenantOperation(ctx.tenantId, 'login.customer');
    } else {
      this.forbidPlatformActor(ctx);
      this.assert(ctx, 'configuration.view');
    }
    return this.configuration.getFormForProduct(ctx.tenantId, productId, roleViewer);
  }

  async previewCustomerForm(ctx: AuthContext, disciplineId: string): Promise<CompiledForm> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.view');
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    return this.configuration.previewCustomerForm(ctx.tenantId, disciplineId);
  }

  async quoteConfiguredLine(
    ctx: AuthContext,
    input: { disciplineId: string; materialId: string; quantity: number }
  ) {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    const includeInternal = this.allows(ctx, 'costs.view') && this.allows(ctx, 'sensitive_data.view');
    return this.configuration.quoteLine(
      ctx.tenantId,
      input.disciplineId,
      input.materialId,
      input.quantity,
      includeInternal
    );
  }

  async submitConfiguredOrder(
    ctx: AuthContext,
    input: {
      disciplineId: string;
      values: Record<string, unknown>;
      customerId: string;
      customerName: string;
      dueAt: number;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      summary?: string;
    }
  ) {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'orders.create');
    if (ctx.roleId !== 'CUSTOMER') this.assert(ctx, 'orders.create');
    return this.configuration.submitOrder(ctx, input);
  }

  async getOnboarding(ctx: AuthContext): Promise<{
    tenant: Tenant;
    config: TenantConfig;
    onboarding: TenantOnboardingState;
    catalog: TenantConfig['disciplines'];
  }> {
    this.forbidPlatformActor(ctx);
    await this.assertTenantOperation(ctx.tenantId, 'admin.limited_read');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    const config = await this.requireConfig(tenant.tenantId);
    return {
      tenant,
      config: this.sanitizeConfig(ctx, config),
      onboarding: config.onboarding || { step: 1, adminSlots: 1, completed: false },
      catalog: config.disciplines,
    };
  }

  async saveOnboardingStep(ctx: AuthContext, step: TenantOnboardingState['step']): Promise<TenantOnboardingState> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const config = await this.requireConfig(ctx.tenantId);
    config.onboarding = { ...(config.onboarding || { step: 1, adminSlots: 1 }), step, completed: false };
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    await this.audit(ctx.tenantId, ctx.userId, 'onboarding.step', String(step), 'ok');
    return config.onboarding;
  }

  async saveOnboardingIdentity(ctx: AuthContext, identity: TenantIdentity): Promise<Tenant> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'configuration.edit');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    if (!identity.commercialName?.trim()) throw new Error('IDENTITY_NAME_REQUIRED');
    if (!identity.currency?.trim()) throw new Error('IDENTITY_CURRENCY_REQUIRED');
    if (!identity.timezone?.trim()) throw new Error('IDENTITY_TIMEZONE_REQUIRED');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    const nextIdentity: TenantIdentity = {
      commercialName: identity.commercialName.trim(),
      internalName: identity.internalName?.trim() || undefined,
      contact: identity.contact?.trim() || undefined,
      logoRef: identity.logoRef?.trim() || undefined,
      locale: identity.locale?.trim() || undefined,
      currency: identity.currency.trim().toUpperCase(),
      timezone: identity.timezone.trim(),
    };
    tenant.name = nextIdentity.commercialName;
    tenant.identity = nextIdentity;
    tenant.currency = nextIdentity.currency;
    tenant.timezone = nextIdentity.timezone;
    tenant.contact = nextIdentity.contact;
    tenant.internalName = nextIdentity.internalName;
    tenant.logoRef = nextIdentity.logoRef;
    tenant.locale = nextIdentity.locale;
    tenant.updatedAt = Date.now();
    await this.repo.saveTenant(tenant);
    const config = await this.requireConfig(tenant.tenantId);
    config.identity = nextIdentity;
    config.updatedAt = tenant.updatedAt;
    await this.repo.saveConfig(config);
    this.syncDeadlinePolicy(config, tenant.timezone);
    await this.audit(ctx.tenantId, ctx.userId, 'tenant.identity', tenant.tenantId, 'ok');
    return tenant;
  }

  async setAdminSlots(ctx: AuthContext, slots: number): Promise<TenantOnboardingState> {
    this.forbidPlatformActor(ctx);
    this.assert(ctx, 'users.create');
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const n = Math.max(1, Math.min(50, Math.floor(Number(slots) || 1)));
    const config = await this.requireConfig(ctx.tenantId);
    config.onboarding = { ...(config.onboarding || { step: 5, adminSlots: 1 }), adminSlots: n };
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    await this.audit(ctx.tenantId, ctx.userId, 'onboarding.admin_slots', String(n), 'ok');
    return config.onboarding;
  }

  async completeOnboarding(ctx: AuthContext): Promise<Tenant> {
    this.forbidPlatformActor(ctx);
    if (ctx.roleId !== 'ADMIN_PRINCIPAL') throw new AccessDeniedError();
    await this.assertTenantOperation(ctx.tenantId, 'admin.configure');
    const tenant = await this.requirePresentTenant();
    this.assertTenant(ctx, tenant.tenantId);
    if (tenant.status === 'ACTIVE' && tenant.activated) return tenant;
    const config = await this.requireConfig(tenant.tenantId);
    const missing = this.onboardingGaps(tenant, config);
    if (missing.length) throw new Error(`SETUP_INCOMPLETE:${missing.join(',')}`);
    const now = Date.now();
    tenant.status = 'ACTIVE';
    tenant.activated = true;
    tenant.activatedAt = tenant.activatedAt || now;
    tenant.updatedAt = now;
    tenant.contractualStatus = 'ok';
    await this.repo.saveTenant(tenant);
    config.onboarding = { ...(config.onboarding || { step: 7, adminSlots: 1 }), step: 7, completed: true };
    config.setupDone = true;
    config.updatedAt = now;
    await this.repo.saveConfig(config);
    const users = await this.repo.listUsers(tenant.tenantId);
    for (const user of users) {
      if (user.roleId === 'ADMIN_PRINCIPAL' && user.firstLogin) {
        user.firstLogin = false;
        user.updatedAt = now;
        await this.repo.saveUser(user);
      }
    }
    await this.control?.registerLocalTenant(tenant);
    this.syncDeadlinePolicy(config, tenant.timezone);
    await this.audit(ctx.tenantId, ctx.userId, 'tenant.activate.operation', tenant.tenantId, 'ok');
    return tenant;
  }

  async completeDefaultOnboarding(ctx: AuthContext): Promise<Tenant> {
    const tenant = await this.requirePresentTenant();
    await this.saveOnboardingIdentity(ctx, {
      commercialName: tenant.identity?.commercialName || tenant.name,
      currency: tenant.currency || LAUNCH_DEFAULTS.currency,
      timezone: tenant.timezone || 'UTC',
    });
    await this.setDisciplineEnabled(ctx, 'textile', true);
    const current = await this.requireConfig(ctx.tenantId);
    if (!current.publishedSchema?.textile) {
      await this.publishSchema(ctx, 'textile');
    }
    await this.saveOnboardingStep(ctx, 7);
    return this.completeOnboarding(ctx);
  }

  private onboardingGaps(tenant: Tenant, config: TenantConfig): string[] {
    const missing: string[] = [];
    const identity = tenant.identity || config.identity;
    if (!identity?.commercialName?.trim()) missing.push('identity');
    if (!identity?.currency && !tenant.currency) missing.push('currency');
    if (!identity?.timezone && !tenant.timezone) missing.push('timezone');
    const enabled = config.disciplines.filter((d) => d.enabled);
    if (!enabled.length) missing.push('rubric');
    const published = config.publishedSchema || {};
    const hasSchema = enabled.some((d) => Boolean(published[d.id]));
    if (!hasSchema) missing.push('schema');
    const hasMaterial = enabled.some((d) =>
      config.materials.some((m) => m.disciplineId === d.id && m.active)
    );
    if (!hasMaterial) missing.push('material');
    const hasProcess = enabled.some((d) =>
      (config.processes || []).some((p) => p.enabled && (p.disciplineId === d.id || p.id.startsWith(`${d.id}.`)))
    );
    if (!hasProcess) missing.push('production');
    return missing;
  }

  private forbidPlatformActor(ctx: AuthContext): void {
    if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
  }

  private async assertTenantOperation(tenantId: string, operation: TenantOperation): Promise<void> {
    if (this.control) {
      await this.control.assertOperation(tenantId, operation);
      return;
    }
    const tenant = await this.repo.getTenant();
    if (!tenant || tenant.tenantId !== tenantId) throw new AccessDeniedError();
    const normalized = normalizeTenant(tenant);
    if (!operationAllowed(policyForStatus(normalized.status), operation)) {
      throw new TenantRestrictedError(normalized.status);
    }
  }

  private allows(ctx: AuthContext, permission: Permission): boolean {
    try {
      this.assert(ctx, permission);
      return true;
    } catch {
      return false;
    }
  }

  private visibleFields(ctx: AuthContext, fields: FormFieldConfig[]): FormFieldConfig[] {
    if (this.allows(ctx, 'sensitive_data.view')) return fields;
    return fields.filter((f) => !f.sensitive);
  }

  private sanitizeConfig(ctx: AuthContext, config: TenantConfig): TenantConfig {
    const canSeeSensitive = this.allows(ctx, 'sensitive_data.view');
    const canSeeCosts = this.allows(ctx, 'costs.view');
    const next: TenantConfig = {
      ...config,
      fields: this.visibleFields(ctx, config.fields),
      materials: config.materials.map((m) => this.sanitizeMaterial(ctx, m, canSeeCosts, canSeeSensitive)),
    };
    if (ctx.roleId === 'OPERATOR' || ctx.roleId === 'CUSTOMER') {
      return stripSensitiveData(next, ctx.roleId);
    }
    return next;
  }

  private sanitizeMaterial(
    ctx: AuthContext,
    material: ConfiguredMaterial,
    canSeeCosts?: boolean,
    canSeeSensitive?: boolean
  ): ConfiguredMaterial {
    const costs = canSeeCosts ?? this.allows(ctx, 'costs.view');
    const sensitive = canSeeSensitive ?? this.allows(ctx, 'sensitive_data.view');
    const copy: ConfiguredMaterial = { ...material };
    if (!(costs && sensitive)) {
      copy.internalUnitCost = 0;
      if (copy.costConfiguration) copy.costConfiguration = { ...copy.costConfiguration, internalCost: 0 };
      delete (copy as { internalUnitCost?: number }).internalUnitCost;
    }
    if (!costs) {
      copy.customerUnitPrice = 0;
    }
    return copy;
  }

  private async requirePresentTenant(): Promise<Tenant> {
    const tenant = await this.repo.getTenant();
    if (!tenant) throw new Error('TENANT_NOT_ACTIVATED');
    return normalizeTenant(tenant);
  }

  private assertAssignablePermissions(ctx: AuthContext, permissions: Permission[]): void {
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return;
    for (const permission of permissions) {
      if (!ctx.permissions.includes(permission)) throw new AccessDeniedError();
    }
  }

  private async requireConfig(tenantId: string): Promise<TenantConfig> {
    const config = await this.repo.getConfig(tenantId);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    return config;
  }

  private assertTenant(ctx: AuthContext, tenantId: string): void {
    if (ctx.tenantId !== tenantId) throw new AccessDeniedError();
  }

  private async requireNonPrincipal(ctx: AuthContext, userId: string): Promise<PersistedUser> {
    const user = await this.repo.getUser(userId);
    if (!user || user.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (user.roleId === 'ADMIN_PRINCIPAL' || user.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    return user;
  }

  private dropSessions(userId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }

  private refreshSessionPermissions(user: PersistedUser): void {
    for (const session of this.sessions.values()) {
      if (session.userId === user.userId) {
        session.roleId = user.roleId;
        session.permissions = [...user.permissions];
      }
    }
  }

  private syncDeadlinePolicy(config: TenantConfig | undefined, timeZone?: string): void {
    if (!config || !this.orders) return;
    this.orders.setDeadlinePolicy({
      approachingWithinMs: config.deadlineApproachingWithinMs,
      timeZone: timeZone || config.identity?.timezone,
    });
  }

  private async audit(
    tenantId: string,
    actorId: string,
    action: string,
    target: string,
    result: AuditEntry['result'],
    detail?: string
  ): Promise<void> {
    await this.repo.appendAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      tenantId,
      actorId,
      action,
      target,
      result,
      detail,
    });
  }
}
