// Chọn một đô thị ở lớp Hệ thống đô thị (mapLevel 'urban'): bấm ký hiệu, nét ranh, bấm trong ranh đô thị trên bản đồ
// quy hoạch hoặc chọn ở mục Đô thị (panel phải). Ranh đô thị được làm nổi, ngoài phạm vi che mờ; phạm vi đã có quy hoạch tô
// theo ranh tổng đồ án cắt trong ranh đô thị, không vẽ lô: QHC vàng, QHPK cam, QHCT đỏ. Bấm vùng đồ án để xem chi tiết.
// Bỏ chọn: nút × trên thanh tên đô thị, phím Esc, hoặc bấm nền ngoài mọi đô thị (viewFlow.js).
// Nguồn: đồ án nhập có ranh tổng (state.projectCatalog, cấp theo tên), ranh 4 tiểu vùng QHC đô thị TT Huế 2045
// (qhc2045Layer.js) và lô QHCT 1/500 (qhctLayer.js) gộp theo đồ án.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn } from './planMap.js';
import { escapeHtml, ico } from './utils.js';
import { planLevelOf, OPEN_PROJECT_EVENT, GP_SCOPE_EVENT, URBAN_FOCUS_EVENT } from './generalPlan.js';
import { getLevel, setLevel, LEVEL_EVENT } from './mapLevel.js';
import { coreFrame } from './qhc2045Layer.js';
import { QHC2045 } from './qhc2045.js';
import { loadQhct } from './qhctLayer.js';

// Bấm vùng QHC đô thị TT Huế 2045: viewFlow.js sang QHC 1/10.000 và mở lô
export const FOCUS_CORE_EVENT = 'qh:urban-focus-core';

// Mặt nạ trên nét ranh đô thị (410) để làm mờ cả ranh đô thị khác; vùng đồ án trên ranh QHC (420), dưới viền đồ án
// đang mở (445); nét ranh đô thị đang chọn dưới viền phường đang chọn (448)
const MASK_PANE = ['urbanMaskPane', 412];
const AREA_PANE = ['urbanFocusPane', 444];
const LINE_PANE = ['urbanFocusLinePane', 446];
// Cấp nhỏ vẽ trên và đậm hơn để không chìm trong vùng QHC phủ rộng
const KINDS = {
  QHC: { title: 'Quy hoạch chung', color: '#facc15', fill: 0.2 },
  QHPK: { title: 'Quy hoạch phân khu 1/2.000', color: '#fb923c', fill: 0.4 },
  QHCT: { title: 'Quy hoạch chi tiết 1/500', color: '#ef4444', fill: 0.5 }
};
const KIND_ORDER = ['QHC', 'QHPK', 'QHCT'];
const KIND_SCALE = { QHC: 'QHC 1/10.000', QHPK: 'QHPK 1/2.000', QHCT: 'QHCT 1/500' };
const AREA_STYLE = { weight: 1.6, opacity: 0.95, fillRule: 'nonzero' };
const AREA_HOVER = 0.65;
const MASK_STYLE = { stroke: false, fillColor: '#020617', fillOpacity: 0.5, interactive: false };
const WORLD = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
// Đồ án cắt ranh đô thị chỉ tính khi phần trong đô thị ≥ tỷ lệ này của phần nhỏ hơn (bỏ đồ án chỉ chạm / lấn mép)
const MIN_SHARE = 0.05;
const tipOpts = { sticky: true, direction: 'top', offset: [0, -8], className: 'ua-tip', opacity: 1 };
// Đang chọn đô thị: ẩn nền tô phân loại đô thị (urbanAreaLayer.js) để màu vùng đồ án không bị pha
const FOCUS_CLASS = 'urban-focused';

const target = () => planMap || map;
const shownMap = () => (planMap && isCompareOn() && !isSplitOn() ? planMap : map);
const polysOf = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);
const multi = (geoms) => ({ type: 'MultiPolygon', coordinates: geoms.flatMap(polysOf) });

let current = null;
let group = null;
let bar = null;
let seq = 0;
const renderers = new WeakMap();

function rendererOf(m, [name, z]) {
  if (!m.getPane(name)) {
    const pane = m.createPane(name);
    pane.style.zIndex = z;
    pane.style.pointerEvents = 'none';
  }
  let r = renderers.get(m);
  if (!r) { r = {}; renderers.set(m, r); }
  if (!r[name]) r[name] = L.svg({ pane: name });
  return r[name];
}

// Phần đồ án nằm trong đô thị (null = ngoài đô thị); cắt lỗi thì giữ nguyên ranh đồ án
function clipper(u) {
  if (u.city) return (g) => g;
  const uf = turf.feature(u.geometry);
  const ub = turf.bbox(uf);
  const uArea = turf.area(uf);
  return (g) => {
    try {
      const f = turf.feature(g);
      const b = turf.bbox(f);
      if (b[0] > ub[2] || b[2] < ub[0] || b[1] > ub[3] || b[3] < ub[1]) return null;
      if (!turf.booleanIntersects(f, uf)) return null;
      const cut = turf.intersect(f, uf);
      if (!cut || turf.area(cut) < MIN_SHARE * Math.min(turf.area(f), uArea)) return null;
      return cut.geometry;
    } catch (e) {
      return g;
    }
  };
}

