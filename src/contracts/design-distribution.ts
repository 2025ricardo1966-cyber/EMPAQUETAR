import { RequestInvalidError } from './configuration-schema';
import type { FamilyStyleConfig } from './garment-family-style';
import {
  findSizeLabel,
  isGarmentType,
  parseGarmentType,
  type GarmentType,
  type SizeTableSnapshot,
} from './order-configuration-domain';
import type { RosterRecord } from './roster-intake';

/**
 * Motor de distribución masiva EMPAQUETAR: un diseño → un pedido → N familias/talles/unidades.
 * Independiente de TenantLimits.maxUnitsPerOrder (ese tope es solo del alta inicial).
 */
export const DESIGN_DISTRIBUTION_INFRA_CAP = 50_000;

export interface GarmentFamilyConfig {
  garmentType: GarmentType;
  sizeTableId: string;
  sizeTableSnapshot: SizeTableSnapshot;
  moldeId?: string;
  style?: FamilyStyleConfig;
}

export interface DesignDistributionUnit {
  index: number;
  recordIndex: number;
  name: string;
  number: string;
  sizeLabel: string;
  garmentType: GarmentType;
  quantity: number;
  sizeTableId: string;
  designKey: string;
}

export interface DesignDistributionFamily {
  garmentType: GarmentType;
  sizeTableId: string;
  sizeTableSnapshot: SizeTableSnapshot;
  units: number;
  bySize: Record<string, number>;
}

export interface DesignDistribution {
  designKey: string;
  designFileId?: string;
  selectedGarmentTypes: GarmentType[];
  families: DesignDistributionFamily[];
  records: DesignDistributionUnit[];
  totalUnits: number;
  recordCount: number;
  integrity: {
    recordCount: number;
    totalUnits: number;
    uniqueKeys: number;
    lost: number;
    duplicates: number;
  };
}

export function recordIdentity(rec: {
  name?: string;
  number?: string;
  size?: string;
  sizeLabel?: string;
  garmentType?: string;
}): string {
  return [
    String(rec.name || '').trim().toUpperCase(),
    String(rec.number || '').trim().toUpperCase(),
    String(rec.sizeLabel || rec.size || '').trim().toUpperCase(),
    String(rec.garmentType || '').trim().toUpperCase(),
  ].join('|');
}

export function rosterRowQuantity(rec: RosterRecord): number {
  if (rec.quantity != null && rec.quantity !== ('' as unknown as number)) {
    const n = Number(rec.quantity);
    if (!Number.isFinite(n) || n <= 0) throw new RequestInvalidError('INVALID_QUANTITY');
    return Math.floor(n);
  }
  const extra = rec.extras?.cantidad || rec.extras?.quantity || rec.extras?.cant || rec.extras?.qty;
  if (extra != null && String(extra).trim() !== '') {
    const fromExtra = Number(extra);
    if (!Number.isFinite(fromExtra) || fromExtra <= 0) throw new RequestInvalidError('INVALID_QUANTITY');
    return Math.floor(fromExtra);
  }
  return 1;
}

export function resolveRecordGarment(
  rec: RosterRecord,
  selected: GarmentType[]
): GarmentType {
  const raw = rec.garmentType || rec.extras?.prenda || rec.extras?.garment || rec.extras?.producto || '';
  const parsed = parseGarmentType(String(raw));
  if (parsed) {
    if (selected.length && !selected.includes(parsed)) throw new RequestInvalidError('GARMENT_NOT_SELECTED');
    return parsed;
  }
  if (selected.length === 1) return selected[0];
  throw new RequestInvalidError('GARMENT_REQUIRED');
}

export function selectedGarmentTypesOf(formValues: Record<string, unknown> | undefined): GarmentType[] {
  const raw = formValues?.selectedGarmentTypes;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((v) => parseGarmentType(String(v))).filter((v): v is GarmentType => !!v))];
  }
  const single = parseGarmentType(String(formValues?.garmentType || ''));
  return single ? [single] : [];
}

export function assertRosterFitsInfrastructure(recordCount: number, totalUnits: number) {
  if (recordCount > DESIGN_DISTRIBUTION_INFRA_CAP || totalUnits > DESIGN_DISTRIBUTION_INFRA_CAP) {
    throw new RequestInvalidError('ROSTER_TOO_LARGE');
  }
}

