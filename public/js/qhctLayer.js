// Lớp QHCT 1/500 (quy hoạch chi tiết) trên bản đồ quy hoạch: khung sẵn, dữ liệu bổ sung sau tại QHCT_URL.
// Định dạng: FeatureCollection lô đất, properties { tenQH, kyHieu, chucNang, dienTich (m²), mau? }. Chưa có file thì
// ghi "chưa có dữ liệu" ở dòng lớp, bản đồ không vẽ gì.
import { map } from './mapEngine.js';
import { planMap, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { escapeHtml, fmtNum } from './utils.js';

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
    setHint(data && data.features.length ? `${fmtNum(data.features.length)} lô` : 'chưa có dữ liệu');
    return;
  }
  if (planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setHint('đang tải…');
  await load();
  if (!$('chk_qhct')?.checked) return;
  if (!data.features.length) { setHint('chưa có dữ liệu'); return; }
  draw(m);
  setHint(`${fmtNum(data.features.length)} lô`);
}

export function initQhctLayer() {
  $('chk_qhct')?.addEventListener('change', (e) => setVisible(e.target.checked));
}
