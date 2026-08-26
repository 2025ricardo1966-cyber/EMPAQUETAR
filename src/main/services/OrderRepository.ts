import type { PersistedOrder } from '../../contracts/order-domain';

export interface OrderRepository {
  create(order: PersistedOrder): Promise<void>;
  get(orderId: string): Promise<PersistedOrder | undefined>;
  update(order: PersistedOrder): Promise<void>;
  delete(orderId: string): Promise<void>;
  list(tenantId?: string): Promise<PersistedOrder[]>;
}
