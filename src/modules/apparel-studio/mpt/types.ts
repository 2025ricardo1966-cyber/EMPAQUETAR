/**
 * Motor de Producción Textil (MPT) — tipos independientes del Motor de Moldes.
 * Metadatos de fabricación industrial asociados por pieza (sin alterar MedidasPiezaResueltas).
 */
import type {
  CategoriaTalle,
  MedidasPiezaResueltas,
  MoldeId,
  PieceSlotId,
  PieceTemplateKind,
  PiezaId,
  Talle,
} from '../moldes/types';

export type GrainDirection =
  | 'vertical'
  | 'horizontal'
  | 'bias-45'
  | 'bias-135'
  | 'custom';

export type NotchType =
  | 'single'
  | 'double'
  | 'triple'
  | 'central'
  | 'lateral'
  | 'union-ref'
  | 'assembly-ref';

/**
 * Definición paramétrica de piquete — anclada al contorno del molde.
 * Persistida en overrides; se re-resuelve cuando cambia outlinePath.
 */
export interface NotchAnchorSpec {
  id: string;
  /** Índice de vértice sobre el contorno muestreado */
  vertexIndex: number;
  /** Posición 0–1 a lo largo del segmento desde el vértice */
  tAlongSegment?: number;
  type: NotchType;
  visible: boolean;
  label?: string;
  /** Escala de longitud respecto al tamaño por defecto */
  lengthScale?: number;
  /** Pieza emparejada (referencias de unión / montaje) */
  pairedPiezaId?: PiezaId;
  pairedSlotId?: PieceSlotId;
}

/** Piquete resuelto contra la geometría actual del molde */
export interface ProductionNotch {
  id: string;
  type: NotchType;
  visible: boolean;
  label?: string;
  x: number;
  y: number;
  /** Normal hacia afuera del contorno (grados) */
  angleDeg: number;
  /** Tangente a lo largo del contorno (grados) */
  tangentDeg: number;
  lengthScale?: number;
  pairedPiezaId?: PiezaId;
  pairedSlotId?: PieceSlotId;
  anchor: NotchAnchorSpec;
}

export interface SeamAllowanceSpec {
  /** Margen de costura / línea de corte externa (cm) — legacy uniforme */
  defaultCm: number;
  stitchLineCm?: number;
  segmentOverrides?: Record<number, number>;
}

export type MarginKind =
  | 'costura'
  | 'dobladillo'
  | 'vista'
  | 'cuello'
  | 'puno'
  | 'cierre';

/**
 * Definición paramétrica de margen por borde — anclada al contorno del molde.
 */
export interface EdgeMarginDefinition {
  id: string;
  segmentIndex: number;
  kind: MarginKind;
  valueCm: number;
  visible: boolean;
  label?: string;
}

/** Spec persistida de márgenes industriales por pieza */
export interface PieceMarginSpec {
  defaultsByKind: Record<MarginKind, number>;
  edges: EdgeMarginDefinition[];
  showCutOutline: boolean;
  showEdgeMargins: boolean;
  /** Ratio pespunte interior respecto al margen de costura */
  stitchRatio?: number;
}

/** Margen resuelto contra geometría actual */
export interface ResolvedEdgeMargin {
  id: string;
  segmentIndex: number;
  kind: MarginKind;
  valueCm: number;
  visible: boolean;
  label?: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  cutFrom: { x: number; y: number };
  cutTo: { x: number; y: number };
}

export interface MarginEdgePath {
  kind: MarginKind;
  visible: boolean;
  path: string;
}

export interface ResolvedPieceMargins {
  edges: ResolvedEdgeMargin[];
  segmentOffsets: number[];
  cutOutlinePath?: string;
  stitchOutlinePath?: string;
  edgePaths: MarginEdgePath[];
}

export type GrainAxisKind = 'thread' | 'fabric' | 'stretch' | 'cut';

/** Configuración editable de un eje de orientación (espacio local de la pieza) */
export interface GrainAxisConfig {
  direction: GrainDirection;
  customAngleDeg?: number;
  inverted?: boolean;
}

/**
 * Definición persistida del sentido del hilo — relativa al marco local de la pieza.
 * Se re-resuelve cuando cambia outlinePath u orientación geométrica.
 */
export interface PieceGrainSpec {
  thread: GrainAxisConfig;
  fabric: GrainAxisConfig;
  stretch: GrainAxisConfig;
  cut: GrainAxisConfig;
  arrowVisible: boolean;
  showSecondaryAxes?: boolean;
  centerNorm?: { x: number; y: number };
  lengthRatio?: number;
}

export interface ResolvedGrainAxis {
  kind: GrainAxisKind;
  direction: GrainDirection;
  localAngleDeg: number;
  worldAngleDeg: number;
  inverted: boolean;
  label: string;
}

export interface GrainArrowGeometry {
  start: { x: number; y: number };
  end: { x: number; y: number };
  visible: boolean;
  inverted: boolean;
  label: string;
  worldAngleDeg: number;
}

export interface GrainLineSpec {
  pieceRotationDeg: number;
  thread: ResolvedGrainAxis;
  fabric: ResolvedGrainAxis;
  stretch: ResolvedGrainAxis;
  cut: ResolvedGrainAxis;
  arrow: GrainArrowGeometry;
  direction: GrainDirection;
  angleDeg: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  label: string;
}

