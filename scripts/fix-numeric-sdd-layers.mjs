// Sửa hàng loạt projects/*/su-dung-dat.json: layer đang là loaidat số → nhãn chức năng.
// Không simplify geom (QHPK/QHCT). Nguồn: .cache/gishue/<mapid>/*chucnang*|sudungdat*.json
//   node scripts/fix-numeric-sdd-layers.mjs [--upload] [--mapid 22870 ...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import { landPatternKey, TT16_STYLES } from '../public/js/tt16Symbols.js';

const require = createRequire(import.meta.url);
const { parseWkt } = require('./gserver-to-shp.js');
const { loadGeeKey } = require('./build-chuyen-nganh.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = path.join(repo, '.cache', 'gishue');
const OUT_ROOT = path.join(CACHE_ROOT, 'out');
const INDEX = path.join(repo, 'public', 'data', 'su-dung-dat-index.json');
const NUM = /^\d+(\.\d+)?$/;

/** 20 đồ án quét bị đen (layer thuần số). */
const DEFAULT_MAPIDS = [
  20635, 20606, 23929, 22870, 22871, 22864, 22877, 22898, 20607, 20680,
  23932, 23938, 23931, 19550, 20605, 20766, 23922, 19168, 22875, 23927
];

function text(v) {
  return String(v ?? '').trim();
}

function num(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function argMapids(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mapid' && argv[i + 1]) {
      out.push(Number(argv[++i]));
    }
  }
  return out.filter((n) => Number.isFinite(n));
}

function targetsFromIndex(mapids) {
  const want = new Set(mapids);
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const hits = [];
  for (const layer of idx.layers || []) {
    if (!String(layer.path || '').includes('su-dung-dat')) continue;
    if (!want.has(layer.mapid)) continue;
    hits.push(layer);
  }
  const missing = [...want].filter((id) => !hits.some((h) => h.mapid === id));
  if (missing.length) throw new Error(`Thiếu trong su-dung-dat-index: ${missing.join(', ')}`);
  return hits;
}

function pickCacheFile(mapid) {
  const dir = path.join(CACHE_ROOT, String(mapid));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rank = (f) => {
    const s = f.toLowerCase();
    if (/diemchucnang|phankhuchucnang|hientrang/.test(s)) return 99;
    if (/chucnangsdd|chucnangsudungdat|chucnangsudungdat/.test(s)) return 0;
    if (/^hl_sudungdat\.json$/i.test(f) || /sudungdat/.test(s)) return 1;
    return 50;
  };
  const ranked = files
    .map((f) => ({ f, r: rank(f) }))
    .filter((x) => x.r < 50)
    .sort((a, b) => a.r - b.r || a.f.localeCompare(b.f));
  return ranked.length ? path.join(dir, ranked[0].f) : null;
}

/** Từ mọi cache: loaidat → nhãn phổ biến nhất (fallback khi hàng thiếu chucnang). */
function buildLoaiDict() {
  const map = new Map();
  if (!fs.existsSync(CACHE_ROOT)) return new Map();
  for (const id of fs.readdirSync(CACHE_ROOT)) {
    const dir = path.join(CACHE_ROOT, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const s = f.toLowerCase();
      if (!/chucnang|sudungdat|sdd/.test(s)) continue;
      if (/diemchucnang|phankhu/.test(s)) continue;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      for (const row of doc.rows || []) {
        const loai = text(row.loaidat);
        const chu = text(row.chucnangsudungdat) || text(row.chucnangsu);
        if (!loai || !NUM.test(loai) || !chu) continue;
        if (!map.has(loai)) map.set(loai, new Map());
        const m = map.get(loai);
        m.set(chu, (m.get(chu) || 0) + 1);
      }
    }
  }
  const out = new Map();
  for (const [loai, counts] of map) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) out.set(loai, top[0]);
  }
  return out;
}

function looksLikeLandNote(s) {
  if (!s || NUM.test(s)) return false;
  return /đất|dat |nhóm nhà|cay xanh|cây xanh|giao thông|giao thong|mặt nước|mat nuoc|dịch vụ|dich vu/i.test(s)
    || (s.length >= 8 && /[A-Za-zÀ-ỹ]/.test(s));
}

