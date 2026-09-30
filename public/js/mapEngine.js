import {
  state, infraLabels, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE, PLAN_CHANGE_INFO,
  BUFFER_COLORS, BUFFER_KEYS, ICON_GROUP_KEYS, getBufferStyle, getPlanScenarioList, effectiveRadius, bumpDataVersion, layerType
} from './state.js';
import { updateInfraPieChart, reloadWardStats, signOutAdmin } from './uiComponents.js';
import { geeApi } from './api.js';
import { escapeHtml, isApproved, fmtNum, distanceMeters, wardLabelFontSize, showToast, wardLabelPoint } from './utils.js';
import { showCsdProof, clearCsdProof } from './csdProof.js';
import { computeServiceArea } from './serviceArea.js';
import { startFlowAnimation } from './flowAnimation.js';
import { tt16ParcelStyle, renderTt16Legend } from './tt16Symbols.js';
import {
  getCoveredRightWidth, highlightPlanWard, planMap, planLayers, syncPlanLayer,
  setPlanHeatUrl, setPlanHeatOpacity, isCompareOn, onCompareChange
} from './planMap.js';

export let map = null;
export let measureLayerGroup = null;
let planMeasureGroup = null;

export const layers = {
  pop: L.layerGroup(),
  boundary: L.layerGroup(),
  highlightWard: L.layerGroup(),
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

const CITY_NAME = "Thành phố Huế";
const CITY_CENTER = [16.4637, 107.5905];
const CITY_ZOOM = 13;
const WARD_GEOM_VERSION = 2;
const INFRA_CODES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
// Số điểm trong khung nhìn ≤ ngưỡng thì vẽ icon PNG (DOM); vượt ngưỡng vẽ chấm tròn trên canvas cho nhẹ
const ICON_MAX_VISIBLE = 1500;
const ICON_FILES = {
  "1-CV": { approved: "Park.png", pending: "Park2.png" },
  "2-BDX": { approved: "Parking.png", pending: "Parking2.png" },
  "3-MN": { approved: "Mamnon.png", pending: "Mamnon2.png" },
  "4-TH": { approved: "Tieuhoc.png", pending: "Tieuhoc2.png" },
  "5-THCS": { approved: "THCS.png", pending: "THCS2.png" },
  "THPT": { approved: "THPT.png", pending: "THPT2.png" },
  "6-YT": { approved: "Yte.png", pending: "Yte2.png" },
  "7-VH": { approved: "Vanhoa.png", pending: "Vanhoa2.png" },
  "8-TM": { approved: "Cho.png", pending: "Cho2.png" },
  "9-CSD": { approved: "Unused.png", pending: "Unused2.png" }
};
const BUFFER_TYPE_BY_KEY = Object.fromEntries(Object.entries(BUFFER_KEYS).map(([type, key]) => [key, type]));
const ICON_LAYER_KEYS = new Set(Object.values(ICON_GROUP_KEYS));
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

let tileHeatmapLayer = null;
let currentHeatUrl = '';
let heatStale = true;
let planHeatStale = true;
let heatmapFetchSeq = 0;
let planHeatSeq = 0;
let singleIsoSeq = 0;

// ============================ LỌC THEO PHƯỜNG ============================

function isPointInWardGeometry(lat, lng, geometry) {
  if (!geometry || lat == null || lng == null) return false;
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).some(g => isPointInWardGeometry(lat, lng, g));
  }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false;
  try {
    return turf.booleanPointInPolygon(turf.point([Number(lng), Number(lat)]), turf.feature(geometry));
  } catch (e) {
    return false;
  }
}

const wardBBoxes = new Map();
function isPointInWard(lat, lng, ward) {
  if (!wardBBoxes.has(ward.name)) {
    let bbox = null;
    try { bbox = turf.bbox(turf.feature(ward.geometry)); } catch (e) {}
    wardBBoxes.set(ward.name, bbox);
  }
  const b = wardBBoxes.get(ward.name);
  if (b && (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])) return false;
  return isPointInWardGeometry(lat, lng, ward.geometry);
}

// Kết quả lọc được ghi nhớ theo (danh sách, phường, phiên bản dữ liệu) — không phải chạy lại turf cho hàng nghìn điểm mỗi lần vẽ
const wardFilterMemo = new WeakMap();
function getWardFilteredList(sourceList) {
  if (!state.selectedWard || state.selectedWard === CITY_NAME) return sourceList;
  const wardInfo = state.wardLabelsList.find(w => w.name === state.selectedWard);
  if (!wardInfo || !wardInfo.geometry) return sourceList;
  const memo = wardFilterMemo.get(sourceList);
  if (memo && memo.ward === wardInfo.name && memo.version === state.dataVersion) return memo.result;
  const result = sourceList.filter(p => isPointInWard(Number(p.lat), Number(p.lng), wardInfo));
  wardFilterMemo.set(sourceList, { ward: wardInfo.name, version: state.dataVersion, result });
  return result;
}

// Tìm điểm đặt nhãn trên ranh đã đơn giản hóa (ranh gốc ~140.000 đỉnh, tính trực tiếp mất ~1 s),
// rồi kiểm tra lại trên ranh gốc; không đạt thì giữ tâm do server trả về
const LABEL_SIMPLIFY_DEG = 0.0003;
function labelPointFor(geometry) {
  if (!geometry) return null;
  try {
    const simple = turf.simplify(turf.feature(geometry), { tolerance: LABEL_SIMPLIFY_DEG }).geometry;
    const pt = wardLabelPoint(simple);
    return pt && isPointInWardGeometry(pt.lat, pt.lng, geometry) ? pt : null;
  } catch (e) {
    return null;
  }
}

function resolveWardNameFromCoords(lat, lng) {
  for (const w of state.wardLabelsList || []) {
    if (w.geometry && isPointInWard(lat, lng, w)) return w.name;
  }
  return null;
}

// ============================ KHỞI TẠO BẢN ĐỒ ============================

export function initMap() {
  map = L.map('map', { renderer: L.canvas(), maxZoom: 18 }).setView(CITY_CENTER, CITY_ZOOM);

  L.tileLayer(ESRI_TILES, {
    maxZoom: 18,
    crossOrigin: 'anonymous',
    attribution: 'Tiles &copy; Esri'
  }).addTo(map);

  measureLayerGroup = L.layerGroup().addTo(map);

  layers.boundary.addTo(map);
  layers.highlightWard.addTo(map);
  layers.heatmap.addTo(map);
  layers.singleIso.addTo(map);
  layers.c1.addTo(map); layers.c2.addTo(map); layers.c3.addTo(map);
  layers.c4.addTo(map); layers.c5.addTo(map); layers.c10.addTo(map); layers.c6.addTo(map);
  layers.c7.addTo(map); layers.c8.addTo(map); layers.c9.addTo(map);

  map.on('zoomend', updateWardLabelFontSize);
  map.on('moveend', () => leftRenderer.refreshPoints());
  updateWardLabelFontSize();
  onCompareChange(handleCompareChange);
  renderTt16Legend(document.getElementById('parcelLegend'));

  return map;
}

let planHooked = false;
function ensurePlanHooks() {
  if (planHooked || !planMap) return;
  planHooked = true;
  planMeasureGroup = L.layerGroup().addTo(planMap);
  planMap.on('moveend', () => planRenderer.refreshPoints());
}

