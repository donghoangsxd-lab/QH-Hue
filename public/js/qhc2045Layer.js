// Lớp bản đồ đồ án QHC đô thị Thừa Thiên Huế 2045 (qhc2045.js) trên bản đồ quy hoạch, điều khiển ở panel Lớp dữ liệu:
//  - chk_qhc25: sơ đồ tổ chức không gian 1/25.000 toàn đô thị (vùng phát triển, mặt nước, cây xanh, ranh khu vực;
//    chú giải ở tab Chú giải, bộ QHC25 – tt16Symbols.js);
//  - chk_qhc10: sử dụng đất 1/10.000 khu vực trung tâm (lô theo ký hiệu TT16 Mục 02, viền theo giai đoạn) + 4 tiểu vùng,
//    phân khu, điểm chức năng. Hàng nút dưới dòng lớp bật/tắt độc lập từng giai đoạn lô và ranh 1/10.000 mở rộng theo
//    QĐ 756 (ranh ngoài các phường vùng lõi + vùng đỏ Hóa Châu, Mỹ Thượng chưa có trong đồ án cũ).
//    Đang xem QHC 1/10.000 (droplist) ở toàn thành phố: chỉ vẽ đường bao ngoài cả 4 quận + tên đồ án, rê chuột vào vùng lõi thì sáng nền,
//    bấm vào ranh mới vẽ lô. Đang xem một địa điểm (phường, đồ án, hoặc phóng gần): mở thẳng lô, không vẽ ranh.
//    Bật lớp khi xem cấp khác (so sánh) vẽ đủ lô ngay. Vùng đô thị trung tâm (hợp 4 tiểu vùng) luôn có nền và viền đỏ nhạt.
//  - Mạng lưới giao thông đường bộ, đường sắt cùng tỷ lệ (qhcRoads.js) vẽ kèm lô 1/10.000 / vùng 1/25.000, nút
//    "Mạng lưới giao thông" dưới mỗi lớp bật / tắt chung; 1/10.000 lọc theo nút giai đoạn như lô.
// Vùng, lô của cả ba lớp chung một canvas ở pane dưới lô đồ án QHPK (overlayPane 400); riêng các đường ranh vẽ ở LINE_PANE
// để nổi trên ranh 40 phường. Canvas mặc định của planMap (renderer: L.canvas())
// nằm ở overlayPane, phủ kín bản đồ khi có bất kỳ lớp vector nào và nuốt click của canvas QHC bên dưới, nên click lô / vùng
// được dò lại ở cấp bản đồ (qhcClick, gọi từ app.js) bằng bbox + point-in-polygon.
import { state } from './state.js';
import { map, wardNameAt, outerWardLines, openOutlinedPopup } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn, getViewMode, setViewMode, passToolClick } from './planMap.js';
import { escapeHtml, fmtNum, ico, WARD_PICK_EVENT } from './utils.js';
import { tt16SymbolStyle, tt16SwatchCss, TT16_STYLES, TT16_PATTERN_ZOOM, LOT_OPACITY_EVENT, getLotOpacity } from './tt16Symbols.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import { analyzeParcelZones, parcelZonesHtml } from './planLandStats.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { isLevelPair, sideOf, mapsForLevel, onSplitPair } from './splitPair.js';
import {
  QHC2045, CENTER_UNITS, ZONE_NAMES, STAGE_LAYERS, landOf, bareWard, isCoreWard,
  visionColor, visionLineStyle, WATER_KINDS, GREEN_COLOR
} from './qhc2045.js';
import { loadTraffic, trafficStyles, trafficRank, trafficPopupHtml, isRail } from './qhcRoads.js';

export { isCoreWard };

const PANE = ['qhcPane', 350];
// Ranh tiểu vùng, phân khu 1/10.000 và ranh mở rộng QĐ 756 nằm trên ranh 40 phường (overlayPane 400), dưới ranh đồ án
// QHPK (projectGlowPane 445) và viền phường đang chọn (448); không nhận click
const LINE_PANE = ['qhcLinePane', 420];
// Highlight vùng trung tâm cùng mặt với ranh QHC nhập (Phong Điền, Chân Mây ở overlayPane 400): nền phải nằm trên
// các ranh đó, nếu không bị che và trông như chỉ còn nét trắng từng quận
const WASH_PANE = ['qhcWashPane', 430];
// Mạng lưới giao thông (qhcRoads.js) nổi trên lô và ranh 40 phường; không nhận click (canvas phủ kín sẽ chặn lớp khác),
// click dò ở qhcClick theo khoảng cách tới tuyến
const ROAD_PANE = ['qhcRoadPane', 415];
const ROAD_HIT_PX = 6;
const LABEL_MIN_ZOOM = 14;
const TV_LABEL_MAX_ZOOM = 14;
const ROAD_BTN_TITLE = 'Mạng lưới giao thông đường bộ, đường sắt của đồ án: màu theo cấp đường, nét liền hiện trạng, nét đứt quy hoạch. Bấm một tuyến để xem tên, cấp, chiều dài và lộ giới theo mặt cắt';
const STAGES = [
  { id: '0', label: 'Hiện trạng' },
  { id: '1', label: 'Đến 2030' },
  { id: '2', label: 'Đến 2045' },
  { id: 'ext', label: 'Ranh QĐ756', title: 'Ranh 1/10.000 mở rộng theo hệ thống đô thị Quyết định 756/QĐ-UBND: ranh ngoài các phường, xã vùng lõi. Vùng đỏ: phần Hóa Châu, Mỹ Thượng chưa có trong đồ án cũ, đang điều chỉnh bổ sung' }
];
const STAGE_NAMES = ['Hiện trạng', 'Ngắn hạn đến 2030', 'Dài hạn đến 2045'];
const MISSING_STYLE = { color: '#ef4444', weight: 2.2, dashArray: '8 5', fillColor: '#ef4444', fillOpacity: 0.28, interactive: true };
const EXT_LINE = { color: '#f43f5e', weight: 3, opacity: 1, dashArray: '12 6' };
const EXT_HALO = { color: '#0f172a', weight: 6.5, opacity: 0.55 };
// Mở lô TTHuế 2045 (bấm vào ranh khi đang xem QHC 1/10.000): viewFlow.js bỏ đồ án QHC nhập đang chọn
export const QHC_CORE_EVENT = 'qh:qhc-core-open';
// Cùng cách ranh QHC nhập (OUTLINE_QHC): viền liền đậm, nền màu đồ án. Đỏ nhạt; nền chỉ khi đang thu gọn (chưa mở lô)
const CORE_WASH = '#f87171';
const WASH_FILL = 0.2;

