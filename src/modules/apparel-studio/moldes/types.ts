// =============================================================================
// Bloque 1 — Legacy M1 (aliases de compatibilidad)
// =============================================================================

export type TipoTalle = 'adulto' | 'infantil';
export type NombreTalleAdulto = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type NombreTalleInfantil = 'T4' | 'T6' | 'T8' | 'T10' | 'T12' | 'T14';
export type NombreTalle = NombreTalleAdulto | NombreTalleInfantil;
export type NombrePrenda = 'camiseta' | 'short';
export type NombrePieza =
  | 'frente'
  | 'espalda'
  | 'manga-izq'
  | 'manga-der'
  | 'cuello'
  | 'delantero-izq'
  | 'delantero-der'
  | 'trasero-izq'
  | 'trasero-der'
  | 'cintura';

export interface MedidaPieza {
  anchoAxila?: number;
  altoTotal?: number;
  sisa?: number;
  largo?: number;
  anchoCabeza?: number;
  anchoPuno?: number;
  perimetro?: number;
  alto?: number;
  tiroDelantero?: number;
  tiroTrasero?: number;
  ancho?: number;
  largoTotal?: number;
}

export interface Pieza {
  nombre: NombrePieza;
  label: string;
  esEspejo: boolean;
  piezaEspejoRef?: NombrePieza;
  medidas: Record<NombreTalle, MedidaPieza>;
}

export interface Molde {
  prenda: NombrePrenda;
  label: string;
  piezas: Pieza[];
}

export interface TalleActivo {
  categoria: TipoTalle;
  talle: NombreTalle;
}

export interface PrendasActivas {
  camiseta: boolean;
  short: boolean;
}

// =============================================================================
// Bloque 2 — Identidad universal
// Evidencia: mold-definitions.ts, piece-library.ts, piece-decomposer.ts
// MoldeId/PiezaId son string (literales de catálogo y pieza.id se asignan sin cast).
// =============================================================================

export type CategoriaTalle = TipoTalle;
export type Talle = NombreTalle;

export type MoldeCategoria =
  | 'superior'
  | 'inferior'
  | 'abrigo'
  | 'deporte'
  | 'conjunto'
  | 'egresados';

/** Identidad de molde. Nominal en el contrato; `string` para literales de catálogo y stores (sin cast). */
export type MoldeId = string;
/** Identidad de pieza. Nominal en el contrato; `string` porque `PieceTemplateDef.id` se asigna a `piezaId`. */
export type PiezaId = string;
export type CatalogId = MoldeId;

export type PieceSlotId =
  | 'frente'
  | 'espalda'
  | 'manga-izquierda'
  | 'manga-derecha'
  | 'cuello'
  | 'punos'
  | 'pretina'
  | 'capucha'
  | 'bolsillos'
  | 'canesu'
  | 'delantero-inferior'
  | 'trasero-inferior'
  | 'panel-lateral';

// =============================================================================
// Bloque 3 — Medidas y piezas resueltas
// Evidencia: universal-mold-engine.ts, piece-decomposer.ts, sublimation-engine.ts
// =============================================================================

export interface MedidaResuelta {
  key: string;
  label: string;
  valorCm: number;
}

export interface MedidasPiezaResueltas {
  piezaId: PiezaId;
  piezaNombre: string;
  esEspejo: boolean;
  espejoDe?: PiezaId;
  medidas: MedidaResuelta[];
  templateKind?: PieceTemplateKind;
  outlinePath?: string;
  viewBox?: string;
  slotId?: PieceSlotId;
}

// =============================================================================
// Bloque 4 — Templates y catálogo
// Evidencia: piece-library.ts, piece-geometry.ts BUILDERS, mold-definitions.ts
// =============================================================================

