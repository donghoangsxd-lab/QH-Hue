// Lớp bản đồ đồ án QHC đô thị Thừa Thiên Huế 2045 (qhc2045.js) trên bản đồ quy hoạch, điều khiển ở panel Lớp dữ liệu:
//  - chk_qhc25: sơ đồ tổ chức không gian 1/25.000 toàn đô thị (vùng phát triển, mặt nước, cây xanh, ranh khu vực;
//    chú giải ở tab Chú giải, bộ QHC25 – tt16Symbols.js);
//  - chk_qhc10: sử dụng đất 1/10.000 khu vực trung tâm (lô theo ký hiệu TT16 Mục 02, viền theo giai đoạn, lọc giai đoạn
//    ngay dưới dòng lớp) + 4 tiểu vùng, phân khu, điểm chức năng;
//  - chk_qhc10Ext: ranh 1/10.000 mở rộng theo QĐ 756 (ranh ngoài các phường vùng lõi) + vùng đỏ Hóa Châu, Mỹ Thượng
//    chưa có trong đồ án cũ.
// Vùng, lô của cả ba lớp chung một canvas ở pane dưới lô đồ án QHPK (overlayPane 400); riêng các đường ranh vẽ ở LINE_PANE
// để nổi trên ranh 40 phường. Canvas mặc định của planMap (renderer: L.canvas())
// nằm ở overlayPane, phủ kín bản đồ khi có bất kỳ lớp vector nào và nuốt click của canvas QHC bên dưới, nên click lô / vùng
// được dò lại ở cấp bản đồ (qhcClick, gọi từ app.js) bằng bbox + point-in-polygon.
import { state } from './state.js';
import { map, wardNameAt, outerWardLines, openOutlinedPopup } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn, getViewMode, setViewMode, passToolClick } from './planMap.js';
import { escapeHtml, fmtNum, ico, WARD_PICK_EVENT } from './utils.js';
import { tt16SymbolStyle, tt16SwatchCss, TT16_STYLES, TT16_PATTERN_ZOOM, LOT_OPACITY_EVENT } from './tt16Symbols.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import {
  QHC2045, CENTER_UNITS, ZONE_NAMES, STAGE_LAYERS, landOf, bareWard, isCoreWard,
  visionColor, visionLineStyle, WATER_KINDS, GREEN_COLOR
} from './qhc2045.js';

export { isCoreWard };

const PANE = ['qhcPane', 350];
// Ranh tiểu vùng, phân khu 1/10.000 và ranh mở rộng QĐ 756 nằm trên ranh 40 phường (overlayPane 400), dưới ranh đồ án
// QHPK (projectGlowPane 445) và viền phường đang chọn (448); không nhận click
const LINE_PANE = ['qhcLinePane', 420];
const LABEL_MIN_ZOOM = 14;
const TV_LABEL_MAX_ZOOM = 14;
const STAGES = [
  { id: 'all', label: 'Tất cả' },
  { id: 0, label: 'Hiện trạng' },
  { id: 1, label: 'Đến 2030' },
  { id: 2, label: 'Đến 2040' }
];
const STAGE_NAMES = ['Hiện trạng', 'Ngắn hạn đến 2030', 'Dài hạn đến 2040'];
const MISSING_STYLE = { color: '#ef4444', weight: 2.2, dashArray: '8 5', fillColor: '#ef4444', fillOpacity: 0.28, interactive: true };
const EXT_LINE = { color: '#f43f5e', weight: 3, opacity: 1, dashArray: '12 6' };
const EXT_HALO = { color: '#0f172a', weight: 6.5, opacity: 0.55 };

// Mã 31 "Mặt nước ven biển": một khối biển ~55.000 ha phủ kín góc bản đồ, không mang thông tin sử dụng đất
const SEA_CODE = 31;

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
const centerSet = new Set(CENTER_UNITS.map(bareWard));

const data = { land: null, frame: null, vision: null };
const loading = {};
const layers = { land: null, frame: null, vision: null, ext: null };
let renderer = null;
let lineRenderer = null;
let stage = 'all';
let detailed = false;

