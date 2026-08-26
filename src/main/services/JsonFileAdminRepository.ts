import fs from 'fs/promises';
import path from 'path';
import type {
  AuditEntry,
  PersistedUser,
  Tenant,
  TenantConfig,
} from '../../contracts/admin-domain';
import { normalizeTenant } from '../../contracts/admin-domain';
import type { AdminRepository } from './AdminRepository';
import type { OperationalNotification } from '../../contracts/trace-domain';

export class JsonFileAdminRepository implements AdminRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private directory: string) {}

  setDirectory(directory: string): void {
    this.directory = directory;
  }

  async getTenant(tenantId?: string): Promise<Tenant | undefined> {
    const tenant = await this.readJson<Tenant>(this.tenantPath());
    const normalized = tenant ? normalizeTenant(tenant) : undefined;
    if (tenantId && normalized && normalized.tenantId !== tenantId) return undefined;
    return normalized;
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await this.writeAtomic(this.tenantPath(), normalizeTenant(tenant));
    });
  }

  async getUser(userId: string): Promise<PersistedUser | undefined> {
    return this.readJson<PersistedUser>(this.userPath(userId));
  }

  async getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined> {
    const users = await this.listUsers(tenantId);
    const needle = login.trim().toLowerCase();
    return users.find((u) => u.login.toLowerCase() === needle);
  }

  async saveUser(user: PersistedUser): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.mkdir(this.usersDir(), { recursive: true });
      await this.writeAtomic(this.userPath(user.userId), user);
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.enqueue(async () => {
      try {
        await fs.unlink(this.userPath(userId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
  }

  async listUsers(tenantId: string): Promise<PersistedUser[]> {
    await this.ensureDir();
    await fs.mkdir(this.usersDir(), { recursive: true });
    const names = await fs.readdir(this.usersDir());
    const users: PersistedUser[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const user = await this.readJson<PersistedUser>(path.join(this.usersDir(), name));
      if (user && user.tenantId === tenantId) users.push(user);
    }
    return users.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getConfig(tenantId: string): Promise<TenantConfig | undefined> {
    const config = await this.readJson<TenantConfig>(this.configPath());
    if (!config || config.tenantId !== tenantId) return undefined;
    return config;
  }

  async saveConfig(config: TenantConfig): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await this.writeAtomic(this.configPath(), config);
    });
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await fs.appendFile(this.auditPath(), `${JSON.stringify(entry)}\n`, 'utf8');
    });
  }

  async listAudit(tenantId: string): Promise<AuditEntry[]> {
    try {
      const raw = await fs.readFile(this.auditPath(), 'utf8');
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry)
        .filter((entry) => entry.tenantId === tenantId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async saveNotification(row: OperationalNotification): Promise<'created' | 'exists'> {
    let result: 'created' | 'exists' = 'created';
    await this.enqueue(async () => {
      await this.ensureDir();
      const list = (await this.readJson<OperationalNotification[]>(this.notificationsPath())) || [];
      if (list.some((n) => n.tenantId === row.tenantId && n.recipientId === row.recipientId && n.dedupeKey === row.dedupeKey)) {
        result = 'exists';
        return;
      }
      list.push(row);
      await this.writeAtomic(this.notificationsPath(), list);
    });
    return result;
  }

  async listNotifications(filter: {
    tenantId: string;
    recipientId?: string;
    audience?: OperationalNotification['audience'];
  }): Promise<OperationalNotification[]> {
    const list = (await this.readJson<OperationalNotification[]>(this.notificationsPath())) || [];
    return list.filter((n) => {
      if (filter.audience === 'platform') return n.audience === 'platform' && n.recipientId === filter.recipientId;
      if (n.tenantId !== filter.tenantId) return false;
      if (filter.audience && n.audience !== filter.audience) return false;
      if (filter.recipientId && n.recipientId !== filter.recipientId) return false;
      return true;
    });
  }

  async getNotification(notificationId: string): Promise<OperationalNotification | undefined> {
    const list = (await this.readJson<OperationalNotification[]>(this.notificationsPath())) || [];
    return list.find((n) => n.notificationId === notificationId);
  }

  async markNotificationRead(notificationId: string, readAt: number): Promise<OperationalNotification | undefined> {
    let updated: OperationalNotification | undefined;
    await this.enqueue(async () => {
      const list = (await this.readJson<OperationalNotification[]>(this.notificationsPath())) || [];
      const idx = list.findIndex((n) => n.notificationId === notificationId);
      if (idx < 0) return;
      list[idx] = { ...list[idx], read: true, readAt };
      updated = list[idx];
      await this.writeAtomic(this.notificationsPath(), list);
    });
    return updated;
  }

  private tenantPath() {
    return path.join(this.directory, 'tenant.json');
  }
  private configPath() {
    return path.join(this.directory, 'config.json');
  }
  private auditPath() {
    return path.join(this.directory, 'audit.jsonl');
  }
  private notificationsPath() {
    return path.join(this.directory, 'notifications.json');
  }
  private usersDir() {
    return path.join(this.directory, 'users');
  }
  private userPath(userId: string) {
    return path.join(this.usersDir(), `${userId}.json`);
  }

  private async readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
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
