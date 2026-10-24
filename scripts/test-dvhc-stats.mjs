import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { WARD_NAMES } from '../public/js/facetStore.js';
import { DVHC_CITY, DVHC_WARDS, dvhcOf } from '../public/js/dvhcStats.js';

const require = createRequire(import.meta.url);
const { WARD_AREA_KM2 } = require('../config/constants.js');

const csv = fs.readFileSync(new URL('../public/data/gba/pop-compare.csv', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const pop = new Map();
for (const line of csv.split(/\n/)) {
  const cols = line.split(',');
  if (cols[2] === 'dan_so') pop.set(cols[0], Number(cols[3]));
}

assert.equal(WARD_NAMES.length, 40);
assert.equal(Object.keys(DVHC_WARDS).length, 40);
assert.deepEqual(Object.keys(DVHC_WARDS).sort(), Object.keys(WARD_AREA_KM2).sort());
for (const name of WARD_NAMES) {
  const row = dvhcOf(name);
  assert.ok(row, name);
  assert.equal(row.pop, pop.get(name), name);
  assert.equal(row.km2, WARD_AREA_KM2[name], name);
}
const sumPop = WARD_NAMES.reduce((sum, name) => sum + DVHC_WARDS[name].pop, 0);
const sumKm = Math.round(WARD_NAMES.reduce((sum, name) => sum + DVHC_WARDS[name].km2, 0) * 100) / 100;
assert.equal(pop.get('Thành phố Huế'), sumPop);
assert.equal(DVHC_CITY.name, 'Thành phố Huế');
assert.equal(DVHC_CITY.pop, sumPop);
assert.equal(DVHC_CITY.km2, sumKm);
assert.equal(dvhcOf('Thành phố Huế').pop, DVHC_CITY.pop);
assert.equal(dvhcOf('không có'), null);

console.log('dvhc stats ok');
