import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const turf = require('@turf/turf');
import { DVHC_WARDS, DVHC_CITY } from '../public/js/dvhcStats.js';
import {
  DOTHI_2030, DOTHI_SAU, HT_GROUPS, HT_URBANS, NOTE_2030, PLAN_FOOT,
  PLAN_2030_II, PLAN_2030_III, PLAN_2030_PD, wardMarks
} from '../public/js/doThiQd756.js';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');

function propsKm(file) {
  const fc = JSON.parse(read(file));
  const map = new Map();
  for (const feature of fc.features || []) {
    const p = feature.properties || {};
    if (p.id) map.set(p.id, p.km2);
  }
  return map;
}

const km614 = propsKm('public/data/urban614.geojson');
const kmVis = propsKm('public/data/urbanVision.geojson');
const kmGp = propsKm('public/data/generalPlan.geojson');
const kmChan = propsKm('public/data/dothi-chan-may.geojson');
const kmOf = {
  'data/urban614.geojson': km614,
  'data/urbanVision.geojson': kmVis,
  'data/generalPlan.geojson': kmGp,
  'data/dothi-chan-may.geojson': kmChan
};

function flat(groups) {
  return groups.flatMap(g => g.rows);
}

function popOf(names) {
  const byBare = new Map(Object.entries(DVHC_WARDS).map(([name, row]) => [name.replace(/^Phường |^Xã /, ''), row]));
  return names.reduce((sum, name) => {
    const row = DVHC_WARDS[`Phường ${name}`] || DVHC_WARDS[`Xã ${name}`] || byBare.get(name);
    assert.ok(row, name);
    return sum + row.pop;
  }, 0);
}

function expectGeom(item, file, id) {
  assert.equal(item.missing, false, item.id);
  assert.equal(item.geom && item.geom.file, file, item.id);
  assert.equal(item.geom && item.geom.id, id, item.id);
  assert.equal(item.km2, kmOf[file].get(id), `${item.id} km²`);
}

const rows2030 = flat(DOTHI_2030);
const rowsSau = flat(DOTHI_SAU);
const rowsHt = flat(HT_GROUPS);

assert.deepEqual(DOTHI_2030.map(g => [g.cls, g.rows.length]), [['I', 1], ['II', 2], ['III', 13]]);
assert.equal(rows2030.length, 16);
assert.equal(rows2030[0].name, 'Thành phố Huế');
assert.equal(rows2030[0].cls, 'I');
assert.equal(rows2030[0].cityPlan, true);
assert.equal(rows2030[0].km2, DVHC_CITY.km2);
assert.equal(rows2030[0].pop, null);
assert.equal(rows2030.filter(r => r.cls === 'II').length, 2);
assert.equal(rows2030.filter(r => r.cls === 'III').length, 13);
assert.deepEqual(rows2030.filter(r => r.strive).map(r => r.id), ['trung-tam', 'huong-thuy', 'quang-dien', 'a-luoi-2']);
assert.match(NOTE_2030, /12 loại II/);
assert.match(NOTE_2030, /10 loại III/);
assert.match(NOTE_2030, /Quảng Điền/);
assert.match(NOTE_2030, /A Lưới 2/);

expectGeom(rows2030.find(r => r.id === 'trung-tam'), 'data/generalPlan.geojson', 'trung-tam');
assert.equal(rows2030.find(r => r.id === 'trung-tam').members.includes('Hóa Châu'), false);
expectGeom(rows2030.find(r => r.id === 'huong-thuy'), 'data/generalPlan.geojson', 'huong-thuy');
expectGeom(rows2030.find(r => r.id === 'huong-tra'), 'data/generalPlan.geojson', 'huong-tra');
expectGeom(rows2030.find(r => r.id === 'phong-dien'), 'data/urbanVision.geojson', 'phong-dien');
expectGeom(rows2030.find(r => r.id === 'hoa-chau'), 'data/generalPlan.geojson', 'hoa-chau');
expectGeom(rows2030.find(r => r.id === 'my-thuong'), 'data/generalPlan.geojson', 'my-thuong');
const chan2030 = rows2030.find(r => r.id === 'chan-may');
expectGeom(chan2030, 'data/dothi-chan-may.geojson', 'chan-may-lang-co');
assert.notEqual(chan2030.km2, km614.get('lang-co'));
assert.notEqual(chan2030.km2, kmVis.get('chan-may'));
const chanFeat = JSON.parse(read('public/data/dothi-chan-may.geojson')).features[0];
assert.equal(chanFeat.geometry.type, 'Polygon');
assert.equal(chanFeat.properties.km2, Math.round(turf.area(chanFeat) / 1e4) / 100);
expectGeom(rows2030.find(r => r.id === 'quang-dien'), 'data/urban614.geojson', 'sia');
expectGeom(rows2030.find(r => r.id === 'a-luoi-2'), 'data/urban614.geojson', 'a-luoi');
for (const [id, kmId] of [['vinh-thanh', 'vinh-thanh'], ['phu-da', 'phu-da'], ['loc-son', 'loc-son'], ['khe-tre', 'khe-tre'], ['phu-loc', 'phu-loc'], ['vinh-hien', 'vinh-hien']]) {
  expectGeom(rows2030.find(r => r.id === id), 'data/urban614.geojson', kmId);
}

