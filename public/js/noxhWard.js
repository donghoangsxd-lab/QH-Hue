// Gán phường cho từng chung cư lúc chạy: cột sheet chỉ dùng khi có tên và khớp ranh.
// Không có cột thì lấy tâm đa giác nếu tâm nằm trong công trình và chiếm phần lớn diện tích;
// không thì lấy phường chồng nhiều mẫu nhất. Một dòng một phường, không tách dân.

const GRID = 24;

export function cleanWardName(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/^\s*(phường|xã|thị trấn|p\.)\s*/i, '')
    .trim()
    .toLowerCase();
}

function polygonsOf(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometry;
  if (geometry.type !== 'GeometryCollection') return null;
  const parts = [];
  (geometry.geometries || []).forEach(g => {
    const p = polygonsOf(g);
    if (!p) return;
    if (p.type === 'Polygon') parts.push(p.coordinates);
    else parts.push(...p.coordinates);
  });
  if (!parts.length) return null;
  return parts.length === 1
    ? { type: 'Polygon', coordinates: parts[0] }
    : { type: 'MultiPolygon', coordinates: parts };
}

function bboxOf(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      if (node[0] < minX) minX = node[0];
      if (node[1] < minY) minY = node[1];
      if (node[0] > maxX) maxX = node[0];
      if (node[1] > maxY) maxY = node[1];
      return;
    }
    for (let i = 0; i < node.length; i++) scan(node[i]);
  };
  scan(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInRings(x, y, rings) {
  if (!rings || !rings[0] || !pointInRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(x, y, rings[h])) return false;
  }
  return true;
}

function pointInGeometry(x, y, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (let i = 0; i < polys.length; i++) {
    if (pointInRings(x, y, polys[i])) return true;
  }
  return false;
}

// Tia ngang theo dải vĩ độ: ranh phường rất nhiều đỉnh, mỗi mẫu chỉ xét vài chục cạnh.
function bandContains(rings) {
  const E = [];
  let minY = Infinity;
  let maxY = -Infinity;
  (rings || []).forEach(ring => {
    if (!ring || ring.length < 3) return;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const y1 = ring[j][1];
      const y2 = ring[i][1];
      if (y1 === y2) continue;
      E.push(ring[j][0], y1, ring[i][0], y2);
      if (y1 < minY) minY = y1;
      if (y2 < minY) minY = y2;
      if (y1 > maxY) maxY = y1;
      if (y2 > maxY) maxY = y2;
    }
  });
  if (!E.length || !(maxY > minY)) return () => false;
  const BANDS = 2048;
  const span = maxY - minY;
  const band = (y) => Math.min(BANDS - 1, Math.max(0, Math.floor(((y - minY) / span) * BANDS)));
  const buckets = Array.from({ length: BANDS }, () => []);
  for (let e = 0; e < E.length; e += 4) {
    const b0 = band(Math.min(E[e + 1], E[e + 3]));
    const b1 = band(Math.max(E[e + 1], E[e + 3]));
    for (let b = b0; b <= b1; b++) buckets[b].push(e);
  }
  return (x, y) => {
    if (y < minY || y > maxY) return false;
    let inside = false;
    const bucket = buckets[band(y)];
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      const x1 = E[e];
      const y1 = E[e + 1];
      const x2 = E[e + 2];
      const y2 = E[e + 3];
      if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  };
}

function containsFn(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const parts = polys.map(rings => bandContains(rings));
  return (x, y) => {
    for (let i = 0; i < parts.length; i++) if (parts[i](x, y)) return true;
    return false;
  };
}

let indexCache = null;

function wardIndex(wards) {
  if (indexCache && indexCache.wards === wards) return indexCache.index;
  const index = [];
  (wards || []).forEach(w => {
    const name = String((w && w.name) || '').normalize('NFC').trim();
    const geometry = polygonsOf(w && w.geometry);
    if (!name || !geometry) return;
    index.push({
      name,
      key: cleanWardName(name),
      geometry,
      bbox: bboxOf(geometry),
      contains: containsFn(geometry)
    });
  });
  indexCache = { wards, index };
  return index;
}

function matchSheetWard(raw, index) {
  const text = String(raw || '').normalize('NFC').trim();
  if (!text) return '';
  const key = cleanWardName(text);
  const hits = index.filter(w => w.key === key);
  return hits.length === 1 ? hits[0].name : '';
}

