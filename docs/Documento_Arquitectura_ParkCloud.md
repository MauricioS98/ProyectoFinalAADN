# Documento de Arquitectura de Datos en la Nube
## ParkCloud Colombia — Plataforma Cloud Híbrida y Transaccional ACID para Gestión Multisede de Parqueaderos

**Universidad Distrital Francisco José de Caldas — Facultad de Ingeniería**
**Proyecto Curricular de Ingeniería de Sistemas**
**Asignatura:** Arquitectura y Almacenamiento de Datos en la Nube (2026-3)
**Docente:** Ing. MBA José David Álvarez

**Autores:**
- Mauricio Sánchez Aguilar — `20212020045`
- Anderson Esteban Arévalo Rodríguez — `20222020063`
- Miguel Ángel Pedroza Vanegas — `20222020062`

**Proveedor de nube:** Microsoft Azure (suscripción *Azure for Students*)

> **Nota sobre equivalencias de nube.** La guía del proyecto usa ejemplos de AWS y Google Cloud (S3, Redshift, BigQuery, Glue, CloudTrail, CloudWatch). Este proyecto se implementa sobre **Microsoft Azure**. En cada sección se indica el servicio Azure equivalente al requisito de la guía. La tabla de equivalencias está en el Anexo A.

---

## Índice de Contenido

1. Introducción y Problemática
2. Arquitectura de Datos Propuesta
3. Flujo de Procesamiento (Pipeline de Datos)
4. Seguridad y Gobierno
5. Análisis Económico (FinOps)
6. Conclusiones y Recomendaciones
- Anexo A. Tabla de equivalencias de servicios de nube
- Anexo B. Estado de implementación (desplegado vs. propuesto)
- Anexo C. Evidencia de despliegue de la base operacional en Azure

---

## 1. Introducción y Problemática

### 1.1. Contexto del negocio

**ParkCloud Colombia** es una plataforma empresarial *full-stack* para centralizar, controlar y auditar en tiempo real la operación de una red de **5 sedes de parqueaderos urbanos en Bogotá D.C.** (Chapinero, Calle 100, Centro Internacional, Salitre Plaza y Usaquén). La capacidad instalada es de **200 cupos físicos por sede (1.000 cupos en total)**, operados sobre una grilla interactiva de **40 bahías numeradas por sede** (`#A-01` a `#D-40`).

El negocio gestiona tres clases de datos con requisitos distintos:

- **Datos transaccionales (OLTP):** ingresos y salidas de vehículos, cobros, cupos disponibles. Exigen consistencia estricta y baja latencia.
- **Datos no estructurados:** evidencias fotográficas LPR (*License Plate Recognition*). Alto volumen y requisitos legales de retención.
- **Datos analíticos (OLAP):** histórico de recaudo, ocupación y rotación, para tableros ejecutivos y decisiones de tarifas.

### 1.2. Volumen de datos esperado

| Clase de dato | Estimación | Observación |
| :--- | :--- | :--- |
| Estancias (OLTP) | ~1.000 cupos × varias rotaciones/día × 5 sedes | Crecimiento lineal diario; es el corazón transaccional. |
| Evidencias LPR (objetos) | ~1 imagen JPEG por estancia | Datos no estructurados, candidatos a *tiering* Hot/Cool/Archive. |
| Hechos analíticos (DWH) | 1 fila por estancia finalizada | Consolidación batch nocturna en esquema estrella. |
| Semilla de referencia | 5 sedes, 20 zonas, 200 celdas, 20 tarifas, 5 convenios, 300 clientes, 300 vehículos, 300 estancias | Datos de inicialización verificados en Azure (ver Anexo C). |

### 1.3. Problemática y retos a solucionar

