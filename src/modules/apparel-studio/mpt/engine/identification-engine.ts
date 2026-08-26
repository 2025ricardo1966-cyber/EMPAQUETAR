import type { MedidasPiezaResueltas, MoldeId, Talle } from '../../moldes/types';

export function buildIdentificationCode(
  moldId: MoldeId,
  pieza: MedidasPiezaResueltas,
  talle: Talle
): string {
  const mold = moldId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
  const piece = String(pieza.piezaId)
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 10)
    .toUpperCase();
  return `${mold}-${piece}-${talle}`;
}

export function buildShortLabel(pieza: MedidasPiezaResueltas): string {
  const name = pieza.piezaNombre.trim();
  if (name.length <= 18) return name;
  return `${name.slice(0, 16)}…`;
}
