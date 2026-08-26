import { RequestInvalidError } from './configuration-schema';

export type PriceDecisionStatus = 'NONE' | 'KEEP' | 'UPDATED';
export type CommercialPriceDecisionKind = 'FREEZE' | 'KEEP' | 'UPDATE';

export interface CommercialPriceLine {
  materialId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface CommercialPriceHistoryEntry {
  at: number;
  actorId: string;
  decision: CommercialPriceDecisionKind;
  previousAmount?: number;
  newAmount?: number;
  reason?: string;
  rule?: string;
}

export interface CommercialEconomicSnapshot {
  currency: string;
  capturedAt: number;
  totals: { internal: number; customer: number };
  frozen?: boolean;
  frozenAt?: number;
  validUntil?: number;
  depositAmount?: number;
  remainingAmount?: number;
  agreedAmount?: number;
  catalogRevision?: number;
  lines?: CommercialPriceLine[];
  original?: {
    agreedAmount: number;
    lines: CommercialPriceLine[];
    frozenAt: number;
    catalogRevision?: number;
  };
  history?: CommercialPriceHistoryEntry[];
  priceDecision?: {
    status: PriceDecisionStatus;
    askedAt?: number;
    decidedAt?: number;
    decidedBy?: string;
  };
}

export function assertHumanProjectName(raw: string, required: boolean): string {
  const projectName = String(raw || '').trim();
  if (!projectName) {
    if (required) throw new RequestInvalidError('PROJECT_NAME_REQUIRED');
    return '';
  }
  if (/\d/.test(projectName)) throw new RequestInvalidError('PROJECT_NAME_NO_NUMBERS');
  return projectName;
}

export const COMMERCIAL_FINISHED_STATUSES = ['ready', 'completed', 'delivered'] as const;

export function linesFromOrder(order: {
  consumptions?: Array<{
    materialId: string;
    name: string;
    unit: string;
    quantity: number;
    customerUnitPrice: number;
    calculatedCustomerAmount: number;
  }>;
}): CommercialPriceLine[] {
  return (order.consumptions || []).map((c) => ({
    materialId: c.materialId,
    name: c.name,
    unit: String(c.unit),
    quantity: Number(c.quantity),
    unitPrice: Number(c.customerUnitPrice),
    amount: Number(c.calculatedCustomerAmount),
  }));
}

export function formatCommercialDate(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function agreedOrderAmount(order: {
  totalCustomerAmount?: number;
  economicSnapshot?: CommercialEconomicSnapshot;
}): number {
  return Number(order.economicSnapshot?.agreedAmount ?? order.totalCustomerAmount ?? 0);
}

export function paymentFullySettled(agreed: number, amountPaid: number): boolean {
  const target = Number(agreed || 0);
  if (target <= 0) return false;
  return Number(amountPaid || 0) + 0.009 >= target;
}

/** Next amount the customer still owes: seña first, then the remaining balance to 100%.
 * The payment portal stays available for the whole order cycle: 50% → additional payments → 100%.
 * Omitting amountPaid after the deposit is idempotent; settling the remainder requires an explicit amount.
 */
export function nextPaymentRemaining(input: { amountDue: number; amountPaid: number; agreed: number }): number {
  const paid = Number(input.amountPaid || 0);
  const señaLeft = Math.max(0, Number(input.amountDue || 0) - paid);
  if (señaLeft > 0.009) return Math.round(señaLeft * 100) / 100;
  return Math.max(0, Math.round((Number(input.agreed || 0) - paid) * 100) / 100);
}

export function materialPriceIncreased(
  frozen: CommercialPriceLine[] | undefined,
  currentByMaterial: Record<string, number>
): boolean {
  for (const line of frozen || []) {
    const current = currentByMaterial[line.materialId];
    if (current != null && current > Number(line.unitPrice) + 0.009) return true;
  }
  return false;
}

export function evaluatePriceDecision(
  order: {
    status: string;
    dueAt: number;
    economicSnapshot?: CommercialEconomicSnapshot;
    customerName: string;
    history?: Array<{ to: string }>;
  },
  now: number,
  currentByMaterial: Record<string, number>
): {
  required: boolean;
  finished: boolean;
  expired: boolean;
  increased: boolean;
  customerName: string;
  agreedAmount?: number;
  validUntil?: number;
} {
  const snap = order.economicSnapshot;
  const finishedNow = (COMMERCIAL_FINISHED_STATUSES as readonly string[]).includes(order.status);
  const finishedInHistory = (order.history || []).some((h) =>
    (COMMERCIAL_FINISHED_STATUSES as readonly string[]).includes(h.to)
  );
  const finished = finishedNow || finishedInHistory;
  const expired = Number(order.dueAt) < now;
  const increased = materialPriceIncreased(snap?.lines, currentByMaterial);
  const decided = snap?.priceDecision?.status === 'KEEP' || snap?.priceDecision?.status === 'UPDATED';
  return {
    required: !!snap?.frozen && finished && expired && increased && !decided,
    finished,
    expired,
    increased,
    customerName: order.customerName,
    agreedAmount: snap?.agreedAmount ?? snap?.totals.customer,
    validUntil: snap?.validUntil ?? order.dueAt,
  };
}

export function productionRosterOf(
  formValues: Record<string, unknown> | undefined
): unknown {
  const production = formValues?.rosterProduction;
  if (production) return production;
  return undefined;
}