1. **Inconsistencia de cupos y cobros por concurrencia.** Dos operadores podrían asignar la misma celda simultáneamente, o una misma cédula podría abrir dos estancias. Reto: integridad transaccional estricta bajo concurrencia.
2. **Acoplamiento tecnológico al entorno local.** La operación nació en PostgreSQL local + disco. Reto: migrar a la nube sin reescribir la lógica de negocio, evitando el *lock-in* de un proveedor.
3. **Silos de información y latencia analítica.** El dato transaccional y el analítico viven mezclados. Reto: separar OLTP de OLAP mediante un Data Lake y un Data Warehouse dimensional, sin degradar la operación.
4. **Cumplimiento legal y costos de almacenamiento de imágenes.** Las placas son datos personales (Ley Estatutaria 1581 de 2012 y Decreto 1377 de 2013). Reto: anonimizar para analítica, auditar accesos a evidencias y abaratar el almacenamiento de imágenes por *tiering* y ciclo de vida.
5. **Altos costos operativos.** Con crédito académico limitado ($100 USD de Azure for Students), el reto es un diseño FinOps que maximice la duración del crédito.

---

## 2. Arquitectura de Datos Propuesta

### 2.1. Topología general

La solución se diseña bajo **Arquitectura Hexagonal (Ports & Adapters)**: el núcleo de dominio no depende de ningún SDK de nube. El cambio de entorno local a Azure se hace **conmutando adaptadores por variables de entorno**, sin tocar la lógica de negocio. Esto responde directamente al reto 2 (desacoplamiento) y al reto de portabilidad entre nubes.

```
┌───────────────────────── Adaptadores de Entrada (Inbound) ─────────────────────────┐
│  SPA Angular 18 (Operador / Admin Sede / Admin Global / Visor ER)                   │
│                       │                                                              │
│          API REST Express (Node.js + TypeScript, puerto 4000)                        │
└───────────────────────┼──────────────────────────────────────────────────────────┘
                         ▼
┌───────────────────── Núcleo Hexagonal (Dominio + Aplicación) ──────────────────────┐
│  Reglas ACID, calculadora FinOps, invariantes de negocio (sin dependencia de nube)  │
└───────┬───────────────────────┬───────────────────────┬───────────────────────────┘
        ▼                       ▼                        ▼
 Puerto Repositorio      Puerto Almacenamiento     Puerto Data Lake Analítico
 (IParkingRepository)    de Objetos (IEvidence...)  (IAnalyticsLakePort)
        │                       │                        │
   ┌────┴────┐             ┌────┴────┐              ┌────┴────┐
   ▼         ▼             ▼         ▼              ▼         ▼
 Local    AZURE          Local    AZURE           Local    AZURE
 Disco  PostgreSQL     Disco    Blob Storage     Parquet  Data Lake
        Flexible Srv            LRS (Hot/Cool/    local    Gen2 +
        (OLTP ACID)             Archive)                   Synapse
```

### 2.2. Estrategia híbrida de almacenamiento (requisito obligatorio A)

La guía exige tres capas de almacenamiento según el tipo de dato. El proyecto las cubre así:

| Capa requerida por la guía | Implementación en el proyecto | Servicio Azure |
| :--- | :--- | :--- |
| **Base de datos operacional (OLTP)** | PostgreSQL 17 en 3FN con transacciones ACID, bloqueo pesimista e índices únicos parciales. **Desplegada en Azure.** | Azure Database for PostgreSQL — Flexible Server `Standard_B1ms` |
| **Almacenamiento no estructurado (Data Lake)** | Zonas *Medallion* Raw / Trusted / Refined para eventos crudos, Parquet limpio y agregados curados. Contenedores creados en ADLS Gen2 y metadatos poblados en `datalake_zonas_medallion`. **Desplegado en Azure.** | Azure Blob Storage LRS + Azure Data Lake Storage Gen2 (*hierarchical namespace*) |
| **Almacenamiento estructurado analítico (Data Warehouse)** | **Esquema estrella**: tabla de hechos `dw_fact_estancias_recaudo` (220 hechos cargados) + 5 dimensiones pobladas. **Desplegado en Azure** sobre PostgreSQL; Synapse serverless queda como capa de consulta opcional sobre los Parquet. | PostgreSQL (DWH dimensional) + Azure Synapse Analytics (consulta serverless, opcional) |

### 2.3. Modelo relacional operacional (3FN)

El motor OLTP está en Tercera Forma Normal, con 13 tablas. Entidades principales: `sedes`, `zonas_sede`, `celdas`, `tarifas`, `convenios_empresariales`, `clientes`, `vehiculos`, `estancias`, `pagos`, `evidencias_lpr`, `auditoria_evidencias`, `usuarios_sistema`, `cierres_batch_parquet`.

