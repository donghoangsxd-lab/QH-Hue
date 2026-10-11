// Lớp bản đồ đồ án QHC đô thị Thừa Thiên Huế 2045 (qhc2045.js) trên bản đồ quy hoạch và luồng khu vực trung tâm:
//  - chk_qhc25: sơ đồ tổ chức không gian 1/25.000 toàn đô thị (vùng phát triển, mặt nước, cây xanh, ranh khu vực, điểm đô thị);
//  - chk_qhc10: sử dụng đất 1/10.000 khu vực trung tâm (lô theo ký hiệu TT16 Mục 02, viền theo giai đoạn) + 4 tiểu vùng,
//    phân khu, điểm chức năng và vùng đỏ đang điều chỉnh (Hóa Châu, Mỹ Thượng ngoài đồ án cũ);
//  - thẻ Khu vực trung tâm theo lớp đang xem (mapLevel.js): lớp QHC 1/10.000 → full (tra cứu lô / chọn phường lõi /
//    chọn QHPK); QHPK mở từ thẻ → mini (nút quay lại); lớp khác → ẩn. Lớp QHC 1/25.000 → nhãn đồ án dưới tiêu đề.
// Mọi lớp vẽ ở pane riêng dưới lô đồ án QHPK (overlayPane 400) để QHPK 1/2.000 luôn nằm trên QHC.
import { state } from './state.js';
import { map, wardNameAt } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { escapeHtml, fmtNum, ico, RIGHT_TAB_EVENT, WARD_PICK_EVENT } from './utils.js';
import { tt16SymbolStyle, tt16SwatchCss, TT16_STYLES, TT16_PATTERN_ZOOM, LOT_OPACITY_EVENT } from './tt16Symbols.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import { showGeneralPlan } from './generalPlanUi.js';
import { getLevel, levelOrigin } from './mapLevel.js';
import {
  QHC2045, CENTER_UNITS, CORE_GROUPS, ZONE_NAMES, STAGE_LAYERS, landOf,
  visionColor, visionLineStyle, WATER_KINDS, GREEN_COLOR
} from './qhc2045.js';

// detail { to: 'core' | 'city' } — viewFlow.js chuyển view
export const CORE_NAV_EVENT = 'qh:qhc-core-nav';

const PANES = { vision: ['qhc25Pane', 340], land: ['qhc10Pane', 350], frame: ['qhc10FramePane', 365] };
const LABEL_MIN_ZOOM = 14;
const TV_LABEL_MAX_ZOOM = 14;
// Nhãn 26 đô thị của đồ án cũ trùng chỗ ký hiệu hệ thống đô thị QĐ 756 khi nhìn toàn tỉnh: chỉ hiện ở mức phóng vừa
const VISION_POINT_ZOOM = [11, 13];
const STAGES = [
  { id: 'all', label: 'Tất cả' },
  { id: 0, label: 'Hiện trạng' },
  { id: 1, label: 'Đến 2030' },
  { id: 2, label: 'Đến 2040' }
];
const STAGE_NAMES = ['Hiện trạng', 'Ngắn hạn đến 2030', 'Dài hạn đến 2040'];
const MISSING_STYLE = { color: '#ef4444', weight: 2.2, dashArray: '8 5', fillColor: '#ef4444', fillOpacity: 0.28, interactive: true };

// Mã 31 "Mặt nước ven biển": một khối biển ~55.000 ha phủ kín góc bản đồ, không mang thông tin sử dụng đất
const SEA_CODE = 31;

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
// Ranh phường ghi tên đầy đủ ("Phường Thuận Hóa"), danh sách vùng lõi ghi tên gọn: so khớp theo tên gọn
const bareWard = (n) => String(n || '').trim().replace(/^(Phường|Xã|Thị trấn)\s+/i, '');
const centerSet = new Set(CENTER_UNITS.map(bareWard));
const coreSet = new Set(CORE_GROUPS.flatMap(g => g.units).map(bareWard));
const inCore = (n) => coreSet.has(bareWard(n));
/** Tên đầy đủ theo ranh phường (để chọn phường), không thấy thì giữ tên gọn */
const fullWard = (u) => (state.wardLabelsList || []).find(w => bareWard(w.name) === bareWard(u))?.name || u;

