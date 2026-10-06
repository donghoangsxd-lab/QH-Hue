// Mạng lưới đường OSM toàn thành phố (Admin tải 1 lần theo từng phường/xã ở trình duyệt), lưu trên bucket GCS:
//   roads/v2/index.json            = { v: 2, saved, total, wards: { tên: { bbox: [w, s, e, n], parts, at, main, kiet, trunk?, bike? } } }
//   (main = trục chính + khu vực, trunk = riêng trục chính, bike = đường xe đạp; bản lưu cũ chưa có trunk / bike;
//    trunkEst = trunk chia từ main theo tỉ lệ chiều dài nhóm vẽ trong mạng lưới đã lưu, chưa tải lại OSM)
//   roads/v2/net_<slug>_<i>.json   = { v: 2, ward, part, ways: [[id, cầu ? 1 : 0, [id nút...], [lat, lon, ...], nhóm vẽ?], ...] }
//   nhóm vẽ: 1 = trục chính, 2 = đường có tên, 0 = kiệt, 3 = đường xe đạp (bản lưu cũ không có phần tử này)
//   roads/v2/custom.json           = { v: 2, saved, roads: [{ id, g, name, nodes, flat, len: { tên phường: km }, at }] }
//   (tuyến đường hiện trạng Admin vẽ bổ sung; tách riêng để tải lại OSM không mất, mỗi lần lưu ghi đè cả file)
// Máy chủ cắt đường quanh công trình từ các file này cho "phạm vi thực tế"; index chứa luôn chiều dài trục chính / kiệt.
// Đọc: file công khai. Ghi: Apps Script (máy chủ Vercel không có quyền ghi bucket).
const axios = require('axios');

const ROADS_PUBLIC_BASE = 'https://storage.googleapis.com/hue-infra-data-us/roads/v2/';
const RADIUS_STEP = 500;          // bán kính cắt làm tròn lên bậc 500 m để CDN dùng lại khi đổi bán kính buffer
const RADIUS_MARGIN = 100;        // lấy rộng hơn bán kính phục vụ (đường nối ngay ngoài vòng)
const ROADS_MAX_RADIUS = 3500;    // lớn hơn: phản hồi có thể vượt 4,5 MB của Vercel → trình duyệt tự tải Overpass
const INDEX_TTL_MS = 10 * 60 * 1000;
const PART_CACHE_MAX = 16;        // số phần mạng lưới giữ trong bộ nhớ hàm Vercel (mỗi phần tối đa ~3 MB)
const MAX_PART_CHARS = 3000000;   // dưới giới hạn 4,5 MB/yêu cầu của Vercel khi Admin gửi lên
const MAX_PARTS = 20;
const CUSTOM_MAX_ROADS = 3000;
const CUSTOM_MAX_POINTS = 2000;   // số đỉnh tối đa của 1 tuyến vẽ bổ sung

