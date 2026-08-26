# B1-47 → B1-56 — Operación real

Cadena sobre Control Plane SQL (PGlite). **No se introdujo Prisma**: el store existente es migraciones SQL; Prisma sería un ORM paralelo.

## Decisiones (sin contradicción de arquitectura)

- Membresía 1:1 con cliente: tabla `memberships` (migración `013`). Trial ORA: **7 días / 5 pedidos**.
- Catálogo de taller: enum de rubro `SUBLIMACION | DTF_TEXTIL | UV_DTF | BORDADO | GRAN_FORMATO | OTRO` + ítems por tenant. No duplica CostEngine ni disciplinas TEXTIL/TPU/DTF.
- Pedidos: el ciclo `PENDIENTE → EN_PRODUCCION → LISTO → ENTREGADO | CANCELADO` es una **capa operativa** sobre `OrderStatus` ya testeado (B1-29→B1-46). No se reemplazó el enum de pedido.
- Mensajes `COMERCIAL` / contexto `PAYMENT` se anclan a la membresía real. Sin entidad de cobro ni MercadoPago.
- Auth: se extendió (verify manual sin RESEND, idioma en sesión). No se rediseñó.

## Recorrido cliente (B1-47)

Registro → token de verificación (RESEND si hay clave; si no, el token alcanza) → perfil → TRIAL automático → dashboard → mensajes → historial. Idioma preferido en usuario/sesión e i18n. Sin membresía: `403 MEMBERSHIP_REQUIRED` con catálogo.

## Administración (B1-48)

`GET/POST /admin/customers`, ficha con perfil + membresía + pedidos + comunicaciones cronológicas. Filtros: `membershipStatus`, `messageStatus`, `recent`. Admin A no lee clientes de B.

## Membresía (B1-49)

Estados `TRIAL | ACTIVE | SUSPENDED | EXPIRED`. Cliente: `GET /client/membership`. Admin: `PUT /admin/customers/:id/membership`. Suspendido/expirado bloquea pedidos nuevos.

## Catálogo (B1-50)

Admin ve todas las categorías; cliente solo habilitadas. Ítem deshabilitado (`stockEnabled=false`) no entra en pedidos nuevos; pedidos viejos conservan snapshot en `formValues.workshopLines`.

## Pedidos (B1-51)

`POST /admin/ops/orders`, transiciones `PUT /admin/ops/orders/:id/status`. Cliente solo lectura `/client/orders`. Pedido inexistente: 404. Transición inválida: 400. Contexto ORDER ajeno: 403 (B1-38).

## Ciclo de vida (B1-52)

Máquinas en `src/contracts/lifecycle-machines.ts`. Comunicación sobre pedido entregado/cancelado: se permite (consulta histórica). Membresía expirada: lectura de historial sí; crear pedido no.

## Errores (B1-53)

HTTP + `message` del catálogo `es`. Idempotencia `Idempotency-Key` en creación operativa. Sin 500 en los escenarios de la directiva.

## Multi-tenant (B1-54)

Dos tenants reales en el mismo proceso de test (`verify-b147-55-operacion.js`). Catálogo, clientes, pedidos, membresías y mensajes no cruzan.

## Persistencia (B1-55)

Reinicio con el mismo directorio PGlite conserva datos. Seed: `scripts/seed-piloto.js` (1 tenant, 3 clientes, 2 pedidos, TRIAL, comunicaciones abiertas/cerradas, 2 categorías).

## Gate B1-56

`scripts/verify-b156-gate.js`: `vite build` production, `tsconfig.cloud.json` + `tsconfig.b129.json`, lint de archivos de la cadena, tests B1-47→55, nested B1-46 (29+35).

**Evidencia de tests (esta sesión):**
- `verify-b147-55-operacion.js` → **43 ok, 0 failed**
- Typecheck `tsconfig.cloud.json` y `tsconfig.b129.json` OK
- `vite build` production OK
- lint de archivos B1-47–55 OK
- `verify-b146-second-chain.js` (nested B1-29 + B1-35) → **15 ok, 0 failed**
- Advertencia conocida: `RESEND_API_KEY missing` (no STOP)

**DME:** precios/membresía usan moneda comercial del tenant (ARS/BRL/UYU vía config). Categorías e i18n no cierran mercados. AR/es/ARS siguen siendo default de lanzamiento, no candado estructural.

**MercadoPago:** no se tocó. Email sin `RESEND_API_KEY`: advertencia conocida, no STOP.

No se crea B1-57.

## Informe para piloto con taller real

La operación de punta a punta queda cubierta por API + seed. El piloto es viable si el taller opera por `#/admin` y `#/client` en este Control Plane, con membresía manual y catálogo de rubro. Falta cobro automático (fuera de alcance) y panel estadístico (excluido). Si el verify B1-56 pasa en el entorno, el bloqueo para piloto es operativo (datos reales, RESEND, entrenamiento), no de producto mínimo de este tramo.
