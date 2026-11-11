// =============================================================================
// CAPA DE DOMINIO (HEXAGONAL CORE) - ENTIDADES Y REGLAS DE NEGOCIO PURAS
// Libre de dependencias de frameworks, motores SQL o SDKs de proveedores cloud.
// =============================================================================

export type TipoVehiculo = 'AUTOMOVIL' | 'CAMIONETA' | 'MOTOCICLETA' | 'ELECTRICO';
export type EstadoCelda = 'DISPONIBLE' | 'OCUPADA' | 'RESERVADA' | 'MANTENIMIENTO';
export type ModalidadTarifa = 'ROTATIVO' | 'CONVENIO_CORPORATIVO' | 'ABONADO_MENSUAL';
export type MetodoPago = 'EFECTIVO' | 'TARJETA_DEBITO_CREDITO' | 'PSE_NEQUI_DAVIPLATA' | 'CARGO_CONVENIO' | 'MENSUALIDAD_ACTIVA';
export type TierEvidencia = 'HOT' | 'COOL' | 'ARCHIVE' | 'PURGED';
export type RolRBAC = 'ADMIN_GLOBAL' | 'ADMIN_SEDE' | 'OPERADOR_SEDE' | 'AUDITOR_SEGURIDAD' | 'ANALISTA_DATOS';

export interface Sede {
  id_sede: number;
  codigo_sede: string;
  nombre: string;
  ciudad: string;
  localidad: string;
  direccion: string;
  latitud: number;
  longitud: number;
  capacidad_total: number;
  cupos_disponibles: number;
  celdas_interactivas_totales: number;
  celdas_interactivas_ocupadas: number;
  celdas_interactivas_disponibles: number;
  porcentaje_ocupacion: number;
  ingresos_hoy_cop: number;
  ingresos_mes_cop: number;
  rotaciones_hoy: number;
  horario_operacion: string;
  estado: string;
}

export interface CeldaMapaCalor {
  id_celda: number;
  id_sede: number;
  id_zona: number;
  codigo_zona: string;
  nombre_zona: string;
  piso: number;
  numero_celda: string;
  fila_grid: number;
  columna_grid: number;
  tipo_vehiculo_permitido: TipoVehiculo;
  estado: EstadoCelda;
  rotaciones_historicas: number;
  minutos_ocupacion_acumulados: number;
  intensidad_calor_pct: number; // 0 a 100 normalizado para el mapa de calor espacial
  // Datos de la estancia activa si estado === 'OCUPADA'
  estancia_activa?: {
    id_estancia: number;
    codigo_tique: string;
    placa: string;
    marca: string;
    color: string;
    nombre_cliente: string;
    documento_cliente: string;
    telefono_cliente: string;
    modalidad_tarifa: ModalidadTarifa;
    timestamp_entrada: string;
    minutos_transcurridos: number;
    valor_estimado_cop: number;
  } | null;
}

export interface SolicitudIngresoVehiculo {
  id_sede: number;
  id_celda: number;
  placa: string;
  tipo_vehiculo: TipoVehiculo;
  marca: string;
  color: string;
  documento_cliente: string;
  nombre_cliente: string;
  telefono_cliente: string;
  email_cliente?: string;
  modalidad_tarifa: ModalidadTarifa;
  id_convenio?: number | null;
  id_operador?: number;
  observaciones?: string;
}

export interface ResultadoIngresoACID {
  id_estancia_creada: number;
  codigo_tique_generado: string;
  numero_celda_asignada: string;
  hora_entrada: string;
  cupos_restantes_sede: number;
  uri_evidencia_generada: string;
  latencia_ms: number;
}

export interface PreliquidacionEstancia {
  id_estancia: number;
  codigo_tique: string;
  placa: string;
  tipo_vehiculo: TipoVehiculo;
  nombre_cliente: string;
  documento_cliente: string;
  numero_celda: string;
  modalidad_tarifa: ModalidadTarifa;
  timestamp_entrada: string;
  timestamp_actual: string;
  minutos_transcurridos: number;
  valor_minuto_aplicado: number;
  valor_bruto_cop: number;
  descuento_convenio_cop: number;
  subtotal_sin_iva_cop: number;
  iva_cop: number;
  total_neto_pagar_cop: number;
}

export interface ResultadoSalidaACID {
  id_estancia_cerrada: number;
  numero_comprobante_emitido: string;
  placa_vehiculo: string;
  numero_celda_liberada: string;
  minutos_facturados: number;
  valor_bruto_cop: number;
  descuento_aplicado_cop: number;
  subtotal_cop: number;
  iva_cop: number;
  total_pagado_cop: number;
  metodo_pago_registrado: MetodoPago;
  cupos_disponibles_actualizados: number;
  latencia_ms: number;
}

export interface CeldaHeatmapHorario {
  dia_semana: number;        // 1 (Lun) a 7 (Dom)
  nombre_dia: string;
  hora_dia: number;          // 5 a 22 (18 horas operativas)
  etiqueta_hora: string;
  cantidad_vehiculos: number;
  ingresos_cop: number;
  intensidad_pct: number;    // 0 a 100
}
