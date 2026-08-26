import type { MarginKind } from '../types';

export const MARGIN_KIND_LABELS: Record<MarginKind, string> = {
  costura: 'Costura',
  dobladillo: 'Dobladillo',
  vista: 'Vista',
  cuello: 'Cuello',
  puno: 'Puño',
  cierre: 'Cierre',
};

export const MARGIN_KINDS: MarginKind[] = [
  'costura',
  'dobladillo',
  'vista',
  'cuello',
  'puno',
  'cierre',
];

/** Valores por defecto industriales (cm) */
export const DEFAULT_MARGIN_CM: Record<MarginKind, number> = {
  costura: 1.0,
  dobladillo: 3.0,
  vista: 0.7,
  cuello: 0.6,
  puno: 0.5,
  cierre: 1.5,
};

export const MARGIN_KIND_COLORS: Record<MarginKind, string> = {
  costura: '#f97316',
  dobladillo: '#3b82f6',
  vista: '#8b5cf6',
  cuello: '#14b8a6',
  puno: '#eab308',
  cierre: '#ef4444',
};
