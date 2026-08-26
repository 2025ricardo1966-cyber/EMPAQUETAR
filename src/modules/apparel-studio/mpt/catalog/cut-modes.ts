import type { PieceCutMode } from '../types';

export const CUT_MODE_LABELS: Record<PieceCutMode, string> = {
  normal: 'Normal (automático)',
  mirror: 'Espejo',
  'double-cut': 'Doble corte',
  'single-cut': 'Corte único',
};

export const CUT_MODES: PieceCutMode[] = ['normal', 'mirror', 'double-cut', 'single-cut'];

export const CUT_MODE_DESCRIPTIONS: Record<PieceCutMode, string> = {
  normal: 'Deriva del molde: ×2 si tiene par espejo, ×1 si no',
  mirror: 'Instancia espejo — no exportar en plotter',
  'double-cut': 'Cortar ×2 sobre tela doblada',
  'single-cut': 'Cortar ×1 — pieza única',
};
