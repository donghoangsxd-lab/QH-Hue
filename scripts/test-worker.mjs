import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allow, apiMax, routeKind, objectNameFromPath, proxyApi } from '../worker/index.js';
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
assert.match(wrangler, /"main": "worker\/index.js"/);
assert.match(wrangler, /\/api\/\*/);
assert.match(wrangler, /buildings\.pmtiles/);
assert.doesNotMatch(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /"crons"/);

console.log('test-worker ok');
