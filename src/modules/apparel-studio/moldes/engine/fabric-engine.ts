import type { FabricDefinition, FabricId, FabricRenderProfile, FabricTextureKind } from '../types';
import { getFabricDefinition } from '../catalog/fabric-library';

function patternContent(texture: FabricTextureKind, baseColor: string): string {
  switch (texture) {
    case 'mesh-athletic':
      return `
        <rect width="8" height="8" fill="${baseColor}"/>
        <circle cx="2" cy="2" r="0.8" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.3"/>
        <circle cx="6" cy="6" r="0.8" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.3"/>
      `;
    case 'micro-weave':
      return `
        <rect width="6" height="6" fill="${baseColor}"/>
        <path d="M0 3 H6 M3 0 V6" stroke="rgba(255,255,255,0.12)" stroke-width="0.25"/>
        <path d="M0 0 L6 6 M6 0 L0 6" stroke="rgba(0,0,0,0.08)" stroke-width="0.15"/>
      `;
    case 'plain-synthetic':
      return `
        <rect width="10" height="10" fill="${baseColor}"/>
        <line x1="0" y1="5" x2="10" y2="5" stroke="rgba(255,255,255,0.08)" stroke-width="0.4"/>
        <line x1="0" y1="8" x2="10" y2="8" stroke="rgba(0,0,0,0.06)" stroke-width="0.3"/>
      `;
    case 'cotton-weave':
      return `
        <rect width="8" height="8" fill="${baseColor}"/>
        <path d="M0 0 H4 V4 H0 Z M4 4 H8 V8 H4 Z" fill="rgba(255,255,255,0.06)"/>
        <path d="M4 0 H8 V4 H4 Z M0 4 H4 V8 H0 Z" fill="rgba(0,0,0,0.05)"/>
      `;
    case 'fleece-brush':
      return `
        <rect width="4" height="12" fill="${baseColor}"/>
        <line x1="1" y1="0" x2="1" y2="12" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>
        <line x1="2.5" y1="0" x2="2.5" y2="12" stroke="rgba(0,0,0,0.08)" stroke-width="0.4"/>
      `;
    case 'polar-pile':
      return `
        <rect width="6" height="6" fill="${baseColor}"/>
        <circle cx="1.5" cy="1.5" r="0.6" fill="rgba(255,255,255,0.14)"/>
        <circle cx="4.5" cy="4.5" r="0.6" fill="rgba(255,255,255,0.1)"/>
        <circle cx="1.5" cy="4.5" r="0.5" fill="rgba(0,0,0,0.06)"/>
      `;
    case 'laminate-shell':
      return `
        <rect width="12" height="12" fill="${baseColor}"/>
        <path d="M0 6 Q6 4 12 6" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
        <path d="M0 9 Q6 7 12 9" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.4"/>
      `;
    case 'stretch-jersey':
      return `
        <rect width="10" height="10" fill="${baseColor}"/>
        <path d="M0 2 L10 4 M0 6 L10 8 M0 10 L10 12" stroke="rgba(255,255,255,0.12)" stroke-width="0.35"/>
        <path d="M2 0 L4 10 M6 0 L8 10" stroke="rgba(255,255,255,0.08)" stroke-width="0.25"/>
      `;
    case 'twill-diagonal':
      return `
        <rect width="8" height="8" fill="${baseColor}"/>
        <path d="M-2 2 L6 10 M0 0 L8 8 M2 -2 L10 6" stroke="rgba(255,255,255,0.1)" stroke-width="0.6"/>
        <path d="M-2 4 L6 12 M0 2 L8 10" stroke="rgba(0,0,0,0.07)" stroke-width="0.4"/>
      `;
    case 'ripstop-grid':
      return `
        <rect width="10" height="10" fill="${baseColor}"/>
        <path d="M0 0 H10 V10 H0 Z" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.35"/>
        <path d="M0 5 H10 M5 0 V10" stroke="rgba(255,255,255,0.1)" stroke-width="0.25"/>
        <circle cx="5" cy="5" r="0.7" fill="rgba(255,255,255,0.2)"/>
      `;
  }
}

/** Genera defs SVG paramétricos — textura, brillo y caída automáticos */
export function buildFabricRenderProfile(fabricId: FabricId): FabricRenderProfile {
  const def = getFabricDefinition(fabricId);
  const { propiedades, baseColor } = def;
  const patternId = `fabric-pattern-${fabricId}`;
  const shineId = `fabric-shine-${fabricId}`;
  const drapeId = `fabric-drape-${fabricId}`;

  const shineOpacity = propiedades.brillo / 100;
  const drapeStrength = propiedades.caida / 100;
  const fillOpacity = 0.45 + (propiedades.espesor / 100) * 0.45;
  const strokeWidthMul = 0.8 + (propiedades.espesor / 100) * 0.6;

  const strokeColor =
    propiedades.brillo > 40
      ? 'rgba(180,220,255,0.75)'
      : 'rgba(140,160,140,0.7)';

  const defsMarkup = `
    <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="8" height="8">
      ${patternContent(propiedades.textura, baseColor)}
    </pattern>
    <linearGradient id="${shineId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="white" stop-opacity="${(shineOpacity * 0.35).toFixed(3)}"/>
      <stop offset="50%" stop-color="white" stop-opacity="0"/>
      <stop offset="100%" stop-color="white" stop-opacity="${(shineOpacity * 0.12).toFixed(3)}"/>
    </linearGradient>
    <linearGradient id="${drapeId}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="${(drapeStrength * 0.35).toFixed(3)}"/>
    </linearGradient>
  `;

  return {
    fabricId,
    baseColor,
    patternId,
    fillOpacity,
    strokeColor,
    strokeWidthMul,
    brillo: propiedades.brillo,
    elasticidad: propiedades.elasticidad,
    caida: propiedades.caida,
    espesor: propiedades.espesor,
    defsMarkup,
    patternFill: `url(#${patternId})`,
    shineOpacity,
    drapeStrength,
  };
}

/** Factor de holgura según elasticidad (lycra estira más) */
export function fabricEaseFactor(fabric: FabricDefinition): number {
  return 1 - (fabric.propiedades.elasticidad / 100) * 0.08;
}

/** Offset de costura ajustado por espesor de tela */
export function fabricSeamOffsetMul(fabric: FabricDefinition): number {
  return 1 + (fabric.propiedades.espesor / 100) * 0.25;
}

export function fabricSelectionFromId(
  moldId: import('../types').MoldeId,
  fabricId: FabricId
): import('../types').FabricSelectionEntry {
  return {
    moldId,
    fabricId,
    updatedAt: new Date().toISOString(),
  };
}

const DEFAULT_FABRIC: FabricId = 'dry-fit';

export function getDefaultFabricForMolde(_moldId: import('../types').MoldeId): FabricId {
  return DEFAULT_FABRIC;
}

export function getEffectiveFabricId(
  moldId: import('../types').MoldeId,
  selections: import('../types').FabricSelectionEntry[]
): FabricId {
  const saved = selections.find((s) => s.moldId === moldId);
  return saved?.fabricId ?? getDefaultFabricForMolde(moldId);
}

export { listFabricOptions, getFabricDefinition } from '../catalog/fabric-library';
