# B1-27 — i18n base + canal Cliente ↔ Administración

Arquitectura de expansión, no traducción completa de todos los mercados.

## Catálogo

Archivos JSON en `src/i18n/`:

- `es.json` — idioma base, siempre completo
- `pt.json` / `en.json` — parciales; claves faltantes caen a español

Agregar un idioma: crear `src/i18n/<code>.json` y registrarlo en `CATALOGS` de `src/i18n/index.ts`. Sin tocar lógica de negocio.

Uso: `t('errors.tenant_suspended', lang, { orderNumber: '#001' })`.

## Detección de idioma

1. `preferredLanguage` del usuario autenticado  
2. header `Accept-Language`  
3. `TenantConfig.defaultLanguage`  
4. `es`

## Canal de mensajes

Tablas `client_messages` + `message_entries`. Estados: `NEW`, `IN_REVIEW`, `RESPONDED`, `WAITING_CLIENT`, `RESOLVED`.  
Admin: `orders.view` (reutilizado). El cliente solo ve sus hilos.

## Moneda

`formatMoney` / `currencySymbol` en `src/contracts/currency.ts` (ISO 4217). El default de un tenant nuevo puede ser ARS; no es una restricción del núcleo.
