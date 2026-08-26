import type { CollarDefinition, CollarId, PieceTemplateDef, PieceTemplateKind } from '../types';

function collarPiece(
  id: string,
  nombre: string,
  templateKind: PieceTemplateKind,
  medidasBase: Record<string, number>,
  medidaLabels: Record<string, string>,
  scaleModes?: Record<string, 'linear' | 'fixed'>
): PieceTemplateDef {
  return { id, nombre, templateKind, medidasBase, medidaLabels, scaleModes };
}

const canesu = collarPiece(
  'canesu',
  'Canesú',
  'canesú',
  { ancho: 8, largo: 28 },
  { ancho: 'Ancho', largo: 'Largo' }
);

/** Catálogo universal de cuellos — piezas independientes del cuerpo de la prenda */
export const COLLAR_LIBRARY: Record<CollarId, CollarDefinition> = {
  'cuello-redondo': {
    id: 'cuello-redondo',
    nombre: 'Cuello redondo',
    descripcion: 'Ribete circular clásico.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello redondo',
        'cuello-redondo',
        { perimetro: 42, alto: 3 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
    ],
  },
  'cuello-v': {
    id: 'cuello-v',
    nombre: 'Cuello V',
    descripcion: 'Escote en V con ribete.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello V',
        'cuello-v',
        { 'ancho-apertura': 18, profundidad: 12, perimetro: 38 },
        {
          'ancho-apertura': 'Ancho apertura',
          profundidad: 'Profundidad',
          perimetro: 'Perímetro ribete',
        }
      ),
    ],
  },
  'cuello-polo': {
    id: 'cuello-polo',
    nombre: 'Cuello polo',
    descripcion: 'Cuello abatible con tapeta.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello polo',
        'cuello-polo',
        { 'ancho-cuello': 42, 'alto-cuello': 8 },
        { 'ancho-cuello': 'Ancho cuello', 'alto-cuello': 'Alto cuello' }
      ),
    ],
    includesCanesu: true,
  },
  'media-polera': {
    id: 'media-polera',
    nombre: 'Media polera',
    descripcion: 'Tapeta corta con 2–3 botones.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello media polera',
        'cuello-media-polera',
        { 'ancho-cuello': 40, 'alto-cuello': 6, 'largo-tapeta': 18, botones: 3 },
        {
          'ancho-cuello': 'Ancho cuello',
          'alto-cuello': 'Alto cuello',
          'largo-tapeta': 'Largo tapeta',
          botones: 'Botones',
        },
        { botones: 'fixed' }
      ),
    ],
    includesCanesu: true,
  },
  polera: {
    id: 'polera',
    nombre: 'Polera',
    descripcion: 'Tapeta completa con botonera.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello polera',
        'cuello-polera',
        { 'ancho-cuello': 42, 'alto-cuello': 8, 'largo-tapeta': 35, botones: 5 },
        {
          'ancho-cuello': 'Ancho cuello',
          'alto-cuello': 'Alto cuello',
          'largo-tapeta': 'Largo tapeta',
          botones: 'Botones',
        },
        { botones: 'fixed' }
      ),
    ],
    includesCanesu: true,
  },
  mao: {
    id: 'mao',
    nombre: 'Mao',
    descripcion: 'Cuello mandarín recto.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello mao',
        'cuello-mao',
        { perimetro: 42, alto: 4, solapa: 2.5 },
        { perimetro: 'Perímetro', alto: 'Alto', solapa: 'Solapa' }
      ),
    ],
  },
  baseball: {
    id: 'baseball',
    nombre: 'Baseball',
    descripcion: 'Cuello plano tipo varsity.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello baseball',
        'cuello-baseball',
        { perimetro: 44, alto: 5, botones: 2 },
        { perimetro: 'Perímetro', alto: 'Alto', botones: 'Botones' },
        { botones: 'fixed' }
      ),
    ],
  },
  rib: {
    id: 'rib',
    nombre: 'Rib',
    descripcion: 'Banda elástica rib.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello rib',
        'cuello-rib',
        { perimetro: 40, alto: 4, elasticidad: 15 },
        { perimetro: 'Perímetro', alto: 'Alto', elasticidad: '% elasticidad' }
      ),
    ],
  },
  'con-cierre': {
    id: 'con-cierre',
    nombre: 'Con cierre',
    descripcion: 'Cuello con cierre frontal.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello con cierre',
        'cuello-cierre',
        { perimetro: 42, alto: 4, 'largo-cierre': 20 },
        { perimetro: 'Perímetro', alto: 'Alto', 'largo-cierre': 'Largo cierre' }
      ),
    ],
  },
  'con-botones': {
    id: 'con-botones',
    nombre: 'Con botones',
    descripcion: 'Banda con botonera.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello con botones',
        'cuello-botones',
        { perimetro: 42, alto: 4, botones: 4, separacion: 3 },
        {
          perimetro: 'Perímetro',
          alto: 'Alto',
          botones: 'Botones',
          separacion: 'Separación (cm)',
        },
        { botones: 'fixed' }
      ),
    ],
  },
  combinado: {
    id: 'combinado',
    nombre: 'Combinado',
    descripcion: 'Rib interior + banda exterior.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello combinado exterior',
        'cuello-combinado',
        { perimetro: 42, 'alto-exterior': 3, 'alto-interior': 2 },
        {
          perimetro: 'Perímetro',
          'alto-exterior': 'Alto exterior',
          'alto-interior': 'Alto interior rib',
        }
      ),
    ],
  },
  bicolor: {
    id: 'bicolor',
    nombre: 'Bicolor',
    descripcion: 'Dos bandas de color.',
    pieces: [
      collarPiece(
        'cuello-banda-a',
        'Banda exterior',
        'cuello-bicolor-banda',
        { perimetro: 42, alto: 2 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
      collarPiece(
        'cuello-banda-b',
        'Banda interior',
        'cuello-bicolor-banda',
        { perimetro: 40, alto: 2 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
    ],
  },
  tricolor: {
    id: 'tricolor',
    nombre: 'Tricolor',
    descripcion: 'Tres bandas de color.',
    pieces: [
      collarPiece(
        'cuello-banda-a',
        'Banda 1 (exterior)',
        'cuello-tricolor-banda',
        { perimetro: 42, alto: 1.5 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
      collarPiece(
        'cuello-banda-b',
        'Banda 2 (media)',
        'cuello-tricolor-banda',
        { perimetro: 41, alto: 1.5 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
      collarPiece(
        'cuello-banda-c',
        'Banda 3 (interior)',
        'cuello-tricolor-banda',
        { perimetro: 40, alto: 1.5 },
        { perimetro: 'Perímetro', alto: 'Alto' }
      ),
    ],
  },
  personalizado: {
    id: 'personalizado',
    nombre: 'Personalizado',
    descripcion: 'Cuello editable con medidas libres.',
    pieces: [
      collarPiece(
        'cuello',
        'Cuello personalizado',
        'cuello-personalizado',
        {
          perimetro: 42,
          alto: 3,
          'ancho-apertura': 0,
          profundidad: 0,
          botones: 0,
        },
        {
          perimetro: 'Perímetro',
          alto: 'Alto',
          'ancho-apertura': 'Ancho apertura (0=redondo)',
          profundidad: 'Profundidad V (0=redondo)',
          botones: 'Botones (0=ninguno)',
        },
        { botones: 'fixed' }
      ),
    ],
  },
};

export function getCollarDefinition(id: CollarId): CollarDefinition {
  return COLLAR_LIBRARY[id];
}

export function listCollarDefinitions(): CollarDefinition[] {
  return Object.values(COLLAR_LIBRARY);
}

export function getCollarCanesuPiece(): PieceTemplateDef {
  return structuredClone(canesu);
}
