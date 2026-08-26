/** Client-side quote for the workshop catalog. Uses catalog unit price; does not invent a consumption engine. */
export function isLinearMeterUnit(unit: string): boolean {
  const u = String(unit || '').trim().toUpperCase();
  return u === 'M' || u === 'ML' || u === 'METRO' || u === 'METROS' || u === 'M2' || u.startsWith('METRO');
}

export function catalogLineTotal(unitPrice: number, quantity: number): number {
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const p = Number(unitPrice);
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.round(p * q * 100) / 100;
}

/**
 * Consumption: if the catalog unit is already a length, quantity is the real consumption.
 * Otherwise there is no workshop consumption API — return a labeled fixture, never as production math.
 */
export function consumptionForPilot(unit: string, quantity: number): { value: number; unit: string; source: 'catalog' | 'fixture' } {
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  if (isLinearMeterUnit(unit)) return { value: q, unit, source: 'catalog' };
  return { value: Math.round(q * 0.35 * 100) / 100, unit: 'm', source: 'fixture' };
}
