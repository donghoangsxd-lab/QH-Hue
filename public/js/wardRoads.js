// Mạng lưới đường OSM toàn thành phố: Admin tải 1 lần theo từng phường/xã (khung bao phường) → lưu bucket roads/v2/
// (services/roadsService.js). Cùng 1 lần tải: phần đi được dùng cho "phạm vi thực tế" (máy chủ cắt quanh công trình),
// chiều dài trục chính / khu vực / nội bộ / xe đạp cắt theo ranh phường lưu trong index; mọi người dùng đọc qua máy chủ (action getWardRoads).
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, ico, setStatusContent, showToast, wardStatHtml } from './utils.js';
import { queryOverpassHedged } from './serviceArea.js';

const QUERY_TIMEOUT_MS = 170000; // xã miền núi rộng hàng trăm km²
const QUERY_HEDGE_MS = 25000;    // truy vấn nặng: chờ lâu hơn mới hỏi thêm máy chủ Overpass khác
const PAUSE_MS = 1500;
const PART_CHARS = 2800000;      // mỗi phần gửi lên dưới giới hạn 4,5 MB/yêu cầu của Vercel (khớp MAX_PART_CHARS máy chủ)
// Khớp EXCLUDED_HIGHWAYS của serviceArea.js (phạm vi thực tế bỏ thêm cao tốc, đường cấm đi bộ / đường riêng)
const SKIP_HIGHWAYS = 'construction|proposed|planned|abandoned|disused|razed|raceway|bus_guideway|platform|corridor|elevator|escape|via_ferrata';

// Trục chính: quốc lộ / tỉnh lộ / đường chính đô thị / liên khu vực + đường phố có tên (OSM ở Huế đặt tên không kèm chữ "Đường").
// Kiệt: phần còn lại — đường không tên, tên Kiệt/Hẻm/Ngõ, đường dịch vụ, phố đi bộ; lối đi bộ chỉ tính khi đặt tên kiệt.
const MAIN_HIGHWAY = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
const STREET_HIGHWAY = /^(residential|unclassified|living_street|road)$/;
const ALLEY_NAME = /^(kiệt|kiet|hẻm|ngõ|ngách)(\s|$)/i;
const SKIP_SERVICE = /^(parking_aisle|driveway|drive-through|emergency_access)$/;
const DUAL_RATIO = 0.5; // các đoạn 1 chiều cùng tên có tổng véc-tơ < 50% tổng chiều dài → đường đôi (2 chiều ngược nhau)

const R = 6371008.8, RAD = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const KM_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DENSITY_FORMAT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Thẻ OSM của 1 đường → 'main' | 'kiet' | 'bike' | null (không tính) */
export function roadClass(tags) {
  const t = tags || {};
  const hw = t.highway || '';
  if (t.area === 'yes' || /^(private|no)$/.test(t.access || '')) return null;
  if (hw === 'cycleway' || (/^(path|footway|track)$/.test(hw) && t.bicycle === 'designated')) return 'bike';
  const alley = ALLEY_NAME.test(String(t.name || '').normalize('NFC').trim());
  if (MAIN_HIGHWAY.test(hw)) return 'main';
  if (STREET_HIGHWAY.test(hw)) return t.name && !alley ? 'main' : 'kiet';
  if (hw === 'service') return alley || !SKIP_SERVICE.test(t.service || '') ? 'kiet' : null;
  if (hw === 'pedestrian') return 'kiet';
  if (/^(footway|path|steps)$/.test(hw)) return alley ? 'kiet' : null;
  return null;
}

/** Nhóm vẽ bản đồ: 1 = trục chính (quốc lộ, tỉnh lộ, đường chính đô thị), 2 = đường phố có tên, 0 = kiệt / đường nhỏ, 3 = đường xe đạp */
export function roadDrawGroup(tags) {
  const t = tags || {};
  if (MAIN_HIGHWAY.test(t.highway || '')) return 1;
  const cls = roadClass(t);
  return cls === 'main' ? 2 : cls === 'bike' ? 3 : 0;
}

/** Đường dùng được cho "phạm vi thực tế" (giống truy vấn Overpass trực tiếp trong serviceArea.js) */
function isWalkable(tags) {
  const t = tags || {};
  return !/^motorway(_link)?$/.test(t.highway || '') && !/^(private|no)$/.test(t.access || '') && t.foot !== 'no';
}

