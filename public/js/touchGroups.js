// Lô hạ tầng cùng loại, cùng giai đoạn, cùng đồ án, có ranh chạm nhau (kể cả khe số hóa vài mét)
// là một công trình: một tên (mã lô cách nhau bằng dấu phẩy), diện tích cộng, một tâm.
// Không gộp khác đồ án. Polygon gốc không bị xóa — chỉ bỏ điểm đếm thừa.
// Khớp classifyPlanChange trong services/gcsService.js (tỷ lệ 5%).

export const TOUCH_TOLERANCE_M = 4;
const PLAN_CHANGE_MIN_RATIO = 0.05;
const LARGE_CELLS = 250;

export function planChangeOf(sizeHT, sizeQH) {
  if (sizeHT == null) return sizeQH == null ? 'none' : 'new';
  if (sizeQH == null) return 'relocate';
  if (sizeHT === 0 || sizeQH === 0) return 'keep';
  if (Math.abs(sizeQH - sizeHT) <= sizeHT * PLAN_CHANGE_MIN_RATIO) return 'keep';
  if (sizeQH > sizeHT) return 'expand';
  if (sizeQH < sizeHT) return 'shrink';
  return 'keep';
}

export function outerRings(geometry) {
  if (!geometry) return [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const rings = [];
  polys.forEach(poly => {
    const ring = poly && poly[0];
    if (ring && ring.length >= 4) rings.push(ring);
  });
  return rings;
}

/** Vòng ngoài từ mảng polygon kiểu lô nhập CAD: mỗi phần là [vòng ngoài, lỗ...] */
export function ringsFromPolygons(polygons) {
  const rings = [];
  (polygons || []).forEach(poly => {
    const ring = poly && poly[0];
    if (ring && ring.length >= 4) rings.push(ring);
  });
  return rings;
}

function idRank(id) {
  const m = String(id || '').match(/(\d+)(?:\.(\d+))?$/);
  if (!m) return [Number.MAX_SAFE_INTEGER, 0, String(id || '')];
  return [Number(m[1]), Number(m[2] || 0), String(id || '')];
}

export function compareIds(a, b) {
  const ra = idRank(a);
  const rb = idRank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
}

/** Ký hiệu lô nếu có, không thì mã trong tên (CX1.07), không thì mã đối tượng */
export function lotLabel(rec) {
  const ky = String((rec && (rec.lotCode || rec.kyHieu)) || '').trim();
  if (ky) return ky;
  const name = String((rec && rec.name) || '').trim();
  const head = name.split(/\s+[–—]\s+/)[0] || name;
  const found = head.match(/[A-Za-zĐđ]{1,10}\d[\w.-]*/g);
  if (found && found.length) return found[found.length - 1];
  return String((rec && (rec.sheetId || rec.id)) || '').trim();
}

export function joinLabels(recs) {
  const labels = (recs || []).map(lotLabel);
  const counts = new Map();
  labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
  const out = [];
  (recs || []).forEach((rec, i) => {
    const label = labels[i];
    const id = String((rec && (rec.sheetId || rec.id)) || '').trim();
    const shown = counts.get(label) > 1 && id && id !== label ? id : label;
    if (shown && !out.includes(shown)) out.push(shown);
  });
  return out.join(', ');
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function dist2PointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const ex = px - qx;
  const ey = py - qy;
  return ex * ex + ey * ey;
}

function ringsTouch(a, b, tol2) {
  const ringsA = a.rings;
  const ringsB = b.rings;
  for (let i = 0; i < ringsA.length; i++) {
    const ra = ringsA[i];
    for (let j = 0; j < ringsB.length; j++) {
      const rb = ringsB[j];
      if (pointInRing(ra[0][0], ra[0][1], rb) || pointInRing(rb[0][0], rb[0][1], ra)) return true;
      const n = ra.length;
      const m = rb.length;
      const stepA = n > 500 ? Math.ceil(n / 500) : 1;
      const stepB = m > 500 ? Math.ceil(m / 500) : 1;
      for (let ia = 0; ia < n; ia += stepA) {
        const p = ra[ia];
        for (let ib = 0; ib < m - 1; ib += stepB) {
          const ib2 = Math.min(m - 1, ib + stepB);
          if (dist2PointSeg(p[0], p[1], rb[ib][0], rb[ib][1], rb[ib2][0], rb[ib2][1]) <= tol2) return true;
        }
      }
    }
  }
  return false;
}

function bboxHits(a, b, tol) {
  return !(a[2] + tol < b[0] || b[2] + tol < a[0] || a[3] + tol < b[1] || b[3] + tol < a[1]);
}

function decimateMeters(ring, step) {
  if (!ring || ring.length <= 8) return ring;
  const out = [ring[0]];
  let px = ring[0][0];
  let py = ring[0][1];
  const step2 = step * step;
  for (let i = 1; i < ring.length - 1; i++) {
    const x = ring[i][0];
    const y = ring[i][1];
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy >= step2) {
      out.push(ring[i]);
      px = x;
      py = y;
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function prepareLot(lot, projectFallback) {
  const rings = (lot.rings || []).filter(r => r && r.length >= 4);
  const lat0 = (rings[0] && rings[0][0] && rings[0][0][1]) || 16.47;
  const scaleX = 111320 * Math.cos(lat0 * Math.PI / 180);
  const scaleY = 110540;
  const toM = (p) => [p[0] * scaleX, p[1] * scaleY];
  const mRings = rings.map(r => decimateMeters(r.map(toM), 1));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  mRings.forEach(r => r.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }));
  const project = lot.project != null ? String(lot.project) : projectFallback;
  return {
    rings: mRings,
    bbox: [minX, minY, maxX, maxY],
    key: `${project}|${lot.phase || ''}|${lot.type || ''}`
  };
}

/**
 * lots: [{ id, type, phase, project, rings }] — rings là vòng ngoài [lng, lat].
 * Chỉ nối trong cùng project + phase + type. Trả về các nhóm chỉ số (mỗi nhóm ≥ 2).
 */
export function clusterTouching(lots, toleranceM = TOUCH_TOLERANCE_M) {
  const n = (lots || []).length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  const prepared = (lots || []).map(lot => prepareLot(lot, ''));
  const cell = Math.max(toleranceM * 4, 16);
  const tol2 = toleranceM * toleranceM;
  const buckets = new Map();
  const large = [];
  const bucketKey = (key, ix, iy) => `${key}|${ix}:${iy}`;
  for (let i = 0; i < n; i++) {
    const p = prepared[i];
    if (!p.rings.length || !Number.isFinite(p.bbox[0])) continue;
    const x0 = Math.floor((p.bbox[0] - toleranceM) / cell);
    const y0 = Math.floor((p.bbox[1] - toleranceM) / cell);
    const x1 = Math.floor((p.bbox[2] + toleranceM) / cell);
    const y1 = Math.floor((p.bbox[3] + toleranceM) / cell);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1);
    const seen = new Set();
    const consider = (j) => {
      if (j === i || seen.has(j) || find(j) === find(i)) return;
      if (prepared[j].key !== p.key) return;
      seen.add(j);
      const q = prepared[j];
      if (!bboxHits(p.bbox, q.bbox, toleranceM)) return;
      if (ringsTouch(p, q, tol2) || ringsTouch(q, p, tol2)) union(j, i);
    };
    if (span > LARGE_CELLS) {
      large.push(i);
    } else {
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const arr = buckets.get(bucketKey(p.key, ix, iy));
          if (arr) arr.forEach(consider);
        }
      }
    }
    large.forEach(consider);
    if (span > LARGE_CELLS) continue;
    const ix0 = Math.floor(p.bbox[0] / cell);
    const iy0 = Math.floor(p.bbox[1] / cell);
    const ix1 = Math.floor(p.bbox[2] / cell);
    const iy1 = Math.floor(p.bbox[3] / cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const k = bucketKey(p.key, ix, iy);
        const arr = buckets.get(k) || [];
        arr.push(i);
        buckets.set(k, arr);
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) || [];
    arr.push(i);
    groups.set(root, arr);
  }
  return [...groups.values()].filter(g => g.length >= 2);
}

