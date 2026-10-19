// Cắt đối tượng OSM theo ranh 40 phường, xã. Khung Overpass rộng hơn thành phố (lấn Đà Nẵng, Quảng Trị).
// Dùng turf toàn cục (cùng bản với các lớp khác). Trả null khi chưa có ranh hoặc chưa có turf.

function polysOf(geometries) {
  const polys = [];
  (geometries || []).forEach(geometry => {
    if (!geometry) return;
    try {
      const f = turf.feature(geometry);
      polys.push({ f, b: turf.bbox(f) });
    } catch (e) { /* ranh lỗi */ }
  });
  return polys;
}

function bboxOverlap(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function lineBbox(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  return [minX, minY, maxX, maxY];
}

function pointInPolys(lng, lat, polys) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const pt = turf.point([lng, lat]);
  return polys.some(p => lng >= p.b[0] && lng <= p.b[2] && lat >= p.b[1] && lat <= p.b[3]
    && turf.booleanPointInPolygon(pt, p.f));
}

function clipLine(coords, polys) {
  if (!coords || coords.length < 2) return [];
  const hits = polys.filter(p => bboxOverlap(lineBbox(coords), p.b));
  if (!hits.length) return [];
  let pending = [coords];
  const kept = [];
  hits.forEach(p => {
    const next = [];
    pending.forEach(part => {
      if (!part || part.length < 2) return;
      let split;
      try { split = turf.lineSplit(turf.lineString(part), p.f); } catch (e) { next.push(part); return; }
      const feats = split && split.features && split.features.length ? split.features : [turf.lineString(part)];
      feats.forEach(f => {
        const c = f.geometry && f.geometry.coordinates;
        if (!c || c.length < 2) return;
        const km = turf.length(f, { units: 'kilometers' });
        const mid = turf.along(f, km / 2, { units: 'kilometers' });
        const xy = mid.geometry.coordinates;
        if (turf.booleanPointInPolygon(turf.point(xy), p.f)) kept.push(c);
        else next.push(c);
      });
    });
    pending = next;
  });
  return kept;
}

export function clipOsmFeatures(features, geometries) {
  if (typeof turf === 'undefined') return null;
  const polys = polysOf(geometries);
  if (!polys.length) return null;
  const out = [];
  (features || []).forEach(f => {
    const g = f.geometry;
    const p = f.properties || {};
    if (!g) return;
    if (g.type === 'Point' || g.type === 'Polygon') {
      if (pointInPolys(Number(p.lng), Number(p.lat), polys)) out.push(f);
      return;
    }
    if (g.type !== 'LineString') return;
    clipLine(g.coordinates, polys).forEach((coords, i) => {
      const line = turf.lineString(coords);
      const km = turf.length(line, { units: 'kilometers' });
      const mid = turf.along(line, km / 2, { units: 'kilometers' });
      const xy = mid.geometry.coordinates;
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          ...p,
          lng: xy[0],
          lat: xy[1],
          lengthKm: Math.round(km * 1000) / 1000,
          id: `${p.id}#${i}`
        }
      });
    });
  });
  return out;
}

export function countGroups(features) {
  const c = { sport: 0, rail: 0, railStop: 0, water: 0, ferry: 0 };
  (features || []).forEach(f => {
    const g = f.properties && f.properties.group;
    if (Object.prototype.hasOwnProperty.call(c, g)) c[g] += 1;
  });
  return c;
}