// ---------- Tải dữ liệu ----------
function load(kind) {
  if (data[kind]) return Promise.resolve(data[kind]);
  if (!loading[kind]) {
    loading[kind] = fetch(QHC2045.urls[kind])
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(fc => { data[kind] = fc; return fc; })
      .finally(() => { delete loading[kind]; });
  }
  return loading[kind];
}

function setHint(id, text) {
  const el = $(id);
  if (el) el.textContent = text ? `(${text})` : '';
}

function ensureRenderer(m) {
  if (renderer) return renderer;
  const pane = m.getPane(PANE[0]) || m.createPane(PANE[0]);
  pane.style.zIndex = PANE[1];
  renderer = L.canvas({ pane: PANE[0], padding: 0.3 });
  return renderer;
}

function ensureLineRenderer(m) {
  if (lineRenderer) return lineRenderer;
  const pane = m.getPane(LINE_PANE[0]) || m.createPane(LINE_PANE[0]);
  pane.style.zIndex = LINE_PANE[1];
  pane.style.pointerEvents = 'none';
  lineRenderer = L.canvas({ pane: LINE_PANE[0], padding: 0.3 });
  return lineRenderer;
}

/** Thứ tự vẽ trong canvas chung: định hướng 1/25.000 < lô 1/10.000 < điểm chức năng < vùng đang điều chỉnh */
function restack() {
  layers.vision?.bringToBack();
  layers.frame?.bringToFront();
  layers.frame?.points?.bringToFront();
  layers.ext?.bringToFront();
}

// ---------- 1/10.000: lô sử dụng đất ----------
function lotStyle(f) {
  const p = f.properties;
  const land = landOf(data.land.zones[p.z], p.c);
  return tt16SymbolStyle(land.key, land.tone, STAGE_LAYERS[p.t], { scenario: 'QH', detailed });
}

function drawLand() {
  const m = target();
  layers.land?.remove();
  layers.land = L.geoJSON(data.land, {
    pane: PANE[0],
    renderer: ensureRenderer(m),
    bubblingMouseEvents: false,
    filter: (f) => f.properties.c !== SEA_CODE && (stage === 'all' || f.properties.t === stage),
    style: lotStyle
  }).on('click', (e) => { if (!passToolClick(m, e)) openLotPopup(e.layer.feature, e.latlng); });
  layers.land.addTo(m);
  restack();
}

function restyleLand() {
  if (layers.land) layers.land.setStyle(lotStyle);
}

function frameLabel(text, cls) {
  return L.divIcon({ className: 'qhc-label-icon', html: `<span class="qhc-label ${cls}">${text}</span>`, iconSize: [0, 0] });
}

function drawFrame() {
  const m = target();
  layers.frame?.remove();
  const r = ensureRenderer(m);
  const lr = ensureLineRenderer(m);
  const lines = L.featureGroup();
  const tvLabels = L.layerGroup();
  const ptLayer = L.featureGroup();
  data.frame.features.forEach(f => {
    const p = f.properties;
    if (p.k === 'tv') {
      L.geoJSON(f, { pane: LINE_PANE[0], renderer: lr, interactive: false, style: { color: '#0f172a', weight: 5, opacity: 0.45, fill: false } }).addTo(lines);
      L.geoJSON(f, { pane: LINE_PANE[0], renderer: lr, interactive: false, style: { color: '#f8fafc', weight: 2.4, opacity: 0.95, dashArray: '12 6', fill: false } }).addTo(lines);
      const c = turf.pointOnFeature(f).geometry.coordinates;
      L.marker([c[1], c[0]], { icon: frameLabel(`<b>${escapeHtml(p.tv)}</b> ${escapeHtml(p.ten)}`, 'qhc-label-tv'), interactive: false, keyboard: false }).addTo(tvLabels);
    } else if (p.k === 'pk') {
      L.geoJSON(f, { pane: LINE_PANE[0], renderer: lr, interactive: false, style: { color: '#e2e8f0', weight: 1.1, opacity: 0.7, dashArray: '3 4', fill: false } }).addTo(lines);
    } else if (p.k === 'd') {
      const [lng, lat] = f.geometry.coordinates;
      L.circleMarker([lat, lng], { pane: PANE[0], renderer: r, radius: 3.5, color: '#0f172a', weight: 1, fillColor: p.t ? '#fb923c' : '#f8fafc', fillOpacity: 1 })
        .bindTooltip(`${escapeHtml(p.n)} · ${STAGE_NAMES[p.t] || ''}`, { direction: 'top', className: 'ua-tip', opacity: 1 })
        .addTo(ptLayer);
    }
  });
  layers.frame = L.featureGroup([lines]);
  layers.frame.tvLabels = tvLabels;
  layers.frame.points = ptLayer;
  layers.frame.addTo(m);
  zoomFrame();
  restack();
}

