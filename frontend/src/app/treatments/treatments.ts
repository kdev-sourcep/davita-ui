import { Component, Input, OnChanges, OnInit, computed, inject, signal }
  from '@angular/core';
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

const EMPTY = {
  treatment_date: '', modality: '', facility_id: null as number | null,
  duration_minutes: null as number | null, notes: '',
};

@Component({
  selector: 'app-patient-treatments',
  imports: [FormsModule, MatTableModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule,
    MatSnackBarModule],
  templateUrl: './treatments.html',
})
export class PatientTreatments implements OnInit, OnChanges {
  @Input({ required: true }) patientId!: number;

  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly cols = ['date', 'modality', 'facility', 'duration', 'actions'];

  all = signal<any[]>([]);
  facilities = signal<any[]>([]);
  modalities = signal<string[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  sorted = computed(() =>
    [...this.all()].sort((a, b) =>
      String(b.treatment_date ?? '').localeCompare(
        String(a.treatment_date ?? ''))));

  ngOnInit() {
    this.api.list('facilities')
      .subscribe((r) => this.facilities.set(r));
    this.api.options().subscribe({
      next: (o) => this.modalities.set(o.modality_options ?? []),
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
  }

  ngOnChanges() {
    this.load();
    this.reset();
  }

  load() {
    this.api.list('treatments').subscribe((r) =>
      this.all.set(r.filter((t: any) => t.patient_id === this.patientId)));
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.form = { ...EMPTY, ...row };
    setTimeout(() => document.getElementById('treatment-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
  }

  save() {
    const body: any = { ...this.form, patient_id: this.patientId };
    const rec = this.editing();
    const req = rec
      ? this.api.update('treatments', rec.id, body)
      : this.api.create('treatments', body);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ Treatment verified in database (ID ${saved.id})`, 'OK',
          { duration: 4000 });
        this.reset();
        this.load();
      },
      error: (e) =>
        this.errors.set(e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete the ${row.treatment_date} treatment session?`))
      return;
    this.api.remove('treatments', row.id).subscribe({
      next: () => {
        this.snack.open('Treatment deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
