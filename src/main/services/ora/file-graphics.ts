import { deflateSync } from 'zlib';
import { convertCdrToPdf, extractColorProfile, guessCdrPhysicalSize, isCorelDraw } from '../CdrConversion';
import { rasterSizeFromBytes } from './raster-size';
import { decodePng, encodePngRgba, nearestNeighborScale } from './png-codec';
import {
  compatibleOperations,
  detectGraphicFormat,
  type OraCompatibleOperation,
  type OraFileDiagnosis,
  type OraGraphicFormat,
  type OraVectorKind,
} from '../../../contracts/ora-file-conversion';
import { flagFitness } from '../../../contracts/ora-engines';
import { RequestInvalidError } from '../../../contracts/configuration-schema';

export interface GraphicConvertResult {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  vectorKind?: OraVectorKind;
  warnings: string[];
  propertiesLost: string[];
  executable: boolean;
}

function pngHasAlpha(bytes: Buffer): boolean | undefined {
  const decoded = decodePng(bytes);
  return decoded?.transparency;
}

function svgStats(text: string) {
  const images = (text.match(/<image\b/gi) || []).length;
  const paths = (text.match(/<path\b/gi) || []).length;
  const texts = (text.match(/<text\b/gi) || []).length;
  const shapes = (text.match(/<(rect|circle|ellipse|polygon|polyline)\b/gi) || []).length;
  return { images, paths, texts, shapes, elements: images + paths + texts + shapes };
}

