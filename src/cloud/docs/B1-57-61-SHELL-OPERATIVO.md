# B1-57 → B1-61 — Shell operativo y piloto visual

Cierre de la superficie hash HTTP (`#/login`, `#/client`, `#/admin`, `#/platform`) sobre APIs ya existentes. El HUD Electron (`App.tsx`, `#/`) no se modificó. No se creó B1-62.

## Qué quedó operativo

**B1-57.** Tras login, el rol deriva a `#/client` (CLIENTE), `#/admin` (ADMIN / ADMIN_PRINCIPAL / SUBADMIN) o `#/platform` (SUPER_ADMIN). OPERADOR sigue en `#/workspace`. Nunca se navega a `#/` desde este flujo. `#/platform` usa `PlatformAreaPage` (placeholder con logout), no `AdminAreaPage`. Token de cliente en `#/admin` redirige a `#/client`. Acceso a `#/platform` sin SUPER_ADMIN redirige a `#/login`. Logout → `#/login`.

**B1-58.** `#/client` muestra catálogo (`GET /client/workshop-catalog`), membresía con vencimiento y uso de trial (`GET /client/membership` + conteo de `GET /client/orders`), lista y detalle de pedido (`GET /client/orders/:id`), mensajes con categoría y contexto `ORDER|PAYMENT|REQUEST|COMMERCIAL`, y avisos IN_APP (`GET /client/notifications`). SUSPENDED/EXPIRED muestran el mensaje de catálogo i18n y bloquean el envío. El cliente no crea pedidos.

**B1-59.** `#/admin` opera el ciclo existente: clientes (`GET/POST /admin/customers`, ficha `GET /admin/customers/:id`), catálogo (`/admin/workshop-catalog/*`), pedidos (`POST /admin/ops/orders`, `PUT .../status`, listado `GET /orders`), inbox ya existente. Producción = estado `EN_PRODUCCION`. Ítems deshabilitados no entran al selector de alta. Transición inválida queda en 4xx con mensaje, no 500.

**B1-60.** El recorrido seed (`scripts/seed-piloto.js`) está cableado en esas pantallas: catálogo → pedido → EN_PRODUCCION → LISTO → cliente ve estado → mensaje ORDER → admin responde/cierra → ENTREGADO → historial → suspender membresía → cliente restringido → reactivar.

**B1-61.** Gate: `vite build` production, `tsconfig.cloud.json` + `tsconfig.b129.json`, lint de archivos de esta tanda, `verify-b157`…`verify-b160`, aislamiento de dos tenants, regresión `verify-b146-second-chain.js` + `verify-b147-55-operacion.js`.

## APIs usadas (ninguna nueva)

`/auth/login`, `/client/workshop-catalog`, `/client/membership`, `/client/orders`, `/client/orders/:id`, `/client/messages`, `/client/notifications`, `/admin/customers`, `/admin/customers/:id`, `/admin/customers/:id/membership`, `/admin/workshop-catalog/*`, `/admin/ops/orders`, `/admin/ops/orders/:id/status`, `/orders`, `/admin/messages*`. El spec nombra `/admin/clients`; el producto ya expone `/admin/customers`.

## DME

Las pantallas nuevas no fijan Argentina / ARS / español como únicos valores. País, idioma y moneda son campos libres o datos del tenant. El “5” del trial es el default ORA ya cerrado en B1-47, no un mercado.

## Viabilidad del piloto con taller real

**Viable en el shell hash** para el circuito de operación real (catálogo, pedido, estados, mensajes, membresía), siempre que el taller use `#/login` y no el HUD Electron.

Ajustes puntuales que no bloquean el circuito pero conviene tener presentes:

- `#/platform` es placeholder (logout + rol). No hay gobernanza extra de Super Admin en esta tanda.
- `#/workspace` sigue siendo scaffold para OPERADOR.
- `#/verify` sigue siendo stub.
- El recorrido visual automático del gate valida APIs + cableado de UI (no hay browser driver). El humano recorre las mismas pantallas sin consola.
- Alta de cliente pide contraseña porque `POST /admin/customers` ya la exige.

## Errores y advertencias del gate

Corrida `node scripts/verify-b161-gate.js`: **11 ok, 0 failed**. Incluye typecheck cloud + b129, vite production, lint B1-57–60, tests 57–60, regresión B1-46 y `verify-b147-55-operacion.js`.

Advertencia conocida no bloqueante: `RESEND_API_KEY missing`. MercadoPago no se tocó. El HUD Electron no se modificó.
