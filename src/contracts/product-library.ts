import type { WorkshopCategory, WorkshopLibrarySeed } from './workshop-catalog-domain';
import type { GarmentType } from './order-configuration-domain';
import type { OrderCollarId, OrderSleeveId } from './garment-family-style';
import type { OjoSession } from './visual-interpreter';

/** Adaptive preview: 2D is the default. 3D only when volume/shape/distribution matter. */
export type PreviewMode = '2D' | '3D';

export type ProductFamily =
  | 'CAMISETA'
  | 'SHORT'
  | 'CALZA'
  | 'BERMUDA'
  | 'CONJUNTO'
  | 'PECHERA'
  | 'CUBREMALETAS'
  | 'PLANAR'
  | 'MATERIAL';

export interface ProductLibraryEntry {
  id: string;
  /** Stable workshop library key (`lib:${catalogKey}`). */
  catalogKey: string;
  name: string;
  category: WorkshopCategory;
  family: ProductFamily;
  previewMode: PreviewMode;
  unit: string;
  description: string;
  /** Existing mold id. Prefer `extends` aliases — do not invent measurements. */
  moldId?: string;
  /** Existing size-table garment type only (CAMISETA | SHORT). */
  garmentType?: GarmentType;
  defaultCollarId?: OrderCollarId;
  defaultSleeveId?: OrderSleeveId;
  printSurfaces?: string[];
  applicationZones?: string[];
  orientation?: 'upright' | 'planar';
  pieces?: string[];
  attributes?: Record<string, unknown>;
  /** Names or catalog keys that represent the same piece. */
  aliases?: string[];
}

function planar(partial: Omit<ProductLibraryEntry, 'previewMode' | 'family' | 'orientation' | 'unit'> & {
  unit?: string;
}): ProductLibraryEntry {
  return {
    family: 'PLANAR',
    previewMode: '2D',
    orientation: 'planar',
    unit: partial.unit || 'UNIDAD',
    printSurfaces: ['frente-plano'],
    applicationZones: ['superficie'],
    ...partial,
  };
}

function apparel3d(
  partial: Omit<ProductLibraryEntry, 'previewMode' | 'orientation' | 'unit' | 'category'> & {
    category?: WorkshopCategory;
    unit?: string;
  }
): ProductLibraryEntry {
  return {
    category: partial.category || 'SUBLIMACION',
    previewMode: '3D',
    orientation: 'upright',
    unit: partial.unit || 'UNIDAD',
    printSurfaces: partial.printSurfaces || ['frente'],
    applicationZones: partial.applicationZones || ['frente'],
    ...partial,
  };
}

function material2d(partial: Omit<ProductLibraryEntry, 'previewMode' | 'family' | 'orientation'>): ProductLibraryEntry {
  return {
    family: 'MATERIAL',
    previewMode: '2D',
    orientation: 'planar',
    printSurfaces: ['superficie'],
    applicationZones: ['superficie'],
    ...partial,
  };
}

/**
 * Parametrizable product library. One schema, many products.
 * Size tables reuse the existing CAMISETA / SHORT references — no invented cm.
 */