function wardQuery(bbox) {
  const [w, s, e, n] = bbox;
  return `[out:json][timeout:160];way["highway"]["highway"!~"^(${SKIP_HIGHWAYS})$"](${s},${w},${n},${e});out body geom;`;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Đường đi được → các phần [[id, cầu ? 1 : 0, [id nút...], [lat, lon, ...], nhóm vẽ], ...], mỗi phần dưới PART_CHARS ký tự */
function packNetworkParts(elements) {
  const parts = [[]];
  let size = 0;
  (elements || []).forEach(w => {
    const g = w.geometry;
    if (!isWalkable(w.tags) || !Array.isArray(w.nodes) || !Array.isArray(g) || w.nodes.length < 2 || w.nodes.length !== g.length) return;
    if (g.some(p => !p)) return;
    const bridge = w.tags && w.tags.bridge && w.tags.bridge !== 'no' ? 1 : 0;
    const packed = [w.id, bridge, w.nodes, g.flatMap(p => [round6(p.lat), round6(p.lon)]), roadDrawGroup(w.tags)];
    const len = JSON.stringify(packed).length + 1;
    if (size + len > PART_CHARS && parts[parts.length - 1].length) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(packed);
    size += len;
  });
  return parts;
}

const segLen = (a, b) => R * Math.hypot((b.lat - a.lat) * RAD, (b.lon - a.lon) * RAD * Math.cos((a.lat + b.lat) / 2 * RAD));

/**
 * Đường Overpass (out tags geom) + ranh phường → { main, kiet, trunk, bike } km; đoạn thuộc phường xét theo trung điểm.
 * main = trục chính + khu vực (giữ nguyên nghĩa cũ cho mật độ đường), trunk = riêng trục chính, bike = đường xe đạp (không vào mật độ)
 */
export function sumWardLengths(elements, geometry) {
  const feature = turf.feature(geometry);
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  const inside = (lat, lon) => lon >= minX && lon <= maxX && lat >= minY && lat <= maxY && turf.booleanPointInPolygon([lon, lat], feature);

  const ways = [];
  (elements || []).forEach(w => {
    const cls = roadClass(w.tags);
    const g = w.geometry;
    if (!cls || !Array.isArray(g) || g.length < 2) return;
    let len = 0;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      if (a && b && inside((a.lat + b.lat) / 2, (a.lon + b.lon) / 2)) len += segLen(a, b);
    }
    if (len > 0) ways.push({ tags: w.tags, g, cls, len, weight: 1 });
  });

  // Đường đôi có dải phân cách vẽ thành 2 tuyến 1 chiều → trục chính chỉ tính 1 lần theo tim tuyến
  const groups = new Map();
  ways.forEach(x => {
    const t = x.tags;
    if (x.cls !== 'main' || !/^(yes|1|-1)$/.test(t.oneway || '') || /^(roundabout|circular)$/.test(t.junction || '')) return;
    const a = x.g[0], b = x.g[x.g.length - 1];
    const sign = t.oneway === '-1' ? -1 : 1;
    const dx = sign * (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * RAD), dy = sign * (b.lat - a.lat);
    const key = `${t.name || ''}|${t.highway}`;
    const grp = groups.get(key) || { sx: 0, sy: 0, abs: 0, items: [] };
    grp.sx += dx; grp.sy += dy; grp.abs += Math.hypot(dx, dy); grp.items.push(x);
    groups.set(key, grp);
  });
  groups.forEach(grp => {
    if (grp.items.length >= 2 && grp.abs > 0 && Math.hypot(grp.sx, grp.sy) / grp.abs < DUAL_RATIO) {
      grp.items.forEach(x => { x.weight = 0.5; });
    }
  });

  const km = { main: 0, kiet: 0, trunk: 0, bike: 0 };
  ways.forEach(x => {
    const v = x.len * x.weight / 1000;
    km[x.cls] += v;
    if (x.cls === 'main' && MAIN_HIGHWAY.test(x.tags.highway || '')) km.trunk += v;
  });
  const r2 = (v) => Math.round(v * 100) / 100;
  return { main: r2(km.main), kiet: r2(km.kiet), trunk: r2(km.trunk), bike: r2(km.bike) };
}

