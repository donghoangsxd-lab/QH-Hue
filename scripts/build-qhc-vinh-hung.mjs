// Gói tĩnh QHC Đô thị mới Vinh Hưng (mapid 22906): SDD + GT + slim mạng QH chuyên ngành.
// Chỉ dùng cho QHC ~1/10.000 (sai số hình học lớn được phép). Không áp simplify cho QHPK 1/2.000 / QHCT 1/500.
// Nguồn: data/chuyen-nganh/qhc-do-thi-moi-vinh-hung-8899f27b (+ cache HT nếu thiếu geojson).
//   node scripts/build-qhc-vinh-hung.mjs [--upload]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const require = createRequire(import.meta.url);
const { loadGeeKey } = require('./build-chuyen-nganh.js');
const { parseWkt } = require('./gserver-to-shp.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'qhc-do-thi-moi-vinh-hung-8899f27b';
const TEN = 'QHC Đô thị mới Vinh Hưng';
const MAPID = 22906;
const PREFIX_QH = 'VH';
const PREFIX_HT = 'VHHT';
const OUT = path.join(repo, 'public', 'data', 'qhc-vinh-hung');
const BASE = path.join(repo, 'data', 'chuyen-nganh', SLUG);
const SDD_QH = path.join(BASE, 'sdd', 'quy-hoach', 'chuc-nang-su-dung-dat.geojson');
const SDD_HT = path.join(BASE, 'sdd', 'hien-trang', 'hien-trang-su-dung-dat.geojson');
const CACHE_HT = path.join(repo, '.cache', 'gishue', String(MAPID), 'qhc_vinhhung_hientrangsudungdat.json');
const ROAD = path.join(BASE, 'giao-thong', 'quy-hoach', 'mang-luoi-giao-thong.geojson');
// ~vài mét — đủ QHC 1/10.000; không dùng TOL này cho QHPK/QHCT.
const TOL = 0.00002;
const SKIP_PROP = new Set(['geom', 's_geo', 'resultnumber', 's_xdaidien', 's_ydaidien', 'xdaidien', 'ydaidien']);

const NET_QH_GLOBS = [
  ['cap-dien', 'quy-hoach'],
  ['cap-nuoc', 'quy-hoach'],
  ['thoat-nuoc-thai', 'quy-hoach'],
  ['san-nen-thoat-mua', 'quy-hoach'],
  ['giao-thong', 'quy-hoach'],
  ['thong-tin-lien-lac', 'quy-hoach'],
  ['chat-thai-ran-nghia-trang', 'quy-hoach']
];

function readFc(file) {
  if (!fs.existsSync(file)) throw new Error(`Thiếu ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function text(v) {
  return String(v ?? '').trim();
}

function num(v, d = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(d) : 0;
}

function slim(geometry) {
  let g = geometry;
  if (!g) return null;
  if (g.type !== 'Point') {
    try { g = turf.simplify(turf.feature(g), { tolerance: TOL, highQuality: false }).geometry; } catch { /* giữ */ }
  }
  return turf.truncate(turf.feature(g), { precision: 5, coordinates: 2 }).geometry;
}

function slimProps(props) {
  const out = {};
  Object.entries(props || {}).forEach(([k, v]) => {
    if (SKIP_PROP.has(k)) return;
    if (v == null || v === '') return;
    out[k] = v;
  });
  return out;
}

function table() {
  const list = [];
  const at = new Map();
  return {
    list,
    idx(s) {
      const t = text(s);
      if (!t) return -1;
      if (!at.has(t)) { at.set(t, list.length); list.push(t); }
      return at.get(t);
    }
  };
}

function propsFromRow(row) {
  const out = {};
  Object.entries(row || {}).forEach(([k, v]) => {
    if (SKIP_PROP.has(k)) return;
    if (v == null || v === '') return;
    out[k] = v;
  });
  return out;
}

/** parseWkt → GeoJSON geometry (WGS84 đã có trong cache Vinh Hưng). */
function wktParsedToGeometry(parsed) {
  if (!parsed) return null;
  if (parsed.type === 'POINT' && parsed.xy) return { type: 'Point', coordinates: parsed.xy };
  if (parsed.type === 'LINESTRING' || parsed.type === 'MULTILINESTRING') {
    const parts = parsed.parts || [];
    if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
    return { type: 'MultiLineString', coordinates: parts };
  }
  if (parsed.type === 'POLYGON') {
    const rings = (parsed.polygons && parsed.polygons[0]) || [];
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (parsed.type === 'MULTIPOLYGON') {
    const polys = parsed.polygons || [];
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

/** Cache gishue (rows + WKT WGS84) → FeatureCollection; ghi ra disk nếu thiếu geojson. */
function ensureHtGeojson() {
  if (fs.existsSync(SDD_HT)) {
    const existing = readFc(SDD_HT);
    if ((existing.features || []).length) return existing;
  }
  if (!fs.existsSync(CACHE_HT)) throw new Error(`Thiếu HT SDD: ${SDD_HT} và ${CACHE_HT}`);
  const doc = JSON.parse(fs.readFileSync(CACHE_HT, 'utf8'));
  const features = [];
  for (const row of doc.rows || []) {
    const parsed = parseWkt(row.geom || row.s_geo || '');
    const geometry = wktParsedToGeometry(parsed);
    if (!geometry) continue;
    features.push({ type: 'Feature', properties: propsFromRow(row), geometry });
  }
  const fc = { type: 'FeatureCollection', features };
  fs.mkdirSync(path.dirname(SDD_HT), { recursive: true });
  fs.writeFileSync(SDD_HT, JSON.stringify(fc));
  console.log(`${path.relative(repo, SDD_HT)}: ${features.length} dt (từ cache)`);
  return fc;
}

function buildSdd(fc, phase = 'QH') {
  const labels = table();
  const features = [];
  const parcels = [];
  let n = 0;
  const prefix = phase === 'HT' ? PREFIX_HT : PREFIX_QH;
  for (const f of fc.features || []) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    const loai = text(p.loaidat);
    const label = text(p.chucnangsudungdat) || text(p.tendoituong)
      || (loai && !/^\d+(\.\d+)?$/.test(loai) ? loai : '') || 'Khác';
    const i = labels.idx(label);
    const a = num(p.dientich, 1);
    const t = Number(p.trangthai) === 1 ? 0 : 1;
    const g = slim(f.geometry);
    if (!g) continue;
    features.push({ type: 'Feature', properties: { i, t, a }, geometry: g });
    n += 1;
    parcels.push({
      kind: 'DXF',
      id: `${prefix}-${n}`,
      phase,
      layer: label,
      area: a || null,
      geometry: g
    });
  }
  return {
    compact: {
      type: 'FeatureCollection',
      labels: labels.list,
      stages: ['Trạng thái 1', 'Trạng thái 2'],
      features
    },
    parcels: {
      v: 2,
      role: phase === 'HT' ? 'hien-trang' : 'su-dung-dat',
      tenQH: TEN,
      slug: SLUG,
      saved: Date.now(),
      parcels
    }
  };
}

const ROAD_CODE = { 1: 'ct', 2: 'ql', 3: 'dt', 5: 'dothi', 6: 'kv' };

function lengthM(feature, row) {
  const n = Number(row.chieudai);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  try { return Math.round(turf.length(feature) * 1000); } catch { return 0; }
}

function buildRoads(roadFc) {
  const features = [];
  for (const f of roadFc.features || []) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    const c = ROAD_CODE[Number(p.caphangduongbo)] || 'kv';
    const props = { L: 'b', c };
    if (text(p.tenduong)) props.n = text(p.tenduong);
    if (text(p.kyhieumatcat)) props.s = text(p.kyhieumatcat).toUpperCase();
    const geometry = slim(f.geometry);
    const out = { type: 'Feature', properties: props, geometry };
    out.properties.l = lengthM(out, p);
    features.push(out);
  }
  return {
    compact: { type: 'FeatureCollection', scale: '5', features },
    full: {
      type: 'FeatureCollection',
      features: features.map((f) => ({
        type: 'Feature',
        properties: {
          ten: f.properties.n || '',
          loai: 'Đường bộ',
          capDuong: f.properties.c || '',
          loGioi: '',
          matCat: f.properties.s || ''
        },
        geometry: f.geometry
      }))
    }
  };
}

function slimFeatureCollection(fc) {
  const features = [];
  for (const f of fc.features || []) {
    if (!f.geometry) continue;
    const g = slim(f.geometry);
    if (!g) continue;
    features.push({ type: 'Feature', properties: slimProps(f.properties), geometry: g });
  }
  return { type: 'FeatureCollection', features };
}

function listGeojson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.geojson'))
    .map((name) => path.join(dir, name));
}

function writeJson(file, data) {
  const body = JSON.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const n = data.features ? data.features.length : (data.parcels || []).length;
  console.log(`${path.relative(repo, file)}: ${n} dt, ${(body.length / 1048576).toFixed(2)} MB`);
  return body;
}

function withRetry(fn, label, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); } catch (err) {
      last = err;
      const code = err && err.code;
      if (code !== 'UNKNOWN' && code !== 'EBUSY' && code !== 'EPERM') throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120 * (i + 1));
    }
  }
  throw new Error(`${label}: ${last && last.message ? last.message : last}`);
}

function slimNetLayers() {
  const updated = [];
  for (const [sector, status] of NET_QH_GLOBS) {
    const dir = path.join(BASE, sector, status);
    for (const file of listGeojson(dir)) {
      const before = withRetry(() => fs.statSync(file).size, file);
      const next = slimFeatureCollection(withRetry(() => readFc(file), file));
      const body = JSON.stringify(next);
      withRetry(() => fs.writeFileSync(file, body), file);
      updated.push({
        file: path.relative(repo, file).replace(/\\/g, '/'),
        n: next.features.length,
        before,
        after: body.length
      });
      console.log(`${path.relative(repo, file)}: ${next.features.length} dt, ${(before / 1024).toFixed(0)}→${(body.length / 1024).toFixed(0)} KB`);
    }
  }
  return updated;
}

function patchIndex(htCount, qhCount, netRows) {
  const indexFile = path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const byFile = new Map(netRows.map((row) => [row.file, row]));
  const qhPath = `projects/${SLUG}/su-dung-dat.json`;
  const htPath = `projects/${SLUG}/hien-trang.json`;
  const fold = (s) => String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
  (index.layers || []).forEach((layer) => {
    if (layer.scheme !== SLUG) return;
    const name = fold(layer.name);
    if (layer.status === 'hien-trang' && name.includes('hien trang') && name.includes('su dung')) {
      layer.file = htPath;
      layer.ref = htPath;
      layer.featureCount = htCount;
      return;
    }
    if (layer.status === 'quy-hoach' && name.includes('chuc nang') && name.includes('su dung')) {
      layer.file = qhPath;
      layer.ref = qhPath;
      layer.featureCount = qhCount;
      return;
    }
    const key = String(layer.file || '').replace(/^public\//, '');
    const hit = byFile.get(key) || byFile.get(layer.file);
    if (hit) layer.featureCount = hit.n;
  });
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
}

function patchSoTay(htCount, qhCount) {
  const file = path.join(repo, 'public', 'data', 'su-dung-dat-index.json');
  if (!fs.existsSync(file)) return;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = doc.entries || doc.layers || [];
  let touched = 0;
  for (const row of rows) {
    if (row.scheme !== SLUG && row.mapid !== MAPID) continue;
    if (row.layer === 'su-dung-dat' || row.role === 'quy-hoach') {
      row.path = `projects/${SLUG}/su-dung-dat.json`;
      row.lands = qhCount;
      row.source = 'projects';
      touched += 1;
    }
    if (row.layer === 'hien-trang' || row.role === 'hien-trang') {
      row.path = `projects/${SLUG}/hien-trang.json`;
      row.lands = htCount;
      row.source = 'projects';
      touched += 1;
    }
  }
  if (!rows.some((r) => r.scheme === SLUG && (r.layer === 'hien-trang' || r.role === 'hien-trang'))) {
    rows.push({
      scheme: SLUG,
      name: TEN,
      mapid: MAPID,
      layer: 'hien-trang',
      role: 'hien-trang',
      path: `projects/${SLUG}/hien-trang.json`,
      lands: htCount,
      source: 'projects'
    });
    touched += 1;
  }
  if (doc.entries) doc.entries = rows;
  else doc.layers = rows;
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`su-dung-dat-index: ${touched} dòng`);
}

async function patchProjectsIndex(htCount, qhCount) {
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  const cur = await gcs.readJson('projects/index.json');
  if (!cur?.data?.projects) throw new Error('Không đọc được projects/index.json');
  const list = cur.data.projects;
  const hit = list.find((p) => p.slug === SLUG || Number(p.mapid) === MAPID);
  if (!hit) {
    console.log('! projects/index: chưa có slug Vinh Hưng — bỏ qua lands');
    return;
  }
  hit.lands = qhCount;
  if (hit.hienTrangLands != null || hit.htLands != null) {
    hit.hienTrangLands = htCount;
    hit.htLands = htCount;
  }
  await gcs.putJson('projects/index.json', JSON.stringify(cur.data), cur.generation);
  console.log(`GCS projects/index.json: lands=${qhCount}`);
}

async function uploadProject(files) {
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  const base = `projects/${SLUG}`;
  for (const [name, body] of files) {
    await gcs.putObject(`${base}/${name}`, Buffer.from(body), 'application/json', undefined, 180000);
    console.log(`GCS ${base}/${name}`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const htFc = ensureHtGeojson();
  const sdd = buildSdd(readFc(SDD_QH), 'QH');
  const ht = buildSdd(htFc, 'HT');
  const roads = buildRoads(readFc(ROAD));

  writeJson(path.join(OUT, 'sdd.json'), sdd.compact);
  writeJson(path.join(OUT, 'hien-trang-sdd.json'), ht.compact);
  writeJson(path.join(OUT, 'giaothong.json'), roads.compact);
  const sddBody = writeJson(path.join(OUT, 'su-dung-dat.project.json'), sdd.parcels);
  const htBody = writeJson(path.join(OUT, 'hien-trang.project.json'), ht.parcels);
  const gtBody = writeJson(path.join(OUT, 'qh-giao-thong.project.json'), roads.full);

  writeJson(path.join(OUT, 'hien-trang-su-dung-dat.geojson'), slimFeatureCollection(htFc));
  writeJson(path.join(OUT, 'chuc-nang-su-dung-dat.geojson'), slimFeatureCollection(readFc(SDD_QH)));

  const netRows = slimNetLayers();
  patchIndex(ht.parcels.parcels.length, sdd.parcels.parcels.length, netRows);
  patchSoTay(ht.parcels.parcels.length, sdd.parcels.parcels.length);

  console.log(`tong: HT ${ht.parcels.parcels.length} · QH ${sdd.parcels.parcels.length} · GT ${roads.full.features.length}`);

  if (process.argv.includes('--upload')) {
    await uploadProject([
      ['su-dung-dat.json', sddBody],
      ['hien-trang.json', htBody],
      ['qh-giao-thong.json', gtBody]
    ]);
    try {
      await patchProjectsIndex(ht.parcels.parcels.length, sdd.parcels.parcels.length);
    } catch (err) {
      console.log(`! projects/index: ${err.message || err}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
