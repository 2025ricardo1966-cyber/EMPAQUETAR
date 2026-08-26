import { RequestInvalidError } from './configuration-schema';
import type { OraFitness } from './ora-core';

export const ORA_FILE_INTENTS = [
  { id: 'CONVERT', label: 'CONVERTIR' },
  { id: 'VECTORIZE', label: 'VECTORIZAR' },
  { id: 'SCALE', label: 'ESCALAR' },
  { id: 'PREPARE_PRINT', label: 'PREPARAR PARA IMPRESIÓN' },
  { id: 'CHANGE_FORMAT', label: 'CAMBIAR FORMATO' },
] as const;

export type OraFileIntentId = (typeof ORA_FILE_INTENTS)[number]['id'];

export type OraGraphicFormat = 'cdr' | 'pdf' | 'png' | 'jpg' | 'svg' | 'webp' | 'avif' | 'tiff' | 'unknown';

export type OraGraphicNature = 'raster' | 'vector' | 'mixed' | 'unknown';

export type OraVectorKind = 'VECTOR_REAL' | 'VECTOR_ASSISTED' | 'RASTER_EMBEDDED';

export type OraFileOperation =
  | 'ANALYZE'
  | 'CONVERT'
  | 'VECTORIZE'
  | 'SCALE'
  | 'PREPARE_PRINT'
  | 'CHANGE_FORMAT';

export interface OraFileDiagnosis {
  format: OraGraphicFormat;
  mimeType: string;
  nature: OraGraphicNature;
  widthPx?: number;
  heightPx?: number;
  widthMm?: number;
  heightMm?: number;
  ppi?: number;
  colorSpace?: string;
  transparency?: boolean;
  hasText?: boolean;
  approxElements?: number;
  conversionPossible: OraGraphicFormat[];
  recommendedIntent: OraFileIntentId[];
  fitness?: OraFitness;
  warnings: string[];
  notes: string[];
}

export interface OraCompatibleOperation {
  intent: OraFileIntentId;
  operation: OraFileOperation;
  targets: OraGraphicFormat[];
  vectorKind?: OraVectorKind;
  executable: boolean;
  reason?: string;
}

export function detectGraphicFormat(filename: string, mimeType: string, bytes?: Buffer): OraGraphicFormat {
  const name = filename.toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (name.endsWith('.cdr') || mime.includes('corel')) return 'cdr';
  if (name.endsWith('.pdf') || mime === 'application/pdf' || (bytes && bytes.slice(0, 5).toString() === '%PDF-')) return 'pdf';
  if (name.endsWith('.svg') || mime.includes('svg') || (bytes && bytes.toString('utf8', 0, 80).includes('<svg'))) return 'svg';
  if (name.endsWith('.png') || mime === 'image/png' || (bytes && bytes[0] === 0x89 && bytes[1] === 0x50)) return 'png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || mime === 'image/jpeg' || (bytes && bytes[0] === 0xff && bytes[1] === 0xd8)) {
    return 'jpg';
  }
  if (name.endsWith('.webp') || mime.includes('webp')) return 'webp';
  if (name.endsWith('.avif') || mime.includes('avif')) return 'avif';
  if (name.endsWith('.tif') || name.endsWith('.tiff') || mime.includes('tiff')) return 'tiff';
  return 'unknown';
}

export function parseFileIntent(raw: unknown): OraFileIntentId {
  const v = String(raw || '').toUpperCase();
  if (v === 'CONVERT' || v === 'VECTORIZE' || v === 'SCALE' || v === 'PREPARE_PRINT' || v === 'CHANGE_FORMAT') return v;
  throw new RequestInvalidError('ORA_FILE_INTENT');
}

export function parseTargetFormat(raw: unknown): OraGraphicFormat {
  const v = String(raw || '').toLowerCase().replace('jpeg', 'jpg');
  if (v === 'pdf' || v === 'png' || v === 'jpg' || v === 'svg' || v === 'webp' || v === 'avif') return v;
  throw new RequestInvalidError('ORA_FILE_TARGET');
}

export function compatibleOperations(diagnosis: OraFileDiagnosis): OraCompatibleOperation[] {
  const out: OraCompatibleOperation[] = [];
  const fmt = diagnosis.format;
  const convertTargets = diagnosis.conversionPossible.filter((t) => t !== fmt);
  if (convertTargets.length) {
    out.push({
      intent: 'CONVERT',
      operation: 'CONVERT',
      targets: convertTargets,
      executable: convertTargets.some((t) => t !== 'webp' && t !== 'avif'),
      reason: convertTargets.includes('webp') || convertTargets.includes('avif')
        ? 'WEBP_AVIF_REQUIRE_FUTURE_ENCODER'
        : undefined,
    });
    out.push({
      intent: 'CHANGE_FORMAT',
      operation: 'CHANGE_FORMAT',
      targets: convertTargets,
      executable: true,
    });
  }
  if (fmt === 'png' || fmt === 'jpg') {
    out.push({
      intent: 'VECTORIZE',
      operation: 'VECTORIZE',
      targets: ['svg'],
      vectorKind: fmt === 'png' ? 'VECTOR_ASSISTED' : 'RASTER_EMBEDDED',
      executable: true,
      reason: fmt === 'jpg' ? 'JPEG_PIXELS_NOT_DECODED_EMBED_ONLY' : 'TRACE_ASSISTED_NOT_INDUSTRIAL',
    });
  }
  if (fmt === 'svg' && (diagnosis.nature === 'vector' || diagnosis.nature === 'mixed')) {
    out.push({
      intent: 'VECTORIZE',
      operation: 'VECTORIZE',
      targets: ['svg', 'pdf'],
      vectorKind: diagnosis.nature === 'vector' ? 'VECTOR_REAL' : 'RASTER_EMBEDDED',
      executable: true,
    });
  }
  if (fmt === 'png' || fmt === 'jpg' || fmt === 'svg') {
    out.push({
      intent: 'SCALE',
      operation: 'SCALE',
      targets: ['png', 'jpg', 'webp', 'avif'],
      executable: fmt === 'png',
      reason: 'AI_8K_16K_PREPARED_NOT_EXECUTED',
    });
  }
  out.push({
    intent: 'PREPARE_PRINT',
    operation: 'PREPARE_PRINT',
    targets: diagnosis.conversionPossible.includes('pdf') ? ['pdf'] : convertTargets.slice(0, 1),
    executable: true,
  });
  return out;
}

export function oraFileIntents() {
  return ORA_FILE_INTENTS.map((row) => ({ ...row, capability: 'FILE_CONVERSION' as const }));
}
