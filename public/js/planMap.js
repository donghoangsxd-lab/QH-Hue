import { state, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE } from './state.js';
import { escapeHtml, wardLabelFontSize } from './utils.js';
import { addIslandFlags } from './islandFlags.js';
import { attachBasemap } from './basemap.js';

export let planMap = null;
let leftMap = null;
let leftLayers = null;
// compareOn: bản đồ quy hoạch đang hiện (chế độ xem QH hoặc chia đôi). Không chia đôi thì planMap phủ kín vùng bản đồ.
let compareOn = false;
let viewMode = 'QH';
let split = false;
// 'same' = cùng tâm (2 bản đồ chồng khít, kéo thanh trượt); 'offset' = lệch tâm (tâm mỗi bản đồ ở giữa nửa màn hình của nó)
let splitKind = 'same';
let dividerRatio = 0.5;
const SPLIT_KIND_KEY = 'qh_split_kind';
const planHighlightLayer = L.layerGroup();
const compareListeners = [];
const viewListeners = [];

// Cùng khóa với `layers` của bản đồ hiện trạng (mapEngine.js) để bật/tắt đồng thời
export const planLayers = {
  pop: L.layerGroup(),
  boundary: L.layerGroup(),
  heatmap: L.layerGroup(),
  singleIso: L.layerGroup(),
  c1: L.layerGroup(), b1: L.layerGroup(),
  c2: L.layerGroup(), b2: L.layerGroup(),
  c3: L.layerGroup(), b3: L.layerGroup(),
  c4: L.layerGroup(), b4: L.layerGroup(),
  c5: L.layerGroup(), b5: L.layerGroup(),
  c10: L.layerGroup(), b10: L.layerGroup(),
  c6: L.layerGroup(), b6: L.layerGroup(),
  c7: L.layerGroup(), b7: L.layerGroup(),
  c8: L.layerGroup(), b8: L.layerGroup(),
  c9: L.layerGroup(), b9: L.layerGroup(),
  c11: L.layerGroup(), b11: L.layerGroup(),
  c12: L.layerGroup(), b12: L.layerGroup(),
  c13: L.layerGroup(), b13: L.layerGroup(),
  c14: L.layerGroup(), b14: L.layerGroup()
};
let planHeatTile = null;

export function initPlanMap(mainMap, mainLayers) {
  leftMap = mainMap;
  leftLayers = mainLayers;
  planMap = L.map('mapPlan', {
    zoomControl: false,
    attributionControl: true,
    renderer: L.canvas(),
    maxZoom: 18,
    zoomSnap: leftMap.options.zoomSnap
  }).setView(leftMap.getCenter(), leftMap.getZoom());

  attachBasemap(planMap);

  planHighlightLayer.addTo(planMap);
  addIslandFlags(planMap);
  syncAllPlanLayers();
  syncMaps(leftMap, planMap);
  initDividerDrag();

  const updateLabelSize = () => {
    planMap.getContainer().style.setProperty('--ward-label-size', `${wardLabelFontSize(planMap.getZoom()).toFixed(1)}px`);
  };
  planMap.on('zoomend', updateLabelSize);
  updateLabelSize();

  const area = document.getElementById('mapArea');
  if (area && window.ResizeObserver) {
    new ResizeObserver(() => {
      planMap.invalidateSize({ pan: false });
      updateDivider();
      if (compareOn && offsetPx()) alignPlanView();
    }).observe(area);
  }

  try { if (localStorage.getItem(SPLIT_KIND_KEY) === 'offset') splitKind = 'offset'; } catch (e) { /* chế độ riêng tư */ }
  applyState({ view: viewMode, split: false, kind: splitKind });
  return planMap;
}

/** Bản đồ quy hoạch đang hiện (xem QH hoặc chia đôi): lớp QH vẽ lên planMap */
export function isCompareOn() {
  return compareOn;
}

export function isSplitOn() {
  return split;
}

export function getViewMode() {
  return viewMode;
}

export function getSplitKind() {
  return splitKind;
}

// Bản đồ quy hoạch chỉ vẽ điểm / buffer / heatmap khi đang hiện
export function onCompareChange(fn) {
  compareListeners.push(fn);
}

/** fn({ view, split, kind }) mỗi khi đổi chế độ xem / chia đôi */
export function onViewChange(fn) {
  viewListeners.push(fn);
}

