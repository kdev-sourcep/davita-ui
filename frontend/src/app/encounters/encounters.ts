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

const EMPTY_LAB = {
  test_code: '', test_name: '', result_value: '', units: '',
  reference_range: '', flag: '', collected_at: '',
};

const EMPTY_MED = {
  drug_name: '', dose: '', route: '', frequency: '', status: 'Administered',
};

const EMPTY_TX = {
  modality: '', duration_minutes: null as number | null,
  blood_flow_ml_min: null as number | null,
  dialysate_flow_ml_min: null as number | null,
  ultrafiltration_goal_ml: null as number | null,
  access_type: '', pre_weight_kg: null as number | null,
  post_weight_kg: null as number | null,
  dry_weight_kg: null as number | null, treatment_notes: '',
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
  labTests = signal<any[]>([]);
  labFlags = signal<string[]>([]);
  medRoutes = signal<string[]>([]);
  medStatuses = signal<string[]>([]);
  accessTypes = signal<string[]>([]);
  modalities = signal<string[]>([]);
  expanded = signal<number | null>(null);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };
  lines: any[] = [];
  labs: any[] = [];
  meds: any[] = [];
  tx: any = { ...EMPTY_TX };
  showTx = signal(false);

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
        this.labTests.set(o.lab_test_options ?? []);
        this.labFlags.set(o.lab_flag_options ?? []);
        this.medRoutes.set(o.med_route_options ?? []);
        this.medStatuses.set(o.med_status_options ?? []);
        this.accessTypes.set(o.access_type_options ?? []);
        this.modalities.set(o.modality_options ?? []);
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

  addLab() {
    this.labs.push({ ...EMPTY_LAB });
  }

  dropLab(i: number) {
    this.labs.splice(i, 1);
  }

  onLabPick(i: number) {
    const t = this.labTests().find((x) => x.code === this.labs[i].test_code);
    if (t) {
      this.labs[i].test_name = t.name;
      this.labs[i].units = t.unit;
      this.labs[i].reference_range = t.ref;
    }
  }

  addMed() {
    this.meds.push({ ...EMPTY_MED });
  }

  dropMed(i: number) {
    this.meds.splice(i, 1);
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
    this.labs = (row.labs ?? []).map((l: any) => ({ ...EMPTY_LAB, ...l }));
    this.meds = (row.medications ?? [])
      .map((m: any) => ({ ...EMPTY_MED, ...m }));
    this.tx = { ...EMPTY_TX, ...(row.treatment ?? {}) };
    this.showTx.set(!!row.treatment);
    setTimeout(() => document.getElementById('encounter-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
    this.lines = [];
    this.labs = [];
    this.meds = [];
    this.tx = { ...EMPTY_TX };
    this.showTx.set(false);
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
      labs: this.labs.map((l) => ({
        test_code: l.test_code, test_name: l.test_name,
        result_value: l.result_value, units: l.units,
        reference_range: l.reference_range, flag: l.flag,
        collected_at: l.collected_at || null,
      })),
      medications: this.meds.map((m) => ({
        drug_name: m.drug_name, dose: m.dose, route: m.route,
        frequency: m.frequency, status: m.status,
      })),
      treatment: this.showTx() ? this.tx : null,
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