Relaciones clave:
- `sedes 1:N zonas_sede 1:N celdas` — organización física de cada parqueadero.
- `clientes 1:N vehiculos 1:N estancias` — una estancia liga vehículo, cliente, sede y celda.
- `estancias 1:1 pagos` — la liquidación de salida.
- `estancias 1:N evidencias_lpr 1:N auditoria_evidencias` — trazabilidad legal de las fotografías.

### 2.4. Modelo dimensional analítico (esquema estrella)

Definido en `database/04_datalake_dwh_iam_audit.sql`:

- **Tabla de hechos** `dw_fact_estancias_recaudo`: métricas aditivas (`minutos_permanencia`, `valor_bruto_cop`, `descuento_cop`, `subtotal_sin_iva_cop`, `iva_cop`, `total_recaudado_cop`) y llaves sustitutas (`sk_tiempo`, `sk_sede`, `sk_vehiculo`, `sk_convenio`, `sk_metodo_pago`).
- **5 dimensiones:** `dw_dim_tiempo`, `dw_dim_sede`, `dw_dim_vehiculo_anonimizado` (sin PII, solo `placa_hash_sha256`), `dw_dim_tarifa_convenio`, `dw_dim_metodo_pago`.

La separación OLTP/OLAP resuelve el reto 3 (silos y latencia analítica): las consultas masivas no golpean la base transaccional.

### 2.5. Justificación de la topología

- **PostgreSQL Flexible Server (B1ms Burstable)** frente a Managed Instance o Single Server: es la opción recomendada por Microsoft, la más barata para dev/académico, y permite **detener el cómputo** fuera de horario (clave para FinOps). Mantiene la versión 17 idéntica a la base local, reduciendo el riesgo de migración.
- **Data Lake Medallion (Raw/Trusted/Refined)** frente a un único bucket: separa responsabilidades (ingesta cruda, limpieza+anonimización, agregación curada), facilita reprocesos y aísla el cumplimiento Ley 1581 en la capa Trusted.
- **Esquema estrella** frente a copo de nieve: dimensiones desnormalizadas para consultas BI simples y rápidas, adecuado al volumen del proyecto.
- **Arquitectura hexagonal** frente a acoplar la lógica al SDK de Azure: permite volver a local o migrar a otra nube cambiando adaptadores; es la respuesta de diseño al reto de *lock-in*.

---

## 3. Flujo de Procesamiento (Pipeline de Datos)

El ciclo de vida del dato sigue las cuatro etapas exigidas: **Ingesta → Almacenamiento → Procesamiento → Consumo**.

### 3.1. Ingesta

- **Origen:** la operación transaccional (check-in, pre-liquidación, salida) escribe en PostgreSQL mediante procedimientos ACID.
- **Hacia el Data Lake:** una consolidación batch (nocturna) extrae las estancias finalizadas y las deposita en la zona **RAW** como eventos crudos (JSON/NDJSON comprimido GZIP). En Azure, la orquestación programada corresponde a **Azure Data Factory** (equivalente a AWS Glue / Cloud Dataflow de la guía).

### 3.2. Almacenamiento (zonas Medallion)

Registrado en la tabla `datalake_zonas_medallion`, con una fila por objeto y zona:

| Zona | Contenido | Formato | Anonimización |
| :--- | :--- | :--- | :--- |
| **RAW (Bronce)** | Eventos crudos + logs LPR | `JSON_NDJSON_RAW` (GZIP) | No |
| **TRUSTED (Plata)** | Estancias limpias, tipadas y con placa anonimizada | `PARQUET` columnar (Snappy) | **Sí (SHA-256)** |
| **REFINED (Oro)** | Agregados financieros curados para BI | `PARQUET` estrella (Snappy) | Sí |

### 3.3. Procesamiento (ETL serverless)

La transformación se implementa en la función `fn_ejecutar_pipeline_etl_estrella(p_id_sede)`, que ejecuta el pipeline completo `RAW → TRUSTED → REFINED → DWH estrella`:

- **Paso A:** pobla las dimensiones maestras (`dw_dim_sede`, `dw_dim_metodo_pago`, `dw_dim_tarifa_convenio`, `dw_dim_vehiculo_anonimizado`, `dw_dim_tiempo`).
- **Paso B:** carga la tabla de hechos `dw_fact_estancias_recaudo` solo con estancias en estado `FINALIZADA`, calculando subtotal, IVA (19%) y total recaudado.
- **Paso C:** registra los artefactos Parquet/JSON en las tres zonas del Data Lake.

