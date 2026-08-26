import type { PointCm } from '../../moldes/types';
import { pathFromPoints, isClosedPath, sampleSvgPath } from '../../moldes/engine/path-parser';

function inwardNormal(from: PointCm, to: PointCm): PointCm {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function lineIntersection(
  p1: PointCm,
  d1: PointCm,
  p2: PointCm,
  d2: PointCm
): PointCm | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / cross;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

export interface ContourSegment {
  index: number;
  from: PointCm;
  to: PointCm;
  length: number;
}

export function buildContourSegments(
  outlinePath: string,
  curveSteps = 8
): { vertices: PointCm[]; segments: ContourSegment[]; closed: boolean } | null {
  const points = sampleSvgPath(outlinePath, curveSteps);
  if (points.length < 3) return null;

  const closed = isClosedPath(outlinePath, points);
  const vertices =
    closed && points.length > 1 ? points.slice(0, -1) : points;
  const n = vertices.length;
  if (n < 2) return null;

  const segments: ContourSegment[] = [];
  const limit = closed ? n : n - 1;

  for (let i = 0; i < limit; i++) {
    const from = vertices[i];
    const to = closed ? vertices[(i + 1) % n] : vertices[i + 1];
    segments.push({
      index: i,
      from,
      to,
      length: Math.hypot(to.x - from.x, to.y - from.y),
    });
  }

  return { vertices, segments, closed };
}

/** Offset variable por borde — hacia afuera (márgenes de corte) */
export function offsetClosedPolylineVariableOutward(
  vertices: PointCm[],
  segmentMargins: number[]
): PointCm[] {
  const m = vertices.length;
  if (m < 3) return [...vertices];

  const result: PointCm[] = [];
  for (let i = 0; i < m; i++) {
    const prev = vertices[(i - 1 + m) % m];
    const curr = vertices[i];
    const next = vertices[(i + 1) % m];
    const mPrev = segmentMargins[(i - 1 + m) % m] ?? 0;
    const mNext = segmentMargins[i] ?? 0;

    const in1 = inwardNormal(prev, curr);
    const in2 = inwardNormal(curr, next);
    const cut1 = { x: curr.x - in1.x * mPrev, y: curr.y - in1.y * mPrev };
    const cut2 = { x: curr.x - in2.x * mNext, y: curr.y - in2.y * mNext };
    const dir1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const dir2 = { x: next.x - curr.x, y: next.y - curr.y };

    const hit = lineIntersection(cut1, dir1, cut2, dir2);
    result.push(
      hit ?? {
        x: curr.x - in1.x * mPrev,
        y: curr.y - in1.y * mPrev,
      }
    );
  }

  return result;
}

/** Offset variable hacia adentro (línea de pespunte) */
export function offsetClosedPolylineVariableInward(
  vertices: PointCm[],
  segmentInsets: number[]
): PointCm[] {
  const outward = segmentInsets.map((v) => -v);
  return offsetClosedPolylineVariableOutward(vertices, outward);
}

export function offsetSegmentOutward(
  from: PointCm,
  to: PointCm,
  marginCm: number
): { cutFrom: PointCm; cutTo: PointCm } {
  const inN = inwardNormal(from, to);
  return {
    cutFrom: { x: from.x - inN.x * marginCm, y: from.y - inN.y * marginCm },
    cutTo: { x: to.x - inN.x * marginCm, y: to.y - inN.y * marginCm },
  };
}

export function edgeLinePath(from: PointCm, to: PointCm): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

export { pathFromPoints, isClosedPath, sampleSvgPath };
