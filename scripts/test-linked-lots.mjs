import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLevelOf } from '../public/js/generalPlan.js';
import {
  linkedAssetHref, mergeLinkedProjects, parcelsFromCollection
} from '../public/js/linkedLots.js';

const poly = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { chucnangsudungdat: 'Đất giao thông', kyhieulodat: 'GT-01', dientich: '12.34' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    },
    {
      type: 'Feature',
      properties: { loaidat: 'Điểm' },
      geometry: { type: 'Point', coordinates: [0, 0] }
    }
  ]
};

const lots = parcelsFromCollection(poly, 'QH');
assert.equal(lots.length, 1);
assert.equal(lots[0].kind, 'DXF');
assert.equal(lots[0].phase, 'QH');
assert.equal(lots[0].id, 'DXF-001');
assert.equal(lots[0].layer, 'Đất giao thông');
assert.equal(lots[0].lotCode, 'GT-01');
assert.equal(lots[0].area, 12.3);
assert.equal(parcelsFromCollection(poly, 'HT')[0].phase, 'HT');

assert.equal(
  linkedAssetHref('https://storage.googleapis.com/hue-infra-data-us/chuyen-nganh/v1/a.geojson', '9'),
  '/gcs/chuyen-nganh/v1/a.geojson?v=9'
);
assert.equal(linkedAssetHref('data/chuyen-nganh/a.geojson', '9'), 'data/chuyen-nganh/a.geojson?v=9');

const kept = {
  tenQH: 'Đã có', slug: 'da-co', dir: true, lands: 4, boundary: { type: 'Polygon' }, linked: false
};
const sheet = { tenQH: 'QHC xã Thượng Long', slug: 'qhc-xa-thuong-long-3f2c4da4', sheetOnly: true, dir: false, lands: 0 };
const link = {
  tenQH: 'QHC xã Thượng Long',
  slug: 'qhc-xa-thuong-long-3f2c4da4',
  linkedLots: { 'hien-trang': 'ht.geojson', 'su-dung-dat': 'qh.geojson' },
  boundary: { type: 'Polygon', coordinates: [] },
  bbox: [1, 2, 3, 4],
  lands: 9,
  wards: ['Xã Long Quảng'],
  saved: 1
};
const merged = mergeLinkedProjects([kept, sheet], [link, {
  tenQH: 'QHC xã Hương Hữu',
  slug: 'qhc-xa-huong-huu-cb7f4149',
  linkedLots: { 'su-dung-dat': 'b.geojson' },
  lands: 3
}]);
assert.equal(merged.length, 3);
assert.equal(merged[0], kept);
assert.equal(merged[1].sheetOnly, false);
assert.equal(merged[1].linked, true);
assert.equal(merged[1].dir, false);
assert.equal(merged[1].lands, 9);
assert.deepEqual(merged[1].wards, ['Xã Long Quảng']);
assert.equal(merged[2].tenQH, 'QHC xã Hương Hữu');
assert.equal(planLevelOf(merged[1].tenQH), 'QHC');
assert.equal(planLevelOf(merged[2].tenQH), 'QHC');

const catalog = JSON.parse(readFileSync('public/data/qhc-xa/catalog.json', 'utf8'));
const want = [
  ['qhc-xa-thuong-long-3f2c4da4', 'QHC xã Thượng Long', 'Xã Long Quảng', 20797],
  ['qhc-xa-huong-huu-cb7f4149', 'QHC xã Hương Hữu', 'Xã Nam Đông', 20800],
  ['qhc-xa-huong-loc-1487608f', 'QHC xã Hương Lộc', 'Xã Nam Đông', 20799],
  ['qhc-xa-thuong-nhat-550f030f', 'QHC xã Thượng Nhật', 'Xã Nam Đông', 20805]
];
assert.equal(catalog.projects.length, 4);
want.forEach(([slug, name, ward, mapid]) => {
  const row = catalog.projects.find(p => p.slug === slug);
  assert.ok(row, slug);
  assert.equal(row.tenQH, name);
  assert.equal(planLevelOf(row.tenQH), 'QHC');
  assert.deepEqual(row.wards, [ward]);
  assert.equal(row.mapid, mapid);
  assert.equal(row.linked, true);
  assert.equal(row.sheetOnly, false);
  assert.equal(row.dir, false);
  assert.ok(row.lands > 0);
  assert.ok(row.boundary && (row.boundary.type === 'Polygon' || row.boundary.type === 'MultiPolygon'));
  assert.equal(row.bbox.length, 4);
  assert.ok(row.linkedLots['hien-trang']);
  assert.ok(row.linkedLots['su-dung-dat']);
  assert.equal(JSON.stringify(catalog).includes('Thuong Quang') || JSON.stringify(catalog).includes('Thượng Quảng'), false);
});

const schemes = JSON.parse(readFileSync('public/data/chuyen-nganh/schemes.json', 'utf8')).schemes;
want.forEach(([slug]) => {
  const row = schemes.find(s => s.slug === slug);
  assert.equal(row.scale, 10000);
  assert.equal(row.sourceScale, 25000);
  assert.equal(row.homeLevel, 'QHC10');
});
assert.equal(schemes.some(s => /thuong quang|thượng quảng/i.test(`${s.slug} ${s.name}`)), false);

console.log('linked lots ok');
