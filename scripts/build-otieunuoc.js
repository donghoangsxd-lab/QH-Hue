// Dựng ô tiêu nước vùng thấp (dưới +10 m) bám theo sông, kênh → OTieuNuoc.geojson cho push-luuvuc.js (--low).
//   node scripts/build-otieunuoc.js [--elev 10] [--zoom 12] [--min-km2 0.05] [--out OTieuNuoc.geojson]
//     --save-low VungThap.geojson   ghi thêm vùng thấp trước khi cắt (kiểm tra trong QGIS)
//     --boundary ranh.geojson       dùng ranh phường xã có sẵn thay vì tải từ webapp
//     --refresh-osm                 tải lại sông, kênh từ OpenStreetMap (mặc định dùng .cache/osm-nuoc.json nếu có)
// 1. Vùng thấp: ô Terrarium FABDEM (cùng nguồn lớp địa hình, URL lấy qua getDemTile; lỗi thì SRTM AWS),
//    pixel 0 < cao độ < ngưỡng trong ranh 40 phường xã → d3-contour → đa giác. Cao độ ≤ 0 m là mặt nước thường xuyên (như floodSim.js).
// 2. Sông, kênh OpenStreetMap (Overpass): mặt nước (natural=water, waterway=riverbank, landuse=reservoir) trừ khỏi vùng thấp;
//    đường waterway=river|canal|stream|drain|ditch đệm thành hành lang CUT_WIDTH rồi trừ, cắt vùng thấp thành ô.
// 3. Tách mảnh, bỏ mảnh < ngưỡng, đặt tên theo phường chứa điểm nhãn: "Ô <phường>", nhiều ô cùng phường thì đánh số.
// OSM có thể thiếu mương, cống nội thị: mở kết quả trong QGIS kiểm tra, sửa tay nếu cần, rồi chạy push-luuvuc.js.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const osmtogeojson = require('osmtogeojson');
const { loadBoundary, makeInside } = require('./wardBoundary');
const { ROOT, lng2tx, lat2ty, tx2lng, ty2lat, demSource, loadDem, cellSizeM, loadOsm, maskToPolygon } = require('./hydroCommon');

// Bề rộng hành lang cắt (m) theo loại đường nước; sông lớn thường đã có mặt nước nên hành lang chỉ nối chỗ OSM thiếu mặt nước
const CUT_WIDTH = { river: 20, canal: 8, stream: 5, drain: 4, ditch: 3 };

