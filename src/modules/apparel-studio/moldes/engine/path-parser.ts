import type { PointCm } from '../types';

/** Parsea paths SVG paramétricos (M/L/Q/Z) generados por piece-geometry */
export function sampleSvgPath(pathD: string, curveSteps = 10): PointCm[] {
  const points: PointCm[] = [];
  const tokens = pathD.match(/[MLQZ]|[-+]?[\d.]+(?:e[-+]?\d+)?/gi);
  if (!tokens) return points;

  let i = 0;
  let cx = 0;
  let cy = 0;
  let subpathStart: PointCm | null = null;

  const readNum = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') {
      cx = readNum();
      cy = readNum();
      subpathStart = { x: cx, y: cy };
      points.push({ x: cx, y: cy });
    } else if (cmd === 'L' || cmd === 'l') {
      cx = readNum();
      cy = readNum();
      points.push({ x: cx, y: cy });
    } else if (cmd === 'Q' || cmd === 'q') {
      const qx = readNum();
      const qy = readNum();
      const ex = readNum();
      const ey = readNum();
      const p0 = { x: cx, y: cy };
      const p1 = { x: qx, y: qy };
      const p2 = { x: ex, y: ey };
      for (let s = 1; s <= curveSteps; s++) {
        const t = s / curveSteps;
        const mt = 1 - t;
        points.push({
          x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
          y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
        });
      }
      cx = ex;
      cy = ey;
    } else if (cmd === 'Z' || cmd === 'z') {
      if (subpathStart) {
        points.push({ ...subpathStart });
        cx = subpathStart.x;
        cy = subpathStart.y;
      }
    }
  }

  return dedupeAdjacent(points);
}

export function isClosedPath(pathD: string, points: PointCm[]): boolean {
  if (/Z\s*$/i.test(pathD.trim())) return true;
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.y - last.y) < 0.01;
}

function dedupeAdjacent(points: PointCm[]): PointCm[] {
  if (points.length === 0) return points;
  const out: PointCm[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.001) {
      out.push(p);
    }
  }
  return out;
}

export function pathFromPoints(points: PointCm[], close = true): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (const p of rest) {
    d += ` L ${p.x} ${p.y}`;
  }
  if (close) d += ' Z';
  return d;
}
