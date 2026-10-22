// Bốn lớp trong vòng tròn bán kính r. Camera phối cảnh fovy 36°: cạnh xa ngắn hơn cạnh gần.
// Chiều cao đùn bằng mét từ data/gba/bldg-hf.bin (làm tròn 0,5 m). Số tầng = round(h / 4).
// Tháp bị GBA lọc hoặc ước thấp nằm ở bldg-overrides.geojson (draw).
// parts: khối đế và tháp, min_height / height là mét thật, số tầng là số công bố, không trần.
// Màu khối tích theo số tầng (làm tròn mét / 4): 1-2, 3-5, 6-10, 11-50. Trên 50 tầng vẫn nhóm trên.
// Dân phường không nhân theo diện tích ô.

import { withAssetVersion } from './gbaVersion.js';
import { geeApi } from './api.js';
import { floorsAt, floorsOnRing, metresForFloors, parseFloorPack } from './bldgFloorEdits.js';
import { partFloorLabel } from './bldgParts.js';
import { parseAdditionPack, toExplicitVolumes } from './bldgAdditions.js';
import { bindDeckNotchZoom } from './wheelZoom.js';

const GBA_URL = 'https://storage.googleapis.com/hue-infra-data-us/gba/buildings.pmtiles';
const CAD_URL = 'https://storage.googleapis.com/hue-infra-data-us/cadastre/thuadat-2016.pmtiles';
const LIBS = {
  pmtiles: 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm',
  vectorTile: 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.5/+esm',
  pbf: 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm'
};
const OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const CLASS_NAME = ['1-2 tầng', '3-5 tầng', '6-10 tầng', '11-50 tầng'];
const VOLUME_FILL = [[255, 237, 213, 235], [253, 186, 116, 240], [234, 88, 12, 242], [154, 52, 18, 248]];
const USE_FILL = {
  'Đất ở': [214, 150, 230, 240],
  'Cơ quan, công cộng': [126, 160, 236, 240],
  'Sản xuất, kinh doanh': [240, 148, 64, 240],
  'Nông nghiệp': [240, 206, 64, 235],
  'Rừng': [120, 190, 110, 235],
  'Mặt nước, thủy sản': [130, 198, 232, 235],
  'Giao thông, thủy lợi': [100, 150, 220, 235],
  'Chưa sử dụng, khác': [196, 196, 202, 220],
  'Chưa có mã': [206, 206, 210, 210]
};
const PLATE = 3;
const LIFT = { links: 0, uses: 1100, voids: 2200, volumes: 3300 };
const FOV_Y = 36;
const WHITE_BLOCK = [248, 250, 252, 232];
const FACILITY = {
  school: { label: 'Trường học', color: [217, 119, 6, 248], glow: [245, 158, 11], walk: 500, rank: 1 },
  health: { label: 'Y tế', color: [220, 38, 38, 248], glow: [248, 113, 113], walk: 700, rank: 2 },
  market: { label: 'Chợ', color: [202, 138, 4, 248], glow: [250, 204, 21], walk: 500, rank: 3 },
  culture: { label: 'Văn hóa', color: [126, 34, 206, 248], glow: [192, 132, 252], walk: 600, rank: 4 },
  parking: { label: 'Bãi đỗ', color: [29, 78, 216, 248], glow: [96, 165, 250], walk: 350, rank: 5 },
  bus: { label: 'Xe buýt', color: [3, 105, 161, 248], glow: [56, 189, 248], walk: 400, rank: 6 }
};
const AMENITY_RE = 'school|kindergarten|college|university|hospital|clinic|doctors|pharmacy|marketplace|supermarket|library|community_centre|theatre|arts_centre|cinema|parking';
const PLATE_FILL = {
  links: [214, 222, 230, 255],
  uses: [244, 244, 246, 255],
  voids: [236, 242, 236, 255],
  volumes: [248, 240, 238, 255]
};
const SOFT = { ambient: 0.52, diffuse: 0.74, shininess: 12, specularColor: [255, 250, 248] };
const SEARCH_M = 2000;
const HEIGHT_LIM = 160;

const GROUPS = [
  { label: 'Đất ở', codes: ['ODT', 'ONT'] },
  { label: 'Nông nghiệp', codes: ['LUC', 'LUK', 'LUN', 'LUA', 'BHK', 'NHK', 'HNK', 'CLN', 'NKH'] },
  { label: 'Rừng', codes: ['RSX', 'RPH', 'RDD'] },
  { label: 'Mặt nước, thủy sản', codes: ['NTS', 'LMU', 'SON', 'MNC'] },
  { label: 'Cơ quan, công cộng', codes: ['TSC', 'DTS', 'DVH', 'DYT', 'DGD', 'DTT', 'DKH', 'DXH', 'DNG', 'DSK', 'DSH', 'DKV', 'DCH', 'DCK', 'DBV', 'DNL', 'DRA', 'DDT', 'DDL', 'TON', 'TIN', 'NTD', 'CQP', 'CAN'] },
  { label: 'Sản xuất, kinh doanh', codes: ['SKK', 'SKN', 'SKT', 'TMD', 'SKC', 'SKS', 'SKX'] },
  { label: 'Giao thông, thủy lợi', codes: ['DGT', 'DTL'] },
  { label: 'Chưa sử dụng, khác', codes: [] }
];
const GROUP_OF = new Map(GROUPS.flatMap((g) => g.codes.map((c) => [c, g.label])));
const ROAD_RANK = {
  motorway: 'truc', motorway_link: 'truc', trunk: 'truc', trunk_link: 'truc', primary: 'truc', primary_link: 'truc',
  secondary: 'khuvuc', secondary_link: 'khuvuc',
  tertiary: 'tertiary', tertiary_link: 'tertiary',
  unclassified: 'noibo', residential: 'noibo', living_street: 'noibo', service: 'noibo',
  cycleway: 'xedap', pedestrian: 'dibo', footway: 'dibo', path: 'dibo', steps: 'dibo'
};
const ROAD_COLOR = {
  truc: [214, 48, 48, 255],
  khuvuc: [224, 176, 40, 255],
  tertiary: [58, 118, 210, 255],
  noibo: [176, 182, 190, 230],
  xedap: [96, 168, 118, 220],
  dibo: [196, 186, 170, 180],
  rail: [120, 86, 150, 230],
  water: [96, 176, 214, 220]
};
const ROAD_WIDTH = { truc: 16, khuvuc: 11, tertiary: 8, noibo: 4.2, xedap: 2.4, dibo: 2, rail: 5, water: 4 };
const ARROW_RANK = new Set(['truc', 'khuvuc', 'tertiary']);

const $ = (id) => document.getElementById(id);

export function clampRadius(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 500;
  return Math.min(800, Math.max(150, n));
}

export function parseCenter(search) {
  const q = new URLSearchParams(search || '');
  let lat = Number(q.get('lat'));
  let lng = Number(q.get('lng'));
  if (!Number.isFinite(lat) || lat < 15.5 || lat > 17.2) lat = 16.4637;
  if (!Number.isFinite(lng) || lng < 106.8 || lng > 108.4) lng = 107.5952;
  return { lat, lng, r: clampRadius(q.get('r')), view: q.get('view') === 'gop' ? 'gop' : 'tach' };
}

export function floorsFromHeight(h) {
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.max(1, Math.round(h / 4));
}

export function floorBin(floors) {
  if (floors == null || floors <= 2) return 0;
  if (floors <= 5) return 1;
  if (floors <= 10) return 2;
  return 3;
}

export function circleRing(r, n = 64) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return ring;
}

export function squareRing(r) {
  return [[-r, -r], [r, -r], [r, r], [-r, r]];
}

function plateRing(r) {
  return circleRing(r, 96);
}

function leftOf(p, a, b) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-8;
}

function segHit(s, e, a, b) {
  const sx = e[0] - s[0];
  const sy = e[1] - s[1];
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const den = sx * ay - sy * ax;
  if (Math.abs(den) < 1e-12) return [e[0], e[1]];
  const t = ((a[0] - s[0]) * ay - (a[1] - s[1]) * ax) / den;
  return [s[0] + sx * t, s[1] + sy * t];
}

export function clipRing(subject, clip) {
  const src = subject.filter((p, i) => i === 0 || p[0] !== subject[i - 1][0] || p[1] !== subject[i - 1][1]);
  if (src.length > 1) {
    const a = src[0];
    const b = src[src.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) src.pop();
  }
  if (src.length < 3) return null;
  let output = src;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length < 3) return null;
    for (let j = 0; j < input.length; j++) {
      const s = input[j];
      const e = input[(j + 1) % input.length];
      const ein = leftOf(e, a, b);
      const sin = leftOf(s, a, b);
      if (ein) {
        if (!sin) output.push(segHit(s, e, a, b));
        output.push(e);
      } else if (sin) output.push(segHit(s, e, a, b));
    }
  }
  return output.length >= 3 ? output : null;
}

export function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function shannon(areas) {
  const vals = [...areas.values()].filter((v) => v > 1);
  const total = vals.reduce((sum, v) => sum + v, 0);
  if (vals.length < 2 || total <= 0) return null;
  let h = 0;
  for (const v of vals) {
    const p = v / total;
    h -= p * Math.log(p);
  }
  return h;
}

