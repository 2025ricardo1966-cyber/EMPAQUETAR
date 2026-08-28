import { randomBytes, randomUUID } from 'crypto';
import type { AuthContext, PersistedUser, TenantConfig } from '../../contracts/admin-domain';
import { AccessDeniedError, CUSTOMER_DEFAULT_PERMISSIONS } from '../../contracts/admin-domain';
import { DEFAULT_TENANT_LIMITS } from '../../contracts/auth-rbac';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import { PaymentRequiredError, paymentMeetsRequired, presentCustomerOrderStatus, type CustomerProfile, type OrderFileRecord, type PaymentRecord } from '../../contracts/customer-experience';
import { DEFAULT_CUSTOMER_VISIBILITY, type OrderAttachmentRef, type PersistedOrder } from '../../contracts/order-domain';
import { t } from '../../i18n';
import { normalizeClientOptions } from '../../contracts/fulfillment-domain';
import { fulfillmentView, parseOrderFulfillment } from './FulfillmentService';
import { hashPassword } from './passwordHash';
import type { AdminService } from './AdminService';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { CustomerPortalService } from './CustomerPortalService';
import type { OrderService } from './OrderService';
import type { ProductionOrchestrator } from './ProductionOrchestrator';
import type { TraceService } from './TraceService';
import type { WorkflowEngine } from './WorkflowEngine';
import {
  normalizeLanguageTag,
  resolveConfiguredLanguage,
  sanitizeContact,
} from '../../contracts/international-domain';
import { MembershipService } from './MembershipService';
import { TRIAL_DURATION_MS } from '../../contracts/membership-domain';
import { toOperationalStatus } from '../../contracts/operational-order';
import { WorkshopCatalogService } from './WorkshopCatalogService';
import {
  categoryToDiscipline,
  workshopCostType,
  workshopMaterialId,
  type WorkshopCatalogItem,
} from '../../contracts/workshop-catalog-domain';
import { resolveUnitId } from '../../contracts/catalog-domain';
import {
  assertHumanProjectName,
  evaluatePriceDecision,
  agreedOrderAmount,
  paymentFullySettled,
  nextPaymentRemaining,
  formatCommercialDate,
  linesFromOrder,
  productionRosterOf,
  type CommercialEconomicSnapshot,
} from '../../contracts/commercial-terms';
import {
  approvedRosterRecords,
  interpretRosterRows,
  isSpreadsheetUpload,
  parseSpreadsheetBytes,
  type RosterIntake,
  type RosterRecord,
} from '../../contracts/roster-intake';
import {
  LASER_MATERIAL_ID,
  assertTpuDimensions,
  findSizeLabel,
  isGarmentType,
  orderToViewerParams,
  parseGarmentType,
  snapshotSizeTable,
  type GarmentConfig,
  type GarmentConfigItem,
  type LaserOrderConfig,
  type Preview3DDecision,
  type TPUOrderConfig,
} from '../../contracts/order-configuration-domain';
import {
  assertDistributionIntegrity,
  distributeDesign,
  selectedGarmentTypesOf,
  type GarmentFamilyConfig,
} from '../../contracts/design-distribution';
import {
  assertFamilyStyle,
  defaultFamilyStyle,
  familyStyleOptions,
  moldeIdForFamily,
} from '../../contracts/garment-family-style';
import { actorTypeFromRole } from '../../contracts/trace-domain';
import {
  assertOrderCanGenerateOutputs,
  isProductionGateError,
} from '../../contracts/order-production-output';
import { buildIndustrialOrderArtifacts } from './orderIndustrialExport';

function contactOrThrow(input: Parameters<typeof sanitizeContact>[0]) {
  try {
    return sanitizeContact(input);
  } catch (err) {
    throw new RequestInvalidError(err instanceof Error ? err.message : 'INVALID_CONTACT');
  }
}

const DEFAULT_SLA_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'image/svg+xml',
  'application/postscript',
  'application/x-coreldraw',
  'image/vnd.corel.draw',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ACTIVE = new Set([
  'pending',
  'received',
  'reviewing',
  'editing',
  'approved',
  'preparing',
  'printing',
  'printing_in_progress',
  'production',
]);
const READY = new Set(['ready']);
const CLOSED = new Set(['completed', 'delivered', 'cancelled', 'expired']);
const PRODUCTIVE_DRAFT_KEYS = [
  'quantity',
  'workshopItemId',
  'workshopLines',
  'garmentConfig',
  'tpuConfig',
  'laserConfig',
  'sizeTableSnapshot',
  'sizeTableId',
  'selectedGarmentTypes',
  'designDistribution',
  'designFileId',
] as const;
const confirmPaymentTail = new Map<string, Promise<void>>();

