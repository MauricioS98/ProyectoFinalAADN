-- =============================================================================
-- PARKCLOUD COLOMBIA - SEED DE DATOS REALISTAS (5 SEDES BOGOTÁ - ANTEPROYECTO)
-- Pobla sedes, zonas, celdas numeradas, tarifas, convenios, usuarios RBAC,
-- clientes, vehículos, estancias históricas (para mapas de calor) y estancias activas.
-- =============================================================================

BEGIN;

-- 1. LAS 5 SEDES DE BOGOTÁ DEFINIDAS EN EL ANTEPROYECTO
INSERT INTO sedes (id_sede, codigo_sede, nombre, ciudad, localidad, direccion, latitud, longitud, capacidad_total, cupos_disponibles, horario_operacion, estado) VALUES
(1, 'BOG-CHP-01', 'Sede Chapinero Financiero', 'Bogotá D.C.', 'Chapinero', 'Cra. 7 # 72-41, Bogotá', 4.656100, -74.055800, 200, 200, '05:00 - 23:00 (18h)', 'OPERATIVA'),
(2, 'BOG-C100-02', 'Sede Calle 100 Empresarial', 'Bogotá D.C.', 'Usaquén / Chicó', 'Calle 100 # 19-61, Bogotá', 4.686500, -74.051200, 200, 200, '05:00 - 23:00 (18h)', 'OPERATIVA'),
(3, 'BOG-CIN-03', 'Sede Centro Internacional', 'Bogotá D.C.', 'Santa Fe', 'Cra. 13 # 28-01, Bogotá', 4.616800, -74.068900, 200, 200, '05:00 - 23:00 (18h)', 'OPERATIVA'),
(4, 'BOG-SAL-04', 'Sede Ciudad Salitre Corporativo', 'Bogotá D.C.', 'Fontibón / Teusaquillo', 'Av. El Dorado # 68B-85, Bogotá', 4.658400, -74.108200, 200, 200, '05:00 - 23:00 (18h)', 'OPERATIVA'),
(5, 'BOG-USA-05', 'Sede Usaquén Plaza Comercial', 'Bogotá D.C.', 'Usaquén', 'Cra. 6 # 118-25, Bogotá', 4.695300, -74.030900, 200, 200, '05:00 - 23:00 (18h)', 'OPERATIVA');

SELECT setval('sedes_id_sede_seq', 5, true);

-- 2. ZONAS Y CELDAS NUMERADAS POR CADA SEDE (40 celdas interactivas por sede en grilla 5x8 = 200 celdas en red)
DO $$
DECLARE
    s INT;
    z_gen INT;
    z_vip INT;
    z_mot INT;
    z_ele INT;
    r INT;
    col INT;
    idx INT;
    v_pref VARCHAR;
    v_zona INT;
    v_tipo VARCHAR;
    v_num VARCHAR;
    v_rot INT;
    v_min INT;
