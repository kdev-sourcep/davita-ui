import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent }
  from '@angular/material/paginator';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';
import { PatientInsurance } from '../insurance/insurance';
import { PatientTreatments } from '../treatments/treatments';
import { downloadCsv } from '../csv';

const US_STATES = [
  '', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
];

const GENDERS = ['', 'Male', 'Female', 'Other', 'Prefer not to say'];

interface MenuOption {
  label: string;
  code?: string;
  value?: string;
}

const EMPTY = {
  first_name: '', last_name: '', mrn: '', date_of_birth: '', gender: '',
  race: '', race_code: null, ethnicity: '', ethnicity_code: null,
  primary_language: '', primary_language_code: null, phone: '', email: '',
  address_line1: '', address_line2: '', city: '', state: '', zip: '',
  physician_id: null, facility_id: null,
};

@Component({
  selector: 'app-patients',
  imports: [FormsModule, MatTableModule, MatSortModule, MatPaginatorModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatSnackBarModule, PatientInsurance,
    PatientTreatments],
  templateUrl: './patients.html',
})
export class PatientsPage implements OnInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly states = US_STATES;
  readonly genders = GENDERS;

  races = signal<MenuOption[]>([]);
  ethnicities = signal<MenuOption[]>([]);
  langFeatured = signal<MenuOption[]>([]);
  langAlpha = signal<MenuOption[]>([]);
  readonly cols = ['id', 'name', 'mrn', 'dob', 'gender', 'phone',
    'physician', 'facility', 'actions'];

  rows = signal<any[]>([]);
  physicians = signal<any[]>([]);
  facilities = signal<any[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  ngOnInit() {
    this.load();
    this.api.list('physicians').subscribe((r) => this.physicians.set(r));
    this.api.list('facilities').subscribe((r) => this.facilities.set(r));
    this.api.options().subscribe({
      next: (o) => {
        this.races.set(o.race_options);
        this.ethnicities.set(o.ethnicity_options);
        this.langFeatured.set(o.primary_language_featured);
        this.langAlpha.set(o.primary_language_alphabetical);
      },
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
  }

  private codeFor(list: MenuOption[], label: string): string | null {
    const o = list.find((o) => o.label === label);
    return o ? o.code ?? o.value ?? null : null;
  }

  query = '';
  private qTimer: any;

  onQuery() {
    clearTimeout(this.qTimer);
    this.qTimer = setTimeout(() => this.load(), 300);
  }

  load() {
    this.api.list('patients', this.query || undefined)
      .subscribe((r) => this.rows.set(r));
  }

  // ---- sort + pagination ----
  sort = signal<Sort>({ active: '', direction: '' });
  pageIndex = signal(0);
  pageSize = signal(10);

  private static readonly SORT_FIELD: Record<string, string> = {
    name: 'last_name', dob: 'date_of_birth',
    physician: 'physician_name', facility: 'facility_name',
  };

  sorted = computed(() => {
    const { active, direction } = this.sort();
    const data = [...this.rows()];
    if (!active || !direction) return data;
    const key = PatientsPage.SORT_FIELD[active] ?? active;
    return data.sort((a, b) =>
      String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined,
        { numeric: true }) * (direction === 'asc' ? 1 : -1));
  });

  paged = computed(() => {
    const s = this.pageIndex() * this.pageSize();
    return this.sorted().slice(s, s + this.pageSize());
  });

  onSort(e: Sort) {
    this.sort.set(e);
    this.pageIndex.set(0);
  }

  onPage(e: PageEvent) {
    this.pageIndex.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
  }

  exportCsv() {
    downloadCsv('patients.csv', this.rows());
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.dupMatch.set(null);
    this.form = { ...EMPTY, ...row };
    setTimeout(() => document.getElementById('edit-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.dupMatch.set(null);
    this.form = { ...EMPTY };
  }

  dupMatch = signal<any | null>(null);

  save(force = false) {
    // Resolve menu selections to their standard codes before sending.
    this.form.race_code = this.codeFor(this.races(), this.form.race);
    this.form.ethnicity_code =
      this.codeFor(this.ethnicities(), this.form.ethnicity);
    this.form.primary_language_code = this.codeFor(
      [...this.langFeatured(), ...this.langAlpha()],
      this.form.primary_language);
    const rec = this.editing();
    const body = force ? { ...this.form, allow_duplicate: true } : this.form;
    const req = rec
      ? this.api.update('patients', rec.id, body)
      : this.api.create('patients', body);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ ${saved.first_name} ${saved.last_name} verified in database (ID ${saved.id})`,
          'OK', { duration: 4000 });
        this.reset();
        this.load();
      },
      error: (e) => {
        if (e.status === 409 && e.error?.duplicate_of) {
          this.dupMatch.set(e.error.duplicate_of);
          this.errors.set(e.error.errors);
        } else {
          this.errors.set(
            e.error?.errors ?? ['Request failed — is the API running?']);
        }
      },
    });
  }

  // User confirmed the name+DOB match is a different person — create anyway.
  createAnyway() {
    this.dupMatch.set(null);
    this.save(true);
  }

  cancelDuplicate() {
    this.dupMatch.set(null);
    this.errors.set([]);
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete patient ${row.first_name} ${row.last_name}?`)) return;
    this.api.remove('patients', row.id).subscribe({
      next: () => {
        this.snack.open('Patient deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
