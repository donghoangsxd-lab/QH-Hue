// Ranh khu vực đô thị hiện trạng theo Quyết định 614/QĐ-UBND ngày 10/02/2026 (Phụ lục I) cho lớp urbanAreaLayer.js.
//   node scripts/build-urban614.js [đường-dẫn-ra] [--boundary ranh40.geojson]
// Ghép từ ranh 40 phường xã đang dùng trên webapp để khớp nét ranh phường. Phần chỉ còn trên ranh trước sáp nhập lấy
// OpenStreetMap ngày 01/6/2025 (ODbL): Phong Điền = 4 phường + phần phường Phong Quảng thuộc thị xã Phong Điền cũ;
// Thanh Hà (xã Quảng Thành cũ) = phường Hóa Châu trừ phường Hương Phong, Hương Vinh cũ.
// 9 đô thị trên một phần xã chưa có ranh thị trấn, xã cũ: chỉ ghi điểm đặt ký hiệu.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const osmtogeojson = require('osmtogeojson');
const { loadBoundary } = require('./wardBoundary');

const OSM_DATE = '2025-06-01T00:00:00Z';
const OSM_REL = { phongDien: 7051224, huongPhong: 15852553, huongVinh: 15852552 };
// Truy vấn theo ngày (attic) chỉ chạy trên máy chủ chính; các máy chủ sau để thử lại khi quá tải
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const TOL = 0.0003; // ~30 m, đủ cho mức thu nhỏ toàn thành phố
const SLIVER_M2 = 300000; // mảnh lệch nét giữa 2 nguồn ranh

// Đô thị ghép trọn phường, xã: units = toàn bộ; core = phường lõi để đặt ký hiệu
const WARD_URBANS = {
  'hue': { core: ['Thuận Hóa', 'Phú Xuân'] },
  'huong-thuy': { units: ['Thanh Thủy', 'Hương Thủy', 'Phú Bài'], core: ['Thanh Thủy', 'Hương Thủy'] },
  'huong-tra': { units: ['Hương Trà', 'Kim Trà', 'Bình Điền'], core: ['Hương Trà', 'Kim Trà'] },
  'phong-dien': { units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú'], core: ['Phong Thái', 'Phong Dinh'] }
};

// [lng, lat] trung tâm thị trấn, xã cũ trên OpenStreetMap; approx = chỉ có điểm của xã mới
const ANCHORS = {
  'loc-son': { at: [107.73955, 16.34667] },
  'sia': { at: [107.51427, 16.57493] },
  'phu-da': { at: [107.71534, 16.43986] },
  'phu-loc': { at: [107.85898, 16.28035] },
  'lang-co': { at: [108.07804, 16.24089] },
  'khe-tre': { at: [107.71849, 16.16842] },
  'a-luoi': { at: [107.23075, 16.27221] },
  'vinh-hien': { at: [107.89586, 16.34744] },
  'vinh-thanh': { at: [107.78461, 16.43324], approx: true }
};

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

async function overpass(query) {
  for (let round = 0; round < 4; round++) {
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': 'QH-Hue/urban614', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(200000)
        });
        const text = await res.text();
        if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
        console.warn(`${url} → HTTP ${res.status}`);
      } catch (err) {
        console.warn(`${url} → ${err.cause?.code || err.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  throw new Error('Overpass không phản hồi');
}

async function loadOldUnits() {
  const ids = Object.values(OSM_REL).join(',');
  const data = await overpass(`[out:json][timeout:180][date:"${OSM_DATE}"];rel(id:${ids});(._;>;);out body;`);
  const fc = osmtogeojson(data);
  const out = {};
  Object.entries(OSM_REL).forEach(([key, id]) => {
    const f = fc.features.find(x => x.id === `relation/${id}`);
    if (!f || !/Polygon/.test(f.geometry?.type)) throw new Error(`Thiếu ranh OSM relation/${id} (${key})`);
    out[key] = turf.feature(f.geometry);
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--boundary');
  const boundaryFile = bi >= 0 ? args.splice(bi, 2)[1] : null;
  const dest = args[0] || path.join(__dirname, '..', 'public', 'data', 'urban614.geojson');

  const wards = await loadBoundary(boundaryFile);
  const byName = new Map(wards.features.map(f => [bare(f.properties.tenXa || f.properties.name), turf.feature(f.geometry)]));
  const pick = (names) => names.map(n => {
    const f = byName.get(bare(n));
    if (!f) throw new Error(`Không có ranh ${n}`);
    return f;
  });
  console.log(`${byName.size} phường xã`);

  const old = await loadOldUnits();
  console.log('Đã tải ranh OSM 01/6/2025');

  const areas = {};
  areas.hue = union(wards.features.map(f => turf.feature(f.geometry)));
  areas['huong-thuy'] = union(pick(WARD_URBANS['huong-thuy'].units));
  areas['huong-tra'] = union(pick(WARD_URBANS['huong-tra'].units));
  const phongHai = dropSlivers(turf.intersect(turf.featureCollection([pick(['Phong Quảng'])[0], old.phongDien])));
  areas['phong-dien'] = union([...pick(WARD_URBANS['phong-dien'].units), ...(phongHai ? [phongHai] : [])]);
  const oldWards = union([old.huongPhong, old.huongVinh]);
  areas['thanh-ha'] = turf.difference(turf.featureCollection([pick(['Hóa Châu'])[0], oldWards]));

  const features = [];
  Object.entries(areas).forEach(([id, raw]) => {
    const clean = dropSlivers(raw);
    if (!clean) throw new Error(`Ranh ${id} rỗng sau khi lọc mảnh`);
    const core = WARD_URBANS[id]?.core;
    const anchor = anchorOf(core ? union(pick(core)) : clean);
    const out = slim(clean);
    out.properties = { id, anchor, km2: Math.round(turf.area(clean) / 1e4) / 100 };
    features.push(out);
    console.log(`${id}: ${out.properties.km2} km²`);
  });
  Object.entries(ANCHORS).forEach(([id, a]) => {
    features.push(turf.point(a.at, { id, ...(a.approx ? { approx: true } : {}) }));
  });

  const fc = {
    type: 'FeatureCollection',
    ref: 'Quyết định 614/QĐ-UBND ngày 10/02/2026',
    source: `Ranh 40 phường xã webapp; ranh trước sáp nhập © OpenStreetMap contributors (ODbL), ngày ${OSM_DATE.slice(0, 10)}`,
    features
  };
  const text = JSON.stringify(fc);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log(`${features.length} đối tượng, ${(text.length / 1024).toFixed(0)} KB → ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
