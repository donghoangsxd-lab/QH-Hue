import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sealWardDraw } from '../public/js/wardSeam.js';

const M_LAT = 110540;
const M_LNG = 111320 * Math.cos(16.4637 * Math.PI / 180);

function distM(a, b) {
  return Math.hypot((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT);
}

function proj(p, a, b) {
  const ax = a[0] * M_LNG, ay = a[1] * M_LAT;
  const bx = b[0] * M_LNG, by = b[1] * M_LAT;
  const px = p[0] * M_LNG, py = p[1] * M_LAT;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringsOf(g) {
  if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.flatMap(poly => poly);
}

function rect(x0, y0, x1, y1) {
  return { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] };
}

const gap = 3 / M_LAT;
const south = { type: 'Feature', properties: { tenXa: 'Nam' }, geometry: rect(107.50, 16.40, 107.52, 16.42) };
const north = { type: 'Feature', properties: { tenXa: 'Bac' }, geometry: rect(107.50, 16.42 + gap, 107.52, 16.44) };
const pack = sealWardDraw([south, north]);
const northGeom = pack.byName.get('Bac');
const southTop = 16.42;
let northBottom = Infinity;
ringsOf(northGeom).forEach(ring => ring.forEach(p => { if (p[1] < northBottom) northBottom = p[1]; }));
assert.ok(Math.abs(northBottom - southTop) * M_LAT < 0.25, `cạnh bắc phải khít, lệch ${((northBottom - southTop) * M_LAT).toFixed(2)} m`);

const bowM = 4 / M_LAT;
const bowed = {
  type: 'Feature',
  properties: { tenXa: 'Vong' },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [107.50, 16.42],
      [107.51, 16.42 + bowM],
      [107.52, 16.42],
      [107.52, 16.44],
      [107.50, 16.44],
      [107.50, 16.42]
    ]]
  }
};
const bowPack = sealWardDraw([south, bowed]);
let bowY = Infinity;
ringsOf(bowPack.byName.get('Vong')).forEach(ring => {
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const x = 107.51;
    if ((a[0] - x) * (b[0] - x) > 0) continue;
    const t = a[0] === b[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
    const y = a[1] + t * (b[1] - a[1]);
    if (y < bowY) bowY = y;
  }
});
assert.ok(Math.abs(bowY - 16.42) * M_LAT < 0.3, `đỉnh võng còn lệch ${((bowY - 16.42) * M_LAT).toFixed(2)} m`);

const sharedY = [];
pack.lines.forEach(line => {
  for (let i = 1; i < line.length; i++) {
    const a = [line[i - 1][1], line[i - 1][0]];
    const b = [line[i][1], line[i][0]];
    const midY = (a[1] + b[1]) / 2;
    if (Math.abs(midY - southTop) * M_LAT < 1 && Math.abs(a[1] - b[1]) * M_LAT < 1) sharedY.push(distM(a, b));
  }
});
assert.ok(sharedY.length >= 1, 'có một nét trên cạnh chung');
const parallel = sharedY.length;
assert.equal(parallel > 0, true);

function nearMissKm(features, lo, hi) {
  const feats = features.filter(f => f && f.geometry);
  const CELL = 0.0002;
  const grid = new Map();
  const segs = [];
  feats.forEach((f, fi) => {
    ringsOf(f.geometry).forEach(ring => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const id = segs.length;
        segs.push({ a, b, fi });
        const minx = Math.min(a[0], b[0]), maxx = Math.max(a[0], b[0]);
        const miny = Math.min(a[1], b[1]), maxy = Math.max(a[1], b[1]);
        for (let x = Math.floor(minx / CELL); x <= Math.floor(maxx / CELL); x++) {
          for (let y = Math.floor(miny / CELL); y <= Math.floor(maxy / CELL); y++) {
            const k = `${x},${y}`;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(id);
          }
        }
      }
    });
  });
  let km = 0;
  let n = 0;
  feats.forEach((f, fi) => {
    ringsOf(f.geometry).forEach(ring => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const len = distM(a, b);
        if (len < 0.05) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const cx = Math.floor(mid[0] / CELL), cy = Math.floor(mid[1] / CELL);
        let best = Infinity;
        const seen = new Set();
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(`${cx + dx},${cy + dy}`);
            if (!bucket) continue;
            for (const id of bucket) {
              if (seen.has(id)) continue;
              seen.add(id);
              if (segs[id].fi === fi) continue;
              const d = proj(mid, segs[id].a, segs[id].b);
              if (d < best) best = d;
            }
          }
        }
        if (best >= lo && best <= hi) { km += len; n++; }
      }
    });
  });
  return { km: km / 1000, n };
}

const fc = JSON.parse(fs.readFileSync(new URL('../public/data/ward-boundary.json', import.meta.url), 'utf8'));
const before = nearMissKm(fc.features, 0.4, 8);
const t0 = performance.now();
const real = sealWardDraw(fc.features);
const ms = Math.round(performance.now() - t0);
const after = nearMissKm(real.features, 0.4, 8);
let verts = 0;
real.features.forEach(f => ringsOf(f.geometry).forEach(r => { verts += r.length; }));
let lineVerts = 0;
real.lines.forEach(line => { lineVerts += line.length; });
console.log(JSON.stringify({ ms, beforeKm: +before.km.toFixed(1), afterKm: +after.km.toFixed(2), afterN: after.n, verts, lineVerts, lines: real.lines.length }));
assert.ok(before.km > 40, 'dữ liệu gốc còn khe');
assert.ok(after.km < before.km * 0.02, `còn ${after.km.toFixed(2)} km khe 0,4–8 m`);
assert.ok(real.lines.length > 10 && real.lines.length < 8000, 'nét ranh gom thành đường');
assert.equal(real.byName.size, 40);
console.log('test-ward-seam ok');
