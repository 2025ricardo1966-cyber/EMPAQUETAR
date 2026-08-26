# B1-22 — Workspace del taller

## Endpoints (además del tablero B1-17)

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/workspace/orders` | `orders.view` — `items[]` B1-22 + `page` B1-17 |
| GET | `/workspace/orders/:id` | detalle enriquecido |
| PUT | `/workspace/orders/:id/status` | `orders.edit` |
| POST | `/workspace/orders/:id/assign` | `orders.edit` |
| GET/POST | `/workspace/orders/:id/comments` | staff (`orders.view`) |
| GET | `/workspace/orders/:id/files` | lista + conversión |
| POST | `/workspace/orders/:id/files/:id/convert` | CDR→PDF, `orders.edit` |
| GET | `/workspace/orders/:id/files/:id/color-profile` | paleta heurística |
| PUT | `/workspace/orders/:id/files/:id/status` | VALIDATED/REJECTED |
| GET/POST | `/workspace/orders/:id/payment` | montos si `costs.view` |
| GET | `/workspace/customers` | `customers.view` / `clients.view` |
| POST | `/workspace/customers/:id/trust-code` | ADMIN_PRINCIPAL |

Vencimiento (`deadlineStatus`) y `status` son independientes. `OVERDUE` no cambia el estado operativo. La lista del workspace usa `peekOrders` (no persiste `expired` al listar) y expone `operationalOrderStatus` para que `PRODUCTION + OVERDUE` coexistan.

## CDR→PDF

Proceso backend (`CdrConversion`): extrae paleta por heurística del binario, genera PDF derivado en blob aparte. El CDR original (`storageKey` / `file.id`) no se sobrescribe. `setImmediate` separa el trabajo del hilo de la request; el original se relee tras escribir el PDF.

## Trust codes

`POST /workspace/customers/:id/trust-code` genera código ligado a `customerId` en `TenantConfig.trustCodes` y `Customer.trustCode`.
