-- =============================================================================
-- PARKCLOUD COLOMBIA - MODELO DE DATOS RELACIONAL TRANSACCIONAL (ACID)
-- Asignatura: Arquitectura y Almacenamiento de Datos en la Nube (2026-3)
-- Autores: Mauricio Sánchez Aguilar, Anderson Esteban Arévalo, Miguel Ángel Pedroza
-- Motor Destino Local: PostgreSQL 15+  |  Motor Cloud Sprint 2: Azure PostgreSQL Flexible (B1ms)
-- =============================================================================

BEGIN;

-- Extensiones para UUID y funciones criptográficas (Ley 1581 de 2012 - SHA-256 con Salt)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Limpieza ordenada en caso de recreación de entorno
DROP TABLE IF EXISTS auditoria_evidencias CASCADE;
DROP TABLE IF EXISTS evidencias_lpr CASCADE;
DROP TABLE IF EXISTS pagos CASCADE;
DROP TABLE IF EXISTS estancias CASCADE;
DROP TABLE IF EXISTS abonos_mensuales CASCADE;
DROP TABLE IF EXISTS vehiculos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS convenios_empresariales CASCADE;
DROP TABLE IF EXISTS tarifas CASCADE;
DROP TABLE IF EXISTS celdas CASCADE;
DROP TABLE IF EXISTS zonas_sede CASCADE;
DROP TABLE IF EXISTS usuarios_sistema CASCADE;
DROP TABLE IF EXISTS cierres_batch_parquet CASCADE;
DROP TABLE IF EXISTS sedes CASCADE;

