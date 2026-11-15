/**
 * Chẩn đoán tán cây 3D qua đúng buildModel (không Overpass song song).
 * Usage: node scripts/diag-3d-trees.mjs [fixture.json] [lat] [lng] [r]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildModel,
  treeStats,
  treeCap,
  roadWidthMeters,
  STREET_TREE_MIN_W,
  pathLengthMeters
} from '../public/js/phanTich3d.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(process.argv[2] || path.join(here, 'fixtures/osm-3d-thuanhoa.json'));
const lat = Number(process.argv[3]) || 16.4705;
const lng = Number(process.argv[4]) || 107.579;
const r = Number(process.argv[5]) || 500;
const mLat = 110540;
const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
const origin = { lat, lng, mLat, mLng };

if (!fs.existsSync(fixturePath)) {
  console.error('Thiếu fixture:', fixturePath);
  console.error('Chạy: node scripts/fetch-osm-3d-fixture.mjs');
  process.exit(2);
}

const osm = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const els = osm.elements || [];
const byHw = new Map();
const widthOverride = [];
for (const el of els) {
  const tags = el.tags || {};
  if (!tags.highway) continue;
  byHw.set(tags.highway, (byHw.get(tags.highway) || 0) + 1);
  const rawW = tags.width != null ? tags.width : tags['width:carriageway'];
  if (rawW != null) {
    const w = roadWidthMeters(tags, null);
    widthOverride.push({
      highway: tags.highway,
      tag: String(rawW),
      computed: w,
      belowMin: w < STREET_TREE_MIN_W
    });
  }
}

const model = buildModel(
  { gba: [], osm, cadastre: [], localInfra: [], osmError: '', gbaError: '', cadError: 'bỏ qua' },
  origin,
  r,
  null,
  null
);

const stats = treeStats(model.trees || []);
const roads = model.roads || [];
const wide = roads.filter((road) => (road.width || 0) >= STREET_TREE_MIN_W);
const plantedLen = wide.reduce((s, road) => s + pathLengthMeters(road.path), 0);
const gapsTree = (model.gaps || []).filter((g) => /đường|cây phố|cây xanh/i.test(g));

const cause =
  model.osmError || !(osm.elements || []).length ? 'OSM'
    : roads.length === 0 ? 'OSM_NO_ROADS'
      : wide.length === 0 ? 'WIDTH_FILTER'
        : stats.street > 0 ? 'HAS_STREET_TREES'
          : stats.total > 0 ? 'PARK_ONLY'
            : 'NO_TREES';

const report = {
  fixture: fixturePath,
  place: { lat, lng, r },
  STREET_TREE_MIN_W,
  osmDate: model.osmDate || '',
  remark: osm.remark || '',
  elements: els.length,
  highways: Object.fromEntries([...byHw.entries()].sort((a, b) => b[1] - a[1])),
  widthOverrideBelowMin: widthOverride.filter((x) => x.belowMin).slice(0, 12),
  widthOverrideCount: widthOverride.length,
  roads: roads.length,
  wideRoads: model.wideRoads,
  treeCap: treeCap(r),
  trees: stats.total,
  streetTrees: model.streetTrees,
  parkTrees: model.parkTrees,
  plantedWideRoadM: Math.round(plantedLen),
  gapsTree,
  cause,
  topWide: wide
    .map((road) => ({
      name: road.name || '',
      rank: road.rank,
      width: road.width,
      len: Math.round(pathLengthMeters(road.path))
    }))
    .sort((a, b) => b.width - a.width || b.len - a.len)
    .slice(0, 10)
};

console.log(JSON.stringify(report, null, 2));

if (cause === 'OSM' || cause === 'OSM_NO_ROADS') {
  console.error('LOCK: OSM — không có đường vào buildModel');
  process.exit(1);
}
if (cause === 'WIDTH_FILTER') {
  console.error('LOCK: WIDTH_FILTER — có đường nhưng wideRoads=0 (tag width / loại hẹp)');
  process.exit(1);
}
if (cause === 'PARK_ONLY' || cause === 'NO_TREES') {
  console.error(`LOCK: ${cause} — streetTrees=0`);
  process.exit(1);
}
console.log('LOCK: HAS_STREET_TREES — dữ liệu có cây phố; nếu UI không thấy → budget phân bố hoặc draw');
