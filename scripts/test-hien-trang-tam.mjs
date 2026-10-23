import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNKNOWN_SCALE, compareRank, declaredScale, familyOf, geomContains, mergeRecords, nhomOf, rankOf, ringContains
} from './hien-trang-tam.mjs';
import { toFeatureCollection } from '../public/js/geoDoc.js';

const fine = rankOf({ slug: 'a', scale: 10000, priority: 1 }, null);
const coarse = rankOf({ slug: 'b', scale: 25000, priority: 1 }, null);
const local = rankOf({ slug: 'c', decisionDate: '2025-01-21', priority: 1 }, null);
const older = rankOf({ slug: 'd', scale: 5000, decisionDate: '2020-03-13', priority: 1 }, null);
assert.ok(compareRank(fine, coarse) < 0);
assert.equal(local.scale, UNKNOWN_SCALE);
assert.ok(compareRank(local, fine) < 0);
assert.ok(compareRank(local, older) < 0);
assert.equal(declaredScale(null, null), null);
assert.equal(declaredScale(2000, null), 2000);
assert.equal(nhomOf('Hiện trạng mạng lưới giao thông đường sắt'), 'duong-sat');
assert.equal(nhomOf('Hiện trạng mặt cắt'), 'mat-cat');
assert.equal(familyOf('LineString'), 'line');

const point = (lng, lat, scheme, scale) => ({
  schemeId: scheme,
  rank: rankOf({ slug: scheme, scale, priority: 1 }, null),
  family: 'point',
  nhom: 'mang',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { tam_thoi: true }
});
const line = (lat, scheme, scale, nhom = 'mang') => ({
  schemeId: scheme,
  rank: rankOf({ slug: scheme, scale, priority: 1 }, null),
  family: 'line',
  nhom,
  geometry: { type: 'LineString', coordinates: [[107.60, lat], [107.62, lat]] },
  properties: {}
});

const near = mergeRecords([
  point(107.60, 16.46, 'coarse', 25000),
  point(107.6004, 16.46, 'fine', 10000)
]);
assert.equal(near.kept.length, 1);
assert.equal(near.kept[0].schemeId, 'fine');
assert.equal(near.droppedDuplicate, 1);

const apart = mergeRecords([
  point(107.60, 16.46, 'fine', 10000),
  point(107.62, 16.46, 'coarse', 25000)
]);
assert.equal(apart.kept.length, 2);

const same = mergeRecords([
  point(107.60, 16.46, 'fine', 10000),
  point(107.6002, 16.46, 'fine', 10000)
]);
assert.equal(same.kept.length, 2);

const roads = mergeRecords([
  line(16.460, 'coarse', 25000),
  line(16.4602, 'fine', 10000),
  line(16.470, 'coarse', 25000)
]);
assert.equal(roads.kept.filter(r => r.schemeId === 'fine').length, 1);
assert.equal(roads.droppedDuplicate, 1);
assert.ok(roads.kept.some(r => r.schemeId === 'coarse'));

const rail = mergeRecords([
  line(16.46, 'city', 25000, 'mang'),
  line(16.4601, 'city2', 10000, 'duong-sat')
]);
assert.equal(rail.kept.length, 2);

const ring = [[107.36, 16.56], [107.40, 16.56], [107.40, 16.59], [107.36, 16.59], [107.36, 16.56]];
assert.equal(ringContains([107.37, 16.57], ring), true);
assert.equal(ringContains([107.50, 16.57], ring), false);
const poly = { type: 'Polygon', coordinates: [ring] };
assert.equal(geomContains([107.37, 16.57], poly), true);

const parentIn = point(107.37, 16.57, 'phong-dien', 25000);
const parentOut = point(107.50, 16.50, 'phong-dien', 25000);
parentIn.overrideDrop = true;
const clipped = mergeRecords([parentIn, parentOut]);
assert.equal(clipped.droppedOverride, 1);
assert.equal(clipped.kept.length, 1);
assert.equal(clipped.kept[0].schemeId, 'phong-dien');

const doc = toFeatureCollection({
  v: 2,
  features: [{ id: 'f1', name: 'Đường A', geometry: { type: 'LineString', coordinates: [[107.6, 16.4], [107.7, 16.5]] }, props: { capDuong: 'đường chính' } }]
});
assert.equal(doc.type, 'FeatureCollection');
assert.equal(doc.features[0].properties.ten, 'Đường A');
assert.equal(doc.features[0].properties.capDuong, 'đường chính');
assert.equal(toFeatureCollection({ type: 'FeatureCollection', features: [] }).features.length, 0);

for (const sector of ['giao-thong', 'cap-dien', 'cap-nuoc']) {
  const file = `public/data/hien-trang-tam/${sector}.geojson`;
  const stat = fs.statSync(file);
  assert.ok(stat.size < 5 * 1024 * 1024, file);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.type, 'FeatureCollection');
  assert.ok(doc.features.length > 0);
  assert.equal(doc.features.every(f => f.properties && f.properties.tam_thoi === true && f.properties.nguon_do_an), true);
}
const coverage = JSON.parse(fs.readFileSync('public/data/hien-trang-tam/coverage.json', 'utf8'));
assert.equal(coverage.sectors['giao-thong'].kept, 280);
assert.equal(coverage.sectors['cap-dien'].kept, 286);
assert.equal(coverage.sectors['cap-nuoc'].kept, 632);

console.log('hien trang tam ok');
