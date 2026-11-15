/**
 * Chẩn đoán tán cây 3D trên OSM thật (Overpass) — in highway/width và phân bố tán.
 * Usage: node scripts/diag-3d-trees.mjs [lat] [lng] [r]
 */
import {
  scatterTrees, treeCap, roadWidthMeters, STREET_TREE_MIN_W, circleRing, clipRing, ringArea
} from '../public/js/phanTich3d.js';

// Phường Thuận Hóa — gần cầu / sông (khớp ảnh lỗi gần đây).
const lat = Number(process.argv[2]) || 16.4705;
const lng = Number(process.argv[3]) || 107.579;
const r = Number(process.argv[4]) || 800;
const mLat = 110540;
const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
const origin = { lat, lng, mLat, mLng };
const toLocal = (lon, la) => [(lon - lng) * mLng, (la - lat) * mLat];

const ROAD_RANK = {
  motorway: 'truc', motorway_link: 'truc', trunk: 'truc', trunk_link: 'truc',
  primary: 'truc', primary_link: 'truc',
  secondary: 'khuvuc', secondary_link: 'khuvuc',
  tertiary: 'tertiary', tertiary_link: 'tertiary',
  unclassified: 'noibo', residential: 'noibo', living_street: 'noibo', service: 'noibo',
  cycleway: 'xedap', pedestrian: 'dibo', footway: 'dibo', path: 'dibo', steps: 'dibo'
};

const q = `
[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"](around:${r},${lat},${lng});
  way["leisure"~"^(park|garden)$"](around:${r},${lat},${lng});
  way["landuse"~"^(grass|forest)$"](around:${r},${lat},${lng});
  relation["type"="multipolygon"]["leisure"~"^(park|garden)$"](around:${r},${lat},${lng});
);
out geom;
`;

const endpoints = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

async function fetchOsm() {
  let last = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(55000)
      });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.json();
    } catch (e) {
      last = e;
      console.warn('overpass fail', url, e.message);
    }
  }
  throw last || new Error('overpass');
}

function ringFromGeom(geom) {
  if (!Array.isArray(geom) || geom.length < 3) return null;
  return geom.map((p) => toLocal(p.lon, p.lat));
}

const data = await fetchOsm();
const els = data.elements || [];
const byHw = new Map();
const roads = [];
const greenRings = [];
const clip = circleRing(r, 64);

for (const el of els) {
  const tags = el.tags || {};
  if (el.type === 'way' && tags.highway && Array.isArray(el.geometry)) {
    const hw = tags.highway;
    const rank = ROAD_RANK[hw] || null;
    const w = roadWidthMeters(tags, rank);
    byHw.set(hw, (byHw.get(hw) || 0) + 1);
    if (!rank) continue;
    const local = ringFromGeom(el.geometry);
    if (!local || local.length < 2) continue;
    // clip đơn giản: giữ đoạn có điểm trong vòng
    const inside = local.filter((p) => p[0] * p[0] + p[1] * p[1] <= r * r);
    if (inside.length < 2) continue;
    roads.push({ path: local, width: w, rank, highway: hw, name: tags.name || '' });
  }
  const leisure = tags.leisure || '';
  const lu = tags.landuse || '';
  const isGreen = ['park', 'garden'].includes(leisure) || ['grass', 'forest'].includes(lu);
  if (isGreen) {
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const local = ringFromGeom(el.geometry);
      if (local) {
        const cut = clipRing(local, clip);
        if (cut && ringArea(cut) > 20) greenRings.push(cut);
      }
    }
    if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const m of el.members) {
        if ((m.role === 'outer' || !m.role) && Array.isArray(m.geometry)) {
          const local = ringFromGeom(m.geometry);
          if (!local) continue;
          const cut = clipRing(local, clip);
          if (cut && ringArea(cut) > 20) greenRings.push(cut);
        }
      }
    }
  }
}

const wide = roads.filter((x) => x.width >= STREET_TREE_MIN_W);
const narrow = roads.filter((x) => x.width < STREET_TREE_MIN_W);
const cap = treeCap(r);
const trees = scatterTrees(greenRings, r, cap, roads);

// Phân loại tán: gần đường rộng vs trong green ring
function nearWideRoad(t) {
  const [x, y] = t.position;
  for (const road of wide) {
    const path = road.path;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      let u = ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
      u = Math.max(0, Math.min(1, u));
      const px = a[0] + dx * u;
      const py = a[1] + dy * u;
      const dist = Math.hypot(x - px, y - py);
      const curb = Math.max(4, (road.width || 4) * 0.55 + 4);
      if (dist <= curb + 6) return true;
    }
  }
  return false;
}

const streetTrees = trees.filter(nearWideRoad);
const otherTrees = trees.length - streetTrees.length;

console.log(JSON.stringify({
  place: { lat, lng, r },
  STREET_TREE_MIN_W,
  elements: els.length,
  highways: Object.fromEntries([...byHw.entries()].sort((a, b) => b[1] - a[1])),
  roads: roads.length,
  wideRoads: wide.length,
  narrowRoads: narrow.length,
  widthSamples: {
    residential: roadWidthMeters({ highway: 'residential' }),
    primary: roadWidthMeters({ highway: 'primary' }),
    service: roadWidthMeters({ highway: 'service' })
  },
  wideByHw: wide.reduce((m, x) => { m[x.highway] = (m[x.highway] || 0) + 1; return m; }, {}),
  greenRings: greenRings.length,
  treeCap: cap,
  trees: trees.length,
  streetTrees: streetTrees.length,
  parkishTrees: otherTrees,
  namedWide: wide.filter((x) => x.name).slice(0, 8).map((x) => ({ name: x.name, w: x.width, hw: x.highway }))
}, null, 2));

if (streetTrees.length < 20) {
  console.error('FAIL: quá ít tán ven đường trên OSM thật (<20)');
  process.exit(1);
}
console.log('OK: có đủ tán ven đường trên dữ liệu OSM thật');