function handleCompareChange(on) {
  ensurePlanHooks();
  leftRenderer.refreshPoints();
  if (!on) return;
  planRenderer.setList(getWardFilteredList(getPlanScenarioList()));
  if (heatStale) refreshHeatmapOnly();
  else if (planHeatStale) refreshPlanHeat();
}

export async function loadBoundaryLayer() {
  if (!map) return;

  try {
    const boundRes = await fetch(geeApi(`action=getBoundaryVector&v=${WARD_GEOM_VERSION}`));
    const boundData = await boundRes.json();
    
    if (boundData && boundData.features) {
      layers.boundary.addLayer(L.geoJSON(boundData, { style: WARD_BOUNDARY_SHADOW_STYLE, interactive: false }));
      layers.boundary.addLayer(L.geoJSON(boundData, { style: WARD_BOUNDARY_LINE_STYLE, interactive: false }));
    }
  } catch (err) {
    console.error("Lỗi tải ranh giới vector 40 phường xã:", err);
  }

  try {
    const labelRes = await fetch(geeApi(`action=getWardLabels&v=${WARD_GEOM_VERSION}`));
    const labelData = await labelRes.json();
    const labels = labelData.labels || [];
    labels.forEach(item => {
      const pt = labelPointFor(item.geometry);
      if (pt) Object.assign(item, { lat: pt.lat, lng: pt.lng });
    });
    state.wardLabelsList = labels;
    wardBBoxes.clear();

    labels.forEach(item => {
      const icon = L.divIcon({
        className: 'ward-label-icon',
        html: `<span class="ward-label-text">${escapeHtml(item.name)}</span>`,
        iconSize: [0, 0]
      });
      layers.boundary.addLayer(L.marker([item.lat, item.lng], { icon, interactive: false }));
    });
    leftRenderer.refreshPoints();
    planRenderer.refreshPoints();
  } catch (err) {
    console.error("Lỗi tải tên 40 phường xã:", err);
  }
}

function getRightObstruction() {
  if (!map) return 0;
  let panelW = 0;
  const rp = document.getElementById('rightPanel');
  if (rp && !document.body.classList.contains('right-collapsed')) {
    panelW = Math.max(0, map.getContainer().getBoundingClientRect().right - rp.getBoundingClientRect().left);
  }
  const covered = Math.max(getCoveredRightWidth(), panelW);
  return (map.getSize().x - covered) < 240 ? 0 : covered;
}

// Popup chỉ được tự dời trong phần nhìn thấy của bản đồ chứa nó: khi so sánh, hiện trạng ở trái thanh trượt,
// quy hoạch ở phải thanh trượt (bản đồ quy hoạch bị cắt ở nửa trái nên popup lọt sang đó sẽ bị ẩn)
function popupFitOptions(targetMap, maxWidth, minWidth) {
  const size = targetMap.getSize();
  let panelW = 0;
  const rp = document.getElementById('rightPanel');
  if (rp && !document.body.classList.contains('right-collapsed')) {
    panelW = Math.max(0, targetMap.getContainer().getBoundingClientRect().right - rp.getBoundingClientRect().left);
  }
  let left = 20;
  let right = 20 + panelW;
  const divider = document.getElementById('swipeDivider');
  if (isCompareOn() && divider) {
    const dividerX = divider.offsetLeft;
    if (targetMap === planMap) left = dividerX + 14;
    else right = Math.max(right, size.x - dividerX + 14);
  }
  const avail = Math.max(160, size.x - left - right - 40);
  const maxW = Math.min(maxWidth, avail);
  return {
    maxWidth: maxW,
    minWidth: Math.min(minWidth, maxW),
    autoPanPaddingTopLeft: [left, 20],
    autoPanPaddingBottomRight: [right, 20]
  };
}

export function centerOnCity(options = { animate: false }) {
  flyToVisible(CITY_CENTER, CITY_ZOOM, options);
}

export function flyToVisible(latlng, zoom, options) {
  if (!map) return;
  const shift = getRightObstruction() / 2;
  if (!shift) {
    map.flyTo(latlng, zoom, options);
    return;
  }
  const target = map.project(L.latLng(latlng), zoom).add([shift, 0]);
  map.flyTo(map.unproject(target, zoom), zoom, options);
}

export function highlightWardBoundary(wardName, { fitView = true } = {}) {
  if (!layers.highlightWard || !map) return;
  layers.highlightWard.clearLayers();
  highlightPlanWard(wardName);

  if (!wardName || wardName === CITY_NAME) {
    if (fitView) centerOnCity({});
    return;
  }

  const wardInfo = state.wardLabelsList.find(w => w.name === wardName);
  if (wardInfo && wardInfo.geometry) {
    const highlightLayer = L.geoJSON({ type: "Feature", geometry: wardInfo.geometry, properties: {} }, { style: WARD_HIGHLIGHT_STYLE, interactive: false });
    layers.highlightWard.addLayer(highlightLayer);

    if (fitView) {
      const bounds = highlightLayer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {
          paddingTopLeft: [20, 20],
          paddingBottomRight: [20 + getRightObstruction(), 20],
          maxZoom: 15,
          animate: true,
          duration: 0.8
        });
      } else if (wardInfo.lat != null && wardInfo.lng != null) {
        flyToVisible([wardInfo.lat, wardInfo.lng], 14);
      }
    }
  } else if (fitView && wardInfo && wardInfo.lat != null && wardInfo.lng != null) {
    flyToVisible([wardInfo.lat, wardInfo.lng], 14);
  }
}

export function focusWard(wardName) {
  state.selectedWard = wardName || CITY_NAME;
  const wardSelector = document.getElementById('wardSelector');
  if (wardSelector) wardSelector.value = state.selectedWard;

  highlightWardBoundary(state.selectedWard, { fitView: true });
  renderGroupedPoints();
  return refreshHeatmapOnly();
}

// Cỡ chữ đặt bằng biến CSS trên khung bản đồ: nhãn tạo lại (bật/tắt lớp) vẫn giữ đúng cỡ
function updateWardLabelFontSize() {
  if (!map) return;
  map.getContainer().style.setProperty('--ward-label-size', `${wardLabelFontSize(map.getZoom()).toFixed(1)}px`);
}

export function toggleLayer(layerKey, isChecked) {
  if (!map) return;
  if (isChecked) {
    if (layerKey === 'heatmap') {
      if (!map.hasLayer(layers.heatmap)) map.addLayer(layers.heatmap);
      if (heatStale || !tileHeatmapLayer) refreshHeatmapOnly();
    } else if (layers[layerKey]) {
      map.addLayer(layers[layerKey]);
    }
  } else if (layerKey === 'heatmap') {
    if (map.hasLayer(layers.heatmap)) map.removeLayer(layers.heatmap);
  } else if (layers[layerKey]) {
    map.removeLayer(layers[layerKey]);
  }
  syncPlanLayer(layerKey);
  if (ICON_LAYER_KEYS.has(layerKey)) {
    leftRenderer.refreshPoints();
    planRenderer.refreshPoints();
  }

  const popBox = document.getElementById('popBox');
  const heatBox = document.getElementById('heatBox');
  if (layerKey === 'pop' && popBox) popBox.style.display = isChecked ? '' : 'none';
  if (layerKey === 'heatmap' && heatBox) heatBox.style.display = isChecked ? '' : 'none';
}