// Mã 31 "Mặt nước ven biển": một khối biển ~55.000 ha phủ kín góc bản đồ, không mang thông tin sử dụng đất
const SEA_CODE = 31;

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
const centerSet = new Set(CENTER_UNITS.map(bareWard));

const data = { land: null, frame: null, vision: null };
const loading = {};
// Mỗi bản đồ một bộ lớp: so sánh cấp độ có thể vẽ 1/25.000 một bên và 1/10.000 bên kia
const bags = new WeakMap();
const bagList = [];
let active = null;
const layers = new Proxy({}, {
  get(_t, key) { return active ? active.layers[key] : undefined; },
  set(_t, key, value) { if (active) active.layers[key] = value; return true; }
});
function use(m) {
  if (!m) return active;
  let b = bags.get(m);
  if (!b) {
    b = {
      m, renderer: null, lineRenderer: null, washRenderer: null, roadRenderer: null, coreHover: false,
      layers: { land: null, frame: null, vision: null, ext: null, core: null, wash: null, hover: null, road10: null, road25: null }
    };
    bags.set(m, b);
    bagList.push(b);
  }
  active = b;
  return b;
}
let coreUnion = null;
const shownStages = new Set([0, 1, 2]);
let extOn = false;
let detailed = false;
let coreOpen = false;
let roadsOn = true;
const roadData = { 10: null, 25: null };
// Đang xem một địa điểm rồi chuyển sang QHC 1/25.000 hoặc 1/10.000: chỉ lô / vùng chức năng, không ranh tổng
let placeLots = false;
const collapsed = () => !isLevelPair() && getLevel() === 'qhc10' && !coreOpen && !placeLots;
const qhcOn = (m, id, chk) => (isLevelPair() ? sideOf(m) === id : !!$(chk)?.checked && m === target());
const tvFeatures = () => (data.frame ? data.frame.features.filter(f => f.properties.k === 'tv') : []);

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

function ensureRenderer(m) {
  const b = use(m);
  if (b.renderer) return b.renderer;
  const pane = m.getPane(PANE[0]) || m.createPane(PANE[0]);
  pane.style.zIndex = PANE[1];
  b.renderer = L.canvas({ pane: PANE[0], padding: 0.3 });
  return b.renderer;
}

function ensureLineRenderer(m) {
  const b = use(m);
  if (b.lineRenderer) return b.lineRenderer;
  const pane = m.getPane(LINE_PANE[0]) || m.createPane(LINE_PANE[0]);
  pane.style.zIndex = LINE_PANE[1];
  pane.style.pointerEvents = 'none';
  b.lineRenderer = L.canvas({ pane: LINE_PANE[0], padding: 0.3 });
  return b.lineRenderer;
}

function ensureWashRenderer(m) {
  const b = use(m);
  if (b.washRenderer) return b.washRenderer;
  const pane = m.getPane(WASH_PANE[0]) || m.createPane(WASH_PANE[0]);
  pane.style.zIndex = WASH_PANE[1];
  pane.style.pointerEvents = 'none';
  b.washRenderer = L.canvas({ pane: WASH_PANE[0], padding: 0.3 });
  return b.washRenderer;
}

function ensureRoadRenderer(m) {
  const b = use(m);
  if (b.roadRenderer) return b.roadRenderer;
  const pane = m.getPane(ROAD_PANE[0]) || m.createPane(ROAD_PANE[0]);
  pane.style.zIndex = ROAD_PANE[1];
  pane.style.pointerEvents = 'none';
  b.roadRenderer = L.canvas({ pane: ROAD_PANE[0], padding: 0.3 });
  return b.roadRenderer;
}

function qhcHosts(id, on) {
  if (isLevelPair()) return mapsForLevel(id) || [];
  return on && target() ? [target()] : [];
}

// Giao thông đi kèm lớp nền cùng tỷ lệ: gỡ lô thì gỡ đường 1/10.000, gỡ vùng thì gỡ đường 1/25.000
const ROAD_OF = { land: 'road10', vision: 'road25' };

function clearQhc(m, keys) {
  const b = use(m);
  keys.flatMap(k => (ROAD_OF[k] ? [k, ROAD_OF[k]] : [k])).forEach(k => {
    const layer = b.layers[k];
    if (k === 'frame') {
      layer?.tvLabels?.remove();
      layer?.points?.remove();
    }
    layer?.remove();
    b.layers[k] = null;
  });
  b.coreHover = false;
}

/** Thứ tự vẽ trong canvas lô: định hướng 1/25.000 < lô; đường bao ngoài vùng trung tâm nổi ở LINE_PANE */
function restack() {
  layers.vision?.bringToBack();
  layers.land?.bringToFront();
  layers.frame?.bringToFront();
  layers.frame?.points?.bringToFront();
  layers.ext?.bringToFront();
}