BEGIN
    FOR s IN 1..5 LOOP
        INSERT INTO zonas_sede (id_sede, codigo_zona, nombre_zona, piso, tipo_zona, capacidad_zona)
        VALUES (s, 'Z-A', 'Nivel 1 - Automóviles General (Acceso Principal)', 1, 'GENERAL', 80)
        RETURNING id_zona INTO z_gen;

        INSERT INTO zonas_sede (id_sede, codigo_zona, nombre_zona, piso, tipo_zona, capacidad_zona)
        VALUES (s, 'Z-B', 'Nivel 1 - Convenios Corporativos & Camionetas', 1, 'CONVENIO_VIP', 50)
        RETURNING id_zona INTO z_vip;

        INSERT INTO zonas_sede (id_sede, codigo_zona, nombre_zona, piso, tipo_zona, capacidad_zona)
        VALUES (s, 'Z-C', 'Nivel 2 - Bahía Motocicletas', 2, 'MOTOS', 40)
        RETURNING id_zona INTO z_mot;

        INSERT INTO zonas_sede (id_sede, codigo_zona, nombre_zona, piso, tipo_zona, capacidad_zona)
        VALUES (s, 'Z-D', 'Nivel 2 - Carga Eléctrica EV & Preferencial', 2, 'ELECTRICOS_PCD', 30)
        RETURNING id_zona INTO z_ele;

        idx := 0;
        FOR r IN 1..5 LOOP
            FOR col IN 1..8 LOOP
                idx := idx + 1;
                IF r <= 2 THEN
                    v_pref := 'A';
                    v_zona := z_gen;
                    v_tipo := 'AUTOMOVIL';
                ELSIF r = 3 THEN
                    v_pref := 'B';
                    v_zona := z_vip;
                    v_tipo := 'CAMIONETA';
                ELSIF r = 4 THEN
                    v_pref := 'C';
                    v_zona := z_mot;
                    v_tipo := 'MOTOCICLETA';
                ELSE
                    v_pref := 'D';
                    v_zona := z_ele;
                    v_tipo := 'ELECTRICO';
                END IF;

                v_num := v_pref || '-' || LPAD((( (r - 1) * 8 ) + col)::TEXT, 2, '0');

                -- Gradiente realista de calor: las celdas más cercanas a la entrada (fila 1-2, col 1-4)
                -- tienen mayor rotación histórica que las del fondo
                v_rot := GREATEST(4, (55 - (r * 7) - (col * 3) + ((s * 5 + idx * 3) % 14)));
                v_min := v_rot * (42 + ((idx * 7 + s * 11) % 55));

                INSERT INTO celdas (
                    id_sede, id_zona, numero_celda, fila_grid, columna_grid,
                    tipo_vehiculo_permitido, estado, rotaciones_historicas, minutos_ocupacion_acumulados
                )
                VALUES (
                    s, v_zona, v_num, r, col,
                    v_tipo, 'DISPONIBLE', v_rot, v_min
                );
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- 3. TARIFAS OFICIALES BOGOTÁ 2026 POR SEDE Y TIPO DE VEHÍCULO
INSERT INTO tarifas (id_sede, tipo_vehiculo, valor_minuto_cop, tarifa_plena_dia_cop, valor_mensualidad_cop, recargo_nocturno_pct)
SELECT
    s.id_sede,
    t.tipo_vehiculo,
    t.val_min,
    t.plena,
    t.mensual,
    t.recargo
FROM sedes s
CROSS JOIN (
    VALUES
        ('AUTOMOVIL',   163.00, 42000.00, 320000.00, 10.00),
        ('CAMIONETA',   185.00, 48000.00, 360000.00, 10.00),
        ('MOTOCICLETA', 115.00, 26000.00, 175000.00,  5.00),
        ('ELECTRICO',   130.00, 34000.00, 250000.00,  0.00)
) AS t(tipo_vehiculo, val_min, plena, mensual, recargo);

-- 4. CONVENIOS EMPRESARIALES (Flotas corporativas del Anteproyecto)
INSERT INTO convenios_empresariales (id_convenio, nit_empresa, nombre_empresa, porcentaje_descuento, minutos_cortesia, cupo_credito_mensual_cop, saldo_consumido_mes_cop, activo) VALUES
(1, '860.002.964-4', 'Bancolombia S.A. - Banca Corporativa', 30.00, 30, 15000000, 4280000, TRUE),
(2, '899.999.068-1', 'Ecopetrol S.A. - Sede Principal', 25.00, 20, 12000000, 3150000, TRUE),
(3, '900.456.781-2', 'Globant Colombia - Hub Ingeniería', 35.00, 45,  9000000, 2640000, TRUE),
(4, '830.114.921-7', 'Clínica del Country & Colsanitas', 40.00, 60, 10000000, 3890000, TRUE),
(5, '899.999.230-7', 'Universidad Distrital FJC - Convenio Docente', 50.00, 60, 6000000, 1120000, TRUE);

SELECT setval('convenios_empresariales_id_convenio_seq', 5, true);

