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
npm run build
PORT=8787 MASCAYL_DATA_DIR=.data npm start
```

Abrir `http://127.0.0.1:8787/#/login`.

Desarrollo con Vite (API en 8787, proxy incluido):

```bash
npx tsc -p tsconfig.cloud.json
node dist/cloud/server.js
# otra terminal
npx vite
```

Abrir `http://localhost:5173/#/login`.

## Producción

- Build: `npm run build` (Vite + `tsc` cloud)
- Start: `node dist/cloud/server.js`
- Puerto: `PORT` (Railway) o `MASCAYL_CONTROL_PLANE_PORT` / 8787
- Datos: `MASCAYL_DATA_DIR` (Railway: volumen en `/data`)
- JWT: `MASCAYL_JWT_SECRET` o secreto persistido en el volumen
