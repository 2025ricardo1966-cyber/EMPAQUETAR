# B1-36 → B1-46 — Productización e integración

Consolida B1-30–B1-35. Un solo `ClientMessage`, un solo perfil, un solo `/admin/config/commercial`.

- B1-36/40: `#/client` y `#/admin` usan catálogo i18n (`client.*`, `admin.*`, categorías).
- B1-37: clasificar `PUT /admin/messages/:id/category`; flujo respuesta/resolución.
- B1-38: contexto opcional `ORDER|PAYMENT|REQUEST|COMMERCIAL` (sin membresía: no existe entidad).
- B1-39: Evento (`tracer.record`) → notificación in-app (`notifyOperational` + `customerId`) → canal `IN_APP`; email sigue opcional.
- B1-41/45: moneda de commercial alimenta pricing; MercadoPago no se toca.
- B1-42: snapshot de contacto/geo/idioma en listado/hilo admin.
- B1-43/44: validaciones controladas; `sanitizeEventMetadata` ampliado.

No se creó B1-47.
