import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HT_FILES, itemsFrom, buildFacts, describeHt, mergeEntry, htFootNote, measures, mainDrain,
  _installFactsForTest, _resetHtForTest
} from '../public/js/hienTrangScore.js';
import { EVAL_URBANS, MAP_2A, fieldsForScope, gapCounts, gapMarkdown, gapRows } from '../public/js/urbanEntrySchema.js';
import { planUrbanOf } from '../public/js/urbanClass.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8'));

const gt = itemsFrom(read('hien-trang-tam/giao-thong.geojson'), { role: 'gt', scale: 0 });
assert.ok(gt.some(it => it.kind === 'road' && it.tam));
assert.ok(gt.some(it => it.kind === 'junction'));
assert.equal(gt.some(it => it.kind === 'road' && it.scale !== 0), false);

const urbans = EVAL_URBANS.map(u => planUrbanOf(u.id)).filter(Boolean);
const layers = HT_FILES.map(spec => ({ spec, fc: read(spec.file) }));
const t0 = Date.now();
const built = buildFacts(layers, read('urban614.geojson'), read('ward-boundary.json'), urbans);
console.log('hien trang score clip ms', Date.now() - t0);

const hue = built.urban.get('hue');
const center = built.urban.get('trung-tam');
const phong = built.urban.get('phong-dien');
const vinh = built.urban.get('vinh-thanh');
assert.ok(hue.roadM > 1000, 'thanh pho co duong tam');
assert.ok(hue.pipeM > 1000, 'thanh pho co ong cap nuoc');
assert.ok(hue.junctions > 0);
assert.ok(center.pipeM > 0, 'trung tam cat theo hop phuong');
assert.ok(center.roadM > 0);
assert.ok(phong.landM2 > 0, 'KCN Phong Dien cat vao do thi');
assert.equal(vinh.landM2, 0);

const thuan = built.ward.get('THUAN HOA');
const aluoi = built.ward.get('A LUOI 5');
assert.ok(thuan && thuan.pipeM > 0);
assert.ok(aluoi);
assert.equal(aluoi.pipeM, 0);

_resetHtForTest();
assert.equal(describeHt('2A.III.08', { id: 'hue' }), null);
_installFactsForTest(built);
const water = describeHt('2A.III.08', { id: 'hue' });
assert.match(water.text, /tạm thời|cap-nuoc/);
assert.match(water.aside, /tạm thời/);
assert.doesNotMatch(water.text, /%/);
const over = mergeEntry({ value: 80, officer: true, note: 'Cán bộ nhập trên luồng Hành chính.' }, water);
assert.equal(over.value, 80);
assert.match(over.note, /Không dùng/);
assert.equal(over.aside, undefined);
const open = mergeEntry({ pending: true, note: 'Chưa có số liệu nhập' }, water);
assert.match(open.aside, /tạm thời/);
assert.match(htFootNote({ id: 'hue' }, 'Phường Thuận Hóa'), /Cấp điện/);
assert.match(htFootNote({ id: 'hue' }, 'Phường Thuận Hóa'), /Thuận Hóa|tạm thời/i);

assert.equal(mainDrain({ duongkinh: 'D300' }), null);
assert.deepEqual(mainDrain({ duongkinh: 'D1500' }), { sized: true });
assert.deepEqual(mainDrain({ duongkinh: 'B25M' }), { sized: true });
assert.deepEqual(mainDrain({ duongkinh: 'B2000' }), { sized: true });
assert.deepEqual(mainDrain({ loaiphanluu: '1' }), { sized: false });
assert.equal(mainDrain({ loaiphanluu: '2' }), null);
const drainItems = itemsFrom({
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[107.5, 16.4], [107.51, 16.41]] }, properties: { duongkinh: 'D300' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[107.5, 16.4], [107.51, 16.41]] }, properties: { duongkinh: 'D1500' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[107.5, 16.4], [107.51, 16.41]] }, properties: {} }
  ]
}, { role: 'drain', scale: 10000 });
assert.equal(drainItems.length, 2);
assert.equal(drainItems.filter(it => it.sized).length, 1);