// ---------- 1/10.000: lô sử dụng đất ----------
function lotStyle(f) {
  const p = f.properties;
  const land = landOf(data.land.zones[p.z], p.c);
  return tt16SymbolStyle(land.key, land.tone, STAGE_LAYERS[p.t], { scenario: 'QH', detailed });
}

function drawLand() {
  const m = active.m;
  layers.land?.remove();
  layers.land = L.geoJSON(data.land, {
    pane: PANE[0],
    renderer: ensureRenderer(m),
    bubblingMouseEvents: false,
    filter: (f) => f.properties.c !== SEA_CODE && shownStages.has(f.properties.t),
    style: lotStyle
  }).on('click', (e) => { if (!passToolClick(m, e)) openLotPopup(e.layer.feature, e.latlng); });
  layers.land.addTo(m);
  restack();
  drawRoads('10');
}

function dropLand() {
  layers.land?.remove();
  layers.land = null;
  dropRoads('10');
}

// ---------- Mạng lưới giao thông (qhcRoads.js) ----------
function dropRoads(scale) {
  layers[`road${scale}`]?.remove();
  layers[`road${scale}`] = null;
}

/** Vẽ giao thông tỷ lệ scale lên bản đồ đang chọn (use). 1/10.000 lọc theo nút giai đoạn như lô; đường sắt 1/10.000 không ghi giai đoạn */
function drawRoads(scale) {
  dropRoads(scale);
  const fc = roadData[scale];
  const m = active?.m;
  if (!roadsOn || !fc || !m) return;
  const feats = fc.features
    .filter(f => scale !== '10' || f.properties.t == null || shownStages.has(f.properties.t))
    .sort((a, b) => trafficRank(a) - trafficRank(b));
  const r = ensureRoadRenderer(m);
  const pass = (list, i) => L.geoJSON({ type: 'FeatureCollection', features: list }, {
    pane: ROAD_PANE[0], renderer: r, interactive: false, style: (f) => trafficStyles(f)[i]
  });
  const roads = feats.filter(f => !isRail(f));
  const rails = feats.filter(isRail);
  const group = L.featureGroup([pass(roads, 0), pass(roads, 1), pass(rails, 0), pass(rails, 1)]);
  group.feats = feats;
  layers[`road${scale}`] = group.addTo(m);
}

function redrawRoads() {
  bagList.forEach(b => {
    use(b.m);
    if (b.layers.land) drawRoads('10'); else dropRoads('10');
    if (b.layers.vision) drawRoads('25'); else dropRoads('25');
  });
}

const loadRoads = (scale) => loadTraffic(scale)
  .then(fc => { roadData[scale] = fc; })
  .catch(err => { console.warn(`QHC 2045 – không tải được giao thông 1/${scale}.000:`, err); });

/** Tuyến gần điểm bấm nhất trong ROAD_HIT_PX điểm ảnh (canvas giao thông không nhận click) */
function roadAt(m, layer, latlng) {
  if (!layer || !m.hasLayer(layer)) return null;
  const p = m.latLngToLayerPoint(latlng);
  const corner = m.layerPointToLatLng(p.add([ROAD_HIT_PX, ROAD_HIT_PX]));
  const dLng = Math.abs(corner.lng - latlng.lng);
  const dLat = Math.abs(corner.lat - latlng.lat);
  let best = null;
  let bestD = ROAD_HIT_PX;
  layer.feats.forEach(f => {
    let b = bboxes.get(f);
    if (!b) { b = turf.bbox(f); bboxes.set(f, b); }
    if (latlng.lng < b[0] - dLng || latlng.lng > b[2] + dLng || latlng.lat < b[1] - dLat || latlng.lat > b[3] + dLat) return;
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    parts.forEach(line => {
      let prev = null;
      line.forEach(([x, y]) => {
        const cur = m.latLngToLayerPoint([y, x]);
        if (prev) {
          const d = L.LineUtil.pointToSegmentDistance(p, prev, cur);
          if (d <= bestD) { best = f; bestD = d; }
        }
        prev = cur;
      });
    });
  });
  return best;
}

function openRoadPopup(f, scale, latlng) {
  const html = trafficPopupHtml(f, scale, wardNameAt(latlng.lat, latlng.lng));
  openOutlinedPopup(active?.m || target(), f.geometry, L.popup({ maxWidth: 320, className: 'qhc-popup' }).setContent(html), latlng);
}

const VISION_FILL = 0.5;
const VISION_WATER = 0.65;
const VISION_SEA = 0.25;
const VISION_GREEN = 0.6;
const visionZoneName = (f) => data.vision?.cats?.zones?.[f.properties.k] || 'Khác';
function visionFillStyle(f) {
  const c = visionColor(visionZoneName(f));
  return { color: c, weight: 0.5, opacity: 0.8, fillColor: c, fillOpacity: VISION_FILL * getLotOpacity() };
}
function visionWaterStyle(f) {
  const c = (WATER_KINDS[f.properties.k] || WATER_KINDS[0]).color;
  const base = f.properties.k === 2 ? VISION_SEA : VISION_WATER;
  return { color: c, weight: 0.4, fillColor: c, fillOpacity: base * getLotOpacity() };
}
function visionGreenStyle() {
  return { color: GREEN_COLOR, weight: 0.4, fillColor: GREEN_COLOR, fillOpacity: VISION_GREEN * getLotOpacity() };
}

function restyleLand() {
  bagList.forEach(b => {
    if (b.layers.land) b.layers.land.setStyle(lotStyle);
    const v = b.layers.vision;
    if (!v) return;
    v.fillsLayer?.setStyle(visionFillStyle);
    v.waterLayer?.setStyle(visionWaterStyle);
    v.greenLayer?.setStyle(visionGreenStyle());
  });
}