export function analyzeGraphicFile(filename: string, mimeType: string, bytes: Buffer, physical?: { widthMm?: number; heightMm?: number }): {
  diagnosis: OraFileDiagnosis;
  operations: OraCompatibleOperation[];
} {
  const format = detectGraphicFormat(filename, mimeType, bytes);
  const warnings: string[] = [];
  const notes: string[] = [];
  const raster = rasterSizeFromBytes(filename, bytes);
  let nature: OraFileDiagnosis['nature'] = 'unknown';
  let colorSpace: string | undefined;
  let transparency: boolean | undefined;
  let hasText: boolean | undefined;
  let approxElements: number | undefined;
  let widthMm = physical?.widthMm;
  let heightMm = physical?.heightMm;
  const conversionPossible: OraGraphicFormat[] = [];

  if (format === 'png') {
    nature = 'raster';
    colorSpace = 'RGB';
    const decoded = decodePng(bytes);
    transparency = decoded?.transparency ?? pngHasAlpha(bytes);
    conversionPossible.push('png', 'pdf', 'svg');
    notes.push('PNG_PIXELS_AVAILABLE');
    if (decoded) notes.push(`DIMENSIONS ${decoded.width}×${decoded.height}`);
  } else if (format === 'jpg') {
    nature = 'raster';
    colorSpace = 'RGB';
    transparency = false;
    conversionPossible.push('jpg', 'pdf', 'svg');
    warnings.push('JPEG_PIXELS_NOT_DECODED');
    notes.push('JPG_CAN_WRAP_NOT_RECODE');
  } else if (format === 'svg') {
    const text = bytes.toString('utf8');
    const st = svgStats(text);
    approxElements = st.elements;
    hasText = st.texts > 0;
    transparency = true;
    colorSpace = text.includes('cmyk') ? 'CMYK' : 'RGB';
    nature = st.images && (st.paths || st.shapes) ? 'mixed' : st.images && !st.paths ? 'raster' : 'vector';
    conversionPossible.push('svg', 'pdf');
    if (nature !== 'vector') warnings.push('SVG_CONTAINS_RASTER');
    notes.push(`SVG elements≈${st.elements}`);
  } else if (format === 'pdf') {
    const text = bytes.toString('latin1');
    hasText = /\/Font\b/.test(text) || /BT\b/.test(text);
    colorSpace = /DeviceCMYK/.test(text) ? 'CMYK' : /DeviceRGB/.test(text) ? 'RGB' : undefined;
    nature = /\/Image\b/.test(text) && /\/Font\b/.test(text) ? 'mixed' : /\/Image\b/.test(text) ? 'raster' : 'vector';
    conversionPossible.push('pdf');
    warnings.push('PDF_RASTERIZE_NOT_AVAILABLE');
    notes.push('PDF_NO_PIXEL_RENDERER');
  } else if (format === 'cdr' || isCorelDraw(filename, mimeType)) {
    const profile = extractColorProfile(bytes);
    const physicalGuess = guessCdrPhysicalSize(bytes);
    colorSpace = profile.spaces.join('+');
    widthMm = widthMm || physicalGuess.widthMm;
    heightMm = heightMm || physicalGuess.heightMm;
    nature = 'vector';
    conversionPossible.push('pdf', 'svg', 'png');
    warnings.push('CONVERSION_NOT_EQUIVALENT');
    notes.push('CDR_ORIGINAL_MUST_BE_KEPT');
  } else if (format === 'webp' || format === 'avif' || format === 'tiff') {
    nature = 'raster';
    conversionPossible.push(format);
    warnings.push('ENCODER_NOT_AVAILABLE');
  } else {
    warnings.push('FORMAT_UNKNOWN');
  }

  let ppi: number | undefined;
  if (raster && widthMm && widthMm > 0) {
    ppi = Math.round((raster.widthPx / (widthMm / 25.4)) * 10) / 10;
    if (ppi < 72) warnings.push('RESOLUTION_INSUFFICIENT_LARGE_FORMAT');
    else if (ppi < 150) notes.push('VECTORIZE_RECOMMENDED');
  }

  if (raster) notes.unshift(`${format.toUpperCase()} ${raster.widthPx} × ${raster.heightPx}`);
  if (colorSpace) notes.push(colorSpace);
  if (ppi) notes.push(`${ppi} PPI estimados`);
  notes.push(`Transparencia: ${transparency === true ? 'sí' : transparency === false ? 'no' : 'indeterminada'}`);

  let fitness: OraFileDiagnosis['fitness'];
  if (widthMm && heightMm && widthMm > 0 && heightMm > 0) {
    const fit = flagFitness({
      raster,
      physical: { widthMm, heightMm, unit: 'mm' },
      sourceIsVector: format === 'svg' || format === 'cdr' || format === 'pdf',
    });
    fitness = fit.fitness;
    for (const w of fit.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
    notes.push(fitness);
  }

  const diagnosis: OraFileDiagnosis = {
    format: format === 'unknown' && isCorelDraw(filename, mimeType) ? 'cdr' : format,
    mimeType,
    nature,
    widthPx: raster?.widthPx,
    heightPx: raster?.heightPx,
    widthMm,
    heightMm,
    ppi,
    colorSpace,
    transparency,
    hasText,
    approxElements,
    conversionPossible,
    recommendedIntent: [],
    fitness,
    warnings,
    notes,
  };
  if (ppi != null && ppi < 150 && (format === 'jpg' || format === 'png')) {
    diagnosis.recommendedIntent.push('VECTORIZE');
  }
  if (ppi != null && ppi < 72) diagnosis.recommendedIntent.push('SCALE');
  diagnosis.recommendedIntent.push('CONVERT');
  const operations = compatibleOperations(diagnosis);
  return { diagnosis, operations };
}

function wrapRasterInSvg(filename: string, mime: string, bytes: Buffer, width: number, height: number): Buffer {
  const href = `data:${mime};base64,${bytes.toString('base64')}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <!-- RASTER_EMBEDDED: not a real vectorization -->\n  <image width="${width}" height="${height}" href="${href}"/>\n</svg>\n`;
  return Buffer.from(svg, 'utf8');
}

function pdfFromObjects(objects: Buffer[]): Buffer {
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const parts: Buffer[] = [header];
  const offsets = [0];
  let offset = header.length;
  for (const obj of objects) {
    offsets.push(offset);
    parts.push(obj);
    offset += obj.length;
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(
    Buffer.from(xref, 'ascii'),
    Buffer.from(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'ascii')
  );
  return Buffer.concat(parts);
}

function pdfObj(n: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${n} 0 obj\n`, 'ascii'), body, Buffer.from('\nendobj\n', 'ascii')]);
}

function wrapAsPdf(title: string, warnings: string[], widthPt = 612, heightPt = 792): Buffer {
  const body = [`Derived: ${title}`, `Warnings: ${warnings.join(', ')}`, 'Original preserved. Not an identical conversion.'].join(' | ');
  const escaped = body.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 10 Tf 36 ${Math.max(48, heightPt - 72).toFixed(1)} Td (${escaped}) Tj ET`;
  return pdfFromObjects([
    pdfObj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')),
    pdfObj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii')),
    pdfObj(
      3,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
        'ascii'
      )
    ),
    pdfObj(4, Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, 'ascii')),
    pdfObj(5, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii')),
  ]);
}

function embedRasterPdf(opts: {
  widthPx: number;
  heightPx: number;
  image: Buffer;
  filter: 'DCTDecode' | 'FlateDecode';
}): Buffer {
  const { widthPx: w, heightPx: h, image, filter } = opts;
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const dict =
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${image.length} >>\nstream\n`;
  return pdfFromObjects([
    pdfObj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')),
    pdfObj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii')),
    pdfObj(
      3,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
        'ascii'
      )
    ),
    pdfObj(4, Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, 'ascii')),
    pdfObj(5, Buffer.concat([Buffer.from(dict, 'ascii'), image, Buffer.from('\nendstream', 'ascii')])),
  ]);
}

function pngToPdfRgb(bytes: Buffer): { pdf: Buffer; warnings: string[]; propertiesLost: string[] } | undefined {
  const decoded = decodePng(bytes);
  if (!decoded) return undefined;
  const warnings: string[] = ['PHYSICAL_SIZE_ASSUMED_72PPI'];
  const propertiesLost: string[] = ['layers'];
  const rgb = Buffer.alloc(decoded.width * decoded.height * 3);
  for (let i = 0, j = 0; i < decoded.rgba.length; i += 4, j += 3) {
    const a = decoded.rgba[i + 3] / 255;
    rgb[j] = Math.round(decoded.rgba[i] * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(decoded.rgba[i + 1] * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(decoded.rgba[i + 2] * a + 255 * (1 - a));
  }
  if (decoded.transparency) {
    warnings.push('TRANSPARENCY_FLATTENED');
    propertiesLost.push('transparency');
  }
  return {
    pdf: embedRasterPdf({
      widthPx: decoded.width,
      heightPx: decoded.height,
      image: deflateSync(rgb),
      filter: 'FlateDecode',
    }),
    warnings,
    propertiesLost,
  };
}

function svgPathToPdf(d: string, pageH: number): { ops: string; skipped: boolean } {
  const tokens = d.match(/[MmLlHhVvCcZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let skipped = false;
  const ops: string[] = [];
  const num = () => Number(tokens[i++] || 0);
  const fy = (y: number) => pageH - y;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MmLlHhVvCcZz]$/.test(t)) {
      cmd = t;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        ops.push('h');
        continue;
      }
    } else if (!cmd) {
      skipped = true;
      i += 1;
      continue;
    }
    if (cmd === 'M' || cmd === 'L') {
      cx = num();
      cy = num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} ${cmd === 'M' ? 'm' : 'l'}`);
      cmd = cmd === 'M' ? 'L' : cmd;
    } else if (cmd === 'm' || cmd === 'l') {
      cx += num();
      cy += num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} ${cmd === 'm' ? 'm' : 'l'}`);
      cmd = cmd === 'm' ? 'l' : cmd;
    } else if (cmd === 'H') {
      cx = num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} l`);
    } else if (cmd === 'h') {
      cx += num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} l`);
    } else if (cmd === 'V') {
      cy = num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} l`);
    } else if (cmd === 'v') {
      cy += num();
      ops.push(`${cx.toFixed(2)} ${fy(cy).toFixed(2)} l`);
    } else if (cmd === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      cx = num();
      cy = num();
      ops.push(
        `${x1.toFixed(2)} ${fy(y1).toFixed(2)} ${x2.toFixed(2)} ${fy(y2).toFixed(2)} ${cx.toFixed(2)} ${fy(cy).toFixed(2)} c`
      );
    } else {
      skipped = true;
      i += 1;
    }
  }
  return { ops: ops.join(' '), skipped };
}

