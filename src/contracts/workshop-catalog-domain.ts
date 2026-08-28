import { defaultCostTypeForUnit, resolveUnitId, type CostType } from './catalog-domain';

export const WORKSHOP_CATEGORIES = [
  'SUBLIMACION',
  'DTF_TEXTIL',
  'UV_DTF',
  'BORDADO',
  'GRAN_FORMATO',
  'TPU',
  'OTRO',
] as const;
export type WorkshopCategory = (typeof WORKSHOP_CATEGORIES)[number];

export function isWorkshopCategory(raw: string): raw is WorkshopCategory {
  return (WORKSHOP_CATEGORIES as readonly string[]).includes(raw);
}

export interface WorkshopCatalogItem {
  itemId: string;
  tenantId: string;
  category: WorkshopCategory;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  unit: string;
  stockEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  productKey?: string;
  previewMode?: '2D' | '3D';
  family?: string;
  moldId?: string;
}

export interface WorkshopCatalogSnapshotLine {
  itemId: string;
  category: WorkshopCategory;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  unit: string;
  quantity: number;
}

export interface WorkshopLibrarySeed {
  key: string;
  category: WorkshopCategory;
  name: string;
  unit: string;
  description: string;
}

/** Initial offer library. Items stay hidden until the workshop enables the category. */
export const DEFAULT_WORKSHOP_LIBRARY: WorkshopLibrarySeed[] = [
  { key: 'tpu', category: 'TPU', name: 'TPU', unit: 'M', description: 'Film TPU' },
  { key: 'dtf', category: 'DTF_TEXTIL', name: 'DTF', unit: 'M2', description: 'DTF textil' },
  { key: 'dtf-uv', category: 'UV_DTF', name: 'DTF UV', unit: 'M2', description: 'DTF UV' },
  { key: 'set-deportivo', category: 'SUBLIMACION', name: 'Conjunto deportivo', unit: 'UNIDAD', description: 'Conjunto deportivo' },
  { key: 'cordura', category: 'OTRO', name: 'Cordura', unit: 'M', description: 'Cordura' },
  { key: 'bordado', category: 'BORDADO', name: 'Bordado', unit: 'UNIDAD', description: 'Bordado' },
  { key: 'tropical-mecanico', category: 'SUBLIMACION', name: 'Tropical mecánico', unit: 'M', description: 'Tropical mecánico' },
  { key: 'drifit', category: 'SUBLIMACION', name: 'Drifit', unit: 'M', description: 'Drifit' },
  { key: 'sublimacion', category: 'SUBLIMACION', name: 'Sublimación', unit: 'M', description: 'Sublimación' },
];

export function workshopMaterialId(itemId: string): string {
  return `ws:${itemId}`;
}

export function workshopItemIdFromMaterial(materialId: string): string | undefined {
  return materialId.startsWith('ws:') ? materialId.slice(3) : undefined;
}

export function categoryToDiscipline(category: WorkshopCategory): string {
  if (category === 'TPU') return 'tpu';
  if (category === 'DTF_TEXTIL' || category === 'UV_DTF') return 'dtf';
  return 'textile';
}

export function workshopCostType(unit: string): CostType {
  return defaultCostTypeForUnit(resolveUnitId(unit));
}

export function libraryItemId(key: string): string {
  return `lib:${key}`;
}
