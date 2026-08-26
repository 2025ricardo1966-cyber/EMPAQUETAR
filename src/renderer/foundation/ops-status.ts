/** Mirrors operational-order.ts for the EMPAQUETAR shell (b129 cannot import contracts). */
export function operationalOf(status: string): string {
  if (status === 'pending' || status === 'received') return 'PENDIENTE';
  if (status === 'ready') return 'LISTO';
  if (status === 'completed' || status === 'delivered') return 'ENTREGADO';
  if (status === 'cancelled' || status === 'expired') return 'CANCELADO';
  return 'EN_PRODUCCION';
}

export function nextOperationalStatuses(from: string): string[] {
  if (from === 'PENDIENTE') return ['EN_PRODUCCION', 'CANCELADO'];
  if (from === 'EN_PRODUCCION') return ['LISTO', 'CANCELADO'];
  if (from === 'LISTO') return ['ENTREGADO', 'CANCELADO'];
  return [];
}
