import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParkCloudApiService } from './services/parkcloud-api.service';

export type VistaActiva = 'OPERADOR_SEDE' | 'ADMIN_SEDE' | 'ADMIN_GLOBAL' | 'MODELO_ER';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['../styles.css'],
  encapsulation: ViewEncapsulation.None,
})
export class AppComponent implements OnInit, OnDestroy {
  vistaActiva: VistaActiva = 'OPERADOR_SEDE';
  idSedeSeleccionada = 1;
  modoVisualizacionGrilla: 'OPERATIVO' | 'MAPA_CALOR' = 'OPERATIVO';
  cargando = false;
  mensajeExito = '';
  mensajeError = '';

  // Autenticación IAM con Contraseña Hasheada (SHA-256 + Salt) y Control de Vistas por Rol
  usuarioAutenticado: any = null;
  loginForm = {
    identificador: 'lvgomez.chp@parkcloud.co',
    password: 'Park2026*',
  };
  loginError = '';
  iniciandoSesion = false;

  // Estado de Data Lake Medallion (Raw/Trusted/Refined), Data Warehouse Estrella, ETL y CloudTrail
  estadoDataLakeDWH: any = null;
  ejecutandoETL = false;
  zonaMedallionFiltro: 'TODAS' | 'RAW' | 'TRUSTED' | 'REFINED' = 'TODAS';

  // Cronómetro en vivo para estancias activas (el tiempo sigue corriendo mientras no se liquide el pago)
  private relojInterval: any = null;
  tiempoCorriendoTexto = '00m 00s';
  calculoPagoAbierto = true;

  // Datos cargados desde el Backend Hexagonal + PostgreSQL ACID
  dashboardGlobal: any = null;
  dashboardSede: any = null;

  // Celda seleccionada en la grilla interactiva (# del parqueadero)
  celdaSeleccionada: any = null;

  // Formulario de Entrada (Cuando la celda seleccionada está DISPONIBLE)
  formIngreso = {
    placa: '',
    tipo_vehiculo: 'AUTOMOVIL',
    marca: '',
    color: '',
    documento_cliente: '',
    nombre_cliente: '',
    telefono_cliente: '',
    email_cliente: '',
    modalidad_tarifa: 'ROTATIVO',
    id_convenio: null as number | null,
    observaciones: '',
  };

  // Estado de Pre-liquidación y Salida (Cuando la celda seleccionada está OCUPADA)
  preliquidacionActual: any = null;
  mostrarFormularioAgregarPago = false;
  metodoPagoSeleccionado = 'EFECTIVO';
  efectivoRecibidoCOP = 100000;
  referenciaPagoTransferencia = '';
  fotoComprobanteDataUrl = '';
  camaraActiva = false;
  private streamCamara: any = null;
  ultimoReciboEmitido: any = null;

  // Modal de Auditoría Ley 1581 (Inspección justificada de evidencia LPR)
  evidenciaSeleccionadaAudit: any = null;
  formAuditoria = {
    codigo_tique_soporte: 'INC-2026-0915',
    motivo_inspeccion: 'Verificación de placa solicitada por titular bajo Ley 1581 de 2012',
  };
  evidenciaDesbloqueadaId: number | null = null;

  readonly diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  readonly horasOperacion = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

  // Metadatos del Modelo ER (13 Tablas ACID) para el visor integrado
  readonly tablasModeloER = [
    {
      nombre: '1. sedes',
      pk: 'id_sede (SERIAL PK)',
      fk: '-',
      atributos: 'codigo_sede UNIQUE, nombre, localidad, direccion, capacidad_total (200), cupos_disponibles, horario_operacion',
      reglaAcid: 'CHECK (cupos_disponibles BETWEEN 0 AND capacidad_total) + Bloqueo FOR UPDATE en ingresos/salidas',
      color: '#0066FF',
    },
    {
      nombre: '2. zonas_sede',
      pk: 'id_zona (SERIAL PK)',
      fk: 'id_sede -> sedes(id_sede)',
      atributos: 'codigo_zona (Z-A..Z-D), nombre_zona, piso, tipo_zona (GENERAL, CONVENIO_VIP, MOTOS, ELECTRICOS_PCD)',
      reglaAcid: 'UNIQUE (id_sede, codigo_zona) ON DELETE CASCADE',
      color: '#0284C7',
    },
    {
      nombre: '3. celdas (# Parqueadero)',
      pk: 'id_celda (SERIAL PK)',
      fk: 'id_sede -> sedes, id_zona -> zonas_sede',
      atributos: 'numero_celda (A-01..D-40), fila_grid, columna_grid, tipo_vehiculo_permitido, estado, rotaciones_historicas, minutos_ocupacion_acumulados',
      reglaAcid: 'Bloqueo pesimista SELECT ... FOR UPDATE al asignar cupo para evitar condición de carrera',
      color: '#10B981',
    },
    {
      nombre: '4. clientes (Ley 1581)',
      pk: 'id_cliente (SERIAL PK)',
      fk: 'id_convenio -> convenios_empresariales',
      atributos: 'documento_identidad UNIQUE, nombre_completo, telefono, email, tipo_cliente, acepta_habeas_data_ley1581, fecha_consentimiento',
      reglaAcid: 'Trazabilidad de consentimiento expreso de Habeas Data (Ley Estatutaria 1581 de 2012)',
      color: '#8B5CF6',
    },
    {
      nombre: '5. vehiculos',
      pk: 'id_vehiculo (SERIAL PK)',
      fk: 'id_cliente -> clientes(id_cliente)',
      atributos: 'placa UNIQUE, placa_hash_sha256 (SHA-256 + Salt), tipo_vehiculo, marca, color',
      reglaAcid: 'fn_hash_placa_ley1581() genera hash irreversible para analítica en Azure Data Lake / Synapse',
      color: '#6366F1',
    },
    {
      nombre: '6. estancias (Core ACID)',
      pk: 'id_estancia (BIGSERIAL PK)',
      fk: 'id_sede, id_celda, id_vehiculo, id_cliente, id_operador_entrada',
      atributos: 'codigo_tique UNIQUE, modalidad_tarifa, timestamp_entrada, timestamp_salida, minutos_permanencia, valor_neto_pagar_cop, estado',
      reglaAcid: 'Índices únicos parciales: UNIQUE(id_celda) WHERE ACTIVA y UNIQUE(id_vehiculo) WHERE ACTIVA',
      color: '#EF4444',
    },
    {
      nombre: '7. pagos (Inmutable)',
      pk: 'id_pago (BIGSERIAL PK)',
      fk: 'id_estancia UNIQUE -> estancias, id_sede -> sedes',
      atributos: 'numero_comprobante UNIQUE, metodo_pago, subtotal_cop, iva_cop (19%), total_pagado_cop, estado_pago, timestamp_pago',
      reglaAcid: 'Consistencia fuerte monetaria: se inserta en la misma transacción atómica que libera la celda',
      color: '#F59E0B',
    },
    {
      nombre: '8. evidencias_lpr (Blob URI)',
      pk: 'id_evidencia (BIGSERIAL PK)',
      fk: 'id_estancia -> estancias, id_sede -> sedes',
      atributos: 'uri_blob (evidencias/año/mes/sede/id.jpg), proveedor_storage, tier_almacenamiento (HOT/COOL/ARCHIVE/PURGED), checksum_sha256',
      reglaAcid: 'Ciclo de vida automatizado: Hot (0-30d) -> Cool (31-90d) -> Archive (91-365d) -> Purga (365d)',
      color: '#14B8A6',
    },
    {
      nombre: '9. auditoria_evidencias',
      pk: 'id_auditoria (BIGSERIAL PK)',
      fk: 'id_evidencia -> evidencias_lpr, id_usuario_auditor -> usuarios_sistema',
      atributos: 'codigo_tique_soporte, motivo_inspeccion, ip_origen, timestamp_inspeccion',
      reglaAcid: 'Registro inmutable obligatorio antes de visualizar fotografías protegidas por Ley 1581',
      color: '#EC4899',
    },
    {
      nombre: '10. cierres_batch_parquet',
      pk: 'id_cierre (SERIAL PK)',
      fk: 'id_sede -> sedes(id_sede)',
      atributos: 'fecha_cierre, total_estancias_procesadas, ingresos_consolidados_cop, uri_archivo_parquet, placas_anonimizadas_sha256',
      reglaAcid: 'UNIQUE (fecha_cierre, id_sede) para ingesta idempotente hacia Azure Data Lake Storage Gen2',
      color: '#3B82F6',
    },
  ];