function frameLabel(text, cls) {
  return L.divIcon({ className: 'qhc-label-icon', html: `<span class="qhc-label ${cls}">${text}</span>`, iconSize: [0, 0] });
}

function drawFrame() {
  const m = active.m;
  layers.frame?.remove();
  const r = ensureRenderer(m);
  const lr = ensureLineRenderer(m);
  const lines = L.featureGroup();
  const tvLabels = L.layerGroup();
  const ptLayer = L.featureGroup();
  const outer = unionTv();
  if (outer) {
    const lineOpts = { pane: LINE_PANE[0], renderer: lr, interactive: false };
    L.geoJSON(outer, { ...lineOpts, style: { color: '#0f172a', weight: 5, opacity: 0.45, fill: false } }).addTo(lines);
    L.geoJSON(outer, { ...lineOpts, style: { color: '#f8fafc', weight: 2.4, opacity: 0.95, dashArray: '12 6', fill: false } }).addTo(lines);
  }
  data.frame.features.forEach(f => {
    const p = f.properties;
    if (p.k === 'tv') {
      const c = turf.pointOnFeature(f).geometry.coordinates;
      L.marker([c[1], c[0]], { icon: frameLabel(`<b>${escapeHtml(p.tv)}</b> ${escapeHtml(p.ten)}`, 'qhc-label-tv'), interactive: false, keyboard: false }).addTo(tvLabels);
    } else if (p.k === 'pk') {
      L.geoJSON(f, { pane: LINE_PANE[0], renderer: lr, interactive: false, style: { color: '#e2e8f0', weight: 1.1, opacity: 0.7, dashArray: '3 4', fill: false } }).addTo(lines);
    } else if (p.k === 'd') {
      const [lng, lat] = f.geometry.coordinates;
      L.circleMarker([lat, lng], { pane: PANE[0], renderer: r, radius: 3.5, color: '#0f172a', weight: 1, fillColor: p.t ? '#fb923c' : '#f8fafc', fillOpacity: 1 })
        .bindTooltip(`${escapeHtml(p.n)} · ${STAGE_NAMES[p.t] || ''}`, { direction: 'top', className: 'ua-tip', opacity: 1 })
        .addTo(ptLayer);
    }
  });
  layers.frame = L.featureGroup([lines]);
  layers.frame.tvLabels = tvLabels;
  layers.frame.points = ptLayer;
  layers.frame.addTo(m);
  zoomFrame();
  restack();
}

function zoomFrame() {
  const m = active.m;
  if (!layers.frame || !m.hasLayer(layers.frame)) return;
  const z = m.getZoom();
  const { tvLabels, points } = layers.frame;
  if (z <= TV_LABEL_MAX_ZOOM) tvLabels.addTo(m); else tvLabels.remove();
  if (z >= LABEL_MIN_ZOOM) { points.addTo(m); points.bringToFront(); } else points.remove();
}

// Bỏ các vòng lỗ. Ranh 4 quận không khít nhau nên hợp xong còn hàng trăm khe nhỏ; viền bám theo khe thành nét lỗi giữa các quận.
function dropHoles(feature) {
  const g = feature?.geometry;
  if (!g) return feature;
  const props = feature.properties || {};
  if (g.type === 'Polygon') return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [g.coordinates[0]] } };
  if (g.type === 'MultiPolygon') {
    return { type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: g.coordinates.map(rings => [rings[0]]) } };
  }
  return feature;
}

// Hợp 4 tiểu vùng thành một đường bao ngoài. turf 6.5 lỗi "output ring" khi tọa độ lệch số lẻ: làm tròn rồi thử lại
function unionTv() {
  if (coreUnion) return coreUnion;
  const tv = tvFeatures();
  if (!tv.length) return null;
  let acc = tv[0];
  for (let i = 1; i < tv.length; i++) {
    try { acc = turf.union(acc, tv[i]) || acc; }
    catch (e) {
      try { acc = turf.union(turf.truncate(acc, { precision: 5 }), turf.truncate(tv[i], { precision: 5 })) || acc; }
      catch (err) { /* giữ phần đã gộp */ }
    }
  }
  coreUnion = dropHoles(acc);
  return coreUnion;
}

// Nền + viền đỏ nhạt của vùng trung tâm. Tách khỏi layers.core để click thu gọn vẫn mở lô.
// fillRule nonzero: evenodd mặc định khoét lỗ khi hợp 4 quận, giữa vùng không còn nền như các QHC khác
function clearCoreHover() {
  layers.hover?.remove();
  layers.hover = null;
  if (active) active.coreHover = false;
}

function setCoreHover(on) {
  on = !!on && collapsed();
  if (!active || active.coreHover === on) return;
  active.coreHover = on;
  layers.hover?.remove();
  layers.hover = null;
  if (!on) return;
  const shape = unionTv();
  const m = active.m;
  if (!shape || !m) return;
  layers.hover = L.geoJSON(shape, {
    pane: WASH_PANE[0],
    renderer: ensureWashRenderer(m),
    interactive: false,
    style: {
      color: '#ffffff', weight: 5.5, opacity: 1, fill: true, fillColor: CORE_WASH, fillOpacity: 0.42,
      fillRule: 'nonzero', lineJoin: 'round'
    }
  }).addTo(m);
}

