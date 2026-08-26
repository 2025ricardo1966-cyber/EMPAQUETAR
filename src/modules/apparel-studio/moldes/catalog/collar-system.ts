import { resolvePieceTemplates } from './mold-definitions';
import { getCollarCanesuPiece, getCollarDefinition, listCollarDefinitions } from './collar-library';
import type {
  CollarId,
  CollarSelectionEntry,
  MedidasPiezaResueltas,
  MoldeId,
  MoldeResuelto,
  PieceTemplateDef,
  PieceTemplateKind,
} from '../types';
import { annotatePiecesWithSlots, decomposeGarment } from '../engine/piece-decomposer';

/** Moldes sin escote intercambiable */
const NO_COLLAR_MOLDES = new Set<MoldeId>([
  'short',
  'bermuda',
  'calza-corta',
  'calza-larga',
  'pantalon-deportivo',
]);

const MOLD_DEFAULT_COLLAR: Partial<Record<MoldeId, CollarId>> = {
  'remera-cuello-redondo': 'cuello-redondo',
  'remera-cuello-v': 'cuello-v',
  'remera-raglan': 'cuello-redondo',
  'chomba-clasica': 'cuello-polo',
  'chomba-deportiva': 'cuello-polo',
  musculosa: 'cuello-redondo',
  campera: 'cuello-redondo',
  buzo: 'cuello-redondo',
  canguro: 'cuello-redondo',
  chaleco: 'cuello-redondo',
  rompevientos: 'con-cierre',
  'camiseta-futbol': 'cuello-v',
  'camiseta-basket': 'cuello-v',
  'camiseta-voley': 'cuello-v',
  'camiseta-rugby': 'cuello-redondo',
  'conjunto-entrenamiento': 'cuello-redondo',
  egresados: 'cuello-redondo',
  camiseta: 'cuello-redondo',
};

const LEGACY_COLLAR_PIECE_IDS = new Set([
  'cuello',
  'cuello-v',
  'cuello-polo',
  'cuello-banda-a',
  'cuello-banda-b',
  'cuello-banda-c',
]);

export function isCollarTemplateKind(kind: PieceTemplateKind): boolean {
  return kind.startsWith('cuello-');
}

export function isCollarPieceTemplate(piece: PieceTemplateDef): boolean {
  return isCollarTemplateKind(piece.templateKind);
}

export function moldSupportsCollarSwap(moldId: MoldeId): boolean {
  if (NO_COLLAR_MOLDES.has(moldId)) return false;
  return resolvePieceTemplates(moldId).some(isCollarPieceTemplate);
}

export function getDefaultCollarForMolde(moldId: MoldeId): CollarId {
  if (MOLD_DEFAULT_COLLAR[moldId]) return MOLD_DEFAULT_COLLAR[moldId]!;
  const templates = resolvePieceTemplates(moldId);
  const builtIn = templates.find(isCollarPieceTemplate);
  if (!builtIn) return 'cuello-redondo';
  return templateKindToCollarId(builtIn.templateKind);
}

function templateKindToCollarId(kind: PieceTemplateKind): CollarId {
  const map: Partial<Record<PieceTemplateKind, CollarId>> = {
    'cuello-redondo': 'cuello-redondo',
    'cuello-v': 'cuello-v',
    'cuello-polo': 'cuello-polo',
    'cuello-media-polera': 'media-polera',
    'cuello-polera': 'polera',
    'cuello-mao': 'mao',
    'cuello-baseball': 'baseball',
    'cuello-rib': 'rib',
    'cuello-cierre': 'con-cierre',
    'cuello-botones': 'con-botones',
    'cuello-combinado': 'combinado',
    'cuello-bicolor-banda': 'bicolor',
    'cuello-tricolor-banda': 'tricolor',
    'cuello-personalizado': 'personalizado',
  };
  return map[kind] ?? 'cuello-redondo';
}

export function listCollarOptions() {
  return listCollarDefinitions().map((c) => ({
    id: c.id,
    nombre: c.nombre,
    descripcion: c.descripcion,
    pieceCount: c.pieces.length + (c.includesCanesu ? 1 : 0),
  }));
}

export function resolveCollarPieces(collarId: CollarId): PieceTemplateDef[] {
  const def = getCollarDefinition(collarId);
  const pieces = def.pieces.map((p) => structuredClone(p));
  if (def.includesCanesu) {
    pieces.push(getCollarCanesuPiece());
  }
  return pieces;
}

export function stripCollarFromResolved(piezas: MedidasPiezaResueltas[]): MedidasPiezaResueltas[] {
  return piezas.filter((p) => {
    if (p.templateKind && isCollarTemplateKind(p.templateKind)) return false;
    if (LEGACY_COLLAR_PIECE_IDS.has(String(p.piezaId))) return false;
    if (p.piezaId === 'canesu') return false;
    return true;
  });
}

export function getEffectiveCollarId(
  moldId: MoldeId,
  selections: CollarSelectionEntry[]
): CollarId {
  const saved = selections.find((s) => s.moldId === moldId);
  return saved?.collarId ?? getDefaultCollarForMolde(moldId);
}

export function applyCollarToMoldeResult(
  result: MoldeResuelto,
  _collarId: CollarId,
  collarPieces: MedidasPiezaResueltas[],
  moldId?: MoldeId
): MoldeResuelto {
  const body = stripCollarFromResolved(result.piezas);
  const piezas = annotatePiecesWithSlots([...body, ...collarPieces]);
  const id = moldId ?? result.moldId;
  return {
    ...result,
    piezas,
    decomposition: decomposeGarment(id, piezas),
  };
}

export function collarSelectionFromId(
  moldId: MoldeId,
  collarId: CollarId
): CollarSelectionEntry {
  return {
    moldId,
    collarId,
    updatedAt: new Date().toISOString(),
  };
}

export { listCollarDefinitions, getCollarDefinition };
