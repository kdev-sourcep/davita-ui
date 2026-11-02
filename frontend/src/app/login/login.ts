import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule],
  templateUrl: './login.html',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  error = signal('');
  busy = signal(false);

  submit() {
    if (!this.username.trim() || !this.password) {
      this.error.set('Enter both username and password');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/']),
      error: (e) => {
        this.busy.set(false);
        this.error.set(e.error?.errors?.[0] ?? 'Login failed');
      },
    });
  }
}
