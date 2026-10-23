import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { createRequire } from 'node:module';

globalThis.turf = turf;
const { clipSchemeLots, schemeBoundaryOf, SCHEME_EDGE_M } = await import('../public/js/schemeLotClip.js');
const require = createRequire(import.meta.url);
const { stageSpec, applyLotKeep } = require('../services/reviewPublish.js');

function ring(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
function poly(x0, y0, x1, y1, name) {
  return {
    type: 'Feature',
    properties: { nhan: name, loai: 'ODT' },
    geometry: { type: 'Polygon', coordinates: [ring(x0, y0, x1, y1)] }
  };
}

const boundary = { type: 'Polygon', coordinates: [ring(107.58, 16.46, 107.59, 16.47)] };
const m = 1 / 111320;
const inside = poly(107.582, 16.462, 107.585, 16.465, 'trong');
const near = poly(107.59 + 1 * m, 16.464, 107.59 + 3 * m, 16.466, 'sat');
const far = poly(107.592, 16.464, 107.594, 16.466, 'ngoai');
const cut = poly(107.588, 16.464, 107.59 + 25 * m, 16.466, 'vat');
const sliver = poly(107.588, 16.462, 107.59 + 2 * m, 16.463, 'me');

const clip = clipSchemeLots([inside, near, far, cut, sliver], boundary);
assert.equal(SCHEME_EDGE_M, 5);
assert.equal(clip.counts.giu, 3);
assert.equal(clip.counts.bo, 1);
assert.equal(clip.counts.cat, 1);
assert.equal(clip.review.length, 2);
assert.equal(clip.review.find(item => item.name === 'ngoai').status, 'bo');
assert.equal(clip.review.find(item => item.name === 'vat').status, 'cat');
const cutOut = clip.features.find(feature => feature.properties.nhan === 'vat');
assert.ok(cutOut);
assert.ok(turf.area(cutOut) < turf.area(cut) - 10);
assert.equal(schemeBoundaryOf([
  { type: 'Feature', geometry: boundary, properties: {} }
]).type, 'Polygon');

const rows = clip.features.map(feature => ({
  name: feature.properties.nhan,
  geometry: feature.geometry,
  props: feature.properties
}));
const staged = stageSpec({
  kind: 'su-dung-dat',
  unit: 'xa:an-cuu',
  tenQH: 'Đồ án thử',
  summary: 'có lô đỏ',
  features: rows,
  lotReview: clip.review,
  clip: { edgeM: 5, ...clip.counts }
});
assert.equal(staged.lotReview.length, 2);
assert.equal(staged.clip.bo, 1);
const kept = applyLotKeep(staged.features, staged.lotReview, ['lo-3', 'lo-4']);
assert.equal(kept.length, rows.length + 1);
const restored = kept.find(row => row.name === 'vat');
assert.ok(Math.abs(turf.area(restored.geometry) - turf.area(cut)) < 1);
const droppedBack = kept.find(row => row.props && row.props.nhan === 'ngoai');
assert.ok(droppedBack);

const emptyOk = stageSpec({
  kind: 'hien-trang',
  unit: 'xa:an-cuu',
  tenQH: 'Đồ án thử',
  features: [],
  lotReview: [clip.review.find(item => item.status === 'bo')]
});
assert.equal(emptyOk.features.length, 0);
assert.equal(emptyOk.lotReview.length, 1);

console.log('scheme lot clip ok', clip.counts);
