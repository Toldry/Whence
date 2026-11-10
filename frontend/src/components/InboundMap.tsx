/**
 * Leaflet map of origin airports. The basemap is a bundled vector layer of country shapes
 * (Natural Earth via world-atlas), so no third-party tile server is involved.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countriesTopology from 'world-atlas/countries-110m.json';

export interface MapItem {
  id: string;
  lat: number;
  lon: number;
  label: string;
  tier: number;
  value: number;
}
export interface Tier { bg: string; fg: string; bd: string }
export interface FocusPoint { id: string; x: number; y: number; w: number; h: number }
export interface MapApi { zoomIn(): void; zoomOut(): void; fitAll(): void }
export interface FitRequest { key: number; id: string }

export interface InboundMapProps {
  items: MapItem[];
  tiers: Tier[];
  destination: { iata: string; city: string; lat: number; lon: number } | null;
  home: { name: string; lat: number; lon: number } | null;
  loading: boolean;
  skeleton: { lat: number; lon: number }[];
  hoverId: string | null;
  selectedId: string | null;
  focusId: string | null;
  fitRequest: FitRequest | null;
  accent: string;
  onHover(id: string | null): void;
  onSelect(id: string | null): void;
  onFocusPoint(point: FocusPoint | null): void;
  onReady(api: MapApi): void;
}

const SEA = '#dfe6ee';
const LAND = '#f7f7f5';
const BORDER = '#cdd2da';
const ICON_FONT = "font-family:'Material Symbols Rounded';font-weight:400;line-height:1;";

const worldGeoJson = (() => {
  const topology = countriesTopology as unknown as Topology<{ countries: GeometryCollection }>;
  return feature(topology, topology.objects.countries);
})();

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Quadratic curve between two points, bowed upward, for route arcs. */
function arcPoints(a: [number, number], b: [number, number]): [number, number][] {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const control: [number, number] = [(a[0] + b[0]) / 2 + ny * len * 0.2, (a[1] + b[1]) / 2 + nx * len * 0.2];
  const points: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const u = 1 - t;
    points.push([
      u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
    ]);
  }
  return points;
}

function animateStroke(line: L.Polyline) {
  const path = line.getElement() as SVGPathElement | undefined;
  if (!path?.getTotalLength) return;
  const length = path.getTotalLength();
  path.style.transition = 'none';
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
  path.getBoundingClientRect();
  path.style.transition = 'stroke-dashoffset .6s cubic-bezier(.3,.7,.3,1)';
  path.style.strokeDashoffset = '0';
  setTimeout(() => { path.style.strokeDasharray = ''; path.style.transition = ''; }, 650);
}

interface MarkerRecord {
  marker: L.Marker;
  latLng: L.LatLng;
  inner: HTMLDivElement;
  item: MapItem;
  mode: 'pill' | 'dot';
  paintKey: string;
}

class MapController {
  private map: L.Map;
  private markers = new Map<string, MarkerRecord>();
  private skeletonMarkers: L.Marker[] = [];
  private destinationMarker: L.Marker | null = null;
  private homeMarker: L.Marker | null = null;
  private selectedArc: L.Polyline | null = null;
  private hoverArc: L.Polyline | null = null;
  private groundLine: L.Polyline | null = null;
  private keys = { items: '', dest: '', home: '', sel: '', hov: '', gnd: '', fit: -1, skel: false, report: '' };
  private zooming = false;
  private frame = 0;
  private viewSet = false;
  private lastSelected = '';
  private resizeObserver: ResizeObserver;

  constructor(element: HTMLElement, private props: { current: InboundMapProps }) {
    const map = L.map(element, {
      zoomControl: false, minZoom: 2.5, maxZoom: 8, maxBounds: [[-75, -250], [85, 250]], maxBoundsViscosity: 0.8,
      zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 110, worldCopyJump: true,
    });
    this.map = map;
    element.style.background = SEA;
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.attributionControl.addAttribution(
      'Map data: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>');
    map.createPane('basemap').style.zIndex = '200';
    map.createPane('arcs').style.zIndex = '450';
    L.geoJSON(worldGeoJson, {
      pane: 'basemap', interactive: false,
      ...({ renderer: L.svg({ pane: 'basemap', padding: 0.5 }) } as L.GeoJSONOptions),
      style: () => ({ color: BORDER, weight: 0.8, fillColor: LAND, fillOpacity: 1, opacity: 1 }),
    }).addTo(map);

    map.on('zoomstart', () => { this.zooming = true; this.report(); });
    map.on('zoomend', () => { this.zooming = false; this.layout(); this.report(true); });
    map.on('moveend', () => { this.layout(); this.report(); });
    map.on('move', () => { if (!this.zooming) this.reportSoon(); });
    map.on('click', () => this.props.current.onSelect(null));
    this.resizeObserver = new ResizeObserver(() => { map.invalidateSize(); this.layout(); this.report(); });
    this.resizeObserver.observe(element);
    this.props.current.onReady({ zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(), fitAll: () => this.fitAll() });
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.map.remove();
  }

