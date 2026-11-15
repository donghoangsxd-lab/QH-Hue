/**
 * Một lần lấy OSM (Overpass) → scripts/fixtures/osm-3d-thuanhoa.json
 * Usage: node scripts/fetch-osm-3d-fixture.mjs [lat] [lng] [r]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const lat = Number(process.argv[2]) || 16.4705;
const lng = Number(process.argv[3]) || 107.579;
const r = Number(process.argv[4]) || 500;
const mLat = 110540;
const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
const d = r + 40;
const south = lat - d / mLat;
const north = lat + d / mLat;
const west = lng - d / mLng;
const east = lng + d / mLng;
const sD = 2000;
const sS = lat - sD / mLat;
const sN = lat + sD / mLat;
const sW = lng - sD / mLng;
const sE = lng + sD / mLng;
const c = `${south},${west},${north},${east}`;
const s = `${sS},${sW},${sN},${sE}`;
const q = `[out:json][timeout:25];(
way["leisure"~"^(park|garden|nature_reserve|pitch)$"](${c});
way["landuse"~"^(grass|meadow|recreation_ground|village_green|forest|orchard|reservoir|basin)$"](${c});
way["natural"~"^(wood|water|wetland|grassland|scrub)$"](${c});
way["natural"="tree_row"](${c});
relation["type"="multipolygon"]["leisure"~"^(park|garden|nature_reserve)$"](${c});
way["place"="square"](${c});
way["highway"="pedestrian"]["area"="yes"](${c});
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|steps)$"](${c});
way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${c});
way["waterway"~"^(river|stream|canal|drain)$"](${c});
node["highway"="bus_stop"](${s});
);out geom;`;

const urls = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'osm-3d-thuanhoa.json');

let last = null;
for (const url of urls) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
      signal: AbortSignal.timeout(55000)
    });
    console.log(url, res.status);
    if (!res.ok) continue;
    const data = await res.json();
    const els = data.elements || [];
    const hw = els.filter((e) => e.tags && e.tags.highway).length;
    console.log({
      elements: els.length,
      highway: hw,
      remark: data.remark || '',
      date: data.osm3s && data.osm3s.timestamp_osm_base
    });
    fs.writeFileSync(outFile, JSON.stringify(data));
    console.log('wrote', outFile, `${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
    process.exit(0);
  } catch (e) {
    last = e;
    console.warn('fail', url, e.message);
  }
}
console.error(last || 'overpass fail');
process.exit(1);
