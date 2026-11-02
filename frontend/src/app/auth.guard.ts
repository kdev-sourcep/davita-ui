import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () =>
  inject(AuthService).isAuthed()
    ? true
    : inject(Router).createUrlTree(['/login']);

export const loginGuard: CanActivateFn = () =>
  inject(AuthService).isAuthed()
    ? inject(Router).createUrlTree(['/'])
    : true;

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isAuthed()) return inject(Router).createUrlTree(['/login']);
  return auth.canDelete() ? true : inject(Router).createUrlTree(['/']);
};