function zoomFrame() {
  const m = target();
  if (!layers.frame || !m.hasLayer(layers.frame)) return;
  const z = m.getZoom();
  const { tvLabels, points } = layers.frame;
  if (z <= TV_LABEL_MAX_ZOOM) tvLabels.addTo(m); else tvLabels.remove();
  if (z >= LABEL_MIN_ZOOM) { points.addTo(m); points.bringToFront(); } else points.remove();
}

async function setLand(on) {
  const m = target();
  if (!on) {
    layers.land?.remove();
    layers.frame?.tvLabels?.remove();
    layers.frame?.points?.remove();
    layers.frame?.remove();
    layers.land = layers.frame = null;
    setHint('qhc10Hint', 'khu vực trung tâm');
    return;
  }
  setHint('qhc10Hint', 'đang tải…');
  try {
    await Promise.all([load('land'), load('frame')]);
  } catch (err) {
    console.warn('QHC 2045 – không tải được lớp 1/10.000:', err);
    setHint('qhc10Hint', 'lỗi tải');
    return;
  }
  if (!$('chk_qhc10')?.checked) return;
  detailed = m.getZoom() >= TT16_PATTERN_ZOOM;
  drawLand();
  drawFrame();
  setHint('qhc10Hint', `${fmtNum(data.land.features.length)} lô`);
}

// ---------- Ranh 1/10.000 mở rộng theo QĐ 756 ----------
async function setExt(on) {
  const m = target();
  layers.ext?.remove();
  layers.ext = null;
  if (!on) {
    setHint('qhc10ExtHint', 'Hóa Châu, Mỹ Thượng');
    return;
  }
  setHint('qhc10ExtHint', 'đang tải…');
  try {
    await load('frame');
  } catch (err) {
    console.warn('QHC 2045 – không tải được ranh điều chỉnh:', err);
    setHint('qhc10ExtHint', 'lỗi tải');
    return;
  }
  if (!$('chk_qhc10Ext')?.checked) return;
  const wards = (state.wardLabelsList || []).filter(w => w.geometry && isCoreWard(w.name));
  if (!wards.length) {
    setHint('qhc10ExtHint', 'chưa tải ranh phường');
    return;
  }
  const r = ensureRenderer(m);
  const group = L.featureGroup();
  data.frame.features.filter(f => f.properties.k === 'dc').forEach(f => {
    const p = f.properties;
    L.geoJSON(f, { pane: PANE[0], renderer: r, style: MISSING_STYLE })
      .bindTooltip(`<b>Đang điều chỉnh</b> · ${escapeHtml(p.n)} (~${fmtNum(p.a)} ha)<br><span class="ua-tip-muted">Chưa có trong ${escapeHtml(QHC2045.short)}; bổ sung vào phạm vi 1/10.000 theo QĐ 756 khi điều chỉnh QHC thành phố Huế.</span>`,
        { sticky: true, className: 'ua-tip', opacity: 1 })
      .addTo(group);
    const c = turf.pointOnFeature(f).geometry.coordinates;
    L.marker([c[1], c[0]], { icon: frameLabel(`Đang điều chỉnh · ${escapeHtml(p.n)}`, 'qhc-label-dc'), interactive: false, keyboard: false }).addTo(group);
  });
  const lines = outerWardLines(wards);
  const lr = ensureLineRenderer(m);
  L.polyline(lines, { pane: LINE_PANE[0], renderer: lr, interactive: false, ...EXT_HALO }).addTo(group);
  L.polyline(lines, { pane: LINE_PANE[0], renderer: lr, interactive: false, ...EXT_LINE }).addTo(group);
  layers.ext = group.addTo(m);
  restack();
  setHint('qhc10ExtHint', `${wards.length} phường, xã`);
}

