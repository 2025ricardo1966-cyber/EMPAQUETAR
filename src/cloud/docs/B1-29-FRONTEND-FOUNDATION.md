# B1-29 — Fundación frontend

No es el diseño visual definitivo. Es el esqueleto para EMPAQUETAR sobre el renderer React + Vite existente.

## Qué hay

- Hash router (`#/login`, `#/client`, `#/workspace`, `#/admin`) sin segundo framework de routing.
- `AppProviders`: i18n → auth → tenant.
- API client único (`src/renderer/foundation/api-client.ts`) con Authorization, Accept-Language, X-Tenant-ID, refresh 401 (un reintento).
- Catálogo B1-27 (`src/i18n`) reutilizado; no se creó un segundo i18n.
- Zustand del estudio desktop no se tocó.
- `App.tsx` (HUD existente) sigue en `#/` / `#` vacío.

## Entorno

`VITE_API_URL` (ver `.env.example`). Sin secretos en variables públicas.

## Fuera de alcance

UI definitiva, OpenAPI, monitoreo (B1-30).
