import { Component, Input, OnChanges, OnInit, inject, signal }
  from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
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

const EMPTY = {
  insurer_id: null as number | null, payer_other: '',
  priority_order: 1, policy_number: '', group_number: '',
  plan_type: '', subscriber_rel: 'Self',
  subscriber_first_name: '', subscriber_last_name: '',
  subscriber_dob: '', copay_primary_care: null,
  copay_specialist: null, is_verified: false,
  verification_date: '', effective_date: '', termination_date: '',
};

@Component({
  selector: 'app-patient-insurance',
  imports: [FormsModule, MatTableModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatCheckboxModule,
    MatIconModule, MatSnackBarModule],
  templateUrl: './insurance.html',
})
export class PatientInsurance implements OnInit, OnChanges {
  @Input({ required: true }) patientId!: number;

  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly priorities = [
    { value: 1, label: 'Primary' },
    { value: 2, label: 'Secondary' },
    { value: 3, label: 'Tertiary' },
  ];
  readonly cols = ['priority', 'payer', 'policy', 'plan', 'subscriber',
    'dates', 'actions'];

  coverages = signal<any[]>([]);
  insurers = signal<any[]>([]);
  planTypes = signal<string[]>([]);
  relationships = signal<string[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  ngOnInit() {
    this.api.list('insurers')
      .subscribe((r) => this.insurers.set(r));
    this.api.options().subscribe({
      next: (o) => {
        this.planTypes.set(o.plan_type_options ?? []);
        this.relationships.set(o.subscriber_relationship_options ?? []);
      },
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
  }

  ngOnChanges() {
    this.load();
    this.reset();
  }

  load() {
    this.api.listInsurance(this.patientId)
      .subscribe((r) => this.coverages.set(r));
  }

  priorityLabel(p: number): string {
    return this.priorities.find((x) => x.value === p)?.label ?? `#${p}`;
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
  }

  reset() {
    this.editing.set(null);
    this.errors.set([]);
    this.form = { ...EMPTY };
  }

  save() {
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
      ? this.api.updateInsurance(this.patientId, rec.id, body)
      : this.api.createInsurance(this.patientId, body);
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
    if (!confirm(`Delete this ${this.priorityLabel(row.priority_order)} coverage?`))
      return;
    this.api.removeInsurance(this.patientId, row.id).subscribe({
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
}
