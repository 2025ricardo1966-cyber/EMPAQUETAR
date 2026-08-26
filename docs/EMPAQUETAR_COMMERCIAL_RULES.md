# EMPAQUETAR — reglas comerciales vigentes (pagos y projectName)

Extienden el cierre de Bloque A. No abren Bloque B. No tocan catálogo, FSM, `CostEngine` ni el modelo de taller.

## Pagos

El portal de pagos permanece disponible durante todo el ciclo del pedido.

Camino:

```
50% seña  →  pagos adicionales  →  100%
```

- El cliente puede cancelar anticipadamente el saldo.
- Confirmar seña **sin** `amountPaid` es idempotente (no acredita el resto).
- El saldo a 100% requiere un importe **explícito** (`amountPaid` o checkout del remaining).
- Si el pedido queda 100% pagado **antes** del vencimiento del precio, una decisión `UPDATE` por vencimiento del plazo de retiro **no puede incrementar** el importe ya completamente cancelado (`PRICE_FULLY_PAID`). `KEEP` sigue siendo válido si hubiera prompt.

La seña (umbral 50%) sigue siendo la que descongela producción. El saldo es independiente de ese umbral.

## projectName

`projectName` es descriptivo y **sigue editable**, también en `ready`.

Cada cambio real genera:

- evento `PROJECT_NAME_CHANGED` con cliente, pedido, fecha/hora, nombre anterior y nombre nuevo
- notificación al Admin: `{cliente} modificó el nombre del pedido {ORD-XXXX}`

El cambio no modifica precio, material, cantidad, producción ni estado.

No se bloquea la edición **solo** porque el pedido esté `ready`. Los estados terminales (`completed` / `delivered` / `cancelled` / `expired`) y la producción en curso siguen cerrados a parches de draft.
