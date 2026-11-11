// =============================================================================
// ADAPTADOR PRIMARIO (INBOUND PORT): SERVIDOR HTTP EXPRESS + INYECCIÓN HEXAGONAL
// Puerto: 4000 | Sirve API RESTful para las 3 vistas de Angular y el visor ER
// =============================================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as path from 'path';
import { PostgresParkingRepository } from './adapters/outbound/postgres/PostgresParkingRepository';
import {
  AzureBlobEvidenceAdapter,
  AzureDataLakeGen2Adapter,
  LocalDiskEvidenceAdapter,
  LocalParquetLakeAdapter,
} from './adapters/outbound/CloudAndLocalAdapters';
import { ParkingApplicationService } from './application/ParkingService';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Instanciación de Adaptadores de Salida (Hexagonal Architecture)
const postgresRepo = new PostgresParkingRepository();
const localEvidenceAdapter = new LocalDiskEvidenceAdapter();
const azureEvidenceAdapter = new AzureBlobEvidenceAdapter();
const localParquetAdapter = new LocalParquetLakeAdapter();
const azureParquetAdapter = new AzureDataLakeGen2Adapter();

const initialStorage =
  process.env.STORAGE_PROVIDER === 'AZURE_BLOB_LRS' ? azureEvidenceAdapter : localEvidenceAdapter;
const initialLake =
  process.env.LAKE_PROVIDER === 'AZURE_DATALAKE_GEN2' ? azureParquetAdapter : localParquetAdapter;

const parkingService = new ParkingApplicationService(postgresRepo, initialStorage, initialLake);

// 1. Estado de Arquitectura Hexagonal y Conmutación en Caliente de Proveedores (Local <-> Azure)
app.get('/api/arquitectura', (_req, res) => {
  res.json(parkingService.obtenerArquitecturaActiva());
});

app.post('/api/arquitectura/switch-provider', (req, res) => {
  const { modo } = req.body; // 'LOCAL' | 'AZURE_CLOUD'
  if (modo === 'AZURE_CLOUD') {
    parkingService.setAdapters(azureEvidenceAdapter, azureParquetAdapter);
  } else {
    parkingService.setAdapters(localEvidenceAdapter, localParquetAdapter);
  }
  res.json({
    mensaje: `Adaptadores hexagonales conmutados exitosamente a modo ${modo}`,
    estado: parkingService.obtenerArquitecturaActiva(),
  });
});