En Azure, la computación de transformación corresponde a **Azure Data Factory / Synapse Spark pools** (equivalente serverless a Glue/Dataflow/Databricks de la guía). La función PL/pgSQL documenta la lógica de negocio del ETL de forma reproducible.

### 3.4. Consumo

- **Tableros operacionales (SPA Angular):** grilla de 40 celdas en tiempo real, mapas de calor espacial (`#A-01`–`#D-40`) y temporal (7 días × 18 horas).
- **Tablero ejecutivo multisede:** KPIs consolidados de las 5 sedes, consultados contra el esquema estrella.
- **Consulta analítica (OLAP):** cubo dimensional sobre `dw_fact_estancias_recaudo`, servido por Synapse SQL serverless en Azure.

---

## 4. Seguridad y Gobierno

Cubre los tres requisitos obligatorios de la guía: control de accesos (mínimo privilegio + IAM), cifrado at-rest / in-transit, y monitoreo/auditoría.

### 4.1. Control de accesos (IAM / RBAC, mínimo privilegio)

Autenticación respaldada por la tabla `usuarios_sistema` y la función `fn_hash_password_iam()`, que almacena la contraseña como **SHA-256 + salt** (`::PARKCLOUD_IAM_SALT_2026`). Cada usuario recibe una **política IAM en JSON** (`politica_iam_json`) de mínimo privilegio:

| Rol | Vistas permitidas | Alcance | Acciones denegadas |
| :--- | :--- | :--- | :--- |
| `OPERADOR_SEDE` | Solo Operador | Sede fija (ej. Chapinero) | `tarifas:Update`, `datalake:Export`, `dwh:QueryStarSchema`, `sedes:SwitchBranch` |
| `ADMIN_SEDE` | Solo Admin Sede | Sede asignada | Operación sobre otras sedes |
| `ADMIN_GLOBAL` | Admin Global + Modelo ER | Las 5 sedes | — (acceso completo controlado) |

En Azure, el control federado corresponde a **Microsoft Entra ID (RBAC)**, equivalente al IAM de la guía. Las políticas de bucket se expresan como recursos tipo `arn:cloud:storage:::parkcloud-datalake/<zona>/*`, mapeables a contenedores privados de Blob/ADLS Gen2.

### 4.2. Cifrado

- **En reposo (at-rest):** datos sensibles de clientes (documento, teléfono, correo) cifrados con **AES-256** mediante `pgp_sym_encrypt(...)` de la extensión `pgcrypto`, en la columna `clientes.datos_contacto_cifrados_aes256`. En Azure, el cifrado de volumen del servidor y las llaves se gestionan con **Azure Key Vault** (equivalente a KMS). Los objetos del Data Lake se marcan `AES-256-GCM (KMS / Key Vault)`.
- **En tránsito (in-transit):** todas las conexiones a PostgreSQL en Azure exigen **TLS** (`sslmode=require`), verificado durante la migración. La guía pide TLS; el proyecto documenta TLS 1.3.
- **Anonimización (Ley 1581):** las placas se transforman a `placa_hash_sha256` mediante `fn_hash_placa_ley1581()` antes de llegar a la capa analítica; el DWH nunca almacena la placa en claro.

### 4.3. Monitoreo y auditoría

- **Trazas de consumo:** tabla `auditoria_cloudtrail_eventos` que registra usuario, rol IAM, servicio origen, acción, recurso (`recurso_arn`), IP, latencia, bytes y estado HTTP. Es el equivalente funcional de **CloudTrail/CloudWatch** de la guía; en Azure corresponde a **Azure Monitor + Log Analytics**.
- **Auditoría legal de evidencias:** la tabla `auditoria_evidencias` obliga a registrar un código de tique de soporte y un motivo antes de desbloquear cualquier fotografía LPR, cumpliendo la Ley 1581 de 2012.
- **Durabilidad:** el *Write-Ahead Log (WAL)* de PostgreSQL 17 y los backups automáticos (7 días) de Flexible Server garantizan recuperación ante fallos.