  // Metadatos del Modelo Analítico Dimensional (Esquema Estrella - Data Warehouse)
  readonly tablasEsquemaEstrella = [
    {
      nombre: 'FACT: dw_fact_estancias_recaudo',
      tipo: 'TABLA DE HECHOS CENTRAL',
      pk: 'id_hecho_estancia (BIGSERIAL PK)',
      fk: 'sk_tiempo, sk_sede, sk_vehiculo, sk_tarifa, sk_metodo_pago',
      metricas: 'minutos_permanencia, recaudo_bruto_cop, descuento_otorgado_cop, iva_recaudado_cop, recaudo_neto_cop, rotacion_celda_unidades',
      color: '#F59E0B',
    },
    {
      nombre: 'DIM 1: dw_dim_tiempo',
      tipo: 'DIMENSIÓN TEMPORAL',
      pk: 'sk_tiempo (SERIAL PK)',
      fk: 'Referenciada por dw_fact_estancias_recaudo(sk_tiempo)',
      metricas: 'fecha, anio, mes, nombre_mes, dia_semana, nombre_dia, hora_dia, franja_horaria (PICO_MANANA, VALLE_TARDE, PICO_TARDE_NOCHE)',
      color: '#0284C7',
    },
    {
      nombre: 'DIM 2: dw_dim_sede',
      tipo: 'DIMENSIÓN GEOGRÁFICA',
      pk: 'sk_sede (SERIAL PK)',
      fk: 'Referenciada por dw_fact_estancias_recaudo(sk_sede)',
      metricas: 'id_sede_nk, codigo_sede, nombre_sede, localidad, ciudad, capacidad_instalada (200 cupos)',
      color: '#10B981',
    },
    {
      nombre: 'DIM 3: dw_dim_vehiculo_anonimizado',
      tipo: 'DIMENSIÓN LEY 1581 (SHA-256)',
      pk: 'sk_vehiculo (SERIAL PK)',
      fk: 'Referenciada por dw_fact_estancias_recaudo(sk_vehiculo)',
      metricas: 'placa_hash_sha256 UNIQUE (Sin PII), tipo_vehiculo, marca_homologada, gama_color',
      color: '#8B5CF6',
    },
    {
      nombre: 'DIM 4: dw_dim_tarifa_convenio',
      tipo: 'DIMENSIÓN COMERCIAL',
      pk: 'sk_tarifa (SERIAL PK)',
      fk: 'Referenciada por dw_fact_estancias_recaudo(sk_tarifa)',
      metricas: 'modalidad_tarifa, nombre_convenio, porcentaje_descuento, cobra_minimo_15min ($2.000 COP)',
      color: '#EC4899',
    },
    {
      nombre: 'DIM 5: dw_dim_metodo_pago',
      tipo: 'DIMENSIÓN FINANCIERA',
      pk: 'sk_metodo_pago (SERIAL PK)',
      fk: 'Referenciada por dw_fact_estancias_recaudo(sk_metodo_pago)',
      metricas: 'metodo_pago (EFECTIVO, PSE_NEQUI_DAVIPLATA, TARJETA, CONVENIO), canal_recaudo, requiere_conciliacion_bancaria',
      color: '#14B8A6',
    },
  ];

  constructor(private readonly api: ParkCloudApiService) {}

