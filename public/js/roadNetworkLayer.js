// Lớp "Mạng lưới đường" (bảng lớp dữ liệu): đường theo 4 nhóm (kể cả đường xe đạp), gồm cả tuyến Admin vẽ bổ sung — để thấy chỗ còn thiếu đường.
// Từ mainMinZoom() đến dưới MIN_ZOOM: chỉ đường trục chính, một file rút gọn cả thành phố (getMainRoads).
// Từ MIN_ZOOM: tải theo ô lưới ~2 km quanh khung nhìn qua action getRoads, nhóm đường lọc theo keysForZoom.
// Zoom ≤ mức một biểu đồ tròn toàn thành phố thì không vẽ đường. Vẽ đồng thời trên bản đồ hiện trạng và quy hoạch.
import { map, CITY_PIE_MAX_ZOOM } from './mapEngine.js';
import { planMap } from './planMap.js';
import { roadWaysAround } from './serviceArea.js';
import { geeApi } from './api.js';
import { customRoadsVersion } from './wardRoads.js';

const MIN_ZOOM = 14;
// Nhóm đường hiện theo mức phóng: xa chỉ trục chính, gần hơn thêm đường khu vực + xe đạp, gần nhất thêm nội bộ / chưa phân loại.
// Thu nhỏ hơn MIN_ZOOM vẫn vẽ trục chính (file rút gọn cả thành phố). Chỉ mức một biểu đồ tròn toàn thành phố là tắt.
// mapEngine.js import ngược lớp này (vòng import): đọc CITY_PIE_MAX_ZOOM lúc chạy, không đọc lúc nạp module
const mainMinZoom = () => CITY_PIE_MAX_ZOOM + 1;
const ZOOM_NAMED = 15;
const ZOOM_ALL = 16;
function keysForZoom(z) {
  if (z >= ZOOM_ALL) return null;
  return new Set(z >= ZOOM_NAMED ? ['main', 'named', 'bike'] : ['main']);
}
const CELL_DEG = 0.02;          // ô lưới ~2,2 × 2,1 km
const CELL_RADIUS_M = 1600;     // phủ trọn ô (nửa đường chéo ~1,55 km)
const MAX_CELLS = 60;           // số ô giữ trong bộ nhớ (ngoài các ô đang trong khung nhìn)
const MAX_PARALLEL = 3;
// Vẽ từ nhóm nhỏ lên nhóm lớn để trục chính nằm trên cùng; đường xe đạp nét đứt trên cùng (thường chạy song song đường phố)
const STYLES = [
  ['kiet', { color: '#cbd5e1', weight: 1 }],
  ['unknown', { color: '#fde047', weight: 1.3 }],
  ['named', { color: '#60a5fa', weight: 1.8 }],
  ['main', { color: '#fb923c', weight: 2.6 }],
  ['bike', { color: '#4ade80', weight: 2.2, dashArray: '6,4' }]
];
const GROUP_KEYS = { 0: 'kiet', 1: 'main', 2: 'named', 3: 'bike' };
const groupKey = (g) => GROUP_KEYS[g] || 'unknown';

let visible = false;
let leftGroup = null, rightGroup = null;
const cells = new Map();        // "i:j" → { lines: { main, named, kiet, unknown } } | { loading: true }
let active = 0;
const queue = [];
let overviewCache = null;       // { cv, lines } — trục chính rút gọn cả thành phố
let overviewGen = 0;
let overviewShown = false;

const $ = (id) => document.getElementById(id);

function setHint(text) {
  const el = $('roadsHint');
  if (el) el.textContent = text;
}

function cellKeysInView() {
  const b = map.getBounds().pad(0.15);
  const keys = [];
  for (let i = Math.floor(b.getSouth() / CELL_DEG); i <= Math.floor(b.getNorth() / CELL_DEG); i++) {
    for (let j = Math.floor(b.getWest() / CELL_DEG); j <= Math.floor(b.getEast() / CELL_DEG); j++) keys.push(`${i}:${j}`);
  }
  return keys;
}

// Bỏ ô cũ nhất khi vượt MAX_CELLS nhưng giữ ô đang trong khung nhìn (màn hình lớn ở zoom 14 cần > 60 ô, xóa ô đang xem sẽ tải lại mãi)
function trimCache(inView) {
  for (const [key, cell] of cells) {
    if (cells.size <= MAX_CELLS) break;
    if (!inView.has(key) && !cell.loading) cells.delete(key);
  }
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const key = queue.shift();
    const [i, j] = key.split(':').map(Number);
    active++;
    roadWaysAround((i + 0.5) * CELL_DEG, (j + 0.5) * CELL_DEG, CELL_RADIUS_M)
      .then(ways => {
        const lines = { main: [], named: [], kiet: [], bike: [], unknown: [] };
        ways.forEach(w => lines[groupKey(w.group)].push(w.geometry.map(p => [p.lat, p.lon])));
        cells.set(key, { lines });
      })
      .catch(() => cells.delete(key))   // lần di chuyển bản đồ sau sẽ thử lại
      .finally(() => { active--; if (visible) update(); pump(); });
  }
}

