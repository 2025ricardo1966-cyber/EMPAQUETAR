import type {
  CategoriaTalle,
  FabricId,
  MedidasPiezaResueltas,
  MoldeId,
  PieceSlotId,
  Talle,
} from '../moldes/types';
import type { PieceProductionMetadata } from '../mpt/types';

/** Formato de archivo de salida */
export type ApparelExportFormat = 'pdf' | 'svg' | 'dxf' | 'ai' | 'eps' | 'png' | 'jpg';

/** Propósito del archivo exportado */
export type ApparelExportPurpose = 'cutting' | 'print' | 'sublimation';

export interface ApparelExportLayoutOptions {
  marginCm: number;
  gapCm: number;
  /** Ancho máximo de hoja en cm (A3 landscape ≈ 42) */
  sheetWidthCm: number;
}

export interface ApparelExportRequest {
  purpose: ApparelExportPurpose;
  format: ApparelExportFormat;
  moldId: MoldeId;
  moldName: string;
  categoria: CategoriaTalle;
  talle: Talle;
  piezas: MedidasPiezaResueltas[];
  fabricId?: FabricId;
  /** Markup SVG de sublimación por slot (vectorial) */
  sublimationBySlot?: Partial<Record<PieceSlotId, string>>;
  /** Overlay egresados frente/espalda */
  egresadosOverlay?: Partial<Record<'frente' | 'espalda', string>>;
  layout?: ApparelExportLayoutOptions;
  /** Solo propósito corte — anotación de piezas espejo */
  mirrorNotes?: boolean;
  /** Metadatos MPT por pieza — márgenes de corte derivados */
  mptByPiezaId?: Record<string, PieceProductionMetadata>;
  /** Incluir contornos de corte MPT en exportación (no modifica geometría del molde) */
  includeMptMargins?: boolean;
  dpi?: number;
  jpegQuality?: number;
}

export interface PlacedExportPiece {
  pieza: MedidasPiezaResueltas;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportLayoutResult {
  placements: PlacedExportPiece[];
  widthCm: number;
  heightCm: number;
}

export interface ApparelExportResult {
  format: ApparelExportFormat;
  purpose: ApparelExportPurpose;
  extension: string;
  mimeType: string;
  /** Contenido UTF-8 (svg, dxf, eps, ai, pdf como texto) */
  contentUtf8?: string;
  /** true si el contenido es binario codificado en base64 (pdf binario, png, jpg) */
  contentBase64?: string;
  /** SVG intermedio — útil para rasterizar en renderer */
  svgIntermediate?: string;
  suggestedFileName: string;
}

export const EXPORT_FORMAT_META: Record<
  ApparelExportFormat,
  { label: string; extension: string; mimeType: string }
> = {
  pdf: { label: 'PDF', extension: 'pdf', mimeType: 'application/pdf' },
  svg: { label: 'SVG', extension: 'svg', mimeType: 'image/svg+xml' },
  dxf: { label: 'DXF', extension: 'dxf', mimeType: 'application/dxf' },
  ai: { label: 'Adobe Illustrator', extension: 'ai', mimeType: 'application/postscript' },
  eps: { label: 'EPS', extension: 'eps', mimeType: 'application/postscript' },
  png: { label: 'PNG', extension: 'png', mimeType: 'image/png' },
  jpg: { label: 'JPG', extension: 'jpg', mimeType: 'image/jpeg' },
};

export const EXPORT_PURPOSE_META: Record<
  ApparelExportPurpose,
  { label: string; description: string; formats: ApparelExportFormat[] }
> = {
  cutting: {
    label: 'Moldes para corte',
    description: 'Contornos de corte para plotter o CNC. Líneas de corte y etiquetas de pieza.',
    formats: ['dxf', 'pdf', 'svg', 'eps', 'ai'],
  },
  print: {
    label: 'Archivos para impresión',
    description: 'Hoja con piezas posicionadas, medidas y referencias de talle.',
    formats: ['pdf', 'svg', 'png', 'jpg', 'eps'],
  },
  sublimation: {
    label: 'Archivos para sublimación',
    description: 'Paneles con color de tela y gráfica vectorial por pieza.',
    formats: ['pdf', 'svg', 'png', 'jpg', 'eps', 'ai'],
  },
};

export const DEFAULT_LAYOUT: ApparelExportLayoutOptions = {
  marginCm: 2,
  gapCm: 3,
  sheetWidthCm: 90,
};
