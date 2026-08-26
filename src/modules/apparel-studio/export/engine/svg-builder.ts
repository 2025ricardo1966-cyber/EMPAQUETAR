import { buildFabricRenderProfile } from '../../moldes/engine/fabric-engine';
import { buildIdentificationSvgGroup } from '../../mpt/engine/identification-svg';
import type { MedidasPiezaResueltas } from '../../moldes/types';
import type { ApparelExportPurpose, ExportLayoutResult, PlacedExportPiece } from '../types';
import type { ApparelExportRequest } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function purposeStyles(purpose: ApparelExportPurpose): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  showLabels: boolean;
  showOverlay: boolean;
} {
  switch (purpose) {
    case 'cutting':
      return { fill: 'none', stroke: '#111111', strokeWidth: 0.35, showLabels: true, showOverlay: false };
    case 'print':
      return { fill: '#f5f5f0', stroke: '#333333', strokeWidth: 0.25, showLabels: true, showOverlay: false };
    case 'sublimation':
      return { fill: 'url(#fabric-fill)', stroke: '#222222', strokeWidth: 0.15, showLabels: false, showOverlay: true };
  }
}

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

function pieceGroupMarkup(
  placed: PlacedExportPiece,
  purpose: ApparelExportPurpose,
  request: ApparelExportRequest,
  styles: ReturnType<typeof purposeStyles>,
  fabricPattern: string | null,
  allPiezas: MedidasPiezaResueltas[]
): string {
  const { pieza, x, y } = placed;
  const outlinePath = resolveCutPath(pieza, request);
  if (!outlinePath) return '';

  const mpt = request.mptByPiezaId?.[String(pieza.piezaId)];

  const slot = pieza.slotId;
  const overlay =
    styles.showOverlay && slot
      ? request.sublimationBySlot?.[slot] ??
        (slot === 'frente'
          ? request.egresadosOverlay?.frente
          : slot === 'espalda'
            ? request.egresadosOverlay?.espalda
            : undefined)
      : undefined;

  const fill = purpose === 'sublimation' && fabricPattern ? fabricPattern : styles.fill;

  const cutLabel =
    request.purpose === 'cutting' && mpt?.cutInstruction?.visible
      ? mpt.cutInstruction.cutLabel
      : null;
  const legacyMirror =
    !mpt &&
    allPiezas.some((p) => p.esEspejo && p.espejoDe === pieza.piezaId) &&
    request.purpose === 'cutting'
      ? 'CORTE ×2'
      : null;
  const cutNote = cutLabel ?? legacyMirror;

  const lines: string[] = [
    `<g transform="translate(${x.toFixed(2)}, ${y.toFixed(2)})" data-piece="${escapeXml(String(pieza.piezaId))}">`,
    `<path d="${outlinePath}" fill="${fill}" stroke="${styles.stroke}" stroke-width="${styles.strokeWidth}" vector-effect="non-scaling-stroke"/>`,
  ];

  if (
    request.includeMptMargins &&
    request.purpose === 'cutting' &&
    mpt?.marginSpec.showEdgeMargins &&
    mpt.margins.edgePaths.length > 0
  ) {
    for (const edge of mpt.margins.edgePaths) {
      lines.push(
        `<path d="${edge.path}" fill="none" stroke="#666" stroke-width="0.2" vector-effect="non-scaling-stroke" data-margin="${edge.kind}"/>`
      );
    }
  }

  if (pieza.outlinePath && request.includeMptMargins && request.purpose === 'cutting') {
    lines.push(
      `<path d="${pieza.outlinePath}" fill="none" stroke="#999" stroke-width="0.15" stroke-dasharray="0.5 0.4" vector-effect="non-scaling-stroke" data-layer="molde-seam"/>`
    );
  }

  if (overlay) {
    lines.push(`<g clip-path="url(#clip-${pieza.piezaId})">${overlay}</g>`);
  }

  if (mpt?.identification && request.mptByPiezaId) {
    lines.push(buildIdentificationSvgGroup(mpt.identification, 0, 0));
  } else if (styles.showLabels) {
    const labelY = placed.height * 0.08;
    lines.push(
      `<text x="${(placed.width * 0.5).toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="2.5" fill="#444">${escapeXml(pieza.piezaNombre)}</text>`
    );
    if (cutNote) {
      lines.push(
        `<text x="${(placed.width * 0.5).toFixed(2)}" y="${(labelY + 3.5).toFixed(2)}" text-anchor="middle" font-size="2" fill="#888">${escapeXml(cutNote)}</text>`
      );
    }
  }

  lines.push('</g>');
  return lines.join('\n');
}

export function buildExportSvg(
  layout: ExportLayoutResult,
  request: ApparelExportRequest
): string {
  const styles = purposeStyles(request.purpose);
  const fabricId = request.fabricId ?? 'dry-fit';
  const fabric = buildFabricRenderProfile(fabricId);
  const fabricFill =
    request.purpose === 'sublimation' ? fabric.patternFill ?? fabric.baseColor : null;

  const defs: string[] = [];
  if (request.purpose === 'sublimation') {
    defs.push(`<defs>${fabric.defsMarkup}<style>#fabric-fill { fill: ${fabric.baseColor}; }</style>`);
    for (const placed of layout.placements) {
      if (placed.pieza.outlinePath) {
        defs.push(
          `<clipPath id="clip-${placed.pieza.piezaId}"><path d="${placed.pieza.outlinePath}"/></clipPath>`
        );
      }
    }
    defs.push('</defs>');
  }

  const header = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.widthCm.toFixed(2)} ${layout.heightCm.toFixed(2)}" width="${layout.widthCm.toFixed(2)}cm" height="${layout.heightCm.toFixed(2)}cm">`,
    `<title>${escapeXml(request.moldName)} · ${request.talle} · ${request.purpose}</title>`,
    ...defs,
    `<rect width="100%" height="100%" fill="${request.purpose === 'cutting' ? '#ffffff' : '#fafaf8'}"/>`,
    `<text x="2" y="4" font-size="3" fill="#666">${escapeXml(`${request.moldName} · ${request.categoria} · talle ${request.talle}`)}</text>`,
  ];

  const body = layout.placements.map((p) =>
    pieceGroupMarkup(p, request.purpose, request, styles, fabricFill, request.piezas)
  );

  return [...header, ...body, '</svg>'].join('\n');
}
