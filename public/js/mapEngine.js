import {
  state, infraLabels, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE, PLAN_CHANGE_INFO,
  BUFFER_COLORS, BUFFER_KEYS, ICON_GROUP_KEYS, getBufferStyle, getPlanScenarioList, effectiveRadius, bumpDataVersion, layerType,
  isNetworkType, ntKindOf, NT_KIND_LABELS
} from './state.js';
import { updateInfraPieChart, reloadWardStats, signOutAdmin } from './uiComponents.js';
import { geeApi, markDataWritten } from './api.js';
import { escapeHtml, isApproved, fmtNum, distanceMeters, wardLabelFontSize, showToast, wardLabelPoint, ico } from './utils.js';
import { showCsdProof, clearCsdProof } from './csdProof.js';
import { computeServiceArea, computeAccessRoutes } from './serviceArea.js';
import { startFlowAnimation } from './flowAnimation.js';
import { tt16ParcelStyle, renderTt16Legend } from './tt16Symbols.js';
import { addIslandFlags } from './islandFlags.js';
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
  c9: L.layerGroup(), b9: L.layerGroup(),
  c11: L.layerGroup(), b11: L.layerGroup(),
  c12: L.layerGroup(), b12: L.layerGroup(),
  c13: L.layerGroup(), b13: L.layerGroup()
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
  "9-CSD": { approved: "Unused.png", pending: "Unused2.png" },
  "10-BUS": { approved: "Bus.svg", pending: "Bus2.svg" },
  "11-PCCC": { approved: "Pccc.svg", pending: "Pccc2.svg" },
  "12-NT": { approved: "Nghiatrang.svg", pending: "Nghiatrang2.svg" }
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
// rồi kiểm tra lại trên ranh gốc; không đạt thì dùng fallbackLabelPoint
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

function fallbackLabelPoint(geometry) {
  try {
    const [lng, lat] = turf.pointOnFeature(turf.feature(geometry)).geometry.coordinates;
    return { lat, lng };
  } catch (e) {
    return { lat: CITY_CENTER[0], lng: CITY_CENTER[1] };
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
    maxZoom: 19,
    maxNativeZoom: 18,
    zIndex: 0,
    crossOrigin: 'anonymous',
    attribution: 'Tiles &copy; Esri'
  }).addTo(map);

  measureLayerGroup = L.layerGroup().addTo(map);
  addIslandFlags(map);

  layers.boundary.addTo(map);
  layers.highlightWard.addTo(map);
  layers.heatmap.addTo(map);
  layers.singleIso.addTo(map);
  layers.c1.addTo(map); layers.c2.addTo(map); layers.c3.addTo(map);
  layers.c4.addTo(map); layers.c5.addTo(map); layers.c10.addTo(map); layers.c6.addTo(map);
  layers.c7.addTo(map); layers.c8.addTo(map); layers.c9.addTo(map);

  map.on('zoomend', updateWardLabelFontSize);
  map.on('moveend', refreshLeftSoon);
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
  planMap.on('moveend', refreshPlanSoon);
}

// Khi so sánh, bản đồ còn lại được đồng bộ bằng setView mỗi khung hình (mỗi lần phát moveend): gom lại, vẽ 1 lần khi dừng
const debounce = (fn, ms) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const refreshLeftSoon = debounce(() => leftRenderer.refreshPoints(), 60);
const refreshPlanSoon = debounce(() => planRenderer.refreshPoints(), 60);

function handleCompareChange(on) {
  ensurePlanHooks();
  leftRenderer.refreshPoints();
  if (!on) {
    // Vùng phục vụ đang vẽ trên bản đồ quy hoạch (bị ẩn): dừng hiệu ứng chấm chạy
    if (planLayers.singleIso.getLayers().length) clearSingleIsochrone();
    return;
  }
  planRenderer.setList(getWardFilteredList(getPlanScenarioList()));
  if (heatStale) refreshHeatmapOnly();
  else if (planHeatStale) refreshPlanHeat();
}

