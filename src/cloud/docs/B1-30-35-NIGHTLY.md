# B1-30 → B1-34 — Domain, profile, communications, commercial readiness

Extiende núcleos existentes (B1-27 mensajes, B1-26 config, B1-29 shell). No hay sistemas paralelos.

## B1-30

- `src/contracts/international-domain.ts`: country/language/currency/contact/commercial como códigos ISO/BCP-47, no catálogos mundiales.
- Defaults de lanzamiento `AR` / `es` / `ARS` en `LAUNCH_DEFAULTS` y `TenantConfig.commercial`. Son configuración, no restricciones.
- `resolveConfiguredCurrency` reemplaza fallbacks estructurales a ARS.

## B1-31

- Perfil cliente existente (`/client/profile`, register). Validación ISO de país **si se envía**; región/CP/teléfono libres.
- Portal existente + `#/client` (foundation) con los mismos campos. Sin segundo perfil.

## B1-32 / B1-33

- Mismo `ClientMessage`. Categorías `ERROR` y `COMERCIAL`. Alias de estado `NUEVO` → `NEW`, etc.
- Deuda/pago: categoría `PAGO_DEUDA` en el mismo canal.
- Admin: filtros `q` / `evaluationStatus`; `PUT /admin/messages/:id/evaluate` (PENDING|REVIEWED|BACKLOG|DECLINED). Una sugerencia **no** se implementa sola.
- UI admin en `AdminAreaPage` (layout B1-29), no otra app.

## B1-34

- `GET/PUT /admin/config/commercial` `{ defaultMarket, defaultCurrency, defaultLanguage }`.
- Precio ≠ ARS como regla; ARS sigue siendo default de lanzamiento.
- Sin impuestos, FX, ni gateways extra. Mercado Pago sigue siendo adaptador de un mercado, no la moneda universal.

Migración: ninguna (payload JSON). No hay 013 destructiva.
