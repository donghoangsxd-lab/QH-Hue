import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WARD_NAMES } from '../public/js/facetStore.js';

const doc = JSON.parse(fs.readFileSync(new URL('../public/data/htkt/cap-nuoc-qhc25.json', import.meta.url), 'utf8'));
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] == null ? 0 : Number(row[key])), 0);

assert.equal(doc.vung.length, 9);
assert.equal(sum(doc.vung, 'nhuCau2030'), doc.nhuCau.tongVung['2030']);
assert.equal(sum(doc.vung, 'nhuCau2045'), doc.nhuCau.tongVung['2045']);
assert.equal(doc.nhuCau.tongVung['2030'], 470000);
assert.equal(doc.nhuCau.tongVung['2045'], 605000);
assert.equal(sum(doc.nhaMay, 'cs2022'), doc.congSuat.congO['2022']);
assert.equal(sum(doc.nhaMay, 'cs2030'), doc.congSuat.congO['2030']);
assert.equal(sum(doc.nhaMay, 'cs2045'), doc.congSuat.congO['2045']);
assert.equal(doc.congSuat.bang['2030'], 520000);
assert.equal(doc.congSuat.congO['2030'], 520000);
assert.equal(doc.congSuat.bang['2045'], 775000);

const wards = doc.vung.flatMap(zone => zone.xa);
assert.equal(wards.length, 40);
assert.equal(new Set(wards).size, 40);
assert.deepEqual([...wards].sort(), [...WARD_NAMES].sort());

const fc = JSON.parse(fs.readFileSync(new URL(`../${doc.nguon.lopDiem}`, import.meta.url), 'utf8'));
const onLayer = new Map(fc.features.map(feature => [String(feature.properties.madoituong), feature.properties.tencongtrinh]));
assert.equal(onLayer.size, 52);
const seen = new Set();
for (const row of doc.nhaMay) {
  if (row.ma == null) continue;
  assert.equal(onLayer.get(String(row.ma)), row.tenLop, row.id);
  assert.ok(!seen.has(String(row.ma)), row.ma);
  seen.add(String(row.ma));
}
for (const row of doc.diemNho) {
  assert.equal(onLayer.get(String(row.ma)), row.ten, row.ma);
  assert.ok(!seen.has(String(row.ma)), row.ma);
  seen.add(String(row.ma));
}
assert.equal(seen.size, 52);
for (const ma of onLayer.keys()) assert.ok(seen.has(ma), `thiếu mã ${ma}`);

const group = doc.nhaMay.filter(row => ['a-lin', 'a-sap', 'lam-dot'].includes(row.id));
assert.equal(sum(group, 'cs2030'), 4000);
assert.equal(sum(group, 'cs2045'), 12000);
assert.equal(doc.congSuat.congO['2045'], 783500);