// ================== ĐỌC / HIỂN THỊ ==================
let metaPromise = null;
const NO_CUSTOM = { saved: 0, count: 0, extra: {} };

/** { wards: index OSM, custom: { saved, count, extra: { phường: { main, kiet } } } (tuyến Admin vẽ bổ sung) } */
function loadRoadsMeta(force = false) {
  if (!metaPromise || force) {
    const promise = fetch(geeApi(`action=getWardRoads${force ? '&fresh=1' : ''}`))
      .then(r => (r.ok ? r.json() : {}))
      .then(d => ({
        wards: d && d.wards && typeof d.wards === 'object' ? d.wards : {},
        custom: d && d.custom && typeof d.custom === 'object' ? { ...NO_CUSTOM, ...d.custom } : NO_CUSTOM
      }))
      .catch(() => {
        if (metaPromise === promise) metaPromise = null;
        return { wards: {}, custom: NO_CUSTOM };
      });
    metaPromise = promise;
  }
  return metaPromise;
}

/** { [tên phường]: { bbox, parts, at, main, kiet } } (chỉ OSM, đúng dạng index lưu bucket) — rỗng nếu chưa tải / lỗi */
export async function loadWardRoadLengths(force = false) {
  return (await loadRoadsMeta(force)).wards;
}

/** Phiên bản tuyến đường bổ sung (0 = chưa có) — gắn vào yêu cầu getRoads để CDN / cache trình duyệt không giữ bản cũ */
export async function customRoadsVersion() {
  return (await loadRoadsMeta()).custom.saved || 0;
}

// Bảng thống kê (uiComponents.js) nghe sự kiện này để điền lại chiều dài 4 loại đường
export const ROADS_META_EVENT = 'roads-meta-updated';

/** Sau khi Admin lưu tuyến bổ sung / tải lại mạng lưới: đọc lại chỉ mục + chiều dài bổ sung, vẽ lại ô mật độ đường và bảng */
export async function refreshRoadsMeta() {
  await loadRoadsMeta(true);
  if (state.selectedWard) fillWardRoadLengths(state.selectedWard);
  const city = $('cityRoadDensity');
  if (city && city.dataset.areas) fillCityRoadDensity(city, JSON.parse(city.dataset.areas));
  document.dispatchEvent(new CustomEvent(ROADS_META_EVENT));
}

// Chiều dài OSM + tuyến bổ sung của 1 phường
const withExtra = (d, extra) => ({ main: d.main + ((extra && extra.main) || 0), kiet: d.kiet + ((extra && extra.kiet) || 0) });

export const ROAD_TYPES = [
  { key: 'trunk', label: 'Đường trục chính', short: 'Trục chính', title: 'Quốc lộ, tỉnh lộ, đường chính đô thị, liên khu vực' },
  { key: 'named', label: 'Đường khu vực', short: 'Khu vực', title: 'Đường phố có tên' },
  { key: 'kiet', label: 'Đường nội bộ', short: 'Nội bộ', title: 'Kiệt, hẻm, đường không tên, đường dịch vụ, phố đi bộ' },
  { key: 'bike', label: 'Đường xe đạp', short: 'Xe đạp', title: 'Đường dành riêng cho xe đạp (OSM highway=cycleway / bicycle=designated + tuyến Admin vẽ)' }
];

/**
 * Chiều dài 4 loại đường (km) của 1 phường: { trunk, named, kiet, bike, main } — null nếu phường chưa có mạng lưới.
 * trunk / named = null khi chỉ mục lưu bản cũ chưa tách trục chính khỏi khu vực (Admin tải lại mạng lưới đường);
 * main = trục chính + khu vực (luôn có).
 */
function roadTypeLengths(d, extra) {
  if (!d) return null;
  const e = { main: 0, kiet: 0, trunk: 0, bike: 0, ...(extra || {}) };
  const split = Number.isFinite(d.trunk);
  return {
    est: split && !!d.trunkEst,
    main: d.main + e.main,
    trunk: split ? d.trunk + e.trunk : null,
    named: split ? Math.max(0, d.main - d.trunk) + (e.main - e.trunk) : null,
    kiet: d.kiet + e.kiet,
    bike: (Number(d.bike) || 0) + e.bike
  };
}

