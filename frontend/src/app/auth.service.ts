import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs';

export interface User {
  id: number;
  username: string;
  role: 'viewer' | 'registrar' | 'admin';
}

const KEY = 'davita.auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private base = 'http://localhost:5000/api';

  user = signal<User | null>(null);
  token = signal<string | null>(null);
  isAuthed = computed(() => !!this.token());
  canWrite = computed(() =>
    ['registrar', 'admin'].includes(this.user()?.role ?? ''));
  canDelete = computed(() => this.user()?.role === 'admin');

  constructor() {
    this.restore();
  }

  private restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const { token, user } = JSON.parse(raw);
      if (token && user) {
        this.token.set(token);
        this.user.set(user);
      }
    } catch { /* corrupt storage → stay logged out */ }
  }

  login(username: string, password: string) {
    return this.http.post<{ token: string; user: User }>(
      `${this.base}/auth/login`, { username, password }).pipe(
      tap((r) => {
        this.token.set(r.token);
        this.user.set(r.user);
        localStorage.setItem(KEY, JSON.stringify(r));
      }));
  }

  logout() {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(KEY);
    this.router.navigate(['/login']);
  }

  /** Interceptor's 401 handler — clears state without a redirect loop. */
  clear() {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(KEY);
  }
}
