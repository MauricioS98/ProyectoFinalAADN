// =============================================================================
// CAPA DE APLICACIÓN (CASOS DE USO) - ARQUITECTURA HEXAGONAL
// Orquesta las reglas del negocio invocando exclusivamente los Puertos (Interfaces),
// permitiendo intercambiar PostgreSQL Local <-> Azure PostgreSQL y Disco <-> Blob Storage.
// =============================================================================

import { MetodoPago, SolicitudIngresoVehiculo } from '../domain/models';
import {
  IAnalyticsLakePort,
  IEvidenceStoragePort,
  IParkingRepositoryPort,
} from '../ports/outbound/HexagonalPorts';

export class ParkingApplicationService {
  constructor(
    private readonly parkingRepo: IParkingRepositoryPort,
    private evidenceStorage: IEvidenceStoragePort,
    private analyticsLake: IAnalyticsLakePort
  ) {}

  public setAdapters(evidenceStorage: IEvidenceStoragePort, analyticsLake: IAnalyticsLakePort) {
    this.evidenceStorage = evidenceStorage;
    this.analyticsLake = analyticsLake;
  }

  public obtenerArquitecturaActiva() {
    const conn = this.parkingRepo.obtenerEstadoConexion();
    const esCloud = this.evidenceStorage.providerName === 'AZURE_BLOB_LRS';
    return {
      arquitectura: 'Hexagonal (Ports & Adapters)',
      modo_activo: esCloud ? 'AZURE_CLOUD' : 'LOCAL',
      puertos_hexagonales: {
        IParkingRepositoryPort: esCloud
          ? 'AzurePostgresFlexibleAdapter (SKU B1ms - TLS 1.3)'
          : `PostgresParkingRepository (${conn.motor} - ${conn.host}/${conn.base_datos})`,
        IEvidenceStoragePort: esCloud
          ? 'AzureBlobEvidenceAdapter (Standard LRS - Hot/Cool/Archive)'
          : 'LocalDiskEvidenceAdapter (Storage Local con Metadatos Ley 1581)',
        IAnalyticsLakePort: esCloud
          ? 'AzureDataLakeGen2Adapter (ADLS Gen2 Parquet Snappy + Synapse SQL)'
          : 'LocalParquetLakeAdapter (Exportador Batch Parquet Local)',
      },
      basedatos_transaccional: conn,
      puerto_evidencias_lpr: {
        adaptador_activo: this.evidenceStorage.providerName,
        ciclo_vida_ley1581: this.evidenceStorage.obtenerPoliticaCicloVidaLey1581(),
      },
      puerto_analitica_lakehouse: {
        adaptador_activo: this.analyticsLake.providerName,
        motor_consulta_cloud: 'Azure Synapse Serverless SQL Pool (Parquet Snappy)',
      },
      finops_azure: {
        costo_on_demand_mensual_usd: 21.32,
        costo_optimizado_apagado_programado_usd: 8.5,
        credito_azure_for_students_usd: 100.0,
        meses_sostenibilidad_estimados: 11.7,
      },
    };
  }

  public async obtenerDashboardGlobal() {
    const sedesRaw = await this.parkingRepo.listarSedesResumen();
    const sedes = sedesRaw.map((s) => ({
      ...s,
      ocupacion_porcentaje: s.porcentaje_ocupacion,
      recaudo_hoy_cop: s.ingresos_hoy_cop,
      estancias_activas: s.celdas_interactivas_ocupadas,
      estancias_finalizadas: s.rotaciones_hoy,
    }));

    const heatmapHorario = await this.parkingRepo.obtenerHeatmapHorarioGlobalOSede();
    const convenios = await this.parkingRepo.listarConveniosEmpresariales();
    const cierresParquet = await this.parkingRepo.listarCierresBatchParquet();
    const evidencias = await this.parkingRepo.listarEvidenciasLPR();

    const capacidadRed = sedes.reduce((acc, s) => acc + s.capacidad_total, 0);
    const celdasTotales = sedes.reduce((acc, s) => acc + s.celdas_interactivas_totales, 0);
    const celdasOcupadas = sedes.reduce((acc, s) => acc + s.celdas_interactivas_ocupadas, 0);
    const ingresosHoyRed = sedes.reduce((acc, s) => acc + s.ingresos_hoy_cop, 0);
    const ingresosMesRed = sedes.reduce((acc, s) => acc + s.ingresos_mes_cop, 0);
    const ocupacionRedPct =
      celdasTotales > 0 ? Math.round((celdasOcupadas / celdasTotales) * 1000) / 10 : 0;

    const conteoTiers = {
      HOT: evidencias.filter((e) => e.tier_almacenamiento === 'HOT').length,
      COOL: evidencias.filter((e) => e.tier_almacenamiento === 'COOL').length,
      ARCHIVE: evidencias.filter((e) => e.tier_almacenamiento === 'ARCHIVE').length,
    };

    const desgloseFinops = [
      {
        servicio: 'Azure Database for PostgreSQL',
        sku: 'Flexible Server B1ms (1 vCore, 2 GiB, 32GB SSD)',
        costo_mensual_24x7_usd: '16.09',
        costo_mensual_optimizado_usd: '7.28',
      },
      {
        servicio: 'Azure Blob Storage LRS (Evidencias LPR)',
        sku: '150 GB en Ciclo Hot / Cool / Archive',
        costo_mensual_24x7_usd: '2.18',
        costo_mensual_optimizado_usd: '0.95',
      },
      {
        servicio: 'Azure Data Lake Gen2 + Synapse SQL',
        sku: '10 GB Parquet Snappy + Serverless SQL',
        costo_mensual_24x7_usd: '0.45',
        costo_mensual_optimizado_usd: '0.27',
      },
      {
        servicio: 'Azure App Service / Container Apps',
        sku: '0.5 vCPU, 1 GiB RAM (Scale-to-zero)',
        costo_mensual_24x7_usd: '2.60',
        costo_mensual_optimizado_usd: '0.00',
      },
    ];

    return {
      kpis_red: {
        total_sedes_bogota: sedes.length,
        capacidad_instalada_red: capacidadRed,
        celdas_interactivas_totales: celdasTotales,
        celdas_interactivas_ocupadas: celdasOcupadas,
        celdas_interactivas_disponibles: celdasTotales - celdasOcupadas,
        ocupacion_promedio_red_pct: ocupacionRedPct,
        ingresos_hoy_red_cop: ingresosHoyRed,
        ingresos_mes_red_cop: ingresosMesRed,
        eventos_mensuales_proyectados: 150000,
        volumen_evidencias_mensual_gb: 45,
      },
      kpis_globales: {
        total_sedes: sedes.length,
        capacidad_red_total: capacidadRed,
        ocupacion_red_porcentaje: ocupacionRedPct,
        cupos_ocupados_red: celdasOcupadas,
        cupos_disponibles_red: celdasTotales - celdasOcupadas,
        recaudo_total_red_cop: ingresosMesRed,
      },
      finops: {
        costo_total_24x7_usd_mes: '21.32',
        costo_optimizado_apagado_programado_usd_mes: '8.50',
        credito_azure_for_students_usd: 100,
        desglose_servicios: desgloseFinops,
      },
      sedes,
      heatmap_horario_red: heatmapHorario,
      heatmap_horario_global: heatmapHorario,
      convenios,
      cierres_batch_parquet: cierresParquet,
      cierres_parquet: cierresParquet,
      resumen_tiers_ley1581: conteoTiers,
      arquitectura: this.obtenerArquitecturaActiva(),
    };
  }

