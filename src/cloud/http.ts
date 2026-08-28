import http from 'http';
import { AccessDeniedError, hasPermission, UnauthorizedError } from '../contracts/admin-domain';
import { TenantRestrictedError } from '../contracts/platform-domain';
import { SecurityBlockedError } from '../contracts/security-domain';
import { OrderConflictError, OrderTransitionError, redactOrderForViewer } from '../contracts/order-lifecycle';
import type { ControlPlaneKernel } from './kernel';
import {
  ActivateAdminRepository,
  WorkshopAdminRepository,
  adminForTenant,
  assertPerm,
  buildCreateOrder,
  hashToken,
  persistSession,
  probe,
  newToken,
} from './auth-helpers';
import { AdminService } from '../main/services/AdminService';
import type { AuthContext } from '../contracts/admin-domain';
import { ConfigConflictError, ConfigValidationError, RequestInvalidError } from '../contracts/configuration-schema';
import type { OrderStatus } from '../contracts/order-domain';
import type { ProductionQuery } from '../contracts/production-center';
import {
  authorize,
  authorizePermission,
  effectivePermissions,
  operadorPermissionList,
  stripSensitiveData,
  toSessionUser,
  type Rubro,
} from '../contracts/auth-rbac';
import { PaymentRequiredError } from '../contracts/customer-experience';
import { MembershipRestrictedError } from '../contracts/membership-domain';
import { ResourceNotFoundError } from '../contracts/http-errors';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { OraCapabilityAdapter } from '../main/services/ora/OraCapabilityAdapter';
import { WorkshopWorkspaceService } from '../main/services/WorkshopWorkspaceService';
import { AdminConfigService } from '../main/services/AdminConfigService';
import { ClientMessageService } from '../main/services/ClientMessageService';
import { MembershipService } from '../main/services/MembershipService';
import { WorkshopCatalogService } from '../main/services/WorkshopCatalogService';
import { OpsOrderService } from '../main/services/OpsOrderService';
import { detectLanguage, t } from '../i18n';
import { randomUUID } from 'crypto';
import { getCachedTenantStatus } from './tenant-status-cache';
import { tryServeStatic } from './static';

const rate = new Map<string, { n: number; t: number }>();

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = rate.get(key);
  if (!cur || now - cur.t > windowMs) {
    rate.set(key, { n: 1, t: now });
    return true;
  }
  cur.n += 1;
  return cur.n <= max;
}

function logEvent(entry: Record<string, unknown>): void {
  const safe = { ...entry };
  delete safe.password;
  delete safe.token;
  delete safe.refreshToken;
  delete safe.secret;
  process.stdout.write(`${JSON.stringify({ ts: Date.now(), ...safe })}\n`);
}

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return readRawBody(req).then((raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_JSON');
    }
  });
}

function clientIp(req: http.IncomingMessage): string {
  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function send(res: http.ServerResponse, status: number, body: unknown, requestId: string): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': requestId,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key, User-Agent, X-Tenant-ID',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end(payload);
}

export function createControlPlaneServer(kernel: ControlPlaneKernel): http.Server {
  return http.createServer((req, res) => {
    void handle(kernel, req, res);
  });
}

async function handle(kernel: ControlPlaneKernel, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const requestId = randomUUID();
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${kernel.env.host}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ip = clientIp(req);
  if (method === 'OPTIONS') {
    send(res, 204, {}, requestId);
    return;
  }
  if (tryServeStatic(req, res, path)) return;
  try {
    const result = await route(kernel, req, method, path, url, requestId);
    send(res, result.status, result.body, requestId);
    logEvent({
      requestId,
      operation: `${method} ${path}`,
      result: result.status < 400 ? 'ok' : 'error',
      actor: result.actor,
      tenant: result.tenant,
      client: req.headers['user-agent'],
    });
    if (result.status >= 400 && path !== '/auth/login') {
      await kernel.security.observe({
        ip,
        method,
        path,
        status: result.status,
        userId: result.actor,
        tenantId: result.tenant,
      });
    }
  } catch (error) {
    const lang = detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') });
    const blocked = error instanceof SecurityBlockedError;
    const denied = error instanceof AccessDeniedError || (error as { code?: string }).code === 'ACCESS_DENIED';
    const unauthorized = error instanceof UnauthorizedError || (error as { code?: string }).code === 'UNAUTHORIZED';
    const payment = error instanceof PaymentRequiredError || (error as { code?: string }).code === 'PAYMENT_REQUIRED';
    const restricted = error instanceof TenantRestrictedError;
    const notFound = error instanceof ResourceNotFoundError;
    const membership = error instanceof MembershipRestrictedError;
    const transition = error instanceof OrderTransitionError;
    const conflict =
      error instanceof OrderConflictError ||
      error instanceof ConfigConflictError ||
      (error as { code?: string }).code === 'ORDER_CONFLICT' ||
      (error as { code?: string }).code === 'CONFIG_CONFLICT';
    const validation = error instanceof ConfigValidationError;
    const invalid = error instanceof RequestInvalidError;
    const invalidDetail = invalid ? String(error.message).replace(/^REQUEST_INVALID:/, '') : '';
    const message = error instanceof Error ? error.message : 'ERROR';
    const i18nInvalid: Record<string, string> = {
      ITEM_DISABLED: 'errors.item_disabled',
      ORDER_ITEMS_REQUIRED: 'errors.order_items_required',
      INVALID_ORDER_STATUS: 'errors.invalid_order_transition',
      INVALID_MEMBERSHIP_TRANSITION: 'errors.invalid_membership_transition',
      MEMBERSHIP_REQUIRED: 'errors.membership_required',
      CUSTOMER_REQUIRED: 'errors.customer_required',
      INVALID_CATALOG_ITEM: 'errors.invalid_catalog_item',
      INVALID_CATEGORY: 'errors.invalid_category',
      INVALID_WHATSAPP_NUMBER: 'errors.invalid_whatsapp_number',
      PROJECT_NAME_NO_NUMBERS: 'errors.project_name_no_numbers',
      PROJECT_NAME_REQUIRED: 'errors.project_name_required',
      PRICE_FROZEN: 'errors.price_frozen',
      PRICE_NOT_FROZEN: 'errors.price_not_frozen',
      PRICE_FULLY_PAID: 'errors.price_fully_paid',
      PRICE_DECISION_NOT_REQUIRED: 'errors.price_decision_not_required',
      EXCEPTION_NOTE_REQUIRED: 'errors.exception_note_required',
      INVALID_AMOUNT: 'errors.invalid_amount',
      TPU_INVALID: 'errors.tpu_invalid',
      TPU_LIMIT_EXCEEDED: 'errors.tpu_limit_exceeded',
      SIZE_NOT_FOUND: 'errors.size_not_found',
      SIZE_TABLE_IMMUTABLE: 'errors.size_table_immutable',
      LASER_CONFIRM_REQUIRED: 'errors.laser_confirm_required',
      GARMENT_NOT_SELECTED: 'errors.garment_not_selected',
      GARMENT_REQUIRED: 'errors.garment_required',
      DUPLICATE_ROSTER_ROW: 'errors.duplicate_roster_row',
      GARMENT_STYLE_INCOMPATIBLE: 'errors.garment_style_incompatible',
      TPU_DISABLED: 'errors.tpu_disabled',
      ROSTER_PENDING: 'errors.roster_pending',
      ROSTER_CORRUPT: 'errors.roster_corrupt',
      INVALID_QUANTITY: 'errors.invalid_quantity',
      FAMILY_WITHOUT_UNITS: 'errors.family_without_units',
      ORPHAN_ROW: 'errors.orphan_row',
      PRODUCTION_NOT_APPROVED: 'errors.production_not_approved',
      DESIGN_REQUIRED: 'errors.design_required',
      PREVIEW_PENDING: 'errors.preview_pending',
      OUTPUT_EMPTY: 'errors.output_empty',
      NOT_CDR: 'errors.not_cdr',
      ORA_INVALID_DIMENSION: 'errors.ora_invalid_dimension',
      ORA_PATTERN_NOT_FOUND: 'errors.ora_pattern_not_found',
      ORA_LUGGAGE_VIEW: 'errors.ora_luggage_view',
      ORA_CONVERT_NOT_POSSIBLE: 'errors.ora_convert_not_possible',
      ORA_FILE_TARGET: 'errors.ora_file_target',
      ORA_SCALE_REQUIRES_PNG: 'errors.ora_scale_requires_png',
    };
    const unprocessable =
      invalid &&
      (invalidDetail === 'TPU_LIMIT_EXCEEDED' ||
        invalidDetail === 'TPU_INVALID' ||
        invalidDetail === 'SIZE_NOT_FOUND' ||
        invalidDetail === 'GARMENT_NOT_SELECTED' ||
        invalidDetail === 'GARMENT_REQUIRED' ||
        invalidDetail === 'DUPLICATE_ROSTER_ROW' ||
        invalidDetail === 'ROSTER_TOTAL_MISMATCH' ||
        invalidDetail === 'ROSTER_RECORD_LOST' ||
        invalidDetail === 'GARMENT_STYLE_INCOMPATIBLE' ||
        invalidDetail === 'TPU_DISABLED' ||
        invalidDetail === 'INVALID_QUANTITY' ||
        invalidDetail === 'FAMILY_WITHOUT_UNITS' ||
        invalidDetail === 'ORPHAN_ROW' ||
        invalidDetail === 'ROSTER_CORRUPT');
    const code = blocked
      ? 'SECURITY_BLOCKED'
      : validation
        ? 'VALIDATION_ERROR'
        : error instanceof ConfigConflictError
          ? 'CONFIG_CONFLICT'
          : conflict
            ? 'ORDER_CONFLICT'
            : restricted
              ? error.code
              : unauthorized
                ? 'UNAUTHORIZED'
                : payment
                  ? 'PAYMENT_REQUIRED'
                  : membership
                    ? error.code
                    : notFound
                      ? 'NOT_FOUND'
                      : transition
                        ? 'INVALID_ORDER_TRANSITION'
                        : denied
                          ? 'ACCESS_DENIED'
                          : invalid
                            ? invalidDetail || 'REQUEST_INVALID'
                            : message;
    const status = notFound
      ? 404
      : conflict
        ? 409
        : payment
          ? 402
          : unauthorized
            ? 401
            : blocked || denied || restricted || membership
              ? 403
              : unprocessable
                ? 422
                : 400;
    const catalogMessage = blocked
      ? t('errors.security_blocked', lang)
      : membership
        ? t(`errors.${error.code.toLowerCase()}`, lang)
        : notFound
          ? t('errors.http_404', lang)
          : transition
            ? t('errors.invalid_order_transition', lang)
            : denied
              ? t('errors.http_403', lang)
              : unauthorized
                ? t('errors.http_401', lang)
                : invalid && i18nInvalid[invalidDetail]
                  ? t(i18nInvalid[invalidDetail], lang)
                  : payment || restricted || validation || error instanceof ConfigConflictError
                    ? message
                    : t('errors.generic', lang);
    send(
      res,
      status,
      {
        error: code,
        code,
        message: catalogMessage,
        fields: validation ? error.fields : undefined,
        currentRevision: conflict && error instanceof OrderConflictError ? error.currentRevision : undefined,
        until: blocked ? error.until : undefined,
      },
      requestId
    );
    logEvent({
      requestId,
      operation: `${method} ${path}`,
      result: denied || blocked ? 'denied' : 'error',
      error: blocked ? 'SECURITY_BLOCKED' : denied ? 'ACCESS_DENIED' : message,
    });
    if (!blocked && path !== '/auth/login' && (status === 401 || status === 403 || status === 404)) {
      const authz = String(req.headers.authorization || '');
      const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
      const session = bearer ? await kernel.store.getSession(hashToken(bearer)) : undefined;
      await kernel.security.observe({
        ip,
        method,
        path,
        status,
        role: session?.ctx.roleId,
        userId: session?.ctx.userId,
        tenantId: session?.ctx.tenantId,
      });
    }
  }
}