export function clipSegment(a, b, r) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (a[0] * dx + a[1] * dy);
  const C = a[0] * a[0] + a[1] * a[1] - r * r;
  if (A < 1e-12) return C <= 0 ? [[a, b]] : [];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  const tA = (-B - s) / (2 * A);
  const tB = (-B + s) / (2 * A);
  const lo = Math.max(0, Math.min(tA, tB));
  const hi = Math.min(1, Math.max(tA, tB));
  if (hi - lo < 1e-6) return [];
  const p = (t) => [a[0] + dx * t, a[1] + dy * t];
  return [[p(lo), p(hi)]];
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / ((b[1] - a[1]) || 1e-12) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function landCode(l) {
  return (String(l || '').toUpperCase().match(/[A-Z]{3}/) || [''])[0];
}

function groupLabel(code) {
  if (!code) return 'Chưa có mã';
  return GROUP_OF.get(code) || GROUPS[GROUPS.length - 1].label;
}

export function tilesFor(lat, lng, radius, z = 16) {
  const dlat = radius / 110540;
  const dlng = radius / (111320 * Math.cos(lat * Math.PI / 180));
  const n = 2 ** z;
  const xy = (lon, la) => {
    const x = Math.floor(((lon + 180) / 360) * n);
    const s = Math.sin((la * Math.PI) / 180);
    const y = Math.floor((1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI)) * n / 2);
    return [x, y];
  };
  const [x0, ySouth] = xy(lng - dlng, lat - dlat);
  const [x1, yNorth] = xy(lng + dlng, lat + dlat);
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = yNorth; y <= ySouth; y++) out.push([z, x, y]);
  }
  return out;
}

function tileToLngLat(px, py, extent, tx, ty, z) {
  const n = 2 ** z;
  const lng = ((tx + px / extent) / n) * 360 - 180;
  const y = (ty + py / extent) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

function directTiles() {
  const host = location.hostname;
  const port = location.port;
  if (host === 'web-hatang-hue-4.vercel.app') return true;
  return (host === 'localhost' || host === '127.0.0.1') && (port === '5500' || port === '5501' || port === '8080' || port === '8000');
}

function osmDated(data) {
  return data && Array.isArray(data.elements) && /^\d{4}-\d{2}-\d{2}/.test(String((data.osm3s || {}).timestamp_osm_base || ''));
}

function byteSource(url) {
  let whole = null;
  let decided = null;
  return {
    getKey() { return url; },
    getBytes(offset, length) {
      if (whole) return Promise.resolve({ data: whole.slice(offset, offset + length) });
      if (!decided) {
        decided = fetch(url, { headers: { Range: 'bytes=0-16383' } }).then(async (res) => {
          if (!res.ok && res.status !== 206) throw new Error(`PMTiles HTTP ${res.status}`);
          const declared = Number(res.headers.get('Content-Length') || 0);
          if (res.status === 206 || (declared > 0 && declared <= 16384)) return 'range';
          whole = await res.arrayBuffer();
          return 'buffer';
        }).catch((err) => { decided = null; throw err; });
      }
      return decided.then(async (kind) => {
        if (kind === 'buffer') return { data: whole.slice(offset, offset + length) };
        const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (!res.ok && res.status !== 206) throw new Error(`PMTiles HTTP ${res.status}`);
        return { data: await res.arrayBuffer() };
      });
    }
  };
}

const readyCache = new Map();
function ready(kind) {
  if (!readyCache.has(kind)) {
    const gcs = kind === 'gba' ? withAssetVersion(GBA_URL) : CAD_URL;
    const url = directTiles() ? gcs : `/api/pmtilesRange?file=${kind}`;
    readyCache.set(kind, Promise.all([
      import(LIBS.pmtiles), import(LIBS.vectorTile), import(LIBS.pbf)
    ]).then(([pm, vt, pbf]) => ({
      archive: new pm.PMTiles(byteSource(url)),
      VectorTile: vt.VectorTile,
      Pbf: pbf.default
    })));
  }
  return readyCache.get(kind);
}

async function readLayer(kind, layerName, tiles) {
  const { archive, VectorTile, Pbf } = await ready(kind);
  const feats = [];
  for (const [z, x, y] of tiles) {
    const res = await archive.getZxy(z, x, y);
    if (!res || !res.data) continue;
    const layer = new VectorTile(new Pbf(new Uint8Array(res.data))).layers[layerName];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      feats.push({
        rings: f.loadGeometry().map((ring) => ring.map((pt) => tileToLngLat(pt.x, pt.y, layer.extent, x, y, z))),
        props: f.properties || {}
      });
    }
  }
  return feats;
}

function toLocal(lng, lat, origin) {
  return [(lng - origin.lng) * origin.mLng, (lat - origin.lat) * origin.mLat];
}

function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function wind(rings) {
  const out = rings.map((ring) => ring.slice());
  if (signedArea(out[0]) > 0) out[0].reverse();
  for (let i = 1; i < out.length; i++) if (signedArea(out[i]) < 0) out[i].reverse();
  return out;
}

function bboxMissSquare(ring, r) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of ring) {
    if (p[0] < minx) minx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] > maxy) maxy = p[1];
  }
  return maxx < -r || minx > r || maxy < -r || miny > r;
}

function fullyInsideSquare(ring, r) {
  for (const p of ring) if (Math.abs(p[0]) > r + 0.05 || Math.abs(p[1]) > r + 0.05) return false;
  return true;
}

function bboxMissDisc(ring, r) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of ring) {
    if (p[0] < minx) minx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] > maxy) maxy = p[1];
  }
  const cx = Math.max(minx, Math.min(0, maxx));
  const cy = Math.max(miny, Math.min(0, maxy));
  return cx * cx + cy * cy > r * r;
}

function fullyInsideDisc(ring, r) {
  const lim = (r + 0.05) * (r + 0.05);
  for (const p of ring) if (p[0] * p[0] + p[1] * p[1] > lim) return false;
  return true;
}

function clipFeature(feat, origin, clip, r) {
  const rings = feat.rings.map((ring) => ring.map(([lng, lat]) => toLocal(lng, lat, origin)));
  if (!rings.length || bboxMissDisc(rings[0], r)) return [];
  const parts = [];
  let current = null;
  const signOf = (ring) => Math.sign(signedArea(ring)) || 1;
  rings.forEach((ring, index) => {
    const cut = fullyInsideDisc(ring, r) ? ring : clipRing(ring, clip);
    if (!cut) return;
    const sign = signOf(cut);
    if (!current || (index > 0 && sign === current.sign)) {
      if (current && current.area > 1) parts.push(current);
      current = { rings: wind([cut]), area: ringArea(cut), sign };
      return;
    }
    current.rings.push(cut);
    current.area -= ringArea(cut);
    current.rings = wind(current.rings);
  });
  if (current && current.area > 1) parts.push(current);
  return parts;
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

function arrowHead(p, dir, head) {
  const h = Math.hypot(dir[0], dir[1]) || 1;
  const dx = dir[0] / h;
  const dy = dir[1] / h;
  const px = -dy;
  const py = dx;
  const tip = [p[0] + dx * head, p[1] + dy * head];
  return [
    tip,
    [p[0] - dx * head * 0.2 + px * head * 0.55, p[1] - dy * head * 0.2 + py * head * 0.55],
    [p[0] - dx * head * 0.2 - px * head * 0.55, p[1] - dy * head * 0.2 - py * head * 0.55]
  ];
}

function clipSegSquare(a, b, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] + r, r - a[0], a[1] + r, r - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t1 - t0 < 1e-5) return null;
  return {
    a: [a[0] + dx * t0, a[1] + dy * t0],
    b: [a[0] + dx * t1, a[1] + dy * t1],
    exit: t1 < 0.999
  };
}

function clipPolylineDisc(line, r) {
  const parts = [];
  const exits = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.length > 1) parts.push(cur);
    cur = null;
  };
  const rim = r * 2.2;
  const onRim = (p) => Math.abs(p[0] * p[0] + p[1] * p[1] - r * r) < rim;
  for (let i = 1; i < line.length; i++) {
    const hits = clipSegment(line[i - 1], line[i], r);
    if (!hits.length) { flush(); continue; }
    const [a, b] = hits[0];
    if (cur && Math.hypot(cur[cur.length - 1][0] - a[0], cur[cur.length - 1][1] - a[1]) < 0.5) cur.push(b);
    else {
      flush();
      cur = [a, b];
    }
    if (Math.hypot(b[0] - line[i][0], b[1] - line[i][1]) > 0.6 && onRim(b)) {
      exits.push({ p: b, dir: [b[0] - a[0], b[1] - a[1]] });
      flush();
    }
  }
  flush();
  return { parts, exits };
}

