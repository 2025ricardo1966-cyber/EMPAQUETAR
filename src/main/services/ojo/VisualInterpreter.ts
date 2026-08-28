import type { OjoDiagnosis, OjoMaterialKind } from '../../../contracts/visual-interpreter';

const MIN_SHORT_SIDE_PX = 1500;
const EXTREME_RATIO = 4;

export function interpretIngestedDesign(input: {
  fileId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  generatedAt?: number;
}): OjoDiagnosis {
  const filename = String(input.filename || '').toLowerCase();
  const mime = String(input.mimeType || '').toLowerCase();
  const kind = classifyKind(filename, mime);
  const size = readRasterSize(input.bytes, filename, mime);
  const reasons: string[] = [];
  const ratio = size && size.height ? size.width / size.height : null;
  const shortSide = size ? Math.min(size.width, size.height) : 0;
  const resolutionInsufficient = kind === 'raster_design' || kind === 'photo' ? !size || shortSide < MIN_SHORT_SIDE_PX : false;
  const proportionRisk = ratio != null && (ratio > EXTREME_RATIO || ratio < 1 / EXTREME_RATIO);
  if (!size && (kind === 'raster_design' || kind === 'photo')) reasons.push('DIMENSIONS_UNKNOWN');
  if (resolutionInsufficient) reasons.push('RESOLUTION_INSUFFICIENT');
  if (proportionRisk) reasons.push('PROPORTION_RISK');
  if (kind === 'document') reasons.push('DOCUMENT_NEEDS_PREP');
  const recommendScale = resolutionInsufficient;
  const recommendPreparation = resolutionInsufficient || proportionRisk || kind === 'document' || kind === 'vector_design';
  const humanIntervention = kind === 'document' || kind === 'unknown' || proportionRisk;
  let productionFitness: OjoDiagnosis['productionFitness'] = 'ready';
  if (recommendPreparation) productionFitness = 'prepare';
  if (humanIntervention) productionFitness = 'review';
  return {
    version: 'v1',
    fileId: input.fileId,
    kind,
    widthPx: size?.width,
    heightPx: size?.height,
    resolutionInsufficient,
    proportionRisk,
    productionFitness,
    recommendScale,
    recommendPreparation,
    humanIntervention,
    reasons,
    layer: {
      zone: 'front',
      scale: recommendScale ? 1.5 : 1,
      orientation: 'upright',
      proportion: size ? { width: size.width, height: size.height, ratio: size.height ? size.width / size.height : 1 } : null,
      designType: kind,
    },
    generatedAt: input.generatedAt || Date.now(),
  };
}

function classifyKind(filename: string, mime: string): OjoMaterialKind {
  if (mime.includes('svg') || filename.endsWith('.svg') || filename.endsWith('.ai') || filename.endsWith('.eps') || mime.includes('postscript')) {
    return 'vector_design';
  }
  if (mime.includes('pdf') || filename.endsWith('.pdf')) return 'document';
  if (mime.startsWith('image/') || filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.webp')) {
    return 'raster_design';
  }
  return 'unknown';
}

function readRasterSize(bytes: Buffer, filename: string, mime: string): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const jpeg = readJpegSize(bytes);
  if (jpeg) return jpeg;
  if (mime.includes('svg') || filename.endsWith('.svg')) return readSvgSize(bytes.toString('utf8'));
  return null;
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    const len = bytes.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

function readSvgSize(text: string): { width: number; height: number } | null {
  const box = text.match(/viewBox\s*=\s*["']([\d.\s-]+)["']/i);
  if (box) {
    const parts = box[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] };
  }
  const w = Number((text.match(/\bwidth\s*=\s*["']([\d.]+)/i) || [])[1]);
  const h = Number((text.match(/\bheight\s*=\s*["']([\d.]+)/i) || [])[1]);
  if (w > 0 && h > 0) return { width: w, height: h };
  return null;
}
