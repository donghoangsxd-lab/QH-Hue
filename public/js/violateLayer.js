// Công trình giao hành lang 50 m ngoài mép nước (đoạn sông rộng hơn 100 m tại chỗ), hoặc nằm trên rừng phòng hộ / đặc dụng.
// Số liệu tính sẵn (scripts/rebuild-river-corridor.py). Bật lớp mới tải nét ranh 50 m.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { escapeHtml, fmtNum } from './utils.js';
import { setRiverCounts, setWardRiverHtml } from './uiComponents.js';

const PANE = 'violatePane';
const HIT_PANE = 'violateHitPane';
const LINE_PANE = 'violateLinePane';
const PANE_Z = 462;
const HIT_Z = 470;
const LINE_Z = 650;
const CELL = 0.008;

const $ = (id) => document.getElementById(id);

let pack = null;
let loadP = null;
let lineP = null;
let on = false;
const lineLayers = [];
const lineRenderers = new WeakMap();
const layers = new Map();
const hits = new Map();
const renderers = new WeakMap();
const unbind = [];

function colorOf(reason) {
  const corridor = reason & 1;
  const forest = reason & 6;
  if (corridor && forest) return '#c084fc';
  if (corridor) return '#f87171';
  return '#fbbf24';
}

function reasonText(pt) {
  const parts = [];
  if (pt.reason & 1) parts.push(`Hành lang 50 m ngoài mép nước, đoạn sông rộng hơn 100 m tại chỗ. Diện tích dấu chân trong hành lang ${fmtNum(pt.ac)} m².`);
  if (pt.reason & 2) parts.push('Nằm trên đất rừng phòng hộ quy hoạch.');
  if (pt.reason & 4) parts.push('Nằm trên đất rừng đặc dụng quy hoạch.');
  if (pt.reason & 6) parts.push(`Diện tích dấu chân trên đất rừng ${fmtNum(pt.af)} m².`);
  return parts;
}

function indexPoints(pts, wards) {
  const grid = new Map();
  const list = pts.map((row) => {
    const pt = {
      lng: row[0], lat: row[1], ac: row[2], af: row[3], reason: row[4],
      ward: wards[row[5]] ? wards[row[5]].name : ''
    };
    const key = `${Math.floor(pt.lng / CELL)}:${Math.floor(pt.lat / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(pt);
    return pt;
  });
  return { list, grid };
}

function cellsIn(bounds) {
  const x0 = Math.floor(bounds.getWest() / CELL);
  const x1 = Math.floor(bounds.getEast() / CELL);
  const y0 = Math.floor(bounds.getSouth() / CELL);
  const y1 = Math.floor(bounds.getNorth() / CELL);
  const keys = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`);
  return keys;
}

function pointsIn(bounds) {
  if (!pack) return [];
  const out = [];
  cellsIn(bounds).forEach((key) => {
    (pack.grid.get(key) || []).forEach((pt) => {
      if (pt.lng >= bounds.getWest() && pt.lng <= bounds.getEast() && pt.lat >= bounds.getSouth() && pt.lat <= bounds.getNorth()) out.push(pt);
    });
  });
  return out;
}

function loadPack() {
  if (pack) return Promise.resolve(pack);
  if (!loadP) {
    const url = new URL('data/gba/bank-forest.json?v=4', document.baseURI).href;
    loadP = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).then((data) => {
      const indexed = indexPoints(data.pts || [], data.wards || []);
      pack = { ...data, ...indexed };
      return pack;
    }).catch((err) => {
      loadP = null;
      throw err;
    });
  }
  return loadP;
}

