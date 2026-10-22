import fs from 'fs';
import { prepareGraveMask, isCemeteryGrave, insideGraveMask } from '../public/js/graveFilter.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const square = prepareGraveMask({
  enabled: true,
  maxAreaM2: 20,
  maxHeightM: 2.5,
  features: [{
    type: 'Feature',
    properties: { src: 'qh' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]
      ]
    }
  }]
});
assert(isCemeteryGrave(square, 12, 2, 0.2, 0.2), 'mộ nhỏ thấp trong nghĩa trang');
assert(isCemeteryGrave(square, 19.9, 2.5, 0.2, 0.2), 'đúng ngưỡng 2,5 m vẫn ẩn');
assert(!isCemeteryGrave(square, 20, 2, 0.2, 0.2), 'đủ 20 m² thì giữ');
assert(!isCemeteryGrave(square, 12, 2.6, 0.2, 0.2), 'cao hơn 2,5 m thì giữ');
assert(!isCemeteryGrave(square, 12, null, 0.2, 0.2), 'chưa có chiều cao thì giữ');
assert(!isCemeteryGrave(square, 12, 1, 2, 2), 'ngoài nghĩa trang thì giữ');
assert(!insideGraveMask(square, 0.5, 0.5), 'lỗ giữa ô không tính');
assert(!isCemeteryGrave({ ...square, enabled: false }, 12, 1, 0.2, 0.2), 'cờ tắt thì vẽ lại');

const mask = prepareGraveMask(JSON.parse(fs.readFileSync(new URL('../public/data/gba/cemetery-mask.geojson', import.meta.url), 'utf8')));
assert(mask.enabled && mask.maxAreaM2 === 60 && mask.maxHeightM === 3.5 && mask.slopeAreaM2 === 180 && mask.lowHeightM === 2.5, 'ngưỡng file');
assert(mask.parts.length > 1000, `quá ít vùng ${mask.parts.length}`);
assert(insideGraveMask(mask, 107.594264, 16.443778), 'thửa 6 tờ 41 An Cựu nằm trong mặt nạ');
assert(isCemeteryGrave(mask, 40, 2, 107.594264, 16.443778), 'mộ nhỏ trong thửa NTD thì ẩn');
assert(!isCemeteryGrave(mask, 150, 1.5, 107.594264, 16.443778), 'dấu chân rộng trong thửa NTD thì giữ');
assert(insideGraveMask(mask, 107.593, 16.446), 'sườn Ngự Bình nằm trong nghĩa trang');
assert(insideGraveMask(mask, 107.5942, 16.4478), 'cụm mộ khoanh đỏ Ngự Bình vẫn bị che');
assert(isCemeteryGrave(mask, 40, 3.5, 107.5942, 16.4478), 'mộ 40 m² cao 3,5 m trong cụm thì ẩn');
assert(isCemeteryGrave(mask, 150, 1.5, 107.5942, 16.4478), 'lăng thấp 150 m² trên sườn thì ẩn');
assert(!isCemeteryGrave(mask, 70, 3.2, 107.5942, 16.4478), 'trên 60 m² và cao hơn 2,5 m thì giữ');
assert(!isCemeteryGrave(mask, 180, 1, 107.5942, 16.4478), 'đủ 180 m² trên sườn thì giữ');
assert(!isCemeteryGrave(mask, 40, 3.6, 107.5942, 16.4478), 'cao hơn 3,5 m thì giữ');
assert(!insideGraveMask(mask, 107.5786, 16.4694), 'kinh thành không phải nghĩa trang');
assert(!insideGraveMask(mask, 107.5905, 16.4637), 'nhà trong phố không nằm trong mặt nạ');
assert(!insideGraveMask(mask, 107.5905, 16.4495), 'điểm ven đường phía tây cụm không nằm trong mặt nạ');

const layer = fs.readFileSync(new URL('../public/js/gbaLayer.js', import.meta.url), 'utf8');
assert(layer.includes('const OUTLINE_ZOOM = 16'), 'ngưỡng viền');
const strokeAt = layer.indexOf("ctx.strokeStyle = c < 0 ? MISSING_STROKE : '#431407'");
const outlineAt = layer.indexOf('const outline = coords.z >= OUTLINE_ZOOM');
const gate = layer.indexOf('if (!outline) return;', outlineAt);
assert(outlineAt > 0 && gate > outlineAt && strokeAt > gate, 'viền chỉ vẽ từ mức 16');
assert(layer.includes('isCemeteryGrave(graveMask'), 'lớp nhà dùng bộ lọc');
assert(!layer.includes('buildings.pmtiles.write') && layer.includes('cemetery-mask.geojson'), 'không ghi đè nguồn');

const raw = JSON.parse(fs.readFileSync(new URL('../public/data/gba/cemetery-mask.geojson', import.meta.url), 'utf8'));
const srcs = new Set(raw.features.map((f) => f.properties.src));
assert(srcs.has('ntd') && srcs.has('qh') && srcs.has('osm') && srcs.has('slope'), 'có NTD, quy hoạch, OSM và sườn');
assert(raw.enabled === true, 'cờ bật');

console.log('grave filter ok', mask.parts.length);
