// Mạng lưới đường OSM toàn thành phố: Admin tải 1 lần theo từng phường/xã (khung bao phường) → lưu bucket roads/v2/
// (services/roadsService.js). Cùng 1 lần tải: phần đi được dùng cho "phạm vi thực tế" (máy chủ cắt quanh công trình),
// chiều dài trục chính / kiệt cắt theo ranh phường lưu trong index; mọi người dùng đọc qua máy chủ (action getWardRoads).
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, showToast, wardStatHtml } from './utils.js';
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

/** Thẻ OSM của 1 đường → 'main' | 'kiet' | null (không tính) */
export function roadClass(tags) {
  const t = tags || {};
  const hw = t.highway || '';
  if (t.area === 'yes' || /^(private|no)$/.test(t.access || '')) return null;
  const alley = ALLEY_NAME.test(String(t.name || '').normalize('NFC').trim());
  if (MAIN_HIGHWAY.test(hw)) return 'main';
  if (STREET_HIGHWAY.test(hw)) return t.name && !alley ? 'main' : 'kiet';
  if (hw === 'service') return alley || !SKIP_SERVICE.test(t.service || '') ? 'kiet' : null;
  if (hw === 'pedestrian') return 'kiet';
  if (/^(footway|path|steps)$/.test(hw)) return alley ? 'kiet' : null;
  return null;
}

