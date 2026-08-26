export const PERMISSIONS = [
  'orders.view',
  'orders.edit',
  'orders.create',
  'orders.delete',
  'production.view',
  'production.edit',
  'materials.view',
  'materials.edit',
  'costs.view',
  'costs.edit',
  'customers.view',
  'customers.edit',
  'configuration.view',
  'configuration.edit',
  'users.view',
  'users.create',
  'users.edit',
  'users.delete',
  'sensitive_data.view',
  'reports.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number] | string;

export const CUSTOMER_DEFAULT_PERMISSIONS: Permission[] = ['orders.create', 'orders.view'];

export type UserStatus = 'active' | 'disabled';
export type SystemRoleId = 'SUPER_ADMIN' | 'ADMIN_PRINCIPAL' | 'ADMIN' | 'SUBADMIN' | 'OPERATOR' | 'CUSTOMER';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'file'
  | 'image'
  | 'reference'
  | 'material'
  | 'quantity'
  | 'measure'
  | 'area'
  | 'table'
  | 'list'
  | 'composition'
  | string;

export type FieldReferenceKind = 'product' | 'material' | 'customer';

export interface FieldOptionItem {
  id: string;
  label: string;
}

export interface FieldDependency {
  fieldId: string;
  equals?: string | number | boolean;
}

export class AccessDeniedError extends Error {
  readonly code = 'ACCESS_DENIED';
  constructor(message = 'ACCESS_DENIED') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED';
  constructor(message = 'UNAUTHORIZED') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface PasswordSecret {
  algo: 'scrypt';
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
}

export const SUPPORTED_CURRENCIES = ['ARS', 'USD', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number] | string;

export interface TenantIdentity {
  commercialName: string;
  internalName?: string;
  contact?: string;
  logoRef?: string;
  locale?: string;
  currency: SupportedCurrency;
  timezone: string;
}

export interface TenantOnboardingState {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  adminSlots: number;
  completed?: boolean;
}

export interface PersistedUser {
  userId: string;
  tenantId: string;
  login: string;
  displayCode: string;
  roleId: SystemRoleId;
  permissions: Permission[];
  permissionMap?: Record<string, boolean>;
  status: UserStatus;
  password: PasswordSecret;
  createdAt: number;
  updatedAt: number;
  firstLogin?: boolean;
  email?: string;
  name?: string;
  emailVerified?: boolean;
  verificationToken?: string | null;
  verificationExpiresAt?: number;
  createdBy?: string;
  preferredLanguage?: string;
  whatsappNumber?: string;
  whatsappVerified?: boolean;
  whatsappAlerts?: 'CRITICAL_ONLY' | 'ALL' | 'NONE';
  whatsappVerifyHash?: string | null;
  whatsappVerifyExpiresAt?: number | null;
}

export interface PublicUser {
  userId: string;
  tenantId: string;
  login: string;
  displayCode: string;
  roleId: SystemRoleId;
  permissions: Permission[];
  permissionMap?: Record<string, boolean>;
  status: UserStatus;
  createdAt: number;
  updatedAt: number;
  firstLogin?: boolean;
  email?: string;
  name?: string;
  preferredLanguage?: string;
  whatsappNumber?: string;
  whatsappVerified?: boolean;
  whatsappAlerts?: 'CRITICAL_ONLY' | 'ALL' | 'NONE';
}

export type TenantStatus =
  | 'PENDING_ACTIVATION'
  | 'SETUP_INCOMPLETE'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'BLOCKED'
  | 'DEACTIVATED'
  | 'CANCELLED';

export interface Tenant {
  tenantId: string;
  name: string;
  activated: boolean;
  activatedAt?: number;
  primaryDisciplineId: string;
  createdAt: number;
  updatedAt: number;
  /** Single source of truth for platform lifecycle. */
  status: TenantStatus;
  contractualStatus: 'ok' | 'restricted' | 'blocked';
  restriction?: {
    status: TenantStatus;
    previousStatus?: TenantStatus;
    reason?: string;
    reasonCategory?: string;
    actorId?: string;
    actorRole?: string;
    at?: number;
  };
  lastAccessAt?: number;
  productVersion?: string;
  releaseChannel?: string;
  identity?: TenantIdentity;
  currency?: SupportedCurrency;
  timezone?: string;
  contact?: string;
  internalName?: string;
  logoRef?: string;
  locale?: string;
  suspendedAt?: number;
  suspendedBy?: string;
  suspensionReason?: string;
  reactivatedAt?: number;
  reactivatedBy?: string;
}

export function normalizeTenant(tenant: Tenant): Tenant {
  const status =
    tenant.status ||
    (tenant.activated ? 'ACTIVE' : 'PENDING_ACTIVATION');
  const contractualStatus =
    tenant.contractualStatus ||
    (status === 'BLOCKED' ? 'blocked' : status === 'SUSPENDED' ? 'restricted' : 'ok');
  return { ...tenant, status, contractualStatus };
}

export interface DisciplineConfig {
  id: string;
  label: string;
  enabled: boolean;
}

export interface FormFieldConfig {
  fieldId: string;
  schemaId?: string;
  disciplineId: string;
  /** Stable technical key. Never use label as identity. */
  key?: string;
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  visible: boolean;
  editable: boolean;
  sensitive: boolean;
  customerVisible?: boolean;
  adminVisible?: boolean;
  active?: boolean;
  order: number;
  options?: string[];
  optionItems?: FieldOptionItem[];
  referenceKind?: FieldReferenceKind;
  dependsOn?: FieldDependency;
  validations?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    allowedExtensions?: string[];
    maxFileSize?: number;
  };
  audience?: {
    customer: boolean;
    operator: boolean;
    subadmin: boolean;
    admin: boolean;
  };
  defaultValue?: string | number | boolean | null;
  viewPermissions?: Permission[];
  displayLabel?: string;
}

export interface ConfiguredMaterial {
  materialId: string;
  tenantId?: string;
  name: string;
  description?: string;
  unit: string;
  unitId?: string;
  internalUnitCost: number;
  customerUnitPrice: number;
  disciplineId: string;
  active: boolean;
  available?: boolean;
  displayName?: string;
  currency?: string;
  costType?: string;
  costConfiguration?: {
    type: string;
    internalCost: number;
    customerPrice: number;
    currency: string;
    unitId: string;
    tiers?: Array<{ min: number; max?: number; internalCost: number; customerPrice: number }>;
  };
  consumptionRule?: {
    kind: string;
    rate?: number;
    fixedQuantity?: number;
  };
  visibility?: {
    showConsumption: boolean;
    showCustomerPrice: boolean;
    showInternalCost: boolean;
    showMargin: boolean;
  };
  customerVisibility?: {
    price?: boolean;
    consumption?: boolean;
    subtotal?: boolean;
    total?: boolean;
  };
  visibleToClient?: boolean;
  clientLabel?: string;
  updatedBy?: string;
}

export interface StatusPresentation {
  status: string;
  enabled: boolean;
  label: string;
  order: number;
  visibleToCustomer: boolean;
}

export interface TenantConfig {
  tenantId: string;
  disciplines: DisciplineConfig[];
  fields: FormFieldConfig[];
  materials: ConfiguredMaterial[];
  statusPresentation: StatusPresentation[];
  deadlineApproachingWithinMs: number;
  customerFieldAllowlist: string[];
  updatedAt: number;
  schemaCatalog?: Array<{
    schemaId: string;
    tenantId: string;
    disciplineId: string;
    version: number;
    label: string;
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    createdAt: number;
    fields: FormFieldConfig[];
    materials: ConfiguredMaterial[];
    processes: { id: string; label: string; enabled: boolean; type?: string; order?: number; required?: boolean; requiresApproval?: boolean; disciplineId?: string }[];
    statusPresentation: StatusPresentation[];
    rules: unknown[];
    deadlineApproachingWithinMs?: number;
  }>;
  publishedSchema?: Record<string, { schemaId: string; version: number }>;
  formInstances?: Array<{
    instanceId: string;
    tenantId: string;
    schemaId: string;
    schemaVersion: number;
    rubricId: string;
    productId?: string;
    customerId?: string;
    status: 'draft' | 'submitted';
    responses: Array<{ fieldId: string; key: string; value: unknown }>;
    createdAt: number;
    updatedAt: number;
  }>;
  processes?: { id: string; label: string; enabled: boolean; type?: string; order?: number; required?: boolean; requiresApproval?: boolean; disciplineId?: string }[];
  rules?: unknown[];
  identity?: TenantIdentity;
  onboarding?: TenantOnboardingState;
  betaNotice?: { enabled: boolean; message: string };
  products?: import('./catalog-domain').CatalogProduct[];
  units?: import('./catalog-domain').CatalogUnit[];
  rubro?: import('./auth-rbac').Rubro;
  setupDone?: boolean;
  limits?: import('./auth-rbac').TenantLimits;
  currency?: string;
  defaultLanguage?: string;
  clientOptions?: import('./fulfillment-domain').ClientFulfillmentOptions;
  commercial?: import('./international-domain').CommercialContext;
  workshopCategories?: Partial<Record<import('./workshop-catalog-domain').WorkshopCategory, boolean>>;
  config?: Record<string, unknown>;
  trustCodes?: import('./auth-rbac').TrustCodeEntry[];
  requiredPaymentPct?: number;
  emailFrom?: string;
  emailReplyTo?: string;
  adminEmail?: string;
  emailsEnabled?: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  tenantId: string;
  actorId: string;
  action: string;
  target: string;
  result: 'ok' | 'denied' | 'error';
  detail?: string;
}

export interface AuthContext {
  token: string;
  userId: string;
  tenantId: string;
  roleId: SystemRoleId;
  permissions: Permission[];
  preferredLanguage?: string;
  lang?: string;
}

export interface ActivationState {
  activated: boolean;
  tenantId?: string;
  tenantName?: string;
  status?: TenantStatus;
  phase?: 'needed' | 'onboarding' | 'ready';
}

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export function toPublicUser(user: PersistedUser): PublicUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId,
    login: user.login,
    displayCode: user.displayCode,
    roleId: user.roleId,
    permissions: user.roleId === 'ADMIN_PRINCIPAL' ? [...ALL_PERMISSIONS] : [...user.permissions],
    permissionMap: user.permissionMap,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    firstLogin: Boolean(user.firstLogin),
    email: user.email,
    name: user.name,
    preferredLanguage: user.preferredLanguage || 'es',
    whatsappNumber: user.whatsappNumber,
    whatsappVerified: !!user.whatsappVerified,
    whatsappAlerts: user.whatsappAlerts || 'CRITICAL_ONLY',
  };
}

export function hasPermission(user: PublicUser | PersistedUser, permission: Permission): boolean {
  if (user.status !== 'active') return false;
  const isPlatform = String(permission).startsWith('platform.');
  if (isPlatform) return user.roleId === 'SUPER_ADMIN';
  if (user.roleId === 'SUPER_ADMIN') return false;
  if (user.roleId === 'ADMIN_PRINCIPAL') return true;
  if (user.roleId === 'OPERATOR') {
    return permission === 'orders.view' || permission === 'production.view';
  }
  return user.permissions.includes(permission);
}
