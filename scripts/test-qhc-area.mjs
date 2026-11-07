import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zoneAreaHa, zoneAreaHtml } from '../public/js/qhc2045.js';

assert.equal(zoneAreaHa({ a: 12.5 }, 1), 12.5);
assert.equal(zoneAreaHa({ a: 0 }, 25000), 2.5);
assert.equal(zoneAreaHa({}, 10000), 1);
assert.equal(zoneAreaHa({}, 0), null);
assert.equal(zoneAreaHa(null, NaN), null);

const html = zoneAreaHtml({}, 12345670);
assert.match(html, /^<div class="qhc-pop-area">Diện tích: <b>1\.234,57 ha<\/b><\/div>$/);
assert.match(zoneAreaHtml({ a: 8.2 }, 0), /8,2 ha/);
assert.equal(zoneAreaHtml({}, 0), '');

const layer = fs.readFileSync(new URL('../public/js/qhc2045Layer.js', import.meta.url), 'utf8');
// Thẻ vùng 1/25.000: hecta qua zoneAreaHa (a hoặc turf.area); 1/10.000: fmtNum(p.a) trong metricCellsHtml
assert.match(layer, /zoneAreaHa\(f\.properties, areaM2\)/);
assert.match(layer, /label:\s*'Diện tích',\s*value:\s*`\$\{fmtNum\(p\.a\)\} ha`/);
console.log('ok');
