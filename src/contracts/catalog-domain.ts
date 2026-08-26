import { roundMoney } from './order-lifecycle';

/** Shared money precision for calculation, persistence, and display. */
export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 4;

export function roundQuantity(value: number): number {
  const f = 10 ** QUANTITY_SCALE;
  return Math.round(Number(value) * f) / f;
}

export function roundCatalogMoney(value: number): number {
  return roundMoney(value);
}

export type UnitDimension = 'count' | 'length' | 'area' | 'mass' | 'volume' | 'other';

export interface CatalogUnit {
  unitId: string;
  code: string;
  label: string;
  dimension: UnitDimension;
}

export const DEFAULT_UNIT_CATALOG: CatalogUnit[] = [
  { unitId: 'UNIT', code: 'UNIT', label: 'Unidad', dimension: 'count' },
  { unitId: 'M', code: 'M', label: 'Metro', dimension: 'length' },
  { unitId: 'M2', code: 'M2', label: 'Metro cuadrado', dimension: 'area' },
  { unitId: 'CM', code: 'CM', label: 'Centímetro', dimension: 'length' },
  { unitId: 'KG', code: 'KG', label: 'Kilogramo', dimension: 'mass' },
  { unitId: 'L', code: 'L', label: 'Litro', dimension: 'volume' },
  { unitId: 'SET', code: 'SET', label: 'Set', dimension: 'count' },
];

const UNIT_ALIASES: Record<string, string> = {
  UNIT: 'UNIT',
  UNIDAD: 'UNIT',
  U: 'UNIT',
  HOJA: 'UNIT',
  M: 'M',
  METRO: 'M',
  M2: 'M2',
  CM: 'CM',
  KG: 'KG',
  L: 'L',
  LITRO: 'L',
  SET: 'SET',
};

export function resolveUnitId(code: string | undefined): string {
  const key = String(code || 'UNIT').trim().toUpperCase();
  return UNIT_ALIASES[key] || key;
}

export type CostType = 'PER_UNIT' | 'PER_METER' | 'PER_M2' | 'FIXED' | 'TIERED';

export interface PriceTier {
  min: number;
  max?: number;
  internalCost: number;
  customerPrice: number;
}

export interface CostConfiguration {
  type: CostType;
  internalCost: number;
  customerPrice: number;
  currency: string;
  unitId: string;
  tiers?: PriceTier[];
}

export type ConsumptionKind = 'FIXED' | 'PER_UNIT' | 'PROPORTIONAL' | 'LENGTH' | 'AREA';

export interface ConsumptionRule {
  kind: ConsumptionKind;
  /** Material units consumed per requested product unit. */
  rate?: number;
  fixedQuantity?: number;
}

export type ProductFieldType = 'text' | 'number' | 'select' | 'multiselect' | 'boolean' | 'textarea';

export interface ProductDynamicField {
  id: string;
  type: ProductFieldType | string;
  label: string;
  placeholder?: string;
  required: boolean;
  visibleToClient: boolean;
  options?: string[];
  defaultValue?: string | number | boolean | null;
  order: number;
}

export interface VisibilityConfiguration {
  showConsumption: boolean;
  showCustomerPrice: boolean;
  showInternalCost: boolean;
  showMargin: boolean;
}

export const DEFAULT_VISIBILITY: VisibilityConfiguration = {
  showConsumption: true,
  showCustomerPrice: true,
  showInternalCost: false,
  showMargin: false,
};

