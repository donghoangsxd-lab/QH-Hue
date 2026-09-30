// Mạng lưới đường OSM toàn thành phố (Admin tải 1 lần theo từng phường/xã ở trình duyệt), lưu trên bucket GCS:
//   roads/v2/index.json            = { v: 2, saved, total, wards: { tên: { bbox: [w, s, e, n], parts, at, main, kiet } } }
//   roads/v2/net_<slug>_<i>.json   = { v: 2, ward, part, ways: [[id, cầu ? 1 : 0, [id nút...], [lat, lon, ...], nhóm vẽ?], ...] }
//   nhóm vẽ: 1 = trục chính, 2 = đường có tên, 0 = kiệt (bản lưu cũ không có phần tử này)
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

let indexCache = null;            // { at, data }
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
 * hoặc null nếu mạng lưới chưa tải đủ 40 phường/xã (trình duyệt tự hỏi Overpass).
 */
async function waysAround(lat, lng, r) {
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
  const partsWays = await Promise.all(loads);

  const r2 = r * r;
  const seen = new Set();
  const out = [];
  partsWays.forEach(ways => ways.forEach(w => {
    const [id, bridge, nodes, flat, group] = w;
    if (seen.has(id)) return;
    for (let i = 0; i < flat.length; i += 2) {
      const dy = (flat[i] - lat) * kLat, dx = (flat[i + 1] - lng) * kLng;
      if (dx * dx + dy * dy <= r2) {
        seen.add(id);
        out.push(group == null ? [bridge, nodes, flat] : [bridge, nodes, flat, group]);
        return;
      }
    }
  }));
  return out;
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
    if (w.length === 5 && group !== 0 && group !== 1 && group !== 2) return null;
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
  }
  return { total, wards };
}

function rememberIndex(data) {
  indexCache = { at: Date.now(), data };
}

module.exports = {
  wardSlug, roadsRadius, readRoadsIndex, waysAround, parseNetworkPart, parseRoadsIndex, rememberIndex,
  ROADS_MAX_RADIUS, MAX_PART_CHARS, MAX_PARTS
};
