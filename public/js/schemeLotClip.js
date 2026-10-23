// Lô sử dụng đất so với ranh quy hoạch của đúng đồ án.
// Dung sai SCHEME_EDGE_M: sai số vẽ (nét bản vẽ 1/2.000 và lệch nắn) thường dưới vài mét.
// Phần ngoài ranh nằm trọn trong dải này thì giữ nguyên hình. Vượt dải thì cắt theo ranh, hoặc bỏ nếu không còn phần trong ranh.
// Không đụng ghép lô hạ tầng (QHCT ưu tiên, QHPK chỉ gỡ ghép).
import { boundaryFromLines } from './boundaryLines.js';

export const SCHEME_EDGE_M = 5;
const SLIVER_M2 = 2;

function turfOf() {
  const lib = globalThis.turf;
  if (!lib || typeof lib.area !== 'function') {
    const err = new Error('Thiếu thư viện turf');
    err.status = 500;
    throw err;
  }
  return lib;
}

function asFeature(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Feature') return geometry;
  return { type: 'Feature', properties: {}, geometry };
}

function geomOf(hit) {
  if (!hit) return null;
  const geometry = hit.type === 'Feature' ? hit.geometry : hit;
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
  return geometry;
}

function pair(name, a, b) {
  const turf = turfOf();
  const op = turf[name];
  if (typeof op !== 'function') return null;
  try {
    const out = op(a, b);
    if (out) return out;
  } catch (e) { /* bản turf 7 nhận FeatureCollection */ }
  try {
    return op(turf.featureCollection([a, b])) || null;
  } catch (e) {
    return null;
  }
}

function areaOf(feature) {
  if (!feature) return 0;
  try {
    const area = turfOf().area(feature);
    return Number.isFinite(area) ? area : 0;
  } catch (e) {
    return 0;
  }
}

function isPoly(feature) {
  const geometry = feature && feature.geometry;
  return !!geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon');
}

function lotName(props) {
  const p = props || {};
  return String(p.nhan || p.TEN || p.ten || p.name || p.layer || '').slice(0, 120);
}

function lotProps(props) {
  const out = {};
  Object.keys(props || {}).forEach(key => {
    if (key === '_mau' || key === '_status') return;
    out[key] = props[key];
  });
  return out;
}

function pushPoly(coordinates, geometry) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') coordinates.push(geometry.coordinates);
  else (geometry.coordinates || []).forEach(poly => coordinates.push(poly));
}

function unionGeoms(geoms) {
  const turf = turfOf();
  let acc = asFeature(geoms[0]);
  for (let i = 1; i < geoms.length; i++) {
    const next = pair('union', acc, asFeature(geoms[i]));
    if (next) acc = next.type === 'Feature' ? next : asFeature(geomOf(next) || next);
  }
  const geometry = geomOf(acc);
  if (geometry) return geometry;
  const coordinates = [];
  geoms.forEach(geometryItem => pushPoly(coordinates, geometryItem));
  if (!coordinates.length) return null;
  if (coordinates.length === 1) return { type: 'Polygon', coordinates: coordinates[0] };
  return { type: 'MultiPolygon', coordinates };
}

/** Ranh từ polygon, hoặc từ đường khép được. Không có vòng thì null. */
export function schemeBoundaryOf(features) {
  const polys = [];
  const lines = [];
  (features || []).forEach(feature => {
    const geometry = feature && feature.geometry;
    if (!geometry) return;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') polys.push(geometry);
    else if (geometry.type === 'LineString') lines.push(geometry.coordinates);
    else if (geometry.type === 'MultiLineString') (geometry.coordinates || []).forEach(line => lines.push(line));
  });
  if (lines.length) {
    const closed = boundaryFromLines(lines);
    if (closed && closed.geometry) polys.push(closed.geometry);
  }
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  return unionGeoms(polys);
}

function toleranceMask(boundary) {
  const turf = turfOf();
  try {
    const grown = turf.buffer(asFeature(boundary), SCHEME_EDGE_M, { units: 'meters', steps: 16 });
    return geomOf(grown);
  } catch (e) {
    return null;
  }
}

function judge(feature, boundary, mask) {
  const lot = asFeature(feature.geometry);
  const edge = asFeature(boundary);
  const band = asFeature(mask);
  let beyond = 0;
  if (band) {
    const outside = pair('difference', lot, band);
    beyond = outside ? areaOf(outside) : 0;
  } else {
    const outside = pair('difference', lot, edge);
    beyond = outside ? areaOf(outside) : 0;
  }
  if (beyond < SLIVER_M2) return { status: 'giu' };
  const inside = pair('intersect', lot, edge);
  const insideGeom = geomOf(inside);
  if (!insideGeom || areaOf(inside) < SLIVER_M2) return { status: 'bo' };
  return { status: 'cat', geometry: insideGeom };
}

/**
 * features: GeoJSON Feature[]. boundary: Polygon hoặc MultiPolygon.
 * Trả features đem ghi (đã cắt, đã bỏ lô ngoài), review là lô đỏ (hình gốc), counts.
 */
export function clipSchemeLots(features, boundary) {
  const list = Array.isArray(features) ? features : [];
  if (!boundary || (boundary.type !== 'Polygon' && boundary.type !== 'MultiPolygon')) {
    return { features: list.slice(), review: [], counts: null, edgeM: SCHEME_EDGE_M };
  }
  const mask = toleranceMask(boundary);
  const out = [];
  const review = [];
  const counts = { giu: 0, bo: 0, cat: 0 };
  let n = 0;
  list.forEach(feature => {
    if (!isPoly(feature)) {
      out.push(feature);
      return;
    }
    n += 1;
    const id = `lo-${n}`;
    const props = lotProps(feature.properties);
    let verdict = { status: 'giu' };
    try { verdict = judge(feature, boundary, mask); }
    catch (e) { verdict = { status: 'giu' }; }
    if (verdict.status === 'giu') {
      counts.giu += 1;
      out.push(feature);
      return;
    }
    if (verdict.status === 'bo') {
      counts.bo += 1;
      review.push({
        id, status: 'bo', index: null, name: lotName(props), geometry: feature.geometry, props
      });
      return;
    }
    const index = out.length;
    counts.cat += 1;
    out.push({ type: 'Feature', geometry: verdict.geometry, properties: props });
    review.push({
      id, status: 'cat', index, name: lotName(props), geometry: feature.geometry, props
    });
  });
  return { features: out, review, counts, edgeM: SCHEME_EDGE_M };
}

export function clipSentence(counts) {
  if (!counts) return '';
  const red = counts.bo + counts.cat;
  if (!red) return `Không có lô ngoài ranh (dung sai ${SCHEME_EDGE_M} m).`;
  return `Đỏ ${red} lô: bỏ ${counts.bo}, cắt ${counts.cat} (dung sai ${SCHEME_EDGE_M} m).`;
}
