import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allow, apiMax, routeKind, objectNameFromPath, proxyApi, proxyGcs, normalizeByteRange, gcsCacheUrl } from '../worker/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { allow: allowNode } = require('../services/rateWindow.js');

const store = new Map();
assert.equal(allow(store, 'a', 0, 2, 1000), true);
assert.equal(allow(store, 'a', 10, 2, 1000), true);
assert.equal(allow(store, 'a', 20, 2, 1000), false);
assert.equal(allow(store, 'a', 2000, 2, 1000), true);
const store2 = new Map();
assert.equal(allowNode(store2, 'a', 0, 2, 1000), true);
assert.equal(allowNode(store2, 'a', 10, 2, 1000), true);
assert.equal(allowNode(store2, 'a', 20, 2, 1000), false);

assert.equal(apiMax('https://qh-hue.example/api/gee?action=getWardStats'), 600);
assert.equal(apiMax('https://qh-hue.example/api/gee?action=getSatTile'), 2000);
assert.equal(apiMax('https://qh-hue.example/api/gee?action=getPopRasterTile'), 2000);
assert.equal(apiMax('https://qh-hue.example/api/osmClip?lat=16.46&lng=107.58&r=300'), 300);
assert.equal(apiMax('https://qh-hue.example/api/pmtilesRange?file=gba'), 2000);
assert.equal(routeKind('/api/gee'), 'api');
assert.equal(routeKind('/gcs/cadastre/thuadat-2016.pmtiles'), 'gcs');
assert.equal(routeKind('/data/gba/buildings.pmtiles'), 'large');
assert.equal(routeKind('/js/app.js'), 'asset');
assert.equal(objectNameFromPath('/data/gba/buildings.pmtiles', 'large'), 'gba/buildings.pmtiles');
assert.equal(objectNameFromPath('/gcs/cache/sat/v1/ndvi/2020/12/1/2.png', 'gcs'), 'cache/sat/v1/ndvi/2020/12/1/2.png');
assert.equal(objectNameFromPath('/gcs/../secret', 'gcs'), '');
assert.equal(objectNameFromPath('/gcs/cho-duyet/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', 'gcs'), '');

const missing = await proxyApi(new Request('https://qh-hue.example.workers.dev/api/gee'), {}, null);
assert.equal(missing.status, 503);
const body = await missing.json();
assert.match(body.message, /API_UPSTREAM/);

const src = fs.readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
assert.match(src, /function directTiles/);
assert.match(src, /if \(directTiles\(\)\) return gcs/);
assert.match(src, /workers\.dev/);
assert.match(src, /data\/gba\/buildings\.pmtiles/);
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.match(wrangler, /"keep_vars": true/);
assert.doesNotMatch(wrangler, /run\.app/);
assert.match(wrangler, /"main": "worker\/index.js"/);
assert.match(wrangler, /\/api\/\*/);
assert.match(wrangler, /buildings\.pmtiles/);
assert.doesNotMatch(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /"crons"/);

assert.equal(normalizeByteRange('bytes=0-16383'), 'bytes=0-16383');
assert.equal(normalizeByteRange(' BYTES=8-15 '), 'bytes=8-15');
assert.equal(normalizeByteRange('bytes=0-'), '');
assert.equal(normalizeByteRange('bytes=5-4'), '');
assert.equal(normalizeByteRange('bytes=0-16383, 20-30'), '');
assert.equal(
  gcsCacheUrl('https://qh-hue.donghoangsxd.workers.dev/data/gba/buildings.pmtiles?x=1&v=abc', 'bytes=0-15'),
  'https://qh-hue.donghoangsxd.workers.dev/data/gba/buildings.pmtiles?v=abc&__range=bytes%3D0-15'
);

const mem = new Map();
const prevCaches = globalThis.caches;
const prevFetch = globalThis.fetch;
const fetches = [];
globalThis.caches = {
  default: {
    async match(req) {
      const hit = mem.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const buf = await res.arrayBuffer();
      mem.set(req.url, new Response(buf, { status: res.status, headers: res.headers }));
    }
  }
};
globalThis.fetch = async (url, init) => {
  const range = init && init.headers && init.headers.get ? init.headers.get('range') : '';
  fetches.push(String(url) + '|' + (range || ''));
  const m = /^bytes=(\d+)-(\d+)$/.exec(range || '');
  const start = m ? Number(m[1]) : 0;
  const end = m ? Number(m[2]) : 15;
  const len = end - start + 1;
  return new Response(new Uint8Array(len), {
    status: m ? 206 : 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(len),
      'content-range': m ? `bytes ${start}-${end}/99` : undefined,
      'accept-ranges': 'bytes'
    }
  });
};

