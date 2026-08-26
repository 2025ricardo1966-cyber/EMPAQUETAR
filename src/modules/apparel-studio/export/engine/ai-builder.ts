import type { ExportLayoutResult } from '../types';
import type { ApparelExportRequest } from '../types';
import { buildExportEps } from './eps-builder';

/**
 * AI — EPS encapsulado con cabecera Adobe Illustrator.
 * Abre en Illustrator y se puede re-exportar nativamente.
 */
export function buildExportAi(
  layout: ExportLayoutResult,
  request: ApparelExportRequest
): string {
  const eps = buildExportEps(layout, request);
  return [
    '%!Adobe-Illustrator-3.0',
    '%%Creator: MASCAYL Apparel Studio',
    `%%Title: ${request.moldName}`,
    '%%AI8_CreatorVersion: 24.0.0',
    '%%For: Apparel Studio Export',
    '%%EndComments',
    eps,
  ].join('\n');
}