export const PRODUCT_LIBRARY: ProductLibraryEntry[] = [
  material2d({
    id: 'tpu',
    catalogKey: 'tpu',
    name: 'TPU',
    category: 'TPU',
    unit: 'M',
    description: 'Film TPU',
  }),
  material2d({
    id: 'dtf',
    catalogKey: 'dtf',
    name: 'DTF',
    category: 'DTF_TEXTIL',
    unit: 'M2',
    description: 'DTF textil',
  }),
  material2d({
    id: 'dtf-uv',
    catalogKey: 'dtf-uv',
    name: 'DTF UV',
    category: 'UV_DTF',
    unit: 'M2',
    description: 'DTF UV',
  }),
  material2d({
    id: 'cordura',
    catalogKey: 'cordura',
    name: 'Cordura',
    category: 'OTRO',
    unit: 'M',
    description: 'Cordura',
  }),
  material2d({
    id: 'bordado',
    catalogKey: 'bordado',
    name: 'Bordado',
    category: 'BORDADO',
    unit: 'UNIDAD',
    description: 'Bordado',
  }),
  material2d({
    id: 'tropical-mecanico',
    catalogKey: 'tropical-mecanico',
    name: 'Tropical mecánico',
    category: 'SUBLIMACION',
    unit: 'M',
    description: 'Tropical mecánico',
  }),
  material2d({
    id: 'drifit',
    catalogKey: 'drifit',
    name: 'Drifit',
    category: 'SUBLIMACION',
    unit: 'M',
    description: 'Drifit',
  }),
  material2d({
    id: 'sublimacion',
    catalogKey: 'sublimacion',
    name: 'Sublimación',
    category: 'SUBLIMACION',
    unit: 'M',
    description: 'Sublimación',
  }),

  planar({
    id: 'bandera',
    catalogKey: 'bandera',
    name: 'Bandera',
    category: 'SUBLIMACION',
    description: 'Superficie plana — bandera',
  }),
  planar({
    id: 'tiras',
    catalogKey: 'tiras',
    name: 'Tiras',
    category: 'SUBLIMACION',
    description: 'Piezas planas / tiras',
    aliases: ['tiras / piezas planas', 'piezas planas'],
  }),
  planar({
    id: 'panos',
    catalogKey: 'panos',
    name: 'Paños',
    category: 'SUBLIMACION',
    description: 'Paños planos',
  }),
  planar({
    id: 'manta-playera',
    catalogKey: 'manta-playera',
    name: 'Manta playera',
    category: 'SUBLIMACION',
    description: 'Manta playera plana',
  }),
  planar({
    id: 'cubrecama',
    catalogKey: 'cubrecama',
    name: 'Cubrecama',
    category: 'SUBLIMACION',
    description: 'Cubrecama plano',
  }),

  apparel3d({
    id: 'remera-cuello-redondo',
    catalogKey: 'remera-cuello-redondo',
    name: 'Remera cuello redondo',
    family: 'CAMISETA',
    moldId: 'remera-cuello-redondo',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Remera cuello redondo',
  }),
  apparel3d({
    id: 'remera-manga-corta',
    catalogKey: 'remera-manga-corta',
    name: 'Remera manga corta',
    family: 'CAMISETA',
    moldId: 'remera-manga-corta',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Remera manga corta',
  }),
  apparel3d({
    id: 'remera-manga-larga',
    catalogKey: 'remera-manga-larga',
    name: 'Remera manga larga',
    family: 'CAMISETA',
    moldId: 'remera-manga-larga',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-larga',
    description: 'Remera manga larga',
  }),
  apparel3d({
    id: 'chomba',
    catalogKey: 'chomba',
    name: 'Chomba',
    family: 'CAMISETA',
    moldId: 'chomba-clasica',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-polo',
    defaultSleeveId: 'manga-corta',
    description: 'Chomba',
  }),
  apparel3d({
    id: 'musculosa-deportiva',
    catalogKey: 'musculosa-deportiva',
    name: 'Musculosa deportiva',
    family: 'CAMISETA',
    moldId: 'musculosa-deportiva',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'sin-mangas',
    description: 'Musculosa deportiva',
  }),
  apparel3d({
    id: 'musculosa-gimnasio',
    catalogKey: 'musculosa-gimnasio',
    name: 'Musculosa de gimnasio',
    family: 'CAMISETA',
    moldId: 'musculosa-gimnasio',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'sin-mangas',
    description: 'Musculosa de gimnasio',
  }),
  apparel3d({
    id: 'remera-entrenamiento',
    catalogKey: 'remera-entrenamiento',
    name: 'Remera de entrenamiento',
    family: 'CAMISETA',
    moldId: 'remera-entrenamiento',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Remera de entrenamiento',
  }),
  apparel3d({
    id: 'camiseta-deportiva',
    catalogKey: 'camiseta-deportiva',
    name: 'Camiseta deportiva',
    family: 'CAMISETA',
    moldId: 'camiseta',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Camiseta deportiva',
  }),
  apparel3d({
    id: 'camiseta-futbol',
    catalogKey: 'camiseta-futbol',
    name: 'Camiseta de fútbol',
    family: 'CAMISETA',
    moldId: 'camiseta-futbol',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-v',
    defaultSleeveId: 'manga-corta',
    description: 'Camiseta de fútbol',
  }),
  apparel3d({
    id: 'camiseta-basquet',
    catalogKey: 'camiseta-basquet',
    name: 'Camiseta de básquet',
    family: 'CAMISETA',
    moldId: 'camiseta-basket',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'sin-mangas',
    description: 'Camiseta de básquet',
  }),
  apparel3d({
    id: 'camiseta-voley',
    catalogKey: 'camiseta-voley',
    name: 'Camiseta de vóley',
    family: 'CAMISETA',
    moldId: 'camiseta-voley',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-v',
    defaultSleeveId: 'manga-corta',
    description: 'Camiseta de vóley',
  }),
  apparel3d({
    id: 'camiseta-running',
    catalogKey: 'camiseta-running',
    name: 'Camiseta de running',
    family: 'CAMISETA',
    moldId: 'camiseta-running',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Camiseta de running',
  }),
  apparel3d({
    id: 'camiseta-ciclismo',
    catalogKey: 'camiseta-ciclismo',
    name: 'Camiseta de ciclismo',
    family: 'CAMISETA',
    moldId: 'camiseta-ciclismo',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Camiseta de ciclismo',
  }),
  apparel3d({
    id: 'calza-deportiva',
    catalogKey: 'calza-deportiva',
    name: 'Calza deportiva',
    family: 'CALZA',
    moldId: 'calza-corta',
    garmentType: 'SHORT',
    description: 'Calza deportiva',
    printSurfaces: ['panel'],
    applicationZones: ['frente-inferior'],
  }),
  apparel3d({
    id: 'calza-ciclismo',
    catalogKey: 'calza-ciclismo',
    name: 'Calza de ciclismo',
    family: 'CALZA',
    moldId: 'calza-ciclismo',
    garmentType: 'SHORT',
    description: 'Calza de ciclismo',
    printSurfaces: ['panel'],
    applicationZones: ['frente-inferior'],
  }),
  apparel3d({
    id: 'short-deportivo',
    catalogKey: 'short-deportivo',
    name: 'Short deportivo',
    family: 'SHORT',
    moldId: 'short',
    garmentType: 'SHORT',
    description: 'Short deportivo',
    printSurfaces: ['delantero'],
    applicationZones: ['frente-inferior'],
  }),
  apparel3d({
    id: 'short-futbol',
    catalogKey: 'short-futbol',
    name: 'Short de fútbol',
    family: 'SHORT',
    moldId: 'short-futbol',
    garmentType: 'SHORT',
    description: 'Short de fútbol — producto explícito, no genérico',
    printSurfaces: ['delantero'],
    applicationZones: ['frente-inferior'],
    attributes: { sport: 'futbol', differentiated: true },
  }),
  apparel3d({
    id: 'short-ciclismo',
    catalogKey: 'short-ciclismo',
    name: 'Short de ciclismo',
    family: 'SHORT',
    moldId: 'short-ciclismo',
    garmentType: 'SHORT',
    description: 'Short de ciclismo',
    printSurfaces: ['delantero'],
    applicationZones: ['frente-inferior'],
  }),
  apparel3d({
    id: 'bermuda-deportiva',
    catalogKey: 'bermuda-deportiva',
    name: 'Bermuda deportiva',
    family: 'BERMUDA',
    moldId: 'bermuda',
    garmentType: 'SHORT',
    description: 'Bermuda deportiva',
    printSurfaces: ['delantero'],
    applicationZones: ['frente-inferior'],
  }),
  apparel3d({
    id: 'conjunto-deportivo',
    catalogKey: 'set-deportivo',
    name: 'Conjunto deportivo',
    family: 'CONJUNTO',
    moldId: 'conjunto-entrenamiento',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'manga-corta',
    description: 'Conjunto deportivo',
    aliases: ['set deportivo', 'set-deportivo'],
    printSurfaces: ['frente', 'delantero'],
    applicationZones: ['frente', 'frente-inferior'],
  }),
  apparel3d({
    id: 'pechera-deportiva',
    catalogKey: 'pechera-deportiva',
    name: 'Pechera deportiva',
    family: 'PECHERA',
    moldId: 'pechera-deportiva',
    garmentType: 'CAMISETA',
    defaultCollarId: 'cuello-redondo',
    defaultSleeveId: 'sin-mangas',
    description: 'Pechera deportiva',
  }),
  apparel3d({
    id: 'cubremaletas',
    catalogKey: 'cubremaletas',
    name: 'Cubremaletas',
    family: 'CUBREMALETAS',
    moldId: 'cubremaletas',
    description: 'Cubremaletas',
    printSurfaces: ['frente'],
    applicationZones: ['superficie'],
  }),
];

