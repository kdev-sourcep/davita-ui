import { AfterViewInit, Component, ElementRef, OnInit, ViewChild,
  computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
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

const EMPTY = {
  facility_name: '', ccn: '', facility_type: '', phone: '', fax: '',
  email: '', station_count: 0, address_line1: '', address_line2: '',
  city: '', state: '', zip: '',
};

// us-atlas state geometries use FIPS codes as feature ids.
const FIPS_TO_ABBR: Record<string, string> = {
  '1': 'AL', '2': 'AK', '4': 'AZ', '5': 'AR', '6': 'CA', '8': 'CO',
  '9': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

@Component({
  selector: 'app-facilities',
  imports: [FormsModule, MatTableModule, MatSortModule, MatPaginatorModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './facilities.html',
})
export class FacilitiesPage implements OnInit, AfterViewInit {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly states = US_STATES;
  readonly cols = ['id', 'name', 'ccn', 'type', 'phone', 'location',
    'stations', 'actions'];

  facilityTypes = signal<string[]>([]);
  rows = signal<any[]>([]);
  editing = signal<any | null>(null);
  errors = signal<string[]>([]);
  form: any = { ...EMPTY };

  query = signal('');
  stateFilter = signal<string | null>(null);
  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sf = this.stateFilter();
    return this.rows().filter((r) => {
      if (sf && String(r.state ?? '').toUpperCase() !== sf) return false;
      return !q || Object.values(r).some((v) =>
        String(v ?? '').toLowerCase().includes(q));
    });
  });

  // ---- sort + pagination ----
  sort = signal<Sort>({ active: '', direction: '' });
  pageIndex = signal(0);
  pageSize = signal(10);

  private static readonly SORT_FIELD: Record<string, string> = {
    name: 'facility_name', type: 'facility_type', location: 'state',
    stations: 'station_count',
  };

  sorted = computed(() => {
    const { active, direction } = this.sort();
    const data = [...this.filtered()];
    if (!active || !direction) return data;
    const key = FacilitiesPage.SORT_FIELD[active] ?? active;
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

  // ---- US map ----
  @ViewChild('mapHost') mapHost?: ElementRef<HTMLElement>;
  geo = signal<any | null>(null);
  private mapPainted = false;

  stateCounts = computed(() => {
    const m = new Map<string, number>();
    for (const f of this.rows()) {
      const st = String(f.state ?? '').toUpperCase();
      if (st) m.set(st, (m.get(st) ?? 0) + 1);
    }
    return m;
  });

  maxCount = computed(() => Math.max(1, ...this.stateCounts().values()));

  constructor() {
    effect(() => {
      this.stateCounts();
      this.stateFilter();
      this.tryPaint();
    });
  }

  exportCsv() {
    downloadCsv('facilities.csv', this.filtered());
  }

  ngOnInit() {
    this.load();
    this.api.options().subscribe({
      next: (o) => this.facilityTypes.set(o.facility_type_options ?? []),
      error: () =>
        this.errors.set(['Could not load menu options — is the API running?']),
    });
    fetch('us-states-albers-10m.json')
      .then((r) => r.json())
      .then((d) => this.geo.set(d))
      .catch(() => this.errors.set(['US map data failed to load']));
  }

  ngAfterViewInit() {
    this.tryPaint();
  }

  private tryPaint() {
    if (!this.geo() || !this.mapHost) return;
    this.paintMap(this.stateCounts());
  }

  private paintMap(counts: Map<string, number>) {
    const host = this.mapHost!.nativeElement;
    const us = this.geo()!;
    const states: any = topojson.feature(us, us.objects.states);
    const path = d3.geoPath();
    const max = Math.max(1, ...counts.values());
    const color = (n: number) =>
      n === 0 ? '#e8eef4' : d3.interpolateBlues(0.3 + 0.7 * (n / max));

    if (!this.mapPainted) {
      d3.select(host).append('div').attr('class', 'map-tooltip');
      const svg = d3.select(host).append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('class', 'us-map');
      svg.append('g').attr('class', 'states')
        .selectAll('path')
        .data(states.features)
        .join('path')
        .attr('d', (f: any) => path(f) as string)
        .attr('class', 'state-shape')
        .on('click', (_e: any, f: any) => {
          const ab = this.abbrOf(f);
          if (ab) {
            this.stateFilter.update((cur) => (cur === ab ? null : ab));
          }
        })
        .on('mousemove', (ev: any, f: any) => this.showTip(ev, f))
        .on('mouseleave', () => this.hideTip());
      svg.append('g').attr('class', 'map-labels')
        .selectAll('text')
        .data(states.features)
        .join('text')
        .attr('transform', (f: any) => `translate(${path.centroid(f)})`);
      this.mapPainted = true;
    }

    const svg = d3.select(host).select('svg');
    const sf = this.stateFilter();
    svg.select('g.states')
      .selectAll<SVGPathElement, any>('path')
      .attr('fill', (f: any) =>
        color(counts.get(this.abbrOf(f) ?? '') ?? 0))
      .classed('active', (f: any) => this.abbrOf(f) === sf);
    svg.select('g.map-labels')
      .selectAll<SVGTextElement, any>('text')
      .text((f: any) => {
        const n = counts.get(this.abbrOf(f) ?? '') ?? 0;
        return n ? String(n) : '';
      });
  }

  // us-atlas feature ids are zero-padded FIPS strings like '08'.
  private abbrOf(f: any): string | undefined {
    return FIPS_TO_ABBR[String(+f.id)];
  }

  load() {
    this.api.list('facilities').subscribe((r) => this.rows.set(r));
  }

  private showTip(ev: MouseEvent, f: any) {
    if (!this.mapHost) return;
    const ab = this.abbrOf(f);
    const list = this.rows().filter(
      (r) => String(r.state ?? '').toUpperCase() === ab);
    const body = list.length
      ? list.map((x) => `• ${x.facility_name}`).join('<br>')
      : 'No facilities';
    const rect = this.mapHost.nativeElement.getBoundingClientRect();
    d3.select(this.mapHost.nativeElement)
      .select<HTMLElement>('.map-tooltip')
      .html(`<b>${f.properties.name}</b> — ${list.length} ` +
            `${list.length === 1 ? 'facility' : 'facilities'}<br>${body}`)
      .style('left', `${ev.clientX - rect.left + 14}px`)
      .style('top', `${ev.clientY - rect.top + 14}px`)
      .style('opacity', '1');
  }

  private hideTip() {
    if (!this.mapHost) return;
    d3.select(this.mapHost.nativeElement)
      .select<HTMLElement>('.map-tooltip')
      .style('opacity', '0');
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
      ? this.api.update('facilities', rec.id, this.form)
      : this.api.create('facilities', this.form);
    req.subscribe({
      next: (saved: any) => {
        this.snack.open(
          `✓ ${saved.facility_name} verified in database (ID ${saved.id})`,
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
    if (!confirm(`Delete facility ${row.facility_name}?`)) return;
    this.api.remove('facilities', row.id).subscribe({
      next: () => {
        this.snack.open('Facility deleted', 'OK', { duration: 3000 });
        if (this.editing()?.id === row.id) this.reset();
        this.load();
      },
      error: (e) =>
        this.snack.open(e.error?.errors?.[0] ?? 'Delete failed', 'OK',
          { duration: 5000 }),
    });
  }
}