  update() {
    const p = this.props.current;
    const homeKeyBefore = this.keys.home;
    this.syncDestination();
    this.syncHome();
    this.syncSkeleton();
    if (homeKeyBefore !== this.keys.home) this.keys.items = '';
    const selectedChanged = (p.selectedId ?? '') !== this.lastSelected;
    this.lastSelected = p.selectedId ?? '';
    if (this.syncItems() || selectedChanged) this.layout();
    else this.markers.forEach(r => this.paint(r));
    this.syncArcs();
    this.syncFit();
    this.report();
  }

  private paint(r: MarkerRecord) {
    const p = this.props.current;
    const id = r.item.id;
    const selected = p.selectedId === id;
    const hovered = p.hoverId === id;
    const mode = selected || hovered ? 'pill' : r.mode;
    const tier = p.tiers[r.item.tier] ?? { bg: '#eee', fg: '#222', bd: '#999' };
    const key = [mode, selected, hovered, r.item.label, r.item.tier, p.accent].join('|');
    if (r.paintKey === key) return;
    r.paintKey = key;
    const base = 'position:absolute;left:0;top:0;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease;';
    if (mode === 'dot') {
      r.inner.textContent = '';
      r.inner.style.cssText = `${base}width:12px;height:12px;border-radius:50%;background:${tier.bd};border:2px solid #fff;`
        + 'box-shadow:0 1px 3px rgba(16,18,32,.35);transform:translate(-50%,-50%);';
    } else {
      const lifted = selected || hovered;
      r.inner.textContent = r.item.label;
      r.inner.style.cssText = `${base}padding:4px 9px;border-radius:999px;white-space:nowrap;`
        + 'font:700 12.5px/16px Figtree,system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;'
        + `background:${selected ? p.accent : tier.bg};color:${selected ? '#fff' : tier.fg};`
        + `border:1px solid ${selected ? p.accent : tier.bd};`
        + `box-shadow:${lifted ? '0 4px 14px rgba(16,18,32,.3)' : '0 1px 3px rgba(16,18,32,.2)'};`
        + `transform:translate(-50%,-50%) scale(${lifted ? 1.14 : 1});`;
    }
    r.marker.setZIndexOffset(selected ? 3000 : hovered ? 2500 : mode === 'pill' ? 1000 - r.item.tier * 100 : 0);
  }