export function toggleBuffer(bufferKey, el) {
  if (!map || !layers[bufferKey]) return;
  const on = !map.hasLayer(layers[bufferKey]);
  if (on) map.addLayer(layers[bufferKey]);
  else map.removeLayer(layers[bufferKey]);
  if (el) {
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  }
  syncPlanLayer(bufferKey);
  leftRenderer.refreshBuffers();
  planRenderer.refreshBuffers();
}

// ============================ ĐO CHIỀU DÀI / DIỆN TÍCH ============================

export function toggleMeasure(type) {
  if (state.activeMeasureType === type) {
    clearMeasure();
    return;
  }
  clearMeasure();
  state.activeMeasureType = type;

  const btn = document.getElementById(type === 'distance' ? 'btnMeasureDist' : 'btnMeasureArea');
  if (btn) {
    btn.classList.add('active');
    btn.textContent = "❌";
  }
}

export function clearMeasure() {
  state.activeMeasureType = null;
  state.measurePoints = [];
  [measureLayerGroup, planMeasureGroup].forEach(g => g && g.clearLayers());

  const btnDist = document.getElementById('btnMeasureDist');
  const btnArea = document.getElementById('btnMeasureArea');
  if (btnDist) {
    btnDist.classList.remove('active');
    btnDist.textContent = "📏";
  }
  if (btnArea) {
    btnArea.classList.remove('active');
    btnArea.textContent = "📐";
  }
}

export function handleMeasureClick(latlng) {
  state.measurePoints.push([latlng.lng, latlng.lat]);
  drawMeasure();
}

// Vẽ lại toàn bộ hình đo trên cả 2 bản đồ; kết quả hiển thị bằng 1 nhãn duy nhất ở điểm cuối (không chồng popup)
function drawMeasure() {
  const groups = [measureLayerGroup, planMeasureGroup].filter(Boolean);
  groups.forEach(g => g.clearLayers());
  const pts = state.measurePoints;
  if (!pts.length) return;
  const isArea = state.activeMeasureType === 'area';
  const color = isArea ? '#f59e0b' : '#38bdf8';
  const latlngs = pts.map(pt => [pt[1], pt[0]]);

  let label = '';
  if (!isArea && pts.length >= 2) {
    const meters = turf.length(turf.lineString(pts), { units: 'meters' });
    label = `📏 Chiều dài: ${meters >= 1000 ? `${fmtNum(meters / 1000)} km` : `${fmtNum(Math.round(meters))} m`}`;
  } else if (isArea && pts.length >= 3) {
    const sqm = turf.area(turf.polygon([[...pts, pts[0]]]));
    label = `📐 Diện tích: ${sqm >= 10000 ? `${fmtNum(sqm / 10000)} ha` : `${fmtNum(Math.round(sqm))} m²`}`;
  }

  groups.forEach(g => {
    latlngs.forEach(ll => L.circleMarker(ll, { radius: 4, color, fillColor: color, fillOpacity: 1, interactive: false }).addTo(g));
    if (!isArea && latlngs.length >= 2) L.polyline(latlngs, { color, weight: 3, dashArray: '4,4', interactive: false }).addTo(g);
    if (isArea && latlngs.length >= 3) L.polygon(latlngs, { color, weight: 2, fillColor: color, fillOpacity: 0.2, interactive: false }).addTo(g);
    if (label) {
      L.marker(latlngs[latlngs.length - 1], {
        interactive: false,
        icon: L.divIcon({ className: 'measure-label', html: `<span style="border-color:${color};">${label}</span>`, iconSize: [0, 0] })
      }).addTo(g);
    }
  });
}

// ============================ VẼ ĐIỂM HẠ TẦNG (TỐI ƯU CHO HÀNG NGHÌN ĐIỂM) ============================

function pointKey(p) {
  return `${p.scenario || 'HT'}|${p.id}|${p.lat}|${p.lng}|${isApproved(p.status) ? 1 : 0}|${p.planChange || ''}`;
}

function hasValidCoord(p) {
  return p.lat != null && p.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

// Ranh lô đất CAD chỉ vẽ khi phóng to đủ gần (ở mức toàn thành phố hàng nghìn polygon vừa rối vừa nặng):
// từ PARCEL_MIN_ZOOM tô màu nền TT16, từ PARCEL_PATTERN_ZOOM (gần 1 lô cụ thể) tô hoa văn TT16
const PARCEL_MIN_ZOOM = 15;
const PARCEL_PATTERN_ZOOM = 17;

// Zoom ≤ ngưỡng (mức toàn thành phố): mỗi phường 1 biểu đồ tròn số công trình theo loại thay cho icon chồng chéo.
// Đang chọn 1 phường thì luôn hiện icon (phường rộng có thể vừa khung ở zoom thấp, 1 biểu đồ đơn lẻ không có ý nghĩa)
const PIE_MAX_ZOOM = 12;
const PIE_CLICK_ZOOM = 15;
const PIE_MIN_PX = 22;
const PIE_MAX_PX = 46;
const PIE_SLICE_GAP_DEG = 1.6;
const PIE_GAP_COLOR = 'rgba(15, 23, 42, 0.85)';

// Phường chứa điểm, ghi nhớ theo tọa độ (danh sách hiện trạng và quy hoạch dùng chung); đổi bộ ranh phường thì tính lại
const wardAtCache = new Map();
let wardAtSource = null;
export function wardNameAt(lat, lng) {
  if (wardAtSource !== state.wardLabelsList) {
    wardAtCache.clear();
    wardAtSource = state.wardLabelsList;
  }
  const key = `${lat},${lng}`;
  if (!wardAtCache.has(key)) wardAtCache.set(key, resolveWardNameFromCoords(Number(lat), Number(lng)));
  return wardAtCache.get(key);
}

function pieTooltipHtml(ward, counts, total, scenarioLabel) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, n]) => `
    <div class="ward-pie-row"><i style="background:${BUFFER_COLORS[type] || '#38bdf8'}"></i><span>${escapeHtml((infraLabels[type] || type).replace(/^[^\p{L}\d]+/u, ''))}</span><b>${fmtNum(n)}</b></div>`).join('');
  return `<div class="ward-pie-title">${escapeHtml(ward.name)}${scenarioLabel ? `<small>${scenarioLabel}</small>` : ''}</div>
    ${rows}<div class="ward-pie-total"><span>Tổng</span><b>${fmtNum(total)}</b></div>
    <div class="ward-pie-hint">Bấm để phóng to xem từng công trình</div>`;
}

