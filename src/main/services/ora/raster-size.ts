import type { RasterSize } from '../../../contracts/ora-engines';

export function rasterSizeFromBytes(filename: string, bytes: Buffer): RasterSize | undefined {
  const name = filename.toLowerCase();
  if (name.endsWith('.png') || (bytes[0] === 0x89 && bytes[1] === 0x50)) return pngSize(bytes);
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || bytes[0] === 0xff) return jpegSize(bytes);
  if (name.endsWith('.svg') || bytes.toString('utf8', 0, 64).includes('<svg')) return svgSize(bytes);
  return undefined;
}

function pngSize(bytes: Buffer): RasterSize | undefined {
  if (bytes.length < 24) return undefined;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): RasterSize | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = bytes.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return { heightPx: bytes.readUInt16BE(i + 5), widthPx: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

function svgSize(bytes: Buffer): RasterSize | undefined {
  const text = bytes.toString('utf8', 0, Math.min(bytes.length, 4000));
  const w = text.match(/\bwidth="([\d.]+)"/);
  const h = text.match(/\bheight="([\d.]+)"/);
  if (w && h) return { widthPx: Number(w[1]), heightPx: Number(h[1]) };
  const vb = text.match(/viewBox="([\d.\s-]+)"/);
  if (vb) {
    const p = vb[1].trim().split(/\s+/).map(Number);
    if (p.length === 4) return { widthPx: p[2], heightPx: p[3] };
  }
  return undefined;
}