function landLabel(row, loaiDict) {
  const chu = text(row.chucnangsudungdat) || text(row.chucnangsu) || text(row.tendoituong);
  if (chu && !NUM.test(chu)) return chu.slice(0, 120);
  const note = text(row.ghichu);
  if (looksLikeLandNote(note)) return note.slice(0, 120);
  const loai = text(row.loaidat);
  if (loai && !NUM.test(loai)) return loai.slice(0, 120);
  if (loai && loaiDict.has(loai)) return String(loaiDict.get(loai)).slice(0, 120);
  const ky = text(row.kyhieuoquyhoach) || text(row.kyhieulodat);
  if (ky) {
    const pref = ky.replace(/\s+/g, '').slice(0, 2).toUpperCase();
    const fromKy = {
      OB: 'Đất ở biệt thự',
      OL: 'Đất ở liền kề',
      OC: 'Đất ở chung cư',
      OH: 'Đất ở hỗn hợp',
      CQ: 'Đất cơ quan',
      CC: 'Đất công cộng',
      SN: 'Đất sân bãi',
      TN: 'Đất thể thao',
      TG: 'Đất tôn giáo',
      GT: 'Đất giao thông',
      CX: 'Đất cây xanh',
      DV: 'Đất dịch vụ'
    }[pref];
    if (fromKy) return fromKy;
  }
  return loai ? `Loại đất ${loai}` : 'Khác';
}

function planOf(row) {
  const floors = text(row.tangcao) || text(row.tangcaomax);
  const coverage = text(row.matdoxaydung) || text(row.matdoxaydungmax);
  const far = text(row.hesosudungdat) || text(row.hesosudung);
  const plan = {};
  if (floors && floors !== '0') plan.floors = floors;
  if (coverage && coverage !== '0') plan.coverage = coverage;
  if (far && far !== '0') plan.far = far;
  return Object.keys(plan).length ? plan : null;
}

function toGeometry(parsed) {
  if (!parsed) return null;
  if (parsed.type === 'POLYGON') return { type: 'Polygon', coordinates: parsed.polygons[0] || [] };
  if (parsed.type === 'MULTIPOLYGON') return { type: 'MultiPolygon', coordinates: parsed.polygons };
  return null;
}

