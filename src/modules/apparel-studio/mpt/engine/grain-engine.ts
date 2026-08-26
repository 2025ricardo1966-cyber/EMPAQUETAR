import type { MedidasPiezaResueltas } from '../../moldes/types';
import { sampleSvgPath } from '../../moldes/engine/path-parser';
import { GRAIN_AXIS_LABELS } from '../catalog/grain-directions';
import type {
  GrainArrowGeometry,
  GrainAxisConfig,
  GrainAxisKind,
  GrainDirection,
  GrainLineSpec,
  PieceGrainSpec,
  ResolvedGrainAxis,
} from '../types';

const DIRECTION_ANGLES: Record<Exclude<GrainDirection, 'custom'>, number> = {
  vertical: 90,
  horizontal: 0,
  'bias-45': 45,
  'bias-135': 135,
};

function normalizeDeg(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

function parseViewBox(viewBox: string | undefined): {
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  if (!viewBox) return { w: 40, h: 50, cx: 20, cy: 25 };
  const parts = viewBox.split(' ').map(Number);
  const w = parts[2] ?? 40;
  const h = parts[3] ?? 50;
  return { w, h, cx: w / 2, cy: h / 2 };
}

/** Orientación de la pieza vía PCA del contorno — sincroniza flecha con rotación geométrica */
export function computePieceRotationDeg(outlinePath: string | undefined): number {
  if (!outlinePath) return 0;
  const points = sampleSvgPath(outlinePath, 8);
  if (points.length < 3) return 0;

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const angleRad = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return normalizeDeg((angleRad * 180) / Math.PI);
}

function localAngleFromConfig(config: GrainAxisConfig): number {
  const base =
    config.direction === 'custom'
      ? (config.customAngleDeg ?? 90)
      : DIRECTION_ANGLES[config.direction];
  return config.inverted ? normalizeDeg(base + 180) : normalizeDeg(base);
}

function axisLabel(kind: GrainAxisKind, direction: GrainDirection): string {
  const prefix = GRAIN_AXIS_LABELS[kind];
  switch (direction) {
    case 'vertical':
      return `${prefix} ↕`;
    case 'horizontal':
      return `${prefix} ↔`;
    case 'bias-45':
      return `${prefix} ↗`;
    case 'bias-135':
      return `${prefix} ↖`;
    default:
      return `${prefix} (custom)`;
  }
}

function resolveAxis(
  kind: GrainAxisKind,
  config: GrainAxisConfig,
  pieceRotationDeg: number
): ResolvedGrainAxis {
  const localAngleDeg = localAngleFromConfig(config);
  const worldAngleDeg = normalizeDeg(pieceRotationDeg + localAngleDeg);
  return {
    kind,
    direction: config.direction,
    localAngleDeg,
    worldAngleDeg,
    inverted: config.inverted ?? false,
    label: axisLabel(kind, config.direction),
  };
}

function buildArrowGeometry(
  viewBox: string | undefined,
  worldAngleDeg: number,
  spec: PieceGrainSpec,
  label: string
): GrainArrowGeometry {
  const { w, h, cx, cy } = parseViewBox(viewBox);
  const centerX = (spec.centerNorm?.x ?? 0.5) * w;
  const centerY = (spec.centerNorm?.y ?? 0.5) * h;
  const anchorX = spec.centerNorm ? centerX : cx;
  const anchorY = spec.centerNorm ? centerY : cy;
  const len = Math.min(w, h) * (spec.lengthRatio ?? 0.55) * 0.5;
  const rad = (worldAngleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * len;
  const dy = Math.sin(rad) * len;

  return {
    start: { x: anchorX - dx, y: anchorY - dy },
    end: { x: anchorX + dx, y: anchorY + dy },
    visible: spec.arrowVisible,
    inverted: spec.thread.inverted ?? false,
    label,
    worldAngleDeg,
  };
}

export function defaultGrainSpec(threadDirection: GrainDirection = 'vertical'): PieceGrainSpec {
  return {
    thread: { direction: threadDirection, inverted: false },
    fabric: { direction: 'horizontal', inverted: false },
    stretch: { direction: threadDirection, inverted: false },
    cut: { direction: threadDirection, inverted: false },
    arrowVisible: true,
    showSecondaryAxes: false,
    lengthRatio: 0.55,
  };
}

/** Migra override legacy con solo grain.direction */
export function grainSpecFromLegacy(
  threadDirection: GrainDirection,
  legacy?: Partial<GrainLineSpec>
): PieceGrainSpec {
  const spec = defaultGrainSpec(threadDirection);
  if (legacy?.direction) {
    spec.thread.direction = legacy.direction;
  }
  if (legacy?.arrow?.inverted !== undefined) {
    spec.thread.inverted = legacy.arrow.inverted;
  }
  return spec;
}

/** Resuelve spec paramétrica contra geometría actual del molde */
export function resolvePieceGrain(
  pieza: MedidasPiezaResueltas,
  spec: PieceGrainSpec
): GrainLineSpec {
  const pieceRotationDeg = computePieceRotationDeg(pieza.outlinePath);

  const thread = resolveAxis('thread', spec.thread, pieceRotationDeg);
  const fabric = resolveAxis('fabric', spec.fabric, pieceRotationDeg);
  const stretch = resolveAxis('stretch', spec.stretch, pieceRotationDeg);
  const cut = resolveAxis('cut', spec.cut, pieceRotationDeg);

  const arrow = buildArrowGeometry(pieza.viewBox, thread.worldAngleDeg, spec, thread.label);

  return {
    pieceRotationDeg,
    thread,
    fabric,
    stretch,
    cut,
    arrow,
    direction: thread.direction,
    angleDeg: thread.worldAngleDeg,
    start: arrow.start,
    end: arrow.end,
    label: thread.label,
  };
}

/** Invierte el sentido de la flecha principal (hilo) */
export function invertThreadDirection(spec: PieceGrainSpec): PieceGrainSpec {
  return {
    ...spec,
    thread: { ...spec.thread, inverted: !spec.thread.inverted },
  };
}

/** @deprecated Use resolvePieceGrain */
export function buildGrainLine(
  viewBox: string | undefined,
  direction: GrainDirection,
  customAngleDeg?: number
): GrainLineSpec {
  const spec: PieceGrainSpec = {
    thread: {
      direction,
      customAngleDeg,
      inverted: false,
    },
    fabric: { direction: 'horizontal', inverted: false },
    stretch: { direction, inverted: false },
    cut: { direction, inverted: false },
    arrowVisible: true,
    lengthRatio: 0.55,
  };
  return resolvePieceGrain({ viewBox, outlinePath: undefined } as MedidasPiezaResueltas, spec);
}

export function secondaryAxisSegment(
  viewBox: string | undefined,
  axis: ResolvedGrainAxis,
  spec: PieceGrainSpec,
  scale = 0.35
): { x1: number; y1: number; x2: number; y2: number } {
  const { w, h, cx, cy } = parseViewBox(viewBox);
  const anchorX = spec.centerNorm ? spec.centerNorm.x * w : cx;
  const anchorY = spec.centerNorm ? spec.centerNorm.y * h : cy;
  const len = Math.min(w, h) * (spec.lengthRatio ?? 0.55) * scale;
  const rad = (axis.worldAngleDeg * Math.PI) / 180;
  return {
    x1: anchorX,
    y1: anchorY,
    x2: anchorX + Math.cos(rad) * len,
    y2: anchorY + Math.sin(rad) * len,
  };
}
