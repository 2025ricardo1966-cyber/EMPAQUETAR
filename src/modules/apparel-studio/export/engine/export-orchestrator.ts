import type {
  ApparelExportFormat,
  ApparelExportRequest,
  ApparelExportResult,
} from '../types';
import { DEFAULT_LAYOUT, EXPORT_FORMAT_META } from '../types';
import { layoutPiecesForExport } from './layout-engine';
import { buildExportSvg } from './svg-builder';
import { buildExportDxf } from './dxf-builder';
import { buildExportEps } from './eps-builder';
import { buildExportAi } from './ai-builder';
import { buildExportPdf } from './pdf-builder';

function purposeSlug(purpose: ApparelExportRequest['purpose']): string {
  switch (purpose) {
    case 'cutting':
      return 'corte';
    case 'print':
      return 'impresion';
    case 'sublimation':
      return 'sublimacion';
  }
}

function buildSuggestedFileName(request: ApparelExportRequest): string {
  const meta = EXPORT_FORMAT_META[request.format];
  const slug = purposeSlug(request.purpose);
  const safeName = request.moldName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
  return `${safeName}-${request.talle}-${slug}.${meta.extension}`;
}

/** Genera archivo de exportación según formato y propósito */
export function buildApparelExport(request: ApparelExportRequest): ApparelExportResult {
  const layout = layoutPiecesForExport(
    request.piezas,
    request.layout ?? DEFAULT_LAYOUT,
    request.mptByPiezaId
  );
  const meta = EXPORT_FORMAT_META[request.format];
  const suggestedFileName = buildSuggestedFileName(request);
  const svg = buildExportSvg(layout, request);

  const base: ApparelExportResult = {
    format: request.format,
    purpose: request.purpose,
    extension: meta.extension,
    mimeType: meta.mimeType,
    suggestedFileName,
    svgIntermediate: svg,
  };

  switch (request.format) {
    case 'svg':
      return { ...base, contentUtf8: svg };
    case 'dxf':
      return { ...base, contentUtf8: buildExportDxf(layout, request) };
    case 'eps':
      return { ...base, contentUtf8: buildExportEps(layout, request) };
    case 'ai':
      return { ...base, contentUtf8: buildExportAi(layout, request) };
    case 'pdf':
      return { ...base, contentUtf8: buildExportPdf(layout, request) };
    case 'png':
    case 'jpg':
      return base;
    default: {
      const _exhaustive: never = request.format;
      return _exhaustive;
    }
  }
}

export function isRasterFormat(format: ApparelExportFormat): boolean {
  return format === 'png' || format === 'jpg';
}
