import { buildPieceOutline, medidasToRecord } from './piece-geometry';
import { scaleMedidasRecord } from './size-scaling';
import {
  applyCollarToMoldeResult,
  getDefaultCollarForMolde,
  getEffectiveCollarId,
  moldSupportsCollarSwap,
  resolveCollarPieces,
} from '../catalog/collar-system';
import { resolveUniversalMolde } from './universal-mold-engine';
import type {
  CategoriaTalle,
  CollarId,
  CollarSelectionEntry,
  MedidasPiezaResueltas,
  MoldTemplateEdit,
  MoldeId,
  MoldeResuelto,
  PieceTemplateDef,
  TablaPersonalizadaTaller,
  Talle,
} from '../types';

function mergeCollarOverrides(
  piece: PieceTemplateDef,
  selection?: CollarSelectionEntry
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

function resolveCollarPieceMeasures(
  piece: PieceTemplateDef,
  talle: Talle,
  categoria: CategoriaTalle,
  moldId: MoldeId,
  customTables: TablaPersonalizadaTaller[]
): MedidasPiezaResueltas {
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

export function resolveCollarForMolde(
  moldId: MoldeId,
  collarId: CollarId,
  categoria: CategoriaTalle,
  talle: Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  collarSelection?: CollarSelectionEntry
): MedidasPiezaResueltas[] {
  const pieces = resolveCollarPieces(collarId).map((p) =>
    mergeCollarOverrides(p, collarSelection)
  );
  return pieces.map((p) =>
    resolveCollarPieceMeasures(p, talle, categoria, moldId, customTables)
  );
}

/** Resuelve molde aplicando cuello intercambiable sin alterar el cuerpo */
export function resolveUniversalMoldeWithCollar(
  moldId: MoldeId,
  categoria: CategoriaTalle,
  talle: Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  templateEdits: MoldTemplateEdit[] = [],
  collarSelections: CollarSelectionEntry[] = [],
  collarIdOverride?: CollarId
): MoldeResuelto | null {
  const base = resolveUniversalMolde(moldId, categoria, talle, customTables, templateEdits);
  if (!base) return null;
  if (!moldSupportsCollarSwap(moldId)) return base;

  const selection = collarSelections.find((s) => s.moldId === moldId);
  const collarId = collarIdOverride ?? getEffectiveCollarId(moldId, collarSelections);
  const collarPieces = resolveCollarForMolde(
    moldId,
    collarId,
    categoria,
    talle,
    customTables,
    selection
  );

  return applyCollarToMoldeResult(base, collarId, collarPieces, moldId);
}

export function listCollarOptionsForMolde(moldId: MoldeId) {
  return {
    supportsCollar: moldSupportsCollarSwap(moldId),
    defaultCollarId: getDefaultCollarForMolde(moldId),
  };
}

export { getEffectiveCollarId, moldSupportsCollarSwap, listCollarOptions } from '../catalog/collar-system';
