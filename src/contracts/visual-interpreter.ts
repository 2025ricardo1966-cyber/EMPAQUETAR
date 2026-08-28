/** OJO V1 — interprets ingested artwork. Does not emit industrial files. */
export type OjoMaterialKind = 'raster_design' | 'vector_design' | 'photo' | 'document' | 'unknown';

export type OjoFitness = 'ready' | 'prepare' | 'review';

export type OjoZone = 'front' | 'back' | 'full' | 'unknown';

export type OjoOrientation = 'upright' | 'rotated' | 'unknown';

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
}