function svgToPdfIfPaths(svg: string, filename: string): { bytes: Buffer; kind: OraVectorKind; warnings: string[] } {
  const st = svgStats(svg);
  const warnings: string[] = ['PHYSICAL_SIZE_ASSUMED_72PPI'];
  if (st.images) warnings.push('RASTER_OBJECTS_IN_SVG');
  const size = rasterSizeFromBytes(filename, Buffer.from(svg, 'utf8')) || { widthPx: 612, heightPx: 792 };
  const pathDs = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/gi)].map((m) => m[1]);
  const ops: string[] = [];
  let skipped = false;
  for (const d of pathDs) {
    const converted = svgPathToPdf(d, size.heightPx);
    if (converted.ops) ops.push(converted.ops);
    if (converted.skipped) skipped = true;
  }
  if (!ops.length) {
    warnings.push('NOT_VECTOR_REAL', 'SVG_PATHS_NOT_TRANSCRIBED_TO_PDF');
    return { bytes: wrapAsPdf(filename, warnings, size.widthPx, size.heightPx), kind: 'RASTER_EMBEDDED', warnings };
  }
  if (skipped) warnings.push('PATH_COMMANDS_SKIPPED', 'REVIEW_REQUIRED');
  const content = `${ops.join(' ')} S`;
  const bytes = pdfFromObjects([
    pdfObj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')),
    pdfObj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii')),
    pdfObj(
      3,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.widthPx} ${size.heightPx}] /Contents 4 0 R >>`,
        'ascii'
      )
    ),
    pdfObj(4, Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, 'ascii')),
  ]);
  const kind: OraVectorKind = st.images ? 'RASTER_EMBEDDED' : skipped ? 'VECTOR_ASSISTED' : 'VECTOR_REAL';
  if (kind !== 'VECTOR_REAL') warnings.push('NOT_VECTOR_REAL');
  return { bytes, kind, warnings };
}

export function tracePngToSvg(decoded: { width: number; height: number; rgba: Buffer }): { svg: string; kind: OraVectorKind; warnings: string[] } {
  const { width, height, rgba } = decoded;
  const paths: string[] = [];
  const visited = new Uint8Array(width * height);
  const lum = (i: number) => (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  const ink = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgba[i + 3] > 32 && lum(i) < 200;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (visited[idx] || !ink(x, y)) continue;
      let minX = x;
      let maxX = x;
      let yy = y;
      while (maxX + 1 < width && ink(maxX + 1, y) && !visited[y * width + maxX + 1]) maxX += 1;
      while (yy + 1 < height) {
        let ok = true;
        for (let xx = minX; xx <= maxX; xx += 1) {
          if (!ink(xx, yy + 1)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
        yy += 1;
      }
      for (let row = y; row <= yy; row += 1) {
        for (let col = minX; col <= maxX; col += 1) visited[row * width + col] = 1;
      }
      const w = maxX - minX + 1;
      const h = yy - y + 1;
      paths.push(`M${minX} ${y}h${w}v${h}h${-w}z`);
    }
  }
  const warnings = ['TRACE_RECT_APPROXIMATION', 'REVIEW_REQUIRED'];
  const kind: OraVectorKind = paths.length ? 'VECTOR_ASSISTED' : 'RASTER_EMBEDDED';
  if (!paths.length) warnings.push('NO_INK_CONTOUR');
  const d = paths.slice(0, 4000).join(' ');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <!-- VECTOR_ASSISTED: not an industrial validated tracing -->\n  <path fill="#111" d="${d}"/>\n</svg>\n`;
  return { svg, kind, warnings };
}

