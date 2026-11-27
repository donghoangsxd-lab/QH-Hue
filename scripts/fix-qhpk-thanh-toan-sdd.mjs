// Sửa su-dung-dat.json QHPK Thanh Toàn: layer đang là loaidat số → dùng chucnangsudungdat.
// Không simplify geom (QHPK 1/2.000). Nguồn: .cache/gishue/20772/chucnangsudungdat_01.json
//   node scripts/fix-qhpk-thanh-toan-sdd.mjs [--upload]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const require = createRequire(import.meta.url);
const { parseWkt } = require('./gserver-to-shp.js');
const { loadGeeKey } = require('./build-chuyen-nganh.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPID = 20772;
const SLUG = 'qhpk-khu-do-thi-sinh-thai-thanh-toan-ac57aa8b';
const TEN = 'QHPK Khu đô thị sinh thái Thanh Toàn';
const CACHE = path.join(repo, '.cache', 'gishue', String(MAPID), 'chucnangsudungdat_01.json');
const OUT = path.join(repo, '.cache', 'gishue', 'out', String(MAPID), 'su-dung-dat.fixed.json');
const GCS_KEY = `projects/${SLUG}/su-dung-dat.json`;

function text(v) {
  return String(v ?? '').trim();
}

function num(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Bỏ loaidat thuần số khi đã có nhãn chữ. */
function landLabel(row) {
  const chu = text(row.chucnangsudungdat) || text(row.chucnangsu) || text(row.tendoituong);
  if (chu) return chu.slice(0, 120);
  const loai = text(row.loaidat);
  if (loai && !/^\d+(\.\d+)?$/.test(loai)) return loai.slice(0, 120);
  return 'Khác';
}

function planOf(row) {
  const floors = text(row.tangcao);
  const coverage = text(row.matdoxaydung);
  const far = text(row.hesosudungdat);
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

function buildParcels(doc) {
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const parcels = [];
  let n = 0;
  let skipped = 0;
  for (const row of rows) {
    const raw = text(row.geom) || text(row.s_geo);
    const geometry = closeRings(toGeometry(parseWkt(raw)));
    if (!geometry) {
      skipped += 1;
      continue;
    }
    // Cache Thanh Toàn đã WGS84 (107.x / 16.x).
    n += 1;
    const layer = landLabel(row);
    const code = text(row.kyhieulodat);
    const plan = planOf(row);
    const parcel = {
      kind: 'DXF',
      id: `QH-${n}`,
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
  return { parcels, skipped };
}

async function main() {
  const upload = process.argv.includes('--upload');
  if (!fs.existsSync(CACHE)) throw new Error(`Thiếu cache ${CACHE}`);
  const doc = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const { parcels, skipped } = buildParcels(doc);
  const body = {
    v: 2,
    role: 'su-dung-dat',
    tenQH: TEN,
    slug: SLUG,
    saved: Date.now(),
    parcels
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(body);
  fs.writeFileSync(OUT, json);
  const layers = {};
  let withCode = 0;
  let withPlan = 0;
  for (const p of parcels) {
    layers[p.layer] = (layers[p.layer] || 0) + 1;
    if (p.lotCode) withCode += 1;
    if (p.plan) withPlan += 1;
  }
  console.log(`parcels ${parcels.length} · skipped ${skipped} · lotCode ${withCode} · plan ${withPlan} · bytes ${Buffer.byteLength(json)}`);
  console.log('layers', Object.entries(layers).sort((a, b) => b[1] - a[1]));
  console.log(`wrote ${OUT}`);
  if (!upload) {
    console.log('Chạy lại với --upload để ghi GCS');
    return;
  }
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  await gcs.putObject(GCS_KEY, Buffer.from(json), 'application/json', undefined, 180000);
  console.log(`GCS ${GCS_KEY}`);
  // Bump saved trong projects/index.json để ?v= đổi — tránh CDN/trình duyệt giữ bản layer=số.
  const got = await gcs.readJson('projects/index.json');
  const entry = ((got && got.data && got.data.projects) || [])
    .find((row) => row && row.slug === SLUG);
  if (!entry) throw new Error('Không thấy đồ án trong projects/index.json');
  entry.saved = Date.now();
  entry.lands = parcels.length;
  await gcs.putObject(
    'projects/index.json',
    Buffer.from(JSON.stringify(got.data)),
    'application/json',
    got.generation,
    180000
  );
  console.log(`GCS projects/index.json saved=${entry.saved} lands=${entry.lands}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