function statsHtml(data) {
  const t = data.totals || {};
  const rank = data.wardRank || [];
  const byName = new Map((data.wards || []).map((row) => [row.name, row]));
  const rows = rank.map((name) => byName.get(name)).filter(Boolean).slice(0, 40);
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${fmtNum(row.corridor)}</td><td>${fmtNum(row.forest)}</td><td>${fmtNum(row.both)}</td></tr>`).join('');
  return `<p>${escapeHtml(data.note || '')}</p>
    <div class="flood-kpi"><span>Trong hành lang sông</span><b>${fmtNum(t.corridor || 0)}</b></div>
    <div class="flood-kpi"><span>Trên đất rừng phòng hộ, đặc dụng</span><b>${fmtNum(t.forest || 0)}</b></div>
    <div class="flood-kpi"><span>Cả hai</span><b>${fmtNum(t.both || 0)}</b></div>
    <div class="violate-legend">
      <span><i style="background:#f87171"></i>Hành lang</span>
      <span><i style="background:#fbbf24"></i>Đất rừng</span>
      <span><i style="background:#c084fc"></i>Cả hai</span>
      <span><i class="violate-line"></i>Ranh 50 m</span>
    </div>
    <p class="flood-muted">Cột hành lang và cột rừng đều gồm công trình trùng. Phóng tới mức 16 và bấm dấu tròn để xem lý do, diện tích.</p>
    <details class="detail-more"><summary>Bảng phường, xã</summary>
      <div class="violate-table-wrap"><table class="violate-table"><thead><tr><th>Phường, xã</th><th>Hành lang</th><th>Rừng</th><th>Trùng</th></tr></thead><tbody>${body}</tbody></table></div>
    </details>`;
}

function paintBox() {
  const box = $('violateBox');
  if (!box) return;
  box.style.display = on ? '' : 'none';
  if (!on || !pack) return;
  box.innerHTML = statsHtml(pack);
}

const Glow = L.Layer.extend({
  onAdd(m) {
    this._map = m;
    if (!m.getPane(PANE)) {
      const pane = m.createPane(PANE);
      pane.style.zIndex = String(PANE_Z);
      pane.style.pointerEvents = 'none';
    }
    this._canvas = L.DomUtil.create('canvas', 'violate-canvas', m.getPane(PANE));
    this._draw = () => this._paint();
    m.on('move zoom viewreset resize', this._draw, this);
    this._paint();
  },
  onRemove(m) {
    m.off('move zoom viewreset resize', this._draw, this);
    this._canvas?.remove();
    this._canvas = null;
  },
  _paint() {
    const m = this._map;
    const canvas = this._canvas;
    if (!m || !canvas || !pack) return;
    const size = m.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, size.x * dpr);
    canvas.height = Math.max(1, size.y * dpr);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, m.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const pts = pointsIn(m.getBounds().pad(0.2));
    const zoom = m.getZoom();
    const step = pts.length > 4000 && zoom < 16 ? Math.ceil(pts.length / 4000) : 1;
    const radius = zoom >= 16 ? 5 : 3;
    for (let i = 0; i < pts.length; i += step) {
      const pt = pts[i];
      const xy = m.latLngToContainerPoint([pt.lat, pt.lng]);
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(pt.reason);
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#7f1d1d';
      ctx.stroke();
    }
  }
});

function popupHtml(pt) {
  const lines = reasonText(pt).map((line) => `<span>${escapeHtml(line)}</span>`).join('');
  return `<div class="violate-pop"><b>Công trình trong hành lang / đất rừng</b>${lines}<span>Phường, xã: ${escapeHtml(pt.ward || 'chưa rõ')}</span></div>`;
}

function syncHits(m) {
  const old = hits.get(m);
  if (old) {
    old.remove();
    hits.delete(m);
  }
  if (!on || !pack || m.getZoom() < 16) return;
  const pts = pointsIn(m.getBounds());
  if (pts.length > 1500) return;
  let renderer = renderers.get(m);
  if (!renderer) {
    if (!m.getPane(HIT_PANE)) {
      const pane = m.createPane(HIT_PANE);
      pane.style.zIndex = String(HIT_Z);
    }
    renderer = L.svg({ pane: HIT_PANE });
    renderers.set(m, renderer);
  }
  const group = L.layerGroup();
  pts.forEach((pt) => {
    const mark = L.circleMarker([pt.lat, pt.lng], {
      radius: 6,
      color: '#7f1d1d',
      weight: 1,
      fillColor: colorOf(pt.reason),
      fillOpacity: 0.95,
      pane: HIT_PANE,
      renderer
    });
    mark.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      L.popup({ maxWidth: 280, className: 'violate-popup' })
        .setLatLng(e.latlng)
        .setContent(popupHtml(pt))
        .openOn(m);
    });
    group.addLayer(mark);
  });
  group.addTo(m);
  hits.set(m, group);
}

function bind(m) {
  const glow = new Glow();
  glow.addTo(m);
  layers.set(m, glow);
  const move = () => syncHits(m);
  m.on('moveend zoomend', move);
  unbind.push(() => {
    m.off('moveend zoomend', move);
    glow.remove();
    layers.delete(m);
    const group = hits.get(m);
    if (group) {
      group.remove();
      hits.delete(m);
    }
  });
  syncHits(m);
}

function loadLines() {
  if (lineP) return lineP;
  const url = new URL('data/gba/river-corridor.json?v=2', document.baseURI).href;
  lineP = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).catch((err) => {
    lineP = null;
    throw err;
  });
  return lineP;
}

function clearLines() {
  while (lineLayers.length) lineLayers.pop().remove();
}

function lineRenderer(m) {
  if (!m.getPane(LINE_PANE)) {
    const pane = m.createPane(LINE_PANE);
    pane.style.zIndex = String(LINE_Z);
    pane.style.pointerEvents = 'none';
  }
  // Bản đồ dùng canvas chung, nên nét này cần renderer riêng mới nằm trên các lớp khác.
  let renderer = lineRenderers.get(m);
  if (!renderer) {
    renderer = L.svg({ pane: LINE_PANE });
    lineRenderers.set(m, renderer);
  }
  return renderer;
}

function drawLines(m, geo) {
  if (!m || !geo) return;
  const layer = L.geoJSON(geo, {
    pane: LINE_PANE,
    renderer: lineRenderer(m),
    interactive: false,
    style: {
      color: '#22d3ee',
      weight: 2.5,
      opacity: 1,
      dashArray: '7 5',
      lineCap: 'butt'
    }
  });
  layer.addTo(m);
  lineLayers.push(layer);
}

function clearMaps() {
  while (unbind.length) unbind.pop()();
  clearLines();
}

function publishCounts(data) {
  const byName = new Map((data.wards || []).map((w) => [w.name, w]));
  setRiverCounts((name) => {
    const w = byName.get(name);
    return w ? { corridor: w.corridor || 0, forest: w.forest || 0 } : { corridor: 0, forest: 0 };
  });
}

function setOn(next) {
  on = !!next;
  const box = $('violateBox');
  if (box) box.style.display = on ? '' : 'none';
  clearMaps();
  if (!on || !map) return;
  if (box) box.innerHTML = '<p class="flood-muted">Đang tải số liệu…</p>';
  Promise.all([loadPack(), loadLines()]).then(([data, geo]) => {
    if (!on) return;
    try { publishCounts(data); } catch (err) { console.warn('Hành lang sông:', err); }
    try { paintBox(); } catch (err) { console.warn('Hành lang sông:', err); }
    try {
      drawLines(map, geo);
      if (planMap) drawLines(planMap, geo);
      bind(map);
      if (planMap) bind(planMap);
    } catch (err) { console.warn('Nét hành lang:', err); }
  }).catch((err) => {
    console.warn('Hành lang sông:', err);
    if (box) box.innerHTML = '<p>Chưa có tệp số liệu hành lang và đất rừng.</p>';
  });
}

function wardHtml(name) {
  if (!pack) return '';
  const row = (pack.wards || []).find((w) => w.name === name) || { corridor: 0, forest: 0, both: 0 };
  return `<section class="lot-over river-ward">
    <h4>Hành lang sông và đất rừng</h4>
    <div class="lot-over-kpis">
      <div><span>Hành lang sông</span><b>${fmtNum(row.corridor)}</b></div>
      <div><span>Rừng phòng hộ, đặc dụng</span><b>${fmtNum(row.forest)}</b></div>
    </div>
  </section>`;
}

export function initViolateLayer() {
  if (!map) return;
  setWardRiverHtml(wardHtml);
  const chk = $('chk_violate');
  // Ô không lấy trạng thái phiên trước. Tải bank-forest.json và nét hành lang chỉ khi người dùng bật.
  if (chk) chk.checked = false;
  chk?.addEventListener('change', (e) => setOn(e.target.checked));
}
