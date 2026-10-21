// Chuẩn hóa hướng thoát nước theo lớp đường thủy nội địa (sông, kênh OSM), tính lúc xem.
// Không ghi đè file trên bucket. Hướng gốc của mũi tên và khe tụ thủy đã theo cao độ FABDEM;
// chỉ đảo khi đầu hạ lưu xa sông, kênh hơn đầu thượng lưu rõ rệt (AWAY_M).
// Bám điểm cuối vào tuyến nước khi còn trong SNAP_M. Xa hơn FLAG_M thì đánh dấu cần rà.

export const SNAP_M = 90;
export const FLAG_M = 500;
export const AWAY_M = 40;
const CELL_M = 180;
const LAT0 = 16.47;
const D2R = Math.PI / 180;
const KX = 111320 * Math.cos(LAT0 * D2R);
const KY = 110540;

const mercX = (lng) => (lng + 180) / 360 * 256;
const mercY = (lat) => {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};

export function mercXY(lng, lat) {
  return [mercX(lng), mercY(lat)];
}

export function unmerc(x, y) {
  const lng = x / 256 * 360 - 180;
  const t = Math.exp((0.5 - y / 256) * 4 * Math.PI);
  const s = (t - 1) / (t + 1);
  return [lng, Math.asin(Math.max(-1, Math.min(1, s))) / D2R];
}

function xy(lng, lat) {
  return [lng * KX, lat * KY];
}

function ll(x, y) {
  return [x / KX, y / KY];
}

/** Feature OSM (group = water, LineString) → [{ name, kind, coords }] */
export function waterwaysFromFeatures(features) {
  const lines = [];
  (features || []).forEach(f => {
    const p = f.properties || {};
    if (p.group !== 'water') return;
    const g = f.geometry;
    if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return;
    const name = String(p.name || (p.kind === 'canal' ? 'Kênh' : 'Sông')).slice(0, 120);
    lines.push({ name, kind: p.kind || 'river', coords: g.coordinates });
  });
  return lines;
}

