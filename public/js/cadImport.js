// Nhập lô đất hạ tầng từ file CAD (DXF): HATCH / polyline khép kín, hệ VN-2000 → tâm (WGS84), diện tích, loại theo tên layer.
// Chỉ đọc & chuyển đổi — không ghi dữ liệu; các phép tính chỉ tiêu phía sau giữ nguyên.

// ============================ HỆ TỌA ĐỘ VN-2000 → WGS84 ============================

// 7 tham số VN-2000 → WGS84 (QĐ 05/2007/QĐ-BTNMT), quy ước Position Vector như proj4 towgs84
const VN2000_TOWGS84 = [-191.90441429, -39.30318279, -111.45032835, -0.00928836, 0.01975479, -0.00427372, 0.252906278];

export const CRS_PRESETS = {
  HUE_3: { label: 'VN-2000 TT-Huế (KTT 107°00\', múi 3°)', lon0: 107, k0: 0.9999 },
  UTM48_6: { label: 'VN-2000 UTM múi 48 (KTT 105°, múi 6°)', lon0: 105, k0: 0.9996 }
};

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const FALSE_EASTING = 500000;
const DEG = Math.PI / 180;
const SEC = DEG / 3600;

function tmInverse(x, y, lon0, k0) {
  const M = y / k0;
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const C1 = EP2 * c * c, T1 = t * t;
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
  const D = (x - FALSE_EASTING) / (N1 * k0);
  const lat = phi1 - (N1 * t / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 * DEG + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [lat, lon];
}

function toEcef(lat, lon) {
  const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - E2) * Math.sin(lat)];
}

function fromEcef(X, Y, Z) {
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - E2));
  for (let i = 0; i < 6; i++) {
    const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    lat = Math.atan2(Z + E2 * N * Math.sin(lat), p);
  }
  return [lat, Math.atan2(Y, X)];
}

/** Tọa độ phẳng VN-2000 (E = X CAD, N = Y CAD, mét) → [lat, lng] WGS84 */
export function vn2000ToWgs84(easting, northing, crs = CRS_PRESETS.HUE_3) {
  const [lat, lon] = tmInverse(easting, northing, crs.lon0, crs.k0);
  const [x, y, z] = toEcef(lat, lon);
  const [dx, dy, dz, rx, ry, rz, s] = VN2000_TOWGS84;
  const m = 1 + s * 1e-6, Rx = rx * SEC, Ry = ry * SEC, Rz = rz * SEC;
  const X = m * (x - Rz * y + Ry * z) + dx;
  const Y = m * (Rz * x + y - Rx * z) + dy;
  const Z = m * (-Ry * x + Rx * y + z) + dz;
  const [la, lo] = fromEcef(X, Y, Z);
  return [la / DEG, lo / DEG];
}

function tmForward(lat, lon, lon0, k0) {
  const s = Math.sin(lat), c = Math.cos(lat), t = Math.tan(lat);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t, C = EP2 * c * c, Aa = (lon - lon0 * DEG) * c;
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * lat
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * lat)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * lat));
  const x = FALSE_EASTING + k0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120);
  const y = k0 * (M + N * t * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  return [x, y];
}

/** [lat, lng] WGS84 → tọa độ phẳng VN-2000 [E, N] (mét); 7 tham số đảo dấu (sai lệch < 1 cm so với phép nghịch đảo chặt) */
export function wgs84ToVn2000(lat, lng, crs = CRS_PRESETS.HUE_3) {
  const [x, y, z] = toEcef(lat * DEG, lng * DEG);
  const [dx, dy, dz, rx, ry, rz, s] = VN2000_TOWGS84.map(v => -v);
  const m = 1 + s * 1e-6, Rx = rx * SEC, Ry = ry * SEC, Rz = rz * SEC;
  const X = m * (x - Rz * y + Ry * z) + dx;
  const Y = m * (Rz * x + y - Rx * z) + dy;
  const Z = m * (-Ry * x + Rx * y + z) + dz;
  const [la, lo] = fromEcef(X, Y, Z);
  return tmForward(la, lo, crs.lon0, crs.k0);
}

// ============================ ĐỌC DXF ============================

const ARC_STEP = 2 * DEG; // sai số diện tích cung ≈ 0,02%

function readTags(text) {
  const lines = text.split(/\r?\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    tags.push([code, lines[i + 1].trim()]);
  }
  return tags;
}

// Cung theo bulge (tan(θ/4), dương = ngược chiều kim đồng hồ) từ p1 tới p2, không gồm p2
function bulgePoints(p1, p2, bulge) {
  if (!bulge) return [p1];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const k = (1 - bulge * bulge) / (4 * bulge);
  const cx = (p1[0] + p2[0]) / 2 - dy * k, cy = (p1[1] + p2[1]) / 2 + dx * k;
  const r = Math.hypot(p1[0] - cx, p1[1] - cy);
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const sweep = 4 * Math.atan(bulge);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + sweep * i / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function bulgeRing(verts, bulges) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    out.push(...bulgePoints(verts[i], verts[(i + 1) % verts.length], bulges[i] || 0));
  }
  return out;
}

// Cung tròn / elip của cạnh HATCH; chiều kim đồng hồ (ccw = 0) lưu góc theo chiều ngược lại
function arcPoints(cx, cy, rx, ry, rot, a0deg, a1deg, ccw) {
  let a0 = a0deg * DEG, a1 = a1deg * DEG;
  if (!ccw) { a0 = -a0; a1 = -a1; }
  let sweep = a1 - a0;
  if (ccw && sweep <= 0) sweep += 2 * Math.PI;
  if (!ccw && sweep >= 0) sweep -= 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * i / n;
    const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
    pts.push([cx + ex * cr - ey * sr, cy + ex * sr + ey * cr]);
  }
  return pts;
}