  /** Cheapest labels win; anything that would overlap collapses to a dot. */
  private layout() {
    const p = this.props.current;
    const size = this.map.getSize();
    const placed: number[][] = [];
    const reserve = (marker: L.Marker | null, halfW: number, halfH: number) => {
      if (!marker) return;
      const pt = this.map.latLngToContainerPoint(marker.getLatLng());
      placed.push([pt.x - halfW, pt.y - halfH, pt.x + halfW, pt.y + halfH]);
    };
    reserve(this.destinationMarker, 50, 16);
    reserve(this.homeMarker, 16, 16);
    const records = [...this.markers.values()].sort((a, b) =>
      (a.item.id === p.selectedId ? -1e9 : a.item.value) - (b.item.id === p.selectedId ? -1e9 : b.item.value));
    for (const r of records) {
      const pt = this.map.latLngToContainerPoint(r.latLng);
      if (pt.x < -60 || pt.y < -30 || pt.x > size.x + 60 || pt.y > size.y + 30) { r.mode = 'pill'; continue; }
      const w = r.item.label.length * 7.6 + 22;
      const box = [pt.x - w / 2, pt.y - 13, pt.x + w / 2, pt.y + 13];
      const hit = placed.some(q => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]);
      r.mode = hit ? 'dot' : 'pill';
      if (!hit) placed.push(box);
    }
    records.forEach(r => this.paint(r));
  }

  private report(force = false) {
    const p = this.props.current;
    const r = p.focusId ? this.markers.get(p.focusId) : undefined;
    let out: FocusPoint | null = null;
    if (r && p.focusId && !this.zooming) {
      const pt = this.map.latLngToContainerPoint(r.latLng);
      const size = this.map.getSize();
      out = { id: p.focusId, x: Math.round(pt.x), y: Math.round(pt.y), w: size.x, h: size.y };
    }
    const key = out ? [out.id, out.x, out.y, out.w, out.h].join(',') : 'null';
    if (key === this.keys.report && !force) return;
    this.keys.report = key;
    p.onFocusPoint(out);
  }

  private reportSoon() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.report(); });
  }

  private syncItems(): boolean {
    const items = this.props.current.items;
    const key = items.map(i => `${i.id}:${i.label}:${i.tier}:${i.value}`).join('|');
    if (key === this.keys.items) return false;
    this.keys.items = key;
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let r = this.markers.get(item.id);
      if (!r) {
        const marker = L.marker([item.lat, item.lon], {
          icon: L.divIcon({ className: 'ib-marker', html: '<div></div>', iconSize: [0, 0], iconAnchor: [0, 0] }),
          keyboard: false,
        }).addTo(this.map);
        const id = item.id;
        marker.on('mouseover', () => this.props.current.onHover(id));
        marker.on('mouseout', () => this.props.current.onHover(null));
        marker.on('click', e => { L.DomEvent.stopPropagation(e); this.props.current.onSelect(id); });
        r = {
          marker, latLng: marker.getLatLng(), inner: marker.getElement()!.firstChild as HTMLDivElement,
          item, mode: 'pill', paintKey: '',
        };
        this.markers.set(id, r);
      }
      r.item = item;
      r.paintKey = '';
    }
    for (const [id, r] of this.markers) {
      if (!seen.has(id)) { this.map.removeLayer(r.marker); this.markers.delete(id); }
    }
    return true;
  }

  private syncSkeleton() {
    const p = this.props.current;
    if (p.loading === this.keys.skel) return;
    this.keys.skel = p.loading;
    this.skeletonMarkers.forEach(m => this.map.removeLayer(m));
    this.skeletonMarkers = [];
    if (!p.loading) return;
    p.skeleton.forEach((pt, i) => {
      const html = '<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);'
        + `width:${38 + (i % 3) * 6}px;height:22px;border-radius:999px;background:#d6d9e0;border:2px solid #fff;`
        + `box-shadow:0 1px 2px rgba(0,0,0,.12);animation:ib-skeleton 1.3s ease-in-out ${((i % 7) * 0.12).toFixed(2)}s infinite"></div>`;
      this.skeletonMarkers.push(L.marker([pt.lat, pt.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'ib-marker', iconSize: [0, 0], iconAnchor: [0, 0], html }),
      }).addTo(this.map));
    });
  }

  private syncDestination() {
    const p = this.props.current;
    const d = p.destination;
    const key = d ? d.iata + p.accent : '';
    if (key === this.keys.dest) return;
    const moved = !d || !this.keys.dest || this.keys.dest.slice(0, 3) !== d.iata;
    this.keys.dest = key;
    if (this.destinationMarker) { this.map.removeLayer(this.destinationMarker); this.destinationMarker = null; }
    if (!d) {
      if (!this.viewSet) { this.map.setView([47, 2], 4); this.viewSet = true; }
      return;
    }
    const html = '<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;'
      + 'gap:5px;padding:5px 11px 5px 8px;border-radius:999px;background:#1d1e23;color:#fff;'
      + 'font:700 13px/16px Figtree,system-ui,sans-serif;white-space:nowrap;'
      + `box-shadow:0 0 0 5px color-mix(in srgb,${p.accent} 30%,transparent),0 4px 12px rgba(0,0,0,.25)">`
      + `<span style="${ICON_FONT}font-size:17px">flight_land</span>${escapeHtml(d.city)}</div>`;
    this.destinationMarker = L.marker([d.lat, d.lon], {
      interactive: false, keyboard: false, zIndexOffset: 4000,
      icon: L.divIcon({ className: 'ib-marker', iconSize: [0, 0], iconAnchor: [0, 0], html }),
    }).addTo(this.map);
    if (moved) {
      const zoom = this.map.getSize().x > 820 ? 4 : 3.5;
      if (this.viewSet) this.map.flyTo([d.lat, d.lon], zoom, { duration: 0.9 });
      else this.map.setView([d.lat, d.lon], zoom);
      this.viewSet = true;
    }
  }

  private syncHome() {
    const h = this.props.current.home;
    const key = h ? h.name : '';
    if (key === this.keys.home) return;
    this.keys.home = key;
    if (this.homeMarker) { this.map.removeLayer(this.homeMarker); this.homeMarker = null; }
    if (!h) return;
    const html = '<div title="Home" style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:26px;'
      + 'height:26px;border-radius:50%;background:#fff;border:2px solid #1d1e23;display:flex;align-items:center;'
      + 'justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2)">'
      + `<span style="${ICON_FONT}font-size:16px;color:#1d1e23">home</span></div>`;
    this.homeMarker = L.marker([h.lat, h.lon], {
      interactive: false, keyboard: false, zIndexOffset: 3500,
      icon: L.divIcon({ className: 'ib-marker', iconSize: [0, 0], iconAnchor: [0, 0], html }),
    }).addTo(this.map);
  }

  private syncArcs() {
    const p = this.props.current;
    const dest: [number, number] | null = p.destination ? [p.destination.lat, p.destination.lon] : null;
    const selectedId = dest && p.selectedId && this.markers.has(p.selectedId) ? p.selectedId : '';
    const hoverId = dest && p.hoverId && p.hoverId !== selectedId && this.markers.has(p.hoverId) ? p.hoverId : '';
    const arcOptions = (weight: number, opacity: number): L.PolylineOptions =>
      ({ pane: 'arcs', color: p.accent, weight, opacity, interactive: false, lineCap: 'round' });

    const selKey = selectedId && selectedId + p.accent + p.destination!.iata;
    if (selKey !== this.keys.sel) {
      this.keys.sel = selKey;
      if (this.selectedArc) { this.map.removeLayer(this.selectedArc); this.selectedArc = null; }
      if (selectedId) {
        const r = this.markers.get(selectedId)!;
        this.selectedArc = L.polyline(arcPoints([r.latLng.lat, r.latLng.lng], dest!), arcOptions(2.5, 0.95)).addTo(this.map);
        animateStroke(this.selectedArc);
      }
    }
    const hovKey = hoverId && hoverId + p.accent + p.destination!.iata;
    if (hovKey !== this.keys.hov) {
      this.keys.hov = hovKey;
      if (this.hoverArc) { this.map.removeLayer(this.hoverArc); this.hoverArc = null; }
      if (hoverId) {
        const r = this.markers.get(hoverId)!;
        this.hoverArc = L.polyline(arcPoints([r.latLng.lat, r.latLng.lng], dest!), arcOptions(2, 0.45)).addTo(this.map);
      }
    }
    const groundId = p.home && (hoverId || selectedId);
    const groundKey = groundId ? groundId + p.home!.name : '';
    if (groundKey !== this.keys.gnd) {
      this.keys.gnd = groundKey;
      if (this.groundLine) { this.map.removeLayer(this.groundLine); this.groundLine = null; }
      if (groundId) {
        const r = this.markers.get(groundId)!;
        this.groundLine = L.polyline([[p.home!.lat, p.home!.lon], [r.latLng.lat, r.latLng.lng]], {
          pane: 'arcs', color: '#33353d', weight: 2, opacity: 0.75, dashArray: '2 6', interactive: false, lineCap: 'round',
        }).addTo(this.map);
      }
    }
  }

  private fitAll() {
    const p = this.props.current;
    const points = [...this.markers.values()].map(r => r.latLng);
    if (p.destination) points.push(L.latLng(p.destination.lat, p.destination.lon));
    if (points.length) this.map.flyToBounds(L.latLngBounds(points), { padding: [50, 50], duration: 0.8 });
  }

  private syncFit() {
    const p = this.props.current;
    const request = p.fitRequest;
    if (!request || request.key === this.keys.fit) return;
    this.keys.fit = request.key;
    const r = this.markers.get(request.id);
    if (!r || !p.destination) return;
    const bounds = L.latLngBounds([r.latLng, L.latLng(p.destination.lat, p.destination.lon)]);
    if (!this.map.getBounds().pad(-0.14).contains(bounds)) {
      this.map.flyToBounds(bounds, { padding: [110, 110], maxZoom: 6, duration: 0.8 });
    }
  }
}

export function InboundMap(props: InboundMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const controllerRef = useRef<MapController | null>(null);
  propsRef.current = props;

  useEffect(() => {
    const controller = new MapController(containerRef.current!, propsRef);
    controllerRef.current = controller;
    controller.update();
    return () => { controller.destroy(); controllerRef.current = null; };
  }, []);

  useEffect(() => { controllerRef.current?.update(); });

  return <div ref={containerRef} className="map-canvas" />;
}
