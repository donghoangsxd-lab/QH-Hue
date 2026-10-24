// Proxy /api sang Cloud Run và file >25 MiB sang GCS, có cache biên.
// Đường tĩnh khác vẫn do asset phục vụ (run_worker_first không gọi file này).
import { cacheControlFor, edgeCacheable } from '../config/gcsCachePolicy.mjs';

const GCS = 'https://storage.googleapis.com/hue-infra-data-us/';
const LARGE = new Set(['data/gba/buildings.pmtiles']);
const GCS_MAX = 2000;
const WINDOW_MS = 60 * 1000;
const STORE_MAX = 8_000_000;
const apiHits = new Map();
const gcsHits = new Map();

export function allow(store, key, now, max, windowMs) {
  const list = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    store.set(key, list);
    return false;
  }
  list.push(now);
  if (store.size > 5000) store.clear();
  store.set(key, list);
  return true;
}

export function apiMax(url) {
  const u = new URL(url, 'https://qh-hue.example/');
  if (u.pathname === '/api/pmtilesRange') return 2000;
  if (u.pathname === '/api/osmClip') return 300;
  const action = u.searchParams.get('action') || '';
  if (action === 'getSatTile' || action === 'getPopRasterTile') return 2000;
  return 600;
}

export function routeKind(pathname) {
  const path = String(pathname || '');
  if (path === '/api' || path.startsWith('/api/')) return 'api';
  if (path === '/gcs' || path.startsWith('/gcs/')) return 'gcs';
  if (LARGE.has(path.replace(/^\//, ''))) return 'large';
  return 'asset';
}

export function objectNameFromPath(pathname, kind) {
  if (kind === 'large') return 'gba/buildings.pmtiles';
  let raw = String(pathname || '').replace(/^\/gcs\/?/, '');
  if (!raw || raw.includes('..') || raw.includes('\\') || raw.includes('\0')) return '';
  try { raw = raw.split('/').map((part) => decodeURIComponent(part)).join('/'); } catch (e) { return ''; }
  if (!raw || raw.startsWith('/') || raw.includes('..')) return '';
  if (raw === 'cho-duyet' || raw.startsWith('cho-duyet/')) return '';
  return raw;
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function limited(message) {
  return new Response(JSON.stringify({ error: true, message }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'retry-after': '60'
    }
  });
}

function cors(headers) {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Cache-Control, cf-cache-status, x-qh-cache');
  return headers;
}

// Chỉ nhận một đoạn đóng bytes=start-end, không quá STORE_MAX. bytes=0- và nhiều đoạn không lưu.
export function normalizeByteRange(range) {
  const text = String(range || '').trim();
  if (!text) return '';
  const m = /^bytes=(\d+)-(\d+)$/i.exec(text);
  if (!m) return '';
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return '';
  const span = end - start + 1;
  if (span <= 0 || span > STORE_MAX) return '';
  return `bytes=${start}-${end}`;
}

// Khóa = đường dẫn + ?v= (nếu có) + khoảng byte đã chuẩn hóa. Tham số khác không tách cache.
export function gcsCacheUrl(requestUrl, normalizedRange) {
  const url = new URL(requestUrl);
  const key = new URL(`${url.origin}${url.pathname}`);
  const version = url.searchParams.get('v');
  if (version) key.searchParams.set('v', version);
  if (normalizedRange) key.searchParams.set('__range', normalizedRange);
  return key.toString();
}

function stampCache(headers, state) {
  // CDN không gắn HIT cho phản hồi 206. Worker tự ghi; x-qh-cache phòng khi mép gỡ cf-cache-status.
  headers.set('cf-cache-status', state);
  headers.set('x-qh-cache', state);
  return headers;
}

export async function proxyApi(request, env, ctx, now = Date.now()) {
  if (request.method !== 'OPTIONS' && !allow(apiHits, clientIp(request), now, apiMax(request.url), WINDOW_MS)) {
    return limited('Quá nhiều yêu cầu, vui lòng chậm lại');
  }
  const upstream = String((env && env.API_UPSTREAM) || '').trim().replace(/\/$/, '');
  if (!upstream) {
    return new Response(JSON.stringify({
      error: true,
      message: 'Chưa đặt API_UPSTREAM (URL Cloud Run, không có dấu / cuối)'
    }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, upstream);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const req = new Request(target.toString(), {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual'
  });
  const cacheable = method === 'GET' && !request.headers.get('range') && !request.headers.get('authorization');
  const cache = cacheable && typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    return new Response(JSON.stringify({ error: true, message: 'Không gọi được API' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  const cc = res.headers.get('cache-control') || '';
  const shared = /s-maxage=\d+/.test(cc) && !/no-store|private/i.test(cc);
  if (cache && res.ok && shared && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

function fromCache(hit) {
  const partial = hit.headers.get('x-stored-status') === '206';
  const headers = cors(new Headers());
  const type = hit.headers.get('content-type');
  if (type) headers.set('content-type', type);
  const len = hit.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const cc = hit.headers.get('cache-control');
  if (cc) headers.set('cache-control', cc);
  headers.set('accept-ranges', 'bytes');
  if (partial) headers.set('content-range', hit.headers.get('x-content-range') || '');
  stampCache(headers, 'HIT');
  return new Response(hit.body, { status: partial ? 206 : (hit.status || 200), headers });
}

async function remember(cache, key, res) {
  if (res.status === 206) {
    const headers = {
      'content-type': res.headers.get('content-type') || 'application/octet-stream',
      'cache-control': res.headers.get('cache-control') || '',
      'x-content-range': res.headers.get('content-range') || '',
      'x-stored-status': '206'
    };
    const len = res.headers.get('content-length');
    if (len) headers['content-length'] = len;
    await cache.put(key, new Response(res.body, { status: 200, headers }));
    return;
  }
  if (res.status === 200) await cache.put(key, res);
}

export async function proxyGcs(request, ctx, objectName, now = Date.now()) {
  if (request.method === 'OPTIONS') {
    const headers = cors(new Headers());
    headers.set('access-control-allow-methods', 'GET, HEAD');
    headers.set('access-control-allow-headers', 'Range');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'cache-control': 'no-store' } });
  }
  if (!objectName) return new Response('Đường dẫn không hợp lệ', { status: 400, headers: { 'cache-control': 'no-store' } });
  const policy = cacheControlFor(objectName) || 'public, max-age=3600';
  const rawRange = request.headers.get('range');
  const normalized = rawRange ? normalizeByteRange(rawRange) : '';
  const cacheableRange = !rawRange || !!normalized;
  const cache = edgeCacheable(policy) && request.method === 'GET' && cacheableRange && typeof caches !== 'undefined'
    ? caches.default
    : null;
  const cacheKey = cache ? new Request(gcsCacheUrl(request.url, normalized), { method: 'GET' }) : null;
  if (cache && cacheKey) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return fromCache(hit);
    } catch (e) { /* biên lỗi thì đọc GCS */ }
  }
  if (!allow(gcsHits, clientIp(request), now, GCS_MAX, WINDOW_MS)) {
    return limited('Quá nhiều ô bản đồ, vui lòng chậm lại');
  }
  const target = GCS + objectName.split('/').map((part) => encodeURIComponent(part)).join('/');
  const headers = new Headers();
  if (rawRange) headers.set('range', normalized || rawRange);
  let res;
  try {
    res = await fetch(target, { method: request.method, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: true, message: 'Không đọc được bucket' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  const outHeaders = new Headers();
  const type = res.headers.get('content-type');
  if (type) outHeaders.set('content-type', type);
  const len = res.headers.get('content-length');
  if (len) outHeaders.set('content-length', len);
  const contentRange = res.headers.get('content-range');
  if (contentRange) outHeaders.set('content-range', contentRange);
  outHeaders.set('accept-ranges', 'bytes');
  outHeaders.set('cache-control', policy);
  stampCache(outHeaders, cache ? 'MISS' : 'BYPASS');
  cors(outHeaders);
  const out = new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: outHeaders });
  const size = Number(len || 0);
  const store = cache && Number.isFinite(size) && size > 0 && size <= STORE_MAX && (res.status === 206 || res.status === 200);
  if (store && ctx && ctx.waitUntil) ctx.waitUntil(remember(cache, cacheKey, out.clone()).catch(() => {}));
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kind = routeKind(url.pathname);
    if (kind === 'asset') return env.ASSETS.fetch(request);
    if (kind === 'api') return proxyApi(request, env, ctx);
    return proxyGcs(request, ctx, objectNameFromPath(url.pathname, kind));
  }
};