-- 5. USUARIOS DEL SISTEMA (Roles RBAC Microsoft Entra ID del Anteproyecto)
INSERT INTO usuarios_sistema (id_usuario, username, nombre_completo, email_institucional, rol_rbac, id_sede_asignada, entra_id_oid) VALUES
(1, 'msanchez.global', 'Mauricio Sánchez Aguilar', 'msancheza@udistrital.edu.co', 'ADMIN_GLOBAL', NULL, 'entra-oid-001-msa'),
(2, 'aarevalo.admin1', 'Anderson Esteban Arévalo Rodríguez', 'aearevalor@udistrital.edu.co', 'ADMIN_SEDE', 1, 'entra-oid-002-aea'),
(3, 'mpedroza.admin2', 'Miguel Ángel Pedroza Vanegas', 'mapedrozav@udistrital.edu.co', 'ADMIN_SEDE', 2, 'entra-oid-003-map'),
(4, 'recep.chapinero', 'Laura Valentina Gómez (Recepcionista Chapinero)', 'lvgomez.chp@parkcloud.co', 'OPERADOR_SEDE', 1, 'entra-oid-004-lvg'),
(5, 'recep.calle100',  'Carlos Andrés Rojas (Recepcionista Calle 100)',  'carojas.c100@parkcloud.co', 'OPERADOR_SEDE', 2, 'entra-oid-005-car'),
(6, 'recep.centro',    'Diana Marcela Pardo (Recepcionista Centro Int.)', 'dmpardo.cin@parkcloud.co', 'OPERADOR_SEDE', 3, 'entra-oid-006-dmp'),
(7, 'recep.salitre',   'Jorge Eliécer Vargas (Recepcionista Salitre)',   'jevargas.sal@parkcloud.co', 'OPERADOR_SEDE', 4, 'entra-oid-007-jev'),
(8, 'recep.usaquen',   'Camila Andrea Castro (Recepcionista Usaquén)',   'cacastro.usa@parkcloud.co', 'OPERADOR_SEDE', 5, 'entra-oid-008-cac'),
(9, 'auditor.ley1581', 'Dr. Hernando Torres (Oficial Habeas Data Ley 1581)', 'auditoria@parkcloud.co', 'AUDITOR_SEGURIDAD', 1, 'entra-oid-009-aud');

SELECT setval('usuarios_sistema_id_usuario_seq', 9, true);

-- 6. GENERAR ESTANCIAS HISTÓRICAS FINALIZADAS (Últimos 14 días en las 5 sedes para Mapas de Calor Horarios y Financieros)
DO $$
DECLARE
    i INT;
    v_sede INT;
    v_celda INT;
    v_placa VARCHAR;
    v_doc VARCHAR;
    v_nom VARCHAR;
    v_tipo VARCHAR;
    v_marca VARCHAR;
    v_color VARCHAR;
    v_mod VARCHAR;
    v_conv INT;
    v_id_cli INT;
    v_id_veh INT;
    v_id_est BIGINT;
    v_hora INT;
    v_dia_offset INT;
    v_ts_in TIMESTAMPTZ;
    v_ts_out TIMESTAMPTZ;
    v_mins INT;
    v_bruto NUMERIC(12,2);
    v_desc NUMERIC(12,2);
    v_neto NUMERIC(12,2);
    v_sub NUMERIC(12,2);
    v_iva NUMERIC(12,2);
    v_metodo VARCHAR;
    v_tier VARCHAR;
    v_marcas TEXT[] := ARRAY['Mazda CX-30', 'Renault Duster', 'Toyota Corolla', 'Chevrolet Onix', 'Kia Picanto', 'BYD Yuan Plus EV', 'Yamaha NMAX', 'BMW X3', 'Ford Ranger', 'Suzuki Swift'];
    v_colores TEXT[] := ARRAY['Gris Titán', 'Blanco Perlado', 'Negro Obsidiana', 'Rojo Diamante', 'Azul Naval', 'Plata Metálico'];
    v_nombres TEXT[] := ARRAY['Juan Sebastián Morales', 'María Fernanda Ospina', 'Andrés Felipe Castellanos', 'Paola Andrea Beltrán', 'Santiago Alejandro Ruiz', 'Natalia Ramírez Pineda', 'Camilo Ernesto Mendoza', 'Valentina Restrepo Cano', 'Daniel Alejandro Quiroga', 'Juliana Patricia Cortés', 'Nicolás David Murillo', 'Luisa Fernanda Velasco'];
    v_metodos TEXT[] := ARRAY['EFECTIVO', 'TARJETA_DEBITO_CREDITO', 'PSE_NEQUI_DAVIPLATA', 'CARGO_CONVENIO'];
    v_horas_pico INT[] := ARRAY[7,8,8,9,9,10,11,12,12,13,13,14,15,16,17,17,18,18,19,20,6,21];