export function distributeDesign(input: {
  records: RosterRecord[];
  families: GarmentFamilyConfig[];
  selectedGarmentTypes: GarmentType[];
  designKey: string;
  designFileId?: string;
}): DesignDistribution {
  for (const rec of input.records) {
    const empty = !String(rec.name || '').trim() && !String(rec.size || rec.sizeLabel || '').trim();
    const hasData =
      !!String(rec.number || '').trim() ||
      !!String(rec.garmentType || '').trim() ||
      rec.quantity != null ||
      Object.keys(rec.extras || {}).length > 0;
    if (empty && hasData) throw new RequestInvalidError('ORPHAN_ROW');
  }
  const usable = input.records.filter((r) => String(r.name || '').trim() || String(r.size || r.sizeLabel || '').trim());
  if (usable.length > DESIGN_DISTRIBUTION_INFRA_CAP) throw new RequestInvalidError('ROSTER_TOO_LARGE');
  const selected = (input.selectedGarmentTypes.filter(isGarmentType).length
    ? input.selectedGarmentTypes.filter(isGarmentType)
    : inferSelected(usable));
  const familyByType = new Map(input.families.map((f) => [f.garmentType, f]));

  const seen = new Set<string>();
  const units: DesignDistributionUnit[] = [];
  let totalUnits = 0;

  usable.forEach((rec, recordIndex) => {
    const garmentType = resolveRecordGarment(rec, selected);
    const family = familyByType.get(garmentType);
    if (!family) throw new RequestInvalidError('SIZE_TABLE_REQUIRED');
    const sizeLabel = String(rec.sizeLabel || rec.size || '').trim();
    if (sizeLabel && !findSizeLabel(family.sizeTableSnapshot, sizeLabel)) throw new RequestInvalidError('SIZE_NOT_FOUND');
    const quantity = rosterRowQuantity(rec);
    const key = recordIdentity({ ...rec, sizeLabel, garmentType });
    if (seen.has(key)) throw new RequestInvalidError('DUPLICATE_ROSTER_ROW');
    seen.add(key);
    totalUnits += quantity;
    units.push({
      index: units.length,
      recordIndex,
      name: rec.name || '',
      number: rec.number || '',
      sizeLabel,
      garmentType,
      quantity,
      sizeTableId: family.sizeTableId,
      designKey: input.designKey,
    });
  });

  assertRosterFitsInfrastructure(units.length, totalUnits);
  for (const type of selected) {
    if (!units.some((u) => u.garmentType === type)) throw new RequestInvalidError('FAMILY_WITHOUT_UNITS');
  }

  const families: DesignDistributionFamily[] = input.families
    .filter((f) => selected.length === 0 || selected.includes(f.garmentType) || units.some((u) => u.garmentType === f.garmentType))
    .map((f) => {
      const mine = units.filter((u) => u.garmentType === f.garmentType);
      const bySize: Record<string, number> = {};
      let familyUnits = 0;
      for (const u of mine) {
        bySize[u.sizeLabel] = (bySize[u.sizeLabel] || 0) + u.quantity;
        familyUnits += u.quantity;
      }
      return {
        garmentType: f.garmentType,
        sizeTableId: f.sizeTableId,
        sizeTableSnapshot: f.sizeTableSnapshot,
        units: familyUnits,
        bySize,
      };
    });

  return {
    designKey: input.designKey,
    designFileId: input.designFileId,
    selectedGarmentTypes: selected.length ? selected : [...new Set(units.map((u) => u.garmentType))],
    families,
    records: units,
    totalUnits,
    recordCount: units.length,
    integrity: {
      recordCount: units.length,
      totalUnits,
      uniqueKeys: seen.size,
      lost: Math.max(0, usable.length - units.length),
      duplicates: 0,
    },
  };
}

function inferSelected(records: RosterRecord[]): GarmentType[] {
  const found = new Set<GarmentType>();
  for (const rec of records) {
    const parsed = parseGarmentType(String(rec.garmentType || rec.extras?.prenda || rec.extras?.garment || ''));
    if (parsed) found.add(parsed);
  }
  return [...found];
}

export function assertDistributionIntegrity(dist: DesignDistribution, sourceCount: number) {
  if (dist.integrity.lost !== 0) throw new RequestInvalidError('ROSTER_RECORD_LOST');
  if (dist.integrity.duplicates !== 0) throw new RequestInvalidError('DUPLICATE_ROSTER_ROW');
  if (dist.recordCount !== dist.records.length) throw new RequestInvalidError('ROSTER_RECORD_LOST');
  if (dist.integrity.uniqueKeys !== dist.recordCount) throw new RequestInvalidError('DUPLICATE_ROSTER_ROW');
  const summed = dist.records.reduce((s, r) => s + r.quantity, 0);
  if (summed !== dist.totalUnits) throw new RequestInvalidError('ROSTER_TOTAL_MISMATCH');
  const familySum = dist.families.reduce((s, f) => s + f.units, 0);
  if (familySum !== dist.totalUnits) throw new RequestInvalidError('ROSTER_TOTAL_MISMATCH');
  if (sourceCount !== dist.recordCount) throw new RequestInvalidError('ROSTER_RECORD_LOST');
}
