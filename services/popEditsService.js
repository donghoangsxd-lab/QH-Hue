// Hiệu chỉnh raster phân bổ dân cư (Pixel-danso) bằng vùng Admin vẽ, lưu bucket pop/edits.json:
//   { v: 1, saved, asset?, bake?, edits: [{ id: "P…", op: "remove" | "add", name, ring: [[lng, lat], ...], holes?: [ring, ...], at }] }
// remove = vùng không có người ở (bỏ pixel dân cư), add = khu dân cư mới (thêm pixel); vùng thêm được áp sau vùng xóa.
// Asset GEE không sửa được từng pixel → máy chủ áp các vùng này lên raster khi tính (services/geeService.js).
// Dân số phường giữ nguyên theo ranh giới: bớt / thêm pixel chỉ đổi cách phân bổ dân trong phường.
// "Ghi cố định": xuất raster đã áp vùng thành asset mới Pixel-danso-hc-<thời điểm> (asset gốc giữ nguyên để khôi phục);
//   asset = raster nền đang dùng (không có = Pixel-danso gốc), bake = { task, asset, at } tác vụ xuất đang chạy.
const axios = require('axios');

const EDITS_URL = 'https://storage.googleapis.com/hue-infra-data-us/pop/edits.json';
const ASSET_DIR = 'projects/optimistic-yew-488501-s0/assets/';
const BAKED_RE = /^projects\/optimistic-yew-488501-s0\/assets\/Pixel-danso-hc-\d{12}$/;
const TTL_MS = 5 * 60 * 1000;
const MAX_EDITS = 500;
const MAX_RING_POINTS = 500;
const MAX_HOLES = 50;            // lỗ trong vùng (cọ tô vòng quanh để lại khoảng trống)
const MAX_CHARS = 2000000;

let cache = null; // { at, data: { saved, edits } }

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const isLat = (v) => typeof v === 'number' && v > 10 && v < 25;
const isLng = (v) => typeof v === 'number' && v > 100 && v < 115;

const isBakedAsset = (id) => typeof id === 'string' && BAKED_RE.test(id);

/** Tên asset ghi cố định theo giờ Việt Nam: Pixel-danso-hc-YYYYMMDDHHmm */
function bakedAssetId(ms = Date.now()) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${ASSET_DIR}Pixel-danso-hc-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function normalize(raw) {
  const data = { saved: Number(raw.saved) || 0, edits: raw.edits, asset: isBakedAsset(raw.asset) ? raw.asset : null, bake: null };
  const b = raw.bake;
  if (b && typeof b.task === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.task) && isBakedAsset(b.asset)) {
    data.bake = { task: b.task, asset: b.asset, at: Number(b.at) || 0 };
  }
  return data;
}

/** edits.json → { saved, edits, asset, bake } (chưa có file → rỗng; lỗi mạng → ném lỗi để không ghi đè nhầm) */
async function readPopEdits(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await axios.get(`${EDITS_URL}?v=${Date.now()}`, { timeout: 8000, validateStatus: () => true });
  let data;
  if (res.status === 404 || res.status === 403) data = { saved: 0, edits: [], asset: null, bake: null };
  else if (res.status === 200 && res.data && res.data.v === 1 && Array.isArray(res.data.edits)) {
    data = normalize(res.data);
  } else throw new Error(`Không đọc được vùng hiệu chỉnh dân cư (HTTP ${res.status})`);
  cache = { at: Date.now(), data };
  return data;
}

function rememberPopEdits(payload) {
  cache = { at: Date.now(), data: normalize(payload) };
}

/** Nội dung edits.json để ghi (bỏ trường rỗng) */
function buildPayload({ saved, edits, asset, bake }) {
  const payload = { v: 1, saved, edits };
  if (asset) payload.asset = asset;
  if (bake) payload.bake = bake;
  return payload;
}

/** Vòng tọa độ [[lng, lat], ...] → vòng đã làm tròn, khép kín; sai dạng → null */
function parseRing(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_RING_POINTS + 1) return null;
  const ring = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !isLng(p[0]) || !isLat(p[1])) return null;
    ring.push([round6(p[0]), round6(p[1])]);
  }
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring.length < 4 ? null : ring;
}

/** Danh sách vùng Admin gửi lên (toàn bộ, ghi đè) → edits đã kiểm tra (vòng khép kín), hoặc null nếu sai dạng */
function parsePopEdits(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_EDITS) return null;
  const out = [];
  const ids = new Set();
  for (const e of raw) {
    if (!e || typeof e !== 'object') return null;
    const id = String(e.id || '');
    if (!/^P[a-z0-9]{1,16}$/.test(id) || ids.has(id) || (e.op !== 'remove' && e.op !== 'add')) return null;
    const ring = parseRing(e.ring);
    if (!ring) return null;
    let holes = [];
    if (e.holes != null) {
      if (!Array.isArray(e.holes) || e.holes.length > MAX_HOLES) return null;
      holes = e.holes.map(parseRing);
      if (holes.some(h => !h)) return null;
    }
    const at = Math.round(Number(e.at));
    if (!(at > 0 && at < 1e14)) return null;
    ids.add(id);
    const edit = { id, op: e.op, name: String(e.name || '').trim().slice(0, 120), ring, at };
    if (holes.length) edit.holes = holes;
    out.push(edit);
  }
  return out;
}

module.exports = { readPopEdits, rememberPopEdits, parsePopEdits, buildPayload, bakedAssetId, isBakedAsset, MAX_CHARS };
