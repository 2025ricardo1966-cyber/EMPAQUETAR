import { MESSAGE_STATUSES } from './client-message-domain';
import { MEMBERSHIP_STATUSES, MEMBERSHIP_TRANSITIONS } from './membership-domain';
import { OPERATIONAL_ORDER_STATUSES } from './operational-order';

/** B1-52 — explicit machines. Existing ClientMessage/OrderStatus remain canonical. */
export const LIFECYCLE = {
  membership: {
    initial: 'TRIAL',
    terminal: ['EXPIRED'],
    statuses: MEMBERSHIP_STATUSES,
    transitions: MEMBERSHIP_TRANSITIONS,
  },
  communication: {
    initial: 'NEW',
    terminal: ['RESOLVED'],
    statuses: MESSAGE_STATUSES,
  },
  operationalOrder: {
    initial: 'PENDIENTE',
    terminal: ['ENTREGADO', 'CANCELADO'],
    statuses: OPERATIONAL_ORDER_STATUSES,
  },
} as const;

export function membershipAllowsOrders(status: string): boolean {
  return status === 'TRIAL' || status === 'ACTIVE';
}

export function communicationOnClosedOrder(orderOp: string): 'allow_read' | 'allow_new' {
  if (orderOp === 'CANCELADO' || orderOp === 'ENTREGADO') return 'allow_read';
  return 'allow_new';
}
