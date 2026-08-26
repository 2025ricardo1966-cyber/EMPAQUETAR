import type { CategoriaTalle, Talle } from '../types';

/** Ratios respecto a M (adulto) derivados de tablas universales camiseta */
const ADULTO_SCALE: Record<Talle, number> = {
  S: 46 / 49,
  M: 1,
  L: 52 / 49,
  XL: 55 / 49,
  XXL: 58 / 49,
  T4: 30 / 34,
  T6: 32 / 34,
  T8: 1,
  T10: 37 / 34,
  T12: 40 / 34,
  T14: 43 / 34,
};

const REFERENCE_TALLE: Record<CategoriaTalle, Talle> = {
  adulto: 'M',
  infantil: 'T8',
};

export function getTalleScale(talle: Talle, categoria: CategoriaTalle): number {
  const ref = REFERENCE_TALLE[categoria];
  const tVal = ADULTO_SCALE[talle] ?? 1;
  const refVal = ADULTO_SCALE[ref] ?? 1;
  return tVal / refVal;
}

export function scaleMeasure(
  baseCm: number,
  talle: Talle,
  categoria: CategoriaTalle,
  mode: 'linear' | 'fixed' = 'linear'
): number {
  if (mode === 'fixed') return baseCm;
  const scaled = baseCm * getTalleScale(talle, categoria);
  return Math.round(scaled * 100) / 100;
}

export function scaleMedidasRecord(
  base: Record<string, number>,
  talle: Talle,
  categoria: CategoriaTalle,
  scaleModes: Record<string, 'linear' | 'fixed'> = {}
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(base)) {
    out[key] = scaleMeasure(val, talle, categoria, scaleModes[key] ?? 'linear');
  }
  return out;
}
