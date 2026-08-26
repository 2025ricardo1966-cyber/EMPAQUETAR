import type { NotchType } from '../types';

export const NOTCH_TYPE_LABELS: Record<NotchType, string> = {
  single: 'Piquete simple',
  double: 'Doble',
  triple: 'Triple',
  central: 'Central',
  lateral: 'Lateral',
  'union-ref': 'Referencia de unión',
  'assembly-ref': 'Referencia de montaje',
};

export const NOTCH_TYPES: NotchType[] = [
  'single',
  'double',
  'triple',
  'central',
  'lateral',
  'union-ref',
  'assembly-ref',
];