BEGIN
    FOR i IN 1..220 LOOP
        v_sede := ((i - 1) % 5) + 1;
        v_dia_offset := (i % 14) + 1;
        v_hora := v_horas_pico[(i % array_length(v_horas_pico, 1)) + 1];
        v_mins := 35 + ((i * 19) % 165);

        v_ts_in := (CURRENT_DATE - (v_dia_offset || ' days')::INTERVAL) + (v_hora || ' hours')::INTERVAL + ((i % 50) || ' minutes')::INTERVAL;
        v_ts_out := v_ts_in + (v_mins || ' minutes')::INTERVAL;

        SELECT id_celda, tipo_vehiculo_permitido INTO v_celda, v_tipo
        FROM celdas
        WHERE id_sede = v_sede
        ORDER BY ((id_celda + i * 7) % 40)
        LIMIT 1;

        v_placa := CHR(65 + (i % 25)) || CHR(65 + ((i * 3) % 25)) || CHR(65 + ((i * 7) % 25)) || LPAD(((100 + i * 3) % 900 + 100)::TEXT, 3, '0');
        v_doc := (1010000000 + i * 14523)::TEXT;
        v_nom := v_nombres[(i % array_length(v_nombres, 1)) + 1];
        v_marca := v_marcas[(i % array_length(v_marcas, 1)) + 1];
        v_color := v_colores[(i % array_length(v_colores, 1)) + 1];

        IF (i % 4) = 0 THEN
            v_mod := 'CONVENIO_CORPORATIVO';
            v_conv := ((i % 5) + 1);
            v_metodo := 'CARGO_CONVENIO';
        ELSE
            v_mod := 'ROTATIVO';
            v_conv := NULL;
            v_metodo := v_metodos[(i % 3) + 1];
        END IF;

        INSERT INTO clientes (documento_identidad, nombre_completo, telefono, email, tipo_cliente, id_convenio)
        VALUES (v_doc, v_nom, '310' || LPAD((2000000 + i * 4321)::TEXT, 7, '0'), 'cliente' || i || '@correo.co', v_mod, v_conv)
        ON CONFLICT (documento_identidad) DO UPDATE SET nombre_completo = EXCLUDED.nombre_completo
        RETURNING id_cliente INTO v_id_cli;

        INSERT INTO vehiculos (placa, placa_hash_sha256, tipo_vehiculo, marca, color, id_cliente)
        VALUES (v_placa, fn_hash_placa_ley1581(v_placa), v_tipo, v_marca, v_color, v_id_cli)
        ON CONFLICT (placa) DO UPDATE SET marca = EXCLUDED.marca
        RETURNING id_vehiculo INTO v_id_veh;

        v_bruto := ROUND(v_mins * 163.0, -2);
        IF v_mod = 'CONVENIO_CORPORATIVO' THEN
            v_desc := ROUND(v_bruto * 0.30, -2);
        ELSE
            v_desc := 0;
        END IF;
        v_neto := GREATEST(2000, v_bruto - v_desc);
        v_sub := ROUND(v_neto / 1.19, 2);
        v_iva := v_neto - v_sub;

        INSERT INTO estancias (
            codigo_tique, id_sede, id_celda, id_vehiculo, id_cliente,
            id_operador_entrada, id_operador_salida, modalidad_tarifa,
            timestamp_entrada, timestamp_salida, minutos_permanencia,
            valor_bruto_cop, descuento_convenio_cop, valor_neto_pagar_cop,
            estado, latencia_transaccion_ms
        )
        VALUES (
            'PKC-H' || v_sede || '-' || LPAD(i::TEXT, 5, '0'),
            v_sede, v_celda, v_id_veh, v_id_cli,
            3 + v_sede, 3 + v_sede, v_mod,
            v_ts_in, v_ts_out, v_mins,
            v_bruto, v_desc, v_neto,
            'FINALIZADA', 22 + (i % 45)
        )
        RETURNING id_estancia INTO v_id_est;

        INSERT INTO pagos (
            id_estancia, id_sede, numero_comprobante, metodo_pago,
            subtotal_cop, iva_cop, total_pagado_cop, estado_pago, timestamp_pago
        )
        VALUES (
            v_id_est, v_sede, 'FAC-H' || v_sede || '-' || LPAD(i::TEXT, 6, '0'),
            v_metodo, v_sub, v_iva, v_neto, 'APROBADO', v_ts_out
        );

        -- Asignar tier según antigüedad simulada para demostrar el ciclo de vida Hot -> Cool -> Archive (Ley 1581)
        IF (i % 10) < 6 THEN
            v_tier := 'HOT';
        ELSIF (i % 10) < 9 THEN
            v_tier := 'COOL';
        ELSE
            v_tier := 'ARCHIVE';
        END IF;

        INSERT INTO evidencias_lpr (
            id_estancia, id_sede, momento_captura, uri_blob,
            proveedor_storage, tier_almacenamiento, tamano_kb, confianza_ocr_pct,
            checksum_sha256, fecha_captura
        )
        VALUES (
            v_id_est, v_sede, 'ENTRADA',
            'evidencias/2026/11/sede_' || v_sede || '/' || v_id_est || '.jpg',
            'LOCAL_DISK', v_tier, 285 + (i % 40), 98.20 + ((i % 17) * 0.1),
            encode(digest('HIST_' || v_id_est::TEXT, 'sha256'), 'hex'), v_ts_in
        );
    END LOOP;
