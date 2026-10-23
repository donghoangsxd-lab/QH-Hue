import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cacheControlFor, IMMUTABLE, INFRA_JSON } from '../config/gcsCachePolicy.mjs';
import { plan, parseArgs } from './apply-gcs-cache.mjs';

const require = createRequire(import.meta.url);
const { revisionUrl, needsRevisionCheck, RECHECK_MS } = require('../services/gcsRevision.js');

const base = 'https://storage.googleapis.com/hue-infra-data-us/infrastructure_hue.json';
assert.equal(revisionUrl(base, ''), base);
assert.equal(revisionUrl(base, '171'), `${base}?v=171`);
assert.equal(needsRevisionCheck(null, 1_000, false), true);
assert.equal(needsRevisionCheck({ generation: '9', checkedAt: 1_000 }, 1_000 + RECHECK_MS - 1, false), false);
assert.equal(needsRevisionCheck({ generation: '9', checkedAt: 1_000 }, 1_000 + RECHECK_MS, false), true);
assert.equal(needsRevisionCheck({ generation: '9', checkedAt: 1_000 }, 1_500, true), true);
assert.doesNotMatch(revisionUrl(base, '171'), /Date\.now|v=\d{13}/);

assert.equal(cacheControlFor('cadastre/thuadat-2016.pmtiles'), IMMUTABLE);
assert.equal(cacheControlFor('gba/buildings.pmtiles'), IMMUTABLE);
assert.equal(cacheControlFor('cache/sat/v1/ndvi/2024/12/1/2.png'), IMMUTABLE);
assert.equal(cacheControlFor('chuyen-nganh/v1/qhc/sdd/hien-trang/a.geojson'), IMMUTABLE);
assert.equal(cacheControlFor('infrastructure_hue.json'), INFRA_JSON);
assert.equal(cacheControlFor('kien-truc/dothi-vinh-thanh/quy-che.pdf'), INFRA_JSON);
assert.equal(cacheControlFor('projects/a/lots.json'), '');
assert.equal(cacheControlFor('../secrets.json'), 'private, no-store');
assert.equal(plan('gba/buildings.pmtiles', '').change, true);
assert.equal(plan('gba/buildings.pmtiles', IMMUTABLE).change, false);
assert.equal(plan('roads/v2/index.json', '').change, false);
assert.deepEqual(parseArgs(['--apply', '--prefix=cache/sat/v1/']), { apply: true, prefix: 'cache/sat/v1/' });

const gcs = require('fs').readFileSync(new URL('../services/gcsService.js', import.meta.url), 'utf8');
const slice = gcs.slice(gcs.indexOf('async function getRawDataList'), gcs.indexOf('async function getCadParcels'));
assert.match(gcs, /revisionUrl/);
assert.doesNotMatch(slice, /bypassEdge/);
assert.doesNotMatch(slice, /\?v=\$\{Date\.now/);

console.log('test-gcs-budget ok');
