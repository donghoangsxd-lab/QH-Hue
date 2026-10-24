// Cắt lô sử dụng đất theo ranh quy hoạch. Phần nhô quá 5 m bị cắt; lô nằm hẳn ngoài vùng đệm thì bỏ.
// Tọa độ mét VN-2000 (múi 3°, KTT 107°) được đổi sang WGS84 trước khi cắt.
//   node scripts/clip-scheme-lots.mjs "<thư mục LOP hoặc thư mục cha>"
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import * as turf from '@turf/turf';

const require = createRequire(import.meta.url);
const { writeLayer } = require('./gserver-to-shp.js');
const { vn2000ToWgs84 } = await import('../public/js/cadImport.js');

const TOL_M = 5;
const ROLE = { shape: 'Polygon', shapeType: 5 };

function strip(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function lopDirs(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const base = path.basename(dir);
    if (/^LOP-mapid\d+/i.test(base)) { out.push(dir); continue; }
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) stack.push(p);
    }
  }
  return out;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function projectCoord(c) {
  const x = c[0];
  const y = c[1];
  if (Math.abs(x) < 1000 && Math.abs(y) < 1000) return [round6(x), round6(y)];
  const [lat, lng] = vn2000ToWgs84(x, y);
  return [round6(lng), round6(lat)];
}

function mapCoords(coords, fn) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') return fn(coords);
  return coords.map((c) => mapCoords(c, fn));
}

function toWkt(geometry) {
  const ring = (r) => `(${r.map((c) => `${c[0]} ${c[1]}`).join(', ')})`;
  const poly = (coords) => `(${coords.map(ring).join(', ')})`;
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return `POLYGON ${poly(geometry.coordinates)}`;
  if (geometry.type === 'MultiPolygon') return `MULTIPOLYGON (${geometry.coordinates.map(poly).join(', ')})`;
  return '';
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).flatMap(polygonsOf);
  }
  return [];
}

function loadCollection(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const features = (doc.features || []).map((f) => {
    if (!f || !f.geometry) return null;
    const geometry = { ...f.geometry, coordinates: mapCoords(f.geometry.coordinates, projectCoord) };
    return { type: 'Feature', properties: f.properties || {}, geometry };
  }).filter(Boolean);
  return features;
}

function ringsOf(feature) {
  const rings = [];
  polygonsOf(feature.geometry).forEach((g) => g.coordinates.forEach((ring) => rings.push(ring)));
  return rings;
}

function edgeHitsBox(rings, box) {
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const c = ring[i];
      if (Math.max(a[0], c[0]) < box[0] || Math.min(a[0], c[0]) > box[2]) continue;
      if (Math.max(a[1], c[1]) < box[1] || Math.min(a[1], c[1]) > box[3]) continue;
      return true;
    }
  }
  return false;
}

function boundaryOf(files) {
  const hits = files.filter((f) => {
    const name = strip(path.basename(f, '.geojson'));
    return f.endsWith('.geojson') && name.includes('ranh gioi') && name.includes('vung');
  });
  const features = hits.flatMap(loadCollection).filter((f) => polygonsOf(f.geometry).length);
  if (!features.length) return null;
  let geom = features[0];
  for (let i = 1; i < features.length; i++) {
    const merged = turf.union(turf.featureCollection([geom, features[i]]));
    if (merged) geom = merged;
  }
  // Dung sai 5 m: đơn giản ranh trước khi đệm để phép cắt không phụ thuộc từng đỉnh dư.
  const simple = turf.simplify(geom, { tolerance: 0.000045, highQuality: false });
  const pad = turf.buffer(simple, TOL_M, { units: 'meters' }) || simple;
  return { line: simple, pad, rings: ringsOf(simple) };
}

function clipFeature(feature, bound) {
  const box = turf.bbox(feature);
  const corners = [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]];
  const inside = corners.every((c) => turf.booleanPointInPolygon(c, bound.line));
  if (inside && !edgeHitsBox(bound.rings, box)) return { kind: 'keep', feature };
  const padBox = turf.bbox(bound.pad);
  if (box[2] < padBox[0] || box[0] > padBox[2] || box[3] < padBox[1] || box[1] > padBox[3]) return { kind: 'drop' };
  let hit;
  try {
    hit = turf.intersect(turf.featureCollection([feature, bound.pad]));
  } catch {
    return { kind: 'fail' };
  }
  if (!hit || !hit.geometry) return { kind: 'drop' };
  const parts = polygonsOf(hit.geometry).filter((g) => {
    try { return turf.area({ type: 'Feature', properties: {}, geometry: g }) > 1; } catch { return false; }
  });
  if (!parts.length) return { kind: 'drop' };
  const geometry = parts.length === 1
    ? parts[0]
    : { type: 'MultiPolygon', coordinates: parts.map((g) => g.coordinates) };
  return { kind: 'clip', feature: { ...feature, geometry } };
}

function lotFiles(files) {
  return files.filter((f) => {
    const name = strip(path.basename(f, '.geojson'));
    return f.endsWith('.geojson') && name.includes('su dung dat');
  });
}

function rewrite(file, features) {
  const dir = path.dirname(file);
  const stem = path.basename(file, '.geojson');
  const rows = features.map((f) => {
    const props = { ...(f.properties || {}) };
    delete props.geom;
    delete props.s_geo;
    return { ...props, geom: toWkt(f.geometry) };
  }).filter((row) => row.geom);
  writeLayer(dir, stem, ROLE, rows, 'WGS84');
}

function clipDir(lop) {
  const files = walk(lop);
  const bound = boundaryOf(files);
  if (!bound) throw new Error(`${path.basename(lop)}: không có ranh vùng`);
  const summary = [];
  for (const file of lotFiles(files)) {
    const features = loadCollection(file);
    const next = [];
    const stat = { file: path.basename(file), in: features.length, keep: 0, clip: 0, drop: 0, fail: 0 };
    for (const feature of features) {
      const got = clipFeature(feature, bound);
      stat[got.kind] += 1;
      if (got.feature) next.push(got.feature);
    }
    rewrite(file, next);
    stat.out = next.length;
    summary.push(stat);
  }
  return { map: path.basename(lop), layers: summary };
}

const roots = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!roots.length) {
  console.error('Thiếu thư mục LOP');
  process.exit(1);
}
const dirs = roots.flatMap((root) => lopDirs(path.resolve(root)));
if (!dirs.length) {
  console.error('Không thấy thư mục LOP-mapid');
  process.exit(1);
}
const report = dirs.map(clipDir);
console.log(JSON.stringify({ toleranceM: TOL_M, maps: report }));