END $$;

-- 7. CREAR ESTANCIAS ACTIVAS EN VIVO EN LAS 5 SEDES (Usando el Procedimiento Almacenado ACID real)
DO $$
DECLARE
    s INT;
    k INT;
    v_celda_id INT;
    v_tipo_v VARCHAR;
    v_placa_act VARCHAR;
    v_res RECORD;
    v_marcas_act TEXT[] := ARRAY['Toyota Fortuner', 'Mazda 3', 'BYD Seagull EV', 'Yamaha MT-03', 'Renault Arkana', 'Chevrolet Tracker', 'Kia Sportage', 'Volvo XC40 Recharge'];
    v_nombres_act TEXT[] := ARRAY['Carlos Eduardo Vargas', 'Laura Sofía Mendoza', 'Alejandro Gómez Díaz', 'Adriana Lucía Torres', 'Felipe Andrés Rojas', 'Mariana Castro Gil', 'Sebastián Ortiz Ríos', 'Claudia Patricia Mora'];
BEGIN
    FOR s IN 1..5 LOOP
        FOR k IN 1..(10 + s * 2) LOOP
            SELECT id_celda, tipo_vehiculo_permitido INTO v_celda_id, v_tipo_v
            FROM celdas
            WHERE id_sede = s AND estado = 'DISPONIBLE'
            ORDER BY ((fila_grid * 3 + columna_grid * 5 + k) % 37)
            LIMIT 1;

            IF v_celda_id IS NOT NULL THEN
                v_placa_act := 'K' || CHR(64 + s) || CHR(64 + k) || LPAD((300 + s * 30 + k)::TEXT, 3, '0');

                SELECT * INTO v_res FROM fn_registrar_ingreso_acido(
                    s,
                    v_celda_id,
                    v_placa_act,
                    v_tipo_v,
                    v_marcas_act[((k + s) % array_length(v_marcas_act, 1)) + 1],
                    'Gris Galena',
                    (1020300000 + s * 1000 + k)::TEXT,
                    v_nombres_act[((k + s) % array_length(v_nombres_act, 1)) + 1],
                    '315800' || LPAD((s * 100 + k)::TEXT, 4, '0'),
                    'activo' || s || '_' || k || '@empresa.co',
                    CASE WHEN (k % 3) = 0 THEN 'CONVENIO_CORPORATIVO' ELSE 'ROTATIVO' END,
                    CASE WHEN (k % 3) = 0 THEN ((k % 5) + 1) ELSE NULL END,
                    3 + s,
                    'Ingreso validado en talanquera LPR'
                );

                -- Retroceder la hora de entrada entre 18 y 145 minutos para que al probar la salida calcule tarifas reales de inmediato
                UPDATE estancias
                SET timestamp_entrada = NOW() - ((18 + k * 9 + s * 6) || ' minutes')::INTERVAL
                WHERE id_estancia = v_res.id_estancia_creada;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 8. POBLAR CIERRES BATCH NOCTURNOS PARQUET (Para Azure Data Lake Gen2 / Synapse Serverless)