// 2. Vista 1: Dashboard Administrador de Todos los Parqueaderos (Global Multisede Bogotá)
app.get('/api/dashboard/global', async (_req, res) => {
  try {
    const data = await parkingService.obtenerDashboardGlobal();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Vista 2 y 3: Dashboard de Sede Específica (Mapa de Calor de Celdas + Operación Recepcionista)
app.get('/api/dashboard/sede/:idSede', async (req, res) => {
  try {
    const idSede = Number(req.params.idSede) || 1;
    const data = await parkingService.obtenerDashboardSede(idSede);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Operación Recepcionista: Ingreso de Vehículo al seleccionar # del parqueadero (Transacción ACID)
app.post('/api/estancias/ingreso', async (req, res) => {
  try {
    const resultado = await parkingService.registrarIngresoVehiculo(req.body);
    res.status(201).json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Operación Recepcionista: Pre-liquidación automática al seleccionar una celda ocupada para salida
app.get('/api/estancias/:idEstancia/preliquidacion', async (req, res) => {
  try {
    const idEstancia = Number(req.params.idEstancia);
    const pre = await parkingService.preliquidarSalida(idEstancia);
    res.json(pre);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Operación Recepcionista: Liquidar Salida, registrar Método de Pago y Liberar # del Parqueadero (ACID)
app.post('/api/estancias/:idEstancia/salida', async (req, res) => {
  try {
    const idEstancia = Number(req.params.idEstancia);
    const { metodo_pago, id_operador } = req.body;
    const salida = await parkingService.liquidarSalidaVehiculo(
      idEstancia,
      metodo_pago || 'EFECTIVO',
      id_operador || 4
    );
    res.json(salida);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Administrador de Parqueadero: Actualizar Tarifas de la Sede
app.put('/api/tarifas/:idTarifa', async (req, res) => {
  try {
    const idTarifa = Number(req.params.idTarifa);
    const { valor_minuto_cop, tarifa_plena_dia_cop, valor_mensualidad_cop } = req.body;
    const actualizada = await postgresRepo.actualizarTarifaSede(
      idTarifa,
      Number(valor_minuto_cop),
      Number(tarifa_plena_dia_cop),
      Number(valor_mensualidad_cop)
    );
    res.json(actualizada);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Gobierno de Datos (Ley 1581 de 2012): Auditoría justificada para inspeccionar fotografía LPR
app.post('/api/evidencias/:idEvidencia/auditar', async (req, res) => {
  try {
    const idEvidencia = Number(req.params.idEvidencia);
    const { id_usuario_auditor, codigo_tique_soporte, motivo_inspeccion } = req.body;
    if (!codigoTiqueValido(codigo_tique_soporte) || !motivo_inspeccion) {
      return res.status(400).json({
        error: 'Por Ley 1581 de 2012 es obligatorio registrar el código de tique de soporte y el motivo de inspección.',
      });
    }
    const audit = await postgresRepo.registrarInspeccionEvidenciaLey1581(
      idEvidencia,
      Number(id_usuario_auditor || 2),
      codigo_tique_soporte,
      motivo_inspeccion
    );
    res.status(201).json(audit);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

function codigoTiqueValido(t: string): boolean {
  return Boolean(t && t.trim().length >= 4);
}

// 9. Administrador Global: Ejecutar Cierre Batch Nocturno a Formato Parquet (Data Lake Gen2)
app.post('/api/datalake/cierre-batch', async (req, res) => {
  try {
    const { id_sede } = req.body;
    const resultado = await parkingService.ejecutarCierreBatchParquet(Number(id_sede || 1));
    res.status(201).json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Autenticación IAM / RBAC con Contraseña Hasheada (SHA-256 + Salt) y Segregación de Vistas
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identificador, password } = req.body;
    const authResult = await postgresRepo.autenticarUsuarioIAM(identificador, password);
    if (!authResult.autenticado) {
      return res.status(401).json(authResult);
    }
    res.json(authResult);
  } catch (err: any) {
    res.status(400).json({ autenticado: false, mensaje: err.message });
  }
});

// 11. Estado del Data Lake Medallion (Raw/Trusted/Refined), Data Warehouse (Esquema Estrella), Cifrado AES-256 y CloudTrail
app.get('/api/datalake-dwh/estado', async (_req, res) => {
  try {
    const estado = await postgresRepo.obtenerEstadoDataLakeYDWH();
    res.json(estado);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Pipeline ETL Serverless: OLTP -> Raw -> Trusted -> Refined -> Data Warehouse Esquema Estrella
app.post('/api/datalake-dwh/ejecutar-etl', async (req, res) => {
  try {
    const { id_sede, usuario_email } = req.body;
    const resultado = await postgresRepo.ejecutarPipelineETLMedallionEstrella(
      id_sede ? Number(id_sede) : undefined,
      usuario_email
    );
    res.status(201).json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT || 4000);
const projectRoot = path.resolve(__dirname, '..', '..');

app.get('/logo-parkcloud.png', (_req, res) => {
  res.sendFile(path.join(projectRoot, 'logo-parkcloud.png'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(projectRoot, 'Consola_y_Diagrama_ER_ParkCloud.html'));
});

postgresRepo.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`========================================================================`);
    console.log(` PARKCLOUD COLOMBIA - BACKEND HEXAGONAL ACID ACTIVO EN PUERTO ${PORT}`);
    console.log(` CONSOLA WEB Y DIAGRAMA ER: http://localhost:${PORT}`);
    console.log(` API REST:                  http://localhost:${PORT}/api/dashboard/global`);
    console.log(`========================================================================`);
  });
});