### 4.4. Principios ACID (integridad transaccional)

Responde al reto 1. Implementados en `fn_registrar_ingreso_acido` y `fn_liquidar_salida_acida`:

- **Atomicidad:** todo el ingreso/salida ocurre en un bloque transaccional; cualquier validación fallida provoca `ROLLBACK` total.
- **Consistencia:** restricciones `CHECK` (p. ej. `cupos_disponibles >= 0`) e índices únicos parciales `idx_unica_celda_activa` y `idx_unico_vehiculo_activo`.
- **Aislamiento:** bloqueo pesimista `SELECT ... FOR UPDATE` serializa el acceso concurrente a una misma celda.
- **Durabilidad:** confirmación en disco vía WAL.

---

## 5. Análisis Económico (FinOps)

### 5.1. Estimación mensual de costos (Azure for Students, crédito $100 USD)

| Servicio Azure | SKU / Configuración | Costo 24/7 (USD/mes) | Con apagado programado (USD/mes) |
| :--- | :--- | :---: | :---: |
| Azure Database for PostgreSQL | Flexible Server Burstable `B1ms` (1 vCore, 2 GiB) | 12.41 | 3.60 |
| Almacenamiento SSD PostgreSQL | 32 GiB + backups 7 días | 3.68 | 3.68 |
| Azure Blob Storage LRS (LPR) | 150 GB en Hot/Cool/Archive | 2.18 | 0.95 |
| Azure Data Lake Gen2 + Synapse | 10 GB Parquet Snappy + Serverless SQL | 0.45 | 0.27 |
| Azure Container Apps / App Service | 0.5 vCPU, 1 GiB (*scale-to-zero*) | 2.60 | 0.00 |
| Microsoft Entra ID + Azure Monitor | RBAC Free + alertas de presupuesto | 0.00 | 0.00 |
| **TOTAL MENSUAL** | | **21.32** | **8.50** |

### 5.2. Estrategias de optimización financiera

1. **Apagado programado del cómputo** (23:30–05:30 COT): `az postgres flexible-server stop/start`. Reduce la factura de PostgreSQL de 12.41 a 3.60 USD/mes.
2. **Scale-to-zero** del backend en Container Apps fuera de horario operativo (2.60 → 0.00).
3. **Ciclo de vida del almacenamiento (tiering)** de evidencias LPR: Hot → Cool (30 días) → Archive (90 días) → purga (365 días). Reduce ~60% el costo por GB.
4. **Compresión Snappy/Parquet** en el Data Lake: menos GB almacenados y menos datos escaneados por Synapse serverless (que cobra por dato leído).
5. **SKU Burstable** en lugar de General Purpose: suficiente para la carga académica, a menor costo.

Con el perfil optimizado (**8.50 USD/mes**), el crédito de 100 USD sostiene el proyecto **~11.7 meses**.

---

## 6. Conclusiones y Recomendaciones

### 6.1. Conclusiones

1. La **arquitectura hexagonal** cumplió su objetivo: la migración de la base operacional a Azure se realizó cambiando configuración, sin modificar la lógica de dominio.
2. La **estrategia híbrida de almacenamiento** (OLTP relacional + Data Lake Medallion + DWH estrella) separa el mundo transaccional del analítico, eliminando los silos y la contención entre cargas OLTP y OLAP.
3. Los **principios ACID** (bloqueo pesimista e índices únicos parciales) resuelven de raíz la inconsistencia de cupos por concurrencia.
4. El **gobierno de datos** (IAM de mínimo privilegio, cifrado AES-256 at-rest, TLS in-transit, anonimización SHA-256 y auditoría) satisface tanto la rúbrica de seguridad como la Ley 1581 de 2012.
5. El **diseño FinOps** mantiene el costo por debajo del crédito académico, con un camino claro de optimización (apagado programado, scale-to-zero, tiering).

### 6.2. Estado de implementación