// Hiện/ẩn lớp quy hoạch theo đúng trạng thái lớp cùng tên bên bản đồ hiện trạng
export function syncPlanLayer(key) {
  const group = planLayers[key];
  if (!planMap || !group || !leftLayers) return;
  const on = key === 'heatmap'
    ? document.getElementById('chk_heat')?.checked !== false
    : leftMap.hasLayer(leftLayers[key]);
  if (on) group.addTo(planMap);
  else group.remove();
}

export function syncAllPlanLayers() {
  Object.keys(planLayers).forEach(syncPlanLayer);
}

export function renderPlanBoundaries() {
  const group = planLayers.boundary;
  group.clearLayers();
  const wards = state.wardLabelsList || [];
  const fc = {
    type: 'FeatureCollection',
    features: wards
      .filter(w => w.geometry)
      .map(w => ({ type: 'Feature', geometry: w.geometry, properties: { name: w.name } }))
  };
  group.addLayer(L.geoJSON(fc, { style: WARD_BOUNDARY_SHADOW_STYLE, interactive: false }));
  group.addLayer(L.geoJSON(fc, { style: WARD_BOUNDARY_LINE_STYLE, interactive: false }));
  wards.forEach(item => {
    if (item.lat == null || item.lng == null) return;
    const icon = L.divIcon({ className: 'ward-label-icon', html: `<span class="ward-label-text">${escapeHtml(item.name)}</span>`, iconSize: [0, 0] });
    group.addLayer(L.marker([item.lat, item.lng], { icon, interactive: false }));
  });
}

export function highlightPlanWard(wardName) {
  planHighlightLayer.clearLayers();
  if (!wardName || wardName === "Thành phố Huế") return;
  const w = (state.wardLabelsList || []).find(x => x.name === wardName);
  if (!w || !w.geometry) return;
  planHighlightLayer.addLayer(L.geoJSON({ type: 'Feature', geometry: w.geometry }, { style: WARD_HIGHLIGHT_STYLE, interactive: false }));
}

export function setPlanHeatUrl(url) {
  planLayers.heatmap.clearLayers();
  planHeatTile = null;
  if (!url) return;
  const opacityEl = document.getElementById('heatOpacity');
  planHeatTile = L.tileLayer(url, { maxZoom: 19, opacity: opacityEl ? opacityEl.value / 100 : 0.3 });
  planLayers.heatmap.addLayer(planHeatTile);
}

export function setPlanHeatOpacity(val) {
  if (planHeatTile) planHeatTile.setOpacity(val);
}

const applyView = (dst, center, zoom, options) => {
  const snap = dst.options.zoomSnap;
  dst.options.zoomSnap = 0;
  dst.setView(center, zoom, options);
  dst.options.zoomSnap = snap;
};

// Lệch tâm: điểm giữa nửa trái bản đồ hiện trạng hiện ở giữa nửa phải bản đồ quy hoạch → tâm QH = tâm HT lùi W/2 px
function offsetPx() {
  return split && splitKind === 'offset' && leftMap ? leftMap.getSize().x / 2 : 0;
}

function shiftCenter(m, center, zoom, dx) {
  if (!dx) return center;
  return m.unproject(m.project(center, zoom).add([dx, 0]), zoom);
}

/** Đặt lại khung nhìn bản đồ quy hoạch theo bản đồ hiện trạng (cùng tâm / lệch tâm) */
export function alignPlanView() {
  if (!planMap || !leftMap) return;
  const zoom = leftMap.getZoom();
  applyView(planMap, shiftCenter(leftMap, leftMap.getCenter(), zoom, -offsetPx()), zoom, { animate: false });
}

// sign: +1 từ HT sang QH (lùi tâm), -1 chiều ngược lại
function syncMaps(a, b) {
  let lock = false;

  const bind = (src, dst, sign) => {
    let zooming = false;
    src.on('zoomanim', (e) => {
      if (lock || !compareOn) return;
      zooming = true;
      lock = true;
      applyView(dst, shiftCenter(src, e.center, e.zoom, -sign * offsetPx()), e.zoom, { animate: true });
      lock = false;
    });
    src.on('zoomend', () => { zooming = false; });
    src.on('move', () => {
      if (lock || zooming || !compareOn) return;
      lock = true;
      const zoom = src.getZoom();
      applyView(dst, shiftCenter(src, src.getCenter(), zoom, -sign * offsetPx()), zoom, { animate: false });
      lock = false;
    });
  };

  bind(a, b, 1);
  bind(b, a, -1);
}

export function getCoveredRightWidth() {
  if (!compareOn || !split) return 0;
  const area = document.getElementById('mapArea');
  if (!area) return 0;
  const w = area.clientWidth;
  const covered = Math.round(w * (1 - dividerRatio));
  return (w - covered) < 240 ? 0 : covered;
}

