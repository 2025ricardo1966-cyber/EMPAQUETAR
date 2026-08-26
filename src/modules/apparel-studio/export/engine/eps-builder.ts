import { sampleSvgPath } from '../../moldes/engine/path-parser';
import type { ExportLayoutResult } from '../types';
import type { ApparelExportRequest } from '../types';

function escapePs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** EPS vectorial (PostScript) — compatible con RIP de sublimación */
export function buildExportEps(
  layout: ExportLayoutResult,
  request: ApparelExportRequest
): string {
  const wPt = layout.widthCm * 28.3465;
  const hPt = layout.heightCm * 28.3465;
  const scale = 28.3465;

  const pathOps: string[] = [];

  for (const placed of layout.placements) {
    const path = placed.pieza.outlinePath;
    if (!path) continue;
    const points = sampleSvgPath(path);
    if (points.length < 2) continue;

    pathOps.push('newpath');
    points.forEach((p, i) => {
      const x = (placed.x + p.x) * scale;
      const y = (layout.heightCm - (placed.y + p.y)) * scale;
      if (i === 0) pathOps.push(`${x.toFixed(3)} ${y.toFixed(3)} moveto`);
      else pathOps.push(`${x.toFixed(3)} ${y.toFixed(3)} lineto`);
    });
    pathOps.push('closepath');

    if (request.purpose === 'sublimation') {
      pathOps.push('gsave', '0.85 0.85 0.82 setrgbcolor', 'fill', 'grestore');
    }

    pathOps.push(
      request.purpose === 'cutting' ? '0 setlinewidth' : '0.3 setlinewidth',
      '0 0 0 setrgbcolor',
      'stroke'
    );

    pathOps.push(
      `/Helvetica findfont 8 scalefont setfont`,
      `${((placed.x + placed.width * 0.5) * scale).toFixed(3)} ${((layout.heightCm - placed.y + 1) * scale).toFixed(3)} moveto`,
      `(${escapePs(placed.pieza.piezaNombre)}) show`
    );
  }

  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%Creator: MASCAYL Apparel Studio`,
    `%%Title: ${request.moldName}`,
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    '%%EndComments',
    `${wPt.toFixed(3)} ${hPt.toFixed(3)} scale`,
    '1 1 1 setrgbcolor',
    `0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)} rectfill`,
    ...pathOps,
    'showpage',
    '%%EOF',
  ].join('\n');
}