**Desplegado y verificado en Azure:**
- Base operacional PostgreSQL (Flexible Server, `parkcloud_db`, 3FN, funciones ACID, datos semilla).
- Data Lake sobre ADLS Gen2: contenedores `datalake-raw`, `datalake-trusted`, `datalake-refined`, `evidencias-lpr`, `analitica-parquet`, con política de ciclo de vida (Hot→Cool→Archive→purga).
- Data Warehouse dimensional (esquema estrella) poblado: 220 hechos y 5 dimensiones.
- Pipeline ETL ejecutado (`fn_ejecutar_pipeline_etl_estrella`): zonas Medallion y hechos cargados.
- Gobierno: cifrado AES-256 at-rest (300 clientes), TLS in-transit, IAM de mínimo privilegio, y monitoreo en Log Analytics con diagnostic logs de Storage y PostgreSQL.

Evidencia en el Anexo C.

**Propuesto (no desplegado), por diseño o restricción del plan académico:**
- Synapse Analytics como capa de consulta serverless sobre los Parquet (el DWH ya funciona en PostgreSQL; Synapse sería un optimizador de consulta opcional).
- Azure Data Factory como orquestador del ETL (la lógica ETL ya existe y se ejecuta vía `fn_ejecutar_pipeline_etl_estrella`).
- Backend en Container Apps (Modalidad C del README; no es requisito de la capa de datos).

### 6.3. Recomendaciones

1. **Montar Synapse serverless** sobre los Parquet del Data Lake cuando el plan lo permita, para consultas analíticas a escala sin cargar el OLTP.
2. **Orquestar el ETL con Data Factory** en lugar de la ejecución manual de la función PL/pgSQL.
3. **Rotar las credenciales** del administrador de PostgreSQL y almacenarlas en **Azure Key Vault** en lugar de en archivos `.env`.
4. **Habilitar alertas de presupuesto** en Azure Cost Management (50%, 80%, 95%) para no agotar el crédito.
5. **Automatizar el apagado/encendido** del cómputo con una Logic App programada.

---

## Anexo A. Tabla de equivalencias de servicios de nube

| Requisito de la guía (AWS / GCP) | Servicio equivalente en Azure (este proyecto) |
| :--- | :--- |
| Data Lake — buckets S3 / Cloud Storage | Azure Blob Storage LRS + Azure Data Lake Storage Gen2 |
| Data Warehouse — Redshift / BigQuery | Azure Synapse Analytics (serverless SQL) |
| BD operacional — RDS / Cloud SQL | Azure Database for PostgreSQL — Flexible Server |
| ETL — AWS Glue / Cloud Dataflow / Databricks | Azure Data Factory / Synapse Spark |
| IAM — roles y políticas | Microsoft Entra ID (RBAC) |
| Cifrado de llaves — KMS | Azure Key Vault |
| Auditoría — CloudTrail | Azure Monitor (activity logs) |
| Monitoreo — CloudWatch | Azure Monitor + Log Analytics |

## Anexo B. Estado de implementación (desplegado vs. propuesto)

| Componente | Estado | Evidencia |
| :--- | :--- | :--- |
| Grupo de recursos `rg-parkcloud-colombia-prod` | ✅ Desplegado | Anexo C |
| PostgreSQL Flexible Server (v17, B1ms, Canada Central) | ✅ Desplegado | Anexo C |
| Base `parkcloud_db` + esquema 3FN + funciones ACID + semilla | ✅ Desplegado y verificado | Anexo C |
| Extensión `pgcrypto` (cifrado AES-256) | ✅ Habilitada en el servidor | Anexo C |
| Conexión TLS (`sslmode=require`) | ✅ Verificada | Anexo C |
| Storage Account `stparkcloudbogotaear` (ADLS Gen2, LRS, TLS1.2, sin acceso público) | ✅ Desplegado | Anexo C |
| Contenedores Data Lake (Raw/Trusted/Refined) + evidencias + analítica | ✅ Desplegados (5 contenedores) | Anexo C |
| Política de ciclo de vida LPR (Hot→Cool→Archive→purga) | ✅ Aplicada | Anexo C |
| Data Warehouse dimensional (esquema estrella) | ✅ Desplegado y poblado (220 hechos + 5 dimensiones) | Anexo C |
| Pipeline ETL (`fn_ejecutar_pipeline_etl_estrella`) | ✅ Ejecutado (15 objetos Medallion) | Anexo C |
| Cifrado AES-256 at-rest (`pgp_sym_encrypt`) | ✅ Aplicado a 300 clientes | Anexo C |
| IAM / RBAC (Entra ID, mínimo privilegio) | ✅ Rol de datos asignado + políticas IAM JSON | Anexo C |
| Monitoreo (Log Analytics + diagnostic logs Storage y PostgreSQL) | ✅ Desplegado | Anexo C |
| Synapse serverless (capa de consulta) | 🟡 Propuesto (el DWH ya funciona en PostgreSQL) | — |
| Orquestación ETL en Data Factory | 🟡 Propuesto (ETL ya se ejecuta vía función PL/pgSQL) | — |
| Backend en Container Apps | 🟡 Propuesto (no es requisito de la capa de datos) | — |

