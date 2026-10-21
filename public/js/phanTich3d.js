// Bản mẫu: bốn thành phần đô thị (khối, khoảng trống, chức năng, liên kết) trong một vòng tròn.
// Chiều cao công trình trên hình chỉ để tách nhóm tương đối của Global Building Atlas, không phải mét đo đạc.
// Dân số phường không được nhân theo diện tích vòng tròn.

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
const CLASS_NAME = ['Thấp', 'Trung bình', 'Cao', 'Rất cao'];
// Bậc vẽ, không phải số mét. Cùng thứ tự nhóm c = 0..3 trong buildings.pmtiles.
const CLASS_DRAW = [9, 18, 32, 52];
const VOLUME_FILL = [[250, 214, 214], [246, 196, 196], [240, 174, 174], [232, 150, 150]];
const VOLUME_LINE = [156, 74, 74, 200];
const LIFT = { links: 0, uses: 90, voids: 180, volumes: 270 };
const SEARCH_M = 2000;

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
const LAND_COLORS = {
  LUC: '#ffff64', LUK: '#ffff78', LUN: '#ffff8c', LUA: '#ffff78', BHK: '#fff0b4', NHK: '#fff0b4', HNK: '#fff0b4',
  CLN: '#ffd7aa', NKH: '#f5f08c', RSX: '#b4ffb4', RPH: '#beff1e', RDD: '#6eff64', NTS: '#aaffff', LMU: '#fafafa',
  ODT: '#ffa0ff', ONT: '#ffd0ff', CQP: '#ff5046', CAN: '#ff5046', DGT: '#ffaa32', DTL: '#aaffff',
  SON: '#a0ffff', MNC: '#b4ffff', NTD: '#d2d2d2', SKS: '#cdaacd', SKX: '#cdaacd', DRA: '#cdaacd',
  BCS: '#fafafa', DCS: '#fafafa', NCS: '#e6e6c8'
};
const PUBLIC_COLOR = '#ffaaa0';
const NO_CODE_COLOR = '#d4d4d4';
const ROAD_RANK = {
  motorway: 'truc', motorway_link: 'truc', trunk: 'truc', trunk_link: 'truc', primary: 'truc', primary_link: 'truc',
  secondary: 'khuvuc', secondary_link: 'khuvuc', tertiary: 'khuvuc', tertiary_link: 'khuvuc',
  unclassified: 'noibo', residential: 'noibo', living_street: 'noibo', service: 'noibo',
  cycleway: 'xedap', pedestrian: 'dibo', footway: 'dibo', path: 'dibo', steps: 'dibo'
};
const ROAD_COLOR = {
  truc: [224, 122, 61, 230],
  khuvuc: [96, 150, 214, 230],
  noibo: [176, 184, 194, 220],
  xedap: [110, 168, 120, 220],
  dibo: [196, 186, 170, 200],
  rail: [107, 76, 122, 230],
  water: [74, 163, 199, 230]
};
const ROAD_HALF = { truc: 4.2, khuvuc: 3.1, noibo: 2.1, xedap: 1.5, dibo: 1.3, rail: 3.2, water: 2.4 };
const DENSITY_RANKS = new Set(['truc', 'khuvuc', 'noibo']);

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

export function circleRing(r, n = 64) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return ring;
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

function bboxOutside(ring, r) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of ring) {
    if (p[0] < minx) minx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] > maxy) maxy = p[1];
  }
  const cx = minx > 0 ? minx : maxx < 0 ? maxx : 0;
  const cy = miny > 0 ? miny : maxy < 0 ? maxy : 0;
  return cx * cx + cy * cy > r * r;
}

