import assert from 'node:assert/strict';
import {
  parseLandStampDxf, projectStamps, matchStamps, stampNameMatch, stampAreaMatch,
  stampAreaM2, stampAreaVsLots, stampPendingWhy, lotMissingStampAttrs, assignKeysOf,
  suggestStampLotKeys, suggestPendingStampHints, STAMP_AUTO_AREA_TOL, STAMP_NEAR_AUTO_M
} from '../public/js/landStamp.js';
import { vn2000ToWgs84, CRS_PRESETS } from '../public/js/cadImport.js';

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
// Lỗ + tên (+ DT nếu có) → tự gán theo luật trên-hatch.
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
assert.ok(byKey.hole, 'tem trong lỗ + tên được gán');
assert.ok(String(byKey.hole.how).includes('hole') || String(byKey.hole.how).includes('pos'), 'có tiêu chí vị trí lỗ');
assert.ok(byKey.empty == null, 'lô trống không nhận tem');
assert.ok(match.unmatchedLots.includes('empty'));
assert.ok(match.pending.some(s => s.floors === '3'), 'tem xa không gán');
assert.ok(match.pending.some(s => s.id === 'near'), 'tem gần mép thiếu tên+DT → hỏi tay');

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

// Cùng điểm trong hai hatch: ưu tiên hatch khớp DT hơn (small).
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

// Tên + diện tích nhưng xa > 50 m → không tự gán (cần trên hatch hoặc gần bao).
const farNamed = { ...farStamp, id: 'far-named', code: 'TMDV' };
const byNameArea = matchStamps([farNamed], [tm, farOther]);
assert.equal(byNameArea.assigned.length, 0);
assert.equal(byNameArea.pending.length, 1);

// Chỉ vị trí → hỏi tay.
const posOnly = matchStamps([{
  id: 'pos-only', code: '', areaRaw: '', floors: '1', coverage: '',
  lat: ambLat + d / 2, lng: ambLng + d / 2,
  cands: [{ lat: ambLat + d / 2, lng: ambLng + d / 2 }]
}], [{ key: 'solo', area: 5000, layer: '', rings: shared }]);
assert.equal(posOnly.assigned.length, 0);
assert.equal(posOnly.pending.length, 1);

// Gốc block / điểm E≈0 + N≈Huế chiếu VN-2000 ra Lào — không được thắng điểm INSERT.
const hueE = 556000;
const hueN = 1815000;
const polluted = {
  code: 'TM-B3', areaRaw: '', floors: '5', coverage: '60', far: '5',
  x: hueE, y: hueN,
  points: [[hueE, hueN], [0, hueN], [1, 1], [10, 20]]
};
const toWgs = (E, N) => vn2000ToWgs84(E, N, CRS_PRESETS.HUE_3);
const [laosLat, laosLng] = toWgs(0, hueN);
assert.ok(laosLng < 105, `mốc Lào ${laosLng}`);
const fixed = projectStamps([polluted], toWgs);
assert.equal(fixed.length, 1);
assert.ok(fixed[0].lng > 106.5 && fixed[0].lng < 108.5, `tem phải ở Huế, không Lào (${fixed[0].lng})`);
assert.ok(fixed[0].lat > 15.5 && fixed[0].lat < 17.2, `vĩ độ Huế (${fixed[0].lat})`);
assert.ok(!fixed[0].cands.some(p => p.lng < 105), 'không còn ứng viên bên Lào');

// ATTRIB local trong block + INSERT thật — vị trí tem = điểm chèn.
const localBlockDxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
TEMLO
10
0
20
0
0
ATTDEF
2
Ký hiệu
10
2
20
3
1
XX
0
ATTDEF
2
Tầng cao
10
2
20
1
1
5
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
2
TEMLO
10
${hueE}
20
${hueN}
0
ATTRIB
2
Ký hiệu
1
TM-B3
10
2
20
3
0
ATTRIB
2
Tầng cao
1
5
10
2
20
1
0
SEQEND
0
ENDSEC
0
EOF
`;
const localStamps = parseLandStampDxf(localBlockDxf);
assert.equal(localStamps.length, 1);
assert.equal(localStamps[0].code, 'TM-B3');
assert.equal(localStamps[0].x, hueE);
assert.equal(localStamps[0].y, hueN);
assert.ok(localStamps[0].points.every(([x, y]) => Math.hypot(x - hueE, y - hueN) <= 200),
  'points chỉ quanh INSERT, không giữ ATTRIB local (2,3)');
const localProj = projectStamps(localStamps, toWgs);
assert.ok(localProj[0].lng > 106.5, `INSERT local-attr → Huế (${localProj[0].lng})`);

// File kiểu Thủy Thanh: INSERT UCS local, ATTRIB đã VN-2000 WCS → neo theo ATTRIB.
const mixedDxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
aaq
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
2
aaq
10
79504.33
20
-80200.16
41
0.8
0
ATTRIB
2
KH
1
CXCD-B11
10
567764.41
20
1820726.73
0
ATTRIB
2
DTLD
1
4,97
10
567777.43
20
1820714.44
0
SEQEND
0
ENDSEC
0
EOF
`;
const mixed = parseLandStampDxf(mixedDxf);
assert.equal(mixed.length, 1);
assert.equal(mixed[0].code, 'CXCD-B11');
assert.ok(mixed[0].x > 500000 && mixed[0].y > 1800000,
  `neo ATTRIB VN-2000, không INSERT local (${mixed[0].x}, ${mixed[0].y})`);