function clipPolylineSquare(line, r) {
  const parts = [];
  const exits = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.length > 1) parts.push(cur);
    cur = null;
  };
  for (let i = 1; i < line.length; i++) {
    const hit = clipSegSquare(line[i - 1], line[i], r);
    if (!hit) { flush(); continue; }
    if (cur && Math.hypot(cur[cur.length - 1][0] - hit.a[0], cur[cur.length - 1][1] - hit.a[1]) < 0.4) cur.push(hit.b);
    else {
      flush();
      cur = [hit.a, hit.b];
    }
    if (hit.exit) {
      exits.push({ p: hit.b, dir: [hit.b[0] - hit.a[0], hit.b[1] - hit.a[1]] });
      flush();
    }
  }
  flush();
  return { parts, exits };
}

function lineLength(parts) {
  let m = 0;
  for (const line of parts) {
    for (let i = 1; i < line.length; i++) m += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return m;
}

function collectNodes(lines, r) {
  const cell = 18;
  const buckets = new Map();
  for (const line of lines) {
    for (const p of line) {
      if (p[0] * p[0] + p[1] * p[1] > (r - 12) * (r - 12)) continue;
      const k = `${Math.round(p[0] / cell)}_${Math.round(p[1] / cell)}`;
      const b = buckets.get(k) || { n: 0, x: 0, y: 0 };
      b.n += 1;
      b.x += p[0];
      b.y += p[1];
      buckets.set(k, b);
    }
  }
  const nodes = [];
  for (const b of buckets.values()) if (b.n >= 4) nodes.push([b.x / b.n, b.y / b.n]);
  return nodes.slice(0, 48);
}

function scatterTrees(rings, r, cap) {
  const out = [];
  if (!rings.length) return out;
  const step = 22;
  let salt = 1;
  for (let y = -r + 14; y <= r - 14 && out.length < cap; y += step) {
    for (let x = -r + 14; x <= r - 14 && out.length < cap; x += step) {
      salt += 1;
      const jx = x + Math.sin(salt * 12.989) * 9;
      const jy = y + Math.cos(salt * 78.233) * 9;
      if (jx * jx + jy * jy > (r - 8) * (r - 8)) continue;
      if (!rings.some((ring) => pointInRing([jx, jy], ring))) continue;
      out.push({
        x: jx,
        y: jy,
        r: 8 + (salt % 4) * 2.4,
        shade: salt % 2 ? [70, 160, 72, 255] : [48, 130, 58, 255]
      });
    }
  }
  return out;
}

function voidKind(tags) {
  const lu = tags.landuse || '';
  const leisure = tags.leisure || '';
  const natural = tags.natural || '';
  if (tags.place === 'square' || (tags.highway === 'pedestrian' && tags.area === 'yes')) return 'square';
  if (lu === 'reservoir' || lu === 'basin' || natural === 'water' || natural === 'wetland') return 'water';
  if (leisure === 'pitch') return 'pitch';
  if (['park', 'garden', 'nature_reserve'].includes(leisure)
    || ['grass', 'meadow', 'recreation_ground', 'village_green', 'forest', 'orchard'].includes(lu)
    || ['wood', 'grassland', 'scrub'].includes(natural)) return 'green';
  return null;
}

function facilityKind(tags) {
  const amenity = tags.amenity || '';
  if (['school', 'kindergarten', 'college', 'university'].includes(amenity)) return 'school';
  if (['hospital', 'clinic', 'doctors', 'pharmacy'].includes(amenity)) return 'health';
  if (amenity === 'marketplace' || amenity === 'supermarket') return 'market';
  if (['library', 'community_centre', 'theatre', 'arts_centre', 'cinema'].includes(amenity)) return 'culture';
  if (amenity === 'parking') return 'parking';
  if (tags.highway === 'bus_stop' || tags.public_transport === 'platform' || tags.public_transport === 'stop_position') return 'bus';
  return null;
}

async function loadOsm(place) {
  try {
    const res = await fetch(`/api/osmClip?lat=${place.lat}&lng=${place.lng}&r=${place.r}`, { signal: AbortSignal.timeout(25000) });
    if (res.ok) {
      const data = await res.json();
      if (osmDated(data)) return data;
    }
  } catch (err) { /* trang tĩnh không có API */ }
  const mLat = 110540;
  const mLng = 111320 * Math.cos((place.lat * Math.PI) / 180);
  const circle = {
    south: place.lat - (place.r + 40) / mLat,
    west: place.lng - (place.r + 40) / mLng,
    north: place.lat + (place.r + 40) / mLat,
    east: place.lng + (place.r + 40) / mLng
  };
  const search = {
    south: place.lat - SEARCH_M / mLat,
    west: place.lng - SEARCH_M / mLng,
    north: place.lat + SEARCH_M / mLat,
    east: place.lng + SEARCH_M / mLng
  };
  const c = `${circle.south},${circle.west},${circle.north},${circle.east}`;
  const s = `${search.south},${search.west},${search.north},${search.east}`;
  const query = `[out:json][timeout:25];(
way["leisure"~"^(park|garden|nature_reserve|pitch)$"](${c});
way["landuse"~"^(grass|meadow|recreation_ground|village_green|forest|orchard|reservoir|basin)$"](${c});
way["natural"~"^(wood|water|wetland|grassland|scrub)$"](${c});
way["place"="square"](${c});
way["highway"="pedestrian"]["area"="yes"](${c});
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|steps)$"](${c});
way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${c});
way["waterway"~"^(river|stream|canal|drain)$"](${c});
node["amenity"~"^(${AMENITY_RE})$"](${s});
way["amenity"~"^(${AMENITY_RE})$"](${s});
node["highway"="bus_stop"](${s});
node["public_transport"~"^(platform|stop_position)$"](${s});
);out geom;`;
  let last = 'Không tải được OpenStreetMap';
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) { last = `OpenStreetMap HTTP ${res.status}`; continue; }
      const data = await res.json();
      if (!osmDated(data)) { last = 'OpenStreetMap trả dữ liệu không có ngày'; continue; }
      return data;
    } catch (err) {
      last = err.name === 'TimeoutError' ? 'OpenStreetMap quá thời gian' : 'Không kết nối được OpenStreetMap';
    }
  }
  throw new Error(last);
}

function hav(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function coverRatio(polys, r) {
  if (!polys.length) return 0;
  const step = (r * 2) / 36;
  const r2 = r * r;
  let inside = 0;
  let hit = 0;
  for (let y = -r; y <= r; y += step) {
    for (let x = -r; x <= r; x += step) {
      if (x * x + y * y > r2) continue;
      inside += 1;
      if (polys.some((ring) => pointInRing([x, y], ring))) hit += 1;
    }
  }
  return inside ? hit / inside : 0;
}

function pushHalo(list, ring, clip, rgb) {
  [28, 70, 130].forEach((extra, i) => {
    const grown = offsetRing(ring, extra);
    const cut = clipRing(grown, clip);
    if (!cut || ringArea(cut) < 30) return;
    const alpha = [150, 88, 40][i];
    list.push({ rings: wind([cut]), h: 0.8, fill: [rgb[0], rgb[1], rgb[2], alpha] });
  });
}

function offsetRing(ring, extra) {
  const c = centroid(ring);
  return ring.map((p) => {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * extra, p[1] + (dy / len) * extra];
  });
}

function glowSteps(x, y, reach, rgb, steps) {
  const out = [];
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const fade = (1 - t) ** 1.55;
    out.push({
      position: [x, y],
      radius: Math.max(8, reach * t),
      color: [rgb[0], rgb[1], rgb[2], Math.round(36 + 150 * fade)]
    });
  }
  return out;
}