export type PieceTemplateKind =
  | 'panel-frente'
  | 'panel-espalda'
  | 'manga-set-in'
  | 'manga-raglan'
  | 'manga-corta'
  | 'manga-larga'
  | 'manga-tres-cuartos'
  | 'manga-puno'
  | 'manga-elastico'
  | 'manga-cierre'
  | 'cuello-redondo'
  | 'cuello-v'
  | 'cuello-polo'
  | 'cuello-media-polera'
  | 'cuello-polera'
  | 'cuello-mao'
  | 'cuello-baseball'
  | 'cuello-rib'
  | 'cuello-cierre'
  | 'cuello-botones'
  | 'cuello-combinado'
  | 'cuello-bicolor-banda'
  | 'cuello-tricolor-banda'
  | 'cuello-personalizado'
  | 'canesú'
  | 'capucha'
  | 'bolsillo-canguro'
  | 'pretina'
  | 'short-delantero'
  | 'short-trasero'
  | 'calza-panel'
  | 'pantalon-delantero'
  | 'pantalon-trasero'
  | 'chaleco-panel'
  | 'campera-panel'
  | 'rompevientos-panel'
  | 'jersey-panel'
  | 'egresados-panel';

export interface PieceTemplateDef {
  id: string;
  nombre: string;
  templateKind: PieceTemplateKind;
  medidasBase: Record<string, number>;
  medidaLabels: Record<string, string>;
  esEspejo?: boolean;
  espejoDe?: string;
  scaleModes?: Record<string, 'linear' | 'fixed'>;
}

export interface MoldeDefinition {
  id: MoldeId;
  nombre: string;
  categoria: MoldeCategoria;
  descripcion?: string;
  extraPieces?: PieceTemplateDef[];
  extends?: MoldeId;
  omitPieceIds?: string[];
  pieceOverrides?: Record<string, Record<string, number>>;
  compuestoDe?: MoldeId[];
}

export interface CatalogMoldeSummary {
  id: MoldeId;
  nombre: string;
  categoria: MoldeCategoria;
  descripcion?: string;
  pieceCount: number;
}

export interface MoldeResuelto {
  moldId: MoldeId;
  nombre: string;
  categoria: MoldeCategoria;
  talle: Talle;
  categoriaTalle: CategoriaTalle;
  piezas: MedidasPiezaResueltas[];
  decomposition?: GarmentDecomposition;
}

// =============================================================================
// Bloque 5 — Edición y personalización
// Evidencia: universal-mold-engine.ts, apparel-tables-store, apparel-mold-templates-store,
//            TalleSelector.tsx
// =============================================================================

export interface MoldTemplateEdit {
  moldId: MoldeId;
  pieceOverrides: Record<string, Record<string, number>>;
  workshopName?: string;
  updatedAt?: string;
}

export interface TablaPersonalizadaTaller {
  prendaId: MoldeId;
  categoria: CategoriaTalle;
  talle: Talle;
  overrides: Record<string, number>;
  workshopName?: string;
  updatedAt?: string;
}

export interface TablaReferenciaTalleFila {
  pieza: string;
  medida: string;
  valorCm: number;
}

export interface TablaReferenciaTalle {
  talle: Talle;
  filas: TablaReferenciaTalleFila[];
}

export interface ApparelCustomTablesStore {
  version: number;
  tables: TablaPersonalizadaTaller[];
}

export interface ApparelMoldTemplatesStore {
  version: number;
  edits: MoldTemplateEdit[];
}

// =============================================================================
// Bloque 6 — Geometría
// Evidencia: path-parser.ts, seam-engine.ts, piece-geometry.ts
// =============================================================================

export interface PointCm {
  x: number;
  y: number;
}

// =============================================================================
// Bloque 7 — Slots y descomposición
// Evidencia: piece-decomposer.ts
// =============================================================================

export interface PieceSlotMeta {
  id: PieceSlotId;
  label: string;
  descripcion: string;
  order?: number;
}

export interface DecomposedSlot {
  slotId: PieceSlotId;
  label: string;
  descripcion: string;
  present: boolean;
  piezas: MedidasPiezaResueltas[];
  editablePieza?: MedidasPiezaResueltas;
}

