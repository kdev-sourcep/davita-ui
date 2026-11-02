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
import { downloadCsv } from '../csv';

const US_STATES = [
  '', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
];

const SPECIALTIES = [
  '', 'Nephrology', 'Internal Medicine', 'Family Medicine',
  'Pediatric Nephrology', 'Transplant Surgery', 'Other',
];

const EMPTY = {
  first_name: '', last_name: '', npi: '', specialty: '', license_number: '',
  phone: '', email: '', address_line1: '', address_line2: '',
  city: '', state: '', zip: '',
};

@Component({
  selector: 'app-physicians',
  imports: [FormsModule, MatTableModule, MatSortModule, MatPaginatorModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './physicians.html',
})
export class PhysiciansPage implements OnInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly states = US_STATES;
  readonly specialties = SPECIALTIES;
  readonly cols = ['id', 'name', 'npi', 'specialty', 'phone', 'email', 'actions'];

  rows = signal<any[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  query = signal('');
  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((r) =>
      Object.values(r).some((v) =>
        String(v ?? '').toLowerCase().includes(q)));
  });

  exportCsv() {
    downloadCsv('physicians.csv', this.filtered());
  }

  // ---- sort + pagination ----
  sort = signal<Sort>({ active: '', direction: '' });
  pageIndex = signal(0);
  pageSize = signal(10);

  private static readonly SORT_FIELD: Record<string, string> = {
    name: 'last_name',
  };

  sorted = computed(() => {
    const { active, direction } = this.sort();
    const data = [...this.filtered()];
    if (!active || !direction) return data;
    const key = PhysiciansPage.SORT_FIELD[active] ?? active;
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

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.list('physicians').subscribe((r) => this.rows.set(r));
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.form = { ...EMPTY, ...row };
    setTimeout(() => document.getElementById('edit-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
  }

  save() {
    const rec = this.editing();
    const req = rec
      ? this.api.update('physicians', rec.id, this.form)
      : this.api.create('physicians', this.form);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ Dr. ${saved.last_name} verified in database (ID ${saved.id})`,
          'OK', { duration: 4000 });
        this.reset();
        this.load();
      },
      error: (e) =>
        this.errors.set(e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete physician ${row.first_name} ${row.last_name}?`)) return;
    this.api.remove('physicians', row.id).subscribe({
      next: () => {
        this.snack.open('Physician deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
