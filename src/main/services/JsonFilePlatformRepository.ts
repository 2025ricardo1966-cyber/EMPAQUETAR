import fs from 'fs/promises';
import path from 'path';
import type {
  AuditEntry,
  PersistedUser,
  Tenant,
  TenantConfig,
} from '../../contracts/admin-domain';
import { AccessDeniedError, normalizeTenant } from '../../contracts/admin-domain';
import type { PlatformAuditEntry } from '../../contracts/platform-domain';
import type { AdminRepository } from './AdminRepository';
import type { PlatformRepository } from './PlatformRepository';

export class JsonFilePlatformRepository implements PlatformRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private directory: string) {}

  setDirectory(directory: string): void {
    this.directory = directory;
  }

  async getProductOverride(): Promise<{ releaseChannel?: string; versionStatus?: string } | undefined> {
    return this.readJson(this.productPath());
  }

  async saveProductOverride(meta: { releaseChannel?: string; versionStatus?: string }): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await this.writeAtomic(this.productPath(), meta);
    });
  }

  async getSuperAdminByLogin(login: string): Promise<PersistedUser | undefined> {
    const needle = login.trim().toLowerCase();
    const users = await this.listSuperAdmins();
    return users.find(
      (u) => u.login.toLowerCase() === needle || String(u.email || '').toLowerCase() === needle
    );
  }

  async getSuperAdmin(userId: string): Promise<PersistedUser | undefined> {
    return this.readJson(this.superAdminPath(userId));
  }

  async saveSuperAdmin(user: PersistedUser): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.superAdminsDir(), { recursive: true });
      await this.writeAtomic(this.superAdminPath(user.userId), user);
    });
  }

  async listSuperAdmins(): Promise<PersistedUser[]> {
    await this.ensureDir();
    await fs.mkdir(this.superAdminsDir(), { recursive: true });
    const names = await fs.readdir(this.superAdminsDir());
    const users: PersistedUser[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const user = await this.readJson<PersistedUser>(path.join(this.superAdminsDir(), name));
      if (user) users.push(user);
    }
    return users;
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    const tenant = await this.readJson<Tenant>(this.tenantPath(tenantId));
    return tenant ? normalizeTenant(tenant) : undefined;
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.tenantDir(tenant.tenantId), { recursive: true });
      await this.writeAtomic(this.tenantPath(tenant.tenantId), normalizeTenant(tenant));
    });
  }

  async listTenants(): Promise<Tenant[]> {
    await this.ensureDir();
    await fs.mkdir(this.tenantsRoot(), { recursive: true });
    const names = await fs.readdir(this.tenantsRoot());
    const tenants: Tenant[] = [];
    for (const name of names) {
      const tenant = await this.getTenant(name);
      if (tenant) tenants.push(tenant);
    }
    return tenants.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getUser(userId: string): Promise<PersistedUser | undefined> {
    const tenants = await this.listTenants();
    for (const tenant of tenants) {
      const user = await this.readJson<PersistedUser>(this.userPath(tenant.tenantId, userId));
      if (user) return user;
    }
    return this.getSuperAdmin(userId);
  }

  async getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined> {
    const users = await this.listUsers(tenantId);
    const needle = login.trim().toLowerCase();
    return users.find(
      (u) => u.login.toLowerCase() === needle || String(u.email || '').toLowerCase() === needle
    );
  }

  async saveUser(user: PersistedUser): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.usersDir(user.tenantId), { recursive: true });
      await this.writeAtomic(this.userPath(user.tenantId, user.userId), user);
    });
  }

  async deleteUser(userId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) return;
    await this.enqueue(async () => {
      try {
        await fs.unlink(this.userPath(user.tenantId, userId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
  }

  async listUsers(tenantId: string): Promise<PersistedUser[]> {
    await this.ensureDir();
    await fs.mkdir(this.usersDir(tenantId), { recursive: true });
    const names = await fs.readdir(this.usersDir(tenantId));
    const users: PersistedUser[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const user = await this.readJson<PersistedUser>(path.join(this.usersDir(tenantId), name));
      if (user && user.tenantId === tenantId) users.push(user);
    }
    return users.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getConfig(tenantId: string): Promise<TenantConfig | undefined> {
    const config = await this.readJson<TenantConfig>(this.configPath(tenantId));
    if (!config || config.tenantId !== tenantId) return undefined;
    return config;
  }

  async saveConfig(config: TenantConfig): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.tenantDir(config.tenantId), { recursive: true });
      await this.writeAtomic(this.configPath(config.tenantId), config);
    });
  }

  async appendTenantAudit(entry: AuditEntry): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.tenantDir(entry.tenantId), { recursive: true });
      await fs.appendFile(this.tenantAuditPath(entry.tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
    });
  }

  async listTenantAudit(tenantId: string): Promise<AuditEntry[]> {
    return this.readJsonl<AuditEntry>(this.tenantAuditPath(tenantId), (e) => e.tenantId === tenantId);
  }

  async appendPlatformAudit(entry: PlatformAuditEntry): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.appendFile(this.platformAuditPath(), `${JSON.stringify(entry)}\n`, 'utf8');
    });
  }

  async listPlatformAudit(): Promise<PlatformAuditEntry[]> {
    return this.readJsonl<PlatformAuditEntry>(this.platformAuditPath());
  }

  private tenantsRoot() {
    return path.join(this.directory, 'tenants');
  }
  private tenantDir(tenantId: string) {
    return path.join(this.tenantsRoot(), tenantId);
  }
  private tenantPath(tenantId: string) {
    return path.join(this.tenantDir(tenantId), 'tenant.json');
  }
  private configPath(tenantId: string) {
    return path.join(this.tenantDir(tenantId), 'config.json');
  }
  private usersDir(tenantId: string) {
    return path.join(this.tenantDir(tenantId), 'users');
  }
  private userPath(tenantId: string, userId: string) {
    return path.join(this.usersDir(tenantId), `${userId}.json`);
  }
  private tenantAuditPath(tenantId: string) {
    return path.join(this.tenantDir(tenantId), 'audit.jsonl');
  }
  private superAdminsDir() {
    return path.join(this.directory, 'super-admins');
  }
  private superAdminPath(userId: string) {
    return path.join(this.superAdminsDir(), `${userId}.json`);
  }
  private platformAuditPath() {
    return path.join(this.directory, 'platform-audit.jsonl');
  }
  private productPath() {
    return path.join(this.directory, 'product.json');
  }

  private async readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readJsonl<T>(file: string, filter?: (entry: T) => boolean): Promise<T[]> {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
      return filter ? rows.filter(filter) : rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  private async writeAtomic(file: string, data: unknown): Promise<void> {
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(temp, file);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(work, work);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

/** Binds AdminService to a single tenant inside the platform store. Prevents writing another tenantId. */
export class TenantScopedAdminRepository implements AdminRepository {
  constructor(
    private platform: PlatformRepository,
    private tenantId: string
  ) {}

  async getTenant(): Promise<Tenant | undefined> {
    return this.platform.getTenant(this.tenantId);
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    if (tenant.tenantId !== this.tenantId) throw new AccessDeniedError();
    await this.platform.saveTenant(tenant);
  }

  async getUser(userId: string): Promise<PersistedUser | undefined> {
    const user = await this.platform.getUser(userId);
    if (!user || user.tenantId !== this.tenantId) return undefined;
    return user;
  }

  async getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined> {
    if (tenantId !== this.tenantId) throw new AccessDeniedError();
    return this.platform.getUserByLogin(tenantId, login);
  }

  async saveUser(user: PersistedUser): Promise<void> {
    if (user.tenantId !== this.tenantId) throw new AccessDeniedError();
    await this.platform.saveUser(user);
  }

  async deleteUser(userId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new AccessDeniedError();
    await this.platform.deleteUser(userId);
  }

  async listUsers(tenantId: string): Promise<PersistedUser[]> {
    if (tenantId !== this.tenantId) throw new AccessDeniedError();
    return this.platform.listUsers(tenantId);
  }

  async getConfig(tenantId: string): Promise<TenantConfig | undefined> {
    if (tenantId !== this.tenantId) throw new AccessDeniedError();
    return this.platform.getConfig(tenantId);
  }

  async saveConfig(config: TenantConfig): Promise<void> {
    if (config.tenantId !== this.tenantId) throw new AccessDeniedError();
    await this.platform.saveConfig(config);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    if (entry.tenantId !== this.tenantId) throw new AccessDeniedError();
    await this.platform.appendTenantAudit(entry);
  }

  async listAudit(tenantId: string): Promise<AuditEntry[]> {
    if (tenantId !== this.tenantId) throw new AccessDeniedError();
    return this.platform.listTenantAudit(tenantId);
  }
}
