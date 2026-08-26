import { sampleSvgPath } from '../../moldes/engine/path-parser';
import type { ExportLayoutResult } from '../types';
import type { ApparelExportRequest } from '../types';

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** PDF vectorial mínimo con paths de corte/impresión */
export function buildExportPdf(
  layout: ExportLayoutResult,
  request: ApparelExportRequest
): string {
  const pt = (cm: number) => (cm * 72) / 2.54;
  const pageW = pt(layout.widthCm);
  const pageH = pt(layout.heightCm);

  const streamLines: string[] = [
    'q',
    '1 1 1 rg',
    `0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)} re f`,
    'Q',
    'q',
  ];

  for (const placed of layout.placements) {
    const path = placed.pieza.outlinePath;
    if (!path) continue;
    const points = sampleSvgPath(path);
    if (points.length < 2) continue;

    if (request.purpose === 'sublimation') {
      streamLines.push('0.85 0.85 0.82 rg');
    } else if (request.purpose === 'print') {
      streamLines.push('0.96 0.96 0.94 rg');
    }

    streamLines.push(`${(request.purpose === 'cutting' ? 0.8 : 0.5).toFixed(2)} w`, '0 0 0 RG');

    points.forEach((p, i) => {
      const x = pt(placed.x + p.x);
      const y = pageH - pt(placed.y + p.y);
      streamLines.push(i === 0 ? `${x.toFixed(2)} ${y.toFixed(2)} m` : `${x.toFixed(2)} ${y.toFixed(2)} l`);
    });
    streamLines.push('h');

    if (request.purpose !== 'cutting') streamLines.push('B');
    else streamLines.push('S');

    streamLines.push(
      'BT',
      '/F1 8 Tf',
      `${pt(placed.x + placed.width * 0.5).toFixed(2)} ${(pageH - pt(placed.y - 0.4)).toFixed(2)} Td`,
      `(${pdfEscape(placed.pieza.piezaNombre)}) Tj`,
      'ET'
    );
  }

  streamLines.push('Q');
  const stream = streamLines.join('\n');
  const streamLen = new TextEncoder().encode(stream).length;

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${streamLen} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${obj}\n`;
  }

  const xrefPos = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return pdf;
}
