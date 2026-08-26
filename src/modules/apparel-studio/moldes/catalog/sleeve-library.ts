import type { PieceTemplateDef, PieceTemplateKind, SleeveDefinition, SleeveId } from '../types';

function sleevePiece(
  id: string,
  nombre: string,
  templateKind: PieceTemplateKind,
  medidasBase: Record<string, number>,
  medidaLabels: Record<string, string>,
  opts?: { esEspejo?: boolean; espejoDe?: string; scaleModes?: Record<string, 'linear' | 'fixed'> }
): PieceTemplateDef {
  return { id, nombre, templateKind, medidasBase, medidaLabels, ...opts };
}

function setInPair(
  largo: number,
  kind: PieceTemplateKind,
  label: string
): PieceTemplateDef[] {
  return [
    sleevePiece(
      'manga-izq',
      `${label} Izq`,
      kind,
      { largo, 'ancho-cabeza': 40, 'ancho-puno': 15 },
      { largo: 'Largo', 'ancho-cabeza': 'Ancho cabeza', 'ancho-puno': 'Ancho puño' }
    ),
    sleevePiece('manga-der', `${label} Der`, kind, {}, {}, {
      esEspejo: true,
      espejoDe: 'manga-izq',
    }),
  ];
}

function raglanPair(largo: number): PieceTemplateDef[] {
  return [
    sleevePiece(
      'manga-raglan-izq',
      'Manga raglan Izq',
      'manga-raglan',
      { largo, 'ancho-cabeza': 42 },
      { largo: 'Largo', 'ancho-cabeza': 'Ancho cabeza' }
    ),
    sleevePiece('manga-raglan-der', 'Manga raglan Der', 'manga-raglan', {}, {}, {
      esEspejo: true,
      espejoDe: 'manga-raglan-izq',
    }),
  ];
}

function punoPair(): PieceTemplateDef[] {
  return [
    sleevePiece(
      'puno-izq',
      'Puño Izq',
      'manga-puno',
      { ancho: 16, alto: 4 },
      { ancho: 'Ancho', alto: 'Alto' }
    ),
    sleevePiece('puno-der', 'Puño Der', 'manga-puno', {}, {}, {
      esEspejo: true,
      espejoDe: 'puno-izq',
    }),
  ];
}

/** Catálogo universal de mangas — slot intercambiable entre modelos compatibles */
export const SLEEVE_LIBRARY: Record<SleeveId, SleeveDefinition> = {
  'manga-corta': {
    id: 'manga-corta',
    nombre: 'Manga corta',
    descripcion: 'Manga set-in corta (~21 cm).',
    pieces: setInPair(21, 'manga-corta', 'Manga corta'),
  },
  'manga-larga': {
    id: 'manga-larga',
    nombre: 'Manga larga',
    descripcion: 'Manga set-in larga (~58 cm).',
    pieces: setInPair(58, 'manga-larga', 'Manga larga'),
  },
  'manga-tres-cuartos': {
    id: 'manga-tres-cuartos',
    nombre: 'Manga 3/4',
    descripcion: 'Manga set-in tres cuartos (~44 cm).',
    pieces: setInPair(44, 'manga-tres-cuartos', 'Manga 3/4'),
  },
  ranglan: {
    id: 'ranglan',
    nombre: 'Ranglan',
    descripcion: 'Manga raglan diagonal.',
    pieces: raglanPair(22),
  },
  'sin-mangas': {
    id: 'sin-mangas',
    nombre: 'Sin mangas',
    descripcion: 'Musculosa — sin piezas de manga.',
    pieces: [],
  },
  'con-puno': {
    id: 'con-puno',
    nombre: 'Con puño',
    descripcion: 'Manga larga con puño rib separado.',
    pieces: [...setInPair(56, 'manga-larga', 'Manga con puño'), ...punoPair()],
  },
  'con-elastico': {
    id: 'con-elastico',
    nombre: 'Con elástico',
    descripcion: 'Manga con puño elástico integrado.',
    pieces: [
      sleevePiece(
        'manga-izq',
        'Manga elástico Izq',
        'manga-elastico',
        { largo: 58, 'ancho-cabeza': 40, 'ancho-puno': 12, elasticidad: 20 },
        {
          largo: 'Largo',
          'ancho-cabeza': 'Ancho cabeza',
          'ancho-puno': 'Ancho puño',
          elasticidad: '% elasticidad',
        }
      ),
      sleevePiece('manga-der', 'Manga elástico Der', 'manga-elastico', {}, {}, {
        esEspejo: true,
        espejoDe: 'manga-izq',
      }),
    ],
  },
  'con-cierre': {
    id: 'con-cierre',
    nombre: 'Con cierre',
    descripcion: 'Manga con cierre lateral (ej. campera).',
    pieces: [
      sleevePiece(
        'manga-izq',
        'Manga cierre Izq',
        'manga-cierre',
        { largo: 58, 'ancho-cabeza': 42, 'ancho-puno': 16, 'largo-cierre': 18 },
        {
          largo: 'Largo',
          'ancho-cabeza': 'Ancho cabeza',
          'ancho-puno': 'Ancho puño',
          'largo-cierre': 'Largo cierre',
        }
      ),
      sleevePiece('manga-der', 'Manga cierre Der', 'manga-cierre', {}, {}, {
        esEspejo: true,
        espejoDe: 'manga-izq',
      }),
    ],
  },
};

export function getSleeveDefinition(id: SleeveId): SleeveDefinition {
  return SLEEVE_LIBRARY[id];
}

export function listSleeveDefinitions(): SleeveDefinition[] {
  return Object.values(SLEEVE_LIBRARY);
}