function fullyInside(ring, r) {
  const r2 = r * r;
  for (const p of ring) if (p[0] * p[0] + p[1] * p[1] > r2) return false;
  return true;
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

export function clipPolyline(line, r) {
  const parts = [];
  let cur = null;
  for (let i = 1; i < line.length; i++) {
    const bits = clipSegment(line[i - 1], line[i], r);
    for (const [a, b] of bits) {
      if (cur && Math.hypot(cur[cur.length - 1][0] - a[0], cur[cur.length - 1][1] - a[1]) < 0.25) cur.push(b);
      else {
        if (cur && cur.length > 1) parts.push(cur);
        cur = [a, b];
      }
    }
  }
  if (cur && cur.length > 1) parts.push(cur);
  return parts;
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

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 210];
}

function landCode(l) {
  return (String(l || '').toUpperCase().match(/[A-Z]{3}/) || [''])[0];
}

function landColor(code) {
  if (!code) return hexRgb(NO_CODE_COLOR);
  return hexRgb(LAND_COLORS[code] || PUBLIC_COLOR);
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
    const gcs = kind === 'gba' ? GBA_URL : CAD_URL;
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

// Vòng đầu là viền ngoài. Vòng cùng chiều là phần tách; vòng ngược chiều là lỗ.
function clipFeature(feat, origin, clip, r) {
  const rings = feat.rings.map((ring) => ring.map(([lng, lat]) => toLocal(lng, lat, origin)));
  if (!rings.length || bboxOutside(rings[0], r)) return [];
  const parts = [];
  let current = null;
  const signOf = (ring) => Math.sign(signedArea(ring)) || 1;
  rings.forEach((ring, index) => {
    const cut = fullyInside(ring, r) ? ring : clipRing(ring, clip);
    if (!cut) return;
    const sign = signOf(cut);
    if (!current || (index > 0 && sign === current.sign)) {
      if (current && current.area > 1) parts.push(current);
      current = { rings: [cut], area: ringArea(cut), sign };
      return;
    }
    current.rings.push(cut);
    current.area -= ringArea(cut);
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

function quad(a, b, half) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny]
  ];
}

function arrowHead(p, dir) {
  const h = Math.hypot(dir[0], dir[1]) || 1;
  const dx = dir[0] / h;
  const dy = dir[1] / h;
  const px = -dy;
  const py = dx;
  return [
    [p[0] + dx * 7, p[1] + dy * 7],
    [p[0] - dx * 5 + px * 4, p[1] - dy * 5 + py * 4],
    [p[0] - dx * 5 - px * 4, p[1] - dy * 5 - py * 4]
  ];
}

function arrowsAlong(line) {
  const heads = [];
  let acc = 0;
  let next = 80;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    while (acc + len >= next) {
      const t = (next - acc) / len;
      heads.push(arrowHead([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [b[0] - a[0], b[1] - a[1]]));
      next += 80;
    }
    acc += len;
  }
  return heads;
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
  if (['hospital', 'clinic', 'doctors'].includes(amenity)) return 'health';
  if (amenity === 'marketplace') return 'market';
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
node["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|marketplace)$"](${s});
way["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|marketplace)$"](${s});
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

function pointInGeo(lng, lat, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some((poly) => pointInRing([lng, lat], poly[0]) && !poly.slice(1).some((hole) => pointInRing([lng, lat], hole)));
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
  const step = r / 36;
  let inside = 0;
  let hit = 0;
  for (let y = -r; y <= r; y += step) {
    for (let x = -r; x <= r; x += step) {
      if (x * x + y * y > r * r) continue;
      inside += 1;
      if (polys.some((ring) => pointInRing([x, y], ring))) hit += 1;
    }
  }
  return inside ? hit / inside : 0;
}

function polyFeature(rings, plane, h, fill, line) {
  return { rings, plane, h, fill, line };
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

function lineLength(parts) {
  let m = 0;
  for (const line of parts) {
    for (let i = 1; i < line.length; i++) m += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return m;
}

function buildModel(raw, origin, r) {
  const clip = circleRing(r, 64);
  const features = [];
  const gaps = [];
  const buildings = [];
  let footprint = 0;
  const classArea = [0, 0, 0, 0];
  if (raw.gbaError) gaps.push('Không đọc được dấu chân công trình (Global Building Atlas).');
  else {
    for (const feat of raw.gba) {
      const c = Math.max(0, Math.min(3, Number(feat.props.c) || 0));
      for (const cut of clipFeature(feat, origin, clip, r)) {
        footprint += cut.area;
        classArea[c] += cut.area;
        buildings.push({ ...cut, c });
      }
    }
    if (!buildings.length) gaps.push('Không có dấu chân công trình trong vòng tròn.');
  }

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
  const disc = circleRing(r, 72);
  features.push(polyFeature([disc], 'links', 0.4, [252, 249, 244, 255], [0, 0, 0, 0]));
  for (const p of parcels) {
    const fill = landColor(p.code);
    features.push(polyFeature(p.rings, 'uses', 4, fill, [120, 100, 90, 140]));
  }
  let unassigned = 0;
  for (const b of buildings) {
    const hit = findParcel(...centroid(b.rings[0]));
    const fill = hit ? landColor(hit.code) : [228, 224, 218, 180];
    if (!hit) unassigned += 1;
    features.push(polyFeature(b.rings, 'uses', 8, fill, [120, 100, 90, 120]));
    features.push(polyFeature(b.rings, 'volumes', CLASS_DRAW[b.c], VOLUME_FILL[b.c].concat(225), VOLUME_LINE));
  }

  const greenRings = [];
  const waterRings = [];
  const squareRings = [];
  const roadM = { truc: 0, khuvuc: 0, noibo: 0, xedap: 0, dibo: 0, rail: 0, water: 0 };
  const nearest = { school: null, health: null, market: null, bus: null };
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
            const fill = kind === 'water' ? [168, 207, 232, 210] : kind === 'square' ? [214, 224, 196, 210] : kind === 'pitch' ? [198, 216, 176, 180] : [176, 214, 170, 210];
            const line = kind === 'water' ? [61, 111, 143, 180] : [70, 120, 80, 160];
            features.push(polyFeature([cut], 'voids', 6, fill, line));
            if (kind === 'water') waterRings.push(cut);
            else if (kind === 'square') squareRings.push(cut);
            else if (kind === 'green') greenRings.push(cut);
          }
        }
        let rank = null;
        if (tags.railway && tags.railway !== 'abandoned') rank = 'rail';
        else if (tags.waterway) rank = 'water';
        else if (!(tags.highway === 'pedestrian' && tags.area === 'yes')) rank = ROAD_RANK[tags.highway] || null;
        if (rank) {
          const parts = clipPolyline(local, r);
          roadM[rank] += lineLength(parts);
          const color = ROAD_COLOR[rank];
          const half = ROAD_HALF[rank];
          for (const part of parts) {
            for (let i = 1; i < part.length; i++) {
              features.push(polyFeature([quad(part[i - 1], part[i], half)], 'links', rank === 'rail' ? 4 : 3, color, color));
            }
            if (rank === 'truc' || rank === 'khuvuc' || rank === 'noibo' || rank === 'rail') {
              for (const head of arrowsAlong(part)) features.push(polyFeature([head], 'links', 5, color, color));
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
      const row = { dist, name: tags.name || '', lng, lat };
      if (!nearest[fac] || row.dist < nearest[fac].dist) nearest[fac] = row;
      if (fac === 'bus') {
        const p = toLocal(lng, lat, origin);
        if (p[0] * p[0] + p[1] * p[1] <= r * r) {
          stopsInside += 1;
          const stop = circleRing(5, 8).map(([x, y]) => [p[0] + x, p[1] + y]);
          features.push(polyFeature([stop], 'links', 10, [217, 119, 6, 230], [146, 64, 14, 200]));
        }
      }
    }
    if (!greenRings.length) gaps.push('OpenStreetMap không có vùng cây xanh hoặc công viên (way) trong vòng tròn.');
    if (!waterRings.length) gaps.push('OpenStreetMap không có mặt nước (way) trong vòng tròn.');
    if (!squareRings.length) gaps.push('OpenStreetMap không có quảng trường trong vòng tròn.');
    if (roadM.rail === 0) gaps.push('OpenStreetMap không có đường sắt trong vòng tròn.');
    if (roadM.water === 0) gaps.push('OpenStreetMap không có đường thủy trong vòng tròn.');
  }

  const anchors = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) + (i * Math.PI) / 2;
    anchors.push([Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62]);
  }
  const connectors = anchors.map((a) => ({ a }));
  const outlines = ['links', 'uses', 'voids', 'volumes'].map((plane) => ({ plane, ring: disc }));

  const circleArea = Math.PI * r * r;
  const mix = shannon(groupArea);
  const driveM = roadM.truc + roadM.khuvuc + roadM.noibo;
  return {
    features, connectors, outlines, gaps, nearest, stopsInside, roadM, driveM, circleArea, footprint,
    buildings: buildings.length, classArea, parcels: parcels.length, groupArea, noCode, unassigned, mix,
    green: coverRatio(greenRings, r),
    water: coverRatio(waterRings, r),
    square: coverRatio(squareRings, r),
    osmDate: raw.osm && raw.osm.osm3s ? raw.osm.osm3s.timestamp_osm_base : ''
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

function legendItem(color, label, note) {
  const item = document.createElement('li');
  const sw = document.createElement('i');
  sw.style.background = color;
  const span = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = label;
  span.append(b);
  if (note) {
    const small = document.createElement('small');
    small.textContent = note;
    span.append(small);
  }
  item.append(sw, span);
  return item;
}

function nearestText(row, r, osmError) {
  if (osmError) return osmError;
  if (!row) return 'Không có trong OpenStreetMap trong bán kính tìm 2 km.';
  const name = row.name ? `${row.name}, ` : '';
  const where = row.dist > r ? ', ngoài vòng phân tích' : ', trong vòng phân tích';
  return `${name}${fmt0(row.dist)} m${where}`;
}

function paintPanel(model, place, wardPop) {
  const legend = $('legend');
  legend.replaceChildren(
    legendItem('#f4c4c4', 'Khối tích', 'Dấu chân công trình, màu đỏ nhạt. Chiều cao vẽ theo nhóm tương đối, không phải mét.'),
    legendItem('#b0d6aa', 'Không gian mở', 'Công viên, cây, mặt nước và quảng trường trên OpenStreetMap.'),
    legendItem('#ffa0ff', 'Chức năng sử dụng', 'Thửa và dấu chân tô theo mã loại đất địa chính 2016.'),
    legendItem('#e07a3d', 'Liên kết', 'Đường theo thứ bậc, đường sắt, đường thủy, điểm dừng xe buýt. Mũi tên chỉ hướng đoạn đường.')
  );
  const areaHa = model.circleArea / 10000;
  const stats = $('stats');
  const items = [
    li('Diện tích vòng tròn', `${fmt1(areaHa)} ha`, `Bán kính ${fmt0(place.r)} m.`),
    li('Mật độ xây dựng', model.buildings ? `${fmt1(model.footprint / model.circleArea * 100)}%` : 'Không có dấu chân trong vòng.',
      model.buildings ? `${fmt0(model.buildings)} công trình, dấu chân ${fmt1(model.footprint / 10000)} ha. Phần thửa bị cắt theo vòng.` : ''),
    li('Tầng cao trung bình', 'Không tính được.', 'Tệp buildings.pmtiles chỉ có bốn nhóm chiều cao tương đối, không có số tầng.'),
    li('Tổng diện tích sàn', 'Không tính được.', 'Không có chiều cao bằng mét hoặc số tầng để nhân với dấu chân.')
  ];
  if (model.buildings) {
    const parts = CLASS_NAME.map((name, i) => `${name} ${fmt0(model.classArea[i] / model.footprint * 100)}%`).join(', ');
    items.push(li('Nhóm chiều cao tương đối', parts, 'Tỷ lệ theo diện tích dấu chân trong vòng. Không quy ra mét.'));
  }
  items.push(
    li('Tỷ lệ cây xanh, công viên', model.osmError ? 'Không có số liệu.' : `${fmt1(model.green * 100)}%`,
      'Phần lưới mẫu trong vòng rơi vào way cây xanh hoặc công viên. Không phải kiểm kê cây. Bỏ sân thể thao và relation multipolygon.'),
    li('Tỷ lệ mặt nước', model.osmError ? 'Không có số liệu.' : `${fmt1(model.water * 100)}%`,
      'Cùng cách lấy mẫu, với mặt nước trên OpenStreetMap. Không cộng thửa địa chính để tránh đếm trùng.'),
    li('Quảng trường', model.osmError ? 'Không có số liệu.' : (model.square > 0 ? `${fmt1(model.square * 100)}%` : 'Không có trong dữ liệu.'),
      'place=square hoặc đường đi bộ dạng vùng.')
  );
  if (model.mix == null) {
    items.push(li('Chỉ số đa dạng chức năng', 'Chưa đủ hai nhóm loại đất.', 'Shannon (ln) theo diện tích nhóm mã Thông tư 28/2014/TT-BTNMT. Bỏ thửa không có mã.'));
  } else {
    const top = [...model.groupArea.entries()].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([name, v]) => `${name} ${fmt0(v / [...model.groupArea.values()].reduce((s, n) => s + n, 0) * 100)}%`).join('; ');
    items.push(li('Chỉ số đa dạng chức năng', fmt2(model.mix), `Shannon (ln) theo nhóm loại đất địa chính. ${top}`));
  }
  const km2 = model.circleArea / 1e6;
  items.push(li('Mật độ mạng đường', model.osmError ? 'Không có số liệu.' : `${fmt2(model.driveM / 1000 / km2)} km/km²`,
    'Chiều dài đường trục, khu vực và nội bộ trên OpenStreetMap, cắt theo vòng. Không gồm đường đi bộ và làn xe đạp. Bề rộng nét trên hình chỉ để phân thứ bậc.'));
  items.push(
    li('Trường học gần nhất', nearestText(model.nearest.school, place.r, model.osmError), 'Trường, mầm non, cao đẳng, đại học trên OpenStreetMap.'),
    li('Cơ sở y tế gần nhất', nearestText(model.nearest.health, place.r, model.osmError), 'Bệnh viện, phòng khám, bác sĩ trên OpenStreetMap.'),
    li('Chợ gần nhất', nearestText(model.nearest.market, place.r, model.osmError), 'amenity=marketplace trên OpenStreetMap.'),
    li('Điểm dừng xe buýt gần nhất', nearestText(model.nearest.bus, place.r, model.osmError), model.stopsInside ? `${model.stopsInside} điểm nằm trong vòng.` : 'Đếm điểm trong vòng nếu có.')
  );
  items.push(li('Dân số trong vòng tròn', 'Không có.', 'Lớp dân số nhà ở không cắt theo bán kính trên trang này. Không suy từ dân số phường.'));
  if (wardPop && wardPop.pop > 0) {
    items.push(li('Dân số cả phường', `${fmt0(wardPop.pop)} người`, `${wardPop.name}. Số của cả phường trong bộ chỉ số đã tính, không phải dân số vòng tròn.`));
  } else {
    items.push(li('Dân số cả phường', 'Không xác định được phường tại tâm vòng.', ''));
  }
  stats.replaceChildren(...items);
  const gapList = [...model.gaps];
  gapList.push('Lớp công trình đã duyệt không có cách cắt theo bán kính nên không dùng để đo khoảng cách.');
  gapList.push('Đồ án quy hoạch sử dụng đất không đưa vào trang này. Màu chức năng là mã địa chính năm 2016.');
  if (model.noCode > model.circleArea * 0.005) gapList.push(`Một phần thửa (${fmt1(model.noCode / model.circleArea * 100)}% vòng) không có mã loại đất.`);
  if (model.unassigned) gapList.push(`${fmt0(model.unassigned)} dấu chân không rơi vào thửa đã cắt, tô xám ở lớp chức năng.`);
  $('gaps').replaceChildren(...gapList.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  const when = model.osmDate ? ` OpenStreetMap ${String(model.osmDate).slice(0, 10)}.` : '';
  $('src').textContent = `Dấu chân © TUM, Global Building Atlas, CC BY-NC 4.0. Thửa đất địa chính 2016. Đường và không gian mở © người đóng góp OpenStreetMap, ODbL.${when}`;
}

function bootMap(place, model) {
  const map = new maplibregl.Map({
    container: 'map',
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4f1ea' } }] },
    center: [place.lng, place.lat],
    zoom: 16,
    pitch: 60,
    bearing: -28,
    maxPitch: 70,
    attributionControl: true,
    customAttribution: 'GBA © TUM · Địa chính 2016 · © OpenStreetMap'
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), 'bottom-right');
  const view = { k: place.view === 'gop' ? 0 : 1, tick: 0 };
  let overlay = null;
  const planeZ = (plane) => LIFT[plane] * view.k;
  const toPoly = (rings, z) => rings.map((ring) => ring.map((p) => [place.lng + p[0] / place.mLng, place.lat + p[1] / place.mLat, z]));
  const dash = new deck.PathStyleExtension({ dash: true });
  // Mỗi khoảng giữa hai lớp là một đoạn riêng: PathLayer chỉ nhận một đường cho mỗi đối tượng.
  const connectorData = () => {
    if (view.k <= 0.08) return [];
    const out = [];
    const pairs = [['links', 'uses', 4], ['uses', 'voids', 9], ['voids', 'volumes', 8]];
    model.connectors.forEach((d) => {
      pairs.forEach(([a, b, pad]) => {
        const z0 = planeZ(a) + pad;
        const z1 = planeZ(b);
        if (z1 - z0 < 8) return;
        out.push([
          [place.lng + d.a[0] / place.mLng, place.lat + d.a[1] / place.mLat, z0],
          [place.lng + d.a[0] / place.mLng, place.lat + d.a[1] / place.mLat, z1]
        ]);
      });
    });
    return out;
  };
  const draw = () => {
    const stack = [
      new deck.PolygonLayer({
        id: 'sheets',
        data: model.features,
        extruded: true,
        filled: true,
        stroked: true,
        wireframe: false,
        pickable: false,
        getPolygon: (d) => toPoly(d.rings, planeZ(d.plane)),
        getElevation: (d) => d.h,
        getFillColor: (d) => d.fill,
        getLineColor: (d) => d.line,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        lineWidthMinPixels: 1,
        updateTriggers: { getPolygon: view.tick },
        material: { ambient: 0.8, diffuse: 0.25, shininess: 0, specularColor: [0, 0, 0] }
      }),
      new deck.PathLayer({
        id: 'rings',
        data: model.outlines,
        getPath: (d) => toPoly([d.ring], planeZ(d.plane))[0],
        getColor: [140, 132, 122, 180],
        getWidth: 1.2,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        updateTriggers: { getPath: view.tick }
      }),
      new deck.PathLayer({
        id: 'posts',
        data: connectorData(),
        getPath: (d) => d,
        getColor: [120, 113, 108, 190],
        getWidth: 1.4,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        extensions: [dash],
        getDashArray: () => [3, 2]
      })
    ];
    overlay.setProps({ layers: stack });
  };
  map.on('load', () => {
    const w = map.getContainer().clientWidth || 800;
    const h = map.getContainer().clientHeight || 600;
    const mpp = (place.r * 2 * (h < 520 ? 1.18 : 1.45)) / w;
    const zoom = Math.log2((156543.03392 * Math.cos((place.lat * Math.PI) / 180)) / mpp);
    map.jumpTo({ center: [place.lng, place.lat], zoom: Math.max(14.6, Math.min(17.3, zoom)), pitch: 60, bearing: -28 });
    overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    draw();
    $('btnTach').disabled = false;
    $('btnGop').disabled = false;
    document.body.dataset.ready = '1';
  });
  let job = 0;
  function animateTo(target) {
    const from = view.k;
    const t0 = performance.now();
    const id = ++job;
    const step = (now) => {
      if (id !== job) return;
      const t = Math.min(1, (now - t0) / 850);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      view.k = from + (target - from) * e;
      view.tick += 1;
      draw();
      if (t < 1) requestAnimationFrame(step);
      else {
        view.k = target;
        draw();
      }
    };
    requestAnimationFrame(step);
  }
  function setMode(mode, animate) {
    const exploded = mode !== 'gop';
    $('btnTach').setAttribute('aria-pressed', exploded ? 'true' : 'false');
    $('btnGop').setAttribute('aria-pressed', exploded ? 'false' : 'true');
    $('modeChip').textContent = exploded ? 'Tách bốn lớp' : 'Gộp một khối';
    const url = new URL(location.href);
    url.searchParams.set('view', exploded ? 'tach' : 'gop');
    history.replaceState(null, '', url);
    if (animate) animateTo(exploded ? 1 : 0);
    else {
      view.k = exploded ? 1 : 0;
      view.tick += 1;
      if (overlay) draw();
    }
  }
  $('btnTach').disabled = true;
  $('btnGop').disabled = true;
  $('btnTach').addEventListener('click', () => setMode('tach', true));
  $('btnGop').addEventListener('click', () => setMode('gop', true));
  setMode(place.view, false);
  window.addEventListener('resize', () => map.resize());
}

async function loadWard(lat, lng) {
  const [boundary, imm] = await Promise.all([
    fetch('data/ward-boundary.json').then((r) => r.json()),
    fetch('data/imm.json').then((r) => r.json())
  ]);
  const feat = (boundary.features || []).find((f) => f.geometry && pointInGeo(lng, lat, f.geometry));
  const name = feat && feat.properties ? feat.properties.tenXa : '';
  const row = (imm.wards || []).find((w) => w.name === name);
  return { name, pop: row && row.pop ? row.pop : 0 };
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
    $('status').textContent = 'Bán kính quá lớn so với số tile cho phép trên trang này.';
    return;
  }
  const raw = { gba: [], cadastre: [], osm: null, gbaError: '', cadError: '', osmError: '' };
  const [gba, cad, osm, ward] = await Promise.all([
    readLayer('gba', 'gba', tiles).catch((err) => { raw.gbaError = err.message; return []; }),
    readLayer('cadastre', 'thuadat', tiles).catch((err) => { raw.cadError = err.message; return []; }),
    loadOsm(place).catch((err) => { raw.osmError = err.message; return null; }),
    loadWard(place.lat, place.lng).catch(() => ({ name: '', pop: 0 }))
  ]);
  raw.gba = gba;
  raw.cadastre = cad;
  raw.osm = osm;
  if (ward.name && nearDefault) {
    $('place').textContent = `Ngã sáu Hùng Vương – Bà Triệu, ${ward.name}. Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`;
  } else if (ward.name) {
    $('place').textContent = `${ward.name}. Tâm ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}. Bán kính ${fmt0(place.r)} m.`;
  }
  try {
    const model = buildModel(raw, origin, place.r);
    model.osmError = raw.osmError;
    paintPanel(model, place, ward);
    $('status').textContent = 'Số liệu chỉ tính phần nằm trong vòng tròn.';
    $('status').classList.add('done');
    bootMap({ ...place, mLng, mLat }, model);
  } catch (err) {
    $('status').textContent = 'Không dựng được mô hình trong vòng tròn.';
  }
}

if (typeof document !== 'undefined') start();
