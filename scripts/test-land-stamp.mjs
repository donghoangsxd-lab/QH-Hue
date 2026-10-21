import assert from 'node:assert/strict';
import { parseLandStampDxf, projectStamps, matchStamps } from '../public/js/landStamp.js';

const dxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
TEM
10
0
20
0
0
ATTDEF
8
0
2
Tầng cao
10
1
20
1
40
1
1
5
0
ENDBLK
0
BLOCK
2
NGOAI
10
0
20
0
0
INSERT
8
0
2
TEM
10
0
20
0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
KYHIEU
2
TEM_LE
10
107.6190
20
16.4300
0
ATTRIB
2
TANGCAOMIN
1
0
10
107.6202
20
16.4302
0
ATTRIB
2
Tầng cao
1
5
10
107.6202
20
16.4302
0
ATTRIB
2
TANGCAOMAX
1
9
10
107.6204
20
16.4302
0
ATTRIB
2
Mật độ XD
1
40
10
107.6204
20
16.4304
0
ATTRIB
2
Hệ số SDĐ
1
2.5
10
107.6206
20
16.4304
0
SEQEND
0
INSERT
8
KYHIEU
2
TEM_LE
10
107.6203
20
16.4303
0
ATTRIB
2
Ký hiệu
1
OD.1
10
107.6203
20
16.4303
0
SEQEND
0
INSERT
8
KYHIEU
2
NGOAI
10
107.6300
20
16.4400
0
SEQEND
0
INSERT
8
KYHIEU
2
TEM_LE
10
107.7000
20
16.5000
0
ATTRIB
2
Tầng
1
3
10
107.7000
20
16.5000
0
ATTRIB
2
MD
1
60
10
107.7001
20
16.5000
0
SEQEND
0
ENDSEC
0
EOF
`;

const raw = parseLandStampDxf(dxf);
assert.equal(raw.length, 4, `số tem ${raw.length}`);
const outside = raw.find(s => s.x === 107.619);
assert.ok(outside, 'tem điểm chèn ngoài lô');
assert.equal(outside.floors, '5');
assert.equal(outside.coverage, '40');
assert.equal(outside.far, '2.5');
assert.ok(outside.points.some(p => Math.abs(p[0] - 107.6202) < 1e-6), 'có điểm thuộc tính trên hatch');

const nested = raw.find(s => s.x === 107.63);
assert.ok(nested && nested.floors === '5', 'block lồng lấy ATTDEF');

const projected = projectStamps(raw, (x, y) => [y, x]);
const d = 0.0012;
const ring = (lng, lat) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
const outer = [[107.65, 16.45], [107.652, 16.45], [107.652, 16.452], [107.65, 16.452], [107.65, 16.45]];
const inner = [[107.6504, 16.4504], [107.6508, 16.4504], [107.6508, 16.4508], [107.6504, 16.4508], [107.6504, 16.4504]];
const lots = [
  { key: 'a', area: 1000, rings: [[ring(107.62, 16.43)]] },
  { key: 'b', area: 800, rings: [[ring(107.6295, 16.4395)]] },
  { key: 'empty', area: 500, rings: [[ring(107.64, 16.44)]] },
  { key: 'hole', area: 2000, rings: [[outer, inner]] }
];
const holeStamp = {
  code: '', areaRaw: '', floors: '2', coverage: '', far: '',
  x: 107.6506, y: 16.4506, id: 'hole',
  lat: 16.4506, lng: 107.6506, cands: [{ lat: 16.4506, lng: 107.6506 }]
};
const nearStamp = {
  code: 'LE', areaRaw: '', floors: '1', coverage: '30', far: '',
  x: 107.61995, y: 16.4306, id: 'near',
  lat: 16.4306, lng: 107.61995, cands: [{ lat: 16.4306, lng: 107.61995 }]
};
const match = matchStamps([...projected, holeStamp, nearStamp], lots);
const byKey = Object.fromEntries(match.assigned.map(a => [a.key, a]));
assert.ok(byKey.a, 'lô A được gán');
assert.equal(byKey.a.stamp.floors, '5');
assert.equal(byKey.a.stamp.coverage, '40');
assert.equal(byKey.a.stamp.code, 'OD.1');
assert.equal(byKey.a.how, 'merge');
assert.ok(byKey.b && byKey.b.stamp.floors === '5', 'block lồng rơi vào lô B');
assert.ok(byKey.hole && byKey.hole.how === 'hole', 'tem trong lỗ vẫn thuộc lô');
assert.ok(byKey.empty == null, 'lô trống không nhận tem');
assert.ok(match.unmatchedLots.includes('empty'));
assert.ok(match.pending.some(s => s.floors === '3'), 'tem xa không gán');
const near = match.assigned.find(a => a.how === 'near');
assert.equal(near, undefined);

const conflict = matchStamps([
  { id: '1', code: '', floors: '5', coverage: '40', far: '', lat: 16.4302, lng: 107.6202, cands: [{ lat: 16.4302, lng: 107.6202 }] },
  { id: '2', code: '', floors: '7', coverage: '40', far: '', lat: 16.4303, lng: 107.6203, cands: [{ lat: 16.4303, lng: 107.6203 }] }
], [lots[0]]);
assert.equal(conflict.assigned.length, 0);
assert.equal(conflict.pending.length, 2);
assert.deepEqual(conflict.unmatchedLots, ['a']);

console.log('land-stamp: ok');
