// Đăng ký 9 đồ án QHCT đã tải trong qhct-out.
//   node scripts/register-qhct.js --survey "<thư mục qhct-out>"
//   node scripts/register-qhct.js --schemes "<thư mục>"
//   node scripts/register-qhct.js --lots "<thư mục>"
// Không in hình. --schemes đọc projects/index.json một lần để tìm đồ án cha.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const turf = require('@turf/turf');
const { classifySector, statusOf } = require('./build-chuyen-nganh');
const { projectSlug, splitProjectName } = require('../services/projectStore');

const NAMES = [
  { mapid: 20642, name: 'QHCT TĐC Phú Mỹ (Khu C)', scale: 1000 },
  { mapid: 20644, name: 'QHCT TĐC Thủy Vân giai đoạn 2 (Khu E)', scale: 500 },
  { mapid: 23967, name: 'QHCT Trồng rừng ngập mặn Rú Chá', scale: 500 },
  { mapid: 20601, name: 'QHCT Khu nhà ở An Đông', scale: 500 },
  { mapid: 24981, name: 'QHCT Khu dịch vụ bãi tắm Thuận An', scale: 500 },
  { mapid: 22861, name: 'QHCT Khu dân cư và tái định cư đường Tố Hữu', scale: 500 },
  { mapid: 23953, name: 'QHCT Nghĩa trang Nhân dân phía Nam', scale: 2000 },
  { mapid: 23946, name: 'QHCT Trạm trung chuyển điều áp Phú Bài', scale: 500 },
  { mapid: 23954, name: 'QHCT Khu đô thị sinh thái Thanh Thủy', scale: 500 }
];

const GCS = 'https://storage.googleapis.com/hue-infra-data-us/projects/index.json';

function argPath(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return '';
  return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
}

function lopDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^LOP-mapid\d+/i.test(d.name))
    .map((d) => path.join(root, d.name));
}

function mapidOf(name) {
  const m = String(name).match(/mapid(\d+)/i);
  return m ? Number(m[1]) : null;
}

function isoDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!md) return '';
  return `${md[3]}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
}

function cleanNo(v) {
  return String(v || '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
}

function prop(p, key) {
  if (!p) return '';
  if (p[key] != null && String(p[key]).trim()) return p[key];
  const hit = Object.keys(p).find((k) => k.replace(/[^a-z0-9]/gi, '').toLowerCase().startsWith(key.slice(0, 10).toLowerCase())
    || k.toLowerCase() === key.toLowerCase());
  return hit ? p[hit] : '';
}

function decisionOf(props) {
  return {
    taskDecision: cleanNo(prop(props, 'soquyetdinhpheduyetnhiemvu')),
    taskDecisionDate: isoDate(prop(props, 'ngayquyetdinhpheduyetnhiemvu')),
    decision: cleanNo(prop(props, 'soquyetdinhpheduyetquyhoach')),
    decisionDate: isoDate(prop(props, 'ngayquyetdinhpheduyetquyhoach')),
    authority: cleanNo(prop(props, 'coquanquyetdinh')),
    loai: cleanNo(prop(props, 'loaiquyhoach')),
    tendoan: cleanNo(prop(props, 'tendoan')),
    tyle: cleanNo(prop(props, 'tyle'))
  };
}

function readFeatures(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(doc.features) ? doc.features : [];
}

function ranhFiles(lop) {
  const out = [];
  for (const dirName of fs.readdirSync(lop)) {
    const dir = path.join(lop, dirName);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (statusOf(dirName) == null && !/ranh/i.test(dirName)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.geojson')) continue;
      if (!/vung|ranh gioi quy hoach_a|ranh gioi/i.test(file) && !/vùng|ranh/i.test(file)) continue;
      if (/hien trang/i.test(dirName) && /hien trang/i.test(file)) continue;
      out.push(path.join(dir, file));
    }
  }
  return out;
}

function survey(root) {
  const rows = [];
  const missed = [];
  for (const lop of lopDirs(root)) {
    const mapid = mapidOf(path.basename(lop));
    const cells = {};
    let decision = null;
    for (const dirName of fs.readdirSync(lop)) {
      const dir = path.join(lop, dirName);
      if (!fs.statSync(dir).isDirectory()) continue;
      const status = statusOf(dirName);
      if (!status) {
        if (!/khong nhom/i.test(dirName)) missed.push({ mapid, group: dirName, name: '(nhóm)' });
        continue;
      }
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.geojson')) continue;
        const name = file.replace(/\.geojson$/i, '');
        const sector = classifySector(name);
        if (!sector) missed.push({ mapid, group: dirName, name });
        else {
          const key = `${sector}|${status}`;
          if (!cells[key]) cells[key] = { n: 0, features: 0 };
          cells[key].n += 1;
          const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          cells[key].features += (doc.features || []).length;
        }
      }
    }
    for (const file of ranhFiles(lop)) {
      const features = readFeatures(file).filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type));
      const picked = features.map((f) => decisionOf(f.properties))
        .filter((d) => d.decision || d.taskDecision)
        .sort((a, b) => (b.decision ? 1 : 0) - (a.decision ? 1 : 0))[0];
      if (picked && (!decision || (picked.decision && !decision.decision))) decision = picked;
    }
    rows.push({ mapid, decision, cells });
  }
  console.log(JSON.stringify({ missed, rows }, null, 2));
}

function polygonFeatures(file) {
  return readFeatures(file).filter((f) => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
}

function featureArea(f) {
  try { return turf.area(f); } catch (err) { return 0; }
}

function combinePolygons(features) {
  const polys = features.filter((f) => featureArea(f) > 0);
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0].geometry;
  const coords = [];
  polys.forEach((f) => {
    if (f.geometry.type === 'Polygon') coords.push(f.geometry.coordinates);
    else f.geometry.coordinates.forEach((c) => coords.push(c));
  });
  return { type: 'MultiPolygon', coordinates: coords };
}

function centroidOf(geometry) {
  const c = turf.centroid(turf.feature(geometry));
  return c.geometry.coordinates;
}

function containsPoint(geometry, lng, lat) {
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), turf.feature(geometry));
  } catch (err) {
    return false;
  }
}

function levelOfName(name) {
  const s = String(name || '');
  if (/^\s*(QHC(?![A-Z])|quy hoạch chung(\s|$))/i.test(s)) return 'QHC';
  if (/^\s*(\d+[.)]?\s+)?(điều chỉnh\s+)?(cục bộ\s+)?(QHCT(?![A-Z])|quy hoạch chi tiết)/i.test(s) && !/1\s*\/\s*2\.?000\b/.test(s)) return 'QHCT';
  return 'QHPK';
}

async function parentsFor(root) {
  const res = await axios.get(`${GCS}?v=${Date.now()}`, { timeout: 60000, maxContentLength: Infinity, maxBodyLength: Infinity });
  if (res.status !== 200) throw new Error(`projects/index.json HTTP ${res.status}`);
  const projects = (res.data.projects || []).filter((p) => p && !p.deleted && p.boundary && p.tenQH);
  const out = {};
  for (const spec of NAMES) {
    const lop = lopDirs(root).find((d) => mapidOf(path.basename(d)) === spec.mapid);
    if (!lop) throw new Error(`Thiếu mapid ${spec.mapid}`);
    const files = ranhFiles(lop);
    const features = files.flatMap(polygonFeatures);
    const boundary = combinePolygons(features);
    if (!boundary) {
      out[spec.mapid] = { parent: null, parentName: '', note: 'không có ranh vùng' };
      continue;
    }
    const [lng, lat] = centroidOf(boundary);
    const hits = projects.filter((p) => containsPoint(p.boundary, lng, lat) && levelOfName(p.tenQH) !== 'QHCT');
    const ranked = hits.map((p) => ({
      slug: p.slug,
      tenQH: p.tenQH,
      level: levelOfName(p.tenQH),
      area: featureArea(turf.feature(p.boundary))
    })).sort((a, b) => {
      if (a.level !== b.level) return a.level === 'QHPK' ? -1 : 1;
      return a.area - b.area;
    });
    const qhpk = ranked.filter((h) => h.level === 'QHPK');
    const pick = (qhpk[0] || ranked[0] || null);
    out[spec.mapid] = {
      parent: pick ? pick.slug : null,
      parentName: pick ? pick.tenQH : '',
      parentLevel: pick ? pick.level : '',
      hits: ranked.length
    };
  }
  return out;
}

function schemeRow(spec, parent) {
  const slug = projectSlug(spec.name);
  const row = {
    slug,
    name: spec.name,
    level: 'QHCT',
    mapid: spec.mapid,
    scale: spec.scale,
    parent: parent && parent.parent ? parent.parent : null,
    overrides: parent && parent.parent ? [parent.parent] : [],
    overrideArea: 'ranh QHCT',
    priority: 3,
    gcs: 'lots',
    fresh: true
  };
  return row;
}

async function writeSchemes(root) {
  const repo = path.resolve(path.join(__dirname, '..'));
  const found = surveyDecisions(root);
  const parents = await parentsFor(root);
  const schemes = [];
  for (const spec of NAMES) {
    const row = schemeRow(spec, parents[spec.mapid]);
    const d = found[spec.mapid] || {};
    if (d.decision) { row.decision = d.decision; row.decisionDate = d.decisionDate || ''; }
    if (d.taskDecision) { row.taskDecision = d.taskDecision; row.taskDecisionDate = d.taskDecisionDate || ''; }
    if (d.authority) row.authority = d.authority;
    schemes.push(row);
  }
  const file = path.join(repo, 'scripts', 'qhct-500-schemes.json');
  fs.writeFileSync(file, JSON.stringify(schemes, null, 2) + '\n');
  console.log(JSON.stringify({
    file,
    schemes: schemes.map((s) => ({
      mapid: s.mapid, slug: s.slug, name: s.name, parent: s.parent, decision: s.decision || '', task: s.taskDecision || ''
    })),
    parents: Object.fromEntries(Object.entries(parents).map(([id, p]) => [id, { parentName: p.parentName, level: p.parentLevel || '', hits: p.hits }]))
  }, null, 2));
}

function surveyDecisions(root) {
  const found = {};
  for (const lop of lopDirs(root)) {
    const mapid = mapidOf(path.basename(lop));
    let decision = null;
    for (const file of ranhFiles(lop)) {
      const features = polygonFeatures(file);
      const picked = features.map((f) => ({ d: decisionOf(f.properties), area: featureArea(f) }))
        .filter((x) => x.d.decision || x.d.taskDecision)
        .sort((a, b) => (b.d.decision ? 1 : 0) - (a.d.decision ? 1 : 0) || b.area - a.area)[0];
      if (picked && (!decision || (picked.d.decision && !decision.decision))) decision = picked.d;
    }
    found[mapid] = decision || {};
  }
  return found;
}

function landUseFiles(lop, status) {
  const out = [];
  for (const dirName of fs.readdirSync(lop)) {
    const dir = path.join(lop, dirName);
    if (!fs.statSync(dir).isDirectory() || statusOf(dirName) !== status) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.geojson')) continue;
      const name = file.replace(/\.geojson$/i, '');
      if (classifySector(name) !== 'sdd') continue;
      if (/ranh|chi gioi|moc gioi|dinh vi|hanh lang/i.test(name)) continue;
      out.push({ file: path.join(dir, file), name });
    }
  }
  return out;
}

function lotLayer(props, fallback) {
  const text = String(prop(props, 'chucnangsudungdat') || prop(props, 'loaidat') || prop(props, 'tendoituong') || fallback || '').trim();
  return text.slice(0, 120);
}

function lotArea(feature) {
  const a = featureArea(feature);
  return a > 0 ? Math.round(a * 10) / 10 : null;
}

function parcelsFrom(files, phase) {
  const parcels = [];
  let n = 0;
  files.forEach(({ file, name }) => {
    polygonFeatures(file).forEach((f) => {
      const area = lotArea(f);
      if (!(area > 0)) return;
      n += 1;
      const layer = lotLayer(f.properties, name);
      parcels.push({
        kind: 'DXF',
        id: `DXF-${n < 1000 ? String(n).padStart(3, '0') : String(n)}`,
        phase,
        layer,
        name: layer,
        area,
        geometry: f.geometry
      });
    });
  });
  return parcels;
}

function bboxOf(geometry) {
  const b = turf.bbox(turf.feature(geometry));
  return b.map((n) => Math.round(n * 1e6) / 1e6);
}

function loadGee(repo) {
  if (process.env.GEE_PRIVATE_KEY) return;
  const text = fs.readFileSync(path.join(repo, '.env.local'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('GEE_PRIVATE_KEY='));
  if (!line) throw new Error('Thiếu GEE_PRIVATE_KEY');
  let v = line.slice('GEE_PRIVATE_KEY='.length).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\"/g, '"');
  }
  process.env.GEE_PRIVATE_KEY = v;
}

async function writeLots(root) {
  const repo = path.resolve(path.join(__dirname, '..'));
  const schemeFile = path.join(repo, 'scripts', 'qhct-500-schemes.json');
  const schemes = JSON.parse(fs.readFileSync(schemeFile, 'utf8'));
  loadGee(repo);
  const gcs = require('../services/gcsWrite');
  const cur = await gcs.readJson('projects/index.json');
  if (!cur || !cur.data || !Array.isArray(cur.data.projects)) throw new Error('Không đọc được projects/index.json');
  const projects = cur.data.projects;
  const savedAt = Date.now();
  const summary = [];
  for (const scheme of schemes) {
    const lop = lopDirs(root).find((d) => mapidOf(path.basename(d)) === scheme.mapid);
    if (!lop) throw new Error(`Thiếu mapid ${scheme.mapid}`);
    const qh = parcelsFrom(landUseFiles(lop, 'quy-hoach'), 'QH');
    const ht = parcelsFrom(landUseFiles(lop, 'hien-trang'), 'HT');
    const ranh = ranhFiles(lop).flatMap(polygonFeatures);
    const boundary = combinePolygons(ranh);
    if (!boundary) throw new Error(`${scheme.name}: không có ranh`);
    const pair = await splitProjectName(scheme.name);
    const slug = scheme.slug;
    const qhDoc = { v: 2, role: 'su-dung-dat', tenQH: scheme.name, slug, saved: savedAt, parcels: qh };
    const htDoc = { v: 2, role: 'hien-trang', tenQH: scheme.name, slug, saved: savedAt, parcels: ht };
    const boundDoc = { v: 2, role: 'ranh-gioi', tenQH: scheme.name, slug, saved: savedAt, boundary, boundarySource: 'gis' };
    await gcs.putJson(`projects/${slug}/su-dung-dat.json`, JSON.stringify(qhDoc));
    await gcs.putJson(`projects/${slug}/hien-trang.json`, JSON.stringify(htDoc));
    await gcs.putJson(`projects/${slug}/ranh-gioi.json`, JSON.stringify(boundDoc));
    const bbox = bboxOf(boundary);
    const entry = {
      tenQH: scheme.name,
      slug,
      tenDayDu: pair.tenDayDu,
      tenRutGon: pair.tenRutGon,
      dir: true,
      file: scheme.name,
      wards: [],
      infra: 0,
      lands: qh.length + ht.length,
      time: scheme.decisionDate || '',
      boundary,
      boundarySource: 'gis',
      bbox,
      landArea: {},
      legacy: false,
      sheetOnly: false,
      saved: savedAt
    };
    const i = projects.findIndex((p) => p && (p.slug === slug || p.tenQH === scheme.name));
    if (i >= 0) projects[i] = { ...projects[i], ...entry, deleted: false };
    else projects.push(entry);
    summary.push({ mapid: scheme.mapid, slug, qh: qh.length, ht: ht.length });
    console.log(JSON.stringify(summary[summary.length - 1]));
  }
  const next = { ...cur.data, v: 1, saved: savedAt, projects };
  await gcs.putJson('projects/index.json', JSON.stringify(next), cur.generation);
  try {
    await gcs.patchCacheControl('projects/index.json', 'public, max-age=3600');
  } catch (err) {
    console.warn('Cache-Control projects/index.json:', err.message);
  }
  console.log(JSON.stringify({ gcs: 'projects', summary }));
}

async function main() {
  const root = argPath('--survey') || argPath('--schemes') || argPath('--lots');
  if (!root) {
    console.error('Thiếu thư mục qhct-out');
    process.exit(1);
  }
  if (process.argv.includes('--survey')) survey(path.resolve(root));
  else if (process.argv.includes('--schemes')) await writeSchemes(path.resolve(root));
  else if (process.argv.includes('--lots')) await writeLots(path.resolve(root));
  else {
    console.error('Chọn --survey, --schemes hoặc --lots');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
