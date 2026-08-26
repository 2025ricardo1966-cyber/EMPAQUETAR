import type { MedidasPiezaResueltas } from '../../moldes/types';
import {
  defaultsToSeamAllowance,
  resolveProductionDefaults,
} from '../catalog/production-defaults';
import type {
  EnrichedProductionPiece,
  MptEnrichRequest,
  MptEnrichmentResult,
  MptPieceOverrideEntry,
  MptPieceOverridePatch,
  NotchAnchorSpec,
  PieceGrainSpec,
  PieceIdentificationSpec,
  PieceMarginSpec,
  PieceProductionMetadata,
} from '../types';
import {
  buildCutAndStitchFromMargins,
  generateDefaultEdgeMargins,
  marginSpecFromLegacySeam,
  resolvePieceMargins,
} from './margin-engine';
import {
  defaultGrainSpec,
  grainSpecFromLegacy,
  resolvePieceGrain,
} from './grain-engine';
import {
  anchorsFromLegacyNotches,
  generateDefaultNotchAnchors,
  resolveNotches,
} from './notch-engine';
import { buildPrintableZone } from './printable-zone-engine';
import {
  buildIdentificationCode,
  buildShortLabel,
} from './identification-engine';
import { resolveCutInstruction } from './cut-mode-engine';
import {
  defaultIdentificationSpec,
  resolvePieceIdentification,
} from './piece-identification-engine';

function findOverride(
  entries: MptPieceOverrideEntry[] | undefined,
  moldId: string,
  piezaId: string,
  categoria: string,
  talle: string
): MptPieceOverrideEntry | undefined {
  return entries?.find(
    (e) =>
      e.moldId === moldId &&
      e.piezaId === piezaId &&
      e.categoria === categoria &&
      e.talle === talle
  );
}

function applyPatch(
  base: PieceProductionMetadata,
  patch: MptPieceOverridePatch
): PieceProductionMetadata {
  return {
    ...base,
    ...patch,
    seamAllowance: patch.seamAllowance
      ? { ...base.seamAllowance, ...patch.seamAllowance }
      : base.seamAllowance,
    grainSpec: patch.grainSpec
      ? {
          ...base.grainSpec,
          ...patch.grainSpec,
          thread: { ...base.grainSpec.thread, ...patch.grainSpec.thread },
          fabric: { ...base.grainSpec.fabric, ...patch.grainSpec.fabric },
          stretch: { ...base.grainSpec.stretch, ...patch.grainSpec.stretch },
          cut: { ...base.grainSpec.cut, ...patch.grainSpec.cut },
        }
      : base.grainSpec,
    marginSpec: patch.marginSpec
      ? {
          ...base.marginSpec,
          ...patch.marginSpec,
          defaultsByKind: {
            ...base.marginSpec.defaultsByKind,
            ...patch.marginSpec.defaultsByKind,
          },
          edges: patch.marginSpec.edges ?? base.marginSpec.edges,
        }
      : base.marginSpec,
    identificationSpec: patch.identificationSpec
      ? {
          ...base.identificationSpec,
          ...patch.identificationSpec,
          anchorNorm: {
            ...base.identificationSpec.anchorNorm,
            ...patch.identificationSpec.anchorNorm,
          },
          fields: {
            ...base.identificationSpec.fields,
            ...patch.identificationSpec.fields,
          },
        }
      : base.identificationSpec,
    cutInstruction: patch.cutInstruction
      ? { ...base.cutInstruction, ...patch.cutInstruction }
      : base.cutInstruction,
    printableZone: patch.printableZone
      ? { ...base.printableZone, ...patch.printableZone }
      : base.printableZone,
    notchDefinitions: patch.notchDefinitions ?? base.notchDefinitions,
    tags: patch.tags ?? base.tags,
    updatedAt: new Date().toISOString(),
  };
}