const openProject = (name) => () => document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: name }));

function openQhct(geometry) {
  setLevel('qhct');
  shownMap().fitBounds(L.geoJSON(geometry).getBounds(), { padding: [40, 40] });
}

async function coverage(u) {
  const clip = clipper(u);
  const items = [];
  (state.projectCatalog || []).forEach(p => {
    const geometry = p.tenQH && p.boundary ? clip(p.boundary) : null;
    if (geometry) items.push({ kind: planLevelOf(p.tenQH), name: p.tenQH, geometry, open: openProject(p.tenQH) });
  });
  const [core, qhct] = await Promise.all([coreFrame().catch(() => []), loadQhct().catch(() => null)]);
  const coreGeoms = core.map(f => (f.geometry ? clip(f.geometry) : null)).filter(Boolean);
  if (coreGeoms.length) {
    items.push({
      kind: 'QHC', name: QHC2045.name, note: QHC2045.status, geometry: multi(coreGeoms),
      open: () => document.dispatchEvent(new CustomEvent(FOCUS_CORE_EVENT))
    });
  }
  const lotsOf = new Map();
  (qhct?.features || []).forEach(f => {
    if (!polysOf(f.geometry).length) return;
    const name = String(f.properties?.tenQH || '').trim() || 'QHCT 1/500';
    if (!lotsOf.has(name)) lotsOf.set(name, []);
    lotsOf.get(name).push(f.geometry);
  });
  lotsOf.forEach((geoms, name) => {
    const all = multi(geoms);
    const geometry = clip(all);
    if (geometry) items.push({ kind: 'QHCT', name, geometry, lots: true, open: () => openQhct(all) });
  });
  return items;
}

function tipHtml(it) {
  return [
    `<b class="ua-tip-name">${escapeHtml(it.name)}</b>`,
    `${KINDS[it.kind].title}${it.note ? ` · ${escapeHtml(it.note)}` : ''}`,
    '<span class="ua-tip-muted">Bấm để xem chi tiết đồ án</span>'
  ].join('<br>');
}

function areaOf(geometry) {
  try { return turf.area(geometry); } catch (e) { return 0; }
}

function fmtHa(m2) {
  const ha = Math.max(0, m2) / 10000;
  const digits = ha > 0 && ha < 10 ? 1 : 0;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(ha);
}

function fmtPct(p) {
  if (!(p > 0)) return '0%';
  if (p < 0.5) return '<1%';
  return `${Math.round(Math.min(100, p))}%`;
}

// Gộp ranh cùng cấp trước khi đo: đồ án chồng nhau chỉ tính một lần. Mảnh lỗi thì bỏ, không cộng dồn.
function unionArea(geoms) {
  const feats = geoms.filter(g => polysOf(g).length).map(g => turf.feature(g));
  if (!feats.length) return 0;
  let acc = feats[0];
  for (let i = 1; i < feats.length; i++) {
    const piece = feats[i];
    try {
      acc = turf.union(acc, piece) || acc;
    } catch (e) {
      try {
        acc = turf.union(turf.truncate(acc, { precision: 6 }), turf.truncate(piece, { precision: 6 })) || acc;
      } catch (e2) { /* bỏ mảnh không hợp được */ }
    }
  }
  return areaOf(acc.geometry);
}

function shareStats(items) {
  const total = areaOf(current.geometry);
  const stats = {};
  KIND_ORDER.forEach(k => {
    const raw = unionArea(items.filter(i => i.kind === k).map(i => i.geometry));
    const covered = total > 0 ? Math.min(raw, total) : 0;
    stats[k] = { covered, total, pct: total > 0 ? (covered / total) * 100 : 0 };
  });
  return stats;
}

function rowHtml(k, stat) {
  const title = `${KINDS[k].title}: phần diện tích đô thị đã phủ. Đồ án chồng nhau chỉ tính một lần.`;
  const body = stat
    ? `${KIND_SCALE[k]}: <b>${fmtPct(stat.pct)}</b> diện tích (${fmtHa(stat.covered)}/${fmtHa(stat.total)} ha)`
    : `${KIND_SCALE[k]}: …`;
  return `<div class="ufb-row" title="${escapeHtml(title)}"><i style="background:${KINDS[k].color}"></i><span>${body}</span></div>`;
}

function clearLayers() {
  group?.remove();
  group = null;
  target()?.getContainer().classList.remove(FOCUS_CLASS);
}

