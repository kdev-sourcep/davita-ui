import { AfterViewInit, Component, ElementRef, OnInit, inject,
         signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import * as d3 from 'd3';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';

const KIND_COLOR: Record<string, string> = {
  patient: '#2a9d8f',
  physician: '#1565c0',
  facility: '#6a1b9a',
};

const KIND_ICON: Record<string, string> = {
  patient: 'person',
  physician: 'medical_services',
  facility: 'domain',
};

@Component({
  selector: 'app-relationships',
  imports: [MatCardModule, MatIconModule],
  templateUrl: './relationships.html',
})
export class RelationshipsPage implements OnInit, AfterViewInit {
  private api = inject(ApiService);
  private el = inject(ElementRef);
  readonly auth = inject(AuthService);

  nodes = signal<any[]>([]);
  links = signal<any[]>([]);
  selected = signal<any | null>(null);
  private simulation: d3.Simulation<any, any> | null = null;
  private rendered = false;

  kindIcon(k: string) { return KIND_ICON[k] ?? 'circle'; }
  kindColor(k: string) { return KIND_COLOR[k] ?? '#666'; }

  connections(n: any) {
    return this.links()
      .filter((l) => l.source.id === n.id || l.target.id === n.id)
      .map((l) => {
        const other = l.source.id === n.id ? l.target : l.source;
        return { type: l.type, label: other.label, kind: other.kind };
      });
  }

  ngOnInit() {
    this.api.relationships().subscribe((r) => {
      this.nodes.set(r.nodes);
      this.links.set(r.links);
      if (this.rendered) this.render();
    });
  }

  ngAfterViewInit() {
    this.rendered = true;
    if (this.nodes().length) this.render();
  }

  private render() {
    const host = this.el.nativeElement.querySelector('#graph');
    if (!host) return;
    d3.select(host).selectAll('*').remove();

    const W = host.clientWidth || 960;
    const H = 560;
    const svg = d3.select(host).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g');
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3])
      .on('zoom', (e) => g.attr('transform', e.transform)) as any);

    // arrowheads per link type
    const defs = svg.append('defs');
    defs.append('marker').attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10').attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#90a4ae');

    const nodes = this.nodes().map((n) => ({ ...n }));
    const links = this.links().map((l) => ({ ...l }));

    const link = g.append('g')
      .selectAll('line').data(links).join('line')
      .attr('stroke', '#b0bec5').attr('stroke-width', 1.6)
      .attr('marker-end', 'url(#arrow)');

    const linkLabel = g.append('g')
      .selectAll('text').data(links).join('text')
      .attr('font-size', 9).attr('fill', '#78909c')
      .attr('text-anchor', 'middle')
      .text((d: any) => d.type);

    const node = g.append('g')
      .selectAll('g').data(nodes).join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<any, any>()
        .on('start', (e, d) => {
          if (!e.active) this.simulation?.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => {
          if (!e.active) this.simulation?.alphaTarget(0);
          d.fx = null; d.fy = null;
        }) as any);

    node.append('circle')
      .attr('r', 20)
      .attr('fill', (d: any) => KIND_COLOR[d.kind] ?? '#666')
      .attr('stroke', '#fff').attr('stroke-width', 2.5)
      .attr('opacity', 0.92);

    node.append('text')
      .attr('text-anchor', 'middle').attr('dy', 4)
      .attr('font-size', 13).attr('fill', '#fff')
      .text((d: any) =>
        (d.label || '?').split(/[ ,]+/)[0].slice(0, 2).toUpperCase());

    node.append('text')
      .attr('text-anchor', 'middle').attr('dy', 34)
      .attr('font-size', 10.5).attr('fill', '#37474f')
      .text((d: any) =>
        d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label);

    node.on('mouseover', (ev, d: any) => {
      const tip = this.el.nativeElement.querySelector('#graph-tip');
      const connCount = this.links().filter(
        (l: any) => (l.source.id ?? l.source) === d.id
                    || (l.target.id ?? l.target) === d.id).length;
      tip.innerHTML =
        `<b>${d.label}</b><br><i>${d.kind}</i>` +
        (d.sub ? `<br>${d.sub}` : '') +
        `<br>${connCount} connection${connCount === 1 ? '' : 's'}`;
      tip.style.display = 'block';
      tip.style.left = ev.offsetX + 14 + 'px';
      tip.style.top = ev.offsetY + 14 + 'px';
    }).on('mousemove', (ev) => {
      const tip = this.el.nativeElement.querySelector('#graph-tip');
      tip.style.left = ev.offsetX + 14 + 'px';
      tip.style.top = ev.offsetY + 14 + 'px';
    }).on('mouseout', () => {
      this.el.nativeElement.querySelector('#graph-tip')
        .style.display = 'none';
    }).on('click', (_ev, d: any) => {
      // after simulation, d3 mutates link endpoints into node objects
      const enriched = {
        ...d,
        connections: this.links().filter(
          (l: any) => (l.source.id ?? l.source) === d.id
                      || (l.target.id ?? l.target) === d.id).map((l: any) => {
            const other = (l.source.id ?? l.source) === d.id
              ? l.target : l.source;
            return {
              type: l.type,
              label: typeof other === 'object' ? other.label : other,
              kind: typeof other === 'object' ? other.kind : '',
            };
          }),
      };
      this.selected.set(enriched);
    });

    this.simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id((d: any) => d.id).distance(150))
      .force('charge', d3.forceManyBody().strength(-520))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide(46))
      .on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);
        linkLabel
          .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
          .attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 6);
        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });
  }
}
