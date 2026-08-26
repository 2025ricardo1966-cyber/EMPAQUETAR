import { resolvePieceTemplates } from './mold-definitions';
import { getSleeveDefinition, listSleeveDefinitions } from './sleeve-library';
import type {
  MedidasPiezaResueltas,
  MoldeId,
  MoldeResuelto,
  PieceTemplateDef,
  PieceTemplateKind,
  SleeveId,
  SleeveSelectionEntry,
} from '../types';
import { annotatePiecesWithSlots, decomposeGarment } from '../engine/piece-decomposer';

const NO_SLEEVE_MOLDES = new Set<MoldeId>([
  'short',
  'bermuda',
  'calza-corta',
  'calza-larga',
  'pantalon-deportivo',
]);

const UPPER_BODY_KINDS = new Set<PieceTemplateKind>([
  'panel-frente',
  'panel-espalda',
  'jersey-panel',
  'egresados-panel',
  'campera-panel',
  'chaleco-panel',
  'rompevientos-panel',
]);

const MOLD_DEFAULT_SLEEVE: Partial<Record<MoldeId, SleeveId>> = {
  'remera-cuello-redondo': 'manga-corta',
  'remera-cuello-v': 'manga-corta',
  'remera-raglan': 'ranglan',
  'chomba-clasica': 'manga-corta',
  'chomba-deportiva': 'manga-corta',
  musculosa: 'sin-mangas',
  campera: 'manga-larga',
  buzo: 'manga-larga',
  canguro: 'manga-larga',
  chaleco: 'sin-mangas',
  rompevientos: 'con-cierre',
  'camiseta-futbol': 'manga-corta',
  'camiseta-basket': 'manga-corta',
  'camiseta-voley': 'manga-corta',
  'camiseta-rugby': 'manga-corta',
  'conjunto-entrenamiento': 'manga-corta',
  egresados: 'manga-larga',
  camiseta: 'manga-corta',
};

const LEGACY_SLEEVE_PIECE_IDS = new Set([
  'manga-izq',
  'manga-der',
  'manga-raglan-izq',
  'manga-raglan-der',
  'puno-izq',
  'puno-der',
]);

export function isSleeveTemplateKind(kind: PieceTemplateKind): boolean {
  return kind.startsWith('manga-');
}

export function isSleevePieceTemplate(piece: PieceTemplateDef): boolean {
  return isSleeveTemplateKind(piece.templateKind);
}

export function moldSupportsSleeveSwap(moldId: MoldeId): boolean {
  if (NO_SLEEVE_MOLDES.has(moldId)) return false;
  const templates = resolvePieceTemplates(moldId);
  return templates.some(
    (p) => UPPER_BODY_KINDS.has(p.templateKind) || isSleevePieceTemplate(p)
  );
}

export function getDefaultSleeveForMolde(moldId: MoldeId): SleeveId {
  if (MOLD_DEFAULT_SLEEVE[moldId]) return MOLD_DEFAULT_SLEEVE[moldId]!;
  const templates = resolvePieceTemplates(moldId);
  const hasRaglan = templates.some((p) => p.templateKind === 'manga-raglan');
  if (hasRaglan) return 'ranglan';
  const hasSetIn = templates.some((p) => p.templateKind === 'manga-set-in');
  if (hasSetIn) {
    const master = templates.find((p) => p.id === 'manga-izq');
    const largo = master?.medidasBase.largo ?? 21;
    if (largo >= 50) return 'manga-larga';
    if (largo >= 35) return 'manga-tres-cuartos';
    return 'manga-corta';
  }
  const hasUpper = templates.some((p) => UPPER_BODY_KINDS.has(p.templateKind));
  return hasUpper ? 'manga-corta' : 'sin-mangas';
}

export function listSleeveOptions() {
  return listSleeveDefinitions().map((s) => ({
    id: s.id,
    nombre: s.nombre,
    descripcion: s.descripcion,
    pieceCount: s.pieces.filter((p) => !p.esEspejo).length,
  }));
}

export function resolveSleevePieces(sleeveId: SleeveId): PieceTemplateDef[] {
  return getSleeveDefinition(sleeveId).pieces.map((p) => structuredClone(p));
}

export function stripSleevesFromResolved(piezas: MedidasPiezaResueltas[]): MedidasPiezaResueltas[] {
  return piezas.filter((p) => {
    if (p.templateKind && isSleeveTemplateKind(p.templateKind)) return false;
    if (LEGACY_SLEEVE_PIECE_IDS.has(String(p.piezaId))) return false;
    return true;
  });
}

export function getEffectiveSleeveId(
  moldId: MoldeId,
  selections: SleeveSelectionEntry[]
): SleeveId {
  const saved = selections.find((s) => s.moldId === moldId);
  return saved?.sleeveId ?? getDefaultSleeveForMolde(moldId);
}

export function applySleevesToMoldeResult(
  result: MoldeResuelto,
  sleevePieces: MedidasPiezaResueltas[]
): MoldeResuelto {
  const body = stripSleevesFromResolved(result.piezas);
  const piezas = annotatePiecesWithSlots([...body, ...sleevePieces]);
  return {
    ...result,
    piezas,
    decomposition: decomposeGarment(result.moldId, piezas),
  };
}

export function sleeveSelectionFromId(
  moldId: MoldeId,
  sleeveId: SleeveId
): SleeveSelectionEntry {
  return {
    moldId,
    sleeveId,
    updatedAt: new Date().toISOString(),
  };
}

export { listSleeveDefinitions, getSleeveDefinition };
