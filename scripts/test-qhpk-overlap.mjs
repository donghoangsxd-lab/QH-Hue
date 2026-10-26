import assert from 'node:assert/strict';
import { sameLevelOverlaps, overlapTip, pickPlanningLot } from '../public/js/qhpkOverlap.js';

const box = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]]
});

function ringBox(geom) {
  const r = geom.coordinates[0];
  const xs = r.map(c => c[0]);
  const ys = r.map(c => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a, b) {
  const A = ringBox(a);
  const B = ringBox(b);
  const x0 = Math.max(A[0], B[0]);
  const y0 = Math.max(A[1], B[1]);
  const x1 = Math.min(A[2], B[2]);
  const y1 = Math.min(A[3], B[3]);
  if (x1 - x0 < 1e-12 || y1 - y0 < 1e-12) return null;
  return box(x0, y0, x1, y1);
}

function area(geom) {
  const b = ringBox(geom);
  return (b[2] - b[0]) * (b[3] - b[1]) * 1e6;
}

const west = box(0, 0, 1, 1);
const east = box(0.5, 0, 1.5, 1);
const far = box(3, 3, 4, 4);

const rows = sameLevelOverlaps([
  { name: 'pk-a', label: 'QHPK TT phía Tây', level: 'QHPK', geom: west },
  { name: 'pk-b', label: 'QHPK Thuận Hòa', level: 'QHPK', geom: east },
  { name: 'pk-c', label: 'QHPK xa', level: 'QHPK', geom: far },
  { name: 'ct', label: 'QHCT nội đô', level: 'QHCT', geom: east }
], { intersect, area, focusedName: '' });

assert.equal(rows.length, 1);
assert.deepEqual(rows[0].names, ['pk-a', 'pk-b']);
assert.match(rows[0].tip, /TT phía Tây và Thuận Hòa/);
assert.match(rows[0].tip, /cần kiểm tra pháp lý theo đồ án được phê duyệt sau/);
assert.doesNotMatch(rows[0].tip, /QHPK QHPK/);
assert.ok(rows[0].m2 > 200);

const focused = sameLevelOverlaps([
  { name: 'pk-a', label: 'QHPK TT phía Tây', level: 'QHPK', geom: west },
  { name: 'pk-b', label: 'Quy hoạch phân khu Thuận Hòa', level: 'QHPK', geom: east }
], { intersect, area, focusedName: 'pk-a' });
assert.equal(focused.length, 1);
assert.match(focused[0].tip, /đồ án QHPK Thuận Hòa/);
assert.doesNotMatch(focused[0].tip, /phía Tây/);
assert.equal(
  overlapTip('QHPK A', 'QHPK B', { nameA: 'a', nameB: 'b', focusedName: 'b' }),
  'Phạm vi thuộc đồ án QHPK A, cần kiểm tra pháp lý theo đồ án được phê duyệt sau'
);

const sliver = sameLevelOverlaps([
  { name: 'pk-a', label: 'A', geom: west },
  { name: 'pk-b', label: 'B', geom: east }
], { intersect, area: () => 10, focusedName: '' });
assert.equal(sliver.length, 0);

function contains(geom, lng, lat) {
  const b = ringBox(geom);
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}
const small = { phase: 'QH', kind: 'DXF', file: 'QHPK nhỏ', geometry: box(0, 0, 0.2, 0.2), area: 100 };
const big = { phase: 'QH', kind: 'DXF', file: 'QHPK lớn', geometry: box(0, 0, 1, 1), area: 9000 };
const infra = { phase: 'QH', kind: 'INFRA', file: 'QHPK nhỏ', geometry: box(0, 0, 0.05, 0.05), area: 1 };
const ht = { phase: 'HT', kind: 'DXF', file: 'QHPK nhỏ', geometry: box(0, 0, 0.05, 0.05), area: 1 };
const bare = { phase: 'QH', file: 'QHPK nhỏ', geometry: box(0, 0, 0.05, 0.05), area: 1 };
const qhct = { phase: 'QH', kind: 'DXF', file: 'QHCT ô', geometry: box(0, 0, 0.4, 0.4), area: 400 };
const levelOf = (name) => (String(name).startsWith('QHCT') ? 'QHCT' : 'QHPK');
const deps = { contains, area: (lot) => lot.area, levelOf };

assert.equal(pickPlanningLot([big, infra, ht, bare, small], 0.1, 0.1, 'QHPK', deps), small);
assert.equal(pickPlanningLot([big, qhct], 0.1, 0.1, 'QHCT', deps), qhct);
assert.equal(pickPlanningLot([infra, ht, bare], 0.02, 0.02, 'QHPK', deps), null);

console.log('test-qhpk-overlap: ok');