/** { tên phường: { trunk, named, kiet, bike } | null } cho mọi phường có trong chỉ mục */
export async function loadRoadTypeLengths() {
  const { wards, custom } = await loadRoadsMeta();
  const out = {};
  Object.entries(wards).forEach(([name, d]) => { out[name] = roadTypeLengths(d, custom.extra[name]); });
  return out;
}

export const fmtKm = (v) => KM_FORMAT.format(v);

// ================== ĐẤT XÂY DỰNG ĐÔ THỊ: MẪU SỐ MẬT ĐỘ ĐƯỜNG ==================
// Diện tích khu vực xây dựng theo ảnh vệ tinh mới nhất (api/gee.js › getBuiltArea, Dynamic World 2 năm gần nhất);
// chưa tải được thì tạm chia cho diện tích tự nhiên và ghi rõ trong chú thích
export const BUILT_AREA_EVENT = 'built-area-updated';
let builtPromise = null;
let builtData = null;     // { years: [y0, y1], scale, wards: { tên phường: km² } }
let builtFailed = false;

export function loadBuiltAreas() {
  if (!builtPromise) {
    builtPromise = fetch(geeApi('action=getBuiltArea'))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.wards || typeof d.wards !== 'object') throw new Error((d && d.message) || `HTTP ${r.status}`);
        builtData = d;
        builtFailed = false;
      })
      .catch(err => {
        console.warn('Chưa tải được diện tích đất xây dựng:', err);
        builtFailed = true;
        setTimeout(() => { builtPromise = null; }, 60000);
      })
      .then(refreshDensityViews);
  }
  return builtPromise;
}

const builtSource = () => (builtData ? `Dynamic World ${builtData.years[0]}–${builtData.years[1]}` : '');

/**
 * Mẫu số mật độ đường của 1 phường: { km2, built } — built = đất xây dựng đô thị, false = tạm diện tích tự nhiên
 * (chưa tải được / phường không có số liệu); null = đang tải
 */
export function densityArea(name, naturalKm2) {
  if (!builtData && !builtFailed) { loadBuiltAreas(); return null; }
  const v = builtData ? Number(builtData.wards[name]) : 0;
  if (v > 0) return { km2: v, built: true };
  return naturalKm2 > 0 ? { km2: naturalKm2, built: false } : null;
}

/** Tên mẫu số cho chú thích; mixed = số phường phải tạm dùng diện tích tự nhiên */
export function densityAreaLabel(built, mixed = 0) {
  if (!built || !builtData) return 'diện tích tự nhiên (chưa tải được diện tích đất xây dựng từ ảnh vệ tinh)';
  return `diện tích đất xây dựng đô thị (khu vực xây dựng đo trên ảnh vệ tinh ${builtSource()}, lưới ${builtData.scale || 20} m)`
    + (mixed ? `; ${mixed} phường/xã chưa có số liệu đất xây dựng tạm dùng diện tích tự nhiên` : '');
}

function refreshDensityViews() {
  if (state.selectedWard) fillWardRoadLengths(state.selectedWard);
  const city = $('cityRoadDensity');
  if (city && city.dataset.areas) fillCityRoadDensity(city, JSON.parse(city.dataset.areas));
  document.dispatchEvent(new CustomEvent(BUILT_AREA_EVENT));
}

const DENSITY_PENDING = (label) => wardStatHtml(label, ico('clock'), 'km/km²', 'Đang tính diện tích đất xây dựng đô thị từ ảnh vệ tinh...');

/** main = đường trục chính + đường khu vực (đường phố có tên), kiet = đường nội bộ; chia cho diện tích đất xây dựng đô thị (km²) */
function roadDensityHtml(main, kiet, areaKm2, source, areaLabel) {
  const total = main + kiet;
  return wardStatHtml('Mật độ đến đường KV', DENSITY_FORMAT.format(main / areaKm2), 'km/km²',
    `Mật độ đến đường khu vực: (đường trục chính + đường khu vực) ${KM_FORMAT.format(main)} km / ${KM_FORMAT.format(areaKm2)} km² — ${source}\n`
    + `Mật độ đường (mọi tuyến): ${DENSITY_FORMAT.format(total / areaKm2)} km/km² — tổng chiều dài các tuyến ${KM_FORMAT.format(total)} km (trục chính + khu vực ${KM_FORMAT.format(main)} km, nội bộ ${KM_FORMAT.format(kiet)} km)\n`
    + `Mẫu số ${KM_FORMAT.format(areaKm2)} km² = ${areaLabel}`);
}

