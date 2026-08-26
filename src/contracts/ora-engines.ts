import { RequestInvalidError } from './configuration-schema';
import { DESIGN_DISTRIBUTION_INFRA_CAP, distributeDesign, type DesignDistribution } from './design-distribution';
import type { OraFitness, OraPatternValidation } from './ora-core';

export interface RasterSize {
  widthPx: number;
  heightPx: number;
}

export interface PhysicalSize {
  widthMm: number;
  heightMm: number;
  unit: 'mm';
}

export function assertPhysicalSize(widthMm: number, heightMm: number): PhysicalSize {
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    throw new RequestInvalidError('ORA_INVALID_DIMENSION');
  }
  if (widthMm > 200_000 || heightMm > 200_000) {
    throw new RequestInvalidError('ORA_DIMENSION_EXTREME');
  }
  return { widthMm, heightMm, unit: 'mm' };
}

export function effectivePpi(pixels: number, mm: number): number {
  const inches = mm / 25.4;
  if (inches <= 0) return 0;
  return Math.round((pixels / inches) * 100) / 100;
}

export function flagFitness(input: {
  raster?: RasterSize;
  physical: PhysicalSize;
  keepProportion?: boolean;
  sourceIsVector?: boolean;
}): { fitness: OraFitness; ppi: { x: number; y: number }; warnings: string[] } {
  const warnings: string[] = [];
  if (input.keepProportion && input.raster) {
    const imgRatio = input.raster.widthPx / input.raster.heightPx;
    const physRatio = input.physical.widthMm / input.physical.heightMm;
    if (Math.abs(imgRatio - physRatio) / physRatio > 0.08) warnings.push('PROPORTION_MISMATCH');
  }
  if (input.sourceIsVector) {
    return { fitness: warnings.length ? 'APTO_CON_ADVERTENCIA' : 'APTO', ppi: { x: 0, y: 0 }, warnings };
  }
  if (!input.raster) {
    warnings.push('RESOLUTION_UNKNOWN');
    return { fitness: 'APTO_CON_ADVERTENCIA', ppi: { x: 0, y: 0 }, warnings };
  }
  const x = effectivePpi(input.raster.widthPx, input.physical.widthMm);
  const y = effectivePpi(input.raster.heightPx, input.physical.heightMm);
  const min = Math.min(x, y);
  if (min < 72) {
    warnings.push('RESOLUTION_INSUFFICIENT');
    return { fitness: 'NO_APTO', ppi: { x, y }, warnings };
  }
  if (min < 150) {
    warnings.push('RESOLUTION_LOW_FOR_PRODUCTION');
    return { fitness: 'APTO_CON_ADVERTENCIA', ppi: { x, y }, warnings };
  }
  return { fitness: warnings.length ? 'APTO_CON_ADVERTENCIA' : 'APTO', ppi: { x, y }, warnings };
}

export interface CandyBarSpec {
  itemWidthMm: number;
  itemHeightMm: number;
  quantity: number;
  bleedMm?: number;
  sheetWidthMm?: number;
  sheetHeightMm?: number;
}