export interface CatalogProduct {
  productId: string;
  tenantId: string;
  rubricId: string;
  name: string;
  description?: string;
  active: boolean;
  schemaId?: string;
  materialIds?: string[];
  processIds?: string[];
  unitId?: string;
  consumptionRule?: ConsumptionRule;
  metadata?: Record<string, string | number | boolean | null>;
  visibleToClient?: boolean;
  displayOrder?: number;
  fields?: ProductDynamicField[];
  clientDescription?: string;
  updatedBy?: string;
  basePrice?: number;
  priceType?: CostType;
  internalCost?: number;
  margin?: number;
  costBreakdown?: Record<string, unknown>;
  supplierPrice?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogLineInput {
  materialId: string;
  productId?: string;
  /** Requested product/order quantity (e.g. 50 shirts). */
  requestedQuantity: number;
  /** Explicit material consumption when not derived from a rule. */
  consumptionQuantity?: number;
  /** Ignored by the engine; catalog prices always win. */
  customerPrice?: number;
  internalCost?: number;
  total?: number;
}

export interface CalculatedCatalogLine {
  lineId: string;
  materialId: string;
  productId?: string;
  name: string;
  rubricId: string;
  unitId: string;
  unit: string;
  requestedQuantity: number;
  consumption: number;
  costType: CostType;
  currency: string;
  calculationSource: 'rule' | 'explicit' | 'quantity';
  internalUnitCost: number;
  customerUnitPrice: number;
  calculatedInternalCost: number;
  calculatedCustomerAmount: number;
  rule?: ConsumptionRule;
}

export function defaultCostTypeForUnit(unitId: string): CostType {
  const id = resolveUnitId(unitId);
  if (id === 'M') return 'PER_METER';
  if (id === 'M2') return 'PER_M2';
  return 'PER_UNIT';
}

export function calculateConsumption(
  requestedQuantity: number,
  rule: ConsumptionRule | undefined,
  explicitConsumption?: number
): { consumption: number; source: CalculatedCatalogLine['calculationSource'] } {
  const qty = roundQuantity(Number(requestedQuantity) || 0);
  if (explicitConsumption != null && Number.isFinite(Number(explicitConsumption))) {
    return { consumption: roundQuantity(Number(explicitConsumption)), source: 'explicit' };
  }
  if (!rule) return { consumption: qty, source: 'quantity' };
  if (rule.kind === 'FIXED' && rule.fixedQuantity != null) {
    return { consumption: roundQuantity(rule.fixedQuantity), source: 'rule' };
  }
  const rate = Number(rule.rate);
  if (Number.isFinite(rate)) {
    return { consumption: roundQuantity(qty * rate), source: 'rule' };
  }
  return { consumption: qty, source: 'quantity' };
}

export function pickTier(tiers: PriceTier[] | undefined, requestedQuantity: number): PriceTier | undefined {
  if (!tiers?.length) return undefined;
  const qty = Number(requestedQuantity);
  return (
    tiers.find((t) => qty >= t.min && (t.max == null || qty <= t.max)) ||
    tiers[tiers.length - 1]
  );
}

export function calculateLineAmounts(input: {
  costType: CostType;
  consumption: number;
  requestedQuantity: number;
  internalCost: number;
  customerPrice: number;
  tiers?: PriceTier[];
}): { internalUnitCost: number; customerUnitPrice: number; calculatedInternalCost: number; calculatedCustomerAmount: number } {
  let internalUnit = Number(input.internalCost) || 0;
  let customerUnit = Number(input.customerPrice) || 0;
  if (input.costType === 'TIERED') {
    const tier = pickTier(input.tiers, input.requestedQuantity);
    if (tier) {
      internalUnit = Number(tier.internalCost);
      customerUnit = Number(tier.customerPrice);
    }
  }
  const basis =
    input.costType === 'FIXED'
      ? Math.max(1, Number(input.requestedQuantity) || 1)
      : Number(input.consumption);
  return {
    internalUnitCost: roundCatalogMoney(internalUnit),
    customerUnitPrice: roundCatalogMoney(customerUnit),
    calculatedInternalCost: roundCatalogMoney(basis * internalUnit),
    calculatedCustomerAmount: roundCatalogMoney(basis * customerUnit),
  };
}

export function publicMaterialView(
  material: {
    materialId: string;
    name: string;
    unit: string;
    unitId?: string;
    customerUnitPrice: number;
    internalUnitCost: number;
    visibility?: VisibilityConfiguration;
  },
  opts: { includeInternal: boolean; includePrice: boolean }
) {
  const vis = { ...DEFAULT_VISIBILITY, ...material.visibility };
  const view: Record<string, unknown> = {
    materialId: material.materialId,
    name: material.name,
    unit: material.unitId || material.unit,
  };
  if (opts.includePrice && vis.showCustomerPrice) view.customerPrice = material.customerUnitPrice;
  if (opts.includeInternal && vis.showInternalCost) view.internalCost = material.internalUnitCost;
  return view;
}
