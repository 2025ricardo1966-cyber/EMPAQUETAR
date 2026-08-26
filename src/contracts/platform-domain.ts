import type { Tenant } from './admin-domain';
import { AccessDeniedError } from './admin-domain';

export const PLATFORM_SCOPE = '__platform__';

export const PLATFORM_PERMISSIONS = [
  'platform.tenants.view',
  'platform.tenants.control',
  'platform.audit.view',
  'platform.version.view',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type TenantLifecycleStatus =
  | 'PENDING_ACTIVATION'
  | 'SETUP_INCOMPLETE'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'BLOCKED'
  | 'DEACTIVATED'
  | 'CANCELLED';

export type ContractualStatus = 'ok' | 'restricted' | 'blocked';

export type TenantOperation =
  | 'login.principal'
  | 'login.operator'
  | 'login.customer'
  | 'orders.create'
  | 'orders.view'
  | 'orders.edit'
  | 'production.process'
  | 'admin.configure'
  | 'admin.limited_read';

export interface TenantAccessPolicy {
  allowPrincipalLogin: boolean;
  allowOperatorLogin: boolean;
  allowCustomerAccess: boolean;
  allowOrderCreate: boolean;
  allowOrderView: boolean;
  allowProcessing: boolean;
  allowAdminConfigure: boolean;
  allowAdminLimitedRead: boolean;
}

export const ACCESS_POLICY_BY_STATUS: Record<TenantLifecycleStatus, TenantAccessPolicy> = {
  PENDING_ACTIVATION: {
    allowPrincipalLogin: false,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: false,
    allowProcessing: false,
    allowAdminConfigure: false,
    allowAdminLimitedRead: false,
  },
  SETUP_INCOMPLETE: {
    allowPrincipalLogin: true,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: false,
    allowProcessing: false,
    allowAdminConfigure: true,
    allowAdminLimitedRead: true,
  },
  DEACTIVATED: {
    allowPrincipalLogin: false,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: false,
    allowProcessing: false,
    allowAdminConfigure: false,
    allowAdminLimitedRead: false,
  },
  ACTIVE: {
    allowPrincipalLogin: true,
    allowOperatorLogin: true,
    allowCustomerAccess: true,
    allowOrderCreate: true,
    allowOrderView: true,
    allowProcessing: true,
    allowAdminConfigure: true,
    allowAdminLimitedRead: true,
  },
  SUSPENDED: {
    allowPrincipalLogin: true,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: true,
    allowProcessing: false,
    allowAdminConfigure: false,
    allowAdminLimitedRead: true,
  },
  BLOCKED: {
    allowPrincipalLogin: true,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: false,
    allowProcessing: false,
    allowAdminConfigure: false,
    allowAdminLimitedRead: true,
  },
  CANCELLED: {
    allowPrincipalLogin: false,
    allowOperatorLogin: false,
    allowCustomerAccess: false,
    allowOrderCreate: false,
    allowOrderView: false,
    allowProcessing: false,
    allowAdminConfigure: false,
    allowAdminLimitedRead: false,
  },
};

export const TENANT_SUSPENDED_MESSAGE =
  'Esta cuenta está temporalmente suspendida. Comuníquese con el administrador de la plataforma.';

export function policyForStatus(status: TenantLifecycleStatus): TenantAccessPolicy {
  return ACCESS_POLICY_BY_STATUS[status];
}

export function operationAllowed(policy: TenantAccessPolicy, operation: TenantOperation): boolean {
  switch (operation) {
    case 'login.principal':
      return policy.allowPrincipalLogin;
    case 'login.operator':
      return policy.allowOperatorLogin;
    case 'login.customer':
      return policy.allowCustomerAccess;
    case 'orders.create':
      return policy.allowOrderCreate;
    case 'orders.view':
      return policy.allowOrderView;
    case 'orders.edit':
      return policy.allowOrderCreate && policy.allowOrderView;
    case 'production.process':
      return policy.allowProcessing;
    case 'admin.configure':
      return policy.allowAdminConfigure;
    case 'admin.limited_read':
      return policy.allowAdminLimitedRead;
    default:
      return false;
  }
}

export class TenantRestrictedError extends Error {
  readonly code:
    | 'TENANT_BLOCKED'
    | 'TENANT_SUSPENDED'
    | 'TENANT_PENDING'
    | 'TENANT_SETUP_INCOMPLETE'
    | 'TENANT_DEACTIVATED';
  constructor(status: TenantLifecycleStatus, message?: string) {
    const code =
      status === 'BLOCKED'
        ? 'TENANT_BLOCKED'
        : status === 'SUSPENDED'
          ? 'TENANT_SUSPENDED'
          : status === 'SETUP_INCOMPLETE'
            ? 'TENANT_SETUP_INCOMPLETE'
            : status === 'DEACTIVATED' || status === 'CANCELLED'
              ? 'TENANT_DEACTIVATED'
              : 'TENANT_PENDING';
    super(message || code);
    this.name = 'TenantRestrictedError';
    this.code = code;
  }
}

export interface TenantRestrictionRecord {
  status: TenantLifecycleStatus;
  previousStatus?: TenantLifecycleStatus;
  reason?: string;
  reasonCategory?: string;
  actorId?: string;
  actorRole?: string;
  at?: number;
}

export interface TenantRestrictionNotice {
  restricted: boolean;
  status: TenantLifecycleStatus;
  message: string;
  reason?: string;
}

export const OPERATIONAL_RESTRICTION_MESSAGE =
  'El acceso operativo de esta organización se encuentra temporalmente restringido.';

export function restrictionNoticeForPrincipal(tenant: Tenant): TenantRestrictionNotice {
  const status = tenant.status || (tenant.activated ? 'ACTIVE' : 'PENDING_ACTIVATION');
  if (status === 'ACTIVE' || status === 'SETUP_INCOMPLETE') {
    return { restricted: false, status, message: '' };
  }
  const reason = tenant.restriction?.reason?.trim();
  return {
    restricted: true,
    status,
    message: OPERATIONAL_RESTRICTION_MESSAGE,
    reason: reason ? `Motivo: ${reason}` : undefined,
  };
}

export interface PlatformAuditEntry {
  id: string;
  timestamp: number;
  actorId: string;
  actorRole: string;
  tenantId: string;
  action: string;
  previousStatus?: TenantLifecycleStatus;
  newStatus?: TenantLifecycleStatus;
  reason?: string;
  result: 'ok' | 'denied' | 'error';
  kind?: string;
  event?: string;
  endpoint?: string;
  attemptedAction?: string;
  riskLevel?: string;
  measure?: string;
  blockDurationMs?: number;
  ip?: string;
  superAdminActorId?: string;
  usuarioId?: string;
}

export interface TenantDashboard {
  tenantId: string;
  name: string;
  status: TenantLifecycleStatus;
  contractualStatus: ContractualStatus;
  activatedAt?: number;
  productVersion?: string;
  releaseChannel?: string;
  lastAccessAt?: number;
  userCount: number;
  orderCount: number;
  overdueCount?: number;
  restrictionReason?: string;
  restrictionAt?: number;
}

export interface TenantListFilter {
  status?: TenantLifecycleStatus | TenantLifecycleStatus[];
  releaseChannel?: string;
  contractualStatus?: ContractualStatus;
  activity?: 'any' | 'recent';
  query?: string;
}

export function assertSuperAdmin(roleId: string): void {
  if (roleId !== 'SUPER_ADMIN') throw new AccessDeniedError();
}

export function isPlatformPermission(permission: string): boolean {
  return permission.startsWith('platform.');
}