// ---------- Popup tra cứu lô ----------
function tvAt(lng, lat) {
  const tv = data.frame?.features.find(f => f.properties.k === 'tv' && turf.booleanPointInPolygon([lng, lat], f));
  return tv ? tv.properties : null;
}

function qhpkAt(lng, lat) {
  return (state.projectCatalog || []).filter(p => {
    if (!p || !p.tenQH || !p.boundary || planLevelOf(p.tenQH) !== 'QHPK') return false;
    const b = p.bbox;
    if (b && (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])) return false;
    try { return turf.booleanPointInPolygon([lng, lat], turf.feature(p.boundary)); } catch (e) { return false; }
  });
}

function swatchHtml(land) {
  const s = land.key ? TT16_STYLES[land.key] : null;
  const bg = (s && tt16SwatchCss(land.key, 0.7)) || `background:${s ? s.color : land.tone};`;
  return `<i class="qhc-sw" style="${bg}border-color:${s ? s.color : land.tone}"></i>`;
}

function openLotPopup(f, latlng) {
  const p = f.properties;
  const zone = data.land.zones[p.z];
  const land = landOf(zone, p.c);
  const ward = wardNameAt(latlng.lat, latlng.lng);
  const tv = tvAt(latlng.lng, latlng.lat);
  const note = p.n != null ? data.land.notes[p.n] : '';
  const projects = qhpkAt(latlng.lng, latlng.lat);
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const projectHtml = projects.length
    ? projects.map(x => `<button type="button" class="qhc-pop-link" data-qhc-open="${escapeHtml(x.tenQH)}">${ico('file')}${escapeHtml(x.tenQH)}</button>`).join('')
    : '<span class="ua-tip-muted">Chưa có đồ án QHPK 1/2.000 tại vị trí này</span>';
  const html = `<div class="qhc-pop">
      <div class="qhc-pop-head">${swatchHtml(land)}<b>${escapeHtml(land.label)}</b></div>
      <table class="qhc-pop-table">
        ${row('Khu', escapeHtml(ZONE_NAMES[zone] || zone))}
        ${row('Giai đoạn', escapeHtml(STAGE_NAMES[p.t] || ''))}
        ${row('Diện tích', `${fmtNum(p.a)} ha`)}
        ${note ? row('Ghi chú', escapeHtml(note)) : ''}
        ${tv ? row('Tiểu vùng', `${escapeHtml(tv.tv)} · ${escapeHtml(tv.ten)}`) : ''}
        ${ward ? row('Phường, xã', escapeHtml(ward)) : ''}
      </table>
      <div class="qhc-pop-sec">QHPK 1/2.000 tại vị trí</div>
      <div class="qhc-pop-projects">${projectHtml}</div>
      ${ward ? `<button type="button" class="bp-btn qhc-pop-ward" data-qhc-ward="${escapeHtml(ward)}">${ico('map')}Xem ${escapeHtml(ward)}</button>` : ''}
      <div class="qhc-pop-src">${escapeHtml(QHC2045.short)} · 1/10.000 · <span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></div>
    </div>`;
  openOutlinedPopup(target(), f.geometry, L.popup({ maxWidth: 320, className: 'qhc-popup' }).setContent(html), latlng);
}