function ensureGroups() {
  if (!leftGroup) leftGroup = L.layerGroup().addTo(map);
  if (planMap && !rightGroup) rightGroup = L.layerGroup().addTo(planMap);
}

function clearDrawn() {
  overviewShown = false;
  [leftGroup, rightGroup].forEach(g => g && g.clearLayers());
}

async function overviewLines() {
  const cv = await customRoadsVersion().catch(() => 0);
  if (overviewCache && overviewCache.cv === cv) return overviewCache.lines;
  const res = await fetch(geeApi(`action=getMainRoads&cv=${cv}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.lines)) throw new Error(data.message || `HTTP ${res.status}`);
  overviewCache = { cv, lines: data.lines };
  return data.lines;
}

function drawMain(lines) {
  clearDrawn();
  if (!lines.length) return;
  const style = { color: '#fb923c', weight: 2.6, opacity: 0.9, interactive: false };
  leftGroup.addLayer(L.polyline(lines, style));
  if (rightGroup) rightGroup.addLayer(L.polyline(lines, style));
}

function showOverview() {
  if (overviewShown && overviewCache) {
    setHint('trục chính — phóng to xem đường khu vực');
    return;
  }
  const gen = ++overviewGen;
  setHint('đang tải đường trục chính...');
  overviewLines()
    .then(lines => {
      if (!visible || gen !== overviewGen || map.getZoom() < mainMinZoom() || map.getZoom() >= MIN_ZOOM) return;
      drawMain(lines);
      overviewShown = true;
      setHint('trục chính — phóng to xem đường khu vực');
    })
    .catch(err => {
      if (!visible || gen !== overviewGen) return;
      console.warn('Không tải được đường trục chính mức toàn thành phố:', err.message);
      setHint('chưa tải được đường trục chính');
    });
}

function draw(keys) {
  [leftGroup, rightGroup].forEach(g => g && g.clearLayers());
  const shown = keysForZoom(map.getZoom());
  STYLES.forEach(([k, s]) => {
    if (shown && !shown.has(k)) return;
    const lines = [];
    keys.forEach(key => { const c = cells.get(key); if (c && c.lines) lines.push(...c.lines[k]); });
    if (!lines.length) return;
    const style = { ...s, opacity: 0.9, interactive: false };
    leftGroup.addLayer(L.polyline(lines, style));
    if (rightGroup) rightGroup.addLayer(L.polyline(lines, style));
  });
}

function update() {
  if (!visible || !map) return;
  ensureGroups();
  const z = map.getZoom();
  if (z < mainMinZoom()) {
    overviewGen++;
    clearDrawn();
    setHint('phóng to để xem');
    return;
  }
  if (z < MIN_ZOOM) {
    showOverview();
    return;
  }
  overviewGen++;
  overviewShown = false;
  const keys = cellKeysInView();
  trimCache(new Set(keys));
  keys.forEach(key => {
    if (!cells.has(key)) {
      cells.set(key, { loading: true });
      queue.push(key);
    }
  });
  const loading = keys.filter(k => cells.get(k)?.loading).length;
  setHint(loading ? `đang tải ${keys.length - loading}/${keys.length} ô...`
    : z < ZOOM_NAMED ? 'trục chính — phóng to xem đường khu vực'
      : z < ZOOM_ALL ? 'trục chính + khu vực — phóng to xem đường nội bộ' : '');
  draw(keys);
  pump();
}

export function setRoadNetworkVisible(on) {
  visible = !!on;
  const legend = $('roadsLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  if (!map) return;
  if (visible) {
    if (!leftGroup) leftGroup = L.layerGroup().addTo(map);
    update();
  } else {
    queue.length = 0;
    [...cells.keys()].forEach(k => { if (cells.get(k).loading) cells.delete(k); });
    overviewShown = false;
    leftGroup?.remove(); leftGroup = null;
    rightGroup?.remove(); rightGroup = null;
    setHint('phóng to để xem');
  }
}

/** Sau khi Admin lưu / xóa tuyến bổ sung: tải lại các ô để thấy tuyến mới */
export function refreshRoadNetwork() {
  queue.length = 0;
  cells.clear();
  overviewCache = null;
  if (visible) update();
}

export function initRoadNetworkLayer() {
  if (!map) return;
  map.on('moveend', () => { if (visible) update(); });
  $('chk_roads')?.addEventListener('change', (e) => setRoadNetworkVisible(e.target.checked));
}
