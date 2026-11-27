// Vá lotCode hàng loạt cho projects/*/su-dung-dat.json (thiếu kyhieulodat lúc nhập cũ).
// 1) Tách mã từ name (NC.A-05, CXCD.01…). 2) Khớp cache gisHue theo tâm hình học.
//   node scripts/fix-lot-codes.mjs [--upload] [--mapid 22872 ...] [--slug qhpk-tt-phia-nam-0f29aa49]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import { lotSymbol } from '../public/js/lotPopup.js';

const require = createRequire(import.meta.url);
const { parseWkt } = require('./gserver-to-shp.js');
const { loadGeeKey } = require('./build-chuyen-nganh.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = path.join(repo, '.cache', 'gishue');
const OUT_ROOT = path.join(CACHE_ROOT, 'out');
const INDEX = path.join(repo, 'public', 'data', 'su-dung-dat-index.json');
const GCS_BASE = 'https://storage.googleapis.com/hue-infra-data-us/';
const MATCH_M = 25;

function text(v) {
  return String(v ?? '').trim();
}

function argList(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]);
  }
  return out;
}

function targetsFromIndex({ mapids, slugs }) {
  const wantMap = mapids.length ? new Set(mapids.map(Number)) : null;
  const wantSlug = slugs.length ? new Set(slugs) : null;
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const hits = [];
  for (const layer of idx.layers || []) {
    const p = String(layer.path || '');
    if (!p.startsWith('projects/') || !p.endsWith('su-dung-dat.json')) continue;
    if (wantMap && !wantMap.has(Number(layer.mapid))) continue;
    if (wantSlug && !wantSlug.has(layer.scheme)) continue;
    hits.push(layer);
  }
  return hits;
}

