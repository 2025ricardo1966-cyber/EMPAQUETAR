import { AccessDeniedError } from '../../contracts/admin-domain';
import type { AuthContext, TenantConfig } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import {
  DEFAULT_CLIENT_OPTIONS,
  normalizeClientOptions,
  type ClientFulfillmentOptions,
  type DeliveryDestination,
  type FulfillmentMode,
  type OrderFulfillment,
  type PartyRef,
} from '../../contracts/fulfillment-domain';
import type { PersistedOrder } from '../../contracts/order-domain';
import { t } from '../../i18n';
import type { AdminService } from './AdminService';
import type { OrderService } from './OrderService';
import type { TraceService } from './TraceService';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';

function party(raw: unknown): PartyRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const name = String(row.name || '').trim();
  if (!name) return undefined;
  return {
    name,
    customerId: row.customerId ? String(row.customerId) : undefined,
    userId: row.userId ? String(row.userId) : undefined,
    phone: row.phone != null ? String(row.phone) : undefined,
    notes: row.notes != null ? String(row.notes) : undefined,
  };
}

function destination(raw: unknown): DeliveryDestination | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  return {
    name: String(row.name || row.deliveryName || '').trim(),
    company: row.company != null ? String(row.company) : undefined,
    country: String(row.country || '').trim(),
    region: row.region != null ? String(row.region) : undefined,
    city: String(row.city || '').trim(),
    postalCode: row.postalCode != null ? String(row.postalCode) : undefined,
    address: String(row.address || '').trim(),
    phone: row.phone != null ? String(row.phone) : undefined,
    instructions: row.instructions != null ? String(row.instructions) : undefined,
  };
}

export function parseOrderFulfillment(
  body: Record<string, unknown>,
  opts: ClientFulfillmentOptions,
  profile: { customerId: string; name: string; userId?: string },
  allowException = false
): OrderFulfillment {
  const mode = String(body.fulfillmentMode || body.mode || 'PICKUP').toUpperCase() as FulfillmentMode;
  if (mode !== 'PICKUP' && mode !== 'DELIVERY') throw new RequestInvalidError('INVALID_FULFILLMENT_MODE');
  if (mode === 'PICKUP' && !opts.pickupEnabled && !allowException) throw new RequestInvalidError('PICKUP_NOT_ENABLED');
  if (mode === 'DELIVERY' && !opts.deliveryEnabled && !allowException) throw new RequestInvalidError('DELIVERY_NOT_ENABLED');
  const delivery = destination(body.delivery || body.destination);
  const recipient = party(body.recipient);
  const pickupAuthorized = party(body.pickupAuthorized || body.pickupByThirdParty);
  const requester = party(body.requester) || { name: profile.name, customerId: profile.customerId, userId: profile.userId };
  const payer = party(body.payer) || { ...requester };
  if (pickupAuthorized && !opts.pickupByThirdPartyEnabled && !allowException) {
    throw new RequestInvalidError('PICKUP_THIRD_PARTY_NOT_ENABLED');
  }
  if (mode === 'DELIVERY') {
    if (!delivery?.name || !delivery.address || !delivery.city || !delivery.country) {
      throw new RequestInvalidError('DELIVERY_ADDRESS_REQUIRED');
    }
  }
  return {
    mode,
    commercialAccountId: body.commercialAccountId ? String(body.commercialAccountId) : profile.customerId,
    requester,
    payer,
    destination: mode === 'DELIVERY' ? delivery : undefined,
    recipient: recipient || (mode === 'DELIVERY' && delivery ? { name: delivery.name, phone: delivery.phone } : undefined),
    pickupAuthorized: mode === 'PICKUP' ? pickupAuthorized : undefined,
    exceptionApproved: allowException,
    exceptionMessageId: body.exceptionMessageId ? String(body.exceptionMessageId) : undefined,
  };
}

export class FulfillmentService {
  constructor(
    private admin: AdminService,
    private orders: OrderService,
    private tracer: TraceService,
    private store: ControlPlaneStore
  ) {}

  async options(ctx: AuthContext): Promise<ClientFulfillmentOptions> {
    const config = await this.admin.peekConfig(ctx.tenantId);
    return normalizeClientOptions(config.clientOptions);
  }

