import type { MedidasPiezaResueltas, PieceSlotId } from '../../moldes/types';
import type { NotchAnchorSpec, NotchType, ProductionNotch } from '../types';
import { NOTCH_TYPES } from '../catalog/notch-types';
import {
  buildContourModel,
  nearestAnchorForPoint,
  resolveNotchAnchor,
} from './notch-geometry';

function uid(prefix: string, i: number): string {
  return `${prefix}-n${i}`;
}

function defaultTypeForVertex(
  slotId: PieceSlotId | undefined,
  vertexIndex: number,
  total: number
): NotchType {
  if (vertexIndex === 0) {
    if (slotId === 'frente' || slotId === 'espalda') return 'union-ref';
    if (slotId === 'cuello' || slotId === 'manga-izquierda' || slotId === 'manga-derecha') {
      return 'assembly-ref';
    }
    return 'double';
  }

  const mid = Math.floor(total / 2);
  if (vertexIndex === mid) return 'central';

  if (slotId === 'manga-izquierda' || slotId === 'manga-derecha') {
    if (vertexIndex >= total - 2) return 'lateral';
  }

  if (vertexIndex % 4 === 0) return 'triple';
  if (vertexIndex % 2 === 0) return 'double';
  return 'single';
}

/** Genera definiciones paramétricas de piquetes en vértices clave del contorno */
export function generateDefaultNotchAnchors(
  pieza: MedidasPiezaResueltas,
  maxNotches = 12
): NotchAnchorSpec[] {
  if (!pieza.outlinePath || pieza.esEspejo) return [];

  const contour = buildContourModel(pieza.outlinePath);
  if (!contour || contour.segmentCount < 3) return [];

  const step = Math.max(1, Math.floor(contour.segmentCount / maxNotches));
  const anchors: NotchAnchorSpec[] = [];

  for (let i = 0; i < contour.segmentCount; i += step) {
    const type = defaultTypeForVertex(pieza.slotId, i, contour.segmentCount);
    anchors.push({
      id: uid(String(pieza.piezaId), anchors.length),
      vertexIndex: i,
      tAlongSegment: 0,
      type,
      visible: true,
      label:
        type === 'union-ref'
          ? 'Unión hombro'
          : type === 'assembly-ref'
            ? 'Montaje'
            : type === 'central'
              ? 'Centro'
              : undefined,
    });
  }

  return anchors;
}

/** Convierte piquetes legacy (coordenadas absolutas) a anclajes paramétricos */
export function anchorsFromLegacyNotches(
  pieza: MedidasPiezaResueltas,
  legacy: Array<{
    id: string;
    x: number;
    y: number;
    type: NotchType;
    label?: string;
    visible?: boolean;
  }>
): NotchAnchorSpec[] {
  if (!pieza.outlinePath) return [];

  const contour = buildContourModel(pieza.outlinePath);
  if (!contour) return [];

  return legacy.map((n) => {
    const nearest = nearestAnchorForPoint(contour, n.x, n.y);
    const type = NOTCH_TYPES.includes(n.type as NotchType) ? (n.type as NotchType) : 'single';
    return {
      id: n.id,
      vertexIndex: nearest.vertexIndex,
      tAlongSegment: nearest.tAlongSegment,
      type,
      visible: n.visible ?? true,
      label: n.label,
    };
  });
}

/** Resuelve definiciones paramétricas contra la geometría actual del molde */
export function resolveNotches(
  pieza: MedidasPiezaResueltas,
  definitions: NotchAnchorSpec[]
): ProductionNotch[] {
  if (!pieza.outlinePath || pieza.esEspejo || definitions.length === 0) return [];

  const contour = buildContourModel(pieza.outlinePath);
  if (!contour) return [];

  const resolved: ProductionNotch[] = [];

  for (const anchor of definitions) {
    const geom = resolveNotchAnchor(contour, anchor);
    if (!geom) continue;

    resolved.push({
      id: anchor.id,
      type: anchor.type,
      visible: anchor.visible,
      label: anchor.label,
      x: geom.x,
      y: geom.y,
      angleDeg: geom.angleDeg,
      tangentDeg: geom.tangentDeg,
      lengthScale: anchor.lengthScale,
      pairedPiezaId: anchor.pairedPiezaId,
      pairedSlotId: anchor.pairedSlotId,
      anchor: { ...anchor },
    });
  }

  return resolved;
}

/** @deprecated Use generateDefaultNotchAnchors + resolveNotches */
export function generateNotches(pieza: MedidasPiezaResueltas, maxNotches = 12): ProductionNotch[] {
  return resolveNotches(pieza, generateDefaultNotchAnchors(pieza, maxNotches));
}

export function mergeNotchDefinitions(
  defaults: NotchAnchorSpec[],
  overrides: NotchAnchorSpec[] | undefined
): NotchAnchorSpec[] {
  if (!overrides?.length) return defaults;
  return overrides;
}

export function visibleNotchCount(notches: ProductionNotch[]): number {
  return notches.filter((n) => n.visible).length;
}