function readHatch(tags, i, stats) {
  const ent = { kind: 'HATCH', layer: '0', rings: [], sources: [] };
  const n = tags.length;
  const val = (j) => parseFloat(tags[j][1]);
  // Phần đầu: tới mã 91 (số đường biên)
  let pathCount = 0;
  for (; i < n && tags[i][0] !== 0; i++) {
    const [code, v] = tags[i];
    if (code === 8) ent.layer = v;
    else if (code === 91) { pathCount = parseInt(v, 10) || 0; i++; break; }
  }
  // Handle đối tượng biên (330 sau 97) — polyline biên liên kết với hatch sẽ không tính thành lô riêng
  const takeSource = (j) => { if (tags[j][0] === 330 && tags[j][1] !== '0') ent.sources.push(tags[j][1]); };
  for (let p = 0; p < pathCount && i < n && tags[i][0] !== 0; p++) {
    while (i < n && tags[i][0] !== 92 && tags[i][0] !== 0) { takeSource(i); i++; }
    if (i >= n || tags[i][0] === 0) break;
    const flag = parseInt(tags[i][1], 10); i++;
    let ring = [];
    if (flag & 2) {
      let hasBulge = false, count = 0;
      for (; i < n && tags[i][0] !== 93; i++) if (tags[i][0] === 72) hasBulge = tags[i][1] !== '0';
      count = parseInt(tags[i][1], 10) || 0; i++;
      const verts = [], bulges = [];
      while (verts.length < count && i < n && tags[i][0] !== 0) {
        if (tags[i][0] === 10) { verts.push([val(i), val(i + 1)]); bulges.push(0); i += 2; }
        else if (tags[i][0] === 42 && hasBulge) { bulges[bulges.length - 1] = val(i); i++; }
        else i++;
      }
      if (i < n && tags[i][0] === 42 && hasBulge) { bulges[bulges.length - 1] = val(i); i++; }
      ring = bulgeRing(verts, bulges);
    } else {
      while (i < n && tags[i][0] !== 93 && tags[i][0] !== 0) i++;
      const edgeCount = parseInt(tags[i][1], 10) || 0; i++;
      for (let e = 0; e < edgeCount && i < n; e++) {
        while (i < n && tags[i][0] !== 72 && tags[i][0] !== 0) i++;
        const type = parseInt(tags[i][1], 10); i++;
        const g = {};
        const ctrl = [], fit = [];
        // Đọc tag của cạnh tới khi gặp cạnh kế tiếp (72) hoặc hết đường biên (97)
        for (; i < n && tags[i][0] !== 72 && tags[i][0] !== 97 && tags[i][0] !== 0; i++) {
          const code = tags[i][0];
          if (type === 4 && code === 10) ctrl.push([val(i), val(i + 1)]);
          else if (type === 4 && code === 11) fit.push([val(i), val(i + 1)]);
          else if (g[code] === undefined) g[code] = val(i);
        }
        if (type === 1) ring.push([g[10], g[20]], [g[11], g[21]]);
        else if (type === 2) ring.push(...arcPoints(g[10], g[20], g[40], g[40], 0, g[50], g[51], g[73] !== 0));
        else if (type === 3) {
          const mx = g[11], my = g[21], rx = Math.hypot(mx, my);
          ring.push(...arcPoints(g[10], g[20], rx, rx * g[40], Math.atan2(my, mx), g[50], g[51], g[73] !== 0));
        } else if (type === 4) {
          stats.splineEdges++;
          ring.push(...(fit.length >= 2 ? fit : ctrl));
        }
      }
    }
    ring = dedupeRing(ring);
    if (ring.length >= 3) ent.rings.push(ring);
  }
  for (; i < n && tags[i][0] !== 0; i++) takeSource(i);
  return [ent, i];
}

function readLwPolyline(tags, i) {
  const ent = { kind: 'LWPOLYLINE', layer: '0', handle: null, closed: false, rings: [] };
  const verts = [], bulges = [];
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    const [code, v] = tags[i];
    if (code === 5) ent.handle = v;
    else if (code === 8) ent.layer = v;
    else if (code === 70) ent.closed = (parseInt(v, 10) & 1) === 1;
    else if (code === 10) { verts.push([parseFloat(v), NaN]); bulges.push(0); }
    else if (code === 20 && verts.length) verts[verts.length - 1][1] = parseFloat(v);
    else if (code === 42 && bulges.length) bulges[bulges.length - 1] = parseFloat(v);
  }
  const ring = dedupeRing(ent.closed || isClosedByPoints(verts) ? bulgeRing(verts, bulges) : []);
  if (ring.length >= 3) ent.rings.push(ring);
  return [ent, i];
}

function readPolyline(tags, i) {
  const ent = { kind: 'POLYLINE', layer: '0', handle: null, closed: false, rings: [] };
  let flags = 0;
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    if (tags[i][0] === 5) ent.handle = tags[i][1];
    else if (tags[i][0] === 8) ent.layer = tags[i][1];
    else if (tags[i][0] === 70) flags = parseInt(tags[i][1], 10);
  }
  ent.closed = (flags & 1) === 1;
  const verts = [], bulges = [];
  while (i < tags.length && tags[i][1] === 'VERTEX') {
    i++;
    let x = NaN, y = NaN, b = 0;
    for (; i < tags.length && tags[i][0] !== 0; i++) {
      if (tags[i][0] === 10) x = parseFloat(tags[i][1]);
      else if (tags[i][0] === 20) y = parseFloat(tags[i][1]);
      else if (tags[i][0] === 42) b = parseFloat(tags[i][1]);
    }
    verts.push([x, y]); bulges.push(b);
  }
  if (i < tags.length && tags[i][1] === 'SEQEND') for (i++; i < tags.length && tags[i][0] !== 0; i++);
  const isMesh = (flags & (16 | 64)) !== 0;
  const ring = !isMesh && (ent.closed || isClosedByPoints(verts)) ? dedupeRing(bulgeRing(verts, bulges)) : [];
  if (ring.length >= 3) ent.rings.push(ring);
  return [ent, i];
}

function isClosedByPoints(verts) {
  if (verts.length < 4) return false;
  const a = verts[0], b = verts[verts.length - 1];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
}

function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

function readPoint(tags, i) {
  const ent = { kind: 'POINT', layer: '0', rings: [], pt: null };
  let x = NaN, y = NaN;
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    const [code, v] = tags[i];
    if (code === 8) ent.layer = v;
    else if (code === 10) x = parseFloat(v);
    else if (code === 20) y = parseFloat(v);
  }
  if (Number.isFinite(x) && Number.isFinite(y)) ent.pt = [x, y];
  return [ent, i];
}

// Tên hiển thị của đối tượng DXF bị bỏ qua (chỉ nhận HATCH và polyline khép kín)
const DXF_SKIP_LABEL = { LINE: 'line', TEXT: 'text', MTEXT: 'mtext', INSERT: 'block', ATTDEF: 'attdef', DIMENSION: 'dimension', POINT: 'point' };

/** Thêm 1 đối tượng bị bỏ qua vào stats.skipped ({ nhãn: số lượng }) */
export function countSkipped(stats, label, n = 1) {
  stats.skipped[label] = (stats.skipped[label] || 0) + n;
}

/**
 * Đọc DXF (văn bản) → { entities: [{kind, layer, rings}], stats } — chỉ HATCH và LWPOLYLINE / POLYLINE khép kín trong ENTITIES;
 * layer đã có hatch thì bỏ polyline kín của layer đó (ranh hatch, đường bao công trình...).
 * Mọi đối tượng khác (line, pline hở, point, text, mtext, dim, block...) đếm vào stats.skipped.
 */
