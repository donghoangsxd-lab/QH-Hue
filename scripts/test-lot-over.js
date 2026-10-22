// Số lô vượt đã chốt: tổng phường khớp tệp, mỗi dòng là lô vượt thật.
import { readFileSync } from 'node:fs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const data = JSON.parse(readFileSync(new URL('../public/data/gba/lot-over.json', import.meta.url), 'utf8'));
const t = data.totals;
assert(t.cover === 818 && t.floors === 481, 'tổng vượt');
assert(t.withCover === 10418 && t.withFloors === 11328 && t.lots === 11492, 'mẫu số');
assert(t.outside === 16, 'tâm lô ngoài ranh');
assert(data.wards.length === 32, '32 phường có lô vượt');
const cover = data.wards.reduce((s, w) => s + w.cover, 0);
const floors = data.wards.reduce((s, w) => s + w.floors, 0);
assert(cover === 818 && floors === 481, 'cộng phường');
data.wards.forEach((w) => {
  let oc = 0;
  let ofl = 0;
  w.items.forEach((it) => {
    assert(it.oc || it.of, `${w.name} ${it.id} không vượt`);
    if (it.oc) oc += 1;
    if (it.of) ofl += 1;
    assert(Number.isFinite(it.lng) && Number.isFinite(it.lat), 'toạ độ');
  });
  assert(oc === w.cover && ofl === w.floors, `${w.name} đếm lệch`);
});
console.log('lot-over: ok');