const data = { land: null, frame: null, vision: null };
const loading = {};
const layers = { land: null, frame: null, vision: null };
let renderers = null;
let stage = 'all';
let detailed = false;
let cardMode = null;
let card = null;
let dock = null;
let projectQuery = '';

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

function ensurePanes(m) {
  if (renderers) return renderers;
  renderers = {};
  Object.entries(PANES).forEach(([kind, [name, z]]) => {
    const pane = m.getPane(name) || m.createPane(name);
    pane.style.zIndex = z;
    renderers[kind] = L.canvas({ pane: name, padding: 0.3 });
  });
  return renderers;
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
    pane: PANES.land[0],
    renderer: ensurePanes(m).land,
    filter: (f) => f.properties.c !== SEA_CODE && (stage === 'all' || f.properties.t === stage),
    style: lotStyle
  }).on('click', (e) => openLotPopup(e.layer.feature, e.latlng));
  layers.land.addTo(m);
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
  const r = ensurePanes(m).frame;
  const group = L.layerGroup();
  const tvLabels = L.layerGroup();
  const ptLayer = L.layerGroup();
  data.frame.features.forEach(f => {
    const p = f.properties;
    if (p.k === 'tv') {
      L.geoJSON(f, { pane: PANES.frame[0], renderer: r, interactive: false, style: { color: '#0f172a', weight: 5, opacity: 0.45, fill: false } }).addTo(group);
      L.geoJSON(f, { pane: PANES.frame[0], renderer: r, interactive: false, style: { color: '#f8fafc', weight: 2.4, opacity: 0.95, dashArray: '12 6', fill: false } }).addTo(group);
      const c = turf.pointOnFeature(f).geometry.coordinates;
      L.marker([c[1], c[0]], { icon: frameLabel(`<b>${escapeHtml(p.tv)}</b> ${escapeHtml(p.ten)}`, 'qhc-label-tv'), interactive: false, keyboard: false }).addTo(tvLabels);
    } else if (p.k === 'pk') {
      L.geoJSON(f, { pane: PANES.frame[0], renderer: r, interactive: false, style: { color: '#e2e8f0', weight: 1.1, opacity: 0.7, dashArray: '3 4', fill: false } }).addTo(group);
    } else if (p.k === 'dc') {
      const area = L.geoJSON(f, { pane: PANES.frame[0], renderer: r, style: MISSING_STYLE });
      area.bindTooltip(`<b>Đang điều chỉnh</b> · ${escapeHtml(p.n)} (~${fmtNum(p.a)} ha)<br><span class="ua-tip-muted">Chưa có trong ${escapeHtml(QHC2045.short)}; sẽ bổ sung khi điều chỉnh QHC thành phố Huế (vùng lõi).</span>`,
        { sticky: true, className: 'ua-tip', opacity: 1 });
      area.addTo(group);
      const c = turf.pointOnFeature(f).geometry.coordinates;
      L.marker([c[1], c[0]], { icon: frameLabel(`Đang điều chỉnh · ${escapeHtml(p.n)}`, 'qhc-label-dc'), interactive: false, keyboard: false }).addTo(group);
    } else if (p.k === 'd') {
      const [lng, lat] = f.geometry.coordinates;
      L.circleMarker([lat, lng], { pane: PANES.frame[0], renderer: r, radius: 3.5, color: '#0f172a', weight: 1, fillColor: p.t ? '#fb923c' : '#f8fafc', fillOpacity: 1 })
        .bindTooltip(`${escapeHtml(p.n)} · ${STAGE_NAMES[p.t] || ''}`, { direction: 'top', className: 'ua-tip', opacity: 1 })
        .addTo(ptLayer);
    }
  });
  layers.frame = L.layerGroup([group]);
  layers.frame.tvLabels = tvLabels;
  layers.frame.points = ptLayer;
  layers.frame.addTo(m);
  zoomFrame();
}

function zoomFrame() {
  const m = target();
  if (!layers.frame || !m.hasLayer(layers.frame)) return;
  const z = m.getZoom();
  const { tvLabels, points } = layers.frame;
  if (z <= TV_LABEL_MAX_ZOOM) tvLabels.addTo(m); else tvLabels.remove();
  if (z >= LABEL_MIN_ZOOM) points.addTo(m); else points.remove();
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
  L.popup({ maxWidth: 320, className: 'qhc-popup' }).setLatLng(latlng).setContent(html).openOn(target());
}