const xaFields = fieldsForScope('xa').map(f => f.code);
['2A.II.05', '2A.III.08', '2A.III.11', '2A.III.14'].forEach(code => assert.equal(xaFields.includes(code), false, code));
['2A.III.09', '2A.III.10', '2A.III.12', '2A.III.21'].forEach(code => assert.equal(xaFields.includes(code), true, code));
assert.equal(MAP_2A['2A.III.09'], 'matDoCong');
const counts = gapCounts();
assert.equal(counts.thieu, 130);
assert.equal(gapRows().some(r => r.unitKey.startsWith('xa:') && r.code === '2A.II.05'), false);
assert.equal(gapRows().find(r => r.unitKey === 'dothi:trung-tam' && r.code === '2A.III.09').status, 'phu-thuoc');
assert.equal(gapRows().find(r => r.unitKey === 'xa:thuan-hoa' && r.code === '2A.III.21').status, 'phu-thuoc');
assert.match(gapMarkdown(), /130 ô thiếu/);

const coverRows = [];
EVAL_URBANS.filter(u => u.cls !== 'I').forEach(u => {
  const b = built.urban.get(u.id);
  assert.ok(b, u.id);
  const ctx = { builtKm2: b.areaM2 / 1e6, builtExact: false };
  const row = measures(b, ctx);
  coverRows.push({
    id: u.id,
    km: Math.round(b.mainM / 100) / 10,
    drain: b.drainSeen ? (row['2A.III.09'].value == null ? 'cho' : Number(row['2A.III.09'].value.toFixed(2))) : 'ngoai',
    ww: b.opCap > 0 && b.designCap > 0 ? Number((b.opCap / b.designCap * 100).toFixed(1)) : (b.designCap > 0 ? 'thiet-ke' : (b.opCap > 0 ? 'thieu-tk' : 'khong')),
    cem: (b.cemHtHa + b.cemNtdM2 / 10000) > 0 && (b.cemQhHa + b.cemNtrM2 / 10000) > 0
      ? Number(((b.cemHtHa + b.cemNtdM2 / 10000) / (b.cemQhHa + b.cemNtrM2 / 10000) * 100).toFixed(1))
      : ((b.cemQhHa + b.cemNtrM2 / 10000) > 0 ? 'thieu-ht' : ((b.cemHtHa + b.cemNtdM2 / 10000) > 0 ? 'thieu-qh' : 'khong')),
    greenHa: Math.round(b.greenM2 / 1000) / 10,
    landFrac: b.areaM2 > 0 ? Math.round(b.landM2 / b.areaM2 * 1000) / 10 : 0
  });
});
const wardEntries = [...built.ward.entries()];
const named = (pred) => wardEntries.filter(([, b]) => pred(b)).map(([name]) => name);
const wardCover = {
  n: wardEntries.length,
  drain: named(b => b.drainSeen && b.mainM > 0).length,
  drainNone: named(b => !(b.drainSeen && b.mainM > 0)),
  ww: named(b => b.opCap > 0 && b.designCap > 0),
  wwDesign: named(b => b.designCap > 0 && !(b.opCap > 0)).length,
  cem: named(b => (b.cemHtHa + b.cemNtdM2 / 10000) > 0 && (b.cemQhHa + b.cemNtrM2 / 10000) > 0),
  greenLand: named(b => b.areaM2 > 0 && b.landM2 / b.areaM2 >= 0.5).length
};
console.log('do phu 4 tieu chi', JSON.stringify({ urbans: coverRows, wards: wardCover }));

console.log('hien trang score ok', {
  hueRoadKm: Math.round(hue.roadM / 100) / 10,
  huePipeKm: Math.round(hue.pipeM / 100) / 10,
  hueJunctions: hue.junctions,
  centerMainKm: Math.round(center.mainM / 100) / 10,
  phongLandHa: Math.round(phong.landM2 / 1000) / 10,
  thuanPipeKm: Math.round(thuan.pipeM / 100) / 10
});
