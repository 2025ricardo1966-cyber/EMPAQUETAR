import type { PieceSlotId, PieceTemplateKind } from '../../moldes/types';
import type { GrainDirection, SeamAllowanceSpec } from '../types';

export interface ProductionDefaultProfile {
  seamAllowanceCm: number;
  stitchLineCm: number;
  grainDirection: GrainDirection;
  printableSafeMarginCm: number;
  sublimationSafe: boolean;
  tags: string[];
}

const DEFAULT_PROFILE: ProductionDefaultProfile = {
  seamAllowanceCm: 1.0,
  stitchLineCm: 0.7,
  grainDirection: 'vertical',
  printableSafeMarginCm: 1.5,
  sublimationSafe: true,
  tags: ['confección'],
};

const BY_SLOT: Partial<Record<PieceSlotId, Partial<ProductionDefaultProfile>>> = {
  cuello: {
    seamAllowanceCm: 0.6,
    stitchLineCm: 0.5,
    grainDirection: 'horizontal',
    tags: ['cuello', 'rib'],
  },
  punos: {
    seamAllowanceCm: 0.6,
    stitchLineCm: 0.5,
    grainDirection: 'horizontal',
    tags: ['puño'],
  },
  pretina: {
    seamAllowanceCm: 0.8,
    stitchLineCm: 0.6,
    grainDirection: 'horizontal',
    tags: ['pretina'],
  },
  capucha: {
    seamAllowanceCm: 1.0,
    grainDirection: 'vertical',
    tags: ['capucha'],
  },
  bolsillos: {
    seamAllowanceCm: 0.7,
    stitchLineCm: 0.5,
    tags: ['bolsillo'],
  },
  'manga-izquierda': {
    seamAllowanceCm: 1.0,
    grainDirection: 'vertical',
    tags: ['manga'],
  },
  'manga-derecha': {
    seamAllowanceCm: 1.0,
    grainDirection: 'vertical',
    tags: ['manga'],
  },
};

const BY_TEMPLATE: Partial<Record<PieceTemplateKind, Partial<ProductionDefaultProfile>>> = {
  'cuello-redondo': { seamAllowanceCm: 0.6, grainDirection: 'horizontal' },
  'cuello-v': { seamAllowanceCm: 0.6, grainDirection: 'horizontal' },
  'cuello-polo': { seamAllowanceCm: 0.7, grainDirection: 'horizontal' },
  'manga-puno': { seamAllowanceCm: 0.5, grainDirection: 'horizontal', tags: ['puño', 'rib'] },
  pretina: { seamAllowanceCm: 0.8, grainDirection: 'horizontal' },
  'short-delantero': { grainDirection: 'vertical', tags: ['inferior'] },
  'short-trasero': { grainDirection: 'vertical', tags: ['inferior'] },
  'pantalon-delantero': { grainDirection: 'vertical', tags: ['inferior', 'pantalón'] },
  'pantalon-trasero': { grainDirection: 'vertical', tags: ['inferior', 'pantalón'] },
  'calza-panel': { grainDirection: 'vertical', tags: ['inferior', 'calza'] },
  'jersey-panel': { printableSafeMarginCm: 2.0, sublimationSafe: true, tags: ['estampa'] },
  'egresados-panel': { printableSafeMarginCm: 2.0, sublimationSafe: true, tags: ['egresados', 'estampa'] },
  'panel-frente': { printableSafeMarginCm: 2.0, tags: ['superior'] },
  'panel-espalda': { printableSafeMarginCm: 2.0, tags: ['superior'] },
};

export function resolveProductionDefaults(
  slotId?: PieceSlotId,
  templateKind?: PieceTemplateKind
): ProductionDefaultProfile {
  let profile = { ...DEFAULT_PROFILE, tags: [...DEFAULT_PROFILE.tags] };

  if (templateKind && BY_TEMPLATE[templateKind]) {
    profile = mergeProfile(profile, BY_TEMPLATE[templateKind]!);
  }
  if (slotId && BY_SLOT[slotId]) {
    profile = mergeProfile(profile, BY_SLOT[slotId]!);
  }

  return profile;
}

function mergeProfile(
  base: ProductionDefaultProfile,
  patch: Partial<ProductionDefaultProfile>
): ProductionDefaultProfile {
  return {
    ...base,
    ...patch,
    tags: patch.tags ? [...new Set([...base.tags, ...patch.tags])] : base.tags,
  };
}

export function defaultsToSeamAllowance(profile: ProductionDefaultProfile): SeamAllowanceSpec {
  return {
    defaultCm: profile.seamAllowanceCm,
    stitchLineCm: profile.stitchLineCm,
  };
}