export type PieceCutMode = 'normal' | 'mirror' | 'double-cut' | 'single-cut';

export interface CutInstructionSpec {
  mode: PieceCutMode;
  quantity: number;
  foldCut: boolean;
  isMirrorInstance: boolean;
  mirrorMasterId?: PiezaId;
  cutLabel: string;
  /** Incluir en exportación plotter/PDF de corte */
  exportToPlotter: boolean;
  /** Mostrar anotación en overlay MPT */
  visible: boolean;
}

export interface PrintableZoneSpec {
  enabled: boolean;
  /** Margen de seguridad sublimación / estampa (cm) */
  safeMarginCm: number;
  /** Rectángulo de zona imprimible dentro del viewBox (cm) */
  bounds?: { x: number; y: number; width: number; height: number };
  sublimationSafe: boolean;
  notes?: string;
}

export type IdentificationFieldKey =
  | 'name'
  | 'number'
  | 'talle'
  | 'quantity'
  | 'uniqueId'
  | 'grainLabel';

/** Posición editable del bloque de identificación — normalizada al viewBox */
export interface PieceIdentificationSpec {
  anchorNorm: { x: number; y: number };
  visible: boolean;
  fields: Record<IdentificationFieldKey, boolean>;
  /** Mostrar flecha de hilo (capa MPT separada) */
  showGrainArrow: boolean;
  fontScale?: number;
  align?: 'start' | 'middle' | 'end';
}

/** Identificación resuelta en coordenadas del viewBox (cm) */
export interface ResolvedPieceIdentification {
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  align: 'start' | 'middle' | 'end';
  lines: Array<{ key: IdentificationFieldKey; text: string }>;
  visible: boolean;
  pieceNumber: number;
  uniqueId: string;
  anchorNorm: { x: number; y: number };
}

/** Metadatos industriales completos por pieza */
export interface PieceProductionMetadata {
  piezaId: PiezaId;
  piezaNombre: string;
  slotId?: PieceSlotId;
  templateKind?: PieceTemplateKind;
  /** Código único de identificación en taller */
  identificationCode: string;
  /** Nombre corto para etiqueta de corte */
  shortLabel: string;
  seamAllowance: SeamAllowanceSpec;
  /** Definiciones paramétricas de márgenes por borde */
  marginSpec: PieceMarginSpec;
  /** Márgenes resueltos — derivados; no alteran outlinePath del molde */
  margins: ResolvedPieceMargins;
  /** Definición paramétrica del hilo — fuente de verdad persistida */
  grainSpec: PieceGrainSpec;
  /** Hilo resuelto contra geometría actual (incluye flecha) */
  grain: GrainLineSpec;
  /** Definiciones paramétricas — fuente de verdad para piquetes */
  notchDefinitions: NotchAnchorSpec[];
  /** Piquetes resueltos contra la geometría actual */
  notches: ProductionNotch[];
  cutInstruction: CutInstructionSpec;
  identificationSpec: PieceIdentificationSpec;
  identification: ResolvedPieceIdentification;
  printableZone: PrintableZoneSpec;
  /** Contorno de CORTE con margen — derivado; no reemplaza outlinePath del molde */
  cutOutlinePath?: string;
  /** Contorno de pespunte interior — derivado */
  stitchOutlinePath?: string;
  tags: string[];
  notes?: string;
  schemaVersion: 1;
  updatedAt: string;
}

/** Pieza enriquecida: molde (referencia) + metadatos MPT */
export interface EnrichedProductionPiece {
  moldPiece: MedidasPiezaResueltas;
  production: PieceProductionMetadata;
}

export interface MptEnrichmentContext {
  moldId: MoldeId;
  moldName?: string;
  categoria: CategoriaTalle;
  talle: Talle;
}

export interface MptEnrichmentResult {
  context: MptEnrichmentContext;
  pieces: EnrichedProductionPiece[];
  enrichedAt: string;
}

/** Override editable persistido — clave compuesta moldId + piezaId + talle */
export interface MptPieceOverrideEntry {
  moldId: MoldeId;
  piezaId: PiezaId;
  categoria: CategoriaTalle;
  talle: Talle;
  overrides: MptPieceOverridePatch;
  updatedAt: string;
}

/** Campos parcialmente editables sobre metadatos generados */
export type MptPieceOverridePatch = Partial<
  Pick<
    PieceProductionMetadata,
    | 'identificationCode'
    | 'shortLabel'
    | 'seamAllowance'
    | 'marginSpec'
    | 'margins'
    | 'grainSpec'
    | 'grain'
    | 'notchDefinitions'
    | 'notches'
    | 'cutInstruction'
    | 'identificationSpec'
    | 'identification'
    | 'printableZone'
    | 'tags'
    | 'notes'
  >
>;

export interface ApparelMptOverridesStore {
  version: 1;
  overrides: MptPieceOverrideEntry[];
}

export interface MptEnrichRequest {
  context: MptEnrichmentContext;
  piezas: MedidasPiezaResueltas[];
  overrideEntries?: MptPieceOverrideEntry[];
}
