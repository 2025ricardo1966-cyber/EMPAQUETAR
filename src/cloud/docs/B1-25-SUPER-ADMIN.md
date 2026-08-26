# B1-25 — Super Admin (plataforma)

## Proceso

1. Primer deploy: `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` y `node scripts/seed-super-admin.js` (idempotente).
2. Login: `POST /auth/login` o `POST /platform/login`. El JWT lleva `role: SUPER_ADMIN` y alcance `__platform__` (fuera de `tenantScope`).
3. `POST /platform/activation-codes` → código de 16 caracteres (única vez en claro).
4. El taller activa con `POST /auth/activate-tenant`.
5. `POST /platform/tenants/:id/suspend` `{ reason }` → `SUSPENDED`, refresh tokens invalidados, evento `TENANT_SUSPENDED`.
6. Usuarios del tenant: login y mutaciones → `403 TENANT_SUSPENDED` (mensaje claro). Lecturas GET de sesiones vigentes se mantienen (B1-17 dashboard).
7. `POST /platform/tenants/:id/reactivate` → `ACTIVE` + `TENANT_REACTIVATED`. `POST .../unblock` sigue válido.

## Variables de entorno

| Variable | Uso |
|---|---|
| `SUPER_ADMIN_EMAIL` | Login del Super Admin (no hay registro público). |
| `SUPER_ADMIN_PASSWORD` | Contraseña inicial (solo seed). |
| `MASCAYL_DATABASE_URL` | SQL del Control Plane. |
| `MASCAYL_JWT_SECRET` | Firmas de sesión. |

## Decisiones

- **Status:** se reutiliza `Tenant.status` (ciclo B1-07). Se agregan `suspendedAt/By`, `suspensionReason`, `reactivatedAt/By` y el valor `CANCELLED` (equivalente operativo a baja). No se introduce un segundo campo de ciclo de vida.
- **Bloqueo:** un solo punto tras JWT. `SUPER_ADMIN` no se bloquea. Mutaciones de tenant `SUSPENDED` → 403. Cache de status en memoria (TTL 2s).
- **Códigos:** GET los ofusca (`ABCD-****-****-****`). DELETE solo no usados.
- **Deadlines:** `POST /platform/ops/evaluate-deadlines` sin `tenantId` recorre tenants `ACTIVE`; con `tenantId` uno solo. `/ops/evaluate-deadlines` (SA) se conserva.
- El SA no recibe pedidos, costos ni PII de clientes: listados de plataforma son conteos y metadatos de tenant.

## Fuera de alcance

UI visual del panel, facturación, logs de auditoría SA, múltiples SUPER_ADMIN.
