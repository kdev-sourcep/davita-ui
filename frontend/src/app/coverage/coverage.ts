import { Component, OnInit, computed, inject, signal }
  from '@angular/core';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';
import { downloadCsv } from '../csv';

const EMPTY = {
  patient_id: null as number | null,
  insurer_id: null as number | null, payer_other: '',
  priority_order: 1, policy_number: '', group_number: '',
  plan_type: '', subscriber_rel: 'Self',
  subscriber_first_name: '', subscriber_last_name: '',
  subscriber_dob: '', copay_primary_care: null,
  copay_specialist: null, is_verified: false,
  verification_date: '', effective_date: '', termination_date: '',
};

const EMPTY_INSURER = {
  payer_name: '', payer_code: null, payer_id: '', phone_support: '',
  address_line1: '', address_line2: '', city: '', state: '',
  postal_code: '',
};

const US_STATES = [
  '', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
];

@Component({
  selector: 'app-coverage-page',
  imports: [FormsModule, MatTableModule, MatSortModule, MatPaginatorModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatCheckboxModule, MatIconModule, MatSnackBarModule],
  templateUrl: './coverage.html',
})
export class CoveragePage implements OnInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly priorities = [
    { value: 1, label: 'Primary' },
    { value: 2, label: 'Secondary' },
    { value: 3, label: 'Tertiary' },
  ];
  readonly cols = ['patient', 'priority', 'payer', 'policy', 'plan',
    'verified', 'dates', 'actions'];

  coverages = signal<any[]>([]);
  patients = signal<any[]>([]);
  insurers = signal<any[]>([]);
  payerCodes = signal<any[]>([]);
  planTypes = signal<string[]>([]);
  relationships = signal<string[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  query = signal('');
  form: any = { ...EMPTY };

  // ---- payer / insurer directory ----
  readonly states = US_STATES;
  readonly insurerCols = ['name', 'code', 'payer_id', 'phone', 'location',
    'actions'];
  insurerEditing = signal<any | null>(null);
  insurerErrors = signal<string[]>([]);
  insurerForm: any = { ...EMPTY_INSURER };

  filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.coverages();
    return this.coverages().filter((r) =>
      [r.first_name, r.last_name, r.mrn, r.payer_name, r.policy_number,
       r.group_number, r.plan_type].join(' ').toLowerCase().includes(q));
  });

  // ---- sort + pagination ----
  sort = signal<Sort>({ active: '', direction: '' });
  pageIndex = signal(0);
  pageSize = signal(10);

  private static readonly SORT_FIELD: Record<string, string> = {
    patient: 'last_name', priority: 'priority_order', payer: 'payer_name',
    policy: 'policy_number', plan: 'plan_type', verified: 'is_verified',
    dates: 'effective_date',
  };

  sorted = computed(() => {
    const { active, direction } = this.sort();
    const data = [...this.filtered()];
    if (!active || !direction) return data;
    const key = CoveragePage.SORT_FIELD[active] ?? active;
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
    this.api.list('patients').subscribe((r) => this.patients.set(r));
    this.api.list('insurers').subscribe((r) => this.insurers.set(r));
    this.api.options().subscribe({
      next: (o) => {
        this.payerCodes.set(o.insurance_options ?? []);
        this.planTypes.set(o.plan_type_options ?? []);
        this.relationships.set(o.subscriber_relationship_options ?? []);
      },
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
  }

  load() {
    this.api.listAllInsurance()
      .subscribe((r) => this.coverages.set(r));
  }

  priorityLabel(p: number): string {
    return this.priorities.find((x) => x.value === p)?.label ?? `#${p}`;
  }

  exportCsv() {
    downloadCsv('insurance_coverage.csv', this.filtered());
  }

  get selectedInsurer(): any | null {
    return this.insurers().find((i) => i.id === this.form.insurer_id) ?? null;
  }

  get isMedicare(): boolean {
    const c = this.selectedInsurer?.payer_code;
    return c === 'medicare_original' || c === 'medicare_advantage';
  }

  get isOther(): boolean {
    return this.selectedInsurer?.payer_code === 'other';
  }

  get showPolicy(): boolean {
    return !!this.selectedInsurer
      && this.selectedInsurer.payer_code !== 'self_pay';
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
    const pid = this.editing()?.patient_id ?? this.form.patient_id;
    if (!pid) {
      this.errors.set(['Select a patient first']);
      return;
    }
    const body: any = { ...this.form };
    if (this.isOther) {
      body.insurer_id = null;
      body.payer_code = 'other';
    } else {
      body.payer_other = null;
    }
    if (!this.showPolicy) body.policy_number = null;
    const rec = this.editing();
    const req = rec
      ? this.api.updateInsurance(pid, rec.id, body)
      : this.api.createInsurance(pid, body);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ ${this.priorityLabel(saved.priority_order)} coverage ` +
          `verified in database (ID ${saved.id})`, 'OK', { duration: 4000 });
        this.reset();
        this.load();
        this.api.list('insurers')
          .subscribe((r) => this.insurers.set(r));
      },
      error: (e) =>
        this.errors.set(e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete this ${this.priorityLabel(row.priority_order)} ` +
        `coverage for ${row.first_name} ${row.last_name}?`))
      return;
    this.api.removeInsurance(row.patient_id, row.id).subscribe({
      next: () => {
        this.snack.open('Coverage deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }

  // ---- payer / insurer directory ----
  loadInsurers() {
    this.api.list('insurers').subscribe((r) => this.insurers.set(r));
  }

  selectInsurer(row: any) {
    this.insurerEditing.set(row);
    this.insurerErrors.set([]);
    this.insurerForm = { ...EMPTY_INSURER, ...row };
    setTimeout(() => document.getElementById('insurer-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  resetInsurer() {
    this.insurerEditing.set(null);
    this.insurerErrors.set([]);
    this.insurerForm = { ...EMPTY_INSURER };
  }

  saveInsurer() {
    const rec = this.insurerEditing();
    const req = rec
      ? this.api.update('insurers', rec.id, this.insurerForm)
      : this.api.create('insurers', this.insurerForm);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ ${saved.payer_name} verified in database (ID ${saved.id})`,
          'OK', { duration: 4000 });
        this.resetInsurer();
        this.loadInsurers();
      },
      error: (e) =>
        this.insurerErrors.set(
          e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  removeInsurer(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete insurer ${row.payer_name}?`)) return;
    this.api.remove('insurers', row.id).subscribe({
      next: () => {
        this.snack.open('Insurer deleted', 'OK', { duration: 3000 });
        if (this.insurerEditing()?.id === row.id) this.resetInsurer();
        this.loadInsurers();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