// ---------- 1/25.000: sơ đồ tổ chức không gian ----------
function drawVision() {
  const m = target();
  layers.vision?.remove();
  const r = ensurePanes(m).vision;
  const cats = data.vision.cats;
  const fills = [], waters = [], greens = [], lines = [], points = L.layerGroup();
  data.vision.features.forEach(f => {
    const L_ = f.properties.L;
    if (L_ === 'v') fills.push(f);
    else if (L_ === 'n' && f.properties.k !== 2) waters.push(f);
    else if (L_ === 'x') greens.push(f);
    else if (L_ === 'r') lines.push(f);
    else if (L_ === 'd') {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const icon = L.divIcon({ className: 'qhc-label-icon', html: `<span class="qhc-label qhc-label-urban"><b>${escapeHtml(p.n)}</b>${p.cap ? ` · ${escapeHtml(p.cap)}` : ''}</span>`, iconSize: [0, 0] });
      L.marker([lat, lng], { icon, keyboard: false })
        .bindTooltip(`<b>${escapeHtml(p.n)}</b> (${escapeHtml(p.loai)}${p.cap ? `, ${escapeHtml(p.cap)}` : ''})<br>${escapeHtml(p.g).replace(/;\s*/g, '<br>')}`, { direction: 'top', className: 'ua-tip', opacity: 1 })
        .addTo(points);
    }
  });
  const zoneName = (f) => cats.zones[f.properties.k] || 'Khác';
  const fillLayer = L.geoJSON({ type: 'FeatureCollection', features: fills }, {
    pane: PANES.vision[0], renderer: r,
    style: (f) => { const c = visionColor(zoneName(f)); return { color: c, weight: 0.5, opacity: 0.8, fillColor: c, fillOpacity: 0.5 }; }
  }).on('click', (e) => {
    const p = e.layer.feature.properties;
    const desc = cats.funcs[p.f] || '';
    L.popup({ maxWidth: 320, className: 'qhc-popup' }).setLatLng(e.latlng).setContent(`<div class="qhc-pop">
        <div class="qhc-pop-head"><i class="qhc-sw" style="background:${visionColor(zoneName(e.layer.feature))}"></i><b>${escapeHtml(zoneName(e.layer.feature))}</b></div>
        ${p.n ? `<div>${escapeHtml(p.n)}</div>` : ''}
        ${desc ? `<p class="qhc-pop-desc">${escapeHtml(desc)}</p>` : ''}
        <div class="qhc-pop-src">${escapeHtml(QHC2045.short)} · Sơ đồ tổ chức không gian 1/25.000 · <span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></div>
      </div>`).openOn(m);
  });
  const waterLayer = L.geoJSON({ type: 'FeatureCollection', features: waters }, {
    pane: PANES.vision[0], renderer: r, interactive: false,
    style: (f) => { const c = (WATER_KINDS[f.properties.k] || WATER_KINDS[0]).color; return { color: c, weight: 0.4, fillColor: c, fillOpacity: f.properties.k === 2 ? 0.25 : 0.65 }; }
  });
  const greenLayer = L.geoJSON({ type: 'FeatureCollection', features: greens }, {
    pane: PANES.vision[0], renderer: r, interactive: false,
    style: { color: GREEN_COLOR, weight: 0.4, fillColor: GREEN_COLOR, fillOpacity: 0.6 }
  });
  const lineLayer = L.geoJSON({ type: 'FeatureCollection', features: lines }, {
    pane: PANES.vision[0], renderer: r,
    style: (f) => ({ ...visionLineStyle(cats.lines[f.properties.k]), opacity: 0.95 }),
    onEachFeature: (f, l) => {
      const note = cats.lineNotes[f.properties.g];
      l.bindTooltip(`<b>${escapeHtml(cats.lines[f.properties.k] || 'Ranh giới')}</b>${note ? `<br><span class="ua-tip-muted">${escapeHtml(note)}…</span>` : ''}`,
        { sticky: true, className: 'ua-tip', opacity: 1 });
    }
  });
  layers.vision = L.layerGroup([fillLayer, waterLayer, greenLayer, lineLayer]);
  layers.vision.points = points;
  layers.vision.addTo(m);
  zoomVision();
  renderVisionLegend();
}

