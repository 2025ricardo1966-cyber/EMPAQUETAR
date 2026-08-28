import { randomUUID } from 'crypto';
import type { AuthContext, ConfiguredMaterial, TenantConfig } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import type { CatalogProduct, ConsumptionRule, CostType, ProductDynamicField } from '../../contracts/catalog-domain';
import { resolveUnitId } from '../../contracts/catalog-domain';
import { ConfigConflictError, ConfigValidationError } from '../../contracts/configuration-schema';
import type { TenantLimits } from '../../contracts/auth-rbac';
import { DEFAULT_TENANT_LIMITS } from '../../contracts/auth-rbac';
import type { DomainEventType } from '../../contracts/trace-domain';
import type { WorkflowDefinition, WorkflowStepDefinition } from '../../contracts/workflow-domain';
import type { AdminService } from './AdminService';
import type { OrderService } from './OrderService';
import type { TraceService } from './TraceService';
import type { WorkflowEngine } from './WorkflowEngine';
import { t } from '../../i18n';
import {
  parseFlowConfiguration,
  readFlowConfiguration,
  resolveTenantCapabilities,
  writeFlowConfiguration,
  FLOW_ACTION_DEFINITIONS,
} from '../../contracts/flow-configuration';
import { discoverWorkshopCapabilities, EMPAQUETAR_CAPABILITY_CATEGORIES, EMPAQUETAR_COMMERCIAL_TIERS } from '../../contracts/empaquetar-capabilities';
import {
  normalizeCurrencyCode,
  normalizeLanguageTag,
  resolveConfiguredCurrency,
  resolveConfiguredLanguage,
} from '../../contracts/international-domain';

const FIELD_TYPES = new Set(['text', 'number', 'select', 'multiselect', 'boolean', 'textarea']);
const CONSUMPTION_TYPES = new Set(['FIXED', 'PER_UNIT', 'PROPORTIONAL', 'LENGTH', 'AREA', 'PER_METER', 'PER_M2']);
const PRICE_TYPES = new Set(['PER_UNIT', 'PER_METER', 'PER_M2', 'FIXED']);
const CLOSED_ORDER = new Set(['completed', 'delivered', 'cancelled', 'expired']);

const RUBRO_TO_KEY: Record<string, string> = {
  TEXTIL: 'textile',
  TPU: 'tpu',
  DTF: 'dtf',
  PUBLICIDAD: 'textile',
  CUSTOM: 'textile',
};

function iso(ms?: number): string {
  return new Date(ms || Date.now()).toISOString();
}

function parseConsumption(raw: unknown): ConsumptionRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const type = String(row.type || row.kind || 'PER_UNIT').toUpperCase();
  if (!CONSUMPTION_TYPES.has(type)) {
    throw new ConfigValidationError({ consumptionRule: `consumptionRule.type inválido: ${type}` });
  }
  const kind =
    type === 'PER_METER' ? 'LENGTH' : type === 'PER_M2' ? 'AREA' : (type as ConsumptionRule['kind']);
  const rate = row.value != null ? Number(row.value) : row.rate != null ? Number(row.rate) : undefined;
  return {
    kind,
    rate: Number.isFinite(rate as number) ? Number(rate) : undefined,
    fixedQuantity: row.fixedQuantity != null ? Number(row.fixedQuantity) : undefined,
  };
}

function validateFields(fields: unknown): ProductDynamicField[] {
  if (fields == null) return [];
  if (!Array.isArray(fields)) throw new ConfigValidationError({ fields: 'fields debe ser un array' });
  const seen = new Set<string>();
  return fields.map((raw, i) => {
    const row = (raw || {}) as Record<string, unknown>;
    const prefix = `fields.${i}`;
    const id = String(row.id || '').trim();
    if (!id) throw new ConfigValidationError({ [`${prefix}.id`]: 'Cada campo necesita un id único' });
    if (seen.has(id)) throw new ConfigValidationError({ [`${prefix}.id`]: `id duplicado: ${id}` });
    seen.add(id);
    const label = String(row.label || '').trim();
    if (!label) throw new ConfigValidationError({ [`${prefix}.label`]: 'El label es requerido' });
    const type = String(row.type || 'text').toLowerCase();
    if (!FIELD_TYPES.has(type)) {
      throw new ConfigValidationError({ [`${prefix}.type`]: `type inválido: ${type}` });
    }
    const options = Array.isArray(row.options) ? row.options.map((o) => String(o)) : undefined;
    if ((type === 'select' || type === 'multiselect') && !(options && options.length)) {
      throw new ConfigValidationError({ [`${prefix}.options`]: 'select/multiselect requiere options no vacío' });
    }
    return {
      id,
      type,
      label,
      placeholder: row.placeholder != null ? String(row.placeholder) : undefined,
      required: row.required !== false,
      visibleToClient: row.visibleToClient !== false,
      options,
      defaultValue: (row.defaultValue as string | number | boolean | null) ?? null,
      order: row.order != null ? Number(row.order) : i + 1,
    };
  });
}

