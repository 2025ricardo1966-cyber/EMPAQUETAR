import { inflateSync, deflateSync, constants as zlibConstants } from 'zlib';

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
  colorType: number;
  transparency: boolean;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(bytes: Buffer): DecodedPng | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  let i = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat: Buffer[] = [];
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  while (i + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(i);
    const type = bytes.toString('ascii', i + 4, i + 8);
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || data[10] !== 0) return undefined;
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!width || !height || !idat.length) return undefined;
  const packed = Buffer.concat(idat);
  let inflated: Buffer;
  try {
    inflated = inflateSync(packed);
  } catch {
    try {
      inflated = inflateSync(packed, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    } catch {
      return undefined;
    }
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    inflated.copy(row, 0, src, src + stride);
    src += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let recon = row[x];
      if (filter === 1) recon = (recon + left) & 255;
      else if (filter === 2) recon = (recon + up) & 255;
      else if (filter === 3) recon = (recon + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) recon = (recon + paeth(left, up, upLeft)) & 255;
      row[x] = recon;
    }
    row.copy(prev);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[o] = row[x * 4];
        rgba[o + 1] = row[x * 4 + 1];
        rgba[o + 2] = row[x * 4 + 2];
        rgba[o + 3] = row[x * 4 + 3];
      } else if (colorType === 2) {
        rgba[o] = row[x * 3];
        rgba[o + 1] = row[x * 3 + 1];
        rgba[o + 2] = row[x * 3 + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        const g = row[x];
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        const g = row[x * 2];
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = row[x * 2 + 1];
      } else if (colorType === 3 && palette) {
        const idx = row[x];
        rgba[o] = palette[idx * 3] || 0;
        rgba[o + 1] = palette[idx * 3 + 1] || 0;
        rgba[o + 2] = palette[idx * 3 + 2] || 0;
        rgba[o + 3] = trns && trns[idx] != null ? trns[idx] : 255;
      }
    }
  }
  let transparency = colorType === 4 || colorType === 6 || !!trns;
  if (transparency) {
    transparency = false;
    for (let p = 3; p < rgba.length; p += 4) {
      if (rgba[p] < 255) {
        transparency = true;
        break;
      }
    }
  }
  return { width, height, rgba, colorType, transparency };
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([head, data, tail]);
}

export function encodePngRgba(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function nearestNeighborScale(src: DecodedPng, width: number, height: number): DecodedPng {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      src.rgba.copy(rgba, (y * width + x) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4);
    }
  }
  return { width, height, rgba, colorType: 6, transparency: src.transparency };
}