function zoomVision() {
  const m = target();
  if (!layers.vision || !m.hasLayer(layers.vision)) return;
  const z = m.getZoom();
  if (z >= VISION_POINT_ZOOM[0] && z <= VISION_POINT_ZOOM[1]) layers.vision.points.addTo(m); else layers.vision.points.remove();
}

function renderVisionLegend() {
  const box = $('qhc25Legend');
  if (!box || !data.vision) return;
  const counts = new Map();
  data.vision.features.forEach(f => { if (f.properties.L === 'v') counts.set(f.properties.k, (counts.get(f.properties.k) || 0) + 1); });
  const zones = [...counts.keys()].map(k => data.vision.cats.zones[k]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
  box.innerHTML = zones.map(z => `<span class="ua-legend-item"><i class="ua-sw" style="background:${visionColor(z)}"></i>${escapeHtml(z.replace(/^Khu vực /, ''))}</span>`).join('')
    + WATER_KINDS.slice(0, 2).map(w => `<span class="ua-legend-item"><i class="ua-sw" style="background:${w.color}"></i>${escapeHtml(w.label)}</span>`).join('')
    + `<span class="ua-legend-item"><i class="ua-sw" style="background:${GREEN_COLOR}"></i>Không gian cây xanh</span>`
    + `<span class="ua-legend-note">${escapeHtml(QHC2045.name)} — ${escapeHtml(QHC2045.status.toLowerCase())}.</span>`;
}

async function setVision(on) {
  const box = $('qhc25Legend');
  if (box) box.style.display = on ? '' : 'none';
  if (!on) {
    layers.vision?.points?.remove();
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

function syncToggles() {
  card?.querySelector('.qhc-stages')?.toggleAttribute('hidden', !$('chk_qhc10')?.checked);
}

// ---------- Đô thị trung tâm ----------
/** Phường, xã thuộc phạm vi 1/10.000 của đồ án (vùng lõi) */
export const isCoreWard = inCore;

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
  const cardW = card && !card.hidden ? card.getBoundingClientRect().width + 20 : 0;
  shown.flyToBounds(b, { paddingTopLeft: [30 + cardW, 30], paddingBottomRight: [30, 30], duration: 0.9 });
}

/** Phường lõi đang chọn (tên gọn) hoặc null khi xem cả khu vực */
const coreWardSel = () => (inCore(state.selectedWard) ? bareWard(state.selectedWard) : null);

function coreProjects() {
  const q = projectQuery.trim().toLowerCase();
  const sel = coreWardSel();
  const hit = sel ? (w) => bareWard(w) === sel : inCore;
  return (state.projectCatalog || [])
    .filter(p => p && p.tenQH && planLevelOf(p.tenQH) === 'QHPK' && (p.wards || []).some(hit))
    .filter(p => !q || `${p.tenQH} ${(p.wards || []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => String(a.tenQH).localeCompare(String(b.tenQH), 'vi'));
}

function projectListHtml() {
  const list = coreProjects();
  if (!list.length) return `<div class="qhc-empty">${(state.projectCatalog || []).length ? 'Không có đồ án khớp' : 'Đang tải danh mục đồ án…'}</div>`;
  return list.map(p => `<button type="button" class="qhc-project" data-qhc-open="${escapeHtml(p.tenQH)}" title="${escapeHtml(p.tenQH)}">
      <span>${escapeHtml(p.tenQH)}</span><small>${escapeHtml((p.wards || []).filter(inCore).map(bareWard).join(', '))}</small></button>`).join('');
}

function fullCardHtml() {
  const sel = coreWardSel();
  const groups = CORE_GROUPS.map(g => `<div class="qhc-grp">
      <span class="qhc-grp-name"><b class="uc-${g.cls}">${g.cls}</b>${escapeHtml(g.name)}</span>
      <div class="qhc-chips">${g.units.map(u => `<button type="button" class="qhc-chip${sel === bareWard(u) ? ' is-sel' : ''}" data-qhc-ward="${escapeHtml(fullWard(u))}" aria-pressed="${String(sel === bareWard(u))}">${escapeHtml(u)}</button>`).join('')}</div>
    </div>`).join('');
  const allChip = `<button type="button" class="qhc-chip qhc-chip-all${sel ? '' : ' is-sel'}" data-qhc-ward="Thành phố Huế" aria-pressed="${String(!sel)}">Cả khu vực</button>`;
  return `<div class="qhc-card-head">
      <button type="button" class="qhc-fold" data-qhc-fold aria-expanded="true" title="Thu gọn / mở thẻ">${ico('chev-up')}</button>
      <div class="qhc-card-title">
        <small>Quy hoạch chung · 1/10.000</small>
        <b>Khu vực đô thị trung tâm</b>
      </div>
      <span class="qhc-flag" title="${escapeHtml(QHC2045.statusNote)}">${escapeHtml(QHC2045.status)}</span>
      <button type="button" class="qhc-x" data-qhc-nav="city" title="Đóng, về Hệ thống đô thị toàn thành phố" aria-label="Đóng, về Hệ thống đô thị toàn thành phố">${ico('close')}</button>
    </div>
    <div class="qhc-card-body">
      <div class="qhc-src" title="${escapeHtml(QHC2045.source)}">${escapeHtml(QHC2045.name)}</div>
      <div class="qhc-sec">
        <div class="qhc-stages" role="group" aria-label="Giai đoạn">${STAGES.map(s => `<button type="button" data-qhc-stage="${s.id}" aria-pressed="${String(s.id === stage)}">${s.label}</button>`).join('')}</div>
        <div class="qhc-note"><i class="qhc-sw qhc-sw-dc"></i>Vùng đỏ: phần Hóa Châu, Mỹ Thượng chưa có trong đồ án, đang điều chỉnh</div>
      </div>
      <div class="qhc-sec">
        <div class="qhc-sec-h"><span>1</span>Tra cứu lô đất</div>
        <p class="qhc-hint">Bấm một lô trên bản đồ để xem chức năng, giai đoạn, diện tích, phường và QHPK 1/2.000 tại vị trí.</p>
      </div>
      <div class="qhc-sec">
        <div class="qhc-sec-h"><span>2</span>Chọn phường, xã <small>vùng lõi ${coreSet.size} đơn vị</small></div>
        <div class="qhc-chips">${allChip}</div>
        ${groups}
      </div>
      <div class="qhc-sec">
        <div class="qhc-sec-h"><span>3</span>Xem QHPK 1/2.000 <small>${sel ? escapeHtml(sel) : 'cả khu vực'}</small><b class="layer-count" data-qhc-pcount>${coreProjects().length}</b></div>
        <input type="search" class="project-search qhc-search" data-qhc-search placeholder="Tìm đồ án, phường..." value="${escapeHtml(projectQuery)}" aria-label="Tìm đồ án QHPK trong vùng lõi">
        <div class="qhc-plist" data-qhc-plist>${projectListHtml()}</div>
      </div>
      <div class="qhc-foot">
        <button type="button" class="bp-btn" data-qhc-legend>${ico('book')}Chú giải QHC</button>
        <button type="button" class="bp-btn" data-qhc-gp>${ico('file')}Hồ sơ QHC TP Huế</button>
      </div>
    </div>`;
}

function miniCardHtml() {
  return `<div class="qhc-card-head qhc-mini">
      <button type="button" class="qhc-back" data-qhc-nav="core" title="Quay lại khu vực trung tâm (QHC 1/10.000)">${ico('chev-left')}<span><small>QHC 1/10.000</small><b>Khu vực trung tâm</b></span></button>
      <span class="qhc-flag" title="${escapeHtml(QHC2045.statusNote)}">${escapeHtml(QHC2045.status)}</span>
    </div>`;
}

/** mode: 'full' | 'mini' | null */
function setCoreCard(mode) {
  cardMode = mode || null;
  if (!card) return;
  card.hidden = !cardMode;
  card.classList.toggle('is-mini', cardMode === 'mini');
  card.innerHTML = cardMode === 'full' ? fullCardHtml() : cardMode === 'mini' ? miniCardHtml() : '';
  document.body.classList.toggle('qhc-core-on', !!cardMode);
  syncToggles();
}

/** Thẻ theo lớp đang xem; gọi lại sau khi đổi lớp / địa bàn để vẽ lại phường đang chọn và danh sách QHPK */
export function syncCoreCard() {
  const level = getLevel();
  setCoreCard(level === 'qhc10' ? 'full' : level === 'qhpk' && levelOrigin() === 'qhc10' ? 'mini' : null);
}

function refreshProjects() {
  if (cardMode !== 'full' || !card) return;
  const list = card.querySelector('[data-qhc-plist]');
  if (list) list.innerHTML = projectListHtml();
  const n = card.querySelector('[data-qhc-pcount]');
  if (n) n.textContent = String(coreProjects().length);
}

function openLegend() {
  document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLegend', open: true } }));
  document.querySelector('[data-legend-set="QHC"]')?.click();
}

function onUiClick(e) {
  const el = e.target.closest('[data-qhc-ward],[data-qhc-open],[data-qhc-nav],[data-qhc-stage],[data-qhc-fold],[data-qhc-legend],[data-qhc-gp]');
  if (!el) return;
  const d = el.dataset;
  if (d.qhcWard) { target().closePopup(); document.dispatchEvent(new CustomEvent(WARD_PICK_EVENT, { detail: d.qhcWard })); return; }
  if (d.qhcOpen) { target().closePopup(); document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: d.qhcOpen })); return; }
  if (d.qhcNav) { document.dispatchEvent(new CustomEvent(CORE_NAV_EVENT, { detail: { to: d.qhcNav } })); return; }
  if (d.qhcStage != null) {
    stage = d.qhcStage === 'all' ? 'all' : Number(d.qhcStage);
    card.querySelectorAll('[data-qhc-stage]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    if (layers.land) drawLand();
    return;
  }
  if (d.qhcFold != null) {
    const folded = card.classList.toggle('is-folded');
    el.setAttribute('aria-expanded', String(!folded));
    return;
  }
  if (d.qhcLegend != null) { openLegend(); return; }
  if (d.qhcGp != null) showGeneralPlan('hue');
}

function initUi() {
  card = document.createElement('section');
  card.className = 'qhc-card';
  card.hidden = true;
  card.setAttribute('aria-label', 'Khu vực đô thị trung tâm – QHC 1/10.000');
  document.body.appendChild(card);
  card.addEventListener('click', onUiClick);
  card.addEventListener('input', (e) => {
    if (!e.target.matches('[data-qhc-search]')) return;
    projectQuery = e.target.value;
    refreshProjects();
  });

  // Nhãn đồ án dưới tiêu đề khi xem lớp QHC 1/25.000 (hiện / ẩn bằng CSS theo body[data-level])
  dock = document.createElement('div');
  dock.className = 'qhc-dock';
  dock.innerHTML = `<span class="qhc-dock-name" title="${escapeHtml(`${QHC2045.name}\n${QHC2045.statusNote}`)}">${ico('layers')}${escapeHtml(QHC2045.short)} · 1/25.000<span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></span>
    <span class="qhc-dock-hint">Bấm một khu vực để xem chức năng</span>`;
  document.body.appendChild(dock);

  // Nút trong popup (lô 1/10.000, vùng 1/25.000) trên cả 2 bản đồ
  [map, planMap].filter(Boolean).forEach(m => m.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.qhcBound) { el.dataset.qhcBound = '1'; el.addEventListener('click', onUiClick); }
  }));
}

export function initQhc2045Layer() {
  const m = target();
  if (!m) return;
  initUi();
  $('chk_qhc10')?.addEventListener('change', (e) => { if (e.target.checked) ensurePlanView(); setLand(e.target.checked); syncToggles(); });
  $('chk_qhc25')?.addEventListener('change', (e) => { if (e.target.checked) ensurePlanView(); setVision(e.target.checked); syncToggles(); });
  m.on('zoomend', () => {
    const d = m.getZoom() >= TT16_PATTERN_ZOOM;
    if (d !== detailed) { detailed = d; restyleLand(); }
    zoomFrame();
    zoomVision();
  });
  document.addEventListener(LOT_OPACITY_EVENT, restyleLand);
  document.addEventListener('cadparcels:loaded', refreshProjects);
  syncToggles();
}
