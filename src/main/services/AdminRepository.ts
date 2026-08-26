import type {
  AuditEntry,
  PersistedUser,
  Tenant,
  TenantConfig,
} from '../../contracts/admin-domain';

export interface AdminRepository {
  getTenant(): Promise<Tenant | undefined>;
  saveTenant(tenant: Tenant): Promise<void>;
  getUser(userId: string): Promise<PersistedUser | undefined>;
  getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined>;
  saveUser(user: PersistedUser): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  listUsers(tenantId: string): Promise<PersistedUser[]>;
  getConfig(tenantId: string): Promise<TenantConfig | undefined>;
  saveConfig(config: TenantConfig): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(tenantId: string): Promise<AuditEntry[]>;
}
