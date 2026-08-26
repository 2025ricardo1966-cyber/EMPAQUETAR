import type { MedidasPiezaResueltas } from '../../moldes/types';
import type { PieceProductionMetadata } from '../../mpt/types';
import { shouldExportPieceToPlotter } from '../../mpt/engine/cut-mode-engine';
import type { ApparelExportLayoutOptions, ExportLayoutResult, PlacedExportPiece } from '../types';
import { DEFAULT_LAYOUT } from '../types';

function parseViewBox(viewBox: string | undefined): { w: number; h: number } {
  if (!viewBox) return { w: 20, h: 20 };
  const parts = viewBox.split(' ').map(Number);
  return { w: parts[2] ?? 20, h: parts[3] ?? 20 };
}

/** Distribuye piezas en hoja para exportación — respeta modos de corte MPT */
export function layoutPiecesForExport(
  piezas: MedidasPiezaResueltas[],
  options: ApparelExportLayoutOptions = DEFAULT_LAYOUT,
  mptByPiezaId?: Record<string, PieceProductionMetadata>
): ExportLayoutResult {
  const { marginCm, gapCm, sheetWidthCm } = options;
  const exportable = piezas.filter((p) => {
    const mpt = mptByPiezaId?.[String(p.piezaId)];
    if (mptByPiezaId) {
      return shouldExportPieceToPlotter(p, mpt?.cutInstruction);
    }
    return !p.esEspejo && p.outlinePath && p.viewBox;
  });

  let x = marginCm;
  let y = marginCm;
  let rowHeight = 0;
  let maxRight = marginCm;
  const placements: PlacedExportPiece[] = [];

  for (const pieza of exportable) {
    const { w, h } = parseViewBox(pieza.viewBox);
    if (x + w > sheetWidthCm - marginCm && x > marginCm) {
      x = marginCm;
      y += rowHeight + gapCm;
      rowHeight = 0;
    }
    placements.push({ pieza, x, y, width: w, height: h });
    x += w + gapCm;
    rowHeight = Math.max(rowHeight, h);
    maxRight = Math.max(maxRight, x);
  }

  return {
    placements,
    widthCm: Math.max(maxRight, marginCm * 2 + 20),
    heightCm: y + rowHeight + marginCm,
  };
}
