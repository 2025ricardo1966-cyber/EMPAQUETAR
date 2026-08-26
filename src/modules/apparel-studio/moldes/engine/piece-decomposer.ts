import type {
  GarmentDecomposition,
  DecomposedSlot,
  MedidasPiezaResueltas,
  MoldeId,
  PieceSlotId,
  PieceSlotMeta,
  PieceTemplateKind,
} from '../types';

/** Catálogo de slots canónicos — orden de visualización */
export const PIECE_SLOT_REGISTRY: PieceSlotMeta[] = [
  { id: 'frente', label: 'Frente', descripcion: 'Panel delantero del cuerpo', order: 1 },
  { id: 'espalda', label: 'Espalda', descripcion: 'Panel trasero del cuerpo', order: 2 },
  {
    id: 'manga-izquierda',
    label: 'Manga izquierda',
    descripcion: 'Manga izquierda (set-in o raglan)',
    order: 3,
  },
  {
    id: 'manga-derecha',
    label: 'Manga derecha',
    descripcion: 'Manga derecha — espejo de la izquierda',
    order: 4,
  },
  { id: 'cuello', label: 'Cuello', descripcion: 'Cuello / escote', order: 5 },
  { id: 'punos', label: 'Puños', descripcion: 'Puños de manga', order: 6 },
  { id: 'pretina', label: 'Pretina', descripcion: 'Pretina / cinturilla', order: 7 },
  { id: 'capucha', label: 'Capucha', descripcion: 'Capucha', order: 8 },
  { id: 'bolsillos', label: 'Bolsillos', descripcion: 'Bolsillos aplicados', order: 9 },
  { id: 'canesu', label: 'Canesú', descripcion: 'Canesú / tapeta', order: 10 },
  {
    id: 'delantero-inferior',
    label: 'Delantero inferior',
    descripcion: 'Panel delantero (short, pantalón)',
    order: 11,
  },
  {
    id: 'trasero-inferior',
    label: 'Trasero inferior',
    descripcion: 'Panel trasero (short, pantalón)',
    order: 12,
  },
  {
    id: 'panel-lateral',
    label: 'Panel lateral',
    descripcion: 'Panel lateral (calza, pierna)',
    order: 13,
  },
];

const PIECE_ID_TO_SLOT: Record<string, PieceSlotId> = {
  frente: 'frente',
  'jersey-frente': 'frente',
  'egresados-frente': 'frente',
  espalda: 'espalda',
  'jersey-espalda': 'espalda',
  'egresados-espalda': 'espalda',
  'manga-izq': 'manga-izquierda',
  'manga-raglan-izq': 'manga-izquierda',
  'manga-der': 'manga-derecha',
  'manga-raglan-der': 'manga-derecha',
  cuello: 'cuello',
  'cuello-v': 'cuello',
  'cuello-polo': 'cuello',
  'cuello-banda-a': 'cuello',
  'cuello-banda-b': 'cuello',
  'cuello-banda-c': 'cuello',
  'puno-izq': 'punos',
  'puno-der': 'punos',
  cintura: 'pretina',
  capucha: 'capucha',
  'bolsillo-canguro': 'bolsillos',
  canesu: 'canesu',
  'delantero-izq': 'delantero-inferior',
  'delantero-der': 'delantero-inferior',
  'pantalon-del-izq': 'delantero-inferior',
  'pantalon-del-der': 'delantero-inferior',
  'trasero-izq': 'trasero-inferior',
  'trasero-der': 'trasero-inferior',
  'pantalon-tras-izq': 'trasero-inferior',
  'pantalon-tras-der': 'trasero-inferior',
  'calza-izq': 'panel-lateral',
  'calza-der': 'panel-lateral',
  'calza-corta-izq': 'panel-lateral',
  'calza-corta-der': 'panel-lateral',
};