function closeRings(geometry) {
  if (!geometry) return null;
  const close = (ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const out = ring.map((p) => [Number(p[0]), Number(p[1])]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (out.length < 3) return null;
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([...a]);
    return out.length >= 4 ? out : null;
  };
  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates || []).map(close).filter(Boolean);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = (geometry.coordinates || [])
      .map((poly) => (poly || []).map(close).filter(Boolean))
      .filter((r) => r.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

function firstXy(geometry) {
  try {
    const c = geometry.type === 'Polygon'
      ? geometry.coordinates[0][0]
      : geometry.coordinates[0][0][0];
    return [Number(c[0]), Number(c[1])];
  } catch {
    return [NaN, NaN];
  }
}

function isWgs84(geometry) {
  const [x, y] = firstXy(geometry);
  return x > 100 && x < 120 && y > 8 && y < 25;
}

function areaOf(geometry, dientich) {
  const fromProp = num(dientich);
  if (fromProp != null && fromProp > 0) return Math.round(fromProp * 10) / 10;
  try {
    const a = turf.area(turf.feature(geometry));
    return a > 0 ? Math.round(a * 10) / 10 : null;
  } catch {
    return null;
  }
}

function codeOf(row) {
  return text(row.kyhieulodat) || text(row.kyhieuoquyhoach) || text(row.kyhieuloda) || '';
}

function buildParcels(doc, loaiDict) {
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const parcels = [];
  let skipped = 0;
  let nonWgs = 0;
  let numericLeft = 0;
  let mapped = 0;
  const layers = new Map();
  for (const row of rows) {
    const raw = text(row.geom) || text(row.s_geo);
    const geometry = closeRings(toGeometry(parseWkt(raw)));
    if (!geometry) {
      skipped += 1;
      continue;
    }
    if (!isWgs84(geometry)) {
      nonWgs += 1;
      skipped += 1;
      continue;
    }
    const layer = landLabel(row, loaiDict);
    if (NUM.test(layer) || /^Loại đất \d+/.test(layer)) numericLeft += 1;
    const key = landPatternKey(layer, '');
    if (key && TT16_STYLES[key]) mapped += 1;
    layers.set(layer, (layers.get(layer) || 0) + 1);
    const code = codeOf(row);
    const plan = planOf(row);
    const parcel = {
      kind: 'DXF',
      id: `QH-${parcels.length + 1}`,
      phase: 'QH',
      layer,
      area: areaOf(geometry, row.dientich),
      geometry
    };
    if (code) {
      parcel.lotCode = code.slice(0, 40);
      parcel.name = code.slice(0, 120);
    } else {
      parcel.name = layer;
    }
    if (plan) parcel.plan = plan;
    parcels.push(parcel);
  }
  return { parcels, skipped, nonWgs, numericLeft, mapped, layers };
}

function fixOne(target, loaiDict) {
  const cache = pickCacheFile(target.mapid);
  if (!cache) throw new Error(`Thiếu cache mapid ${target.mapid}`);
  const doc = JSON.parse(fs.readFileSync(cache, 'utf8'));
  const built = buildParcels(doc, loaiDict);
  const body = {
    v: 2,
    role: 'su-dung-dat',
    tenQH: target.name,
    slug: target.scheme,
    saved: Date.now(),
    parcels: built.parcels
  };
  const out = path.join(OUT_ROOT, String(target.mapid), 'su-dung-dat.fixed.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(body);
  fs.writeFileSync(out, json);
  const top = [...built.layers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${k}:${v}`).join(', ');
  const mapPct = built.parcels.length ? built.mapped / built.parcels.length : 0;
  console.log(
    `${target.mapid} | ${target.scheme} | n=${built.parcels.length} skip=${built.skipped}`
    + ` nonWgs=${built.nonWgs} numLeft=${built.numericLeft} map=${(mapPct * 100).toFixed(0)}%`
    + ` | ${path.basename(cache)} | ${top}`
  );
  return {
    target,
    out,
    json,
    parcels: built.parcels.length,
    mapPct,
    numericLeft: built.numericLeft,
    gcsKey: target.path
  };
}

async function uploadAll(results) {
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  for (const r of results) {
    await gcs.putObject(r.gcsKey, Buffer.from(r.json), 'application/json', undefined, 180000);
    console.log(`GCS ${r.gcsKey} (${r.parcels} lô)`);
  }
  const got = await gcs.readJson('projects/index.json');
  const projects = (got && got.data && got.data.projects) || [];
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const now = Date.now();
  let bumped = 0;
  for (const r of results) {
    const entry = bySlug.get(r.target.scheme);
    if (!entry) {
      console.log(`! thiếu projects/index: ${r.target.scheme}`);
      continue;
    }
    entry.saved = now;
    entry.lands = r.parcels;
    bumped += 1;
  }
  await gcs.putObject(
    'projects/index.json',
    Buffer.from(JSON.stringify(got.data)),
    'application/json',
    got.generation,
    180000
  );
  console.log(`GCS projects/index.json bumped=${bumped}`);
}

async function main() {
  const upload = process.argv.includes('--upload');
  const mapids = argMapids(process.argv) ;
  const ids = mapids.length ? mapids : DEFAULT_MAPIDS;
  const targets = targetsFromIndex(ids);
  console.log(`targets ${targets.length}; loaiDict…`);
  const loaiDict = buildLoaiDict();
  console.log(`loaiDict ${loaiDict.size} mã`);
  const results = [];
  for (const t of targets) {
    results.push(fixOne(t, loaiDict));
  }
  const weak = results.filter((r) => r.mapPct < 0.2 || r.numericLeft > r.parcels * 0.2);
  if (weak.length) {
    console.log('! còn yếu (map<20% hoặc numLeft>20%):');
    for (const r of weak) {
      console.log(`  ${r.target.mapid} map=${(r.mapPct * 100).toFixed(0)}% numLeft=${r.numericLeft}`);
    }
  }
  if (!upload) {
    console.log('Chạy lại với --upload để ghi GCS');
    return;
  }
  await uploadAll(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