function discPosts(r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function indexParcels(parcels) {
  const cell = 40;
  const grid = new Map();
  parcels.forEach((p, i) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    p.rings[0].forEach(([x, y]) => {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    });
    const x0 = Math.floor(minx / cell);
    const x1 = Math.floor(maxx / cell);
    const y0 = Math.floor(miny / cell);
    const y1 = Math.floor(maxy / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = `${ix},${iy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return (x, y) => {
    const list = grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) || [];
    for (const i of list) if (pointInRing([x, y], parcels[i].rings[0])) return parcels[i];
    return null;
  };
}

function tileParts(lng, lat) {
  const n = 65536;
  const xf = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const yf = (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI)) * n / 2;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, cx: Math.floor((xf - x) * 4096), cy: Math.floor((yf - y) * 4096) };
}

export function parseHeightIndex(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'GBH2') throw new Error('tệp chiều cao không đúng');
  const tiles = dv.getUint32(4, true);
  const rec0 = 12 + tiles * 12;
  const index = new Map();
  let p = 12;
  for (let i = 0; i < tiles; i++) {
    const key = dv.getUint32(p, true);
    const start = dv.getUint32(p + 4, true);
    const count = dv.getUint32(p + 8, true);
    index.set(key, { start, count });
    p += 12;
  }
  function scan(tx, ty, gx, gy, best) {
    const ent = index.get(tx * 65536 + ty);
    if (!ent) return best;
    const base = rec0 + ent.start * 8;
    for (let i = 0; i < ent.count; i++) {
      const o = base + i * 8;
      const dx = tx * 4096 + dv.getUint16(o, true) - gx;
      const dy = ty * 4096 + dv.getUint16(o + 2, true) - gy;
      const d = dx * dx + dy * dy;
      if (d < best.d) best = { d, h: dv.getUint16(o + 4, true) / 2 };
    }
    return best;
  }
  return {
    lookup(lng, lat) {
      const part = tileParts(lng, lat);
      const gx = part.x * 4096 + part.cx;
      const gy = part.y * 4096 + part.cy;
      let best = scan(part.x, part.y, gx, gy, { d: HEIGHT_LIM * HEIGHT_LIM, h: null });
      if (best.d > 70 * 70) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            best = scan(part.x + dx, part.y + dy, gx, gy, best);
          }
        }
      }
      return best.h;
    }
  };
}

function buildModel(raw, origin, r, heights, floorPack) {
  const clip = circleRing(r, 48);
  const gaps = [];
  const volumes = [];
    const greens = [];
  const waters = [];
  const squares = [];
  const roads = [];
  const arrows = [];
  const majorLines = [];
  let footprint = 0;
  let matchedFp = 0;
  let gfa = 0;
  let hSum = 0;
  let heightMiss = 0;
  const classArea = [0, 0, 0, 0];
  const buildings = [];
  if (raw.gbaError) gaps.push('Không đọc được dấu chân công trình (Global Building Atlas).');
  if (raw.gba.length) {
    for (const feat of raw.gba) {
      if (feat.explicit) {
        const mid = ringCentroidLngLat(feat.rings && feat.rings[0]);
        const edited = mid ? floorsAt(floorPack, mid[0], mid[1]) : null;
        const top = edited != null ? metresForFloors(edited) : feat.height;
        const minH = edited != null ? 0 : (feat.minHeight || 0);
        const extrusion = top - minH;
        const f = edited != null ? edited : feat.floors;
        if (!(extrusion > 0) || !f) continue;
        for (const cut of clipFeature(feat, origin, clip, r)) {
          if (minH === 0) {
            footprint += cut.area;
            matchedFp += cut.area;
            classArea[floorBin(f)] += cut.area;
            gfa += cut.area * f;
            hSum += cut.area * top;
            buildings.push(cut);
          } else {
            gfa += cut.area * f;
            hSum += cut.area * extrusion;
            if (feat.groundFloors) {
              classArea[floorBin(feat.groundFloors)] -= cut.area;
              classArea[floorBin(f)] += cut.area;
            }
          }
          const partLabel = feat.added && feat.role !== 'podium' && feat.role !== 'tower'
            ? String(f)
            : partFloorLabel(feat.role, f);
          volumes.push({
            rings: cut.rings,
            h: extrusion,
            z0: minH,
            fill: VOLUME_FILL[floorBin(f)],
            partLabel
          });
        }
        continue;
      }
      if (ringInsideMask(feat.rings && feat.rings[0], raw.masks)) continue;
      const touched = floorsOnRing(floorPack, feat.rings && feat.rings[0]);
      for (const cut of clipFeature(feat, origin, clip, r)) {
        const mid = centroid(cut.rings[0]);
        const lng = origin.lng + mid[0] / origin.mLng;
        const lat = origin.lat + mid[1] / origin.mLat;
        const h0 = heights ? heights.lookup(lng, lat) : null;
        const edited = touched != null ? touched : floorsAt(floorPack, lng, lat);
        const h = edited != null ? metresForFloors(edited) : h0;
        const f = edited != null ? edited : floorsFromHeight(h0);
        footprint += cut.area;
        classArea[floorBin(f)] += cut.area;
        if (h == null) heightMiss += 1;
        else {
          matchedFp += cut.area;
          gfa += cut.area * f;
          hSum += cut.area * h;
        }
        const drawH = h == null ? 4 : h;
        buildings.push(cut);
        volumes.push({ rings: cut.rings, h: drawH, z0: 0, fill: VOLUME_FILL[floorBin(f)] });
      }
    }
    for (let i = 0; i < classArea.length; i++) if (classArea[i] < 0) classArea[i] = 0;
    if (!buildings.length) gaps.push('Không có dấu chân công trình trong vòng tròn.');
  }
  if (!heights) gaps.push('Không đọc được tệp chiều cao mét. Hình dùng tạm 4 m cho mỗi dấu chân, không tính sàn.');

  const parcels = [];
  const groupArea = new Map();
  let noCode = 0;
  if (raw.cadError) gaps.push('Không đọc được thửa đất địa chính 2016.');
  else {
    for (const feat of raw.cadastre) {
      const code = landCode(feat.props.l);
      const label = groupLabel(code);
      for (const cut of clipFeature(feat, origin, clip, r)) {
        if (!code) noCode += cut.area;
        else groupArea.set(label, (groupArea.get(label) || 0) + cut.area);
        parcels.push({ ...cut, code, label });
      }
    }
    if (!parcels.length) gaps.push('Không có thửa đất trong vòng tròn.');
  }
  const findParcel = indexParcels(parcels);
  let unassigned = 0;
  for (const b of buildings) if (!findParcel(...centroid(b.rings[0]))) unassigned += 1;

  const greenRings = [];
  const waterRings = [];
  const squareRings = [];
  const halos = [];
  const openBloom = [];
  const roadM = { truc: 0, khuvuc: 0, tertiary: 0, noibo: 0, xedap: 0, dibo: 0, rail: 0, water: 0 };
  const nearest = { school: null, health: null, market: null, bus: null, culture: null, parking: null };
  const found = [];
  let stopsInside = 0;
  if (raw.osmError) gaps.push(`${raw.osmError}. Không tính cây xanh, mặt nước, đường và khoảng cách công trình.`);
  else {
    for (const el of raw.osm.elements || []) {
      const tags = el.tags || {};
      if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 1) {
        const local = el.geometry.map((p) => toLocal(p.lon, p.lat, origin));
        const kind = voidKind(tags);
        const closed = Math.hypot(local[0][0] - local[local.length - 1][0], local[0][1] - local[local.length - 1][1]) < 1;
        if (kind && closed) {
          const cut = clipRing(local, clip);
          if (cut && ringArea(cut) > 8) {
            const wound = wind([cut]);
            const area = ringArea(cut);
            if (kind === 'water') {
              waters.push({ rings: wound, h: 2.4, fill: [14, 165, 233, 235] });
              waterRings.push(cut);
              pushHalo(halos, cut, clip, [56, 189, 248]);
              const c = centroid(cut);
              openBloom.push(...glowSteps(c[0], c[1], Math.min(260, Math.max(46, Math.sqrt(area) * 1.15)), [56, 189, 248], 10));
            } else if (kind === 'square') {
              squares.push({ rings: wound, h: 1.4, fill: [226, 232, 220, 210] });
              squareRings.push(cut);
            } else if (kind === 'pitch') {
              greens.push({ rings: wound, h: 1.6, fill: [74, 222, 128, 220] });
              greenRings.push(cut);
              pushHalo(halos, cut, clip, [34, 197, 94]);
            } else {
              greens.push({ rings: wound, h: 2.2, fill: [22, 163, 74, 235] });
              greenRings.push(cut);
              pushHalo(halos, cut, clip, [34, 197, 94]);
              const c = centroid(cut);
              openBloom.push(...glowSteps(c[0], c[1], Math.min(280, Math.max(50, Math.sqrt(area) * 1.2)), [34, 197, 94], 10));
            }
          }
        }
        let rank = null;
        if (tags.railway && tags.railway !== 'abandoned') rank = 'rail';
        else if (tags.waterway) rank = 'water';
        else if (!(tags.highway === 'pedestrian' && tags.area === 'yes')) rank = ROAD_RANK[tags.highway] || null;
        if (rank) {
          const clipped = clipPolylineDisc(local, r);
          roadM[rank] += lineLength(clipped.parts);
          const color = ROAD_COLOR[rank];
          for (const part of clipped.parts) {
            roads.push({ path: part, color, width: ROAD_WIDTH[rank] });
            if (rank === 'truc' || rank === 'khuvuc') majorLines.push(part);
          }
          if (ARROW_RANK.has(rank)) {
            for (const ex of clipped.exits) {
              const dir = ex.dir;
              const len = Math.hypot(dir[0], dir[1]) || 1;
              const ux = dir[0] / len;
              const uy = dir[1] / len;
              const base = [ex.p[0] - ux * 22, ex.p[1] - uy * 22];
              const tail = [ex.p[0] - ux * 78, ex.p[1] - uy * 78];
              arrows.push({ stem: [tail, base], head: arrowHead(base, dir, 20), color, rank });
            }
          }
        }
      }
      const fac = facilityKind(tags);
      if (!fac) continue;
      let lng = el.lon;
      let lat = el.lat;
      if ((lng == null || lat == null) && el.geometry && el.geometry.length) {
        lng = el.geometry.reduce((s, p) => s + p.lon, 0) / el.geometry.length;
        lat = el.geometry.reduce((s, p) => s + p.lat, 0) / el.geometry.length;
      }
      if (lng == null || lat == null) continue;
      const dist = hav(origin.lng, origin.lat, lng, lat);
      if (dist > SEARCH_M) continue;
      const p = toLocal(lng, lat, origin);
      const row = { id: fac, dist, name: tags.name || '', lng, lat, x: p[0], y: p[1], rings: null };
      if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 3) {
        const local = el.geometry.map((pt) => toLocal(pt.lon, pt.lat, origin));
        const closed = Math.hypot(local[0][0] - local[local.length - 1][0], local[0][1] - local[local.length - 1][1]) < 1.2;
        if (closed) {
          const cut = clipRing(local, clip);
          if (cut && ringArea(cut) > 12) row.rings = wind([cut]);
        }
      }
      if (!nearest[fac] || row.dist < nearest[fac].dist) nearest[fac] = row;
      if (row.dist <= r) found.push(row);
      if (fac === 'bus' && row.x * row.x + row.y * row.y <= r * r) stopsInside += 1;
    }
    if (!greenRings.length) gaps.push('OpenStreetMap không có vùng cây xanh hoặc công viên (way) trong vòng tròn.');
    if (!waterRings.length) gaps.push('OpenStreetMap không có mặt nước (way) trong vòng tròn.');
    if (!squareRings.length) gaps.push('OpenStreetMap không có quảng trường trong vòng tròn.');
    if (roadM.rail === 0) gaps.push('OpenStreetMap không có đường sắt trong vòng tròn.');
    if (roadM.water === 0) gaps.push('OpenStreetMap không có đường thủy trong vòng tròn.');
  }

  const seen = new Set();
  const facilities = [];
  found.sort((a, b) => a.dist - b.dist);
  for (const row of found) {
    const key = `${row.id}:${Math.round(row.x / 22)}:${Math.round(row.y / 22)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facilities.push(row);
  }
  const counts = { school: 0, health: 0, market: 0, culture: 0, parking: 0, bus: 0 };
  facilities.forEach((f) => { counts[f.id] += 1; });
  const phone = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const steps = phone ? 7 : 11;
  const access = [];
  facilities.forEach((f) => {
    const meta = FACILITY[f.id];
    if (!meta) return;
    const c = f.rings ? centroid(f.rings[0]) : [f.x, f.y];
    if (c[0] * c[0] + c[1] * c[1] > r * r) return;
    access.push(...glowSteps(c[0], c[1], meta.walk, meta.glow, steps));
  });
  const claimed = new Set();
  const blocks = volumes.map((v) => ({ ...v, fill: WHITE_BLOCK, infra: false }));
  facilities.slice().sort((a, b) => FACILITY[a.id].rank - FACILITY[b.id].rank).forEach((f) => {
    const meta = FACILITY[f.id];
    if (!meta) return;
    let matched = 0;
    if (f.rings) {
      blocks.forEach((b, i) => {
        if (claimed.has(i)) return;
        if (!pointInRing(centroid(b.rings[0]), f.rings[0])) return;
        claimed.add(i);
        b.fill = meta.color;
        b.infra = true;
        matched += 1;
      });
    }
    if (!matched) {
      const lim = f.id === 'bus' ? 18 : 32;
      let best = lim;
      let hit = -1;
      blocks.forEach((b, i) => {
        if (claimed.has(i)) return;
        const c = centroid(b.rings[0]);
        const d = Math.hypot(c[0] - f.x, c[1] - f.y);
        if (d < best) { best = d; hit = i; }
      });
      if (hit >= 0) {
        claimed.add(hit);
        blocks[hit].fill = meta.color;
        blocks[hit].infra = true;
        matched = 1;
      }
    }
    if (matched) return;
    if (f.rings) {
      blocks.push({ rings: f.rings, h: 8, z0: 0, fill: meta.color, infra: true });
      return;
    }
    if (f.x * f.x + f.y * f.y > r * r) return;
    const s = 8;
    blocks.push({
      rings: [[[f.x - s, f.y - s], [f.x + s, f.y - s], [f.x + s, f.y + s], [f.x - s, f.y + s]]],
      h: 12,
      z0: 0,
      fill: meta.color,
      infra: true
    });
  });

  const nodes = collectNodes(majorLines, r);
  const corners = discPosts(r);
  const area = Math.PI * r * r;
  const mix = shannon(groupArea);
  const driveM = roadM.truc + roadM.khuvuc + roadM.tertiary + roadM.noibo;
  const meanF = matchedFp > 0 ? gfa / matchedFp : null;
  const meanH = matchedFp > 0 ? hSum / matchedFp : null;
  for (let i = 0; i < classArea.length; i++) if (classArea[i] < 0) classArea[i] = 0;
  return {
    volumes, blocks, greens, waters, squares, halos, openBloom, access, roads, arrows, nodes, corners, gaps, nearest, stopsInside, counts,
    roadM, driveM, squareArea: area, area, footprint, buildings: buildings.length, classArea, parcels: parcels.length,
    groupArea, noCode, unassigned, mix, meanF, meanH, gfa, heightMiss, matched: buildings.length - heightMiss,
    green: coverRatio(greenRings, r),
    water: coverRatio(waterRings, r),
    square: coverRatio(squareRings, r),
    osmDate: raw.osm && raw.osm.osm3s ? raw.osm.osm3s.timestamp_osm_base : '',
    heightMeta: raw.heightMeta || null,
    massing: raw.massing || []
  };
}

const fmt1 = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
const fmt2 = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
const fmt0 = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n);

function li(label, value, note) {
  const item = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = label;
  const span = document.createElement('span');
  span.textContent = value;
  item.append(b, span);
  if (note) {
    const small = document.createElement('small');
    small.textContent = note;
    item.append(small);
  }
  return item;
}

function legendCard(num, color, label, note) {
  const item = document.createElement('li');
  item.className = 'card';
  const badge = document.createElement('i');
  badge.style.background = color;
  badge.textContent = String(num);
  const span = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = label;
  span.append(b);
  const small = document.createElement('small');
  small.textContent = note;
  span.append(small);
  item.append(badge, span);
  return item;
}

function swatch(color, label) {
  const item = document.createElement('li');
  const badge = document.createElement('i');
  badge.style.background = color;
  const span = document.createElement('span');
  span.textContent = label;
  item.append(badge, span);
  return item;
}

function paintMassing(rows) {
  const host = $('massing');
  const note = $('massingNote');
  if (!host || !note) return;
  note.textContent = 'Danh sách công bố của Huế dừng ở 13 công trình từ 50 m hoặc 15 tầng, cộng 3 công trình đang xây. Không đủ 20 công trình có số liệu. Khối đế và tháp do thuật toán dịch mái về chân theo vectơ nghiêng. Nhà còn lại trong ô lấy mét chia 4.';
  const table = document.createElement('table');
  table.className = 'massing';
  const head = document.createElement('tr');
  ['Tên', 'Đế', 'Tháp', 'm', 'Nguồn'].forEach((label) => {
    const cell = document.createElement('th');
    cell.textContent = label;
    head.append(cell);
  });
  table.append(head);
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = row.drawn ? row.name : `${row.name} (chưa vẽ)`;
    if (!row.drawn) name.className = 'off';
    if (!row.drawn && row.note) {
      const small = document.createElement('small');
      small.className = 'mass-note';
      small.textContent = row.note;
      name.append(small);
    }
    const podium = document.createElement('td');
    podium.textContent = row.podiumFloors == null ? '—' : String(row.podiumFloors);
    const tower = document.createElement('td');
    tower.textContent = row.towerFloors == null ? '—' : String(row.towerFloors);
    const height = document.createElement('td');
    height.textContent = row.height == null ? '—' : String(row.height).replace('.', ',');
    const src = document.createElement('td');
    if (row.source) {
      const a = document.createElement('a');
      a.href = row.source;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = 'nguồn';
      src.append(a);
    }
    tr.append(name, podium, tower, height, src);
    if (row.note) tr.title = row.note;
    table.append(tr);
  });
  host.replaceChildren(table);
}