const BY_ID = new Map(PRODUCT_LIBRARY.map((p) => [p.id, p]));
const BY_CATALOG_KEY = new Map(PRODUCT_LIBRARY.map((p) => [p.catalogKey, p]));
const BY_NAME = new Map<string, ProductLibraryEntry>();

function normName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

for (const product of PRODUCT_LIBRARY) {
  BY_NAME.set(normName(product.name), product);
  for (const alias of product.aliases || []) {
    BY_NAME.set(normName(alias), product);
    BY_CATALOG_KEY.set(alias, product);
  }
}

export function listProductLibrary(): ProductLibraryEntry[] {
  return [...PRODUCT_LIBRARY];
}

export function getProductById(id: string): ProductLibraryEntry | undefined {
  return BY_ID.get(String(id || '').trim());
}

export function resolveProduct(input: {
  productKey?: string;
  catalogKey?: string;
  itemId?: string;
  name?: string;
}): ProductLibraryEntry | undefined {
  const key = String(input.productKey || input.catalogKey || '').trim();
  if (key) {
    const found = BY_ID.get(key) || BY_CATALOG_KEY.get(key);
    if (found) return found;
  }
  const itemId = String(input.itemId || '').trim();
  if (itemId.startsWith('lib:')) {
    const catalogKey = itemId.slice(4);
    const found = BY_CATALOG_KEY.get(catalogKey) || BY_ID.get(catalogKey);
    if (found) return found;
  }
  const name = normName(String(input.name || ''));
  if (name) return BY_NAME.get(name);
  return undefined;
}

