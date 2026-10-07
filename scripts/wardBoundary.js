// Ranh 40 phường xã (đất liền TP. Huế) cho các script xử lý lớp tĩnh: tải từ webapp hoặc đọc file có sẵn.
const fs = require('fs');

const GEE_API_URL = process.env.GEE_API_URL || 'https://web-hatang-hue-4.vercel.app/api/gee';
const BOUNDARY_URL = process.env.BOUNDARY_URL || `${GEE_API_URL}?action=getBoundaryVector&v=2`;

async function loadBoundary(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(BOUNDARY_URL, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Không tải được ranh phường xã (HTTP ${res.status}) — dùng --boundary <file.geojson>`);
  return res.json();
}

/**
 * Hàm (lng, lat) → nằm trong ranh. Tia ngang chẵn–lẻ trên mọi vòng của các phường xã (không chồng nhau, cạnh chung
 * được đếm 2 lần vẫn đúng chẵn lẻ); cạnh chia theo dải vĩ độ để mỗi điểm chỉ xét vài chục cạnh.
 */
function makeInside(fc) {
  const E = [];
  let minY = Infinity, maxY = -Infinity;
  (fc.features || []).forEach(f => {
    const g = f && f.geometry;
    const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    polys.forEach(poly => poly.forEach(ring => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (a[1] === b[1]) continue;
        E.push(a[0], a[1], b[0], b[1]);
        minY = Math.min(minY, a[1], b[1]);
        maxY = Math.max(maxY, a[1], b[1]);
      }
    }));
  });
  if (!E.length) throw new Error('Ranh phường xã rỗng');
  const BANDS = 4096;
  const h = (maxY - minY) / BANDS;
  const band = (y) => Math.min(BANDS - 1, Math.max(0, Math.floor((y - minY) / h)));
  const buckets = Array.from({ length: BANDS }, () => []);
  for (let e = 0; e < E.length; e += 4) {
    const b0 = band(Math.min(E[e + 1], E[e + 3])), b1 = band(Math.max(E[e + 1], E[e + 3]));
    for (let b = b0; b <= b1; b++) buckets[b].push(e);
  }
  return (x, y) => {
    if (y < minY || y >= maxY) return false;
    let inside = false;
    for (const e of buckets[band(y)]) {
      const x1 = E[e], y1 = E[e + 1], x2 = E[e + 2], y2 = E[e + 3];
      if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  };
}

module.exports = { GEE_API_URL, loadBoundary, makeInside };
