// Dân chung cư: số dân đã biết, rồi số căn × hộ, rồi tầng × dấu chân. Phần còn lại không âm.
import {
  apartmentPopulation, wardSplit, servedPopulation, floodPopulation, setPopData, setPopConfig, POP_DEFAULTS
} from '../public/js/popMethod.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const cfg = { ...POP_DEFAULTS };
assert(apartmentPopulation({ residents: 120 }, cfg).pop === 120, 'ưu tiên số dân đã ghi');
assert(apartmentPopulation({ residents: 0, units: 10 }, cfg).pop === 33, 'số căn × 3,3');
const tang = apartmentPopulation({ floors: 10, footprint: 1000 }, cfg);
assert(Math.round(tang.pop) === 300 && tang.how === 'tang', '10 tầng × 1000 × 0,75 / 25 = 300');
assert(apartmentPopulation({ footprint: 800 }, cfg).how === 'thieu', 'thiếu số tầng thì chưa tính');

setPopData({
  hhSize: 3.3,
  m2PerPerson: 25,
  efficiency: 0.75,
  items: [
    { id: 'A', ward: 'P', floors: 10, footprint: 1000, residents: null, units: null, elev: 3, school: true, health: false, park: false, schoolX: true, healthX: false, parkX: false },
    { id: 'B', ward: 'P', residents: 500, elev: 8, school: false, health: false, park: false, schoolX: false, healthX: false, parkX: false }
  ]
}, {
  wards: [{
    name: 'P', pop: 1000, lowW: 100,
    bins: [[2, 40], [9, 60]],
    schoolW: 25, healthW: 0, parkW: 0,
    schoolX: 25, healthX: 0, parkX: 0
  }]
});
setPopConfig(cfg);
const split = wardSplit('P');
assert(split.apt === 800 && split.remain === 200 && !split.warn, '300 + 500, còn 200');
const over = wardSplit('P', cfg);
assert(over.remain === 200, 'không âm');

setPopData({
  items: [{ id: 'C', ward: 'Q', residents: 1500, elev: 1, school: false, health: false, park: false, schoolX: false, healthX: false, parkX: false }]
}, { wards: [{ name: 'Q', pop: 1000, lowW: 50, bins: [[1, 50]], schoolW: 10, healthW: 0, parkW: 0, schoolX: 10, healthX: 0, parkX: 0 }] });
const clip = wardSplit('Q');
assert(clip.warn && clip.remain === 0, 'vượt dân số thì nhà thấp tầng bằng 0 và có cảnh báo');

setPopData({
  items: [{ id: 'A', ward: 'P', floors: 10, footprint: 1000, elev: 3, school: true, health: false, park: false, schoolX: true, healthX: false, parkX: false }]
}, {
  wards: [{
    name: 'P', pop: 1000, lowW: 100,
    bins: [[2, 40], [9, 60]],
    schoolW: 50, healthW: 0, parkW: 0,
    schoolX: 50, healthX: 0, parkX: 0
  }]
});
const school = servedPopulation('P', 'school');
assert(Math.round(school) === 650, 'nhà thấp 700 × 0,5 + chung cư 300 trong vùng trường');
const flood = floodPopulation(5);
assert(Math.round(flood.pop) === 580, 'ngập: 700 × 0,4 + chung cư cao độ 3');
assert(flood.wards[0].name === 'P', 'có phường');

console.log('apartments: ok');
