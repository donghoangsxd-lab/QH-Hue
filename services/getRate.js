'use strict';

// Bộ đếm trong RAM của từng isolate Vercel. Request do CDN trả cache không vào hàm nên không bị đếm
// và không tốn Fluid CPU. Không dùng middleware: middleware chạy cả với file tĩnh.

const WINDOW_MS = 60 * 1000;
// Đọc JSON (phường, thoát nước, hồ sơ). Prefetch mũi tên z12 là khoảng 150 ô, cộng các GET lớp khác
// trong cùng một phút và vài máy chung IP — 300 sẽ cắt lớp thoát nước lúc cache biên còn lạnh.
const GEE_READ_MAX = 600;
// Ô getSatTile / getPopRasterTile: một khung nhìn là nhiều ô, tách khỏi ngân sách đọc JSON.
const GEE_TILE_MAX = 2000;
const OSM_MAX = 300;
const PMTILES_MAX = 2000;
const TILE_ACTIONS = new Set(['getSatTile', 'getPopRasterTile']);

const stores = new Map();

function storeFor(name) {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function clientIp(req) {
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  const sock = req && req.socket && req.socket.remoteAddress;
  return String(fwd || sock || 'unknown').split(',')[0].trim() || 'unknown';
}

function allow(store, ip, max, windowMs, now) {
  const hits = (store.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    store.set(ip, hits);
    const retryMs = hits.length ? windowMs - (now - hits[0]) : windowMs;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  hits.push(now);
  if (store.size > 5000) store.clear();
  store.set(ip, hits);
  return { ok: true };
}

function resetRates() {
  stores.clear();
}

// Trả true khi đã gửi 429 — handler phải return ngay. OPTIONS không tính.
function limitPublicGet(req, res, opts) {
  if (!req || req.method === 'OPTIONS') return false;
  if (opts.methods && opts.methods.indexOf(req.method) === -1) return false;
  const now = opts.now == null ? Date.now() : opts.now;
  const result = allow(storeFor(opts.name), clientIp(req), opts.max, opts.windowMs, now);
  if (result.ok) return false;
  res.setHeader('Retry-After', String(result.retryAfter));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(429).json({
    error: true,
    message: opts.message || 'Quá nhiều yêu cầu, vui lòng thử lại sau'
  });
  return true;
}

function geeLimitOpts(action) {
  const tile = TILE_ACTIONS.has(String(action || ''));
  return {
    name: tile ? 'gee-tile' : 'gee-read',
    max: tile ? GEE_TILE_MAX : GEE_READ_MAX,
    windowMs: WINDOW_MS,
    message: tile
      ? 'Quá nhiều ô bản đồ, vui lòng chậm lại một chút'
      : 'Quá nhiều yêu cầu đọc, vui lòng thử lại sau một phút'
  };
}

module.exports = {
  WINDOW_MS,
  GEE_READ_MAX,
  GEE_TILE_MAX,
  OSM_MAX,
  PMTILES_MAX,
  TILE_ACTIONS,
  limitPublicGet,
  geeLimitOpts,
  clientIp,
  resetRates
};