export function convertGraphic(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  target: OraGraphicFormat;
}): GraphicConvertResult {
  const origin = detectGraphicFormat(input.filename, input.mimeType, input.bytes);
  const target = input.target;
  const base = input.filename.replace(/\.[^.]+$/, '') || 'archivo';
  const warnings: string[] = [];
  const propertiesLost: string[] = [];
  if (origin === target) throw new RequestInvalidError('ORA_FILE_SAME_FORMAT');

  if (origin === 'cdr') {
    if (target === 'pdf') {
      const conv = convertCdrToPdf(input.filename, input.bytes);
      return {
        bytes: conv.pdf,
        mimeType: 'application/pdf',
        filename: `${base}.pdf`,
        vectorKind: 'RASTER_EMBEDDED',
        warnings: [...conv.warnings, ...extraCdrWarnings(input.bytes)],
        propertiesLost: ['fonts', 'effects', 'layers'],
        executable: true,
      };
    }
    if (target === 'svg' || target === 'png') {
      const conv = convertCdrToPdf(input.filename, input.bytes);
      warnings.push(...conv.warnings, 'CDR_PREVIEW_NOT_PIXEL_PERFECT');
      if (target === 'svg') {
        return {
          bytes: wrapRasterInSvg(`${base}.pdf`, 'application/pdf', conv.pdf, 612, 792),
          mimeType: 'image/svg+xml',
          filename: `${base}.svg`,
          vectorKind: 'RASTER_EMBEDDED',
          warnings: [...warnings, 'NOT_VECTOR_REAL', ...extraCdrWarnings(input.bytes)],
          propertiesLost: ['vectors', 'fonts', 'color-profile'],
          executable: true,
        };
      }
      throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
    }
  }

  if ((origin === 'png' || origin === 'jpg') && (target === 'pdf' || target === 'svg')) {
    const size = rasterSizeFromBytes(input.filename, input.bytes) || { widthPx: 100, heightPx: 100 };
    if (target === 'svg') {
      return {
        bytes: wrapRasterInSvg(input.filename, origin === 'png' ? 'image/png' : 'image/jpeg', input.bytes, size.widthPx, size.heightPx),
        mimeType: 'image/svg+xml',
        filename: `${base}.svg`,
        vectorKind: 'RASTER_EMBEDDED',
        warnings: ['NOT_VECTOR_REAL', 'RASTER_IN_VECTOR_CONTAINER'],
        propertiesLost: [],
        executable: true,
      };
    }
    if (origin === 'png') {
      const embedded = pngToPdfRgb(input.bytes);
      if (!embedded) throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
      return {
        bytes: embedded.pdf,
        mimeType: 'application/pdf',
        filename: `${base}.pdf`,
        vectorKind: 'RASTER_EMBEDDED',
        warnings: [...embedded.warnings, 'NOT_VECTOR_REAL', 'RASTER_IN_VECTOR_CONTAINER'],
        propertiesLost: embedded.propertiesLost,
        executable: true,
      };
    }
    const jpegSize = rasterSizeFromBytes(input.filename, input.bytes);
    if (!jpegSize) throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
    return {
      bytes: embedRasterPdf({
        widthPx: jpegSize.widthPx,
        heightPx: jpegSize.heightPx,
        image: input.bytes,
        filter: 'DCTDecode',
      }),
      mimeType: 'application/pdf',
      filename: `${base}.pdf`,
      vectorKind: 'RASTER_EMBEDDED',
      warnings: ['NOT_VECTOR_REAL', 'RASTER_IN_VECTOR_CONTAINER', 'PHYSICAL_SIZE_ASSUMED_72PPI'],
      propertiesLost: ['layers'],
      executable: true,
    };
  }

  if (origin === 'png' && target === 'jpg') {
    propertiesLost.push('transparency', 'lossless');
    warnings.push('JPEG_ENCODER_NOT_AVAILABLE');
    throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
  }
  if (origin === 'jpg' && target === 'png') {
    warnings.push('JPEG_DECODER_NOT_AVAILABLE');
    throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
  }
  if (origin === 'svg' && (target === 'png' || target === 'jpg')) {
    warnings.push('SVG_RASTERIZER_NOT_AVAILABLE');
    throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
  }
  if (origin === 'pdf' && (target === 'png' || target === 'jpg' || target === 'svg')) {
    warnings.push('PDF_RASTERIZE_NOT_AVAILABLE');
    throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
  }
  if (origin === 'svg' && target === 'pdf') {
    const text = input.bytes.toString('utf8');
    const conv = svgToPdfIfPaths(text, input.filename);
    return {
      bytes: conv.bytes,
      mimeType: 'application/pdf',
      filename: `${base}.pdf`,
      vectorKind: conv.kind,
      warnings: conv.warnings,
      propertiesLost: conv.kind === 'VECTOR_REAL' ? [] : ['true-vectors'],
      executable: true,
    };
  }
  if (target === 'webp' || target === 'avif') throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
  throw new RequestInvalidError('ORA_CONVERT_NOT_POSSIBLE');
}