export function previewModeOf(product?: ProductLibraryEntry | null): PreviewMode {
  return product?.previewMode === '3D' ? '3D' : '2D';
}

export function productNeedsApparelConfig(product?: ProductLibraryEntry | null): boolean {
  if (!product) return false;
  if (product.previewMode !== '3D') return false;
  return product.family !== 'CUBREMALETAS' && product.family !== 'PLANAR' && product.family !== 'MATERIAL';
}

export function productLibrarySeeds(): WorkshopLibrarySeed[] {
  return PRODUCT_LIBRARY.map((p) => ({
    key: p.catalogKey,
    category: p.category,
    name: p.name,
    unit: p.unit,
    description: p.description,
  }));
}

/** Safe rename map: existing catalog name → canonical name for the same piece. */
export const PRODUCT_NAME_NORMALIZATIONS: Array<{ itemId?: string; from: string; to: string; productId: string }> = [
  { itemId: 'lib:set-deportivo', from: 'Set deportivo', to: 'Conjunto deportivo', productId: 'conjunto-deportivo' },
];

export function presentProduct(product: ProductLibraryEntry) {
  return {
    productKey: product.id,
    catalogKey: product.catalogKey,
    name: product.name,
    category: product.category,
    family: product.family,
    previewMode: product.previewMode,
    moldId: product.moldId || null,
    garmentType: product.garmentType || null,
    defaultCollarId: product.defaultCollarId || null,
    defaultSleeveId: product.defaultSleeveId || null,
    printSurfaces: product.printSurfaces || [],
    applicationZones: product.applicationZones || [],
    orientation: product.orientation || null,
    pieces: product.pieces || [],
    attributes: product.attributes || {},
  };
}

