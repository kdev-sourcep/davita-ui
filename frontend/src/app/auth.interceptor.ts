import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Attaches the Bearer token; a 401 clears the session and re-logs-in. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }
  return next(req).pipe(catchError((e) => {
    if (e.status === 401 && !req.url.includes('/auth/')) {
      auth.clear();
      router.navigate(['/login']);
    }
    return throwError(() => e);
  }));
};
