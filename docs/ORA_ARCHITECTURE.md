# ORA — frontera arquitectónica evolutiva

Este documento es un **overlay**. No reescribe `PROJECT_CONTRACT.md`, no abre Bloque B, no despliega cloud y no crea productos independientes.

## Relación de capas

```
ORA                          paraguas tecnológico
 └── EMPAQUETAR              producto/vertical prioritario (taller, pedidos, catálogo)
 └── futuras aplicaciones    no implementar ahora
 └── servicios independientes  no implementar ahora
 └── capacidades core        motores reutilizables (imagen, 16K, TPU, 3D, …)
```

- **ORA** es el paraguas tecnológico.
- **EMPAQUETAR** es un producto dentro de ORA. Conserva su flujo comercial, catálogo, `OrderService`, `CostEngine`, FSM, portal, pagos de taller, Excel, producción, modelo de taller, tenancy y UX actuales.
- Toda capacidad tecnológica que pueda servir fuera de EMPAQUETAR debe quedar identificada como **capacidad core**, no encapsulada de forma que después haya que arrancarla del dominio taller.

## Cloud (cuando corresponda, no ahora)

No diseñar “Cloud EMPAQUETAR”. Diseñar **Cloud ORA**:

```
Cloud ORA
 ├── capacidades core
 │    ├── Image Processing
 │    ├── 16K
 │    ├── TPU
 │    ├── 3D
 │    └── futuras
 └── productos / experiencias
      ├── EMPAQUETAR
      ├── futuras aplicaciones ORA
      └── servicios independientes
```

Una capacidad debe poder consumirse después por más de un producto **sin duplicar el motor**.

## Objetivo 16K

La capacidad objetivo futura es **16K** de procesamiento y salida (ya enumerada en el contrato funcional). Las decisiones de cloud no deben asumir un máximo de 8K ni cerrar el camino a:

- imágenes 16K y archivos grandes
- procesamiento intensivo y jobs prolongados
- almacenamiento temporal, generación de resultados y descarga
- medición del consumo

No implementar el escalado cloud 16K en este bloque.

## Servicios independientes futuros

Arquitectura permitida más adelante, **sin implementar ahora**:

```
Usuario externo → ORA → capacidad específica → procesamiento → resultado → descarga
```

Ese usuario no necesita conocer ni utilizar EMPAQUETAR. No es un tenant de taller.

## Tenancy

Distinguir conceptualmente, cuando exista cloud:

| Identidad | Dominio |
|-----------|---------|
| EMPAQUETAR / WORKSHOP | taller, pedidos, catálogo, seña, producción |
| ORA / CAPABILITY USER | consumidor de una capacidad core, sin modelo de taller |

Misma infraestructura común. Distinta identidad comercial. **No** segundo sistema de usuarios ni segundo backend.

## Economía cloud (conceptual)

Separar, sin fijar precios ahora:

- costo de procesamiento
- almacenamiento temporal
- transferencia / descarga
- regeneración / reprocesamiento
- resolución e intensidad computacional

El consumo de una capacidad se mide **independientemente del producto** que la invocó. Mismo motor; distinto contexto comercial. No implementar billing independiente todavía.

## Prohibido (islas)

No resolver reutilización copiando:

- segundo motor 16K, imagen, TPU o 3D
- segundo almacenamiento, login, backend
- segundo `CostEngine` u `OrderService`

La reutilización se hace con el motor existente o con un contrato core futuro, no con copias.

## Qué no hacer por esta directiva

No crear app 16K, portal de fotógrafos, marketplace, billing nuevo, segundo login, API pública prematura, ni desplegar cloud. No modificar EMPAQUETAR para “demostrar” el concepto. No detener Bloque B para construir estos servicios.

## Criterio de aceptación

Si mañana el procesamiento 16K se ofrece como servicio independiente de ORA, debe poder usarse **la misma infraestructura y el mismo motor**, sin copiar código de EMPAQUETAR ni alterar su funcionamiento de taller.

Si para lograrlo hay que reconstruir EMPAQUETAR, el acoplamiento quedó mal.

## Identificación durante el desarrollo

Al agregar una capacidad tecnológica potencialmente reutilizable:

1. identificarla
2. separar qué es dominio EMPAQUETAR y qué es capacidad general
3. evitar acoplamiento innecesario
4. documentar la frontera
5. continuar el producto actual **sin abrir un producto nuevo**

No crear abstracciones especulativas que no aporten valor inmediato.

## Frontera técnica preparada (B-18 — no implementar)

Capacidades ya persistidas que **no son dominio EMPAQUETAR** y no deben encapsularse dentro del pedido de taller:

| Capacidad core | Dónde vive hoy | Consumo EMPAQUETAR | Servicio independiente futuro |
|---|---|---|---|
| TPU | `TPUAdminConfig` en config de taller / `assertTpuDimensions` | `formValues.tpuConfig` + snapshot al freeze | mismo motor de límites/medidas, sin `OrderService` ni catálogo de taller |
| Procesamiento 16K | motor de imagen existente (no cloud) | no es un producto EMPAQUETAR | Cloud ORA: job, storage temporal, descarga, medición |
| Export industrial | `buildApparelExport` / moldes universales | pedido → familia → talle → salida | el export no se copia; el pedido solo invoca |
| 3D | `Garment3DViewer` + `orderToViewerParams` | preview del pedido real | viewer no conoce Order; el adapter sí |

Reglas de frontera (sin abrir producto):