-- 1. TABLA: SEDES (Las 5 sedes de Bogotá definidas en el Anteproyecto)
CREATE TABLE sedes (
    id_sede SERIAL PRIMARY KEY,
    codigo_sede VARCHAR(16) NOT NULL UNIQUE,
    nombre VARCHAR(80) NOT NULL,
    ciudad VARCHAR(50) NOT NULL DEFAULT 'Bogotá D.C.',
    localidad VARCHAR(60) NOT NULL,
    direccion VARCHAR(140) NOT NULL,
    latitud NUMERIC(9,6) NOT NULL,
    longitud NUMERIC(9,6) NOT NULL,
    capacidad_total INT NOT NULL CHECK (capacidad_total > 0),
    cupos_disponibles INT NOT NULL,
    horario_operacion VARCHAR(40) NOT NULL DEFAULT '05:00 - 23:00 (18h)',
    estado VARCHAR(20) NOT NULL DEFAULT 'OPERATIVA' CHECK (estado IN ('OPERATIVA', 'MANTENIMIENTO', 'CERRADA')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Invariante ACID de Consistencia: jamás puede haber cupos negativos ni mayores a la capacidad instalada
    CONSTRAINT chk_cupos_coherentes CHECK (cupos_disponibles >= 0 AND cupos_disponibles <= capacidad_total)
);

-- 2. TABLA: ZONAS POR SEDE (Para estructurar el mapa de calor espacial del parqueadero)
CREATE TABLE zonas_sede (
    id_zona SERIAL PRIMARY KEY,
    id_sede INT NOT NULL REFERENCES sedes(id_sede) ON DELETE CASCADE,
    codigo_zona VARCHAR(10) NOT NULL,
    nombre_zona VARCHAR(60) NOT NULL,
    piso INT NOT NULL DEFAULT 1,
    tipo_zona VARCHAR(30) NOT NULL CHECK (tipo_zona IN ('GENERAL', 'CONVENIO_VIP', 'MOTOS', 'ELECTRICOS_PCD')),
    capacidad_zona INT NOT NULL CHECK (capacidad_zona > 0),
    UNIQUE (id_sede, codigo_zona)
);

-- 3. TABLA: CELDAS / CUPOS INDIVIDUALES (# del parqueadero seleccionable por el recepcionista)
CREATE TABLE celdas (
    id_celda SERIAL PRIMARY KEY,
    id_sede INT NOT NULL REFERENCES sedes(id_sede) ON DELETE CASCADE,
    id_zona INT NOT NULL REFERENCES zonas_sede(id_zona) ON DELETE CASCADE,
    numero_celda VARCHAR(12) NOT NULL,          -- Ej: 'A-01', 'A-02', ..., 'C-10'
    fila_grid INT NOT NULL,                     -- Coordenada Y para el Mapa de Calor visual
    columna_grid INT NOT NULL,                  -- Coordenada X para el Mapa de Calor visual
    tipo_vehiculo_permitido VARCHAR(20) NOT NULL DEFAULT 'AUTOMOVIL'
        CHECK (tipo_vehiculo_permitido IN ('AUTOMOVIL', 'CAMIONETA', 'MOTOCICLETA', 'ELECTRICO')),
    estado VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE'
        CHECK (estado IN ('DISPONIBLE', 'OCUPADA', 'RESERVADA', 'MANTENIMIENTO')),
    rotaciones_historicas INT NOT NULL DEFAULT 0 CHECK (rotaciones_historicas >= 0),
    minutos_ocupacion_acumulados INT NOT NULL DEFAULT 0 CHECK (minutos_ocupacion_acumulados >= 0),
    ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_sede, numero_celda)
);

-- 4. TABLA: TARIFAS POR SEDE Y TIPO DE VEHÍCULO
CREATE TABLE tarifas (
    id_tarifa SERIAL PRIMARY KEY,
    id_sede INT NOT NULL REFERENCES sedes(id_sede) ON DELETE CASCADE,
    tipo_vehiculo VARCHAR(20) NOT NULL CHECK (tipo_vehiculo IN ('AUTOMOVIL', 'CAMIONETA', 'MOTOCICLETA', 'ELECTRICO')),
    valor_minuto_cop NUMERIC(10,2) NOT NULL CHECK (valor_minuto_cop >= 0),
    tarifa_plena_dia_cop NUMERIC(12,2) NOT NULL CHECK (tarifa_plena_dia_cop >= 0),
    valor_mensualidad_cop NUMERIC(12,2) NOT NULL CHECK (valor_mensualidad_cop >= 0),
    recargo_nocturno_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    vigente BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (id_sede, tipo_vehiculo)
);

-- 5. TABLA: CONVENIOS EMPRESARIALES (Flotas corporativas y descuentos comerciales)
CREATE TABLE convenios_empresariales (
    id_convenio SERIAL PRIMARY KEY,
    nit_empresa VARCHAR(25) NOT NULL UNIQUE,
    nombre_empresa VARCHAR(100) NOT NULL,
    porcentaje_descuento NUMERIC(5,2) NOT NULL CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 100),
    minutos_cortesia INT NOT NULL DEFAULT 0 CHECK (minutos_cortesia >= 0),
    cupo_credito_mensual_cop NUMERIC(14,2) NOT NULL DEFAULT 5000000,
    saldo_consumido_mes_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- 6. TABLA: CLIENTES (Datos del conductor/propietario con protección Ley 1581 de 2012)
CREATE TABLE clientes (
    id_cliente SERIAL PRIMARY KEY,
    documento_identidad VARCHAR(25) NOT NULL UNIQUE,
    nombre_completo VARCHAR(120) NOT NULL,
    telefono VARCHAR(25) NOT NULL,
    email VARCHAR(120),
    tipo_cliente VARCHAR(25) NOT NULL DEFAULT 'ROTATIVO'
        CHECK (tipo_cliente IN ('ROTATIVO', 'CONVENIO_CORPORATIVO', 'ABONADO_MENSUAL')),
    id_convenio INT REFERENCES convenios_empresariales(id_convenio) ON DELETE SET NULL,
    acepta_habeas_data_ley1581 BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_consentimiento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. TABLA: VEHÍCULOS (Con Hash SHA-256 + Salt para anonimización en Data Lake según Anteproyecto)
CREATE TABLE vehiculos (
    id_vehiculo SERIAL PRIMARY KEY,
    placa VARCHAR(10) NOT NULL UNIQUE,
    placa_hash_sha256 VARCHAR(64) NOT NULL,     -- SHA-256(placa + salt) para Azure Synapse / Parquet
    tipo_vehiculo VARCHAR(20) NOT NULL CHECK (tipo_vehiculo IN ('AUTOMOVIL', 'CAMIONETA', 'MOTOCICLETA', 'ELECTRICO')),
    marca VARCHAR(50) NOT NULL DEFAULT 'Genérico',
    color VARCHAR(40) NOT NULL DEFAULT 'Gris',
    id_cliente INT REFERENCES clientes(id_cliente) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. TABLA: USUARIOS DEL SISTEMA Y GOBIERNO RBAC (Microsoft Entra ID / Local JWT)
CREATE TABLE usuarios_sistema (
    id_usuario SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    nombre_completo VARCHAR(100) NOT NULL,
    email_institucional VARCHAR(120) NOT NULL UNIQUE,
    rol_rbac VARCHAR(30) NOT NULL
        CHECK (rol_rbac IN ('ADMIN_GLOBAL', 'ADMIN_SEDE', 'OPERADOR_SEDE', 'AUDITOR_SEGURIDAD', 'ANALISTA_DATOS')),
    id_sede_asignada INT REFERENCES sedes(id_sede) ON DELETE SET NULL, -- NULL para ADMIN_GLOBAL
    entra_id_oid VARCHAR(64),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- 9. TABLA: ESTANCIAS TRANSACCIONALES (El corazón operativo de entrada/salida en talanquera)
CREATE TABLE estancias (
    id_estancia BIGSERIAL PRIMARY KEY,
    codigo_tique VARCHAR(24) NOT NULL UNIQUE,
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    id_celda INT NOT NULL REFERENCES celdas(id_celda),
    id_vehiculo INT NOT NULL REFERENCES vehiculos(id_vehiculo),
    id_cliente INT REFERENCES clientes(id_cliente),
    id_operador_entrada INT REFERENCES usuarios_sistema(id_usuario),
    id_operador_salida INT REFERENCES usuarios_sistema(id_usuario),
    modalidad_tarifa VARCHAR(25) NOT NULL DEFAULT 'ROTATIVO'
        CHECK (modalidad_tarifa IN ('ROTATIVO', 'CONVENIO_CORPORATIVO', 'ABONADO_MENSUAL')),
    timestamp_entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timestamp_salida TIMESTAMPTZ,
    minutos_permanencia INT CHECK (minutos_permanencia IS NULL OR minutos_permanencia >= 0),
    valor_bruto_cop NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento_convenio_cop NUMERIC(12,2) NOT NULL DEFAULT 0,
    valor_neto_pagar_cop NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA'
        CHECK (estado IN ('ACTIVA', 'FINALIZADA', 'ANULADA')),
    latencia_transaccion_ms INT NOT NULL DEFAULT 42,
    observaciones VARCHAR(250)
);

-- Índices únicos parciales (ACID):
-- 1) Impide que dos vehículos ocupen la misma celda al mismo tiempo
CREATE UNIQUE INDEX idx_unica_celda_activa ON estancias(id_celda) WHERE estado = 'ACTIVA';
-- 2) Impide que un mismo vehículo tenga dos estancias activas al mismo tiempo en la red
CREATE UNIQUE INDEX idx_unico_vehiculo_activo ON estancias(id_vehiculo) WHERE estado = 'ACTIVA';
-- 3) Impide que una misma persona (cliente / documento CC) alquile más de un parqueadero al mismo tiempo
CREATE UNIQUE INDEX idx_unico_cliente_activo ON estancias(id_cliente) WHERE estado = 'ACTIVA';
-- 4) Índices para consultas analíticas y mapas de calor sub-segundo
CREATE INDEX idx_estancias_sede_estado ON estancias(id_sede, estado);
CREATE INDEX idx_estancias_timestamp_entrada ON estancias(timestamp_entrada);