const osmDate = (at) => (at ? `OSM ${new Date(at).toLocaleDateString('vi-VN')}` : 'OpenStreetMap');
const customNote = (n) => (n ? ` + ${n} tuyến Admin bổ sung` : '');

/** Điền mật độ đường vào ô #wardRoadLen của phần chi tiết phường (data-ward, data-area km²) nếu đã có số liệu */
export async function fillWardRoadLengths(wardName) {
  const { wards, custom } = await loadRoadsMeta();
  const el = $('wardRoadLen');
  if (!el || el.dataset.ward !== wardName) return;
  const d = wards[wardName];
  if (!d) { el.innerHTML = ''; return; }
  const area = densityArea(wardName, Number(el.dataset.area) || 0);
  if (!area) { el.innerHTML = builtFailed ? '' : DENSITY_PENDING('Mật độ đến đường KV'); return; }
  const extra = custom.extra[wardName];
  const km = withExtra(d, extra);
  const added = custom.count && extra ? ' + tuyến Admin bổ sung' : '';
  el.innerHTML = roadDensityHtml(km.main, km.kiet, area.km2, `theo ${osmDate(d.at)}${added}`, densityAreaLabel(area.built));
}

/**
 * Mật độ đường toàn thành phố vào phần tử el: cộng chiều dài các phường/xã đã có mạng lưới đường,
 * chia cho tổng diện tích đất xây dựng đô thị của chính các phường/xã đó (areas = { tên phường: km² diện tích tự nhiên, dự phòng })
 */
export async function fillCityRoadDensity(el, areas) {
  if (el) el.dataset.areas = JSON.stringify(areas);
  const { wards, custom } = await loadRoadsMeta();
  if (!el || !el.isConnected) return;
  let main = 0, kiet = 0, areaKm2 = 0, n = 0, at = 0, natural = 0, pending = false;
  Object.entries(areas).forEach(([name, area]) => {
    const d = wards[name];
    if (!d) return;
    const a = densityArea(name, area);
    if (!a) { pending = pending || !builtData; return; }
    if (!a.built) natural++;
    const km = withExtra(d, custom.extra[name]);
    main += km.main; kiet += km.kiet; areaKm2 += a.km2; n++;
    at = Math.max(at, d.at || 0);
  });
  if (pending) { el.innerHTML = DENSITY_PENDING('Mật độ đến đường KV'); return; }
  const total = Object.keys(areas).length;
  const allNatural = natural === n;
  el.innerHTML = n && areaKm2 > 0
    ? roadDensityHtml(main, kiet, areaKm2, `${n}/${total} phường/xã có mạng lưới đường, theo ${osmDate(at)}${customNote(custom.count)}`,
      densityAreaLabel(!allNatural, allNatural ? 0 : natural))
    : '';
}

// ================== ADMIN TẢI MẠNG LƯỚI & LƯU ==================
const BTN_LABEL = `${ico('road')}Tải mạng lưới đường toàn thành phố`;
let running = false;
let stopRequested = false;

function setMsg(text, color) {
  const el = $('wardRoadsMsg');
  if (!el) return;
  setStatusContent(el, text);
  el.style.color = color || '';
}

export async function postAdmin(action, body) {
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('Phiên Admin hết hạn — đăng nhập lại');
  if (!res.ok || !data.saved) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  return data;
}

/** Tải 1 phường: Overpass → lưu các phần mạng lưới → { bbox, parts, at, main, kiet, grouped } cho index */
async function downloadWard(w, onStep) {
  const bbox = turf.bbox(turf.feature(w.geometry));
  const data = await queryOverpassHedged(wardQuery(bbox), QUERY_TIMEOUT_MS, QUERY_HEDGE_MS);
  const lengths = sumWardLengths(data.elements, w.geometry);
  const parts = packNetworkParts(data.elements);
  for (let i = 0; i < parts.length; i++) {
    onStep(`lưu phần ${i + 1}/${parts.length}`);
    await postAdmin('saveRoadNetwork', { ward: w.name, part: i, ways: parts[i] });
  }
  return { bbox, parts: parts.length, at: Date.now(), ...lengths, grouped: true };
}

