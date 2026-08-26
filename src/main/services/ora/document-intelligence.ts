import { detectGraphicFormat } from '../../../contracts/ora-file-conversion';

export type OraDocConfidenceZone = { zone: string; reason: string; confidence: 'low' | 'medium' | 'high' };

export interface OraDocumentExtraction {
  text: string;
  pages: number;
  structure: {
    titles: string[];
    paragraphs: string[];
    lists: string[];
    tables: string[];
    headers: string[];
    footers: string[];
  };
  lowConfidence: OraDocConfidenceZone[];
  validation: 'APTO' | 'APTO_CON_ADVERTENCIA' | 'REQUIERE_REVISION' | 'NO_APTO';
  warnings: string[];
  ocrExecuted: false;
}

function unescapePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractPdfLiteralStrings(bytes: Buffer): string[] {
  const raw = bytes.toString('latin1');
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const inner = unescapePdfString(m[0].slice(1, -1)).trim();
    if (inner.length >= 2 && /[A-Za-zÁÉÍÓÚáéíóúñÑ0-9]/.test(inner)) out.push(inner);
  }
  return out;
}

function structureFromLines(lines: string[]) {
  const titles: string[] = [];
  const paragraphs: string[] = [];
  const lists: string[] = [];
  for (const line of lines) {
    if (/^(\d+[\.\)]|-|\*|•)\s+/.test(line)) lists.push(line);
    else if (line.length < 80 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{4,}/.test(line)) titles.push(line);
    else paragraphs.push(line);
  }
  return { titles, paragraphs, lists, tables: [] as string[], headers: lines.slice(0, 1), footers: lines.slice(-1) };
}

export function extractStructuredDocument(filename: string, mimeType: string, bytes: Buffer): OraDocumentExtraction {
  const format = detectGraphicFormat(filename, mimeType, bytes);
  const warnings: string[] = ['OCR_ENGINE_NOT_PRESENT'];
  const lowConfidence: OraDocConfidenceZone[] = [];

  if (format === 'pdf' || bytes.slice(0, 5).toString() === '%PDF-') {
    const strings = extractPdfLiteralStrings(bytes);
    const pages = Math.max(1, (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length);
    const text = strings.join('\n');
    if (!text.trim()) {
      warnings.push('SCANNED_OR_EMPTY_PDF');
      lowConfidence.push({ zone: 'full-document', reason: 'NO_EXTRACTABLE_TEXT', confidence: 'low' });
      return {
        text: '',
        pages,
        structure: { titles: [], paragraphs: [], lists: [], tables: [], headers: [], footers: [] },
        lowConfidence,
        validation: 'REQUIERE_REVISION',
        warnings,
        ocrExecuted: false,
      };
    }
    const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (strings.length < 8) {
      lowConfidence.push({ zone: 'body', reason: 'SPARSE_TEXT_OPERATORS', confidence: 'low' });
      warnings.push('LOW_CONFIDENCE_STRUCTURE');
    }
    return {
      text,
      pages,
      structure: structureFromLines(lines),
      lowConfidence,
      validation: lowConfidence.length ? 'REQUIERE_REVISION' : 'APTO_CON_ADVERTENCIA',
      warnings,
      ocrExecuted: false,
    };
  }

  lowConfidence.push({ zone: 'full-document', reason: 'RASTER_NEEDS_OCR', confidence: 'low' });
  warnings.push('RASTER_DOCUMENT_NOT_OCRD');
  return {
    text: '',
    pages: 1,
    structure: { titles: [], paragraphs: [], lists: [], tables: [], headers: [], footers: [] },
    lowConfidence,
    validation: 'REQUIERE_REVISION',
    warnings,
    ocrExecuted: false,
  };
}

export function documentDerivatives(filename: string, extraction: OraDocumentExtraction) {
  const base = filename.replace(/\.[^.]+$/, '') || 'documento';
  const report = {
    original: filename,
    validation: extraction.validation,
    ocrExecuted: extraction.ocrExecuted,
    pages: extraction.pages,
    lowConfidence: extraction.lowConfidence,
    warnings: extraction.warnings,
    structure: extraction.structure,
  };
  const md = [
    `# ${base}`,
    '',
    `Validación: **${extraction.validation}**`,
    '',
    extraction.text || '_Sin texto extraíble. OCR no ejecutado._',
    '',
    '## Zonas de baja confianza',
    ...extraction.lowConfidence.map((z) => `- ${z.zone}: ${z.reason}`),
  ].join('\n');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${base}</title></head><body><h1>${base}</h1><p>Validación: ${extraction.validation}</p><pre>${escapeHtml(extraction.text)}</pre></body></html>`;
  return {
    json: Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
    txt: Buffer.from(extraction.text || extraction.warnings.join('\n'), 'utf8'),
    md: Buffer.from(md, 'utf8'),
    html: Buffer.from(html, 'utf8'),
    skipped: ['docx', 'xlsx'] as const,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
