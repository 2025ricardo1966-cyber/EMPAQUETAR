import type { OrderStatus } from './order-domain';
import { findOrderStatusPath, OrderTransitionError } from './order-lifecycle';

/** Client/admin operational cycle. Maps onto existing OrderStatus; does not replace it. */
export const OPERATIONAL_ORDER_STATUSES = ['PENDIENTE', 'EN_PRODUCCION', 'LISTO', 'ENTREGADO', 'CANCELADO'] as const;
export type OperationalOrderStatus = (typeof OPERATIONAL_ORDER_STATUSES)[number];

const OP_TRANSITIONS: Record<OperationalOrderStatus, OperationalOrderStatus[]> = {
  PENDIENTE: ['EN_PRODUCCION', 'CANCELADO'],
  EN_PRODUCCION: ['LISTO', 'CANCELADO'],
  LISTO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

const OP_TO_CORE: Record<OperationalOrderStatus, OrderStatus> = {
  PENDIENTE: 'pending',
  EN_PRODUCCION: 'production',
  LISTO: 'ready',
  ENTREGADO: 'delivered',
  CANCELADO: 'cancelled',
};

export function toOperationalStatus(status: OrderStatus): OperationalOrderStatus {
  if (status === 'pending' || status === 'received') return 'PENDIENTE';
  if (status === 'ready') return 'LISTO';
  if (status === 'completed' || status === 'delivered') return 'ENTREGADO';
  if (status === 'cancelled' || status === 'expired') return 'CANCELADO';
  return 'EN_PRODUCCION';
}

export function operationalTargetCore(op: OperationalOrderStatus): OrderStatus {
  return OP_TO_CORE[op];
}

export function canTransitionOperational(from: OperationalOrderStatus, to: OperationalOrderStatus): boolean {
  if (from === to) return true;
  return (OP_TRANSITIONS[from] || []).includes(to);
}

export function assertOperationalTransition(from: OperationalOrderStatus, to: OperationalOrderStatus): void {
  if (!canTransitionOperational(from, to)) {
    throw new OrderTransitionError(OP_TO_CORE[from], OP_TO_CORE[to]);
  }
}

export function pathToOperationalTarget(fromCore: OrderStatus, toOp: OperationalOrderStatus): OrderStatus[] {
  const target = operationalTargetCore(toOp);
  if (fromCore === target) return [];
  const path = findOrderStatusPath(fromCore, target);
  if (!path.length && fromCore !== target) {
    throw new OrderTransitionError(fromCore, target);
  }
  return path;
}