function nearestText(row, r, osmError) {
  if (osmError) return 'Không có số liệu.';
  if (!row) return 'Không có trong bán kính 2 km.';
  const name = row.name ? `${row.name} · ` : '';
  const where = row.dist <= r ? 'trong vòng' : 'ngoài vòng';
  return `${name}${fmt0(row.dist)} m, ${where}`;
}

function paintPanel(model, place) {
  const legend = $('legend');
  legend.replaceChildren(
    legendCard(1, '#ea580c', 'Khối tích', 'Màu theo bốn nhóm số tầng.'),
    legendCard(2, '#16a34a', 'Không gian mở', 'Công viên loang lục, mặt nước loang lam.'),
    legendCard(3, '#0284c7', 'Tiếp cận hạ tầng', 'Công trình hạ tầng theo loại. Vầng màu nhạt theo khoảng đi bộ.'),
    legendCard(4, '#d6a820', 'Liên kết', 'Đường phân cấp và hướng ra mép vòng.')
  );
  const keys = $('keys');
  if (keys) {
    keys.replaceChildren(
      swatch('#ffedd5', '1-2 tầng'),
      swatch('#fdba74', '3-5 tầng'),
      swatch('#ea580c', '6-10 tầng'),
      swatch('#9a3412', '11-50 tầng'),
      swatch('#d97706', 'Trường'),
      swatch('#dc2626', 'Y tế'),
      swatch('#ca8a04', 'Chợ'),
      swatch('#7e22ce', 'Văn hóa'),
      swatch('#1d4ed8', 'Bãi đỗ'),
      swatch('#0369a1', 'Xe buýt')
    );
  }
  const areaHa = model.area / 10000;
  const counts = model.counts || {};
  const countLine = ['school', 'health', 'market', 'culture', 'parking', 'bus']
    .map((id) => `${FACILITY[id].label} ${fmt0(counts[id] || 0)}`).join(' · ');
  const items = [
    li('Diện tích vòng tròn', `${fmt1(areaHa)} ha`, `Bán kính ${fmt0(place.r)} m.`),
    li('Mật độ xây dựng', model.buildings ? `${fmt1(model.footprint / model.area * 100)}%` : 'Không có dấu chân.',
      model.buildings ? `${fmt0(model.buildings)} công trình.` : ''),
    li('Tầng trung bình', model.meanF == null ? 'Không có số mét.' : fmt1(model.meanF), 'Theo diện tích dấu chân. Tầng = làm tròn (mét / 4).'),
    li('Diện tích sàn', model.meanF == null ? 'Không có số mét.' : `${fmt0(model.gfa)} m²`, 'Dấu chân trong vòng nhân số tầng.'),
    li('Hạ tầng trong vòng', model.osmError ? 'Không có số liệu.' : countLine, 'Đếm tâm công trình nằm trong bán kính.'),
    li('Cây xanh, công viên', model.osmError ? 'Không có số liệu.' : `${fmt1(model.green * 100)}%`, 'Phần diện tích vòng.'),
    li('Mặt nước', model.osmError ? 'Không có số liệu.' : `${fmt1(model.water * 100)}%`, 'Phần diện tích vòng.'),
    li('Trường học', nearestText(model.nearest.school, place.r, model.osmError), ''),
    li('Y tế', nearestText(model.nearest.health, place.r, model.osmError), ''),
    li('Chợ', nearestText(model.nearest.market, place.r, model.osmError), ''),
    li('Xe buýt', nearestText(model.nearest.bus, place.r, model.osmError), '')
  ];
  $('stats').replaceChildren(...items);
  const when = model.osmDate ? ` OpenStreetMap ${String(model.osmDate).slice(0, 10)}.` : '';
  $('src').textContent = `Dấu chân và chiều cao © TUM, Global Building Atlas, CC BY-NC 4.0. Đường, công viên và công trình © người đóng góp OpenStreetMap, ODbL.${when}`;
  paintMassing(model.massing || []);
}