export function parseDxf(text) {
  const tags = readTags(text);
  const stats = { hatch: 0, polyline: 0, insert: 0, splineEdges: 0, skipped: {}, insUnits: null };
  const entities = [];
  let section = null;
  for (let i = 0; i < tags.length;) {
    const [code, v] = tags[i];
    if (code === 9 && v === '$INSUNITS') { stats.insUnits = parseInt(tags[i + 1] && tags[i + 1][1], 10); i += 2; continue; }
    if (code !== 0) { i++; continue; }
    if (v === 'SECTION') { section = tags[i + 1] && tags[i + 1][1]; i += 2; continue; }
    if (v === 'ENDSEC') { section = null; i++; continue; }
    if (section !== 'ENTITIES') { i++; continue; }
    let ent = null;
    if (v === 'HATCH') { [ent, i] = readHatch(tags, i + 1, stats); }
    else if (v === 'LWPOLYLINE') { [ent, i] = readLwPolyline(tags, i + 1); }
    else if (v === 'POLYLINE') { [ent, i] = readPolyline(tags, i + 1); }
    else {
      if (v === 'INSERT') stats.insert++;
      countSkipped(stats, DXF_SKIP_LABEL[v] || v.toLowerCase());
      for (i++; i < tags.length && tags[i][0] !== 0; i++);
      continue;
    }
    if (ent.rings.length) {
      entities.push(ent);
      if (ent.kind === 'HATCH') stats.hatch++; else stats.polyline++;
    } else countSkipped(stats, ent.kind === 'HATCH' ? 'hatch lỗi biên' : 'pline hở');
  }
  const hatchLayers = new Set(entities.filter(e => e.kind === 'HATCH').map(e => e.layer));
  const kept = entities.filter(e => e.kind === 'HATCH' || !hatchLayers.has(e.layer));
  const dropped = entities.length - kept.length;
  if (dropped) {
    stats.polyline -= dropped;
    countSkipped(stats, 'polyline kín ở layer đã có hatch', dropped);
  }
  return { entities: kept, stats };
}

// ============================ HÌNH HỌC (mét, VN-2000) ============================

function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return s / 2;
}

function ringCentroid(r) {
  let cx = 0, cy = 0, a = 0;
  const [ox, oy] = r[0];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const x0 = r[j][0] - ox, y0 = r[j][1] - oy, x1 = r[i][0] - ox, y1 = r[i][1] - oy;
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return [ox, oy];
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x, y, poly) {
  if (!pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) return false;
  return true;
}

