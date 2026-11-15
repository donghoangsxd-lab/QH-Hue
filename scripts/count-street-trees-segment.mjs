/**
 * Đếm cây phố trên đoạn đường OSM thật (trước khi chụp 3D).
 * Usage: node scripts/count-street-trees-segment.mjs [lat] [lng] [r]
 * Mặc định: đoạn Lê Lợi / trung tâm Huế, r=200 m (ngắn, dễ đối chiếu sat).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildModel,
  treeStats,
  treeCap,
  pathLengthMeters,
  isPlantableStreet,
  STREET_TREE_PLANT_W
} from '../public/js/phanTich3d.js';

const lat = Number(process.argv[2]) || 16.4637;
const lng = Number(process.argv[3]) || 107.5905;
const r = Number(process.argv[4]) || 200;
const mLat = 110540;
const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
const origin = { lat, lng, mLat, mLng };
const d = r + 40;
const c = [
  lat - d / mLat,
  lng - d / mLng,
  lat + d / mLat,
  lng + d / mLng
].join(',');

// Chỉ highway — query ngắn để Overpass kịp trả (đếm trước render).
const q = `[out:json][timeout:25];(
way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street)$"](${c});
way["leisure"~"^(park|garden)$"](${c});
);out geom;`;

const urls = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

async function fetchOsm() {
  let last = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'QH-Hue-planning-map/1.0'
        },
        body: `data=${encodeURICommand(q)}`,
        signal: AbortSignal.timeout(30000)
      });
      console.log('overpass', url, res.status);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.remark) {
        console.warn('remark', data.remark);
        last = new Error(data.remark);
        continue;
      }
      if (!Array.isArray(data.elements) || !data.elements.length) {
        last = new Error('elements rỗng');
        continue;
      }
      return data;
    } catch (e) {
      last = e;
      console.warn('fail', url, e.message);
    }
  }
  throw last || new Error('overpass');
}

function encodeURICommand(s) {
  return encodeURIComponent(s);
}

const osm = await fetchOsm();
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'fixtures');
fs.mkdirSync(outDir, { recursive: true });
const fixtureFile = path.join(outDir, 'osm-segment-leloi.json');
fs.writeFileSync(fixtureFile, JSON.stringify(osm));

const model = buildModel(
  { gba: [], osm, cadastre: [], localInfra: [], osmError: '', gbaError: '', cadError: 'bỏ qua' },
  origin,
  r,
  null,
  null
);

const plantable = (model.roads || []).filter(isPlantableStreet);
const stats = treeStats(model.trees || []);
const top = plantable
  .map((road) => ({
    name: road.name || '(không tên)',
    rank: road.rank,
    width: road.width,
    lenM: Math.round(pathLengthMeters(road.path)),
    // Cây gần path (ước lượng lề)
    treesNear: (model.trees || []).filter((t) => {
      if (t.source !== 'street') return false;
      const path = road.path;
      let best = Infinity;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy || 1;
        let u = ((t.position[0] - a[0]) * dx + (t.position[1] - a[1]) * dy) / len2;
        u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(t.position[0] - (a[0] + dx * u), t.position[1] - (a[1] + dy * u)));
      }
      return best <= Math.max(8, (road.width || 8) * 0.55 + 4);
    }).length
  }))
  .sort((a, b) => b.treesNear - a.treesNear || b.lenM - a.lenM)
  .slice(0, 12);

const report = {
  place: { lat, lng, r },
  PLANT_W: STREET_TREE_PLANT_W,
  treeCap: treeCap(r),
  osmElements: (osm.elements || []).length,
  highways: (osm.elements || []).filter((e) => e.tags && e.tags.highway).length,
  roads: (model.roads || []).length,
  plantableRoads: plantable.length,
  streetTrees: stats.street,
  parkTrees: stats.park,
  topRoads: top,
  fixtureFile,
  viewUrl: `phan-tich-3d.html?lat=${lat}&lng=${lng}&r=${r}&view=gop`,
  ok: stats.street >= 8 && plantable.length >= 1
};

const assets = 'C:/Users/User/.cursor/projects/c-Users-User-Desktop-DA-HTKT-Hue-T9-CloneGit-Cursor-QH-Hue/assets';
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'street-trees-segment-count.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error('FAIL: đoạn này không đủ cây phố để chứng minh');
  process.exit(1);
}
console.log('OK: đủ số liệu — mở 3D tại', report.viewUrl);
