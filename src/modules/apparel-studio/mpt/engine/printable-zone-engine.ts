import type { MedidasPiezaResueltas } from '../../moldes/types';
import type { PrintableZoneSpec } from '../types';

export function buildPrintableZone(
  pieza: MedidasPiezaResueltas,
  safeMarginCm: number,
  sublimationSafe: boolean
): PrintableZoneSpec {
  if (!pieza.viewBox || !pieza.outlinePath) {
    return {
      enabled: false,
      safeMarginCm,
      sublimationSafe,
    };
  }

  const parts = pieza.viewBox.split(' ').map(Number);
  const x = parts[0] ?? 0;
  const y = parts[1] ?? 0;
  const w = parts[2] ?? 0;
  const h = parts[3] ?? 0;
  const m = Math.max(0, safeMarginCm);

  return {
    enabled: w > m * 2 && h > m * 2,
    safeMarginCm: m,
    bounds: {
      x: x + m,
      y: y + m,
      width: Math.max(0, w - m * 2),
      height: Math.max(0, h - m * 2),
    },
    sublimationSafe,
    notes: sublimationSafe ? 'Zona segura sublimación/DTF' : undefined,
  };
}