export interface VisualVersionInput {
  productKey?: string;
  previewMode?: PreviewMode;
  moldId?: string;
  designFileId?: string;
  sample2dFileId?: string;
  region?: unknown;
  hints?: unknown;
  transformation?: unknown;
  interpretationFileId?: string;
  garmentType?: string;
  tpu?: unknown;
  laserEnabled?: boolean;
  familyStyles?: unknown;
}

export function computeVisualVersion(input: VisualVersionInput): string {
  const payload = JSON.stringify({
    productKey: input.productKey || '',
    previewMode: input.previewMode === '3D' ? '3D' : '2D',
    moldId: input.moldId || '',
    designFileId: input.designFileId || '',
    sample2dFileId: input.sample2dFileId || '',
    region: input.region || null,
    hints: input.hints || [],
    transformation: input.transformation || null,
    interpretationFileId: input.interpretationFileId || '',
    garmentType: input.garmentType || '',
    tpu: input.tpu || null,
    laserEnabled: !!input.laserEnabled,
    familyStyles: input.familyStyles || null,
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `v1:${(hash >>> 0).toString(16)}`;
}

export function visualVersionFromForm(formValues: Record<string, unknown>): string {
  const session = (formValues.ojoSession || {}) as Partial<OjoSession>;
  const families = formValues.garmentFamilies;
  const tpu = formValues.tpuConfig as { width_mm?: number; height_mm?: number } | undefined;
  const laser = formValues.laserConfig as { enabled?: boolean } | undefined;
  return computeVisualVersion({
    productKey: formValues.productKey != null ? String(formValues.productKey) : undefined,
    previewMode: formValues.previewMode === '3D' ? '3D' : '2D',
    moldId: formValues.moldId != null ? String(formValues.moldId) : undefined,
    designFileId: formValues.designFileId != null ? String(formValues.designFileId) : undefined,
    sample2dFileId: session.sample2dFileId,
    region: session.region || null,
    hints: session.hints || [],
    transformation: session.transformation || null,
    interpretationFileId: session.current?.fileId,
    garmentType: formValues.garmentType != null ? String(formValues.garmentType) : undefined,
    tpu: tpu ? { width_mm: tpu.width_mm, height_mm: tpu.height_mm } : null,
    laserEnabled: !!laser?.enabled,
    familyStyles: Array.isArray(families)
      ? (families as Array<{ garmentType?: string; moldeId?: string; style?: unknown }>).map((f) => ({
          garmentType: f.garmentType,
          moldeId: f.moldeId,
          style: f.style || null,
        }))
      : null,
  });
}

export function approvalMatchesVisual(
  formValues: Record<string, unknown>
): { valid: boolean; current: string; approved?: string } {
  const current = visualVersionFromForm(formValues);
  const decision = formValues.preview3dDecision as { visualVersion?: string; status?: string } | undefined;
  const approved = decision?.visualVersion;
  if (!formValues.previewApproved) return { valid: false, current, approved };
  return { valid: !!approved && approved === current, current, approved };
}
