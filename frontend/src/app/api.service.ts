import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ApiError {
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = 'http://localhost:5000/api';

  summary(): Observable<any> {
    return this.http.get(`${this.base}/summary`);
  }

  options(): Observable<any> {
    return this.http.get(`${this.base}/options`);
  }

  relationships(): Observable<{ nodes: any[]; links: any[] }> {
    return this.http.get<{ nodes: any[]; links: any[] }>(
      `${this.base}/relationships`);
  }

  list<T = any>(entity: string, q?: string): Observable<T[]> {
    const url = q
      ? `${this.base}/${entity}?q=${encodeURIComponent(q)}`
      : `${this.base}/${entity}`;
    return this.http.get<T[]>(url);
  }

  get<T = any>(entity: string, id: number): Observable<T> {
    return this.http.get<T>(`${this.base}/${entity}/${id}`);
  }

  create<T = any>(entity: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.base}/${entity}`, body);
  }

  update<T = any>(entity: string, id: number, body: any): Observable<T> {
    return this.http.put<T>(`${this.base}/${entity}/${id}`, body);
  }

  remove(entity: string, id: number): Observable<any> {
    return this.http.delete(`${this.base}/${entity}/${id}`);
  }

  // ---- insurance coverage (nested under patient) ----
  listAllInsurance<T = any>(): Observable<T[]> {
    return this.http.get<T[]>(`${this.base}/insurance`);
  }

  listInsurance<T = any>(pid: number): Observable<T[]> {
    return this.http.get<T[]>(`${this.base}/patients/${pid}/insurance`);
  }

  createInsurance<T = any>(pid: number, body: any): Observable<T> {
    return this.http.post<T>(`${this.base}/patients/${pid}/insurance`, body);
  }

  updateInsurance<T = any>(pid: number, iid: number, body: any): Observable<T> {
    return this.http.put<T>(
      `${this.base}/patients/${pid}/insurance/${iid}`, body);
  }

  removeInsurance(pid: number, iid: number): Observable<any> {
    return this.http.delete(
      `${this.base}/patients/${pid}/insurance/${iid}`);
  }
}
