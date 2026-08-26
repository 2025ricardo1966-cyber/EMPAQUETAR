# B1-24 — Pagos online (MercadoPago + Stripe)

## Variables de entorno

| Variable | Uso |
|---|---|
| `MP_ACCESS_TOKEN` | Fallback MercadoPago si el tenant no tiene credenciales. |
| `MP_WEBHOOK_SECRET` | Firma `x-signature` global. |
| `STRIPE_SECRET_KEY` | Fallback Stripe. |
| `STRIPE_WEBHOOK_SECRET` | Firma `stripe-signature`. |
| `PAYMENT_SUCCESS_URL` / `FAILURE` / `PENDING` | Retorno (`:orderId` se sustituye). |
| `PAYMENT_LIVE=1` | Llama APIs reales; si no, sandbox in-process. |

Prioridad: `TenantConfig.config.payments` > env global.

## Credenciales por tenant

En `TenantConfig.config.payments`:

```json
{
  "gateway": "MERCADOPAGO",
  "allowManual": true,
  "mercadopago": { "accessToken": "...", "webhookSecret": "..." },
  "stripe": { "secretKey": "sk_test_...", "webhookSecret": "whsec_..." }
}
```

Secretos pueden ir cifrados (`enc:v1:…`) con AES-256-GCM derivado de `MASCAYL_JWT_SECRET`.

## Estados

`PENDING` → checkout / voucher → `PARTIAL` | `COMPLETED` | `FAILED`.

`FAILED` permite reintentar checkout. `WAIVED` (confianza) no abre checkout.

Manual (`gateway: MANUAL`) coexiste: voucher + `POST /admin/orders/:id/payment/confirm`.

## Webhooks (secuencia)

1. POST público `/webhooks/mercadopago` o `/webhooks/stripe`.
2. Sin firma → 400.
3. Parsear `gatewayOrderId` → `PaymentRecord` → tenant → secret.
4. Verificar HMAC (MP `ts=,v1=` / Stripe `t=,v1=`).
5. `PaymentAttempt` único `(gateway, gatewayEventId)` → duplicado 200 sin reprocesar.
6. `approved` → `confirmPayment` (B1-21) + email `PAYMENT_CONFIRMED`.
7. `rejected`/`cancelled` → `FAILED` + `PAYMENT_REJECTED`; el workflow no avanza.
8. Respuesta 200 para no reintentar en bucle.

El Core solo ve `PaymentGatewayAdapter`.
