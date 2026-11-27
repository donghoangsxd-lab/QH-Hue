// Kiểm tra logic độ phủ đồ án (cùng công thức polyPair / buffer / đất ở như projectCover.js).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.turf = require('@turf/turf');

const { landPatternKey } = await import(pathToFileURL(path.join(root, 'public/js/tt16Symbols.js')).href);
const { reviewRowsFor } = await import(pathToFileURL(path.join(root, 'public/js/projectReviewCore.js')).href);

function feat(geom) {
  return geom?.type === 'Feature' ? geom : turf.feature(geom);
}
function geomOf(f) {
  return f?.type === 'Feature' ? f.geometry : f;
}
function polyPair(op, a, b) {
  const fa = feat(a);
  const fb = feat(b);
  try {
    const hit = turf[op](fa, fb);
    if (hit) return hit;
  } catch (e) { /* Turf 7 */ }
  try { return turf[op](turf.featureCollection([fa, fb])); } catch (e2) { return null; }
}
function unionAll(features) {
  const list = (features || []).filter(Boolean).map(feat);
  if (!list.length) return null;
  return list.slice(1).reduce((acc, f) => polyPair('union', acc, f) || acc, list[0]);
}

const TYPE_PATTERNS = { '3-MN': ['3-MN'] };
const HOUSING = new Set(['O-NO', 'O-HH', 'O-LX']);

function compute({ boundary, lots, typeKey, pop }) {
  const want = new Set(TYPE_PATTERNS[typeKey] || []);
  const people = Number(pop?.qh) > 0 ? Number(pop.qh) : Number(pop?.ht) || 0;
  const facilities = [];
  const housingFeats = [];
  lots.forEach(lot => {
    const key = landPatternKey(lot.layer, lot.name || '');
    if (HOUSING.has(key)) housingFeats.push(feat(lot.geometry));
    if (!want.has(key)) return;
    const c = turf.centroid(feat(lot.geometry)).geometry.coordinates;
    facilities.push({ center: c, radius: 1000 });
  });
  const buffers = facilities.map(f => turf.buffer(turf.point(f.center), f.radius, { units: 'meters' }));
  const host = feat(boundary);
  const coveredUnion = unionAll(buffers);
  let coveredGeom = null;
  let gapGeom = null;
  if (coveredUnion) {
    coveredGeom = geomOf(polyPair('intersect', coveredUnion, host));
    gapGeom = geomOf(polyPair('difference', host, coveredUnion));
  } else gapGeom = geomOf(host);
  const housingUnion = unionAll(housingFeats);
  const housingM2 = housingUnion ? turf.area(housingUnion) : 0;
  let coveredHousingM2 = 0;
  if (housingUnion && coveredGeom) {
    const hit = polyPair('intersect', housingUnion, feat(coveredGeom));
    coveredHousingM2 = hit ? turf.area(hit) : 0;
  }
  const gapHousingM2 = Math.max(0, housingM2 - coveredHousingM2);
  const density = housingM2 > 0 && people > 0 ? people / housingM2 : null;
  return {
    facilityCount: facilities.length,
    housingM2,
    gapHousingM2,
    peopleUnserved: density != null ? Math.round(density * gapHousingM2) : null,
    coveredGeom,
    gapGeom
  };
}

const boundary = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]]
};
const mnLot = {
  layer: 'DAT_HTXH_TRUONGHOC_MN',
  name: 'Truong mam non A',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0.009, 0.009], [0.011, 0.009], [0.011, 0.011], [0.009, 0.011], [0.009, 0.009]]]
  }
};
const houseFar = {
  layer: 'DAT_O_NHOMNHAO',
  name: 'O.A-01',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0.018, 0.018], [0.0195, 0.018], [0.0195, 0.0195], [0.018, 0.0195], [0.018, 0.018]]]
  }
};
const houseNear = {
  layer: 'DAT_O_NHOMNHAO',
  name: 'O.B-01',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0.0095, 0.0095], [0.0105, 0.0095], [0.0105, 0.0105], [0.0095, 0.0105], [0.0095, 0.0095]]]
  }
};

assert.equal(landPatternKey(mnLot.layer, mnLot.name), '3-MN');
assert.equal(landPatternKey(houseFar.layer, houseFar.name), 'O-NO');
assert.ok(reviewRowsFor('QHPK', 10000).some(t => t.key === '3-MN' && t.radius > 0));
assert.match(
  require('fs').readFileSync(path.join(root, 'public/js/projectCover.js'), 'utf8'),
  /function polyPair|export function computeProjectCover/
);

const out = compute({
  boundary,
  lots: [mnLot, houseFar, houseNear],
  typeKey: '3-MN',
  pop: { qh: 1000, ht: 0 }
});
assert.equal(out.facilityCount, 1);
assert.ok(out.housingM2 > 0);
assert.ok(out.gapHousingM2 > 0, 'dat o goc xa phai nam ngoai ban kinh');
assert.ok(out.gapHousingM2 < out.housingM2, 'dat o gan phai nam trong ban kinh');
assert.ok(out.peopleUnserved > 0);
assert.ok(out.peopleUnserved < 1000);
assert.ok(out.coveredGeom);
assert.ok(out.gapGeom);

console.log('project-cover: ok');