function resolveNotchDefinitions(
  pieza: MedidasPiezaResueltas,
  patch?: MptPieceOverridePatch
): NotchAnchorSpec[] {
  const defaults = generateDefaultNotchAnchors(pieza);
  if (patch?.notchDefinitions?.length) {
    return patch.notchDefinitions;
  }
  if (patch?.notches?.length) {
    return anchorsFromLegacyNotches(pieza, patch.notches);
  }
  return defaults;
}

function resolveGrainSpec(
  defaults: ReturnType<typeof resolveProductionDefaults>,
  patch?: MptPieceOverridePatch
): PieceGrainSpec {
  const base = defaultGrainSpec(defaults.grainDirection);
  if (patch?.grainSpec) {
    return {
      ...base,
      ...patch.grainSpec,
      thread: { ...base.thread, ...patch.grainSpec.thread },
      fabric: { ...base.fabric, ...patch.grainSpec.fabric },
      stretch: { ...base.stretch, ...patch.grainSpec.stretch },
      cut: { ...base.cut, ...patch.grainSpec.cut },
    };
  }
  if (patch?.grain) {
    return grainSpecFromLegacy(defaults.grainDirection, patch.grain);
  }
  return base;
}

function resolveMarginSpec(
  pieza: MedidasPiezaResueltas,
  seamAllowance: ReturnType<typeof defaultsToSeamAllowance>,
  patch?: MptPieceOverridePatch
): PieceMarginSpec {
  if (patch?.marginSpec?.edges?.length) {
    return {
      ...marginSpecFromLegacySeam(pieza, seamAllowance.defaultCm),
      ...patch.marginSpec,
      defaultsByKind: {
        ...marginSpecFromLegacySeam(pieza, seamAllowance.defaultCm).defaultsByKind,
        ...patch.marginSpec.defaultsByKind,
      },
      edges: patch.marginSpec.edges,
    };
  }
  if (patch?.seamAllowance?.defaultCm !== undefined) {
    return marginSpecFromLegacySeam(pieza, patch.seamAllowance.defaultCm);
  }
  const edges = generateDefaultEdgeMargins(pieza);
  if (edges.length > 0) {
    const spec = marginSpecFromLegacySeam(pieza, seamAllowance.defaultCm);
    return { ...spec, edges };
  }
  return marginSpecFromLegacySeam(pieza, seamAllowance.defaultCm);
}

function resolveIdentificationSpec(patch?: MptPieceOverridePatch): PieceIdentificationSpec {
  const base = defaultIdentificationSpec();
  if (!patch?.identificationSpec) return base;
  return {
    ...base,
    ...patch.identificationSpec,
    anchorNorm: { ...base.anchorNorm, ...patch.identificationSpec.anchorNorm },
    fields: { ...base.fields, ...patch.identificationSpec.fields },
  };
}

function buildResolvedIdentification(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[],
  spec: PieceIdentificationSpec,
  context: MptEnrichRequest['context'],
  production: Pick<
    PieceProductionMetadata,
    'identificationCode' | 'shortLabel' | 'cutInstruction' | 'grain'
  >
) {
  return resolvePieceIdentification(pieza, allPiezas, spec, {
    talle: context.talle,
    identificationCode: production.identificationCode,
    shortLabel: production.shortLabel,
    cutInstruction: production.cutInstruction,
    grain: production.grain,
  });
}

