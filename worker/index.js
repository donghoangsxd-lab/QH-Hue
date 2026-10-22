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
  headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Cache-Control');
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
  if (hit.headers.get('x-stored-status') !== '206') return hit;
  const headers = cors(new Headers({
    'content-type': hit.headers.get('content-type') || 'application/octet-stream',
    'content-range': hit.headers.get('x-content-range') || '',
    'accept-ranges': 'bytes',
    'cache-control': hit.headers.get('cache-control') || ''
  }));
  return new Response(hit.body, { status: 206, headers });
}

async function remember(cache, key, res) {
  if (res.status === 206) {
    await cache.put(key, new Response(res.body, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/octet-stream',
        'cache-control': res.headers.get('cache-control') || '',
        'x-content-range': res.headers.get('content-range') || '',
        'x-stored-status': '206'
      }
    }));
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
  if (!allow(gcsHits, clientIp(request), now, GCS_MAX, WINDOW_MS)) {
    return limited('Quá nhiều ô bản đồ, vui lòng chậm lại');
  }
  const policy = cacheControlFor(objectName) || 'public, max-age=3600';
  const range = request.headers.get('range');
  const keyUrl = new URL(request.url);
  keyUrl.hash = '';
  if (range) keyUrl.searchParams.set('__range', range);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const cache = edgeCacheable(policy) && request.method === 'GET' && typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return fromCache(hit);
  }
  const target = GCS + objectName.split('/').map((part) => encodeURIComponent(part)).join('/');
  const headers = new Headers();
  if (range) headers.set('range', range);
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
  cors(outHeaders);
  const out = new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: outHeaders });
  const size = Number(len || 0);
  const store = cache && (res.status === 206 || (res.status === 200 && size > 0 && size <= STORE_MAX));
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