function createWardPie(ward, counts, total, maxTotal, targetMap, scenarioLabel) {
  const size = Math.round(PIE_MIN_PX + (PIE_MAX_PX - PIE_MIN_PX) * Math.sqrt(total / maxTotal));
  const entries = Object.entries(counts);
  // Vạch ngăn mảnh giữa các lát để phân biệt các màu gần nhau (cam/đỏ...)
  const gap = entries.length > 1 ? PIE_SLICE_GAP_DEG : 0;
  let acc = 0;
  const stops = entries.map(([type, n]) => {
    const from = acc;
    acc += (n / total) * 360;
    const color = BUFFER_COLORS[type] || '#38bdf8';
    const end = Math.max(from, acc - gap);
    return `${color} ${from.toFixed(2)}deg ${end.toFixed(2)}deg, ${PIE_GAP_COLOR} ${end.toFixed(2)}deg ${acc.toFixed(2)}deg`;
  }).join(', ');
  // Tâm biểu đồ đặt tại điểm sâu nhất trong ranh phường; tên phường gắn liền phía trên (nhãn rời bị ẩn ở chế độ này)
  const marker = L.marker([ward.lat, ward.lng], {
    icon: L.divIcon({
      className: 'ward-pie-icon',
      html: `<span class="ward-pie-name">${escapeHtml(ward.name)}</span><div class="ward-pie" style="width:${size}px;height:${size}px;background:conic-gradient(${stops})"><span>${total}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    }),
    riseOnHover: true,
    bubblingMouseEvents: false
  });
  marker.bindTooltip(pieTooltipHtml(ward, counts, total, scenarioLabel), {
    direction: 'auto', offset: [size / 2 + 6, 0], className: 'ward-pie-tip', opacity: 1
  });
  marker.on('click', () => {
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode) return;
    targetMap.flyTo([ward.lat, ward.lng], PIE_CLICK_ZOOM);
  });
  return marker;
}

// Bản đồ quy hoạch ưu tiên ranh QH, chưa có thì dùng ranh hiện trạng của cùng công trình → { geometry, layer }
function parcelFor(p) {
  const parcels = state.cadParcels;
  if (!parcels.size) return null;
  if (p.scenario === 'QH') return parcels.get(`QH|${p.id}`) || parcels.get(`HT|${p.id}`) || null;
  return parcels.get(`HT|${p.id}`) || null;
}

function parcelStyle(entry, detailed) {
  const p = entry.point;
  return tt16ParcelStyle(layerType(p), entry.parcel.layer, { scenario: p.scenario, detailed, approved: isApproved(p.status) });
}

function createParcelShape(entry, targetMap, detailed) {
  const p = entry.point;
  entry.parcel = parcelFor(p);
  if (!entry.parcel) return null;
  const shape = L.geoJSON(entry.parcel.geometry, {
    style: parcelStyle(entry, detailed),
    bubblingMouseEvents: false
  });
  shape.on('click', () => {
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode) return;
    onPointClick(entry.point, targetMap);
  });
  return shape;
}

function createPointMarker(entry, mode, targetMap) {
  const p = entry.point;
  const approved = isApproved(p.status);
  // Chỉ đánh dấu trên bản đồ quy hoạch các điểm khác hiện trạng (mới/mở rộng/thu hẹp)
  const planInfo = p.scenario === 'QH' ? PLAN_CHANGE_INFO[p.planChange] : null;
  let marker;
  if (mode === 'icon') {
    const files = ICON_FILES[layerType(p)] || ICON_FILES["1-CV"];
    const iconUrl = `./icons/${approved ? files.approved : files.pending}`;
    const badgeHtml = planInfo ? `<span class="plan-badge" title="${planInfo.label}"></span>` : '';
    marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: 'custom-infra-icon-png',
        html: `${badgeHtml}<img src="${iconUrl}" alt="" style="position: relative; width: 22px; height: 27px; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.5));" />`,
        iconSize: [26, 32],
        iconAnchor: [11, 26]
      })
    });
  } else {
    marker = L.circleMarker([p.lat, p.lng], {
      radius: 4.5,
      weight: planInfo ? 2.5 : 1,
      color: planInfo ? '#22c55e' : '#0f172a',
      fillColor: approved ? (BUFFER_COLORS[layerType(p)] || '#38bdf8') : '#f87171',
      fillOpacity: 0.95,
      bubblingMouseEvents: false
    });
  }
  marker.on('click', () => {
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode) return;
    onPointClick(entry.point, targetMap);
  });
  return marker;
}

/**
 * Bộ vẽ cho 1 bản đồ:
 * - Chỉ tạo marker cho điểm nằm trong khung nhìn (nới 25%), khi kéo/zoom chỉ thêm/bớt phần chênh lệch.
 * - Nhiều điểm trong khung nhìn (> ICON_MAX_VISIBLE) thì chuyển sang chấm tròn canvas thay cho icon DOM.
 * - Buffer vẽ bằng L.circle trên canvas, chỉ dựng cho nhóm đang bật.
 * - Ranh lô CAD (nếu có) vẽ cùng nhóm với marker nên bật/tắt theo loại hạ tầng và lọc phường như icon.
 * - Zoom ≤ PIE_MAX_ZOOM: bỏ marker, mỗi phường 1 biểu đồ tròn đếm theo các loại đang bật.
 */
function createRenderer(getMap, groups, isActive, scenarioLabel) {
  let list = [];
  let listSeq = 0;
  let mode = null;
  let parcelsOn = false;
  let parcelDetail = false;
  let pieKey = null;
  const rendered = new Map();
  const builtBuffers = new Set();
  const pieGroup = L.layerGroup();

  const clearPies = () => {
    pieGroup.clearLayers();
    pieGroup.remove();
    pieKey = null;
  };

  function renderPies(m) {
    const activeTypes = Object.keys(ICON_GROUP_KEYS).filter(t => m.hasLayer(groups[ICON_GROUP_KEYS[t]]));
    const label = scenarioLabel();
    const key = `${listSeq}|${activeTypes.join(',')}|${state.wardLabelsList.length}|${label}`;
    if (!m.hasLayer(pieGroup)) pieGroup.addTo(m);
    if (key === pieKey) return;
    pieKey = key;
    pieGroup.clearLayers();

    const active = new Set(activeTypes);
    const byWard = new Map();
    list.forEach(p => {
      const type = layerType(p);
      if (!active.has(type)) return;
      const name = wardNameAt(p.lat, p.lng);
      if (!name) return;
      const counts = byWard.get(name) || {};
      counts[type] = (counts[type] || 0) + 1;
      byWard.set(name, counts);
    });
    const totals = new Map([...byWard].map(([name, counts]) => [name, Object.values(counts).reduce((s, n) => s + n, 0)]));
    const maxTotal = Math.max(1, ...totals.values());
    state.wardLabelsList.forEach(ward => {
      const counts = byWard.get(ward.name);
      if (!counts || ward.lat == null || ward.lng == null) return;
      const ordered = Object.fromEntries(Object.keys(ICON_GROUP_KEYS).filter(t => counts[t]).map(t => [t, counts[t]]));
      pieGroup.addLayer(createWardPie(ward, ordered, totals.get(ward.name), maxTotal, m, label));
    });
  }

  const removeEntry = (entry) => {
    entry.group.removeLayer(entry.marker);
    if (entry.shape) entry.group.removeLayer(entry.shape);
  };

  const clearPoints = () => {
    rendered.forEach(removeEntry);
    rendered.clear();
  };

  function refreshPoints() {
    const m = getMap();
    if (!m || !isActive()) return;
    const wardSelected = state.selectedWard && state.selectedWard !== CITY_NAME;
    if (m.getZoom() <= PIE_MAX_ZOOM && !wardSelected && state.wardLabelsList.some(w => w.geometry)) {
      if (mode !== 'pie') {
        clearPoints();
        mode = 'pie';
        parcelsOn = false;
        m.getContainer().classList.add('ward-pie-mode');
      }
      renderPies(m);
      return;
    }
    if (mode === 'pie') {
      clearPies();
      m.getContainer().classList.remove('ward-pie-mode');
    }
    const bounds = m.getBounds().pad(0.25);
    const visible = list.filter(p => bounds.contains([p.lat, p.lng]));
    const nextMode = visible.length <= ICON_MAX_VISIBLE ? 'icon' : 'dot';
    const wantParcels = state.showParcels && state.cadParcels.size > 0 && m.getZoom() >= PARCEL_MIN_ZOOM;
    const detail = m.getZoom() >= PARCEL_PATTERN_ZOOM;
    if (nextMode !== mode || wantParcels !== parcelsOn) {
      clearPoints();
      mode = nextMode;
      parcelsOn = wantParcels;
    }
    // Qua ngưỡng hoa văn: chỉ đổi kiểu tô của ranh lô đang vẽ, giữ nguyên marker
    if (detail !== parcelDetail) {
      parcelDetail = detail;
      rendered.forEach(entry => { if (entry.shape) entry.shape.setStyle(parcelStyle(entry, detail)); });
    }

    const wanted = new Map();
    visible.forEach(p => wanted.set(pointKey(p), p));
    rendered.forEach((entry, key) => {
      if (wanted.has(key)) return;
      removeEntry(entry);
      rendered.delete(key);
    });
    wanted.forEach((p, key) => {
      const existing = rendered.get(key);
      if (existing) {
        existing.point = p;
        return;
      }
      const entry = { point: p, group: groups[ICON_GROUP_KEYS[layerType(p)]] || groups.c9 };
      entry.shape = parcelsOn ? createParcelShape(entry, m, parcelDetail) : null;
      if (entry.shape) entry.group.addLayer(entry.shape);
      entry.marker = createPointMarker(entry, mode, m);
      entry.group.addLayer(entry.marker);
      rendered.set(key, entry);
    });
  }

  // Vẽ lại toàn bộ marker + ranh lô (dữ liệu ranh vừa tải hoặc bật/tắt lớp ranh)
  function reset() {
    clearPoints();
    if (mode === 'pie') {
      clearPies();
      getMap()?.getContainer().classList.remove('ward-pie-mode');
    }
    mode = null;
    pieKey = null;
    refreshPoints();
  }

  function buildBuffer(key) {
    const group = groups[key];
    const type = BUFFER_TYPE_BY_KEY[key];
    group.clearLayers();
    list.forEach(p => {
      if (layerType(p) !== type) return;
      const approved = isApproved(p.status);
      if (type === "9-CSD" && !approved) return;
      group.addLayer(L.circle([p.lat, p.lng], { radius: effectiveRadius(p), ...getBufferStyle(type, approved), interactive: false }));
    });
    builtBuffers.add(key);
  }

  function refreshBuffers() {
    const m = getMap();
    if (!m || !isActive()) return;
    Object.values(BUFFER_KEYS).forEach(key => {
      if (m.hasLayer(groups[key]) && !builtBuffers.has(key)) buildBuffer(key);
    });
  }

  function invalidateBuffers() {
    builtBuffers.clear();
    Object.values(BUFFER_KEYS).forEach(key => groups[key].clearLayers());
    refreshBuffers();
  }

  function setList(next) {
    list = next.filter(hasValidCoord);
    listSeq++;
    refreshPoints();
    invalidateBuffers();
  }

  return { setList, refreshPoints, refreshBuffers, invalidateBuffers, reset };
}

const leftRenderer = createRenderer(() => map, layers, () => true, () => (isCompareOn() ? 'Hiện trạng' : ''));
const planRenderer = createRenderer(() => planMap, planLayers, () => isCompareOn(), () => 'Quy hoạch');

export function renderGroupedPoints() {
  if (!map) return;
  const sourceList = getWardFilteredList(state.rawDataList);
  const planList = getWardFilteredList(getPlanScenarioList());
  updateInfraPieChart(sourceList, planList);
  leftRenderer.setList(sourceList);
  planRenderer.setList(planList);
}

// Bán kính buffer chung đổi: chỉ vẽ lại vùng phủ, không phải dựng lại marker
export function refreshBuffers() {
  leftRenderer.invalidateBuffers();
  planRenderer.invalidateBuffers();
}

// ============================ RANH LÔ ĐẤT CAD ============================

function redrawParcels() {
  leftRenderer.reset();
  planRenderer.reset();
}

/** Tải ranh lô từ máy chủ (cad_parcels.json qua cache ETag); lỗi thì giữ ranh đang có */
export async function loadCadParcels() {
  try {
    const res = await fetch(geeApi('action=getCadParcels'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const next = new Map();
    (data.parcels || []).forEach(p => {
      if (p && p.id && p.geometry) next.set(`${p.phase === 'QH' ? 'QH' : 'HT'}|${p.id}`, { geometry: p.geometry, layer: p.layer || '' });
    });
    state.cadParcels = next;
  } catch (err) {
    console.warn('Không tải được ranh lô CAD:', err);
    return;
  }
  redrawParcels();
}

export function setParcelsVisible(on) {
  state.showParcels = !!on;
  redrawParcels();
}

// ============================ HEATMAP ============================

function isHeatOn() {
  return document.getElementById('chk_heat')?.checked !== false;
}

// Gửi điểm dạng gọn [lat, lng, bán kính] theo nhóm, server tự dựng buffer (nhẹ hơn nhiều so với gửi polygon)
function heatmapGroups(list) {
  const groups = {};
  list.forEach(p => {
    if (!INFRA_CODES.includes(p.type) || !isApproved(p.status) || !hasValidCoord(p)) return;
    (groups[p.type] = groups[p.type] || []).push([
      Number(Number(p.lat).toFixed(6)), Number(Number(p.lng).toFixed(6)), Math.round(effectiveRadius(p))
    ]);
  });
  return groups;
}

async function requestHeatTile(list) {
  const res = await fetch(geeApi('action=getHeatmapTile'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups: heatmapGroups(list) })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) || {}).urlFormat || '';
}

function setLeftHeatUrl(url) {
  currentHeatUrl = url;
  layers.heatmap.clearLayers();
  tileHeatmapLayer = null;
  if (!url) return;
  const heatOpacityEl = document.getElementById('heatOpacity');
  tileHeatmapLayer = L.tileLayer(url, { opacity: heatOpacityEl ? heatOpacityEl.value / 100 : 0.3 });
  layers.heatmap.addLayer(tileHeatmapLayer);
}

export function setHeatOpacity(val) {
  if (tileHeatmapLayer) tileHeatmapLayer.setOpacity(val);
  setPlanHeatOpacity(val);
}

// Heatmap chỉ gọi GEE khi đang bật; tắt thì đánh dấu cũ để lần bật sau tính lại theo địa bàn / bán kính hiện tại
export async function refreshHeatmapOnly() {
  const seq = ++heatmapFetchSeq;
  planHeatStale = true;
  if (!isHeatOn()) {
    heatStale = true;
    return;
  }
  heatStale = false;
  try {
    const url = await requestHeatTile(getWardFilteredList(state.rawDataList));
    if (seq !== heatmapFetchSeq) return;
    setLeftHeatUrl(url);
    await refreshPlanHeat();
  } catch (err) {
    if (seq === heatmapFetchSeq) heatStale = true;
    console.error("Lỗi cập nhật heatmap theo địa bàn:", err);
  }
}

// Heatmap quy hoạch trùng hiện trạng nếu trong phạm vi không có công trình mới / di dời đã duyệt
async function refreshPlanHeat() {
  if (!isCompareOn() || !isHeatOn()) {
    planHeatStale = true;
    return;
  }
  const seq = ++planHeatSeq;
  planHeatStale = false;
  const htList = getWardFilteredList(state.rawDataList);
  const planList = getWardFilteredList(getPlanScenarioList());
  const differs = planList.some(p => p.planChange === 'new' && isApproved(p.status))
    || htList.some(p => p.planChange === 'relocate' && isApproved(p.status));
  if (!differs) {
    setPlanHeatUrl(currentHeatUrl);
    return;
  }
  try {
    const url = await requestHeatTile(planList);
    if (seq === planHeatSeq) setPlanHeatUrl(url);
  } catch (err) {
    if (seq === planHeatSeq) planHeatStale = true;
    console.warn("Lỗi cập nhật heatmap quy hoạch:", err);
  }
}

// ============================ POPUP CÔNG TRÌNH ============================

let stopFlow = null;

// Đường theo nhóm (serviceArea.js): nền = mọi đường quanh công trình (mờ), tới được = phần đi được trong bán kính.
// Vẽ từ nhóm nhỏ lên nhóm lớn để trục chính nằm trên cùng; 'unknown' = mạng lưới lưu cũ chưa phân nhóm.
const ROAD_STYLES = [
  ['kiet',    { label: 'Đường nội bộ', title: 'Kiệt, hẻm, đường không tên, đường nội bộ', color: '#cbd5e1', base: 0.6, reach: 1.1 }],
  ['unknown', { label: 'Đường chưa phân nhóm', title: 'Mạng lưới đường lưu bản cũ — Admin tải lại mạng lưới đường', color: '#fde047', base: 0.9, reach: 1.8 }],
  ['named',   { label: 'Đường khu vực', title: 'Đường phố có tên', color: '#60a5fa', base: 1.1, reach: 2.2 }],
  ['main',    { label: 'Đường trục chính', title: 'Quốc lộ, tỉnh lộ, đường chính đô thị', color: '#fb923c', base: 1.6, reach: 3.2 }]
];

function addRoadLayers(group, area) {
  ROAD_STYLES.forEach(([key, s]) => {
    if (area.allRoads[key].length) {
      group.addLayer(L.polyline(area.allRoads[key], { color: '#e2e8f0', weight: s.base, opacity: 0.3, interactive: false }));
    }
  });
  ROAD_STYLES.forEach(([key, s]) => {
    if (area.reachRoads[key].length) {
      group.addLayer(L.polyline(area.reachRoads[key], { color: s.color, weight: s.reach, opacity: 0.95, lineCap: 'round', interactive: false }));
    }
  });
}

function roadLegendHtml(area) {
  const items = ROAD_STYLES.slice().reverse()
    .filter(([key]) => area.reachRoads[key].length)
    .map(([, s]) => `<span class="road-legend-item" title="${s.title}"><i style="background:${s.color}; height:${Math.max(2, Math.round(s.reach))}px;"></i>${s.label}</span>`);
  return items.length ? `<div class="road-legend">${items.join('')}</div>` : '';
}

function clearSingleIsochrone() {
  singleIsoSeq++;
  if (stopFlow) stopFlow();
  stopFlow = null;
  layers.singleIso.clearLayers();
  planLayers.singleIso.clearLayers();
}

// Vùng phục vụ thực tế theo mạng đường + đường giao thông làm minh chứng.
// Trả về { area, polygon }: area = null khi không tải được đường (khi đó polygon là vòng tròn bán kính); null nếu đã có click khác.
export async function highlightSingleIsochrone(lat, lng, radius, group = layers.singleIso) {
  clearSingleIsochrone();
  const seq = singleIsoSeq;
  if (!group) return null;
  lat = Number(lat);
  lng = Number(lng);
  group.addLayer(L.circle([lat, lng], { radius, color: '#ffffff', weight: 1.2, dashArray: '4,4', fillColor: '#020617', fillOpacity: 0.6, interactive: false }));

  try {
    const area = await computeServiceArea(lat, lng, radius);
    if (seq !== singleIsoSeq) return null;
    group.addLayer(L.geoJSON(area.polygon, {
      interactive: false,
      style: { color: '#22c55e', weight: 2, fillColor: '#22c55e', fillOpacity: 0.1 }
    }));
    addRoadLayers(group, area);
    stopFlow = startFlowAnimation(group === planLayers.singleIso ? planMap : map, group, area.flowPaths);
    return { area, polygon: area.polygon };
  } catch (err) {
    if (seq !== singleIsoSeq) return null;
    console.warn("Không dựng được vùng phục vụ theo mạng đường:", err);
    group.addLayer(L.circle([lat, lng], { radius, color: '#ffffff', weight: 1.2, dashArray: '3,3', fillColor: '#38bdf8', fillOpacity: 0.18, interactive: false }));
    return { area: null, polygon: turf.circle([lng, lat], radius / 1000, { steps: 64 }) };
  }
}

async function fetchServedPop(lat, lng, radius, polygon) {
  const res = await fetch(geeApi('action=analyzePoint'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, radius, polygon: polygon.geometry.coordinates[0] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatCapCongTrinhLabel(raw) {
  if (!raw) return "Cấp đơn vị ở";
  const original = String(raw).trim();
  const s = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");

  if (s.includes("do thi") || s.includes("urban")) return "Cấp đô thị";
  if (s.includes("don vi") || s.includes("dvo")) return "Cấp đơn vị ở";
  return original;
}

function buildDiaBanHtml(geoWard, sheetWard) {
  const geo = (geoWard || "").trim();
  const sheet = (sheetWard || "").trim();
  if (!geo) return escapeHtml(sheet || "—");
  let html = escapeHtml(geo);
  const clean = (s) => String(s || "").replace(/^Phường\s+/i, "").replace(/^Xã\s+/i, "").trim().toLowerCase();
  if (clean(sheet) !== clean(geo)) {
    html += ` <span style="color:var(--accent-orange); font-size:9px; font-weight:normal;" title="Tên phường trong Sheet khác phường theo tọa độ — cần sửa cột Ten_XaPhuong">(⚠ Sheet: ${escapeHtml(sheet || 'trống')})</span>`;
  }
  return html;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function onPointClick(p, targetMap = map) {
  const approved = isApproved(p.status);
  const isCSD = p.type === "9-CSD";
  const isCSDUnapproved = isCSD && !approved;
  const itemRadius = effectiveRadius(p);
  const isPlanScenario = p.scenario === 'QH';

  // Chỉ để mở 1 popup công trình trên 2 bản đồ
  if (map) map.closePopup();
  if (planMap) planMap.closePopup();
  clearCsdProof();

  const areaPromise = isCSDUnapproved
    ? null
    : highlightSingleIsochrone(p.lat, p.lng, itemRadius, isPlanScenario ? planLayers.singleIso : layers.singleIso);

  const capCongTrinh = formatCapCongTrinhLabel(p.nhomHaTang || p.capCongTrinh || "Cấp đơn vị ở");
  const geoWardNow = resolveWardNameFromCoords(Number(p.lat), Number(p.lng));

  let html = `<div style="min-width:220px; font-size:11px;">`;
  html += `<b style="color:var(--accent-cyan); font-size:12px;">${escapeHtml(p.name)}</b>`;
  if (!approved) html += `<span class="badge-pending">Chờ duyệt</span>`;
  html += `<br><hr style="border-color:var(--border-color); margin:4px 0;">`;
  html += `• Loại hạ tầng: <b>${escapeHtml(infraLabels[layerType(p)] || p.type)}</b><br>`;
  html += `• Địa bàn: <b class="js-ward">${buildDiaBanHtml(geoWardNow, p.ward)}</b><br>`;
  html += `• Cấp công trình: <b style="color:var(--accent-orange);">${escapeHtml(capCongTrinh)}</b><br>`;
  const planInfo = PLAN_CHANGE_INFO[p.planChange];
  html += `• Diện tích${isPlanScenario ? ' QH' : ''}: <b>${fmtNum(p.size)} m²</b>`;
  if (planInfo) {
    const otherSize = isPlanScenario
      ? (p.planChange === 'new' ? '' : `, HT ${fmtNum(p.sizeHT)} m²`)
      : (p.planChange === 'relocate' ? '' : ` → QH ${fmtNum(p.sizeQH)} m²`);
    html += ` <span style="color:${planInfo.color}; font-weight:bold;">(${planInfo.label}${otherSize})</span>`;
  }
  html += `<br>`;
  if (!isCSDUnapproved) {
    html += `• Bán kính phục vụ: <b style="color:var(--accent-cyan);">${fmtNum(itemRadius)} m</b><br>`;
    html += `<div class="js-area">• Phạm vi thực tế: <span style="color:var(--text-muted);">⏳ đang dựng theo mạng đường...</span></div>`;
  }

  const servedColor = approved ? 'var(--accent-orange)' : 'var(--accent-red)';
  const showServed = !isCSD;
  if (showServed) {
    html += `<div class="js-served" style="color:${servedColor}; font-weight:bold; margin-top:4px;">• Dân số phục vụ${approved ? '' : ' DỰ KIẾN'}: <span style="font-weight:normal;">⏳ đang tính...</span></div>`;
  }
  if (isCSD && approved) {
    html += `<div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">💡 ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG:</div>`;
    html += `<div class="js-csd"><div style="font-size:10px; color:var(--text-muted);">⏳ Đang tính toán không gian...</div></div>`;
  }
  if (!approved) {
    html += state.currentUserRole === "ADMIN"
      ? `<button type="button" class="js-approve popup-approve-btn">✅ PHÊ DUYỆT CHÍNH THỨC (ADMIN)</button>`
      : `<div style="margin-top:6px; font-size:10px; color:var(--accent-orange); font-style:italic; text-align:center;">⏳ Đang chờ Quản trị viên (Admin) phê duyệt.</div>`;
  }
  html += `</div>`;

  const popup = L.popup({ closeButton: true, autoPan: true, ...popupFitOptions(targetMap, 300, 50) }).setLatLng([p.lat, p.lng]).setContent(html);
  popup.openOn(targetMap);
  popup.getElement()?.querySelector('.js-approve')?.addEventListener('click', () => approvePointStatus(p.id));

  // Kết quả tải chậm chỉ ghi vào đúng popup này (popup đã đóng / đã mở popup khác thì bỏ qua)
  const fill = (selector, content) => {
    if (!popup.isOpen()) return;
    const el = popup.getElement()?.querySelector(selector);
    if (el) el.innerHTML = content;
  };

  if (!geoWardNow) {
    fetchJson(geeApi(`action=getWardFromPoint&lat=${p.lat}&lng=${p.lng}`))
      .then(res => fill('.js-ward', buildDiaBanHtml(res.ward, p.ward)))
      .catch(() => {});
  }

  if (areaPromise) {
    areaPromise.then(r => {
      if (!r) return;
      if (r.area) {
        const pct = Math.round(r.area.areaKm2 / r.area.circleKm2 * 100);
        fill('.js-area', `• Phạm vi thực tế: <b style="color:#22c55e;">${r.area.areaKm2.toFixed(2)} km²</b> <span style="color:var(--text-muted);">(${pct}% vòng tròn, theo ${r.area.reachKm.toFixed(1)} km đường tiếp cận)</span>${roadLegendHtml(r.area)}`);
      } else {
        fill('.js-area', `<span style="color:var(--text-muted);">• Phạm vi thực tế: máy chủ dữ liệu đường (OpenStreetMap) đang quá tải — tạm hiển thị vòng tròn bán kính, bấm lại công trình sau ít phút.</span>`);
      }
    });
  }

  if (showServed) {
    const servedLabel = `Dân số phục vụ${approved ? '' : ' DỰ KIẾN'}`;
    Promise.resolve(areaPromise)
      .then(r => {
        const polygon = r ? r.polygon : turf.circle([Number(p.lng), Number(p.lat)], itemRadius / 1000, { steps: 64 });
        return fetchServedPop(Number(p.lat), Number(p.lng), itemRadius, polygon).then(res => ({ res, real: !!(r && r.area) }));
      })
      .then(({ res, real }) => fill('.js-served', `• ${servedLabel}: ~<b style="color:${servedColor};">${fmtNum(res.servedPop || 0)} người</b> <span style="font-weight:normal; color:var(--text-muted);">(${real ? 'trong phạm vi thực tế' : 'trong vòng tròn'})</span>`))
      .catch(() => fill('.js-served', `<span style="color:var(--text-muted); font-weight:normal;">• ${servedLabel}: chưa tính được (GEE đang bận), mở lại sau.</span>`));
  }

  if (isCSD && approved) {
    const csdQuery = `id=${encodeURIComponent(p.id || '')}&lat=${p.lat}&lng=${p.lng}&size=${Number(p.size) || 0}`;
    fetchJson(geeApi(`action=analyzeCSD&${csdQuery}`))
      .then(res => {
        const suggestions = res.suggestions || [];
        let sugHtml = "";
        suggestions.forEach((s, idx) => {
          const priorityBadge = s.isTopPriority ? `<span class="badge-priority">ƯU TIÊN HÀNG ĐẦU</span>` : "";
          const cls = s.isTopPriority ? "sug-card priority" : "sug-card";
          const estimateNote = s.coverageMethod === 'estimate' ? ` <span title="GEE bận: ước lượng theo diện tích">(ước lượng)</span>` : '';
          sugHtml += `<div class="${cls}"><div>🚩 <b>${escapeHtml(s.label)}</b> ${priorityBadge}</div>
            <div style="color:var(--text-muted); margin-top:2px;">└ Bổ sung <b style="color:var(--accent-green);">${fmtNum(s.scaleAddPct)}%</b> quy mô, <b style="color:var(--accent-cyan);">${fmtNum(s.coverageAddPct)}%</b> độ phủ${estimateNote}</div>
            <button type="button" class="proof-btn" data-idx="${idx}">📋 Xem thuyết minh</button></div>`;
        });
        (res.ineligible || []).forEach(inEl => {
          sugHtml += `<div class="sug-card ineligible">❌ <b>${escapeHtml(inEl.label)}</b> (Không đủ DT min: ${fmtNum(inEl.minSize)} m²)</div>`;
        });
        const base = sugHtml || "<div class='sug-card'>✓ Vị trí đã phủ đủ hạ tầng.</div>";
        fill('.js-csd', base + `<div style="margin-top:6px; font-size:10px; color:var(--accent-red); font-weight:bold; text-align:center;">(Cần phê duyệt)</div>`);
        popup.getElement()?.querySelectorAll('.proof-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const fitOpts = popupFitOptions(targetMap, 300, 50);
            clearSingleIsochrone();
            showCsdProof(p, suggestions[Number(btn.dataset.idx)], targetMap, {
              padTopLeft: fitOpts.autoPanPaddingTopLeft,
              padBottomRight: fitOpts.autoPanPaddingBottomRight
            });
          });
        });
      })
      .catch(() => fill('.js-csd', `<div class="sug-card ineligible">Chưa tính được đề xuất (GEE đang bận), mở lại sau.</div>`));
  }
}

