import type { PointCm } from '../../moldes/types';
import { isClosedPath, sampleSvgPath } from '../../moldes/engine/path-parser';
import type { NotchAnchorSpec } from '../types';

export const NOTCH_CONTOUR_SAMPLE_STEPS = 8;

export interface ContourModel {
  vertices: PointCm[];
  closed: boolean;
  segmentCount: number;
}

export interface ResolvedNotchGeometry {
  x: number;
  y: number;
  /** Normal hacia afuera del contorno (grados) */
  angleDeg: number;
  /** Tangente a lo largo del contorno (grados) */
  tangentDeg: number;
}

/** Modelo paramétrico del contorno de la pieza — base para anclar piquetes */
export function buildContourModel(
  outlinePath: string,
  curveSteps = NOTCH_CONTOUR_SAMPLE_STEPS
): ContourModel | null {
  const points = sampleSvgPath(outlinePath, curveSteps);
  if (points.length < 3) return null;

  const closed = isClosedPath(outlinePath, points);
  const vertices =
    closed && points.length > 1 ? points.slice(0, -1) : points;

  return {
    vertices,
    closed,
    segmentCount: vertices.length,
  };
}

function segmentEndpoints(
  contour: ContourModel,
  vertexIndex: number
): { from: PointCm; to: PointCm } {
  const { vertices, closed, segmentCount } = contour;
  const idx = ((vertexIndex % segmentCount) + segmentCount) % segmentCount;
  const from = vertices[idx];
  const to = closed
    ? vertices[(idx + 1) % segmentCount]
    : vertices[Math.min(idx + 1, segmentCount - 1)];
  return { from, to };
}

function tangentAngleDeg(from: PointCm, to: PointCm): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function outwardNormalDeg(tangentDeg: number): number {
  return tangentDeg + 90;
}

/** Resuelve posición y orientación de un piquete anclado al contorno actual */
export function resolveNotchAnchor(
  contour: ContourModel,
  anchor: NotchAnchorSpec
): ResolvedNotchGeometry | null {
  const { segmentCount } = contour;
  if (segmentCount < 2) return null;

  const idx = ((anchor.vertexIndex % segmentCount) + segmentCount) % segmentCount;
  const t = Math.max(0, Math.min(1, anchor.tAlongSegment ?? 0));
  const { from, to } = segmentEndpoints(contour, idx);

  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  const tangentDeg = tangentAngleDeg(from, to);
  const angleDeg = outwardNormalDeg(tangentDeg);

  return { x, y, angleDeg, tangentDeg };
}

/** Encuentra el anclaje paramétrico más cercano a un punto (migración legacy) */
export function nearestAnchorForPoint(
  contour: ContourModel,
  x: number,
  y: number
): Pick<NotchAnchorSpec, 'vertexIndex' | 'tAlongSegment'> {
  let bestDist = Infinity;
  let bestVertex = 0;
  let bestT = 0;

  for (let i = 0; i < contour.segmentCount; i++) {
    const { from, to } = segmentEndpoints(contour, i);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq > 0
        ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lenSq))
        : 0;
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestVertex = i;
      bestT = t;
    }
  }

  return { vertexIndex: bestVertex, tAlongSegment: bestT };
}
