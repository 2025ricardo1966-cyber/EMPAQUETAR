import { randomUUID } from 'crypto';
import type { AuthContext, ConfiguredMaterial, Tenant, TenantConfig } from '../../contracts/admin-domain';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import type { CatalogLineInput, CatalogProduct, CatalogUnit, CalculatedCatalogLine, ConsumptionRule, CostType, VisibilityConfiguration } from '../../contracts/catalog-domain';
import {
  calculateConsumption,
  calculateLineAmounts,
  DEFAULT_UNIT_CATALOG,
  DEFAULT_VISIBILITY,
  defaultCostTypeForUnit,
  publicMaterialView,
  resolveUnitId,
  roundCatalogMoney,
  roundQuantity,
} from '../../contracts/catalog-domain';
import { resolveConfiguredCurrency } from '../../contracts/international-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import type { MaterialConsumption, PersistedOrder } from '../../contracts/order-domain';
import { calculateConsumptionLine } from '../../contracts/order-lifecycle';
import type { AdminRepository } from './AdminRepository';
import type { OrderService } from './OrderService';

function can(ctx: AuthContext, permission: string): boolean {
  return hasPermission(
    {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      login: '',
      displayCode: '',
      roleId: ctx.roleId,
      permissions: ctx.permissions,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    },
    permission
  );
}

export class CostEngine {
  constructor(
    private repo: AdminRepository,
    private orders?: OrderService
  ) {}

  listUnits(config?: TenantConfig): CatalogUnit[] {
    return config?.units?.length ? config.units : DEFAULT_UNIT_CATALOG;
  }

  async listProducts(tenantId: string, activeOnly = false): Promise<CatalogProduct[]> {
    const config = await this.requireConfig(tenantId);
    const rows = config.products || [];
    return activeOnly ? rows.filter((p) => p.active) : rows;
  }

  async getProduct(tenantId: string, productId: string): Promise<CatalogProduct | undefined> {
    return (await this.listProducts(tenantId)).find((p) => p.productId === productId);
  }

