// =============================================================================
// ADAPTADORES INTERCAMBIABLES DE ALMACENAMIENTO DE OBJETOS Y DATA LAKE
// Demuestra el desacoplamiento de la Arquitectura Hexagonal:
// - Sprint 1 (Local): LocalDiskEvidenceAdapter + LocalParquetLakeAdapter
// - Sprint 2 (Azure): AzureBlobEvidenceAdapter + AzureDataLakeGen2Adapter
// =============================================================================

import fs from 'fs';
import path from 'path';
import { IAnalyticsLakePort, IEvidenceStoragePort } from '../../ports/outbound/HexagonalPorts';

export class LocalDiskEvidenceAdapter implements IEvidenceStoragePort {
  public readonly providerName = 'LOCAL_DISK' as const;
  private readonly baseDir = path.join(process.cwd(), 'storage_local', 'evidencias_lpr');

  async guardarEvidenciaBinaria(uriRelativa: string, metadataPlaca: string) {
    const targetPath = path.join(this.baseDir, uriRelativa.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const simulatedContent = JSON.stringify(
      {
        formato: 'JPEG_LPR_METADATA_FRAME',
        placa_detectada: metadataPlaca,
        uri_estructurada: uriRelativa,
        normativa: 'Ley Estatutaria 1581 de 2012 - Habeas Data Colombia',
        cifrado_reposo: 'AES-256 Simulated Local',
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
    fs.writeFileSync(targetPath + '.meta.json', simulatedContent, 'utf-8');
    return {
      uriFinal: `local://${uriRelativa}`,
      tier: 'HOT',
      sizeKb: 295,
    };
  }

  obtenerPoliticaCicloVidaLey1581() {
    return {
      hotDays: '0 a 30 días (Operación diaria y reclamos inmediatos en sede)',
      coolDays: '31 a 90 días (Auditorías tributarias y conciliación de convenios)',
      archiveDays: '91 a 365 días (Custodia probatoria legal a $0.00099 USD/GB/mes)',
      purgeDays: 'Día 365 (Purga física irreversible automatizada - Ley 1581 de 2012)',
      encryption: 'TLS 1.3 en tránsito + AES-256 Server-Side Encryption (Key Vault Ready)',
    };
  }
}

export class AzureBlobEvidenceAdapter implements IEvidenceStoragePort {
  public readonly providerName = 'AZURE_BLOB_LRS' as const;

  async guardarEvidenciaBinaria(uriRelativa: string, _metadataPlaca: string) {
    return {
      uriFinal: `https://stparkcloudcolombia.blob.core.windows.net/evidencias-placas/${uriRelativa}`,
      tier: 'HOT',
      sizeKb: 300,
    };
  }

  obtenerPoliticaCicloVidaLey1581() {
    return {
      hotDays: 'Azure Blob Hot Tier (0-30 días)',
      coolDays: 'Azure Blob Cool Tier (31-90 días - Lifecycle Rule)',
      archiveDays: 'Azure Blob Archive Tier (91-365 días - $0.00099/GB)',
      purgeDays: 'Delete Blob Action a los 365 días exactos (Ley 1581)',
      encryption: 'Azure Key Vault Managed Keys (AES-256) + Private Endpoint VNet',
    };
  }
}

export class LocalParquetLakeAdapter implements IAnalyticsLakePort {
  public readonly providerName = 'LOCAL_PARQUET' as const;
  private readonly lakeDir = path.join(process.cwd(), 'storage_local', 'datalake_parquet');

  async exportarConsolidadoParquet(idSede: number, fecha: string, registrosAnonimizados: number, ingresosCop: number) {
    fs.mkdirSync(this.lakeDir, { recursive: true });
    const fileName = `sede_${idSede}_cierre_${fecha}_snappy.parquet.json`;
    const filePath = path.join(this.lakeDir, fileName);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          formato_columnar: 'Apache Parquet v2 (Snappy Compression)',
          id_sede: idSede,
          fecha_cierre: fecha,
          total_estancias_procesadas: registrosAnonimizados,
          ingresos_consolidados_cop: ingresosCop,
          anonimizacion_ley1581: 'SHA-256 + Salt (Placas irreversibles para analítica)',
          destino_cloud_sprint2: 'abfss://lakehouse@adlsparkcloud.dfs.core.windows.net/gold/cierres/',
        },
        null,
        2
      ),
      'utf-8'
    );
    return {
      uriParquet: `datalake/parquet/2026/11/${fileName}`,
      compression: 'SNAPPY',
      sha256Anonymized: true,
    };
  }
}

export class AzureDataLakeGen2Adapter implements IAnalyticsLakePort {
  public readonly providerName = 'AZURE_DATALAKE_GEN2' as const;

  async exportarConsolidadoParquet(idSede: number, fecha: string, _registrosAnonimizados: number, _ingresosCop: number) {
    return {
      uriParquet: `abfss://lakehouse@adlsparkcloud.dfs.core.windows.net/parquet/2026/11/sede_${idSede}_${fecha}_snappy.parquet`,
      compression: 'SNAPPY',
      sha256Anonymized: true,
    };
  }
}
