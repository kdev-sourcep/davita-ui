import { Component, Input, OnChanges, OnInit, computed, inject, signal }
  from '@angular/core';
import { CurrencyPipe } from '@angular/common';
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
  physician_id: null as number | null,
  facility_id: null as number | null,
  coverage_id: null as number | null,
  encounter_date: '', encounter_type: '', status: 'Scheduled',
  clinical_notes: '',
};

const EMPTY_LINE = {
  product_id: null as number | null,
  quantity: 1, lot_number: '', unit_price_at_time: 0,
};

@Component({
  selector: 'app-patient-encounters',
  imports: [CurrencyPipe, FormsModule, MatTableModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatSnackBarModule],
  templateUrl: './encounters.html',
})
export class PatientEncounters implements OnInit, OnChanges {
  @Input({ required: true }) patientId!: number;

  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly cols = ['date', 'type', 'physician', 'facility', 'status',
    'products', 'actions'];

  all = signal<any[]>([]);
  physicians = signal<any[]>([]);
  facilities = signal<any[]>([]);
  coverages = signal<any[]>([]);
  catalog = signal<any[]>([]);
  types = signal<string[]>([]);
  statuses = signal<string[]>([]);
  expanded = signal<number | null>(null);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };
  lines: any[] = [];

  activeCatalog = computed(() =>
    this.catalog().filter((p) => p.is_active));

  sorted = computed(() =>
    [...this.all()].sort((a, b) =>
      String(b.encounter_date ?? '').localeCompare(
        String(a.encounter_date ?? ''))));

  ngOnInit() {
    this.api.list('physicians')
      .subscribe((r) => this.physicians.set(r));
    this.api.list('facilities')
      .subscribe((r) => this.facilities.set(r));
    this.api.list('products')
      .subscribe((r) => this.catalog.set(r));
    this.api.options().subscribe({
      next: (o) => {
        this.types.set(o.encounter_type_options ?? []);
        this.statuses.set(o.encounter_status_options ?? []);
      },
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
  }

  ngOnChanges() {
    this.load();
    this.api.listInsurance(this.patientId)
      .subscribe((r) => this.coverages.set(r));
    this.reset();
  }

  load() {
    this.api.listEncounters(this.patientId)
      .subscribe((r) => this.all.set(r));
  }

  lineTotal(e: any): number {
    return (e.products ?? []).reduce(
      (s: number, p: any) => s + p.quantity * p.unit_price_at_time, 0);
  }

  productLabel(pid: number): string {
    const p = this.catalog().find((c) => c.id === Number(pid));
    return p ? `${p.sku} — ${p.product_name}` : '—';
  }

  onProductPick(i: number) {
    const p = this.catalog().find(
      (c) => c.id === Number(this.lines[i].product_id));
    if (p) this.lines[i].unit_price_at_time = p.unit_cost;
  }

  addLine() {
    this.lines.push({ ...EMPTY_LINE });
  }

  dropLine(i: number) {
    this.lines.splice(i, 1);
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.form = { ...EMPTY, ...row };
    this.lines = (row.products ?? []).map((p: any) => ({
      product_id: p.product_id, quantity: p.quantity,
      lot_number: p.lot_number ?? '',
      unit_price_at_time: p.unit_price_at_time,
    }));
    setTimeout(() => document.getElementById('encounter-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
    this.lines = [];
  }

  toggleExpand(id: number) {
    this.expanded.set(this.expanded() === id ? null : id);
  }

  save() {
    const rec = this.editing();
    const body: any = {
      ...this.form,
      patient_id: this.patientId,
      coverage_id: this.form.coverage_id || null,
      products: this.lines.map((l) => ({
        product_id: l.product_id, quantity: l.quantity,
        lot_number: l.lot_number,
        unit_price_at_time: l.unit_price_at_time,
      })),
    };
    if (rec) {
      this.api.update('encounters', rec.id, body).subscribe({
        next: () => this.afterSave(rec.id),
        error: (e) => this.errors.set(
          e.error?.errors ?? ['Request failed — is the API running?']),
      });
    } else {
      this.api.create('encounters', body).subscribe({
        next: (saved: any) => this.afterSave(saved.id),
        error: (e) => this.errors.set(
          e.error?.errors ?? ['Request failed — is the API running?']),
      });
    }
  }

  private afterSave(id: number) {
    this.snack.open(
      `✓ Encounter verified in database (ID ${id})`, 'OK',
      { duration: 4000 });
    this.reset();
    this.load();
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete the ${row.encounter_date} encounter and its ` +
        `${(row.products ?? []).length} product line(s)?`)) return;
    this.api.remove('encounters', row.id).subscribe({
      next: () => {
        this.snack.open('Encounter deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
