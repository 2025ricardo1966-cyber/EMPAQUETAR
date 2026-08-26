import { getMoldeDefinition, listCatalogSummaries, resolvePieceTemplates } from '../catalog/mold-definitions';
import { buildPieceOutline, medidasToRecord } from './piece-geometry';
import { scaleMedidasRecord } from './size-scaling';
import { annotatePiecesWithSlots, decomposeGarment } from './piece-decomposer';
import type {
  CatalogMoldeSummary,
  CategoriaTalle,
  MedidasPiezaResueltas,
  MoldTemplateEdit,
  MoldeId,
  MoldeResuelto,
  PieceTemplateDef,
  TablaPersonalizadaTaller,
} from '../types';

function mergeTemplateEdits(
  piece: PieceTemplateDef,
  templateEdits?: MoldTemplateEdit[]
): PieceTemplateDef {
  if (!templateEdits?.length) return piece;
  let merged = { ...piece, medidasBase: { ...piece.medidasBase } };
  for (const edit of templateEdits) {
    const ov = edit.pieceOverrides[piece.id];
    if (ov) merged = { ...merged, medidasBase: { ...merged.medidasBase, ...ov } };
  }
  return merged;
}

function resolvePiece(
  piece: PieceTemplateDef,
  talle: import('../types').Talle,
  categoria: CategoriaTalle,
  moldId: MoldeId,
  customTables: TablaPersonalizadaTaller[],
  templateEdits?: MoldTemplateEdit[]
): MedidasPiezaResueltas {
  const withEdits = mergeTemplateEdits(piece, templateEdits);
  const sourcePiece =
    withEdits.esEspejo && withEdits.espejoDe
      ? resolvePieceTemplates(moldId).find((p) => p.id === withEdits.espejoDe) ?? withEdits
      : withEdits;

  const scaled = scaleMedidasRecord(
    sourcePiece.medidasBase,
    talle,
    categoria,
    sourcePiece.scaleModes ?? {}
  );

  const custom = customTables.find(
    (t) => t.prendaId === moldId && t.categoria === categoria && t.talle === talle
  );

  const medidas = Object.entries(sourcePiece.medidaLabels).map(([key, label]) => {
    const overrideKey = `${sourcePiece.id}:${key}`;
    const valorCm = custom?.overrides[overrideKey] ?? scaled[key] ?? 0;
    return { key, label, valorCm };
  });

  const outline =
    !withEdits.esEspejo && withEdits.templateKind
      ? buildPieceOutline(withEdits.templateKind, medidasToRecord(medidas))
      : null;

  return {
    piezaId: withEdits.id,
    piezaNombre: withEdits.nombre,
    esEspejo: Boolean(withEdits.esEspejo),
    espejoDe: withEdits.espejoDe,
    medidas,
    templateKind: withEdits.templateKind,
    outlinePath: outline?.path,
    viewBox: outline?.viewBox,
  };
}

export function resolveUniversalMolde(
  moldId: MoldeId,
  categoria: CategoriaTalle,
  talle: import('../types').Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  templateEdits: MoldTemplateEdit[] = []
): MoldeResuelto | null {
  const def = getMoldeDefinition(moldId);
  if (!def) return null;

  const editsForMold = templateEdits.filter((e) => e.moldId === moldId);
  const pieces = resolvePieceTemplates(moldId);

  const piezas = annotatePiecesWithSlots(
    pieces.map((p) =>
      resolvePiece(p, talle, categoria, moldId, customTables, editsForMold)
    )
  );

  return {
    moldId,
    nombre: def.nombre,
    categoria: def.categoria,
    talle,
    categoriaTalle: categoria,
    piezas,
    decomposition: decomposeGarment(moldId, piezas),
  };
}

export function listUniversalMoldes(): CatalogMoldeSummary[] {
  return listCatalogSummaries();
}

export function getPiezasImpresionUniversal(
  moldId: MoldeId,
  categoria: CategoriaTalle,
  talle: import('../types').Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  templateEdits: MoldTemplateEdit[] = []
): MedidasPiezaResueltas[] {
  const resolved = resolveUniversalMolde(moldId, categoria, talle, customTables, templateEdits);
  return resolved?.piezas.filter((p) => !p.esEspejo) ?? [];
}

export function overridesFromUniversalMedidas(
  moldId: MoldeId,
  categoria: CategoriaTalle,
  talle: import('../types').Talle,
  piezas: MedidasPiezaResueltas[],
  workshopName?: string
): TablaPersonalizadaTaller {
  const overrides: Record<string, number> = {};
  for (const pieza of piezas) {
    if (pieza.esEspejo) continue;
    for (const m of pieza.medidas) {
      overrides[`${pieza.piezaId}:${m.key}`] = m.valorCm;
    }
  }
  return {
    prendaId: moldId,
    categoria,
    talle,
    overrides,
    workshopName,
    updatedAt: new Date().toISOString(),
  };
}

export function templateEditFromPieces(
  moldId: MoldeId,
  piezas: MedidasPiezaResueltas[],
  workshopName?: string
): MoldTemplateEdit {
  const pieceOverrides: Record<string, Record<string, number>> = {};
  for (const pieza of piezas) {
    if (pieza.esEspejo) continue;
    pieceOverrides[pieza.piezaId] = Object.fromEntries(
      pieza.medidas.map((m) => [m.key, m.valorCm])
    );
  }
  return {
    moldId,
    pieceOverrides,
    workshopName,
    updatedAt: new Date().toISOString(),
  };
}

export function isUniversalMoldeId(id: string): id is MoldeId {
  return getMoldeDefinition(id as MoldeId) !== undefined;
}
