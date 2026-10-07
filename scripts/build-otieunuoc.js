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
const { PNG } = require('pngjs');
const turf = require('@turf/turf');
const osmtogeojson = require('osmtogeojson');
const { GEE_API_URL, loadBoundary, makeInside } = require('./wardBoundary');

const ROOT = path.join(__dirname, '..');
const AWS_TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
// Bề rộng hành lang cắt (m) theo loại đường nước; sông lớn thường đã có mặt nước nên hành lang chỉ nối chỗ OSM thiếu mặt nước
const CUT_WIDTH = { river: 20, canal: 8, stream: 5, drain: 4, ditch: 3 };
const D2R = Math.PI / 180;

const lng2tx = (lng, z) => (lng + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => {
  const s = Math.sin(lat * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const tx2lng = (t, z) => t / 2 ** z * 360 - 180;
const ty2lat = (t, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / 2 ** z))) / D2R;

async function demSource() {
  try {
    const r = await fetch(`${GEE_API_URL}?action=getDemTile&dem=fabdem`, { signal: AbortSignal.timeout(90000) });
    const d = await r.json();
    if (d && d.urlFormat) return { url: d.urlFormat, name: 'FABDEM (cao độ nền)' };
  } catch (e) { /* GEE lỗi → SRTM */ }
  return { url: AWS_TERRARIUM, name: 'SRTM qua AWS (cao độ bề mặt, còn mái nhà và tán cây)' };
}

async function fetchTile(url) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return PNG.sync.read(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (k === 2) throw new Error(`Không tải được ô cao độ ${url}: ${e.message}`);
    }
  }
  return null;
}

/** Ghép ô Terrarium phủ bbox → { mask: Uint8Array (1 = vùng thấp trong ranh), W, H, tx0, ty0 } */
async function buildLowMask(bbox, z, elevMax, inside, src) {
  const tx0 = Math.floor(lng2tx(bbox[0], z)), tx1 = Math.floor(lng2tx(bbox[2], z));
  const ty0 = Math.floor(lat2ty(bbox[3], z)), ty1 = Math.floor(lat2ty(bbox[1], z));
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1, W = nx * 256, H = ny * 256;
  const mask = new Uint8Array(W * H);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0, empty = 0;
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.pop();
      const png = await fetchTile(src.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty));
      if (!png) { empty++; } else {
        const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (let py = 0; py < 256; py++) {
          const lat = ty2lat(ty + (py + 0.5) / 256, z);
          for (let px = 0; px < 256; px++) {
            const o = (py * 256 + px) * 4;
            if (png.data[o + 3] === 0) continue;
            const e = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
            if (!(e > 0 && e < elevMax)) continue;
            if (inside(tx2lng(tx + (px + 0.5) / 256, z), lat)) mask[(oy + py) * W + ox + px] = 1;
          }
        }
      }
      if (++done % 20 === 0) process.stdout.write(`\r… ô cao độ ${done}/${nx * ny}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  process.stdout.write('\r');
  return { mask, W, H, tx0, ty0, tiles: nx * ny, empty };
}

const ringAreaPx = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
};

/** Bỏ đỉnh thẳng hàng tuyệt đối (đường viền ô lưới có nhiều đoạn ngang / dọc liên tiếp) — không làm hỏng hình học */
function dropCollinear(ring) {
  const out = [];
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) out.push(b);
  }
  out.push(out[0]);
  return out;
}

/** Mặt nạ vùng thấp → MultiPolygon kinh / vĩ, bỏ mảnh và lỗ nhỏ hơn minPx pixel */
async function maskToPolygon({ mask, W, H, tx0, ty0 }, z, minPx) {
  const { contours } = await import('d3-contour');
  const mp = contours().size([W, H]).smooth(false).thresholds([0.5])(mask)[0];
  const toLL = ([x, y]) => [tx2lng(tx0 + x / 256, z), ty2lat(ty0 + y / 256, z)];
  const polys = [];
  mp.coordinates.forEach(poly => {
    if (ringAreaPx(poly[0]) < minPx) return;
    const rings = [poly[0], ...poly.slice(1).filter(r => ringAreaPx(r) >= minPx)]
      .map(dropCollinear).filter(r => r.length >= 4).map(r => r.map(toLL));
    if (rings.length && rings[0].length >= 4) polys.push(rings);
  });
  return turf.multiPolygon(polys);
}

async function loadOsm(bbox, cacheFile, refresh) {
  if (!refresh && fs.existsSync(cacheFile)) {
    console.log(`… Dùng sông, kênh OSM đã lưu: ${path.relative(ROOT, cacheFile)} (--refresh-osm để tải lại)`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const [w, s, e, n] = bbox;
  const b = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:300];(
    way["natural"="water"](${b});relation["natural"="water"](${b});
    way["waterway"="riverbank"](${b});relation["waterway"="riverbank"](${b});
    way["landuse"="reservoir"](${b});
    way["waterway"~"^(river|canal|stream|drain|ditch)$"](${b});
  );(._;>;);out body qt;`;
  console.log('… Tải sông, kênh, mặt nước từ OpenStreetMap (Overpass, có thể mất vài phút)');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'qh-hue/build-otieunuoc' },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(400000)
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} — thử lại sau hoặc đặt OVERPASS_URL sang máy chủ khác`);
  const osm = await res.json();
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(osm));
  return osm;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const elevMax = Number(opt('--elev') ?? 10);
  const z = Number(opt('--zoom') ?? 12);
  const minKm2 = Number(opt('--min-km2') ?? 0.05);
  const outFile = opt('--out') || path.join(ROOT, 'OTieuNuoc.geojson');
  const lowFile = opt('--save-low');
  const cacheFile = path.join(ROOT, '.cache', 'osm-nuoc.json');
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
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cellM = 40075016 * Math.cos(midLat * D2R) / (256 * 2 ** z);
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

  const gj = osmtogeojson(await loadOsm(bbox, cacheFile, args.includes('--refresh-osm')));
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
