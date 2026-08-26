import { randomUUID } from 'crypto';

export interface ColorProfile {
  colors: string[];
  spaces: string[];
  source: 'embedded-heuristic';
  originalBytes: number;
}

export interface CdrPhysicalGuess {
  widthMm?: number;
  heightMm?: number;
  source: 'binary-heuristic' | 'unverified';
}

export interface CdrConversionResult {
  pdf: Buffer;
  profile: ColorProfile;
  physical: CdrPhysicalGuess;
  warnings: string[];
  equivalent: false;
  originalPreserved: true;
}

export function isCorelDraw(filename: string, mimeType: string): boolean {
  const name = filename.toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  return name.endsWith('.cdr') || mime.includes('corel') || mime === 'application/x-coreldraw';
}

export function extractColorProfile(bytes: Buffer): ColorProfile {
  const text = bytes.toString('latin1');
  const hex = [...text.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => `#${m[1].toUpperCase()}`);
  const cmyk = [...text.matchAll(/CMYK\s*[:(]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/gi)].map(
    (m) => `CMYK(${m[1]},${m[2]},${m[3]},${m[4]})`
  );
  const unique = [...new Set([...hex, ...cmyk])].slice(0, 32);
  if (!unique.length) unique.push('#000000');
  const spaces = [];
  if (hex.length) spaces.push('RGB');
  if (cmyk.length) spaces.push('CMYK');
  if (!spaces.length) spaces.push('RGB');
  return { colors: unique, spaces, source: 'embedded-heuristic', originalBytes: bytes.length };
}

export function guessCdrPhysicalSize(bytes: Buffer): CdrPhysicalGuess {
  const text = bytes.toString('latin1');
  const mm = [...text.matchAll(/(\d{2,4}(?:\.\d+)?)\s*mm/gi)].map((m) => Number(m[1])).filter((n) => n > 5 && n < 20000);
  if (mm.length >= 2) return { widthMm: mm[0], heightMm: mm[1], source: 'binary-heuristic' };
  const cm = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*cm/gi)].map((m) => Number(m[1]) * 10).filter((n) => n > 5 && n < 20000);
  if (cm.length >= 2) return { widthMm: cm[0], heightMm: cm[1], source: 'binary-heuristic' };
  return { source: 'unverified' };
}

/** PDF derivado. El CDR original no se modifica. No se afirma equivalencia. */
export function convertCdrToPdf(filename: string, originalBytes: Buffer): CdrConversionResult {
  const profile = extractColorProfile(originalBytes);
  const physical = guessCdrPhysicalSize(originalBytes);
  const warnings = [
    'CONVERSION_NOT_EQUIVALENT',
    'VECTORS_NOT_GUARANTEED',
    'FONTS_MAY_BE_SUBSTITUTED',
    'COLOR_SPACE_HEURISTIC',
  ];
  if (physical.source === 'unverified') warnings.push('PHYSICAL_SIZE_UNVERIFIED');
  const widthPt = physical.widthMm ? (physical.widthMm * 72) / 25.4 : 612;
  const heightPt = physical.heightMm ? (physical.heightMm * 72) / 25.4 : 792;
  const pdf = buildDerivedPdf(filename, profile, widthPt, heightPt, warnings);
  return {
    pdf,
    profile,
    physical,
    warnings,
    equivalent: false,
    originalPreserved: true,
  };
}

export function buildDerivedPdf(
  filename: string,
  profile: ColorProfile,
  widthPt = 612,
  heightPt = 792,
  warnings: string[] = ['CONVERSION_NOT_EQUIVALENT']
): Buffer {
  const body = [
    `% Derived from ${filename}`,
    `Colors: ${profile.colors.join(', ')}`,
    `Spaces: ${profile.spaces.join(', ')}`,
    `Warnings: ${warnings.join(', ')}`,
    'Original CorelDRAW file preserved. Conversion is not identical.',
  ].join('\n');
  const stream = `BT /F1 11 Tf 36 ${Math.max(48, heightPt - 72).toFixed(1)} Td (${escapePdf(body)}) Tj ET`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let offset = '%PDF-1.4\n'.length;
  const xref = ['0000000000 65535 f '];
  let bodyOut = '%PDF-1.4\n';
  for (const obj of objects) {
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    bodyOut += obj + '\n';
    offset += obj.length + 1;
  }
  const startxref = Buffer.byteLength(bodyOut, 'utf8');
  bodyOut += `xref\n0 ${objects.length + 1}\n${xref.join('\n')}\n`;
  bodyOut += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(bodyOut, 'utf8');
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');
}

export function newConversionId(): string {
  return randomUUID();
}
