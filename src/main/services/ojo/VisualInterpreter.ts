import type {
  OjoAction,
  OjoDiagnosis,
  OjoFitness,
  OjoHint,
  OjoMaterialKind,
  OjoOrderContext,
  OjoRegion,
  OjoScaleAnalysis,
} from '../../../contracts/visual-interpreter';
import { ojoActionOf, parseOjoHints, parseOjoRegion } from '../../../contracts/visual-interpreter';
import { decodePng } from '../ora/png-codec';

const MIN_SHORT_SIDE_PX = 1500;
const EXTREME_RATIO = 4;
const PPI = 150;
const SMALL_REGION_AREA = 0.08;

export function interpretIngestedDesign(input: {
  fileId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  generatedAt?: number;
  region?: OjoRegion;
  hints?: OjoHint[];
  orderContext?: OjoOrderContext;
  originalFileId?: string;
}): OjoDiagnosis {
  const filename = String(input.filename || '').toLowerCase();
  const mime = String(input.mimeType || '').toLowerCase();
  const kind = classifyKind(filename, mime);
  const size = readRasterSize(input.bytes, filename, mime);
  const region = input.region;
  const hints = input.hints || [];
  const reasons: string[] = [];
  const risk: string[] = [];
  const qualityNotes: string[] = [];
  const ratio = size && size.height ? size.width / size.height : null;
  const regionBox = size && region ? regionPixelBox(size, region) : null;
  const measuredWidth = regionBox?.width || size?.width;
  const measuredHeight = regionBox?.height || size?.height;
  const shortSide = measuredWidth && measuredHeight ? Math.min(measuredWidth, measuredHeight) : 0;
  const fullShort = size ? Math.min(size.width, size.height) : 0;
  const resolutionInsufficient =
    kind === 'raster_design' || kind === 'photo' ? !size || shortSide < MIN_SHORT_SIDE_PX : false;
  const proportionRisk = ratio != null && (ratio > EXTREME_RATIO || ratio < 1 / EXTREME_RATIO);
  if (!size && (kind === 'raster_design' || kind === 'photo')) reasons.push('DIMENSIONS_UNKNOWN');
  if (resolutionInsufficient) reasons.push('RESOLUTION_INSUFFICIENT');
  if (proportionRisk) reasons.push('PROPORTION_RISK');
  if (kind === 'document') reasons.push('DOCUMENT_NEEDS_PREP');
  if (region) reasons.push(region.shape === 'ellipse' ? 'REGION_ELLIPSE' : 'REGION_RECT');
  for (const hint of hints) reasons.push(`HINT_${hint}`);

  const sizeAnalysis = analyzeScale(size, input.orderContext, regionBox);
  const recommendScale = resolutionInsufficient || sizeAnalysis.needsScale;
  const recommendPreparation =
    recommendScale || sizeAnalysis.needsResample || proportionRisk || kind === 'document' || kind === 'vector_design';
  const fontOnRaster = hints.includes('FUENTE') && (kind === 'raster_design' || kind === 'photo');
  if (fontOnRaster) {
    reasons.push('FONT_ON_RASTER');
    risk.push('FONT_NOT_EXTRACTABLE');
  }
  const humanIntervention = kind === 'document' || kind === 'unknown' || proportionRisk || fontOnRaster;
  let productionFitness: OjoFitness = 'ready';
  if (recommendPreparation) productionFitness = 'prepare';
  if (humanIntervention) productionFitness = 'review';
  const ambiguous = isAmbiguous({ kind, region, hints });
  if (ambiguous) reasons.push('AMBIGUOUS_REGION');

  if (mime.includes('jpeg') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) qualityNotes.push('JPEG_LOSSY');
  if (!size) qualityNotes.push('SIZE_UNKNOWN');
  if (shortSide && shortSide < 500) qualityNotes.push('VERY_LOW_PIXELS');
  const qualityScore: OjoDiagnosis['quality']['score'] =
    !size || shortSide < 500 ? 'low' : shortSide < MIN_SHORT_SIDE_PX ? 'medium' : 'high';
  if (proportionRisk) risk.push('EXTREME_ASPECT');
  if (resolutionInsufficient) risk.push('UPSCALE_REQUIRED');
  if (kind === 'unknown') risk.push('UNCLASSIFIED_FILE');
  if (ambiguous) risk.push('ELEMENT_UNDECLARED');

  const action: OjoAction = ojoActionOf(productionFitness);
  const content = describeContent(kind, hints, region, size);

  return {
    version: 'v1',
    fileId: input.fileId,
    originalFileId: input.originalFileId || input.fileId,
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
      zone: region ? 'front' : fullShort ? 'front' : 'unknown',
      scale: sizeAnalysis.scaleFactor && sizeAnalysis.scaleFactor > 1 ? sizeAnalysis.scaleFactor : recommendScale ? 1.5 : 1,
      orientation: 'upright',
      proportion: size ? { width: size.width, height: size.height, ratio: size.height ? size.width / size.height : 1 } : null,
      designType: kind,
    },
    generatedAt: input.generatedAt || Date.now(),
    region,
    hints,
    ambiguous,
    content,
    quality: { score: qualityScore, notes: qualityNotes },
    size: sizeAnalysis,
    risk,
    action,
  };
}