function draw(items) {
  clearLayers();
  const m = target();
  if (!m || !current) return;
  m.getContainer().classList.add(FOCUS_CLASS);
  group = L.featureGroup();
  const polys = polysOf(current.geometry);
  L.polygon([WORLD, ...polys.map(p => toLatLngs(p[0]))], { pane: MASK_PANE[0], renderer: rendererOf(m, MASK_PANE), ...MASK_STYLE })
    .addTo(group);
  // Đồ án lớn vẽ dưới, đồ án nhỏ lồng bên trong nằm trên; QHC dưới cùng, QHCT trên cùng
  items.map(it => ({ it, a: areaOf(it.geometry) }))
    .sort((x, y) => KIND_ORDER.indexOf(x.it.kind) - KIND_ORDER.indexOf(y.it.kind) || y.a - x.a)
    .forEach(({ it }) => {
      const { color, fill } = KINDS[it.kind];
      const style = { ...AREA_STYLE, color, fillColor: color, fillOpacity: fill, ...(it.lots ? { stroke: false } : {}) };
      const layer = L.geoJSON(it.geometry, { pane: AREA_PANE[0], renderer: rendererOf(m, AREA_PANE), style, bubblingMouseEvents: false });
      layer.bindTooltip(tipHtml(it), tipOpts);
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: AREA_HOVER }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: fill }));
      layer.on('click', () => it.open());
      layer.addTo(group);
    });
  const rings = polys.flatMap(p => p).map(toLatLngs);
  const line = { pane: LINE_PANE[0], renderer: rendererOf(m, LINE_PANE), interactive: false, lineJoin: 'round', lineCap: 'round' };
  L.polyline(rings, { ...line, color: '#0f172a', weight: 9, opacity: 0.55 }).addTo(group);
  L.polyline(rings, { ...line, color: '#38bdf8', weight: 6, opacity: 0.55 }).addTo(group);
  L.polyline(rings, { ...line, color: '#ffffff', weight: 2.5, opacity: 1 }).addTo(group);
  group.addTo(m);
}

function paintBar(stats = null) {
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'urban-focus-bar';
    bar.setAttribute('role', 'status');
    bar.hidden = true;
    bar.addEventListener('click', (e) => { if (e.target.closest('.ufb-x')) clearUrbanFocus(); });
    document.body.appendChild(bar);
  }
  if (!current || getLevel() !== 'urban') { bar.hidden = true; return; }
  bar.innerHTML = `<div class="ufb-head"><b class="ufb-name" title="${escapeHtml(current.name)}">${escapeHtml(current.name)}</b>
    <button type="button" class="ufb-x" title="Bỏ chọn đô thị (Esc)" aria-label="Bỏ chọn đô thị">${ico('close')}</button></div>
    <div class="ufb-rows">${KIND_ORDER.map(k => rowHtml(k, stats?.[k])).join('')}</div>`;
  bar.hidden = false;
}

async function render() {
  const id = ++seq;
  clearLayers();
  paintBar();
  if (!current || getLevel() !== 'urban') return;
  const items = await coverage(current);
  if (id !== seq || !current || getLevel() !== 'urban') return;
  draw(items);
  paintBar(shareStats(items));
}

function fitFocus() {
  if (!current) return;
  const b = L.geoJSON(current.geometry).getBounds();
  if (b.isValid()) shownMap().flyToBounds(b, { padding: [40, 40], duration: 0.8 });
}

const emitFocus = () => document.dispatchEvent(new CustomEvent(URBAN_FOCUS_EVENT, { detail: current?.key || null }));

/** u = { key, name, geometry, city }; chọn lại đô thị đang chọn chỉ phóng tới */
export function focusUrban(u, { fit = true } = {}) {
  if (!u?.geometry || !polysOf(u.geometry).length) return;
  const same = current?.key === u.key;
  current = { key: u.key, name: u.name || '', geometry: u.geometry, city: !!u.city };
  if (fit) fitFocus();
  if (same) return;
  emitFocus();
  render();
}

export function clearUrbanFocus() {
  if (!current) return;
  current = null;
  seq++;
  clearLayers();
  paintBar();
  emitFocus();
}

/** Điểm bấm nằm trong đô thị đang chọn (đô thị loại I toàn thành phố không giữ click để còn chọn đô thị bên trong) */
export function urbanFocusHolds(latlng) {
  if (!current || current.city || !latlng) return false;
  try { return turf.booleanPointInPolygon([latlng.lng, latlng.lat], turf.feature(current.geometry)); } catch (e) { return false; }
}

export function initUrbanFocus() {
  // Rời lớp đô thị thì ẩn, quay lại (VD thoát đồ án vừa mở từ đô thị) thì vẽ lại; chọn lại chính lớp này (về toàn TP) thì bỏ chọn
  document.addEventListener(LEVEL_EVENT, (e) => {
    const { level, prev } = e.detail || {};
    if (level === 'urban' && prev === 'urban') { clearUrbanFocus(); return; }
    if (level === 'urban' && current) fitFocus();
    render();
  });
  document.addEventListener(GP_SCOPE_EVENT, (e) => {
    const d = e.detail;
    if (!d) {
      if (current?.key.startsWith('gp:')) clearUrbanFocus();
      return;
    }
    if (getLevel() === 'urban') focusUrban({ key: `gp:${d.id}`, name: d.name, geometry: d.geometry, city: d.city }, { fit: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !current || getLevel() !== 'urban') return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    clearUrbanFocus();
  });
}
