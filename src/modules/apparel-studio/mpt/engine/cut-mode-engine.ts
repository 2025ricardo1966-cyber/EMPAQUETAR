import type { MedidasPiezaResueltas, PiezaId } from '../../moldes/types';
import type { CutInstructionSpec, PieceCutMode } from '../types';

function hasMirrorSibling(pieza: MedidasPiezaResueltas, allPiezas: MedidasPiezaResueltas[]): boolean {
  return allPiezas.some((p) => p.esEspejo && p.espejoDe === pieza.piezaId);
}

function inferModeFromMold(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[]
): PieceCutMode {
  if (pieza.esEspejo) return 'mirror';
  if (hasMirrorSibling(pieza, allPiezas)) return 'double-cut';
  return 'single-cut';
}

function buildSpecForMode(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[],
  mode: PieceCutMode,
  patch?: Partial<CutInstructionSpec>
): CutInstructionSpec {
  const mirrorMasterId = patch?.mirrorMasterId ?? pieza.espejoDe;
  const visible = patch?.visible ?? true;

  switch (mode) {
    case 'mirror':
      return {
        mode: 'mirror',
        quantity: 0,
        foldCut: true,
        isMirrorInstance: true,
        mirrorMasterId,
        exportToPlotter: false,
        visible,
        cutLabel:
          patch?.cutLabel ??
          `Espejo${mirrorMasterId ? ` de ${mirrorMasterId}` : ''} — no duplicar en plotter`,
      };

    case 'double-cut':
      return {
        mode: 'double-cut',
        quantity: 2,
        foldCut: true,
        isMirrorInstance: false,
        exportToPlotter: true,
        visible,
        cutLabel: patch?.cutLabel ?? 'CORTE ×2 (doblar tela / espejo)',
      };

    case 'single-cut':
      return {
        mode: 'single-cut',
        quantity: 1,
        foldCut: false,
        isMirrorInstance: false,
        exportToPlotter: true,
        visible,
        cutLabel: patch?.cutLabel ?? 'CORTE ×1',
      };

    case 'normal':
    default: {
      if (pieza.esEspejo) {
        return buildSpecForMode(pieza, allPiezas, 'mirror', { ...patch, mode: 'mirror' });
      }
      const mirrorSibling = hasMirrorSibling(pieza, allPiezas);
      return {
        mode: 'normal',
        quantity: mirrorSibling ? 2 : 1,
        foldCut: mirrorSibling,
        isMirrorInstance: false,
        exportToPlotter: true,
        visible,
        cutLabel:
          patch?.cutLabel ??
          (mirrorSibling ? 'CORTE ×2 (automático / espejo)' : 'CORTE ×1 (automático)'),
      };
    }
  }
}

/** Resuelve instrucción de corte MPT — no modifica geometría del molde */
export function resolveCutInstruction(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[],
  patch?: Partial<CutInstructionSpec>
): CutInstructionSpec {
  const mode = patch?.mode ?? inferModeFromMold(pieza, allPiezas);
  return buildSpecForMode(pieza, allPiezas, mode, patch);
}

export function shouldExportPieceToPlotter(
  pieza: MedidasPiezaResueltas,
  cut?: CutInstructionSpec
): boolean {
  if (!pieza.outlinePath || !pieza.viewBox) return false;
  if (cut) {
    return cut.exportToPlotter && cut.mode !== 'mirror';
  }
  return !pieza.esEspejo;
}

export function exportQuantityLabel(cut: CutInstructionSpec): string {
  if (cut.mode === 'mirror') return 'ESPEJO';
  if (cut.quantity > 1) return `×${cut.quantity}`;
  return '×1';
}

export function findMirrorMasterId(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[]
): PiezaId | undefined {
  if (pieza.espejoDe) return pieza.espejoDe;
  return allPiezas.find((p) => p.esEspejo && p.espejoDe === pieza.piezaId)?.piezaId;
}

/** @deprecated Use resolveCutInstruction */
export function buildCutInstruction(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[]
): CutInstructionSpec {
  return resolveCutInstruction(pieza, allPiezas);
}