1. No crear `TpuService`, `Image16kService` ni segundo storage.
2. No acoplar TPU/16K a `OrderService`, FSM, `CostEngine` ni portal de seña.
3. Un consumidor futuro (fotógrafo, API, otro vertical) reutiliza el **mismo motor** y otra identidad (`ORA / CAPABILITY USER`), no un segundo login.
4. EMPAQUETAR sigue siendo el único producto comercial activo.

Pendiente de productización (no resolver en local): frontend visual de checkout/gateway live, despliegue Cloud ORA, secretos de pasarela en producción.

## Capacidades independientes (pre-cloud)

ORA es el paraguas. EMPAQUETAR es el vertical textil. Las capacidades siguientes viven en contratos cloud-safe (`src/contracts/ora-*.ts`) y se ejecutan por `OraCapabilityAdapter` sobre el mismo `ControlPlaneStore` (blobs + `capability_jobs`) y `TraceService`. No hay segundo login, segundo `OrderService` ni segundo `CostEngine`.

```
ORA
├── EMPAQUETAR          vertical taller (A/B cerrados)
├── 16K                 pipeline preparado, no ejecutado
├── TPU                 TPUAdminConfig existente
├── CDR → PDF           original + derivado; conversión no equivalente
├── BANDERAS            ancho × alto libres
├── MOLDERÍA TEXTIL     catálogo real Apparel Studio
├── CANDY BAR           composición por medidas del cliente
├── CUBRE MALETAS       4 vistas + variante Carry-On
├── DISEÑO EN LOTE      1 diseño → N unidades (sin tope 100 de alta EMPAQUETAR)
├── FILE CONVERSION     análisis + conversión + vector (etiquetado) + escalado
├── DTF                 preparación textil (preflight + transparencia + etapas dtf)
├── DTF UV              mismo motor; capa blanca/barniz no fingidos
├── DOCUMENTOS          PDF digital → texto; raster sin OCR
└── PACK PRODUCCIÓN     ORIGINAL / DERIVADOS / PRINT / VECTOR / PRODUCTION / REPORT
```

### Quién puede usar cada capacidad

| Capacidad | Taller | Cliente de taller | Usuario independiente (misma identidad, otro contexto comercial) |
|---|---|---|---|
| EMPAQUETAR | sí | sí | no (es el vertical) |
| 16K | sí | sí | sí (preparado) |
| TPU | sí | sí (en pedido) | sí (mismos límites) |
| CDR → PDF | sí | sí | sí |
| Banderas | sí | sí | sí |
| Moldería | sí | sí | sí |
| Candy Bar | sí | sí | sí |
| Cubre maletas | sí | sí | sí |
| Diseño en lote | sí | sí | sí |
| Conversión de archivos | sí | sí | sí |
| DTF | sí | sí | sí |
| DTF UV | sí | sí | sí |
| Documentos | sí | sí | sí |
| Pack de producción | sí | sí | sí |

Identidad: el mismo `AuthContext`. `consumerKind` distingue `WORKSHOP_USER` vs `CAPABILITY_USER`. `commercialContext` distingue `WORKSHOP_LINKED` vs `INDEPENDENT`. No hay billing en este ciclo; el hook registra `tariffCode` y uso (bytes/duración) para Cloud.

Entradas HTTP (misma API, URIs opacas `cloud://artifacts/...`):

- `GET /ora/capabilities`
- `POST /ora/cdr-pdf`
- `POST /ora/flags`
- `POST /ora/pattern/search` · `POST /ora/pattern/resolve`
- `POST /ora/candy-bar`
- `POST /ora/luggage-cover`
- `POST /ora/batch`
- `POST /ora/16k/prepare`
- `GET /ora/files/intents`
- `POST /ora/files/analyze`
- `POST /ora/files/convert`
- `POST /ora/files/vectorize`
- `POST /ora/files/scale`
- `POST /ora/files/preflight`
- `POST /ora/files/prepare-print`
- `POST /ora/dtf`
- `POST /ora/dtf-uv`
- `POST /ora/documents`
- `POST /ora/pack`
- `POST /ora/tpu/prepare`
- `GET /ora/jobs/:id`

`FILE_CONVERSION` no destruye el original. El análisis no ejecuta transformaciones. La vectorización declara `VECTOR_REAL`, `VECTOR_ASSISTED` o `RASTER_EMBEDDED`. JPG/PNG envueltos en SVG/PDF **no** se presentan como vector real. 8K/16K se prepara, no se finge un motor cloud.

DTF / DTF UV reutilizan `flagFitness`, análisis PNG y las etapas `production-orchestration.dtf`. No hay segundo motor. DTF UV **no** genera placa blanca ni barniz UV.

Document intelligence extrae texto de PDF digital. No hay OCR: un escaneo o foto queda `REQUIERE_REVISION`. DOCX/XLSX no se generan sin paquete.

Storage: URI opaca `cloud://artifacts/...`. `MASCAYL_DATABASE_URL=postgres://` **no** cae en memoria. El driver `pg` y R2/S3 quedan pendientes de Cloud real (sin deploy de demostración).


Archivos: ORIGINAL nunca se sobrescribe. Los derivados quedan identificados. La traza usa `JOB_SUCCEEDED` existente.

16K: etapas `intake → prepare → process_16k → validate → output` con estado `PREPARED_NOT_EXECUTED`. Consumidores previstos: fotógrafo, diseñador, impresor, particular, taller, otros ORA. No está limitado al textil.