// Bay tới công trình (từ bảng chi tiết phường) rồi mở popup của nó
export function zoomToPoint(lat, lng, name) {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  map.closePopup();
  if (planMap) planMap.closePopup();
  const near = (it) => Math.abs(Number(it.lat) - lat) < 1e-5 && Math.abs(Number(it.lng) - lng) < 1e-5;
  const item = state.rawDataList.find(near) || state.planDataList.find(near);

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    if (item) {
      onPointClick(item, map);
      return;
    }
    L.popup(popupFitOptions(map, 300, 50))
      .setLatLng([lat, lng])
      .setContent(`<div style="font-size:11px;"><b style="color:var(--accent-cyan);">${escapeHtml(name)}</b><br/>• Tọa độ: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`)
      .openOn(map);
  };
  map.once('moveend', open);
  setTimeout(open, 1600);
  flyToVisible([lat, lng], 17, { animate: true, duration: 1.2 });
}

/** pv: phiên bản vùng hiệu chỉnh dân cư Admin vừa lưu (bỏ qua cache CDN, thay ảnh đang hiển thị) */
export async function loadPopulationLayer(pv) {
  if (!map) return;
  try {
    const res = await fetch(geeApi(`action=getPopRasterTile${pv ? `&pv=${pv}` : ''}`));
    const data = await res.json();
    if (data.urlFormat) {
      const popOpacityEl = document.getElementById('popOpacity');
      const opacity = popOpacityEl ? popOpacityEl.value / 100 : 0.6;
      layers.pop.clearLayers();
      planLayers.pop?.clearLayers();
      layers.pop.addLayer(L.tileLayer(data.urlFormat, { opacity }));
      planLayers.pop.addLayer(L.tileLayer(data.urlFormat, { opacity }));
    }
  } catch (err) {
    console.error("Lỗi tải lớp raster dân số:", err);
  }
}

