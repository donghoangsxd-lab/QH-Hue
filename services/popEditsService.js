// Hiệu chỉnh raster phân bổ dân cư (Pixel-danso) bằng vùng Admin vẽ, lưu bucket pop/edits.json:
//   { v: 1, saved, edits: [{ id: "P…", op: "remove" | "add", name, ring: [[lng, lat], ...], at }] }
// remove = vùng không có người ở (bỏ pixel dân cư), add = khu dân cư mới (thêm pixel); vùng thêm được áp sau vùng xóa.
// Asset GEE không sửa được từng pixel → máy chủ áp các vùng này lên raster khi tính (services/geeService.js).
// Dân số phường giữ nguyên theo ranh giới: bớt / thêm pixel chỉ đổi cách phân bổ dân trong phường.
const axios = require('axios');

const EDITS_URL = 'https://storage.googleapis.com/hue-infra-data-us/pop/edits.json';
const TTL_MS = 5 * 60 * 1000;
const MAX_EDITS = 500;
const MAX_RING_POINTS = 500;
const MAX_CHARS = 2000000;

let cache = null; // { at, data: { saved, edits } }

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const isLat = (v) => typeof v === 'number' && v > 10 && v < 25;
const isLng = (v) => typeof v === 'number' && v > 100 && v < 115;

/** edits.json → { saved, edits } (chưa có file → rỗng; lỗi mạng → ném lỗi để không ghi đè nhầm) */
async function readPopEdits(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await axios.get(`${EDITS_URL}?v=${Date.now()}`, { timeout: 8000, validateStatus: () => true });
  let data;
  if (res.status === 404 || res.status === 403) data = { saved: 0, edits: [] };
  else if (res.status === 200 && res.data && res.data.v === 1 && Array.isArray(res.data.edits)) {
    data = { saved: Number(res.data.saved) || 0, edits: res.data.edits };
  } else throw new Error(`Không đọc được vùng hiệu chỉnh dân cư (HTTP ${res.status})`);
  cache = { at: Date.now(), data };
  return data;
}

function rememberPopEdits(payload) {
  cache = { at: Date.now(), data: { saved: payload.saved, edits: payload.edits } };
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
    if (!Array.isArray(e.ring) || e.ring.length < 3 || e.ring.length > MAX_RING_POINTS + 1) return null;
    const ring = [];
    for (const p of e.ring) {
      if (!Array.isArray(p) || p.length !== 2 || !isLng(p[0]) || !isLat(p[1])) return null;
      ring.push([round6(p[0]), round6(p[1])]);
    }
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    if (ring.length < 4) return null;
    const at = Math.round(Number(e.at));
    if (!(at > 0 && at < 1e14)) return null;
    ids.add(id);
    out.push({ id, op: e.op, name: String(e.name || '').trim().slice(0, 120), ring, at });
  }
  return out;
}

module.exports = { readPopEdits, rememberPopEdits, parsePopEdits, MAX_CHARS };