## Anexo C. Evidencia de despliegue de la base operacional en Azure

**Infraestructura creada (Azure CLI):**
- Suscripción: *Azure for Students* (`anearevalor@udistrital.edu.co`).
- Grupo de recursos: `rg-parkcloud-colombia-prod`.
- Servidor: `pg-parkcloud-bogota-acid-ear.postgres.database.azure.com` — PostgreSQL 17, SKU `Standard_B1ms` (Burstable), región Canada Central, 32 GiB.
- Regla de firewall: habilitada para la IP del equipo de desarrollo.
- Parámetro `azure.extensions = PGCRYPTO` habilitado (requisito para el cifrado AES-256).
- Base de datos `parkcloud_db` (UTF8, `en_US.utf8`).

**Carga de scripts (psql con `sslmode=require`):**
- `01_schema_acid.sql` → esquema 3FN (tablas e índices) creado.
- `02_procedures_acid.sql` → 4 funciones PL/pgSQL creadas.
- `03_seed_bogota_5_sedes.sql` → datos semilla cargados (`COMMIT`).

**Verificación de conteos en Azure:**

| Tabla | Filas |
| :--- | :---: |
| sedes | 5 |
| zonas_sede | 20 |
| celdas | 200 |
| tarifas | 20 |
| convenios_empresariales | 5 |
| clientes | 300 |
| vehiculos | 300 |
| estancias | 300 |

**Funciones ACID verificadas:** `fn_registrar_ingreso_acido`, `fn_liquidar_salida_acida`, `fn_preliquidar_estancia`, `fn_hash_placa_ley1581`.

---

### C.2. Data Lake (ADLS Gen2)

- Cuenta de almacenamiento `stparkcloudbogotaear` — `StorageV2`, `Standard_LRS`, región Canada Central, *hierarchical namespace* activo (`isHnsEnabled: true`), sin acceso público, TLS 1.2 mínimo, HTTPS obligatorio.
- Contenedores creados: `datalake-raw`, `datalake-trusted`, `datalake-refined`, `evidencias-lpr`, `analitica-parquet`.
- Política de ciclo de vida `CicloVidaEvidenciasLey1581` sobre el prefijo `evidencias-lpr/`: Cool a 30 días, Archive a 90, purga a 365.

### C.3. Data Warehouse y ETL (verificación de conteos en Azure)

| Tabla | Filas |
| :--- | :---: |
| dw_fact_estancias_recaudo (tabla de hechos) | 220 |
| dw_dim_tiempo | 15 |
| dw_dim_sede | 5 |
| dw_dim_vehiculo_anonimizado | 300 |
| dw_dim_tarifa_convenio | 4 |
| dw_dim_metodo_pago | 5 |
| datalake_zonas_medallion (metadatos Raw/Trusted/Refined) | 15 |
| auditoria_cloudtrail_eventos | 4 |

### C.4. Gobierno verificado

- **Cifrado AES-256 at-rest:** 300 filas en `clientes` con `datos_contacto_cifrados_aes256` no nulo (cifrado con `pgp_sym_encrypt`, algoritmo `aes256`).
- **IAM:** rol `Storage Blob Data Contributor` asignado al usuario sobre la cuenta de storage (mínimo privilegio); políticas IAM JSON por rol (`OPERADOR_SEDE`, `ADMIN_SEDE`, `ADMIN_GLOBAL`) en `usuarios_sistema.politica_iam_json`.
- **Monitoreo:** workspace Log Analytics `log-parkcloud-monitor` (retención 30 días). Diagnostic settings `diag-storage-parkcloud` (StorageRead/Write/Delete + Transaction) y `diag-postgres-parkcloud` (PostgreSQLLogs + AllMetrics).
