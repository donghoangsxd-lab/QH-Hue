// Hình học tuyến / nhãn tiếp cận HT: cắt path tại ranh lô, neo chip phía ngoài.

import { distanceMeters } from './utils.js';

/** Cắt polyline [lat,lng]… tại mép lô — bỏ đoạn từ ranh vào tâm. */
export function clipPathAtParcel(path, geometry, turfApi = typeof turf !== 'undefined' ? turf : null) {
  if (!path || path.length < 2 || !geometry || !turfApi) return path;
  try {
    const poly = turfApi.feature(geometry);
    let cutIdx = -1;
    for (let i = 0; i < path.length; i++) {
      if (turfApi.booleanPointInPolygon([path[i][1], path[i][0]], poly)) {
        cutIdx = i;
        break;
      }
    }
    if (cutIdx < 0) return path;
    if (cutIdx === 0) return [path[0]];
    const a = path[cutIdx - 1];
    const b = path[cutIdx];
    const seg = turfApi.lineString([[a[1], a[0]], [b[1], b[0]]]);
    const border = turfApi.polygonToLine(poly);
    const hits = turfApi.lineIntersect(seg, border);
    let end = a;
    if (hits.features.length) {
      let bestD = Infinity;
      hits.features.forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const d = distanceMeters(a[0], a[1], lat, lng);
        if (d < bestD) {
          bestD = d;
          end = [lat, lng];
        }
      });
    }
    return path.slice(0, cutIdx).concat([end]);
  } catch (e) {
    return path;
  }
}

/** Neo nhãn phía ngoài ranh, hướng về điểm tra cứu. */
export function accessLabelAnchor(clickLat, clickLng, item, geometry, turfApi = typeof turf !== 'undefined' ? turf : null) {
  const destLat = Number(item.lat);
  const destLng = Number(item.lng);
  if (!geometry || !turfApi) return [destLat, destLng];
  try {
    const poly = turfApi.feature(geometry);
    const from = turfApi.point([clickLng, clickLat]);
    const c = turfApi.centroid(poly);
    const bearing = turfApi.bearing(from, c);
    const past = turfApi.destination(c, 0.08, bearing, { units: 'kilometers' });
    const ray = turfApi.lineString([from.geometry.coordinates, past.geometry.coordinates]);
    const border = turfApi.polygonToLine(poly);
    const hits = turfApi.lineIntersect(ray, border);
    if (!hits.features.length) {
      const [x, y] = c.geometry.coordinates;
      return [y, x];
    }
    let best = null;
    let bestD = Infinity;
    hits.features.forEach((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const d = distanceMeters(clickLat, clickLng, lat, lng);
      if (d < bestD) {
        bestD = d;
        best = [lat, lng];
      }
    });
    if (!best) return [destLat, destLng];
    const out = turfApi.destination(
      turfApi.point([best[1], best[0]]),
      0.014,
      turfApi.bearing(turfApi.point([best[1], best[0]]), from),
      { units: 'kilometers' }
    );
    return [out.geometry.coordinates[1], out.geometry.coordinates[0]];
  } catch (e) {
    return [destLat, destLng];
  }
}
