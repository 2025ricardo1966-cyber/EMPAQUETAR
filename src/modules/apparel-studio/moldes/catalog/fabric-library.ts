import type { FabricDefinition, FabricId, FabricProperties, FabricTextureKind } from '../types';

function props(
  textura: FabricTextureKind,
  brillo: number,
  elasticidad: number,
  caida: number,
  espesor: number
): FabricProperties {
  return { textura, brillo, elasticidad, caida, espesor };
}

/** Biblioteca profesional de telas — propiedades físicas de referencia */
export const FABRIC_LIBRARY: Record<FabricId, FabricDefinition> = {
  'dry-fit': {
    id: 'dry-fit',
    nombre: 'Dry Fit',
    descripcion: 'Poliéster técnico transpirable para alto rendimiento.',
    composicion: '100 % poliéster técnico',
    baseColor: '#1e4d6b',
    propiedades: props('mesh-athletic', 48, 38, 22, 14),
  },
  microfibra: {
    id: 'microfibra',
    nombre: 'Microfibra',
    descripcion: 'Fibra fina, suave y de secado rápido.',
    composicion: 'Poliéster / poliamida microfibra',
    baseColor: '#2a5a4a',
    propiedades: props('micro-weave', 52, 32, 28, 12),
  },
  poliester: {
    id: 'poliester',
    nombre: 'Poliéster',
    descripcion: 'Tela sintética versátil para uniformes y deporte.',
    composicion: '100 % poliéster',
    baseColor: '#3d4f6f',
    propiedades: props('plain-synthetic', 50, 26, 34, 18),
  },
  algodon: {
    id: 'algodon',
    nombre: 'Algodón',
    descripcion: 'Fibra natural, confortable y transpirable.',
    composicion: '100 % algodón peinado',
    baseColor: '#8b7355',
    propiedades: props('cotton-weave', 12, 14, 58, 24),
  },
  frisa: {
    id: 'frisa',
    nombre: 'Frisa',
    descripcion: 'Algodón cepillado con buen aislamiento térmico.',
    composicion: 'Algodón frisado',
    baseColor: '#6b5b4f',
    propiedades: props('fleece-brush', 8, 22, 52, 38),
  },
  polar: {
    id: 'polar',
    nombre: 'Polar',
    descripcion: 'Tejido de pelo sintético, muy abrigado.',
    composicion: '100 % poliéster polar',
    baseColor: '#4a5568',
    propiedades: props('polar-pile', 6, 42, 48, 42),
  },
  softshell: {
    id: 'softshell',
    nombre: 'Softshell',
    descripcion: 'Laminado elástico resistente al viento y agua.',
    composicion: 'Poliéster / elastano laminado',
    baseColor: '#374151',
    propiedades: props('laminate-shell', 38, 48, 32, 30),
  },
  lycra: {
    id: 'lycra',
    nombre: 'Lycra',
    descripcion: 'Alta elasticidad para calzas y compresión.',
    composicion: 'Elastano / poliéster',
    baseColor: '#1a3a4a',
    propiedades: props('stretch-jersey', 42, 96, 18, 10),
  },
  gabardina: {
    id: 'gabardina',
    nombre: 'Gabardina',
    descripcion: 'Sarga diagonal resistente para pantalones y abrigos.',
    composicion: 'Algodón / poliéster sarga',
    baseColor: '#5c4d3c',
    propiedades: props('twill-diagonal', 18, 16, 62, 32),
  },
  ripstop: {
    id: 'ripstop',
    nombre: 'Ripstop',
    descripcion: 'Cuadriculado anti-desgarro para rompevientos.',
    composicion: 'Nylon / poliéster ripstop',
    baseColor: '#4a5568',
    propiedades: props('ripstop-grid', 28, 24, 38, 22),
  },
};

export function getFabricDefinition(id: FabricId): FabricDefinition {
  return FABRIC_LIBRARY[id];
}

export function listFabricDefinitions(): FabricDefinition[] {
  return Object.values(FABRIC_LIBRARY);
}

export function listFabricOptions() {
  return listFabricDefinitions().map((f) => ({
    id: f.id,
    nombre: f.nombre,
    descripcion: f.descripcion,
    composicion: f.composicion,
    propiedades: f.propiedades,
  }));
}
