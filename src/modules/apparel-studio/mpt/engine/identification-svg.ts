import type { ResolvedPieceIdentification } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Markup SVG del bloque de identificación — capa anotación, no geometría */
export function buildIdentificationSvgGroup(
  id: ResolvedPieceIdentification,
  offsetX = 0,
  offsetY = 0
): string {
  if (!id.visible || id.lines.length === 0) return '';

  const x = id.x + offsetX;
  const y = id.y + offsetY;
  const anchor = id.align === 'start' ? 'start' : id.align === 'end' ? 'end' : 'middle';
  const pad = id.fontSize * 0.35;
  const blockH = id.lines.length * id.lineHeight + pad * 2;
  const maxLen = Math.max(...id.lines.map((l) => l.text.length));
  const blockW = maxLen * id.fontSize * 0.55 + pad * 2;

  const rectX =
    anchor === 'middle' ? x - blockW / 2 : anchor === 'end' ? x - blockW : x;

  const lines: string[] = [
    `<g class="mpt-piece-identification" data-unique-id="${escapeXml(id.uniqueId)}">`,
    `<rect x="${rectX.toFixed(3)}" y="${(y - id.fontSize - pad).toFixed(3)}" width="${blockW.toFixed(3)}" height="${blockH.toFixed(3)}" fill="white" fill-opacity="0.82" stroke="#cbd5e1" stroke-width="${(id.fontSize * 0.06).toFixed(3)}" rx="${(id.fontSize * 0.15).toFixed(3)}"/>`,
  ];

  id.lines.forEach((line, i) => {
    const ly = y + i * id.lineHeight;
    const weight = line.key === 'uniqueId' ? ' font-family="monospace"' : '';
    const fill = line.key === 'number' ? '#0f766e' : line.key === 'uniqueId' ? '#334155' : '#1e293b';
    lines.push(
      `<text x="${x.toFixed(3)}" y="${ly.toFixed(3)}" text-anchor="${anchor}" font-size="${id.fontSize.toFixed(3)}" fill="${fill}" font-weight="${line.key === 'name' ? '600' : '400'}"${weight}>${escapeXml(line.text)}</text>`
    );
  });

  lines.push('</g>');
  return lines.join('\n');
}
