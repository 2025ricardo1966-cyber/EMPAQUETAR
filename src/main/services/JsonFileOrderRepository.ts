import fs from 'fs/promises';
import path from 'path';
import type { PersistedOrder } from '../../contracts/order-domain';
import type { OrderRepository } from './OrderRepository';

/** Local durable store for orders. Directory injected by the host. */
export class JsonFileOrderRepository implements OrderRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private directory: string) {}

  setDirectory(directory: string): void {
    this.directory = directory;
  }

  async create(order: PersistedOrder): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      if (await this.exists(order.orderId)) {
        throw new Error(`Order already exists: ${order.orderId}`);
      }
      await this.writeAtomic(order);
    });
  }

  async get(orderId: string): Promise<PersistedOrder | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(orderId), 'utf8');
      return JSON.parse(raw) as PersistedOrder;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async update(order: PersistedOrder): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      await this.writeAtomic(order);
    });
  }

  async delete(orderId: string): Promise<void> {
    await this.enqueue(async () => {
      try {
        await fs.unlink(this.filePath(orderId));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }
    });
  }

  async list(tenantId?: string): Promise<PersistedOrder[]> {
    await this.ensureDir();
    const names = await fs.readdir(this.directory);
    const orders: PersistedOrder[] = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
      const orderId = name.slice(0, -'.json'.length);
      const order = await this.get(orderId);
      if (order && (!tenantId || order.tenantId === tenantId)) orders.push(order);
    }
    return orders.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private filePath(orderId: string): string {
    return path.join(this.directory, `${orderId}.json`);
  }

  private async exists(orderId: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(orderId));
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  private async writeAtomic(order: PersistedOrder): Promise<void> {
    const target = this.filePath(order.orderId);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(order, null, 2)}\n`, 'utf8');
    await fs.rename(temp, target);
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