/** Lưới đoạn thẳng để tìm mép nước gần nhất */
export function buildWaterIndex(lines) {
  const segs = [];
  const grid = new Map();
  (lines || []).forEach(ln => {
    const c = ln.coords;
    for (let i = 1; i < c.length; i++) {
      const a = xy(c[i - 1][0], c[i - 1][1]);
      const b = xy(c[i][0], c[i][1]);
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const id = segs.length;
      segs.push({ a, b, name: ln.name, kind: ln.kind });
      const i0 = Math.floor(Math.min(a[0], b[0]) / CELL_M);
      const i1 = Math.floor(Math.max(a[0], b[0]) / CELL_M);
      const j0 = Math.floor(Math.min(a[1], b[1]) / CELL_M);
      const j1 = Math.floor(Math.max(a[1], b[1]) / CELL_M);
      for (let ix = i0; ix <= i1; ix++) {
        for (let iy = j0; iy <= j1; iy++) {
          const key = `${ix},${iy}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(id);
          else grid.set(key, [id]);
        }
      }
    }
  });
  return { segs, grid };
}

function pointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = ax + t * dx, y = ay + t * dy;
  return { d: Math.hypot(px - x, py - y), x, y };
}

/** Điểm gần nhất trên sông, kênh. maxM giới hạn tìm; null nếu không có đoạn trong tầm. */
export function nearestWater(index, lng, lat, maxM = FLAG_M * 3) {
  if (!index || !index.segs.length || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const [px, py] = xy(lng, lat);
  const limit = maxM > 0 ? maxM : FLAG_M * 3;
  const rad = Math.ceil(limit / CELL_M);
  const ix = Math.floor(px / CELL_M), iy = Math.floor(py / CELL_M);
  let best = null;
  const seen = new Set();
  for (let r = 0; r <= rad; r++) {
    if (best && best.dist + CELL_M < r * CELL_M) break;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const bucket = index.grid.get(`${ix + dx},${iy + dy}`);
        if (!bucket) continue;
        bucket.forEach(id => {
          if (seen.has(id)) return;
          seen.add(id);
          const s = index.segs[id];
          const hit = pointSeg(px, py, s.a[0], s.a[1], s.b[0], s.b[1]);
          if (hit.d > limit) return;
          if (!best || hit.d < best.dist) best = { dist: hit.d, x: hit.x, y: hit.y, name: s.name, kind: s.kind };
        });
      }
    }
  }
  if (!best) return null;
  const p = ll(best.x, best.y);
  best.lng = p[0];
  best.lat = p[1];
  return best;
}

/**
 * Đường [[lng, lat], …], hạ lưu ở điểm cuối.
 * mode 'arrow': mũi tên hướng thoát nước mặt — đảo, bám, đánh dấu.
 * mode 'outfall': cửa xả khe tụ thủy (điểm cuối không nối tiếp) — cùng quy tắc, vì đoạn đã là hạ lưu.
 */
export function normalizePolyline(coords, index, mode = 'arrow') {
  const blank = { coords, snapped: false, reoriented: false, flag: '', receiver: '', dist: null };
  if (!index || !Array.isArray(coords) || coords.length < 2) return blank;
  const d0 = nearestWater(index, coords[0][0], coords[0][1]);
  const d1 = nearestWater(index, coords[coords.length - 1][0], coords[coords.length - 1][1]);
  let pts = coords.map(p => [p[0], p[1]]);
  let reoriented = false;
  let down = d1;
  if (d0 && d1 && d0.dist + AWAY_M < d1.dist) {
    pts.reverse();
    reoriented = true;
    down = d0;
  }
  let snapped = false;
  if (down && down.dist <= SNAP_M && down.dist >= 1) {
    pts[pts.length - 1] = [down.lng, down.lat];
    snapped = true;
  }
  const dist = down ? down.dist : null;
  let flag = '';
  if (dist == null || dist > FLAG_M) flag = 'far';
  else if (!snapped) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    const vx = bx - ax, vy = by - ay;
    const wx = down.x - bx, wy = down.y - by;
    const vl = Math.hypot(vx, vy), wl = Math.hypot(wx, wy);
    if (vl > 1 && wl > 15 && (vx * wx + vy * wy) / (vl * wl) < 0) flag = 'away';
  }
  const receiver = down && dist != null && dist <= FLAG_M ? down.name : (down ? down.name : '');
  return {
    coords: pts,
    snapped,
    reoriented,
    flag,
    receiver: flag === 'far' ? (down ? down.name : '') : receiver,
    dist: dist == null ? null : Math.round(dist)
  };
}

function quantKey(lng, lat) {
  return `${Math.round(lng * 1e4)},${Math.round(lat * 1e4)}`;
}

function nearCount(map, lng, lat) {
  const x = Math.round(lng * 1e4), y = Math.round(lat * 1e4);
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) n += map.get(`${x + dx},${y + dy}`) || 0;
  }
  return n;
}

/** Chỉ số các đường có điểm cuối không trùng điểm đầu đường khác — cửa xả, không phải đoạn giữa mạng. */
export function outfallIndexes(polylines) {
  const starts = new Map();
  const ends = (polylines || []).map(line => {
    const s = line[0], e = line[line.length - 1];
    const sk = quantKey(s[0], s[1]);
    starts.set(sk, (starts.get(sk) || 0) + 1);
    return { s, e };
  });
  const ids = [];
  (polylines || []).forEach((line, i) => {
    if (!line || line.length < 2) return;
    const { s, e } = ends[i];
    let links = nearCount(starts, e[0], e[1]);
    if (nearCount(new Map([[quantKey(s[0], s[1]), 1]]), e[0], e[1])) links -= 1;
    if (links <= 0) ids.push(i);
  });
  return ids;
}

/** Đỉnh vành lưu vực [[lng, lat], …] → sông, kênh gần nhất (cửa xả). */
export function nearestOnRing(lngLats, index) {
  if (!index || !lngLats || !lngLats.length) return null;
  const step = lngLats.length > 600 ? Math.ceil(lngLats.length / 600) : 1;
  let best = null;
  for (let i = 0; i < lngLats.length; i += step) {
    const hit = nearestWater(index, lngLats[i][0], lngLats[i][1], FLAG_M * 2);
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }
  return best;
}

export function summarize(rows) {
  let snapped = 0, reoriented = 0, flagged = 0;
  (rows || []).forEach(r => {
    if (r.snapped) snapped++;
    if (r.reoriented) reoriented++;
    if (r.flag) flagged++;
  });
  return { snapped, reoriented, flagged, total: (rows || []).length };
}
