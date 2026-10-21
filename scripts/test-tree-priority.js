const { cemeteryRadius, cemeteryBuffers, acceptYear, rowsFromFeatures, popFromPixels, assignFallbackPop, scoreTreeWards, MIN_BUILT_HA } = require('../services/treePriority');

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

console.log('ok tree priority');