function bindCoreHover(m) {
  if (!m || m._qhcCoreHover) return;
  m._qhcCoreHover = true;
  let raf = 0;
  let ev = null;
  m.getContainer().addEventListener('mousemove', (e) => {
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!ev || !collapsed() || !qhcOn(m, 'qhc10', 'chk_qhc10')) { use(m); setCoreHover(false); return; }
      use(m);
      const ll = m.mouseEventToLatLng(ev);
      const shape = unionTv();
      let inside = false;
      if (shape && ll) {
        try { inside = turf.booleanPointInPolygon([ll.lng, ll.lat], shape); } catch (err) { inside = false; }
      }
      setCoreHover(inside);
    });
  });
  m.getContainer().addEventListener('mouseleave', () => { use(m); setCoreHover(false); });
}

function drawWash() {
  layers.wash?.remove();
  layers.wash = null;
  clearCoreHover();
  const m = active?.m;
  if (!m || (placeLots && !isLevelPair())) return;
  if (!qhcOn(m, 'qhc10', 'chk_qhc10')) return;
  const shape = unionTv();
  if (!shape) return;
  layers.wash = L.geoJSON(shape, {
    pane: WASH_PANE[0],
    renderer: ensureWashRenderer(m),
    interactive: false,
    style: {
      color: CORE_WASH, weight: 2.8, opacity: 1, dashArray: null, lineJoin: 'round',
      fill: true, fillColor: CORE_WASH, fillOpacity: collapsed() ? WASH_FILL : 0, fillRule: 'nonzero'
    }
  }).addTo(m);
}

// Thu gọn: nhãn tên đồ án ở mép trên (nhãn A1–A4 nằm giữa tiểu vùng). Nền vùng trung tâm là layers.wash
function drawCore() {
  layers.core?.remove();
  layers.core = null;
  const tv = tvFeatures();
  if (!collapsed() || !tv.length || !qhcOn(active?.m, 'qhc10', 'chk_qhc10')) return;
  const m = active.m;
  const fc = { type: 'FeatureCollection', features: tv };
  const group = L.featureGroup();
  const [w, , e, n] = turf.bbox(fc);
  const icon = L.divIcon({
    className: 'project-label', iconSize: null,
    html: `<span title="Bấm vào ranh để xem lô sử dụng đất"><i style="background:${CORE_WASH}"></i>${escapeHtml(QHC2045.short)}</span>`
  });
  L.marker([n, (w + e) / 2], { icon, interactive: false, keyboard: false }).addTo(group);
  layers.core = group.addTo(m);
}

function applyCore() {
  const m = target();
  if (!m) return;
  use(m);
  if (!qhcOn(m, 'qhc10', 'chk_qhc10') || !data.land) return;
  if (collapsed()) dropLand();
  else if (!layers.land) drawLand();
  if (placeLots) {
    layers.frame?.remove();
    layers.core?.remove();
    layers.frame = layers.core = null;
    clearCoreHover();
    layers.wash?.remove();
    layers.wash = null;
    return;
  }
  if (!layers.frame && data.frame) drawFrame();
  drawWash();
  drawCore();
}

/** true: đang xem một địa điểm — QHC 1/10.000 chỉ vẽ lô, QHC 1/25.000 bỏ các nét ranh */
export function setQhcPlaceMode(on) {
  placeLots = !!on;
  if (isLevelPair()) { syncQhc(); return; }
  if (!placeLots) return;
  const m = target();
  if (!m) return;
  use(m);
  if (getLevel() === 'qhc25' && layers.vision) drawVision();
  if (getLevel() === 'qhc10') applyCore();
}

/** Mở / thu gọn lô TTHuế 2045 khi đang xem QHC 1/10.000 */
export function setCoreOpen(on) {
  if (coreOpen === on) return;
  coreOpen = on;
  applyCore();
}

export const isCoreOpen = () => coreOpen && getLevel() === 'qhc10';

/** Điểm latlng nằm trong ranh 4 tiểu vùng TTHuế 2045 */
export const coreContains = (latlng) => !!latlng && !!featureAt(tvFeatures(), latlng.lng, latlng.lat);

/** Ranh 4 tiểu vùng TTHuế 2045 (phạm vi đã có QHC 1/10.000), tải nếu chưa có */
export const coreFrame = () => load('frame').then(tvFeatures);

let landGen = 0;
async function setLand(on) {
  const gen = ++landGen;
  const maps = qhcHosts('qhc10', on);
  const both = [map, planMap].filter(Boolean);
  if (!maps.length) {
    both.forEach(m => clearQhc(m, ['land', 'core', 'wash', 'hover', 'frame', 'ext']));
    setHint('qhc10Hint', 'Trung tâm');
    return;
  }
  setHint('qhc10Hint', 'đang tải…');
  await Promise.resolve();
  try {
    await Promise.all([load('land'), loadRoads('10'), ...((placeLots && !isLevelPair()) ? [] : [load('frame')])]);
  } catch (err) {
    console.warn('QHC 2045 – không tải được lớp 1/10.000:', err);
    setHint('qhc10Hint', 'lỗi tải');
    return;
  }
  if (gen !== landGen) return;
  const now = qhcHosts('qhc10', !!$('chk_qhc10')?.checked);
  both.forEach(m => { if (!now.includes(m)) clearQhc(m, ['land', 'core', 'wash', 'hover', 'frame']); });
  now.forEach(m => {
    use(m);
    detailed = m.getZoom() >= TT16_PATTERN_ZOOM;
    if (!collapsed()) drawLand();
    else dropLand();
    if (placeLots && !isLevelPair()) {
      layers.frame?.tvLabels?.remove();
      layers.frame?.points?.remove();
      layers.frame?.remove();
      layers.core?.remove();
      layers.frame = layers.core = null;
      clearCoreHover();
      layers.wash?.remove();
      layers.wash = null;
      return;
    }
    if (data.frame) drawFrame();
    drawWash();
    drawCore();
  });
  setHint('qhc10Hint', 'Trung tâm');
}

