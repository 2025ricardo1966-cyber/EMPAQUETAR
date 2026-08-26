# B1-23 — Email transaccional (Resend)

## Variables de entorno

| Variable | Uso |
|---|---|
| `RESEND_API_KEY` | API key de Resend. Si falta: warning en startup, emails deshabilitados, el Control Plane sigue. |
| `EMAIL_FROM_DEFAULT` | Remitente por defecto (`EMPAQUETAR <noreply@empaquetar.app>`). |
| `EMAIL_APP_URL` / `MASCAYL_APP_URL` | Base de links de verificación y seguimiento. |

`TenantConfig.emailFrom` (o `config.emailFrom`) pisa `EMAIL_FROM_DEFAULT`. También: `emailReplyTo`, `adminEmail`, `emailsEnabled`.

## Verificación de dominio en Resend

1. Alta del dominio en el dashboard de Resend.
2. Publicar registros DNS (SPF, DKIM, opcional DMARC).
3. Esperar estado *verified*.
4. Usar un `from` de ese dominio. Hasta entonces, el envío puede fallar con dominio no verificado: se registra en `EmailLog` y **no** se revierte el negocio.

## Arquitectura

- Los domain events de B1-19 se persisten en `TraceService.record`.
- Hook aditivo `setAfterRecord` (no cambia la semántica de B1-19).
- `EmailDispatcher` traduce evento → template → `EmailService.send`.
- `EmailService` es best-effort: nunca lanza. Retry 3 intentos, backoff 1m / 5m / 15m (en tests delays `0`).
- Transporte: HTTP `https://api.resend.com/emails`. Tests inyectan `MemoryEmailTransport`.
- In-app (B1-19) y email coexisten.

## Evento → email

| Evento | Destinatario | Condición |
|---|---|---|
| `CUSTOMER_REGISTERED` | Cliente | siempre |
| `ORDER_SUBMITTED` | Admin + cliente | siempre |
| `PAYMENT_VOUCHER_UPLOADED` | Admin | siempre |
| `PAYMENT_CONFIRMED` | Cliente | siempre |
| `ARTIFACT_REJECTED` | Cliente | siempre |
| `CHANGE_REQUESTED` | Admin | siempre |
| `ORDER_APPROVED` | Admin | siempre |
| `ORDER_ASSIGNED` | Staff asignado | siempre |
| `ORDER_READY` / `STEP_STARTED` READY | Cliente | solo READY |
| `ORDER_OVERDUE` | Admin (`DEADLINE_OVERDUE`) | si `emailsEnabled` |
| `JOB_FAILED` | Admin | siempre |
| `WORKFLOW_BLOCKED` / `STEP_BLOCKED` | Admin | siempre |

Sin email: `STEP_STARTED` (no READY), `INTERNAL_COMMENT_ADDED`, `AUDIT_*`, `TENANT_RUBRO_SELECTED`, `USER_CREATED` / `USER_DEACTIVATED`.

Templates de cliente no incluyen `internalCost`, `margin`, `costBreakdown`, `supplierPrice`.
