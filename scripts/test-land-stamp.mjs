import assert from 'node:assert/strict';
import { parseLandStampDxf, projectStamps, matchStamps, stampNameMatch, stampAreaMatch } from '../public/js/landStamp.js';

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
ATTRIB
2
Ký hiệu
1
OD.1
10
107.6202
20
16.4305
0
ATTRIB
2
Diện tích
1
1000
10
107.6202
20
16.4306
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
ATTRIB
2
Diện tích
1
1000
10
107.6203
20
16.4304
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
66
1
0
ATTRIB
2
Ký hiệu
1
OD.1
10
107.6300
20
16.4400
0
ATTRIB
2
Diện tích
1
800
10
107.6300
20
16.4401
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
  { key: 'a', area: 1000, layer: 'ODT', rings: [[ring(107.62, 16.43)]] },
  { key: 'b', area: 800, layer: 'ODT', rings: [[ring(107.6295, 16.4395)]] },
  { key: 'empty', area: 500, layer: 'ODT', rings: [[ring(107.64, 16.44)]] },
  { key: 'hole', area: 2000, layer: 'CAY', rings: [[outer, inner]] }
];
// Lỗ + tên + diện tích (≥ 2 tiêu chí) mới tự gán.
const holeStamp = {
  code: 'CX', areaRaw: '2000', floors: '2', coverage: '', far: '',
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
assert.ok(byKey.hole, 'tem trong lỗ được gán khi đủ ≥ 2 tiêu chí');
assert.ok(String(byKey.hole.how).includes('hole') || String(byKey.hole.how).includes('pos'), 'có tiêu chí vị trí lỗ');
assert.ok(byKey.empty == null, 'lô trống không nhận tem');
assert.ok(match.unmatchedLots.includes('empty'));
assert.ok(match.pending.some(s => s.floors === '3'), 'tem xa không gán');
assert.ok(match.pending.some(s => s.id === 'near'), 'tem chỉ gần mép (1 tiêu chí) → hỏi tay');

const conflict = matchStamps([
  { id: '1', code: '', floors: '5', coverage: '40', far: '', lat: 16.4302, lng: 107.6202, cands: [{ lat: 16.4302, lng: 107.6202 }] },
  { id: '2', code: '', floors: '7', coverage: '40', far: '', lat: 16.4303, lng: 107.6203, cands: [{ lat: 16.4303, lng: 107.6203 }] }
], [lots[0]]);
assert.equal(conflict.assigned.length, 0);
assert.equal(conflict.pending.length, 2);
assert.deepEqual(conflict.unmatchedLots, ['a']);

// Block tem CAD: tag ATTRIB trùng "1", diện tích kiểu Việt 4.994,4, ký hiệu "CX - QT".
const khDxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
KH
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
00-TEXT
2
KH
10
100
20
200
66
1
0
ATTRIB
8
00-TEXT
10
102
20
196
40
2
1
5
100
AcDbAttribute
2
1
0
ATTRIB
8
00-TEXT
10
98
20
196
40
2
1
1
100
AcDbAttribute
2
1
0
ATTRIB
8
00-TEXT
10
96
20
199
40
2
1
4.994,4
100
AcDbAttribute
2
1
0
ATTRIB
8
00-TEXT
10
95
20
202
40
2
1
CX - QT
100
AcDbAttribute
2
1
0
SEQEND
0
ENDSEC
0
EOF
`;
const kh = parseLandStampDxf(khDxf);
assert.equal(kh.length, 1, `tem KH ${kh.length}`);
assert.equal(kh[0].code, 'CX-QT');
assert.equal(kh[0].areaRaw, '4994.4');
assert.equal(kh[0].floors, '1');
assert.equal(kh[0].coverage, '5');
assert.equal(kh[0].far, '');

// Cùng điểm trong hai hatch: chỉ small đạt ≥ 2 (pos+name+area); big chỉ pos+name.
const ambLng = 107.8;
const ambLat = 16.5;
const shared = [[ring(ambLng, ambLat)]];
const big = { key: 'big', area: 10000, layer: 'CAY A', rings: shared };
const small = { key: 'small', area: 4994.4, layer: 'CAY B', rings: shared };
const areaStamp = {
  id: 'area-cx', code: 'CX01', areaRaw: '4994.4', floors: '1', coverage: '5',
  lat: ambLat + d / 2, lng: ambLng + d / 2,
  cands: [{ lat: ambLat + d / 2, lng: ambLng + d / 2 }]
};
assert.ok(stampAreaMatch(areaStamp, small));
assert.ok(!stampAreaMatch(areaStamp, big));
const byArea = matchStamps([areaStamp], [big, small]);
assert.equal(byArea.assigned.length, 1);
assert.equal(byArea.assigned[0].key, 'small');
assert.ok(byArea.assigned[0].how.includes('area'));
assert.ok(byArea.assigned[0].how.split('+').length >= 2);

// Vị trí + tên (không có diện tích): đủ 2 tiêu chí với CAY, không đủ với đất ở.
const nameStamp = {
  id: 'name-cx', code: 'CX-QT', areaRaw: '', floors: '1', coverage: '5',
  lat: ambLat + d / 2, lng: ambLng + d / 2,
  cands: [{ lat: ambLat + d / 2, lng: ambLng + d / 2 }]
};
const cay = { key: 'cay', area: 3000, layer: 'CAY 1', rings: shared };
const other = { key: 'other', area: 3100, layer: 'DAT_O', rings: shared };
assert.ok(stampNameMatch(nameStamp, cay));
assert.ok(!stampNameMatch(nameStamp, other));
const byName = matchStamps([nameStamp], [cay, other]);
assert.equal(byName.assigned[0].key, 'cay');
assert.ok(byName.assigned[0].how.includes('name'));
assert.ok(byName.assigned[0].how.split('+').length >= 2);

// Chỉ 1 tiêu chí (diện tích) → hỏi tay.
const farStamp = {
  id: 'far-area', code: '', areaRaw: '2509.6', floors: '5', coverage: '45',
  lat: 16.9, lng: 107.9, cands: [{ lat: 16.9, lng: 107.9 }]
};
const tm = { key: 'tm', area: 2510, layer: 'Cong cong', rings: [[ring(107.7, 16.4)]] };
const farOther = { key: 'far-other', area: 9000, layer: 'CAY', rings: [[ring(107.71, 16.41)]] };
const byFarArea = matchStamps([farStamp], [tm, farOther]);
assert.equal(byFarArea.assigned.length, 0);
assert.equal(byFarArea.pending.length, 1);

// Tên + diện tích (không vị trí) → tự gán.
const farNamed = { ...farStamp, id: 'far-named', code: 'TMDV' };
const byNameArea = matchStamps([farNamed], [tm, farOther]);
assert.equal(byNameArea.assigned[0].key, 'tm');
assert.equal(byNameArea.assigned[0].how, 'name+area');

// Chỉ vị trí → hỏi tay.
const posOnly = matchStamps([{
  id: 'pos-only', code: '', areaRaw: '', floors: '1', coverage: '',
  lat: ambLat + d / 2, lng: ambLng + d / 2,
  cands: [{ lat: ambLat + d / 2, lng: ambLng + d / 2 }]
}], [{ key: 'solo', area: 5000, layer: '', rings: shared }]);
assert.equal(posOnly.assigned.length, 0);
assert.equal(posOnly.pending.length, 1);

console.log('land-stamp: ok');
