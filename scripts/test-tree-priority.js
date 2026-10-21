const { cemeteryRadius, cemeteryBuffers, acceptYear, rowsFromFeatures, popFromPixels, assignFallbackPop, scoreTreeWards, MIN_BUILT_HA, zoneLevel, landKind, normalizeZones, ZONE_LEVELS } = require('../services/treePriority');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(cemeteryRadius(null) === 60, 'nghĩa trang thiếu diện tích');
assert(cemeteryRadius(0) === 60, 'diện tích 0');
assert(cemeteryRadius(1) === 40, 'bán kính sàn');
assert(cemeteryRadius(Math.PI * 100 * 100) === 100, 'bán kính đúng diện tích');
assert(cemeteryRadius(Math.PI * 1000 * 1000) === 600, 'bán kính trần');

const buffers = cemeteryBuffers([
  { type: '11-NT', status: true, ntKind: 'cemetery_hung', lat: 16.4, lng: 107.5, size: Math.PI * 80 * 80 },
  { type: '11-NT', status: true, ntKind: 'funeral', lat: 16.5, lng: 107.6, size: 1000 },
  { type: '11-NT', status: false, ntKind: 'cemetery_cat', lat: 16.5, lng: 107.6, size: 5000 },
  { type: '1-CV', status: true, ntKind: 'cemetery_hung', lat: 16.5, lng: 107.6 }
]);
assert(buffers.length === 1 && buffers[0].radius === 80, 'chỉ nghĩa trang đã duyệt');

assert(acceptYear(2024, [2014, 2024, 2026]) === 2024, 'năm hợp lệ');
assert(acceptYear(2016, [2014, 2016, 2026]) === null, 'trước NDVI');
assert(acceptYear(2010, [2024]) === null, 'ngoài danh sách');

const merged = rowsFromFeatures(
  { features: [{ properties: { tenXa: 'A', lst_mean: 40, ndvi_mean: 0.2 } }] },
  { features: [{ properties: { tenXa: 'A', pop_sum: 1000, builtHa_sum: 20 } }, { properties: { name: 'B', pop: 5, builtHa: 1 } }] }
);
assert(merged.length === 2, 'hai phường');
const a = merged.find(r => r.name === 'A');
assert(a.lst === 40 && a.ndvi === 0.2 && a.pop === 1000 && a.builtHa === 20, 'đọc hậu tố reducer');

const bare = rowsFromFeatures(
  { features: [{ properties: { tenXa: 'C', lst: 33, ndvi: 0.4 } }] },
  { features: [{ properties: { tenXa: 'C', pop: 50, builtHa: 10 } }] }
);
assert(bare[0].lst === 33 && bare[0].pop === 50, 'đọc tên band');
assert(popFromPixels(1000, 25, 100) === 250, 'dân theo tỉ lệ pixel');
assert(popFromPixels(1000, 0, 100) === 0, 'không có pixel xây dựng');
assert(popFromPixels(0, 10, 10) === null, 'thiếu dân số phường');
const fb = assignFallbackPop([{ name: 'V', danSo: 49684, urbanPix: 40, allPix: 80, pop: 99999, builtHa: 10, lst: 36, ndvi: 0.3 }]);
assert(fb[0].pop === 24842, 'raster cũ lấy một nửa dân phường');

const scored = scoreTreeWards([
  { name: 'A', builtHa: 100, lst: 40, ndvi: 0.15, pop: 20000 },
  { name: 'B', builtHa: 100, lst: 32, ndvi: 0.55, pop: 2000 },
  { name: 'C', builtHa: 5, lst: 45, ndvi: 0.05, pop: 5000 }
]);
assert(scored.ranked === 2, 'hai phường được xếp');
assert(scored.wards[0].name === 'A' && scored.wards[0].rank === 1 && scored.wards[0].score === 100, 'A nóng, ít cây, đông');
assert(scored.wards[1].name === 'B' && scored.wards[1].rank === 2 && scored.wards[1].score === 0, 'B mát hơn');
assert(scored.wards[2].name === 'C' && scored.wards[2].rank == null && scored.wards[2].score == null, 'C không đủ đất xây dựng');
assert(scored.cityLst === 36, 'nhiệt trung bình theo diện tích');
assert(scored.wards[0].lstGap === 4 && scored.wards[1].lstGap === -4, 'chênh nhiệt');
assert(scored.wards[0].density === 200 && scored.wards[1].density === 20, 'người/ha');
assert(MIN_BUILT_HA === 15, 'ngưỡng 15 ha');

const weighted = scoreTreeWards([
  { name: 'Nóng', builtHa: 100, lst: 40, ndvi: 0.2, pop: 1000 },
  { name: 'Rộng', builtHa: 300, lst: 30, ndvi: 0.2, pop: 3000 }
]);
assert(weighted.cityLst === 32.5, 'trung bình có trọng số diện tích');

