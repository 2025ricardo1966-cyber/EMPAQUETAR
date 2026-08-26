# B1-26 — API de configuración del Admin

Configuración por tenant via `/admin/config/*`. El Core no cambia: catálogo sigue en `TenantConfig` JSON (B1-14) y workflow en `WorkflowDefinition` (B1-18).

## Auth

`ADMIN_PRINCIPAL` o `SUBADMIN`/`ADMIN` con `config.view` (GET) / `config.edit` (mutaciones). OPERADOR y CLIENTE → 403. Scope: solo el tenant del JWT.

## Productos

| Método | Path | Notas |
|---|---|---|
| GET | `/admin/config/products` | Incluye inactivos. Sin `internalCost`. |
| POST | `/admin/config/products` | `fields[]` validados. Evento `PRODUCT_CREATED`. |
| PUT | `/admin/config/products/:id` | Con pedidos activos no se cambian `unit` ni `consumptionRule` → 409. `PRODUCT_UPDATED`. |
| DELETE | `/admin/config/products/:id` | Soft-delete (`isActive: false`). 409 si hay pedidos activos. |
| PUT | `/admin/config/products/order` | `displayOrder` del catálogo cliente. |

`consumptionRule` acepta `{ type, value }` o `{ kind, rate }`.

### fields (JSONB en el producto)

`id`, `type` (`text|number|select|multiselect|boolean|textarea`), `label`, `required`, `visibleToClient`, `options` (obligatorio en select), `order`.

## Materiales / precios

POST/PUT/DELETE `/admin/config/materials`. Cambio de `internalCost` no toca `PaymentRecord` ni consumos de pedidos.  
GET `/admin/config/pricing` y PUT `/admin/config/pricing/products/:id` | `.../materials/:id`.

## Workflow

GET/PUT `/admin/config/workflow`. Solo `label`, `labelForClient`, `notifyClient`, `notifyAdmin`. Cambiar `name` → 400. Reordenar con instancias activas → 409. Instantáneas de instancias no se reescriben.

## Visibilidad y límites

PUT `/admin/config/client-visibility` → `GET /client/catalog` respeta `visibleToClient` y `displayOrder`.  
`deliveryAddress` / `deliveryHours` van al email de trabajo listo.  
GET/PUT `/admin/config/limits` (`maxFileSizeMb`, `allowedMimeTypes`). `PUT /tenant/config/limits` (B1-20) se conserva.

## Pedidos activos

Estados abiertos: todo excepto `completed`, `delivered`, `cancelled`, `expired`.
