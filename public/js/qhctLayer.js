// Lớp QHCT 1/500 (quy hoạch chi tiết) trên bản đồ quy hoạch: lô tĩnh tại QHCT_URL + đồ án QHCT nhập (projectLayer.js vẽ
// theo planLevelOf). Định dạng lô tĩnh: FeatureCollection, properties { tenQH, kyHieu, chucNang, dienTich (m²), mau? }.
// Dòng lớp ghi số đồ án nhập và số lô tĩnh; chưa có cả hai thì "chưa có dữ liệu".
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { escapeHtml, fmtNum } from './utils.js';
import { planLevelOf } from './generalPlan.js';

export const QHCT_URL = 'data/qhct/index.json';
const PANE = 'qhctPane';
const DEFAULT_COLOR = '#f472b6';

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
let data = null;
let loading = null;
let layer = null;
let renderer = null;

function setHint(text) {
  const el = $('qhctHint');
  if (el) el.textContent = `(${text})`;
}

function idleHint() {
  const plans = (state.projectCatalog || []).filter(p => planLevelOf(p.tenQH) === 'QHCT').length;
  const lots = data ? data.features.length : 0;
  const parts = [plans && `${fmtNum(plans)} đồ án`, lots && `${fmtNum(lots)} lô`].filter(Boolean);
  return parts.join(', ') || 'chưa có dữ liệu';
}

/** Cập nhật dòng lớp khi danh mục đồ án đổi (projectLayer.js) */
export function refreshQhctHint() {
  if (!loading) setHint(idleHint());
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
  $('chk_qhct')?.addEventListener('change', (e) => setVisible(e.target.checked));
}
