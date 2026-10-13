// Lớp QHCT 1/500 (quy hoạch chi tiết) trên bản đồ quy hoạch: lô tĩnh tại QHCT_URL + đồ án QHCT nhập (projectLayer.js vẽ
// theo planLevelOf). Định dạng lô tĩnh: FeatureCollection, properties { tenQH, kyHieu, chucNang, dienTich (m²), mau? }.
// Dòng lớp ghi số đồ án nhập và số lô tĩnh; chưa có cả hai thì "chưa có dữ liệu".
// Chọn một phường khi lớp QHCT tắt: ranh các đồ án QHCT giao phường đó vẽ đỏ nét đứt dày, phần nằm ngoài phường bị cắt.
// Toàn TP (droplist QHPK) không vẽ các ranh này. Nhịp nét lệch nửa chu kỳ với ranh điều chỉnh cục bộ (adjustLayer.js)
// nên chỗ trùng ranh hiện xen kẽ đỏ / xanh.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, isSplitOn, getViewMode, setViewMode, passToolClick } from './planMap.js';
import { escapeHtml, fmtNum } from './utils.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import { analyzeParcelPlan, parcelPlanHtml } from './planLandStats.js';

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

const CITY_NAME = 'Thành phố Huế';
const qhctPlans = () => (state.projectCatalog || []).filter(p => p && p.tenQH && planLevelOf(p.tenQH) === 'QHCT');

function selectedWard() {
  const w = state.selectedWard;
  return w && w !== CITY_NAME ? w : null;
}

// null = không giao phường; undefined = chưa cắt được (thiếu ranh phường hoặc hình lỗi)
const wardClipMemo = new WeakMap();
function clipToWard(geom, wardName) {
  let byWard = wardClipMemo.get(geom);
  if (!byWard) { byWard = new Map(); wardClipMemo.set(geom, byWard); }
  if (byWard.has(wardName)) return byWard.get(wardName);
  const ward = state.wardLabelsList.find(w => w.name === wardName);
  let out;
  if (!ward || !ward.geometry || typeof turf === 'undefined') out = undefined;
  else {
    try {
      const hit = turf.intersect(turf.feature(geom), turf.feature(ward.geometry));
      out = hit ? hit.geometry : null;
    } catch (e) { out = undefined; }
  }
  byWard.set(wardName, out);
  return out;
}

function outlineInWard(p, wardName) {
  const clipped = clipToWard(p.boundary, wardName);
  if (clipped) return clipped;
  if (clipped === null) return null;
  return Array.isArray(p.wards) && p.wards.includes(wardName) ? p.boundary : null;
}

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

// Ranh khu vực đã có QHCT: đang chọn phường, lớp QHPK bật, lớp QHCT tắt. Chỉ phần ranh nằm trong phường.
function refreshOutlines() {
  const m = target();
  const ward = selectedWard();
  const on = !!m && !!ward && !!$('chk_projects')?.checked && !$('chk_qhct')?.checked;
  const key = on ? `${ward}|${state.projectCatalog}` : null;
  if (key === outlineKey && (!on || outlines)) return;
  outlineKey = key;
  outlines?.remove();
  outlines = null;
  if (!on || typeof L === 'undefined') return;
  const plans = qhctPlans().filter(p => p.boundary).map(p => {
    const boundary = outlineInWard(p, ward);
    return boundary ? { ...p, boundary } : null;
  }).filter(Boolean);
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

/** Thửa cắt với đồ án QHCT đã nạp rồi tới lô tĩnh, kể cả khi lớp QHCT đang tắt */
export async function parcelQhctHtml(geometry, recorded) {
  const fc = await load();
  const extras = (fc.features || []).filter(f => f && f.geometry).map(f => {
    const p = f.properties || {};
    const name = p.kyHieu || p.chucNang || 'Lô QHCT';
    return {
      geometry: f.geometry,
      label: p.chucNang || 'Lô QHCT',
      color: p.mau || DEFAULT_COLOR,
      key: '',
      name,
      sub: [p.tenQH, p.kyHieu && p.chucNang ? p.chucNang : ''].filter(Boolean).join(' · '),
      file: p.tenQH || ''
    };
  });
  const res = await analyzeParcelPlan(geometry, { level: 'QHCT', includeHidden: true, extras });
  return {
    html: parcelPlanHtml(res, recorded, {
      title: 'QHCT 1/500 trên thửa đất',
      noneLabel: 'Chưa có lô QHCT',
      empty: 'Thửa chưa nằm trong lô QHCT 1/500 (lô tĩnh hoặc đồ án đã nạp).',
      note: 'Cắt hình học thửa với lô QHCT 1/500, kể cả khi lớp QHCT hoặc đồ án đang tắt. Đồ án nhập giữ phần chồng lên lô tĩnh. Sai số ranh khoảng 0,5 m.'
    }),
    shapes: res.shapes
  };
}

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