  async createProduct(
    tenantId: string,
    input: Omit<CatalogProduct, 'productId' | 'tenantId' | 'createdAt' | 'updatedAt'> & { productId?: string }
  ): Promise<CatalogProduct> {
    if (!input.name?.trim()) throw new Error('PRODUCT_NAME_REQUIRED');
    if (!input.rubricId?.trim()) throw new Error('PRODUCT_RUBRIC_REQUIRED');
    const config = await this.requireConfig(tenantId);
    const now = Date.now();
    const product: CatalogProduct = {
      productId: input.productId || randomUUID(),
      tenantId,
      rubricId: input.rubricId.trim(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      active: input.active !== false,
      schemaId: input.schemaId,
      materialIds: input.materialIds || [],
      processIds: input.processIds || [],
      unitId: resolveUnitId(input.unitId || 'UNIT'),
      consumptionRule: input.consumptionRule,
      metadata: input.metadata,
      visibleToClient: input.visibleToClient !== false,
      displayOrder: input.displayOrder,
      fields: input.fields || [],
      clientDescription: input.clientDescription,
      updatedBy: input.updatedBy,
      basePrice: input.basePrice,
      priceType: input.priceType,
      internalCost: input.internalCost,
      margin: input.margin,
      costBreakdown: input.costBreakdown,
      supplierPrice: input.supplierPrice,
      createdAt: now,
      updatedAt: now,
    };
    config.products = [...(config.products || []), product];
    config.updatedAt = now;
    await this.repo.saveConfig(config);
    return product;
  }

  async updateProduct(tenantId: string, productId: string, patch: Partial<CatalogProduct>): Promise<CatalogProduct> {
    const config = await this.requireConfig(tenantId);
    const index = (config.products || []).findIndex((p) => p.productId === productId);
    if (index < 0) throw new Error('PRODUCT_NOT_FOUND');
    const prev = config.products![index];
    const next: CatalogProduct = {
      ...prev,
      ...patch,
      productId: prev.productId,
      tenantId,
      name: patch.name?.trim() || prev.name,
      rubricId: patch.rubricId?.trim() || prev.rubricId,
      unitId: patch.unitId ? resolveUnitId(patch.unitId) : prev.unitId,
      updatedAt: Date.now(),
    };
    config.products![index] = next;
    config.updatedAt = next.updatedAt;
    await this.repo.saveConfig(config);
    return next;
  }

  async listMaterials(tenantId: string, activeOnly = false): Promise<ConfiguredMaterial[]> {
    const config = await this.requireConfig(tenantId);
    const rows = (config.materials || []).map((m) => this.normalizeMaterial(tenantId, m, config));
    return activeOnly ? rows.filter((m) => m.active !== false && m.available !== false) : rows;
  }

  async upsertMaterial(tenantId: string, input: ConfiguredMaterial, currency: string): Promise<ConfiguredMaterial> {
    if (!input.name?.trim()) throw new Error('MATERIAL_NAME_REQUIRED');
    const config = await this.requireConfig(tenantId);
    const unitId = resolveUnitId(input.unitId || input.unit);
    const costType = (input.costType || input.costConfiguration?.type || defaultCostTypeForUnit(unitId)) as CostType;
    const visibility: VisibilityConfiguration = {
      ...DEFAULT_VISIBILITY,
      ...input.visibility,
      showCustomerPrice: input.visibility?.showCustomerPrice ?? input.customerVisibility?.price ?? true,
      showConsumption: input.visibility?.showConsumption ?? input.customerVisibility?.consumption ?? true,
      showInternalCost: input.visibility?.showInternalCost ?? false,
      showMargin: input.visibility?.showMargin ?? false,
    };
    const now = Date.now();
    const material: ConfiguredMaterial = {
      ...input,
      tenantId,
      name: input.name.trim(),
      unit: input.unit?.trim() || unitId,
      unitId,
      currency: input.currency || currency,
      costType,
      internalUnitCost: roundCatalogMoney(Number(input.internalUnitCost || input.costConfiguration?.internalCost || 0)),
      customerUnitPrice: roundCatalogMoney(Number(input.customerUnitPrice || input.costConfiguration?.customerPrice || 0)),
      costConfiguration: {
        type: costType,
        internalCost: roundCatalogMoney(Number(input.internalUnitCost || input.costConfiguration?.internalCost || 0)),
        customerPrice: roundCatalogMoney(Number(input.customerUnitPrice || input.costConfiguration?.customerPrice || 0)),
        currency: input.currency || currency,
        unitId,
        tiers: input.costConfiguration?.tiers,
      },
      consumptionRule: input.consumptionRule,
      visibility,
      customerVisibility: {
        price: visibility.showCustomerPrice,
        consumption: visibility.showConsumption,
        subtotal: visibility.showCustomerPrice,
        total: visibility.showCustomerPrice,
      },
      active: input.active !== false,
      visibleToClient: input.visibleToClient === true,
      clientLabel: input.clientLabel,
      updatedBy: input.updatedBy,
    };
    const index = config.materials.findIndex((m) => m.materialId === material.materialId);
    if (index >= 0) config.materials[index] = material;
    else {
      if (!material.materialId) material.materialId = randomUUID();
      config.materials.push(material);
    }
    config.updatedAt = now;
    await this.repo.saveConfig(config);
    return material;
  }

  calculateQuote(input: {
    tenant: Tenant;
    config: TenantConfig;
    lines: CatalogLineInput[];
  }): { lines: CalculatedCatalogLine[]; totals: { internal: number; customer: number }; currency: string } {
    const currency = resolveConfiguredCurrency({
      currency: input.tenant.currency || input.tenant.identity?.currency,
    });
    const calculated: CalculatedCatalogLine[] = [];
    for (const line of input.lines) {
      calculated.push(this.quoteOne(input.tenant.tenantId, input.config, line, currency));
    }
    const totals = {
      internal: roundCatalogMoney(calculated.reduce((s, l) => s + l.calculatedInternalCost, 0)),
      customer: roundCatalogMoney(calculated.reduce((s, l) => s + l.calculatedCustomerAmount, 0)),
    };
    return { lines: calculated, totals, currency };
  }

  toConsumption(line: CalculatedCatalogLine): MaterialConsumption {
    return calculateConsumptionLine({
      lineId: line.lineId,
      materialId: line.materialId,
      name: line.name,
      discipline: line.rubricId,
      unit: line.unit,
      unitId: line.unitId,
      quantity: line.consumption,
      requestedQuantity: line.requestedQuantity,
      consumption: line.consumption,
      calculationSource: line.calculationSource,
      costType: line.costType,
      currency: line.currency,
      productId: line.productId,
      internalUnitCost: line.internalUnitCost,
      customerUnitPrice: line.customerUnitPrice,
      snapshot: {
        materialId: line.materialId,
        name: line.name,
        unitId: line.unitId,
        unit: line.unit,
        requestedQuantity: line.requestedQuantity,
        consumption: line.consumption,
        internalUnitCost: line.internalUnitCost,
        customerUnitPrice: line.customerUnitPrice,
        currency: line.currency,
        costType: line.costType,
        rule: line.rule,
        capturedAt: Date.now(),
      },
    });
  }

  async confirmOrderLines(
    tenantId: string,
    orderId: string,
    lines: CatalogLineInput[],
    claimedTotal?: number,
    options?: { allowFrozenReplace?: boolean }
  ): Promise<PersistedOrder> {
    if (!this.orders) throw new Error('Order service unavailable');
    const tenant = await this.repo.getTenant();
    if (!tenant || tenant.tenantId !== tenantId) throw new AccessDeniedError();
    const existing = await this.orders.getOrder(orderId, 'admin');
    if (existing?.economicSnapshot?.frozen && !options?.allowFrozenReplace) {
      throw new RequestInvalidError('PRICE_FROZEN');
    }
    const config = await this.requireConfig(tenantId);
    const quote = this.calculateQuote({ tenant, config, lines });
    if (claimedTotal != null && roundCatalogMoney(Number(claimedTotal)) !== quote.totals.customer) {
      /* backend wins — ignore claimed total */
    }
    const consumptions = quote.lines.map((l) => this.toConsumption(l));
    const saved = await this.orders.replaceConsumptions(
      orderId,
      consumptions,
      {
        currency: quote.currency,
        capturedAt: Date.now(),
        totals: quote.totals,
      },
      { allowFrozenReplace: !!options?.allowFrozenReplace }
    );
    return saved;
  }

  redactMaterial(ctx: AuthContext, material: ConfiguredMaterial, viewer: 'admin' | 'subadmin' | 'customer') {
    const includeInternal = viewer !== 'customer' && can(ctx, 'costs.view') && can(ctx, 'sensitive_data.view');
    const includePrice = viewer === 'customer' ? material.visibility?.showCustomerPrice !== false : can(ctx, 'costs.view') || can(ctx, 'materials.view');
    if (viewer === 'customer') {
      return publicMaterialView(
        {
          materialId: material.materialId,
          name: material.displayName || material.name,
          unit: material.unit,
          unitId: material.unitId,
          customerUnitPrice: material.customerUnitPrice,
          internalUnitCost: material.internalUnitCost,
          visibility: material.visibility,
        },
        { includeInternal: false, includePrice }
      );
    }
    const copy: ConfiguredMaterial = { ...material };
    if (!includeInternal) {
      copy.internalUnitCost = 0;
      if (copy.costConfiguration) copy.costConfiguration = { ...copy.costConfiguration, internalCost: 0 };
    }
    if (!can(ctx, 'costs.view')) {
      copy.customerUnitPrice = 0;
      if (copy.costConfiguration) copy.costConfiguration = { ...copy.costConfiguration, customerPrice: 0, internalCost: 0 };
    }
    return copy;
  }

  private quoteOne(
    tenantId: string,
    config: TenantConfig,
    line: CatalogLineInput,
    currency: string
  ): CalculatedCatalogLine {
    const product = line.productId ? (config.products || []).find((p) => p.productId === line.productId) : undefined;
    if (line.productId && !product) throw new Error('PRODUCT_NOT_FOUND');
    if (product && product.active === false) throw new Error('PRODUCT_INACTIVE');
    const materialId = line.materialId || product?.materialIds?.[0];
    const material = (config.materials || []).find((m) => m.materialId === materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');
    if (material.active === false || material.available === false) throw new Error('MATERIAL_INACTIVE');
    if (material.tenantId && material.tenantId !== tenantId) throw new AccessDeniedError();
    const normalized = this.normalizeMaterial(tenantId, material, config);
    const unitId = resolveUnitId(normalized.unitId || normalized.unit);
    const rule = (product?.consumptionRule || normalized.consumptionRule) as ConsumptionRule | undefined;
    const requested = roundQuantity(Number(line.requestedQuantity) || 0);
    const { consumption, source } = calculateConsumption(requested, rule, line.consumptionQuantity);
    const costType = (normalized.costType || normalized.costConfiguration?.type || defaultCostTypeForUnit(unitId)) as CostType;
    const amounts = calculateLineAmounts({
      costType,
      consumption,
      requestedQuantity: requested,
      internalCost: normalized.internalUnitCost,
      customerPrice: normalized.customerUnitPrice,
      tiers: normalized.costConfiguration?.tiers,
    });
    return {
      lineId: randomUUID(),
      materialId: normalized.materialId,
      productId: product?.productId,
      name: normalized.displayName || normalized.name,
      rubricId: normalized.disciplineId,
      unitId,
      unit: unitId,
      requestedQuantity: requested,
      consumption,
      costType,
      currency: normalized.currency || currency,
      calculationSource: source,
      rule,
      ...amounts,
    };
  }

  private normalizeMaterial(tenantId: string, material: ConfiguredMaterial, config: TenantConfig): ConfiguredMaterial {
    const unitId = resolveUnitId(material.unitId || material.unit);
    const currency = resolveConfiguredCurrency({
      currency: material.currency || config.identity?.currency || config.currency,
    });
    return {
      ...material,
      tenantId: material.tenantId || tenantId,
      unit: unitId,
      unitId,
      currency,
      costType: material.costType || material.costConfiguration?.type || defaultCostTypeForUnit(unitId),
      visibility: {
        ...DEFAULT_VISIBILITY,
        ...material.visibility,
        showCustomerPrice: material.visibility?.showCustomerPrice ?? material.customerVisibility?.price ?? true,
        showConsumption: material.visibility?.showConsumption ?? material.customerVisibility?.consumption ?? true,
      },
    };
  }

  private async requireConfig(tenantId: string): Promise<TenantConfig> {
    const config = await this.repo.getConfig(tenantId);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    return config;
  }
}