  public async obtenerDashboardSede(idSede: number) {
    const sedes = await this.parkingRepo.listarSedesResumen();
    const sedeRaw = sedes.find((s) => s.id_sede === idSede) || sedes[0];
    const sedeActual = {
      ...sedeRaw,
      ocupacion_porcentaje: sedeRaw.porcentaje_ocupacion,
      recaudo_hoy_cop: sedeRaw.ingresos_hoy_cop,
      estancias_activas: sedeRaw.celdas_interactivas_ocupadas,
      estancias_finalizadas: sedeRaw.rotaciones_hoy,
    };

    const celdas = await this.parkingRepo.obtenerMapaCalorCeldasSede(sedeActual.id_sede);
    const estanciasActivasRaw = await this.parkingRepo.listarEstanciasActivasSede(sedeActual.id_sede);
    const estanciasActivas = estanciasActivasRaw.map((e) => ({
      ...e,
      minutos_actuales: e.minutos_transcurridos,
    }));
    const pagosRecientes = await this.parkingRepo.listarHistorialPagosSede(sedeActual.id_sede, 20);
    const tarifas = await this.parkingRepo.listarTarifasSede(sedeActual.id_sede);
    const heatmapHorarioSede = await this.parkingRepo.obtenerHeatmapHorarioGlobalOSede(sedeActual.id_sede);
    const evidenciasSede = await this.parkingRepo.listarEvidenciasLPR(sedeActual.id_sede);
    const convenios = await this.parkingRepo.listarConveniosEmpresariales();

    return {
      sede: sedeActual,
      celdas_mapa_calor: celdas,
      estancias_activas: estanciasActivas,
      pagos_recientes: pagosRecientes,
      tarifas,
      heatmap_horario_sede: heatmapHorarioSede,
      heatmap_horario: heatmapHorarioSede,
      evidencias_lpr: evidenciasSede,
      convenios,
    };
  }

  public async registrarIngresoVehiculo(solicitud: SolicitudIngresoVehiculo) {
    const resultadoACID = await this.parkingRepo.registrarIngresoACID(solicitud);
    const blobResult = await this.evidenceStorage.guardarEvidenciaBinaria(
      resultadoACID.uri_evidencia_generada,
      solicitud.placa.toUpperCase()
    );
    return {
      ...resultadoACID,
      storage_adapter: this.evidenceStorage.providerName,
      blob_metadata: blobResult,
    };
  }

  public async preliquidarSalida(idEstancia: number) {
    const raw = await this.parkingRepo.preliquidarEstancia(idEstancia);
    return {
      ...raw,
      valor_minuto_aplicado_cop: raw.valor_minuto_aplicado,
      valor_descuento_cop: raw.descuento_convenio_cop,
      valor_iva_cop: raw.iva_cop,
      valor_neto_pagar_cop: raw.total_neto_pagar_cop,
    };
  }

  public async liquidarSalidaVehiculo(idEstancia: number, metodoPago: MetodoPago, idOperador?: number) {
    const raw = await this.parkingRepo.liquidarSalidaACID(idEstancia, metodoPago, idOperador);
    return {
      ...raw,
      minutos_liquidados: raw.minutos_facturados,
    };
  }

  public async ejecutarCierreBatchParquet(idSede: number) {
    const registro = await this.parkingRepo.ejecutarCierreBatchNocturnoParquet(idSede);
    const lakeExport = await this.analyticsLake.exportarConsolidadoParquet(
      idSede,
      String(registro.fecha_cierre).slice(0, 10),
      registro.total_estancias_procesadas,
      registro.ingresos_consolidados_cop
    );
    return {
      registro_bd: registro,
      lake_export: lakeExport,
      adaptador_activo: this.analyticsLake.providerName,
    };
  }
}