export function vectorizeGraphic(filename: string, mimeType: string, bytes: Buffer): GraphicConvertResult {
  const origin = detectGraphicFormat(filename, mimeType, bytes);
  const base = filename.replace(/\.[^.]+$/, '') || 'archivo';
  if (origin === 'png') {
    const decoded = decodePng(bytes);
    if (decoded) {
      const traced = tracePngToSvg(decoded);
      return {
        bytes: Buffer.from(traced.svg, 'utf8'),
        mimeType: 'image/svg+xml',
        filename: `${base}.svg`,
        vectorKind: traced.kind,
        warnings: traced.warnings,
        propertiesLost: traced.kind === 'VECTOR_ASSISTED' ? ['photographic-detail'] : ['vectors'],
        executable: true,
      };
    }
  }
  const size = rasterSizeFromBytes(filename, bytes) || { widthPx: 100, heightPx: 100 };
  const mime = origin === 'jpg' ? 'image/jpeg' : origin === 'png' ? 'image/png' : 'application/octet-stream';
  return {
    bytes: wrapRasterInSvg(filename, mime, bytes, size.widthPx, size.heightPx),
    mimeType: 'image/svg+xml',
    filename: `${base}.svg`,
    vectorKind: 'RASTER_EMBEDDED',
    warnings: ['NOT_VECTOR_REAL', 'RASTER_IN_VECTOR_CONTAINER'],
    propertiesLost: ['vectors'],
    executable: true,
  };
}