/** Lưới cao độ phủ bbox → { mask: Uint8Array (1 = vùng thấp trong ranh), W, H, tx0, ty0 } */
async function buildLowMask(bbox, z, elevMax, inside, src) {
  const dem = await loadDem(bbox, z, src);
  const { elev, W, H, tx0, ty0 } = dem;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = ty2lat(ty0 + (y + 0.5) / 256, z);
    for (let x = 0; x < W; x++) {
      const e = elev[y * W + x];
      if (!(e > 0 && e < elevMax)) continue;
      if (inside(tx2lng(tx0 + (x + 0.5) / 256, z), lat)) mask[y * W + x] = 1;
    }
  }
  return { mask, W, H, tx0, ty0, tiles: dem.tiles, empty: dem.empty };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const elevMax = Number(opt('--elev') ?? 10);
  const z = Number(opt('--zoom') ?? 12);
  const minKm2 = Number(opt('--min-km2') ?? 0.05);
  const outFile = opt('--out') || path.join(ROOT, 'OTieuNuoc.geojson');
  const lowFile = opt('--save-low');
  if (!Number.isFinite(elevMax)) throw new Error('--elev phải là cao độ (m)');
  if (!Number.isInteger(z) || z < 10 || z > 14) throw new Error('--zoom từ 10 đến 14 (12 ≈ 36 m/pixel, sát DEM 30 m)');

  const t0 = Date.now();
  const sec = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
  const wards = await loadBoundary(opt('--boundary'));
  const inside = makeInside(wards);
  const bbox = turf.bbox(wards);
  console.log(`✓ Ranh: ${wards.features.length} phường xã`);

  const src = await demSource();
  console.log(`… Cao độ: ${src.name}, mức ô ${z}`);
  const grid = await buildLowMask(bbox, z, elevMax, inside, src);
  const cellM = cellSizeM((bbox[1] + bbox[3]) / 2, z);
  const low = await maskToPolygon(grid, z, minKm2 * 1e6 / (cellM * cellM));
  console.log(`✓ Vùng thấp 0–${elevMax} m: ${(turf.area(low) / 1e6).toFixed(1)} km², ${low.geometry.coordinates.length} mảnh`
    + ` (${grid.tiles} ô cao độ, ${grid.empty} ô trống) · ${sec()}`);
  if (lowFile) {
    fs.writeFileSync(lowFile, JSON.stringify(turf.featureCollection([turf.truncate(low, { precision: 6 })])));
    console.log(`✓ Đã ghi vùng thấp: ${lowFile}`);
  }

  const isLow = (lng, lat) => {
    const x = Math.floor((lng2tx(lng, z) - grid.tx0) * 256), y = Math.floor((lat2ty(lat, z) - grid.ty0) * 256);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < grid.W && yy < grid.H && grid.mask[yy * grid.W + xx]) return true;
    }
    return false;
  };
  const touchesLow = (f) => turf.coordAll(f).some(([lng, lat]) => isLow(lng, lat));

  const gj = osmtogeojson(await loadOsm(bbox, args.includes('--refresh-osm')));
  const tagsOf = (f) => (f.properties && (f.properties.tags || f.properties)) || {};
  const water = [], cuts = [];
  gj.features.forEach(f => {
    const g = f.geometry;
    if (!g) return;
    const t = tagsOf(f);
    if ((g.type === 'Polygon' || g.type === 'MultiPolygon')
      && (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir')) {
      if (touchesLow(f)) water.push(f);
    } else if ((g.type === 'LineString' || g.type === 'MultiLineString') && CUT_WIDTH[t.waterway]) {
      if (touchesLow(f)) cuts.push(turf.buffer(f, CUT_WIDTH[t.waterway] / 2, { units: 'meters' }));
    }
  });
  console.log(`✓ OSM trong vùng thấp: ${water.length} mặt nước, ${cuts.length} đoạn sông / kênh / mương · ${sec()}`);

  console.log('… Trừ mặt nước và hành lang sông, kênh khỏi vùng thấp');
  const cutters = [...water, ...cuts].filter(f => f && f.geometry);
  const rest = cutters.length ? turf.difference(turf.featureCollection([low, ...cutters])) : low;
  if (!rest) throw new Error('Vùng thấp bị mặt nước phủ hết — kiểm tra lại ngưỡng --elev');

  const pieces = turf.flatten(rest).features
    .map(f => ({ f, km2: turf.area(f) / 1e6 }))
    .filter(p => p.km2 >= minKm2)
    .sort((a, b) => b.km2 - a.km2);
  const wardOf = (pt) => wards.features.find(w => w.geometry && turf.booleanPointInPolygon(pt, w));
  const byWard = new Map();
  pieces.forEach(p => {
    const w = wardOf(turf.pointOnFeature(p.f));
    p.ward = w ? String(w.properties.tenXa || w.properties.name || '') : '';
    const base = p.ward.replace(/^(Phường|Xã)\s+/i, '') || 'ngoài ranh';
    if (!byWard.has(base)) byWard.set(base, []);
    byWard.get(base).push(p);
  });
  const features = [];
  byWard.forEach((list, base) => list.forEach((p, i) => {
    const Ten = list.length > 1 ? `Ô ${base} ${i + 1}` : `Ô ${base}`;
    features.push(turf.truncate(turf.feature(p.f.geometry, { Ten, phuong: p.ward, km2: Math.round(p.km2 * 100) / 100 }), { precision: 6 }));
  }));
  fs.writeFileSync(outFile, JSON.stringify(turf.featureCollection(features)));
  const total = pieces.reduce((s, p) => s + p.km2, 0);
  console.log(`✓ ${features.length} ô tiêu nước, tổng ${total.toFixed(1)} km²`
    + `${pieces[0] ? `, lớn nhất ${pieces[0].km2.toFixed(1)} km²` : ''} · ${sec()}`);
  console.log(`✓ Đã ghi ${path.relative(ROOT, outFile) || outFile} — mở trong QGIS kiểm tra rồi chạy node scripts/push-luuvuc.js`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