const mixedProj = projectStamps(mixed, toWgs);
assert.ok(mixedProj[0].lng > 106.5 && mixedProj[0].lat > 15.5,
  `Thủy Thanh-style → Huế (${mixedProj[0].lat}, ${mixedProj[0].lng})`);

// Gán tay một tem → nhiều lô.
const multiA = { key: 'ma', area: 500, layer: 'TMDV', rings: shared };
const multiB = { key: 'mb', area: 500, layer: 'TMDV', rings: shared };
const multiStamp = {
  id: 'multi', code: 'TM-X', areaRaw: '1000', floors: '5', coverage: '60', far: '3',
  lat: ambLat, lng: ambLng, cands: [{ lat: ambLat, lng: ambLng }]
};
const multi = matchStamps([multiStamp], [multiA, multiB], { assign: { multi: ['ma', 'mb'] } });
assert.equal(multi.assigned.length, 1);
assert.deepEqual(multi.assigned[0].keys, ['ma', 'mb']);
assert.equal(multi.pending.length, 0);
assert.equal(multi.unmatchedLots.length, 0);
const vs = stampAreaVsLots(multiStamp, [multiA, multiB], ['ma', 'mb']);
assert.equal(vs.ok, true);
assert.ok(lotMissingStampAttrs({}));
assert.equal(lotMissingStampAttrs({ lotCode: 'A', floors: '1', coverage: '50', far: '2' }), false);
assert.ok(lotMissingStampAttrs({ name: 'O-1', layer: 'DAT_O' }));
assert.equal(lotMissingStampAttrs({ plan: { floors: '5', coverage: '60', far: '3' } }), false);
assert.equal(lotMissingStampAttrs({ lotCode: 'B1' }), false);
assert.equal(lotMissingStampAttrs({ KyHieu: 'C2' }), false);
assert.deepEqual(assignKeysOf('a'), ['a']);
assert.deepEqual(assignKeysOf(['a', 'b']), ['a', 'b']);
assert.ok(stampPendingWhy(posOnly.pending[0], [{ key: 'solo', area: 5000, layer: '', rings: shared }]).length > 10);

// Tem ghi ha: 0.9 / 0,9 / 0.90 / …ha → 9000 m² (không cần 3 thập phân).
assert.equal(stampAreaM2('0.9', 9015), 9000);
assert.equal(stampAreaM2('0,9', 9015), 9000);
assert.equal(stampAreaM2('0.90', 9015), 9000);
assert.equal(stampAreaM2('0,90', 9015), 9000);
assert.equal(stampAreaM2('0.9ha', 9015), 9000);
assert.equal(stampAreaM2('0,9 ha'.replace(/\s/g, ''), 9015), 9000);
assert.equal(stampAreaM2('0.9'), 9000);
const octLot = { key: 'oct', area: 9015, layer: 'DAT_O_Nhomnhao', rings: shared };
const octStamp = {
  id: 'oct-b6', code: 'OCT-B6', areaRaw: '0.90', floors: '4', coverage: '90', far: '4',
  lat: ambLat + d / 2, lng: ambLng + d / 2,
  cands: [{ lat: ambLat + d / 2, lng: ambLng + d / 2 }]
};
assert.ok(stampAreaMatch(octStamp, octLot));
assert.ok(stampNameMatch(octStamp, octLot));
const octMatch = matchStamps([octStamp], [octLot]);
assert.equal(octMatch.assigned.length, 1);
assert.equal(octMatch.assigned[0].key, 'oct');
assert.ok(octMatch.assigned[0].how.split('+').length >= 2);