INSERT INTO cierres_batch_parquet (fecha_cierre, id_sede, total_estancias_procesadas, ingresos_consolidados_cop, ocupacion_promedio_pct, uri_archivo_parquet, tamano_comprimido_kb, placas_anonimizadas_sha256) VALUES
(CURRENT_DATE - 2, 1, 512, 8450000, 78.40, 'datalake/parquet/2026/11/sede_1_cierre_snappy.parquet', 410, TRUE),
(CURRENT_DATE - 2, 2, 540, 9120000, 82.10, 'datalake/parquet/2026/11/sede_2_cierre_snappy.parquet', 435, TRUE),
(CURRENT_DATE - 2, 3, 488, 7640000, 71.50, 'datalake/parquet/2026/11/sede_3_cierre_snappy.parquet', 390, TRUE),
(CURRENT_DATE - 2, 4, 495, 8190000, 74.80, 'datalake/parquet/2026/11/sede_4_cierre_snappy.parquet', 398, TRUE),
(CURRENT_DATE - 2, 5, 530, 8890000, 80.20, 'datalake/parquet/2026/11/sede_5_cierre_snappy.parquet', 422, TRUE),
(CURRENT_DATE - 1, 1, 528, 8790000, 81.00, 'datalake/parquet/2026/11/sede_1_ayer_snappy.parquet', 425, TRUE),
(CURRENT_DATE - 1, 2, 556, 9480000, 85.30, 'datalake/parquet/2026/11/sede_2_ayer_snappy.parquet', 448, TRUE),
(CURRENT_DATE - 1, 3, 501, 7920000, 74.10, 'datalake/parquet/2026/11/sede_3_ayer_snappy.parquet', 402, TRUE),
(CURRENT_DATE - 1, 4, 510, 8350000, 76.90, 'datalake/parquet/2026/11/sede_4_ayer_snappy.parquet', 412, TRUE),
(CURRENT_DATE - 1, 5, 542, 9150000, 83.40, 'datalake/parquet/2026/11/sede_5_ayer_snappy.parquet', 438, TRUE);

-- 9. REGISTROS INICIALES DE AUDITORÍA DE EVIDENCIAS (Ley 1581 de 2012)
INSERT INTO auditoria_evidencias (id_evidencia, id_usuario_auditor, codigo_tique_soporte, motivo_inspeccion, ip_origen) VALUES
(1, 9, 'INC-2026-0841', 'Verificación de placa por reclamación de cobro en talanquera norte Chapinero', '192.168.10.24'),
(2, 2, 'INC-2026-0892', 'Inspección de ingreso autorizada por solicitud del titular (Ley 1581 Art. 14)', '192.168.10.12');

COMMIT;