export interface GarmentDecomposition {
  moldId: MoldeId;
  slots: DecomposedSlot[];
  totalPiezas: number;
  piezasEditables: number;
}

// =============================================================================
// Bloque 8 — Fabric, Collar, Seam, Sleeve, Sublimation, SlotStyle
// Evidencia: fabric-library/engine, collar-library/engine, seam-catalog/engine,
//            sleeve-library/engine, sublimation-engine, apparel-ai-executor,
//            stores de selección
// =============================================================================

export type FabricId =
  | 'dry-fit'
  | 'microfibra'
  | 'poliester'
  | 'algodon'
  | 'frisa'
  | 'polar'
  | 'softshell'
  | 'lycra'
  | 'gabardina'
  | 'ripstop';

export type FabricTextureKind =
  | 'mesh-athletic'
  | 'micro-weave'
  | 'plain-synthetic'
  | 'cotton-weave'
  | 'fleece-brush'
  | 'polar-pile'
  | 'laminate-shell'
  | 'stretch-jersey'
  | 'twill-diagonal'
  | 'ripstop-grid';

export interface FabricProperties {
  textura: FabricTextureKind;
  brillo: number;
  elasticidad: number;
  caida: number;
  espesor: number;
}

export interface FabricDefinition {
  id: FabricId;
  nombre: string;
  descripcion: string;
  composicion: string;
  baseColor: string;
  propiedades: FabricProperties;
}

export interface FabricRenderProfile {
  fabricId: FabricId;
  baseColor: string;
  patternId: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidthMul: number;
  brillo: number;
  elasticidad: number;
  caida: number;
  espesor: number;
  defsMarkup: string;
  patternFill: string;
  shineOpacity: number;
  drapeStrength: number;
}

export interface FabricSelectionEntry {
  moldId: MoldeId;
  fabricId: FabricId;
  updatedAt?: string;
}

export interface ApparelFabricSelectionsStore {
  version: number;
  selections: FabricSelectionEntry[];
}

export type CollarId =
  | 'cuello-redondo'
  | 'cuello-v'
  | 'cuello-polo'
  | 'media-polera'
  | 'polera'
  | 'mao'
  | 'baseball'
  | 'rib'
  | 'con-cierre'
  | 'con-botones'
  | 'combinado'
  | 'bicolor'
  | 'tricolor'
  | 'personalizado';

export interface CollarDefinition {
  id: CollarId;
  nombre: string;
  descripcion: string;
  pieces: PieceTemplateDef[];
  includesCanesu?: boolean;
}

export interface CollarSelectionEntry {
  moldId: MoldeId;
  collarId: CollarId;
  pieceOverrides?: Record<string, Partial<Record<string, number>>>;
  updatedAt?: string;
}

export interface ApparelCollarSelectionsStore {
  version: number;
  selections: CollarSelectionEntry[];
}

export type SleeveId =
  | 'manga-corta'
  | 'manga-larga'
  | 'manga-tres-cuartos'
  | 'ranglan'
  | 'sin-mangas'
  | 'con-puno'
  | 'con-elastico'
  | 'con-cierre';

export interface SleeveDefinition {
  id: SleeveId;
  nombre: string;
  descripcion: string;
  pieces: PieceTemplateDef[];
}

export interface SleeveSelectionEntry {
  moldId: MoldeId;
  sleeveId: SleeveId;
  pieceOverrides?: Record<string, Partial<Record<string, number>>>;
  updatedAt?: string;
}

export interface ApparelSleeveSelectionsStore {
  version: number;
  selections: SleeveSelectionEntry[];
}

export type SeamId =
  | 'simple'
  | 'doble'
  | 'overlock'
  | 'tapacostura'
  | 'recubridora'
  | 'decorativa';

export interface SeamLayer {
  offsetCm: number;
  label: string;
  stroke: string;
  strokeWidthRatio: number;
  strokeDasharray?: string;
  zigzag?: boolean;
}

export interface SeamDefinition {
  id: SeamId;
  nombre: string;
  descripcion: string;
  layers: SeamLayer[];
}