function lift(z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];
}

function bootMap(place, model) {
  const parent = $('map');
  const CART = deck.COORDINATE_SYSTEM.CARTESIAN;
  let sphere = null;
  try { sphere = new deck.SphereGeometry({ radius: 1, nlat: 5, nlong: 8 }); } catch (err) { sphere = null; }
  let lights = null;
  try {
    lights = new deck.LightingEffect({
      ambient: new deck.AmbientLight({ color: [255, 255, 255], intensity: 0.55 }),
      sun: new deck.DirectionalLight({ color: [255, 244, 236], intensity: 1.35, direction: [-0.45, -0.7, -1] })
    });
  } catch (err) { lights = null; }
  const dash = new deck.PathStyleExtension({ dash: true });
  const view = { k: place.view === 'gop' ? 0 : 1 };
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let camera = null;
  let deckgl = null;

  let maskExt = null;
  try { maskExt = new deck.MaskExtension(); } catch (err) { maskExt = null; }
  const orbit = new deck.OrbitView({ orbitAxis: 'Z', orthographic: false, fovy: FOV_Y, near: 0.01, far: 80 });

  function gapValue() {
    const n = Number($('gap') && $('gap').value);
    return Number.isFinite(n) ? Math.min(2, Math.max(0.4, n)) : 1;
  }

  function withMask(props) {
    if (!maskExt) return props;
    return { ...props, extensions: [...(props.extensions || []), maskExt], maskId: 'disc-mask' };
  }

  function fitState(k) {
    const w = Math.max(parent.clientWidth || 900, 320);
    const hgt = Math.max(parent.clientHeight || 700, 240);
    const pad = 28;
    const top = LIFT.volumes * k * gapValue() + 48;
    const target = [0, 0, top * 0.32];
    const rotationX = camera ? camera.rotationX : 50;
    const rotationOrbit = camera ? camera.rotationOrbit : -32;
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([Math.cos(a) * place.r, Math.sin(a) * place.r, 0]);
      pts.push([Math.cos(a) * place.r, Math.sin(a) * place.r, top]);
    }
    let lo = -8;
    let hi = 4;
    for (let i = 0; i < 22; i++) {
      const zoom = (lo + hi) / 2;
      const vp = orbit.makeViewport({
        width: w,
        height: hgt,
        viewState: { target, rotationX, rotationOrbit, zoom, minZoom: -12, maxZoom: 12 }
      });
      let ok = true;
      for (const pt of pts) {
        const xy = vp.project(pt);
        if (!xy || xy[2] < 0 || xy[2] > 1 || xy[0] < pad || xy[0] > w - pad || xy[1] < pad || xy[1] > hgt - pad) {
          ok = false;
          break;
        }
      }
      if (ok) lo = zoom;
      else hi = zoom;
    }
    return { target, rotationX, rotationOrbit, zoom: lo, minZoom: lo - 1.6, maxZoom: lo + 2.8 };
  }

  function planeZ(name) {
    return LIFT[name] * view.k * gapValue();
  }

  function polys(id, data, z) {
    return new deck.PolygonLayer(withMask({
      id,
      data,
      coordinateSystem: CART,
      modelMatrix: lift(z),
      extruded: true,
      filled: true,
      stroked: false,
      wireframe: false,
      pickable: false,
      getPolygon: (d) => d.rings,
      getElevation: (d) => d.h,
      getFillColor: (d) => d.fill,
      material: SOFT
    }));
  }

  function blooms(id, data, z) {
    if (!data || !data.length) return null;
    return new deck.ScatterplotLayer(withMask({
      id,
      data,
      coordinateSystem: CART,
      modelMatrix: lift(z),
      getPosition: (d) => d.position,
      getRadius: (d) => d.radius,
      radiusUnits: 'meters',
      getFillColor: (d) => d.color,
      stroked: false,
      pickable: false
    }));
  }

  function draw() {
    const k = view.k;
    const zLinks = planeZ('links');
    const zUses = planeZ('uses');
    const zVoids = planeZ('voids');
    const zVolumes = planeZ('volumes');
    const showStack = k > 0.08;
    const disc = plateRing(place.r);
    const layers = [
      new deck.PolygonLayer({
        id: 'disc-mask',
        operation: 'mask',
        data: [disc],
        coordinateSystem: CART,
        getPolygon: (d) => d,
        getFillColor: [255, 255, 255, 255]
      }),
      polys('plate-links', [{ rings: [disc], h: PLATE, fill: PLATE_FILL.links }], zLinks),
      new deck.PathLayer({
        id: 'rim',
        data: [{ path: disc.concat([disc[0]]) }],
        coordinateSystem: CART,
        modelMatrix: lift(zLinks + PLATE + 0.2),
        getPath: (d) => d.path,
        getColor: [51, 65, 85, 230],
        getWidth: 2,
        widthUnits: 'pixels',
        widthMinPixels: 1.5
      })
    ];
    if (showStack) {
      layers.push(polys('plate-uses', [{ rings: [disc], h: PLATE, fill: PLATE_FILL.uses }], zUses));
      layers.push(polys('plate-voids', [{ rings: [disc], h: PLATE, fill: PLATE_FILL.voids }], zVoids));
      layers.push(polys('plate-vol', [{ rings: [disc], h: PLATE, fill: PLATE_FILL.volumes }], zVolumes));
    }
    layers.push(polys('halos', model.halos, zVoids + PLATE + 0.15));
    layers.push(polys('greens', model.greens, zVoids + PLATE));
    layers.push(polys('waters', model.waters, zVoids + PLATE));
    layers.push(polys('squares', model.squares, zVoids + PLATE));
    const openBloom = blooms('open-bloom', model.openBloom, zVoids + PLATE + 1.1);
    if (openBloom) layers.push(openBloom);
    if (k > 0.12) {
      const access = blooms('access', model.access, zUses + PLATE + 0.3);
      if (access) layers.push(access);
      const byBlock = new Map();
      (model.blocks || []).forEach((v) => {
        const key = v.z0 || 0;
        if (!byBlock.has(key)) byBlock.set(key, []);
        byBlock.get(key).push(v);
      });
      let bi = 0;
      byBlock.forEach((data, z0) => {
        layers.push(polys(bi ? `blocks-${bi}` : 'blocks', data, zUses + PLATE + z0));
        bi += 1;
      });
      layers.push(new deck.PathLayer(withMask({
        id: 'block-edge',
        data: (model.blocks || []).filter((d) => d.infra),
        coordinateSystem: CART,
        modelMatrix: lift(zUses + PLATE + 0.45),
        getPath: (d) => d.rings[0].map((pt) => [pt[0], pt[1], (d.z0 || 0) + d.h]),
        getColor: [15, 23, 42, 255],
        getWidth: 4.5,
        widthUnits: 'pixels',
        widthMinPixels: 2
      })));
    }
    const byBase = new Map();
    model.volumes.forEach((v) => {
      const key = v.z0 || 0;
      if (!byBase.has(key)) byBase.set(key, []);
      byBase.get(key).push(v);
    });
    let volI = 0;
    byBase.forEach((data, z0) => {
      layers.push(polys(volI ? `volumes-${volI}` : 'volumes', data, zVolumes + PLATE + z0));
      volI += 1;
    });
    if (!coarse || model.volumes.length < 3500) {
      layers.push(new deck.PathLayer(withMask({
        id: 'roofs',
        data: model.volumes,
        coordinateSystem: CART,
        modelMatrix: lift(zVolumes + PLATE + 0.35),
        getPath: (d) => d.rings[0].map((pt) => [pt[0], pt[1], (d.z0 || 0) + d.h]),
        getColor: [67, 20, 7, 220],
        getWidth: 1.2,
        widthUnits: 'pixels',
        widthMinPixels: 1
      })));
    }
    const partTags = model.volumes.filter((v) => v.partLabel).map((v) => {
      const c = centroid(v.rings[0]);
      return { t: v.partLabel, position: [c[0], c[1], PLATE + (v.z0 || 0) + v.h + 3] };
    });
    if (partTags.length) {
      try {
        layers.push(new deck.TextLayer({
          id: 'part-floors',
          data: partTags,
          coordinateSystem: CART,
          modelMatrix: lift(zVolumes),
          getPosition: (d) => d.position,
          getText: (d) => d.t,
          getColor: [255, 255, 255, 255],
          getSize: 16,
          sizeUnits: 'pixels',
          fontFamily: 'sans-serif',
          fontSettings: { sdf: true }, // viền chỉ vẽ được khi sdf; thiếu sdf thì chữ bị cắt
          billboard: true,
          outlineWidth: 4,
          outlineColor: [28, 16, 8, 240],
          characterSet: 'Đế Tháp0123456789'
        }));
      } catch (err) { /* số tầng vẫn ở bảng bên trái */ }
    }
    layers.push(new deck.PathLayer(withMask({
      id: 'roads',
      data: model.roads,
      coordinateSystem: CART,
      modelMatrix: lift(zLinks + PLATE + 0.8),
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => d.width,
      widthUnits: 'meters',
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true
    })));
    layers.push(new deck.PathLayer(withMask({
      id: 'arrow-stems',
      data: model.arrows,
      coordinateSystem: CART,
      modelMatrix: lift(zLinks + PLATE + 1.4),
      getPath: (d) => d.stem,
      getColor: (d) => d.color,
      getWidth: 4.5,
      widthUnits: 'meters',
      widthMinPixels: 2
    })));
    layers.push(new deck.PolygonLayer(withMask({
      id: 'arrow-heads',
      data: model.arrows,
      coordinateSystem: CART,
      modelMatrix: lift(zLinks + PLATE + 1.6),
      extruded: true,
      filled: true,
      stroked: false,
      getPolygon: (d) => d.head,
      getElevation: 2,
      getFillColor: (d) => d.color,
      material: SOFT
    })));
    layers.push(new deck.ScatterplotLayer(withMask({
      id: 'nodes',
      data: model.nodes,
      coordinateSystem: CART,
      modelMatrix: lift(zLinks + PLATE + 2),
      getPosition: (d) => d,
      getRadius: 8,
      radiusUnits: 'meters',
      getFillColor: [255, 255, 255, 255],
      stroked: true,
      getLineColor: [55, 55, 58, 255],
      lineWidthUnits: 'pixels',
      getLineWidth: 2
    })));
    if (showStack) {
      const posts = [];
      const seams = [['links', 'uses'], ['uses', 'voids'], ['voids', 'volumes']];
      model.corners.forEach((c) => {
        seams.forEach(([a, b]) => {
          const z0 = planeZ(a) + PLATE;
          const z1 = planeZ(b);
          if (z1 - z0 < 16) return;
          posts.push([[c[0], c[1], z0], [c[0], c[1], z1]]);
        });
      });
      layers.push(new deck.PathLayer({
        id: 'posts',
        data: posts,
        coordinateSystem: CART,
        getPath: (d) => d,
        getColor: [150, 150, 148, 210],
        getWidth: 1.4,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        extensions: [dash],
        getDashArray: () => [3, 2]
      }));
      const badges = [
        { plane: 'volumes', color: [214, 54, 66, 255] },
        { plane: 'voids', color: [22, 163, 74, 255] },
        { plane: 'uses', color: [2, 132, 199, 255] },
        { plane: 'links', color: [214, 168, 32, 255] }
      ];
      const badgePos = (d) => [-place.r - 42, 0, planeZ(d.plane) + 16];
      layers.push(new deck.ScatterplotLayer({
        id: 'badges',
        data: badges,
        coordinateSystem: CART,
        getPosition: badgePos,
        getRadius: 16,
        radiusUnits: 'meters',
        getFillColor: (d) => d.color,
        stroked: true,
        getLineColor: [255, 255, 255, 230],
        lineWidthMinPixels: 2,
        getLineWidth: 2
      }));
      try {
        layers.push(new deck.TextLayer({
          id: 'badge-num',
          data: badges.map((d, i) => ({ ...d, t: String(i + 1) })),
          coordinateSystem: CART,
          getPosition: badgePos,
          getText: (d) => d.t,
          getColor: [255, 255, 255, 255],
          getSize: 16,
          sizeUnits: 'pixels',
          fontFamily: 'sans-serif',
          billboard: true,
          characterSet: '1234'
        }));
      } catch (err) { /* số nằm trên thẻ bên trái */ }
    }
    deckgl.setProps({ layers });
  }

  camera = fitState(view.k);
  deckgl = new deck.Deck({
    parent,
    views: orbit,
    controller: { scrollZoom: false, touchZoom: true, dragPan: true, dragRotate: true, touchRotate: true, doubleClickZoom: false, keyboard: false },
    viewState: camera,
    onViewStateChange: ({ viewState }) => {
      camera = viewState;
      deckgl.setProps({ viewState: camera });
    },
    effects: lights ? [lights] : [],
    parameters: { clearColor: [0.91, 0.933, 0.953, 1] },
    useDevicePixels: coarse ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
  });

  let job = 0;
  function animateTo(target) {
    const from = view.k;
    const t0 = performance.now();
    const id = ++job;
    const step = (now) => {
      if (id !== job) return;
      const t = Math.min(1, (now - t0) / 700);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      view.k = from + (target - from) * e;
      camera = fitState(view.k);
      deckgl.setProps({ viewState: camera });
      draw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function setMode(mode, animate) {
    const exploded = mode !== 'gop';
    $('btnTach').setAttribute('aria-pressed', exploded ? 'true' : 'false');
    $('btnGop').setAttribute('aria-pressed', exploded ? 'false' : 'true');
    $('modeChip').textContent = exploded ? 'Tách bốn lớp' : 'Gộp một khối';
    const gapRow = $('gapRow');
    if (gapRow) gapRow.hidden = !exploded;
    const url = new URL(location.href);
    url.searchParams.set('view', exploded ? 'tach' : 'gop');
    history.replaceState(null, '', url);
    if (animate) animateTo(exploded ? 1 : 0);
    else {
      view.k = exploded ? 1 : 0;
      camera = fitState(view.k);
      deckgl.setProps({ viewState: camera });
      draw();
    }
  }
  $('btnTach').addEventListener('click', () => setMode('tach', true));
  $('btnGop').addEventListener('click', () => setMode('gop', true));
  $('gap')?.addEventListener('input', () => {
    if (view.k < 0.5) return;
    camera = fitState(view.k);
    deckgl.setProps({ viewState: camera });
    draw();
  });
  setMode(place.view, false);
  bindDeckNotchZoom(parent, () => camera, (zoom) => {
    camera = { ...camera, zoom };
    deckgl.setProps({ viewState: camera });
  });
  window.addEventListener('resize', () => {
    camera = fitState(view.k);
    deckgl.setProps({ viewState: camera });
  });
  $('btnTach').disabled = false;
  $('btnGop').disabled = false;
  document.body.dataset.ready = '1';
  return {
    replace(next) {
      model = next;
      draw();
    }
  };
}

function pointInGeo(lng, lat, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some((poly) => pointInRing([lng, lat], poly[0]) && !poly.slice(1).some((hole) => pointInRing([lng, lat], hole)));
}

function ringCentroidLngLat(ring) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of ring) {
    if (n && p[0] === ring[0][0] && p[1] === ring[0][1]) continue;
    x += p[0];
    y += p[1];
    n += 1;
  }
  return n ? [x / n, y / n] : null;
}