let indexCache = null;            // { at, data }
let customCache = null;           // { at, data: { saved, roads } }
let mainOverviewCache = null;     // { at, lines } đường trục chính rút gọn cả thành phố
const partCache = new Map();      // "slug_i@at" → ways

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Tên phường → tên file không dấu: "Phường Thuận Hóa" → "phuong-thuan-hoa" */
function wardSlug(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Bán kính phục vụ (m) → bán kính cắt đường (m); so với ROADS_MAX_RADIUS */
function roadsRadius(radius) {
  return Math.ceil((Number(radius) + RADIUS_MARGIN) / RADIUS_STEP) * RADIUS_STEP;
}

async function readPublicJson(name, version) {
  try {
    const res = await axios.get(`${ROADS_PUBLIC_BASE}${name}.json?v=${version}`, { timeout: 8000, validateStatus: () => true });
    return res.status === 200 && res.data && typeof res.data === 'object' ? res.data : null;
  } catch (e) {
    return null;
  }
}

/** index.json (giữ trong bộ nhớ 10 phút; tham số v tránh bản cũ trong cache của storage.googleapis.com) */
async function readRoadsIndex(force = false) {
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.data;
  const d = await readPublicJson('index', Date.now());
  const data = d && d.v === 2 && d.wards && typeof d.wards === 'object' ? d : null;
  indexCache = { at: Date.now(), data };
  return data;
}

/**
 * custom.json → { saved, roads } (chưa có file → rỗng; lỗi mạng → ném lỗi để không trả / ghi đè nhầm danh sách rỗng).
 * minSaved: phiên bản client đã biết (tham số cv) — bộ nhớ cũ hơn thì đọc lại, đọc lại vẫn cũ hơn thì ném lỗi (tránh CDN giữ bản cũ).
 */
async function readCustomRoads(minSaved = 0, force = false) {
  const c = customCache;
  if (!force && c && Date.now() - c.at < INDEX_TTL_MS && c.data.saved >= minSaved) return c.data;
  const res = await axios.get(`${ROADS_PUBLIC_BASE}custom.json?v=${Date.now()}`, { timeout: 8000, validateStatus: () => true });
  let data;
  if (res.status === 404 || res.status === 403) data = { saved: 0, roads: [] };
  else if (res.status === 200 && res.data && res.data.v === 2 && Array.isArray(res.data.roads)) {
    data = { saved: Number(res.data.saved) || 0, roads: res.data.roads };
  } else throw new Error(`Không đọc được tuyến đường bổ sung (HTTP ${res.status})`);
  customCache = { at: Date.now(), data };
  if (data.saved < minSaved) throw new Error('Tuyến đường bổ sung trên bucket chưa cập nhật');
  return data;
}

function rememberCustom(payload) {
  customCache = { at: Date.now(), data: { saved: payload.saved, roads: payload.roads } };
}

/**
 * Chiều dài tuyến bổ sung theo phường: { tên phường: { main, kiet, trunk, bike } } km
 * (nhóm 1, 2 → main như index, nhóm 1 thêm vào trunk; 0 → kiet; 3 → bike)
 */
function customExtra(data) {
  const out = {};
  const KEY = { 0: 'kiet', 1: 'main', 2: 'main', 3: 'bike' };
  (data && data.roads || []).forEach(r => {
    Object.entries(r.len || {}).forEach(([ward, km]) => {
      const e = out[ward] || (out[ward] = { main: 0, kiet: 0, trunk: 0, bike: 0 });
      const v = Number(km) || 0;
      e[KEY[r.g] || 'main'] += v;
      if (r.g === 1) e.trunk += v;
    });
  });
  Object.values(out).forEach(e => Object.keys(e).forEach(k => { e[k] = Math.round(e[k] * 100) / 100; }));
  return out;
}

async function readPart(name, i, at) {
  const key = `${wardSlug(name)}_${i}@${at}`;
  if (partCache.has(key)) {
    const ways = partCache.get(key);
    partCache.delete(key);
    partCache.set(key, ways);
    return ways;
  }
  const d = await readPublicJson(`net_${wardSlug(name)}_${i}`, at);
  if (!d || d.v !== 2 || !Array.isArray(d.ways)) throw new Error(`Thiếu mạng lưới đường ${name} (phần ${i})`);
  partCache.set(key, d.ways);
  while (partCache.size > PART_CACHE_MAX) partCache.delete(partCache.keys().next().value);
  return d.ways;
}

/**
 * Đường có đỉnh cách (lat, lng) không quá r mét → [[cầu, [id nút...], [lat, lon, ...], nhóm vẽ?], ...] (dạng client đang dùng),
 * hoặc null nếu mạng lưới chưa tải đủ 40 phường/xã (trình duyệt tự hỏi Overpass). Gồm cả tuyến Admin vẽ bổ sung
 * (customMin = phiên bản tuyến bổ sung client đã biết).
 */
async function waysAround(lat, lng, r, customMin = 0) {
  const index = await readRoadsIndex();
  if (!index) return null;
  const entries = Object.entries(index.wards);
  if (!entries.length || entries.length < Number(index.total || 0)) return null;

  const kLat = 111320, kLng = 111320 * Math.cos(lat * Math.PI / 180);
  const dLat = r / kLat, dLng = r / kLng;
  const near = entries.filter(([, w]) => Array.isArray(w.bbox)
    && w.bbox[0] <= lng + dLng && w.bbox[2] >= lng - dLng && w.bbox[1] <= lat + dLat && w.bbox[3] >= lat - dLat);
  const loads = [];
  near.forEach(([name, w]) => { for (let i = 0; i < w.parts; i++) loads.push(readPart(name, i, w.at)); });
  const [partsWays, custom] = await Promise.all([Promise.all(loads), readCustomRoads(customMin)]);

  const r2 = r * r;
  const within = (flat) => {
    for (let i = 0; i < flat.length; i += 2) {
      const dy = (flat[i] - lat) * kLat, dx = (flat[i + 1] - lng) * kLng;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  const seen = new Set();
  const out = [];
  partsWays.forEach(ways => ways.forEach(w => {
    const [id, bridge, nodes, flat, group] = w;
    if (seen.has(id) || !within(flat)) return;
    seen.add(id);
    out.push(group == null ? [bridge, nodes, flat] : [bridge, nodes, flat, group]);
  }));
  custom.roads.forEach(c => { if (within(c.flat)) out.push([0, c.nodes, c.flat, c.g]); });
  return out;
}

function flatToLine(flat) {
  const line = [];
  for (let i = 0; i < flat.length; i += 2) line.push([flat[i], flat[i + 1]]);
  return line;
}

/** Đường trục chính rút gọn (main-overview.json) cộng tuyến Admin nhóm 1. null nếu chưa có file rút gọn. */
async function mainRoadLines(customMin = 0) {
  if (!mainOverviewCache || Date.now() - mainOverviewCache.at >= INDEX_TTL_MS) {
    const d = await readPublicJson('main-overview', Date.now());
    const lines = d && d.v === 1 && Array.isArray(d.lines) ? d.lines : null;
    mainOverviewCache = { at: Date.now(), lines };
  }
  if (!mainOverviewCache.lines) return null;
  let custom = { roads: [] };
  try { custom = await readCustomRoads(customMin); } catch (e) { /* vẫn trả đường OSM nếu tuyến bổ sung chưa đọc được */ }
  const lines = mainOverviewCache.lines.slice();
  custom.roads.forEach(r => { if (r.g === 1 && Array.isArray(r.flat) && r.flat.length >= 4) lines.push(flatToLine(r.flat)); });
  return lines;
}

const isInt = (v) => Number.isSafeInteger(v) && v > 0;
const isLat = (v) => typeof v === 'number' && v > 10 && v < 25;
const isLng = (v) => typeof v === 'number' && v > 100 && v < 115;

/** Một phần mạng lưới Admin gửi lên → ways đã kiểm tra (làm tròn tọa độ 6 số lẻ), hoặc null nếu sai dạng */
function parseNetworkPart(raw) {
  if (!Array.isArray(raw) || raw.length > 200000) return null;
  const out = [];
  for (const w of raw) {
    if (!Array.isArray(w) || (w.length !== 4 && w.length !== 5)) return null;
    const [id, bridge, nodes, flat, group] = w;
    if (!isInt(id) || (bridge !== 0 && bridge !== 1) || !Array.isArray(nodes) || !Array.isArray(flat)) return null;
    if (nodes.length < 2 || nodes.length > 5000 || flat.length !== nodes.length * 2 || !nodes.every(isInt)) return null;
    if (w.length === 5 && ![0, 1, 2, 3].includes(group)) return null;
    for (let i = 0; i < flat.length; i += 2) if (!isLat(flat[i]) || !isLng(flat[i + 1])) return null;
    out.push(w.length === 5 ? [id, bridge, nodes, flat.map(round6), group] : [id, bridge, nodes, flat.map(round6)]);
  }
  return out;
}

/** index Admin gửi lên → { total, wards } đã làm sạch, hoặc null nếu sai dạng */
function parseRoadsIndex(rawWards, rawTotal) {
  if (!rawWards || typeof rawWards !== 'object' || Array.isArray(rawWards)) return null;
  const entries = Object.entries(rawWards);
  const total = Math.round(Number(rawTotal));
  if (!entries.length || entries.length > 80 || !(total >= 1 && total <= 80)) return null;
  const wards = {};
  for (const [name, v] of entries) {
    const key = String(name).trim();
    if (!key || key.length > 80 || !wardSlug(key) || !v || typeof v !== 'object' || !Array.isArray(v.bbox) || v.bbox.length !== 4) return null;
    const [w, s, e, n] = v.bbox.map(Number);
    if (!isLng(w) || !isLng(e) || !isLat(s) || !isLat(n) || w > e || s > n) return null;
    const parts = Math.round(Number(v.parts)), at = Math.round(Number(v.at));
    const main = Number(v.main), kiet = Number(v.kiet);
    if (!(parts >= 1 && parts <= MAX_PARTS) || !(at > 0 && at < 1e14)) return null;
    if (![main, kiet].every(x => Number.isFinite(x) && x >= 0 && x < 1e5)) return null;
    wards[key] = { bbox: [w, s, e, n].map(round6), parts, at, main: Math.round(main * 100) / 100, kiet: Math.round(kiet * 100) / 100 };
    if (v.grouped === true) wards[key].grouped = true;
    if (v.trunkEst === true) wards[key].trunkEst = true;
    if (v.trunk != null || v.bike != null) {
      const trunk = Number(v.trunk), bike = Number(v.bike);
      if (![trunk, bike].every(x => Number.isFinite(x) && x >= 0 && x < 1e5) || trunk > main + 0.01) return null;
      wards[key].trunk = Math.round(trunk * 100) / 100;
      wards[key].bike = Math.round(bike * 100) / 100;
    }
  }
  return { total, wards };
}

function rememberIndex(data) {
  indexCache = { at: Date.now(), data };
}

/**
 * Danh sách tuyến bổ sung Admin gửi lên (toàn bộ, ghi đè) → roads đã kiểm tra, hoặc null nếu sai dạng.
 * Mỗi tuyến: { id: "R…", g: 1 trục chính | 2 khu vực | 0 nội bộ | 3 xe đạp, name, nodes: [id nút], flat: [lat, lon, ...], len: { phường: km }, at }
 */
function parseCustomRoads(raw) {
  if (!Array.isArray(raw) || raw.length > CUSTOM_MAX_ROADS) return null;
  const out = [];
  const ids = new Set();
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const id = String(r.id || '');
    const { g, nodes, flat, len } = r;
    if (!/^R[a-z0-9]{1,16}$/.test(id) || ids.has(id) || ![0, 1, 2, 3].includes(g)) return null;
    if (!Array.isArray(nodes) || !Array.isArray(flat) || nodes.length < 2 || nodes.length > CUSTOM_MAX_POINTS) return null;
    if (flat.length !== nodes.length * 2 || !nodes.every(isInt)) return null;
    for (let i = 0; i < flat.length; i += 2) if (!isLat(flat[i]) || !isLng(flat[i + 1])) return null;
    if (!len || typeof len !== 'object' || Array.isArray(len) || Object.keys(len).length > 80) return null;
    const cleanLen = {};
    for (const [ward, km] of Object.entries(len)) {
      const key = String(ward).trim();
      const v = Number(km);
      if (!key || key.length > 80 || !Number.isFinite(v) || v < 0 || v > 500) return null;
      cleanLen[key] = Math.round(v * 1000) / 1000;
    }
    const at = Math.round(Number(r.at));
    if (!(at > 0 && at < 1e14)) return null;
    ids.add(id);
    out.push({ id, g, name: String(r.name || '').trim().slice(0, 120), nodes, flat: flat.map(round6), len: cleanLen, at });
  }
  return out;
}

module.exports = {
  wardSlug, roadsRadius, readRoadsIndex, readPart, waysAround, parseNetworkPart, parseRoadsIndex, rememberIndex,
  readCustomRoads, rememberCustom, customExtra, parseCustomRoads, mainRoadLines,
  ROADS_MAX_RADIUS, MAX_PART_CHARS, MAX_PARTS
};
