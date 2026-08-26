import { sampleSvgPath } from '../../moldes/engine/path-parser';
import type { MedidasPiezaResueltas } from '../../moldes/types';
import type { ExportLayoutResult } from '../types';
import type { ApparelExportRequest } from '../types';

function resolveCutPath(
  pieza: MedidasPiezaResueltas,
  request: ApparelExportRequest
): string | undefined {
  const mpt = request.mptByPiezaId?.[String(pieza.piezaId)];
  if (
    request.includeMptMargins &&
    request.purpose === 'cutting' &&
    mpt?.margins?.cutOutlinePath
  ) {
    return mpt.margins.cutOutlinePath;
  }
  return pieza.outlinePath;
}

/** Exporta contornos como DXF R12 (LWPOLYLINE) — unidades en cm */
export function buildExportDxf(layout: ExportLayoutResult, request: ApparelExportRequest): string {
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  for (const placed of layout.placements) {
    const cutPath = resolveCutPath(placed.pieza, request);
    const seamPath = placed.pieza.outlinePath;
    if (!cutPath && !seamPath) continue;

    const points = sampleSvgPath(cutPath ?? seamPath!);
    if (points.length < 2) continue;

    const layer =
      request.purpose === 'cutting'
        ? 'CORTE'
        : request.purpose === 'sublimation'
          ? 'SUBLIM'
          : 'IMPRESION';

    lines.push('0', 'LWPOLYLINE', '8', layer, '90', String(points.length), '70', '1');

    for (const p of points) {
      const x = (placed.x + p.x).toFixed(4);
      const y = (layout.heightCm - (placed.y + p.y)).toFixed(4);
      lines.push('10', x, '20', y);
    }

    lines.push(
      '0',
      'TEXT',
      '8',
      'ETIQUETAS',
      '10',
      (placed.x + placed.width * 0.5).toFixed(4),
      '20',
      (layout.heightCm - placed.y + 1.5).toFixed(4),
      '40',
      '2.5',
      '1',
      placed.pieza.piezaNombre
    );

    const mpt = request.mptByPiezaId?.[String(placed.pieza.piezaId)];
    if (request.purpose === 'cutting' && mpt?.cutInstruction?.visible) {
      lines.push(
        '0',
        'TEXT',
        '8',
        'ETIQUETAS',
        '10',
        (placed.x + placed.width * 0.5).toFixed(4),
        '20',
        (layout.heightCm - placed.y + 3.5).toFixed(4),
        '40',
        '2',
        '1',
        mpt.cutInstruction.cutLabel
      );
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}