function pickCacheFile(mapid) {
  if (mapid == null || !Number.isFinite(Number(mapid))) return null;
  const dir = path.join(CACHE_ROOT, String(mapid));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rank = (f) => {
    const s = f.toLowerCase();
    if (/diemchucnang|phankhuchucnang|hientrang/.test(s)) return 99;
    if (/chucnangsdd|chucnangsudungdat/.test(s)) return 0;
    if (/sudungdat/.test(s)) return 1;
    return 50;
  };
  const ranked = files
    .map((f) => ({ f, r: rank(f) }))
    .filter((x) => x.r < 50)
    .sort((a, b) => a.r - b.r || a.f.localeCompare(b.f));
  return ranked.length ? path.join(dir, ranked[0].f) : null;
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

function centroidOf(geometry) {
  try {
    const c = turf.centroid(turf.feature(geometry)).geometry.coordinates;
    return [Number(c[0]), Number(c[1])];
  } catch {
    return null;
  }
}

function distM(a, b) {
  if (!a || !b) return Infinity;
  try {
    return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
  } catch {
    return Infinity;
  }
}

function codeOf(row) {
  return text(row.kyhieulodat) || text(row.kyhieuoquyhoach) || text(row.kyhieuloda) || '';
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

function loadSourceRows(mapid) {
  const file = pickCacheFile(mapid);
  if (!file) return { file: null, rows: [] };
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  for (const row of doc.rows || []) {
    const code = codeOf(row);
    const plan = planOf(row);
    if (!code && !plan) continue;
    const geometry = closeRings(toGeometry(parseWkt(text(row.geom) || text(row.s_geo))));
    if (!geometry) continue;
    const xy = centroidOf(geometry);
    if (!xy) continue;
    rows.push({
      code: code ? code.slice(0, 40) : '',
      plan,
      xy,
      id: text(row.madoituong)
    });
  }
  return { file, rows };
}

function parcelNeedsCode(p) {
  if (!p || !p.geometry) return false;
  if (text(p.lotCode)) return false;
  return true;
}

/** Bỏ mã giả từ id nội bộ (DXF-303, QH-185, CV-051) lẫn trong name. */
function looksInternalId(code, parcel) {
  const c = String(code || '').toUpperCase();
  const id = String(parcel?.id || '').toUpperCase();
  if (!c) return true;
  if (id && (c === id || id.endsWith(`-${c}`) || id.startsWith(`${c}-`))) return true;
  if (/^(DXF|QH|HT|INFRA|CV|VH|TH|MN|YT|BDX|TM|NT|PCCC|BUS)[-_]?\d+$/i.test(c)) return true;
  return false;
}

function applyNameCodes(parcels) {
  let n = 0;
  for (const p of parcels) {
    if (!parcelNeedsCode(p)) continue;
    const code = lotSymbol(p.name || '', '');
    if (!code || looksInternalId(code, p)) continue;
    p.lotCode = code.slice(0, 40);
    if (!text(p.name) || text(p.name) === text(p.layer)) p.name = code.slice(0, 120);
    n += 1;
  }
  return n;
}

function needsPlan(p) {
  const plan = p && p.plan;
  return !(plan && (plan.floors || plan.coverage || plan.far));
}

function applyCacheAttrs(parcels, sourceRows) {
  if (!sourceRows.length) return { codes: 0, plans: 0 };
  const open = parcels
    .map((p, i) => ({
      p,
      i,
      xy: p && p.geometry ? centroidOf(p.geometry) : null,
      needCode: parcelNeedsCode(p),
      needPlan: needsPlan(p)
    }))
    .filter((x) => x.xy && (x.needCode || x.needPlan));
  if (!open.length) return { codes: 0, plans: 0 };

  const pairs = [];
  for (const src of sourceRows) {
    if (!src.code && !src.plan) continue;
    let best = null;
    for (const slot of open) {
      if (src.code && !slot.needCode && !(src.plan && slot.needPlan)) continue;
      if (!src.code && !(src.plan && slot.needPlan)) continue;
      const d = distM(src.xy, slot.xy);
      if (d > MATCH_M) continue;
      if (!best || d < best.d) best = { slot, d, src };
    }
    if (best) pairs.push(best);
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedParcel = new Set();
  const usedCode = new Set();
  let codes = 0;
  let plans = 0;
  for (const hit of pairs) {
    const key = hit.slot.i;
    if (usedParcel.has(key)) continue;
    const code = hit.src.code;
    if (code && usedCode.has(code) && hit.slot.needCode) continue;
    const p = hit.slot.p;
    let changed = false;
    if (hit.slot.needCode && code && !looksInternalId(code, p)) {
      p.lotCode = code;
      if (!text(p.name) || text(p.name) === text(p.layer)) p.name = code;
      usedCode.add(code);
      codes += 1;
      changed = true;
    }
    if (hit.slot.needPlan && hit.src.plan) {
      p.plan = { ...(p.plan || {}), ...hit.src.plan };
      plans += 1;
      changed = true;
    }
    if (changed) usedParcel.add(key);
  }
  return { codes, plans };
}

async function fetchDoc(gcsPath) {
  const r = await fetch(GCS_BASE + gcsPath);
  if (!r.ok) throw new Error(`GET ${gcsPath} → ${r.status}`);
  return r.json();
}

async function fixOne(target) {
  const doc = await fetchDoc(target.path);
  const parcels = Array.isArray(doc.parcels) ? doc.parcels : [];
  const before = parcels.filter((p) => text(p.lotCode)).length;
  const beforePlan = parcels.filter((p) => !needsPlan(p)).length;
  const fromName = applyNameCodes(parcels);
  const src = loadSourceRows(target.mapid);
  const fromCache = applyCacheAttrs(parcels, src.rows);
  const after = parcels.filter((p) => text(p.lotCode)).length;
  const afterPlan = parcels.filter((p) => !needsPlan(p)).length;
  const changed = fromName + fromCache.codes + fromCache.plans;
  const body = {
    ...doc,
    v: doc.v || 2,
    role: doc.role || 'su-dung-dat',
    tenQH: doc.tenQH || target.name,
    slug: doc.slug || target.scheme,
    saved: changed ? Date.now() : (doc.saved || Date.now()),
    parcels
  };
  const out = path.join(OUT_ROOT, String(target.mapid || target.scheme), 'su-dung-dat.lotcode.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(body);
  fs.writeFileSync(out, json);
  console.log(
    `${target.mapid || '—'} | ${target.scheme} | n=${parcels.length}`
    + ` code ${before}→${after} (+name ${fromName}, +cache ${fromCache.codes})`
    + ` plan ${beforePlan}→${afterPlan} (+${fromCache.plans})`
    + ` | cache=${src.file ? path.basename(src.file) : '—'}`
  );
  return {
    target,
    out,
    json,
    parcels: parcels.length,
    before,
    after,
    changed,
    gcsKey: target.path
  };
}

async function uploadAll(results) {
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  const touched = results.filter((r) => r.changed > 0);
  for (const r of touched) {
    await gcs.putObject(r.gcsKey, Buffer.from(r.json), 'application/json', undefined, 180000);
    console.log(`GCS ${r.gcsKey} (code ${r.before}→${r.after})`);
  }
  if (!touched.length) {
    console.log('Không có file đổi — bỏ qua projects/index.json');
    return;
  }
  const got = await gcs.readJson('projects/index.json');
  const projects = (got && got.data && got.data.projects) || [];
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const now = Date.now();
  let bumped = 0;
  for (const r of touched) {
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
  const mapids = argList(process.argv, '--mapid').map(Number).filter(Number.isFinite);
  const slugs = argList(process.argv, '--slug');
  const targets = targetsFromIndex({ mapids, slugs });
  if (!targets.length) throw new Error('Không có đồ án nào khớp');
  console.log(`targets ${targets.length}`);
  const results = [];
  for (const t of targets) {
    results.push(await fixOne(t));
  }
  const gained = results.reduce((s, r) => s + Math.max(0, r.after - r.before), 0);
  const touched = results.filter((r) => r.changed > 0).length;
  console.log(`xong: ${touched}/${results.length} đồ án đổi, +${gained} lotCode`);
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