// ---------- Ranh 1/10.000 mở rộng theo QĐ 756 ----------
const extVisible = () => extOn && (isLevelPair() || !!$('chk_qhc10')?.checked);

let extGen = 0;
async function setExt(on) {
  const gen = ++extGen;
  const both = [map, planMap].filter(Boolean);
  both.forEach(m => { use(m); layers.ext?.remove(); layers.ext = null; });
  if (!on) return;
  try {
    await load('frame');
  } catch (err) {
    console.warn('QHC 2045 – không tải được ranh điều chỉnh:', err);
    return;
  }
  if (gen !== extGen || !extOn) return;
  const maps = qhcHosts('qhc10', !!$('chk_qhc10')?.checked);
  const wards = (state.wardLabelsList || []).filter(w => w.geometry && isCoreWard(w.name));
  if (!wards.length || !data.frame) return;
  maps.forEach(m => {
    use(m);
    const r = ensureRenderer(m);
    const group = L.featureGroup();
    data.frame.features.filter(f => f.properties.k === 'dc').forEach(f => {
      const p = f.properties;
      L.geoJSON(f, { pane: PANE[0], renderer: r, style: MISSING_STYLE })
        .bindTooltip(`<b>Đang điều chỉnh</b> · ${escapeHtml(p.n)} (~${fmtNum(p.a)} ha)<br><span class="ua-tip-muted">Chưa có trong ${escapeHtml(QHC2045.short)}; bổ sung vào phạm vi 1/10.000 theo QĐ 756 khi điều chỉnh QHC thành phố Huế.</span>`,
          { sticky: true, className: 'ua-tip', opacity: 1 })
        .addTo(group);
      const c = turf.pointOnFeature(f).geometry.coordinates;
      L.marker([c[1], c[0]], { icon: frameLabel(`Đang điều chỉnh<br>Bổ sung ${escapeHtml(p.n)}`, 'qhc-label-dc'), interactive: false, keyboard: false }).addTo(group);
    });
    const lines = outerWardLines(wards);
    const lr = ensureLineRenderer(m);
    L.polyline(lines, { pane: LINE_PANE[0], renderer: lr, interactive: false, ...EXT_HALO }).addTo(group);
    L.polyline(lines, { pane: LINE_PANE[0], renderer: lr, interactive: false, ...EXT_LINE }).addTo(group);
    layers.ext = group.addTo(m);
    restack();
  });
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
  openOutlinedPopup(active?.m || target(), f.geometry, L.popup({ maxWidth: 320, className: 'qhc-popup' }).setContent(html), latlng);
}

// ---------- 1/25.000: sơ đồ tổ chức không gian ----------
function drawVision() {
  const m = active.m;
  layers.vision?.remove();
  const r = ensureRenderer(m);
  const cats = data.vision.cats;
  const fills = [], waters = [], greens = [], lines = [];
  data.vision.features.forEach(f => {
    const L_ = f.properties.L;
    if (L_ === 'v') fills.push(f);
    else if (L_ === 'n' && f.properties.k !== 2) waters.push(f);
    else if (L_ === 'x') greens.push(f);
    else if (L_ === 'r' && !(placeLots && !isLevelPair())) lines.push(f);
  });
  const fillLayer = L.geoJSON({ type: 'FeatureCollection', features: fills }, {
    pane: PANE[0], renderer: r, bubblingMouseEvents: false,
    style: visionFillStyle
  }).on('click', (e) => { if (!passToolClick(m, e)) openVisionPopup(e.layer.feature, e.latlng); });
  const waterLayer = L.geoJSON({ type: 'FeatureCollection', features: waters }, {
    pane: PANE[0], renderer: r, interactive: false,
    style: visionWaterStyle
  });
  const greenLayer = L.geoJSON({ type: 'FeatureCollection', features: greens }, {
    pane: PANE[0], renderer: r, interactive: false,
    style: visionGreenStyle
  });
  const lineLayer = L.geoJSON({ type: 'FeatureCollection', features: lines }, {
    pane: PANE[0], renderer: r,
    style: (f) => ({ ...visionLineStyle(cats.lines[f.properties.k]), opacity: 0.95 }),
    onEachFeature: (f, l) => {
      const note = cats.lineNotes[f.properties.g];
      l.bindTooltip(`<b>${escapeHtml(cats.lines[f.properties.k] || 'Ranh giới')}</b>${note ? `<br><span class="ua-tip-muted">${escapeHtml(note)}…</span>` : ''}`,
        { sticky: true, className: 'ua-tip', opacity: 1 });
    }
  });
  layers.vision = L.featureGroup([fillLayer, waterLayer, greenLayer, lineLayer]);
  layers.vision.fills = fills;
  layers.vision.fillsLayer = fillLayer;
  layers.vision.waterLayer = waterLayer;
  layers.vision.greenLayer = greenLayer;
  layers.vision.addTo(m);
  restack();
  drawRoads('25');
}

function openVisionPopup(f, latlng) {
  const cats = data.vision.cats;
  const zone = cats.zones[f.properties.k] || 'Khác';
  const desc = cats.funcs[f.properties.f] || '';
  const html = `<div class="qhc-pop">
      <div class="qhc-pop-head"><i class="qhc-sw" style="background:${visionColor(zone)}"></i><b>${escapeHtml(zone)}</b></div>
      ${f.properties.n ? `<div>${escapeHtml(f.properties.n)}</div>` : ''}
      ${desc ? `<p class="qhc-pop-desc">${escapeHtml(desc)}</p>` : ''}
      <div class="qhc-pop-src">${escapeHtml(QHC2045.short)} · Sơ đồ tổ chức không gian 1/25.000 · <span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></div>
    </div>`;
  openOutlinedPopup(active?.m || target(), f.geometry, L.popup({ maxWidth: 320, className: 'qhc-popup' }).setContent(html), latlng);
}