// grouped = mạng lưới có nhóm vẽ đường (trục chính / có tên / kiệt); trunk = chỉ mục đã tách chiều dài trục chính / khu vực / xe đạp;
// trunkEst = trục chính mới ước tính (phường có đường trục chính 2 chiều) → vẫn cần tải lại OSM.
// Bản chưa tách: quét mạng lưới đã lưu (scanSavedNetworks) trước, chỉ tải lại OSM phường thật sự cần
const isCurrent = (d) => !!(d && d.parts && d.grouped && Number.isFinite(d.trunk) && !d.trunkEst);
const needsSplitOnly = (d) => !!(d && d.parts && d.grouped && !Number.isFinite(d.trunk));

async function fetchSavedPart(name, part, at) {
  const res = await fetch(geeApi(`action=getRoadPart&ward=${encodeURIComponent(name)}&part=${part}&at=${at}`));
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(d.ways)) throw new Error(d.message || `HTTP ${res.status}`);
  return d.ways;
}

const PIECE_M = 20;          // chia đoạn trục chính thành mẩu ≤ 20 m để dò tuyến song song
const DUAL_GAP_M = 40;       // 2 làn của đường đôi cách nhau dưới 40 m
const DUAL_COS = Math.cos(20 * RAD);
const DUAL_MIN_KM = 0.3;     // tổng mẩu trục chính có tuyến song song kèm (≈ 2 × chiều dài đường đôi) dưới ngưỡng = nút giao, nhánh rẽ
const MATCH_KM = 0.3, MATCH_PCT = 0.01; // sai lệch cho phép giữa tổng đo lại và tổng chính xác đã lưu

/**
 * Mạng lưới đã lưu của 1 phường (các phần [[id, cầu, nút, [lat, lon, ...], nhóm vẽ], ...]) + ranh phường →
 * { len: { 0, 1, 2, 3 } km theo nhóm vẽ (đoạn có trung điểm trong ranh, như sumWardLengths), dualKm: km trục chính có tuyến trục chính khác song song kèm }
 */