function drainCtx() {
  const jobs = [];
  return {
    waitUntil(p) { jobs.push(p); },
    done: () => Promise.all(jobs)
  };
}

const ip = { 'cf-connecting-ip': '203.0.113.8' };
const now = 1_700_000_000_000;
const tile = 'https://qh-hue.donghoangsxd.workers.dev/data/gba/buildings.pmtiles?v=rel-1&utm=noise';
const ctx1 = drainCtx();
const first = await proxyGcs(new Request(tile, { headers: { ...ip, range: 'bytes=0-15' } }), ctx1, 'gba/buildings.pmtiles', now);
assert.equal(first.status, 206);
assert.equal(first.headers.get('cf-cache-status'), 'MISS');
assert.equal(first.headers.get('x-qh-cache'), 'MISS');
assert.equal(first.headers.get('content-range'), 'bytes 0-15/99');
await first.arrayBuffer();
await ctx1.done();
assert.equal(fetches.length, 1);
assert.match(fetches[0], /\/gba\/buildings\.pmtiles\|bytes=0-15$/);

const second = await proxyGcs(new Request(tile, { headers: { ...ip, range: 'BYTES=0-15' } }), drainCtx(), 'gba/buildings.pmtiles', now);
assert.equal(second.status, 206);
assert.equal(second.headers.get('cf-cache-status'), 'HIT');
assert.equal(second.headers.get('x-qh-cache'), 'HIT');
assert.equal(second.headers.get('content-range'), 'bytes 0-15/99');
assert.equal(fetches.length, 1);

const otherVersion = await proxyGcs(
  new Request('https://qh-hue.donghoangsxd.workers.dev/data/gba/buildings.pmtiles?v=rel-2', { headers: { ...ip, range: 'bytes=0-15' } }),
  drainCtx(),
  'gba/buildings.pmtiles',
  now
);
await otherVersion.arrayBuffer();
assert.equal(otherVersion.headers.get('cf-cache-status'), 'MISS');
assert.equal(fetches.length, 2);

const cadCtx = drainCtx();
const cad = await proxyGcs(
  new Request('https://qh-hue.donghoangsxd.workers.dev/gcs/cadastre/thuadat-2016.pmtiles', { headers: { ...ip, range: 'bytes=100-115' } }),
  cadCtx,
  'cadastre/thuadat-2016.pmtiles',
  now
);
assert.equal(cad.headers.get('cf-cache-status'), 'MISS');
await cad.arrayBuffer();
await cadCtx.done();
const cadHit = await proxyGcs(
  new Request('https://qh-hue.donghoangsxd.workers.dev/gcs/cadastre/thuadat-2016.pmtiles?x=1', { headers: { ...ip, range: 'bytes=100-115' } }),
  drainCtx(),
  'cadastre/thuadat-2016.pmtiles',
  now
);
assert.equal(cadHit.headers.get('cf-cache-status'), 'HIT');
assert.equal(fetches.length, 3);

const open = await proxyGcs(
  new Request(tile, { headers: { ...ip, range: 'bytes=0-' } }),
  drainCtx(),
  'gba/buildings.pmtiles',
  now
);
assert.equal(open.headers.get('cf-cache-status'), 'BYPASS');
await open.arrayBuffer();
assert.equal(fetches.length, 4);

for (let i = 1; i <= 1996; i++) {
  const end = 20 + i;
  const miss = await proxyGcs(
    new Request(tile, { headers: { ...ip, range: `bytes=20-${end}` } }),
    drainCtx(),
    'gba/buildings.pmtiles',
    now
  );
  assert.equal(miss.status, 206);
  await miss.arrayBuffer();
}
const stillCached = await proxyGcs(new Request(tile, { headers: { ...ip, range: 'bytes=0-15' } }), drainCtx(), 'gba/buildings.pmtiles', now);
assert.equal(stillCached.status, 206);
assert.equal(stillCached.headers.get('cf-cache-status'), 'HIT');
const blocked = await proxyGcs(
  new Request(tile, { headers: { ...ip, range: 'bytes=4000-4007' } }),
  drainCtx(),
  'gba/buildings.pmtiles',
  now
);
assert.equal(blocked.status, 429);

globalThis.caches = prevCaches;
globalThis.fetch = prevFetch;

console.log('test-worker ok');