function wardAtPoint(x, y, index) {
  for (let i = 0; i < index.length; i++) {
    const w = index[i];
    const b = w.bbox;
    if (b && (x < b[0] || x > b[2] || y < b[1] || y > b[3])) continue;
    if (w.contains(x, y)) return w.name;
  }
  return '';
}

function ringAreaM2(ring) {
  if (!ring || ring.length < 4) return 0;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const m = 111320;
  const cos = Math.cos(lat * Math.PI / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * m * cos;
    const y1 = ring[i][1] * m;
    const x2 = ring[i + 1][0] * m * cos;
    const y2 = ring[i + 1][1] * m;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function centroidOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let ring = null;
  let best = -1;
  polys.forEach(rings => {
    const outer = rings && rings[0];
    if (!outer) return;
    const area = ringAreaM2(outer);
    if (area > best) { ring = outer; best = area; }
  });
  if (!ring) return null;
  let lng = 0;
  let lat = 0;
  const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return n ? { lng: lng / n, lat: lat / n } : null;
}

function overlapCounts(geometry, index) {
  const counts = new Map();
  let total = 0;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polys.forEach(rings => {
    const ring = rings && rings[0];
    if (!ring || !ring.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ring.forEach(p => {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    const dx = (maxX - minX) / GRID || 1e-8;
    const dy = (maxY - minY) / GRID || 1e-8;
    const candidates = index.filter(w => {
      const b = w.bbox;
      return !b || !(maxX < b[0] || minX > b[2] || maxY < b[1] || minY > b[3]);
    });
    for (let ix = 0; ix < GRID; ix++) {
      for (let iy = 0; iy < GRID; iy++) {
        const x = minX + (ix + 0.5) * dx;
        const y = minY + (iy + 0.5) * dy;
        if (!pointInRings(x, y, rings)) continue;
        total += 1;
        for (let c = 0; c < candidates.length; c++) {
          const w = candidates[c];
          const b = w.bbox;
          if (b && (x < b[0] || x > b[2] || y < b[1] || y > b[3])) continue;
          if (w.contains(x, y)) {
            counts.set(w.name, (counts.get(w.name) || 0) + 1);
            break;
          }
        }
      }
    }
  });
  return { total, counts };
}

function topName(counts) {
  let best = '';
  let n = 0;
  counts.forEach((v, name) => {
    if (v > n) { n = v; best = name; }
  });
  return best;
}

function assignNoxhWard(item, index) {
  const sheet = matchSheetWard(item && item.ward, index);
  if (sheet) return sheet;
  const geometry = polygonsOf(item && item.geometry);
  const fit = geometry ? overlapCounts(geometry, index) : { total: 0, counts: new Map() };
  const overlap = topName(fit.counts);
  const center = geometry ? centroidOf(geometry) : null;
  if (center && geometry && pointInGeometry(center.lng, center.lat, geometry)) {
    const hit = wardAtPoint(center.lng, center.lat, index);
    const n = fit.counts.get(hit) || 0;
    if (hit && (!fit.total || n * 2 >= fit.total)) return hit;
  }
  if (overlap) return overlap;
  const lng = Number(item && item.lng);
  const lat = Number(item && item.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    const hit = wardAtPoint(lng, lat, index);
    if (hit) return hit;
  }
  return '';
}

export function assignNoxhWards(items, wards) {
  const index = wardIndex(wards);
  if (!index.length || !Array.isArray(items)) return items || [];
  return items.map(it => {
    if (!it) return it;
    const sheetWard = it.sheetWard != null ? String(it.sheetWard) : String(it.ward || '');
    const ward = assignNoxhWard({ ...it, ward: sheetWard }, index);
    if (ward === it.ward && it.sheetWard != null) return it;
    return { ...it, ward, sheetWard };
  });
}

/** Phần mẫu nằm trong phường đã gán. Dùng để biết dấu chân có lệch sang phường khác hay không. */
export function apartmentWardFit(item, wards) {
  const index = wardIndex(wards);
  const sheet = String(item && item.sheetWard != null ? item.sheetWard : (item && item.ward) || '');
  const ward = index.length ? assignNoxhWard({ ...item, ward: sheet }, index) : '';
  const geometry = polygonsOf(item && item.geometry);
  const fit = geometry ? overlapCounts(geometry, index) : { total: 0, counts: new Map() };
  const inWard = fit.counts.get(ward) || 0;
  return { ward, total: fit.total, inWard, spill: Math.max(0, fit.total - inWard) };
}