  async putOptions(ctx: AuthContext, body: Record<string, unknown>): Promise<ClientFulfillmentOptions> {
    if (ctx.roleId === 'OPERATOR' || ctx.roleId === 'CUSTOMER') throw new AccessDeniedError();
    const config = await this.admin.peekConfig(ctx.tenantId);
    const next = normalizeClientOptions(config.clientOptions);
    if (body.pickupEnabled != null) next.pickupEnabled = Boolean(body.pickupEnabled);
    if (body.deliveryEnabled != null) next.deliveryEnabled = Boolean(body.deliveryEnabled);
    if (body.pickupByThirdPartyEnabled != null) next.pickupByThirdPartyEnabled = Boolean(body.pickupByThirdPartyEnabled);
    config.clientOptions = next;
    await this.admin.persistConfig(config);
    return next;
  }

  publicOptions(opts: ClientFulfillmentOptions, lang: string) {
    const modes: Array<{ mode: FulfillmentMode; label: string; enabled: boolean }> = [];
    if (opts.pickupEnabled) modes.push({ mode: 'PICKUP', label: t('fulfillment.mode.PICKUP', lang), enabled: true });
    if (opts.deliveryEnabled) modes.push({ mode: 'DELIVERY', label: t('fulfillment.mode.DELIVERY', lang), enabled: true });
    return {
      pickupEnabled: opts.pickupEnabled,
      deliveryEnabled: opts.deliveryEnabled,
      pickupByThirdPartyEnabled: opts.pickupByThirdPartyEnabled,
      modes,
      pickupByThirdPartyLabel: t('fulfillment.pickup_by_third_party', lang),
    };
  }

  parseForCreate(
    body: Record<string, unknown>,
    opts: ClientFulfillmentOptions,
    profile: { customerId: string; name: string; userId?: string },
    allowException = false
  ): OrderFulfillment {
    return parseOrderFulfillment(body, opts, profile, allowException);
  }

  async applyAdmin(ctx: AuthContext, orderId: string, body: Record<string, unknown>): Promise<PersistedOrder> {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'OPERATOR') throw new AccessDeniedError();
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const opts = await this.options(ctx);
    const prev = order.fulfillment;
    const merged: Record<string, unknown> = {
      fulfillmentMode: body.fulfillmentMode || body.mode || prev?.mode || 'PICKUP',
      delivery: body.delivery || body.destination || prev?.destination,
      recipient: body.recipient || prev?.recipient,
      pickupAuthorized: body.pickupAuthorized || body.pickupByThirdParty || prev?.pickupAuthorized,
      requester: body.requester || prev?.requester,
      payer: body.payer || prev?.payer,
      commercialAccountId: body.commercialAccountId || prev?.commercialAccountId,
      exceptionMessageId: body.exceptionMessageId || prev?.exceptionMessageId,
    };
    const next = this.parseForCreate(merged, opts, { customerId: order.customerId, name: order.customerName }, true);
    if (body.exceptionMessageId) {
      const msg = await this.store.getClientMessage(String(body.exceptionMessageId));
      if (!msg || msg.tenantId !== ctx.tenantId) throw new AccessDeniedError();
      next.exceptionMessageId = msg.id;
      next.exceptionApproved = true;
    }
    const updated = await this.orders.setFulfillment(orderId, next, {
      actorId: ctx.userId,
      role: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'admin' : 'subadmin',
    });
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'FULFILLMENT_UPDATED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { mode: next.mode, exceptionMessageId: next.exceptionMessageId || null },
      correlationId: orderId,
    });
    return updated;
  }
}

export function fulfillmentView(order: PersistedOrder, lang: string) {
  const f = order.fulfillment || { mode: 'PICKUP' as const };
  return {
    fulfillmentMode: f.mode,
    modeLabel: t(`fulfillment.mode.${f.mode}`, lang),
    commercialAccountId: f.commercialAccountId || order.customerId,
    requester: f.requester || { name: order.customerName, customerId: order.customerId },
    payer: f.payer || f.requester || { name: order.customerName, customerId: order.customerId },
    delivery: f.destination || null,
    recipient: f.recipient || null,
    pickupAuthorized: f.pickupAuthorized || null,
    exceptionApproved: Boolean(f.exceptionApproved),
    exceptionMessageId: f.exceptionMessageId || null,
  };
}

export function optionsFromConfig(config?: TenantConfig | null): ClientFulfillmentOptions {
  return normalizeClientOptions(config?.clientOptions || DEFAULT_CLIENT_OPTIONS);
}
