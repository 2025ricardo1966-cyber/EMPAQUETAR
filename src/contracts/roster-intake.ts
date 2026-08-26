import { inflateRawSync } from 'zlib';

export type RosterStatus = 'PENDING_REVIEW' | 'CORRECTED' | 'REJECTED' | 'APPROVED';

export interface RosterRecord {
  name: string;
  number: string;
  size: string;
  extras: Record<string, string>;
  raw: string[];
  sizeLabel?: string;
  sizeTableId?: string;
  garmentType?: string;
  quantity?: number;
}

export interface RosterIntake {
  fileId?: string;
  filename: string;
  original: { text?: string; rows: string[][] };
  interpretation: { columns: string[]; records: RosterRecord[]; unknownColumns?: string[] };
  humanEdits?: { records: RosterRecord[] };
  status: RosterStatus;
  approvedAt?: number;
  approvedBy?: string;
  humanApprovedAt?: number;
  rejectedAt?: number;
  rejectedBy?: string;
}

const NAME_KEYS = ['nombre', 'name', 'jugador', 'apellido'];
const NUMBER_KEYS = ['numero', 'número', 'number', 'nro', 'n°', '#', 'dorsal'];
const SIZE_KEYS = ['talle', 'talla', 'size', 'sz'];
const GARMENT_KEYS = ['prenda', 'garment', 'producto', 'product', 'familia'];
const QTY_KEYS = ['cantidad', 'quantity', 'qty', 'cant', 'unidades'];

export function isSpreadsheetUpload(filename: string, mimeType: string): boolean {
  const name = filename.toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    name.endsWith('.csv') ||
    name.endsWith('.tsv') ||
    name.endsWith('.txt') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    mime.includes('csv') ||
    mime.includes('tab-separated') ||
    mime.includes('spreadsheet') ||
    mime.includes('excel')
  );
}

export function parseSpreadsheetBytes(filename: string, bytes: Buffer): string[][] {
  const looksXlsx = filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls');
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return parseXlsxSheet(bytes);
    } catch (err) {
      if (looksXlsx) throw err;
    }
  } else if (looksXlsx) {
    throw new Error('ROSTER_CORRUPT');
  }
  const text = stripBom(bytes.toString('utf8'));
  return parseDelimited(text, filename.toLowerCase().endsWith('.tsv') ? '\t' : undefined);
}

export function interpretRosterRows(rows: string[][]): { columns: string[]; records: RosterRecord[]; unknownColumns: string[] } {
  const cleaned = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c));
  if (!cleaned.length) return { columns: [], records: [], unknownColumns: [] };
  const header = cleaned[0].map((h) => h.toLowerCase());
  const looksHeader = header.some(
    (h) => NAME_KEYS.includes(h) || NUMBER_KEYS.includes(h) || SIZE_KEYS.includes(h) || GARMENT_KEYS.includes(h)
  );
  const data = looksHeader ? cleaned.slice(1) : cleaned;
  const columns = looksHeader ? cleaned[0] : guessColumns(header.length || cleaned[0].length);
  const nameIdx = looksHeader ? findCol(header, NAME_KEYS) : 0;
  const numberIdx = looksHeader ? findCol(header, NUMBER_KEYS) : 1;
  const sizeIdx = looksHeader ? findCol(header, SIZE_KEYS) : 2;
  const garmentIdx = looksHeader ? findCol(header, GARMENT_KEYS) : -1;
  const qtyIdx = looksHeader ? findCol(header, QTY_KEYS) : -1;
  const records = data.map((raw) => {
    const extras: Record<string, string> = {};
    raw.forEach((value, i) => {
      if (i === nameIdx || i === numberIdx || i === sizeIdx || i === garmentIdx || i === qtyIdx) return;
      const key = columns[i] || `col${i + 1}`;
      if (value) extras[key] = value;
    });
    const qtyRaw = qtyIdx >= 0 ? raw[qtyIdx] : '';
    const qty = Number(qtyRaw);
    return {
      name: nameIdx >= 0 ? raw[nameIdx] || '' : '',
      number: numberIdx >= 0 ? raw[numberIdx] || '' : '',
      size: sizeIdx >= 0 ? raw[sizeIdx] || '' : '',
      extras,
      raw,
      garmentType: garmentIdx >= 0 ? raw[garmentIdx] || '' : undefined,
      quantity: qtyRaw !== '' && Number.isFinite(qty) ? Math.floor(qty) : undefined,
    };
  });
  const mapped = new Set([nameIdx, numberIdx, sizeIdx, garmentIdx, qtyIdx].filter((i) => i >= 0));
  const unknownColumns = looksHeader ? columns.filter((_, i) => !mapped.has(i) && String(columns[i] || '').trim()) : [];
  return { columns, records, unknownColumns };
}

export function approvedRosterRecords(intake: RosterIntake): RosterRecord[] {
  return intake.humanEdits?.records || intake.interpretation.records;
}

function guessColumns(count: number): string[] {
  const base = ['nombre', 'numero', 'talle'];
  while (base.length < count) base.push(`col${base.length + 1}`);
  return base.slice(0, count);
}

function findCol(header: string[], keys: string[]): number {
  return header.findIndex((h) => keys.includes(h.replace(/\s+/g, '')));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseDelimited(text: string, forced?: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = forced || (first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',');
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(splitDelimitedLine(line, delim));
  }
  return rows;
}

function splitDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseXlsxSheet(buf: Buffer): string[][] {
  const files = unzip(buf);
  const strings = parseSharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  const sheet =
    files.get('xl/worksheets/sheet1.xml')?.toString('utf8') ||
    [...files.entries()].find(([k]) => k.startsWith('xl/worksheets/sheet'))?.[1]?.toString('utf8') ||
    '';
  if (!sheet) throw new Error('NO_SHEET');
  return sheetXmlToRows(sheet, strings);
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const blocks = xml.split(/<si[\s>]/).slice(1);
  for (const block of blocks) {
    const texts = [...block.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1]));
    out.push(texts.join(''));
  }
  return out;
}

function sheetXmlToRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowBlocks = xml.split(/<row[\s>]/).slice(1);
  for (const block of rowBlocks) {
    const cells = [...block.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)];
    if (!cells.length) continue;
    const row: string[] = [];
    for (const cell of cells) {
      const attrs = cell[1];
      const inner = cell[2];
      const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
      const col = ref ? colIndex(ref[1]) : row.length;
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (t === 'inlineStr') {
        value = decodeXml((/<t[^>]*>([^<]*)<\/t>/.exec(inner) || [])[1] || '');
      } else {
        const v = (/<v>([^<]*)<\/v>/.exec(inner) || [])[1] || '';
        value = t === 's' ? strings[Number(v)] || '' : v;
      }
      while (row.length < col) row.push('');
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('NOT_ZIP');
  const cdOff = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const entries = new Map<string, Buffer>();
  let p = cdOff;
  const end = cdOff + cdSize;
  while (p + 46 <= end) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    const nameLenLocal = buf.readUInt16LE(localOff + 26);
    const extraLenLocal = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + nameLenLocal + extraLenLocal;
    const compressed = buf.slice(dataStart, dataStart + compSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : compressed;
    entries.set(name, Buffer.from(data));
  }
  return entries;
}
