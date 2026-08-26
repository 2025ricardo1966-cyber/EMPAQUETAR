# EMPAQUETAR

Producto Cloud bajo el paraguas **ORA — Ingeniería Digital**.

```text
ORA — INGENIERÍA DIGITAL
 └── EMPAQUETAR          vertical taller (pedidos, catálogo, seña, producción)
 └── capacidades core    imagen, TPU, 3D, moldería, etc. (no son este producto)
```

EMPAQUETAR conserva el flujo comercial de taller. No es AI Studio ni Real-ESRGAN. Apparel Studio y las capacidades ORA se **consumen**; no se reemplazan.

Origen de esta copia: `AI_UPSCALER` (MASCAYL Platform). El origen no se modifica.

## Arranque local

```bash
npm install
npx tsc -p tsconfig.cloud.json
node dist/cloud/server.js
```

En otra terminal:

```bash
set VITE_API_URL=http://127.0.0.1:8787
npx vite
```

Abrir `http://localhost:5173/#/login`.
