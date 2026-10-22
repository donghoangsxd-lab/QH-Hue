import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rate = require('../services/getRate.js');

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function mockReq(over) {
  return Object.assign({
    method: 'GET',
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {}
  }, over);
}

function burst(name, max, ip, method) {
  rate.resetRates();
  const opts = {
    name,
    max,
    windowMs: rate.WINDOW_MS,
    now: 1_000_000,
    message: 'đầy'
  };
  let blocked = 0;
  let last = null;
  for (let i = 0; i < max + 3; i++) {
    const res = mockRes();
    const stopped = rate.limitPublicGet(mockReq({
      method: method || 'GET',
      headers: { 'x-forwarded-for': ip }
    }), res, opts);
    if (stopped) {
      blocked++;
      last = res;
    }
  }
  assert.equal(blocked, 3);
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.error, true);
  assert.equal(last.body.message, 'đầy');
  assert.equal(last.headers['Cache-Control'], 'private, no-store');
  assert.ok(Number(last.headers['Retry-After']) >= 1);
  assert.ok(Number(last.headers['Retry-After']) <= 60);
}

burst('osm-clip', rate.OSM_MAX, '198.51.100.4');
burst('pmtiles-range', rate.PMTILES_MAX, '198.51.100.5');
burst('gee-read', rate.GEE_READ_MAX, '198.51.100.6', 'POST');

rate.resetRates();
const optRes = mockRes();
assert.equal(rate.limitPublicGet(mockReq({ method: 'OPTIONS' }), optRes, {
  name: 'osm-clip', max: 1, windowMs: rate.WINDOW_MS, now: 5
}), false);
assert.equal(optRes.statusCode, 0);
assert.equal(rate.limitPublicGet(mockReq({ headers: {} }), mockRes(), {
  name: 'osm-clip', max: 1, windowMs: rate.WINDOW_MS, now: 5
}), false);
const blockedOpt = mockRes();
assert.equal(rate.limitPublicGet(mockReq({ headers: {} }), blockedOpt, {
  name: 'osm-clip', max: 1, windowMs: rate.WINDOW_MS, now: 5, message: 'đầy'
}), true);

rate.resetRates();
const other = mockRes();
assert.equal(rate.limitPublicGet(mockReq({
  headers: { 'x-forwarded-for': '198.51.100.8' }
}), other, { name: 'osm-clip', max: 1, windowMs: rate.WINDOW_MS, now: 5 }), false);
assert.equal(other.statusCode, 0);

rate.resetRates();
const t0 = 10_000;
assert.equal(rate.limitPublicGet(mockReq(), mockRes(), {
  name: 'gee-read', max: 1, windowMs: 1000, now: t0
}), false);
const aged = mockRes();
assert.equal(rate.limitPublicGet(mockReq(), aged, {
  name: 'gee-read', max: 1, windowMs: 1000, now: t0 + 1000, message: 'đầy'
}), false);
assert.equal(aged.statusCode, 0);

rate.resetRates();
const readOpts = rate.geeLimitOpts('getWardStats');
const tileOpts = rate.geeLimitOpts('getSatTile');
assert.equal(readOpts.max, rate.GEE_READ_MAX);
assert.equal(tileOpts.max, rate.GEE_TILE_MAX);
assert.notEqual(readOpts.name, tileOpts.name);
assert.equal(rate.geeLimitOpts('getPopRasterTile').name, 'gee-tile');
for (let i = 0; i < readOpts.max; i++) {
  assert.equal(rate.limitPublicGet(mockReq(), mockRes(), { ...readOpts, now: 50 }), false);
}
assert.equal(rate.limitPublicGet(mockReq(), mockRes(), { ...tileOpts, now: 50 }), false);
const readBlocked = mockRes();
assert.equal(rate.limitPublicGet(mockReq(), readBlocked, { ...readOpts, now: 50 }), true);
assert.equal(readBlocked.statusCode, 429);

assert.equal(rate.clientIp({ headers: { 'x-forwarded-for': ' 203.0.113.7 , 1.1.1.1' } }), '203.0.113.7');
assert.equal(rate.clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');

const gee = fs.readFileSync(new URL('../api/gee.js', import.meta.url), 'utf8');
const osm = fs.readFileSync(new URL('../api/osmClip.js', import.meta.url), 'utf8');
const tiles = fs.readFileSync(new URL('../api/pmtilesRange.js', import.meta.url), 'utf8');
assert.match(gee, /limitPublicGet\(req, res, geeLimitOpts/);
assert.match(gee, /checkAddPointRate/);
assert.match(osm, /name: 'osm-clip'/);
assert.match(osm, /OSM_MAX/);
assert.match(tiles, /name: 'pmtiles-range'/);
assert.match(tiles, /PMTILES_MAX/);
assert.doesNotMatch(gee, /middleware/);
assert.equal(rate.OSM_MAX, 300);
assert.equal(rate.PMTILES_MAX, 2000);
assert.equal(rate.GEE_TILE_MAX, 2000);
assert.ok(rate.GEE_READ_MAX >= 600);

console.log('get rate ok');
