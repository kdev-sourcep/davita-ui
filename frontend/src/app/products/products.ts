import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
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

const EMPTY = {
  sku: '', product_name: '', category: '', unit_of_measure: '',
  unit_cost: null as number | null, billable_code: '', is_active: true,
};

@Component({
  selector: 'app-products',
  imports: [CurrencyPipe, FormsModule, MatTableModule, MatSortModule,
    MatPaginatorModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './products.html',
})
export class ProductsPage implements OnInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly cols = ['id', 'sku', 'product_name', 'category',
    'unit_cost', 'billable_code', 'is_active', 'actions'];

  categories = signal<string[]>([]);
  uoms = signal<string[]>([]);

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
    downloadCsv('products.csv', this.filtered());
  }

  sort = signal<Sort>({ active: '', direction: '' });
  pageIndex = signal(0);
  pageSize = signal(10);

  sorted = computed(() => {
    const { active, direction } = this.sort();
    const data = [...this.filtered()];
    if (!active || !direction) return data;
    return data.sort((a, b) =>
      String(a[active] ?? '').localeCompare(String(b[active] ?? ''), undefined,
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
    this.api.options().subscribe((o) => {
      this.categories.set(o.product_category_options ?? []);
      this.uoms.set(o.unit_of_measure_options ?? []);
    });
  }

  load() {
    this.api.list('products').subscribe((r) => this.rows.set(r));
  }

  select(row: any) {
    this.editing.set(row);
    this.errors.set([]);
    this.form = { ...EMPTY, ...row, is_active: !!row.is_active };
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
      ? this.api.update('products', rec.id, this.form)
      : this.api.create('products', this.form);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ ${saved.sku} verified in database (ID ${saved.id})`,
          'OK', { duration: 4000 });
        this.reset();
        this.load();
      },
      error: (e) =>
        this.errors.set(e.error?.errors ?? ['Request failed — is the API running?']),
    });
  }

  toggleActive(row: any, ev: Event) {
    ev.stopPropagation();
    const body = { ...row, is_active: !row.is_active };
    this.api.update('products', row.id, body).subscribe({
      next: () => {
        this.snack.open(
          row.is_active ? `${row.sku} deactivated` : `${row.sku} reactivated`,
          'OK', { duration: 3000 });
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Update failed', 'OK',
          { duration: 5000 }),
    });
  }

  remove(row: any, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Delete product ${row.sku}? Products referenced by ` +
        `encounters cannot be deleted — deactivate instead.`)) return;
    this.api.remove('products', row.id).subscribe({
      next: () => {
        this.snack.open('Product deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
