import type { MedidasPiezaResueltas } from '../../moldes/types';
import { isClosedPath, pathFromPoints, sampleSvgPath } from '../../moldes/engine/path-parser';
import { offsetClosedPolyline } from '../../moldes/engine/seam-geometry';
import type { SeamAllowanceSpec } from '../types';

/**
 * Contorno de corte y pespunte.
 * Piezas abiertas (cuello V) o compuestas (manga con cierre: Z no al final)
 * conservan el outline como corte — no se omiten.
 */
export function buildCutAndStitchPaths(
  pieza: MedidasPiezaResueltas,
  seam: SeamAllowanceSpec
): { cutOutlinePath?: string; stitchOutlinePath?: string } {
  if (!pieza.outlinePath || pieza.esEspejo) {
    return {};
  }

  const outline = pieza.outlinePath;
  const points = sampleSvgPath(outline);
  if (points.length < 3) {
    return { cutOutlinePath: outline, stitchOutlinePath: outline };
  }

  const closed = isClosedPath(outline, points);
  if (closed) {
    const cutPts = offsetClosedPolyline(points, -seam.defaultCm);
    const stitchCm = seam.stitchLineCm ?? seam.defaultCm * 0.7;
    const stitchPts = offsetClosedPolyline(points, stitchCm);
    if (cutPts.length >= 3) {
      return {
        cutOutlinePath: pathFromPoints(cutPts, true),
        stitchOutlinePath: pathFromPoints(stitchPts, true),
      };
    }
  }

  return {
    cutOutlinePath: outline,
    stitchOutlinePath: outline,
  };
}
