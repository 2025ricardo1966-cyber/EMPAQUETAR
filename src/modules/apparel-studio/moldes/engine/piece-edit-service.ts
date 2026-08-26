import type {
  CatalogId,
  CategoriaTalle,
  MedidasPiezaResueltas,
  TablaPersonalizadaTaller,
  Talle,
} from '../types';

/** Construye overrides para una sola pieza editable */
export function overridesForSinglePiece(piece: MedidasPiezaResueltas): Record<string, number> {
  const overrides: Record<string, number> = {};
  if (piece.esEspejo) return overrides;
  for (const m of piece.medidas) {
    overrides[`${piece.piezaId}:${m.key}`] = m.valorCm;
  }
  return overrides;
}

/** Fusiona edición de una pieza en la tabla personalizada del taller */
export function mergePieceIntoCustomTable(
  catalogId: CatalogId,
  categoria: CategoriaTalle,
  talle: Talle,
  piece: MedidasPiezaResueltas,
  existingTables: TablaPersonalizadaTaller[],
  workshopName?: string
): TablaPersonalizadaTaller {
  const existing = existingTables.find(
    (t) => t.prendaId === catalogId && t.categoria === categoria && t.talle === talle
  );

  const pieceOverrides = overridesForSinglePiece(piece);

  return {
    prendaId: catalogId,
    categoria,
    talle,
    overrides: { ...(existing?.overrides ?? {}), ...pieceOverrides },
    workshopName: workshopName ?? existing?.workshopName,
    updatedAt: new Date().toISOString(),
  };
}

/** Aplica overrides guardados a una pieza resuelta */
export function applyCustomOverridesToPiece(
  piece: MedidasPiezaResueltas,
  customTable?: TablaPersonalizadaTaller
): MedidasPiezaResueltas {
  if (!customTable || piece.esEspejo) return piece;
  return {
    ...piece,
    medidas: piece.medidas.map((m) => {
      const key = `${piece.piezaId}:${m.key}`;
      const override = customTable.overrides[key];
      return override !== undefined ? { ...m, valorCm: override } : m;
    }),
  };
}