  ngOnInit(): void {
    this.recargarTodo();
    this.relojInterval = setInterval(() => {
      this.actualizarCronometroEnVivo();
    }, 1000);
  }

  seleccionarCredencialRapida(identificador: string): void {
    this.loginForm.identificador = identificador;
    this.loginForm.password = 'Park2026*';
    this.loginError = '';
  }

  iniciarSesionIAM(): void {
    if (!this.loginForm.identificador || !this.loginForm.password) {
      this.loginError = 'Ingresa usuario/correo institucional y contraseña.';
      return;
    }
    this.iniciandoSesion = true;
    this.loginError = '';
    this.api.loginIAM(this.loginForm.identificador, this.loginForm.password).subscribe({
      next: (res) => {
        this.iniciandoSesion = false;
        if (res.autenticado && res.usuario) {
          this.usuarioAutenticado = res.usuario;
          this.vistaActiva = res.usuario.vista_inicial as VistaActiva;
          if (res.usuario.id_sede_asignada) {
            this.idSedeSeleccionada = Number(res.usuario.id_sede_asignada);
          }
          this.recargarTodo();
          this.mostrarExito(
            `Sesión IAM iniciada: ${res.usuario.nombre_completo} [${res.usuario.rol}] | Hash SHA-256 verificado.`
          );
        } else {
          this.loginError = res.mensaje || 'No se pudo autenticar.';
        }
      },
      error: (err) => {
        this.iniciandoSesion = false;
        this.loginError = err?.error?.mensaje || 'Credenciales inválidas (verificación SHA-256 + Salt fallida).';
      },
    });
  }

  cerrarSesionIAM(): void {
    this.usuarioAutenticado = null;
    this.limpiarAlertas();
  }

  tieneAccesoVista(vista: VistaActiva): boolean {
    if (!this.usuarioAutenticado) return false;
    const autorizadas: string[] = this.usuarioAutenticado.vistas_autorizadas || [];
    return autorizadas.includes(vista);
  }

  puedeCambiarSede(): boolean {
    if (!this.usuarioAutenticado) return false;
    return this.usuarioAutenticado.rol === 'ADMIN_GLOBAL' || !this.usuarioAutenticado.id_sede_asignada;
  }

  ngOnDestroy(): void {
    if (this.relojInterval) {
      clearInterval(this.relojInterval);
    }
  }

