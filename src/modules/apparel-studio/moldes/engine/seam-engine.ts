import { getSeamDefinition, listSeamOptions } from '../catalog/seam-catalog';
import type {
  MedidasPiezaResueltas,
  MoldeId,
  PieceSeamsOverlay,
  PointCm,
  SeamId,
  SeamRenderLine,
  SeamSelectionEntry,
} from '../types';
import { isClosedPath, pathFromPoints, sampleSvgPath } from './path-parser';
import {
  buildDecorativeWave,
  buildOverlockZigzag,
  offsetClosedPolyline,
  offsetOpenPolyline,
} from './seam-geometry';

function buildSeamLinePath(
  edgePoints: PointCm[],
  closed: boolean,
  offsetCm: number,
  zigzag?: boolean,
  decorative?: boolean
): string {
  if (zigzag) {
    return buildOverlockZigzag(edgePoints, closed);
  }
  if (decorative) {
    return buildDecorativeWave(edgePoints, closed, offsetCm);
  }
  const offsetPts =
    offsetCm === 0
      ? edgePoints
      : closed
        ? offsetClosedPolyline(edgePoints, offsetCm)
        : offsetOpenPolyline(edgePoints, offsetCm);
  return pathFromPoints(offsetPts, closed);
}

export function computeSeamsForOutline(
  outlinePath: string,
  seamId: SeamId,
  viewBoxWidth = 50
): PieceSeamsOverlay {
  const def = getSeamDefinition(seamId);
  const edgePoints = sampleSvgPath(outlinePath);
  const closed = isClosedPath(outlinePath, edgePoints);

  const lines: SeamRenderLine[] = def.layers.map((layer) => {
    const path = buildSeamLinePath(
      edgePoints,
      closed,
      layer.offsetCm,
      layer.zigzag,
      seamId === 'decorativa'
    );
    return {
      path,
      label: layer.label,
      stroke: layer.stroke,
      strokeWidth: Math.max(0.15, viewBoxWidth * layer.strokeWidthRatio),
      strokeDasharray: layer.strokeDasharray,
      strokeLinecap: layer.zigzag ? 'round' : 'butt',
    };
  });

  return {
    seamId,
    edgePath: outlinePath,
    lines: lines.filter((l) => l.path.length > 0),
  };
}

export function computeSeamsForPiece(
  pieza: MedidasPiezaResueltas,
  seamId: SeamId
): PieceSeamsOverlay | null {
  if (!pieza.outlinePath || pieza.esEspejo) return null;
  const vbW = pieza.viewBox ? parseFloat(pieza.viewBox.split(' ')[2]) : 50;
  return computeSeamsForOutline(pieza.outlinePath, seamId, vbW);
}

export function computeSeamsForGarment(
  piezas: MedidasPiezaResueltas[],
  seamId: SeamId,
  pieceOverrides?: Record<string, SeamId>
): Map<string, PieceSeamsOverlay> {
  const result = new Map<string, PieceSeamsOverlay>();
  for (const pieza of piezas) {
    if (pieza.esEspejo || !pieza.outlinePath) continue;
    const effectiveSeam = pieceOverrides?.[String(pieza.piezaId)] ?? seamId;
    const overlay = computeSeamsForPiece(pieza, effectiveSeam);
    if (overlay) result.set(String(pieza.piezaId), overlay);
  }
  return result;
}

const DEFAULT_SEAM: SeamId = 'simple';

export function getDefaultSeamForMolde(_moldId: MoldeId): SeamId {
  return DEFAULT_SEAM;
}

export function getEffectiveSeamId(
  moldId: MoldeId,
  selections: SeamSelectionEntry[]
): SeamId {
  const saved = selections.find((s) => s.moldId === moldId);
  return saved?.seamId ?? getDefaultSeamForMolde(moldId);
}

export function seamSelectionFromId(moldId: MoldeId, seamId: SeamId): SeamSelectionEntry {
  return {
    moldId,
    seamId,
    updatedAt: new Date().toISOString(),
  };
}

export { listSeamOptions, getSeamDefinition };