function updateDivider() {
  const area = document.getElementById('mapArea');
  const divider = document.getElementById('swipeDivider');
  const planEl = document.getElementById('mapPlan');
  if (!area || !divider || !planEl) return;
  if (!split) {
    planEl.style.clipPath = 'none';
    return;
  }
  const ratio = splitKind === 'offset' ? 0.5 : dividerRatio;
  const x = Math.round(area.clientWidth * ratio);
  divider.style.left = `${x}px`;
  divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  planEl.style.clipPath = `inset(0 0 0 ${x}px)`;
}

function initDividerDrag() {
  const area = document.getElementById('mapArea');
  const divider = document.getElementById('swipeDivider');
  if (!area || !divider) return;

  divider.addEventListener('pointerdown', (e) => {
    if (splitKind === 'offset') return;
    e.preventDefault();
    e.stopPropagation();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const rect = area.getBoundingClientRect();
    dividerRatio = Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width));
    updateDivider();
  });
  const release = (e) => {
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
    divider.classList.remove('dragging');
  };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);

  // Bàn phím: ←/→ dịch 2%, giữ Shift dịch 10%, Home/End về 2 mép
  divider.addEventListener('keydown', (e) => {
    if (splitKind === 'offset') return;
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') dividerRatio -= step;
    else if (e.key === 'ArrowRight') dividerRatio += step;
    else if (e.key === 'Home') dividerRatio = 0.02;
    else if (e.key === 'End') dividerRatio = 0.98;
    else return;
    e.preventDefault();
    dividerRatio = Math.min(0.98, Math.max(0.02, dividerRatio));
    updateDivider();
  });
}

// compareOn phải bật SAU khi planMap đã khớp view, nếu không sự kiện move của invalidateSize / panBy sẽ kéo bản đồ kia đi
function applyState(next) {
  const wasOffset = split && splitKind === 'offset';
  compareOn = false;
  viewMode = next.view === 'HT' ? 'HT' : 'QH';
  split = !!next.split;
  splitKind = next.kind === 'offset' ? 'offset' : 'same';
  const shown = split || viewMode === 'QH';
  const offset = split && splitKind === 'offset';
  const body = document.body.classList;
  body.toggle('plan-on', shown);
  body.toggle('compare-on', split);
  body.toggle('split-offset', offset);
  body.toggle('view-ht', !shown);
  const btn = document.getElementById('btnToggleCompare');
  if (btn) {
    btn.classList.toggle('active', split);
    btn.setAttribute('aria-pressed', String(split));
    btn.title = split ? 'Tắt chia đôi màn hình' : 'Chia đôi màn hình: hiện trạng bên trái, quy hoạch bên phải';
  }
  if (planMap && leftMap) {
    // Vào / ra lệch tâm: dời bản đồ hiện trạng 1/4 bề ngang để điểm đang ở giữa màn hình về giữa nửa trái (và ngược lại)
    if (offset !== wasOffset) {
      const q = leftMap.getSize().x / 4;
      leftMap.panBy([offset ? q : -q, 0], { animate: false });
    }
    if (shown) {
      planMap.invalidateSize({ pan: false });
      alignPlanView();
    }
    updateDivider();
  }
  compareOn = shown;
  compareListeners.forEach(fn => fn(shown));
  const info = { view: viewMode, split, kind: splitKind };
  viewListeners.forEach(fn => fn(info));
}

/** 'QH' = bản đồ quy hoạch (đồ án), 'HT' = bản đồ hiện trạng. Đang chia đôi thì chỉ ghi nhớ, áp dụng khi tắt chia đôi */
export function setViewMode(mode) {
  if (split) { viewMode = mode === 'HT' ? 'HT' : 'QH'; return; }
  applyState({ view: mode, split: false, kind: splitKind });
}

export function toggleViewMode() {
  setViewMode(viewMode === 'QH' ? 'HT' : 'QH');
}

export function setSplit(on) {
  if (!!on === split) return;
  applyState({ view: viewMode, split: !!on, kind: splitKind });
}

export function toggleSplit() {
  setSplit(!split);
}

export function setSplitKind(kind) {
  const k = kind === 'offset' ? 'offset' : 'same';
  try { localStorage.setItem(SPLIT_KIND_KEY, k); } catch (e) { /* chế độ riêng tư */ }
  if (k === splitKind) return;
  if (!split) { splitKind = k; return; }
  applyState({ view: viewMode, split: true, kind: k });
}

export const toggleCompareMode = toggleSplit;
