import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ParkCloudApiService {
  private readonly baseUrl = 'http://localhost:4000/api';

  constructor(private readonly http: HttpClient) {}

  obtenerDashboardGlobal(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/global`);
  }

  obtenerDashboardSede(idSede: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/sede/${idSede}`);
  }

  registrarIngresoACID(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/estancias/ingreso`, payload);
  }

  preliquidarEstancia(idEstancia: number): Observable<any> {
    return this.http.get(`${this.baseUrl}/estancias/${idEstancia}/preliquidacion`);
  }

  liquidarSalidaACID(idEstancia: number, metodoPago: string, idOperador = 4): Observable<any> {
    return this.http.post(`${this.baseUrl}/estancias/${idEstancia}/salida`, {
      metodo_pago: metodoPago,
      id_operador: idOperador,
    });
  }

  actualizarTarifa(idTarifa: number, payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/tarifas/${idTarifa}`, payload);
  }

  auditarEvidenciaLey1581(idEvidencia: number, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/evidencias/${idEvidencia}/auditar`, payload);
  }

  ejecutarCierreBatchParquet(idSede: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/datalake/cierre-batch`, { id_sede: idSede });
  }

  conmutarProveedorHexagonal(modo: 'LOCAL' | 'AZURE_CLOUD'): Observable<any> {
    return this.http.post(`${this.baseUrl}/arquitectura/switch-provider`, { modo });
  }

  loginIAM(identificador: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, { identificador, password });
  }

  obtenerEstadoDataLakeYDWH(): Observable<any> {
    return this.http.get(`${this.baseUrl}/datalake-dwh/estado`);
  }

  ejecutarPipelineETL(idSede?: number, usuarioEmail?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/datalake-dwh/ejecutar-etl`, {
      id_sede: idSede,
      usuario_email: usuarioEmail,
    });
  }
}
