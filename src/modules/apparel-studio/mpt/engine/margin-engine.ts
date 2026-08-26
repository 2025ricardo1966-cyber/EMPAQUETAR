import type { MedidasPiezaResueltas, PieceSlotId } from '../../moldes/types';
import { pathFromPoints } from '../../moldes/engine/path-parser';
import { DEFAULT_MARGIN_CM } from '../catalog/margin-types';
import type {
  EdgeMarginDefinition,
  MarginKind,
  PieceMarginSpec,
  ResolvedEdgeMargin,
  ResolvedPieceMargins,
} from '../types';
import {
  buildContourSegments,
  edgeLinePath,
  offsetClosedPolylineVariableInward,
  offsetClosedPolylineVariableOutward,
  offsetSegmentOutward,
} from './margin-geometry';
import { buildCutAndStitchPaths } from './seam-allowance-engine';

function uid(prefix: string, i: number): string {
  return `${prefix}-e${i}`;
}

function defaultKindForSlot(slotId: PieceSlotId | undefined): MarginKind {
  switch (slotId) {
    case 'cuello':
      return 'cuello';
    case 'punos':
      return 'puno';
    case 'pretina':
      return 'dobladillo';
    default:
      return 'costura';
  }
}

function defaultKindForSegment(
  slotId: PieceSlotId | undefined,
  segmentIndex: number,
  total: number
): MarginKind {
  const base = defaultKindForSlot(slotId);
  if (base !== 'costura') return base;
  if (segmentIndex === 0) return 'costura';
  if (segmentIndex >= total - 1) return 'dobladillo';
  return 'costura';
}

export function defaultMarginSpec(): PieceMarginSpec {
  return {
    defaultsByKind: { ...DEFAULT_MARGIN_CM },
    edges: [],
    showCutOutline: true,
    showEdgeMargins: true,
    stitchRatio: 0.7,
  };
}

/** Genera definiciones por borde ancladas al contorno */
export function generateDefaultEdgeMargins(pieza: MedidasPiezaResueltas): EdgeMarginDefinition[] {
  if (!pieza.outlinePath || pieza.esEspejo) return [];

  const contour = buildContourSegments(pieza.outlinePath);
  if (!contour) return [];

  return contour.segments.map((seg) => {
    const kind = defaultKindForSegment(pieza.slotId, seg.index, contour.segments.length);
    return {
      id: uid(String(pieza.piezaId), seg.index),
      segmentIndex: seg.index,
      kind,
      valueCm: DEFAULT_MARGIN_CM[kind],
      visible: true,
    };
  });
}

function definitionForSegment(
  spec: PieceMarginSpec,
  segmentIndex: number,
  segmentCount: number,
  slotId?: PieceSlotId
): EdgeMarginDefinition {
  const found = spec.edges.find((e) => e.segmentIndex === segmentIndex);
  if (found) return found;

  const kind = defaultKindForSegment(slotId, segmentIndex, segmentCount);
  return {
    id: `auto-${segmentIndex}`,
    segmentIndex,
    kind,
    valueCm: spec.defaultsByKind[kind] ?? DEFAULT_MARGIN_CM[kind],
    visible: true,
  };
}

function stitchInsetForKind(kind: MarginKind, valueCm: number, ratio: number): number {
  if (kind === 'dobladillo') return valueCm * 0.5;
  if (kind === 'vista') return valueCm * 0.6;
  return valueCm * ratio;
}

/** Resuelve márgenes contra geometría actual — no modifica outlinePath del molde */
export function resolvePieceMargins(
  pieza: MedidasPiezaResueltas,
  spec: PieceMarginSpec
): ResolvedPieceMargins {
  if (!pieza.outlinePath || pieza.esEspejo) {
    return { edges: [], segmentOffsets: [], edgePaths: [] };
  }

  const contour = buildContourSegments(pieza.outlinePath);
  if (!contour || !contour.closed) {
    return { edges: [], segmentOffsets: [], edgePaths: [] };
  }

  const { vertices, segments } = contour;
  const ratio = spec.stitchRatio ?? 0.7;

  const defs = segments.map((seg) =>
    definitionForSegment(spec, seg.index, segments.length, pieza.slotId)
  );

  const segmentOffsets = defs.map((d) => d.valueCm);
  const stitchInsets = defs.map((d) => stitchInsetForKind(d.kind, d.valueCm, ratio));

  const cutPts = offsetClosedPolylineVariableOutward(vertices, segmentOffsets);
  const stitchPts = offsetClosedPolylineVariableInward(vertices, stitchInsets);

  const edges: ResolvedEdgeMargin[] = segments.map((seg, i) => {
    const def = defs[i];
    const { cutFrom, cutTo } = offsetSegmentOutward(seg.from, seg.to, def.valueCm);
    return {
      id: def.id,
      segmentIndex: seg.index,
      kind: def.kind,
      valueCm: def.valueCm,
      visible: def.visible,
      label: def.label,
      from: { x: seg.from.x, y: seg.from.y },
      to: { x: seg.to.x, y: seg.to.y },
      cutFrom,
      cutTo,
    };
  });

  const edgePaths = edges
    .filter((e) => e.visible)
    .map((e) => ({
      kind: e.kind,
      visible: true,
      path: edgeLinePath(e.cutFrom, e.cutTo),
    }));

  return {
    edges,
    segmentOffsets,
    cutOutlinePath: pathFromPoints(cutPts, true),
    stitchOutlinePath: pathFromPoints(stitchPts, true),
    edgePaths,
  };
}

export function mergeMarginDefinitions(
  defaults: EdgeMarginDefinition[],
  overrides: EdgeMarginDefinition[] | undefined
): EdgeMarginDefinition[] {
  if (!overrides?.length) return defaults;
  return overrides;
}

export function visibleMarginCount(margins: ResolvedPieceMargins): number {
  return margins.edges.filter((e) => e.visible).length;
}

/** Migra seamAllowance uniforme legacy a spec por borde */
export function marginSpecFromLegacySeam(
  pieza: MedidasPiezaResueltas,
  defaultCm: number
): PieceMarginSpec {
  const spec = defaultMarginSpec();
  spec.defaultsByKind.costura = defaultCm;
  spec.edges = generateDefaultEdgeMargins(pieza).map((e) => ({
    ...e,
    kind: 'costura',
    valueCm: defaultCm,
  }));
  return spec;
}

export function buildCutAndStitchFromMargins(
  pieza: MedidasPiezaResueltas,
  spec: PieceMarginSpec
): { cutOutlinePath?: string; stitchOutlinePath?: string } {
  const resolved = resolvePieceMargins(pieza, spec);
  if (resolved.cutOutlinePath) {
    return {
      cutOutlinePath: resolved.cutOutlinePath,
      stitchOutlinePath: resolved.stitchOutlinePath,
    };
  }
  const costura = spec.defaultsByKind.costura ?? DEFAULT_MARGIN_CM.costura;
  return buildCutAndStitchPaths(pieza, {
    defaultCm: costura,
    stitchLineCm: costura * (spec.stitchRatio ?? 0.7),
  });
}
