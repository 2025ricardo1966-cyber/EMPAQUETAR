import type {
  AuditEntry,
  PersistedUser,
  Tenant,
  TenantConfig,
} from '../../contracts/admin-domain';
import type { PlatformAuditEntry } from '../../contracts/platform-domain';

export interface PlatformRepository {
  getProductOverride(): Promise<{ releaseChannel?: string; versionStatus?: string } | undefined>;
  saveProductOverride(meta: { releaseChannel?: string; versionStatus?: string }): Promise<void>;

  getSuperAdminByLogin(login: string): Promise<PersistedUser | undefined>;
  getSuperAdmin(userId: string): Promise<PersistedUser | undefined>;
  saveSuperAdmin(user: PersistedUser): Promise<void>;
  listSuperAdmins(): Promise<PersistedUser[]>;

  getTenant(tenantId: string): Promise<Tenant | undefined>;
  saveTenant(tenant: Tenant): Promise<void>;
  listTenants(): Promise<Tenant[]>;
  invalidateRefreshTokensForTenant?(tenantId: string): Promise<void>;

  getUser(userId: string): Promise<PersistedUser | undefined>;
  getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined>;
  saveUser(user: PersistedUser): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  listUsers(tenantId: string): Promise<PersistedUser[]>;

  getConfig(tenantId: string): Promise<TenantConfig | undefined>;
  saveConfig(config: TenantConfig): Promise<void>;

  appendTenantAudit(entry: AuditEntry): Promise<void>;
  listTenantAudit(tenantId: string): Promise<AuditEntry[]>;

  appendPlatformAudit(entry: PlatformAuditEntry): Promise<void>;
  listPlatformAudit(): Promise<PlatformAuditEntry[]>;
}