function templateKindToSlot(kind: PieceTemplateKind): PieceSlotId | null {
  if (kind === 'panel-espalda') return 'espalda';
  if (kind.startsWith('manga-') && kind !== 'manga-puno') return 'manga-izquierda';
  if (kind.startsWith('cuello-')) return 'cuello';
  if (kind === 'manga-puno') return 'punos';
  if (kind === 'pretina') return 'pretina';
  if (kind === 'capucha') return 'capucha';
  if (kind === 'bolsillo-canguro') return 'bolsillos';
  if (kind === 'canesú') return 'canesu';
  if (kind === 'short-delantero' || kind === 'pantalon-delantero') return 'delantero-inferior';
  if (kind === 'short-trasero' || kind === 'pantalon-trasero') return 'trasero-inferior';
  if (kind === 'calza-panel') return 'panel-lateral';
  return null;
}

export function resolvePieceSlot(piece: MedidasPiezaResueltas): PieceSlotId {
  const byId = PIECE_ID_TO_SLOT[String(piece.piezaId)];
  if (byId) return byId;

  if (piece.templateKind === 'panel-frente' || piece.templateKind === 'chaleco-panel') {
    return piece.piezaNombre.toLowerCase().includes('espalda') ? 'espalda' : 'frente';
  }
  if (piece.templateKind === 'panel-espalda') return 'espalda';
  if (piece.templateKind === 'jersey-panel') {
    return String(piece.piezaId).includes('espalda') ? 'espalda' : 'frente';
  }
  if (piece.templateKind === 'egresados-panel') {
    return String(piece.piezaId).includes('espalda') ? 'espalda' : 'frente';
  }
  if (piece.templateKind === 'campera-panel' || piece.templateKind === 'rompevientos-panel') {
    return String(piece.piezaId).includes('espalda') ? 'espalda' : 'frente';
  }

  if (piece.templateKind) {
    const byKind = templateKindToSlot(piece.templateKind);
    if (byKind) {
      if (byKind === 'manga-izquierda' && piece.esEspejo) return 'manga-derecha';
      if (byKind === 'manga-izquierda' && String(piece.piezaId).includes('der')) {
        return 'manga-derecha';
      }
      if (byKind === 'delantero-inferior' && piece.esEspejo) return 'delantero-inferior';
      if (byKind === 'trasero-inferior' && piece.esEspejo) return 'trasero-inferior';
      if (byKind === 'panel-lateral' && piece.esEspejo) return 'panel-lateral';
      if (byKind === 'punos' && piece.esEspejo) return 'punos';
      return byKind;
    }
  }

  if (piece.esEspejo) return 'manga-derecha';
  return 'frente';
}

export function annotatePiecesWithSlots(
  piezas: MedidasPiezaResueltas[]
): MedidasPiezaResueltas[] {
  return piezas.map((p) => ({
    ...p,
    slotId: resolvePieceSlot(p),
  }));
}

function buildSlot(
  meta: PieceSlotMeta,
  piezas: MedidasPiezaResueltas[]
): DecomposedSlot {
  const editablePieza = piezas.find((p) => !p.esEspejo);
  return {
    slotId: meta.id,
    label: meta.label,
    descripcion: meta.descripcion,
    present: piezas.length > 0,
    piezas,
    editablePieza,
  };
}

/** Descompone automáticamente una prenda resuelta en piezas independientes por slot */
export function decomposeGarment(
  moldId: MoldeId,
  piezas: MedidasPiezaResueltas[]
): GarmentDecomposition {
  const annotated = annotatePiecesWithSlots(piezas);

  const bySlot = new Map<PieceSlotId, MedidasPiezaResueltas[]>();
  for (const piece of annotated) {
    const slot = piece.slotId ?? resolvePieceSlot(piece);
    const list = bySlot.get(slot) ?? [];
    list.push(piece);
    bySlot.set(slot, list);
  }

  const slots: DecomposedSlot[] = PIECE_SLOT_REGISTRY.map((meta) =>
    buildSlot(meta, bySlot.get(meta.id) ?? [])
  ).filter((s) => s.present);

  const piezasEditables = slots.filter((s) => s.editablePieza).length;

  return {
    moldId,
    slots,
    totalPiezas: annotated.length,
    piezasEditables,
  };
}

export function getApplicableSlotsForMold(moldId: MoldeId): PieceSlotMeta[] {
  void moldId;
  return PIECE_SLOT_REGISTRY;
}

export function findEditablePieceInSlot(slot: DecomposedSlot): MedidasPiezaResueltas | undefined {
  return slot.editablePieza;
}
