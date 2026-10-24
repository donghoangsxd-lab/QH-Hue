// Bỏ mảnh phụ lỗi của ranh phường/xã: mảnh không phải phần lớn nhất,
// diện tích < 500 m², hoặc < 2 ha và diện tích/chu vi < 25 m (dải mỏng, spur).
// Không dời đỉnh của phần giữ lại. Ghi nhật ký scripts/ward-boundary-repairs.json.
import fs from 'node:fs';

const SRC = new URL('../public/data/ward-boundary.json', import.meta.url);
const LOG = new URL('./ward-boundary-repairs.json', import.meta.url);
const M_LAT = 110540;
const M_LNG = 111320 * Math.cos(16.4637 * Math.PI / 180);

function distM(a, b) {
  return Math.hypot((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT);
}

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

function partMetrics(poly) {
  const outer = ringMeters(poly[0] || []);
  let area = outer.area;
  let per = outer.per;
  for (let h = 1; h < poly.length; h++) {
    const hole = ringMeters(poly[h]);
    area -= hole.area;
    per += hole.per;
  }
  return { area: Math.max(0, area), per };
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const c = x1 * y2 - x2 * y1;
    a += c;
    x += (x1 + x2) * c;
    y += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-18) return { lng: +ring[0][0].toFixed(4), lat: +ring[0][1].toFixed(4) };
  return { lng: +(x / (3 * a)).toFixed(4), lat: +(y / (3 * a)).toFixed(4) };
}

function isSliver(m) {
  if (m.area < 500) return 'manh-nho';
  if (m.area < 20000 && m.per > 0 && m.area / m.per < 25) return 'dai-mong';
  return '';
}

const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const repairs = [];

doc.features.forEach(f => {
  const g = f.geometry;
  if (!g) return;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  if (polys.length < 2) return;
  const rows = polys.map((poly, i) => ({ i, poly, ...partMetrics(poly) }));
  const primary = rows.reduce((best, row) => (row.area > best.area ? row : best));
  const kept = [];
  rows.forEach(row => {
    if (row.i === primary.i) { kept.push(row.poly); return; }
    const kind = isSliver(row);
    if (!kind) { kept.push(row.poly); return; }
    const at = centroid(row.poly[0]);
    repairs.push({
      tenXa: f.properties && f.properties.tenXa,
      defect: kind,
      areaM2: Math.round(row.area),
      lng: at.lng,
      lat: at.lat
    });
  });
  if (kept.length === 1) f.geometry = { type: 'Polygon', coordinates: kept[0] };
  else f.geometry = { type: 'MultiPolygon', coordinates: kept };
});

doc.v = 3;
fs.writeFileSync(LOG, `${JSON.stringify({ v: 3, repairs }, null, 2)}\n`);
fs.writeFileSync(SRC, JSON.stringify(doc));
const byName = {};
repairs.forEach(r => { byName[r.tenXa] = (byName[r.tenXa] || 0) + 1; });
console.log(JSON.stringify({ dropped: repairs.length, byName }));
