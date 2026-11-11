// =============================================================================
// PUERTOS DE SALIDA (OUTBOUND PORTS) - ARQUITECTURA HEXAGONAL
// Definen los contratos estrictos que deben cumplir los adaptadores locales
// o de la nube (Microsoft Azure / AWS / GCP) sin modificar el dominio.
// =============================================================================

import {
  CeldaHeatmapHorario,
  CeldaMapaCalor,
  MetodoPago,
  PreliquidacionEstancia,
  ResultadoIngresoACID,
  ResultadoSalidaACID,
  Sede,
  SolicitudIngresoVehiculo,
} from '../../domain/models';

export interface IParkingRepositoryPort {
  obtenerEstadoConexion(): { motor: string; modo: string; base_datos: string; host: string; acid_activo: boolean };
  listarSedesResumen(): Promise<Sede[]>;
  obtenerMapaCalorCeldasSede(idSede: number): Promise<CeldaMapaCalor[]>;
  listarEstanciasActivasSede(idSede?: number): Promise<any[]>;
  listarHistorialPagosSede(idSede?: number, limite?: number): Promise<any[]>;
  listarConveniosEmpresariales(): Promise<any[]>;
  listarTarifasSede(idSede: number): Promise<any[]>;
  actualizarTarifaSede(idTarifa: number, valorMinutoCop: number, tarifaPlenaDiaCop: number, valorMensualidadCop: number): Promise<any>;
  registrarIngresoACID(solicitud: SolicitudIngresoVehiculo): Promise<ResultadoIngresoACID>;
  preliquidarEstancia(idEstancia: number): Promise<PreliquidacionEstancia>;
  liquidarSalidaACID(idEstancia: number, metodoPago: MetodoPago, idOperador?: number): Promise<ResultadoSalidaACID>;
  obtenerHeatmapHorarioGlobalOSede(idSede?: number): Promise<CeldaHeatmapHorario[]>;
  listarEvidenciasLPR(idSede?: number): Promise<any[]>;
  registrarInspeccionEvidenciaLey1581(idEvidencia: number, idUsuarioAuditor: number, codigoTique: string, motivo: string): Promise<any>;
  listarCierresBatchParquet(): Promise<any[]>;
  ejecutarCierreBatchNocturnoParquet(idSede: number): Promise<any>;
  listarUsuariosRBAC(): Promise<any[]>;
}

export interface IEvidenceStoragePort {
  readonly providerName: 'LOCAL_DISK' | 'AZURE_BLOB_LRS';
  guardarEvidenciaBinaria(uriRelativa: string, metadataPlaca: string): Promise<{ uriFinal: string; tier: string; sizeKb: number }>;
  obtenerPoliticaCicloVidaLey1581(): {
    hotDays: string;
    coolDays: string;
    archiveDays: string;
    purgeDays: string;
    encryption: string;
  };
}

export interface IAnalyticsLakePort {
  readonly providerName: 'LOCAL_PARQUET' | 'AZURE_DATALAKE_GEN2';
  exportarConsolidadoParquet(idSede: number, fecha: string, registrosAnonimizados: number, ingresosCop: number): Promise<{
    uriParquet: string;
    compression: string;
    sha256Anonymized: boolean;
  }>;
}
