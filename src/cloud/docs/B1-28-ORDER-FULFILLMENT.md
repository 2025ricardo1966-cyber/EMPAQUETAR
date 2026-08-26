# B1-28 — Pedido multidestinatario + fulfillment + capacidades del tenant

Un solo modelo de pedido. Roles independientes: solicitante, pagador, destinatario, receptor, autorizado a retirar.

## Modalidades

`PICKUP` | `DELIVERY`. Se reutilizan estados existentes: `ready` (listo para retiro o entrega), `delivered`, `completed`. No se duplican READY_FOR_PICKUP / READY_FOR_DELIVERY.

## Capacidades (Admin Principal)

`PUT/GET /admin/config/client-options`

- `pickupEnabled` (default true)
- `deliveryEnabled` (default false)
- `pickupByThirdPartyEnabled` (default false)

El cliente consulta `GET /client/fulfillment-options` y solo ve lo habilitado. No puede mutar `TenantConfig`.

## Pedido

`POST /client/orders` acepta `fulfillmentMode`, `delivery`, `recipient`, `pickupAuthorized`, `requester`, `payer`.

La dirección de entrega vive en el pedido, no en `Customer.address`.

Deshabilitar Delivery después no reescribe pedidos históricos.

## Excepciones

`ClientMessage` categoría `PEDIDO` + `orderId`. Administración aplica `PUT /workspace/orders/:id/fulfillment` (incluye `exceptionMessageId`). Eso no cambia las capacidades del tenant.

## Fuera de alcance

Logística externa, GPS, sucursales completas, portal B2B, B1-29.