/** Nhóm vẽ bản đồ: 1 = trục chính (quốc lộ, tỉnh lộ, đường chính đô thị), 2 = đường phố có tên, 0 = kiệt / đường nhỏ */
export function roadDrawGroup(tags) {
  const t = tags || {};
  if (MAIN_HIGHWAY.test(t.highway || '')) return 1;
  return roadClass(t) === 'main' ? 2 : 0;
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

/** Đường Overpass (out tags geom) + ranh phường → { main, kiet } km; đoạn thuộc phường xét theo trung điểm */
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

  const km = { main: 0, kiet: 0 };
  ways.forEach(x => { km[x.cls] += x.len * x.weight / 1000; });
  return { main: Math.round(km.main * 100) / 100, kiet: Math.round(km.kiet * 100) / 100 };
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

/** Sau khi Admin lưu tuyến bổ sung: đọc lại chỉ mục + chiều dài bổ sung, vẽ lại ô mật độ đường */
export async function refreshRoadsMeta() {
  await loadRoadsMeta(true);
  if (state.selectedWard) fillWardRoadLengths(state.selectedWard);
  const city = $('cityRoadDensity');
  if (city && city.dataset.areas) fillCityRoadDensity(city, JSON.parse(city.dataset.areas));
}

// Chiều dài OSM + tuyến bổ sung của 1 phường
const withExtra = (d, extra) => ({ main: d.main + ((extra && extra.main) || 0), kiet: d.kiet + ((extra && extra.kiet) || 0) });

/** main = đường trục chính + đường khu vực (đường phố có tên), kiet = đường nội bộ; chia cho diện tích tự nhiên (km²) */
function roadDensityHtml(main, kiet, areaKm2, source) {
  const total = main + kiet;
  return wardStatHtml('Mật độ giao thông', DENSITY_FORMAT.format(total / areaKm2), 'km/km²',
    `Tổng chiều dài các tuyến đường ${KM_FORMAT.format(total)} km (trục chính + khu vực ${KM_FORMAT.format(main)} km, nội bộ ${KM_FORMAT.format(kiet)} km) / diện tích tự nhiên ${KM_FORMAT.format(areaKm2)} km² — ${source}`)
    + wardStatHtml('Mật độ đường khu vực', DENSITY_FORMAT.format(main / areaKm2), 'km/km²',
      `(Đường trục chính + đường khu vực) ${KM_FORMAT.format(main)} km / diện tích tự nhiên ${KM_FORMAT.format(areaKm2)} km² — ${source}`);
}

const osmDate = (at) => (at ? `OSM ${new Date(at).toLocaleDateString('vi-VN')}` : 'OpenStreetMap');
const customNote = (n) => (n ? ` + ${n} tuyến Admin bổ sung` : '');

/** Điền mật độ đường vào ô #wardRoadLen của phần chi tiết phường (data-ward, data-area km²) nếu đã có số liệu */
export async function fillWardRoadLengths(wardName) {
  const { wards, custom } = await loadRoadsMeta();
  const el = $('wardRoadLen');
  if (!el || el.dataset.ward !== wardName) return;
  const d = wards[wardName];
  const areaKm2 = Number(el.dataset.area) || 0;
  if (!d || !(areaKm2 > 0)) { el.innerHTML = ''; return; }
  const extra = custom.extra[wardName];
  const km = withExtra(d, extra);
  const added = custom.count && extra ? ' + tuyến Admin bổ sung' : '';
  el.innerHTML = roadDensityHtml(km.main, km.kiet, areaKm2, `theo ${osmDate(d.at)}${added}`);
}

/**
 * Mật độ đường toàn thành phố vào phần tử el: cộng chiều dài các phường/xã đã có mạng lưới đường,
 * chia cho tổng diện tích của chính các phường/xã đó (areas = { tên phường: km² })
 */
export async function fillCityRoadDensity(el, areas) {
  if (el) el.dataset.areas = JSON.stringify(areas);
  const { wards, custom } = await loadRoadsMeta();
  if (!el || !el.isConnected) return;
  let main = 0, kiet = 0, areaKm2 = 0, n = 0, at = 0;
  Object.entries(areas).forEach(([name, area]) => {
    const d = wards[name];
    if (!d || !(area > 0)) return;
    const km = withExtra(d, custom.extra[name]);
    main += km.main; kiet += km.kiet; areaKm2 += area; n++;
    at = Math.max(at, d.at || 0);
  });
  const total = Object.keys(areas).length;
  el.innerHTML = n && areaKm2 > 0
    ? roadDensityHtml(main, kiet, areaKm2, `${n}/${total} phường/xã có mạng lưới đường, theo ${osmDate(at)}${customNote(custom.count)}`)
    : '';
}

// ================== ADMIN TẢI MẠNG LƯỚI & LƯU ==================
const BTN_LABEL = '🛣️ Tải mạng lưới đường toàn thành phố';
let running = false;
let stopRequested = false;

function setMsg(text, color) {
  const el = $('wardRoadsMsg');
  if (!el) return;
  el.textContent = text;
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

// grouped = mạng lưới có nhóm vẽ đường (trục chính / có tên / kiệt); bản lưu trước đó thiếu → cần tải lại
const isCurrent = (d) => !!(d && d.parts && d.grouped);

async function run() {
  const wards = state.wardLabelsList.filter(w => w.geometry);
  if (!wards.length) { setMsg('Chưa tải xong ranh giới phường/xã.', 'var(--accent-red)'); return; }
  const index = { ...(await loadWardRoadLengths(true)) };
  const missing = wards.filter(w => !isCurrent(index[w.name]));
  const outdated = missing.filter(w => index[w.name] && index[w.name].parts).length;
  let targets = missing;
  if (!missing.length) {
    if (!confirm(`Đã có mạng lưới đường cả ${wards.length} phường/xã. Tải lại toàn bộ theo OpenStreetMap mới nhất?`)) return;
    targets = wards;
  } else if (!confirm(`Tải mạng lưới đường cho ${missing.length} phường/xã`
    + `${outdated ? ` (${outdated} phường/xã đang lưu bản cũ chưa phân nhóm trục chính / đường có tên / kiệt)` : ' chưa có'}?`
    + `\n\nDùng chung cho "phạm vi thực tế" của công trình và chiều dài đường theo phường. Mỗi phường/xã mất vài giây đến 1–2 phút; giữ tab mở tới khi xong (có thể bấm Dừng, lần sau bấm lại sẽ tải tiếp phần còn lại).`)) {
    return;
  }

  running = true;
  stopRequested = false;
  const btn = $('btnWardRoads');
  if (btn) btn.textContent = '⏹ Dừng tải mạng lưới đường';
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
  if (btn) btn.textContent = BTN_LABEL;
  const tail = failed.length ? ` Lỗi ${failed.length}: ${failed.join(', ')} — bấm lại để tải tiếp.` : '';
  const have = wards.filter(w => isCurrent(index[w.name])).length;
  setMsg(`${stopRequested ? 'Đã dừng' : '✓ Xong'}: tải ${fresh}/${targets.length} phường/xã (đã có ${have}/${wards.length}).${tail}`,
    failed.length || stopRequested || have < wards.length ? 'var(--accent-orange)' : 'var(--accent-green)');
  if (state.selectedWard) fillWardRoadLengths(state.selectedWard);
}

export function initWardRoads() {
  $('btnWardRoads')?.addEventListener('click', () => {
    if (running) { stopRequested = true; setMsg('Đang dừng sau phường/xã đang tải...', 'var(--accent-orange)'); return; }
    if (state.currentUserRole !== 'ADMIN') return;
    run();
  });
}
