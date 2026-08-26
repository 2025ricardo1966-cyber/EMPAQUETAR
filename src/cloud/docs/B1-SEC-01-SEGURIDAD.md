# B1-SEC-01 — Seguridad, detección e incidentes

Capa de seguridad sobre `platform_audit`, roles, TraceService y el canal de notificaciones existente. No se creó B1-SEC-02.

El scoring vive en `src/contracts/security-risk.ts` (núcleo compilable de este repo; no hay paquete npm `packages/core`).

## Niveles

`RIESGO_0` … `RIESGO_4`. Ventana acumulativa configurable (default 15 min). Sin eventos nuevos, la ventana caduca.

- Auth: 3 fallos → 1; 5 → 2; 10 o cuentas inexistentes (10) → 3
- Cliente en `/admin/*` → 1; 3+ ACCESS_DENIED → 2; admin a otro tenant → 3
- Membresía sin permiso → 2; precios/permisos sin permiso → 3; patrón de mutación fuera de rol (3+) → 4
- Volumen → 2; enumeración de recursos (404 distintos) → 3

`RIESGO_0` y `RIESGO_1` no bloquean. `RIESGO_3+` bloquean si la protección automática está ON.

## Bloqueo

Usuario o IP (solo si no hay usuario autenticado). **Nunca el tenant**. Respuesta `403 SECURITY_BLOCKED` con mensaje i18n, no 500. Super Admin desbloquea en `#/platform`.

## Incidentes

Se persisten en `platform_audit` (`action: security.incident`). Sin passwords, tokens ni secretos.

## WhatsApp

`WhatsAppProvider` → Twilio si `WHATSAPP_PROVIDER=twilio` y hay SID/token/from; si no, `NullAdapter`. RIESGO_1/2: IN_APP. RIESGO_3/4: IN_APP + email (si Resend) + WhatsApp (número verificado).

## Gate

`node scripts/verify-bsec01-gate.js`. Informe: este archivo + `B1-SEC-01-ENV.md`.
