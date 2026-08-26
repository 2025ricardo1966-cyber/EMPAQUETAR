import { resolveUniversalMolde } from './universal-mold-engine';
import { resolveCollarForMolde } from './collar-engine';
import { applySleevesToMolde } from './sleeve-engine';
import {
  applyCollarToMoldeResult,
  getEffectiveCollarId,
  moldSupportsCollarSwap,
} from '../catalog/collar-system';
import { getEffectiveSleeveId, moldSupportsSleeveSwap } from '../catalog/sleeve-system';
import { annotatePiecesWithSlots, decomposeGarment } from './piece-decomposer';
import type {
  CategoriaTalle,
  CollarId,
  CollarSelectionEntry,
  MoldTemplateEdit,
  MoldeId,
  MoldeResuelto,
  SleeveId,
  SleeveSelectionEntry,
  TablaPersonalizadaTaller,
  Talle,
} from '../types';

/** Resuelve molde con cuello y mangas intercambiables sin alterar el cuerpo */
export function resolveUniversalMoldeWithOptions(
  moldId: MoldeId,
  categoria: CategoriaTalle,
  talle: Talle,
  customTables: TablaPersonalizadaTaller[] = [],
  templateEdits: MoldTemplateEdit[] = [],
  collarSelections: CollarSelectionEntry[] = [],
  sleeveSelections: SleeveSelectionEntry[] = [],
  overrides?: { collarId?: CollarId; sleeveId?: SleeveId }
): MoldeResuelto | null {
  const base = resolveUniversalMolde(moldId, categoria, talle, customTables, templateEdits);
  if (!base) return null;

  let result = base;

  if (moldSupportsCollarSwap(moldId)) {
    const collarSelection = collarSelections.find((s) => s.moldId === moldId);
    const collarId = overrides?.collarId ?? getEffectiveCollarId(moldId, collarSelections);
    const collarPieces = resolveCollarForMolde(
      moldId,
      collarId,
      categoria,
      talle,
      customTables,
      collarSelection
    );
    result = applyCollarToMoldeResult(result, collarId, collarPieces);
  }

  if (moldSupportsSleeveSwap(moldId)) {
    const sleeveSelection = sleeveSelections.find((s) => s.moldId === moldId);
    const sleeveId = overrides?.sleeveId ?? getEffectiveSleeveId(moldId, sleeveSelections);
    result = applySleevesToMolde(
      result,
      moldId,
      sleeveId,
      categoria,
      talle,
      customTables,
      sleeveSelection
    );
  }

  const piezas = annotatePiecesWithSlots(result.piezas);
  const decomposition = decomposeGarment(moldId, piezas);

  return {
    ...result,
    piezas,
    decomposition,
  };
}

export { getEffectiveCollarId, moldSupportsCollarSwap, listCollarOptions } from '../catalog/collar-system';
export {
  getEffectiveSleeveId,
  moldSupportsSleeveSwap,
  listSleeveOptions,
} from '../catalog/sleeve-system';
export { resolveUniversalMoldeWithCollar } from './collar-engine';
