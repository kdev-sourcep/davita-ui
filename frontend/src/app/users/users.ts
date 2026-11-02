import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';

const ROLES = ['viewer', 'registrar', 'admin'];

const EMPTY = {
  username: '', password: '', role: 'viewer',
};

@Component({
  selector: 'app-users',
  imports: [FormsModule, MatTableModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule,
    MatSnackBarModule],
  templateUrl: './users.html',
})
export class UsersPage implements OnInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly roles = ROLES;
  readonly cols = ['id', 'username', 'role', 'created', 'actions'];

  rows = signal<any[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.list('users').subscribe((r) => this.rows.set(r));
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.form = { ...EMPTY, username: row.username, role: row.role,
                  password: '' };  // blank = keep current password
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
  }

  save() {
    const body: any = { ...this.form };
    if (this.editing() && !body.password) delete body.password;
    const rec = this.editing();
    const req = rec
      ? this.api.update('users', rec.id, body)
      : this.api.create('users', body);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ User ${saved.username} (${saved.role}) saved`, 'OK',
          { duration: 4000 });
        this.reset();
        this.load();
      },
      error: (e) =>
        this.errors.set(
          e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete user ${row.username}?`)) return;
    this.api.remove('users', row.id).subscribe({
      next: () => {
        this.snack.open('User deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
