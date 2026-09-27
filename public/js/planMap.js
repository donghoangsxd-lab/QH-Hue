import { state, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE, BUFFER_KEYS, getBufferStyle } from './state.js';
import { geeApi } from './api.js';

export let planMap = null;
let leftMap = null;
let leftLayers = null;
let compareOn = false;
let dividerRatio = 0.5;
const planHighlightLayer = L.layerGroup();

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
  c6: L.layerGroup(), b6: L.layerGroup(),
  c7: L.layerGroup(), b7: L.layerGroup(),
  c8: L.layerGroup(), b8: L.layerGroup(),
  c9: L.layerGroup(), b9: L.layerGroup()
};
let planHeatTile = null;
let planHeatSeq = 0;

const isApproved = (s) => s === true || String(s).trim().toUpperCase() === 'TRUE' || String(s).trim() === '1';

export function initPlanMap(mainMap, mainLayers) {
  leftMap = mainMap;
  leftLayers = mainLayers;
  planMap = L.map('mapPlan', {
    zoomControl: false,
    attributionControl: true,
    renderer: L.canvas(),
    zoomSnap: leftMap.options.zoomSnap
  }).setView(leftMap.getCenter(), leftMap.getZoom());

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri'
  }).addTo(planMap);

  planHighlightLayer.addTo(planMap);
  syncAllPlanLayers();
  syncMaps(leftMap, planMap);
  initDividerDrag();

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
    const icon = L.divIcon({ className: 'ward-label-icon', html: `<span class="ward-label-text">${item.name}</span>`, iconSize: [0, 0] });
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

function setPlanHeatUrl(url) {
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

function renderPlanBuffers(isoFeatures) {
  Object.values(BUFFER_KEYS).forEach(k => planLayers[k].clearLayers());
  isoFeatures.forEach(feat => {
    const props = feat.properties || {};
    const group = planLayers[BUFFER_KEYS[props.type]] || planLayers.b9;
    group.addLayer(L.geoJSON(feat, { style: getBufferStyle(props.type, isApproved(props.status)), interactive: false }));
  });
}

// Vùng phủ & heatmap quy hoạch dùng lại isochrone hiện trạng (bỏ công trình di dời) + isochrone công trình quy hoạch mới,
// tương đương tính lại toàn bộ từ danh sách getPlanScenarioList() nhưng không phải gọi GEE cho ~700 điểm lần nữa.
// Mở rộng/thu hẹp không đổi bán kính nên không làm đổi vùng phủ.
export async function refreshPlanLayers(leftIsoFeatures, leftUrl, newItems) {
  const seq = ++planHeatSeq;
  const relocated = new Set(state.rawDataList.filter(it => it.planChange === 'relocate').map(it => it.id));

  try {
    let newIso = [];
    if (newItems.length) {
      const isoRes = await fetch(geeApi('action=getIsochrone'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: newItems })
      });
      if (isoRes.ok) newIso = ((await isoRes.json()) || {}).features || [];
    }
    if (seq !== planHeatSeq) return;

    const planIso = leftIsoFeatures
      .filter(f => !relocated.has(f.properties && f.properties.id))
      .concat(newIso);
    renderPlanBuffers(planIso);

    const approvedNewIso = newIso.filter(f => isApproved(f.properties && f.properties.status));
    if (!relocated.size && !approvedNewIso.length) {
      setPlanHeatUrl(leftUrl);
      return;
    }

    const features = planIso.filter(f => isApproved(f.properties && f.properties.status));
    const heatRes = await fetch(geeApi(`action=getHeatmapTile&t=${Date.now()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features })
    });
    if (!heatRes.ok) return;
    const d = await heatRes.json();
    if (seq !== planHeatSeq) return;
    setPlanHeatUrl(d.urlFormat);
  } catch (err) {
    console.warn("Lỗi cập nhật heatmap quy hoạch:", err);
  }
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
}

export function setCompareMode(on) {
  // compareOn phải bật SAU khi planMap đã khớp view, nếu không sự kiện move của invalidateSize sẽ kéo bản đồ trái đi
  compareOn = false;
  document.body.classList.toggle('compare-on', on);
  const btn = document.getElementById('btnToggleCompare');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.title = on ? 'Tắt so sánh Hiện trạng / Quy hoạch' : 'So sánh Hiện trạng / Quy hoạch (chia đôi màn hình)';
  }
  if (!planMap || !on) return;
  planMap.invalidateSize({ pan: false });
  planMap.setView(leftMap.getCenter(), leftMap.getZoom(), { animate: false });
  updateDivider();
  compareOn = true;
}

export function toggleCompareMode() {
  setCompareMode(!compareOn);
}