async function route(
  kernel: ControlPlaneKernel,
  req: http.IncomingMessage,
  method: string,
  path: string,
  url: URL,
  requestId: string
): Promise<{ status: number; body: unknown; actor?: string; tenant?: string }> {
  const { store, env } = kernel;
  const ip = clientIp(req);
  if (method === 'GET' && path === '/health') {
    return { status: 200, body: { ok: true, ephemeral: env.dataEphemeral } };
  }
  if (method === 'GET' && path === '/ready') {
    const db = await kernel.db.ready();
    return { status: db ? 200 : 503, body: { ready: db, db } };
  }
  if (method === 'GET' && path === '/public/workshop') {
    const tenants = await store.listTenants();
    const tenant =
      tenants.find((row) => row.status === 'ACTIVE' || row.activated) ||
      tenants.find((row) => row.status === 'SETUP_INCOMPLETE') ||
      tenants[0];
    if (!tenant) return { status: 200, body: { activated: false } };
    return {
      status: 200,
      body: {
        activated: tenant.status === 'ACTIVE' || !!tenant.activated,
        status: tenant.status,
        tenantId: tenant.tenantId,
        name: tenant.name,
      },
    };
  }
  if (method === 'GET' && path === '/contract') {
    return {
      status: 200,
      body: {
        api: 'mascayl-control-plane/v1',
        clients: ['windows', 'macos'],
        sourceOfTruth: 'cloud-database',
      },
    };
  }
  await kernel.security.assertNotBlocked({ ip });

  const rawBody = method === 'GET' || method === 'HEAD' ? '' : await readRawBody(req);
  const body: Record<string, unknown> = (() => {
    if (method === 'GET' || method === 'HEAD' || !rawBody) return {};
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_JSON');
    }
  })();

  if (method === 'POST' && path === '/webhooks/mercadopago') {
    const sig = String(req.headers['x-signature'] || '');
    return kernel.payments.handleWebhook('MERCADOPAGO', rawBody, sig || undefined);
  }
  if (method === 'POST' && path === '/webhooks/stripe') {
    const sig = String(req.headers['stripe-signature'] || '');
    return kernel.payments.handleWebhook('STRIPE', rawBody, sig || undefined);
  }

  if (method === 'POST' && path === '/platform/bootstrap') {
    if (!rateLimit(`boot:${ip}`, 5, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const user = await kernel.control.bootstrapSuperAdmin({
      login: String(body.login || ''),
      password: String(body.password || ''),
    });
    return { status: 200, body: { user } };
  }

  if (method === 'POST' && path === '/platform/login') {
    if (!rateLimit(`plogin:${ip}:${body.login}`, 10, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const result = await kernel.control.loginSuperAdmin(String(body.login || ''), String(body.password || ''));
    const persisted = await persistSession(store, result.session, env.sessionTtlMs, env.refreshTtlMs, env.jwtSecret);
    return {
      status: 200,
      body: {
        token: persisted.token,
        accessToken: persisted.token,
        refreshToken: persisted.refreshToken,
        user: result.user,
        scope: 'platform',
      },
      actor: result.session.userId,
    };
  }

  if (method === 'POST' && path === '/auth/activate') {
    if (!rateLimit(`act:${ip}`, 8, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const admin = new AdminService(new WorkshopAdminRepository(store), kernel.orders, kernel.control);
    const created = await admin.activate({
      organizationName: String(body.organizationName || ''),
      principalLogin: String(body.principalLogin || 'ADMIN'),
      principalPassword: String(body.principalPassword || ''),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '';
      if (/already activated/i.test(message)) {
        const conflict = new Error('TENANT_ALREADY_ACTIVATED');
        (conflict as { status?: number }).status = 409;
        throw conflict;
      }
      throw err;
    });
    return { status: 200, body: created };
  }

  if (method === 'POST' && path === '/auth/activate-tenant') {
    if (!rateLimit(`actt:${ip}`, 8, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const code = String(body.activationCode || '');
    const row = await store.getActivationCode(code);
    if (!row) throw new Error('INVALID_ACTIVATION_CODE');
    if (row.usedAt) throw new Error('ACTIVATION_CODE_USED');
    if (row.expiresAt < Date.now()) throw new Error('ACTIVATION_CODE_EXPIRED');
    const admin = new AdminService(new ActivateAdminRepository(store), kernel.orders, kernel.control);
    const created = await admin.activateTenantBootstrap({
      tenantName: String(body.tenantName || ''),
      adminEmail: String(body.adminEmail || ''),
      adminPassword: String(body.adminPassword || ''),
      adminName: String(body.adminName || ''),
    });
    await store.consumeActivationCode(code, created.tenant.tenantId, created.principal.userId);
    const ctx: AuthContext = {
      token: '',
      userId: created.principal.userId,
      tenantId: created.tenant.tenantId,
      roleId: 'ADMIN_PRINCIPAL',
      permissions: created.principal.permissions,
    };
    const persisted = await persistSession(store, ctx, env.sessionTtlMs, env.refreshTtlMs, env.jwtSecret);
    return {
      status: 201,
      body: {
        tenantId: created.tenant.tenantId,
        userId: created.principal.userId,
        accessToken: persisted.token,
        token: persisted.token,
        refreshToken: persisted.refreshToken,
        setupRequired: true,
      },
      actor: created.principal.userId,
      tenant: created.tenant.tenantId,
    };
  }

  if (method === 'POST' && path === '/auth/verify-email') {
    const token = String(body.token || '');
    const user = await store.findUserByVerificationToken(token);
    if (!user || !user.verificationExpiresAt || user.verificationExpiresAt < Date.now()) {
      throw new UnauthorizedError();
    }
    user.emailVerified = true;
    user.verificationToken = null;
    user.updatedAt = Date.now();
    await store.saveUser(user);
    return { status: 200, body: { ok: true, userId: user.userId } };
  }

  if (method === 'POST' && path === '/auth/login') {
    if (!rateLimit(`login:${ip}:${body.login || body.email}`, 10, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const login = String(body.email || body.login || '');
    const password = String(body.password || '');
    const tenantName = body.tenantName ? String(body.tenantName) : undefined;
    let user = await store.findUserByLogin(login, tenantName);
    if (!user) user = await store.getSuperAdminByLogin(login);
    if (!user) {
      await kernel.security.noteAuthFailure({ ip, unknownAccount: true });
      throw new UnauthorizedError();
    }
    await kernel.security.assertNotBlocked({ ip, userId: user.userId });
    if (user.status !== 'active') throw new UnauthorizedError();
    const { verifyPassword } = await import('../main/services/passwordHash');
    if (!(await verifyPassword(password, user.password))) {
      await kernel.security.noteAuthFailure({ ip, unknownAccount: false, userId: user.userId, tenantId: user.tenantId });
      throw new UnauthorizedError();
    }
    if (user.roleId === 'CUSTOMER' && user.emailVerified === false) {
      const lang = detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') });
      return {
        status: 403,
        body: {
          error: 'EMAIL_NOT_VERIFIED',
          code: 'EMAIL_NOT_VERIFIED',
          message: t('errors.email_not_verified', lang),
        },
      };
    }
    if (user.roleId === 'SUPER_ADMIN') {
      const saCtx: AuthContext = {
        token: '',
        userId: user.userId,
        tenantId: '__platform__',
        roleId: 'SUPER_ADMIN',
        permissions: effectivePermissions('SUPER_ADMIN', user.permissions),
      };
      const persisted = await persistSession(store, saCtx, env.sessionTtlMs, env.refreshTtlMs, env.jwtSecret);
      return {
        status: 200,
        body: {
          token: persisted.token,
          accessToken: persisted.token,
          refreshToken: persisted.refreshToken,
          user: toSessionUser(user),
        },
        actor: user.userId,
      };
    }
    const tenant = await store.getTenant(user.tenantId);
    if (!tenant) throw new UnauthorizedError();
    if (tenant.status === 'SUSPENDED') {
      throw new TenantRestrictedError('SUSPENDED', t('errors.tenant_suspended', detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') })));
    }
    const loginOp =
      user.roleId === 'ADMIN_PRINCIPAL'
        ? 'login.principal'
        : user.roleId === 'CUSTOMER'
          ? 'login.customer'
          : 'login.operator';
    await kernel.control.assertOperation(user.tenantId, loginOp, user.roleId);
    const ctxLogin: AuthContext = {
      token: '',
      userId: user.userId,
      tenantId: user.tenantId,
      roleId: user.roleId,
      permissions:
        user.roleId === 'OPERATOR'
          ? operadorPermissionList()
          : user.roleId === 'ADMIN_PRINCIPAL'
            ? []
            : user.permissions,
    };
    const persisted = await persistSession(store, ctxLogin, env.sessionTtlMs, env.refreshTtlMs, env.jwtSecret);
    const { toPublicUser } = await import('../contracts/admin-domain');
    if (user.roleId === 'CUSTOMER') {
      await store.recordAudit({
        id: randomUUID(),
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'customer.login',
        entity: 'customer',
        entityId: user.userId,
      });
    }
    return {
      status: 200,
      body: {
        token: persisted.token,
        accessToken: persisted.token,
        refreshToken: persisted.refreshToken,
        user: { ...toPublicUser(user), ...toSessionUser(user) },
      },
      actor: user.userId,
      tenant: user.tenantId,
    };
  }

  const authHeader = String(req.headers.authorization || '');
  const workerTok = authHeader.startsWith('Worker ') ? authHeader.slice(7).trim() : '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (method === 'POST' && path === '/auth/refresh') {
    const refresh = String(body.refreshToken || '');
    const existing = await store.getSessionByRefreshHash(hashToken(refresh));
    if (!existing) throw new UnauthorizedError();
    if (existing.ctx.roleId !== 'SUPER_ADMIN') {
      const tenant = await store.getTenant(existing.ctx.tenantId);
      if (tenant?.status === 'SUSPENDED') {
        throw new TenantRestrictedError('SUSPENDED', t('errors.tenant_suspended', detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') })));
      }
    }
    await store.deleteSessionByRefreshHash(hashToken(refresh));
    const persisted = await persistSession(store, existing.ctx, env.sessionTtlMs, env.refreshTtlMs, env.jwtSecret);
    return {
      status: 200,
      body: {
        token: persisted.token,
        accessToken: persisted.token,
        refreshToken: persisted.refreshToken,
        session: persisted.session,
      },
    };
  }

  if (method === 'POST' && path === '/client/register') {
    if (!rateLimit(`clireg:${ip}`, 8, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const tenantHeader = String(req.headers['x-tenant-id'] || body.tenantId || '').trim();
    if (!tenantHeader) throw new Error('TENANT_REQUIRED');
    const tenant = await store.getTenant(tenantHeader);
    if (!tenant) throw new Error('TENANT_NOT_FOUND');
    const admin = adminForTenant(store, tenant.tenantId, kernel.orders, kernel.control);
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    const created = await service.register({
      tenantId: tenant.tenantId,
      email: String(body.email || ''),
      password: String(body.password || ''),
      name: String(body.name || ''),
      phone: body.phone ? String(body.phone) : undefined,
      preferredLanguage: body.preferredLanguage
        ? String(body.preferredLanguage)
        : detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') }),
      country: body.country ? String(body.country) : undefined,
      region: body.region ? String(body.region) : undefined,
      city: body.city ? String(body.city) : undefined,
      postalCode: body.postalCode ? String(body.postalCode) : undefined,
      address: body.address ? String(body.address) : undefined,
    });
    return { status: 201, body: created, tenant: tenant.tenantId };
  }

  if (method === 'POST' && path === '/customers/register' && !authHeader) {
    if (!rateLimit(`creg:${ip}`, 8, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    const tenants = await store.listTenants();
    const tenant = tenants.find((t) => t.name === String(body.tenantName || body.organizationName || '')) || tenants[0];
    if (!tenant) throw new Error('TENANT_NOT_ACTIVATED');
    if (tenant.status !== 'ACTIVE') throw new TenantRestrictedError(tenant.status);
    const profile = await kernel.portal.register({
      tenantId: tenant.tenantId,
      name: String(body.name || ''),
      contact: String(body.contact || ''),
      login: String(body.login || ''),
      password: String(body.password || ''),
    });
    return { status: 200, body: profile, tenant: tenant.tenantId };
  }

  if (workerTok) {
    return workerRoutes(kernel, method, path, body, workerTok, requestId);
  }

  if (method === 'POST' && path === '/auth/logout') {
    if (!bearer) throw new UnauthorizedError();
    const current = await store.getSession(hashToken(bearer));
    if (!current) throw new UnauthorizedError();
    await store.deleteSession(hashToken(bearer));
    await store.deleteSessionsForUser(current.ctx.userId);
    return { status: 200, body: { ok: true } };
  }

  const session = bearer ? await store.getSession(hashToken(bearer)) : undefined;
  if (!session) throw new UnauthorizedError();
  const liveUser = await store.getUser(session.ctx.userId);
  if (!liveUser || liveUser.status !== 'active') throw new UnauthorizedError();
  await kernel.security.assertNotBlocked({ ip, userId: liveUser.userId, sessionId: hashToken(bearer) });
  const tenantCfg = liveUser.roleId === 'SUPER_ADMIN' ? undefined : await store.getConfig(liveUser.tenantId);
  let preferred = liveUser.preferredLanguage;
  if (!preferred && liveUser.roleId === 'CUSTOMER') {
    preferred = (await store.getCustomer(liveUser.userId))?.preferredLanguage;
  }
  const ctx: AuthContext = {
    ...session.ctx,
    token: bearer,
    roleId: liveUser.roleId,
    permissions: effectivePermissions(liveUser.roleId, liveUser.permissions),
    tenantId: liveUser.roleId === 'SUPER_ADMIN' ? session.ctx.tenantId : liveUser.tenantId,
    preferredLanguage: preferred,
    lang: detectLanguage({
      preferredLanguage: preferred,
      acceptLanguage: String(req.headers['accept-language'] || ''),
      tenantDefaultLanguage: tenantCfg?.defaultLanguage,
    }),
  };

  if (ctx.roleId !== 'SUPER_ADMIN') {
    const tenantStatus = await getCachedTenantStatus(ctx.tenantId, async () => (await store.getTenant(ctx.tenantId))?.status);
    if (tenantStatus === 'SUSPENDED' && method !== 'GET' && path !== '/auth/logout') {
      throw new TenantRestrictedError('SUSPENDED', t('errors.tenant_suspended', detectLanguage({ acceptLanguage: String(req.headers['accept-language'] || '') })));
    }
  }

  if (method === 'GET' && path === '/auth/session') {
    return { status: 200, body: { session: ctx }, actor: ctx.userId, tenant: ctx.tenantId };
  }

  if (method === 'POST' && path === '/reconnect') {
    if (body.workerId) {
      const workers = await store.listWorkers();
      const worker = workers.find((w) => w.workerId === body.workerId && w.tenantId === ctx.tenantId);
      if (worker) {
        worker.lastHeartbeat = Date.now();
        worker.status = 'idle';
        await store.saveWorker(worker);
      }
    }
    return { status: 200, body: { ok: true, session: ctx, source: 'cloud' }, actor: ctx.userId, tenant: ctx.tenantId };
  }

  if (ctx.roleId === 'SUPER_ADMIN') {
    if (method === 'GET' && path === '/platform/notifications') {
      const unread = url.searchParams.get('unread');
      return {
        status: 200,
        body: await kernel.tracer.listPlatformNotifications(ctx, {
          unread: unread === '1' || unread === 'true' ? true : undefined,
        }),
        actor: ctx.userId,
      };
    }
    if (method === 'POST' && path.match(/^\/notifications\/[^/]+\/read$/)) {
      const id = path.split('/')[2];
      return { status: 200, body: await kernel.tracer.markRead(ctx, id, body.recipientId ? String(body.recipientId) : undefined), actor: ctx.userId };
    }
    return platformRoutes(kernel, ctx, method, path, body, url);
  }

  if (path.startsWith('/platform/')) throw new AccessDeniedError();

  const tenantId = ctx.tenantId;
  if (body.tenantId && body.tenantId !== tenantId) throw new AccessDeniedError();

  if (path.startsWith('/ora')) {
    const ora = new OraCapabilityAdapter(store, kernel.tracer);
    if (method === 'GET' && path === '/ora/capabilities') {
      return { status: 200, body: ora.catalog(), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'GET' && path.startsWith('/ora/jobs/')) {
      const jobId = path.slice('/ora/jobs/'.length);
      return { status: 200, body: await ora.getJob(ctx, jobId), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/cdr-pdf') {
      return { status: 201, body: await ora.runCdrPdf(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/flags') {
      return { status: 201, body: await ora.runFlags(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/pattern/search') {
      return { status: 200, body: await ora.searchPatterns(ctx, String(body.query || '')), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/pattern/resolve') {
      return { status: 201, body: await ora.resolvePattern(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/candy-bar') {
      return { status: 201, body: await ora.runCandyBar(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/luggage-cover') {
      return { status: 201, body: await ora.runLuggage(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/batch') {
      return { status: 201, body: await ora.runBatch(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/16k/prepare') {
      return { status: 201, body: await ora.prepare16k(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'GET' && path === '/ora/files/intents') {
      return { status: 200, body: { intents: ora.catalog().fileIntents }, tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/analyze') {
      return { status: 201, body: await ora.analyzeFile(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/convert') {
      return { status: 201, body: await ora.convertFile(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/vectorize') {
      return { status: 201, body: await ora.vectorizeFile(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/scale') {
      return { status: 201, body: await ora.scaleFile(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/preflight') {
      return { status: 201, body: await ora.preflightFile(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/files/prepare-print') {
      return { status: 201, body: await ora.preparePrint(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/dtf') {
      return { status: 201, body: await ora.runDtf(ctx, body, 'DTF'), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/dtf-uv') {
      return { status: 201, body: await ora.runDtf(ctx, body, 'DTF_UV'), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/documents') {
      return { status: 201, body: await ora.runDocumentIntelligence(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/pack') {
      return { status: 201, body: await ora.runProductionPack(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    if (method === 'POST' && path === '/ora/tpu/prepare') {
      return { status: 201, body: await ora.prepareTpu(ctx, body), tenant: tenantId, actor: ctx.userId };
    }
    throw new ResourceNotFoundError();
  }

  if (!kernel.admins.has(tenantId)) {
    kernel.admins.set(tenantId, adminForTenant(store, tenantId, kernel.orders, kernel.control));
  }
  const admin = kernel.admins.get(tenantId)!;

  if (path.startsWith('/client')) {
    const headerTenant = String(req.headers['x-tenant-id'] || '').trim();
    if (headerTenant && headerTenant !== tenantId) throw new AccessDeniedError();
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    if (liveUser.emailVerified === false) throw new AccessDeniedError();
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    return clientPortalRoutes(kernel, service, ctx, method, path, body, url);
  }

  if (method === 'POST' && path === '/customers/register') {
    const profile = await kernel.portal.register({
      tenantId,
      name: String(body.name || ''),
      contact: String(body.contact || ''),
      login: String(body.login || ''),
      password: String(body.password || ''),
    });
    return { status: 200, body: profile, tenant: tenantId };
  }

  if (ctx.roleId === 'CUSTOMER') {
    if (path.startsWith('/admin')) throw new AccessDeniedError();
    return customerRoutes(kernel, ctx, method, path, body, url);
  }

  if (method === 'GET' && path === '/tenants/me') {
    const tenant = await store.getTenant(tenantId);
    return { status: 200, body: tenant, actor: ctx.userId, tenant: tenantId };
  }
  if (method === 'GET' && path === '/admin/security/incidents') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    return {
      status: 200,
      body: await kernel.security.listIncidents(ctx, {
        level: url.searchParams.get('level') || undefined,
        tenantId: ctx.tenantId,
      }),
      actor: ctx.userId,
      tenant: tenantId,
    };
  }
  if (method === 'GET' && path === '/admin/security/whatsapp') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    return { status: 200, body: await kernel.security.getWhatsApp(ctx), actor: ctx.userId, tenant: tenantId };
  }
  if (method === 'PUT' && path === '/admin/security/whatsapp') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    return {
      status: 200,
      body: await kernel.security.saveWhatsApp(ctx, {
        whatsappNumber: body.whatsappNumber != null ? String(body.whatsappNumber) : undefined,
        whatsappAlerts: body.whatsappAlerts ? (String(body.whatsappAlerts) as never) : undefined,
      }),
      actor: ctx.userId,
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/admin/security/whatsapp/verify') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    return { status: 200, body: await kernel.security.verifyWhatsApp(ctx, String(body.code || '')), actor: ctx.userId, tenant: tenantId };
  }

  if (method === 'GET' && path === '/onboarding') {
    return { status: 200, body: await admin.getOnboarding(ctx), tenant: tenantId };
  }
  if (method === 'PUT' && path === '/onboarding/step') {
    return { status: 200, body: await admin.saveOnboardingStep(ctx, Number(body.step) as 1), tenant: tenantId };
  }
  if (method === 'PUT' && path === '/onboarding/identity') {
    const tenant = await admin.saveOnboardingIdentity(ctx, {
      commercialName: String(body.commercialName || body.name || ''),
      internalName: body.internalName ? String(body.internalName) : undefined,
      contact: body.contact ? String(body.contact) : undefined,
      logoRef: body.logoRef ? String(body.logoRef) : undefined,
      locale: body.locale ? String(body.locale) : undefined,
      currency: String(body.currency || ''),
      timezone: String(body.timezone || ''),
    });
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'tenant.identity',
      entity: 'tenant',
      entityId: tenantId,
    });
    return { status: 200, body: tenant, tenant: tenantId };
  }
  if (method === 'PUT' && path === '/onboarding/slots') {
    return { status: 200, body: await admin.setAdminSlots(ctx, Number(body.slots)), tenant: tenantId };
  }
  if (method === 'POST' && path === '/onboarding/complete') {
    const tenant = await admin.completeOnboarding(ctx);
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'tenant.activate.operation',
      entity: 'tenant',
      entityId: tenantId,
    });
    return { status: 200, body: tenant, tenant: tenantId };
  }
  if (method === 'POST' && path === '/onboarding/complete-default') {
    const tenant = await admin.completeDefaultOnboarding(ctx);
    return { status: 200, body: tenant, tenant: tenantId };
  }

  if (method === 'POST' && path === '/tenant/setup/rubro') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const rubro = String(body.rubro || '').toUpperCase() as Rubro;
    if (!['TEXTIL', 'TPU', 'DTF', 'PUBLICIDAD', 'CUSTOM'].includes(rubro)) throw new Error('INVALID_RUBRO');
    return { status: 200, body: await admin.setupRubro(ctx, rubro), tenant: tenantId };
  }
  if (method === 'POST' && path === '/tenant/setup/complete') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    return { status: 200, body: await admin.completeSetup(ctx), tenant: tenantId };
  }
  if (method === 'GET' && path === '/tenant/config') {
    return { status: 200, body: await admin.getTenantConfigView(ctx), tenant: tenantId };
  }
  if (method === 'PUT' && path === '/tenant/config/limits') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    return { status: 200, body: await admin.updateLimits(ctx, body as never), tenant: tenantId };
  }

  if (path.startsWith('/admin/config')) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    const cfg = new AdminConfigService(admin, kernel.orders, kernel.tracer, kernel.workflows);
    const isGet = method === 'GET';
    authorizePermission(isGet ? 'config.view' : 'config.edit')(ctx);
    if (method === 'GET' && path === '/admin/config/products') {
      return { status: 200, body: await cfg.listProducts(ctx), tenant: tenantId };
    }
    if (method === 'POST' && path === '/admin/config/products') {
      return { status: 201, body: await cfg.createProduct(ctx, body), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/products/order') {
      return { status: 200, body: await cfg.reorderProducts(ctx, (body.order as never) || []), tenant: tenantId };
    }
    const prod = path.match(/^\/admin\/config\/products\/([^/]+)$/);
    if (method === 'PUT' && prod) {
      return { status: 200, body: await cfg.updateProduct(ctx, prod[1], body), tenant: tenantId };
    }
    if (method === 'DELETE' && prod) {
      return { status: 200, body: await cfg.deactivateProduct(ctx, prod[1]), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/materials') {
      return { status: 200, body: await cfg.listMaterials(ctx), tenant: tenantId };
    }
    if (method === 'POST' && path === '/admin/config/materials') {
      return { status: 201, body: await cfg.createMaterial(ctx, body), tenant: tenantId };
    }
    const mat = path.match(/^\/admin\/config\/materials\/([^/]+)$/);
    if (method === 'PUT' && mat) {
      return { status: 200, body: await cfg.updateMaterial(ctx, mat[1], body), tenant: tenantId };
    }
    if (method === 'DELETE' && mat) {
      return { status: 200, body: await cfg.deactivateMaterial(ctx, mat[1]), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/workflow') {
      return { status: 200, body: await cfg.getWorkflow(ctx), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/workflow') {
      return { status: 200, body: await cfg.updateWorkflow(ctx, body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/pricing') {
      return { status: 200, body: await cfg.getPricing(ctx), tenant: tenantId };
    }
    const priceP = path.match(/^\/admin\/config\/pricing\/products\/([^/]+)$/);
    if (method === 'PUT' && priceP) {
      return { status: 200, body: await cfg.updateProductPrice(ctx, priceP[1], body), tenant: tenantId };
    }
    const priceM = path.match(/^\/admin\/config\/pricing\/materials\/([^/]+)$/);
    if (method === 'PUT' && priceM) {
      return { status: 200, body: await cfg.updateMaterialCost(ctx, priceM[1], body), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/client-visibility') {
      return { status: 200, body: await cfg.putClientVisibility(ctx, body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/flow') {
      return { status: 200, body: await cfg.getFlowConfiguration(ctx), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/flow') {
      return { status: 200, body: await cfg.putFlowConfiguration(ctx, body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/limits') {
      return { status: 200, body: await cfg.getLimits(ctx), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/limits') {
      return { status: 200, body: await cfg.putLimits(ctx, body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/client-options') {
      const opts = await kernel.fulfillment.options(ctx);
      return { status: 200, body: kernel.fulfillment.publicOptions(opts, ctx.lang || 'es'), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/client-options') {
      const opts = await kernel.fulfillment.putOptions(ctx, body);
      return { status: 200, body: kernel.fulfillment.publicOptions(opts, ctx.lang || 'es'), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/config/commercial') {
      return { status: 200, body: await cfg.getCommercial(ctx), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/config/commercial') {
      return { status: 200, body: await cfg.putCommercial(ctx, body), tenant: tenantId };
    }
    return { status: 404, body: { error: 'NOT_FOUND' }, tenant: tenantId };
  }

  if (
    path.startsWith('/admin/workshop-catalog') ||
    path.startsWith('/admin/size-tables') ||
    path === '/admin/tpu-config' ||
    path.startsWith('/admin/ops/') ||
    path === '/admin/customers' ||
    /^\/admin\/customers\/[^/]+$/.test(path) ||
    /^\/admin\/customers\/[^/]+\/membership$/.test(path)
  ) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    const { membership, catalog, ops } = opsOf(kernel);
    if (method === 'GET' && path === '/admin/workshop-catalog/categories') {
      return { status: 200, body: await catalog.categories(ctx, false), tenant: tenantId };
    }
    const catPut = path.match(/^\/admin\/workshop-catalog\/categories\/([^/]+)$/);
    if (method === 'PUT' && catPut) {
      return { status: 200, body: await catalog.setCategory(ctx, catPut[1], body.enabled !== false && body.enabled !== 0), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/workshop-catalog/items') {
      return { status: 200, body: await catalog.listItems(ctx, false), tenant: tenantId };
    }
    if (method === 'POST' && path === '/admin/workshop-catalog/items') {
      return { status: 201, body: await catalog.createItem(ctx, body), tenant: tenantId };
    }
    const itemPut = path.match(/^\/admin\/workshop-catalog\/items\/([^/]+)$/);
    if (method === 'PUT' && itemPut) {
      return { status: 200, body: await catalog.updateItem(ctx, itemPut[1], body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/size-tables') {
      return { status: 200, body: { tables: await catalog.listSizeTables(ctx, url.searchParams.get('garmentType') || undefined) }, tenant: tenantId };
    }
    if (method === 'POST' && path === '/admin/size-tables') {
      return { status: 201, body: await catalog.createSizeTable(ctx, body), tenant: tenantId };
    }
    const sizePut = path.match(/^\/admin\/size-tables\/([^/]+)$/);
    if (method === 'GET' && sizePut) {
      return { status: 200, body: await catalog.getSizeTable(ctx, sizePut[1]), tenant: tenantId };
    }
    if (method === 'PUT' && sizePut) {
      return { status: 200, body: await catalog.updateSizeTable(ctx, sizePut[1], body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/tpu-config') {
      return { status: 200, body: await catalog.getTpuConfig(ctx), tenant: tenantId };
    }
    if (method === 'PUT' && path === '/admin/tpu-config') {
      return { status: 200, body: await catalog.putTpuConfig(ctx, body), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/customers') {
      const ws = workshopOf(kernel, tenantId);
      return {
        status: 200,
        body: await ws.listCustomers(ctx, {
          membershipStatus: url.searchParams.get('membershipStatus') || undefined,
          messageStatus: url.searchParams.get('messageStatus') || undefined,
          recent: url.searchParams.get('recent') === '1' || url.searchParams.get('recent') === 'true',
        }),
        tenant: tenantId,
      };
    }
    if (method === 'POST' && path === '/admin/customers') {
      const ws = workshopOf(kernel, tenantId);
      return {
        status: 201,
        body: await ws.createCustomer(ctx, {
          email: String(body.email || ''),
          password: String(body.password || ''),
          name: String(body.name || ''),
          phone: body.phone ? String(body.phone) : undefined,
          preferredLanguage: body.preferredLanguage ? String(body.preferredLanguage) : undefined,
          country: body.country ? String(body.country) : undefined,
          region: body.region ? String(body.region) : undefined,
          city: body.city ? String(body.city) : undefined,
          postalCode: body.postalCode ? String(body.postalCode) : undefined,
          membershipStatus: body.membershipStatus ? (String(body.membershipStatus) as never) : undefined,
        }),
        tenant: tenantId,
      };
    }
    const cust = path.match(/^\/admin\/customers\/([^/]+)(?:\/(.*))?$/);
    if (cust) {
      const ws = workshopOf(kernel, tenantId);
      if (method === 'GET' && !cust[2]) {
        return { status: 200, body: await ws.getCustomer(ctx, cust[1]), tenant: tenantId };
      }
      if (method === 'PUT' && cust[2] === 'membership') {
        return {
          status: 200,
          body: await membership.setStatus(ctx, cust[1], String(body.status || '') as never),
          tenant: tenantId,
        };
      }
    }
    if (method === 'POST' && path === '/admin/ops/orders') {
      const key = String(req.headers['idempotency-key'] || body.idempotencyKey || '');
      if (key) {
        const hit = await store.getIdempotency(tenantId, key);
        if (hit) return { status: Number(hit.status), body: JSON.parse(hit.body), tenant: tenantId };
      }
      const created = await ops.create(ctx, {
        customerId: body.customerId ? String(body.customerId) : undefined,
        items: Array.isArray(body.items) ? (body.items as Array<{ itemId: string; quantity: number }>) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      });
      const payload = { order: created };
      if (key) await store.saveIdempotency(tenantId, key, method, path, 201, payload);
      return { status: 201, body: payload, tenant: tenantId };
    }
    const opsSt = path.match(/^\/admin\/ops\/orders\/([^/]+)\/status$/);
    if (method === 'PUT' && opsSt) {
      return { status: 200, body: { order: await ops.setOperationalStatus(ctx, opsSt[1], String(body.status || body.to || '')) }, tenant: tenantId };
    }
    return { status: 404, body: { error: 'NOT_FOUND' }, tenant: tenantId };
  }

  if (path.startsWith('/admin/messages')) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    authorizePermission('orders.view')(ctx);
    const msgSvc = new ClientMessageService(store, kernel.tracer, kernel.emailService);
    if (method === 'GET' && path === '/admin/messages/stats') {
      return { status: 200, body: await msgSvc.stats(ctx), tenant: tenantId };
    }
    if (method === 'GET' && path === '/admin/messages') {
      return {
        status: 200,
        body: await msgSvc.listAdmin(ctx, {
          status: url.searchParams.get('status') || undefined,
          category: url.searchParams.get('category') || undefined,
          customerId: url.searchParams.get('customerId') || undefined,
          q: url.searchParams.get('q') || undefined,
          evaluationStatus: url.searchParams.get('evaluationStatus') || undefined,
        }),
        tenant: tenantId,
      };
    }
    const adm = path.match(/^\/admin\/messages\/([^/]+)(?:\/(.*))?$/);
    if (adm) {
      const id = adm[1];
      const rest = adm[2] || '';
      if (method === 'GET' && rest === '') return { status: 200, body: await msgSvc.getAdmin(ctx, id), tenant: tenantId };
      if (method === 'POST' && rest === 'reply') {
        return { status: 200, body: await msgSvc.replyAdmin(ctx, id, String(body.content || '')), tenant: tenantId };
      }
      if (method === 'PUT' && rest === 'status') {
        return { status: 200, body: await msgSvc.setStatus(ctx, id, String(body.status || '')), tenant: tenantId };
      }
      if (method === 'PUT' && rest === 'evaluate') {
        return { status: 200, body: await msgSvc.evaluate(ctx, id, body), tenant: tenantId };
      }
      if (method === 'PUT' && rest === 'category') {
        return { status: 200, body: await msgSvc.classify(ctx, id, String(body.category || '')), tenant: tenantId };
      }
    }
    return { status: 404, body: { error: 'NOT_FOUND' }, tenant: tenantId };
  }

  if (method === 'POST' && path === '/admin/trust-codes') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    return {
      status: 201,
      body: await service.addTrustCode(ctx, { code: String(body.code || ''), creditLimit: Number(body.creditLimit || 0) }),
      tenant: tenantId,
    };
  }

  const creditPath = path.match(/^\/admin\/customers\/([^/]+)\/credit$/);
  if (creditPath) {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    if (method === 'GET') {
      return { status: 200, body: await service.getCredit(ctx, creditPath[1]), tenant: tenantId };
    }
    if (method === 'PUT') {
      return {
        status: 200,
        body: await service.putCredit(ctx, creditPath[1], {
          creditLimit: body.creditLimit != null ? Number(body.creditLimit) : undefined,
          paymentAmount: body.paymentAmount != null ? Number(body.paymentAmount) : undefined,
        }),
        tenant: tenantId,
      };
    }
  }

  const payConfirm = path.match(/^\/admin\/orders\/([^/]+)\/payment\/confirm$/);
  if (method === 'POST' && payConfirm) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    authorizePermission('orders.edit')(ctx);
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    return {
      status: 200,
      body: await service.confirmPayment(
        ctx,
        payConfirm[1],
        body.amountPaid != null ? Number(body.amountPaid) : undefined,
        {
          authorizeException: !!body.authorizeException,
          exceptionNote: body.exceptionNote ? String(body.exceptionNote) : undefined,
        }
      ),
      tenant: tenantId,
    };
  }

  const payRefund = path.match(/^\/admin\/orders\/([^/]+)\/payment\/refund$/);
  if (method === 'POST' && payRefund) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    authorizePermission('orders.edit')(ctx);
    return {
      status: 200,
      body: await kernel.payments.refund(ctx, payRefund[1], body.amount != null ? Number(body.amount) : undefined),
      tenant: tenantId,
    };
  }

  const priceDecision = path.match(/^\/admin\/orders\/([^/]+)\/price-decision$/);
  if (method === 'POST' && priceDecision) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    authorizePermission('orders.edit')(ctx);
    const service = new ClientPortalService(
      store,
      kernel.orders,
      kernel.portal,
      admin,
      kernel.tracer,
      kernel.workflows,
      kernel.orchestrator
    );
    return {
      status: 200,
      body: await service.decidePrice(ctx, priceDecision[1], {
        decision: String(body.decision || '').toUpperCase() === 'UPDATE' ? 'UPDATE' : 'KEEP',
        note: body.note ? String(body.note) : undefined,
      }),
      tenant: tenantId,
    };
  }

  if (method === 'POST' && path === '/admin/users') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const created = await admin.createStaffUser(ctx, {
      email: String(body.email || body.login || ''),
      name: String(body.name || ''),
      role: String(body.role || body.roleId || ''),
      password: body.password ? String(body.password) : undefined,
      permissions: (body.permissions as Record<string, boolean>) || undefined,
    });
    return { status: 201, body: created, tenant: tenantId };
  }
  if (method === 'GET' && path === '/admin/users') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    return { status: 200, body: await admin.listStaffUsers(ctx), tenant: tenantId };
  }
  const staffPerm = path.match(/^\/admin\/users\/([^/]+)\/permissions$/);
  if (method === 'PUT' && staffPerm) {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const mapped = body.permissions;
    const list = Array.isArray(mapped)
      ? (mapped as string[])
      : Object.entries((mapped as Record<string, boolean>) || {})
          .filter(([, v]) => v)
          .map(([k]) => k);
    return { status: 200, body: await admin.updatePermissions(ctx, staffPerm[1], list), tenant: tenantId };
  }
  const staffUser = path.match(/^\/admin\/users\/([^/]+)$/);
  if (method === 'DELETE' && staffUser) {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const user = await admin.deactivateStaffUser(ctx, staffUser[1]);
    await store.deleteSessionsForUser(staffUser[1]);
    return { status: 200, body: user, tenant: tenantId };
  }

  if (method === 'POST' && path === '/disciplines/enable') {
    const config = await admin.setDisciplineEnabled(ctx, String(body.disciplineId || body.id), body.enabled !== false);
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: body.enabled === false ? 'discipline.disable' : 'discipline.enable',
      entity: 'discipline',
      entityId: String(body.disciplineId || body.id),
    });
    return { status: 200, body: config, tenant: tenantId };
  }
    if (method === 'POST' && path === '/schemas/publish') {
    const schema = await admin.publishSchema(ctx, String(body.disciplineId));
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'schema.published',
      entity: 'schema',
      entityId: String(body.disciplineId),
    });
    return { status: 200, body: schema, tenant: tenantId };
  }
  if (method === 'POST' && path === '/schemas/archive') {
    const schema = await admin.archiveSchema(ctx, String(body.disciplineId), body.version != null ? Number(body.version) : undefined);
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'schema.archived',
      entity: 'schema',
      entityId: String(body.disciplineId),
    });
    return { status: 200, body: schema, tenant: tenantId };
  }
  if (method === 'GET' && path === '/schemas/published') {
    const disciplineId = String(url.searchParams.get('disciplineId') || body.disciplineId || '');
    return { status: 200, body: await admin.getPublishedSchema(ctx, disciplineId), tenant: tenantId };
  }
  if (method === 'POST' && path === '/forms/validate') {
    return {
      status: 200,
      body: await admin.validateForm(ctx, {
        disciplineId: String(body.disciplineId),
        values: (body.values as Record<string, unknown>) || {},
        productId: body.productId ? String(body.productId) : undefined,
      }),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/forms/instances') {
    return {
      status: 200,
      body: await admin.createFormInstance(ctx, {
        rubricId: String(body.rubricId || body.disciplineId),
        productId: body.productId ? String(body.productId) : undefined,
        values: (body.values as Record<string, unknown>) || {},
      }),
      tenant: tenantId,
    };
  }
  const instanceMatch = path.match(/^\/forms\/instances\/([^/]+)$/);
  if (method === 'PUT' && instanceMatch) {
    return {
      status: 200,
      body: await admin.saveFormResponse(ctx, instanceMatch[1], (body.values as Record<string, unknown>) || {}),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/fields/deactivate') {
    const config = await admin.deactivateField(ctx, String(body.disciplineId), String(body.fieldId));
    return { status: 200, body: config, tenant: tenantId };
  }
  if (method === 'POST' && path === '/fields/reorder') {
    return {
      status: 200,
      body: await admin.reorderFields(ctx, String(body.disciplineId), (body.fieldIds as string[]) || []),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/orders/from-form') {
    const created = await admin.submitConfiguredOrder(ctx, {
      disciplineId: String(body.disciplineId),
      values: (body.values as Record<string, unknown>) || {},
      customerId: String(body.customerId || ctx.userId),
      customerName: String(body.customerName || 'Cliente'),
      dueAt: Number(body.dueAt || Date.now() + 86400000),
      summary: body.summary ? String(body.summary) : undefined,
    });
    return { status: 200, body: created, tenant: tenantId };
  }
  if (method === 'GET' && path.startsWith('/forms/') && path.endsWith('/preview')) {
    const disciplineId = path.split('/')[2];
    return { status: 200, body: await admin.previewCustomerForm(ctx, disciplineId), tenant: tenantId };
  }
  if (method === 'PUT' && path === '/materials') {
    const material = body.material || body;
    const config = await admin.upsertMaterial(ctx, material as never);
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'materials.upsert',
      entity: 'material',
      entityId: String((material as { materialId?: string }).materialId || ''),
    });
    return { status: 200, body: config, tenant: tenantId };
  }
  if (method === 'PUT' && path === '/fields') {
    return { status: 200, body: await admin.upsertField(ctx, (body.field || body) as never), tenant: tenantId };
  }

  if (method === 'GET' && path === '/users') {
    assertPerm(ctx, 'users.view');
    return { status: 200, body: await admin.listUsers(ctx), tenant: tenantId };
  }

  if (method === 'POST' && path === '/users') {
    if (body.roleId === 'ADMIN_PRINCIPAL' || body.roleId === 'SUPER_ADMIN' || body.isSuperAdmin) {
      throw new AccessDeniedError();
    }
    const created = await admin.createAdmin(ctx, {
      login: body.login ? String(body.login) : undefined,
      password: body.password ? String(body.password) : undefined,
      generatePassword: body.generatePassword !== false && !body.password,
      permissions: (body.permissions as string[]) || [],
    });
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'users.create',
      entity: 'user',
      entityId: created.userId,
    });
    return { status: 200, body: created, tenant: tenantId };
  }

  const userMatch = path.match(/^\/users\/([^/]+)\/(permissions|disable|reset)$/);
  if (method === 'POST' && userMatch) {
    const userId = userMatch[1];
    const action = userMatch[2];
    if (action === 'permissions') {
      const user = await admin.updatePermissions(ctx, userId, (body.permissions as string[]) || []);
      await store.recordAudit({
        id: randomUUID(),
        tenantId,
        actorId: ctx.userId,
        action: 'users.permissions',
        entity: 'user',
        entityId: userId,
      });
      return { status: 200, body: user, tenant: tenantId };
    }
    if (action === 'disable') {
      const user = await admin.disableAdmin(ctx, userId);
      await store.deleteSessionsForUser(userId);
      await store.recordAudit({
        id: randomUUID(),
        tenantId,
        actorId: ctx.userId,
        action: 'users.disable',
        entity: 'user',
        entityId: userId,
      });
      return { status: 200, body: user, tenant: tenantId };
    }
    const reset = await admin.resetCredentials(ctx, userId, body.password ? String(body.password) : undefined);
    await store.deleteSessionsForUser(userId);
    return { status: 200, body: reset, tenant: tenantId };
  }

  if (method === 'GET' && path === '/configuration') {
    assertPerm(ctx, 'configuration.view');
    return { status: 200, body: await admin.getConfig(ctx), tenant: tenantId };
  }

  if (method === 'GET' && path === '/units') {
    return { status: 200, body: await admin.listUnits(ctx), tenant: tenantId };
  }
  if (method === 'GET' && path === '/products') {
    const products = await admin.listProducts(ctx, false);
    return { status: 200, body: stripSensitiveData(products, ctx.roleId), tenant: tenantId };
  }
  if (method === 'POST' && path === '/products') {
    authorize(['ADMIN_PRINCIPAL'])(ctx);
    const product = await admin.createProduct(ctx, {
      name: String(body.name || ''),
      rubricId: String(body.rubricId || body.disciplineId || ''),
      description: body.description ? String(body.description) : undefined,
      active: body.active !== false,
      schemaId: body.schemaId ? String(body.schemaId) : undefined,
      materialIds: Array.isArray(body.materialIds) ? (body.materialIds as string[]) : [],
      processIds: Array.isArray(body.processIds) ? (body.processIds as string[]) : [],
      unitId: body.unitId ? String(body.unitId) : undefined,
      consumptionRule: body.consumptionRule as never,
      metadata: body.metadata as never,
    });
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'product.create',
      entity: 'product',
      entityId: product.productId,
    });
    return { status: 200, body: product, tenant: tenantId };
  }
  const productMatch = path.match(/^\/products\/([^/]+)$/);
  if (method === 'PUT' && productMatch) {
    const product = await admin.updateProduct(ctx, productMatch[1], body as never);
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: body.active === false ? 'product.deactivate' : 'product.update',
      entity: 'product',
      entityId: productMatch[1],
    });
    return { status: 200, body: product, tenant: tenantId };
  }
  if (method === 'POST' && path === '/catalog/quote') {
    const lines = (body.lines || body.catalogLines || []) as never;
    return { status: 200, body: await admin.quoteCatalog(ctx, lines), tenant: tenantId };
  }
  if (method === 'POST' && path === '/catalog/totals') {
    const lines = (body.lines || body.catalogLines || []) as never;
    return { status: 200, body: await admin.quoteCatalog(ctx, lines), tenant: tenantId };
  }

  if (method === 'GET' && path === '/materials') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    assertPerm(ctx, 'materials.view');
    const materials = await admin.getMaterials(ctx);
    return { status: 200, body: stripSensitiveData(materials, ctx.roleId), tenant: tenantId };
  }

  if (method === 'GET' && path === '/rubrics') {
    const config = await store.getConfig(tenantId);
    return { status: 200, body: config?.disciplines || [], tenant: tenantId };
  }

  if (method === 'GET' && path === '/orders') {
    assertPerm(ctx, 'orders.view');
    const listed = await kernel.orders.listOrders(tenantId, 'admin');
    return {
      status: 200,
      body: listed.map((o) => redactByPerm(o, ctx)),
      tenant: tenantId,
    };
  }

  if (method === 'POST' && path === '/orders') {
    if (!rateLimit(`order:${tenantId}`, 30, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    assertPerm(ctx, 'orders.create');
    await kernel.control.assertOperation(tenantId, 'orders.create');
    const key = String(req.headers['idempotency-key'] || body.idempotencyKey || '');
    if (key) {
      const hit = await store.getIdempotency(tenantId, key);
      if (hit) return { status: Number(hit.status), body: JSON.parse(hit.body), tenant: tenantId };
    }
    let created = await kernel.orders.createOrder(buildCreateOrder(ctx, body));
    const lines = (body.lines || body.catalogLines) as unknown;
    if (Array.isArray(lines) && lines.length) {
      created = await admin.confirmCatalogOrder(ctx, created.orderId, lines as never, body.total != null ? Number(body.total) : undefined);
    }
    await store.recordAudit({
      id: randomUUID(),
      tenantId,
      actorId: ctx.userId,
      action: 'orders.create',
      entity: 'order',
      entityId: created.orderId,
      after: { status: created.status },
    });
    const response = { order: created };
    if (key) await store.saveIdempotency(tenantId, key, 'POST', '/orders', 200, response);
    return { status: 200, body: response, tenant: tenantId };
  }

  const orderMatch = path.match(/^\/orders\/([^/]+)(\/.*)?$/);
  if (orderMatch) {
    const orderId = orderMatch[1];
    const rest = orderMatch[2] || '';
    if (method === 'PATCH' || method === 'PUT') {
      throw new AccessDeniedError();
    }
    const order = await kernel.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== tenantId) throw new AccessDeniedError();
    if (method === 'GET' && rest === '') {
      assertPerm(ctx, 'orders.view');
      const tenantRow = await store.getTenant(tenantId);
      const cfg = await store.getConfig(tenantId);
      if (tenantRow?.timezone) {
        kernel.orders.setDeadlinePolicy({
          approachingWithinMs: cfg?.deadlineApproachingWithinMs || 172800000,
          timeZone: tenantRow.timezone,
        });
      }
      const deadline = kernel.orders.deadlineFor(order);
      const snapshot = await store.getSnapshot(orderId, tenantId);
      return {
        status: 200,
        body: { order: redactByPerm(order, ctx), deadline, snapshot, createdAt: order.createdAt, dueAt: order.dueAt },
        tenant: tenantId,
      };
    }
    if (method === 'GET' && rest === '/costs') {
      assertPerm(ctx, 'costs.view');
      return {
        status: 200,
        body: { orderId, totalInternalCost: order.totalInternalCost, lines: order.consumptions },
        tenant: tenantId,
      };
    }
    if (method === 'POST' && rest === '/status') {
      assertPerm(ctx, 'orders.edit');
      const to = String(body.to) as OrderStatus;
      const expectedRevision = body.expectedRevision != null ? Number(body.expectedRevision) : undefined;
      const updated = body.force
        ? await kernel.center.forceTransition(ctx, orderId, to, String(body.reason || 'override'), expectedRevision)
        : await kernel.center.transition(ctx, orderId, to, expectedRevision);
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
  }

  if (method === 'GET' && (path === '/workspace/dashboard' || path === '/workspace/orders' || path === '/production/center')) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
    authorizePermission('orders.view')(ctx);
    const board = await kernel.center.query(ctx, parseProductionQuery(url));
    if (path === '/workspace/orders') {
      const ws = workshopOf(kernel, tenantId);
      const list = await ws.list(ctx, Object.fromEntries(url.searchParams.entries()));
      return {
        status: 200,
        body: stripSensitiveData({ ...board, items: list.items, total: list.total, pageNumber: list.page, limit: list.limit }, ctx.roleId),
        tenant: tenantId,
      };
    }
    return { status: 200, body: stripSensitiveData(board, ctx.roleId), tenant: tenantId };
  }

  if (method === 'GET' && path === '/workspace/customers') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    const ws = workshopOf(kernel, tenantId);
    return {
      status: 200,
      body: stripSensitiveData(
        await ws.listCustomers(ctx, {
          membershipStatus: url.searchParams.get('membershipStatus') || undefined,
          messageStatus: url.searchParams.get('messageStatus') || undefined,
          recent: url.searchParams.get('recent') === '1' || url.searchParams.get('recent') === 'true',
        }),
        ctx.roleId
      ),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/workspace/customers') {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    const ws = workshopOf(kernel, tenantId);
    return {
      status: 201,
      body: await ws.createCustomer(ctx, {
        email: String(body.email || ''),
        password: String(body.password || ''),
        name: String(body.name || ''),
        phone: body.phone ? String(body.phone) : undefined,
        preferredLanguage: body.preferredLanguage ? String(body.preferredLanguage) : undefined,
        country: body.country ? String(body.country) : undefined,
        region: body.region ? String(body.region) : undefined,
        city: body.city ? String(body.city) : undefined,
        postalCode: body.postalCode ? String(body.postalCode) : undefined,
        membershipStatus: body.membershipStatus ? (String(body.membershipStatus) as never) : undefined,
      }),
      tenant: tenantId,
    };
  }
  const wsCustomer = path.match(/^\/workspace\/customers\/([^/]+)(?:\/(.*))?$/);
  if (wsCustomer) {
    authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
    const ws = workshopOf(kernel, tenantId);
    if (method === 'GET' && !wsCustomer[2]) {
      return { status: 200, body: stripSensitiveData(await ws.getCustomer(ctx, wsCustomer[1]), ctx.roleId), tenant: tenantId };
    }
    if (method === 'POST' && wsCustomer[2] === 'trust-code') {
      authorize(['ADMIN_PRINCIPAL'])(ctx);
      return { status: 201, body: await ws.generateTrustCode(ctx, wsCustomer[1]), tenant: tenantId };
    }
  }

  const wsOrder = path.match(/^\/workspace\/orders\/([^/]+)(?:\/(.*))?$/);
  if (wsOrder) {
    const orderId = wsOrder[1];
    const rest = wsOrder[2] || '';
    const ws = workshopOf(kernel, tenantId);
    if (method === 'GET' && rest === '') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      const detail = await kernel.center.getDetail(ctx, orderId);
      const extra = await ws.detail(ctx, orderId);
      return { status: 200, body: stripSensitiveData({ ...detail, ...extra }, ctx.roleId), tenant: tenantId };
    }
    if (method === 'PUT' && rest === 'status') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      const updated = await ws.setStatus(ctx, orderId, String(body.status || body.to || ''), body.reason ? String(body.reason) : undefined);
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'PUT' && rest === 'fulfillment') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      const updated = await kernel.fulfillment.applyAdmin(ctx, orderId, body);
      return { status: 200, body: { order: updated, fulfillment: updated.fulfillment }, tenant: tenantId };
    }
    if (method === 'GET' && rest === 'files') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      return { status: 200, body: await ws.listFiles(ctx, orderId), tenant: tenantId };
    }
    const fileGet = rest.match(/^files\/([^/]+)$/);
    if (method === 'GET' && fileGet) {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      return { status: 200, body: await ws.downloadOrderFile(ctx, orderId, fileGet[1]), tenant: tenantId };
    }
    const convert = rest.match(/^files\/([^/]+)\/convert$/);
    if (method === 'POST' && convert) {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      const result = await ws.convert(ctx, orderId, convert[1]);
      return { status: result.reused ? 200 : 202, body: result, tenant: tenantId };
    }
    const color = rest.match(/^files\/([^/]+)\/color-profile$/);
    if (method === 'GET' && color) {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      return { status: 200, body: await ws.colorProfile(ctx, orderId, color[1]), tenant: tenantId };
    }
    const fileStatus = rest.match(/^files\/([^/]+)\/status$/);
    if (method === 'PUT' && fileStatus) {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      return {
        status: 200,
        body: await ws.setFileStatus(ctx, orderId, fileStatus[1], String(body.status || ''), body.reason ? String(body.reason) : undefined),
        tenant: tenantId,
      };
    }
    if (method === 'GET' && rest === 'comments') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      return { status: 200, body: await ws.listComments(ctx, orderId), tenant: tenantId };
    }
    if (method === 'GET' && rest === 'payment') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      return { status: 200, body: await ws.getPayment(ctx, orderId), tenant: tenantId };
    }
    if (method === 'POST' && rest === 'price-decision') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      const portal = new ClientPortalService(
        store,
        kernel.orders,
        kernel.portal,
        admin,
        kernel.tracer,
        kernel.workflows,
        kernel.orchestrator
      );
      return {
        status: 200,
        body: await portal.decidePrice(ctx, orderId, {
          decision: String(body.decision || '').toUpperCase() === 'UPDATE' ? 'UPDATE' : 'KEEP',
          note: body.note ? String(body.note) : undefined,
        }),
        tenant: tenantId,
      };
    }
    if (method === 'POST' && rest === 'payment/confirm') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      return {
        status: 200,
        body: await ws.confirmPayment(
          ctx,
          orderId,
          body.amountPaid != null ? Number(body.amountPaid) : undefined,
          {
            authorizeException: !!body.authorizeException,
            exceptionNote: body.exceptionNote ? String(body.exceptionNote) : undefined,
          }
        ),
        tenant: tenantId,
      };
    }
    if (method === 'POST' && rest === 'status') {
      const to = String(body.to) as OrderStatus;
      const expectedRevision = body.expectedRevision != null ? Number(body.expectedRevision) : undefined;
      const updated = await kernel.center.transition(ctx, orderId, to, expectedRevision);
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'force') {
      const updated = await kernel.center.forceTransition(
        ctx,
        orderId,
        String(body.to) as OrderStatus,
        String(body.reason || ''),
        body.expectedRevision != null ? Number(body.expectedRevision) : undefined
      );
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'priority') {
      const updated = await kernel.center.setPriority(
        ctx,
        orderId,
        body.priority as never,
        body.expectedRevision != null ? Number(body.expectedRevision) : undefined
      );
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'assign') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'])(ctx);
      authorizePermission('orders.edit')(ctx);
      const assigned = await ws.assign(ctx, orderId, String(body.userId || body.assignedTo));
      return { status: 200, body: { order: assigned.order, assignment: assigned.assignment }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'comments') {
      const updated = await ws.addComment(ctx, orderId, String(body.content || body.body || body.comment || ''));
      const order = await kernel.orders.getOrder(orderId, 'admin');
      return { status: 200, body: { order, comment: updated }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'due-at') {
      const updated = await kernel.center.setDueAt(
        ctx,
        orderId,
        Number(body.dueAt),
        body.expectedRevision != null ? Number(body.expectedRevision) : undefined
      );
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'POST' && rest === 'versions') {
      const updated = await kernel.center.selectVersion(
        ctx,
        orderId,
        String(body.fileId),
        body.expectedRevision != null ? Number(body.expectedRevision) : undefined
      );
      return { status: 200, body: { order: updated }, tenant: tenantId };
    }
    if (method === 'GET' && rest === 'timeline') {
      authorize(['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN', 'OPERATOR'])(ctx);
      authorizePermission('production.view')(ctx);
      return { status: 200, body: await kernel.tracer.timeline(ctx, orderId), tenant: tenantId };
    }
    if (method === 'GET' && rest === 'workflow') {
      return { status: 200, body: await kernel.workflows.view(ctx, orderId), tenant: tenantId };
    }
    const stepStart = rest.match(/^steps\/([^/]+)\/start$/);
    if (method === 'POST' && stepStart) {
      return {
        status: 200,
        body: await kernel.workflows.startStep(ctx, orderId, stepStart[1], body.expectedRevision != null ? Number(body.expectedRevision) : undefined),
        tenant: tenantId,
      };
    }
    const stepComplete = rest.match(/^steps\/([^/]+)\/complete$/);
    if (method === 'POST' && stepComplete) {
      return {
        status: 200,
        body: await kernel.workflows.completeStep(
          ctx,
          orderId,
          stepComplete[1],
          body.result != null ? String(body.result) : undefined,
          body.expectedRevision != null ? Number(body.expectedRevision) : undefined
        ),
        tenant: tenantId,
      };
    }
    if (method === 'POST' && rest === 'qc') {
      const result = String(body.result || 'PASS') === 'FAIL' ? 'FAIL' : 'PASS';
      return { status: 200, body: await kernel.workflows.qc(ctx, orderId, result, body.expectedRevision != null ? Number(body.expectedRevision) : undefined), tenant: tenantId };
    }
    if (method === 'POST' && rest === 'cancel-workflow') {
      return { status: 200, body: await kernel.workflows.cancel(ctx, orderId, String(body.reason || '')), tenant: tenantId };
    }
    if (method === 'GET' && rest.startsWith('files/')) {
      const fileId = rest.slice('files/'.length);
      return { status: 200, body: await kernel.center.downloadFile(ctx, orderId, fileId), tenant: tenantId };
    }
  }

  if (method === 'GET' && path === '/workflows') {
    assertPerm(ctx, 'production.view');
    return { status: 200, body: await kernel.workflows.list(ctx), tenant: tenantId };
  }
  if (method === 'POST' && path === '/workflows/publish') {
    assertPerm(ctx, 'production.edit');
    return {
      status: 200,
      body: await kernel.workflows.publish(ctx, {
        key: String(body.key || 'textile'),
        name: body.name ? String(body.name) : undefined,
        rubricId: body.rubricId ? String(body.rubricId) : undefined,
        productId: body.productId ? String(body.productId) : undefined,
        steps: (body.steps as never) || [],
      }),
      tenant: tenantId,
    };
  }

  if (method === 'POST' && path === '/production/start') {
    assertPerm(ctx, 'production.edit');
    const started = await kernel.orchestrator.startProduction(ctx, String(body.orderId));
    return { status: 200, body: started, tenant: tenantId };
  }

  if (method === 'GET' && path.startsWith('/production/board/')) {
    assertPerm(ctx, 'production.view');
    const orderId = path.slice('/production/board/'.length);
    return { status: 200, body: await kernel.orchestrator.getBoard(ctx, orderId), tenant: tenantId };
  }

  if (method === 'POST' && path.startsWith('/jobs/') && path.endsWith('/retry')) {
    assertPerm(ctx, 'production.edit');
    const jobId = path.split('/')[2];
    return { status: 200, body: await kernel.center.retryJob(ctx, jobId), tenant: tenantId };
  }

  if (method === 'POST' && path.startsWith('/jobs/') && path.endsWith('/fail')) {
    assertPerm(ctx, 'production.edit');
    const jobId = path.split('/')[2];
    return { status: 200, body: await kernel.orchestrator.failJob(ctx, jobId, String(body.error || 'failed')), tenant: tenantId };
  }

  if (method === 'POST' && path.startsWith('/jobs/') && path.endsWith('/run-local')) {
    if (!rateLimit(`job:${tenantId}`, 40, 60_000)) return { status: 429, body: { error: 'RATE_LIMIT' } };
    assertPerm(ctx, 'production.edit');
    const jobId = path.split('/')[2];
    return { status: 200, body: await kernel.orchestrator.runLocal(ctx, jobId), tenant: tenantId };
  }

  if (method === 'GET' && path === '/jobs') {
    assertPerm(ctx, 'production.view');
    const orderId = url.searchParams.get('orderId') || undefined;
    return { status: 200, body: await store.listJobs({ tenantId, orderId }), tenant: tenantId };
  }

  if (method === 'GET' && path === '/processes') {
    assertPerm(ctx, 'production.view');
    const orderId = url.searchParams.get('orderId');
    if (!orderId) return { status: 400, body: { error: 'orderId required' } };
    const order = await kernel.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== tenantId) throw new AccessDeniedError();
    return { status: 200, body: await store.listProcesses(orderId), tenant: tenantId };
  }

  if (method === 'POST' && path === '/workers/register') {
    assertPerm(ctx, 'production.edit');
    const workerId = `worker_${randomUUID()}`;
    const token = newToken();
    const worker = {
      workerId,
      tenantId,
      type: (body.type as 'LOCAL' | 'CLOUD') || 'LOCAL',
      capabilities: (body.capabilities as string[]) || ['image-processing', 'file-processing'],
      status: 'idle' as const,
      lastHeartbeat: Date.now(),
      implementation: 'local-adapter' as const,
      version: String(body.version || '1'),
    };
    await store.saveWorker(worker);
    await store.bindWorkerToken(workerId, tenantId, hashToken(token));
    return { status: 200, body: { worker, token }, tenant: tenantId };
  }

  if (method === 'GET' && path === '/workers') {
    assertPerm(ctx, 'production.view');
    const workers = (await store.listWorkers()).filter((w) => w.tenantId === tenantId);
    return { status: 200, body: workers, tenant: tenantId };
  }

  if (method === 'GET' && path === '/notifications') {
    return {
      status: 200,
      body: await kernel.tracer.listNotifications(ctx, parseNotifQuery(url, body)),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/notifications') {
    throw new AccessDeniedError();
  }
  if (method === 'POST' && path.match(/^\/notifications\/[^/]+\/read$/)) {
    const id = path.split('/')[2];
    return {
      status: 200,
      body: await kernel.tracer.markRead(ctx, id, body.recipientId ? String(body.recipientId) : undefined),
      tenant: tenantId,
    };
  }
  if (method === 'POST' && path === '/ops/evaluate-deadlines') {
    throw new AccessDeniedError();
  }
  if (method === 'POST' && path.match(/^\/users\/[^/]+\/role$/)) {
    const userId = path.split('/')[2];
    return { status: 200, body: await admin.assignRole(ctx, userId, String(body.roleId || 'OPERATOR')), tenant: tenantId };
  }

  if (method === 'GET' && path === '/audit') {
    assertPerm(ctx, 'reports.view');
    return { status: 200, body: await store.listTenantAudit(tenantId), tenant: tenantId };
  }

  return { status: 404, body: { error: 'NOT_FOUND' }, tenant: tenantId };
}

function parseNotifQuery(url: URL, body: Record<string, unknown>) {
  const unread = url.searchParams.get('unread') ?? (body.unread != null ? String(body.unread) : undefined);
  return {
    unread: unread === '1' || unread === 'true' ? true : unread === '0' || unread === 'false' ? false : undefined,
    type: url.searchParams.get('type') || (body.type ? String(body.type) : undefined),
    entityId: url.searchParams.get('entityId') || (body.entityId ? String(body.entityId) : undefined),
    from: url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined,
    to: url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined,
    cursor: url.searchParams.get('cursor') || (body.cursor ? String(body.cursor) : undefined),
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : body.limit != null ? Number(body.limit) : undefined,
    recipientId: url.searchParams.get('recipientId') || (body.recipientId ? String(body.recipientId) : undefined),
  };
}

function redactByPerm(order: ReturnType<typeof redactOrderForViewer> extends never ? never : import('../contracts/order-domain').PersistedOrder, ctx: AuthContext) {
  if (!hasPermission(probe(ctx), 'costs.view')) {
    return redactOrderForViewer(
      { ...order, visibility: { ...order.visibility, internalCost: false, purchasePrice: false, margin: false } },
      'subadmin'
    );
  }
  return order;
}

async function clientPortalRoutes(
  kernel: ControlPlaneKernel,
  service: ClientPortalService,
  ctx: AuthContext,
  method: string,
  path: string,
  body: Record<string, unknown>,
  url: URL
): Promise<{ status: number; body: unknown; actor?: string; tenant?: string }> {
  const wrap = (status: number, payload: unknown) => ({
    status,
    body: stripSensitiveData(payload, 'CUSTOMER'),
    tenant: ctx.tenantId,
    actor: ctx.userId,
  });
  if (method === 'POST' && path === '/client/activate-trust') {
    return wrap(200, await service.activateTrust(ctx, String(body.trustCode || '')));
  }
  if (method === 'GET' && path === '/client/dashboard') {
    return wrap(200, await service.dashboard(ctx));
  }
  if (method === 'GET' && path === '/client/catalog') {
    return wrap(200, await service.catalog(ctx));
  }
  if (method === 'GET' && path === '/client/size-tables') {
    const catalog = new WorkshopCatalogService(kernel.store);
    return wrap(200, { tables: await catalog.listSizeTables(ctx, url.searchParams.get('garmentType') || undefined) });
  }
  if (method === 'GET' && path === '/client/tpu-config') {
    const catalog = new WorkshopCatalogService(kernel.store);
    return wrap(200, await catalog.getTpuConfig(ctx));
  }
  if (method === 'GET' && path === '/client/workshop-catalog') {
    const catalog = new WorkshopCatalogService(kernel.store);
    return wrap(200, {
      categories: await catalog.categories(ctx, true),
      items: await catalog.listItems(ctx, true),
    });
  }
  if (method === 'GET' && path === '/client/membership') {
    return wrap(200, await new MembershipService(kernel.store, kernel.orders).getMine(ctx));
  }
  if (method === 'GET' && path === '/client/fulfillment-options') {
    const opts = await kernel.fulfillment.options(ctx);
    return wrap(200, kernel.fulfillment.publicOptions(opts, ctx.lang || 'es'));
  }
  if (method === 'GET' && path === '/client/flow-configuration') {
    return wrap(200, await service.getFlowConfiguration(ctx));
  }
  if (method === 'GET' && path === '/client/profile') {
    return wrap(200, await service.getProfile(ctx));
  }
  if (method === 'PUT' && path === '/client/profile') {
    return wrap(200, await service.updateProfile(ctx, body));
  }
  const msgSvc = new ClientMessageService(kernel.store, kernel.tracer, kernel.emailService);
  if (method === 'POST' && path === '/client/messages') {
    return wrap(201, await msgSvc.create(ctx, body));
  }
  if (method === 'GET' && path === '/client/messages') {
    return wrap(200, await msgSvc.listMine(ctx));
  }
  const cliMsg = path.match(/^\/client\/messages\/([^/]+)(?:\/(.*))?$/);
  if (cliMsg) {
    const id = cliMsg[1];
    const rest = cliMsg[2] || '';
    if (method === 'GET' && rest === '') return wrap(200, await msgSvc.getMine(ctx, id));
    if (method === 'POST' && rest === 'reply') return wrap(200, await msgSvc.replyMine(ctx, id, String(body.content || '')));
  }
  if (method === 'GET' && path === '/client/orders') {
    return wrap(
      200,
      await service.listOrders(ctx, {
        status: url.searchParams.get('status') || undefined,
        page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      })
    );
  }
  if (method === 'POST' && path === '/client/orders/quote') {
    return wrap(
      200,
      await service.quoteWorkshop(ctx, {
        workshopItemId: String(body.workshopItemId || body.itemId || ''),
        quantity: Number(body.quantity),
      })
    );
  }
  if (method === 'POST' && path === '/client/orders') {
    return wrap(
      201,
      await service.createOrder(ctx, {
        productId: body.productId ? String(body.productId) : undefined,
        workshopItemId: body.workshopItemId ? String(body.workshopItemId) : undefined,
        quantity: Number(body.quantity),
        projectName: body.projectName ? String(body.projectName) : undefined,
        formData: (body.formData as Record<string, unknown>) || undefined,
        notes: body.notes ? String(body.notes) : undefined,
        fulfillment: (body.fulfillment as Record<string, unknown>) || {
          fulfillmentMode: body.fulfillmentMode,
          delivery: body.delivery,
          recipient: body.recipient,
          pickupAuthorized: body.pickupAuthorized,
          requester: body.requester,
          payer: body.payer,
          commercialAccountId: body.commercialAccountId,
        },
      })
    );
  }
  const orderMatch = path.match(/^\/client\/orders\/([^/]+)(?:\/(.*))?$/);
  if (orderMatch) {
    const orderId = orderMatch[1];
    const rest = orderMatch[2] || '';
    if (method === 'GET' && rest === '') return wrap(200, await service.getOrder(ctx, orderId));
    if ((method === 'PATCH' || method === 'PUT') && rest === '') {
      return wrap(
        200,
        await service.updateDraft(ctx, orderId, {
          projectName: body.projectName != null ? String(body.projectName) : undefined,
          formData: (body.formData as Record<string, unknown>) || undefined,
          rawMaterial: body.rawMaterial != null ? !!body.rawMaterial : undefined,
          previewApproved: body.previewApproved != null ? !!body.previewApproved : undefined,
        })
      );
    }
    if ((method === 'PATCH' || method === 'PUT') && rest === 'configuration') {
      return wrap(200, await service.configureOrder(ctx, orderId, body));
    }
    if (method === 'POST' && rest === 'preview-3d-decision') {
      return wrap(200, await service.decidePreview3D(ctx, orderId, body));
    }
    if (method === 'GET' && rest === 'timeline') {
      return wrap(200, await kernel.tracer.timeline(ctx, orderId));
    }
    if (method === 'POST' && rest === 'files') {
      return wrap(
        201,
        await service.uploadFile(ctx, orderId, {
          filename: String(body.filename || 'file'),
          mimeType: String(body.mimeType || 'application/octet-stream'),
          contentBase64: String(body.contentBase64 || ''),
        })
      );
    }
    if (method === 'POST' && rest === 'ojo') {
      return wrap(
        200,
        await service.interpretOjo(ctx, orderId, {
          fileId: body.fileId ? String(body.fileId) : undefined,
          region: body.region,
          hints: body.hints,
        })
      );
    }
    const clientFile = rest.match(/^files\/([^/]+)$/);
    if (method === 'GET' && clientFile) {
      return wrap(200, await service.downloadOrderFile(ctx, orderId, clientFile[1]));
    }
    if (method === 'POST' && rest === 'roster') {
      return wrap(
        200,
        await service.reviewRoster(ctx, orderId, {
          records: Array.isArray(body.records) ? (body.records as never) : undefined,
          approve: !!body.approve,
          reject: !!body.reject,
        })
      );
    }
    if (method === 'POST' && rest === 'submit') return wrap(200, await service.submit(ctx, orderId));
    if (method === 'POST' && rest === 'production-outputs') {
      return wrap(201, await service.generateProductionOutputs(ctx, orderId));
    }
    if (method === 'POST' && rest === 'approve') return wrap(200, await service.approve(ctx, orderId));
    if (method === 'POST' && rest === 'request-changes') {
      return wrap(200, await service.requestChanges(ctx, orderId, String(body.message || body.note || '')));
    }
    if (method === 'POST' && rest === 'payment/voucher') {
      return wrap(
        200,
        await service.uploadVoucher(ctx, orderId, {
          filename: String(body.filename || 'voucher'),
          mimeType: String(body.mimeType || 'application/octet-stream'),
          contentBase64: String(body.contentBase64 || ''),
        })
      );
    }
    if (method === 'POST' && rest === 'payment/checkout') {
      return wrap(200, await kernel.payments.checkout(ctx, orderId));
    }
    if (method === 'GET' && rest === 'payment/status') {
      return wrap(200, await kernel.payments.status(ctx, orderId));
    }
  }
  if (method === 'GET' && path === '/client/notifications') {
    return wrap(200, await kernel.tracer.listNotifications(ctx, parseNotifQuery(url, body)));
  }
  if (method === 'POST' && path.match(/^\/client\/notifications\/[^/]+\/read$/)) {
    const id = path.split('/')[3];
    return wrap(200, await kernel.tracer.markRead(ctx, id, body.recipientId ? String(body.recipientId) : undefined));
  }
  return { status: 404, body: { error: 'NOT_FOUND' }, tenant: ctx.tenantId };
}

async function customerRoutes(
  kernel: ControlPlaneKernel,
  ctx: AuthContext,
  method: string,
  path: string,
  body: Record<string, unknown>,
  url: URL
) {
  if (path.startsWith('/workspace') || path === '/production/center' || path.startsWith('/production/center') || path.startsWith('/workflows') || path.startsWith('/ops')) {
    throw new AccessDeniedError();
  }
  if (method === 'POST' && path === '/notifications') throw new AccessDeniedError();
  if (method === 'GET' && path === '/notifications') {
    return {
      status: 200,
      body: await kernel.tracer.listNotifications(ctx, parseNotifQuery(url, body)),
      tenant: ctx.tenantId,
    };
  }
  if (method === 'POST' && path.match(/^\/notifications\/[^/]+\/read$/)) {
    const id = path.split('/')[2];
    return {
      status: 200,
      body: await kernel.tracer.markRead(ctx, id, body.recipientId ? String(body.recipientId) : undefined),
      tenant: ctx.tenantId,
    };
  }
  if (method === 'GET' && path.match(/^\/orders\/[^/]+\/timeline$/)) {
    const orderId = path.split('/')[2];
    return { status: 200, body: await kernel.tracer.timeline(ctx, orderId), tenant: ctx.tenantId };
  }
  const admin = kernel.admins.get(ctx.tenantId);
  if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    throw new AccessDeniedError();
  }
  if (path.includes('internalCost') || path.endsWith('/costs') || path.endsWith('/customerPrice') || path.endsWith('/status')) {
    throw new AccessDeniedError();
  }
  if (method === 'GET' && path === '/customers/me') {
    const profile = await kernel.store.getCustomer(ctx.userId);
    if (!profile || profile.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return { status: 200, body: profile, tenant: ctx.tenantId, actor: ctx.userId };
  }
  if (method === 'GET' && path === '/portal/meta') {
    return { status: 200, body: await kernel.portal.meta(ctx), tenant: ctx.tenantId };
  }
  if (method === 'GET' && path === '/tenant/config') {
    if (!admin) throw new AccessDeniedError();
    return { status: 200, body: await admin.getTenantConfigView(ctx), tenant: ctx.tenantId };
  }
  if (method === 'GET' && path === '/rubrics') {
    return { status: 200, body: await kernel.portal.listRubrics(ctx), tenant: ctx.tenantId };
  }
  if (method === 'GET' && path === '/products') {
    const rubricId = url.searchParams.get('rubricId') || undefined;
    const products = await kernel.portal.listProducts(ctx, rubricId);
    return { status: 200, body: stripSensitiveData(products, 'CUSTOMER'), tenant: ctx.tenantId };
  }
  if (method === 'GET' && path.startsWith('/forms/')) {
    const disciplineId = path.split('/')[2];
    const productId = url.searchParams.get('productId') || undefined;
    if (!admin) throw new AccessDeniedError();
    const form = productId
      ? await admin.configuration.getFormForProduct(ctx.tenantId, productId, 'customer')
      : await admin.configuration.getFormSchema(ctx.tenantId, disciplineId, 'customer');
    return { status: 200, body: form, tenant: ctx.tenantId };
  }
  if (method === 'POST' && path === '/forms/validate') {
    if (!admin) throw new AccessDeniedError();
    try {
      await admin.configuration.validateForm(
        ctx.tenantId,
        String(body.disciplineId),
        (body.values as Record<string, unknown>) || {},
        'customer',
        body.productId ? String(body.productId) : undefined
      );
      return { status: 200, body: { ok: true }, tenant: ctx.tenantId };
    } catch (error) {
      return { status: 400, body: { error: error instanceof Error ? error.message : 'INVALID' }, tenant: ctx.tenantId };
    }
  }
  if (method === 'POST' && path === '/forms/instances') {
    const draft = await kernel.portal.saveDraft(ctx, {
      rubricId: String(body.rubricId || body.disciplineId),
      productId: body.productId ? String(body.productId) : undefined,
      values: (body.values as Record<string, unknown>) || {},
      instanceId: body.instanceId ? String(body.instanceId) : undefined,
    });
    return { status: 200, body: draft, tenant: ctx.tenantId };
  }
  if (method === 'GET' && path === '/drafts') {
    return { status: 200, body: await kernel.portal.listDrafts(ctx), tenant: ctx.tenantId };
  }
  if (method === 'GET' && path.startsWith('/drafts/')) {
    return { status: 200, body: await kernel.portal.getDraft(ctx, path.split('/')[2]), tenant: ctx.tenantId };
  }
  if (method === 'POST' && path === '/files/stage') {
    const file = await kernel.portal.stageFile(ctx, {
      filename: String(body.filename || 'file'),
      mimeType: String(body.mimeType || 'application/octet-stream'),
      contentBase64: String(body.contentBase64 || ''),
    });
    return { status: 200, body: { artifactId: file.fileId, ...file }, tenant: ctx.tenantId };
  }
  if (method === 'GET' && path.startsWith('/files/')) {
    const fileId = path.split('/')[2];
    return { status: 200, body: await kernel.portal.downloadFile(ctx, fileId), tenant: ctx.tenantId };
  }
  if (method === 'POST' && path === '/forms/submit') {
    const order = await kernel.portal.submit(ctx, {
      disciplineId: String(body.disciplineId),
      values: (body.values as Record<string, unknown>) || {},
      fileIds: Array.isArray(body.fileIds) ? (body.fileIds as string[]) : [],
      summary: body.summary ? String(body.summary) : undefined,
      productId: body.productId ? String(body.productId) : undefined,
      instanceId: body.instanceId ? String(body.instanceId) : undefined,
      tenantId: body.tenantId ? String(body.tenantId) : undefined,
      customerId: body.customerId ? String(body.customerId) : undefined,
      dueAt: body.dueAt != null ? Number(body.dueAt) : undefined,
      status: body.status ? String(body.status) : undefined,
    });
    return { status: 200, body: order, tenant: ctx.tenantId };
  }
  if (method === 'GET' && path === '/schemas/published') {
    if (!admin) throw new AccessDeniedError();
    return {
      status: 200,
      body: await admin.configuration.getPublishedSchema(ctx.tenantId, String(url.searchParams.get('disciplineId') || body.disciplineId || '')),
      tenant: ctx.tenantId,
    };
  }
  if (method === 'GET' && path === '/orders') {
    const filter = (url.searchParams.get('filter') || 'all') as 'all' | 'active' | 'finished' | 'expired' | 'cancelled';
    const q = url.searchParams.get('q') || undefined;
    const listed = await kernel.portal.list(ctx, filter, q);
    return { status: 200, body: listed, tenant: ctx.tenantId };
  }
  if (method === 'GET' && (path === '/jobs' || path === '/workers' || path === '/configuration' || path.endsWith('/costs'))) {
    throw new AccessDeniedError();
  }
  if (method === 'POST' && path.match(/^\/orders\/[^/]+\/approve$/)) {
    const orderId = path.split('/')[2];
    const view = await kernel.portal.approve(ctx, orderId, {
      decision: 'approved',
      schemaVersion: body.schemaVersion != null ? Number(body.schemaVersion) : undefined,
      note: body.note ? String(body.note) : undefined,
    });
    return { status: 200, body: view, tenant: ctx.tenantId };
  }
  if (method === 'POST' && path.match(/^\/orders\/[^/]+\/changes$/)) {
    const orderId = path.split('/')[2];
    const view = await kernel.portal.requestChanges(ctx, orderId, String(body.note || body.comment || ''));
    return { status: 200, body: view, tenant: ctx.tenantId };
  }
  if (method === 'GET' && path.startsWith('/orders/')) {
    const orderId = path.split('/')[2];
    if (path.split('/')[3]) throw new AccessDeniedError();
    const view = await kernel.portal.get(ctx, orderId);
    return { status: 200, body: view, tenant: ctx.tenantId };
  }
  void body;
  void url;
  return { status: 404, body: { error: 'NOT_FOUND' } };
}

async function platformRoutes(
  kernel: ControlPlaneKernel,
  ctx: AuthContext,
  method: string,
  path: string,
  body: Record<string, unknown>,
  url: URL
) {
  if (path.startsWith('/workflows') || path.includes('/steps/')) throw new AccessDeniedError();
  if (method === 'POST' && path === '/platform/activation-codes') {
    const created = await kernel.platform.createActivationCode(ctx, {
      expiresInDays: body.expiresInDays != null ? Number(body.expiresInDays) : undefined,
      ttlMs: body.ttlMs != null ? Number(body.ttlMs) : undefined,
      notes: body.notes != null ? String(body.notes) : undefined,
    });
    return { status: 201, body: { ...created, expiresAt: created.expiresAt }, actor: ctx.userId };
  }
  if (method === 'GET' && path === '/platform/activation-codes') {
    return { status: 200, body: await kernel.platform.listActivationCodes(ctx), actor: ctx.userId };
  }
  const delCode = path.match(/^\/platform\/activation-codes\/([^/]+)$/);
  if (method === 'DELETE' && delCode) {
    return { status: 200, body: await kernel.platform.invalidateActivationCode(ctx, delCode[1]), actor: ctx.userId };
  }
  if (method === 'POST' && path === '/ops/evaluate-deadlines') {
    return {
      status: 200,
      body: await kernel.tracer.evaluateDeadlines(ctx, Date.now(), body.tenantId ? String(body.tenantId) : undefined),
      actor: ctx.userId,
    };
  }
  if (method === 'POST' && path === '/platform/ops/evaluate-deadlines') {
    return {
      status: 200,
      body: await kernel.platform.evaluateDeadlines(ctx, body.tenantId ? String(body.tenantId) : undefined),
      actor: ctx.userId,
    };
  }
  if (method === 'GET' && path === '/platform/stats') {
    return { status: 200, body: await kernel.platform.platformStats(ctx), actor: ctx.userId };
  }
  if (method === 'GET' && path === '/platform/security/config') {
    return { status: 200, body: kernel.security.getPolicy(), actor: ctx.userId };
  }
  if (method === 'PUT' && path === '/platform/security/config') {
    return { status: 200, body: await kernel.security.setPolicy(ctx, body as never), actor: ctx.userId };
  }
  if (method === 'GET' && path === '/platform/security/incidents') {
    return {
      status: 200,
      body: await kernel.security.listIncidents(ctx, {
        level: url.searchParams.get('level') || undefined,
        tenantId: url.searchParams.get('tenantId') || undefined,
        from: url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined,
        to: url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined,
      }),
      actor: ctx.userId,
    };
  }
  if (method === 'GET' && path === '/platform/security/blocks') {
    return { status: 200, body: await kernel.security.listBlocks(ctx), actor: ctx.userId };
  }
  const unlock = path.match(/^\/platform\/security\/blocks\/([^/]+)\/unlock$/);
  if (method === 'POST' && unlock) {
    return { status: 200, body: await kernel.security.unlock(ctx, unlock[1]), actor: ctx.userId };
  }
  if (method === 'GET' && path === '/platform/security/whatsapp') {
    return { status: 200, body: await kernel.security.getWhatsApp(ctx), actor: ctx.userId };
  }
  if (method === 'PUT' && path === '/platform/security/whatsapp') {
    return {
      status: 200,
      body: await kernel.security.saveWhatsApp(ctx, {
        whatsappNumber: body.whatsappNumber != null ? String(body.whatsappNumber) : undefined,
        whatsappAlerts: body.whatsappAlerts ? (String(body.whatsappAlerts) as never) : undefined,
      }),
      actor: ctx.userId,
    };
  }
  if (method === 'POST' && path === '/platform/security/whatsapp/verify') {
    return { status: 200, body: await kernel.security.verifyWhatsApp(ctx, String(body.code || '')), actor: ctx.userId };
  }
  if (method === 'GET' && path === '/platform/tenants') {
    return {
      status: 200,
      body: await kernel.platform.listTenants(ctx, {
        status: url.searchParams.get('status') || undefined,
        search: url.searchParams.get('search') || undefined,
        page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      }),
      actor: ctx.userId,
    };
  }
  const tenantDash = path.match(/^\/platform\/tenants\/([^/]+)$/);
  if (method === 'GET' && tenantDash) {
    return { status: 200, body: await kernel.platform.getTenantDetail(ctx, tenantDash[1]), actor: ctx.userId };
  }
  if (method === 'GET' && path.match(/^\/platform\/tenants\/[^/]+\/orders/)) {
    throw new AccessDeniedError();
  }
  const block = path.match(/^\/platform\/tenants\/([^/]+)\/(block|suspend|unblock|deactivate|reactivate)$/);
  if (method === 'POST' && block) {
    const tenantId = block[1];
    const action = block[2];
    if (action === 'block') return { status: 200, body: await kernel.control.blockTenant(ctx, tenantId, String(body.reason || 'blocked')) };
    if (action === 'suspend') return { status: 200, body: await kernel.control.suspendTenant(ctx, tenantId, String(body.reason || 'suspended')) };
    if (action === 'deactivate') return { status: 200, body: await kernel.control.deactivateTenant(ctx, tenantId, String(body.reason || 'deactivated')) };
    if (action === 'reactivate') return { status: 200, body: await kernel.control.reactivateTenant(ctx, tenantId) };
    return { status: 200, body: await kernel.control.unblockTenant(ctx, tenantId, String(body.reason || 'ok')) };
  }
  if (method === 'GET' && path.startsWith('/orders')) throw new AccessDeniedError();
  return { status: 404, body: { error: 'NOT_FOUND' } };
}

async function workerRoutes(
  kernel: ControlPlaneKernel,
  method: string,
  path: string,
  body: Record<string, unknown>,
  token: string,
  _requestId: string
) {
  const bound = await kernel.store.getWorkerByTokenHash(hashToken(token));
  if (!bound) throw new AccessDeniedError();
  if (method === 'POST' && path === '/workers/heartbeat') {
    const worker = { ...bound.worker, lastHeartbeat: Date.now(), status: 'idle' as const, tenantId: bound.tenantId };
    if (body.version) worker.version = String(body.version);
    await kernel.store.saveWorker(worker);
    await kernel.store.bindWorkerToken(worker.workerId, bound.tenantId, hashToken(token));
    return { status: 200, body: { worker }, tenant: bound.tenantId };
  }
  if (method === 'POST' && path.startsWith('/jobs/') && path.endsWith('/complete')) {
    const jobId = path.split('/')[2];
    const job = await kernel.store.getJob(jobId);
    if (!job || job.tenantId !== bound.tenantId) throw new AccessDeniedError();
    const ctx: AuthContext = {
      token: '',
      userId: `worker:${bound.worker.workerId}`,
      tenantId: bound.tenantId,
      roleId: 'OPERATOR',
      permissions: ['production.edit', 'production.view'],
    };
    const completed = await kernel.orchestrator.completeJob(ctx, jobId, {
      filename: String(body.filename || 'result.bin'),
      mimeType: String(body.mimeType || 'application/octet-stream'),
      contentBase64: String(body.contentBase64 || Buffer.from('cloud-artifact').toString('base64')),
    });
    return { status: 200, body: completed, tenant: bound.tenantId };
  }
  throw new AccessDeniedError();
}

function opsOf(kernel: ControlPlaneKernel) {
  const membership = new MembershipService(kernel.store, kernel.orders);
  const catalog = new WorkshopCatalogService(kernel.store);
  const ops = new OpsOrderService(kernel.store, kernel.orders, membership, catalog);
  return { membership, catalog, ops };
}

function workshopOf(kernel: ControlPlaneKernel, tenantId: string): WorkshopWorkspaceService {
  if (!kernel.admins.has(tenantId)) {
    kernel.admins.set(tenantId, adminForTenant(kernel.store, tenantId, kernel.orders, kernel.control));
  }
  const admin = kernel.admins.get(tenantId)!;
  const client = new ClientPortalService(
    kernel.store,
    kernel.orders,
    kernel.portal,
    admin,
    kernel.tracer,
    kernel.workflows,
    kernel.orchestrator
  );
  return new WorkshopWorkspaceService(kernel.store, kernel.orders, kernel.center, kernel.tracer, client);
}

function parseProductionQuery(url: URL): ProductionQuery {
  const p = url.searchParams;
  const statusRaw = p.get('status');
  const statusMapped = statusRaw
    ? statusRaw
        .split(',')
        .map((s) => {
          const key = s.trim();
          const aliases: Record<string, string> = {
            RECEIVED: 'received',
            REVIEWING: 'reviewing',
            EDITING: 'editing',
            WAITING_APPROVAL: 'approved',
            APPROVED: 'approved',
            PRINTING: 'printing',
            PRODUCTION: 'production',
            READY: 'ready',
            COMPLETED: 'completed',
            CANCELLED: 'cancelled',
          };
          return aliases[key] || key.toLowerCase();
        })
        .join(',')
    : undefined;
  const num = (key: string) => {
    const v = p.get(key);
    return v ? Number(v) : undefined;
  };
  const deadline = (p.get('deadline') || '').toUpperCase();
  const page = num('page');
  const limit = num('limit');
  const query: ProductionQuery = {
    status: statusMapped
      ? (statusMapped.includes(',') ? (statusMapped.split(',') as ProductionQuery['status']) : (statusMapped as ProductionQuery['status']))
      : undefined,
    priority: (p.get('priority') as ProductionQuery['priority']) || undefined,
    disciplineId: p.get('disciplineId') || p.get('rubro') || undefined,
    customerId: p.get('customerId') || undefined,
    customer: p.get('customer') || undefined,
    product: p.get('product') || undefined,
    productId: p.get('productId') || undefined,
    assignedTo: p.get('assignedTo') || p.get('responsable') || undefined,
    fromDueAt: num('fromDueAt'),
    toDueAt: num('toDueAt'),
    fromCreatedAt: num('fromCreatedAt') || num('from'),
    toCreatedAt: num('toCreatedAt') || num('to'),
    deadlineClass:
      (p.get('deadlineClass') as ProductionQuery['deadlineClass']) ||
      (deadline === 'OVERDUE' || deadline === 'DUE_SOON' || deadline === 'ON_TIME' ? (deadline as ProductionQuery['deadlineClass']) : undefined),
    view: (p.get('view') as ProductionQuery['view']) || undefined,
    q: p.get('q') || p.get('search') || undefined,
    sort: (p.get('sort') as ProductionQuery['sort']) || undefined,
    offset: page != null && page > 0 ? (page - 1) * (limit || 20) : num('offset'),
    limit,
  };
  if (p.get('waitingApproval') === 'true') query.waitingApproval = true;
  if (p.get('error') === 'true') query.error = true;
  return query;
}
