/** Core risk scoring (packages/core equivalent: this repo compiles contracts as core). */
export const RISK_LEVELS = ['RIESGO_0', 'RIESGO_1', 'RIESGO_2', 'RIESGO_3', 'RIESGO_4'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DEFAULT_WINDOW_MINUTES = 15;
export const DEFAULT_BLOCK_MINUTES = 15;
export const BLOCK_DURATION_MINUTES = [5, 15, 30, 60, 360, 1440] as const;

export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

export function maxRisk(levels: RiskLevel[]): RiskLevel {
  let best: RiskLevel = 'RIESGO_0';
  for (const level of levels) {
    if (riskRank(level) > riskRank(best)) best = level;
  }
  return best;
}

export function failedAuthRisk(
  failedCount: number,
  unknownAccountHits: number,
  thresholds: { r1?: number; r2?: number; r3?: number } = {}
): RiskLevel {
  const r1 = thresholds.r1 ?? 3;
  const r2 = thresholds.r2 ?? 5;
  const r3 = thresholds.r3 ?? 10;
  if (failedCount >= r3 || unknownAccountHits >= r3) return 'RIESGO_3';
  if (failedCount >= r2) return 'RIESGO_2';
  if (failedCount >= r1) return 'RIESGO_1';
  return 'RIESGO_0';
}

export function authorizationRisk(input: {
  clientHitAdmin: boolean;
  accessDeniedCount: number;
  crossTenantAttempt: boolean;
}): RiskLevel {
  if (input.crossTenantAttempt) return 'RIESGO_3';
  if (input.accessDeniedCount >= 3) return 'RIESGO_2';
  if (input.clientHitAdmin) return 'RIESGO_1';
  return 'RIESGO_0';
}

export function manipulationRisk(input: {
  membershipWithoutPerm: boolean;
  pricingOrPermissionsWithoutPerm: boolean;
  outOfRoleMutations: number;
}): RiskLevel {
  if (input.outOfRoleMutations >= 3) return 'RIESGO_4';
  if (input.pricingOrPermissionsWithoutPerm) return 'RIESGO_3';
  if (input.membershipWithoutPerm) return 'RIESGO_2';
  return 'RIESGO_0';
}

export function abuseRisk(input: { requestCount: number; volumeThreshold: number; distinctNotFound: number; enumThreshold: number }): RiskLevel {
  if (input.distinctNotFound >= input.enumThreshold) return 'RIESGO_3';
  if (input.requestCount >= input.volumeThreshold) return 'RIESGO_2';
  return 'RIESGO_0';
}

export function pruneWindow<T extends { at: number }>(rows: T[], now: number, windowMs: number): T[] {
  const from = now - windowMs;
  return rows.filter((r) => r.at >= from);
}

export function isSensitiveMembershipPath(path: string): boolean {
  return /\/membership\b/.test(path) || /\/trial\b/.test(path);
}

export function isSensitivePricingOrPermPath(path: string): boolean {
  return (
    /\/config\/commercial/.test(path) ||
    /\/permissions/.test(path) ||
    path === '/users' ||
    /\/users\/[^/]+\/(permissions|role)/.test(path)
  );
}

export function looksLikeResourceEnum(path: string): boolean {
  return /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(path) || /\/ord_[a-z0-9_]+/i.test(path);
}