// Gợi ý nhiều hatch cạnh nhau, cùng loại, tổng DT = tem.
const dLon = 0.00008;
const ringA = [[
  [ambLng, ambLat], [ambLng + dLon, ambLat], [ambLng + dLon, ambLat + dLon],
  [ambLng, ambLat + dLon], [ambLng, ambLat]
]];
const ringB = [[
  [ambLng + dLon, ambLat], [ambLng + 2 * dLon, ambLat], [ambLng + 2 * dLon, ambLat + dLon],
  [ambLng + dLon, ambLat + dLon], [ambLng + dLon, ambLat]
]];
const hintA = { key: 'ha', area: 5000, layer: 'DAT_O_Nhomnhao', rings: [ringA] };
const hintB = { key: 'hb', area: 4000, layer: 'DAT_O_Nhomnhao', rings: [ringB] };
const hintStamp = {
  id: 'hint-oct', code: 'OCT-Z1', areaRaw: '0.90', floors: '4', coverage: '80', far: '3',
  lat: ambLat + dLon / 2, lng: ambLng + dLon / 2,
  cands: [{ lat: ambLat + dLon / 2, lng: ambLng + dLon / 2 }]
};
const hintKeys = suggestStampLotKeys(hintStamp, [hintA, hintB]);
assert.deepEqual(hintKeys.sort(), ['ha', 'hb']);
const hintMap = suggestPendingStampHints([hintStamp], [hintA, hintB]);
assert.deepEqual(hintMap['hint-oct'].sort(), ['ha', 'hb']);

// Tự pair: tem trên hatch A (DT lệch > 5%) → gộp hatch B cạnh cùng loại đến ±5%.
const growA = { key: 'ga', area: 5000, layer: 'DAT_O_Nhomnhao', rings: [ringA] };
const growB = { key: 'gb', area: 4000, layer: 'DAT_O_Nhomnhao', rings: [ringB] };
const growStamp = {
  id: 'grow-oct', code: 'OCT-G1', areaRaw: '0.90', floors: '4', coverage: '80', far: '3',
  lat: ambLat + dLon / 2, lng: ambLng + dLon / 2,
  cands: [{ lat: ambLat + dLon / 2, lng: ambLng + dLon / 2 }]
};
assert.ok(stampNameMatch(growStamp, growA));
assert.ok(!stampAreaMatch(growStamp, growA, STAMP_AUTO_AREA_TOL), 'một hatch lệch > 5%');
const growMatch = matchStamps([growStamp], [growA, growB]);
assert.equal(growMatch.assigned.length, 1);
assert.deepEqual(growMatch.assigned[0].keys.sort(), ['ga', 'gb']);
assert.ok(String(growMatch.assigned[0].how).includes('multi'));
assert.equal(growMatch.unmatchedLots.length, 0);

// Gần bao ≤ 50 m + tên + DT → tự pair (không cần nằm trong hatch).
const nearD = 0.00035; // ~39 m vĩ độ
const nearRing = [[
  [ambLng + 0.01, ambLat + 0.01],
  [ambLng + 0.01 + dLon, ambLat + 0.01],
  [ambLng + 0.01 + dLon, ambLat + 0.01 + dLon],
  [ambLng + 0.01, ambLat + 0.01 + dLon],
  [ambLng + 0.01, ambLat + 0.01]
]];
const nearLot = { key: 'nl', area: 2500, layer: 'Cong cong', rings: [nearRing] };
const nearEdgeStamp = {
  id: 'near50', code: 'TM-N1', areaRaw: '2500', floors: '3', coverage: '40', far: '1.5',
  lat: ambLat + 0.01 - nearD, lng: ambLng + 0.01 + dLon / 2,
  cands: [{ lat: ambLat + 0.01 - nearD, lng: ambLng + 0.01 + dLon / 2 }]
};
assert.ok(stampNameMatch(nearEdgeStamp, nearLot));
assert.ok(stampAreaMatch(nearEdgeStamp, nearLot, STAMP_AUTO_AREA_TOL));
const nearEdge = matchStamps([nearEdgeStamp], [nearLot], { tolM: STAMP_NEAR_AUTO_M });
assert.equal(nearEdge.assigned.length, 1);
assert.equal(nearEdge.assigned[0].key, 'nl');
assert.ok(String(nearEdge.assigned[0].how).includes('near'));

assert.equal(STAMP_AUTO_AREA_TOL, 0.05);
assert.equal(STAMP_NEAR_AUTO_M, 50);

