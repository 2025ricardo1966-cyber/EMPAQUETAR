/** OJO V1 — interprets ingested artwork. Does not emit industrial files. */
export type OjoMaterialKind = 'raster_design' | 'vector_design' | 'photo' | 'document' | 'unknown';

export type OjoFitness = 'ready' | 'prepare' | 'review';

export type OjoZone = 'front' | 'back' | 'full' | 'unknown';

export type OjoOrientation = 'upright' | 'rotated' | 'unknown';

export type OjoRegionShape = 'rect' | 'ellipse';

/** Bounding box normalized to the original image (0..1). */
export interface OjoRegion {
  shape: OjoRegionShape;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OjoHint = 'NUMERO' | 'NOMBRE' | 'FUENTE' | 'DISENO';

export type OjoAction = 'APTO' | 'ESCALAR_PREPARAR' | 'INTERVENCION_HUMANA';

export interface OjoOrderContext {
  orderId?: string;
  garmentType?: string;
  tpuWidthMm?: number;
  tpuHeightMm?: number;
}

export interface OjoScaleAnalysis {
  currentWidthPx?: number;
  currentHeightPx?: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
  targetWidthMm?: number;
  targetHeightMm?: number;
  needsScale: boolean;
  needsResample: boolean;
  scaleFactor?: number;
}

/** Metadata the 3D viewer can later apply as a real texture/layer. */
export interface OjoLayerHint {
  zone: OjoZone;
  scale: number;
  orientation: OjoOrientation;
  proportion: { width: number; height: number; ratio: number } | null;
  designType: OjoMaterialKind;
}

export interface OjoDiagnosis {
  version: 'v1';
  fileId: string;
  originalFileId?: string;
  kind: OjoMaterialKind;
  widthPx?: number;
  heightPx?: number;
  resolutionInsufficient: boolean;
  proportionRisk: boolean;
  productionFitness: OjoFitness;
  recommendScale: boolean;
  recommendPreparation: boolean;
  humanIntervention: boolean;
  reasons: string[];
  layer: OjoLayerHint;
  generatedAt: number;
  region?: OjoRegion;
  hints: OjoHint[];
  ambiguous: boolean;
  content: { summary: string; elements: string[] };
  quality: { score: 'low' | 'medium' | 'high'; notes: string[] };
  size: OjoScaleAnalysis;
  risk: string[];
  action: OjoAction;
}

export interface OjoTransformation {
  kind: 'SCALE' | 'PREPARE';
  engine: 'scaleGraphic';
  derivedFileId: string;
  performedAt: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
}

export interface OjoSession {
  originalFileId: string;
  region?: OjoRegion;
  hints: OjoHint[];
  initial?: OjoDiagnosis;
  current: OjoDiagnosis;
  transformation?: OjoTransformation;
  post?: OjoDiagnosis;
  sample2dFileId?: string;
  sample3dFileId?: string;
  sample3dAvailable: boolean;
}

export const OJO_HINTS: readonly OjoHint[] = ['NUMERO', 'NOMBRE', 'FUENTE', 'DISENO'];

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function parseOjoRegion(raw: unknown): OjoRegion | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const shape: OjoRegionShape | undefined = r.shape === 'ellipse' ? 'ellipse' : r.shape === 'rect' ? 'rect' : undefined;
  if (!shape) return undefined;
  const x = clampUnit(Number(r.x));
  const y = clampUnit(Number(r.y));
  const w = clampUnit(Number(r.w));
  const h = clampUnit(Number(r.h));
  if (w <= 0 || h <= 0) return undefined;
  return { shape, x, y, w: Math.min(w, 1 - x) || w, h: Math.min(h, 1 - y) || h };
}

export function parseOjoHints(raw: unknown): OjoHint[] {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: OjoHint[] = [];
  for (const item of list) {
    const key = String(item || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    let mapped: OjoHint | undefined;
    if (key === 'NUMERO' || key === 'NUMBER') mapped = 'NUMERO';
    else if (key === 'NOMBRE' || key === 'NAME') mapped = 'NOMBRE';
    else if (key === 'FUENTE' || key === 'FONT') mapped = 'FUENTE';
    else if (key === 'DISENO' || key === 'DESIGN') mapped = 'DISENO';
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function ojoActionOf(fitness: OjoFitness): OjoAction {
  if (fitness === 'review') return 'INTERVENCION_HUMANA';
  if (fitness === 'prepare') return 'ESCALAR_PREPARAR';
  return 'APTO';
}

export function ojoActionLabel(action: OjoAction): string {
  if (action === 'ESCALAR_PREPARAR') return 'ESCALAR/PREPARAR';
  if (action === 'INTERVENCION_HUMANA') return 'INTERVENCIÓN HUMANA';
  return 'APTO';
}