export function composeCandyBar(spec: CandyBarSpec, raster?: RasterSize) {
  const item = assertPhysicalSize(spec.itemWidthMm, spec.itemHeightMm);
  if (!Number.isInteger(spec.quantity) || spec.quantity <= 0) throw new RequestInvalidError('ORA_INVALID_QUANTITY');
  if (spec.quantity > DESIGN_DISTRIBUTION_INFRA_CAP) throw new RequestInvalidError('ORA_BATCH_TOO_LARGE');
  const bleed = Number(spec.bleedMm || 0);
  if (bleed < 0) throw new RequestInvalidError('ORA_INVALID_DIMENSION');
  const warnings: string[] = [];
  if (bleed < 2) warnings.push('BLEED_MISSING');
  const cellW = item.widthMm + bleed * 2;
  const cellH = item.heightMm + bleed * 2;
  const sheetW = spec.sheetWidthMm && spec.sheetWidthMm > 0 ? spec.sheetWidthMm : Math.max(cellW, 330);
  const sheetH = spec.sheetHeightMm && spec.sheetHeightMm > 0 ? spec.sheetHeightMm : Math.max(cellH, 480);
  const cols = Math.max(1, Math.floor(sheetW / cellW));
  const rows = Math.max(1, Math.ceil(spec.quantity / cols));
  const neededH = rows * cellH;
  if (neededH > sheetH + 0.01) warnings.push('DIMENSION_INCOMPATIBLE');
  if (raster) {
    const fit = flagFitness({ raster, physical: item });
    warnings.push(...fit.warnings);
  }
  const placements = [];
  for (let i = 0; i < spec.quantity; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    placements.push({
      index: i + 1,
      xMm: col * cellW + bleed,
      yMm: row * cellH + bleed,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
    });
  }
  const fitness: OraFitness = warnings.includes('DIMENSION_INCOMPATIBLE') || warnings.includes('RESOLUTION_INSUFFICIENT')
    ? warnings.includes('RESOLUTION_INSUFFICIENT') && !warnings.includes('DIMENSION_INCOMPATIBLE')
      ? 'NO_APTO'
      : 'APTO_CON_ADVERTENCIA'
    : warnings.length
      ? 'APTO_CON_ADVERTENCIA'
      : 'APTO';
  return {
    item,
    quantity: spec.quantity,
    bleedMm: bleed,
    sheet: { widthMm: sheetW, heightMm: Math.max(sheetH, neededH) },
    cols,
    rows,
    placements,
    warnings,
    fitness,
  };
}

export const LUGGAGE_VIEWS = ['FRENTE', 'DORSO', 'LATERAL_DERECHO', 'LATERAL_IZQUIERDO'] as const;
export type LuggageView = (typeof LUGGAGE_VIEWS)[number];

export type LuggageVariant = 'STANDARD' | 'CARRY_ON';

export const CARRY_ON_DEFAULT = { widthMm: 550, heightMm: 400, depthMm: 200 };

export interface LuggageViewInput {
  view: LuggageView;
  fileId?: string;
  filename?: string;
  raster?: RasterSize;
}

export function assertLuggageSet(input: {
  variant?: LuggageVariant;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  views: LuggageViewInput[];
}) {
  const variant: LuggageVariant = input.variant === 'CARRY_ON' ? 'CARRY_ON' : 'STANDARD';
  const widthMm = variant === 'CARRY_ON' && !input.widthMm ? CARRY_ON_DEFAULT.widthMm : input.widthMm;
  const heightMm = variant === 'CARRY_ON' && !input.heightMm ? CARRY_ON_DEFAULT.heightMm : input.heightMm;
  const depthMm = variant === 'CARRY_ON' && !input.depthMm ? CARRY_ON_DEFAULT.depthMm : input.depthMm;
  if ([widthMm, heightMm, depthMm].some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new RequestInvalidError('ORA_INVALID_DIMENSION');
  }
  const views = input.views || [];
  const byView = new Map<string, LuggageViewInput>();
  for (const v of views) {
    if (!LUGGAGE_VIEWS.includes(v.view)) throw new RequestInvalidError('ORA_LUGGAGE_VIEW');
    if (byView.has(v.view)) throw new RequestInvalidError('ORA_LUGGAGE_DUPLICATE_VIEW');
    byView.set(v.view, v);
  }
  const missing = LUGGAGE_VIEWS.filter((v) => !byView.has(v));
  const warnings: string[] = [];
  if (missing.length) warnings.push(`MISSING_VIEWS:${missing.join(',')}`);
  const front = byView.get('FRENTE')?.raster;
  const back = byView.get('DORSO')?.raster;
  if (front && back) {
    const fr = front.widthPx / front.heightPx;
    const br = back.widthPx / back.heightPx;
    if (Math.abs(fr - br) / fr > 0.2) warnings.push('VIEW_ASPECT_CONTRADICTION');
  }
  const expectedFront = widthMm / heightMm;
  if (front) {
    const fr = front.widthPx / front.heightPx;
    if (Math.abs(fr - expectedFront) / expectedFront > 0.25) warnings.push('SCALE_ORIENTATION_MISMATCH');
  }
  const fitness: OraFitness = missing.length
    ? 'NO_APTO'
    : warnings.length
      ? 'APTO_CON_ADVERTENCIA'
      : 'APTO';
  return {
    variant,
    measures: { widthMm, heightMm, depthMm },
    sameObject: true,
    views: LUGGAGE_VIEWS.map((view) => byView.get(view) || { view }),
    missing,
    warnings,
    fitness,
  };
}