// ---------- Click cấp bản đồ ----------
const bboxes = new WeakMap();

/** Đối tượng vẽ sau (nằm trên) chứa điểm [lng, lat] */
function featureAt(features, lng, lat) {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f || !f.geometry) continue;
    let b = bboxes.get(f);
    if (!b) { b = turf.bbox(f); bboxes.set(f, b); }
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    try { if (turf.booleanPointInPolygon([lng, lat], f)) return f; } catch (err) { /* hình học lỗi */ }
  }
  return null;
}

/** Click nền bản đồ m (không bật công cụ): mở popup lô 1/10.000 hoặc vùng 1/25.000 tại điểm bấm. → true khi đã mở */
export function qhcClick(e, m) {
  if (!m || !e?.latlng) return false;
  if (!isLevelPair() && m !== target()) return false;
  if (isLevelPair() && sideOf(m) !== 'qhc10' && sideOf(m) !== 'qhc25') return false;
  use(m);
  const { lat, lng } = e.latlng;
  if (layers.core && m.hasLayer(layers.core) && featureAt(tvFeatures(), lng, lat)) {
    setCoreOpen(true);
    document.dispatchEvent(new CustomEvent(QHC_CORE_EVENT));
    return true;
  }
  for (const scale of ['10', '25']) {
    const f = roadAt(m, layers[`road${scale}`], e.latlng);
    if (f) { openRoadPopup(f, scale, e.latlng); return true; }
  }
  if (layers.land && m.hasLayer(layers.land)) {
    const f = featureAt(layers.land.getLayers().map(l => l.feature), lng, lat);
    if (f) { openLotPopup(f, e.latlng); return true; }
  }
  if (layers.vision && m.hasLayer(layers.vision)) {
    const f = featureAt(layers.vision.fills, lng, lat);
    if (f) { openVisionPopup(f, e.latlng); return true; }
  }
  return false;
}

// ---------- Thửa địa chính (cadastreLayer): đối chiếu QHC dù lớp / giai đoạn đang tắt ----------
async function parcelVisionHtml(geometry, recorded) {
  const v = await load('vision');
  const cats = v.cats;
  const res = analyzeParcelZones(geometry, v.features.filter(f => f.properties.L === 'v'), (f) => {
    const zone = cats.zones[f.properties.k] || 'Khác';
    const name = f.properties.n || zone;
    return { label: zone, color: visionColor(zone), key: '', name, sub: name !== zone ? zone : '', desc: cats.funcs[f.properties.f] || '' };
  });
  return {
    html: parcelZonesHtml(res, recorded, {
      title: 'QHC 1/25.000 trên thửa đất', unit: 'vùng', cover: 'Thuộc vùng chức năng', none: 'Ngoài các vùng chức năng',
      empty: 'Thửa nằm ngoài các vùng của sơ đồ tổ chức không gian 1/25.000.', partsHead: 'Vùng chức năng và định hướng',
      note: `${QHC2045.short} · Sơ đồ tổ chức không gian 1/25.000 · ${QHC2045.status}. Đối chiếu cả khi lớp đang tắt.`
    }),
    shapes: res.shapes
  };
}

async function parcelLandHtml(geometry, recorded) {
  const [land] = await Promise.all([load('land'), load('frame')]);
  const feats = land.features.filter(f => f.properties.c !== SEA_CODE);
  const res = analyzeParcelZones(geometry, feats, (f) => {
    const p = f.properties;
    const zone = land.zones[p.z];
    const l = landOf(zone, p.c);
    const s = l.key ? TT16_STYLES[l.key] : null;
    return {
      label: l.label, color: s ? s.color : l.tone, key: s ? l.key : '', name: l.label,
      sub: [ZONE_NAMES[zone] || zone, STAGE_NAMES[p.t], `lô ${fmtNum(p.a)} ha`].filter(Boolean).join(' · '),
      desc: p.n != null ? land.notes[p.n] || '' : ''
    };
  });
  const [lng, lat] = turf.pointOnFeature(turf.feature(geometry)).geometry.coordinates;
  const tv = tvAt(lng, lat);
  return {
    html: parcelZonesHtml(res, recorded, {
      title: 'QHC 1/10.000 trên thửa đất', unit: 'lô', cover: 'Có lô QHC', none: 'Chưa có lô QHC',
      empty: 'Thửa chưa nằm trong lô QHC 1/10.000.',
      partsHead: 'Lô sử dụng đất QHC', extra: tv ? [['Tiểu vùng', `${tv.tv} · ${tv.ten}`]] : [],
      note: `${QHC2045.short} · 1/10.000 · ${QHC2045.status}. Gồm mọi giai đoạn, kể cả khi lớp hoặc giai đoạn đang tắt. Lô chồng nhau giữ lô vẽ trên.`
    }),
    shapes: res.shapes
  };
}

/** Thửa đối chiếu với QHC cấp level ('qhc10' | 'qhc25'), cắt hình học như chỉ tiêu QHPK. recorded: diện tích hồ sơ (m²) */
export function parcelQhcHtml(geometry, level, recorded) {
  return level === 'qhc25' ? parcelVisionHtml(geometry, recorded) : parcelLandHtml(geometry, recorded);
}

