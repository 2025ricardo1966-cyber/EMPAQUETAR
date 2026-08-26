import type { MedidasPiezaResueltas, Talle } from '../../moldes/types';
import type {
  CutInstructionSpec,
  GrainLineSpec,
  PieceIdentificationSpec,
  ResolvedPieceIdentification,
} from '../types';

export const IDENTIFICATION_FIELD_LABELS = {
  name: 'Nombre',
  number: 'Nº',
  talle: 'Talle',
  quantity: 'Cantidad',
  uniqueId: 'ID único',
  grainLabel: 'Hilo',
} as const;

export function defaultIdentificationSpec(): PieceIdentificationSpec {
  return {
    anchorNorm: { x: 0.5, y: 0.92 },
    visible: true,
    fields: {
      name: true,
      number: true,
      talle: true,
      quantity: true,
      uniqueId: true,
      grainLabel: true,
    },
    showGrainArrow: true,
    fontScale: 0.038,
    align: 'middle',
  };
}

function parseViewBox(viewBox: string | undefined): { w: number; h: number } {
  if (!viewBox) return { w: 40, h: 50 };
  const parts = viewBox.split(' ').map(Number);
  return { w: parts[2] ?? 40, h: parts[3] ?? 50 };
}

/** Número secuencial entre piezas maestras con contorno */
export function resolvePieceNumber(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[]
): number {
  const masters = allPiezas.filter((p) => !p.esEspejo && p.outlinePath);
  const idx = masters.findIndex((p) => p.piezaId === pieza.piezaId);
  return idx >= 0 ? idx + 1 : 0;
}

function quantityText(cut: CutInstructionSpec): string {
  if (cut.mode === 'mirror') return 'ESPEJO';
  if (cut.quantity <= 0) return '—';
  return `×${cut.quantity}`;
}

/** Resuelve bloque de identificación — posición en espacio viewBox (cm), sin alterar geometría */
export function resolvePieceIdentification(
  pieza: MedidasPiezaResueltas,
  allPiezas: MedidasPiezaResueltas[],
  spec: PieceIdentificationSpec,
  context: {
    talle: Talle;
    identificationCode: string;
    shortLabel: string;
    cutInstruction: CutInstructionSpec;
    grain: GrainLineSpec;
  }
): ResolvedPieceIdentification {
  const { w, h } = parseViewBox(pieza.viewBox);
  const minDim = Math.min(w, h);
  const fontSize = minDim * (spec.fontScale ?? 0.038);
  const lineHeight = fontSize * 1.15;
  const pieceNumber = resolvePieceNumber(pieza, allPiezas);

  const lines: ResolvedPieceIdentification['lines'] = [];

  if (spec.fields.name) {
    lines.push({ key: 'name', text: context.shortLabel || pieza.piezaNombre });
  }
  if (spec.fields.number && pieceNumber > 0) {
    lines.push({ key: 'number', text: `Nº ${String(pieceNumber).padStart(2, '0')}` });
  }
  if (spec.fields.talle) {
    lines.push({ key: 'talle', text: `Talle ${context.talle.toUpperCase()}` });
  }
  if (spec.fields.quantity) {
    lines.push({ key: 'quantity', text: quantityText(context.cutInstruction) });
  }
  if (spec.fields.grainLabel) {
    lines.push({ key: 'grainLabel', text: context.grain.label });
  }
  if (spec.fields.uniqueId) {
    lines.push({ key: 'uniqueId', text: context.identificationCode });
  }

  const x = spec.anchorNorm.x * w;
  const y = spec.anchorNorm.y * h;

  return {
    x,
    y,
    fontSize,
    lineHeight,
    align: spec.align ?? 'middle',
    lines,
    visible: spec.visible,
    pieceNumber,
    uniqueId: context.identificationCode,
    anchorNorm: { ...spec.anchorNorm },
  };
}
