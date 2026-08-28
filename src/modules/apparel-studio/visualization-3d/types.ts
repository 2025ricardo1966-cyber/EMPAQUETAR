import type { FabricId, MedidasPiezaResueltas, MoldeId } from '../moldes/types';

export type CameraViewPreset = 'front' | 'back' | 'left' | 'right' | 'perspective';

export type LightingPresetId = 'studio' | 'soft' | 'dramatic' | 'outdoor';

export interface Garment3DSimulationOptions {
  /** Activa simulación de caída de tela */
  enabled: boolean;
  /** Pliegues procedurales según espesor y elasticidad */
  folds: boolean;
  /** Movimiento sutil continuo (viento / balanceo) */
  movement: boolean;
}

export interface Garment3DMeasurements {
  chestWidth: number;
  bodyHeight: number;
  sleeveLength: number;
  sleeveHead: number;
  sleeveCuff: number;
  hasSleeves: boolean;
  hasHood: boolean;
  hasLower: boolean;
  legLength: number;
  waistWidth: number;
}

export interface Garment3DSceneConfig {
  moldId: MoldeId;
  piezas: MedidasPiezaResueltas[];
  fabricId: FabricId;
  simulation: Garment3DSimulationOptions;
  lighting: LightingPresetId;
  view: CameraViewPreset;
  autoRotate: boolean;
  zoom: number;
  /** OJO layer hint consumed by the viewer — not re-interpreted here. */
  designLayer?: {
    zone: string;
    scale: number;
    orientation: string;
    proportion: { width: number; height: number; ratio: number } | null;
    designType: string;
  } | null;
  /** Current OJO artwork (data URL or blob URL). Applied as texture when present. */
  designUrl?: string;
}

export interface Garment3DSceneConfigInput {
  moldId: MoldeId;
  piezas: MedidasPiezaResueltas[];
  fabricId?: FabricId;
}

/** EMPAQUETAR validation preview: no cloth sim, wrinkles, wind, or cinematic motion. */
export const VALIDATION_SIMULATION: Garment3DSimulationOptions = {
  enabled: false,
  folds: false,
  movement: false,
};

export const DEFAULT_SIMULATION: Garment3DSimulationOptions = {
  enabled: true,
  folds: true,
  movement: true,
};

export const DEFAULT_GARMENT_3D_CONFIG: Omit<Garment3DSceneConfig, 'moldId' | 'piezas' | 'fabricId'> = {
  simulation: DEFAULT_SIMULATION,
  lighting: 'studio',
  view: 'perspective',
  autoRotate: false,
  zoom: 1,
};
