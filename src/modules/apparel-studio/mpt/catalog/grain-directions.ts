import type { GrainDirection } from '../types';

export const GRAIN_DIRECTION_LABELS: Record<GrainDirection, string> = {
  vertical: 'Vertical ↕',
  horizontal: 'Horizontal ↔',
  'bias-45': 'Bias 45° ↗',
  'bias-135': 'Bias 135° ↖',
  custom: 'Personalizado',
};

export const GRAIN_DIRECTIONS: GrainDirection[] = [
  'vertical',
  'horizontal',
  'bias-45',
  'bias-135',
  'custom',
];

export const GRAIN_AXIS_LABELS = {
  thread: 'Dirección del hilo',
  fabric: 'Dirección del tejido',
  stretch: 'Dirección del estiramiento',
  cut: 'Sentido de corte',
} as const;
