import assert from 'node:assert/strict';
import {
  TOUCH_TOLERANCE_M, clusterTouching, applyTouchGroups, groupInfraParcels, infraCategory, approxSepM
} from '../public/js/touchGroups.js';

const LAT = 16.46;
const LNG = 107.58;

function at(east, north) {
  return [
    LNG + east / (111320 * Math.cos(LAT * Math.PI / 180)),
    LAT + north / 110540
  ];
}

function box(x, y, s) {
  return [at(x, y), at(x + s, y), at(x + s, y + s), at(x, y + s), at(x, y)];
}

function lot(id, ring, extra = {}) {
  return { id, type: 'CV', phase: 'QH', project: 'Kim Long', rings: [ring], ...extra };
}

const close = clusterTouching([
  lot('CV-1', box(0, 0, 20)),
  lot('CV-2', box(23, 0, 20))
]);
assert.equal(close.length, 1, 'khe 3 m phải thành một nhóm');
assert.equal(close[0].length, 2);

const apart = clusterTouching([
  lot('CV-1', box(0, 0, 20)),
  lot('CV-2', box(30, 0, 20))
]);
assert.equal(apart.length, 0, 'khe 10 m không gộp');

const otherProject = clusterTouching([
  lot('CV-1', box(0, 0, 20), { project: 'A' }),
  lot('CV-2', box(23, 0, 20), { project: 'B' })
]);
assert.equal(otherProject.length, 0, 'khác đồ án không gộp');

const otherType = clusterTouching([
  lot('CV-1', box(0, 0, 20), { type: 'CV' }),
  lot('YT-1', box(23, 0, 20), { type: 'YT' })
]);
assert.equal(otherType.length, 0, 'khác loại không gộp');

const otherPhase = clusterTouching([
  lot('CV-1', box(0, 0, 20), { phase: 'HT' }),
  lot('CV-2', box(23, 0, 20), { phase: 'QH' })
]);
assert.equal(otherPhase.length, 0, 'khác giai đoạn không gộp');

const grid = [];
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) grid.push(lot(`CV-${i}${j}`, box(i * 12, j * 12, 10)));
}
const island = clusterTouching(grid);
assert.equal(island.length, 1, '9 mảnh khe 2 m là một đảo');
assert.equal(island[0].length, 9);
assert.equal(clusterTouching(grid, 1).length, 0, 'dung sai 1 m không bắt khe 2 m');

const gap = approxSepM(lot('a', box(0, 0, 20)), lot('b', box(23, 0, 20)));
assert.ok(gap > 2 && gap < 4, `khe đo được ${gap}`);

const points = [
  { id: 'CV-2', name: 'CX1.02', sizeHT: 10, sizeQH: 12, status: true, lat: 1, lng: 2, type: '1-CV', radius: 400 },
  { id: 'CV-1', name: 'CX1.01', sizeHT: 20, sizeQH: null, status: true, lat: 1, lng: 2, type: '1-CV', radius: 400 },
  { id: 'YT-9', name: 'Trạm', sizeHT: 5, sizeQH: 5, status: true, lat: 3, lng: 4, type: '7-YT' }
];
const once = applyTouchGroups(points, [
  { ids: ['CV-1', 'CV-2'], name: 'CX1.01, CX1.02', lat: 16.1, lng: 107.1 },
  { ids: ['CV-1', 'CV-2'], name: 'trùng', lat: 9, lng: 9 }
]);
assert.equal(once.length, 2);
const merged = once.find(p => p.id === 'CV-1');
assert.ok(merged);
assert.equal(merged.name, 'CX1.01, CX1.02');
assert.equal(merged.sizeHT, 30);
assert.equal(merged.sizeQH, 12);
assert.equal(merged.lat, 16.1);
assert.equal(merged.lng, 107.1);
assert.deepEqual(merged.touchIds, ['CV-1', 'CV-2']);
assert.equal(once.some(p => p.id === 'CV-2'), false);
assert.equal(applyTouchGroups(once, [{ ids: ['CV-1', 'CV-2'], name: 'CX1.01, CX1.02', lat: 16.1, lng: 107.1 }]).length, 2);

assert.equal(infraCategory({ layer: 'Cây xanh → CV_DT', id: 'CV-1' }), 'CV');
assert.equal(infraCategory({ prefix: 'THCS', type: '5-THCS' }), 'THCS');

const ring = box(0, 0, 10);
const ring2 = box(12, 0, 10);
const land = { id: 'DXF-1', land: true, phase: 'QH', type: '1-CV', polygons: [[ring]], area: 10 };
const a = { id: 'CV-1', phase: 'QH', type: '1-CV', prefix: 'CV_DT', layer: 'cx → CV', lotCode: 'CX1.01', polygons: [[ring]], area: 100, lat: LAT, lng: LNG };
const b = { id: 'CV-2', phase: 'QH', type: '1-CV', prefix: 'CV', layer: 'cx → CV', lotCode: 'CX1.02', polygons: [[ring2]], area: 50, lat: LAT, lng: LNG };
const pending = { id: 'TH-1', phase: 'QH', type: '4-TH', prefix: 'TH', pending: true, polygons: [[box(12, 12, 10)]], area: 80 };
const src = [land, a, b, pending];
const grouped = groupInfraParcels(src);
assert.equal(src.length, 4, 'không xóa lô gốc');
assert.equal(src[1], a);
assert.equal(grouped.length, 3);
const lead = grouped.find(p => p.touchCount === 2);
assert.ok(lead);
assert.equal(lead.area, 150);
assert.equal(lead.polygons.length, 2);
assert.equal(lead.lotCode, 'CX1.01, CX1.02');
const dupName = groupInfraParcels([
  { ...a, lotCode: 'CX1.02', polygons: [[ring]] },
  { ...b, id: 'CV-3', lotCode: 'CX1.02', polygons: [[ring2]] }
]);
assert.equal(dupName.find(p => p.touchCount === 2).lotCode, 'CV-1, CV-3');
assert.equal(grouped.some(p => p.id === 'CV-2'), false);
assert.equal(grouped.some(p => p.pending), true);
assert.equal(TOUCH_TOLERANCE_M, 4);

console.log('test-touch-groups: ok');
