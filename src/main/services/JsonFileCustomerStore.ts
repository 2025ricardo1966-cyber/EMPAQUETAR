import fs from 'fs/promises';
import path from 'path';
import type {
  CustomerProfile,
  OrderNotificationEvent,
} from '../../contracts/customer-experience';
import type { CustomerFileRecord, CustomerStore } from './CustomerStore';

interface StoreState {
  customers: CustomerProfile[];
  files: CustomerFileRecord[];
}

/** Durable customer identity + attachment blobs. Directory is injected by the host. */
export class JsonFileCustomerStore implements CustomerStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private directory: string) {}

  setDirectory(directory: string): void {
    this.directory = directory;
  }

  async saveCustomer(profile: CustomerProfile): Promise<void> {
    await this.mutate((state) => {
      const idx = state.customers.findIndex((c) => c.customerId === profile.customerId);
      if (idx >= 0) state.customers[idx] = profile;
      else state.customers.push(profile);
    });
  }

  async getCustomer(customerId: string): Promise<CustomerProfile | undefined> {
    const state = await this.readState();
    return state.customers.find((c) => c.customerId === customerId);
  }

  async getCustomerByLogin(tenantId: string, login: string): Promise<CustomerProfile | undefined> {
    const state = await this.readState();
    return state.customers.find((c) => c.tenantId === tenantId && c.login === login);
  }

  async saveFileMeta(record: CustomerFileRecord): Promise<void> {
    await this.mutate((state) => {
      const idx = state.files.findIndex((f) => f.fileId === record.fileId);
      if (idx >= 0) state.files[idx] = record;
      else state.files.push(record);
    });
  }

  async getFile(fileId: string): Promise<CustomerFileRecord | undefined> {
    const state = await this.readState();
    return state.files.find((f) => f.fileId === fileId);
  }

  async listFiles(fileIds: string[]): Promise<CustomerFileRecord[]> {
    const state = await this.readState();
    return state.files.filter((f) => fileIds.includes(f.fileId));
  }

  async writeBlob(fileId: string, bytes: Buffer): Promise<string> {
    await this.ensureDir();
    const blobDir = path.join(this.directory, 'blobs');
    await fs.mkdir(blobDir, { recursive: true });
    await fs.writeFile(path.join(blobDir, `${fileId}.bin`), bytes);
    return `attachments/${fileId}`;
  }

  async readBlob(fileId: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(path.join(this.directory, 'blobs', `${fileId}.bin`));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async appendEvent(event: OrderNotificationEvent): Promise<void> {
    await this.ensureDir();
    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(path.join(this.directory, 'events.jsonl'), line, 'utf8');
  }

  async listEvents(orderId: string): Promise<OrderNotificationEvent[]> {
    try {
      const raw = await fs.readFile(path.join(this.directory, 'events.jsonl'), 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OrderNotificationEvent)
        .filter((e) => e.orderId === orderId);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw error;
    }
  }

  private statePath(): string {
    return path.join(this.directory, 'state.json');
  }

  private async readState(): Promise<StoreState> {
    try {
      const raw = await fs.readFile(this.statePath(), 'utf8');
      const parsed = JSON.parse(raw) as StoreState;
      return { customers: parsed.customers || [], files: parsed.files || [] };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { customers: [], files: [] };
      throw error;
    }
  }

  private async mutate(work: (state: StoreState) => void): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      const state = await this.readState();
      work(state);
      const target = this.statePath();
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await fs.rename(temp, target);
    });
  }

  private async ensureDir(): Promise<void> {
    if (!this.directory) return;
    await fs.mkdir(this.directory, { recursive: true });
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