function ringCentroid(ring) {
  let a = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0];
    const y1 = ring[i][1];
    const x2 = ring[i + 1][0];
    const y2 = ring[i + 1][1];
    const c = x1 * y2 - x2 * y1;
    a += c;
    sx += (x1 + x2) * c;
    sy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-18) {
    let x = 0;
    let y = 0;
    ring.forEach(p => { x += p[0]; y += p[1]; });
    const k = ring.length || 1;
    return { lng: x / k, lat: y / k, area: 0 };
  }
  return { lng: sx / (3 * a), lat: sy / (3 * a), area: Math.abs(a) / 2 };
}

/** Tâm diện tích của mọi vòng ngoài (độ). areaHint theo lô để lô không có vòng vẫn kéo tâm. */
export function groupCentroid(members) {
  let sx = 0;
  let sy = 0;
  let sa = 0;
  (members || []).forEach(m => {
    const rings = m.rings || [];
    rings.forEach(ring => {
      const c = ringCentroid(ring);
      const w = c.area > 0 ? c.area : 0;
      if (w > 0 && Number.isFinite(c.lng) && Number.isFinite(c.lat)) {
        sx += c.lng * w;
        sy += c.lat * w;
        sa += w;
      }
    });
  });
  if (sa > 0) return { lng: sx / sa, lat: sy / sa };
  let fx = 0;
  let fy = 0;
  let n = 0;
  (members || []).forEach(m => {
    const lat = Number(m.lat);
    const lng = Number(m.lng);
    const w = Number(m.area) > 0 ? Number(m.area) : 1;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    fx += lng * w;
    fy += lat * w;
    n += w;
  });
  if (!n) return null;
  return { lng: fx / n, lat: fy / n };
}

