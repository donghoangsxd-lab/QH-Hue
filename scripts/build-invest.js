// Dựng public/data/invest-boundary.geojson từ KMZ ranh dự án và public/data/invest-sheet.json từ danh sách Excel.
// Bỏ ranh xã (DiaPhan_Xa_2025) và nét đường (D-Duong chinh). Chạy lại khi thay file nguồn ở thư mục gốc.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const turf = require('@turf/turf');

const root = path.join(__dirname, '..');
const tmp = path.join(root, '.tmp-invest');
const SKIP_FOLDER = /DiaPhan_Xa_2025|D-Duong chinh/i;
const SKIP_DATA = new Set(['DwgLayerColor', 'gx_media_links', 'SHAPE_Length', 'SHAPE_Area', 'maXa_BNV', 'dienTich', 'nghiQuyet']);

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function unzip(file, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xf', file, '-C', dest], { cwd: root });
}

function readSheet(dir) {
  const ss = fs.readFileSync(path.join(dir, 'xl/sharedStrings.xml'), 'utf8');
  const strings = [];
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decode(x[1])).join(''));
  }
  const sheet = fs.readFileSync(path.join(dir, 'xl/worksheets/sheet1.xml'), 'utf8');
  const colIndex = (ref) => {
    let n = 0;
    for (const ch of (ref.match(/^[A-Z]+/) || [''])[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const grid = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const cells = [];
    for (const c of r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = (c[1].match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      const t = (c[1].match(/\bt="([^"]+)"/) || [])[1];
      const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inline = [...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decode(x[1])).join('');
      let val = t === 's' ? (strings[Number(v)] ?? '') : t === 'inlineStr' ? inline : (v || '');
      cells[colIndex(ref)] = String(val).replace(/\s+/g, ' ').trim();
    }
    return cells;
  });
  let header = null;
  const rows = [];
  for (const cells of grid) {
    if ((cells[0] || '') === 'STT' && /tên dự án/i.test(cells[2] || '')) {
      header = cells.map(h => h || '');
      continue;
    }
    if (!header) continue;
    const name = (cells[2] || '').trim();
    if (!name) continue;
    const row = {};
    header.forEach((h, i) => { if (h && cells[i]) row[h] = cells[i]; });
    if (row[header[2]]) rows.push(row);
  }
  return { headers: (header || []).filter(Boolean), rows };
}

function mapColumn(rows) {
  const keys = new Set();
  rows.forEach(row => Object.keys(row).forEach(k => keys.add(k)));
  return [...keys].find(k => /google|vị trí/i.test(k)) || '';
}

function keepMapPoints(rows) {
  const prevPath = path.join(root, 'public/data/invest-sheet.json');
  const known = {};
  if (fs.existsSync(prevPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      const key = mapColumn(prev.rows || []);
      (prev.rows || []).forEach(row => { if (key && row[key] && row._map) known[row[key]] = row._map; });
    } catch { /* dựng lại từ link */ }
  }
  const key = mapColumn(rows);
  if (!key) return;
  rows.forEach(row => { if (row[key] && known[row[key]]) row._map = known[row[key]]; });
}

function parseRing(text) {
  const ring = [];
  String(text || '').trim().split(/\s+/).forEach(tok => {
    const [lng, lat] = tok.split(',');
    const x = Number(lng);
    const y = Number(lat);
    if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
  });
  if (ring.length >= 4 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  return ring.length >= 4 ? ring : null;
}

function polygonsOf(block) {
  const polys = [];
  for (const poly of block.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)) {
    const outer = parseRing((poly[1].match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/) || [])[1]);
    if (!outer) continue;
    const holes = [...poly[1].matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)]
      .map(h => parseRing(h[1])).filter(Boolean);
    polys.push([outer, ...holes]);
  }
  if (!polys.length) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}

function kmlFields(block) {
  const out = {};
  for (const d of block.matchAll(/<Data name="([^"]+)">[\s\S]*?<value>([\s\S]*?)<\/value>/g)) {
    const key = decode(d[1]).trim();
    const val = decode(d[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key || !val || SKIP_DATA.has(key)) continue;
    out[key] = val;
  }
  return out;
}

function roundGeom(g) {
  const round = (c) => (typeof c[0] === 'number'
    ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]
    : c.map(round));
  return { type: g.type, coordinates: round(g.coordinates) };
}

function readBoundary(kmlPath) {
  const kml = fs.readFileSync(kmlPath, 'utf8');
  const features = [];
  for (const fm of kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)) {
    const folder = decode((fm[1].match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').replace(/\s+/g, ' ').trim();
    if (SKIP_FOLDER.test(folder)) continue;
    for (const pm of fm[1].matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
      const geometry = polygonsOf(pm[1]);
      if (!geometry) continue;
      let name = decode((pm[1].match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').replace(/\s+/g, ' ').trim();
      if (/^kml_\d+$/i.test(name)) name = '';
      let geom = geometry;
      try {
        const simple = turf.simplify(turf.feature(geometry), { tolerance: 0.00003, highQuality: false });
        if (simple && simple.geometry) geom = simple.geometry;
      } catch { /* giữ nguyên vòng */ }
      features.push({
        type: 'Feature',
        geometry: roundGeom(geom),
        properties: { name, folder, kml: kmlFields(pm[1]) }
      });
    }
  }
  features.sort((a, b) => {
    let aa = 0;
    let bb = 0;
    try { aa = turf.area(a); } catch { aa = 0; }
    try { bb = turf.area(b); } catch { bb = 0; }
    return bb - aa;
  });
  return { type: 'FeatureCollection', features };
}

const xlsx = fs.readdirSync(root).find(f => f.endsWith('.xlsx') && !f.startsWith('~') && /đầu tư/i.test(f));
const kmz = fs.readdirSync(root).find(f => /\.kmz$/i.test(f) && /ranh/i.test(f));
if (!xlsx || !kmz) {
  console.error('Thiếu file danh sách .xlsx hoặc ranh .kmz ở thư mục gốc');
  process.exit(1);
}
unzip(xlsx, path.join(tmp, 'xlsx'));
unzip(kmz, path.join(tmp, 'kmz'));
const sheet = readSheet(path.join(tmp, 'xlsx'));
keepMapPoints(sheet.rows);
const boundary = readBoundary(path.join(tmp, 'kmz/doc.kml'));
const outDir = path.join(root, 'public/data');
fs.writeFileSync(path.join(outDir, 'invest-sheet.json'), JSON.stringify(sheet));
fs.writeFileSync(path.join(outDir, 'invest-boundary.geojson'), JSON.stringify(boundary));
const bSize = fs.statSync(path.join(outDir, 'invest-boundary.geojson')).size;
const sSize = fs.statSync(path.join(outDir, 'invest-sheet.json')).size;
console.log('rows', sheet.rows.length, 'polygons', boundary.features.length, 'sheet', sSize, 'boundary', bSize);
fs.rmSync(tmp, { recursive: true, force: true });