export interface SeamRenderLine {
  path: string;
  label: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  strokeLinecap: 'round' | 'butt';
}

export interface PieceSeamsOverlay {
  seamId: SeamId;
  edgePath: string;
  lines: SeamRenderLine[];
}

export interface SeamSelectionEntry {
  moldId: MoldeId;
  seamId: SeamId;
  updatedAt?: string;
}

export interface ApparelSeamSelectionsStore {
  version: number;
  selections: SeamSelectionEntry[];
}

export type SublimationMode = 'full-coverage' | 'per-piece' | 'repeat';

export type VectorSourceFormat = 'svg' | 'pdf' | 'ai' | 'eps';

export interface VectorTextEntry {
  id: string;
  content: string;
}

export interface SublimationTransform {
  scale: number;
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  offsetXCm: number;
  offsetYCm: number;
}

export interface SublimationAsset {
  id: string;
  fileName: string;
  sourcePath: string;
  normalizedSvgPath: string;
  sourceFormat: VectorSourceFormat;
  viewBox: string;
  widthUnits: number;
  heightUnits: number;
  unit: 'cm';
  pathCount: number;
  textCount: number;
  nodeCount: number;
  curveCount: number;
  editableTexts: VectorTextEntry[];
  createdAt: string;
}

export interface SublimationRenderProfile {
  enabled: boolean;
  mode: SublimationMode;
  patternId: string;
  defsMarkup: string;
  patternFill: string | null;
  vectorLayerMarkup: string;
  imageLayerMarkup: string;
  opacity: number;
}

export interface SublimationPieceOverride {
  assetId?: string;
  transform?: Partial<SublimationTransform>;
}

export interface SublimationSelectionEntry {
  moldId: MoldeId;
  enabled: boolean;
  mode: SublimationMode;
  globalTransform: SublimationTransform;
  assetId?: string;
  slotAssets?: Partial<Record<PieceSlotId, string>>;
  slotTransforms?: Partial<Record<PieceSlotId, SublimationTransform>>;
  pieceOverrides?: Record<string, SublimationPieceOverride>;
  updatedAt?: string;
}

export interface ApparelSublimationSelectionsStore {
  version: number;
  selections: SublimationSelectionEntry[];
}

export interface ApparelSublimationAssetsStore {
  version: number;
  assets: SublimationAsset[];
}

export interface SlotStyleSpec {
  fillColor?: string;
  trimColor?: string;
}

export interface SlotStyleSelectionEntry {
  moldId: MoldeId;
  slotStyles: Partial<Record<PieceSlotId, SlotStyleSpec>>;
  updatedAt?: string;
}

export interface ApparelSlotStylesStore {
  version: number;
  selections: SlotStyleSelectionEntry[];
}

// =============================================================================
// Bloque 9 — IA
// Evidencia: apparel-ai-engine.ts, apparel-ai-executor.ts
// =============================================================================

export interface ApparelAiContext {
  moldId: MoldeId;
  supportsCollar: boolean;
  supportsSleeve: boolean;
}

export type ApparelAiMutation =
  | { type: 'collar'; collarId: CollarId; reason: string }
  | { type: 'sleeve'; sleeveId: SleeveId; reason: string }
  | { type: 'fabric'; fabricId: FabricId; reason: string }
  | { type: 'seam'; seamId: SeamId; reason: string }
  | { type: 'select_mold'; moldId: MoldeId; reason: string }
  | { type: 'slot_style'; slotId: PieceSlotId; style: SlotStyleSpec; reason: string }
  | { type: 'slot_trim_all'; trimColor: string; slotIds: PieceSlotId[]; reason: string };

export interface ApparelAiPlan {
  moldId: MoldeId;
  instruction: string;
  mutations: ApparelAiMutation[];
  summary: string;
}

export type ApparelAiParseResult =
  | { success: true; plan: ApparelAiPlan; error?: undefined; suggestions?: undefined }
  | { success: false; error: string; plan?: undefined; suggestions?: string[] };
