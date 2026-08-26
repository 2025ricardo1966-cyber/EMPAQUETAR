import type { SeamDefinition, SeamId } from '../types';

export const SEAM_LIBRARY: Record<SeamId, SeamDefinition> = {
  simple: {
    id: 'simple',
    nombre: 'Costura simple',
    descripcion: 'Una línea de pespunte a 0,7 cm del borde.',
    layers: [
      {
        offsetCm: 0.7,
        label: 'Pespunte',
        stroke: '#f97316',
        strokeWidthRatio: 0.006,
      },
    ],
  },
  doble: {
    id: 'doble',
    nombre: 'Doble',
    descripcion: 'Dos líneas paralelas — remalle + pespunte de refuerzo.',
    layers: [
      {
        offsetCm: 0.5,
        label: 'Remalle interior',
        stroke: '#fb923c',
        strokeWidthRatio: 0.005,
        strokeDasharray: '2 1',
      },
      {
        offsetCm: 1.0,
        label: 'Pespunte exterior',
        stroke: '#f97316',
        strokeWidthRatio: 0.006,
      },
    ],
  },
  overlock: {
    id: 'overlock',
    nombre: 'Overlock',
    descripcion: 'Terminación en zigzag sobre el borde de corte.',
    layers: [
      {
        offsetCm: 0,
        label: 'Overlock',
        stroke: '#a855f7',
        strokeWidthRatio: 0.005,
        zigzag: true,
      },
    ],
  },
  tapacostura: {
    id: 'tapacostura',
    nombre: 'Tapacostura',
    descripcion: 'Doble línea — borde y vuelta tapada.',
    layers: [
      {
        offsetCm: 0.35,
        label: 'Borde vuelto',
        stroke: '#eab308',
        strokeWidthRatio: 0.005,
      },
      {
        offsetCm: 1.2,
        label: 'Fijación tapacostura',
        stroke: '#ca8a04',
        strokeWidthRatio: 0.006,
      },
    ],
  },
  recubridora: {
    id: 'recubridora',
    nombre: 'Recubridora',
    descripcion: 'Triple pespunte tipo coverstitch.',
    layers: [
      {
        offsetCm: 0.25,
        label: 'Aguja 1',
        stroke: '#22d3ee',
        strokeWidthRatio: 0.005,
      },
      {
        offsetCm: 0.55,
        label: 'Aguja 2',
        stroke: '#06b6d4',
        strokeWidthRatio: 0.005,
      },
      {
        offsetCm: 0.85,
        label: 'Aguja 3',
        stroke: '#0891b2',
        strokeWidthRatio: 0.005,
      },
    ],
  },
  decorativa: {
    id: 'decorativa',
    nombre: 'Costura decorativa',
    descripcion: 'Línea ondulada visible sobre el borde.',
    layers: [
      {
        offsetCm: 0.45,
        label: 'Decorativa',
        stroke: '#ec4899',
        strokeWidthRatio: 0.007,
        strokeDasharray: '1.5 0.8',
      },
    ],
  },
};

export function getSeamDefinition(id: SeamId): SeamDefinition {
  return SEAM_LIBRARY[id];
}

export function listSeamDefinitions(): SeamDefinition[] {
  return Object.values(SEAM_LIBRARY);
}

export function listSeamOptions() {
  return listSeamDefinitions().map((s) => ({
    id: s.id,
    nombre: s.nombre,
    descripcion: s.descripcion,
    lineCount: s.layers.length,
  }));
}
