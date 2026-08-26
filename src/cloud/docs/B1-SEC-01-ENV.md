# B1-SEC-01 — Variables de entorno (Railway y local)

El control plane lee `process.env`. No asume Railway. Los mismos nombres sirven en local (`.env`) y en Railway Environment Variables.

## Seguridad

```
SECURITY_BLOCK_DURATION_MINUTES=15
SECURITY_WINDOW_MINUTES=15
SECURITY_AUTO_BLOCK_ENABLED=true
```

Duraciones de bloqueo admitidas: `5`, `15`, `30`, `60`, `360`, `1440`.

## WhatsApp

```
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
```

Si `WHATSAPP_PROVIDER` no es `twilio` o falta cualquier credencial Twilio → `NullAdapter` (silencioso, sin error).

## Secretos

- `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `RESEND_API_KEY` y JWT **nunca** van en código ni en git.
- Railway: Environment Variables del servicio.
- Local: archivo `.env` (ignorado). `.env.example` documenta nombres sin valores.
