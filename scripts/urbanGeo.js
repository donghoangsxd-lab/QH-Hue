// Hàm hình học dùng chung cho các script dựng ranh khu vực đô thị (build-urban614.js, build-urban-vision.js).
const turf = require('@turf/turf');

const TOL = 0.0003; // ~30 m, đủ cho mức thu nhỏ toàn thành phố
const SLIVER_M2 = 300000; // mảnh lệch nét giữa các nguồn ranh

const bare = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[-–—]/g, ' ')
  .replace(/\s+/g, ' ').trim().toUpperCase()
  .replace(/^(PHUONG|XA)\s+/, '');

const union = (feats) => (feats.length === 1 ? feats[0] : turf.union(turf.featureCollection(feats)));

function dropSlivers(feature) {
  if (!feature) return null;
  const g = feature.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const kept = polys
    .map(([outer, ...holes]) => [outer, ...holes.filter(h => turf.area(turf.polygon([h])) >= SLIVER_M2)])
    .filter(p => turf.area(turf.polygon(p)) >= SLIVER_M2);
  if (!kept.length) return null;
  return kept.length === 1 ? turf.polygon(kept[0]) : turf.multiPolygon(kept);
}

function slim(feature) {
  const s = turf.simplify(feature, { tolerance: TOL, highQuality: true });
  return turf.truncate(s, { precision: 5, coordinates: 2 });
}

function anchorOf(feature) {
  const c = turf.centerOfMass(feature);
  const pt = turf.booleanPointInPolygon(c, feature) ? c : turf.pointOnFeature(feature);
  return pt.geometry.coordinates.map(v => Math.round(v * 1e5) / 1e5);
}

/** Tra ranh phường, xã theo tên (bỏ dấu, bỏ tiền tố Phường/Xã); thiếu tên nào thì báo lỗi. */
function wardPicker(wardsFc) {
  const byName = new Map(wardsFc.features.map(f => [bare(f.properties.tenXa || f.properties.name), turf.feature(f.geometry)]));
  const pick = (names) => names.map(n => {
    const f = byName.get(bare(n));
    if (!f) throw new Error(`Không có ranh ${n}`);
    return f;
  });
  return { pick, size: byName.size };
}

/** Feature vùng đã lọc mảnh, đơn giản hóa, kèm điểm đặt ký hiệu (trên các phường lõi nếu có) và diện tích. */
function areaFeature(id, raw, coreFeature) {
  const clean = dropSlivers(raw);
  if (!clean) throw new Error(`Ranh ${id} rỗng sau khi lọc mảnh`);
  const anchor = anchorOf(coreFeature || clean);
  const out = slim(clean);
  out.properties = { id, anchor, km2: Math.round(turf.area(clean) / 1e4) / 100 };
  return out;
}

module.exports = { bare, union, dropSlivers, slim, anchorOf, wardPicker, areaFeature };
