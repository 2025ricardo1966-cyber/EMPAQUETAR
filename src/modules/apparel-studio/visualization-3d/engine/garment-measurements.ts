import type { MedidasPiezaResueltas, MoldeId } from '../../moldes/types';
import type { Garment3DMeasurements } from '../types';

const LOWER_MOLDES: MoldeId[] = [
  'short',
  'short-futbol',
  'short-ciclismo',
  'bermuda',
  'calza-corta',
  'calza-larga',
  'calza-ciclismo',
  'pantalon-deportivo',
];

function measureFromPiece(
  piezas: MedidasPiezaResueltas[],
  matchers: ((p: MedidasPiezaResueltas) => boolean)[],
  key: string,
  fallback: number
): number {
  for (const match of matchers) {
    const piece = piezas.find((p) => !p.esEspejo && match(p));
    if (!piece) continue;
    const medida = piece.medidas.find((m) => m.key === key);
    if (medida && medida.valorCm > 0) return medida.valorCm;
  }
  return fallback;
}

function hasPiece(
  piezas: MedidasPiezaResueltas[],
  matchers: ((p: MedidasPiezaResueltas) => boolean)[]
): boolean {
  return matchers.some((match) => piezas.some((p) => !p.esEspejo && match(p)));
}

/** Extrae medidas del molde resuelto para construir la malla 3D */
export function extractGarment3DMeasurements(
  moldId: MoldeId,
  piezas: MedidasPiezaResueltas[]
): Garment3DMeasurements {
  const bySlot = (slot: string) => (p: MedidasPiezaResueltas) => p.slotId === slot;
  const byId = (fragment: string) => (p: MedidasPiezaResueltas) =>
    String(p.piezaId).includes(fragment);
  const byKind = (kind: string) => (p: MedidasPiezaResueltas) =>
    p.templateKind?.includes(kind) ?? false;

  const chestWidth = measureFromPiece(
    piezas,
    [bySlot('frente'), byId('frente'), byKind('panel-frente')],
    'ancho-axila',
    49
  );

  const bodyHeight = measureFromPiece(
    piezas,
    [bySlot('frente'), byId('frente'), byKind('panel-frente')],
    'alto-total',
    71
  );

  const sleeveLength = measureFromPiece(
    piezas,
    [bySlot('manga-izquierda'), byId('manga-izq'), byId('manga')],
    'largo',
    21
  );

  const sleeveHead = measureFromPiece(
    piezas,
    [bySlot('manga-izquierda'), byId('manga-izq'), byId('manga')],
    'ancho-cabeza',
    40
  );

  const sleeveCuff = measureFromPiece(
    piezas,
    [bySlot('manga-izquierda'), byId('manga-izq'), byId('manga')],
    'ancho-puno',
    15
  );

  const legLength = measureFromPiece(
    piezas,
    [bySlot('pretina'), byId('short'), byKind('short'), byKind('pantalon')],
    'largo-total',
    measureFromPiece(piezas, [byKind('calza')], 'largo', 45)
  );

  const waistWidth = measureFromPiece(
    piezas,
    [bySlot('pretina'), byId('cintura'), byKind('pretina')],
    'ancho',
    chestWidth * 0.92
  );

  const sleeveless =
    moldId === 'musculosa' ||
    moldId === 'musculosa-deportiva' ||
    moldId === 'musculosa-gimnasio' ||
    moldId === 'pechera-deportiva' ||
    moldId === 'chaleco' ||
    moldId === 'cubremaletas' ||
    !hasPiece(piezas, [bySlot('manga-izquierda'), byId('manga-izq'), byKind('manga-')]);

  const hasHood = moldId === 'buzo' || hasPiece(piezas, [byId('capucha'), byKind('capucha')]);

  const hasLower =
    moldId === 'egresados' ||
    moldId === 'conjunto-entrenamiento' ||
    LOWER_MOLDES.includes(moldId) ||
    hasPiece(piezas, [byKind('short'), byKind('pantalon'), byKind('calza'), bySlot('pretina')]);

  const isLowerOnly = LOWER_MOLDES.includes(moldId) && !hasPiece(piezas, [bySlot('frente')]);

  return {
    chestWidth,
    bodyHeight: isLowerOnly ? legLength * 0.55 : bodyHeight,
    sleeveLength,
    sleeveHead,
    sleeveCuff,
    hasSleeves: !sleeveless,
    hasHood,
    hasLower,
    legLength,
    waistWidth,
  };
}
