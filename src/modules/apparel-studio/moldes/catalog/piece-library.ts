import type { PieceTemplateDef, PieceTemplateKind } from '../types';

function piece(
  id: string,
  nombre: string,
  templateKind: PieceTemplateKind,
  medidasBase: Record<string, number>,
  medidaLabels: Record<string, string>,
  opts?: { esEspejo?: boolean; espejoDe?: string; scaleModes?: Record<string, 'linear' | 'fixed'> }
): PieceTemplateDef {
  return {
    id,
    nombre,
    templateKind,
    medidasBase,
    medidaLabels,
    esEspejo: opts?.esEspejo,
    espejoDe: opts?.espejoDe,
    scaleModes: opts?.scaleModes,
  };
}

/** Piezas base reutilizables — medidas en cm @ talle M adulto */
export const PIECE_LIBRARY = {
  frente: piece(
    'frente',
    'Frente',
    'panel-frente',
    { 'ancho-axila': 49, 'alto-total': 71, sisa: 21 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total', sisa: 'Sisa' }
  ),
  espalda: piece(
    'espalda',
    'Espalda',
    'panel-espalda',
    { 'ancho-axila': 49, 'alto-total': 73, sisa: 20 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total', sisa: 'Sisa' }
  ),
  mangaIzq: piece(
    'manga-izq',
    'Manga Izq',
    'manga-set-in',
    { largo: 21, 'ancho-cabeza': 40, 'ancho-puno': 15 },
    { largo: 'Largo', 'ancho-cabeza': 'Ancho cabeza', 'ancho-puno': 'Ancho puño' }
  ),
  mangaDer: piece('manga-der', 'Manga Der', 'manga-set-in', {}, {}, {
    esEspejo: true,
    espejoDe: 'manga-izq',
  }),
  cuelloRedondo: piece(
    'cuello',
    'Cuello redondo',
    'cuello-redondo',
    { perimetro: 42, alto: 3 },
    { perimetro: 'Perímetro', alto: 'Alto' }
  ),
  cuelloV: piece(
    'cuello-v',
    'Cuello V',
    'cuello-v',
    { 'ancho-apertura': 18, profundidad: 12 },
    { 'ancho-apertura': 'Ancho apertura', profundidad: 'Profundidad' }
  ),
  cuelloPolo: piece(
    'cuello-polo',
    'Cuello polo',
    'cuello-polo',
    { 'ancho-cuello': 42, 'alto-cuello': 8 },
    { 'ancho-cuello': 'Ancho cuello', 'alto-cuello': 'Alto cuello' }
  ),
  canesu: piece(
    'canesu',
    'Canesú',
    'canesú',
    { ancho: 8, largo: 28 },
    { ancho: 'Ancho', largo: 'Largo' }
  ),
  mangaRaglanIzq: piece(
    'manga-raglan-izq',
    'Manga raglan Izq',
    'manga-raglan',
    { largo: 22, 'ancho-cabeza': 42 },
    { largo: 'Largo', 'ancho-cabeza': 'Ancho cabeza' }
  ),
  mangaRaglanDer: piece('manga-raglan-der', 'Manga raglan Der', 'manga-raglan', {}, {}, {
    esEspejo: true,
    espejoDe: 'manga-raglan-izq',
  }),
  delanteroIzq: piece(
    'delantero-izq',
    'Delantero Izq',
    'short-delantero',
    { ancho: 26, 'alto-total': 48, 'tiro-delantero': 27 },
    { ancho: 'Ancho', 'alto-total': 'Alto total', 'tiro-delantero': 'Tiro delantero' }
  ),
  delanteroDer: piece('delantero-der', 'Delantero Der', 'short-delantero', {}, {}, {
    esEspejo: true,
    espejoDe: 'delantero-izq',
  }),
  traseroIzq: piece(
    'trasero-izq',
    'Trasero Izq',
    'short-trasero',
    { ancho: 28, 'alto-total': 50, 'tiro-trasero': 31 },
    { ancho: 'Ancho', 'alto-total': 'Alto total', 'tiro-trasero': 'Tiro trasero' }
  ),
  traseroDer: piece('trasero-der', 'Trasero Der', 'short-trasero', {}, {}, {
    esEspejo: true,
    espejoDe: 'trasero-izq',
  }),
  cintura: piece(
    'cintura',
    'Cintura / Pretina',
    'pretina',
    { 'largo-total': 78, alto: 4 },
    { 'largo-total': 'Largo total', alto: 'Alto' }
  ),
  calzaPanelIzq: piece(
    'calza-izq',
    'Calza panel Izq',
    'calza-panel',
    { 'ancho-cadera': 28, largo: 95, 'ancho-rodilla': 20 },
    { 'ancho-cadera': 'Ancho cadera', largo: 'Largo', 'ancho-rodilla': 'Ancho rodilla' }
  ),
  calzaPanelDer: piece('calza-der', 'Calza panel Der', 'calza-panel', {}, {}, {
    esEspejo: true,
    espejoDe: 'calza-izq',
  }),
  calzaCortaPanelIzq: piece(
    'calza-corta-izq',
    'Calza corta Izq',
    'calza-panel',
    { 'ancho-cadera': 28, largo: 42, 'ancho-rodilla': 22 },
    { 'ancho-cadera': 'Ancho cadera', largo: 'Largo', 'ancho-rodilla': 'Ancho rodilla' }
  ),
  calzaCortaPanelDer: piece('calza-corta-der', 'Calza corta Der', 'calza-panel', {}, {}, {
    esEspejo: true,
    espejoDe: 'calza-corta-izq',
  }),
  capucha: piece(
    'capucha',
    'Capucha',
    'capucha',
    { 'ancho-base': 50, alto: 35 },
    { 'ancho-base': 'Ancho base', alto: 'Alto' }
  ),
  bolsilloCanguro: piece(
    'bolsillo-canguro',
    'Bolsillo canguro',
    'bolsillo-canguro',
    { ancho: 32, alto: 18 },
    { ancho: 'Ancho', alto: 'Alto' }
  ),
  pantalonDelanteroIzq: piece(
    'pantalon-del-izq',
    'Pantalón delantero Izq',
    'pantalon-delantero',
    { ancho: 30, 'alto-total': 98, 'tiro-delantero': 32 },
    { ancho: 'Ancho', 'alto-total': 'Alto total', 'tiro-delantero': 'Tiro delantero' }
  ),
  pantalonDelanteroDer: piece('pantalon-del-der', 'Pantalón delantero Der', 'pantalon-delantero', {}, {}, {
    esEspejo: true,
    espejoDe: 'pantalon-del-izq',
  }),
  pantalonTraseroIzq: piece(
    'pantalon-tras-izq',
    'Pantalón trasero Izq',
    'pantalon-trasero',
    { ancho: 32, 'alto-total': 100, 'tiro-trasero': 36 },
    { ancho: 'Ancho', 'alto-total': 'Alto total', 'tiro-trasero': 'Tiro trasero' }
  ),
  pantalonTraseroDer: piece('pantalon-tras-der', 'Pantalón trasero Der', 'pantalon-trasero', {}, {}, {
    esEspejo: true,
    espejoDe: 'pantalon-tras-izq',
  }),
  jerseyFrente: piece(
    'jersey-frente',
    'Jersey frente',
    'jersey-panel',
    { 'ancho-axila': 52, 'alto-total': 74 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total' }
  ),
  jerseyEspalda: piece(
    'jersey-espalda',
    'Jersey espalda',
    'jersey-panel',
    { 'ancho-axila': 52, 'alto-total': 76 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total' }
  ),
  egresadosFrente: piece(
    'egresados-frente',
    'Egresados frente',
    'egresados-panel',
    { 'ancho-axila': 50, 'alto-total': 72 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total' }
  ),
  egresadosEspalda: piece(
    'egresados-espalda',
    'Egresados espalda',
    'egresados-panel',
    { 'ancho-axila': 50, 'alto-total': 74 },
    { 'ancho-axila': 'Ancho (axila)', 'alto-total': 'Alto total' }
  ),
} as const satisfies Record<string, PieceTemplateDef>;

export function clonePiece(def: PieceTemplateDef): PieceTemplateDef {
  return structuredClone(def);
}

export function piecesFromKeys(keys: (keyof typeof PIECE_LIBRARY)[]): PieceTemplateDef[] {
  return keys.map((k) => clonePiece(PIECE_LIBRARY[k]));
}
