// Tab NOXH: hiện trạng tính dân, quy hoạch không tính, thương mại chỉ là nhãn.
const { phaseOf, kindOf, fold, parseWktPolygon, peopleOf, normalizeNoxhItem, normalizeNoxhPack } = require('../services/noxh');
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(fold('Trạng thái') === 'trangthai', 'trạng thái');
assert(fold('Diện tích (ha)') === 'dientichha', 'diện tích ha');
assert(fold('MĐXD (%)') === 'mdxd', 'mđxd');
assert(fold('Số căn hộ') === 'socanho', 'số căn');
assert(fold('WKT_simplified') === 'wktsimplified', 'wkt');
assert(phaseOf('Hiện trạng') === 'hien_trang', 'hiện trạng');
assert(phaseOf('Đã hoàn thành') === 'hien_trang', 'đã hoàn thành');
assert(phaseOf('hien_trang') === 'hien_trang', 'mã hiện trạng');
assert(phaseOf('') === 'quy_hoach', 'trống là quy hoạch');
assert(phaseOf('Quy hoạch') === 'quy_hoach', 'quy hoạch');
assert(phaseOf('Đang kêu gọi đầu tư') === 'quy_hoach', 'kêu gọi');
assert(kindOf('Thương mại') === 'thuongmai', 'thương mại');
assert(kindOf('TM') === 'thuongmai', 'tm');
assert(kindOf('NOXH') === 'noxh', 'noxh');
assert(kindOf('Nhà ở xã hội') === 'noxh', 'xã hội');
assert(kindOf('') === '', 'loại trống');

const wkt = 'POLYGON ((107.61 16.46, 107.62 16.46, 107.62 16.47, 107.61 16.46))';
const geom = parseWktPolygon(wkt);
assert(geom && geom.type === 'Polygon' && geom.coordinates[0].length === 4, 'wkt');
assert(parseWktPolygon('POINT (1 2)') === null, 'không phải polygon');

assert(peopleOf({ residents: 100, units: 10 }) === 100, 'dân số thắng số căn');
assert(peopleOf({ units: 10 }) === 33, '10 căn × 3,3');
assert(peopleOf({}) === 0, 'thiếu số');

const tm = normalizeNoxhItem({
  name: 'Manor', status: 'Hiện trạng', kind: 'Thương mại', units: 100, wkt, detail: 'thương mại'
}, 0);
assert(tm && tm.status === 'hien_trang' && tm.kind === 'thuongmai' && tm.pop === 330, 'thương mại vẫn tính dân');
assert(tm.geometry && tm.areaM2 > 0, 'diện tích từ polygon');

const qh = normalizeNoxhItem({ name: 'Khu E', status: '', detail: 'Đang khởi công', units: 500, lat: 16.45, lng: 107.6 }, 1);
assert(qh && qh.status === 'quy_hoach' && qh.pop === 0, 'quy hoạch không tính');

const done = normalizeNoxhItem({ name: 'XH3', status: '', detail: 'Đã hoàn thành', units: 182, lat: 16.47, lng: 107.6 }, 2);
assert(done && done.status === 'hien_trang' && done.pop === 601, 'mô tả đã hoàn thành khi thiếu trạng thái');

const ha = normalizeNoxhItem({ name: 'A', status: 'hien_trang', residents: 10, siteHa: 1.9, lat: 16.4, lng: 107.5 }, 3);
assert(ha.areaM2 === 19000, '1,9 ha');
const m2 = normalizeNoxhItem({ name: 'B', status: 'hien_trang', residents: 10, siteHa: 500, lat: 16.4, lng: 107.5 }, 4);
assert(m2.areaM2 === 500, 'số lớn là m²');

const pack = normalizeNoxhPack({ items: [
  { name: 'A', status: 'Hiện trạng', units: 10, lat: 16.4, lng: 107.5 },
  { name: 'A', status: 'Quy hoạch', units: 99, lat: 16.41, lng: 107.51 }
]});
assert(pack.items.length === 2 && pack.items[0].id !== pack.items[1].id, 'trùng tên thì tách id');
assert(pack.items[0].pop === 33 && pack.items[1].pop === 0, 'chỉ hiện trạng có dân');
const again = normalizeNoxhPack({ items: [
  { name: 'A', status: 'Hiện trạng', units: 20, lat: 16.4, lng: 107.5 },
  { name: 'A', status: 'Quy hoạch', units: 99, lat: 16.41, lng: 107.51 }
]});
assert(pack.version !== again.version, 'đổi số căn thì đổi version');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'gba', 'apartments.json'), 'utf8'));
const seeded = normalizeNoxhPack(seed);
assert(seeded.items.length === 4, 'seed 4 hiện trạng');
assert(seeded.items.every(it => it.status === 'hien_trang' && it.geometry), 'seed có polygon');
assert(seeded.items.reduce((s, it) => s + it.pop, 0) === 6251, 'dân seed');

console.log('noxh: ok', seeded.version);
