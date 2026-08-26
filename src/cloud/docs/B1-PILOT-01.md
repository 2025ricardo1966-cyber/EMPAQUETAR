# B1-PILOT-01 — Laboratorio visual cliente / administrador

Cierre: **no se crea B1-PILOT-02**. Omar valida personalmente `#/client` y `#/admin`. El HUD Electron no se tocó.

## 1–2. Interfaces

- **Cliente** (`#/client`): catálogo progresivo (categoría → ítem → preview/cantidad/resumen → confirmar solicitud), seguimiento, mensajes, perfil/membresía.
- **Administrador** (`#/admin`): resumen operativo (PENDIENTE / EN_PRODUCCION / LISTO / mensajes abiertos), clientes, catálogo, alta de pedido ops, estados, inbox, ficha de membresía.

Una sola app hash. El rol lo da el **login real**, no un selector Cliente/Administrador.

## 3. APIs usadas (ninguna nueva)

Cliente: `GET /client/workshop-catalog`, `/client/membership`, `/client/orders`, `/client/orders/:id`, `/client/messages`, `/client/notifications`, `PUT /client/profile`, `POST /client/messages`.

Admin: `/admin/customers*`, `/admin/workshop-catalog/*`, `POST /admin/ops/orders`, `PUT /admin/ops/orders/:id/status`, `GET /orders`, `/admin/messages*`, `/admin/messages/stats`, `/admin/config/commercial`.

## 4–6. Campos por rol

| Campo | Cliente | Admin |
|---|---|---|
| Ítem, cantidad | elige | ve / crea ops |
| Precio unitario, subtotal, total | **solo lectura** (precio del catálogo × cantidad) | ve líneas del pedido |
| Consumo en unidad no métrica | fixture etiquetado | ve líneas; no hay motor de metros del workshop |
| Precios/costos/reglas | no | no se editan en esta pantalla (comercial existente) |
| Catálogo / membresía / estados | no | sí (APIs ya existentes) |
| Mensajes | inicia / historial | responde / clasifica / cierra |

## 7. Cálculos reales

`precio_catálogo × cantidad` en el cliente (`src/renderer/foundation/pilot-quote.ts`). Si la unidad del ítem es metro (`M`, `METRO`, …), el consumo = cantidad (la unidad ya es consumo).

## 8. Fixtures

- Previsualización: `data-pilot-fixture="preview"` — **no es un render GPU**.
- Consumo cuando la unidad es `UNIDAD` (u otra no lineal): `0.35 m × cantidad`, marcado `fixture de laboratorio`.

## 9. Fuera del piloto

GPU, 16K, 3D, TPU, FX, fiscal, pagos nuevos, motor industrial de consumo, dashboard estadístico, frontend comercial definitivo.

## 10. GAPS de backend (STOP: no se inventó API)

1. **Solicitud de catálogo workshop → pedido ops.** El cliente **no** llama `POST /admin/ops/orders`. Envía `POST /client/messages` (`PEDIDO` + `REQUEST`). El admin crea el pedido ops a mano. Falta un modelo “solicitud → pedido” si se quiere un clic.
2. **`POST /client/orders`** existe pero pide `productId` del catálogo de **configuración/productos**, no del workshop catalog. No se usó para no mezclar sistemas.
3. **Consumo/metros** del workshop catalog: no hay `quoteLine` para esos ítems.
4. **Imagen de ítem:** el modelo `WorkshopCatalogItem` no tiene `imageUrl`.
5. **`CustomerPortalService.preview`** calcula consumo real para productos/materiales de configuración, no para workshop items.

## 11. Instalador

**Opción A — instalación única.** Una app Vite/hash; `#/client` vs `#/admin` según token. Un selector visual no concedería permisos (no se agregó). Opción B (dos instaladores) no hace falta: duplicaría el mismo bundle.

## 12. Cómo correr el laboratorio local

```
cd AI_UPSCALER
node node_modules/typescript/bin/tsc -p tsconfig.cloud.json
# terminal 1
node dist/cloud/server.js
# terminal 2
set VITE_API_URL=http://127.0.0.1:8787
npm run dev:vite
```

Abrir `http://localhost:5173/#/login`. Semilla: con el control plane arriba, `node scripts/seed-piloto.js` (o el helper del verify B1-55). No GPU. Recorrido normal sin consola.

## 13. Tests

`node scripts/verify-bpilot01-gate.js` (incluye typecheck, vite, lint, `verify-bpilot01.js` y regresión `verify-bsec01-gate.js`, que anida B1-61).

## 14. Riesgos

Confundir el fixture de preview/consumo con cálculo productivo; se etiquetó. Un cliente no puede “volverse admin” desde la UI.

## 15. Revisión humana

Omar recorre cliente y admin y define qué agregar/quitar/simplificar. Relación solicitud ↔ pedido ops (GAP 1).

## 16. Recorrido

Login cliente → catálogo → categoría → ítem → ± cantidad → totales → confirmar solicitud → seguimiento/mensajes. Logout. Login admin → resumen → inbox (solicitud) → catálogo/clientes → crear pedido ops → EN_PRODUCCION → LISTO → responder mensaje.

## 17. HUD

`App.tsx` / CustomerPortal / AdminConsole / ProductionCenter **sin cambios**. `AppShell` sigue: `#/` = studio HUD; el resto = EmpaquetarShell.