/** Enriquece piezas del molde con metadatos industriales MPT (sin mutar el molde) */
export function enrichPieceProductionMetadata(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[],
  context: MptEnrichRequest['context'],
  overrideEntry?: MptPieceOverrideEntry
): EnrichedProductionPiece {
  const defaults = resolveProductionDefaults(pieza.slotId, pieza.templateKind);
  const seamAllowance = defaultsToSeamAllowance(defaults);

  const patch = overrideEntry?.overrides;
  const marginSpec = resolveMarginSpec(pieza, seamAllowance, patch);
  const margins = resolvePieceMargins(pieza, marginSpec);
  const { cutOutlinePath, stitchOutlinePath } = buildCutAndStitchFromMargins(pieza, marginSpec);

  const notchDefinitions = resolveNotchDefinitions(pieza, patch);
  const notches = resolveNotches(pieza, notchDefinitions);
  const grainSpec = resolveGrainSpec(defaults, patch);
  const grain = resolvePieceGrain(pieza, grainSpec);
  const cutInstruction = resolveCutInstruction(pieza, allPiezas, patch?.cutInstruction);
  const identificationSpec = resolveIdentificationSpec(patch);

  const base: PieceProductionMetadata = {
    piezaId: pieza.piezaId,
    piezaNombre: pieza.piezaNombre,
    slotId: pieza.slotId,
    templateKind: pieza.templateKind,
    identificationCode: buildIdentificationCode(context.moldId, pieza, context.talle),
    shortLabel: buildShortLabel(pieza),
    seamAllowance,
    marginSpec,
    margins,
    grainSpec,
    grain,
    notchDefinitions,
    notches,
    cutInstruction,
    identificationSpec,
    identification: buildResolvedIdentification(pieza, allPiezas, identificationSpec, context, {
      identificationCode: buildIdentificationCode(context.moldId, pieza, context.talle),
      shortLabel: buildShortLabel(pieza),
      cutInstruction,
      grain,
    }),
    printableZone: buildPrintableZone(
      pieza,
      defaults.printableSafeMarginCm,
      defaults.sublimationSafe
    ),
    cutOutlinePath,
    stitchOutlinePath,
    tags: [...defaults.tags],
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };

  const patched = patch ? applyPatch(base, patch) : base;
  const finalDefinitions = patched.notchDefinitions;
  const finalNotches = resolveNotches(pieza, finalDefinitions);
  const finalGrainSpec = patched.grainSpec;
  const finalGrain = resolvePieceGrain(pieza, finalGrainSpec);
  const finalMarginSpec = patched.marginSpec;
  const finalMargins = resolvePieceMargins(pieza, finalMarginSpec);
  const finalCut = buildCutAndStitchFromMargins(pieza, finalMarginSpec);
  const finalCutInstruction = resolveCutInstruction(pieza, allPiezas, patched.cutInstruction);
  const finalIdentificationSpec = patched.identificationSpec;
  const finalIdentification = buildResolvedIdentification(
    pieza,
    allPiezas,
    finalIdentificationSpec,
    context,
    {
      identificationCode: patched.identificationCode,
      shortLabel: patched.shortLabel,
      cutInstruction: finalCutInstruction,
      grain: finalGrain,
    }
  );

  const syncedGrainSpec = {
    ...finalGrainSpec,
    arrowVisible: finalIdentificationSpec.showGrainArrow,
  };
  const syncedGrain = resolvePieceGrain(pieza, syncedGrainSpec);

  return {
    moldPiece: pieza,
    production: {
      ...patched,
      notchDefinitions: finalDefinitions,
      notches: finalNotches,
      grainSpec: syncedGrainSpec,
      grain: syncedGrain,
      marginSpec: finalMarginSpec,
      margins: finalMargins,
      cutOutlinePath: finalCut.cutOutlinePath,
      stitchOutlinePath: finalCut.stitchOutlinePath,
      cutInstruction: finalCutInstruction,
      identificationSpec: finalIdentificationSpec,
      identification: finalIdentification,
    },
  };
}

/** Enriquece todas las piezas de un molde resuelto */
export function enrichMoldForProduction(request: MptEnrichRequest): MptEnrichmentResult {
  const { context, piezas, overrideEntries } = request;
  const pieces = piezas.map((pieza) => {
    const override = findOverride(
      overrideEntries,
      context.moldId,
      String(pieza.piezaId),
      context.categoria,
      context.talle
    );
    return enrichPieceProductionMetadata(pieza, piezas, context, override);
  });

  return {
    context,
    pieces,
    enrichedAt: new Date().toISOString(),
  };
}

export function filterOverridesForContext(
  entries: MptPieceOverrideEntry[],
  moldId: string,
  categoria: string,
  talle: string
): MptPieceOverrideEntry[] {
  return entries.filter(
    (e) => e.moldId === moldId && e.categoria === categoria && e.talle === talle
  );
}
