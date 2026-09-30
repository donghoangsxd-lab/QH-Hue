import { state, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE } from './state.js';
import { escapeHtml, wardLabelFontSize } from './utils.js';

export let planMap = null;
let leftMap = null;
let leftLayers = null;
let compareOn = false;
let dividerRatio = 0.5;
const planHighlightLayer = L.layerGroup();
const compareListeners = [];

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
  c9: L.layerGroup(), b9: L.layerGroup()
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

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    crossOrigin: 'anonymous',
    attribution: 'Tiles &copy; Esri'
  }).addTo(planMap);

  planHighlightLayer.addTo(planMap);
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
    }).observe(area);
  }

  setCompareMode(false);
  return planMap;
}

export function isCompareOn() {
  return compareOn;
}

// Bản đồ quy hoạch chỉ vẽ điểm / buffer / heatmap khi đang bật so sánh
export function onCompareChange(fn) {
  compareListeners.push(fn);
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
  planHeatTile = L.tileLayer(url, { opacity: opacityEl ? opacityEl.value / 100 : 0.3 });
  planLayers.heatmap.addLayer(planHeatTile);
}

export function setPlanHeatOpacity(val) {
  if (planHeatTile) planHeatTile.setOpacity(val);
}

function syncMaps(a, b) {
  let lock = false;

  const applyView = (dst, center, zoom, options) => {
    const snap = dst.options.zoomSnap;
    dst.options.zoomSnap = 0;
    dst.setView(center, zoom, options);
    dst.options.zoomSnap = snap;
  };

  const bind = (src, dst) => {
    let zooming = false;
    src.on('zoomanim', (e) => {
      if (lock || !compareOn) return;
      zooming = true;
      lock = true;
      applyView(dst, e.center, e.zoom, { animate: true });
      lock = false;
    });
    src.on('zoomend', () => { zooming = false; });
    src.on('move', () => {
      if (lock || zooming || !compareOn) return;
      lock = true;
      applyView(dst, src.getCenter(), src.getZoom(), { animate: false });
      lock = false;
    });
  };

  bind(a, b);
  bind(b, a);
}

export function getCoveredRightWidth() {
  if (!compareOn) return 0;
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
  const x = Math.round(area.clientWidth * dividerRatio);
  divider.style.left = `${x}px`;
  divider.setAttribute('aria-valuenow', String(Math.round(dividerRatio * 100)));
  planEl.style.clipPath = `inset(0 0 0 ${x}px)`;
}

function initDividerDrag() {
  const area = document.getElementById('mapArea');
  const divider = document.getElementById('swipeDivider');
  if (!area || !divider) return;

  divider.addEventListener('pointerdown', (e) => {
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

export function setCompareMode(on) {
  // compareOn phải bật SAU khi planMap đã khớp view, nếu không sự kiện move của invalidateSize sẽ kéo bản đồ trái đi
  compareOn = false;
  document.body.classList.toggle('compare-on', on);
  const btn = document.getElementById('btnToggleCompare');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Tắt so sánh Hiện trạng / Quy hoạch' : 'So sánh Hiện trạng / Quy hoạch (chia đôi màn hình)';
  }
  if (!planMap || !on) {
    compareListeners.forEach(fn => fn(false));
    return;
  }
  planMap.invalidateSize({ pan: false });
  planMap.setView(leftMap.getCenter(), leftMap.getZoom(), { animate: false });
  updateDivider();
  compareOn = true;
  compareListeners.forEach(fn => fn(true));
}

export function toggleCompareMode() {
  setCompareMode(!compareOn);
}
