// Tab NOXH: hiện trạng tính dân, quy hoạch không tính, thương mại chỉ là nhãn.
const { phaseOf, kindOf, fold, parseWktPolygon, peopleOf, normalizeNoxhItem, normalizeNoxhPack, isNoxhSheetName, pickNoxhSheetName, confidenceOf } = require('../services/noxh');
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
assert(fold('Loại') === 'loai', 'loại');
assert(fold('loai_chi_tiet') === 'loaichitiet', 'loại chi tiết');
assert(fold('do_tin_cay') === 'dotincay', 'độ tin cậy');
assert(fold('ghi_chu_dinh_vi') === 'ghichudinhvi', 'ghi chú định vị');
assert(fold('ghi chú') !== fold('ghi_chu_dinh_vi'), 'ghi chú không nuốt định vị');
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

assert(pickNoxhSheetName(['8-VH', '14-NOXH', 'NOXH']) === 'NOXH', 'ưu tiên đúng tên NOXH');
assert(pickNoxhSheetName(['8-VH', '14-NOXH']) === '14-NOXH', 'tab đánh số');
assert(pickNoxhSheetName(['8-VH', '14 - NOXH']) === '14 - NOXH', 'khoảng trắng quanh gạch');
assert(isNoxhSheetName('NOXH') === true, 'đúng tên');
assert(isNoxhSheetName('14_NOXH') === true, 'gạch dưới');
assert(isNoxhSheetName('14.NOXH') === true, 'dấu chấm');
assert(isNoxhSheetName('14-NOXH phụ') === false, 'không nuốt hậu tố');
assert(isNoxhSheetName('noxh') === false, 'không khớp chữ thường không số');
assert(isNoxhSheetName('8-VH') === false, 'tab khác');
assert(confidenceOf('Cao') === 'high', 'độ tin cậy cao');
assert(confidenceOf('gần đúng') === 'gần đúng', 'giữ chữ tự do');

const hole = parseWktPolygon('POLYGON ((107.60 16.46, 107.62 16.46, 107.62 16.48, 107.60 16.48, 107.60 16.46), (107.605 16.465, 107.610 16.465, 107.610 16.470, 107.605 16.470, 107.605 16.465))');
assert(hole && hole.type === 'Polygon' && hole.coordinates.length === 2, 'polygon có lỗ');

const multiWkt = 'MULTIPOLYGON (((107.60 16.46, 107.61 16.46, 107.61 16.47, 107.60 16.47, 107.60 16.46)), ((107.70 16.50, 107.71 16.50, 107.71 16.51, 107.70 16.51, 107.70 16.50)))';
const multi = parseWktPolygon(multiWkt);
assert(multi && multi.type === 'MultiPolygon' && multi.coordinates.length === 2, 'multipolygon hai mảnh');
const row = normalizeNoxhItem({
  name: 'Khu A',
  status: 'hien_trang',
  kind: 'NOXH',
  loai_chi_tiet: 'Chung cư',
  do_tin_cay: 'Cao',
  ghi_chu_dinh_vi: 'Bám ranh lô',
  units: 10,
  wkt: multiWkt
}, 5);
assert(row && row.kind === 'noxh' && row.kindDetail === 'Chung cư' && row.confidence === 'high', 'cột loại chi tiết');
assert(row.locateNote === 'Bám ranh lô' && row.pop === 33, 'ghi chú và dân hiện trạng');
assert(row.geometry.type === 'MultiPolygon' && Number.isFinite(row.lat) && Number.isFinite(row.lng) && row.areaM2 > 0, 'tâm và diện tích multipolygon');
assert(row.wkt.indexOf('MULTIPOLYGON') === 0, 'giữ WKT gốc');

const plan = normalizeNoxhItem({ name: 'Khu B', status: 'quy_hoach', units: 40, wkt: multiWkt }, 6);
assert(plan && plan.status === 'quy_hoach' && plan.pop === 0 && plan.geometry.type === 'MultiPolygon', 'quy hoạch không tính dân');

console.log('noxh: ok', seeded.version);
