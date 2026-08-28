import type { MoldeDefinition, MoldeId } from '../types';
import { piecesFromKeys } from './piece-library';

/**
 * Catálogo universal de moldes — cada prenda = conjunto de piezas paramétricas independientes.
 * Sin imágenes planas. Medidas base @ talle M (adulto).
 */
export const MOLD_CATALOG: MoldeDefinition[] = [
  {
    id: 'remera-cuello-redondo',
    nombre: 'Remera cuello redondo',
    categoria: 'superior',
    descripcion: 'Remera básica con cuello redondo y manga set-in.',
    extraPieces: piecesFromKeys(['frente', 'espalda', 'mangaIzq', 'mangaDer', 'cuelloRedondo']),
  },
  {
    id: 'remera-cuello-v',
    nombre: 'Remera cuello V',
    categoria: 'superior',
    descripcion: 'Remera con escote en V.',
    extends: 'remera-cuello-redondo',
    omitPieceIds: ['cuello'],
    extraPieces: piecesFromKeys(['cuelloV']),
  },
  {
    id: 'remera-raglan',
    nombre: 'Remera raglan',
    categoria: 'superior',
    descripcion: 'Remera con manga raglan.',
    extends: 'remera-cuello-redondo',
    omitPieceIds: ['manga-izq', 'manga-der'],
    extraPieces: piecesFromKeys(['mangaRaglanIzq', 'mangaRaglanDer']),
  },
  {
    id: 'chomba-clasica',
    nombre: 'Chomba clásica',
    categoria: 'superior',
    descripcion: 'Polo clásico con cuello y canesú.',
    extraPieces: piecesFromKeys([
      'frente',
      'espalda',
      'mangaIzq',
      'mangaDer',
      'cuelloPolo',
      'canesu',
    ]),
  },
  {
    id: 'chomba-deportiva',
    nombre: 'Chomba deportiva',
    categoria: 'deporte',
    descripcion: 'Polo deportivo ajustado.',
    extends: 'chomba-clasica',
    pieceOverrides: {
      frente: { 'ancho-axila': 51, 'alto-total': 69 },
    },
  },
  {
    id: 'musculosa',
    nombre: 'Musculosa',
    categoria: 'superior',
    descripcion: 'Musculosa sin mangas.',
    extends: 'remera-cuello-redondo',
    omitPieceIds: ['manga-izq', 'manga-der'],
  },
  {
    id: 'calza-corta',
    nombre: 'Calza corta',
    categoria: 'inferior',
    descripcion: 'Calza corta deportiva.',
    extraPieces: piecesFromKeys(['calzaCortaPanelIzq', 'calzaCortaPanelDer', 'cintura']),
  },
  {
    id: 'calza-larga',
    nombre: 'Calza larga',
    categoria: 'inferior',
    descripcion: 'Calza larga deportiva.',
    extraPieces: piecesFromKeys(['calzaPanelIzq', 'calzaPanelDer', 'cintura']),
  },
  {
    id: 'short',
    nombre: 'Short deportivo',
    categoria: 'inferior',
    descripcion: 'Short clásico (M1 legacy compatible).',
    extraPieces: piecesFromKeys([
      'delanteroIzq',
      'delanteroDer',
      'traseroIzq',
      'traseroDer',
      'cintura',
    ]),
  },
  {
    id: 'bermuda',
    nombre: 'Bermuda',
    categoria: 'inferior',
    descripcion: 'Bermuda más larga que el short.',
    extends: 'short',
    pieceOverrides: {
      'delantero-izq': { 'alto-total': 58, 'tiro-delantero': 32 },
      'trasero-izq': { 'alto-total': 60, 'tiro-trasero': 36 },
    },
  },
  {
    id: 'campera',
    nombre: 'Campera',
    categoria: 'abrigo',
    descripcion: 'Campera con mangas y cierre frontal.',
    extraPieces: piecesFromKeys(['frente', 'espalda', 'mangaIzq', 'mangaDer', 'cuelloRedondo']),
    pieceOverrides: {
      frente: { 'alto-total': 68, 'ancho-axila': 54 },
      espalda: { 'alto-total': 70, 'ancho-axila': 54 },
    },
  },
  {
    id: 'buzo',
    nombre: 'Buzo',
    categoria: 'abrigo',
    descripcion: 'Buzo con capucha.',
    extraPieces: piecesFromKeys([
      'frente',
      'espalda',
      'mangaIzq',
      'mangaDer',
      'capucha',
      'cuelloRedondo',
    ]),
    pieceOverrides: {
      frente: { 'alto-total': 72 },
      espalda: { 'alto-total': 74 },
    },
  },
  {
    id: 'canguro',
    nombre: 'Canguro',
    categoria: 'abrigo',
    descripcion: 'Buzo con bolsillo canguro.',
    extends: 'buzo',
    extraPieces: piecesFromKeys(['bolsilloCanguro']),
  },
  {
    id: 'chaleco',
    nombre: 'Chaleco',
    categoria: 'abrigo',
    descripcion: 'Chaleco sin mangas.',
    extraPieces: piecesFromKeys(['frente', 'espalda', 'cuelloRedondo']),
    pieceOverrides: {
      frente: { 'alto-total': 65 },
      espalda: { 'alto-total': 67 },
    },
  },
  {
    id: 'pantalon-deportivo',
    nombre: 'Pantalón deportivo',
    categoria: 'inferior',
    descripcion: 'Pantalón largo deportivo.',
    extraPieces: piecesFromKeys([
      'pantalonDelanteroIzq',
      'pantalonDelanteroDer',
      'pantalonTraseroIzq',
      'pantalonTraseroDer',
      'cintura',
    ]),
  },
  {
    id: 'rompevientos',
    nombre: 'Rompevientos',
    categoria: 'abrigo',
    descripcion: 'Rompevientos ligero.',
    extends: 'campera',
    pieceOverrides: {
      frente: { 'ancho-axila': 56, 'alto-total': 70 },
      'manga-izq': { largo: 24 },
    },
  },
  {
    id: 'camiseta-futbol',
    nombre: 'Camiseta de fútbol',
    categoria: 'deporte',
    descripcion: 'Camiseta de fútbol con manga corta.',
    extraPieces: piecesFromKeys(['jerseyFrente', 'jerseyEspalda', 'mangaIzq', 'mangaDer', 'cuelloV']),
    pieceOverrides: {
      'manga-izq': { largo: 18 },
    },
  },
  {
    id: 'camiseta-basket',
    nombre: 'Camiseta de básquet',
    categoria: 'deporte',
    descripcion: 'Camiseta amplia de básquet.',
    extends: 'camiseta-futbol',
    pieceOverrides: {
      'jersey-frente': { 'ancho-axila': 58, 'alto-total': 78 },
      'jersey-espalda': { 'ancho-axila': 58, 'alto-total': 80 },
    },
  },
  {
    id: 'camiseta-voley',
    nombre: 'Camiseta de vóley',
    categoria: 'deporte',
    descripcion: 'Camiseta de vóley ajustada.',
    extends: 'camiseta-futbol',
    pieceOverrides: {
      'jersey-frente': { 'ancho-axila': 50, 'alto-total': 70 },
    },
  },
  {
    id: 'camiseta-rugby',
    nombre: 'Camiseta de rugby',
    categoria: 'deporte',
    descripcion: 'Camiseta robusta de rugby.',
    extends: 'camiseta-futbol',
    pieceOverrides: {
      'jersey-frente': { 'ancho-axila': 56, 'alto-total': 76 },
      'manga-izq': { largo: 22, 'ancho-cabeza': 44 },
    },
  },
  {
    id: 'conjunto-entrenamiento',
    nombre: 'Conjunto de entrenamiento',
    categoria: 'conjunto',
    descripcion: 'Remera + short de entrenamiento.',
    compuestoDe: ['remera-cuello-redondo', 'short'],
  },
  {
    id: 'egresados',
    nombre: 'Prendas para egresados',
    categoria: 'egresados',
    descripcion: 'Conjunto superior e inferior para egresados.',
    extraPieces: piecesFromKeys([
      'egresadosFrente',
      'egresadosEspalda',
      'mangaIzq',
      'mangaDer',
      'cuelloRedondo',
      'pantalonDelanteroIzq',
      'pantalonDelanteroDer',
      'pantalonTraseroIzq',
      'pantalonTraseroDer',
      'cintura',
    ]),
  },
  /** Legacy M1 — alias explícito */
  {
    id: 'camiseta',
    nombre: 'Camiseta deportiva (legacy M1)',
    categoria: 'deporte',
    descripcion: 'Alias M1 — equivalente a remera cuello redondo.',
    extends: 'remera-cuello-redondo',
  },
  {
    id: 'remera-manga-corta',
    nombre: 'Remera manga corta',
    categoria: 'superior',
    descripcion: 'Remera manga corta — alias paramétrico de cuello redondo.',
    extends: 'remera-cuello-redondo',
  },
  {
    id: 'remera-manga-larga',
    nombre: 'Remera manga larga',
    categoria: 'superior',
    descripcion: 'Remera manga larga — reutiliza molde de cuello redondo.',
    extends: 'remera-cuello-redondo',
  },
  {
    id: 'musculosa-deportiva',
    nombre: 'Musculosa deportiva',
    categoria: 'deporte',
    descripcion: 'Musculosa deportiva.',
    extends: 'musculosa',
  },
  {
    id: 'musculosa-gimnasio',
    nombre: 'Musculosa de gimnasio',
    categoria: 'deporte',
    descripcion: 'Musculosa de gimnasio.',
    extends: 'musculosa',
  },
  {
    id: 'remera-entrenamiento',
    nombre: 'Remera de entrenamiento',
    categoria: 'deporte',
    descripcion: 'Remera de entrenamiento.',
    extends: 'remera-cuello-redondo',
  },
  {
    id: 'camiseta-running',
    nombre: 'Camiseta de running',
    categoria: 'deporte',
    descripcion: 'Camiseta de running.',
    extends: 'camiseta-futbol',
  },
  {
    id: 'camiseta-ciclismo',
    nombre: 'Camiseta de ciclismo',
    categoria: 'deporte',
    descripcion: 'Camiseta de ciclismo.',
    extends: 'camiseta-futbol',
  },
  {
    id: 'calza-ciclismo',
    nombre: 'Calza de ciclismo',
    categoria: 'deporte',
    descripcion: 'Calza de ciclismo.',
    extends: 'calza-corta',
  },
  {
    id: 'short-futbol',
    nombre: 'Short de fútbol',
    categoria: 'deporte',
    descripcion: 'Short de fútbol — molde explícito, distinto del short deportivo.',
    extends: 'short',
  },
  {
    id: 'short-ciclismo',
    nombre: 'Short de ciclismo',
    categoria: 'deporte',
    descripcion: 'Short de ciclismo.',
    extends: 'short',
  },
  {
    id: 'pechera-deportiva',
    nombre: 'Pechera deportiva',
    categoria: 'deporte',
    descripcion: 'Pechera deportiva.',
    extends: 'musculosa',
  },
  {
    id: 'cubremaletas',
    nombre: 'Cubremaletas',
    categoria: 'abrigo',
    descripcion: 'Cubremaletas — volumen de cobertura, sin medidas inventadas.',
    extends: 'chaleco',
  },
];