// ---------- 1/25.000: sơ đồ tổ chức không gian ----------
function drawVision() {
  const m = target();
  layers.vision?.remove();
  const r = ensureRenderer(m);
  const cats = data.vision.cats;
  const fills = [], waters = [], greens = [], lines = [];
  data.vision.features.forEach(f => {
    const L_ = f.properties.L;
    if (L_ === 'v') fills.push(f);
    else if (L_ === 'n' && f.properties.k !== 2) waters.push(f);
    else if (L_ === 'x') greens.push(f);
    else if (L_ === 'r') lines.push(f);
  });
  const zoneName = (f) => cats.zones[f.properties.k] || 'Khác';
  const fillLayer = L.geoJSON({ type: 'FeatureCollection', features: fills }, {
    pane: PANE[0], renderer: r, bubblingMouseEvents: false,
    style: (f) => { const c = visionColor(zoneName(f)); return { color: c, weight: 0.5, opacity: 0.8, fillColor: c, fillOpacity: 0.5 }; }
  }).on('click', (e) => { if (!passToolClick(m, e)) openVisionPopup(e.layer.feature, e.latlng); });
  const waterLayer = L.geoJSON({ type: 'FeatureCollection', features: waters }, {
    pane: PANE[0], renderer: r, interactive: false,
    style: (f) => { const c = (WATER_KINDS[f.properties.k] || WATER_KINDS[0]).color; return { color: c, weight: 0.4, fillColor: c, fillOpacity: f.properties.k === 2 ? 0.25 : 0.65 }; }
  });
  const greenLayer = L.geoJSON({ type: 'FeatureCollection', features: greens }, {
    pane: PANE[0], renderer: r, interactive: false,
    style: { color: GREEN_COLOR, weight: 0.4, fillColor: GREEN_COLOR, fillOpacity: 0.6 }
  });
  const lineLayer = L.geoJSON({ type: 'FeatureCollection', features: lines }, {
    pane: PANE[0], renderer: r,
    style: (f) => ({ ...visionLineStyle(cats.lines[f.properties.k]), opacity: 0.95 }),
    onEachFeature: (f, l) => {
      const note = cats.lineNotes[f.properties.g];
      l.bindTooltip(`<b>${escapeHtml(cats.lines[f.properties.k] || 'Ranh giới')}</b>${note ? `<br><span class="ua-tip-muted">${escapeHtml(note)}…</span>` : ''}`,
        { sticky: true, className: 'ua-tip', opacity: 1 });
    }
  });
  layers.vision = L.featureGroup([fillLayer, waterLayer, greenLayer, lineLayer]);
  layers.vision.fills = fills;
  layers.vision.addTo(m);
  restack();
}

function openVisionPopup(f, latlng) {
  const cats = data.vision.cats;
  const zone = cats.zones[f.properties.k] || 'Khác';
  const desc = cats.funcs[f.properties.f] || '';
  const html = `<div class="qhc-pop">
      <div class="qhc-pop-head"><i class="qhc-sw" style="background:${visionColor(zone)}"></i><b>${escapeHtml(zone)}</b></div>
      ${f.properties.n ? `<div>${escapeHtml(f.properties.n)}</div>` : ''}
      ${desc ? `<p class="qhc-pop-desc">${escapeHtml(desc)}</p>` : ''}
      <div class="qhc-pop-src">${escapeHtml(QHC2045.short)} · Sơ đồ tổ chức không gian 1/25.000 · <span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></div>
    </div>`;
  openOutlinedPopup(target(), f.geometry, L.popup({ maxWidth: 320, className: 'qhc-popup' }).setContent(html), latlng);
}

// ---------- Click cấp bản đồ ----------
const bboxes = new WeakMap();

/** Đối tượng vẽ sau (nằm trên) chứa điểm [lng, lat] */
function featureAt(features, lng, lat) {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f || !f.geometry) continue;
    let b = bboxes.get(f);
    if (!b) { b = turf.bbox(f); bboxes.set(f, b); }
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    try { if (turf.booleanPointInPolygon([lng, lat], f)) return f; } catch (err) { /* hình học lỗi */ }
  }
  return null;
}

