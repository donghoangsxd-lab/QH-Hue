// Ranh phạm vi lập quy hoạch chung cho module Quy hoạch chung (generalPlanUi.js): 10 QHC, vùng lõi QHC thành phố Huế
// và 5 khu vực đô thị trong vùng lõi.
//   node --experimental-detect-module scripts/build-general-plan.js [đường-dẫn-ra] [--boundary ranh40.geojson]
// Danh sách lấy từ public/js/generalPlan.js (ES module; Node 20 cần cờ trên để nạp). Mọi phạm vi ghép trọn phường, xã.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadBoundary } = require('./wardBoundary');
const { union, wardPicker, areaFeature } = require('./urbanGeo');

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--boundary');
  const boundaryFile = bi >= 0 ? args.splice(bi, 2)[1] : null;
  const dest = args[0] || path.join(__dirname, '..', 'public', 'data', 'generalPlan.geojson');

  const { GENERAL_PLANS, CORE_AREAS, CORE_ZONE_ID } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'generalPlan.js')).href);
  const wards = await loadBoundary(boundaryFile);
  const { pick, size } = wardPicker(wards);
  console.log(`${size} phường xã`);

  const all = wards.features.map(f => ({ type: 'Feature', properties: {}, geometry: f.geometry }));
  const city = GENERAL_PLANS.find(p => p.city);
  const scopes = [
    ...GENERAL_PLANS.map(p => ({ id: p.id, feats: p.city ? all : pick(p.units) })),
    { id: CORE_ZONE_ID, feats: pick(city.zones[0].units) },
    ...CORE_AREAS.map(a => ({ id: a.id, feats: pick(a.units) }))
  ];
  const features = scopes.map(s => {
    const out = areaFeature(s.id, union(s.feats));
    console.log(`${s.id}: ${out.properties.km2} km²`);
    return out;
  });

  const fc = { type: 'FeatureCollection', source: 'Ghép từ ranh 40 phường xã webapp', features };
  const text = JSON.stringify(fc);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log(`${features.length} đối tượng, ${(text.length / 1024).toFixed(0)} KB → ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