function sumOptional(vals) {
  const nums = (vals || []).filter(v => v != null && v !== '' && Number.isFinite(Number(v)));
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + Number(n), 0) * 10) / 10;
}

/**
 * Điểm công trình → một điểm mỗi nhóm đã chạm ranh. Nhóm không đủ 2 điểm đang có thì giữ nguyên.
 * groups: [{ ids, name, lat, lng }] — ids[0] là mã giữ lại.
 */
export function applyTouchGroups(points, groups) {
  const list = points || [];
  const byId = new Map(list.map(p => [p && p.id, p]));
  const consumed = new Set();
  const merged = [];
  (groups || []).forEach(g => {
    const ids = [...new Set((g.ids || []).filter(Boolean))];
    const members = ids.map(id => byId.get(id)).filter(m => m && !consumed.has(m.id));
    if (members.length < 2) return;
    members.forEach(m => consumed.add(m.id));
    const primary = members.find(m => m.id === ids[0]) || members.slice().sort((a, b) => compareIds(a.id, b.id))[0];
    const sizeHT = sumOptional(members.map(m => m.sizeHT));
    const sizeQH = sumOptional(members.map(m => m.sizeQH));
    const next = {
      ...primary,
      name: g.name || joinLabels(members),
      lat: Number.isFinite(Number(g.lat)) ? Number(g.lat) : primary.lat,
      lng: Number.isFinite(Number(g.lng)) ? Number(g.lng) : primary.lng,
      sizeHT,
      sizeQH,
      size: sizeHT || 0,
      planChange: planChangeOf(sizeHT, sizeQH),
      touchIds: ids.slice()
    };
    if (g.name) next.lotCode = g.name;
    const parts = [];
    members.forEach(m => { if (m.wardParts) parts.push(...m.wardParts); });
    if (parts.length) next.wardParts = parts;
    else delete next.wardParts;
    const approved = members.every(m => m.status === true || m.status === 'TRUE');
    next.status = approved;
    merged.push(next);
  });
  if (!consumed.size) return list;
  return list.filter(p => p && !consumed.has(p.id)).concat(merged);
}

let alias = new Map();

/** Gán bảng mã lô phụ → mã giữ lại, để polygon gốc vẫn mở đúng công trình đã gộp */
export function setTouchAlias(groups) {
  alias = new Map();
  (groups || []).forEach(g => {
    const ids = g.ids || [];
    const primary = ids[0];
    if (!primary) return;
    ids.forEach(id => { if (id && id !== primary) alias.set(id, primary); });
  });
}

export function touchPrimary(id) {
  return alias.get(id) || '';
}

function normCategory(s) {
  return String(s || '').trim().toUpperCase().replace(/_(DT|DV)$/i, '');
}

/** Cùng loại công trình: mã sau mũi tên trên layer, không thì prefix / mã ID. Bỏ hậu tố cấp _DT / _DV. */
export function infraCategory(source) {
  const layer = String((source && source.layer) || '');
  const parts = layer.split('→');
  if (parts.length > 1) {
    const token = parts[parts.length - 1].trim().split(/[\s,;/]+/)[0];
    if (token) return normCategory(token);
  }
  if (source && source.prefix) return normCategory(source.prefix);
  const id = String((source && source.id) || '');
  const prefix = id.includes('-') ? id.split('-')[0] : '';
  if (prefix && !/^DXF$/i.test(prefix)) return normCategory(prefix);
  const type = String((source && source.type) || '').replace(/^\d+-/, '');
  return normCategory(type);
}

