// Gộp hiện trạng tạm thời. Quy tắc xếp hạng và trùng hình dùng cho script dựng file và test.

export const SECTORS = ['giao-thong', 'cap-dien', 'cap-nuoc'];
// Đồ án không ghi tỷ lệ được xếp 1/5.000: chi tiết hơn QHC 1/10.000 và 1/25.000, thô hơn 1/2.000.
export const UNKNOWN_SCALE = 5000;
export const POINT_METERS = 100;
export const LINE_METERS = 60;
export const LINE_COVER = 0.6;

export function stripName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}

export function nhomOf(layerName) {
  const s = stripName(layerName);
  if (s.includes('duong sat') || s.includes('sat ')) return 'duong-sat';
  if (s.includes('duong thuy') || s.includes('thuy')) return 'duong-thuy';
  if (s.includes('mat cat')) return 'mat-cat';
  if (s.includes('nang luong')) return 'nang-luong';
  return 'mang';
}

export function familyOf(type) {
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  return '';
}

export function declaredScale(layerScale, schemeScale) {
  const n = Number(layerScale || schemeScale);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function rankOf(scheme, layerScale) {
  const declared = declaredScale(layerScale, scheme && scheme.scale);
  const year = scheme && scheme.decisionDate ? Number(String(scheme.decisionDate).slice(0, 4)) : 0;
  return {
    scale: declared || UNKNOWN_SCALE,
    year: Number.isFinite(year) ? year : 0,
    priority: Number(scheme && scheme.priority) || 0,
    slug: scheme && scheme.slug ? scheme.slug : ''
  };
}

// Âm nếu a được giữ trước b: tỷ lệ chi tiết hơn, rồi năm mới hơn, rồi priority, rồi slug.
export function compareRank(a, b) {
  if (a.scale !== b.scale) return a.scale - b.scale;
  if (a.year !== b.year) return b.year - a.year;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

function distM(a, b) {
  const R = 6371000;
  const p1 = a[1] * Math.PI / 180;
  const p2 = b[1] * Math.PI / 180;
  const dp = (b[1] - a[1]) * Math.PI / 180;
  const dl = (b[0] - a[0]) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function segDistM(p, a, b) {
  const lat = ((a[1] + b[1] + p[1]) / 3) * Math.PI / 180;
  const kx = 111320 * Math.cos(lat);
  const ky = 110540;
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const bx = b[0] * kx;
  const by = b[1] * ky;
  const px = p[0] * kx;
  const py = p[1] * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function pointsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'MultiPoint') return geometry.coordinates;
  return [];
}

function lineLength(line) {
  let n = 0;
  for (let i = 1; i < line.length; i += 1) n += distM(line[i - 1], line[i]);
  return n;
}

function sampleLine(line, count) {
  if (!line || line.length < 2) return line ? line.slice() : [];
  const total = lineLength(line);
  if (!total) return [line[0]];
  const out = [];
  const step = total / Math.max(1, count - 1);
  let acc = 0;
  let next = 0;
  out.push(line[0]);
  for (let i = 1; i < line.length && out.length < count; i += 1) {
    const seg = distM(line[i - 1], line[i]);
    while (out.length < count && acc + seg >= next && seg) {
      const t = (next - acc) / seg;
      out.push([
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t
      ]);
      next += step;
    }
    acc += seg;
  }
  if (out.length < count) out.push(line[line.length - 1]);
  return out;
}

export function repPoint(geometry) {
  const pts = pointsOf(geometry);
  if (pts.length) return pts[0];
  const lines = linesOf(geometry);
  if (lines.length) {
    const samples = sampleLine(lines[0], 3);
    return samples[Math.floor(samples.length / 2)] || lines[0][0];
  }
  if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
    const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
    if (!ring || !ring.length) return null;
    let x = 0;
    let y = 0;
    const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1 : ring.length;
    for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
  }
  return null;
}

function bboxOf(geometry) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  const walk = (c) => {
    if (!c) return;
    if (typeof c[0] === 'number') {
      minx = Math.min(minx, c[0]);
      miny = Math.min(miny, c[1]);
      maxx = Math.max(maxx, c[0]);
      maxy = Math.max(maxy, c[1]);
      return;
    }
    c.forEach(walk);
  };
  walk(geometry && geometry.coordinates);
  if (!Number.isFinite(minx)) return null;
  return [minx, miny, maxx, maxy];
}

function grow(box, meters) {
  if (!box) return null;
  const dLat = meters / 110540;
  const dLng = meters / (111320 * Math.cos(((box[1] + box[3]) / 2) * Math.PI / 180));
  return [box[0] - dLng, box[1] - dLat, box[2] + dLng, box[3] + dLat];
}

function hits(box, point) {
  return box && point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

function nearLine(point, geometry, meters, box) {
  if (!hits(box, point)) return false;
  return linesOf(geometry).some(line => {
    for (let i = 1; i < line.length; i += 1) {
      if (segDistM(point, line[i - 1], line[i]) <= meters) return true;
    }
    return false;
  });
}

export function ringContains(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function geomContains(point, geometry) {
  if (!point || !geometry) return false;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(poly => ringContains(point, poly[0]) && !poly.slice(1).some(hole => ringContains(point, hole)));
}

function sameKind(a, b) {
  return a.family && a.family === b.family && a.family !== 'polygon' && a.nhom === b.nhom;
}

function duplicates(kept, row, opt) {
  if (!sameKind(kept, row)) return false;
  if (row.family === 'point') {
    return pointsOf(row.geometry).some(p => pointsOf(kept.geometry).some(q => distM(p, q) <= opt.pointMeters));
  }
  if (row.family === 'line') {
    const samples = linesOf(row.geometry).flatMap(line => sampleLine(line, 8));
    if (!samples.length) return false;
    const box = grow(kept.bbox || bboxOf(kept.geometry), opt.lineMeters);
    const hit = samples.filter(p => nearLine(p, kept.geometry, opt.lineMeters, box)).length;
    return hit / samples.length >= opt.lineCover;
  }
  return false;
}

export function mergeRecords(records, options = {}) {
  const opt = {
    pointMeters: POINT_METERS,
    lineMeters: LINE_METERS,
    lineCover: LINE_COVER,
    ...options
  };
  const sorted = records.slice().sort((a, b) => compareRank(a.rank, b.rank));
  const kept = [];
  let droppedDuplicate = 0;
  let droppedOverride = 0;
  sorted.forEach(row => {
    if (row.overrideDrop) {
      droppedOverride += 1;
      return;
    }
    if (!row.bbox) row.bbox = bboxOf(row.geometry);
    if (kept.some(item => item.schemeId !== row.schemeId && duplicates(item, row, opt))) {
      droppedDuplicate += 1;
      return;
    }
    kept.push(row);
  });
  return { kept, droppedDuplicate, droppedOverride };
}
