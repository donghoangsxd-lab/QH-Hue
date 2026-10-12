// Lớp QHCT 1/500 (quy hoạch chi tiết) trên bản đồ quy hoạch: lô tĩnh tại QHCT_URL + đồ án QHCT nhập (projectLayer.js vẽ
// theo planLevelOf). Định dạng lô tĩnh: FeatureCollection, properties { tenQH, kyHieu, chucNang, dienTich (m²), mau? }.
// Dòng lớp ghi số đồ án nhập và số lô tĩnh; chưa có cả hai thì "chưa có dữ liệu".
// Xem QHPK 1/2.000 (lớp QHCT tắt): ranh các đồ án QHCT nhập vẽ đỏ nét đứt dày nổi trên lớp để biết khu vực đã có QHCT;
// nhịp nét lệch nửa chu kỳ với ranh điều chỉnh cục bộ (adjustLayer.js) nên chỗ trùng ranh hiện xen kẽ đỏ / xanh.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, isSplitOn, getViewMode, setViewMode, passToolClick } from './planMap.js';
import { escapeHtml, fmtNum } from './utils.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';

export const QHCT_URL = 'data/qhct/index.json';
const PANE = 'qhctPane';
const DEFAULT_COLOR = '#f472b6';
// Trên ranh điều chỉnh cục bộ (447), dưới tem đường (450)
const OUTLINE_PANE = 'qhctOutlinePane';
const OUTLINE_Z = 448;
const OUTLINE_STYLE = { color: '#ef4444', weight: 4, opacity: 1, dashArray: '12 12', lineCap: 'butt', fill: false };
const OUTLINE_HOVER = { color: '#fca5a5', weight: 6 };

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
let data = null;
let loading = null;
let layer = null;
let renderer = null;
let outlines = null;
let outlineKey = null;
const outlineRenderers = new WeakMap();

function setHint(text) {
  const el = $('qhctHint');
  if (el) el.textContent = `(${text})`;
}

const qhctPlans = () => (state.projectCatalog || []).filter(p => p && p.tenQH && planLevelOf(p.tenQH) === 'QHCT');

function idleHint() {
  const plans = qhctPlans().length;
  const lots = data ? data.features.length : 0;
  const parts = [plans && `${fmtNum(plans)} đồ án`, lots && `${fmtNum(lots)} lô`].filter(Boolean);
  return parts.join(', ') || 'chưa có dữ liệu';
}

function outlineRenderer(m) {
  let r = outlineRenderers.get(m);
  if (!r) {
    if (!m.getPane(OUTLINE_PANE)) m.createPane(OUTLINE_PANE).style.zIndex = OUTLINE_Z;
    r = L.svg({ pane: OUTLINE_PANE });
    outlineRenderers.set(m, r);
  }
  return r;
}

function drawOutlines(m, plans) {
  const r = outlineRenderer(m);
  outlines = L.layerGroup().addTo(m);
  plans.forEach(p => {
    const line = L.geoJSON(p.boundary, { renderer: r, bubblingMouseEvents: false, style: OUTLINE_STYLE });
    line.bindTooltip(`Đã có QHCT 1/500 · ${escapeHtml(p.tenQH)}`, { sticky: true, direction: 'top', className: 'dot-tip' });
    line.on('mouseover', () => line.setStyle(OUTLINE_HOVER));
    line.on('mouseout', () => line.setStyle(OUTLINE_STYLE));
    line.on('click', (e) => {
      if (!passToolClick(m, e)) document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: p.tenQH }));
    });
    outlines.addLayer(line);
  });
}

// Ranh khu vực đã có QHCT: chỉ khi lớp QHPK bật mà lớp QHCT tắt (bật QHCT thì chính đồ án QHCT đã hiện)
function refreshOutlines() {
  const m = target();
  const on = !!m && !!$('chk_projects')?.checked && !$('chk_qhct')?.checked;
  const key = on ? state.projectCatalog : null;
  if (key === outlineKey && (!on || outlines)) return;
  outlineKey = key;
  outlines?.remove();
  outlines = null;
  if (!on || typeof L === 'undefined') return;
  const plans = qhctPlans().filter(p => p.boundary);
  if (plans.length) drawOutlines(m, plans);
}

/** Cập nhật dòng lớp + ranh khu vực QHCT khi danh mục đồ án đổi (projectLayer.js) */
export function refreshQhct() {
  if (!loading) setHint(idleHint());
  refreshOutlines();
}

function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch(QHCT_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(fc => { data = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] }; return data; })
      .finally(() => { loading = null; });
  }
  return loading;
}

/** Lô QHCT 1/500 (FeatureCollection rỗng khi chưa có file) */
export const loadQhct = () => load();

function popupHtml(p) {
  const rows = [
    ['Đồ án', p.tenQH],
    ['Ký hiệu lô', p.kyHieu],
    ['Chức năng', p.chucNang],
    ['Diện tích', p.dienTich ? `${fmtNum(Math.round(p.dienTich))} m²` : '']
  ].filter(([, v]) => v);
  return `<div class="qhc-pop"><div class="qhc-pop-head"><b>${escapeHtml(p.chucNang || 'Lô đất QHCT 1/500')}</b></div>
    <table class="qhc-pop-table">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(String(v))}</td></tr>`).join('')}</table>
    <div class="qhc-pop-src">QHCT 1/500</div></div>`;
}

function draw(m) {
  layer?.remove();
  if (!renderer) {
    const pane = m.getPane(PANE) || m.createPane(PANE);
    pane.style.zIndex = 380;
    renderer = L.canvas({ pane: PANE });
  }
  layer = L.geoJSON(data, {
    pane: PANE,
    renderer,
    style: (f) => {
      const c = f.properties?.mau || DEFAULT_COLOR;
      return { color: c, weight: 1, fillColor: c, fillOpacity: 0.45 };
    }
  }).on('click', (e) => m.openPopup(popupHtml(e.layer.feature.properties || {}), e.latlng, { maxWidth: 320, className: 'qhc-popup' }));
  layer.addTo(m);
}

async function setVisible(on) {
  const m = target();
  if (!m) return;
  if (!on) {
    layer?.remove();
    layer = null;
    setHint(idleHint());
    return;
  }
  if (planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setHint('đang tải…');
  await load();
  if (!$('chk_qhct')?.checked) return;
  if (data.features.length) draw(m);
  setHint(idleHint());
}

export function initQhctLayer() {
  $('chk_qhct')?.addEventListener('change', (e) => { setVisible(e.target.checked); refreshOutlines(); });
  $('chk_projects')?.addEventListener('change', refreshOutlines);
}