export async function loadBoundaryLayer() {
  if (!map) return;

  let features = [];
  try {
    const boundRes = await fetch(geeApi(`action=getBoundaryVector&v=${WARD_GEOM_VERSION}`));
    const boundData = await boundRes.json();
    
    if (boundData && boundData.features) {
      features = boundData.features;
      layers.boundary.addLayer(L.geoJSON(boundData, { style: WARD_BOUNDARY_SHADOW_STYLE, interactive: false }));
      layers.boundary.addLayer(L.geoJSON(boundData, { style: WARD_BOUNDARY_LINE_STYLE, interactive: false }));
    }
  } catch (err) {
    console.error("Lỗi tải ranh giới vector 40 phường xã:", err);
  }

  // Tên + điểm đặt nhãn lấy từ chính ranh vừa tải (cùng thứ tự, cùng tên như getWardLabels), không tải lại hình học lần 2
  try {
    const labels = features.filter(f => f && f.geometry).map(f => {
      const props = f.properties || {};
      const pt = labelPointFor(f.geometry) || fallbackLabelPoint(f.geometry);
      return {
        name: props.tenXa || props.NAME_2 || props.name || 'Phường',
        lat: pt.lat,
        lng: pt.lng,
        geometry: f.geometry
      };
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

export function getRightObstruction() {
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
    btn.innerHTML = ico('close');
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
    btnDist.innerHTML = ico('ruler');
  }
  if (btnArea) {
    btnArea.classList.remove('active');
    btnArea.innerHTML = ico('area');
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
    label = `${ico('ruler')}Chiều dài: ${meters >= 1000 ? `${fmtNum(meters / 1000)} km` : `${fmtNum(Math.round(meters))} m`}`;
  } else if (isArea && pts.length >= 3) {
    const sqm = turf.area(turf.polygon([[...pts, pts[0]]]));
    label = `${ico('area')}Diện tích: ${sqm >= 10000 ? `${fmtNum(sqm / 10000)} ha` : `${fmtNum(Math.round(sqm))} m²`}`;
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
// Zoom ≤ ngưỡng (thấy toàn bộ thành phố): gộp 40 biểu đồ phường thành 1 biểu đồ TP, làm nổi ranh giới thành phố
const CITY_PIE_MAX_ZOOM = 10;
const CITY_PIE_PX = 64;
const CITY_OUTLINE_SIMPLIFY_DEG = 0.0004;

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

function pieTooltipHtml(ward, counts, total, scenarioLabel, city) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, n]) => `
    <div class="ward-pie-row"><i style="background:${BUFFER_COLORS[type] || '#38bdf8'}"></i><span>${escapeHtml(infraLabels[type] || type)}</span><b>${fmtNum(n)}</b></div>`).join('');
  return `<div class="ward-pie-title">${escapeHtml(ward.name)}${scenarioLabel ? `<small>${scenarioLabel}</small>` : ''}</div>
    ${rows}<div class="ward-pie-total"><span>Tổng</span><b>${fmtNum(total)}</b></div>
    <div class="ward-pie-hint">Bấm để phóng to xem ${city ? 'từng phường/xã' : 'từng công trình'}</div>`;
}

// city = biểu đồ chung toàn thành phố: tên in hoa cỡ lớn, bấm vào phóng tới mức biểu đồ từng phường
function createWardPie(ward, counts, total, size, targetMap, scenarioLabel, city = false) {
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
      className: `ward-pie-icon${city ? ' city-pie-icon' : ''}`,
      html: `<span class="ward-pie-name">${escapeHtml(city ? ward.name.toUpperCase() : ward.name)}</span><div class="ward-pie" style="width:${size}px;height:${size}px;background:conic-gradient(${stops})"><span>${total}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    }),
    riseOnHover: true,
    bubblingMouseEvents: false
  });
  marker.bindTooltip(pieTooltipHtml(ward, counts, total, scenarioLabel, city), {
    direction: 'auto', offset: [size / 2 + 6, 0], className: 'ward-pie-tip', opacity: 1
  });
  marker.on('click', () => {
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode || state.sketchTool) return;
    if (city) targetMap.flyTo(CITY_CENTER, CITY_PIE_MAX_ZOOM + 1);
    else targetMap.flyTo([ward.lat, ward.lng], PIE_CLICK_ZOOM);
  });
  return marker;
}

// Ranh thành phố = các cạnh chỉ thuộc 1 phường (cạnh chung của 2 phường liền kề trùng đỉnh nên bị loại),
// nối thành các đường liên tục rồi giản lược; ~0,1 s so với vài giây nếu turf.union 40 phường.
// Tâm biểu đồ chung = trọng tâm các phường theo diện tích (rơi ra ngoài ranh thì lấy điểm đặt nhãn phường gần nhất)
let cityShape = null;
function cityShapeOf(wards) {
  if (cityShape && cityShape.source === wards) return cityShape;
  const vkey = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const edges = new Map();
  let sx = 0, sy = 0, sa = 0;
  wards.forEach(w => {
    const g = w.geometry;
    if (!g) return;
    const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    polys.forEach(poly => poly.forEach(ring => {
      for (let i = 0; i < ring.length - 1; i++) {
        const ka = vkey(ring[i]), kb = vkey(ring[i + 1]);
        if (ka === kb) continue;
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edges.get(k);
        if (e) e.n++;
        else edges.set(k, { n: 1, a: ring[i], b: ring[i + 1], ka, kb });
      }
    }));
    try {
      const area = turf.area(g);
      const [x, y] = turf.centroid(g).geometry.coordinates;
      sx += x * area; sy += y * area; sa += area;
    } catch (e) { /* hình học lỗi: bỏ qua khi tính tâm */ }
  });

  const outer = [...edges.values()].filter(e => e.n === 1);
  const adj = new Map();
  outer.forEach(e => {
    [e.ka, e.kb].forEach(k => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(e); });
  });
  const used = new Set();
  const walk = (k) => {
    const pts = [];
    for (;;) {
      const next = (adj.get(k) || []).find(e => !used.has(e));
      if (!next) return pts;
      used.add(next);
      const forward = next.ka === k;
      pts.push(forward ? next.b : next.a);
      k = forward ? next.kb : next.ka;
    }
  };
  const lines = [];
  outer.forEach(start => {
    if (used.has(start)) return;
    used.add(start);
    const ahead = walk(start.kb);
    const behind = walk(start.ka).reverse();
    const coords = [...behind, start.a, start.b, ...ahead];
    const simple = coords.length > 2
      ? turf.simplify(turf.lineString(coords), { tolerance: CITY_OUTLINE_SIMPLIFY_DEG }).geometry.coordinates
      : coords;
    lines.push(simple.map(([lng, lat]) => [lat, lng]));
  });

  let center = sa ? { lat: sy / sa, lng: sx / sa } : { lat: CITY_CENTER[0], lng: CITY_CENTER[1] };
  if (!wardNameAt(center.lat, center.lng)) {
    const near = wards.filter(w => w.lat != null && w.lng != null)
      .sort((a, b) => ((a.lat - center.lat) ** 2 + (a.lng - center.lng) ** 2) - ((b.lat - center.lat) ** 2 + (b.lng - center.lng) ** 2))[0];
    if (near) center = { lat: near.lat, lng: near.lng };
  }
  cityShape = { source: wards, lines, center };
  return cityShape;
}

// Ranh TP nổi bật: nét trắng trên quầng vàng nhấp nháy (SVG riêng để tạo hiệu ứng CSS; bản đồ chính vẽ canvas)
function createCityOutline(lines, renderer) {
  return L.layerGroup([
    L.polyline(lines, { renderer, className: 'city-outline-glow', color: '#facc15', weight: 11, opacity: 0.45, interactive: false }),
    L.polyline(lines, { renderer, className: 'city-outline-line', color: '#ffffff', weight: 2.4, opacity: 1, interactive: false })
  ]);
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
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode || state.sketchTool) return;
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
    // Viền trắng để chấm nổi trên ảnh vệ tinh; điểm quy hoạch khác hiện trạng viền xanh đậm như chấm biến động của icon
    marker = L.circleMarker([p.lat, p.lng], {
      radius: 5,
      weight: planInfo ? 2.5 : 1.5,
      color: planInfo ? '#22c55e' : '#ffffff',
      fillColor: approved ? (BUFFER_COLORS[layerType(p)] || '#38bdf8') : '#f87171',
      fillOpacity: 1,
      bubblingMouseEvents: false
    });
    marker.bindTooltip(escapeHtml(p.name || ''), { direction: 'top', offset: [0, -6], className: 'dot-tip' });
  }
  marker.on('click', () => {
    if (state.isPickMode || state.activeMeasureType || state.adminDrawMode || state.sketchTool) return;
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
  const outlineRenderer = L.svg({ padding: 0.3 });
  let outlineLayer = null;
  // Công trình trong phạm vi phục vụ của công trình đang chọn (pointKey); null = không chọn
  let selKeys = null;
  const markSel = (entry, key) => {
    const el = entry.marker.getElement && entry.marker.getElement();
    if (el) el.classList.toggle('sel-in', !!selKeys && selKeys.has(key));
  };

  const showCityOutline = (m, on) => {
    m.getContainer().classList.toggle('city-pie-mode', on);
    if (!on) { outlineLayer?.remove(); return; }
    const shape = cityShapeOf(state.wardLabelsList);
    if (!outlineLayer || outlineLayer.source !== shape) {
      outlineLayer?.remove();
      outlineLayer = createCityOutline(shape.lines, outlineRenderer);
      outlineLayer.source = shape;
    }
    if (!m.hasLayer(outlineLayer)) outlineLayer.addTo(m);
  };

  const clearPies = () => {
    pieGroup.clearLayers();
    pieGroup.remove();
    pieKey = null;
    const m = getMap();
    if (m) showCityOutline(m, false);
  };

  function renderPies(m) {
    const cityPie = m.getZoom() <= CITY_PIE_MAX_ZOOM;
    showCityOutline(m, cityPie);
    const activeTypes = Object.keys(ICON_GROUP_KEYS).filter(t => m.hasLayer(groups[ICON_GROUP_KEYS[t]]));
    const label = scenarioLabel();
    const key = `${listSeq}|${activeTypes.join(',')}|${state.wardLabelsList.length}|${label}|${cityPie}`;
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
    const orderedOf = (counts) => Object.fromEntries(Object.keys(ICON_GROUP_KEYS).filter(t => counts[t]).map(t => [t, counts[t]]));
    if (cityPie) {
      const cityCounts = {};
      byWard.forEach(counts => Object.entries(counts).forEach(([t, n]) => { cityCounts[t] = (cityCounts[t] || 0) + n; }));
      const total = Object.values(cityCounts).reduce((s, n) => s + n, 0);
      if (!total) return;
      const { center } = cityShapeOf(state.wardLabelsList);
      pieGroup.addLayer(createWardPie({ name: CITY_NAME, ...center }, orderedOf(cityCounts), total, CITY_PIE_PX, m, label, true));
      return;
    }
    const totals = new Map([...byWard].map(([name, counts]) => [name, Object.values(counts).reduce((s, n) => s + n, 0)]));
    const maxTotal = Math.max(1, ...totals.values());
    state.wardLabelsList.forEach(ward => {
      const counts = byWard.get(ward.name);
      if (!counts || ward.lat == null || ward.lng == null) return;
      const total = totals.get(ward.name);
      const size = Math.round(PIE_MIN_PX + (PIE_MAX_PX - PIE_MIN_PX) * Math.sqrt(total / maxTotal));
      pieGroup.addLayer(createWardPie(ward, orderedOf(counts), total, size, m, label));
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
    // Nhóm đang tắt: không dựng marker và không tính vào ngưỡng ICON_MAX_VISIBLE (bật lại lớp sẽ gọi refreshPoints)
    const groupOf = (p) => groups[ICON_GROUP_KEYS[layerType(p)]] || groups.c9;
    const visible = list.filter(p => bounds.contains([p.lat, p.lng]) && m.hasLayer(groupOf(p)));
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
      const entry = { point: p, group: groupOf(p) };
      entry.shape = parcelsOn ? createParcelShape(entry, m, parcelDetail) : null;
      if (entry.shape) entry.group.addLayer(entry.shape);
      entry.marker = createPointMarker(entry, mode, m);
      entry.group.addLayer(entry.marker);
      if (selKeys) markSel(entry, key);
      rendered.set(key, entry);
    });
  }

  function highlight(keys) {
    selKeys = keys;
    rendered.forEach(markSel);
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
      const radius = effectiveRadius(p);
      if (!(radius > 0)) return;
      group.addLayer(L.circle([p.lat, p.lng], { radius, ...getBufferStyle(type, approved), interactive: false }));
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

  return { setList, refreshPoints, refreshBuffers, invalidateBuffers, reset, highlight };
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
  tileHeatmapLayer = L.tileLayer(url, { maxZoom: 19, opacity: heatOpacityEl ? heatOpacityEl.value / 100 : 0.3 });
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

// Chọn công trình = chế độ âm bản: phủ xanh dương thẫm (ngoài vòng bán kính nhạt, trong vòng đậm) trên pane riêng
// nằm trên canvas buffer/heatmap/chấm công trình, dưới icon và chấm sáng; nổi bật đường tiếp cận và công trình trong phạm vi
const SEL_PANE = 'selPane';
const SEL_PANE_Z = 420;
const SEL_NAVY = '#04112b';
const SEL_OUTER_OPACITY = 0.5;
const SEL_INNER_OPACITY = 0.84;
const SEL_ACCENT = '#22d3ee';
const SEL_RING_STEPS = 96;
const WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
const selRenderers = new WeakMap();

function selRendererFor(m) {
  if (!m.getPane(SEL_PANE)) m.createPane(SEL_PANE).style.zIndex = SEL_PANE_Z;
  if (!selRenderers.has(m)) selRenderers.set(m, L.canvas({ pane: SEL_PANE }));
  return selRenderers.get(m);
}

// Đường theo nhóm (serviceArea.js): nền = mọi đường quanh công trình (xanh mờ kiểu bản vẽ), tới được = phần đi được trong bán kính (phát sáng).
// Vẽ từ nhóm nhỏ lên nhóm lớn để trục chính nằm trên cùng; 'unknown' = mạng lưới lưu cũ chưa phân nhóm.
const ROAD_STYLES = [
  ['kiet',    { label: 'Đường nội bộ', title: 'Kiệt, hẻm, đường không tên, đường nội bộ', color: '#a5c8ff', base: 0.6, reach: 1.2 }],
  ['unknown', { label: 'Đường chưa phân nhóm', title: 'Mạng lưới đường lưu bản cũ — Admin tải lại mạng lưới đường', color: '#fde047', base: 0.9, reach: 1.8 }],
  ['named',   { label: 'Đường khu vực', title: 'Đường phố có tên', color: '#22d3ee', base: 1.1, reach: 2.2 }],
  ['bike',    { label: 'Đường xe đạp', title: 'Đường dành riêng cho xe đạp', color: '#4ade80', base: 1, reach: 2 }],
  ['main',    { label: 'Đường trục chính', title: 'Quốc lộ, tỉnh lộ, đường chính đô thị', color: '#fbbf24', base: 1.6, reach: 3.2 }]
];
const ROAD_BASE_COLOR = '#3b6fd8';
const ROAD_GLOW_SCALE = 3.2;

function addRoadLayers(group, area, renderer) {
  ROAD_STYLES.forEach(([key, s]) => {
    if (area.allRoads[key].length) {
      group.addLayer(L.polyline(area.allRoads[key], { renderer, color: ROAD_BASE_COLOR, weight: s.base, opacity: 0.55, interactive: false }));
    }
  });
  ROAD_STYLES.forEach(([key, s]) => {
    if (!area.reachRoads[key].length) return;
    group.addLayer(L.polyline(area.reachRoads[key], { renderer, color: s.color, weight: s.reach * ROAD_GLOW_SCALE, opacity: 0.18, lineCap: 'round', lineJoin: 'round', interactive: false }));
    group.addLayer(L.polyline(area.reachRoads[key], { renderer, color: s.color, weight: s.reach, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }));
  });
}

// Công trình trong phạm vi phục vụ: vòng sáng màu theo loại (thấy được cả khi đang vẽ chấm canvas), icon DOM được giữ sáng, icon ngoài phạm vi mờ đi
function addInRangePoints(group, points, polygon, renderer, m) {
  const keys = new Set();
  points.forEach(p => {
    if (!turf.booleanPointInPolygon([Number(p.lng), Number(p.lat)], polygon)) return;
    const color = isApproved(p.status) ? (BUFFER_COLORS[layerType(p)] || SEL_ACCENT) : '#f87171';
    group.addLayer(L.circleMarker([p.lat, p.lng], { renderer, radius: 8, color, weight: 2, opacity: 1, fillColor: color, fillOpacity: 0.3, interactive: false }));
    keys.add(pointKey(p));
  });
  (m === planMap ? planRenderer : leftRenderer).highlight(keys);
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
  [map, planMap].forEach(m => m?.getContainer().classList.remove('sel-active'));
  leftRenderer.highlight(null);
  planRenderer.highlight(null);
}

// Công trình cấp đơn vị ở chỉ phục vụ trong phường của nó (QCVN 01:2026: đơn vị ở ⊂ phường/xã);
// cấp đô thị (kể cả THPT) phục vụ liên phường. Ranh rút gọn ~10 m cho nhẹ phép cắt và giữ vòng gửi máy chủ dưới giới hạn đỉnh.
const WARD_CLIP_TOLERANCE_DEG = 0.0001;
const wardClipCache = new Map();

function serviceClipFor(p, wardName) {
  if (p.type === '9-CSD' || layerType(p) === 'THPT' || isNetworkType(p.type)) return null;
  if (formatCapCongTrinhLabel(p.nhomHaTang || p.capCongTrinh) === 'Cấp đô thị') return null;
  const ward = wardName && (state.wardLabelsList || []).find(w => w.name === wardName);
  if (!ward || !ward.geometry) return null;
  if (!wardClipCache.has(ward.name)) {
    let feature = null;
    try {
      feature = turf.simplify(turf.feature(ward.geometry), { tolerance: WARD_CLIP_TOLERANCE_DEG, highQuality: true });
      feature.bbox = turf.bbox(feature);
    } catch (e) { /* ranh lỗi: không giới hạn */ }
    wardClipCache.set(ward.name, feature && { key: ward.name, feature, name: ward.name });
  }
  return wardClipCache.get(ward.name);
}

// Vùng phục vụ thực tế theo mạng đường + đường giao thông làm minh chứng, hiển thị kiểu âm bản.
// points: công trình đang hiển thị để làm nổi những công trình nằm trong phạm vi.
// clip: ranh phường giới hạn vùng phục vụ (serviceClipFor), null = không giới hạn.
// Trả về { area, polygon }: area = null khi không tải được đường (khi đó polygon là vòng tròn bán kính); null nếu đã có click khác.
// roads = false: chỉ vòng tròn bán kính (khoảng cách đường chim bay: PCCC, khoảng cách an toàn nghĩa trang) → { area: null, polygon, plain: true }
export async function highlightSingleIsochrone(lat, lng, radius, group = layers.singleIso, points = [], clip = null, roads = true) {
  clearSingleIsochrone();
  const seq = singleIsoSeq;
  const m = group === planLayers.singleIso ? planMap : map;
  if (!group || !m) return null;
  lat = Number(lat);
  lng = Number(lng);
  const renderer = selRendererFor(m);
  const circle = turf.circle([lng, lat], radius / 1000, { steps: SEL_RING_STEPS });
  const ring = circle.geometry.coordinates[0].map(([x, y]) => [y, x]);
  group.addLayer(L.polygon([WORLD_RING, ring], { renderer, stroke: false, fillColor: SEL_NAVY, fillOpacity: SEL_OUTER_OPACITY, interactive: false }));
  group.addLayer(L.polygon(ring, { renderer, color: '#7dd3fc', weight: 1.2, opacity: 0.85, dashArray: '4,5', fillColor: SEL_NAVY, fillOpacity: SEL_INNER_OPACITY, interactive: false }));
  if (clip) {
    group.addLayer(L.geoJSON(clip.feature, { interactive: false, renderer, style: { color: '#fbbf24', weight: 1.6, opacity: 0.9, dashArray: '6,4', fill: false } }));
  }
  group.addLayer(L.marker([lat, lng], { icon: L.divIcon({ className: 'sel-pulse', iconSize: [18, 18] }), interactive: false, keyboard: false, zIndexOffset: -1000 }));
  m.getContainer().classList.add('sel-active');
  if (!roads) {
    addInRangePoints(group, points, circle, renderer, m);
    return { area: null, polygon: circle, plain: true };
  }

  try {
    const area = await computeServiceArea(lat, lng, radius, clip);
    if (seq !== singleIsoSeq) return null;
    group.addLayer(L.geoJSON(area.polygon, {
      interactive: false,
      renderer,
      style: { color: SEL_ACCENT, weight: 1.8, opacity: 0.9, fillColor: SEL_ACCENT, fillOpacity: 0.07 }
    }));
    addRoadLayers(group, area, renderer);
    addInRangePoints(group, points, area.polygon, renderer, m);
    stopFlow = startFlowAnimation(m, group, area.flowPaths);
    return { area, polygon: area.polygon };
  } catch (err) {
    if (seq !== singleIsoSeq) return null;
    console.warn("Không dựng được vùng phục vụ theo mạng đường:", err);
    let polygon = circle;
    if (clip) {
      const inWard = turf.intersect(circle, clip.feature);
      if (inWard) {
        polygon = inWard.geometry.type === 'MultiPolygon'
          ? inWard.geometry.coordinates.map(c => turf.polygon([c[0]])).sort((a, b) => turf.area(b) - turf.area(a))[0]
          : inWard;
      }
    }
    group.addLayer(L.geoJSON(polygon, { renderer, interactive: false, style: { color: '#7dd3fc', weight: 1.2, dashArray: '3,3', fillColor: '#38bdf8', fillOpacity: 0.12 } }));
    addInRangePoints(group, points, polygon, renderer, m);
    return { area: null, polygon };
  }
}

// Gửi loại + diện tích để server giới hạn dân số phục vụ theo chỉ tiêu m²/người
async function fetchServedPop(p, radius, polygon) {
  const res = await fetch(geeApi('action=analyzePoint'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: Number(p.lat), lng: Number(p.lng), radius, polygon: polygon.geometry.coordinates[0],
      id: p.id || '', name: p.name || '', type: p.type || '', size: Number(p.size) || 0
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const QUOTA_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

// Đối chiếu dân trong phạm vi với số dân diện tích công trình đáp ứng theo chỉ tiêu m²/người
function servedQuotaHtml(res, size) {
  const quota = Number(res.quota) || 0;
  if (!(quota > 0)) return '';
  if (res.capacity == null) return `<div class="pp-sub">Chưa rõ diện tích nên chưa đối chiếu chỉ tiêu ${QUOTA_FORMAT.format(quota)} m²/người.</div>`;
  const formula = `${fmtNum(size)} m² ÷ ${QUOTA_FORMAT.format(quota)} m²/người = ${fmtNum(res.capacity)} người`;
  const reach = Number(res.reachPop) || 0;
  if (reach > res.capacity) {
    const lackArea = Math.ceil((reach - res.capacity) * quota);
    return `<div class="pp-sub pp-cap-warn">${ico('alert')}Phạm vi có ~${fmtNum(reach)} người nhưng quy mô chỉ đáp ứng theo chỉ tiêu: ${formula} (thiếu ~${fmtNum(lackArea)} m²).</div>`;
  }
  return `<div class="pp-sub">Quy mô theo chỉ tiêu đáp ứng tối đa: ${formula}.</div>`;
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
    html += ` <span class="pp-warn" title="Tên phường trong Sheet khác phường theo tọa độ — cần sửa cột Ten_XaPhuong">${ico('alert')}Sheet: ${escapeHtml(sheet || 'trống')}</span>`;
  }
  return html;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Nút con mắt cạnh nút đóng: thu popup về dòng tên để xem trọn vùng phục vụ (popup neo theo đáy nên mũi chỉ không đổi chỗ).
// Khi đang thu gọn, bấm ra bản đồ không đóng popup (đóng popup sẽ xóa luôn lớp vùng phục vụ / tuyến tiếp cận);
// chỉ nút × hoặc chọn công trình / điểm tra cứu khác mới đóng. Leaflet gắn việc đóng khi bấm bản đồ vào sự kiện preclick.
function addPopupCollapseToggle(popup) {
  const container = popup.getElement();
  const ownerMap = popup._map;
  if (!container || !ownerMap) return;
  const btn = L.DomUtil.create('a', 'pp-collapse-btn', container);
  btn.href = '#';
  btn.setAttribute('role', 'button');
  const render = (collapsed) => {
    btn.innerHTML = ico(collapsed ? 'eye' : 'eye-off');
    btn.title = collapsed ? 'Hiện bảng thông tin' : 'Ẩn bảng thông tin để xem toàn bộ vùng phục vụ';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(collapsed));
  };
  render(false);
  L.DomEvent.disableClickPropagation(btn);
  L.DomEvent.on(btn, 'click', (e) => {
    L.DomEvent.preventDefault(e);
    const collapsed = container.classList.toggle('pp-collapsed');
    render(collapsed);
    ownerMap.off('preclick', popup.close, popup);
    const closesOnClick = popup.options.closeOnClick ?? ownerMap.options.closePopupOnClick;
    if (!collapsed && closesOnClick) ownerMap.on('preclick', popup.close, popup);
  });
}

export function onPointClick(p, targetMap = map) {
  const approved = isApproved(p.status);
  const isCSD = p.type === "9-CSD";
  const isCSDUnapproved = isCSD && !approved;
  const itemRadius = effectiveRadius(p);
  const isPlanScenario = p.scenario === 'QH';
  const isNetwork = isNetworkType(p.type);
  const ntKind = p.type === '12-NT' ? ntKindOf(p) : null;
  // Nhà tang lễ không có khoảng cách an toàn; PCCC và nghĩa trang xét vòng tròn bán kính, trạm xe buýt theo đường đi bộ
  const noZone = !(itemRadius > 0);
  const roadArea = !(p.type === '11-PCCC' || p.type === '12-NT');

  // Chỉ để mở 1 popup công trình trên 2 bản đồ
  if (map) map.closePopup();
  if (planMap) planMap.closePopup();
  clearCsdProof();

  const groups = isPlanScenario ? planLayers : layers;
  const selType = layerType(p);
  const geoWardNow = resolveWardNameFromCoords(Number(p.lat), Number(p.lng));
  const clip = serviceClipFor(p, geoWardNow);
  const inViewPoints = isCSDUnapproved ? [] : getWardFilteredList(isPlanScenario ? getPlanScenarioList() : state.rawDataList)
    .filter(q => layerType(q) === selType && (q.type !== '9-CSD' || q === p) && hasValidCoord(q) && targetMap.hasLayer(groups[ICON_GROUP_KEYS[selType]]));
  if (noZone) clearSingleIsochrone();
  const areaPromise = isCSDUnapproved || noZone
    ? null
    : highlightSingleIsochrone(p.lat, p.lng, itemRadius, groups.singleIso, inViewPoints, clip, roadArea);
  const selSeq = singleIsoSeq;

  const capCongTrinh = formatCapCongTrinhLabel(p.nhomHaTang || p.capCongTrinh || "Cấp đơn vị ở");

  let html = `<div class="pp">`;
  html += `<div class="pp-title">${escapeHtml(p.name)}`;
  if (!approved) html += `<span class="badge-pending">Chờ duyệt</span>`;
  html += `</div>`;
  html += `<div class="pp-row"><span>Loại hạ tầng</span><b>${escapeHtml(infraLabels[layerType(p)] || p.type)}</b></div>`;
  if (ntKind) html += `<div class="pp-row"><span>Hình thức</span><b>${escapeHtml(NT_KIND_LABELS[ntKind] || '')}</b></div>`;
  html += `<div class="pp-row"><span>Địa bàn</span><b class="js-ward">${buildDiaBanHtml(geoWardNow, p.ward)}</b></div>`;
  if (!isNetwork) html += `<div class="pp-row"><span>Cấp công trình</span><b class="c-orange">${escapeHtml(capCongTrinh)}</b></div>`;
  const planInfo = PLAN_CHANGE_INFO[p.planChange];
  let sizeHtml = `${fmtNum(p.size)} m²`;
  if (planInfo) {
    const otherSize = isPlanScenario
      ? (p.planChange === 'new' ? '' : `, HT ${fmtNum(p.sizeHT)} m²`)
      : (p.planChange === 'relocate' ? '' : ` → QH ${fmtNum(p.sizeQH)} m²`);
    sizeHtml += ` <span class="pp-plan" style="color:${planInfo.color};">(${planInfo.label}${otherSize})</span>`;
  }
  if (!isNetwork || p.type === '12-NT' || Number(p.size) > 0) {
    if (ntKind && !(Number(p.size) > 0)) sizeHtml = 'chưa rõ';
    html += `<div class="pp-row"><span>Diện tích${isPlanScenario ? ' QH' : ''}</span><b>${sizeHtml}</b></div>`;
  }
  if (!isCSDUnapproved) {
    const radiusLabel = p.type === '10-BUS' ? 'Phạm vi đi bộ (Mục 2.8.3.3)'
      : p.type === '11-PCCC' ? 'Bán kính phục vụ (Mục 2.5.13.1)'
        : ntKind ? 'Khoảng cách an toàn (Bảng 23)' : 'Bán kính phục vụ';
    html += `<div class="pp-row"><span>${radiusLabel}</span><b class="c-cyan">${noZone ? 'không quy định' : `${fmtNum(itemRadius)} m`}</b></div>`;
    if (!noZone && roadArea) {
      html += `<div class="pp-row js-area"><span>Phạm vi thực tế</span><span class="pp-loading">${ico('clock')}đang dựng theo mạng đường...</span></div>`;
    }
  }

  const servedCls = approved ? 'c-orange' : 'c-red';
  const showServed = !isCSD && !noZone;
  const servedLabel = ntKind ? 'Dân số trong vùng cách ly' : `Dân số phục vụ${approved ? '' : ' dự kiến'}`;
  if (showServed) {
    html += `<div class="pp-row pp-served js-served"><span>${servedLabel}</span><span class="pp-loading">${ico('clock')}đang tính...</span></div>`;
  }
  if (isCSD && approved) {
    html += `<div class="pp-section c-orange">${ico('bulb')}ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG</div>`;
    html += `<div class="js-csd"><div class="pp-loading">${ico('clock')}Đang tính toán không gian...</div></div>`;
  }
  if (!approved) {
    html += state.currentUserRole === "ADMIN"
      ? `<button type="button" class="js-approve popup-approve-btn">${ico('check')}PHÊ DUYỆT CHÍNH THỨC (ADMIN)</button>`
      : `<div class="pp-note c-orange">${ico('clock')}Đang chờ Quản trị viên (Admin) phê duyệt.</div>`;
  }
  html += `</div>`;

  const popup = L.popup({ className: 'infra-popup', closeButton: true, autoPan: true, ...popupFitOptions(targetMap, 300, 50) }).setLatLng([p.lat, p.lng]).setContent(html);
  popup.openOn(targetMap);
  popup.getElement()?.querySelector('.js-approve')?.addEventListener('click', () => approvePointStatus(p.id));
  addPopupCollapseToggle(popup);
  // Đóng popup thì thoát chế độ âm bản (trừ khi đã chọn công trình khác / chuyển sang thuyết minh CSD)
  popup.on('remove', () => { if (singleIsoSeq === selSeq) clearSingleIsochrone(); });

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
      if (!r || r.plain) return;
      if (r.area) {
        const pct = Math.round(r.area.areaKm2 / r.area.circleKm2 * 100);
        fill('.js-area', `<span>Phạm vi thực tế</span><div><b class="c-green">${r.area.areaKm2.toFixed(2)} km²</b> <span class="pp-sub">(${pct}% vòng tròn, theo ${r.area.reachKm.toFixed(1)} km đường tiếp cận)</span>${roadLegendHtml(r.area)}</div>`);
      } else {
        fill('.js-area', `<span>Phạm vi thực tế</span><span class="pp-sub">máy chủ dữ liệu đường (OpenStreetMap) đang quá tải — tạm hiển thị vòng tròn bán kính, bấm lại công trình sau ít phút.</span>`);
      }
    });
  }

  if (showServed) {
    const scope = clip ? `, nội bộ ${escapeHtml(clip.name)}` : ', kể cả phường lân cận';
    // Bảng 23 áp dụng khi xây mới: nghĩa trang hiện hữu có dân trong vùng cách ly chỉ cảnh báo (đánh giá tác động môi trường)
    const ntNote = (n) => (!ntKind ? '' : n > 0
      ? `<div class="pp-sub pp-cap-warn">${ico('alert')}Có dân cư trong khoảng cách an toàn: nghĩa trang hiện hữu cần đánh giá tác động môi trường; xây mới phải bảo đảm khoảng cách theo Bảng 23.</div>`
      : `<div class="pp-sub">Không có dân cư trong khoảng cách an toàn.</div>`);
    Promise.resolve(areaPromise)
      .then(r => {
        const polygon = r ? r.polygon : turf.circle([Number(p.lng), Number(p.lat)], itemRadius / 1000, { steps: 64 });
        return fetchServedPop(p, itemRadius, polygon).then(res => ({ res, real: !!(r && r.area) }));
      })
      .then(({ res, real }) => fill('.js-served', `<span>${servedLabel}</span><div><b class="${ntKind && res.servedPop > 0 ? 'c-red' : servedCls}">~${fmtNum(res.servedPop || 0)} người</b> <span class="pp-sub">(${real ? 'trong phạm vi thực tế' : 'trong vòng tròn'}${scope})</span>${servedQuotaHtml(res, p.size)}${ntNote(res.servedPop || 0)}</div>`))
      .catch(() => fill('.js-served', `<span>${servedLabel}</span><span class="pp-sub">chưa tính được (GEE đang bận), mở lại sau.</span>`));
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
          const basisNote = s.basis === 'scale'
            ? `Bù thiếu quy mô: phường đạt <b class="c-red">${fmtNum(s.currentScalePct)}%</b> → <b class="c-green">${fmtNum(Math.min(100, s.currentScalePct + s.scaleAddPct))}%</b> (độ phủ không tăng)`
            : `Bổ sung <b class="c-green">${fmtNum(s.scaleAddPct)}%</b> quy mô, <b class="c-cyan">${fmtNum(s.coverageAddPct)}%</b> độ phủ${estimateNote}`
              + (s.capacityLimited ? `<br>Quy mô chỉ đáp ứng ~${fmtNum(s.capacity)} người (${QUOTA_FORMAT.format(s.quota)} m²/người)` : '');
          sugHtml += `<div class="${cls}"><div>${ico('flag')}<b>${escapeHtml(s.label)}</b> ${priorityBadge}</div>
            <div class="pp-sub">${basisNote}</div>
            <button type="button" class="proof-btn" data-idx="${idx}">${ico('book')}Xem thuyết minh</button></div>`;
        });
        (res.ineligible || []).forEach(inEl => {
          sugHtml += `<div class="sug-card ineligible">${ico('error')}<b>${escapeHtml(inEl.label)}</b> (Không đủ DT min: ${fmtNum(inEl.minSize)} m²)</div>`;
        });
        const base = sugHtml || `<div class="sug-card">${ico('check')}Vị trí đã phủ đủ hạ tầng.</div>`;
        fill('.js-csd', base + `<div class="pp-note c-red">(Cần phê duyệt)</div>`);
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
  // Công trình chỉ có ở quy hoạch: lấy bản ghi theo kịch bản QH (quy mô QH) và mở trên bản đồ quy hoạch nếu đang so sánh
  const item = state.rawDataList.find(near) || getPlanScenarioList().find(near);

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    if (item) {
      onPointClick(item, item.scenario === 'QH' && isCompareOn() && planMap ? planMap : map);
      return;
    }
    L.popup(popupFitOptions(map, 300, 50))
      .setLatLng([lat, lng])
      .setContent(`<div class="pp"><div class="pp-title">${escapeHtml(name)}</div><div class="pp-row"><span>Tọa độ</span><b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b></div></div>`)
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
      layers.pop.addLayer(L.tileLayer(data.urlFormat, { maxZoom: 19, opacity }));
      planLayers.pop.addLayer(L.tileLayer(data.urlFormat, { maxZoom: 19, opacity }));
      if (pv) popLayerPromise = Promise.resolve(true);
      return true;
    }
  } catch (err) {
    console.error("Lỗi tải lớp raster dân số:", err);
  }
  return false;
}

// Lớp dân cư mặc định tắt: chỉ gọi GEE lần đầu người dùng bật (lỗi thì lần bật sau thử lại)
let popLayerPromise = null;
export function ensurePopulationLayer() {
  if (!popLayerPromise) {
    popLayerPromise = loadPopulationLayer().then(ok => {
      if (!ok) popLayerPromise = null;
      return ok;
    });
  }
  return popLayerPromise;
}

// ============================ TRA CỨU TẠI VỊ TRÍ ============================

const ROUTE_CANDIDATES = 4;   // mỗi nhóm thử vài công trình gần nhất theo đường chim bay (gần nhất chưa chắc đi đường gần nhất)
const WALK_M_PER_MIN = 80;    // đi bộ ~4,8 km/h
const fmtDist = (m) => (m >= 1000 ? `${fmtNum(Math.round(m / 100) / 10)} km` : `${fmtNum(Math.round(m / 10) * 10)} m`);

// Ứng viên chỉ đường của mỗi nhóm: công trình đã duyệt gần nhất theo đường chim bay; nhóm Tiểu học không lấy trường THPT
function nearestByGroup(source, lat, lng) {
  const out = {};
  INFRA_CODES.forEach(code => { out[code] = []; });
  source.forEach(item => {
    if (!INFRA_CODES.includes(item.type) || !isApproved(item.status) || !hasValidCoord(item)) return;
    if (item.type === '4-TH' && layerType(item) !== '4-TH') return;
    const ilat = Number(item.lat), ilng = Number(item.lng);
    out[item.type].push({ lat: ilat, lng: ilng, ref: item, d: distanceMeters(lat, lng, ilat, ilng) });
  });
  INFRA_CODES.forEach(code => { out[code] = out[code].sort((a, b) => a.d - b.d).slice(0, ROUTE_CANDIDATES); });
  return out;
}

// Tuyến theo mạng giao thông từ vị trí tra cứu tới công trình gần nhất mỗi nhóm: nét màu theo nhóm, vòng sáng ở công trình,
// chấm sáng chạy từ vị trí về phía công trình (như khi click công trình); nhóm không nối được đường thì ghi khoảng cách chim bay
async function showAccessRoutes(lat, lng, m, cands, popup, seq) {
  const group = m === planMap ? planLayers.singleIso : layers.singleIso;
  const box = () => (popup.isOpen() ? popup.getElement()?.querySelector('.js-routes') : null);
  const codes = INFRA_CODES.filter(code => cands[code].length);
  if (!codes.length) {
    const el = box();
    if (el) el.innerHTML = `<div class="sug-card ineligible">(Chưa có công trình đã duyệt)</div>`;
    return;
  }
  let result = null, error = null;
  try { result = await computeAccessRoutes(lat, lng, cands); } catch (err) { error = err; }
  if (seq !== singleIsoSeq) return;

  const rows = codes.map(code => {
    const r = result && result.routes[code];
    return r ? { code, item: r.ref, distM: r.distM, path: r.path } : { code, item: cands[code][0].ref, airM: cands[code][0].d };
  }).sort((a, b) => (a.path ? 0 : 1e9) + (a.distM ?? a.airM) - ((b.path ? 0 : 1e9) + (b.distM ?? b.airM)));

  const renderer = selRendererFor(m);
  const routed = rows.filter(r => r.path);
  routed.slice().reverse().forEach(r => {          // tuyến ngắn nhất vẽ trên cùng
    const color = BUFFER_COLORS[r.code] || SEL_ACCENT;
    const line = { renderer, lineCap: 'round', lineJoin: 'round', interactive: false };
    group.addLayer(L.polyline(r.path, { ...line, color: '#020617', weight: 7, opacity: 0.5 }));
    group.addLayer(L.polyline(r.path, { ...line, color, weight: 3.2, opacity: 0.95 }));
    group.addLayer(L.circleMarker(r.path[r.path.length - 1], { renderer, radius: 9, color, weight: 2.5, fillColor: color, fillOpacity: 0.25, interactive: false }));
  });
  if (routed.length) stopFlow = startFlowAnimation(m, group, routed.map(r => r.path));

  const el = box();
  if (!el) return;
  let html = error ? `<div class="pp-note c-orange">${ico('alert')}Chưa tải được mạng đường (${escapeHtml(error.message)}) — tạm ghi khoảng cách đường chim bay.</div>` : '';
  html += rows.map((r, i) => {
    const dot = `<i class="route-dot" style="background:${BUFFER_COLORS[r.code] || SEL_ACCENT};"></i>`;
    const head = `${dot}<b>${escapeHtml(infraLabels[r.code] || r.code)}</b><div class="c-cyan">${escapeHtml(r.item.name || 'Công trình')}</div>`;
    if (!r.path) return `<div class="sug-card route-card ineligible">${head}<div>≈ ${fmtDist(r.airM)} đường chim bay (chưa nối được theo đường)</div></div>`;
    const radius = effectiveRadius(r.item);
    const over = r.distM > radius ? ` <span class="c-orange">· vượt bán kính ${fmtNum(radius)} m</span>` : '';
    return `<div class="sug-card route-card" data-route="${i}" title="Bấm để xem trọn tuyến">${head}
      <div>${fmtDist(r.distM)} theo đường · ~${Math.max(1, Math.round(r.distM / WALK_M_PER_MIN))} phút đi bộ${over}</div></div>`;
  }).join('');
  el.innerHTML = html;
  el.addEventListener('click', (e) => {
    const card = e.target.closest('[data-route]');
    const r = card && rows[Number(card.dataset.route)];
    if (r) m.fitBounds(L.latLngBounds(r.path), { padding: [50, 50], maxZoom: 17 });
  });
}

// Mạng lưới tại vị trí tra cứu (đường chim bay): trạm xe buýt ≤ 500 m (Mục 2.8.3.3), trụ sở PCCC ≤ 3 km phường / 5 km xã
// (Mục 2.5.13.1), vị trí nằm trong khoảng cách an toàn nghĩa trang / cơ sở hỏa táng (Bảng 23)
function networkInspectHtml(source, lat, lng, wardName) {
  const approvedOf = (type) => source.filter(it => it.type === type && isApproved(it.status) && hasValidCoord(it))
    .map(it => ({ it, d: distanceMeters(lat, lng, Number(it.lat), Number(it.lng)) }));
  const nearest = (list) => list.reduce((best, x) => (!best || x.d < best.d ? x : best), null);
  const row = (label, n, limit, ref) => {
    if (!n) return `<div class="sug-card ineligible"><b>${label}</b><div>(Chưa có dữ liệu đã duyệt)</div></div>`;
    const ok = n.d <= limit;
    return `<div class="sug-card${ok ? '' : ' ineligible'}">${ico(ok ? 'check' : 'error')}<b>${label}</b>
      <div class="c-cyan">${escapeHtml(n.it.name || 'Công trình')}</div>
      <div>${fmtDist(n.d)} đường chim bay · ${ok ? 'đạt' : 'vượt'} ${fmtDist(limit)} (${ref})</div></div>`;
  };
  const pcccLimit = /^xã\s/i.test(String(wardName || '').trim()) ? 5000 : 3000;
  let html = `<div class="pp-section c-orange">4. Mạng lưới hạ tầng khác</div>`;
  html += row('Trạm dừng xe buýt', nearest(approvedOf('10-BUS')), 500, 'Mục 2.8.3.3');
  html += row('Trụ sở cảnh sát PCCC', nearest(approvedOf('11-PCCC')), pcccLimit, 'Mục 2.5.13.1');
  const inside = approvedOf('12-NT').filter(x => Number(x.it.radius) > 0 && x.d <= Number(x.it.radius));
  html += inside.length
    ? inside.map(x => `<div class="sug-card ineligible">${ico('alert')}<b>Trong khoảng cách an toàn (Bảng 23)</b>
        <div class="c-cyan">${escapeHtml(x.it.name || 'Nghĩa trang')}</div>
        <div>${escapeHtml(NT_KIND_LABELS[ntKindOf(x.it)] || '')}: cách ${fmtDist(x.d)} &lt; ${fmtDist(Number(x.it.radius))}</div></div>`).join('')
    : `<div class="sug-card">${ico('check')}<b>Ngoài khoảng cách an toàn của nghĩa trang, cơ sở hỏa táng</b></div>`;
  return html;
}

// Buffer của mỗi công trình là vòng tròn bán kính R: điểm được phục vụ khi khoảng cách ≤ R.
// Tính trực tiếp trên toàn TP (không phụ thuộc phường đang lọc), dùng được cho cả bản đồ quy hoạch.
export function handleInspectPointClick(clickLat, clickLng, targetMap = map) {
  if (!targetMap) return;
  clearSingleIsochrone();
  const routeSeq = singleIsoSeq;
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

  let html = `<div class="pp">
    <div class="pp-title">${ico('chart')}MẬT ĐỘ HẠ TẦNG TẠI VỊ TRÍ${isPlan ? ' (QUY HOẠCH)' : ''}</div>
    <div class="pp-row"><span>Tọa độ</span><b>${clickLat.toFixed(5)}, ${clickLng.toFixed(5)}</b></div>
    <div class="pp-row"><span>Địa bàn</span><b class="js-ward">${wardLocal ? escapeHtml(wardLocal) : ico('clock')}</b></div>
    <div class="pp-row"><span>Bán kính</span><b class="c-green">${override !== null ? `${fmtNum(override)} m (chung)` : 'theo từng công trình'}</b></div>
    <div class="pp-section c-green">1. Tiếp cận: ${coveredCount}/8 nhóm</div>`;

  if (coveredCount > 0) {
    INFRA_CODES.forEach(code => {
      if (!coveredGroups[code]) return;
      const names = [...coveredGroups[code]];
      const shown = names.slice(0, 5).map(escapeHtml).join(', ') + (names.length > 5 ? ` và ${names.length - 5} công trình khác` : '');
      html += `<div class="sug-card"><b>${escapeHtml(infraLabels[code] || code)}</b><div class="c-cyan">${shown}</div></div>`;
    });
  } else {
    html += `<div class="sug-card ineligible">(Chưa có hạ tầng phủ đến)</div>`;
  }

  html += `<div class="pp-section c-red">2. Chưa tiếp cận: ${missingCodes.length}/8 nhóm</div>`;
  if (missingCodes.length > 0) {
    missingCodes.forEach(code => {
      html += `<div class="sug-card ineligible">${ico('error')}${escapeHtml(infraLabels[code] || code)}</div>`;
    });
  } else {
    html += `<div class="sug-card priority">${ico('check')}Vị trí tiếp cận đủ 8 nhóm hạ tầng!</div>`;
  }
  const routeCands = nearestByGroup(source, clickLat, clickLng);
  html += `<div class="pp-section c-cyan">3. Đường đi tới công trình gần nhất</div>
    <div class="js-routes"><div class="pp-loading">${ico('clock')}đang tìm đường theo mạng giao thông...</div></div>`;
  html += networkInspectHtml(source, clickLat, clickLng, wardLocal);
  html += `</div>`;

  const inspectPopup = L.popup({ className: 'inspect-popup', ...popupFitOptions(targetMap, 320, 240) })
    .setLatLng([clickLat, clickLng])
    .setContent(html)
    .openOn(targetMap);
  addPopupCollapseToggle(inspectPopup);
  inspectPopup.on('remove', () => { if (singleIsoSeq === routeSeq) clearSingleIsochrone(); });
  showAccessRoutes(clickLat, clickLng, targetMap, routeCands, inspectPopup, routeSeq);

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
    markDataWritten();
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
