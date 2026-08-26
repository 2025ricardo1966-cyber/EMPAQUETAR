import { randomUUID } from 'crypto';
import type { AuthContext } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import {
  canTransitionMembership,
  effectiveMembershipStatus,
  MEMBERSHIP_STATUSES,
  MembershipRestrictedError,
  TRIAL_DURATION_MS,
  TRIAL_MAX_ORDERS,
  type Membership,
  type MembershipPlanId,
  type MembershipStatus,
} from '../../contracts/membership-domain';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { OrderService } from './OrderService';

export class MembershipService {
  constructor(
    private store: ControlPlaneStore,
    private orders: OrderService
  ) {}

  async assignTrial(tenantId: string, customerId: string, now = Date.now()): Promise<Membership> {
    const existing = await this.store.getMembershipByCustomer(customerId);
    if (existing) return this.refresh(existing, now);
    return this.save({
      id: randomUUID(),
      tenantId,
      customerId,
      planId: 'TRIAL',
      status: 'TRIAL',
      startedAt: now,
      expiresAt: now + TRIAL_DURATION_MS,
      createdAt: now,
      updatedAt: now,
    });
  }

  async assign(
    ctx: AuthContext,
    customerId: string,
    input: { planId?: string; status?: MembershipStatus; expiresAt?: number }
  ): Promise<Membership> {
    this.assertAdmin(ctx);
    const customer = await this.store.getCustomer(customerId);
    if (!customer || customer.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const now = Date.now();
    const existing = await this.store.getMembershipByCustomer(customerId);
    const status = input.status || 'TRIAL';
    if (!MEMBERSHIP_STATUSES.includes(status)) throw new RequestInvalidError('INVALID_MEMBERSHIP_STATUS');
    const planId = (input.planId || (status === 'TRIAL' ? 'TRIAL' : 'STANDARD')) as MembershipPlanId;
    const currency = (await this.store.getConfig(ctx.tenantId))?.commercial?.defaultCurrency;
    const next: Membership = {
      id: existing?.id || randomUUID(),
      tenantId: ctx.tenantId,
      customerId,
      planId,
      currency,
      status,
      startedAt: existing?.startedAt || now,
      expiresAt: input.expiresAt ?? (status === 'TRIAL' ? now + TRIAL_DURATION_MS : existing?.expiresAt || now + TRIAL_DURATION_MS),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    return this.save(next);
  }

  async setStatus(ctx: AuthContext, customerId: string, to: MembershipStatus): Promise<Membership> {
    this.assertAdmin(ctx);
    if (!MEMBERSHIP_STATUSES.includes(to)) throw new RequestInvalidError('INVALID_MEMBERSHIP_TRANSITION');
    const row = await this.requireForTenant(ctx.tenantId, customerId);
    const current = effectiveMembershipStatus(row);
    if (!canTransitionMembership(current, to)) throw new RequestInvalidError('INVALID_MEMBERSHIP_TRANSITION');
    if (current === to) return this.public(row);
    row.status = to;
    row.updatedAt = Date.now();
    if (to === 'ACTIVE' && current === 'EXPIRED') {
      row.expiresAt = Date.now() + TRIAL_DURATION_MS;
      row.startedAt = Date.now();
    }
    return this.save(row);
  }

  async getMine(ctx: AuthContext): Promise<Membership> {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    const row = await this.store.getMembershipByCustomer(ctx.userId);
    if (!row || row.tenantId !== ctx.tenantId) throw new MembershipRestrictedError('MEMBERSHIP_REQUIRED');
    return this.public(await this.refresh(row));
  }

  async getForAdmin(ctx: AuthContext, customerId: string): Promise<Membership | null> {
    this.assertAdmin(ctx);
    const row = await this.store.getMembershipByCustomer(customerId);
    if (!row || row.tenantId !== ctx.tenantId) return null;
    return this.public(await this.refresh(row));
  }

  async assertCanCreateOrder(ctx: AuthContext, customerId: string): Promise<Membership> {
    const row = await this.store.getMembershipByCustomer(customerId);
    if (!row || row.tenantId !== ctx.tenantId) throw new MembershipRestrictedError('MEMBERSHIP_REQUIRED');
    const live = await this.refresh(row);
    const status = live.status;
    if (status === 'SUSPENDED') throw new MembershipRestrictedError('MEMBERSHIP_SUSPENDED');
    if (status === 'EXPIRED') throw new MembershipRestrictedError('MEMBERSHIP_EXPIRED');
    if (status === 'TRIAL') {
      const listed = await this.orders.listOrders(ctx.tenantId, 'admin');
      const count = listed.filter((o) => o.customerId === customerId).length;
      if (count >= TRIAL_MAX_ORDERS) throw new MembershipRestrictedError('TRIAL_ORDER_LIMIT');
    }
    return live;
  }

  private async refresh(row: Membership, now = Date.now()): Promise<Membership> {
    const next = effectiveMembershipStatus(row, now);
    if (next !== row.status) {
      row.status = next;
      row.updatedAt = now;
      await this.store.saveMembership(row);
    }
    return row;
  }

  private async save(row: Membership): Promise<Membership> {
    await this.store.saveMembership(row);
    return this.public(row);
  }

  private public(row: Membership): Membership {
    return { ...row };
  }

  private async requireForTenant(tenantId: string, customerId: string): Promise<Membership> {
    const row = await this.store.getMembershipByCustomer(customerId);
    if (!row || row.tenantId !== tenantId) throw new AccessDeniedError();
    return this.refresh(row);
  }

  private assertAdmin(ctx: AuthContext) {
    if (!['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'].includes(ctx.roleId)) throw new AccessDeniedError();
  }
}
