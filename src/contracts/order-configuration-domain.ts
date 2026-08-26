import { RequestInvalidError } from './configuration-schema';
import type { FamilyStyleConfig, OrderCollarId, OrderFabricId, OrderSleeveId } from './garment-family-style';

/** EMPAQUETAR — configuración de pedido (talles, TPU, láser). No es un producto ORA independiente. */
export const GARMENT_TYPES = ['CAMISETA', 'SHORT'] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

export type SizeTableSource = 'REFERENCE' | 'CUSTOM';

export interface SizeEntry {
  id: string;
  sizeTableId: string;
  label: string;
  chest_cm?: number;
  hip_cm?: number;
  length_cm?: number;
  waist_cm?: number;
  sortOrder: number;
}

export interface SizeTable {
  id: string;
  workshopId: string | null;
  name: string;
  brand: string;
  garmentType: GarmentType;
  source: SizeTableSource;
  isEditable: boolean;
  entries: SizeEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface SizeTableSnapshot {
  id: string;
  name: string;
  brand: string;
  garmentType: GarmentType;
  source: SizeTableSource;
  entries: SizeEntry[];
  capturedAt: number;
}

/** Capacidad TPU ORA persistida en config de taller. No es un motor EMPAQUETAR separado. */
export interface TPUAdminConfig {
  id: string;
  workshopId: string;
  maxWidth_mm: number;
  maxHeight_mm: number;
  defaultWidth_mm: number;
  defaultHeight_mm: number;
  laserUnitPrice: number;
  unit?: 'mm';
  enabled?: boolean;
  updatedAt: number;
}

export interface TPUOrderConfig {
  width_mm: number;
  height_mm: number;
  adminLimitSnapshot?: Pick<TPUAdminConfig, 'maxWidth_mm' | 'maxHeight_mm' | 'updatedAt'>;
}

export interface LaserOrderConfig {
  enabled: boolean;
  confirmed: boolean;
  notes?: string;
  unitPrice?: number;
  costSnapshot?: { unitPrice: number; amount: number; capturedAt: number };
}

export interface GarmentConfigItem {
  name: string;
  number?: string;
  sizeLabel: string;
  quantity: number;
  garmentType: GarmentType;
  sizeTableId: string;
}

export interface GarmentFamilySnapshot {
  garmentType: GarmentType;
  sizeTableId: string;
  sizeTableSnapshot: SizeTableSnapshot;
  moldeId?: string;
  style?: FamilyStyleConfig;
}

export interface GarmentConfig {
  garmentType?: GarmentType;
  sizeTableId?: string;
  sizeTableSnapshot?: SizeTableSnapshot;
  selectedGarmentTypes?: GarmentType[];
  families?: GarmentFamilySnapshot[];
  items: GarmentConfigItem[];
}

export interface Preview3DDecision {
  status: 'APPROVED' | 'REJECTED' | 'RAW';
  at: number;
  actorId: string;
  note?: string;
}

export interface ViewerOrderParams {
  ready: boolean;
  pendingReasons: string[];
  moldId?: string;
  talle?: string;
  categoria?: 'adulto' | 'infantil';
  fabricId?: string;
  designUrl?: string;
  tpu?: { width_mm: number; height_mm: number };
  garmentType?: GarmentType;
  collarId?: OrderCollarId;
  sleeveId?: OrderSleeveId;
  colors?: FamilyStyleConfig['colors'];
}

export const LASER_MATERIAL_ID = 'laser:registro';

export const DEFAULT_TPU_LIMITS: Omit<TPUAdminConfig, 'id' | 'workshopId' | 'updatedAt'> = {
  maxWidth_mm: 1600,
  maxHeight_mm: 2000,
  defaultWidth_mm: 300,
  defaultHeight_mm: 400,
  laserUnitPrice: 0,
  unit: 'mm',
  enabled: true,
};

const MOLDE_TALLE = new Set(['S', 'M', 'L', 'XL', 'XXL', 'T4', 'T6', 'T8', 'T10', 'T12', 'T14']);

export function isGarmentType(raw: string): raw is GarmentType {
  return (GARMENT_TYPES as readonly string[]).includes(raw);
}

export function parseGarmentType(raw: string): GarmentType | undefined {
  const n = String(raw || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');
  if (!n) return undefined;
  if (n === 'CAMISETA' || n === 'CAMISETAS' || n === 'REMERA' || n === 'REMERAS' || n === 'TSHIRT') return 'CAMISETA';
  if (n === 'SHORT' || n === 'SHORTS') return 'SHORT';
  return isGarmentType(n) ? n : undefined;
}

export function snapshotSizeTable(table: SizeTable, now = Date.now()): SizeTableSnapshot {
  return {
    id: table.id,
    name: table.name,
    brand: table.brand,
    garmentType: table.garmentType,
    source: table.source,
    entries: table.entries.map((e) => ({ ...e })),
    capturedAt: now,
  };
}

export function findSizeLabel(snapshot: SizeTableSnapshot | undefined, label: string): SizeEntry | undefined {
  const wanted = String(label || '').trim().toUpperCase();
  return (snapshot?.entries || []).find((e) => e.label.trim().toUpperCase() === wanted);
}

export function assertTpuDimensions(
  width_mm: unknown,
  height_mm: unknown,
  limits: { maxWidth_mm: number; maxHeight_mm: number }
): { width_mm: number; height_mm: number } {
  const width = Number(width_mm);
  const height = Number(height_mm);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RequestInvalidError('TPU_INVALID');
  if (width <= 0 || height <= 0) throw new RequestInvalidError('TPU_INVALID');
  if (width > limits.maxWidth_mm || height > limits.maxHeight_mm) throw new RequestInvalidError('TPU_LIMIT_EXCEEDED');
  return { width_mm: Math.round(width * 100) / 100, height_mm: Math.round(height * 100) / 100 };
}

export function moldIdForGarment(type?: GarmentType): string | undefined {
  if (type === 'CAMISETA') return 'camiseta';
  if (type === 'SHORT') return 'short';
  return undefined;
}

export function fabricIdFromMaterial(name?: string): string {
  const n = String(name || '').toLowerCase();
  if (n.includes('dry') || n.includes('drifit') || n.includes('dri-fit')) return 'dry-fit';
  return 'dry-fit';
}

export function orderToViewerParams(input: {
  garmentType?: string;
  sizeLabel?: string;
  materialName?: string;
  designUrl?: string;
  tpu?: { width_mm?: number; height_mm?: number };
  collarId?: string;
  sleeveId?: string;
  fabricId?: string;
  colors?: FamilyStyleConfig['colors'];
}): ViewerOrderParams {
  const pending: string[] = [];
  const garmentType = isGarmentType(String(input.garmentType || '')) ? (input.garmentType as GarmentType) : undefined;
  const moldId = moldIdForGarment(garmentType);
  if (!moldId) pending.push('garmentType');
  const label = String(input.sizeLabel || '').trim().toUpperCase();
  const talle = MOLDE_TALLE.has(label) ? label : undefined;
  if (!talle) pending.push('talle');
  const categoria = talle && talle.startsWith('T') ? 'infantil' : 'adulto';
  const tpuReady = Number(input.tpu?.width_mm) > 0 && Number(input.tpu?.height_mm) > 0;
  if (!tpuReady) pending.push('tpu');
  const fabricId = (input.fabricId as OrderFabricId | undefined) || fabricIdFromMaterial(input.materialName);
  return {
    ready: pending.length === 0,
    pendingReasons: pending,
    moldId,
    talle,
    categoria,
    fabricId,
    designUrl: input.designUrl,
    tpu: tpuReady ? { width_mm: Number(input.tpu?.width_mm), height_mm: Number(input.tpu?.height_mm) } : undefined,
    garmentType,
    collarId: input.collarId as OrderCollarId | undefined,
    sleeveId: input.sleeveId as OrderSleeveId | undefined,
    colors: input.colors,
  };
}

function entry(tableId: string, label: string, sort: number, measures: Partial<SizeEntry>): SizeEntry {
  return { id: `${tableId}:${label}`, sizeTableId: tableId, label, sortOrder: sort, ...measures };
}

export function referenceSizeTables(now = 0): SizeTable[] {
  const camiseta: SizeTable = {
    id: 'ref-camiseta-estandar',
    workshopId: null,
    name: 'Camiseta referencia estándar',
    brand: 'REFERENCIA',
    garmentType: 'CAMISETA',
    source: 'REFERENCE',
    isEditable: false,
    createdAt: now,
    updatedAt: now,
    entries: [
      entry('ref-camiseta-estandar', 'S', 1, { chest_cm: 50, length_cm: 68, waist_cm: 48 }),
      entry('ref-camiseta-estandar', 'M', 2, { chest_cm: 54, length_cm: 70, waist_cm: 52 }),
      entry('ref-camiseta-estandar', 'L', 3, { chest_cm: 58, length_cm: 72, waist_cm: 56 }),
      entry('ref-camiseta-estandar', 'XL', 4, { chest_cm: 62, length_cm: 74, waist_cm: 60 }),
    ],
  };
  const short: SizeTable = {
    id: 'ref-short-estandar',
    workshopId: null,
    name: 'Short referencia estándar',
    brand: 'REFERENCIA',
    garmentType: 'SHORT',
    source: 'REFERENCE',
    isEditable: false,
    createdAt: now,
    updatedAt: now,
    entries: [
      entry('ref-short-estandar', 'S', 1, { waist_cm: 38, hip_cm: 50, length_cm: 42 }),
      entry('ref-short-estandar', 'M', 2, { waist_cm: 40, hip_cm: 52, length_cm: 44 }),
      entry('ref-short-estandar', 'L', 3, { waist_cm: 42, hip_cm: 54, length_cm: 46 }),
      entry('ref-short-estandar', 'XL', 4, { waist_cm: 44, hip_cm: 56, length_cm: 48 }),
    ],
  };
  return [camiseta, short];
}

export interface WorkshopOrderConfigurationState {
  sizeTables: SizeTable[];
  tpu: TPUAdminConfig;
}

export function readWorkshopOrderConfiguration(config: { tenantId: string; config?: Record<string, unknown> }): WorkshopOrderConfigurationState {
  const raw = (config.config?.orderConfiguration || {}) as Partial<WorkshopOrderConfigurationState>;
  const custom = Array.isArray(raw.sizeTables) ? raw.sizeTables.filter((t) => t && t.source === 'CUSTOM' && t.workshopId === config.tenantId) : [];
  const tpu = raw.tpu && raw.tpu.workshopId === config.tenantId
    ? raw.tpu
    : {
        id: `tpu:${config.tenantId}`,
        workshopId: config.tenantId,
        ...DEFAULT_TPU_LIMITS,
        updatedAt: 0,
      };
  return { sizeTables: custom, tpu };
}

export function writeWorkshopOrderConfiguration(
  config: { config?: Record<string, unknown> },
  next: WorkshopOrderConfigurationState
): Record<string, unknown> {
  return { ...(config.config || {}), orderConfiguration: next };
}