function sameRule(a?: ConsumptionRule, b?: ConsumptionRule): boolean {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

export class AdminConfigService {
  constructor(
    private admin: AdminService,
    private orders: OrderService,
    private tracer: TraceService,
    private workflows: WorkflowEngine
  ) {}

  async listProducts(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    return (config.products || [])
      .slice()
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map((p) => this.productDto(p, config));
  }

  async createProduct(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const name = String(body.name || '').trim();
    if (!name) throw new ConfigValidationError({ name: 'El nombre es requerido' });
    const config = await this.config(ctx);
    if ((config.products || []).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ConfigValidationError({ name: 'Ya existe un producto con ese nombre' });
    }
    const fields = validateFields(body.fields);
    const consumptionRule = parseConsumption(body.consumptionRule);
    const materials = Array.isArray(body.materials) ? (body.materials as string[]) : Array.isArray(body.materialIds) ? (body.materialIds as string[]) : [];
    const product = await this.admin.catalog.createProduct(ctx.tenantId, {
      name,
      rubricId: this.disciplineOf(config),
      description: body.clientDescription ? String(body.clientDescription) : undefined,
      active: true,
      materialIds: materials,
      unitId: String(body.unit || body.unitId || 'UNIT'),
      consumptionRule,
      visibleToClient: body.visibleToClient !== false,
      displayOrder: body.displayOrder != null ? Number(body.displayOrder) : (config.products || []).length + 1,
      fields,
      clientDescription: body.clientDescription ? String(body.clientDescription) : undefined,
      updatedBy: ctx.userId,
      basePrice: body.basePrice != null ? Number(body.basePrice) : undefined,
      priceType: body.priceType ? (String(body.priceType) as CostType) : undefined,
    });
    await this.emit(ctx, product.productId, 'PRODUCT_CREATED');
    return this.productDto(product, await this.config(ctx));
  }

  async updateProduct(ctx: AuthContext, productId: string, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const current = (config.products || []).find((p) => p.productId === productId);
    if (!current || current.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const fields = body.fields !== undefined ? validateFields(body.fields) : current.fields;
    const nextUnit = body.unit != null || body.unitId != null ? resolveUnitId(String(body.unit || body.unitId)) : current.unitId;
    const nextRule = body.consumptionRule !== undefined ? parseConsumption(body.consumptionRule) : current.consumptionRule;
    const active = await this.activeOrdersForProduct(ctx.tenantId, productId);
    if (active && (nextUnit !== current.unitId || !sameRule(nextRule, current.consumptionRule))) {
      throw new ConfigConflictError(
        'No se puede cambiar unit ni consumptionRule mientras hay pedidos activos con este producto.'
      );
    }
    const product = await this.admin.catalog.updateProduct(ctx.tenantId, productId, {
      name: body.name != null ? String(body.name) : current.name,
      clientDescription: body.clientDescription != null ? String(body.clientDescription) : current.clientDescription,
      description: body.clientDescription != null ? String(body.clientDescription) : current.description,
      displayOrder: body.displayOrder != null ? Number(body.displayOrder) : current.displayOrder,
      visibleToClient: body.visibleToClient != null ? Boolean(body.visibleToClient) : current.visibleToClient,
      fields,
      unitId: nextUnit,
      consumptionRule: nextRule,
      materialIds: Array.isArray(body.materials) ? (body.materials as string[]) : current.materialIds,
      updatedBy: ctx.userId,
    });
    await this.emit(ctx, productId, 'PRODUCT_UPDATED');
    return this.productDto(product, await this.config(ctx));
  }

  async deactivateProduct(ctx: AuthContext, productId: string) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const current = (config.products || []).find((p) => p.productId === productId);
    if (!current || current.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (await this.activeOrdersForProduct(ctx.tenantId, productId)) {
      throw new ConfigConflictError('No se puede desactivar: hay pedidos activos con este producto.');
    }
    const product = await this.admin.catalog.updateProduct(ctx.tenantId, productId, { active: false, updatedBy: ctx.userId });
    await this.emit(ctx, productId, 'PRODUCT_DEACTIVATED');
    return this.productDto(product, await this.config(ctx));
  }

  async reorderProducts(ctx: AuthContext, order: Array<{ productId: string; displayOrder: number }>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    for (const item of order || []) {
      const row = (config.products || []).find((p) => p.productId === item.productId);
      if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
      await this.admin.catalog.updateProduct(ctx.tenantId, item.productId, { displayOrder: Number(item.displayOrder), updatedBy: ctx.userId });
    }
    return this.listProducts(ctx);
  }

  async listMaterials(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    return (config.materials || []).map((m) => this.materialDto(m));
  }

  async createMaterial(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const name = String(body.name || '').trim();
    if (!name) throw new ConfigValidationError({ name: 'El nombre es requerido' });
    const config = await this.config(ctx);
    const materialId = randomUUID();
    const internalCost = Number(body.internalCost || body.internalUnitCost || 0);
    await this.admin.catalog.upsertMaterial(
      ctx.tenantId,
      {
        materialId,
        tenantId: ctx.tenantId,
        name,
        unit: String(body.unit || 'M'),
        unitId: resolveUnitId(String(body.unit || 'M')),
        internalUnitCost: internalCost,
        customerUnitPrice: Number(body.customerUnitPrice || body.clientPrice || 0),
        disciplineId: this.disciplineOf(config),
        active: true,
        costType: String(body.costType || 'PER_METER'),
        visibleToClient: body.visibleToClient === true,
        clientLabel: body.clientLabel != null ? String(body.clientLabel) : undefined,
        updatedBy: ctx.userId,
      },
      resolveConfiguredCurrency(config)
    );
    await this.emit(ctx, materialId, 'MATERIAL_CREATED');
    const next = (await this.config(ctx)).materials.find((m) => m.materialId === materialId);
    return this.materialDto(next!);
  }

  async updateMaterial(ctx: AuthContext, materialId: string, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const current = config.materials.find((m) => m.materialId === materialId);
    if (!current) throw new AccessDeniedError();
    const internalCost =
      body.internalCost != null ? Number(body.internalCost) : current.internalUnitCost;
    await this.admin.catalog.upsertMaterial(
      ctx.tenantId,
      {
        ...current,
        name: body.name != null ? String(body.name) : current.name,
        unit: body.unit != null ? String(body.unit) : current.unit,
        internalUnitCost: internalCost,
        customerUnitPrice:
          body.customerUnitPrice != null ? Number(body.customerUnitPrice) : current.customerUnitPrice,
        costType: body.costType != null ? String(body.costType) : current.costType,
        visibleToClient: body.visibleToClient != null ? Boolean(body.visibleToClient) : current.visibleToClient,
        clientLabel: body.clientLabel != null ? String(body.clientLabel) : current.clientLabel,
        updatedBy: ctx.userId,
        active: current.active,
      },
      resolveConfiguredCurrency(config)
    );
    await this.emit(ctx, materialId, body.internalCost != null ? 'MATERIAL_COST_UPDATED' : 'MATERIAL_UPDATED');
    if (body.internalCost != null) await this.emit(ctx, materialId, 'MATERIAL_UPDATED');
    const next = (await this.config(ctx)).materials.find((m) => m.materialId === materialId);
    return this.materialDto(next!);
  }

  async deactivateMaterial(ctx: AuthContext, materialId: string) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const current = config.materials.find((m) => m.materialId === materialId);
    if (!current) throw new AccessDeniedError();
    const linked = (config.products || []).some(
      (p) => p.active !== false && (p.materialIds || []).includes(materialId)
    );
    if (linked) {
      throw new ConfigConflictError('No se puede desactivar: el material está asociado a productos activos.');
    }
    await this.admin.catalog.upsertMaterial(
      ctx.tenantId,
      { ...current, active: false, updatedBy: ctx.userId },
      resolveConfiguredCurrency(config)
    );
    const next = (await this.config(ctx)).materials.find((m) => m.materialId === materialId);
    return this.materialDto(next!);
  }

  async getWorkflow(ctx: AuthContext) {
    this.assertRead(ctx);
    const def = await this.workflows.ensureDefaultForTenant(ctx);
    return this.workflowDto(def);
  }

  async updateWorkflow(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const steps = Array.isArray(body.steps) ? (body.steps as Array<Record<string, unknown>>) : [];
    const updated = await this.workflows.patchPublishedPresentation(ctx, steps);
    await this.emit(ctx, updated.id, 'WORKFLOW_CONFIG_UPDATED');
    return this.workflowDto(updated);
  }

  async getPricing(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    return {
      currency: resolveConfiguredCurrency(config),
      market: config.commercial?.defaultMarket || null,
      products: (config.products || []).map((p) => ({
        productId: p.productId,
        productName: p.name,
        basePrice: Number(p.basePrice || 0),
        priceType: p.priceType || 'PER_UNIT',
      })),
      materials: (config.materials || []).map((m) => ({
        materialId: m.materialId,
        materialName: m.name,
        internalCost: m.internalUnitCost,
        costType: m.costType || 'PER_UNIT',
      })),
    };
  }

  async updateProductPrice(ctx: AuthContext, productId: string, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const current = (config.products || []).find((p) => p.productId === productId);
    if (!current || current.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const priceType = String(body.priceType || current.priceType || 'PER_UNIT').toUpperCase();
    if (!PRICE_TYPES.has(priceType)) {
      throw new ConfigValidationError({ priceType: `priceType inválido: ${priceType}` });
    }
    const product = await this.admin.catalog.updateProduct(ctx.tenantId, productId, {
      basePrice: Number(body.basePrice),
      priceType: priceType as CostType,
      updatedBy: ctx.userId,
    });
    await this.emit(ctx, productId, 'PRODUCT_PRICE_UPDATED');
    return {
      productId: product.productId,
      productName: product.name,
      basePrice: product.basePrice,
      priceType: product.priceType,
    };
  }

  async updateMaterialCost(ctx: AuthContext, materialId: string, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    return this.updateMaterial(ctx, materialId, { internalCost: body.internalCost, costType: body.costType });
  }

  async putClientVisibility(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const vis = {
      showConsumption: body.showConsumption !== false,
      showEstimatedDelivery: body.showEstimatedDelivery !== false,
      showMaterials: body.showMaterials === true,
      deliveryAddress: body.deliveryAddress != null ? String(body.deliveryAddress) : undefined,
      deliveryHours: body.deliveryHours != null ? String(body.deliveryHours) : undefined,
    };
    if (Array.isArray(body.products)) {
      for (const row of body.products as Array<Record<string, unknown>>) {
        const id = String(row.productId || '');
        const product = (config.products || []).find((p) => p.productId === id);
        if (!product || product.tenantId !== ctx.tenantId) throw new AccessDeniedError();
        await this.admin.catalog.updateProduct(ctx.tenantId, id, {
          visibleToClient: row.visibleToClient !== false,
          clientDescription: row.clientDescription != null ? String(row.clientDescription) : product.clientDescription,
          updatedBy: ctx.userId,
        });
      }
    }
    const next = await this.config(ctx);
    next.config = { ...(next.config || {}), clientVisibility: vis };
    await this.admin.persistConfig(next);
    return vis;
  }

  async getFlowConfiguration(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    const flow = readFlowConfiguration(config);
    return this.flowDto(flow);
  }

  async putFlowConfiguration(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    if (config.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    const now = Date.now();
    const incoming = parseFlowConfiguration(
      {
        features: body.features,
        actionOrder: body.actionOrder,
        updatedAt: now,
        updatedBy: ctx.userId,
      },
      ctx.tenantId,
      now
    );
    incoming.updatedBy = ctx.userId;
    incoming.updatedAt = now;
    incoming.tenantId = ctx.tenantId;
    const next = await this.config(ctx);
    next.config = writeFlowConfiguration(next, incoming);
    const vis = { ...(((next.config.clientVisibility as Record<string, unknown>) || {}) as Record<string, unknown>) };
    const consumption = incoming.features.find((f) => f.featureKey === 'consumption');
    const materials = incoming.features.find((f) => f.featureKey === 'materials');
    if (consumption) vis.showConsumption = consumption.enabled !== false;
    if (materials) vis.showMaterials = materials.enabled !== false;
    next.config.clientVisibility = vis;
    next.updatedAt = now;
    await this.admin.persistConfig(next);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId: ctx.tenantId,
      eventType: 'FLOW_CONFIGURATION_UPDATED',
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: {
        eventType: 'FLOW_CONFIGURATION_UPDATED',
        tenantId: ctx.tenantId,
        actionOrder: incoming.actionOrder.join(','),
        enabled: incoming.features.filter((f) => f.enabled).map((f) => f.featureKey).join(','),
        disabled: incoming.features.filter((f) => !f.enabled).map((f) => f.featureKey).join(','),
        displayOrder: incoming.features.map((f) => f.featureKey).join(','),
      },
      correlationId: ctx.tenantId,
    });
    return this.flowDto(incoming);
  }

  private flowDto(flow: ReturnType<typeof readFlowConfiguration>) {
    const capabilities = resolveTenantCapabilities(flow);
    return {
      version: flow.version,
      tenantId: flow.tenantId,
      features: flow.features,
      actionOrder: flow.actionOrder,
      capabilities,
      updatedAt: flow.updatedAt,
      updatedBy: flow.updatedBy || null,
      catalog: {
        source: 'empaquetar-capabilities',
        categories: [...EMPAQUETAR_CAPABILITY_CATEGORIES],
        commercialTiers: [...EMPAQUETAR_COMMERCIAL_TIERS],
        commercialEnforced: false,
        capabilities: discoverWorkshopCapabilities(),
        actions: FLOW_ACTION_DEFINITIONS,
      },
    };
  }

  async getLimits(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    const limits = { ...DEFAULT_TENANT_LIMITS, ...(config.limits || {}) };
    const maxFileSizeMb = limits.maxFileSizeMb ?? Math.round((limits.maxFileBytes || 50 * 1024 * 1024) / (1024 * 1024));
    return {
      maxFilesPerOrder: limits.maxFilesPerOrder,
      maxUnitsPerOrder: limits.maxUnitsPerOrder,
      maxMetersPerOrder: limits.maxMetersPerOrder,
      maxFileSizeMb,
      allowedMimeTypes: limits.allowedMimeTypes || DEFAULT_TENANT_LIMITS.allowedMimeTypes,
    };
  }

  async putLimits(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const maxFileSizeMb = body.maxFileSizeMb != null ? Number(body.maxFileSizeMb) : undefined;
    const patch: Partial<TenantLimits> = {
      maxFilesPerOrder: body.maxFilesPerOrder != null ? Number(body.maxFilesPerOrder) : undefined,
      maxUnitsPerOrder: body.maxUnitsPerOrder != null ? Number(body.maxUnitsPerOrder) : undefined,
      maxMetersPerOrder: body.maxMetersPerOrder != null ? Number(body.maxMetersPerOrder) : undefined,
      maxFileSizeMb,
      maxFileBytes: maxFileSizeMb != null ? maxFileSizeMb * 1024 * 1024 : undefined,
      allowedMimeTypes: Array.isArray(body.allowedMimeTypes) ? (body.allowedMimeTypes as string[]) : undefined,
    };
    const config = await this.config(ctx);
    config.limits = { ...DEFAULT_TENANT_LIMITS, ...(config.limits || {}), ...patch };
    if (patch.maxFileBytes) config.limits.maxFileBytes = patch.maxFileBytes;
    await this.admin.persistConfig(config);
    return this.getLimits(ctx);
  }

  async getCommercial(ctx: AuthContext) {
    this.assertRead(ctx);
    const config = await this.config(ctx);
    return {
      defaultMarket: config.commercial?.defaultMarket || null,
      defaultCurrency: resolveConfiguredCurrency(config),
      defaultLanguage: resolveConfiguredLanguage(config),
    };
  }

  async putCommercial(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertWrite(ctx);
    const config = await this.config(ctx);
    const commercial = { ...(config.commercial || {}) };
    if (body.defaultMarket != null) {
      commercial.defaultMarket = String(body.defaultMarket).trim() || undefined;
    }
    if (body.defaultCurrency != null) {
      try {
        const code = normalizeCurrencyCode(String(body.defaultCurrency));
        commercial.defaultCurrency = code;
        if (code) {
          config.currency = code;
        }
      } catch {
        throw new ConfigValidationError({ defaultCurrency: 'INVALID_CURRENCY' });
      }
    }
    if (body.defaultLanguage != null) {
      try {
        const lang = normalizeLanguageTag(String(body.defaultLanguage));
        commercial.defaultLanguage = lang;
        if (lang) config.defaultLanguage = lang;
      } catch {
        throw new ConfigValidationError({ defaultLanguage: 'INVALID_LANGUAGE' });
      }
    }
    config.commercial = commercial;
    await this.admin.persistConfig(config);
    if (commercial.defaultCurrency) {
      try {
        await this.admin.updateLimits(ctx, { currency: commercial.defaultCurrency });
      } catch (err) {
        if (!(err instanceof AccessDeniedError)) throw err;
      }
    }
    await this.emit(ctx, ctx.tenantId, 'COMMERCIAL_CONFIG_UPDATED');
    await this.tracer.notifyOperational({
      tenantId: ctx.tenantId,
      type: 'COMMERCIAL_CONFIG_UPDATED',
      title: t('notifications.commercial_updated', ctx.lang || 'es'),
      workshopMessage: t('notifications.commercial_updated', ctx.lang || 'es'),
      entityType: 'config',
      entityId: ctx.tenantId,
      dedupeKey: `${ctx.tenantId}:COMMERCIAL_CONFIG_UPDATED:${Date.now()}`,
      includeWorkshop: true,
      workshopOnlyAdmins: true,
      metadata: { channel: 'IN_APP', status: commercial.defaultCurrency || '' },
      actorId: ctx.userId,
    });
    return this.getCommercial(ctx);
  }

  private assertRead(ctx: AuthContext): void {
    if (ctx.roleId === 'SUPER_ADMIN' || ctx.roleId === 'OPERATOR' || ctx.roleId === 'CUSTOMER') {
      throw new AccessDeniedError();
    }
  }

  private assertWrite(ctx: AuthContext): void {
    this.assertRead(ctx);
  }

  private async config(ctx: AuthContext): Promise<TenantConfig> {
    return this.admin.peekConfig(ctx.tenantId);
  }

  private disciplineOf(config: TenantConfig): string {
    const enabled = config.disciplines?.find((d) => d.enabled);
    return enabled?.id || RUBRO_TO_KEY[String(config.rubro || 'TEXTIL')] || 'textile';
  }

  private productDto(p: CatalogProduct, config: TenantConfig) {
    return {
      id: p.productId,
      productId: p.productId,
      name: p.name,
      rubro: config.rubro || p.rubricId,
      isActive: p.active !== false,
      visibleToClient: p.visibleToClient !== false,
      displayOrder: p.displayOrder || 0,
      clientDescription: p.clientDescription || p.description || '',
      fields: p.fields || [],
      unit: p.unitId || 'UNIT',
      consumptionRule: p.consumptionRule || {},
      materials: p.materialIds || [],
      updatedAt: iso(p.updatedAt),
    };
  }

  private materialDto(m: ConfiguredMaterial) {
    return {
      id: m.materialId,
      materialId: m.materialId,
      name: m.name,
      unit: m.unitId || m.unit,
      costType: m.costType || 'PER_UNIT',
      internalCost: m.internalUnitCost,
      isActive: m.active !== false,
      visibleToClient: m.visibleToClient === true,
      clientLabel: m.clientLabel || null,
      updatedBy: m.updatedBy || null,
    };
  }

  private workflowDto(def: WorkflowDefinition) {
    return {
      id: def.id,
      name: def.name,
      isDefault: Boolean(def.isDefault),
      steps: def.steps.map((s) => this.stepDto(s)),
      updatedAt: iso(def.updatedAt),
    };
  }

  private stepDto(step: WorkflowStepDefinition) {
    return {
      id: step.stepId,
      name: String(step.configuration.orderStatus || step.stepId).toUpperCase(),
      label: String(step.configuration.workshopLabel || step.name),
      labelForClient: String(step.configuration.customerLabel || step.configuration.labelForClient || ''),
      requiresClientApproval: Boolean(step.configuration.requiresApproval),
      notifyClient: step.configuration.notifyClient !== false,
      notifyAdmin: step.configuration.notifyAdmin === true,
      order: step.order,
    };
  }

  private async activeOrdersForProduct(tenantId: string, productId: string): Promise<boolean> {
    const listed = await this.orders.peekOrders(tenantId);
    return listed.some((o) => {
      if (CLOSED_ORDER.has(o.status)) return false;
      const fromForm = String(o.formValues?.productId || '');
      const fromLine = (o.consumptions || []).some((c) => c.productId === productId);
      return fromForm === productId || fromLine;
    });
  }

  private async emit(ctx: AuthContext, entityId: string, eventType: DomainEventType): Promise<void> {
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'config',
      entityId,
      eventType,
      actorType: ctx.roleId === 'ADMIN_PRINCIPAL' ? 'ADMIN_PRINCIPAL' : 'ADMIN',
      actorId: ctx.userId,
      metadata: { eventType },
      correlationId: ctx.tenantId,
    });
  }
}
