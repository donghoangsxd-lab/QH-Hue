import fs from 'fs';
import { acceptMissingFeature, missingPaintForTile, prepareMissingFootprints, projectLngLat, tileOf } from '../public/js/bldgMissing.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const raw = JSON.parse(fs.readFileSync(new URL('../public/data/gba/bldg-missing.geojson', import.meta.url), 'utf8'));
assert(raw.enabled === true && raw.minAreaM2 === 1000 && raw.maxOverlap === 0.25, 'ngưỡng file');
assert(raw.features.length === 96, `sai số tấm ${raw.features.length}`);
const text = JSON.stringify(raw);
assert(!text.includes('labelFloors') && !text.includes('"floors"') && !text.includes('"parts"'), 'không có số tầng hay tấm giả');
const wards = new Set();
for (const feature of raw.features) {
  assert(acceptMissingFeature(feature, raw.enabled), 'tấm không đạt điều kiện');
  assert(feature.geometry.type === 'Polygon', 'chỉ polygon thật');
  wards.add(feature.properties.ward);
}
assert(wards.size === 18, `sai số phường ${wards.size}`);

const off = prepareMissingFootprints({ ...raw, enabled: false });
assert(off.length === 0, 'enabled=false thì không vẽ');
const list = prepareMissingFootprints(raw);
assert(list.length === 96, `sai số vòng ${list.length}`);
const lng = 107.587843;
const lat = 16.461888;
for (const z of [14, 15, 16]) {
  const tile = tileOf(lng, lat, z);
  const hits = missingPaintForTile(list, tile);
  const px = projectLngLat(lng, lat, tile);
  assert(hits.some((ft) => ft.unknown === true && ft.floors == null && ft.label == null && pointInRing(px[0], px[1], ft.rings[0])), `trọng tâm lệch ở mức ${z}`);
}
const deep = tileOf(lng, lat, 16);
const parent = missingPaintForTile(list, { z: 17, x: deep.x, y: deep.y });
assert(parent.length === 0, 'không chiếu nhầm sang ô mức 17');

assert(!acceptMissingFeature({
  type: 'Feature',
  properties: { src: 'ms', areaM2: 1500, overlap: 0, labelFloors: 5 },
  geometry: raw.features[0].geometry
}), 'có số tầng thì bỏ');
assert(!acceptMissingFeature({
  type: 'Feature',
  properties: { src: 'ms', areaM2: 900, overlap: 0 },
  geometry: raw.features[0].geometry
}), 'dưới 1000 m² thì bỏ');
assert(!acceptMissingFeature({
  type: 'Feature',
  properties: { src: 'ms', areaM2: 1500, overlap: 0.25 },
  geometry: raw.features[0].geometry
}), 'giao đúng 25% thì bỏ');

const layer = fs.readFileSync(new URL('../public/js/gbaLayer.js', import.meta.url), 'utf8');
assert(layer.includes('ft.unknown ? -1'), 'không tô xám vào nhóm 1-2 tầng');
assert(layer.includes('c < 0 ? MISSING_FILL'), 'màu riêng');
assert(layer.includes('c < 0 ? MISSING_STROKE'), 'viền riêng');
assert(layer.includes('missingFor(coords, dz)'), 'vẽ cùng ô dấu chân');
assert(layer.includes("data/gba/bldg-missing.geojson"), 'đúng file');
const view3d = fs.readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
assert(!view3d.includes('bldg-missing'), 'không dựng 3D khi chưa có chiều cao');
const note = fs.readFileSync(new URL('../public/js/gbaStats.js', import.meta.url), 'utf8');
assert(note.includes('không dựng khối 3D') && note.includes('1000 m²'), 'ghi chú nguồn');

console.log(`missing buildings ok ${raw.features.length} wards ${wards.size}`);