function ringInsideMask(ring, masks) {
  if (!ring || !masks || !masks.length) return false;
  const c = ringCentroidLngLat(ring);
  return c ? masks.some((g) => pointInGeo(c[0], c[1], g)) : false;
}

function geometryAreaM2(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let area = 0;
  for (const coords of polys) {
    const ring = coords[0].map(([lng, lat]) => [(lng - 107.59) * 106800, (lat - 16.46) * 110540]);
    area += Math.abs(signedArea(ring));
  }
  return area;
}

function pushOverridePolys(out, geometry, spec) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const coords of polys) {
    const rings = coords.map((ring) => ring.map(([lng, lat]) => [lng, lat]));
    if (Math.abs(signedArea(rings[0].map(([lng, lat]) => [(lng - 107.59) * 106800, (lat - 16.46) * 110540]))) < 80) continue;
    out.push({ rings, ...spec });
  }
}

async function loadOverrideFootprints() {
  const empty = { extras: [], masks: [], massing: [] };
  try {
    const res = await fetch(withAssetVersion('data/gba/bldg-overrides.geojson'));
    if (!res.ok) return empty;
    const fc = await res.json();
    const extras = [];
    const masks = [];
    for (const f of fc.features || []) {
      const props = f.properties || {};
      const parts = Array.isArray(props.parts) ? props.parts : [];
      if (!f.geometry || (!props.draw && !parts.length)) continue;
      if (props.draw) masks.push(f.geometry);
      if (props.roofMask && props.roofMask.type) masks.push(props.roofMask);
      if (!parts.length) {
        pushOverridePolys(extras, f.geometry, { explicit: false });
        continue;
      }
      for (const part of parts) {
        const geometry = part.geometry || f.geometry;
        if (geometryAreaM2(geometry) >= 80) masks.push(geometry);
        const height = Number(part.height);
        const minHeight = Number(part.min_height) || 0;
        const floors = Number(part.floors);
        if (!(height > minHeight) || !floors) continue;
        pushOverridePolys(extras, geometry, {
          explicit: true,
          height,
          minHeight,
          floors,
          groundFloors: Number(part.groundFloors) || 0,
          role: props.draw ? (part.role === 'podium' ? 'podium' : 'tower') : ''
        });
      }
    }
    return { extras, masks, massing: Array.isArray(fc.massing) ? fc.massing : [] };
  } catch (e) {
    return empty;
  }
}