function scanWardNetwork(waysList, geometry) {
  const feature = turf.feature(geometry);
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  const inside = (lat, lon) => lon >= minX && lon <= maxX && lat >= minY && lat <= maxY && turf.booleanPointInPolygon([lon, lat], feature);
  const lat0 = (minY + maxY) / 2, kLng = Math.cos(lat0 * RAD) * R * RAD, kLat = R * RAD;
  const len = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const pieces = [];   // mẩu trục chính trong ranh: [x, y, ux, uy, dài m, id tuyến]
  const seen = new Set();
  waysList.forEach(ways => ways.forEach(([id, , , flat, group]) => {
    if (seen.has(id) || !(group in len)) return;
    seen.add(id);
    for (let i = 2; i < flat.length; i += 2) {
      const a = { lat: flat[i - 2], lon: flat[i - 1] }, b = { lat: flat[i], lon: flat[i + 1] };
      if (!inside((a.lat + b.lat) / 2, (a.lon + b.lon) / 2)) continue;
      const l = segLen(a, b);
      len[group] += l;
      if (group !== 1 || l <= 0) continue;
      const ax = a.lon * kLng, ay = a.lat * kLat, dx = b.lon * kLng - ax, dy = b.lat * kLat - ay;
      const n = Math.ceil(l / PIECE_M);
      for (let k = 0; k < n; k++) pieces.push([ax + dx * (k + 0.5) / n, ay + dy * (k + 0.5) / n, dx / l, dy / l, l / n, id]);
    }
  }));

  const grid = new Map();
  const cell = (x, y) => `${Math.floor(x / DUAL_GAP_M)}:${Math.floor(y / DUAL_GAP_M)}`;
  pieces.forEach((p, i) => { const k = cell(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const hasParallel = ([x, y, ux, uy, , id]) => {
    const cx = Math.floor(x / DUAL_GAP_M), cy = Math.floor(y / DUAL_GAP_M);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx}:${gy}`) || []) {
          const q = pieces[j];
          if (q[5] === id || Math.abs(ux * q[2] + uy * q[3]) < DUAL_COS) continue;
          const ox = q[0] - x, oy = q[1] - y;
          // lệch ngang ≥ 3 m: 2 làn chạy cạnh nhau, không phải 2 tuyến nối tiếp thẳng hàng
          if (Math.hypot(ox, oy) <= DUAL_GAP_M && Math.abs(ox * uy - oy * ux) >= 3) return true;
        }
      }
    }
    return false;
  };
  const dualM = pieces.reduce((s, p) => s + (hasParallel(p) ? p[4] : 0), 0);
  const km = (m) => Math.round(m / 10) / 100;
  return { len: { 0: km(len[0]), 1: km(len[1]), 2: km(len[2]), 3: km(len[3]) }, dualKm: km(dualM) };
}

/**
 * Tách trục chính / khu vực cho phường đã có mạng lưới (bản chưa tách) mà không tải lại OSM.
 * Tổng main đã lưu đã gộp đường đôi và gồm cả đường ngoài mạng lưới đi bộ (cao tốc, cấm đi bộ):
 * - tổng đo lại (nhóm 1 + 2) khớp main, hoặc chỉ dư do đường đôi ở đường khu vực → trục chính = chiều dài nhóm 1 (chính xác);
 * - còn lại (có đường trục chính 2 chiều / tuyến ngoài mạng lưới) → ước tính theo tỉ lệ, đánh dấu trunkEst để chỉ tải lại các phường này.
 * Trả về danh sách phường cần tải lại.
 */
async function scanSavedNetworks(targets, index, total) {
  running = true;
  stopRequested = false;
  const btn = $('btnWardRoads');
  if (btn) btn.innerHTML = `${ico('stop')}Dừng quét mạng lưới`;
  const failed = [], reload = [];
  let done = 0, exact = 0;
  for (const w of targets) {
    if (stopRequested) break;
    setMsg(`⏳ Quét ${done + 1}/${targets.length}: ${w.name}...`, 'var(--accent-orange)');
    try {
      const d = index[w.name];
      const parts = [];
      for (let i = 0; i < d.parts; i++) parts.push(await fetchSavedPart(w.name, i, d.at));
      const { len, dualKm } = scanWardNetwork(parts, w.geometry);
      const gap = len[1] + len[2] - d.main;
      const tol = Math.max(MATCH_KM, d.main * MATCH_PCT);
      const bike = len[3];
      if (Math.abs(gap) <= tol || (gap > tol && dualKm < DUAL_MIN_KM)) {
        index[w.name] = { ...d, trunk: Math.min(d.main, len[1]), bike };
        exact++;
      } else {
        const ratio = len[1] + len[2] > 0 ? len[1] / (len[1] + len[2]) : 0;
        index[w.name] = { ...d, trunk: Math.round(d.main * ratio * 100) / 100, bike, trunkEst: true };
        reload.push(`${w.name} (${dualKm >= DUAL_MIN_KM ? `đường đôi ~${KM_FORMAT.format(dualKm / 2)} km` : 'có tuyến ngoài mạng lưới đi bộ'})`);
      }
    } catch (err) {
      failed.push(w.name);
    }
    done++;
  }
  try {
    setMsg('⏳ Đang lưu chỉ mục mạng lưới đường...', 'var(--accent-orange)');
    await postAdmin('saveWardRoads', { wards: index, total });
    await refreshRoadsMeta();
    const tail = failed.length ? ` Lỗi ${failed.length}: ${failed.join(', ')} — bấm lại để quét tiếp.` : '';
    setMsg(`${stopRequested ? 'Đã dừng' : '✓ Quét xong'}: ${exact} phường/xã tách chính xác, ${reload.length} phường/xã có đường trục chính 2 chiều cần tải lại.${tail}`,
      failed.length || stopRequested || reload.length ? 'var(--accent-orange)' : 'var(--accent-green)');
  } catch (err) {
    setMsg(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    running = false;
    if (btn) btn.innerHTML = BTN_LABEL;
  }
  return { reload, stopped: stopRequested };
}

async function run() {
  const wards = state.wardLabelsList.filter(w => w.geometry);
  if (!wards.length) { setMsg('Chưa tải xong ranh giới phường/xã.', 'var(--accent-red)'); return; }
  const index = { ...(await loadWardRoadLengths(true)) };
  const splitOnly = wards.filter(w => needsSplitOnly(index[w.name]));
  let dualNote = '';
  if (splitOnly.length) {
    if (!confirm(`${splitOnly.length} phường/xã đã có mạng lưới đường nhưng chưa tách chiều dài trục chính / khu vực / xe đạp.`
      + `\n\nQuét mạng lưới đã lưu (khoảng 1–2 phút, không tải lại OpenStreetMap): phường/xã không có đường trục chính 2 chiều được tách chính xác ngay,`
      + ` chỉ phường/xã có đường trục chính 2 chiều mới cần tải lại.`)) return;
    const { reload, stopped } = await scanSavedNetworks(splitOnly, index, wards.length);
    if (stopped) return;
    if (reload.length) dualNote = `\n\nCó đường trục chính 2 chiều (đang hiện số ước tính ≈):\n• ${reload.join('\n• ')}`;
  }
  const missing = wards.filter(w => !isCurrent(index[w.name]));
  const flagged = missing.filter(w => index[w.name] && index[w.name].trunkEst).length;
  const outdated = missing.filter(w => index[w.name] && index[w.name].parts && !index[w.name].trunkEst).length;
  const absent = missing.length - flagged - outdated;
  let targets = missing;
  if (!missing.length) {
    if (splitOnly.length) return;
    if (!confirm(`Đã có mạng lưới đường cả ${wards.length} phường/xã. Tải lại toàn bộ theo OpenStreetMap mới nhất?`)) return;
    targets = wards;
  } else if (!confirm(`Tải lại mạng lưới đường từ OpenStreetMap cho ${missing.length} phường/xã: `
    + [flagged && `${flagged} có đường trục chính 2 chiều`, outdated && `${outdated} đang lưu bản cũ`, absent && `${absent} chưa có`].filter(Boolean).join(', ')
    + `?${dualNote}`
    + `\n\nDùng chung cho "phạm vi thực tế" của công trình và chiều dài đường theo phường. Mỗi phường/xã mất vài giây đến 1–2 phút; giữ tab mở tới khi xong (có thể bấm Dừng, lần sau bấm lại sẽ tải tiếp phần còn lại).`)) {
    return;
  }

  running = true;
  stopRequested = false;
  const btn = $('btnWardRoads');
  if (btn) btn.innerHTML = `${ico('stop')}Dừng tải mạng lưới đường`;
  const failed = [];
  let done = 0, fresh = 0;

  for (const w of targets) {
    if (stopRequested) break;
    const step = (s) => setMsg(`⏳ ${done + 1}/${targets.length}: ${w.name}${s ? ` — ${s}` : ''}...`, 'var(--accent-orange)');
    step('');
    try {
      index[w.name] = await downloadWard(w, step);
      step('cập nhật chỉ mục');
      await postAdmin('saveWardRoads', { wards: index, total: wards.length });
      const { custom } = await loadRoadsMeta();
      metaPromise = Promise.resolve({ wards: { ...index }, custom });
      fresh++;
    } catch (err) {
      failed.push(w.name);
      if (/hết hạn/.test(err.message)) { showToast(`❌ ${err.message}`, 'error'); break; }
    }
    done++;
    await sleep(PAUSE_MS);
  }

  running = false;
  if (btn) btn.innerHTML = BTN_LABEL;
  const tail = failed.length ? ` Lỗi ${failed.length}: ${failed.join(', ')} — bấm lại để tải tiếp.` : '';
  const have = wards.filter(w => isCurrent(index[w.name])).length;
  setMsg(`${stopRequested ? 'Đã dừng' : '✓ Xong'}: tải ${fresh}/${targets.length} phường/xã (đã có ${have}/${wards.length}).${tail}`,
    failed.length || stopRequested || have < wards.length ? 'var(--accent-orange)' : 'var(--accent-green)');
  if (state.selectedWard) fillWardRoadLengths(state.selectedWard);
  if (fresh) document.dispatchEvent(new CustomEvent(ROADS_META_EVENT));
}

export function initWardRoads() {
  $('btnWardRoads')?.addEventListener('click', () => {
    if (running) { stopRequested = true; setMsg('Đang dừng sau phường/xã đang tải...', 'var(--accent-orange)'); return; }
    if (state.currentUserRole !== 'ADMIN') return;
    run();
  });
}
