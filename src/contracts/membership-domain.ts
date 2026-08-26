/** ORA trial: 7 days, max 5 orders. Not a new commercial invention. */
export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const TRIAL_MAX_ORDERS = 5;

export const MEMBERSHIP_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  TRIAL: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED'],
  EXPIRED: ['ACTIVE'],
};

export type MembershipPlanId = 'TRIAL' | 'STANDARD';

export interface Membership {
  id: string;
  tenantId: string;
  customerId: string;
  planId: MembershipPlanId | string;
  currency?: string;
  status: MembershipStatus;
  startedAt: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export class MembershipRestrictedError extends Error {
  readonly code: 'MEMBERSHIP_REQUIRED' | 'MEMBERSHIP_EXPIRED' | 'MEMBERSHIP_SUSPENDED' | 'TRIAL_ORDER_LIMIT';
  constructor(code: MembershipRestrictedError['code']) {
    super(code);
    this.name = 'MembershipRestrictedError';
    this.code = code;
  }
}

export function canTransitionMembership(from: MembershipStatus, to: MembershipStatus): boolean {
  if (from === to) return true;
  return (MEMBERSHIP_TRANSITIONS[from] || []).includes(to);
}

export function effectiveMembershipStatus(row: Membership, now = Date.now()): MembershipStatus {
  if (row.status === 'SUSPENDED') return 'SUSPENDED';
  if (row.status === 'EXPIRED') return 'EXPIRED';
  if ((row.status === 'TRIAL' || row.status === 'ACTIVE') && now >= row.expiresAt) return 'EXPIRED';
  return row.status;
}
