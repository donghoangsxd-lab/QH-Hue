// Nhà ngập: bậc 0,5 m, chỉ cao độ > 0. Mực 5 m và 1,5 m khớp tệp đã chốt.
import { readFileSync } from 'node:fs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const data = JSON.parse(readFileSync(new URL('../public/data/gba/bldg-flood.json', import.meta.url), 'utf8'));
assert(data.step === 0.5 && data.maxM === 15, 'bậc');

function total(level) {
  let n = 0;
  data.wards.forEach((w) => w.bins.forEach((c, i) => { if (i * data.step < level) n += c; }));
  return n;
}

assert(total(5) === 291338, `mực 5 m ${total(5)}`);
assert(total(1.5) > 0 && total(1.5) < total(5), 'mực 1,5 m ít hơn');
assert(data.wards.length === 32, 'phường có nhà dưới 15 m');
const sum = data.wards.reduce((s, w) => s + w.n, 0);
assert(sum === data.buildings && sum === 805763, 'tổng 0–15 m');
console.log('bldg-flood: ok', total(1.5));
