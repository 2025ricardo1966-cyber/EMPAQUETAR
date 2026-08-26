# B1-21 — Portal del Cliente (contratos)

## Endpoints `/client/*`

Todas las respuestas aplican `stripSensitiveData` (rol CUSTOMER). Auth JWT + `tenantScope` + `customerScope`. `emailVerified === false` → 403. `undefined` (legado B1-16) se trata como verificado.

| Método | Ruta | Notas |
|---|---|---|
| POST | `/client/register` | Público. Header `X-Tenant-ID`. 201 `{ userId, customerId, verificationToken }`. Sin JWT. |
| POST | `/client/activate-trust` | Body `{ trustCode }`. Códigos en `TenantConfig.trustCodes`. |
| GET | `/client/dashboard` | Resumen propio. `creditAvailable` solo si `isTrust`. |
| GET | `/client/catalog` | Productos activos del rubro, sin costos internos. |
| GET | `/client/orders` | `status`, `page`, `limit`. Solo pedidos del customer. |
| POST | `/client/orders` | `{ productId, quantity, formData?, notes? }`. 402 si crédito insuficiente. |
| GET | `/client/orders/:id` | 403 si no es dueño. Incluye files, payment, timeline. |
| POST | `/client/orders/:id/files` | JSON `{ filename, mimeType, contentBase64 }` (equivalente multipart). |
| POST | `/client/orders/:id/submit` | Requiere archivo + pago PARTIAL/COMPLETED o WAIVED. |
| GET | `/client/orders/:id/timeline` | Reutiliza B1-19. |
| POST | `/client/orders/:id/approve` | Emite `ORDER_APPROVED`. |
| POST | `/client/orders/:id/request-changes` | `{ message }`. Emite `CHANGE_REQUESTED`. |
| GET | `/client/notifications` | B1-19 filtrado por `recipientId`. |
| POST | `/client/notifications/:id/read` | 403 cruzado. |
| POST | `/client/orders/:id/payment/voucher` | No cambia el status de pago. |

## Admin

- `POST /admin/trust-codes` `{ code, creditLimit }` — ADMIN_PRINCIPAL.
- `GET/PUT /admin/customers/:id/credit` — ADMIN_PRINCIPAL.
- `POST /admin/orders/:id/payment/confirm` — ADMIN_PRINCIPAL o SUBADMIN con `orders.edit`.

## TrustClient

Perfil en `customers.payload`: `isTrust`, `trustCode`, `creditLimit`, `currentDebt`. Códigos genéricos del tenant (no contaminan el motor de pedidos). Deuda += total al crear pedido WAIVED; -= `amountPaid` al confirmar o PUT `paymentAmount`.

Mensaje 402 de crédito: no expone límites ni deuda.

## Producción

Pedido `RECEIVED` + `PaymentRecord` + workflow instance. Submit / confirmación de pago llama `startProductionForSubmit`. Cliente estándar: `requiredPct` 50 o 100 desde `TenantConfig.limits.requiredPaymentPct`.

## Storage

Blobs existentes (`writeBlob`) + filas `order_files`. Acceso de archivos atado a `customerId` del pedido.