/** Khoảng hở gần đúng giữa hai vòng (mét). Vòng cách khung > 30 m thì chỉ lấy khoảng hở khung. */
export function approxSepM(a, b) {
  const pa = prepareLot(a, '');
  const pb = prepareLot(b, '');
  if (!pa.rings.length || !pb.rings.length || !Number.isFinite(pa.bbox[0]) || !Number.isFinite(pb.bbox[0])) return Infinity;
  const gapX = Math.max(0, Math.max(pb.bbox[0] - pa.bbox[2], pa.bbox[0] - pb.bbox[2]));
  const gapY = Math.max(0, Math.max(pb.bbox[1] - pa.bbox[3], pa.bbox[1] - pb.bbox[3]));
  const boxGap = Math.hypot(gapX, gapY);
  if (boxGap > 30) return boxGap;
  let best = boxGap * boxGap;
  const consider = (rings, other) => {
    for (let r = 0; r < rings.length; r++) {
      const ra = rings[r];
      const stepA = ra.length > 500 ? Math.ceil(ra.length / 500) : 1;
      for (let ia = 0; ia < ra.length; ia += stepA) {
        const p = ra[ia];
        for (let k = 0; k < other.length; k++) {
          const rb = other[k];
          const stepB = rb.length > 500 ? Math.ceil(rb.length / 500) : 1;
          for (let ib = 0; ib < rb.length - 1; ib += stepB) {
            const ib2 = Math.min(rb.length - 1, ib + stepB);
            const d = dist2PointSeg(p[0], p[1], rb[ib][0], rb[ib][1], rb[ib2][0], rb[ib2][1]);
            if (d < best) best = d;
          }
        }
      }
    }
  };
  consider(pa.rings, pb.rings);
  consider(pb.rings, pa.rings);
  return Math.sqrt(best);
}

function canGroupParcel(p) {
  if (!p || p.land || p.pending || p.rejected || p.kind === 'POINT') return false;
  if (p.wardParts || p.crossWard) return false;
  if (!p.type || !p.phase || !p.polygons || !p.polygons.length) return false;
  return true;
}

/**
 * Lô hạ tầng của một lần nhập (cùng một đồ án): gộp các lô chạm ranh cùng loại, cùng giai đoạn.
 * Mảnh không đủ điều kiện giữ nguyên. Polygon của mảnh đã gộp nằm trong lô kết quả.
 */
export function groupInfraParcels(parcels, toleranceM = TOUCH_TOLERANCE_M) {
  const list = parcels || [];
  const eligible = [];
  list.forEach((p, index) => { if (canGroupParcel(p)) eligible.push(index); });
  if (eligible.length < 2) return list.slice();
  const lots = eligible.map(index => {
    const p = list[index];
    return {
      id: String(p.lotCode || p.handle || index),
      type: infraCategory(p),
      phase: p.phase,
      project: '',
      rings: ringsFromPolygons(p.polygons)
    };
  });
  const grouped = clusterTouching(lots, toleranceM);
  if (!grouped.length) return list.slice();
  const skip = new Set();
  const replacement = new Map();
  grouped.forEach(localIdxs => {
    const indexes = localIdxs.map(i => eligible[i]).sort((a, b) => a - b);
    const members = indexes.map(i => list[i]);
    indexes.slice(1).forEach(i => skip.add(i));
    const lead = members[0];
    const polygons = members.flatMap(p => p.polygons || []);
    const area = Math.round(members.reduce((s, p) => s + (Number(p.area) || 0), 0) * 10) / 10;
    const center = groupCentroid(members.map(p => ({ rings: ringsFromPolygons(p.polygons), lat: p.lat, lng: p.lng, area: p.area })));
    const name = joinLabels(members);
    const biggest = members.reduce((a, b) => ((Number(b.area) || 0) > (Number(a.area) || 0) ? b : a));
    replacement.set(indexes[0], {
      ...lead,
      polygons,
      area,
      lat: center ? Math.round(center.lat * 1e6) / 1e6 : lead.lat,
      lng: center ? Math.round(center.lng * 1e6) / 1e6 : lead.lng,
      ward: biggest.ward || lead.ward,
      lotCode: name || lead.lotCode,
      name: name || lead.name,
      partner: null,
      merged: false,
      touchCount: members.length
    });
  });
  const out = [];
  list.forEach((p, i) => {
    if (skip.has(i)) return;
    out.push(replacement.get(i) || p);
  });
  return out;
}