export interface PatternCatalogEntry {
  id: string;
  name: string;
  category: string;
  description?: string;
  garment?: string;
  variant?: string;
  version: string;
  units: 'cm';
  validation: OraPatternValidation;
}

export function matchPatternQuery(query: string, catalog: PatternCatalogEntry[]): Array<PatternCatalogEntry & { score: number }> {
  const q = query.trim().toLowerCase();
  if (!q) throw new RequestInvalidError('ORA_PATTERN_QUERY');
  const tokens = q.split(/[^a-z0-9áéíóúüñ]+/i).filter(Boolean);
  return catalog
    .map((entry) => {
      const hay = `${entry.id} ${entry.name} ${entry.category} ${entry.description || ''} ${entry.garment || ''}`.toLowerCase();
      const score = tokens.reduce((s, tok) => s + (hay.includes(tok) ? 1 : 0), 0);
      return { ...entry, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function parseRequestedTalle(query: string): string | undefined {
  const m = query.toUpperCase().match(/\b(XXL|XL|T1[024]|T[468]|S|M|L)\b/);
  return m?.[1];
}

export interface OraBatchUnit {
  key: string;
  quantity: number;
  garmentType?: string;
  sizeLabel?: string;
}

export function distributeOraBatch(input: {
  designFileId: string;
  units: OraBatchUnit[];
  families?: Parameters<typeof distributeDesign>[0]['families'];
  records?: Parameters<typeof distributeDesign>[0]['records'];
  selectedGarmentTypes?: Parameters<typeof distributeDesign>[0]['selectedGarmentTypes'];
}): { totalUnits: number; byKey: Record<string, number>; distribution?: DesignDistribution; warnings: string[] } {
  if (!input.designFileId) throw new RequestInvalidError('DESIGN_REQUIRED');
  const warnings: string[] = [];
  if (input.records && input.families && input.selectedGarmentTypes) {
    const distribution = distributeDesign({
      designKey: input.designFileId,
      designFileId: input.designFileId,
      selectedGarmentTypes: input.selectedGarmentTypes,
      families: input.families,
      records: input.records,
    });
    return { totalUnits: distribution.totalUnits, byKey: {}, distribution, warnings };
  }
  const byKey: Record<string, number> = {};
  let total = 0;
  const seen = new Set<string>();
  for (const unit of input.units || []) {
    const key = String(unit.key || '').trim();
    if (!key) throw new RequestInvalidError('ORA_BATCH_KEY');
    if (seen.has(key)) throw new RequestInvalidError('DUPLICATE_ROSTER_ROW');
    seen.add(key);
    const n = Number(unit.quantity);
    if (!Number.isFinite(n) || n <= 0) throw new RequestInvalidError('INVALID_QUANTITY');
    byKey[key] = Math.floor(n);
    total += Math.floor(n);
  }
  if (!total) throw new RequestInvalidError('ORA_BATCH_EMPTY');
  if (total > DESIGN_DISTRIBUTION_INFRA_CAP) throw new RequestInvalidError('ORA_BATCH_TOO_LARGE');
  warnings.push('EMPAQUETAR_MAX_UNITS_NOT_APPLIED');
  return { totalUnits: total, byKey, warnings };
}

export type OraDtfKind = 'DTF_TEXTILE' | 'DTF_UV';

export const DTF_PREP_STAGES = [
  'intake',
  'prepare',
  'transparency',
  'dimensions',
  'resolution',
  'scale',
  'compose',
  'output',
] as const;

export function prepareDtfJob(input: {
  kind: OraDtfKind;
  physical: PhysicalSize;
  raster?: RasterSize;
  transparency?: boolean;
  format?: string;
  sourceIsVector?: boolean;
}) {
  const fit = flagFitness({
    raster: input.raster,
    physical: input.physical,
    sourceIsVector: input.sourceIsVector,
  });
  const warnings = [...fit.warnings];
  if (input.transparency === false) warnings.push('BACKGROUND_NOT_TRANSPARENT');
  if (input.transparency == null) warnings.push('TRANSPARENCY_UNKNOWN');
  if (input.kind === 'DTF_TEXTILE') {
    warnings.push('WHITE_UNDERBASE_NOT_RENDERED');
  } else {
    warnings.push('WHITE_LAYER_NOT_RENDERED');
    warnings.push('UV_VARNISH_NOT_RENDERED');
    warnings.push('HARD_SURFACE_PROFILE_NOT_APPLIED');
  }
  const blocking = fit.fitness === 'NO_APTO';
  const limitationOnly = new Set([
    'WHITE_UNDERBASE_NOT_RENDERED',
    'WHITE_LAYER_NOT_RENDERED',
    'UV_VARNISH_NOT_RENDERED',
    'HARD_SURFACE_PROFILE_NOT_APPLIED',
  ]);
  const extra = warnings.filter((w) => !limitationOnly.has(w) && !fit.warnings.includes(w));
  const fitness: OraFitness = blocking
    ? 'NO_APTO'
    : fit.fitness === 'APTO_CON_ADVERTENCIA' || extra.length
      ? 'APTO_CON_ADVERTENCIA'
      : 'APTO_CON_ADVERTENCIA';
  return {
    kind: input.kind,
    workshopCategory: input.kind === 'DTF_UV' ? 'UV_DTF' : 'DTF_TEXTIL',
    physical: input.physical,
    raster: input.raster,
    ppi: fit.ppi,
    transparency: input.transparency,
    format: input.format,
    fitness,
    warnings,
    stages: DTF_PREP_STAGES.map((stage) => ({
      stage,
      ready: stage !== 'scale' || fit.fitness !== 'NO_APTO',
      executed: stage === 'intake' || stage === 'prepare' || stage === 'transparency' || stage === 'dimensions' || stage === 'resolution',
    })),
    originalPreserved: true as const,
    fakeUvLayers: false as const,
    reusable: ['flagFitness', 'analyzeGraphicFile', 'png-codec', 'production-orchestration.dtf'] as const,
  };
}

export const PRODUCTION_PACK_FOLDERS = ['ORIGINAL', 'DERIVADOS', 'PRINT', 'VECTOR', 'PRODUCTION', 'REPORT'] as const;

export function productionPackManifest(input: {
  jobId: string;
  capability: string;
  version: number;
  createdAt: number;
  physical?: PhysicalSize;
  resolution?: { x: number; y: number };
  formatOrigin?: string;
  formatDestination?: string;
  warnings: string[];
  files: Array<{ fileId: string; filename: string; role: string; folder: string }>;
}) {
  return {
    folders: PRODUCTION_PACK_FOLDERS,
    jobId: input.jobId,
    capability: input.capability,
    version: input.version,
    date: new Date(input.createdAt).toISOString(),
    dimensions: input.physical,
    resolution: input.resolution,
    formatOrigin: input.formatOrigin,
    formatDestination: input.formatDestination,
    warnings: input.warnings,
    files: input.files,
    originalPreserved: true as const,
  };
}
