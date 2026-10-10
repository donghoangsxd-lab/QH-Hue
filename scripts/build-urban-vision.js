// Ranh khu vực đô thị sau năm 2030 theo Quyết định 756/QĐ-UBND ngày 28/02/2026 cho lớp urbanAreaLayer.js (bản đồ quy hoạch).
//   node --experimental-detect-module scripts/build-urban-vision.js [đường-dẫn-ra] [--boundary ranh40.geojson]
// Danh sách đô thị lấy từ public/js/urbanVision.js (ES module; Node 20 cần cờ trên để nạp). Mọi đô thị ghép trọn phường, xã.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadBoundary } = require('./wardBoundary');
const { union, wardPicker, areaFeature } = require('./urbanGeo');

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--boundary');
  const boundaryFile = bi >= 0 ? args.splice(bi, 2)[1] : null;
  const dest = args[0] || path.join(__dirname, '..', 'public', 'data', 'urbanVision.geojson');

  const { URBANS_VISION, VISION_REF, VISION_STAGE } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'urbanVision.js')).href);
  const wards = await loadBoundary(boundaryFile);
  const { pick, size } = wardPicker(wards);
  console.log(`${size} phường xã`);

  const features = URBANS_VISION.map(u => {
    const units = u.city ? wards.features.map(f => ({ type: 'Feature', properties: {}, geometry: f.geometry })) : pick(u.units);
    const out = areaFeature(u.id, union(units), u.core ? union(pick(u.core)) : null);
    console.log(`${u.id} (${u.cls}): ${out.properties.km2} km²`);
    return out;
  });

  const fc = {
    type: 'FeatureCollection',
    ref: `${VISION_REF} — ${VISION_STAGE}`,
    source: 'Ghép từ ranh 40 phường xã webapp',
    features
  };
  const text = JSON.stringify(fc);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log(`${features.length} đối tượng, ${(text.length / 1024).toFixed(0)} KB → ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
