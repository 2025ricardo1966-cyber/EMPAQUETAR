import type { AuthContext, Permission, PersistedUser, PublicUser, SystemRoleId } from './admin-domain';
import { AccessDeniedError, ALL_PERMISSIONS, hasPermission, UnauthorizedError } from './admin-domain';

export { UnauthorizedError };

export type Rubro = 'TEXTIL' | 'TPU' | 'DTF' | 'PUBLICIDAD' | 'CUSTOM';

export const OPERADOR_PERMISSIONS: Record<string, boolean> = {
  'orders.view': true,
  'orders.edit': false,
  'production.view': true,
  'costs.view': false,
  'clients.view': false,
  'config.view': false,
  'config.edit': false,
};

export const SENSITIVE_DATA_KEYS = ['internalCost', 'margin', 'costBreakdown', 'supplierPrice'] as const;

const ALIAS_TO_PERMISSION: Record<string, Permission> = {
  'orders.view': 'orders.view',
  'orders.edit': 'orders.edit',
  'production.view': 'production.view',
  'costs.view': 'costs.view',
  'clients.view': 'customers.view',
  'config.view': 'configuration.view',
  'config.edit': 'configuration.edit',
  'customers.view': 'customers.view',
  'configuration.view': 'configuration.view',
  'configuration.edit': 'configuration.edit',
  'materials.view': 'materials.view',
  'materials.edit': 'materials.edit',
  'sensitive_data.view': 'sensitive_data.view',
};

export function normalizeSystemRole(role: string | undefined): SystemRoleId | undefined {
  const raw = String(role || '').trim().toUpperCase();
  if (raw === 'OPERADOR' || raw === 'OPERATOR') return 'OPERATOR';
  if (raw === 'CLIENTE' || raw === 'CUSTOMER') return 'CUSTOMER';
  if (raw === 'SUBADMIN' || raw === 'ADMIN') return raw === 'ADMIN' ? 'ADMIN' : 'SUBADMIN';
  if (raw === 'ADMIN_PRINCIPAL') return 'ADMIN_PRINCIPAL';
  if (raw === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  return undefined;
}

export function operadorPermissionList(): Permission[] {
  return Object.entries(OPERADOR_PERMISSIONS)
    .filter(([, allowed]) => allowed)
    .map(([key]) => (ALIAS_TO_PERMISSION[key] || key) as Permission);
}

export function mapPermissionInput(input?: Record<string, boolean> | Permission[]): {
  list: Permission[];
  map: Record<string, boolean>;
} {
  if (Array.isArray(input)) {
    const list = [...new Set(input.filter((p) => !String(p).startsWith('platform.')))];
    const map: Record<string, boolean> = {};
    for (const p of list) map[p] = true;
    return { list, map };
  }
  const map = { ...(input || {}) };
  const list: Permission[] = [];
  for (const [key, allowed] of Object.entries(map)) {
    if (!allowed) continue;
    const mapped = ALIAS_TO_PERMISSION[key] || key;
    list.push(mapped as Permission);
    if (key === 'costs.view') list.push('sensitive_data.view');
  }
  return { list: [...new Set(list)], map };
}

export function effectivePermissions(roleId: SystemRoleId, permissions: Permission[]): Permission[] {
  if (roleId === 'ADMIN_PRINCIPAL') return [...ALL_PERMISSIONS];
  if (roleId === 'OPERATOR') return operadorPermissionList();
  if (roleId === 'CUSTOMER') return ['orders.create', 'orders.view'];
  return [...permissions];
}

export function authorize(roles: Array<SystemRoleId | 'OPERADOR' | 'CLIENTE' | 'SUBADMIN'>): (ctx: AuthContext) => void {
  const allowed = new Set(roles.map((r) => normalizeSystemRole(r)).filter(Boolean) as SystemRoleId[]);
  return (ctx: AuthContext) => {
    if (!allowed.has(ctx.roleId)) throw new AccessDeniedError();
  };
}

export function authorizePermission(permission: string): (ctx: AuthContext) => void {
  return (ctx: AuthContext) => {
    if (ctx.roleId === 'ADMIN_PRINCIPAL') return;
    if (ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
    if (ctx.roleId === 'OPERATOR') {
      if (OPERADOR_PERMISSIONS[permission] !== true) throw new AccessDeniedError();
      return;
    }
    const mapped = (ALIAS_TO_PERMISSION[permission] || permission) as Permission;
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
    if (!hasPermission(probe, mapped) && !ctx.permissions.includes(permission as Permission)) {
      throw new AccessDeniedError();
    }
  };
}

function stripKey(key: string): boolean {
  if ((SENSITIVE_DATA_KEYS as readonly string[]).includes(key)) return true;
  if (key === 'internalUnitCost' || key === 'calculatedInternalCost' || key === 'totalInternalCost') return true;
  if (key === 'purchasePrice' || key === 'supplierUnitPrice') return true;
  return false;
}

export function stripSensitiveData<T>(data: T, role: SystemRoleId | string): T {
  if (role === 'ADMIN_PRINCIPAL' || role === 'SUPER_ADMIN') return data;
  if (role !== 'OPERATOR' && role !== 'CUSTOMER' && role !== 'OPERADOR' && role !== 'CLIENTE') {
    return data;
  }
  return stripWalk(data) as T;
}

function stripWalk(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripWalk);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (stripKey(key)) continue;
    out[key] = stripWalk(nested);
  }
  return out;
}

export function toSessionUser(user: PersistedUser | PublicUser) {
  const perms =
    'permissionMap' in user && user.permissionMap
      ? user.permissionMap
      : Object.fromEntries((user.permissions || []).map((p) => [p, true]));
  return {
    id: user.userId,
    userId: user.userId,
    email: ('email' in user && user.email) || user.login,
    name: ('name' in user && user.name) || user.login,
    role: user.roleId,
    roleId: user.roleId,
    tenantId: user.tenantId,
    permissions: user.roleId === 'OPERATOR' ? { ...OPERADOR_PERMISSIONS } : perms,
    login: user.login,
    displayCode: user.displayCode,
    status: user.status,
    preferredLanguage: user.preferredLanguage,
    lang: user.preferredLanguage,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export interface TenantLimits {
  maxFilesPerOrder: number;
  maxUnitsPerOrder: number;
  maxMetersPerOrder: number;
  maxFileBytes?: number;
  maxFileSizeMb?: number;
  allowedMimeTypes?: string[];
  requiredPaymentPct?: number;
}

export const DEFAULT_TENANT_LIMITS: TenantLimits = {
  maxFilesPerOrder: 100,
  /** Tope del ALTA inicial del pedido. No limita el plantel aprobado ni la distribución masiva. */
  maxUnitsPerOrder: 100,
  maxMetersPerOrder: 200,
  maxFileBytes: 50 * 1024 * 1024,
  maxFileSizeMb: 50,
  requiredPaymentPct: 50,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'application/pdf',
    'application/postscript',
    'application/x-coreldraw',
  ],
};

export interface TrustCodeEntry {
  code: string;
  creditLimit: number;
  customerId?: string;
}
