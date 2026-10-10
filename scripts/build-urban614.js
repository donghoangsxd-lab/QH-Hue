// Ranh khu vực đô thị hiện trạng theo Quyết định 614/QĐ-UBND ngày 10/02/2026 (Phụ lục I) cho lớp urbanAreaLayer.js.
//   node scripts/build-urban614.js [đường-dẫn-ra] [--boundary ranh40.geojson] [--xa-cu xaCu.geojson]
// Ghép từ ranh 40 phường xã đang dùng trên webapp để khớp nét ranh phường. Phần chỉ còn trên ranh trước sáp nhập lấy
// OpenStreetMap ngày 01/6/2025 (ODbL): Phong Điền = 4 phường + phần phường Phong Quảng thuộc thị xã Phong Điền cũ;
// Thanh Hà (xã Quảng Thành cũ) = phường Hóa Châu trừ phường Hương Phong, Hương Vinh cũ.
// 9 đô thị trên một phần xã = thị trấn, xã cũ (scripts/data/xaCu-dothiV.geojson, trích lớp bl_xaphuong của WebGIS gServer
// sở ngành, địa giới trước 2020, trùng phạm vi lúc được công nhận) cắt theo phường, xã hiện nay. --xa-cu nhận cả file
// tải đủ 153 xã, chọn theo objectid.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const osmtogeojson = require('osmtogeojson');
const { loadBoundary } = require('./wardBoundary');
const { union, dropSlivers, wardPicker, areaFeature } = require('./urbanGeo');

const OSM_DATE = '2025-06-01T00:00:00Z';
const OSM_REL = { phongDien: 7051224, huongPhong: 15852553, huongVinh: 15852552 };
// Truy vấn theo ngày (attic) chỉ chạy trên máy chủ chính; các máy chủ sau để thử lại khi quá tải
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

// Đô thị ghép trọn phường, xã: units = toàn bộ; core = phường lõi để đặt ký hiệu
const WARD_URBANS = {
  'hue': { core: ['Thuận Hóa', 'Phú Xuân'] },
  'huong-thuy': { units: ['Thanh Thủy', 'Hương Thủy', 'Phú Bài'], core: ['Thanh Thủy', 'Hương Thủy'] },
  'huong-tra': { units: ['Hương Trà', 'Kim Trà', 'Bình Điền'], core: ['Hương Trà', 'Kim Trà'] },
  'phong-dien': { units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú'], core: ['Phong Thái', 'Phong Dinh'] }
};

// at = [lng, lat] trung tâm thị trấn, xã cũ trên OpenStreetMap (đặt ký hiệu); oid = objectid trong bl_xaphuong;
// ward = phường, xã hiện nay chứa đô thị. Thị trấn A Lưới cũ không có tên trong lớp: lấy polygon chứa trung tâm thị trấn.
const OLD_TOWNS = {
  'loc-son': { at: [107.73955, 16.34667], oid: 122, ward: 'Hưng Lộc' },
  'sia': { at: [107.51427, 16.57493], oid: 44, ward: 'Quảng Điền' },
  'phu-da': { at: [107.71534, 16.43986], oid: 69, ward: 'Phú Vang' },
  'phu-loc': { at: [107.85898, 16.28035], oid: 115, ward: 'Phú Lộc' },
  'lang-co': { at: [108.07804, 16.24089], oid: 143, ward: 'Chân Mây - Lăng Cô' },
  'khe-tre': { at: [107.71849, 16.16842], oid: 132, ward: 'Khe Tre' },
  'a-luoi': { at: [107.23075, 16.27221], oid: 146, ward: 'A Lưới 2', inferred: true },
  'vinh-hien': { at: [107.89586, 16.34744], oid: 120, ward: 'Vinh Lộc' },
  'vinh-thanh': { at: [107.78461, 16.43324], oid: 70, ward: 'Phú Vinh' }
};
const OLD_TOWNS_FILE = path.join(__dirname, 'data', 'xaCu-dothiV.geojson');

function loadOldTowns(file) {
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byOid = new Map(fc.features.map(f => [Number(f.properties.objectid), turf.feature(f.geometry)]));
  return Object.fromEntries(Object.entries(OLD_TOWNS).map(([id, t]) => {
    const f = byOid.get(t.oid);
    if (!f) throw new Error(`Thiếu ranh xã cũ objectid ${t.oid} (${id}) trong ${file}`);
    if (!turf.booleanPointInPolygon(t.at, f)) throw new Error(`Trung tâm ${id} nằm ngoài polygon objectid ${t.oid}`);
    return [id, f];
  }));
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
  const xi = args.indexOf('--xa-cu');
  const oldTownsFile = xi >= 0 ? args.splice(xi, 2)[1] : OLD_TOWNS_FILE;
  const dest = args[0] || path.join(__dirname, '..', 'public', 'data', 'urban614.geojson');

  const wards = await loadBoundary(boundaryFile);
  const { pick, size } = wardPicker(wards);
  console.log(`${size} phường xã`);

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
    const core = WARD_URBANS[id]?.core;
    const out = areaFeature(id, raw, core ? union(pick(core)) : null);
    features.push(out);
    console.log(`${id}: ${out.properties.km2} km²`);
  });
  const towns = loadOldTowns(oldTownsFile);
  Object.entries(OLD_TOWNS).forEach(([id, t]) => {
    const raw = turf.intersect(turf.featureCollection([towns[id], pick([t.ward])[0]]));
    if (!raw) throw new Error(`Ranh ${id} không giao ${t.ward}`);
    const out = areaFeature(id, raw, null);
    out.properties.anchor = t.at;
    if (t.inferred) out.properties.inferred = true;
    features.push(out);
    console.log(`${id}: ${out.properties.km2} km²`);
  });

  const fc = {
    type: 'FeatureCollection',
    ref: 'Quyết định 614/QĐ-UBND ngày 10/02/2026',
    source: `Ranh 40 phường xã webapp; ranh trước sáp nhập © OpenStreetMap contributors (ODbL), ngày ${OSM_DATE.slice(0, 10)}; `
      + 'thị trấn, xã cũ: WebGIS gServer sở ngành Huế (bl_xaphuong, trước 2020)',
    features
  };
  const text = JSON.stringify(fc);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log(`${features.length} đối tượng, ${(text.length / 1024).toFixed(0)} KB → ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
