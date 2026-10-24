// Ranh phường/xã không còn mảnh phụ, mũi nhọn đi-về, cạnh tự cắt hoặc cạnh vẽ đè.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const M_LAT = 110540;
const M_LNG = 111320 * Math.cos(16.4637 * Math.PI / 180);
const distM = (a, b) => Math.hypot((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT);

function ringMeters(ring) {
  let area = 0;
  let per = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * M_LNG * y2 * M_LAT - x2 * M_LNG * y1 * M_LAT;
    per += distM(ring[i], ring[i + 1]);
  }
  return { area: Math.abs(area) / 2, per };
}

function partArea(poly) {
  let area = ringMeters(poly[0] || []).area;
  let per = ringMeters(poly[0] || []).per;
  for (let h = 1; h < poly.length; h++) {
    const hole = ringMeters(poly[h]);
    area -= hole.area;
    per += hole.per;
  }
  return { area: Math.max(0, area), per };
}

function orient(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(v) < 1e-14) return 0;
  return v > 0 ? 1 : -1;
}

function properCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 && o2 && o3 && o4 && o1 !== o2 && o3 !== o4;
}

const doc = JSON.parse(fs.readFileSync(new URL('../public/data/ward-boundary.json', import.meta.url), 'utf8'));
assert.equal(doc.v, 3);
assert.equal(doc.features.length, 40);
const engine = fs.readFileSync(new URL('../public/js/mapEngine.js', import.meta.url), 'utf8');
assert.match(engine, /WARD_GEOM_VERSION = 3/);

const log = JSON.parse(fs.readFileSync(new URL('./ward-boundary-repairs.json', import.meta.url), 'utf8'));
assert.ok(log.repairs.some(r => r.tenXa === 'Xã A Lưới 1' && r.defect));
assert.ok(log.repairs.some(r => r.tenXa === 'Xã Vinh Lộc'));
assert.ok(log.repairs.some(r => r.tenXa === 'Phường Phong Quảng'));

doc.features.forEach(f => {
  const name = f.properties.tenXa;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rows = polys.map(partArea);
  const primary = Math.max(...rows.map(r => r.area));
  rows.forEach(r => {
    if (r.area === primary) return;
    assert.ok(r.area >= 500, `${name} còn mảnh ${Math.round(r.area)} m²`);
    assert.ok(!(r.area < 20000 && r.per > 0 && r.area / r.per < 25), `${name} còn dải mỏng`);
  });
  const rings = polys.flat();
  rings.forEach(ring => {
    for (let i = 0; i < ring.length - 2; i++) {
      assert.ok(distM(ring[i], ring[i + 2]) > 1 || distM(ring[i], ring[i + 1]) < 8, `${name} có mũi nhọn đi-về`);
    }
    const CELL = 0.00025;
    const grid = new Map();
    const segs = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      if (distM(a, b) < 0.05) continue;
      const id = segs.length;
      segs.push({ a, b, i });
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
    segs.forEach(s => {
      const mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
      const cx = Math.floor(mid[0] / CELL), cy = Math.floor(mid[1] / CELL);
      const seen = new Set();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const id of bucket) {
            if (seen.has(id) || id === segs.indexOf(s)) continue;
            seen.add(id);
            const o = segs[id];
            if (Math.abs(o.i - s.i) <= 1) continue;
            const share = (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b)
              || distM(o.a, s.a) < 0.2 || distM(o.a, s.b) < 0.2 || distM(o.b, s.a) < 0.2 || distM(o.b, s.b) < 0.2;
            if (share) continue;
            const ax = s.a[0] * M_LNG, ay = s.a[1] * M_LAT;
            const bx = s.b[0] * M_LNG, by = s.b[1] * M_LAT;
            const px = mid[0] * M_LNG, py = mid[1] * M_LAT;
            const ox = o.a[0] * M_LNG, oy = o.a[1] * M_LAT;
            const qx = o.b[0] * M_LNG, qy = o.b[1] * M_LAT;
            const dx = qx - ox, dy = qy - oy;
            const l2 = dx * dx + dy * dy;
            let t = l2 ? ((px - ox) * dx + (py - oy) * dy) / l2 : 0;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const d = Math.hypot(px - (ox + t * dx), py - (oy + t * dy));
            assert.ok(d > 2 || t < 0.05 || t > 0.95, `${name} có cạnh vẽ đè`);
            assert.ok(!properCross(s.a, s.b, o.a, o.b), `${name} tự cắt`);
          }
        }
      }
    });
  });
});

console.log('test-ward-geom ok');