async function loadWard(lat, lng) {
  const [boundary, imm] = await Promise.all([
    fetch(withAssetVersion('data/ward-boundary.json')).then((r) => r.json()),
    fetch('data/imm.json').then((r) => r.json())
  ]);
  const feat = (boundary.features || []).find((f) => f.geometry && pointInGeo(lng, lat, f.geometry));
  const name = feat && feat.properties ? feat.properties.tenXa : '';
  const row = (imm.wards || []).find((w) => w.name === name);
  return { name, pop: row && row.pop ? row.pop : 0 };
}

let floorPack = { v: 1, saved: 0, edits: {} };
let additionPack = { v: 1, saved: 0, features: [] };
let built = null;
let view = null;

const ADD_STORE = 'qh_bldg_additions';

function mountAdditions(next) {
  additionPack = next;
  try { sessionStorage.setItem(ADD_STORE, JSON.stringify({ v: 1, saved: next.saved, features: next.features })); } catch (e) { /* riêng tư */ }
  if (!built) return;
  const vol = toExplicitVolumes(next.features);
  built.raw.gba = (built.raw.gba || []).filter((feat) => !feat.added).concat(vol.extras);
  built.raw.masks = (built.raw.maskBase || []).concat(vol.masks);
}

async function loadAdditionPack() {
  let remote = { v: 1, saved: 0, features: [] };
  try {
    const res = await fetch(geeApi('action=getBldgAdditions'));
    if (res.ok) remote = parseAdditionPack(await res.json());
  } catch (e) { /* máy chủ tĩnh */ }
  try {
    const local = parseAdditionPack(JSON.parse(sessionStorage.getItem(ADD_STORE) || 'null'));
    if (local.saved >= remote.saved && local.features.length) remote = local;
  } catch (e) { /* chưa có bản trong phiên */ }
  if (additionPack.saved > remote.saved) return additionPack;
  additionPack = remote;
  return additionPack;
}

async function loadFloorPack() {
  let remote = { v: 1, saved: 0, edits: {} };
  try {
    const res = await fetch(geeApi('action=getBldgFloors'));
    if (res.ok) remote = parseFloorPack(await res.json());
  } catch (e) { /* máy chủ tĩnh */ }
  try {
    const local = parseFloorPack(JSON.parse(sessionStorage.getItem('qh_bldg_floors') || 'null'));
    if (local.saved >= remote.saved && Object.keys(local.edits).length) remote = local;
  } catch (e) { /* chưa có bản trong phiên */ }
  floorPack = remote;
}

function showBuilt() {
  if (!built) return;
  const model = buildModel(built.raw, built.origin, built.place.r, built.heights, floorPack);
  model.osmError = built.raw.osmError;
  paintPanel(model, built.place, built.ward);
  $('status').textContent = model.meanF == null
    ? 'Chưa có chiều cao mét trong ô.'
    : `Số liệu trong vòng tròn. Tầng cao trung bình ${fmt1(model.meanF)}, sàn ${fmt0(model.gfa)} m².`;
  $('status').classList.add('done');
  if (model.meanF != null) document.body.dataset.meanF = String(model.meanF);
  const hs = model.volumes.map((v) => (v.z0 || 0) + v.h);
  if (hs.length) {
    document.body.dataset.minH = String(Math.min(...hs));
    document.body.dataset.maxH = String(Math.max(...hs));
    document.body.dataset.raised = String(model.volumes.filter((v) => v.z0 > 0).length);
  }
  document.body.dataset.buildings = String(model.buildings);
  document.body.dataset.shape = 'circle';
  document.body.dataset.area = String(Math.round(model.area));
  document.body.dataset.roads = String(model.roads.length);
  document.body.dataset.greens = String(model.greens.length);
  document.body.dataset.waters = String(model.waters.length);
  document.body.dataset.arrows = String(model.arrows.length);
  document.body.dataset.greenPct = String(model.green);
  if (model.greens[0]) {
    const ring = model.greens[0].rings[0];
    document.body.dataset.g0 = `${ring.length}|${ring[0][0].toFixed(0)},${ring[0][1].toFixed(0)}|${Math.round(ringArea(ring))}`;
  }
  document.body.dataset.gfa = String(Math.round(model.gfa || 0));
  document.body.dataset.partLabels = model.volumes.map((v) => v.partLabel).filter(Boolean).join('|');
  if (!view) view = bootMap(built.place, model);
  else view.replace(model);
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'qh-bldg-add') {
      mountAdditions(parseAdditionPack(e.data.pack));
      showBuilt();
      return;
    }
    if (e.data.type !== 'qh-floor-edit') return;
    loadFloorPack().then(showBuilt).catch(() => {});
  });
}

async function start() {
  const place = parseCenter(location.search);
  const mLat = 110540;
  const mLng = 111320 * Math.cos((place.lat * Math.PI) / 180);
  const origin = { lat: place.lat, lng: place.lng, mLat, mLng };
  const nearDefault = Math.hypot(place.lat - 16.4637, place.lng - 107.5952) < 0.0008;
  $('place').textContent = nearDefault
    ? `Ngã sáu Hùng Vương – Bà Triệu. Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`
    : `Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`;
  const tiles = tilesFor(place.lat, place.lng, place.r);
  if (tiles.length > 16) {
    $('status').textContent = 'Ô quá lớn so với số tile cho phép trên trang này.';
    return;
  }
  const raw = { gba: [], cadastre: [], osm: null, gbaError: '', cadError: '', osmError: '', heightMeta: null };
  const [gba, cad, osm, ward, heights] = await Promise.all([
    readLayer('gba', 'gba', tiles).catch((err) => { raw.gbaError = err.message; return []; }),
    readLayer('cadastre', 'thuadat', tiles).catch((err) => { raw.cadError = err.message; return []; }),
    loadOsm(place).catch((err) => { raw.osmError = err.message; return null; }),
    loadWard(place.lat, place.lng).catch(() => ({ name: '', pop: 0 })),
    fetch(withAssetVersion('data/gba/bldg-hf.bin')).then(async (res) => {
      if (!res.ok) throw new Error('bin');
      const buf = await res.arrayBuffer();
      const meta = await fetch(withAssetVersion('data/gba/bldg-hf.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const index = parseHeightIndex(buf);
      index.meta = meta;
      return index;
    }).catch(() => null)
  ]);
  const overrides = await loadOverrideFootprints();
  const additions = await loadAdditionPack();
  const added = toExplicitVolumes(additions.features);
  raw.maskBase = overrides.masks;
  raw.gba = gba.concat(overrides.extras, added.extras);
  raw.masks = raw.maskBase.concat(added.masks);
  raw.massing = overrides.massing;
  raw.cadastre = cad;
  raw.osm = osm;
  raw.heightMeta = heights && heights.meta;
  if (ward.name && nearDefault) {
    $('place').textContent = `Ngã sáu Hùng Vương – Bà Triệu, ${ward.name}. Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`;
  } else if (ward.name) {
    $('place').textContent = `${ward.name}. Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`;
  }
  try {
    built = { raw, origin, place: { ...place, mLng, mLat }, heights, ward };
    await loadFloorPack();
    showBuilt();
  } catch (err) {
    console.warn('Mô hình 3D:', err);
    $('status').textContent = 'Không dựng được mô hình trong vòng tròn.';
  }
}

if (typeof document !== 'undefined') start();
