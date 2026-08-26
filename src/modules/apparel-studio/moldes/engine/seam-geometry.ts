import type { PointCm } from '../types';
import { pathFromPoints } from './path-parser';

function inwardNormal(from: PointCm, to: PointCm): PointCm {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Offset de polilínea cerrada hacia adentro (línea de costura paralela al borde) */
export function offsetClosedPolyline(points: PointCm[], offset: number): PointCm[] {
  const n = points.length;
  if (n < 3 || offset === 0) return [...points];

  const isClosed =
    Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) < 0.01;
  const verts = isClosed ? points.slice(0, -1) : points;
  const m = verts.length;
  const result: PointCm[] = [];

  for (let i = 0; i < m; i++) {
    const prev = verts[(i - 1 + m) % m];
    const curr = verts[i];
    const next = verts[(i + 1) % m];
    const n1 = inwardNormal(prev, curr);
    const n2 = inwardNormal(curr, next);
    let ax = n1.x + n2.x;
    let ay = n1.y + n2.y;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al;
    ay /= al;
    const dot = Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y));
    const miterLen = offset / Math.max(0.35, Math.sqrt((1 + dot) / 2));
    result.push({ x: curr.x + ax * miterLen, y: curr.y + ay * miterLen });
  }

  return result;
}

/** Offset de polilínea abierta */
export function offsetOpenPolyline(points: PointCm[], offset: number): PointCm[] {
  if (points.length < 2 || offset === 0) return [...points];
  const result: PointCm[] = [];

  for (let i = 0; i < points.length; i++) {
    let nx = 0;
    let ny = 0;
    if (i > 0) {
      const n = inwardNormal(points[i - 1], points[i]);
      nx += n.x;
      ny += n.y;
    }
    if (i < points.length - 1) {
      const n = inwardNormal(points[i], points[i + 1]);
      nx += n.x;
      ny += n.y;
    }
    const len = Math.hypot(nx, ny) || 1;
    result.push({
      x: points[i].x + (nx / len) * offset,
      y: points[i].y + (ny / len) * offset,
    });
  }

  return result;
}

/** Zigzag overlock a lo largo del borde de corte */
export function buildOverlockZigzag(
  points: PointCm[],
  closed: boolean,
  amplitude = 0.25,
  waveLen = 0.8
): string {
  const verts = closed && points.length > 1 ? points.slice(0, -1) : points;
  if (verts.length < 2) return '';

  const segments: PointCm[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (!closed && i === verts.length - 1) break;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(len / waveLen));
    const nx = (-dy / len) * amplitude;
    const ny = (dx / len) * amplitude;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const sign = s % 2 === 0 ? 1 : -1;
      segments.push({ x: px + nx * sign, y: py + ny * sign });
    }
  }

  return pathFromPoints(segments, false);
}

/** Línea decorativa con pequeñas ondas sobre offset interior */
export function buildDecorativeWave(points: PointCm[], closed: boolean, offset: number): string {
  const offsetPts = closed ? offsetClosedPolyline(points, offset) : offsetOpenPolyline(points, offset);
  if (offsetPts.length < 2) return pathFromPoints(offsetPts, closed);

  const wave: PointCm[] = [];
  const verts = closed ? offsetPts : offsetPts;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const n = inwardNormal(a, b);
    wave.push(a);
    wave.push({ x: mx + n.x * 0.15, y: my + n.y * 0.15 });
    wave.push(b);
  }
  if (closed) wave.push({ ...wave[0] });

  return pathFromPoints(wave, closed);
}