assert.deepEqual(DOTHI_SAU.map(g => [g.cls, g.rows.length]), [['I', 1], ['II', 5], ['III', 7]]);
assert.equal(rowsSau[0].name, 'Thành phố Huế');
assert.equal(rowsSau[0].cityPlan, true);
assert.equal(rowsSau[0].pop, null);
assert.deepEqual(rowsSau.filter(r => r.strive).map(r => r.id), ['huong-tra', 'phong-dien', 'chan-may']);
expectGeom(rowsSau.find(r => r.id === 'trung-tam'), 'data/urbanVision.geojson', 'trung-tam');
assert.ok(rowsSau.find(r => r.id === 'trung-tam').members.includes('Hóa Châu'));
assert.ok(rowsSau.find(r => r.id === 'trung-tam').members.includes('Mỹ Thượng'));
expectGeom(rowsSau.find(r => r.id === 'chan-may'), 'data/urbanVision.geojson', 'chan-may');
expectGeom(rowsSau.find(r => r.id === 'a-luoi'), 'data/urbanVision.geojson', 'a-luoi');
assert.equal(rowsSau.find(r => r.id === 'a-luoi').cls, 'III');
const siaSau = rowsSau.find(r => r.id === 'quang-dien');
expectGeom(siaSau, 'data/urban614.geojson', 'sia');
assert.equal(siaSau.core, 'Sịa');
expectGeom(rowsSau.find(r => r.id === 'phu-vinh'), 'data/urbanVision.geojson', 'vinh-thanh');
expectGeom(rowsSau.find(r => r.id === 'phu-vang'), 'data/urbanVision.geojson', 'phu-da');
expectGeom(rowsSau.find(r => r.id === 'hung-loc'), 'data/urbanVision.geojson', 'loc-son');
expectGeom(rowsSau.find(r => r.id === 'khe-tre'), 'data/urbanVision.geojson', 'khe-tre');
expectGeom(rowsSau.find(r => r.id === 'phu-ho'), 'data/generalPlan.geojson', 'phu-ho');
assert.equal(rowsSau.find(r => r.id === 'phu-vinh').core, 'Vinh Thanh');
assert.equal(rowsSau.find(r => r.id === 'phu-vang').core, 'Phú Đa');
assert.equal(rowsSau.find(r => r.id === 'hung-loc').core, 'Lộc Sơn');
assert.notEqual(rowsSau.find(r => r.id === 'khe-tre').km2, km614.get('khe-tre'));
for (const id of ['hoa-chau', 'my-thuong', 'vinh-thanh', 'phu-da', 'loc-son', 'vinh-hien', 'phu-loc', 'a-luoi-2']) {
  assert.equal(rowsSau.some(r => r.id === id), false, id);
}