function serializeConfirmPayment<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  const prev = confirmPaymentTail.get(orderId) || Promise.resolve();
  const run = prev.then(fn, fn);
  confirmPaymentTail.set(
    orderId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

function workflowStatusKey(status: string): string {
  const map: Record<string, string> = {
    pending: 'PENDING',
    received: 'RECEIVED',
    reviewing: 'REVIEWING',
    editing: 'EDITING',
    approved: 'APPROVED',
    preparing: 'PRODUCTION',
    printing: 'PRINTING',
    printing_in_progress: 'PRINTING',
    production: 'PRODUCTION',
    ready: 'READY',
    completed: 'COMPLETED',
    delivered: 'DELIVERED',
    cancelled: 'CANCELLED',
    expired: 'EXPIRED',
  };
  return map[status] || String(status || '').toUpperCase();
}

export class ClientPortalService {
  constructor(
    private store: ControlPlaneStore,
    private orders: OrderService,
    private portal: CustomerPortalService,
    private admin: AdminService,
    private tracer: TraceService,
    private workflows: WorkflowEngine,
    private orchestrator: ProductionOrchestrator
  ) {}

  async register(input: {
    tenantId: string;
    email: string;
    password: string;
    name: string;
    phone?: string;
    preferredLanguage?: string;
    country?: string;
    region?: string;
    city?: string;
    postalCode?: string;
    address?: string;
  }): Promise<{ userId: string; customerId: string; verificationToken: string }> {
    const tenant = await this.store.getTenant(input.tenantId);
    if (!tenant) throw new RequestInvalidError('TENANT_NOT_FOUND');
    const config = await this.store.getConfig(input.tenantId);
    if (!config || (config.setupDone !== true && tenant.status !== 'ACTIVE')) {
      throw new RequestInvalidError('TENANT_NOT_READY');
    }
    const email = input.email.trim().toLowerCase();
    if (!email || !input.name?.trim()) throw new RequestInvalidError('CUSTOMER_IDENTITY');
    const contact = contactOrThrow({
      phone: input.phone,
      country: input.country,
      region: input.region,
      city: input.city,
      postalCode: input.postalCode,
      address: input.address,
    });
    const preferredLanguage =
      (input.preferredLanguage ? normalizeLanguageTag(input.preferredLanguage) : undefined) ||
      resolveConfiguredLanguage(config);
    const existing = await this.store.getUserByLogin(input.tenantId, email);
    if (existing) throw new RequestInvalidError('LOGIN_TAKEN');
    const now = Date.now();
    const customerId = randomUUID();
    const verificationToken = randomBytes(24).toString('hex');
    const user: PersistedUser = {
      userId: customerId,
      tenantId: input.tenantId,
      login: email,
      email,
      name: input.name.trim(),
      displayCode: `CLI-${customerId.slice(0, 8)}`,
      roleId: 'CUSTOMER',
      permissions: [...CUSTOMER_DEFAULT_PERMISSIONS],
      status: 'active',
      password: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
      emailVerified: !process.env.RESEND_API_KEY,
      verificationToken: process.env.RESEND_API_KEY ? verificationToken : null,
      verificationExpiresAt: now + 24 * 60 * 60 * 1000,
      preferredLanguage,
    };
    await this.store.saveUser(user);
    const profile: CustomerProfile = {
      customerId,
      userId: customerId,
      tenantId: input.tenantId,
      name: input.name.trim(),
      contact: email,
      login: email,
      email,
      phone: contact.phone,
      preferredLanguage,
      country: contact.country,
      region: contact.region,
      city: contact.city,
      postalCode: contact.postalCode,
      address: contact.address,
      status: 'active',
      isTrust: false,
      currentDebt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveCustomer(profile);
    await this.store.saveMembership({
      id: randomUUID(),
      tenantId: input.tenantId,
      customerId,
      planId: 'TRIAL',
      status: 'TRIAL',
      startedAt: now,
      expiresAt: now + TRIAL_DURATION_MS,
      createdAt: now,
      updatedAt: now,
    });
    await this.tracer.record({
      tenantId: input.tenantId,
      entityType: 'tenant',
      entityId: customerId,
      eventType: 'CUSTOMER_REGISTERED',
      actorType: 'CUSTOMER',
      actorId: customerId,
      metadata: { email },
      correlationId: customerId,
    });
    return { userId: customerId, customerId, verificationToken };
  }

  async getProfile(ctx: AuthContext) {
    const profile = await this.requireCustomer(ctx);
    const user = await this.store.getUser(ctx.userId);
    return {
      preferredLanguage: user?.preferredLanguage || profile.preferredLanguage || 'es',
      lang: ctx.lang || user?.preferredLanguage || 'es',
      country: profile.country || null,
      region: profile.region || null,
      city: profile.city || null,
      postalCode: profile.postalCode || null,
      phone: profile.phone || null,
      address: profile.address || null,
      name: profile.name,
    };
  }

  async updateProfile(ctx: AuthContext, body: Record<string, unknown>) {
    const profile = await this.requireCustomer(ctx);
    const user = await this.store.getUser(ctx.userId);
    if (body.preferredLanguage != null) {
      const lang = normalizeLanguageTag(String(body.preferredLanguage));
      if (!lang) throw new RequestInvalidError('INVALID_LANGUAGE');
      profile.preferredLanguage = lang;
      if (user) {
        user.preferredLanguage = lang;
        user.updatedAt = Date.now();
        await this.store.saveUser(user);
      }
    }
    const contact = contactOrThrow({
      phone: body.phone != null ? String(body.phone) : profile.phone,
      country: body.country != null ? String(body.country) : profile.country,
      region: body.region != null ? String(body.region) : profile.region,
      city: body.city != null ? String(body.city) : profile.city,
      postalCode: body.postalCode != null ? String(body.postalCode) : profile.postalCode,
      address: body.address != null ? String(body.address) : profile.address,
    });
    if (body.country != null) profile.country = contact.country;
    if (body.region != null) profile.region = contact.region;
    if (body.city != null) profile.city = contact.city;
    if (body.postalCode != null) profile.postalCode = contact.postalCode;
    if (body.phone != null) profile.phone = contact.phone;
    if (body.address != null) profile.address = contact.address;
    profile.updatedAt = Date.now();
    await this.store.saveCustomer(profile);
    return this.getProfile({ ...ctx, preferredLanguage: profile.preferredLanguage, lang: profile.preferredLanguage });
  }

  async activateTrust(ctx: AuthContext, trustCode: string) {
    const profile = await this.requireCustomer(ctx);
    const config = await this.requireConfig(ctx.tenantId);
    const entry = (config.trustCodes || []).find((c) => c.code === trustCode.trim());
    if (!entry) throw new RequestInvalidError('INVALID_TRUST_CODE');
    profile.isTrust = true;
    profile.trustCode = entry.code;
    profile.creditLimit = entry.creditLimit;
    profile.currentDebt = profile.currentDebt || 0;
    profile.updatedAt = Date.now();
    await this.store.saveCustomer(profile);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'tenant',
      entityId: profile.customerId,
      eventType: 'CUSTOMER_TRUST_ACTIVATED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { customerId: profile.customerId },
      correlationId: profile.customerId,
    });
    return { ok: true, isTrust: true, creditAvailable: this.creditAvailable(profile) };
  }

  async dashboard(ctx: AuthContext) {
    const profile = await this.requireCustomer(ctx);
    const membership = await new MembershipService(this.store, this.orders).getMine(ctx).catch(() => null);
    const listed = await this.orders.listOrders(ctx.tenantId, 'customer', Date.now(), ctx.userId);
    const notes = await this.tracer.listNotifications(ctx, {});
    return {
      customer: {
        id: profile.customerId,
        displayName: profile.name,
        isTrust: !!profile.isTrust,
        creditAvailable: profile.isTrust ? this.creditAvailable(profile) : null,
        preferredLanguage: profile.preferredLanguage || ctx.lang || 'es',
        membershipStatus: membership?.status || null,
      },
      ordersSummary: {
        active: listed.filter((o) => ACTIVE.has(o.status)).length,
        pendingApproval: listed.filter((o) => o.approvalStatus === 'pending' || o.status === 'reviewing').length,
        ready: listed.filter((o) => READY.has(o.status)).length,
      },
      unreadNotifications: notes.unreadCount,
    };
  }

  async catalog(ctx: AuthContext) {
    await this.requireCustomer(ctx);
    return this.admin.configuration.listActiveProducts(ctx.tenantId);
  }

  async listOrders(ctx: AuthContext, query: { status?: string; page?: number; limit?: number }) {
    await this.requireCustomer(ctx);
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    let listed = await this.orders.listOrders(ctx.tenantId, 'customer', Date.now(), ctx.userId);
    if (query.status) listed = listed.filter((o) => o.status === query.status);
    const slice = listed.slice((page - 1) * limit, page * limit);
    return {
      page,
      limit,
      total: listed.length,
      items: slice.map((o) => this.listItem(o, ctx.lang)),
    };
  }

  async getOrder(ctx: AuthContext, orderId: string) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const files = await this.store.listOrderFiles(ctx.tenantId, orderId);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    const timeline = await this.tracer.timeline(ctx, orderId);
    const config = await this.requireConfig(ctx.tenantId);
    const vis = (config.config?.clientVisibility || {}) as {
      showConsumption?: boolean;
      showMaterials?: boolean;
    };
    return {
      ...this.listItem(order, ctx.lang),
      notes: order.formValues?.notes || order.summary,
      formData: order.formValues || {},
      statusHistory: (order.history || []).map((h) => ({
        from: h.from,
        to: h.to,
        operationalFrom: h.from ? toOperationalStatus(h.from) : null,
        operationalTo: toOperationalStatus(h.to),
        at: h.at,
        atIso: new Date(h.at).toISOString(),
      })),
      consumption: vis.showConsumption === false
        ? []
        : (order.consumptions || []).map((c) => ({
            name: vis.showMaterials === false ? undefined : c.name,
            quantity: c.quantity,
            unit: c.unit,
            unitPrice: c.customerUnitPrice,
            amount: c.calculatedCustomerAmount,
            costType: c.costType,
          })),
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        status: f.status,
        uploadedAt: f.uploadedAt,
      })),
      payment: payment
        ? {
            requiredPct: payment.requiredPct,
            amountDue: payment.amountDue,
            amountPaid: payment.amountPaid,
            remaining: nextPaymentRemaining({
              amountDue: Number(payment.amountDue || 0),
              amountPaid: Number(payment.amountPaid || 0),
              agreed: agreedOrderAmount(order),
            }),
            remainingBalance: Math.max(0, Math.round((agreedOrderAmount(order) - Number(payment.amountPaid || 0)) * 100) / 100),
            settled: paymentFullySettled(agreedOrderAmount(order), Number(payment.amountPaid || 0)),
            status: payment.status,
            hasVoucher: !!payment.voucherKey,
            meetsRequired: paymentMeetsRequired(payment),
            exceptionAuthorized: !!payment.exceptionAuthorized,
            exceptionBy: payment.exceptionBy,
            exceptionAt: payment.exceptionAt,
            exceptionNote: payment.exceptionNote,
            exceptionCondition: payment.exceptionCondition,
            checkoutOpen:
              !['cancelled', 'expired'].includes(order.status) &&
              !paymentFullySettled(agreedOrderAmount(order), Number(payment.amountPaid || 0)),
          }
        : null,
      commercialTerms: this.presentCommercialTerms(order, payment),
      roster: this.presentRoster(order),
      configuration: this.presentConfiguration(order),
      viewer: this.viewerFromOrder(order),
      outputs: Array.isArray(order.formValues?.productionOutputs) ? order.formValues.productionOutputs : [],
      timeline: timeline.slice(-20),
    };
  }

  async createOrder(ctx: AuthContext, input: {
    productId?: string;
    workshopItemId?: string;
    quantity: number;
    projectName?: string;
    formData?: Record<string, unknown>;
    notes?: string;
    fulfillment?: Record<string, unknown>;
  }) {
    if (input.workshopItemId) return this.createFromWorkshop(ctx, input);
    const profile = await this.requireCustomer(ctx);
    await new MembershipService(this.store, this.orders).assertCanCreateOrder(ctx, profile.customerId);
    const config = await this.requireConfig(ctx.tenantId);
    const limits = { ...DEFAULT_TENANT_LIMITS, ...(config.limits || {}) };
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new RequestInvalidError('INVALID_QUANTITY');
    // maxUnitsPerOrder aplica solo al alta inicial. El plantel aprobado es la fuente de verdad (reviewRoster).
    if (quantity > limits.maxUnitsPerOrder) throw new RequestInvalidError('LIMIT_UNITS_EXCEEDED');
    const product = (config.products || []).find((p) => p.productId === input.productId && p.tenantId === ctx.tenantId);
    if (!product || product.active === false || product.visibleToClient === false) throw new RequestInvalidError('PRODUCT_UNAVAILABLE');
    const materialId = product.materialIds?.[0];
    if (!materialId) throw new RequestInvalidError('PRODUCT_NO_MATERIAL');
    const lines = [{ productId: product.productId, materialId, requestedQuantity: quantity }];
    const quote = await this.admin.quoteCatalog(ctx, lines);
    const total = Number(quote.totals.customer || 0);
    const consumptionQty = Number(quote.lines[0]?.consumption || quantity);
    if (consumptionQty > limits.maxMetersPerOrder) throw new RequestInvalidError('LIMIT_METERS_EXCEEDED');
    if (profile.isTrust) {
      const limit = Number(profile.creditLimit || 0);
      const debt = Number(profile.currentDebt || 0);
      if (debt + total > limit) throw new PaymentRequiredError(t('errors.credit_limit_reached', ctx.lang));
    }
    const projectName = assertHumanProjectName(String(input.projectName || ''), false);
    const dueAt = Date.now() + DEFAULT_SLA_MS;
    const fulfillment = parseOrderFulfillment(
      input.fulfillment || {},
      normalizeClientOptions(config.clientOptions),
      { customerId: profile.customerId, name: profile.name, userId: ctx.userId }
    );
    const order = await this.orders.createOrder({
      tenantId: ctx.tenantId,
      customerId: profile.customerId,
      customerName: profile.name,
      projectName: projectName || undefined,
      summary: projectName || input.notes || product.name,
      dueAt,
      actor: { actorId: ctx.userId, role: 'customer' },
      initialStatus: 'received',
      fulfillment,
      formValues: {
        productId: product.productId,
        quantity,
        notes: input.notes,
        projectName: projectName || undefined,
        ...(input.formData || {}),
      },
      visibility: { ...DEFAULT_CUSTOMER_VISIBILITY },
      configurationSnapshot: {
        schemaId: product.schemaId || 'client-portal',
        schemaVersion: 1,
        disciplineId: product.rubricId,
        capturedAt: Date.now(),
        fields: [],
        materials: [],
      },
    });
    const priced = await this.admin.confirmCatalogOrder(ctx, order.orderId, lines);
    return this.afterCreate(ctx, profile, priced, config, limits);
  }

  async quoteWorkshop(ctx: AuthContext, input: { workshopItemId: string; quantity: number }) {
    await this.requireCustomer(ctx);
    const quantity = Number(input.quantity);
    const item = await new WorkshopCatalogService(this.store).requireEnabledLine(
      ctx.tenantId,
      String(input.workshopItemId || ''),
      quantity
    );
    const lines = await this.syncWorkshopLine(ctx, item, quantity);
    const quote = await this.admin.quoteCatalog(ctx, lines);
    const line = quote.lines[0];
    return {
      currency: quote.currency,
      itemId: item.itemId,
      name: item.name,
      unit: item.unit,
      quantity,
      unitPrice: line?.customerUnitPrice,
      consumption: line?.consumption,
      consumptionUnit: line?.unit,
      costType: line?.costType,
      subtotal: quote.totals.customer,
      total: quote.totals.customer,
      lines: quote.lines.map((l) => ({
        name: l.name,
        unit: l.unit,
        consumption: l.consumption,
        unitPrice: l.customerUnitPrice,
        amount: l.calculatedCustomerAmount,
        costType: l.costType,
      })),
    };
  }

  async updateDraft(
    ctx: AuthContext,
    orderId: string,
    body: { projectName?: string; formData?: Record<string, unknown>; rawMaterial?: boolean; previewApproved?: boolean }
  ) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    if (CLOSED.has(order.status) || order.status === 'printing' || order.status === 'printing_in_progress' || order.status === 'production') {
      throw new RequestInvalidError('ORDER_CLOSED');
    }
    const formValues: Record<string, unknown> = { ...(body.formData || {}) };
    delete formValues.rosterProduction;
    delete formValues.rosterIntake;
    delete formValues.economicSnapshot;
    delete formValues.garmentConfig;
    delete formValues.tpuConfig;
    delete formValues.laserConfig;
    delete formValues.sizeTableSnapshot;
    delete formValues.selectedGarmentTypes;
    delete formValues.designDistribution;
    delete formValues.designFileId;
    const productiveLocked =
      !!order.economicSnapshot?.frozen || READY.has(order.status) || CLOSED.has(order.status);
    if (productiveLocked && body.formData) {
      for (const key of PRODUCTIVE_DRAFT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(body.formData, key)) {
          throw new RequestInvalidError('PRICE_FROZEN');
        }
      }
    }
    if (body.rawMaterial != null) formValues.rawMaterialRequested = !!body.rawMaterial;
    if (body.previewApproved != null) formValues.previewApproved = !!body.previewApproved;
    if (body.rawMaterial != null || body.previewApproved != null) {
      const status: Preview3DDecision['status'] = body.rawMaterial
        ? 'RAW'
        : body.previewApproved
          ? 'APPROVED'
          : 'REJECTED';
      formValues.preview3dDecision = {
        status,
        at: Date.now(),
        actorId: ctx.userId,
      } satisfies Preview3DDecision;
    }
    const previousName = String(order.projectName || order.formValues?.projectName || '');
    const projectName =
      body.projectName != null ? assertHumanProjectName(body.projectName, false) : undefined;
    return this.orders.patchCustomerDraft(
      orderId,
      { actorId: ctx.userId, role: 'customer' },
      { projectName, formValues }
    ).then(async (updated) => {
      const nextName = String(updated.projectName || updated.formValues?.projectName || '');
      if (projectName != null && nextName && nextName !== previousName) {
        await this.tracer.record({
          tenantId: ctx.tenantId,
          entityType: 'order',
          entityId: orderId,
          eventType: 'PROJECT_NAME_CHANGED',
          actorType: 'CUSTOMER',
          actorId: ctx.userId,
          metadata: {
            orderId,
            customerId: order.customerId,
            customerName: order.customerName,
            previousName,
            nextName,
            at: Date.now(),
          },
          correlationId: orderId,
        });
        const number = updated.displayNumber || orderId;
        await this.tracer.notifyOperational({
          tenantId: ctx.tenantId,
          type: 'ORDER_STATUS_CHANGED',
          title: 'Nombre de pedido modificado',
          workshopMessage: `${order.customerName} modificó el nombre del pedido ${number}.`,
          entityType: 'order',
          entityId: orderId,
          order: updated,
          dedupeKey: `${orderId}:PROJECT_NAME_CHANGED:${nextName}`,
          includeWorkshop: true,
          workshopOnlyAdmins: true,
        });
      }
      if (body.rawMaterial != null || body.previewApproved != null) {
        const decision = updated.formValues?.preview3dDecision as Preview3DDecision | undefined;
        if (decision) {
          await this.orders.recordApproval(
            orderId,
            {
              actorId: ctx.userId,
              at: decision.at,
              decision: decision.status === 'REJECTED' ? 'rejected' : 'approved',
              note: `preview3d:${decision.status}`,
            },
            decision.status === 'REJECTED' ? 'rejected' : decision.status === 'APPROVED' ? 'approved' : 'not_required'
          );
          await this.tracer.record({
            tenantId: ctx.tenantId,
            entityType: 'order',
            entityId: orderId,
            eventType: decision.status === 'REJECTED' ? 'APPROVAL_REJECTED' : 'APPROVAL_APPROVED',
            actorType: 'CUSTOMER',
            actorId: ctx.userId,
            metadata: { orderId, preview3d: decision.status },
            correlationId: orderId,
          });
        }
      }
      return this.listItem(updated, ctx.lang);
    });
  }

  async uploadFile(
    ctx: AuthContext,
    orderId: string,
    input: { filename: string; mimeType: string; contentBase64: string }
  ) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    if (CLOSED.has(order.status)) throw new RequestInvalidError('ORDER_CLOSED');
    const config = await this.requireConfig(ctx.tenantId);
    const limits = { ...DEFAULT_TENANT_LIMITS, ...(config.limits || {}) };
    const existing = await this.store.listOrderFiles(ctx.tenantId, orderId);
    if (existing.length >= limits.maxFilesPerOrder) throw new RequestInvalidError('LIMIT_FILES_EXCEEDED');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (!bytes.length) throw new RequestInvalidError('EMPTY_FILE');
    const maxBytes = limits.maxFileBytes || DEFAULT_TENANT_LIMITS.maxFileBytes || 50 * 1024 * 1024;
    if (bytes.length > maxBytes) throw new RequestInvalidError('FILE_TOO_LARGE');
    const mime = (input.mimeType || '').toLowerCase();
    const name = (input.filename || '').toLowerCase();
    const extra = (limits.allowedMimeTypes || []).map((m) => m.toLowerCase());
    const allowed =
      DEFAULT_MIME.has(mime) ||
      extra.includes(mime) ||
      name.endsWith('.cdr') ||
      name.endsWith('.ai') ||
      name.endsWith('.eps') ||
      name.endsWith('.csv') ||
      name.endsWith('.tsv') ||
      name.endsWith('.txt') ||
      name.endsWith('.xls') ||
      name.endsWith('.xlsx');
    if (!allowed) throw new RequestInvalidError('FILE_TYPE');
    const fileId = randomUUID();
    const storageKey = await this.store.writeBlob(fileId, bytes);
    const filename = input.filename.replace(/\\/g, '/').split('/').pop() || 'file';
    const uploadedAt = Date.now();
    const storedMime = mime || (name.endsWith('.cdr') ? 'application/x-coreldraw' : mime);
    const row: OrderFileRecord = {
      id: fileId,
      tenantId: ctx.tenantId,
      orderId,
      customerId: ctx.userId,
      filename,
      storageKey,
      mimeType: storedMime,
      sizeBytes: bytes.length,
      status: 'PENDING',
      uploadedAt,
      conversionStatus: name.endsWith('.cdr') || storedMime.includes('corel') ? 'NOT_REQUIRED' : 'NOT_REQUIRED',
    };
    await this.store.saveOrderFile(row);
    const attachment: OrderAttachmentRef = {
      fileId,
      storageReference: storageKey,
      filename,
      mimeType: storedMime,
      size: bytes.length,
      createdAt: uploadedAt,
      version: 1,
      current: true,
    };
    await this.orders.appendAttachments(orderId, [attachment]);
    await this.store.saveFileMeta({
      ...attachment,
      tenantId: ctx.tenantId,
      customerId: ctx.userId,
      orderId,
      staged: false,
    });
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'artifact',
      entityId: fileId,
      eventType: 'ARTIFACT_UPLOADED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId, filename, size: bytes.length },
      correlationId: orderId,
    });
    let roster: RosterIntake | undefined;
    if (isSpreadsheetUpload(filename, storedMime)) {
      roster = await this.storeRosterInterpretation(ctx, orderId, fileId, filename, bytes);
    } else if (this.isDesignUpload(filename, storedMime)) {
      const formValues: Record<string, unknown> = { ...(order.formValues || {}), designFileId: fileId };
      const existing = formValues.designDistribution as { designKey?: string; designFileId?: string } | undefined;
      if (existing) {
        formValues.designDistribution = { ...existing, designFileId: fileId, designKey: fileId };
      }
      await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    }
    return { id: fileId, filename, mimeType: mime, sizeBytes: bytes.length, status: 'PENDING', storageKey, roster };
  }

  async submit(ctx: AuthContext, orderId: string) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const files = await this.store.listOrderFiles(ctx.tenantId, orderId);
    const okFiles = files.filter((f) => f.status === 'PENDING' || f.status === 'VALIDATED');
    if (!okFiles.length && !(order.attachments || []).length) throw new RequestInvalidError('FILES_REQUIRED');
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!this.economicOk(payment)) {
      throw new PaymentRequiredError('Para enviar el pedido necesitamos confirmar la condición de pago.');
    }
    this.assertProductionReady(order);
    const selected = selectedGarmentTypesOf(order.formValues);
    const outputs = selected.length
      ? await this.ensureIndustrialOutputs(order, { actorId: ctx.userId, roleId: ctx.roleId })
      : { files: [] as Array<{ id: string; filename: string; mimeType: string; format: string }> };
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'ORDER_SUBMITTED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId, status: order.status, outputCount: outputs.files.length },
      correlationId: orderId,
    });
    await this.startWorkshopPipelineAfterOutputs(orderId, ctx.tenantId);
    const submitted = (await this.orders.getOrder(orderId, 'admin')) || order;
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'ORDER_RECEIVED',
      title: 'Pedido listo para revisión',
      workshopMessage: `Pedido listo para revisión ${submitted.displayNumber || orderId}.`,
      entityType: 'order',
      entityId: orderId,
      order: submitted,
      dedupeKey: `${orderId}:READY_REVIEW`,
      includeWorkshop: true,
    });
    const view = await this.getOrder(ctx, orderId);
    return {
      ...view,
      orderId,
      status: view.status,
      outputs: outputs.files,
    };
  }

  async approve(ctx: AuthContext, orderId: string) {
    const view = await this.portal.approve(ctx, orderId, { decision: 'approved' });
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'ORDER_APPROVED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId },
      correlationId: orderId,
    });
    return view;
  }

  async requestChanges(ctx: AuthContext, orderId: string, message: string) {
    return this.portal.requestChanges(ctx, orderId, message);
  }

  async uploadVoucher(ctx: AuthContext, orderId: string, input: { filename: string; mimeType: string; contentBase64: string }) {
    await this.requireCustomer(ctx);
    await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (!bytes.length) throw new RequestInvalidError('EMPTY_FILE');
    const voucherId = randomUUID();
    const voucherKey = await this.store.writeBlob(voucherId, bytes);
    payment.voucherKey = voucherKey;
    await this.store.savePaymentRecord(payment);
    const order = await this.orders.getOrder(orderId, 'admin');
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'PAYMENT_VOUCHER_UPLOADED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId, filename: input.filename },
      correlationId: orderId,
    });
    if (order) {
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'ORDER_RECEIVED',
        title: 'Comprobante recibido',
        workshopMessage: `Comprobante recibido para pedido ${order.displayNumber || orderId}.`,
        entityType: 'order',
        entityId: orderId,
        order,
        dedupeKey: `${orderId}:VOUCHER:${voucherId}`,
        includeWorkshop: true,
      });
    }
    return { ok: true, voucherKey, ...(await this.getOrder(ctx, orderId)) };
  }

  async confirmPayment(
    ctx: AuthContext,
    orderId: string,
    amountPaid?: number,
    options?: { authorizeException?: boolean; exceptionNote?: string }
  ) {
    return serializeConfirmPayment(orderId, () => this.confirmPaymentLocked(ctx, orderId, amountPaid, options));
  }

  private async confirmPaymentLocked(
    ctx: AuthContext,
    orderId: string,
    amountPaid?: number,
    options?: { authorizeException?: boolean; exceptionNote?: string }
  ) {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment) throw new RequestInvalidError('PAYMENT_NOT_FOUND');
    if (options?.authorizeException) {
      const note = String(options.exceptionNote || '').trim();
      if (!note) throw new RequestInvalidError('EXCEPTION_NOTE_REQUIRED');
    }
    if (amountPaid != null) {
      const offered = Number(amountPaid);
      if (!Number.isFinite(offered) || offered < 0) throw new RequestInvalidError('INVALID_AMOUNT');
    }
    const agreed = agreedOrderAmount(order);
    const alreadyPaid = Number(payment.amountPaid || 0);
    if (paymentFullySettled(agreed, alreadyPaid) || payment.status === 'COMPLETED') {
      return payment;
    }
    let paid: number;
    if (amountPaid != null) {
      paid = Number(amountPaid);
    } else if (this.economicOk(payment)) {
      return payment;
    } else {
      paid = Number(payment.amountDue);
    }
    if (!Number.isFinite(paid) || paid < 0) throw new RequestInvalidError('INVALID_AMOUNT');
    const remainingSettle = Math.max(0, Math.round((agreed - alreadyPaid) * 100) / 100);
    if (paid > remainingSettle) paid = remainingSettle;
    if (paid <= 0 && !options?.authorizeException) return payment;
    payment.amountPaid = Number(payment.amountPaid || 0) + paid;
    if (options?.authorizeException) {
      payment.exceptionAuthorized = true;
      payment.exceptionBy = ctx.userId;
      payment.exceptionAt = Date.now();
      payment.exceptionNote = String(options.exceptionNote || '').trim();
      payment.exceptionCondition = {
        requiredPct: payment.requiredPct,
        amountDue: payment.amountDue,
        amountPaid: payment.amountPaid,
        authorizedBelowMinimum: payment.amountPaid + 0.009 < payment.amountDue,
      };
    }
    payment.status = paymentFullySettled(agreed, payment.amountPaid) ? 'COMPLETED' : 'PARTIAL';
    payment.confirmedAt = Date.now();
    payment.confirmedBy = ctx.userId;
    await this.store.savePaymentRecord(payment);
    const customer = await this.store.getCustomer(order.customerId);
    if (customer?.isTrust) {
      customer.currentDebt = Math.max(0, Number(customer.currentDebt || 0) - paid);
      customer.updatedAt = Date.now();
      await this.store.saveCustomer(customer);
    }
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'PAYMENT_CONFIRMED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: {
        orderId,
        amountPaid: paid,
        status: payment.status,
        exceptionAuthorized: !!payment.exceptionAuthorized,
        exceptionBy: payment.exceptionBy,
      },
      correlationId: orderId,
    });
    let production: { files: Array<{ id: string; filename: string; mimeType: string; format: string }> } = { files: [] };
    if (this.economicOk(payment)) {
      await this.freezeOnAccreditedDeposit(ctx, orderId, payment);
      const fresh = (await this.orders.getOrder(orderId, 'admin')) || order;
      production = await this.triggerProductionAfterPayment(ctx, fresh);
    }
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'ORDER_PRODUCTION_STARTED',
      title: 'Pago confirmado',
      customerMessage: t('notifications.payment_confirmed', ctx.lang, { orderNumber: order.displayNumber || orderId }),
      workshopMessage: t('notifications.payment_confirmed', 'es', { orderNumber: order.displayNumber || orderId }),
      entityType: 'order',
      entityId: orderId,
      order,
      dedupeKey: `${orderId}:PAYMENT_CONFIRMED`,
      includeCustomer: true,
      includeWorkshop: true,
    });
    return {
      ...payment,
      orderId,
      status: ((await this.orders.getOrder(orderId, 'admin')) || order).status,
      outputs: production.files,
    };
  }

  async addTrustCode(ctx: AuthContext, input: { code: string; creditLimit: number }) {
    const config = await this.requireConfig(ctx.tenantId);
    const code = input.code.trim();
    if (!code) throw new RequestInvalidError('TRUST_CODE');
    config.trustCodes = [...(config.trustCodes || []).filter((c) => c.code !== code), { code, creditLimit: Number(input.creditLimit) }];
    config.updatedAt = Date.now();
    await this.store.saveConfig(config);
    return { ok: true, code, creditLimit: Number(input.creditLimit) };
  }

  async getCredit(ctx: AuthContext, customerId: string) {
    const customer = await this.store.getCustomer(customerId);
    if (!customer || customer.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const creditLimit = Number(customer.creditLimit || 0);
    const currentDebt = Number(customer.currentDebt || 0);
    return {
      customerId,
      creditLimit,
      currentDebt,
      available: creditLimit - currentDebt,
      isTrust: !!customer.isTrust,
    };
  }

  async putCredit(ctx: AuthContext, customerId: string, input: { creditLimit?: number; paymentAmount?: number }) {
    const customer = await this.store.getCustomer(customerId);
    if (!customer || customer.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (input.creditLimit != null) customer.creditLimit = Number(input.creditLimit);
    if (input.paymentAmount) {
      customer.currentDebt = Math.max(0, Number(customer.currentDebt || 0) - Number(input.paymentAmount));
    }
    customer.updatedAt = Date.now();
    await this.store.saveCustomer(customer);
    return this.getCredit(ctx, customerId);
  }

  private economicOk(payment: PaymentRecord | undefined): boolean {
    return paymentMeetsRequired(payment);
  }

  private async createFromWorkshop(
    ctx: AuthContext,
    input: {
      workshopItemId?: string;
      quantity: number;
      projectName?: string;
      formData?: Record<string, unknown>;
      notes?: string;
      fulfillment?: Record<string, unknown>;
    }
  ) {
    const profile = await this.requireCustomer(ctx);
    await new MembershipService(this.store, this.orders).assertCanCreateOrder(ctx, profile.customerId);
    const config = await this.requireConfig(ctx.tenantId);
    const limits = { ...DEFAULT_TENANT_LIMITS, ...(config.limits || {}) };
    const quantity = Number(input.quantity);
    const item = await new WorkshopCatalogService(this.store).requireEnabledLine(
      ctx.tenantId,
      String(input.workshopItemId || ''),
      quantity
    );
    const projectName = assertHumanProjectName(String(input.projectName || ''), true);
    const lines = await this.syncWorkshopLine(ctx, item, quantity);
    const quote = await this.admin.quoteCatalog(ctx, lines);
    const total = Number(quote.totals.customer || 0);
    const consumptionQty = Number(quote.lines[0]?.consumption || quantity);
    // maxUnitsPerOrder aplica solo al alta inicial. El plantel aprobado es la fuente de verdad (reviewRoster).
    if (quantity > limits.maxUnitsPerOrder) throw new RequestInvalidError('LIMIT_UNITS_EXCEEDED');
    if (consumptionQty > limits.maxMetersPerOrder) throw new RequestInvalidError('LIMIT_METERS_EXCEEDED');
    if (profile.isTrust) {
      const limit = Number(profile.creditLimit || 0);
      const debt = Number(profile.currentDebt || 0);
      if (debt + total > limit) throw new PaymentRequiredError(t('errors.credit_limit_reached', ctx.lang));
    }
    const fulfillment = parseOrderFulfillment(
      input.fulfillment || {},
      normalizeClientOptions(config.clientOptions),
      { customerId: profile.customerId, name: profile.name, userId: ctx.userId }
    );
    const snapshot = {
      itemId: item.itemId,
      category: item.category,
      name: item.name,
      description: item.description,
      price: item.price,
      currency: item.currency,
      unit: item.unit,
      quantity,
    };
    const clientForm: Record<string, unknown> = { ...(input.formData || {}) };
    delete clientForm.rosterIntake;
    delete clientForm.rosterProduction;
    delete clientForm.economicSnapshot;
    delete clientForm.workshopItemId;
    delete clientForm.workshopLines;
    delete clientForm.garmentConfig;
    delete clientForm.tpuConfig;
    delete clientForm.laserConfig;
    delete clientForm.sizeTableSnapshot;
    delete clientForm.selectedGarmentTypes;
    delete clientForm.designDistribution;
    delete clientForm.designFileId;
    delete clientForm.quantity;
    const order = await this.orders.createOrder({
      tenantId: ctx.tenantId,
      customerId: profile.customerId,
      customerName: profile.name,
      projectName,
      summary: projectName,
      dueAt: Date.now() + DEFAULT_SLA_MS,
      actor: { actorId: ctx.userId, role: 'customer' },
      initialStatus: 'received',
      fulfillment,
      formValues: {
        ...clientForm,
        workshopItemId: item.itemId,
        workshopLines: [snapshot],
        quantity,
        notes: input.notes,
        projectName,
        materialName: item.name,
      },
      visibility: { ...DEFAULT_CUSTOMER_VISIBILITY },
      configurationSnapshot: {
        schemaId: 'workshop-catalog',
        schemaVersion: 1,
        disciplineId: categoryToDiscipline(item.category),
        capturedAt: Date.now(),
        fields: [],
        materials: [{ materialId: workshopMaterialId(item.itemId), name: item.name, unitPrice: item.price }],
      },
    });
    const priced = await this.admin.confirmCatalogOrder(ctx, order.orderId, lines);
    return this.afterCreate(ctx, profile, priced, config, limits);
  }

  private async syncWorkshopLine(ctx: AuthContext, item: WorkshopCatalogItem, quantity: number) {
    const config = await this.requireConfig(ctx.tenantId);
    const currency = String(config.currency || config.commercial?.defaultCurrency || item.currency || 'ARS');
    const materialId = workshopMaterialId(item.itemId);
    const unitId = resolveUnitId(item.unit);
    await this.admin.catalog.upsertMaterial(
      ctx.tenantId,
      {
        materialId,
        tenantId: ctx.tenantId,
        name: item.name,
        displayName: item.name,
        description: item.description,
        unit: item.unit,
        unitId,
        internalUnitCost: 0,
        customerUnitPrice: item.price,
        disciplineId: categoryToDiscipline(item.category),
        active: true,
        available: true,
        visibleToClient: true,
        currency,
        costType: workshopCostType(item.unit),
        consumptionRule: { kind: 'PER_UNIT', rate: 1 },
        customerVisibility: { price: true, consumption: true, subtotal: true, total: true },
      },
      currency
    );
    return [{ materialId, requestedQuantity: quantity }];
  }

  private async afterCreate(
    ctx: AuthContext,
    profile: CustomerProfile,
    priced: PersistedOrder,
    config: TenantConfig,
    limits: { requiredPaymentPct?: number }
  ) {
    try {
      await this.workflows.ensureInstance(ctx, priced.orderId);
    } catch {
      /* workflow bootstrap deferred */
    }
    const requiredPct = Number(config.requiredPaymentPct ?? limits.requiredPaymentPct ?? 50);
    const payment = await this.createPayment(profile, priced, requiredPct);
    if (profile.isTrust && payment.status === 'WAIVED') {
      profile.currentDebt = Number(profile.currentDebt || 0) + priced.totalCustomerAmount;
      profile.updatedAt = Date.now();
      await this.store.saveCustomer(profile);
      await this.freezeOnAccreditedDeposit(
        { ...ctx, userId: ctx.userId },
        priced.orderId,
        payment
      );
    }
    const projectName = priced.projectName || String(priced.formValues?.projectName || '');
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'ORDER_RECEIVED',
      title: 'Nuevo pedido recibido',
      workshopMessage: t('notifications.new_order_admin', 'es', {
        orderNumber: priced.displayNumber || priced.orderId,
        customerName: profile.name,
        projectName,
      }),
      entityType: 'order',
      entityId: priced.orderId,
      order: priced,
      dedupeKey: `${priced.orderId}:ADMIN_NEW_ORDER`,
      includeWorkshop: true,
    });
    const fresh = (await this.orders.getOrder(priced.orderId, 'admin')) || priced;
    return {
      ...this.listItem(fresh, ctx.lang),
      consumption: (fresh.consumptions || []).map((c) => ({
        name: c.name,
        quantity: c.quantity,
        unit: c.unit,
        unitPrice: c.customerUnitPrice,
        amount: c.calculatedCustomerAmount,
      })),
      total: fresh.totalCustomerAmount,
      payment: {
        requiredPct: payment.requiredPct,
        amountDue: payment.amountDue,
        amountPaid: payment.amountPaid,
        remaining: nextPaymentRemaining({
          amountDue: Number(payment.amountDue || 0),
          amountPaid: Number(payment.amountPaid || 0),
          agreed: agreedOrderAmount(fresh),
        }),
        remainingBalance: Math.max(0, Math.round((agreedOrderAmount(fresh) - Number(payment.amountPaid || 0)) * 100) / 100),
        settled: paymentFullySettled(agreedOrderAmount(fresh), Number(payment.amountPaid || 0)),
        status: payment.status,
        checkoutOpen:
          !['cancelled', 'expired'].includes(fresh.status) &&
          !paymentFullySettled(agreedOrderAmount(fresh), Number(payment.amountPaid || 0)),
      },
      commercialTerms: this.presentCommercialTerms(fresh, payment),
    };
  }

  private async createPayment(profile: CustomerProfile, order: PersistedOrder, requiredPct: number): Promise<PaymentRecord> {
    const pct = requiredPct === 100 ? 100 : 50;
    const amountDue = Math.round(order.totalCustomerAmount * (pct / 100) * 100) / 100;
    const row: PaymentRecord = {
      id: randomUUID(),
      tenantId: order.tenantId,
      orderId: order.orderId,
      customerId: profile.customerId,
      requiredPct: pct,
      amountDue,
      amountPaid: 0,
      status: profile.isTrust ? 'WAIVED' : 'PENDING',
      gateway: 'MANUAL',
    };
    await this.store.savePaymentRecord(row);
    return row;
  }

  private creditAvailable(profile: CustomerProfile): number {
    return Number(profile.creditLimit || 0) - Number(profile.currentDebt || 0);
  }

  private listItem(order: PersistedOrder, lang?: string) {
    const key = workflowStatusKey(order.status);
    const langCode = lang || 'es';
    const flow = presentCustomerOrderStatus(order);
    const projectName = order.projectName || String(order.formValues?.projectName || '');
    return {
      id: order.orderId,
      orderId: order.orderId,
      number: order.displayNumber || order.orderId,
      projectName,
      product: String(order.formValues?.productId || order.formValues?.materialName || order.summary || ''),
      status: order.status,
      operationalStatus: toOperationalStatus(order.status),
      statusLabel: t(`workflow.steps.${key}`, langCode),
      flowStatus: flow.key,
      flowStatusLabel: flow.label,
      date: order.createdAt,
      createdAt: order.createdAt,
      dueAt: order.dueAt,
      total: order.totalCustomerAmount,
      priceFrozen: !!order.economicSnapshot?.frozen,
      priceValidUntil: order.economicSnapshot?.validUntil || order.dueAt,
      priceValidUntilLabel: formatCommercialDate(order.economicSnapshot?.validUntil || order.dueAt),
      previewApproved: !!order.formValues?.previewApproved,
      rawMaterialRequested: !!order.formValues?.rawMaterialRequested,
      ...fulfillmentView(order, langCode),
    };
  }

  async configureOrder(ctx: AuthContext, orderId: string, body: Record<string, unknown>) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    if (CLOSED.has(order.status) || order.status === 'printing' || order.status === 'printing_in_progress' || order.status === 'production') {
      throw new RequestInvalidError('ORDER_CLOSED');
    }
    const productiveLocked = !!order.economicSnapshot?.frozen || READY.has(order.status);
    if (
      productiveLocked &&
      (body.tpu != null ||
        body.laser != null ||
        body.garmentType != null ||
        body.garmentTypes != null ||
        body.sizeTableId != null ||
        body.sizeTables != null ||
        body.familyStyles != null ||
        body.items != null)
    ) {
      throw new RequestInvalidError('PRICE_FROZEN');
    }
    if (body.garmentConfig != null || body.items != null || body.rosterProduction != null) {
      throw new RequestInvalidError('ROSTER_INTAKE_REQUIRED');
    }
    const catalog = new WorkshopCatalogService(this.store);
    const formValues: Record<string, unknown> = { ...(order.formValues || {}) };
    if (body.garmentType != null || body.garmentTypes != null) {
      const raw = body.garmentTypes != null
        ? (Array.isArray(body.garmentTypes) ? body.garmentTypes : [body.garmentTypes])
        : [body.garmentType];
      const types = [...new Set(raw.map((v) => parseGarmentType(String(v))).filter((v): v is NonNullable<typeof v> => !!v))];
      if (!types.length) throw new RequestInvalidError('INVALID_GARMENT_TYPE');
      formValues.selectedGarmentTypes = types;
      formValues.garmentType = types.length === 1 ? types[0] : types[0];
    }
    if (body.sizeTableId != null) {
      const table = await catalog.getSizeTable(ctx, String(body.sizeTableId));
      const garmentType = parseGarmentType(String(formValues.garmentType || table.garmentType));
      if (!garmentType || table.garmentType !== garmentType) throw new RequestInvalidError('SIZE_TABLE_GARMENT_MISMATCH');
      formValues.sizeTableId = table.id;
      formValues.sizeTableSnapshot = snapshotSizeTable(table);
      formValues.garmentFamilies = this.mergeFamily(formValues.garmentFamilies, {
        garmentType,
        sizeTableId: table.id,
        sizeTableSnapshot: formValues.sizeTableSnapshot as never,
        moldeId: moldeIdForFamily(garmentType),
        style: defaultFamilyStyle(garmentType),
      });
    }
    if (body.sizeTables != null) {
      const rows = Array.isArray(body.sizeTables) ? body.sizeTables : [];
      if (!rows.length) throw new RequestInvalidError('SIZE_TABLE_REQUIRED');
      const families: GarmentFamilyConfig[] = [];
      for (const row of rows) {
        const r = (row || {}) as Record<string, unknown>;
        const garmentType = parseGarmentType(String(r.garmentType || ''));
        if (!garmentType) throw new RequestInvalidError('INVALID_GARMENT_TYPE');
        const table = await catalog.getSizeTable(ctx, String(r.sizeTableId || ''));
        if (table.garmentType !== garmentType) throw new RequestInvalidError('SIZE_TABLE_GARMENT_MISMATCH');
        const previous = this.familiesFromForm(formValues).find((f) => f.garmentType === garmentType);
        families.push({
          garmentType,
          sizeTableId: table.id,
          sizeTableSnapshot: snapshotSizeTable(table),
          moldeId: previous?.moldeId || moldeIdForFamily(garmentType),
          style: previous?.style || defaultFamilyStyle(garmentType),
        });
      }
      formValues.garmentFamilies = families;
      const selected = selectedGarmentTypesOf(formValues);
      const missing = selected.filter((t) => !families.some((f) => f.garmentType === t));
      if (selected.length && missing.length) throw new RequestInvalidError('SIZE_TABLE_REQUIRED');
      if (families.length === 1) {
        formValues.sizeTableId = families[0].sizeTableId;
        formValues.sizeTableSnapshot = families[0].sizeTableSnapshot;
        formValues.garmentType = families[0].garmentType;
      }
    }
    if (body.familyStyles != null) {
      const rows = Array.isArray(body.familyStyles) ? body.familyStyles : [];
      const selected = selectedGarmentTypesOf(formValues);
      const current = this.familiesFromForm(formValues);
      if (!current.length) throw new RequestInvalidError('SIZE_TABLE_REQUIRED');
      for (const row of rows) {
        const r = (row || {}) as Record<string, unknown>;
        const garmentType = parseGarmentType(String(r.garmentType || ''));
        if (!garmentType) throw new RequestInvalidError('INVALID_GARMENT_TYPE');
        if (selected.length && !selected.includes(garmentType)) throw new RequestInvalidError('GARMENT_NOT_SELECTED');
        const family = current.find((f) => f.garmentType === garmentType);
        if (!family) throw new RequestInvalidError('GARMENT_NOT_SELECTED');
        family.style = assertFamilyStyle(garmentType, r);
        family.moldeId = moldeIdForFamily(garmentType);
      }
      formValues.garmentFamilies = current;
    }
    if (body.tpu != null) {
      const tpuBody = (body.tpu || {}) as Record<string, unknown>;
      const tpuAdmin = await catalog.getTpuConfig(ctx);
      if (tpuAdmin.enabled === false) throw new RequestInvalidError('TPU_DISABLED');
      const dims = assertTpuDimensions(tpuBody.width_mm, tpuBody.height_mm, tpuAdmin);
      formValues.tpuConfig = { ...dims } satisfies TPUOrderConfig;
    }
    if (body.laser != null) {
      const laserBody = (body.laser || {}) as Record<string, unknown>;
      const enabled = !!laserBody.enabled;
      const confirmed = !!laserBody.confirmed;
      if (enabled && !confirmed) throw new RequestInvalidError('LASER_CONFIRM_REQUIRED');
      const tpuAdmin = await catalog.getTpuConfig(ctx);
      const laser: LaserOrderConfig = {
        enabled,
        confirmed: enabled ? confirmed : false,
        notes: laserBody.notes != null ? String(laserBody.notes) : undefined,
        unitPrice: enabled ? tpuAdmin.laserUnitPrice : 0,
      };
      formValues.laserConfig = laser;
    }
    if (
      formValues.previewApproved &&
      (body.garmentType != null ||
        body.garmentTypes != null ||
        body.sizeTableId != null ||
        body.sizeTables != null ||
        body.familyStyles != null ||
        body.tpu != null ||
        body.laser != null)
    ) {
      formValues.previewApproved = false;
      delete formValues.preview3dDecision;
    }
    await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'CONFIGURATION_CHANGED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: {
        orderId,
        keys: Object.keys(body).filter((k) => body[k] != null).join(','),
      },
      correlationId: orderId,
    });
    if (body.laser != null) {
      const fresh = await this.orders.getOrder(orderId, 'admin');
      if (fresh) {
        const priced = await this.requoteCatalog(ctx, fresh);
        await this.syncPendingPayment(orderId, priced.totalCustomerAmount);
      }
    }
    return this.getOrder(ctx, orderId);
  }

  async decidePreview3D(
    ctx: AuthContext,
    orderId: string,
    body: { status?: string; decision?: string; note?: string }
  ) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    if (CLOSED.has(order.status) || order.status === 'printing' || order.status === 'printing_in_progress' || order.status === 'production') {
      throw new RequestInvalidError('ORDER_CLOSED');
    }
    const raw = String(body.status || body.decision || '').toUpperCase();
    const status: Preview3DDecision['status'] =
      raw === 'RAW' || raw === 'RAW_MATERIAL' ? 'RAW' : raw === 'REJECTED' || raw === 'REJECT' ? 'REJECTED' : raw === 'APPROVED' || raw === 'APPROVE' ? 'APPROVED' : ('' as Preview3DDecision['status']);
    if (!status) throw new RequestInvalidError('INVALID_PREVIEW_DECISION');
    const now = Date.now();
    const decision: Preview3DDecision = {
      status,
      at: now,
      actorId: ctx.userId,
      note: body.note ? String(body.note) : undefined,
    };
    const formValues: Record<string, unknown> = {
      ...(order.formValues || {}),
      preview3dDecision: decision,
      previewApproved: status === 'APPROVED',
      rawMaterialRequested: status === 'RAW',
    };
    await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    await this.orders.recordApproval(
      orderId,
      {
        actorId: ctx.userId,
        at: now,
        decision: status === 'REJECTED' ? 'rejected' : 'approved',
        note: `preview3d:${status}${decision.note ? `:${decision.note}` : ''}`,
      },
      status === 'REJECTED' ? 'rejected' : status === 'APPROVED' ? 'approved' : 'not_required'
    );
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: status === 'REJECTED' ? 'APPROVAL_REJECTED' : 'APPROVAL_APPROVED',
      actorType: 'CUSTOMER',
      actorId: ctx.userId,
      metadata: { orderId, preview3d: status, note: decision.note || '' },
      correlationId: orderId,
    });
    if (status === 'APPROVED') {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'order',
        entityId: orderId,
        eventType: 'PRODUCTION_APPROVED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { orderId, preview3d: status },
        correlationId: orderId,
      });
    }
    return this.getOrder(ctx, orderId);
  }

  async reviewRoster(
    ctx: AuthContext,
    orderId: string,
    body: { records?: RosterRecord[]; approve?: boolean; reject?: boolean }
  ) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const intake = (order.formValues?.rosterIntake || null) as RosterIntake | null;
    if (!intake) throw new RequestInvalidError('ROSTER_NOT_FOUND');
    if (intake.status === 'APPROVED' && body.approve) {
      return this.getOrder(ctx, orderId);
    }
    const next: RosterIntake = { ...intake };
    if (body.records) next.humanEdits = { records: body.records };
    if (body.reject) {
      next.status = 'REJECTED';
      next.rejectedAt = Date.now();
      next.rejectedBy = ctx.userId;
      const formValues: Record<string, unknown> = { ...(order.formValues || {}), rosterIntake: next };
      delete formValues.rosterProduction;
      await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
      return this.getOrder(ctx, orderId);
    }
    if (body.records && !body.approve && next.status !== 'APPROVED') {
      next.status = 'CORRECTED';
    }
    const formValues: Record<string, unknown> = { ...(order.formValues || {}), rosterIntake: next };
    delete formValues.rosterProduction;
    let distributed = false;
    if (body.approve) {
      const records = approvedRosterRecords(next);
      const families = this.familiesFromForm(formValues);
      if (!families.length) {
        const snapshot = formValues.sizeTableSnapshot as GarmentConfig['sizeTableSnapshot'] | undefined;
        const garmentType = parseGarmentType(String(formValues.garmentType || ''));
        if (snapshot) {
          for (const rec of records) {
            if (rec.size && !findSizeLabel(snapshot, rec.size)) throw new RequestInvalidError('SIZE_NOT_FOUND');
          }
        }
        const linked = records.map((rec) => ({
          ...rec,
          sizeLabel: rec.size,
          sizeTableId: snapshot?.id,
          garmentType,
          quantity: Number(rec.quantity || 1) || 1,
        }));
        next.status = 'APPROVED';
        next.approvedAt = Date.now();
        next.approvedBy = ctx.userId;
        next.humanApprovedAt = next.approvedAt;
        formValues.rosterIntake = next;
        formValues.rosterProduction = {
          records: linked,
          approvedAt: next.approvedAt,
          approvedBy: next.approvedBy,
        };
        if (garmentType && snapshot) {
          formValues.garmentConfig = {
            garmentType,
            sizeTableId: snapshot.id,
            sizeTableSnapshot: snapshot,
            selectedGarmentTypes: [garmentType],
            families: [{ garmentType, sizeTableId: snapshot.id, sizeTableSnapshot: snapshot }],
            items: linked.map((rec) => ({
              name: rec.name,
              number: rec.number || undefined,
              sizeLabel: rec.size,
              quantity: rec.quantity || 1,
              garmentType,
              sizeTableId: snapshot.id,
            })),
          } satisfies GarmentConfig;
        }
      } else {
      distributed = true;
      const selected = selectedGarmentTypesOf(formValues);
      const designFileId = String(formValues.designFileId || '');
      const distribution = distributeDesign({
        records,
        families,
        selectedGarmentTypes: selected,
        designKey: designFileId || orderId,
        designFileId: designFileId || undefined,
      });
      const usable = records.filter((r) => String(r.name || '').trim() || String(r.size || r.sizeLabel || '').trim());
      assertDistributionIntegrity(distribution, usable.length);
      const linked = distribution.records.map((unit) => {
        const src = records[unit.recordIndex] || usable[unit.recordIndex];
        return {
          ...(src || {}),
          name: unit.name,
          number: unit.number,
          size: unit.sizeLabel,
          sizeLabel: unit.sizeLabel,
          sizeTableId: unit.sizeTableId,
          garmentType: unit.garmentType,
          quantity: unit.quantity,
          extras: src?.extras || {},
          raw: src?.raw || [],
        };
      });
      next.status = 'APPROVED';
      next.approvedAt = Date.now();
      next.approvedBy = ctx.userId;
      next.humanApprovedAt = next.approvedAt;
      formValues.rosterIntake = next;
      formValues.rosterProduction = {
        records: linked,
        approvedAt: next.approvedAt,
        approvedBy: next.approvedBy,
      };
      formValues.designDistribution = distribution;
      formValues.productionRevision = this.nextProductionRevision(order, ctx.userId, distribution.totalUnits);
      // El total del plantel aprobado sustituye la cantidad de alta. No se revalida maxUnitsPerOrder.
      formValues.quantity = distribution.totalUnits;
      const primary = distribution.families[0];
      const items: GarmentConfigItem[] = distribution.records.map((unit) => ({
        name: unit.name,
        number: unit.number || undefined,
        sizeLabel: unit.sizeLabel,
        quantity: unit.quantity,
        garmentType: unit.garmentType,
        sizeTableId: unit.sizeTableId,
      }));
      formValues.garmentConfig = {
        garmentType: primary?.garmentType || selected[0],
        sizeTableId: primary?.sizeTableId,
        sizeTableSnapshot: primary?.sizeTableSnapshot,
        selectedGarmentTypes: distribution.selectedGarmentTypes,
        families: distribution.families.map((f) => ({
          garmentType: f.garmentType,
          sizeTableId: f.sizeTableId,
          sizeTableSnapshot: f.sizeTableSnapshot,
        })),
        items,
      } satisfies GarmentConfig;
      }
    }
    await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    if (distributed && !order.economicSnapshot?.frozen) {
      const fresh = await this.orders.getOrder(orderId, 'admin');
      if (fresh) {
        const priced = await this.requoteCatalog(ctx, fresh);
        await this.syncPendingPayment(orderId, priced.totalCustomerAmount);
      }
    }
    if (body.approve) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'order',
        entityId: orderId,
        eventType: 'ROSTER_APPROVED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { orderId, units: Number(formValues.quantity || 0) },
        correlationId: orderId,
      });
    }
    return this.getOrder(ctx, orderId);
  }

  async decidePrice(
    ctx: AuthContext,
    orderId: string,
    body: { decision: 'KEEP' | 'UPDATE'; note?: string }
  ) {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const prices = await this.currentMaterialPrices(order);
    const evaluation = evaluatePriceDecision(order, Date.now(), prices);
    if (!evaluation.required) throw new RequestInvalidError('PRICE_DECISION_NOT_REQUIRED');
    const snap = order.economicSnapshot;
    if (!snap?.frozen) throw new RequestInvalidError('PRICE_NOT_FROZEN');
    const now = Date.now();
    const decision = body.decision === 'UPDATE' ? 'UPDATE' : 'KEEP';
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    const settled = paymentFullySettled(agreedOrderAmount(order), Number(payment?.amountPaid || 0));
    if (decision === 'UPDATE' && settled) throw new RequestInvalidError('PRICE_FULLY_PAID');
    const original = snap.original || {
      agreedAmount: snap.agreedAmount ?? snap.totals.customer,
      lines: snap.lines || linesFromOrder(order),
      frozenAt: snap.frozenAt || now,
      catalogRevision: snap.catalogRevision,
    };
    if (decision === 'KEEP') {
      const next: CommercialEconomicSnapshot = {
        ...snap,
        original,
        history: [
          ...(snap.history || []),
          {
            at: now,
            actorId: ctx.userId,
            decision: 'KEEP',
            previousAmount: snap.agreedAmount ?? snap.totals.customer,
            newAmount: snap.agreedAmount ?? snap.totals.customer,
            reason: body.note?.trim() || 'admin_keep_agreed_price',
            rule: 'PLAZO_RETIRO_VENCIDO',
          },
        ],
        priceDecision: { status: 'KEEP', askedAt: now, decidedAt: now, decidedBy: ctx.userId },
      };
      await this.orders.setEconomicSnapshot(orderId, next);
    } else {
      const priced = await this.requoteCatalog(ctx, order, { allowFrozenReplace: true });
      const agreed = priced.totalCustomerAmount;
      const lines = linesFromOrder(priced);
      const config = await this.requireConfig(ctx.tenantId);
      const next: CommercialEconomicSnapshot = {
        currency: priced.economicSnapshot?.currency || snap.currency || 'ARS',
        capturedAt: now,
        totals: priced.economicSnapshot?.totals || { internal: priced.totalInternalCost, customer: agreed },
        frozen: true,
        frozenAt: snap.frozenAt,
        validUntil: snap.validUntil || priced.dueAt,
        depositAmount: snap.depositAmount ?? Number(payment?.amountPaid || 0),
        remainingAmount: Math.max(0, agreed - Number(payment?.amountPaid || 0)),
        agreedAmount: agreed,
        catalogRevision: config.updatedAt,
        lines,
        original,
        history: [
          ...(snap.history || []),
          {
            at: now,
            actorId: ctx.userId,
            decision: 'UPDATE',
            previousAmount: original.agreedAmount,
            newAmount: agreed,
            reason: body.note?.trim() || 'admin_update_after_deadline',
            rule: 'PLAZO_RETIRO_VENCIDO',
          },
        ],
        priceDecision: { status: 'UPDATED', askedAt: now, decidedAt: now, decidedBy: ctx.userId },
      };
      await this.orders.setEconomicSnapshot(orderId, next);
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'ORDER_STATUS_CHANGED',
        title: 'Precio actualizado',
        customerMessage: `El importe acordado de su pedido ${order.displayNumber || orderId} se actualizó a ${agreed}.`,
        workshopMessage: `Precio actualizado en pedido ${order.displayNumber || orderId}.`,
        entityType: 'order',
        entityId: orderId,
        order: priced,
        dedupeKey: `${orderId}:PRICE_UPDATED:${now}`,
        includeCustomer: true,
        includeWorkshop: true,
      });
    }
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'order',
      entityId: orderId,
      eventType: 'PAYMENT_CONFIRMED',
      actorType: 'ADMIN_PRINCIPAL',
      actorId: ctx.userId,
      metadata: { orderId, priceDecision: decision, note: body.note || '' },
      correlationId: orderId,
    });
    return this.priceDecisionPayload(ctx, orderId);
  }

  async priceDecisionPayload(ctx: AuthContext, orderId: string) {
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    const prices = await this.currentMaterialPrices(order);
    const evaluation = evaluatePriceDecision(order, Date.now(), prices);
    const fullyPaid = paymentFullySettled(agreedOrderAmount(order), Number(payment?.amountPaid || 0));
    const prompt = evaluation.required && !fullyPaid;
    return {
      orderId,
      customerName: order.customerName,
      projectName: order.projectName,
      total: order.totalCustomerAmount,
      commercialTerms: this.presentCommercialTerms(order, payment),
      priceDecisionRequired: prompt,
      priceDecisionPrompt: prompt
        ? `El trabajo de ${order.customerName} terminó correctamente. El plazo de retiro acordado ha vencido. El precio del material utilizado se ha incrementado.`
        : null,
      evaluation,
      fullyPaid,
    };
  }

  private presentCommercialTerms(order: PersistedOrder, payment?: PaymentRecord | null) {
    const snap = order.economicSnapshot;
    const agreed = snap?.agreedAmount ?? order.totalCustomerAmount;
    const paid = Number(payment?.amountPaid || 0);
    const validUntil = order.dueAt;
    return {
      frozen: !!snap?.frozen,
      frozenAt: snap?.frozenAt || null,
      validUntil,
      validUntilLabel: formatCommercialDate(validUntil),
      agreedAmount: agreed,
      depositAmount: snap?.depositAmount ?? paid,
      remainingAmount: snap?.remainingAmount ?? Math.max(0, agreed - paid),
      catalogRevision: snap?.catalogRevision || null,
      lines: snap?.lines || linesFromOrder(order),
      original: snap?.original || null,
      history: snap?.history || [],
      priceDecision: snap?.priceDecision || { status: 'NONE' },
    };
  }

  private presentConfiguration(order: PersistedOrder) {
    const fv = order.formValues || {};
    return {
      garmentType: fv.garmentType || null,
      garmentTypes: selectedGarmentTypesOf(fv),
      sizeTableId: fv.sizeTableId || null,
      sizeTableSnapshot: fv.sizeTableSnapshot || null,
      families: fv.garmentFamilies || (fv.garmentConfig as GarmentConfig | undefined)?.families || null,
      tpuConfig: fv.tpuConfig || null,
      laserConfig: fv.laserConfig || null,
      garmentConfig: fv.garmentConfig || null,
      designFileId: fv.designFileId || null,
      distribution: fv.designDistribution || null,
      preview3d: (fv.preview3dDecision as Preview3DDecision | undefined) || null,
      productionRevision: fv.productionRevision || null,
      productionOutputs: fv.productionOutputs || null,
      styleOptions: familyStyleOptions(),
    };
  }

  private viewerFromOrder(order: PersistedOrder) {
    const fv = order.formValues || {};
    const gc = fv.garmentConfig as GarmentConfig | undefined;
    const tpu = fv.tpuConfig as TPUOrderConfig | undefined;
    const production = productionRosterOf(fv) as { records?: Array<{ sizeLabel?: string; size?: string }> } | undefined;
    const first = gc?.items?.[0];
    const rosterFirst = production?.records?.[0];
    const families = this.familiesFromForm(fv);
    const family =
      families.find((f) => f.garmentType === (first?.garmentType || gc?.garmentType || fv.garmentType)) || families[0];
    const style = family?.style;
    return orderToViewerParams({
      garmentType: String(first?.garmentType || family?.garmentType || gc?.garmentType || fv.garmentType || ''),
      sizeLabel: String(first?.sizeLabel || rosterFirst?.sizeLabel || rosterFirst?.size || fv.sizeLabel || ''),
      materialName: String(fv.materialName || ''),
      designUrl: fv.designFileId ? String(fv.designFileId) : undefined,
      tpu,
      collarId: style?.collarId,
      sleeveId: style?.sleeveId,
      fabricId: style?.fabricId,
      colors: style?.colors,
    });
  }

  private familiesFromForm(formValues: Record<string, unknown>): GarmentFamilyConfig[] {
    const stored = formValues.garmentFamilies;
    if (Array.isArray(stored) && stored.length) return stored as GarmentFamilyConfig[];
    const gc = formValues.garmentConfig as GarmentConfig | undefined;
    if (gc?.families?.length) return gc.families;
    const snapshot = formValues.sizeTableSnapshot as GarmentConfig['sizeTableSnapshot'] | undefined;
    const garmentType = parseGarmentType(String(formValues.garmentType || snapshot?.garmentType || ''));
    if (snapshot && garmentType) {
      return [{ garmentType, sizeTableId: String(formValues.sizeTableId || snapshot.id), sizeTableSnapshot: snapshot }];
    }
    return [];
  }

  private mergeFamily(current: unknown, next: GarmentFamilyConfig): GarmentFamilyConfig[] {
    const list = Array.isArray(current) ? [...(current as GarmentFamilyConfig[])] : [];
    const idx = list.findIndex((f) => f.garmentType === next.garmentType);
    if (idx >= 0) list[idx] = { ...list[idx], ...next, style: next.style || list[idx].style };
    else list.push({ ...next, style: next.style || defaultFamilyStyle(next.garmentType) });
    return list;
  }

  private isDesignUpload(filename: string, mimeType: string): boolean {
    const name = filename.toLowerCase();
    const mime = mimeType.toLowerCase();
    return (
      mime.startsWith('image/') ||
      mime.includes('svg') ||
      mime.includes('postscript') ||
      mime.includes('pdf') ||
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.svg') ||
      name.endsWith('.ai') ||
      name.endsWith('.eps') ||
      name.endsWith('.pdf')
    );
  }

  private presentRoster(order: PersistedOrder) {
    const intake = (order.formValues?.rosterIntake || null) as RosterIntake | null;
    const production = productionRosterOf(order.formValues);
    return {
      intake,
      production: production || null,
      pendingApproval: !!intake && intake.status !== 'APPROVED',
      understood: intake
        ? {
            columns: intake.interpretation.columns,
            unknownColumns: intake.interpretation.unknownColumns || [],
            records: intake.humanEdits?.records || intake.interpretation.records,
            status: intake.status,
          }
        : null,
    };
  }

  private async storeRosterInterpretation(
    ctx: AuthContext,
    orderId: string,
    fileId: string,
    filename: string,
    bytes: Buffer
  ): Promise<RosterIntake> {
    let rows: string[][];
    try {
      rows = parseSpreadsheetBytes(filename, bytes);
    } catch {
      throw new RequestInvalidError('ROSTER_CORRUPT');
    }
    const interpretation = interpretRosterRows(rows);
    const intake: RosterIntake = {
      fileId,
      filename,
      original: { text: bytes.toString('utf8').slice(0, 20000), rows },
      interpretation,
      status: 'PENDING_REVIEW',
    };
    const order = await this.orders.getOrder(orderId, 'admin');
    const formValues: Record<string, unknown> = { ...(order?.formValues || {}) };
    formValues.rosterIntake = intake;
    delete formValues.rosterProduction;
    await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    return intake;
  }

  private async freezeOnAccreditedDeposit(ctx: AuthContext, orderId: string, payment: PaymentRecord) {
    if (!this.economicOk(payment)) return;
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.economicSnapshot?.frozen) return;
    const priced = await this.requoteCatalog(ctx, order);
    const now = Date.now();
    const config = await this.requireConfig(ctx.tenantId);
    const catalog = new WorkshopCatalogService(this.store);
    const tpuAdmin = await catalog.getTpuConfig({ ...ctx, tenantId: order.tenantId } as AuthContext);
    const formValues: Record<string, unknown> = { ...(priced.formValues || order.formValues || {}) };
    const tpu = formValues.tpuConfig as TPUOrderConfig | undefined;
    if (tpu) {
      formValues.tpuConfig = {
        ...tpu,
        adminLimitSnapshot: {
          maxWidth_mm: tpuAdmin.maxWidth_mm,
          maxHeight_mm: tpuAdmin.maxHeight_mm,
          updatedAt: tpuAdmin.updatedAt,
        },
      } satisfies TPUOrderConfig;
    }
    const laser = formValues.laserConfig as LaserOrderConfig | undefined;
    if (laser?.enabled) {
      const qty = Number(formValues.quantity || 1);
      const unit = Number(laser.unitPrice ?? tpuAdmin.laserUnitPrice);
      formValues.laserConfig = {
        ...laser,
        unitPrice: unit,
        costSnapshot: { unitPrice: unit, amount: Math.round(unit * qty * 100) / 100, capturedAt: now },
      } satisfies LaserOrderConfig;
    }
    await this.orders.patchCustomerDraft(orderId, { actorId: ctx.userId, role: 'customer' }, { formValues });
    const lines = linesFromOrder(priced);
    const agreed = priced.totalCustomerAmount;
    const paid = Number(payment.amountPaid || 0);
    const snapshot: CommercialEconomicSnapshot = {
      currency: priced.economicSnapshot?.currency || 'ARS',
      capturedAt: now,
      totals: priced.economicSnapshot?.totals || { internal: priced.totalInternalCost, customer: agreed },
      frozen: true,
      frozenAt: now,
      validUntil: priced.dueAt,
      depositAmount: paid,
      remainingAmount: Math.max(0, agreed - paid),
      agreedAmount: agreed,
      catalogRevision: config.updatedAt,
      lines,
      original: { agreedAmount: agreed, lines, frozenAt: now, catalogRevision: config.updatedAt },
      history: [
        {
          at: now,
          actorId: ctx.userId,
          decision: 'FREEZE',
          newAmount: agreed,
          reason: payment.status === 'WAIVED' ? 'trust_waived' : 'deposit_accredited',
          rule: 'SEÑA_CONGELA_PRECIO',
        },
      ],
      priceDecision: { status: 'NONE' },
    };
    await this.orders.setEconomicSnapshot(orderId, snapshot);
  }

  private frozenQuoteLines(order: PersistedOrder): Array<{ materialId: string; requestedQuantity: number }> | null {
    const snap = order.economicSnapshot;
    if (!snap?.frozen) return null;
    const src =
      snap.original?.lines && snap.original.lines.length ? snap.original.lines : snap.lines || [];
    const fromSnap = src
      .map((line) => ({
        materialId: line.materialId,
        requestedQuantity: Number(line.quantity),
      }))
      .filter((line) => line.materialId && Number.isFinite(line.requestedQuantity) && line.requestedQuantity > 0);
    if (fromSnap.length) return fromSnap;
    return (order.consumptions || [])
      .map((c) => ({
        materialId: c.materialId,
        requestedQuantity: Number(c.requestedQuantity || c.quantity || 1),
      }))
      .filter((line) => line.materialId && Number.isFinite(line.requestedQuantity) && line.requestedQuantity > 0);
  }

  private async requoteCatalog(
    ctx: AuthContext,
    order: PersistedOrder,
    options?: { allowFrozenReplace?: boolean }
  ) {
    const frozenLines = this.frozenQuoteLines(order);
    if (frozenLines && frozenLines.length) {
      const workshopId = String(frozenLines[0].materialId || '').replace(/^ws:/, '');
      const item = workshopId ? await this.store.getWorkshopItem(workshopId) : null;
      if (item && item.tenantId === ctx.tenantId) {
        const lines = await this.syncWorkshopLine(ctx, item, frozenLines[0].requestedQuantity);
        return this.admin.confirmCatalogOrder(ctx, order.orderId, lines, undefined, options);
      }
      return this.admin.confirmCatalogOrder(ctx, order.orderId, frozenLines, undefined, options);
    }
    const qty = Number(order.formValues?.quantity || order.consumptions?.[0]?.requestedQuantity || 1);
    const workshopItemId = String(order.formValues?.workshopItemId || '');
    let lines: Array<{ materialId: string; requestedQuantity: number; productId?: string }>;
    if (workshopItemId) {
      const item = await this.store.getWorkshopItem(workshopItemId);
      if (!item || item.tenantId !== ctx.tenantId) throw new RequestInvalidError('ITEM_DISABLED');
      lines = await this.syncWorkshopLine(ctx, item, qty);
    } else if (order.formValues?.productId) {
      const materialId = String(order.consumptions?.[0]?.materialId || '');
      lines = [{ productId: String(order.formValues.productId), materialId, requestedQuantity: qty }];
    } else {
      lines = (order.consumptions || []).map((c) => ({
        materialId: c.materialId,
        requestedQuantity: Number(c.requestedQuantity || c.quantity || 1),
      }));
    }
    lines = await this.withLaserLine(ctx, order, lines);
    return this.admin.confirmCatalogOrder(ctx, order.orderId, lines, undefined, options);
  }

  private async withLaserLine(
    ctx: AuthContext,
    order: PersistedOrder,
    lines: Array<{ materialId: string; requestedQuantity: number; productId?: string }>
  ) {
    const laser = order.formValues?.laserConfig as LaserOrderConfig | undefined;
    if (!laser?.enabled || !laser.confirmed) {
      return lines.filter((l) => l.materialId !== LASER_MATERIAL_ID);
    }
    await this.ensureLaserMaterial(ctx);
    const qty = Number(order.formValues?.quantity || lines[0]?.requestedQuantity || 1);
    const without = lines.filter((l) => l.materialId !== LASER_MATERIAL_ID);
    return [...without, { materialId: LASER_MATERIAL_ID, requestedQuantity: qty }];
  }

  private async ensureLaserMaterial(ctx: AuthContext) {
    const catalog = new WorkshopCatalogService(this.store);
    const tpu = await catalog.getTpuConfig(ctx);
    const config = await this.requireConfig(ctx.tenantId);
    const currency = String(config.currency || config.commercial?.defaultCurrency || 'ARS');
    await this.admin.catalog.upsertMaterial(
      ctx.tenantId,
      {
        materialId: LASER_MATERIAL_ID,
        tenantId: ctx.tenantId,
        name: 'Registro láser',
        displayName: 'Registro láser',
        unit: 'UNIDAD',
        unitId: resolveUnitId('UNIDAD'),
        internalUnitCost: 0,
        customerUnitPrice: tpu.laserUnitPrice,
        disciplineId: 'textile',
        active: true,
        available: true,
        visibleToClient: true,
        currency,
        costType: workshopCostType('UNIDAD'),
        consumptionRule: { kind: 'PER_UNIT', rate: 1 },
        customerVisibility: { price: true, consumption: true, subtotal: true, total: true },
      },
      currency
    );
  }

  private async syncPendingPayment(orderId: string, total: number) {
    const payment = await this.store.getPaymentRecordByOrder(orderId);
    if (!payment || payment.status !== 'PENDING') return;
    const pct = Number(payment.requiredPct || 50);
    payment.amountDue = Math.round(total * (pct / 100) * 100) / 100;
    await this.store.savePaymentRecord(payment);
  }

  private async currentMaterialPrices(order: PersistedOrder): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const itemId = String(order.formValues?.workshopItemId || '');
    if (itemId) {
      const item = await this.store.getWorkshopItem(itemId);
      const materialId = item ? workshopMaterialId(item.itemId) : '';
      if (item && materialId) out[materialId] = item.price;
    }
    const config = await this.store.getConfig(order.tenantId);
    for (const line of order.consumptions || []) {
      if (out[line.materialId] != null) continue;
      const material = (config?.materials || []).find((m) => m.materialId === line.materialId);
      if (material) out[line.materialId] = Number(material.customerUnitPrice);
    }
    return out;
  }

  private assertProductionReady(order: PersistedOrder) {
    assertOrderCanGenerateOutputs(order.formValues);
  }

  private async triggerProductionAfterPayment(
    ctx: AuthContext,
    order: PersistedOrder
  ): Promise<{ files: Array<{ id: string; filename: string; mimeType: string; format: string }> }> {
    const selected = selectedGarmentTypesOf(order.formValues);
    if (!selected.length) {
      await this.startWorkshopPipelineAfterOutputs(order.orderId, order.tenantId);
      return { files: [] };
    }
    try {
      this.assertProductionReady(order);
    } catch (error) {
      if (isProductionGateError(error)) return { files: [] };
      throw error;
    }
    const outputs = await this.ensureIndustrialOutputs(order, { actorId: ctx.userId, roleId: ctx.roleId });
    await this.startWorkshopPipelineAfterOutputs(order.orderId, order.tenantId);
    return { files: outputs.files };
  }

  private async startWorkshopPipelineAfterOutputs(orderId: string, tenantId: string): Promise<void> {
    try {
      await this.orchestrator.startProductionForSubmit(orderId, tenantId);
    } catch (error) {
      await this.tracer.record({
        tenantId,
        entityType: 'order',
        entityId: orderId,
        eventType: 'OUTPUT_FAILED',
        actorType: 'SYSTEM',
        actorId: 'pipeline',
        metadata: {
          orderId,
          phase: 'workshop-pipeline',
          error: error instanceof Error ? error.message : 'PIPELINE_FAILED',
        },
        correlationId: orderId,
      });
    }
  }

  private nextProductionRevision(order: PersistedOrder, actorId: string, totalUnits: number) {
    const prev = (order.formValues?.productionRevision || {}) as { version?: number };
    return {
      id: `rev_${Date.now().toString(36)}`,
      version: Number(prev.version || 0) + 1,
      at: Date.now(),
      actorId,
      totalUnits,
    };
  }

  async generateProductionOutputs(ctx: AuthContext, orderId: string) {
    await this.requireCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    this.assertProductionReady(order);
    const generated = await this.ensureIndustrialOutputs(order, { actorId: ctx.userId, roleId: ctx.roleId });
    const fresh = (await this.orders.getOrder(orderId, 'admin')) || order;
    return {
      orderId,
      status: fresh.status,
      files: generated.files,
      revision: generated.revision,
    };
  }

  async downloadOrderFile(ctx: AuthContext, orderId: string, fileId: string) {
    await this.requireCustomer(ctx);
    await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const file = await this.store.getOrderFile(fileId);
    if (!file || file.tenantId !== ctx.tenantId || file.orderId !== orderId || file.customerId !== ctx.userId) {
      throw new AccessDeniedError();
    }
    const bytes = await this.store.readBlob(file.id);
    if (!bytes?.length) throw new AccessDeniedError();
    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      contentBase64: bytes.toString('base64'),
    };
  }

  private async ensureIndustrialOutputs(
    order: PersistedOrder,
    actor: { actorId: string; roleId: string }
  ): Promise<{
    files: Array<{ id: string; filename: string; mimeType: string; format: string; spec?: unknown }>;
    revision: { id?: string; version?: number } | null;
  }> {
    this.assertProductionReady(order);
    const revision = (order.formValues?.productionRevision || null) as { id?: string; version?: number } | null;
    const existing = order.formValues?.productionOutputs as
      | Array<{ id: string; filename: string; mimeType: string; format: string; spec?: unknown; revisionId?: string }>
      | undefined;
    if (Array.isArray(existing) && existing.length && revision?.id) {
      const sameRevision = existing.every((row) => !row.revisionId || row.revisionId === revision.id);
      if (sameRevision) return { files: existing, revision };
    }
    try {
      const selected = selectedGarmentTypesOf(order.formValues);
      if (!selected.length) throw new RequestInvalidError('OUTPUT_EMPTY');
      const distribution = order.formValues?.designDistribution as
        | import('../../contracts/design-distribution').DesignDistribution
        | undefined;
      if (!distribution) throw new RequestInvalidError('PRODUCTION_NOT_APPROVED');
      const styles = Object.fromEntries(
        this.familiesFromForm(order.formValues || {}).map((f) => [f.garmentType, f.style])
      );
      const artifacts = buildIndustrialOrderArtifacts({
        orderId: order.orderId,
        orderNumber: String(order.displayNumber || order.orderId),
        projectName: String(order.projectName || order.formValues?.projectName || ''),
        revision: Number(revision?.version || order.revision || 1),
        revisionId: String(revision?.id || `rev_${order.revision || 1}`),
        generatedAt: Date.now(),
        distribution,
        styles,
      });
      if (!artifacts.length) throw new RequestInvalidError('OUTPUT_EMPTY');
      const files = [];
      for (const art of artifacts) {
        const bytes = Buffer.from(art.contentUtf8, 'utf8');
        if (!bytes.length) throw new RequestInvalidError('OUTPUT_EMPTY');
        const fileId = randomUUID();
        const storageKey = await this.store.writeBlob(fileId, bytes);
        const uploadedAt = Date.now();
        await this.store.saveOrderFile({
          id: fileId,
          tenantId: order.tenantId,
          orderId: order.orderId,
          customerId: order.customerId,
          filename: art.filename,
          storageKey,
          mimeType: art.mimeType,
          sizeBytes: bytes.length,
          status: 'VALIDATED',
          uploadedAt,
          conversionStatus: 'NOT_REQUIRED',
        });
        files.push({
          id: fileId,
          filename: art.filename,
          mimeType: art.mimeType,
          format: art.format,
          spec: art.spec,
          revisionId: revision?.id,
        });
      }
      const formValues: Record<string, unknown> = { ...(order.formValues || {}), productionOutputs: files };
      await this.orders.patchCustomerDraft(
        order.orderId,
        { actorId: actor.actorId, role: actor.roleId === 'CUSTOMER' ? 'customer' : 'admin' },
        { formValues }
      );
      await this.orders.appendHistoryNote(
        order.orderId,
        { actorId: actor.actorId, role: actor.roleId === 'CUSTOMER' ? 'customer' : 'admin' },
        'outputs_generated'
      );
      await this.tracer.record({
        tenantId: order.tenantId,
        entityType: 'order',
        entityId: order.orderId,
        eventType: 'OUTPUT_GENERATED',
        actorType: actorTypeFromRole(actor.roleId, actor.actorId),
        actorId: actor.actorId,
        metadata: { orderId: order.orderId, count: files.length, revisionId: revision?.id || '' },
        correlationId: order.orderId,
      });
      return { files, revision };
    } catch (error) {
      await this.tracer.record({
        tenantId: order.tenantId,
        entityType: 'order',
        entityId: order.orderId,
        eventType: 'OUTPUT_FAILED',
        actorType: actorTypeFromRole(actor.roleId, actor.actorId),
        actorId: actor.actorId,
        metadata: {
          orderId: order.orderId,
          phase: 'production-outputs',
          error: error instanceof Error ? error.message.replace(/^REQUEST_INVALID:/, '') : 'OUTPUT_FAILED',
        },
        correlationId: order.orderId,
      });
      throw error;
    }
  }

  private async requireCustomer(ctx: AuthContext): Promise<CustomerProfile> {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    const profile = await this.store.getCustomer(ctx.userId);
    if (!profile || profile.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (profile.status === 'disabled') throw new AccessDeniedError();
    return profile;
  }

  private async requireConfig(tenantId: string): Promise<TenantConfig> {
    const config = await this.store.getConfig(tenantId);
    if (!config) throw new RequestInvalidError('CONFIG_NOT_FOUND');
    return config;
  }
}