-- 10. TABLA: PAGOS Y FACTURACIÓN (Consistencia fuerte ACID para dinero)
CREATE TABLE pagos (
    id_pago BIGSERIAL PRIMARY KEY,
    id_estancia BIGINT NOT NULL UNIQUE REFERENCES estancias(id_estancia),
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    numero_comprobante VARCHAR(32) NOT NULL UNIQUE,
    metodo_pago VARCHAR(25) NOT NULL
        CHECK (metodo_pago IN ('EFECTIVO', 'TARJETA_DEBITO_CREDITO', 'PSE_NEQUI_DAVIPLATA', 'CARGO_CONVENIO', 'MENSUALIDAD_ACTIVA')),
    subtotal_cop NUMERIC(12,2) NOT NULL CHECK (subtotal_cop >= 0),
    iva_cop NUMERIC(12,2) NOT NULL CHECK (iva_cop >= 0),
    total_pagado_cop NUMERIC(12,2) NOT NULL CHECK (total_pagado_cop >= 0),
    estado_pago VARCHAR(20) NOT NULL DEFAULT 'APROBADO'
        CHECK (estado_pago IN ('APROBADO', 'PENDIENTE', 'RECHAZADO')),
    timestamp_pago TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. TABLA: EVIDENCIAS FOTOGRÁFICAS LPR (Punteros URI hacia Blob Storage / Disco Local + Ciclo de Vida Ley 1581)
CREATE TABLE evidencias_lpr (
    id_evidencia BIGSERIAL PRIMARY KEY,
    id_estancia BIGINT NOT NULL REFERENCES estancias(id_estancia) ON DELETE CASCADE,
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    momento_captura VARCHAR(15) NOT NULL DEFAULT 'ENTRADA' CHECK (momento_captura IN ('ENTRADA', 'SALIDA')),
    uri_blob VARCHAR(255) NOT NULL,             -- Formato: evidencias/año/mes/sede/id_estancia.jpg
    proveedor_storage VARCHAR(20) NOT NULL DEFAULT 'LOCAL_DISK'
        CHECK (proveedor_storage IN ('LOCAL_DISK', 'AZURE_BLOB_LRS')),
    tier_almacenamiento VARCHAR(15) NOT NULL DEFAULT 'HOT'
        CHECK (tier_almacenamiento IN ('HOT', 'COOL', 'ARCHIVE', 'PURGED')),
    tamano_kb INT NOT NULL DEFAULT 300,
    confianza_ocr_pct NUMERIC(5,2) NOT NULL DEFAULT 98.50,
    checksum_sha256 VARCHAR(64) NOT NULL,
    fecha_captura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_migracion_cool TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    fecha_migracion_archive TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    fecha_purga_ley1581 TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days')
);

-- 12. TABLA: AUDITORÍA DE ACCESO A EVIDENCIAS (Rol AuditorSeguridad - Ley 1581 de 2012)
CREATE TABLE auditoria_evidencias (
    id_auditoria BIGSERIAL PRIMARY KEY,
    id_evidencia BIGINT NOT NULL REFERENCES evidencias_lpr(id_evidencia),
    id_usuario_auditor INT NOT NULL REFERENCES usuarios_sistema(id_usuario),
    codigo_tique_soporte VARCHAR(40) NOT NULL,
    motivo_inspeccion VARCHAR(250) NOT NULL,
    ip_origen VARCHAR(45) NOT NULL DEFAULT '127.0.0.1',
    timestamp_inspeccion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. TABLA: CIERRES BATCH NOCTURNOS PARQUET (Azure Data Lake Storage Gen2 / Synapse Serverless)
CREATE TABLE cierres_batch_parquet (
    id_cierre SERIAL PRIMARY KEY,
    fecha_cierre DATE NOT NULL,
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    total_estancias_procesadas INT NOT NULL,
    ingresos_consolidados_cop NUMERIC(14,2) NOT NULL,
    ocupacion_promedio_pct NUMERIC(5,2) NOT NULL,
    uri_archivo_parquet VARCHAR(255) NOT NULL,
    tamano_comprimido_kb INT NOT NULL,
    placas_anonimizadas_sha256 BOOLEAN NOT NULL DEFAULT TRUE,
    timestamp_ejecucion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha_cierre, id_sede)
);

COMMIT;