let visionGen = 0;
async function setVision(on) {
  const gen = ++visionGen;
  const maps = qhcHosts('qhc25', on);
  const both = [map, planMap].filter(Boolean);
  if (!maps.length) {
    both.forEach(m => clearQhc(m, ['vision']));
    setHint('qhc25Hint', 'toàn đô thị');
    return;
  }
  setHint('qhc25Hint', 'đang tải…');
  try {
    await Promise.all([load('vision'), loadRoads('25')]);
  } catch (err) {
    console.warn('QHC 2045 – không tải được lớp 1/25.000:', err);
    setHint('qhc25Hint', 'lỗi tải');
    return;
  }
  if (gen !== visionGen) return;
  const now = qhcHosts('qhc25', !!$('chk_qhc25')?.checked);
  both.forEach(m => { if (!now.includes(m)) clearQhc(m, ['vision']); });
  now.forEach(m => { use(m); drawVision(); });
  setHint('qhc25Hint', 'toàn đô thị');
}

function syncQhc() {
  setLand(!!$('chk_qhc10')?.checked);
  setVision(!!$('chk_qhc25')?.checked);
  setExt(extVisible());
  syncStages();
}

// ---------- Bật lớp: chuyển sang bản đồ quy hoạch nếu đang xem hiện trạng ----------
function ensurePlanView() {
  if (planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
}

function syncStages() {
  const on = (id, chk) => !!$(chk)?.checked || (isLevelPair() && (mapsForLevel(id) || []).length > 0);
  const on10 = on('qhc10', 'chk_qhc10');
  $('qhcStages')?.toggleAttribute('hidden', !on10);
  $('qhc10Opts')?.toggleAttribute('hidden', !on10);
  $('qhc25Opts')?.toggleAttribute('hidden', !on('qhc25', 'chk_qhc25'));
}

const stageBtn = (s) => `<button type="button" data-qhc-stage="${s.id}"${s.id === 'ext' ? ' class="qhc-stage-ext"' : ''}${s.title ? ` title="${escapeHtml(s.title)}"` : ''}>${s.label}</button>`;

// Nút giao thông ở hàng riêng dưới mỗi lớp 1/10.000, 1/25.000 (hàng giai đoạn đã kín chỗ), chung một trạng thái
function initStages() {
  const box = $('qhcStages');
  if (!box) return;
  const opts = [$('qhc10Opts'), $('qhc25Opts')].filter(Boolean);
  const isOn = (id) => (id === 'ext' ? extOn : id === 'road' ? roadsOn : shownStages.has(Number(id)));
  const paint = () => [box, ...opts].forEach(el => el.querySelectorAll('[data-qhc-stage]')
    .forEach(b => b.setAttribute('aria-pressed', String(isOn(b.dataset.qhcStage)))));
  box.innerHTML = STAGES.map(stageBtn).join('');
  opts.forEach(el => { el.innerHTML = stageBtn({ id: 'road', label: 'Mạng lưới giao thông', title: ROAD_BTN_TITLE }); });
  const onClick = (e) => {
    const b = e.target.closest('[data-qhc-stage]');
    if (!b) return;
    const id = b.dataset.qhcStage;
    if (id === 'ext') {
      extOn = !extOn;
      setExt(extVisible());
    } else if (id === 'road') {
      roadsOn = !roadsOn;
      redrawRoads();
    } else {
      const t = Number(id);
      if (shownStages.has(t)) shownStages.delete(t); else shownStages.add(t);
      bagList.forEach(b => { if (b.layers.land) { use(b.m); drawLand(); } });
    }
    paint();
  };
  [box, ...opts].forEach(el => el.addEventListener('click', onClick));
  paint();
}

// ---------- Đô thị trung tâm ----------
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
  shown.flyToBounds(b, { padding: [30, 30], duration: 0.9 });
}

function onPopupClick(e, host) {
  const el = e.target.closest('[data-qhc-ward],[data-qhc-open]');
  if (!el) return;
  (host || target())?.closePopup();
  if (el.dataset.qhcWard) document.dispatchEvent(new CustomEvent(WARD_PICK_EVENT, { detail: el.dataset.qhcWard }));
  else document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: el.dataset.qhcOpen }));
}

function initUi() {
  // Nút trong popup (lô 1/10.000, vùng 1/25.000) trên cả 2 bản đồ
  [map, planMap].filter(Boolean).forEach(m => m.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.qhcBound) { el.dataset.qhcBound = '1'; el.addEventListener('click', (ev) => onPopupClick(ev, m)); }
  }));
  initStages();
}

export function initQhc2045Layer() {
  const m = target();
  if (!m) return;
  use(m);
  initUi();
  $('chk_qhc10')?.addEventListener('change', (e) => {
    if (isLevelPair()) { syncQhc(); return; }
    if (e.target.checked) ensurePlanView();
    setLand(e.target.checked);
    setExt(extVisible());
    syncStages();
  });
  $('chk_qhc25')?.addEventListener('change', (e) => {
    if (isLevelPair()) { syncQhc(); return; }
    if (e.target.checked) ensurePlanView();
    setVision(e.target.checked);
    syncStages();
  });
  const onZoom = (host) => {
    use(host);
    const d = host.getZoom() >= TT16_PATTERN_ZOOM;
    if (d !== detailed) { detailed = d; restyleLand(); }
    if (active.layers.frame && host.hasLayer(active.layers.frame)) zoomFrame();
  };
  [map, planMap].filter(Boolean).forEach(host => host.on('zoomend', () => onZoom(host)));
  window.addEventListener(LOT_OPACITY_EVENT, restyleLand);
  document.addEventListener(LEVEL_EVENT, () => { if (!isLevelPair() && !placeLots) applyCore(); });
  onSplitPair(() => syncQhc());
  bindCoreHover(map);
  bindCoreHover(planMap);
  syncStages();
}
