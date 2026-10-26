// Đăng ký 4 QHC xã vào catalog Quy hoạch QHC 1/10.000.
// Ranh và lô trỏ GeoJSON đã có. Không tải lại gisHue, không nhân bản file lô.
//   node scripts/register-qhc-xa.mjs
//   node scripts/register-qhc-xa.mjs --gcs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitProjectName } from '../public/js/projectNames.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUGS = [
  'qhc-xa-thuong-long-3f2c4da4',
  'qhc-xa-huong-huu-cb7f4149',
  'qhc-xa-huong-loc-1487608f',
  'qhc-xa-thuong-nhat-550f030f'
];
const WARD = {
  'long-quang': 'Xã Long Quảng',
  'nam-dong': 'Xã Nam Đông'
};

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
}

function writeJson(rel, doc) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function bboxOf(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
      return;
    }
    c.forEach(walk);
  };
  walk(geometry && geometry.coordinates);
  if (!Number.isFinite(b[0])) return null;
  return b.map(n => Math.round(n * 1e6) / 1e6);
}

function boundaryOf(file) {
  const abs = file.startsWith('data/') ? path.join(root, 'public', file) : file;
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  const feature = (doc.features || []).find(f => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  if (!feature) throw new Error(`Không có ranh vùng: ${file}`);
  return feature.geometry;
}

function landFile(layers, status, nameRe) {
  return layers.find(l => l
    && l.sector === 'sdd'
    && (l.status === status || l.role === status)
    && (l.geomType === 'Polygon' || l.geomType === 'MultiPolygon')
    && nameRe.test(fold(l.name)));
}

function retargetSchemes(doc) {
  let n = 0;
  (doc.schemes || []).forEach(row => {
    if (!row || !SLUGS.includes(row.slug)) return;
    row.scale = 10000;
    row.sourceScale = 25000;
    row.homeLevel = 'QHC10';
    n += 1;
  });
  if (n !== SLUGS.length) throw new Error(`schemes.json thiếu đồ án (${n}/${SLUGS.length})`);
  return doc;
}

function retargetLayers(doc) {
  let n = 0;
  (doc.layers || []).forEach(layer => {
    if (!layer || !SLUGS.includes(layer.scheme)) return;
    if (Number(layer.scale) === 25000) layer.scale = 10000;
    n += 1;
  });
  if (!n) throw new Error('index.json không có lớp QHC xã');
  return { doc, n };
}

function catalogEntry(scheme, layers) {
  const ht = landFile(layers, 'hien-trang', /hien trang su dung dat/);
  const qh = landFile(layers, 'quy-hoach', /chuc nang su dung dat/);
  const ranh = landFile(layers, 'quy-hoach', /ranh gioi quy hoach/);
  if (!ht || !qh || !ranh) throw new Error(`${scheme.slug}: thiếu lớp đất hoặc ranh`);
  if (String(ranh.file).startsWith('http')) throw new Error(`${scheme.slug}: ranh không nằm trong repo`);
  const boundary = boundaryOf(ranh.file);
  const names = splitProjectName(scheme.name);
  const ward = WARD[scheme.area && scheme.area.code] || '';
  return {
    tenQH: scheme.name,
    slug: scheme.slug,
    tenDayDu: names.tenDayDu,
    tenRutGon: names.tenRutGon,
    dir: false,
    file: scheme.name,
    wards: ward ? [ward] : [],
    infra: 0,
    lands: Number(ht.featureCount) + Number(qh.featureCount),
    time: '',
    boundary,
    boundarySource: 'gis',
    bbox: bboxOf(boundary),
    landArea: {},
    legacy: false,
    sheetOnly: false,
    linked: true,
    linkedLots: {
      'hien-trang': ht.file,
      'su-dung-dat': qh.file
    },
    mapid: scheme.mapid,
    saved: 1
  };
}

function buildCatalog(schemesDoc, indexDoc) {
  const projects = SLUGS.map(slug => {
    const scheme = schemesDoc.schemes.find(s => s.slug === slug);
    const layers = indexDoc.layers.filter(l => l.scheme === slug);
    return catalogEntry(scheme, layers);
  });
  return {
    v: 1,
    note: 'Bốn QHC xã là đồ án gốc ở Quy hoạch → QHC 1/10.000. Lô trỏ GeoJSON đã có, không copy sang projects/. Tờ bản vẽ gisHue ghi 1/25.000 (sourceScale); catalog đồ án theo cấp QHC 1/10.000.',
    projects
  };
}

function loadGeeKey() {
  if (process.env.GEE_PRIVATE_KEY) return;
  const file = path.join(root, '.env.local');
  const text = readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find(l => l.startsWith('GEE_PRIVATE_KEY='));
  if (!line) throw new Error('Thiếu GEE_PRIVATE_KEY');
  let v = line.slice('GEE_PRIVATE_KEY='.length).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\"/g, '"');
  }
  process.env.GEE_PRIVATE_KEY = v;
}

async function pushGcs(catalog) {
  loadGeeKey();
  const mod = await import('../services/gcsWrite.js');
  const gcs = mod.default || mod;
  const cur = await gcs.readJson('projects/index.json');
  if (!cur || !cur.data || !Array.isArray(cur.data.projects)) throw new Error('Không đọc được projects/index.json');
  const projects = cur.data.projects;
  const before = projects.length;
  const touched = [];
  for (const row of catalog.projects) {
    const entry = { ...row };
    delete entry.mapid;
    const i = projects.findIndex(p => p && (p.slug === row.slug || p.tenQH === row.tenQH));
    if (i >= 0) {
      const prev = projects[i];
      if (prev.dir && Number(prev.lands) > 0 && !prev.linked) {
        touched.push({ slug: row.slug, skip: 'dir' });
        continue;
      }
      projects[i] = { ...prev, ...entry, deleted: false };
      touched.push({ slug: row.slug, op: 'update' });
    } else {
      projects.push(entry);
      touched.push({ slug: row.slug, op: 'add' });
    }
  }
  const next = { ...cur.data, v: 1, saved: Date.now(), projects };
  await gcs.putJson('projects/index.json', JSON.stringify(next), cur.generation);
  try {
    await gcs.patchCacheControl('projects/index.json', 'public, max-age=3600');
  } catch (err) {
    console.warn('Cache-Control projects/index.json:', err.message);
  }
  console.log(JSON.stringify({ gcs: 'projects/index.json', before, after: projects.length, touched }));
}

async function main() {
  const schemes = retargetSchemes(readJson('public/data/chuyen-nganh/schemes.json'));
  const { doc: index, n } = retargetLayers(readJson('public/data/chuyen-nganh/index.json'));
  const catalog = buildCatalog(schemes, index);
  writeJson('public/data/chuyen-nganh/schemes.json', schemes);
  writeJson('public/data/chuyen-nganh/index.json', index);
  writeJson('public/data/qhc-xa/catalog.json', catalog);
  const summary = catalog.projects.map(p => ({
    slug: p.slug,
    name: p.tenQH,
    wards: p.wards,
    lands: p.lands,
    ht: p.linkedLots['hien-trang'],
    qh: p.linkedLots['su-dung-dat'],
    bbox: p.bbox
  }));
  console.log(JSON.stringify({ layers: n, projects: summary }, null, 2));
  if (process.argv.includes('--gcs')) await pushGcs(catalog);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
