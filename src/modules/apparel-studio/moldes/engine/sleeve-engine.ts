import { buildPieceOutline, medidasToRecord } from './piece-geometry';
import { scaleMedidasRecord } from './size-scaling';
import {
  applySleevesToMoldeResult,
  resolveSleevePieces,
} from '../catalog/sleeve-system';
import type {
  CategoriaTalle,
  MedidasPiezaResueltas,
  MoldeId,
  MoldeResuelto,
  PieceTemplateDef,
  SleeveId,
  SleeveSelectionEntry,
  TablaPersonalizadaTaller,
  Talle,
} from '../types';

function mergeSleeveOverrides(
  piece: PieceTemplateDef,
  selection?: SleeveSelectionEntry
): PieceTemplateDef {
  if (!selection?.pieceOverrides) return piece;
  const ov = selection.pieceOverrides[piece.id];
  if (!ov) return piece;
  const medidasBase = { ...piece.medidasBase };
  for (const [key, value] of Object.entries(ov)) {
    if (value !== undefined) medidasBase[key] = value;
  }
  return { ...piece, medidasBase };
}

function resolveSleevePieceMeasures(
  piece: PieceTemplateDef,
  talle: Talle,
  categoria: CategoriaTalle,
  moldId: MoldeId,
  customTables: TablaPersonalizadaTaller[]
): MedidasPiezaResueltas {
  if (piece.esEspejo && piece.espejoDe) {
    return {
      piezaId: piece.id,
      piezaNombre: piece.nombre,
      esEspejo: true,
      espejoDe: piece.espejoDe,
      medidas: [],
      templateKind: piece.templateKind,
    };
  }

  const scaled = scaleMedidasRecord(
    piece.medidasBase,
    talle,
    categoria,
    piece.scaleModes ?? {}
  );

  const custom = customTables.find(
    (t) => t.prendaId === moldId && t.categoria === categoria && t.talle === talle
  );

  const medidas = Object.entries(piece.medidaLabels).map(([key, label]) => {
    const overrideKey = `${piece.id}:${key}`;
    const valorCm = custom?.overrides[overrideKey] ?? scaled[key] ?? 0;
    return { key, label, valorCm };
  });

  const outline = buildPieceOutline(piece.templateKind, medidasToRecord(medidas));

  return {
    piezaId: piece.id,
    piezaNombre: piece.nombre,
    esEspejo: false,
    medidas,
    templateKind: piece.templateKind,
    outlinePath: outline?.path,
    viewBox: outline?.viewBox,
  };
}

export function resolveSleevesForMolde(
  moldId: MoldeId,
  sleeveId: SleeveId,
  categoria: CategoriaTalle,
  talle: Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  sleeveSelection?: SleeveSelectionEntry
): MedidasPiezaResueltas[] {
  const pieces = resolveSleevePieces(sleeveId).map((p) =>
    mergeSleeveOverrides(p, sleeveSelection)
  );
  return pieces.map((p) =>
    resolveSleevePieceMeasures(p, talle, categoria, moldId, customTables)
  );
}

export function applySleevesToMolde(
  result: MoldeResuelto,
  moldId: MoldeId,
  sleeveId: SleeveId,
  categoria: CategoriaTalle,
  talle: Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  sleeveSelection?: SleeveSelectionEntry
): MoldeResuelto {
  const sleevePieces = resolveSleevesForMolde(
    moldId,
    sleeveId,
    categoria,
    talle,
    customTables,
    sleeveSelection
  );
  return applySleevesToMoldeResult(result, sleevePieces);
}

export {
  getEffectiveSleeveId,
  moldSupportsSleeveSwap,
  listSleeveOptions,
  getDefaultSleeveForMolde,
} from '../catalog/sleeve-system';
