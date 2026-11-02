import { Routes } from '@angular/router';
import { Dashboard } from './dashboard/dashboard';
import { PatientsPage } from './patients/patients';
import { PhysiciansPage } from './physicians/physicians';
import { FacilitiesPage } from './facilities/facilities';
import { CoveragePage } from './coverage/coverage';
import { RelationshipsPage } from './relationships/relationships';
import { LoginPage } from './login/login';
import { UsersPage } from './users/users';
import { authGuard, adminGuard, loginGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage, canActivate: [loginGuard],
    title: 'Sign in — DAVITA' },
  { path: '', component: Dashboard, canActivate: [authGuard],
    title: 'DAVITA Dashboard' },
  { path: 'patients', component: PatientsPage, canActivate: [authGuard],
    title: 'Patients — DAVITA' },
  { path: 'physicians', component: PhysiciansPage, canActivate: [authGuard],
    title: 'Physicians — DAVITA' },
  { path: 'facilities', component: FacilitiesPage, canActivate: [authGuard],
    title: 'Facilities — DAVITA' },
  { path: 'insurance', component: CoveragePage, canActivate: [authGuard],
    title: 'Insurance — DAVITA' },
  { path: 'network', component: RelationshipsPage, canActivate: [authGuard],
    title: 'Relationship Map — DAVITA' },
  { path: 'users', component: UsersPage, canActivate: [adminGuard],
    title: 'Users — DAVITA' },
  { path: '**', redirectTo: '' },
];
