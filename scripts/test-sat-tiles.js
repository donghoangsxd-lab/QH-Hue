const assert = require('assert');
const tiles = require('../services/satTileCache');

const now = new Date('2026-10-22T04:00:00Z');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

assert.equal(tiles.classifyGee(200, png, 'image/png'), 'ok');
assert.equal(tiles.classifyGee(429, Buffer.from('Too Many Requests'), 'text/plain'), 'retry');
assert.equal(tiles.classifyGee(504, Buffer.from('deadline exceeded'), 'application/json'), 'retry');
assert.equal(tiles.classifyGee(500, Buffer.from('Earth Engine computation timed out'), 'text/plain'), 'retry');
assert.equal(tiles.classifyGee(400, Buffer.from('The map ID has expired'), 'application/json'), 'expired');
assert.equal(tiles.classifyGee(404, Buffer.from('not found'), 'text/plain'), 'expired');
assert.equal(tiles.classifyGee(400, Buffer.from('Tile request deadline exceeded'), 'application/json'), 'retry');

const ndvi = tiles.parseQuery({ layer: 'ndvi', year: '2020', z: '15', x: '26000', y: '14000' }, now);
assert.ok(ndvi && ndvi.durable);
assert.equal(tiles.objectName(ndvi), 'cache/sat/v1/ndvi/2020/15/26000/14000.png');
assert.equal(tiles.parseQuery({ layer: 'ndvi', year: '2020', z: '19', x: '1', y: '1' }, now), null);
assert.equal(tiles.parseQuery({ layer: 'ndvi', year: '2026', z: '15', x: '1', y: '1' }, now).durable, false);

const diff = tiles.parseQuery({ layer: 'ndvi', year: '2024', compare: '2020', z: '14', x: '1', y: '2' }, now);
assert.equal(tiles.seriesId(diff), '2024-2020');
assert.ok(diff.durable);
assert.match(tiles.template(diff), /action=getSatTile&layer=ndvi&year=2024&compare=2020&z=\{z\}&x=\{x\}&y=\{y\}/);
assert.match(tiles.tileUrls(diff, now).urlFormat, /storage\.googleapis\.com\/hue-infra-data-us\/cache\/sat\/v1\/ndvi\/2024-2020\/\{z\}\/\{x\}\/\{y\}\.png/);
assert.match(tiles.tileUrls(diff, now).fallbackFormat, /action=getSatTile/);
const live = tiles.parseQuery({ layer: 'ndvi', year: '2026', z: '15', x: '1', y: '1' }, now);
assert.equal(live.durable, false);
assert.match(tiles.tileUrls(live, now).urlFormat, /action=getSatTile/);
assert.equal(tiles.tileUrls(live, now).fallbackFormat, undefined);

const lst = tiles.meta({ layer: 'lst', year: '2024' }, now);
assert.equal(lst.maxNativeZoom, 14);
assert.ok(lst.legend.palette.length >= 5);
assert.match(lst.urlFormat, /cache\/sat\/v1\/lst\/2024\/\{z\}\/\{x\}\/\{y\}\.png/);
assert.match(lst.fallbackFormat, /layer=lst&year=2024/);

assert.equal(tiles.parseQuery({ layer: 'sar', year: 'all', z: '15', x: '1', y: '1' }, now).durable, true);
assert.equal(tiles.parseQuery({ layer: 'forest', mode: 'cover', z: '14', x: '3', y: '4' }, now).durable, true);
assert.equal(tiles.parseQuery({ layer: 'forest', mode: 'nope', z: '14', x: '1', y: '1' }, now), null);
const dev = tiles.parseQuery({ layer: 'dev', from: '2020', z: '15', x: '8', y: '9' }, now);
assert.ok(dev && dev.durable);
assert.match(tiles.objectName(dev), /^cache\/sat\/v1\/dev\/2020-\d+\/15\/8\/9\.png$/);
assert.equal(tiles.parseQuery({ layer: 'dev', from: '2020', z: '11', x: '1', y: '1' }, now), null);

const headers = tiles.pngHeaders(true, 'hit');
assert.match(headers['Cache-Control'], /immutable/);
assert.equal(headers['Content-Type'], 'image/png');
assert.match(tiles.pngHeaders(false, 'gee')['Cache-Control'], /max-age=300/);
assert.equal(tiles.fillTemplate('https://example.test/tiles/{z}/{x}/{y}', 15, 3, 4), 'https://example.test/tiles/15/3/4');

console.log('test-sat-tiles ok');
