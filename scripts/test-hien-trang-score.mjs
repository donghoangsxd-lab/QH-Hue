import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HT_FILES, itemsFrom, buildFacts, describeHt, mergeEntry, htFootNote,
  _installFactsForTest, _resetHtForTest
} from '../public/js/hienTrangScore.js';
import { gapCounts, gapMarkdown } from '../public/js/urbanEntrySchema.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8'));

const gt = itemsFrom(read('hien-trang-tam/giao-thong.geojson'), { role: 'gt', scale: 0 });
assert.ok(gt.some(it => it.kind === 'road' && it.tam));
assert.ok(gt.some(it => it.kind === 'junction'));
assert.equal(gt.some(it => it.kind === 'road' && it.scale !== 0), false);

const urbans = [
  { id: 'hue' },
  { id: 'trung-tam', units: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An'] },
  { id: 'phong-dien', units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'] },
  { id: 'vinh-thanh' },
  { id: 'khe-tre' }
];
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

const counts = gapCounts();
assert.equal(counts.thieu, 510);
assert.match(gapMarkdown(), /chiều dài ống/);
assert.match(gapMarkdown(), /510 ô thiếu/);

console.log('hien trang score ok', {
  hueRoadKm: Math.round(hue.roadM / 100) / 10,
  huePipeKm: Math.round(hue.pipeM / 100) / 10,
  hueJunctions: hue.junctions,
  centerDrainKm: Math.round(center.drainM / 100) / 10,
  phongLandHa: Math.round(phong.landM2 / 1000) / 10,
  thuanPipeKm: Math.round(thuan.pipeM / 100) / 10
});
