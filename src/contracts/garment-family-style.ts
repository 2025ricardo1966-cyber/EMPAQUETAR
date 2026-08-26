import { RequestInvalidError } from './configuration-schema';
import type { GarmentType } from './order-configuration-domain';

/** IDs alineados con Apparel Studio (collar-system / sleeve-system / fabric). Cloud no importa modules/. */
export const COLLAR_IDS = [
  'cuello-redondo',
  'cuello-v',
  'cuello-polo',
  'media-polera',
  'polera',
  'mao',
  'baseball',
  'rib',
  'con-cierre',
  'con-botones',
  'combinado',
  'bicolor',
  'tricolor',
  'personalizado',
] as const;
export type OrderCollarId = (typeof COLLAR_IDS)[number];

export const SLEEVE_IDS = [
  'manga-corta',
  'manga-larga',
  'manga-tres-cuartos',
  'ranglan',
  'sin-mangas',
  'con-puno',
  'con-elastico',
  'con-cierre',
] as const;
export type OrderSleeveId = (typeof SLEEVE_IDS)[number];

export const FABRIC_IDS = [
  'dry-fit',
  'microfibra',
  'poliester',
  'algodon',
  'frisa',
  'polar',
  'softshell',
  'lycra',
  'gabardina',
  'ripstop',
] as const;
export type OrderFabricId = (typeof FABRIC_IDS)[number];

export interface FamilySlotColor {
  fillColor?: string;
  trimColor?: string;
}

export interface FamilyStyleConfig {
  collarId?: OrderCollarId;
  sleeveId?: OrderSleeveId;
  fabricId?: OrderFabricId;
  colors?: {
    primary?: string;
    secondary?: string;
    slots?: Record<string, FamilySlotColor>;
  };
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function familyStyleOptions() {
  return {
    CAMISETA: {
      supportsCollar: true,
      supportsSleeve: true,
      collars: [...COLLAR_IDS],
      sleeves: [...SLEEVE_IDS],
      fabrics: [...FABRIC_IDS],
    },
    SHORT: {
      supportsCollar: false,
      supportsSleeve: false,
      collars: [] as OrderCollarId[],
      sleeves: [] as OrderSleeveId[],
      fabrics: [...FABRIC_IDS],
    },
  };
}

export function defaultFamilyStyle(garmentType: GarmentType): FamilyStyleConfig {
  if (garmentType === 'SHORT') return { fabricId: 'dry-fit' };
  return { collarId: 'cuello-redondo', sleeveId: 'manga-corta', fabricId: 'dry-fit' };
}

export function assertFamilyStyle(garmentType: GarmentType, raw: Record<string, unknown>): FamilyStyleConfig {
  const options = familyStyleOptions()[garmentType];
  const next: FamilyStyleConfig = { ...defaultFamilyStyle(garmentType) };
  if (raw.collarId != null && String(raw.collarId).trim()) {
    const id = String(raw.collarId) as OrderCollarId;
    if (!options.supportsCollar) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
    if (!(COLLAR_IDS as readonly string[]).includes(id)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
    next.collarId = id;
  } else if (!options.supportsCollar) {
    delete next.collarId;
  }
  if (raw.sleeveId != null && String(raw.sleeveId).trim()) {
    const id = String(raw.sleeveId) as OrderSleeveId;
    if (!options.supportsSleeve) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
    if (!(SLEEVE_IDS as readonly string[]).includes(id)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
    next.sleeveId = id;
  } else if (!options.supportsSleeve) {
    delete next.sleeveId;
  }
  if (raw.fabricId != null && String(raw.fabricId).trim()) {
    const id = String(raw.fabricId) as OrderFabricId;
    if (!(FABRIC_IDS as readonly string[]).includes(id)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
    next.fabricId = id;
  }
  const colors = (raw.colors || {}) as Record<string, unknown>;
  if (colors.primary || colors.secondary || colors.slots) {
    next.colors = {};
    if (colors.primary != null) {
      const c = String(colors.primary);
      if (!HEX.test(c)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
      next.colors.primary = c;
    }
    if (colors.secondary != null) {
      const c = String(colors.secondary);
      if (!HEX.test(c)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
      next.colors.secondary = c;
    }
    if (colors.slots && typeof colors.slots === 'object') {
      next.colors.slots = {};
      for (const [slot, spec] of Object.entries(colors.slots as Record<string, FamilySlotColor>)) {
        const fill = spec?.fillColor ? String(spec.fillColor) : undefined;
        const trim = spec?.trimColor ? String(spec.trimColor) : undefined;
        if (fill && !HEX.test(fill)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
        if (trim && !HEX.test(trim)) throw new RequestInvalidError('GARMENT_STYLE_INCOMPATIBLE');
        next.colors.slots[slot] = { fillColor: fill, trimColor: trim };
      }
    }
  }
  return next;
}

export function moldeIdForFamily(garmentType: GarmentType): string | undefined {
  if (garmentType === 'CAMISETA') return 'camiseta';
  if (garmentType === 'SHORT') return 'short';
  return undefined;
}