// ============================ TRA CỨU TẠI VỊ TRÍ ============================

// Buffer của mỗi công trình là vòng tròn bán kính R: điểm được phục vụ khi khoảng cách ≤ R.
// Tính trực tiếp trên toàn TP (không phụ thuộc phường đang lọc), dùng được cho cả bản đồ quy hoạch.
export function handleInspectPointClick(clickLat, clickLng, targetMap = map) {
  if (!targetMap) return;
  const isPlan = !!planMap && targetMap === planMap;
  if (state.tempMarker) state.tempMarker.remove();
  state.tempMarker = L.marker([clickLat, clickLng], { interactive: false }).addTo(targetMap);

  const source = isPlan ? getPlanScenarioList() : state.rawDataList;
  const coveredGroups = {};
  source.forEach(item => {
    if (!INFRA_CODES.includes(item.type) || !isApproved(item.status) || !hasValidCoord(item)) return;
    if (distanceMeters(clickLat, clickLng, Number(item.lat), Number(item.lng)) > effectiveRadius(item)) return;
    (coveredGroups[item.type] = coveredGroups[item.type] || new Set()).add(item.name || 'Công trình');
  });
  const missingCodes = INFRA_CODES.filter(code => !coveredGroups[code]);
  const coveredCount = INFRA_CODES.length - missingCodes.length;
  const override = state.globalBufferRadiusOverride;
  const wardLocal = resolveWardNameFromCoords(clickLat, clickLng);

  let html = `<div style="font-size:11px;">
    <b style="color:var(--accent-cyan);">📊 MẬT ĐỘ HẠ TẦNG TẠI VỊ TRÍ${isPlan ? ' (QUY HOẠCH)' : ''}</b><br>
    <span style="color:var(--text-muted);">📌 Tọa độ: <b>${clickLat.toFixed(5)}, ${clickLng.toFixed(5)}</b></span><br>
    <span style="color:var(--text-muted);">📍 Địa bàn: <b class="js-ward">${escapeHtml(wardLocal || '⏳')}</b> | 🛤️ Bán kính: <b style="color:var(--accent-green);">${override !== null ? `${fmtNum(override)} m (chung)` : 'theo từng công trình'}</b></span><br>
    <div style="font-weight:bold; color:var(--accent-green); margin-top:6px;">1. Tiếp cận: ${coveredCount}/8 nhóm</div>`;

  if (coveredCount > 0) {
    INFRA_CODES.forEach(code => {
      if (!coveredGroups[code]) return;
      const names = [...coveredGroups[code]];
      const shown = names.slice(0, 5).map(escapeHtml).join(', ') + (names.length > 5 ? ` và ${names.length - 5} công trình khác` : '');
      html += `<div class="sug-card">• <b>${escapeHtml(infraLabels[code] || code)}:</b><br><span style="color:var(--accent-cyan);">└ ${shown}</span></div>`;
    });
  } else {
    html += `<div class="sug-card ineligible">(Chưa có hạ tầng phủ đến)</div>`;
  }

  html += `<div style="font-weight:bold; color:var(--accent-red); margin-top:6px;">2. Chưa tiếp cận: ${missingCodes.length}/8 nhóm</div>`;
  if (missingCodes.length > 0) {
    missingCodes.forEach(code => {
      html += `<div class="sug-card ineligible">❌ ${escapeHtml(infraLabels[code] || code)}</div>`;
    });
  } else {
    html += `<div class="sug-card priority">✓ Vị trí tiếp cận đủ 8 nhóm hạ tầng!</div>`;
  }
  html += `</div>`;

  const inspectPopup = L.popup({ className: 'inspect-popup', ...popupFitOptions(targetMap, 320, 240) })
    .setLatLng([clickLat, clickLng])
    .setContent(html)
    .openOn(targetMap);

  if (!wardLocal) {
    fetchJson(geeApi(`action=getWardFromPoint&lat=${clickLat.toFixed(6)}&lng=${clickLng.toFixed(6)}`))
      .then(res => res.ward || "Ngoài ranh giới")
      .catch(() => "Không xác định")
      .then(name => {
        const el = inspectPopup.isOpen() && inspectPopup.getElement()?.querySelector('.js-ward');
        if (el) el.textContent = name;
      });
  }
}

// ============================ PHÊ DUYỆT (ADMIN) ============================

export async function approvePointStatus(pointId) {
  if (state.currentUserRole !== "ADMIN" || !state.authToken) return;
  const target = state.rawDataList.find(x => x.id === pointId)
    || state.planDataList.find(x => x.id === pointId);
  if (!target) return;
  if (map) map.closePopup();
  if (planMap) planMap.closePopup();

  const applyStatus = (value) => {
    target.status = value;
    bumpDataVersion();
    renderGroupedPoints();
    refreshHeatmapOnly();
  };
  applyStatus(true);

  try {
    const res = await fetch(geeApi('action=approvePoint'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ id: pointId })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    showToast(`✓ Đã phê duyệt ${target.name || pointId}`, 'success');
    reloadWardStats();
  } catch (err) {
    applyStatus(false);
    showToast(`❌ Không phê duyệt được: ${err.message}`, 'error');
  }
}