// Tem giữa lô to: ưu tiên lô chứa tem + DT — không nhảy sang lô cùng loại cách ~500 m.
const bigHalf = 0.002;
const bigRing = [[
  [ambLng - bigHalf, ambLat - bigHalf],
  [ambLng + bigHalf, ambLat - bigHalf],
  [ambLng + bigHalf, ambLat + bigHalf],
  [ambLng - bigHalf, ambLat + bigHalf],
  [ambLng - bigHalf, ambLat - bigHalf]
]];
const farOff = 0.005;
function farRingAt(dx, dy) {
  return [[
    [ambLng + dx, ambLat + dy],
    [ambLng + dx + dLon, ambLat + dy],
    [ambLng + dx + dLon, ambLat + dy + dLon],
    [ambLng + dx, ambLat + dy + dLon],
    [ambLng + dx, ambLat + dy]
  ]];
}
const bigLot = { key: 'big', area: 9000, layer: 'DAT_O_Nhomnhao', rings: [bigRing] };
const far1 = { key: 'f1', area: 4000, layer: 'DAT_O_Nhomnhao', rings: farRingAt(farOff, 0) };
const far2 = { key: 'f2', area: 3500, layer: 'DAT_O_Nhomnhao', rings: farRingAt(farOff, farOff) };
const far3 = { key: 'f3', area: 3000, layer: 'DAT_O_Nhomnhao', rings: farRingAt(0, farOff) };
const midStamp = {
  id: 'mid-big', code: 'OCT-MID', areaRaw: '0.90', floors: '4', coverage: '80', far: '3',
  lat: ambLat, lng: ambLng, cands: [{ lat: ambLat, lng: ambLng }]
};
assert.ok(stampNameMatch(midStamp, bigLot));
assert.ok(stampAreaMatch(midStamp, bigLot, STAMP_AUTO_AREA_TOL));
assert.deepEqual(suggestStampLotKeys(midStamp, [bigLot, far1, far2, far3]), ['big']);
assert.deepEqual(suggestStampLotKeys(midStamp, [far1, far2, far3, bigLot]), ['big']);
const midAuto = matchStamps([midStamp], [bigLot, far1, far2, far3]);
assert.equal(midAuto.assigned.length, 1);
assert.equal(midAuto.assigned[0].key, 'big');
assert.ok(String(midAuto.assigned[0].how).includes('pos'));
assert.ok(String(midAuto.assigned[0].how).includes('area'));
// Trên lô + DT khớp, không cần tên layer → vẫn tự ghép.
const bigBare = { key: 'bigx', area: 9000, layer: 'San_nen_khac', rings: [bigRing] };
assert.ok(!stampNameMatch(midStamp, bigBare));
assert.deepEqual(suggestStampLotKeys(midStamp, [bigBare, far1, far2, far3]), ['bigx']);
const bareArea = matchStamps([midStamp], [bigBare, far1, far2, far3]);
assert.equal(bareArea.assigned.length, 1);
assert.equal(bareArea.assigned[0].key, 'bigx');
assert.equal(bareArea.assigned[0].how, 'pos+area');
// Không có hatch chứa tem, chỉ lô cách ~500 m → không gợi ý xa.
assert.deepEqual(suggestStampLotKeys(midStamp, [far1, far2, far3]), []);
// Tem trên hatch DT lệch + lô bên cạnh có tên+DT → không nhảy pair.
const bareHalf = 0.0002;
const bareLot = {
  key: 'bare', area: 100, layer: 'San_nen_khac',
  rings: [[
    [
      [ambLng - bareHalf, ambLat - bareHalf],
      [ambLng + bareHalf, ambLat - bareHalf],
      [ambLng + bareHalf, ambLat + bareHalf],
      [ambLng - bareHalf, ambLat + bareHalf],
      [ambLng - bareHalf, ambLat - bareHalf]
    ]
  ]]
};
const namedBeside = {
  key: 'beside', area: 2500, layer: 'Cong cong',
  rings: [[
    [
      [ambLng + bareHalf * 2, ambLat - bareHalf],
      [ambLng + bareHalf * 4, ambLat - bareHalf],
      [ambLng + bareHalf * 4, ambLat + bareHalf],
      [ambLng + bareHalf * 2, ambLat + bareHalf],
      [ambLng + bareHalf * 2, ambLat - bareHalf]
    ]
  ]]
};
const onBareStamp = {
  id: 'on-bare', code: 'TM-BARE', areaRaw: '2500', floors: '3', coverage: '40', far: '1.5',
  lat: ambLat, lng: ambLng, cands: [{ lat: ambLat, lng: ambLng }]
};
assert.ok(!stampNameMatch(onBareStamp, bareLot));
assert.ok(stampNameMatch(onBareStamp, namedBeside));
const noJump = matchStamps([onBareStamp], [bareLot, namedBeside], { tolM: STAMP_NEAR_AUTO_M });
assert.equal(noJump.assigned.length, 0, 'tem trên hatch không được pair lô bên cạnh');
assert.equal(noJump.pending.length, 1);
assert.deepEqual(suggestStampLotKeys(onBareStamp, [bareLot, namedBeside]), ['bare']);

console.log('land-stamp: ok');