const CATALOG_MAP = new Map<MoldeId, MoldeDefinition>(
  MOLD_CATALOG.map((m) => [m.id, m])
);

export function getMoldeDefinition(id: MoldeId): MoldeDefinition | undefined {
  return CATALOG_MAP.get(id);
}

export function listCatalogMoldes(): MoldeDefinition[] {
  return [...MOLD_CATALOG];
}

export function listCatalogSummaries() {
  return MOLD_CATALOG.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    categoria: m.categoria,
    descripcion: m.descripcion,
    pieceCount: resolvePieceTemplates(m.id).length,
  }));
}

/** Resuelve herencia y composición → lista final de piezas */
export function resolvePieceTemplates(moldId: MoldeId): import('../types').PieceTemplateDef[] {
  const def = CATALOG_MAP.get(moldId);
  if (!def) return [];

  if (def.compuestoDe?.length) {
    const seen = new Set<string>();
    const out: import('../types').PieceTemplateDef[] = [];
    for (const subId of def.compuestoDe) {
      for (const p of resolvePieceTemplates(subId)) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(structuredClone(p));
        }
      }
    }
    return out;
  }

  let pieces: import('../types').PieceTemplateDef[] = [];

  if (def.extends) {
    pieces = resolvePieceTemplates(def.extends);
  }

  if (def.omitPieceIds?.length) {
    const omit = new Set(def.omitPieceIds);
    pieces = pieces.filter((p) => !omit.has(p.id));
  }

  if (def.extraPieces?.length) {
    pieces = [...pieces, ...def.extraPieces.map((p) => structuredClone(p))];
  }

  if (def.pieceOverrides) {
    pieces = pieces.map((p) => {
      const ov = def.pieceOverrides?.[p.id];
      if (!ov) return p;
      const medidasBase = { ...p.medidasBase };
      for (const [key, value] of Object.entries(ov)) {
        if (value !== undefined) medidasBase[key] = value;
      }
      return { ...p, medidasBase };
    });
  }

  return pieces;
}