export function scaleGraphic(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  target: '8K' | '16K' | { widthPx: number; heightPx: number };
}): GraphicConvertResult {
  if (input.target === '8K' || input.target === '16K') {
    return {
      bytes: Buffer.alloc(0),
      mimeType: 'application/json',
      filename: `${input.filename}.${input.target}.scale-plan.json`,
      warnings: ['PROCESS_16K_NOT_EXECUTED', 'NO_FAKE_CLOUD_SCALE'],
      propertiesLost: [],
      executable: false,
    };
  }
  const label = `${input.target.widthPx}x${input.target.heightPx}`;
  const decoded = decodePng(input.bytes);
  if (!decoded) throw new RequestInvalidError('ORA_SCALE_REQUIRES_PNG');
  const scaled = nearestNeighborScale(decoded, input.target.widthPx, input.target.heightPx);
  return {
    bytes: encodePngRgba(scaled.width, scaled.height, scaled.rgba),
    mimeType: 'image/png',
    filename: input.filename.replace(/\.png$/i, '') + `-${label}.png`,
    warnings: ['NEAREST_NEIGHBOR_NOT_AI', 'NOT_8K_16K_ENGINE'],
    propertiesLost: ['photographic-ai-detail'],
    executable: true,
  };
}

export function extraCdrWarnings(bytes: Buffer): string[] {
  const text = bytes.toString('latin1');
  const out: string[] = [];
  if (/font/i.test(text)) out.push('FONTS_MAY_BE_SUBSTITUTED');
  if (/gradient|degrad/i.test(text)) out.push('GRADIENTS_MAY_FLATTEN');
  if (/transpar|opacity/i.test(text)) out.push('TRANSPARENCY_MAY_FLATTEN');
  if (/effect|shadow|glow|lens|mesh/i.test(text)) out.push('EFFECTS_UNSUPPORTED');
  if (/icc|color.?profile/i.test(text)) out.push('COLOR_PROFILE_NOT_GUARANTEED');
  if (/ole|embed|bitmap|incompat/i.test(text)) out.push('INCOMPATIBLE_OBJECTS');
  if (guessCdrPhysicalSize(bytes).source === 'unverified') out.push('PHYSICAL_SIZE_UNVERIFIED');
  return out;
}
