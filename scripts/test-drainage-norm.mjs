// Chuẩn hóa hướng thoát nước theo sông, kênh: bám mép, đảo hướng, đánh dấu xa hoặc ngược nguồn.
import assert from 'assert';
import {
  SNAP_M, FLAG_M, AWAY_M, waterwaysFromFeatures, buildWaterIndex, nearestWater,
  normalizePolyline, nearestOnRing, summarize, mercXY, unmerc, outfallIndexes
} from '../public/js/drainageNorm.js';

const canal = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[107.50, 16.46], [107.60, 16.46]] },
  properties: { group: 'water', kind: 'canal', name: 'Kênh Phủ Cam' }
};
const river = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[107.40, 16.40], [107.40, 16.50]] },
  properties: { group: 'water', kind: 'river', name: 'Sông Hương' }
};
const rail = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[107.50, 16.47], [107.60, 16.47]] },
  properties: { group: 'rail', kind: 'rail', name: 'Đường sắt' }
};

const index = buildWaterIndex(waterwaysFromFeatures([canal, river, rail]));
assert.ok(index.segs.length >= 2);

const [lng, lat] = unmerc(...mercXY(107.58, 16.463));
assert.ok(Math.abs(lng - 107.58) < 1e-8);
assert.ok(Math.abs(lat - 16.463) < 1e-8);

const near = nearestWater(index, 107.55, 16.4604);
assert.strictEqual(near.name, 'Kênh Phủ Cam');
assert.ok(near.dist < 60);
assert.ok(near.dist > 30);

// Đầu hạ lưu cách kênh ~45 m → bám mép, gắn tên
const snap = normalizePolyline([[107.552, 16.462], [107.555, 16.4604]], index);
assert.strictEqual(snap.snapped, true);
assert.strictEqual(snap.reoriented, false);
assert.strictEqual(snap.flag, '');
assert.strictEqual(snap.receiver, 'Kênh Phủ Cam');
assert.ok(Math.abs(snap.coords[snap.coords.length - 1][1] - 16.46) < 1e-4);

// Đầu thượng lưu sát kênh, đầu hạ lưu xa → đảo rồi bám
const rev = normalizePolyline([[107.55, 16.4602], [107.55, 16.464]], index);
assert.strictEqual(rev.reoriented, true);
assert.strictEqual(rev.snapped, true);
assert.strictEqual(rev.receiver, 'Kênh Phủ Cam');
assert.ok(rev.coords[rev.coords.length - 1][1] < rev.coords[0][1]);

// Xa mọi tuyến
const far = normalizePolyline([[107.70, 16.70], [107.701, 16.701]], index);
assert.strictEqual(far.snapped, false);
assert.strictEqual(far.flag, 'far');

// Hạ lưu gần hơn nhưng đoạn cuối quay ngược nguồn
const away = normalizePolyline([
  [107.55, 16.464],
  [107.55, 16.4612],
  [107.55, 16.4616]
], index);
assert.strictEqual(away.reoriented, false);
assert.strictEqual(away.flag, 'away');
assert.strictEqual(away.receiver, 'Kênh Phủ Cam');

// Song song bờ kênh, hạ lưu hơi gần hơn: giữ hướng cao độ, không đảo
const along = normalizePolyline([[107.552, 16.4612], [107.558, 16.461]], index);
assert.strictEqual(along.reoriented, false);
assert.strictEqual(along.flag, '');

const ring = nearestOnRing([[107.552, 16.462], [107.558, 16.463], [107.555, 16.4603]], index);
assert.strictEqual(ring.name, 'Kênh Phủ Cam');
assert.ok(ring.dist < SNAP_M);

const counts = summarize([snap, rev, far, away, along]);
assert.strictEqual(counts.snapped, 2);
assert.strictEqual(counts.reoriented, 1);
assert.strictEqual(counts.flagged, 2);
assert.ok(FLAG_M > SNAP_M);
assert.ok(AWAY_M < SNAP_M);

const chain = [
  [[107.50, 16.47], [107.51, 16.47]],
  [[107.51, 16.47], [107.52, 16.4702]],
  [[107.40, 16.47], [107.41, 16.47]]
];
assert.deepStrictEqual(outfallIndexes(chain), [1, 2]);

console.log('test-drainage-norm: ok');
