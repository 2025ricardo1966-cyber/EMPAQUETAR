import type { AuthContext } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import {
  assertOperationalTransition,
  OPERATIONAL_ORDER_STATUSES,
  pathToOperationalTarget,
  toOperationalStatus,
  type OperationalOrderStatus,
} from '../../contracts/operational-order';
import type { WorkshopCatalogSnapshotLine } from '../../contracts/workshop-catalog-domain';
import type { PersistedOrder } from '../../contracts/order-domain';
import { ResourceNotFoundError } from '../../contracts/http-errors';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { OrderService } from './OrderService';
import type { MembershipService } from './MembershipService';
import type { WorkshopCatalogService } from './WorkshopCatalogService';
import { DEFAULT_SLA_MS } from './ops-constants';

export { DEFAULT_SLA_MS } from './ops-constants';

export class OpsOrderService {
  constructor(
    private store: ControlPlaneStore,
    private orders: OrderService,
    private membership: MembershipService,
    private catalog: WorkshopCatalogService
  ) {}

  async create(
    ctx: AuthContext,
    body: {
      customerId?: string;
      items?: Array<{ itemId: string; quantity: number }>;
      notes?: string;
    }
  ): Promise<PersistedOrder> {
    this.assertAdmin(ctx);
    const customerId = String(body.customerId || '').trim();
    if (!customerId) throw new RequestInvalidError('CUSTOMER_REQUIRED');
    const profile = await this.store.getCustomer(customerId);
    if (!profile || profile.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const lines = Array.isArray(body.items) ? body.items : [];
    if (!lines.length) throw new RequestInvalidError('ORDER_ITEMS_REQUIRED');
    await this.membership.assertCanCreateOrder(ctx, customerId);
    const snapshots: WorkshopCatalogSnapshotLine[] = [];
    let total = 0;
    for (const line of lines) {
      const item = await this.catalog.requireEnabledLine(ctx.tenantId, String(line.itemId), Number(line.quantity));
      const quantity = Number(line.quantity);
      snapshots.push({
        itemId: item.itemId,
        category: item.category,
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        unit: item.unit,
        quantity,
      });
      total += item.price * quantity;
    }
    return this.orders.createOrder({
      tenantId: ctx.tenantId,
      customerId,
      customerName: profile.name,
      summary: body.notes || snapshots.map((s) => s.name).join(', '),
      dueAt: Date.now() + DEFAULT_SLA_MS,
      actor: { actorId: ctx.userId, role: 'admin' },
      initialStatus: 'pending',
      formValues: { workshopLines: snapshots, notes: body.notes || '' },
      totalCustomerAmount: total,
    });
  }

  async setOperationalStatus(ctx: AuthContext, orderId: string, raw: string): Promise<PersistedOrder> {
    this.assertAdmin(ctx);
    const to = String(raw || '').trim().toUpperCase() as OperationalOrderStatus;
    if (!(OPERATIONAL_ORDER_STATUSES as readonly string[]).includes(to)) {
      throw new RequestInvalidError('INVALID_ORDER_STATUS');
    }
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new ResourceNotFoundError('ORDER_NOT_FOUND');
    const from = toOperationalStatus(order.status);
    if (from === to) return order;
    assertOperationalTransition(from, to);
    let current = order;
    const hops = pathToOperationalTarget(current.status, to);
    for (const hop of hops) {
      current = await this.orders.transition(current.orderId, hop, {
        actorId: ctx.userId,
        role: 'admin',
      });
    }
    return current;
  }

  async getClientOrder(ctx: AuthContext, orderId: string): Promise<PersistedOrder> {
    const order = await this.orders.getOrder(orderId, 'customer');
    if (!order) throw new ResourceNotFoundError('ORDER_NOT_FOUND');
    if (order.tenantId !== ctx.tenantId || order.customerId !== ctx.userId) {
      throw new ResourceNotFoundError('ORDER_NOT_FOUND');
    }
    return order;
  }

  private assertAdmin(ctx: AuthContext) {
    if (!['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'].includes(ctx.roleId)) throw new AccessDeniedError();
  }
}
