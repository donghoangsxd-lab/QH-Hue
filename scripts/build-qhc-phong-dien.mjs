// Rút gọn SDD QHC Phong Điền (mapid 20710) → projects/ + giữ lô INFRA sẵn có.
// Chỉ dùng cho QHC ~1/10.000 (sai số hình học lớn được phép). Không áp simplify cho QHPK 1/2.000 / QHCT 1/500.
// Nguồn: .cache/gishue/out/20710 sau gishue-import --no-gcs.
//   node scripts/build-qhc-phong-dien.mjs [--upload]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const require = createRequire(import.meta.url);
const { loadGeeKey } = require('./build-chuyen-nganh.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'qhc-do-thi-phong-dien-den-nam-2030-tam-nhin-den-nam-2045-5727c5b3';
const TEN = 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045';
const MAPID = 20710;
const OUT = path.join(repo, 'public', 'data', 'qhc-phong-dien');
const CACHE_SDD = path.join(repo, '.cache', 'gishue', 'out', String(MAPID), 'chuc-nang-su-dung-dat', 'chuc-nang-su-dung-dat.geojson');
// ~vài mét — đủ QHC 1/10.000; không dùng TOL này cho QHPK/QHCT.
const TOL = 0.00002;
const SKIP_PROP = new Set(['geom', 's_geo', 'resultnumber', 's_xdaidien', 's_ydaidien', 'xdaidien', 'ydaidien']);

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

function buildSdd(fc) {
  const labels = table();
  const features = [];
  const parcels = [];
  let n = 0;
  for (const f of fc.features || []) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    // gisHue đôi khi cắt tên cột (chucnangsu ← chucnangsudungdat). Không dùng loaidat thuần số.
    const loai = text(p.loaidat);
    const label = text(p.chucnangsudungdat) || text(p.chucnangsu) || text(p.tendoituong)
      || (loai && !/^\d+(\.\d+)?$/.test(loai) ? loai : '') || 'Khác';
    const i = labels.idx(label);
    const a = num(p.dientich, 1) || num(p.shape_area, 1);
    const t = Number(p.trangthai) === 1 ? 0 : 1;
    const g = slim(f.geometry);
    if (!g) continue;
    features.push({ type: 'Feature', properties: { i, t, a }, geometry: g });
    n += 1;
    parcels.push({
      kind: 'DXF',
      id: `PD-${n}`,
      phase: 'QH',
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
    parcels
  };
}

function writeJson(file, data) {
  const body = JSON.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const n = data.features ? data.features.length : (data.parcels || []).length;
  console.log(`${path.relative(repo, file)}: ${n} dt, ${(body.length / 1048576).toFixed(2)} MB`);
  return body;
}

function patchCatalog(dxfCount) {
  const indexFile = path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const qhPath = `projects/${SLUG}/su-dung-dat.json`;
  (index.layers || []).forEach((layer) => {
    if (layer.scheme !== SLUG) return;
    if (layer.name === 'Chức năng sử dụng đất' && layer.status === 'quy-hoach') {
      layer.file = qhPath;
      layer.ref = qhPath;
      layer.featureCount = dxfCount;
    }
  });
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);

  const landFile = path.join(repo, 'public', 'data', 'su-dung-dat-index.json');
  const land = JSON.parse(fs.readFileSync(landFile, 'utf8'));
  let hit = (land.layers || []).find((l) => l.scheme === SLUG && l.role === 'quy-hoach');
  if (!hit) {
    hit = {
      scheme: SLUG,
      name: TEN,
      mapid: MAPID,
      layer: 'su-dung-dat',
      role: 'quy-hoach',
      path: qhPath,
      lands: dxfCount,
      source: 'projects'
    };
    land.layers.push(hit);
    land.count = land.layers.length;
  } else {
    hit.mapid = MAPID;
    hit.path = qhPath;
    hit.lands = dxfCount;
    hit.source = 'projects';
  }
  fs.writeFileSync(landFile, `${JSON.stringify(land, null, 2)}\n`);
  console.log('catalog + su-dung-dat-index →', qhPath, dxfCount);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const built = buildSdd(readFc(CACHE_SDD));
  writeJson(path.join(OUT, 'sdd.json'), built.compact);

  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  const prev = await gcs.readJson(`projects/${SLUG}/su-dung-dat.json`);
  const infra = ((prev && prev.data && prev.data.parcels) || []).filter((p) => p && p.kind === 'INFRA');
  const saved = Date.now();
  const doc = {
    v: 2,
    role: 'su-dung-dat',
    tenQH: TEN,
    slug: SLUG,
    saved,
    parcels: [...built.parcels, ...infra]
  };
  const body = writeJson(path.join(OUT, 'su-dung-dat.project.json'), doc);
  console.log(`ghép INFRA giữ lại: ${infra.length}; DXF mới: ${built.parcels.length}`);

  patchCatalog(built.parcels.length);

  if (process.argv.includes('--upload')) {
    await gcs.putObject(`projects/${SLUG}/su-dung-dat.json`, Buffer.from(body), 'application/json', undefined, 180000);
    console.log(`GCS projects/${SLUG}/su-dung-dat.json`);

    const idx = await gcs.readJson('projects/index.json');
    const projects = (idx.data && idx.data.projects) || [];
    let touched = false;
    const next = projects.map((p) => {
      if (!p || p.deleted || p.slug !== SLUG) return p;
      touched = true;
      return {
        ...p,
        dir: true,
        lands: built.parcels.length,
        saved,
        time: new Date(saved).toLocaleString('vi-VN')
      };
    });
    if (!touched) throw new Error('Không thấy đồ án Phong Điền trong projects/index.json');
    await gcs.putJson('projects/index.json', JSON.stringify({
      v: idx.data.v || 1,
      migrated: !!idx.data.migrated,
      projects: next
    }), idx.generation);
    console.log('projects/index lands', built.parcels.length, 'saved', saved);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