/** Click nền bản đồ m (không bật công cụ): mở popup lô 1/10.000 hoặc vùng 1/25.000 tại điểm bấm. → true khi đã mở */
export function qhcClick(e, m) {
  if (!m || m !== target() || !e?.latlng) return false;
  const { lat, lng } = e.latlng;
  if (layers.land && m.hasLayer(layers.land)) {
    const f = featureAt(layers.land.getLayers().map(l => l.feature), lng, lat);
    if (f) { openLotPopup(f, e.latlng); return true; }
  }
  if (layers.vision && m.hasLayer(layers.vision)) {
    const f = featureAt(layers.vision.fills, lng, lat);
    if (f) { openVisionPopup(f, e.latlng); return true; }
  }
  return false;
}

async function setVision(on) {
  if (!on) {
    layers.vision?.remove();
    layers.vision = null;
    setHint('qhc25Hint', 'toàn đô thị');
    return;
  }
  setHint('qhc25Hint', 'đang tải…');
  try {
    await load('vision');
  } catch (err) {
    console.warn('QHC 2045 – không tải được lớp 1/25.000:', err);
    setHint('qhc25Hint', 'lỗi tải');
    return;
  }
  if (!$('chk_qhc25')?.checked) return;
  drawVision();
  setHint('qhc25Hint', 'toàn đô thị');
}

// ---------- Bật lớp: chuyển sang bản đồ quy hoạch nếu đang xem hiện trạng ----------
function ensurePlanView() {
  if (planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
}

function syncStages() {
  $('qhcStages')?.toggleAttribute('hidden', !$('chk_qhc10')?.checked);
}

function initStages() {
  const box = $('qhcStages');
  if (!box) return;
  const paint = () => box.querySelectorAll('[data-qhc-stage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.qhcStage === String(stage))));
  box.innerHTML = STAGES.map(s => `<button type="button" data-qhc-stage="${s.id}">${s.label}</button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qhc-stage]');
    if (!b) return;
    stage = b.dataset.qhcStage === 'all' ? 'all' : Number(b.dataset.qhcStage);
    paint();
    if (layers.land) drawLand();
  });
  paint();
}

// ---------- Đô thị trung tâm ----------
export function fitCenter() {
  const m = target();
  let b = null;
  (state.wardLabelsList || []).forEach(w => {
    if (!w.geometry || !centerSet.has(bareWard(w.name))) return;
    const wb = L.geoJSON(w.geometry).getBounds();
    b = b ? b.extend(wb) : wb;
  });
  if (!b || !b.isValid()) return;
  const shown = planMap && isCompareOn() && !isSplitOn() ? planMap : map;
  shown.flyToBounds(b, { padding: [30, 30], duration: 0.9 });
}

function onPopupClick(e) {
  const el = e.target.closest('[data-qhc-ward],[data-qhc-open]');
  if (!el) return;
  target().closePopup();
  if (el.dataset.qhcWard) document.dispatchEvent(new CustomEvent(WARD_PICK_EVENT, { detail: el.dataset.qhcWard }));
  else document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: el.dataset.qhcOpen }));
}

function initUi() {
  // Nút trong popup (lô 1/10.000, vùng 1/25.000) trên cả 2 bản đồ
  [map, planMap].filter(Boolean).forEach(m => m.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.qhcBound) { el.dataset.qhcBound = '1'; el.addEventListener('click', onPopupClick); }
  }));
  initStages();
}

export function initQhc2045Layer() {
  const m = target();
  if (!m) return;
  initUi();
  $('chk_qhc10')?.addEventListener('change', (e) => { if (e.target.checked) ensurePlanView(); setLand(e.target.checked); syncStages(); });
  $('chk_qhc10Ext')?.addEventListener('change', (e) => { if (e.target.checked) ensurePlanView(); setExt(e.target.checked); });
  $('chk_qhc25')?.addEventListener('change', (e) => { if (e.target.checked) ensurePlanView(); setVision(e.target.checked); });
  m.on('zoomend', () => {
    const d = m.getZoom() >= TT16_PATTERN_ZOOM;
    if (d !== detailed) { detailed = d; restyleLand(); }
    zoomFrame();
  });
  document.addEventListener(LOT_OPACITY_EVENT, restyleLand);
  syncStages();
}