export function interpretOjoRequest(input: {
  fileId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  generatedAt?: number;
  region?: unknown;
  hints?: unknown;
  orderContext?: OjoOrderContext;
  originalFileId?: string;
}): OjoDiagnosis {
  return interpretIngestedDesign({
    ...input,
    region: parseOjoRegion(input.region),
    hints: parseOjoHints(input.hints),
  });
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
  const png = decodePng(bytes);
  if (png) return { width: png.width, height: png.height };
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

function regionPixelBox(
  size: { width: number; height: number },
  region: OjoRegion
): { x0: number; y0: number; width: number; height: number } {
  const x0 = Math.max(0, Math.floor(region.x * size.width));
  const y0 = Math.max(0, Math.floor(region.y * size.height));
  const x1 = Math.min(size.width, Math.ceil((region.x + region.w) * size.width));
  const y1 = Math.min(size.height, Math.ceil((region.y + region.h) * size.height));
  return { x0, y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

function mmToPx(mm?: number): number | undefined {
  if (mm == null || !Number.isFinite(mm) || mm <= 0) return undefined;
  return Math.max(1, Math.round((mm / 25.4) * PPI));
}

function analyzeScale(
  size: { width: number; height: number } | null,
  ctx?: OjoOrderContext,
  regionBox?: { width: number; height: number } | null
): OjoScaleAnalysis {
  const currentWidthPx = regionBox?.width || size?.width;
  const currentHeightPx = regionBox?.height || size?.height;
  const targetWidthMm = ctx?.tpuWidthMm;
  const targetHeightMm = ctx?.tpuHeightMm;
  let targetWidthPx = mmToPx(targetWidthMm);
  let targetHeightPx = mmToPx(targetHeightMm);
  if (!targetWidthPx || !targetHeightPx) {
    if (currentWidthPx && currentHeightPx) {
      const short = Math.min(currentWidthPx, currentHeightPx);
      if (short < MIN_SHORT_SIDE_PX) {
        const factor = MIN_SHORT_SIDE_PX / short;
        targetWidthPx = Math.round(currentWidthPx * factor);
        targetHeightPx = Math.round(currentHeightPx * factor);
      } else {
        targetWidthPx = currentWidthPx;
        targetHeightPx = currentHeightPx;
      }
    } else {
      targetWidthPx = MIN_SHORT_SIDE_PX;
      targetHeightPx = MIN_SHORT_SIDE_PX;
    }
  }
  const needsScale =
    !!currentWidthPx &&
    !!currentHeightPx &&
    !!targetWidthPx &&
    !!targetHeightPx &&
    (currentWidthPx + 1 < targetWidthPx || currentHeightPx + 1 < targetHeightPx);
  const scaleFactor =
    currentWidthPx && targetWidthPx ? Math.max(targetWidthPx / currentWidthPx, currentHeightPx && targetHeightPx ? targetHeightPx / currentHeightPx : 1) : undefined;
  return {
    currentWidthPx,
    currentHeightPx,
    targetWidthPx,
    targetHeightPx,
    targetWidthMm,
    targetHeightMm,
    needsScale,
    needsResample: needsScale,
    scaleFactor: scaleFactor && Number.isFinite(scaleFactor) ? Math.round(scaleFactor * 100) / 100 : undefined,
  };
}

function isAmbiguous(input: { kind: OjoMaterialKind; region?: OjoRegion; hints: OjoHint[] }): boolean {
  if (input.hints.length) return false;
  if (input.kind === 'unknown' || input.kind === 'document') return true;
  if (!input.region) return false;
  const area = input.region.w * input.region.h;
  return area > 0 && area < SMALL_REGION_AREA;
}

function describeContent(
  kind: OjoMaterialKind,
  hints: OjoHint[],
  region: OjoRegion | undefined,
  size: { width: number; height: number } | null
): { summary: string; elements: string[] } {
  const elements = hints.length ? [...hints] : region ? ['REGION'] : ['FULL_FILE'];
  const summary = [
    kind,
    region ? `${region.shape}:${region.x.toFixed(3)},${region.y.toFixed(3)},${region.w.toFixed(3)}x${region.h.toFixed(3)}` : 'no-region',
    size ? `${size.width}x${size.height}` : 'no-size',
    hints.length ? hints.join('+') : 'no-hint',
  ].join(' ');
  return { summary, elements };
}