  private actualizarCronometroEnVivo(): void {
    // Actualizar reloj de todas las estancias activas y de la celda ocupada seleccionada
    const ahora = Date.now();
    if (this.dashboardSede?.estancias_activas) {
      for (const est of this.dashboardSede.estancias_activas) {
        if (est.timestamp_entrada) {
          const segs = Math.max(1, Math.floor((ahora - new Date(est.timestamp_entrada).getTime()) / 1000));
          est.minutos_actuales = Math.max(1, Math.ceil(segs / 60));
          est.reloj_vivo = `${Math.floor(segs / 60)}m ${String(segs % 60).padStart(2, '0')}s`;
        }
      }
    }

    if (this.celdaSeleccionada?.estado === 'OCUPADA' && this.celdaSeleccionada?.estancia_activa) {
      const ts = new Date(this.celdaSeleccionada.estancia_activa.timestamp_entrada).getTime();
      const segs = Math.max(1, Math.floor((ahora - ts) / 1000));
      const mins = Math.max(1, Math.ceil(segs / 60));
      const h = Math.floor(segs / 3600);
      const m = Math.floor((segs % 3600) / 60);
      const s = segs % 60;
      this.tiempoCorriendoTexto =
        h > 0
          ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
          : `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;

      // Si tenemos preliquidación abierta, actualizar minutos y monto en vivo mientras no se haya pagado
      if (this.preliquidacionActual) {
        const valMin = Number(this.preliquidacionActual.valor_minuto_aplicado_cop || 163);
        const mod = this.preliquidacionActual.modalidad_tarifa;
        const bruto =
          mod === 'ABONADO_MENSUAL' || mod === 'MENSUALIDAD'
            ? 0
            : mins <= 15
            ? 2000
            : 2000 + (mins - 15) * valMin;
        const desc = mod === 'CONVENIO_CORPORATIVO' ? Math.round(bruto * 0.25) : 0;
        const neto = Math.round((bruto - desc) / 100) * 100;
        const sub = Math.round(neto / 1.19);
        const iva = neto - sub;

        this.preliquidacionActual.minutos_transcurridos = mins;
        this.preliquidacionActual.valor_bruto_cop = bruto;
        this.preliquidacionActual.valor_descuento_cop = desc;
        this.preliquidacionActual.valor_iva_cop = iva;
        this.preliquidacionActual.valor_neto_pagar_cop = neto;
      }
    }
  }

  private construirPreliquidacionInmediata(celda: any): any {
    const est = celda.estancia_activa;
    const segs = Math.max(1, Math.floor((Date.now() - new Date(est.timestamp_entrada).getTime()) / 1000));
    const mins = Math.max(1, Math.ceil(segs / 60));
    const tipo = celda.tipo_vehiculo_permitido || 'AUTOMOVIL';
    const tarifaSede = this.dashboardSede?.tarifas?.find((t: any) => t.tipo_vehiculo === tipo);
    const valMin = Number(tarifaSede?.valor_minuto_cop || 163);
    const mod = est.modalidad_tarifa || 'ROTATIVO';
    const bruto =
      mod === 'ABONADO_MENSUAL' || mod === 'MENSUALIDAD'
        ? 0
        : mins <= 15
        ? 2000
        : 2000 + (mins - 15) * valMin;
    const desc = mod === 'CONVENIO_CORPORATIVO' ? Math.round(bruto * 0.25) : 0;
    const neto = Math.round((bruto - desc) / 100) * 100;
    const sub = Math.round(neto / 1.19);
    const iva = neto - sub;

    return {
      id_estancia: est.id_estancia,
      codigo_tique: est.codigo_tique,
      placa: est.placa,
      tipo_vehiculo: tipo,
      nombre_cliente: est.nombre_cliente || 'Cliente Rotativo',
      documento_cliente: est.documento_cliente || 'N/A',
      numero_celda: celda.numero_celda,
      modalidad_tarifa: mod,
      timestamp_entrada: est.timestamp_entrada,
      minutos_transcurridos: mins,
      valor_minuto_aplicado_cop: valMin,
      valor_bruto_cop: bruto,
      valor_descuento_cop: desc,
      subtotal_sin_iva_cop: sub,
      valor_iva_cop: iva,
      valor_neto_pagar_cop: neto,
    };
  }

  recargarTodo(): void {
    this.cargando = true;
    this.api.obtenerDashboardGlobal().subscribe({
      next: (glob) => {
        this.dashboardGlobal = glob;
        this.cargarSede(this.idSedeSeleccionada);
        this.cargarEstadoDataLakeYDWH();
      },
      error: (err) => {
        this.mostrarError('Error conectando con el Backend Hexagonal en localhost:4000: ' + (err?.error?.error || err.message));
        this.cargando = false;
      },
    });
  }

  cargarEstadoDataLakeYDWH(): void {
    this.api.obtenerEstadoDataLakeYDWH().subscribe({
      next: (data) => {
        this.estadoDataLakeDWH = data;
      },
      error: () => {
        // Silencioso si se está inicializando
      },
    });
  }

  dispararPipelineETLMedallionEstrella(idSede?: number): void {
    this.ejecutandoETL = true;
    this.api.ejecutarPipelineETL(idSede, this.usuarioAutenticado?.email).subscribe({
      next: (res) => {
        this.ejecutandoETL = false;
        this.mostrarExito(
          `Pipeline ETL Serverless completado (${res.latencia_etl_ms || 142} ms): OLTP -> Raw -> Trusted -> Refined -> Data Warehouse Estrella (${res.total_hechos_dwh || 222} hechos sincronizados).`
        );
        this.recargarTodo();
      },
      error: (err) => {
        this.ejecutandoETL = false;
        this.mostrarError(err?.error?.error || 'Error ejecutando Pipeline ETL Medallion -> Estrella');
      },
    });
  }

  obtenerObjetosDataLakeFiltrados(): any[] {
    const lista = this.estadoDataLakeDWH?.datalake_medallion?.objetos || [];
    if (this.zonaMedallionFiltro === 'TODAS') return lista;
    return lista.filter((o: any) => o.zona_datalake === this.zonaMedallionFiltro);
  }

  cargarSede(idSede: number): void {
    if (this.usuarioAutenticado && !this.puedeCambiarSede() && Number(idSede) !== Number(this.usuarioAutenticado.id_sede_asignada)) {
      this.mostrarError(`Política IAM de Mínimo Privilegio: Tu rol (${this.usuarioAutenticado.rol}) solo tiene acceso a tu sede asignada.`);
      return;
    }
    this.idSedeSeleccionada = Number(idSede);
    this.api.obtenerDashboardSede(this.idSedeSeleccionada).subscribe({
      next: (data) => {
        this.dashboardSede = data;
        this.cargando = false;
        if (this.celdaSeleccionada) {
          const updated = data.celdas_mapa_calor.find((c: any) => c.id_celda === this.celdaSeleccionada.id_celda);
          if (updated) {
            this.seleccionarCelda(updated, false);
          } else if (data.celdas_mapa_calor.length > 0) {
            this.seleccionarCelda(data.celdas_mapa_calor[0], false);
          }
        } else if (data.celdas_mapa_calor.length > 0) {
          this.seleccionarCelda(data.celdas_mapa_calor[0], false);
        }
      },
      error: (err) => {
        this.mostrarError(err?.error?.error || 'No se pudo cargar la sede');
        this.cargando = false;
      },
    });
  }

  cambiarVista(vista: VistaActiva): void {
    if (!this.tieneAccesoVista(vista)) {
      this.mostrarError(`Acceso Denegado por IAM RBAC: El rol ${this.usuarioAutenticado?.rol} no está autorizado para abrir la vista ${vista}.`);
      return;
    }
    this.vistaActiva = vista;
    this.limpiarAlertas();
  }

  seleccionarCelda(celda: any, limpiarRecibo = true): void {
    const cambioDeCelda = !this.celdaSeleccionada || this.celdaSeleccionada.id_celda !== celda.id_celda;
    this.celdaSeleccionada = celda;
    this.calculoPagoAbierto = true;
    if (cambioDeCelda) {
      this.mostrarFormularioAgregarPago = false;
      this.detenerCamaraComprobante();
    }
    if (limpiarRecibo) {
      this.ultimoReciboEmitido = null;
    }

    if (celda.estado === 'DISPONIBLE') {
      this.preliquidacionActual = null;
      this.mostrarFormularioAgregarPago = false;
      this.formIngreso.tipo_vehiculo = celda.tipo_vehiculo_permitido || 'AUTOMOVIL';
    } else if (celda.estado === 'OCUPADA' && celda.estancia_activa) {
      // 1. Mostrar de inmediato el cálculo en vivo para que el recuadro aparezca al instante
      this.preliquidacionActual = this.construirPreliquidacionInmediata(celda);
      if (cambioDeCelda) {
        this.metodoPagoSeleccionado =
          this.preliquidacionActual.modalidad_tarifa === 'CONVENIO_CORPORATIVO' ? 'CARGO_CONVENIO' : 'EFECTIVO';
      }
      this.actualizarCronometroEnVivo();

      // 2. Sincronizar con el procedimiento almacenado fn_preliquidar_estancia en PostgreSQL
      this.api.preliquidarEstancia(celda.estancia_activa.id_estancia).subscribe({
        next: (pre) => {
          this.preliquidacionActual = {
            ...this.preliquidacionActual,
            ...pre,
            valor_minuto_aplicado_cop: pre.valor_minuto_aplicado_cop ?? pre.valor_minuto_aplicado ?? 163,
            valor_descuento_cop: pre.valor_descuento_cop ?? pre.descuento_convenio_cop ?? 0,
            valor_iva_cop: pre.valor_iva_cop ?? pre.iva_cop ?? 0,
            valor_neto_pagar_cop: pre.valor_neto_pagar_cop ?? pre.total_neto_pagar_cop ?? 0,
          };
        },
        error: () => {
          // Mantiene el cálculo en vivo en caso de latencia
        },
      });
    }
  }

  abrirModalAgregarPago(): void {
    this.mostrarFormularioAgregarPago = true;
    const neto = Number(this.preliquidacionActual?.valor_neto_pagar_cop || 2000);
    if (!this.efectivoRecibidoCOP || this.efectivoRecibidoCOP < neto) {
      this.efectivoRecibidoCOP = neto <= 50000 ? 50000 : neto <= 100000 ? 100000 : Math.ceil(neto / 50000) * 50000;
    }
  }

  fijarBilleteEfectivo(monto: number): void {
    this.efectivoRecibidoCOP = Number(monto);
  }

  obtenerVueltasCOP(): number {
    const total = Number(this.preliquidacionActual?.valor_neto_pagar_cop || 0);
    const recibido = Number(this.efectivoRecibidoCOP || 0);
    return Math.max(0, recibido - total);
  }

  efectivoInsuficiente(): boolean {
    const total = Number(this.preliquidacionActual?.valor_neto_pagar_cop || 0);
    const recibido = Number(this.efectivoRecibidoCOP || 0);
    return recibido < total;
  }

  private descomponerEnDenominaciones(
    monto: number,
    denominacionesPermitidas: { valor: number; nombre: string; tipo: string }[]
  ): { texto: string; totalPiezas: number } {
    let restante = Math.round(monto);
    const partes: string[] = [];
    let piezas = 0;

    for (const d of denominacionesPermitidas) {
      if (restante >= d.valor) {
        const cant = Math.floor(restante / d.valor);
        restante -= cant * d.valor;
        piezas += cant;
        partes.push(`${cant}x ${d.nombre}`);
      }
    }
    return {
      texto: partes.length > 0 ? partes.join(' + ') : 'Sin vueltas ($0 COP)',
      totalPiezas: piezas,
    };
  }

  obtener3CombinacionesVueltasCOP(): { titulo: string; detalle: string; piezas: number }[] {
    const cambio = this.obtenerVueltasCOP();
    if (cambio <= 0) return [];

    const todas = [
      { valor: 100000, nombre: 'Billete $100.000', tipo: 'BILLETE' },
      { valor: 50000, nombre: 'Billete $50.000', tipo: 'BILLETE' },
      { valor: 20000, nombre: 'Billete $20.000', tipo: 'BILLETE' },
      { valor: 10000, nombre: 'Billete $10.000', tipo: 'BILLETE' },
      { valor: 5000, nombre: 'Billete $5.000', tipo: 'BILLETE' },
      { valor: 2000, nombre: 'Billete $2.000', tipo: 'BILLETE' },
      { valor: 1000, nombre: 'Moneda $1.000', tipo: 'MONEDA' },
      { valor: 500, nombre: 'Moneda $500', tipo: 'MONEDA' },
      { valor: 200, nombre: 'Moneda $200', tipo: 'MONEDA' },
      { valor: 100, nombre: 'Moneda $100', tipo: 'MONEDA' },
      { valor: 50, nombre: 'Moneda $50', tipo: 'MONEDA' },
    ];

    // 1. Combinación Óptima (Menor cantidad de billetes y monedas)
    const c1 = this.descomponerEnDenominaciones(cambio, todas);

    // Identificar la denominación más alta utilizada en la Combinación 1 para generar alternativas reales
    const mayorUsada = todas.find((d) => cambio >= d.valor) || todas[5];

    // 2. Combinación Intermedia (Sin el billete de mayor denominación de la Opción 1, usando los inmediatamente inferiores)
    const denomsC2 = todas.filter((d) => d.valor < mayorUsada.valor || d.valor <= 1000);
    const c2 = this.descomponerEnDenominaciones(cambio, denomsC2);

    // 3. Combinación Sencillo de Caja (Desglosando en denominaciones medianas/bajas: $10.000, $5.000, $2.000 y monedas)
    const limiteC3 = mayorUsada.valor >= 50000 ? 10000 : mayorUsada.valor >= 20000 ? 5000 : mayorUsada.valor >= 5000 ? 2000 : 500;
    const denomsC3 = todas.filter((d) => d.valor <= limiteC3);
    const c3 = this.descomponerEnDenominaciones(cambio, denomsC3);

    return [
      {
        titulo: 'Opción 1 (Óptima - Menos billetes/monedas)',
        detalle: c1.texto,
        piezas: c1.totalPiezas,
      },
      {
        titulo: `Opción 2 (Alternativa sin ${mayorUsada.nombre})`,
        detalle: c2.texto,
        piezas: c2.totalPiezas,
      },
      {
        titulo: 'Opción 3 (Sencillo de caja en baja denominación)',
        detalle: c3.texto,
        piezas: c3.totalPiezas,
      },
    ];
  }

  async activarCamaraComprobante(): Promise<void> {
    try {
      this.camaraActiva = true;
      this.streamCamara = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setTimeout(() => {
        const videoEl = document.getElementById('video-comprobante-nequi') as HTMLVideoElement | null;
        if (videoEl && this.streamCamara) {
          videoEl.srcObject = this.streamCamara;
          videoEl.play();
        }
      }, 100);
    } catch {
      this.camaraActiva = false;
      this.mostrarError(
        'No se detectó cámara web disponible en el navegador. Puedes subir una imagen desde archivo o usar el botón "Simular Foto Nequi".'
      );
    }
  }

  capturarFotoDeCamara(): void {
    const videoEl = document.getElementById('video-comprobante-nequi') as HTMLVideoElement | null;
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 480;
    canvas.height = videoEl.videoHeight || 320;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      this.fotoComprobanteDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }
    this.detenerCamaraComprobante();
  }

  detenerCamaraComprobante(): void {
    if (this.streamCamara) {
      this.streamCamara.getTracks().forEach((t: any) => t.stop());
      this.streamCamara = null;
    }
    this.camaraActiva = false;
  }

  alSeleccionarFotoArchivo(event: any): void {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.fotoComprobanteDataUrl = String(reader.result || '');
      if (!this.referenciaPagoTransferencia.trim()) {
        this.referenciaPagoTransferencia = 'M' + Math.floor(10000000 + Math.random() * 89999999);
      }
    };
    reader.readAsDataURL(file);
  }

  generarComprobanteNequiDemo(): void {
    if (!this.referenciaPagoTransferencia.trim()) {
      this.referenciaPagoTransferencia = 'M' + Math.floor(10000000 + Math.random() * 89999999);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 460;
    canvas.height = 250;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#130924';
      ctx.fillRect(0, 0, 460, 250);
      ctx.strokeStyle = '#DA0081';
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, 444, 234);

      ctx.fillStyle = '#DA0081';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('COMPROBANTE NEQUI / TRANSFERENCIA QR', 24, 38);

      ctx.fillStyle = '#10B981';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('ESTADO: PAGO EXITOSO VERIFICADO', 24, 68);

      ctx.fillStyle = '#F8FAFC';
      ctx.font = '14px monospace';
      ctx.fillText(`Referencia:  ${this.referenciaPagoTransferencia}`, 24, 102);
      ctx.fillText(`Placa:       ${this.preliquidacionActual?.placa || 'N/A'} (Celda #${this.celdaSeleccionada?.numero_celda})`, 24, 128);
      ctx.fillText(`Valor Pagado: ${this.formatoCOP(this.preliquidacionActual?.valor_neto_pagar_cop || 2000)}`, 24, 154);
      ctx.fillText(`Fecha/Hora:  ${new Date().toLocaleString('es-CO')}`, 24, 180);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '12px sans-serif';
      ctx.fillText('Respaldo fotográfico adjunto a la estancia ACID', 24, 215);

      this.fotoComprobanteDataUrl = canvas.toDataURL('image/png');
    }
  }

  recalcularPagoSinDarSalida(): void {
    if (!this.celdaSeleccionada || this.celdaSeleccionada.estado !== 'OCUPADA') return;
    this.calculoPagoAbierto = true;
    this.actualizarCronometroEnVivo();
    if (this.celdaSeleccionada.estancia_activa) {
      this.api.preliquidarEstancia(this.celdaSeleccionada.estancia_activa.id_estancia).subscribe({
        next: (pre) => {
          this.preliquidacionActual = {
            ...this.preliquidacionActual,
            ...pre,
            valor_minuto_aplicado_cop: pre.valor_minuto_aplicado_cop ?? pre.valor_minuto_aplicado ?? 163,
            valor_descuento_cop: pre.valor_descuento_cop ?? pre.descuento_convenio_cop ?? 0,
            valor_iva_cop: pre.valor_iva_cop ?? pre.iva_cop ?? 0,
            valor_neto_pagar_cop: pre.valor_neto_pagar_cop ?? pre.total_neto_pagar_cop ?? 0,
          };
          this.mostrarExito(
            `Cálculo actualizado sin dar salida: Placa ${this.preliquidacionActual.placa} en celda #${this.celdaSeleccionada.numero_celda} -> ${this.formatoCOP(
              this.preliquidacionActual.valor_neto_pagar_cop
            )} (${this.tiempoCorriendoTexto}). El tiempo sigue corriendo hasta registrar el pago.`
          );
        },
        error: () => {
          this.mostrarExito(
            `Cálculo actualizado en vivo sin dar salida: ${this.formatoCOP(
              this.preliquidacionActual?.valor_neto_pagar_cop || 0
            )} (${this.tiempoCorriendoTexto}). El tiempo sigue corriendo.`
          );
        },
      });
    }
  }

  salirDelCalculoSinPagar(): void {
    if (!this.celdaSeleccionada) return;
    const numCelda = this.celdaSeleccionada.numero_celda;
    const placa = this.celdaSeleccionada.estancia_activa?.placa || '';
    this.calculoPagoAbierto = false;
    this.mostrarFormularioAgregarPago = false;
    this.detenerCamaraComprobante();
    this.mostrarExito(
      `Saliste del cálculo sin registrar pago. El vehículo ${placa} continúa estacionado en la celda #${numCelda} y su tiempo sigue corriendo en vivo (${this.tiempoCorriendoTexto}).`
    );
  }

  autocompletarDemoOCR(): void {
    const letras = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    const rLetra = () => letras[Math.floor(Math.random() * letras.length)];
    const rNum = Math.floor(100 + Math.random() * 899);
    const marcasPorTipo: Record<string, string[]> = {
      AUTOMOVIL: ['Mazda 3 Touring', 'Toyota Corolla Hybrid', 'Chevrolet Onix Turbo', 'Renault Arkana'],
      CAMIONETA: ['Toyota Fortuner 4x4', 'Mazda CX-50', 'Renault Duster Iconic', 'Ford Bronco Sport'],
      MOTOCICLETA: ['Yamaha NMAX Connected', 'KTM Duke 390', 'BMW G310 GS', 'Bajaj Pulsar NS200'],
      ELECTRICO: ['BYD Yuan Plus EV', 'BYD Seagull EV', 'Volvo EX30 Electric', 'Renault Kwid E-Tech'],
    };
    const colores = ['Gris Titán', 'Blanco Perlado', 'Negro Obsidiana', 'Azul Cobalto', 'Rojo Carmesí'];
    const nombres = [
      'Andrés Felipe Castellanos',
      'Valeria Alejandra Gómez',
      'Juan Camilo Restrepo',
      'María Paula Sánchez',
      'Nicolás David Ramírez',
    ];

    const tipo = this.celdaSeleccionada?.tipo_vehiculo_permitido || 'AUTOMOVIL';
    const listaMarcas = marcasPorTipo[tipo] || marcasPorTipo['AUTOMOVIL'];

    this.formIngreso = {
      placa: `${rLetra()}${rLetra()}${rLetra()}${rNum}`,
      tipo_vehiculo: tipo,
      marca: listaMarcas[Math.floor(Math.random() * listaMarcas.length)],
      color: colores[Math.floor(Math.random() * colores.length)],
      documento_cliente: String(Math.floor(1010000000 + Math.random() * 89000000)),
      nombre_cliente: nombres[Math.floor(Math.random() * nombres.length)],
      telefono_cliente: '310' + Math.floor(2000000 + Math.random() * 7999999),
      email_cliente: 'conductor.bogota@correo.co',
      modalidad_tarifa: 'ROTATIVO',
      id_convenio: null,
      observaciones: 'Lectura asistida en recepción de sede',
    };
  }

  obtenerEstanciaActivaPorDocumento(doc: string): any | null {
    const limpio = String(doc || '').trim();
    if (!limpio || !this.dashboardSede?.estancias_activas) return null;
    return (
      this.dashboardSede.estancias_activas.find(
        (e: any) => String(e.documento_cliente || '').trim() === limpio
      ) || null
    );
  }

  ejecutarIngresoACID(): void {
    if (!this.celdaSeleccionada || this.celdaSeleccionada.estado !== 'DISPONIBLE') {
      this.mostrarError('Selecciona primero una celda DISPONIBLE (verde) en el mapa del parqueadero.');
      return;
    }
    if (!this.formIngreso.placa.trim() || !this.formIngreso.documento_cliente.trim() || !this.formIngreso.nombre_cliente.trim()) {
      this.mostrarError('Completa la placa del vehículo, el documento y el nombre del cliente.');
      return;
    }

    const estanciaPreviaCliente = this.obtenerEstanciaActivaPorDocumento(this.formIngreso.documento_cliente);
    if (estanciaPreviaCliente) {
      this.mostrarError(
        `El cliente con documento ${this.formIngreso.documento_cliente.trim()} ya se encuentra alquilando un parqueadero activo en este momento (Celda #${estanciaPreviaCliente.numero_celda}, Vehículo ${estanciaPreviaCliente.placa}). Solo se permite 1 parqueadero ocupado por persona.`
      );
      return;
    }

    const payload = {
      id_sede: this.idSedeSeleccionada,
      id_celda: this.celdaSeleccionada.id_celda,
      ...this.formIngreso,
    };

    this.api.registrarIngresoACID(payload).subscribe({
      next: (res) => {
        this.mostrarExito(
          `Ingreso ACID registrado en ${res.latencia_ms} ms | Tique: ${res.codigo_tique_generado} | Celda ${res.numero_celda_asignada} marcada OCUPADA | Evidencia: ${res.uri_evidencia_generada}`
        );
        this.formIngreso.placa = '';
        this.formIngreso.documento_cliente = '';
        this.formIngreso.nombre_cliente = '';
        this.recargarTodo();
      },
      error: (err) => {
        this.mostrarError(err?.error?.error || 'Error al registrar ingreso ACID');
      },
    });
  }

  ejecutarSalidaACID(): void {
    if (!this.preliquidacionActual) return;

    if (this.metodoPagoSeleccionado === 'EFECTIVO' && this.efectivoInsuficiente()) {
      this.mostrarError(
        `El efectivo recibido (${this.formatoCOP(this.efectivoRecibidoCOP)}) es menor al total a pagar (${this.formatoCOP(
          this.preliquidacionActual.valor_neto_pagar_cop
        )}).`
      );
      return;
    }

    if (this.metodoPagoSeleccionado === 'PSE_NEQUI_DAVIPLATA') {
      if (!this.referenciaPagoTransferencia.trim()) {
        this.mostrarError('Debes escribir la referencia de pago de Nequi o transferencia antes de confirmar la salida.');
        return;
      }
      if (!this.fotoComprobanteDataUrl) {
        this.mostrarError('Debes tomar o adjuntar la foto del comprobante de Nequi o transferencia.');
        return;
      }
    }

    const idEstancia = this.preliquidacionActual.id_estancia;
    const efectivoEntregado = Number(this.efectivoRecibidoCOP || 0);
    const refTransferencia =
      this.metodoPagoSeleccionado === 'PSE_NEQUI_DAVIPLATA' ? this.referenciaPagoTransferencia.trim() : null;
    const fotoEvidenciaPago =
      this.metodoPagoSeleccionado === 'PSE_NEQUI_DAVIPLATA' ? this.fotoComprobanteDataUrl : null;

    this.api.liquidarSalidaACID(idEstancia, this.metodoPagoSeleccionado).subscribe({
      next: (res) => {
        const totalCobradoReal = Number(res.total_pagado_cop || 0);
        const vueltasCalculadas =
          this.metodoPagoSeleccionado === 'EFECTIVO' ? Math.max(0, efectivoEntregado - totalCobradoReal) : 0;

        this.ultimoReciboEmitido = {
          ...res,
          efectivo_recibido_cop: this.metodoPagoSeleccionado === 'EFECTIVO' ? efectivoEntregado : null,
          vueltas_cop: vueltasCalculadas,
          referencia_transferencia: refTransferencia,
          foto_comprobante_url: fotoEvidenciaPago,
        };
        this.preliquidacionActual = null;
        this.mostrarFormularioAgregarPago = false;
        this.referenciaPagoTransferencia = '';
        this.fotoComprobanteDataUrl = '';
        this.detenerCamaraComprobante();

        const extraDetalle =
          this.metodoPagoSeleccionado === 'EFECTIVO'
            ? ` | Recibido: ${this.formatoCOP(efectivoEntregado)} - Vueltas: ${this.formatoCOP(vueltasCalculadas)}`
            : refTransferencia
            ? ` | Ref. Nequi/Transf: ${refTransferencia} (Con foto adjunta)`
            : '';

        this.mostrarExito(
          `Salida liquidada en ${res.latencia_ms} ms | Factura ${res.numero_comprobante_emitido} por ${this.formatoCOP(
            totalCobradoReal
          )} (${res.metodo_pago_registrado})${extraDetalle} | Celda ${res.numero_celda_liberada} LIBERADA.`
        );
        this.recargarTodo();
      },
      error: (err) => {
        this.mostrarError(err?.error?.error || 'Error al liquidar la salida ACID');
      },
    });
  }

  seleccionarEstanciaDeTablaParaSalida(est: any): void {
    const celda = this.dashboardSede?.celdas_mapa_calor?.find((c: any) => c.id_celda === est.id_celda);
    if (celda) {
      this.seleccionarCelda(celda);
    }
  }

  guardarTarifa(tarifa: any): void {
    this.api
      .actualizarTarifa(tarifa.id_tarifa, {
        valor_minuto_cop: tarifa.valor_minuto_cop,
        tarifa_plena_dia_cop: tarifa.tarifa_plena_dia_cop,
        valor_mensualidad_cop: tarifa.valor_mensualidad_cop,
      })
      .subscribe({
        next: () => {
          this.mostrarExito(`Tarifa de ${tarifa.tipo_vehiculo} actualizada correctamente en PostgreSQL.`);
          this.cargarSede(this.idSedeSeleccionada);
        },
        error: (err) => this.mostrarError(err?.error?.error || 'Error actualizando tarifa'),
      });
  }

  abrirAuditoriaEvidencia(ev: any): void {
    this.evidenciaSeleccionadaAudit = ev;
    this.evidenciaDesbloqueadaId = null;
  }

  confirmarAuditoriaLey1581(): void {
    if (!this.evidenciaSeleccionadaAudit) return;
    this.api
      .auditarEvidenciaLey1581(this.evidenciaSeleccionadaAudit.id_evidencia, {
        id_usuario_auditor: 2,
        codigo_tique_soporte: this.formAuditoria.codigo_tique_soporte,
        motivo_inspeccion: this.formAuditoria.motivo_inspeccion,
      })
      .subscribe({
        next: () => {
          this.evidenciaDesbloqueadaId = this.evidenciaSeleccionadaAudit.id_evidencia;
          this.mostrarExito(
            `Auditoría Ley 1581 registrada (Tique ${this.formAuditoria.codigo_tique_soporte}). Evidencia fotográfica desbloqueada.`
          );
          this.cargarSede(this.idSedeSeleccionada);
        },
        error: (err) => this.mostrarError(err?.error?.error || 'Debe ingresar tique y motivo'),
      });
  }

  dispararCierreBatchParquet(idSede: number): void {
    this.api.ejecutarCierreBatchParquet(idSede).subscribe({
      next: (res) => {
        this.mostrarExito(
          `Cierre Batch Nocturno Parquet generado con compresión Snappy y placas anonimizadas (SHA-256): ${res.lake_export.uriParquet}`
        );
        this.recargarTodo();
      },
      error: (err) => this.mostrarError(err?.error?.error || 'Error ejecutando cierre Parquet'),
    });
  }

  conmutarAdaptadorCloud(modo: 'LOCAL' | 'AZURE_CLOUD'): void {
    this.api.conmutarProveedorHexagonal(modo).subscribe({
      next: (res) => {
        this.mostrarExito(res.mensaje);
        this.recargarTodo();
      },
      error: (err) => this.mostrarError(err?.error?.error || 'Error cambiando adaptador'),
    });
  }

  // Helpers para Mapas de Calor y Formatos
  obtenerEstiloCeldaParqueadero(celda: any): Record<string, string> {
    if (this.modoVisualizacionGrilla === 'OPERATIVO' && this.vistaActiva === 'OPERADOR_SEDE') {
      return {};
    }
    // Modo Mapa de Calor Espacial (Gradiente térmico según intensidad_calor_pct)
    const p = Number(celda.intensidad_calor_pct || 0);
    if (p >= 80) {
      return {
        background: 'linear-gradient(145deg, rgba(239, 68, 68, 0.78), rgba(153, 27, 27, 0.90))',
        borderColor: '#FCA5A5',
      };
    } else if (p >= 60) {
      return {
        background: 'linear-gradient(145deg, rgba(245, 158, 11, 0.72), rgba(180, 83, 9, 0.88))',
        borderColor: '#FDE68A',
      };
    } else if (p >= 40) {
      return {
        background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.55), rgba(4, 120, 87, 0.78))',
        borderColor: '#6EE7B7',
      };
    } else {
      return {
        background: 'linear-gradient(145deg, rgba(2, 132, 199, 0.42), rgba(15, 61, 104, 0.72))',
        borderColor: '#7DD3FC',
      };
    }
  }

  obtenerCeldaHeatmapHorario(lista: any[], dia: number, hora: number): any {
    if (!lista) return { cantidad_vehiculos: 0, intensidad_pct: 0, ingresos_cop: 0 };
    return (
      lista.find((x: any) => x.dia_semana === dia && x.hora_dia === hora) || {
        cantidad_vehiculos: 0,
        intensidad_pct: 0,
        ingresos_cop: 0,
      }
    );
  }

  obtenerColorHeatmapHorario(intensidadPct: number): string {
    if (intensidadPct >= 82) return '#DC2626'; // Rojo crítico hora pico
    if (intensidadPct >= 64) return '#D97706'; // Ámbar alto
    if (intensidadPct >= 44) return '#059669'; // Esmeralda medio
    if (intensidadPct >= 25) return '#0284C7'; // Cian moderado
    return '#1E3A8A';                          // Azul valle
  }

  formatoCOP(valor: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(valor || 0));
  }

  private mostrarExito(msg: string): void {
    this.mensajeExito = msg;
    this.mensajeError = '';
  }

  private mostrarError(msg: string): void {
    this.mensajeError = msg;
    this.mensajeExito = '';
  }

  private limpiarAlertas(): void {
    this.mensajeExito = '';
    this.mensajeError = '';
  }
}
