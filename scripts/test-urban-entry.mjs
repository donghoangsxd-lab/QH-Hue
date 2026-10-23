import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure2A, planUrbanOf } from '../public/js/urbanClass.js';
import { EVAL_URBANS, ENTRY_FIELDS, MANUAL_2A, MANUAL_I, gapCounts, gapMarkdown, gapRows } from '../public/js/urbanEntrySchema.js';
import { PART_BOUNDS, pointInFeature, setPartGeoms, shareOf } from '../public/js/urbanPartGeom.js';

assert.equal(EVAL_URBANS.length, 16);
EVAL_URBANS.forEach(u => {
  const live = planUrbanOf(u.id);
  assert.ok(live, u.id);
  assert.equal(live.cls, u.cls);
  assert.equal(live.partial || '', u.partial || '');
});

assert.equal(MANUAL_2A['2A.II.05'].key, 'ldPhiNong');
assert.equal(MANUAL_2A['2A.I.01'].qual, true);
assert.equal(MANUAL_2A['2A.II.03'], undefined);
assert.equal(MANUAL_I['1.I.01'], 'i01');
assert.equal(MANUAL_I['1.II.10'], undefined);
ENTRY_FIELDS.forEach(f => assert.ok(f.key && f.label && f.scopes.length));

const rows = gapRows();
const counts = gapCounts();
assert.equal(counts.partialDanSo, 6);
assert.equal(counts.wards, 40);
assert.ok(counts.thieu > 100);
const partialPop = rows.filter(r => r.unitKey === 'dothi:vinh-thanh' && r.field === 'Dân số phần đô thị');
assert.equal(partialPop[0].status, 'phu-thuoc');
const fullPop = rows.filter(r => r.unitKey === 'dothi:trung-tam' && r.field === 'Dân số phần đô thị');
assert.equal(fullPop[0].status, 'co-san');
const ward = rows.find(r => r.unitKey === 'xa:phu-vinh' && r.field === 'Dân số phần đô thị');
assert.equal(ward.status, 'phu-thuoc');
const boundRow = rows.find(r => r.unitKey === 'dothi:vinh-thanh' && r.field === 'Ranh giới đô thị');
assert.equal(boundRow.status, 'co-san');
const areaRow = rows.find(r => r.unitKey === 'xa:phu-vinh' && r.field === 'Diện tích phần đô thị');
assert.equal(areaRow.status, 'co-san');
const plain = rows.find(r => r.unitKey === 'xa:thuan-hoa' && r.field === 'Dân số cả xã, phường');
assert.equal(plain.status, 'co-san');
assert.equal(gapMarkdown().includes('ChiTieuDoThi'), true);
assert.equal(gapMarkdown().includes('| Đô thị mới Vinh Thanh |'), true);
const report = readFileSync(new URL('../docs/thieu-chi-tieu-do-thi.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
assert.equal(report, gapMarkdown().trim());

const fc = JSON.parse(readFileSync(new URL('../public/data/urban614.geojson', import.meta.url), 'utf8'));
setPartGeoms(fc);
Object.entries(PART_BOUNDS).forEach(([id, bound]) => {
  const feature = fc.features.find(f => f.properties.id === id);
  assert.ok(feature, id);
  assert.equal(feature.properties.km2, bound.km2);
  const ring = feature.geometry.coordinates[0];
  let lng = 0;
  let lat = 0;
  ring.forEach(p => { lng += p[0]; lat += p[1]; });
  lng /= ring.length;
  lat /= ring.length;
  assert.equal(pointInFeature(feature, lng, lat), true, id);
  assert.equal(pointInFeature(feature, 0, 0), false);
});
const share = shareOf('khe-tre', 256.02);
assert.ok(Math.abs(share.share - 4.34 / 256.02) < 1e-12);
const khe = fc.features.find(f => f.properties.id === 'khe-tre');
const ring = khe.geometry.coordinates[0];
let lng = 0;
let lat = 0;
ring.forEach(p => { lng += p[0]; lat += p[1]; });
lng /= ring.length;
lat /= ring.length;
const wards = [{
  Ten_Phuong: 'Xã Khe Tre',
  Dan_So_Vector: 10000,
  Dien_Tich_Km2: 256.02,
  network: { nt: [{ ntKind: 'funeral', lat, lng }, { ntKind: 'funeral', lat: 0, lng: 0 }] }
}];
const pop = measure2A('2A.II.03', planUrbanOf('khe-tre'), wards);
assert.equal(pop.m.partial, true);
assert.ok(Math.abs(pop.m.value - 10000 * share.share) < 0.01);
const funeral = measure2A('2A.III.13', planUrbanOf('khe-tre'), wards);
assert.equal(funeral.m.value, 1);
const area = measure2A('2A.II.04', planUrbanOf('khe-tre'), wards);
assert.ok(Math.abs(area.m.value - (10000 * share.share) / 4.34) < 0.01);

console.log('urban entry ok', counts);