function distToSegments(x, y, poly) {
  let best = Infinity;
  for (const r of poly) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

// Điểm nằm sâu trong lô (lô chữ L/U có trọng tâm rơi ra ngoài): quét lưới thô rồi tinh chỉnh
function interiorPoint(poly) {
  const c = ringCentroid(poly[0]);
  if (pointInPolygon(c[0], c[1], poly)) return c;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly[0]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  let best = null, bestD = -1;
  let step = Math.max(maxX - minX, maxY - minY) / 24;
  let x0 = minX, y0 = minY, x1 = maxX, y1 = maxY;
  for (let pass = 0; pass < 3 && step > 0.05; pass++) {
    for (let x = x0; x <= x1; x += step) {
      for (let y = y0; y <= y1; y += step) {
        if (!pointInPolygon(x, y, poly)) continue;
        const d = distToSegments(x, y, poly);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (!best) break;
    x0 = best[0] - step; x1 = best[0] + step; y0 = best[1] - step; y1 = best[1] + step;
    step /= 6;
  }
  return best || c;
}

// Ghép vòng ngoài / lỗ theo độ lồng nhau: vòng nằm trong số lẻ vòng khác là lỗ.
// Thử bằng 1 điểm nằm hẳn trong vòng (không dùng đỉnh): hatch bị cắt thành nhiều mảnh sát nhau có đỉnh nằm trên cạnh chung.
function buildPolygons(rings) {
  const info = rings.map(r => ({ r, area: Math.abs(ringArea(r)), depth: 0, parent: null, probe: interiorPoint([r]) }));
  info.sort((a, b) => b.area - a.area);
  info.forEach((ri, idx) => {
    const [x, y] = ri.probe;
    for (let k = idx - 1; k >= 0; k--) {
      if (pointInRing(x, y, info[k].r)) { ri.parent = info[k]; ri.depth = info[k].depth + 1; break; }
    }
  });
  const polys = [];
  info.filter(ri => ri.depth % 2 === 0).forEach(outer => {
    const holes = info.filter(ri => ri.parent === outer && ri.depth % 2 === 1);
    polys.push({ rings: [outer.r, ...holes.map(h => h.r)], area: outer.area - holes.reduce((s, h) => s + h.area, 0) });
  });
  return polys;
}

// ============================ LAYER → LOẠI HẠ TẦNG ============================

// Tiền tố ID_DoiTuong → mã loại webapp (khớp constants.codeMap phía server)
export const LAYER_PREFIXES = {
  CV_DT: '1-CV', CV_DV: '1-CV', CV: '1-CV',
  BDX_DT: '2-BDX', BDX_DV: '2-BDX', BDX: '2-BDX',
  MN: '3-MN', TH: '4-TH', THPT: '4-TH', THCS: '5-THCS',
  YT_DT: '7-YT', YT_DV: '7-YT', YT: '7-YT',
  VH_DT: '8-VH', VH_DV: '8-VH', VH: '8-VH',
  TM_DT: '9-TM', TM_DV: '9-TM', TM: '9-TM',
  CSD: '12-CSD'
};
const PREFIX_KEYS = Object.keys(LAYER_PREFIXES).sort((a, b) => b.length - a.length);

// ---- Tên layer theo TT 16/2025/TT-BXD (Phụ lục I): <tiền tố>_<loại đất>[_<hậu tố>] ----
// Tiền tố → cột quy mô: HT_ → QuyMo_HT; QHDD_ / QHDH_ (QHC, QHPK) và QH_ (QHCT 1/500) → QuyMo_QH
const TT16_PHASE = { HT: 'HT', QHDD: 'QH', QHDH: 'QH', QH: 'QH' };
// Loại đất TT16 thuộc 10 nhóm webapp (viết hoa, không dấu) → mã gốc; urban: loại đất vốn cấp đô thị khi không có hậu tố.
// SCHOOL: Truonghoc cần hậu tố _MN / _TH / _THCS, thiếu thì admin chọn từng lô.
const TT16_LANDS = {
  DAT_DD_CAYXANHCCDOTHI: { code: 'CV', urban: true },
  DAT_HTXH_CAYXANHCC: { code: 'CV' }, DAT_CTHTXH_CAYXANHCC: { code: 'CV' }, DAT_KXD_CAYXANHCC: { code: 'CV' },
  DAT_CAYXANHCC: { code: 'CV' },
  DAT_HTKT_BAIDOXE: { code: 'BDX' }, DAT_CTHTKT_BAIDOXE: { code: 'BDX' },
  DAT_DD_TRUONGTHPT: { code: 'THPT' }, DAT_HTXH_TRUONGTHPT: { code: 'THPT' }, DAT_CTHTXH_TRUONGTHPT: { code: 'THPT' },
  DAT_DD_TRUONGHOC: { code: 'SCHOOL' }, DAT_HTXH_TRUONGHOC: { code: 'SCHOOL' }, DAT_CTHTXH_TRUONGHOC: { code: 'SCHOOL' },
  DAT_NDD_YTE: { code: 'YT', urban: true },
  DAT_HTXH_YTE: { code: 'YT' }, DAT_CTHTXH_YTE: { code: 'YT' }, DAT_KXD_YTE: { code: 'YT' },
  DAT_NDD_VANHOATHETHAO: { code: 'VH', urban: true },
  DAT_HTXH_VANHOA: { code: 'VH' }, DAT_HTXH_THEDUCTHETHAO: { code: 'VH' },
  DAT_CTHTXH_VANHOA: { code: 'VH' }, DAT_CTHTXH_THEDUCTHETHAO: { code: 'VH' }, DAT_KXD_VANHOATHETHAO: { code: 'VH' },
  DAT_CTHTXD_THUONGMAIDV: { code: 'TM', market: true }, DAT_CTHTXH_THUONGMAIDV: { code: 'TM', market: true },
  DAT_DICHVU: { code: 'TM', market: true }
};
const TT16_URBAN_SUFFIX = new Set(['CT', 'CV', 'QG']);
const TT16_SCHOOL_SUFFIX = new Set(['MN', 'TH', 'THCS']);
// _CHO / _TM (_TTTM): quy ước nội bộ (ngoài TT16) đánh dấu lô dịch vụ là chợ / trung tâm thương mại.
// Lô dịch vụ, thương mại dịch vụ không có hậu tố này (market) chỉ vào nhóm TM khi tên là chợ / siêu thị / TTTM.
const MARKET_SUFFIX = new Set(['CHO', 'TM', 'TTTM']);
const TT16_SUFFIX = new Set([...TT16_URBAN_SUFFIX, ...TT16_SCHOOL_SUFFIX, 'DVO', ...MARKET_SUFFIX]);
// Cách viết khác của cùng loại đất (dữ liệu gServer Huế): "Cayxanhcongcong" = "CayxanhCC"
const TT16_TOKEN_ALIAS = { CAYXANHCONGCONG: 'CAYXANHCC' };
// Mã có biến thể cấp đô thị (_DT) trong LAYER_PREFIXES
const URBAN_CODES = new Set(['CV', 'BDX', 'YT', 'VH', 'TM']);

/**
 * Tên layer TT16 → null (không theo TT16) hoặc { tt16, phase (HT/QH), stage (HT/QHDD/QHDH/QH), ... }:
 *   - thuộc 10 nhóm: thêm { prefix, type, nhom } như layerToType; marketCheck: lô dịch vụ cần tên chợ / siêu thị / TTTM
 *   - Truonghoc thiếu hậu tố cấp trường: { school: true }
 *   - loại đất TT16 ngoài 10 nhóm (hoặc hậu tố lạ): { other: true }
 * Hậu tố _CT / _CV / _QG → cấp đô thị, _DVO → cấp đơn vị ở; không có hậu tố → theo loại đất.
 * Dấu gạch ngang tính như gạch dưới (HT-DAT-HTXH-Yte = HT_DAT_HTXH_Yte).
 */
export function tt16Layer(layerName) {
  const parts = String(layerName || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'D').toUpperCase().split(/[_\s-]+/).filter(Boolean)
    .map(t => TT16_TOKEN_ALIAS[t] || t);
  const stage = parts[0];
  if (!TT16_PHASE[stage] || parts[1] !== 'DAT') return null;
  const phase = TT16_PHASE[stage];
  const core = parts.slice(1);
  const suffixes = [];
  while (core.length > 2 && suffixes.length < 2 && !TT16_LANDS[core.join('_')] && TT16_SUFFIX.has(core[core.length - 1])) {
    suffixes.unshift(core.pop());
  }
  const land = TT16_LANDS[core.join('_')];
  if (!land) return { tt16: true, other: true, phase, stage };
  let code = land.code;
  if (code === 'SCHOOL') {
    const level = suffixes.find(s => TT16_SCHOOL_SUFFIX.has(s));
    if (!level) return { tt16: true, school: true, phase, stage };
    code = level;
  }
  const urban = suffixes.some(s => TT16_URBAN_SUFFIX.has(s)) || (!suffixes.includes('DVO') && !!land.urban);
  const prefix = urban && URBAN_CODES.has(code) ? `${code}_DT` : code;
  const nhom = prefix === 'THPT' || prefix.endsWith('_DT') ? 'Cấp đô thị' : 'Cấp đơn vị ở';
  const marketCheck = !!land.market && !suffixes.some(s => MARKET_SUFFIX.has(s));
  return { tt16: true, phase, stage, prefix, type: LAYER_PREFIXES[prefix], nhom, marketCheck };
}

/**
 * Tiền tố tên file DXF: "QH-TTPN.dxf" → "QH", "HT_AnCuu.dxf" → "HT".
 * Chữ cái ngay sau HT/QH (VD "QHTTPN.dxf") không tính là tiền tố.
 */
export function filePhaseFromName(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m = base.match(/^(HT|QH)(?![A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Tên layer → { prefix, type, nhom } hoặc null. Nhận tên TT16 (tt16Layer), đúng mã webapp,
 * mã kèm tiền tố / hậu tố giai đoạn (HT_CV, CV_HT, QH_MN) hoặc phần đuôi sau dấu _ - khoảng trắng.
 */
export function layerToType(layerName) {
  const tt = tt16Layer(layerName);
  if (tt) return tt.prefix ? { prefix: tt.prefix, type: tt.type, nhom: tt.nhom } : null;
  const name = String(layerName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const core = name.replace(/^(?:QHDD|QHDH|QH|HT)_/, '').replace(/_(?:QHDD|QHDH|QH|HT)$/, '');
  const prefix = LAYER_PREFIXES[core] ? core : PREFIX_KEYS.find(k => core.startsWith(k + '_'));
  if (!prefix) return null;
  const nhom = prefix === 'THPT' || prefix.endsWith('_DT') ? 'Cấp đô thị' : 'Cấp đơn vị ở';
  return { prefix, type: LAYER_PREFIXES[prefix], nhom };
}

// ---- Thuộc tính lô quy hoạch (gServer Huế; DBF cắt tên trường còn 10 ký tự: hesosddat, matdoxd, kyhieulod) ----

const PLAN_FIELDS = {
  floors: /^(tang_?cao|so_?tang)$/i,
  coverage: /^(mat_?do_?(xay_?dung|xd)|mdxd)$/i,
  far: /^(he_?so_?(su_?dung_?dat|sd_?dat|sdd)|hssdd)$/i
};
const LOT_CODE_FIELD = /^ky_?hieu_?lo(_?d(at?)?)?$/i;

function attrOf(attrs, re) {
  const key = attrs && Object.keys(attrs).find(k => re.test(k));
  return key ? String(attrs[key] ?? '').trim() : '';
}

/** Chỉ tiêu quy hoạch → { floors, coverage, far } (chuỗi, '' = chưa có) hoặc null. gServer ghi 0 khi bỏ trống nên 0 = chưa có */
export function planAttrsOf(attrs) {
  const out = {};
  let any = false;
  Object.entries(PLAN_FIELDS).forEach(([k, re]) => {
    const v = attrOf(attrs, re).replace(',', '.');
    out[k] = v && Number(v) !== 0 ? v : '';
    if (out[k]) any = true;
  });
  return any ? out : null;
}

/** Ký hiệu lô quy hoạch, VD "TM.A-13" */
export const lotCodeOf = (attrs) => attrOf(attrs, LOT_CODE_FIELD);

// "Trung tâm dịch vụ, thương mại" (nhãn chung) không tính là trung tâm thương mại
const MARKET_RE = /(^|[^\p{L}])(chợ|siêu thị|trung tâm thương mại|tttm)(?!\p{L})/iu;
export const isMarketName = (s) => MARKET_RE.test(String(s || '').normalize('NFC'));

const SCHOOL_NAME_RULES = [
  ['THPT', /trung học phổ thông|(^|[^\p{L}])thpt(?!\p{L})/iu],
  ['THCS', /trung học cơ sở|(^|[^\p{L}])thcs(?!\p{L})/iu],
  ['TH', /tiểu học/iu],
  ['MN', /mầm non|mẫu giáo|nhà trẻ/iu]
];

/** Cấp trường theo tên (VD "Trường tiểu học Lê Lợi"), không rõ thì theo tiền tố ký hiệu lô (MN. / TH. / THCS. / THPT.); tên gộp nhiều cấp → '' */
export function schoolLevelOf(names, lotCode) {
  const hits = new Set();
  names.forEach(n => {
    const s = String(n || '').normalize('NFC');
    SCHOOL_NAME_RULES.forEach(([lv, re]) => { if (re.test(s)) hits.add(lv); });
  });
  if (hits.size) return hits.size === 1 ? [...hits][0] : '';
  const m = String(lotCode || '').match(/^(MN|THPT|THCS|TH)(?=[.\-_\s\d])/i);
  return m ? m[1].toUpperCase() : '';
}

/**
 * Gắn điểm chức năng ({ lat, lng, name, kind } WGS84) vào mọi lô vùng chứa nó → p.points; trả về số điểm nằm ngoài mọi lô.
 * Lô HT và lô QH chồng nhau cùng nhận điểm.
 */
export function attachPoints(parcels, points) {
  const lots = parcels.filter(p => p.kind !== 'POINT' && p.polygons.length)
    .map(p => ({ p, b: bboxOfRings(p.polygons.map(poly => poly[0])) }));
  parcels.forEach(p => { p.points = []; });
  let outside = 0;
  points.forEach(pt => {
    const hits = lots.filter(({ p, b }) => pt.lng >= b[0] && pt.lng <= b[2] && pt.lat >= b[1] && pt.lat <= b[3]
      && inPolys(pt.lng, pt.lat, p.polygons));
    if (hits.length) hits.forEach(({ p }) => p.points.push(pt));
    else outside++;
  });
  return outside;
}

// ============================ LÔ ĐẤT ============================

const E_RANGE = [350000, 900000];
const N_RANGE = [1650000, 1950000];
const inRange = (v, r) => v >= r[0] && v <= r[1];

/** Tọa độ đầu tiên của thực thể (đỉnh đầu của vòng, hoặc chính điểm với thực thể POINT) */
export const firstXY = (e) => e.pt || e.rings[0][0];

/** Phát hiện đảo X/Y và đơn vị mm từ vài điểm mẫu: trả về hàm (x, y) → [E, N] mét, kèm ghi chú */
export function detectAxes(entities) {
  const sample = [];
  for (const e of entities) { sample.push(firstXY(e)); if (sample.length >= 50) break; }
  const tries = [
    { note: '', f: (x, y) => [x, y] },
    { note: 'đảo X/Y', f: (x, y) => [y, x] },
    { note: 'đơn vị mm', f: (x, y) => [x / 1000, y / 1000] },
    { note: 'đảo X/Y, đơn vị mm', f: (x, y) => [y / 1000, x / 1000] }
  ];
  for (const t of tries) {
    const ok = sample.filter(([x, y]) => { const [E, N] = t.f(x, y); return inRange(E, E_RANGE) && inRange(N, N_RANGE); }).length;
    if (sample.length && ok >= sample.length * 0.9) return { ...t, valid: true };
  }
  return { ...tries[0], valid: false };
}

// Thực thể dạng vùng tô (HATCH trong DXF, Polygon trong KML) được ưu tiên hơn đường khép kín trùng với nó
const FILL_KINDS = new Set(['HATCH', 'POLYGON']);

function metersApart(a, b) {
  const k = 111320;
  return Math.hypot((a.lat - b.lat) * k, (a.lng - b.lng) * k * Math.cos(a.lat * DEG));
}

// Bỏ đỉnh cách đỉnh giữ liền trước dưới 0,2 m (sai số cho phép khi rút gọn hatch)
const VERTEX_GAP_M = 0.2;
function simplifyRing(ring) {
  if (!ring || ring.length < 4) return ring;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const closed = same(ring[0], ring[ring.length - 1]);
  const pts = closed ? ring.slice(0, -1) : ring.slice();
  const gap = (a, b) => {
    const lat = ((a[1] + b[1]) / 2) * DEG;
    return Math.hypot((a[1] - b[1]) * 111320, (a[0] - b[0]) * 111320 * Math.cos(lat));
  };
  const kept = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (gap(kept[kept.length - 1], pts[i]) >= VERTEX_GAP_M) kept.push(pts[i]);
  }
  while (kept.length > 3 && gap(kept[0], kept[kept.length - 1]) < VERTEX_GAP_M) kept.pop();
  if (kept.length < 3) return ring;
  return [...kept, kept[0]];
}

/**
 * Thực thể → lô đất: { layer, name, attrs, prefix, type, nhom, area (m²), lat, lng, polygons ([[lng,lat]...] theo vòng) }
 * project(ent) → { toXY(x, y) → [X, Y] mét trên mặt phẳng, toLatLng(X, Y) → [lat, lng] }.
 * Đường khép kín trùng với vùng tô cùng layer (cùng tâm < 1 m, diện tích lệch < 1%) được bỏ để không đếm 2 lần.
 * Thực thể POINT → công trình dạng điểm (area 0, polygons []); điểm nằm trong lô cùng loại, cùng giai đoạn của file được bỏ.
 * Layer TT16: lô mang phase / stage theo tiền tố; Truonghoc thiếu hậu tố hoặc khớp thủ công SCHOOL_PICK → lô chờ chọn cấp
 * (school, pending, type SCHOOL_PENDING); khớp thủ công MARKET_PICK → lô chờ xác nhận chợ / TTTM (market, pending);
 * loại đất TT16 ngoài 13 nhóm hạ tầng và layer không nhận diện → lô đất (land), ghi sheet DXF của đồ án.
 */
export const SCHOOL_PENDING = 'SCHOOL';
// Mã khớp thủ công "Trường học – chọn cấp từng lô": lô vào khung duyệt cấp trường như Truonghoc thiếu hậu tố
export const SCHOOL_PICK = 'TRUONG';
// Mã khớp thủ công "Chợ, TTTM – chọn từng lô": lô dịch vụ / thương mại chờ xác nhận chợ / TTTM từng lô (market, pending)
export const MARKET_PENDING = 'MARKET';
export const MARKET_PICK = 'CHOTM';

function makeParcels(entities, project) {
  const parcels = [];
  const unknownLayers = {};
  const tt16Other = {};
  entities.forEach((ent, src) => {
    const tt = tt16Layer(ent.layer);
    const otherLand = !!(tt && tt.other && !ent.typeCode);
    if (otherLand) tt16Other[ent.layer] = (tt16Other[ent.layer] || 0) + 1;
    const pickSchool = ent.typeCode === SCHOOL_PICK || !!(tt && tt.school && !ent.typeCode);
    const pickMarket = ent.typeCode === MARKET_PICK;
    // typeCode: mã loại người dùng khớp thủ công cho layer/thuộc tính không theo quy ước
    const t = otherLand ? null
      : pickSchool ? { prefix: '', type: SCHOOL_PENDING, nhom: 'Cấp đơn vị ở' }
      : pickMarket ? { prefix: '', type: MARKET_PENDING, nhom: 'Cấp đơn vị ở' }
      : ent.typeCode ? layerToType(ent.typeCode)
        : layerToType(ent.layer);
    const land = otherLand || !t;
    if (!t && !otherLand) unknownLayers[ent.layer] = (unknownLayers[ent.layer] || 0) + 1;
    if (land && ent.kind === 'POINT') return;
    const tag = land ? {
      src, prefix: `LAND:${ent.layer}`, type: null, nhom: '', manual: false, land: true,
      tt16: !!tt, phase: tt ? tt.phase : null, stage: tt ? tt.stage : null, school: false, pending: false
    } : {
      src, prefix: t.prefix, type: t.type, nhom: t.nhom, manual: !!ent.typeCode, land: false,
      tt16: !!tt, phase: tt ? tt.phase : null, stage: tt ? tt.stage : null,
      school: pickSchool, market: pickMarket, pending: pickSchool || pickMarket,
      marketCheck: !!(tt && tt.marketCheck && !ent.typeCode)
    };
    tag.attrs = ent.attrs || null;
    const { toXY, toLatLng } = project(ent);
    if (ent.kind === 'POINT') {
      const [lat, lng] = toLatLng(...toXY(ent.pt[0], ent.pt[1]));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      parcels.push({
        kind: 'POINT', layer: ent.layer, name: ent.name || '', handle: null, ...tag,
        area: 0, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, polygons: []
      });
      return;
    }
    const rings = ent.rings.map(r => r.map(([x, y]) => toXY(x, y)));
    const polys = buildPolygons(rings);
    if (!polys.length) return;
    const area = polys.reduce((s, p) => s + p.area, 0);
    if (!(area > 0)) return;
    const main = polys.reduce((a, b) => (b.area > a.area ? b : a));
    // Tâm chung của mọi mảnh (trừ lỗ); rơi ra ngoài lô thì lấy điểm nằm sâu trong mảnh lớn nhất
    let sx = 0, sy = 0;
    for (const p of polys) {
      p.rings.forEach((r, k) => {
        const a = Math.abs(ringArea(r)) * (k === 0 ? 1 : -1);
        const [x, y] = ringCentroid(r);
        sx += x * a; sy += y * a;
      });
    }
    const whole = [sx / area, sy / area];
    const [cE, cN] = polys.some(p => pointInPolygon(whole[0], whole[1], p.rings)) ? whole : interiorPoint(main.rings);
    const [lat, lng] = toLatLng(cE, cN);
    parcels.push({
      kind: ent.kind, layer: ent.layer, name: ent.name || '', handle: ent.handle || null, ...tag,
      area: Math.round(area * 10) / 10,
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
      polygons: polys.map(p => p.rings.map(r => {
        const ring = r.map(([X, Y]) => { const [la, lo] = toLatLng(X, Y); return [lo, la]; });
        ring.push(ring[0]);
        return simplifyRing(ring);
      }))
    });
  });

  // Hatch bị cắt thành nhiều mảnh sát nhau → gộp lại 1 khối (cần turf toàn cục; không có thì giữ nguyên các mảnh)
  if (typeof turf !== 'undefined') {
    for (const p of parcels) {
      if (p.polygons.length < 2) continue;
      try {
        let merged = turf.polygon(p.polygons[0]);
        for (let k = 1; k < p.polygons.length; k++) merged = turf.union(merged, turf.polygon(p.polygons[k])) || merged;
        const g = merged.geometry;
        p.polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      } catch (e) { /* giữ các mảnh gốc */ }
    }
  }

  const fills = parcels.filter(p => FILL_KINDS.has(p.kind));
  const boundHandles = new Set(entities.filter(e => e.kind === 'HATCH').flatMap(e => e.sources || []));
  const areas = parcels.filter(p => p.kind !== 'POINT');
  let pointsInLots = 0;
  const kept = parcels.filter(p => {
    if (p.kind === 'POINT') {
      const inLot = areas.some(a => a.type === p.type && a.phase === p.phase && inPolys(p.lng, p.lat, a.polygons));
      if (inLot) pointsInLots++;
      return !inLot;
    }
    return FILL_KINDS.has(p.kind) || !(boundHandles.has(p.handle) || fills.some(h => h.layer === p.layer
      && metersApart(h, p) < 1
      && Math.abs(h.area - p.area) <= 0.01 * h.area));
  });
  return { parcels: kept, duplicatesDropped: parcels.length - kept.length - pointsInLots, pointsInLots, unknownLayers, tt16Other };
}

/** Thực thể DXF (VN-2000) → { parcels, duplicatesDropped, unknownLayers, axes } */
export function buildParcels(entities, { crs = CRS_PRESETS.HUE_3 } = {}) {
  const axes = detectAxes(entities);
  const proj = { toXY: axes.f, toLatLng: (E, N) => vn2000ToWgs84(E, N, crs) };
  return { ...makeParcels(entities, () => proj), axes: { note: axes.note, valid: axes.valid } };
}

// Phạm vi kiểm tra tọa độ KML (quanh TP. Huế)
const LAT_RANGE = [15.5, 17.2];
const LNG_RANGE = [106.5, 108.6];

// Mặt phẳng cục bộ quanh (lng0, lat0) theo bán kính cong ellipsoid WGS84: sai số diện tích không đáng kể ở cỡ lô đất
function localProjection(lng0, lat0) {
  const s = Math.sin(lat0 * DEG);
  const w = Math.sqrt(1 - E2 * s * s);
  const mLat = A * (1 - E2) / (w * w * w) * DEG;
  const mLng = A / w * Math.cos(lat0 * DEG) * DEG;
  return { toXY: (lng, lat) => [(lng - lng0) * mLng, (lat - lat0) * mLat], toLatLng: (x, y) => [lat0 + y / mLat, lng0 + x / mLng] };
}

/** Thực thể KML (vòng [lng, lat] WGS84) → { parcels, duplicatesDropped, unknownLayers, axes } */
export function buildParcelsLonLat(entities) {
  const sample = entities.slice(0, 50).map(firstXY);
  const ok = sample.filter(([lng, lat]) => inRange(lat, LAT_RANGE) && inRange(lng, LNG_RANGE)).length;
  const valid = sample.length > 0 && ok >= sample.length * 0.9;
  return { ...makeParcels(entities, (ent) => localProjection(...firstXY(ent))), axes: { note: '', valid } };
}

// ============================ PHƯỜNG & CÔNG TRÌNH ĐÃ CÓ ============================

// Ranh phường là ranh tổng quát hóa: phần lấn sang phường khác dưới 5% diện tích lô hoặc dưới 50 m² coi là sai số số hóa
const SPLIT_SHARE_MIN = 0.05;
const SPLIT_AREA_MIN = 50;
const SAMPLE_STEP_DEG = 0.0001; // ~10 m

function bboxOfRings(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}

function geometryPolygons(g) {
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
}

function inPolys(x, y, polys) {
  return polys.some(poly => pointInPolygon(x, y, poly));
}

function samplePoints(polygons) {
  const pts = [];
  for (const poly of polygons) {
    const r = poly[0];
    for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SAMPLE_STEP_DEG));
      for (let k = 0; k < n; k++) pts.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
  }
  return pts;
}

const geomPolys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

// Điểm đại diện của mảnh: tâm nếu nằm trong mảnh, không thì điểm trên mảnh (turf)
function pieceAnchor(g, feature, polys) {
  const [x, y] = g.centroid(feature).geometry.coordinates;
  const [lng, lat] = inPolys(x, y, polys) ? [x, y] : g.pointOnFeature(feature).geometry.coordinates;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/**
 * Chia lô theo ranh phường: mảnh phường chính = lô trừ các mảnh phụ (phần lấn vụn ở lại mảnh chính).
 * Diện tích mảnh chia theo tỷ lệ turf.area để tổng khớp diện tích lô (đo trên mặt phẳng VN-2000 / cục bộ).
 */
function splitByWards(g, p, shape, big) {
  const others = big.slice(1);
  let main = shape;
  for (const o of others) {
    try { main = g.difference(main, o.part) || main; } catch (e) { return null; }
  }
  const pieces = [{ ward: big[0].ward, part: main }, ...others.map(o => ({ ward: o.ward, part: o.part }))]
    .map(x => ({ ...x, m2: g.area(x.part) }));
  const sum = pieces.reduce((s, x) => s + x.m2, 0);
  if (!(sum > 0)) return null;
  return pieces.map(x => {
    const polygons = geomPolys(x.part.geometry);
    return { ward: x.ward, polygons, area: Math.round(p.area * x.m2 / sum * 10) / 10, ...pieceAnchor(g, x.part, polygons) };
  });
}

/**
 * Gán phường và tách lô vắt ranh (p.ward, p.wardParts, p.crossWard, p.wardShares).
 * - Mỗi phường có phần ≥ SPLIT_SHARE_MIN và ≥ SPLIT_AREA_MIN m² là 1 mảnh: p.wardParts = [{ ward, polygons, area, lat, lng }],
 *   mảnh đầu thuộc phường chiếm nhiều nhất (= p.ward); chỉ 1 phường đạt ngưỡng → cả lô thuộc phường đó.
 * - Không có turf / cắt hình lỗi → p.crossWard (ghi quy mô 0 như trước).
 * wards: [{ name, geometry }] (state.wardLabelsList).
 */
export function assignWards(parcels, wards) {
  const W = wards.filter(w => w.geometry).map(w => {
    const polys = geometryPolygons(w.geometry);
    return { name: w.name, geometry: w.geometry, polys, bbox: bboxOfRings(polys.map(p => p[0])) };
  });
  const find = (x, y) => {
    for (const w of W) {
      if (x < w.bbox[0] || x > w.bbox[2] || y < w.bbox[1] || y > w.bbox[3]) continue;
      if (inPolys(x, y, w.polys)) return w;
    }
    return null;
  };
  for (const p of parcels) {
    const home = find(p.lng, p.lat);
    p.ward = home ? home.name : null;
    p.crossWard = false;
    p.wardShares = null;
    p.wardParts = null;
    if (!p.polygons.length) continue;
    const hit = new Set();
    for (const [x, y] of samplePoints(p.polygons)) hit.add(find(x, y));
    if (hit.size === 1 && hit.has(home)) continue;

    const g = typeof turf !== 'undefined' ? turf : null;
    if (!g) { p.crossWard = true; continue; }
    const shape = g.multiPolygon(p.polygons);
    const total = g.area(shape);
    const parts = [];
    for (const w of hit) {
      if (!w) continue;
      let part = null;
      try { part = g.intersect(shape, g.feature(w.geometry)); } catch (e) { part = null; }
      const m2 = part ? g.area(part) : 0;
      parts.push({ ward: w.name, part, share: total > 0 ? m2 / total : 0, area: total > 0 ? p.area * m2 / total : 0 });
    }
    parts.sort((a, b) => b.share - a.share);
    p.wardShares = parts.map(({ ward, share }) => ({ ward, share }));
    const big = parts.filter(x => x.part && x.share >= SPLIT_SHARE_MIN && x.area >= SPLIT_AREA_MIN);
    if (!big.length) continue;
    p.ward = big[0].ward;
    if (big.length === 1) continue;
    p.wardParts = splitByWards(g, p, shape, big);
    if (!p.wardParts) p.crossWard = true;
  }
  return parcels;
}

// Điểm cách công trình cùng loại đã có dưới ngưỡng này coi là đã có (không tạo trùng, không ghi đè quy mô)
const POINT_EXISTING_M = 20;

/**
 * Lô chứa công trình cùng loại đã có → cập nhật công trình đó (p.matchId). Nhiều công trình trong 1 lô,
 * hoặc 1 công trình nằm trong nhiều lô cùng giai đoạn → p.matchConflict (danh sách ID) để admin chọn.
 * Điểm (không có ranh) gần công trình cùng loại < POINT_EXISTING_M → p.existingId (bỏ qua khi ghi).
 */
// THPT tính chung mã 4-TH nhưng nằm tab 6-THPT riêng: lô THPT chỉ khớp công trình THPT và ngược lại
const isThptRecord = (it) => /^THPT-/i.test(String(it.id || '')) || /THPT/i.test(String(it.name || ''));
const sameKind = (p, it) => p.type === it.type && (p.type !== '4-TH' || (p.prefix === 'THPT') === isThptRecord(it));

const LEVEL_OF_TYPE = { '3-MN': 'MN', '5-THCS': 'THCS', '6-THPT': 'THPT', '9-TM': 'TM' };

/**
 * Lô chờ chọn từng lô (đất giáo dục gộp cấp, dịch vụ chờ xác nhận chợ): cấp theo công trình đã có nằm trong lô
 * (VD lô "dat giao duc" chứa "Trường TH số 1 An Đông" → TH). Không có hoặc nhiều cấp khác nhau → ''.
 */
export function existingLevelOf(p, existing) {
  if (p.kind === 'POINT' || !p.polygons?.length) return '';
  const want = p.market ? ['9-TM'] : ['3-MN', '4-TH', '5-THCS', '6-THPT'];
  const [x0, y0, x1, y1] = bboxOfRings(p.polygons.map(poly => poly[0]));
  const hits = new Set();
  for (const it of existing) {
    if (!it.id || !want.includes(it.type)) continue;
    const x = Number(it.lng), y = Number(it.lat);
    if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1) || !inPolys(x, y, p.polygons)) continue;
    hits.add(it.type === '4-TH' ? (isThptRecord(it) ? 'THPT' : 'TH') : LEVEL_OF_TYPE[it.type]);
  }
  return hits.size === 1 ? [...hits][0] : '';
}

export function matchExisting(parcels, existing) {
  const boxes = parcels.map(p => bboxOfRings(p.polygons.map(poly => poly[0])));
  const byParcel = parcels.map(() => []);
  const byItem = new Map();
  parcels.forEach(p => {
    p.existingId = null;
    if (p.kind !== 'POINT') return;
    let bestD = POINT_EXISTING_M;
    for (const it of existing) {
      if (!sameKind(p, it) || !it.id) continue;
      const d = metersApart(p, { lat: Number(it.lat), lng: Number(it.lng) });
      if (d < bestD) { bestD = d; p.existingId = it.id; }
    }
  });
  for (const it of existing) {
    const x = Number(it.lng), y = Number(it.lat);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !it.id) continue;
    parcels.forEach((p, k) => {
      const b = boxes[k];
      if (p.kind === 'POINT' || !sameKind(p, it) || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return;
      if (!inPolys(x, y, p.polygons)) return;
      byParcel[k].push(it.id);
      const key = `${p.phase || ''}|${it.id}`;
      byItem.set(key, (byItem.get(key) || 0) + 1);
    });
  }
  parcels.forEach((p, k) => {
    const ids = byParcel[k];
    p.matchId = null;
    p.matchConflict = null;
    if (ids.length === 1 && byItem.get(`${p.phase || ''}|${ids[0]}`) === 1) p.matchId = ids[0];
    else if (ids.length) p.matchConflict = ids;
  });
  return parcels;
}

/** 2 lô cùng loại (cùng mã ID) ở cùng vị trí: tâm lô này nằm trong lô kia; 2 điểm thì cách nhau < POINT_EXISTING_M */
export function sameSite(a, b) {
  if (a.type !== b.type || a.prefix !== b.prefix) return false;
  const pa = a.polygons.length > 0, pb = b.polygons.length > 0;
  if (!pa && !pb) return metersApart(a, b) < POINT_EXISTING_M;
  return (pb && inPolys(a.lng, a.lat, b.polygons)) || (pa && inPolys(b.lng, b.lat, a.polygons));
}

/**
 * Nối các giai đoạn của lô TT16 (chạy sau matchExisting; bỏ qua lô chờ chọn cấp / bị từ chối):
 *   - QHDD trùng vị trí QHDH → bỏ QHDD (cả hai cùng ghi QuyMo_QH, lấy quy hoạch phân khu chi tiết hơn)
 *   - HT + QH cùng vị trí → 1 công trình ghi cả QuyMo_HT và QuyMo_QH: lô HT có p.partner = lô QH, lô QH có p.merged
 * Lô vắt ranh vẫn nối; lô ngoài TP, lô chứa nhiều công trình, điểm đã có thì giữ riêng.
 * → { parcels, stageDupes (số lô QHDD bị bỏ) }
 */
export function linkStages(parcels) {
  const usable = (p) => p.stage && !p.land && !p.pending && !p.rejected;
  const qhdh = parcels.filter(p => usable(p) && p.stage === 'QHDH');
  const kept = qhdh.length ? parcels.filter(p => !(usable(p) && p.stage === 'QHDD' && qhdh.some(q => sameSite(p, q)))) : parcels.slice();
  kept.forEach(p => { p.partner = null; p.merged = false; });
  const single = (p) => usable(p) && p.ward && !p.matchConflict && !p.existingId;
  const hts = kept.filter(p => single(p) && p.phase === 'HT');
  kept.forEach(q => {
    if (!single(q) || q.phase !== 'QH') return;
    let best = null, bestD = Infinity;
    for (const h of hts) {
      if (h.partner || (h.matchId && q.matchId && h.matchId !== q.matchId) || !sameSite(h, q)) continue;
      const d = metersApart(h, q);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best) { best.partner = q; q.merged = true; }
  });
  return { parcels: kept, stageDupes: parcels.length - kept.length };
}