assert.equal(HT_URBANS.length, 14);
assert.equal(rowsHt.length, 14);
assert.equal(rowsHt[0].name, 'Đô thị Huế');
assert.equal(rowsHt[0].cls, 'I');
assert.equal(rowsHt[0].pop, null);
expectGeom(rowsHt[0], 'data/urban614.geojson', 'hue');
assert.equal(rowsHt[0].kv, 'TP');
assert.equal(rowsHt.filter(r => r.cls === 'III').length, 13);
assert.equal(rowsHt[0].cityPlan, false);
const thuy = rowsHt.find(r => r.id === 'ht-huong-thuy');
const tra = rowsHt.find(r => r.id === 'ht-huong-tra');
expectGeom(thuy, 'data/urban614.geojson', 'huong-thuy');
expectGeom(tra, 'data/urban614.geojson', 'huong-tra');
assert.equal(thuy.pop, popOf(['Thanh Thủy', 'Phú Bài', 'Hương Thủy']));
assert.equal(tra.pop, popOf(['Hương Trà', 'Kim Trà', 'Bình Điền']));
expectGeom(rowsHt.find(r => r.id === 'ht-phong-dien'), 'data/urban614.geojson', 'phong-dien');
assert.equal(rowsHt.find(r => r.id === 'ht-phong-dien').pop, null);
for (const item of rowsHt.slice(1)) assert.equal(item.cls, 'III', item.id);
for (const item of [...rows2030, ...rowsSau, ...rowsHt]) {
  if (item.geom && item.geom.file === 'data/urban614.geojson' && item.geom.id === 'hue') {
    assert.equal(item.id, 'ht-hue');
  }
}
const wired = [
  [rowsHt, 'ht-hue'],
  [rows2030, 'chan-may'],
  [rowsSau, 'phu-vinh'],
  [rowsSau, 'phu-vang'],
  [rowsSau, 'hung-loc'],
  [rowsSau, 'khe-tre'],
  [rowsSau, 'phu-ho']
];
for (const [list, id] of wired) {
  const item = list.find(r => r.id === id);
  assert.equal(item.missing, false, id);
  assert.ok(item.geom && item.geom.file && item.geom.id, id);
  assert.equal(typeof item.km2, 'number', id);
  assert.ok(item.km2 > 0, id);
}

let ii = 0; let iii = 0; let pd = 0; let dash = 0;
let ht2 = 0; let ht3 = 0; let htDash = 0;
for (const name of Object.keys(DVHC_WARDS)) {
  const marks = wardMarks(name);
  if (marks.plan === 'II') ii += 1;
  else if (marks.plan === 'III') iii += 1;
  else if (marks.plan === 'PĐ III') pd += 1;
  else if (marks.plan === '—') dash += 1;
  else assert.fail(name + ' ' + marks.plan);
  if (marks.ht === 'II') ht2 += 1;
  else if (marks.ht === 'III') ht3 += 1;
  else if (marks.ht === '—') htDash += 1;
  else assert.fail('HT ' + name);
}
assert.equal(ii, 12);
assert.equal(iii, 10);
assert.equal(pd, 2);
assert.equal(dash, 16);
assert.equal(PLAN_2030_II.length, 12);
assert.equal(PLAN_2030_III.length, 10);
assert.equal(PLAN_2030_PD.length, 2);
assert.equal(ht2, 8);
assert.equal(ht3, 13);
assert.equal(htDash, 19);
assert.equal(wardMarks('Xã Chân Mây - Lăng Cô').plan, 'III');
assert.equal(wardMarks('Xã Chân Mây - Lăng Cô').planTitle, 'Xã định hướng nâng lên phường');
assert.equal(wardMarks('Xã Chân Mây - Lăng Cô').ht, '—');
assert.equal(wardMarks('Xã Quảng Điền').plan, 'PĐ III');
assert.equal(wardMarks('Xã Quảng Điền').planTitle, 'Phấn đấu đạt loại III');
assert.equal(wardMarks('Xã Quảng Điền').note, 'Đô thị Sịa');
assert.equal(wardMarks('Xã A Lưới 2').planTitle, 'Phấn đấu đạt loại III');
assert.equal(wardMarks('Xã A Lưới 2').note, 'Thị trấn A Lưới cũ');
assert.equal(wardMarks('Xã Bình Điền').plan, '—');
assert.equal(wardMarks('Xã Bình Điền').ht, '—');
assert.equal(wardMarks(DVHC_CITY.name).plan, 'I');
assert.equal(wardMarks(DVHC_CITY.name).ht, 'I');
assert.match(wardMarks('Phường Thuận Hóa').htTitle, /Loại trước chuyển tiếp: I/);
assert.match(wardMarks('Phường Phong Điền').htTitle, /Loại trước chuyển tiếp: IV/);
assert.match(wardMarks('Phường Hóa Châu').htTitle, /Loại trước chuyển tiếp: I/);
assert.match(wardMarks('Phường Hóa Châu').htTitle, /loại III/);
assert.equal(PLAN_FOOT, 'Theo QĐ 756; kế hoạch nâng loại có thể thay đổi theo nghiên cứu cụ thể');

const gp = read('public/js/generalPlanUi.js');
assert.match(gp, /g\.rows\.map\(item => areaBtn\(item, \+\+n, period\)\)/);
assert.match(gp, /const num = `\$\{n\}\.`/);
assert.doesNotMatch(gp, /isCityRow\(item\) \? null/);
assert.match(gp, /getViewMode\(\) === 'HT'/);

console.log('do thi qd756 ok');