const tied = scoreTreeWards([
  { name: 'Xa B', builtHa: 20, lst: 35, ndvi: 0.3, pop: 2000 },
  { name: 'Phường A', builtHa: 20, lst: 35, ndvi: 0.3, pop: 2000 }
]);
assert(tied.wards[0].score === 50 && tied.wards[1].score === 50, 'hòa hạng bách phân');
assert(tied.wards[0].name === 'Phường A' && tied.wards[1].name === 'Xa B', 'hòa thì sort tên');

const missing = scoreTreeWards([{ name: 'D', builtHa: 40, lst: null, ndvi: 0.2, pop: 1000 }]);
assert(missing.wards[0].rank == null, 'thiếu nhiệt thì không xếp');

assert(zoneLevel(37, 0.25, true) === 3, 'rất cần');
assert(zoneLevel(36, 0.35, true) === 2, 'cần');
assert(zoneLevel(34.2, 0.44, true) === 1, 'theo dõi');
assert(zoneLevel(38, 0.2, false) === 0, 'không có dân cư');
assert(zoneLevel(33, 0.2, true) === 0, 'chưa đủ nóng');
assert(zoneLevel(36.5, 0.32, true) === 3 && zoneLevel(35.5, 0.38, true) === 2 && zoneLevel(34, 0.45, true) === 1, 'đúng ngưỡng');

assert(landKind({ lotCode: 'DGD', density: 80 }) === 'sân trường', 'đất giáo dục');
assert(landKind({ facilityType: '4-TH', name: 'Trường gần chợ' }) === 'sân trường', 'trường học');
assert(landKind({ lotCode: 'TMD-1' }) === 'khu chợ', 'thương mại');
assert(landKind({ facilityType: '9-TM' }) === 'khu chợ', 'loại chợ');
assert(landKind({ name: 'Chợ Đông Ba' }) === 'khu chợ', 'tên chợ');
assert(landKind({ name: 'Cho An Cuu' }) === 'khu chợ', 'tên không dấu');
assert(landKind({ lotCode: 'DGT' }) === 'dải phố', 'giao thông');
assert(landKind({ lotCode: 'GT1' }) === 'dải phố', 'mã GT');
assert(landKind({ lotCode: 'DTT' }) === 'sân thể thao', 'thể thao');
assert(landKind({ facilityType: '8-VH' }) === 'sân thể thao', 'văn hóa');
assert(landKind({ lotCode: 'ODT' }) === 'khu ở', 'đất ở đô thị');
assert(landKind({ lotCode: 'ONT' }) === 'khu ở', 'đất ở nông thôn');
assert(landKind({ density: 40, ndvi: 0.4 }) === 'khu ở', 'mật độ cao');
assert(landKind({ density: 20, ndvi: 0.2 }) === 'sân, bãi', 'sân bãi');
assert(landKind({ density: 10, ndvi: 0.4 }) === 'khu dân cư', 'mặc định');
assert(landKind({ name: 'school yard', density: 10, ndvi: 0.4 }) === 'khu dân cư', 'không nhận nhầm chữ school');

const ring = { type: 'Polygon', coordinates: [[[107.5, 16.4], [107.51, 16.4], [107.51, 16.41], [107.5, 16.4]]] };
const zones = normalizeZones({
  features: [
    { properties: { level: 1, ha: 2, lst_mean: 34.2, ndvi_mean: 0.4, popHa_mean: 20, lat: 16.4, lng: 107.5, ward: 'A' }, geometry: ring },
    { properties: { level: 3, ha: 1.2, lst: 37, ndvi: 0.2, popHa: 50, lat: 16.5, lng: 107.6, ward: 'B' }, geometry: ring },
    { properties: { level: 3, ha: 4, lst: 38, ndvi: 0.2, popHa: 10, lat: 16.46, lng: 107.58, ward: 'C' }, geometry: ring },
    { properties: { level: 3, ha: 0.2, lst: 37, ndvi: 0.2, popHa: 50 }, geometry: ring },
    { properties: { level: 0, ha: 5, lst: 30 }, geometry: ring },
    { properties: { level: 2, ha: 4, lst: 36 }, geometry: null }
  ]
}, { lst: 35.4 });
assert(zones.length === 3, 'bỏ vùng nhỏ, mức 0 và thiếu hình');
assert(zones[0].level === 3 && zones[0].ward === 'C' && zones[0].ha === 4 && zones[0].id === 1, 'mức cao, diện tích lớn trước');
assert(zones[1].level === 3 && zones[1].ward === 'B' && zones[1].lstGap === 1.6 && zones[1].pop === 60, 'dân và chênh nhiệt');
assert(zones[2].level === 1 && zones[2].ward === 'A', 'theo dõi sau cùng');
assert(ZONE_LEVELS.map(l => l.label).join('/') === 'Rất cần/Cần/Theo dõi', 'ba mức chú giải');

console.log('ok tree priority');
