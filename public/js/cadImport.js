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

/** Đọc DXF (văn bản) → { entities: [{kind, layer, rings}], stats } — chỉ HATCH, LWPOLYLINE, POLYLINE khép kín trong ENTITIES */
export function parseDxf(text) {
  const tags = readTags(text);
  const stats = { hatch: 0, polyline: 0, openPolyline: 0, insert: 0, splineEdges: 0, ignored: {}, insUnits: null };
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
    if (v === 'HATCH') { [ent, i] = readHatch(tags, i + 1, stats); stats.hatch++; }
    else if (v === 'LWPOLYLINE') { [ent, i] = readLwPolyline(tags, i + 1); }
    else if (v === 'POLYLINE') { [ent, i] = readPolyline(tags, i + 1); }
    else {
      if (v === 'INSERT') stats.insert++;
      else stats.ignored[v] = (stats.ignored[v] || 0) + 1;
      for (i++; i < tags.length && tags[i][0] !== 0; i++);
      continue;
    }
    if (ent.kind !== 'HATCH') {
      if (ent.rings.length) stats.polyline++; else stats.openPolyline++;
    }
    if (ent.rings.length) entities.push(ent);
  }
  return { entities, stats };
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
  YT_DT: '6-YT', YT_DV: '6-YT', YT: '6-YT',
  VH_DT: '7-VH', VH_DV: '7-VH', VH: '7-VH',
  TM_DT: '8-TM', TM_DV: '8-TM', TM: '8-TM',
  CSD: '9-CSD'
};
const PREFIX_KEYS = Object.keys(LAYER_PREFIXES).sort((a, b) => b.length - a.length);

/** Tên layer → { prefix, type, nhom } hoặc null. Nhận đúng mã hoặc mã + phần đuôi sau dấu _ - khoảng trắng (VD "MN_QH") */
export function layerToType(layerName) {
  const name = String(layerName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const prefix = LAYER_PREFIXES[name] ? name : PREFIX_KEYS.find(k => name.startsWith(k + '_'));
  if (!prefix) return null;
  const nhom = prefix === 'THPT' || prefix.endsWith('_DT') ? 'Cấp đô thị' : 'Cấp đơn vị ở';
  return { prefix, type: LAYER_PREFIXES[prefix], nhom };
}

// ============================ LÔ ĐẤT ============================

const E_RANGE = [350000, 900000];
const N_RANGE = [1650000, 1950000];
const inRange = (v, r) => v >= r[0] && v <= r[1];

/** Phát hiện đảo X/Y và đơn vị mm từ vài điểm mẫu: trả về hàm (x, y) → [E, N] mét, kèm ghi chú */
export function detectAxes(entities) {
  const sample = [];
  for (const e of entities) { sample.push(e.rings[0][0]); if (sample.length >= 50) break; }
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

/**
 * Thực thể DXF → lô đất: { layer, prefix, type, nhom, area (m²), lat, lng, polygons ([[lng,lat]...] theo vòng) }
 * Polyline trùng với HATCH cùng layer (cùng tâm < 1 m, diện tích lệch < 1%) được bỏ để không đếm 2 lần.
 */
export function buildParcels(entities, { crs = CRS_PRESETS.HUE_3 } = {}) {
  const axes = detectAxes(entities);
  const parcels = [];
  const unknownLayers = {};
  for (const ent of entities) {
    const t = layerToType(ent.layer);
    if (!t) { unknownLayers[ent.layer] = (unknownLayers[ent.layer] || 0) + 1; continue; }
    const rings = ent.rings.map(r => r.map(([x, y]) => axes.f(x, y)));
    const polys = buildPolygons(rings);
    if (!polys.length) continue;
    const area = polys.reduce((s, p) => s + p.area, 0);
    if (!(area > 0)) continue;
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
    const [lat, lng] = vn2000ToWgs84(cE, cN, crs);
    parcels.push({
      kind: ent.kind, layer: ent.layer, handle: ent.handle || null, ...t,
      area: Math.round(area * 10) / 10,
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
      centerEN: [cE, cN],
      polygons: polys.map(p => p.rings.map(r => {
        const ring = r.map(([E, N]) => { const [la, lo] = vn2000ToWgs84(E, N, crs); return [lo, la]; });
        ring.push(ring[0]);
        return ring;
      }))
    });
  }

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

  const hatches = parcels.filter(p => p.kind === 'HATCH');
  const boundHandles = new Set(entities.filter(e => e.kind === 'HATCH').flatMap(e => e.sources || []));
  const kept = parcels.filter(p => p.kind === 'HATCH' || !(boundHandles.has(p.handle) || hatches.some(h => h.layer === p.layer
    && Math.hypot(h.centerEN[0] - p.centerEN[0], h.centerEN[1] - p.centerEN[1]) < 1
    && Math.abs(h.area - p.area) <= 0.01 * h.area)));
  return { parcels: kept, duplicatesDropped: parcels.length - kept.length, unknownLayers, axes: { note: axes.note, valid: axes.valid } };
}

// ============================ PHƯỜNG & CÔNG TRÌNH ĐÃ CÓ ============================

// Ranh phường là ranh tổng quát hóa: lô lấn sang phường khác dưới 5% diện tích vẫn coi là nằm trọn
const WARD_SHARE_MIN = 0.95;
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

/**
 * Gán phường theo tâm lô và đánh dấu lô vắt ranh (p.ward, p.crossWard, p.wardShares).
 * wards: [{ name, geometry }] (state.wardLabelsList). Cần turf toàn cục để đo phần diện tích lấn ranh.
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
    const hit = new Set();
    for (const [x, y] of samplePoints(p.polygons)) hit.add(find(x, y));
    if (hit.size === 1 && hit.has(home)) continue;

    const shares = [];
    const g = typeof turf !== 'undefined' ? turf : null;
    if (g) {
      const shape = g.multiPolygon(p.polygons);
      const total = g.area(shape);
      for (const w of hit) {
        if (!w) continue;
        let part = null;
        try { part = g.intersect(shape, g.feature(w.geometry)); } catch (e) { part = null; }
        shares.push({ ward: w.name, share: part && total > 0 ? g.area(part) / total : 0 });
      }
      shares.sort((a, b) => b.share - a.share);
    }
    p.wardShares = shares;
    const top = shares[0];
    if (top && top.share >= WARD_SHARE_MIN) p.ward = top.ward;
    else p.crossWard = true;
  }
  return parcels;
}

/**
 * Lô chứa công trình cùng loại đã có → cập nhật công trình đó (p.matchId). Nhiều công trình trong 1 lô,
 * hoặc 1 công trình nằm trong nhiều lô → p.matchConflict (danh sách ID) để admin chọn.
 */
export function matchExisting(parcels, existing) {
  const boxes = parcels.map(p => bboxOfRings(p.polygons.map(poly => poly[0])));
  const byParcel = parcels.map(() => []);
  const byItem = new Map();
  for (const it of existing) {
    const x = Number(it.lng), y = Number(it.lat);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !it.id) continue;
    parcels.forEach((p, k) => {
      const b = boxes[k];
      if (p.type !== it.type || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return;
      if (!inPolys(x, y, p.polygons)) return;
      byParcel[k].push(it.id);
      byItem.set(it.id, (byItem.get(it.id) || 0) + 1);
    });
  }
  parcels.forEach((p, k) => {
    const ids = byParcel[k];
    p.matchId = null;
    p.matchConflict = null;
    if (ids.length === 1 && byItem.get(ids[0]) === 1) p.matchId = ids[0];
    else if (ids.length) p.matchConflict = ids;
  });
  return parcels;
}
