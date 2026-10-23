// Ranh 40 phường/xã không khít cạnh chung (lệch vài mét) và Leaflet simplify từng polygon
// (smoothFactor) nên hai nét / hai nền lệch nhau, để lộ nền sáng dọc ranh ở mọi mức phóng.
// Bản vẽ khép khe ≤ SNAP_M về một cạnh, mỗi cạnh chỉ giữ một lần. Đỉnh đã nằm trên cạnh
// gần nhất, và cạnh đã trùng một polygon khác, giữ nguyên. Tra điểm vẫn dùng hình gốc.

const SNAP_M = 8;
const DENSIFY_M = 12;
const COLINEAR_M = 0.04;
const DEDUPE_M = 0.4;
const COINCIDE_M = 0.15;
const PASSES = 3;
const M_LAT = 110540;
const M_LNG = 111320 * Math.cos(16.4637 * Math.PI / 180);
const CELL = 0.00018;

const distM = (a, b) => Math.hypot((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT);

function proj(p, a, b) {
  const ax = a[0] * M_LNG, ay = a[1] * M_LAT;
  const bx = b[0] * M_LNG, by = b[1] * M_LAT;
  const px = p[0] * M_LNG, py = p[1] * M_LAT;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), t, p: [qx / M_LNG, qy / M_LAT] };
}

function copyRing(ring) {
  if (!ring || ring.length < 2) return [];
  const out = ring.map(p => [p[0], p[1]]);
  const a = out[0], b = out[out.length - 1];
  if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) out[out.length - 1] = a;
  return out;
}

function loadParts(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', polys: [geometry.coordinates.map(r => ({ pts: copyRing(r) }))] };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', polys: geometry.coordinates.map(poly => poly.map(r => ({ pts: copyRing(r) }))) };
  }
  return null;
}

function nearestOther(grid, p, fi, rad) {
  let best = Infinity;
  for (const seg of nearSegs(grid, p, rad)) {
    if (seg.fi === fi) continue;
    const d = proj(p, seg.a, seg.b).d;
    if (d < best) best = d;
  }
  return best;
}

// Cạnh đã khít (trung điểm ≤ 0,5 m) không chia dày: đỉnh mới sẽ bị hút sang polygon chỉ số thấp hơn.
function gapSegment(a, b, fi, grid) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (nearestOther(grid, mid, fi, 2) <= COINCIDE_M) return false;
  for (const p of [a, b, mid]) {
    const best = nearestOther(grid, p, fi, 2);
    if (best > 0.2 && best <= SNAP_M + 1) return true;
  }
  return false;
}

// Chỉ chia dày cạnh đang hở. Cạnh đã trùng hoặc bờ ngoài giữ nguyên số đỉnh.
function densifyGaps(items) {
  const { grid } = indexSegs(items);
  items.forEach((item, fi) => {
    if (!item) return;
    allRings(item).forEach(ring => {
      const pts = ring.pts;
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const last = i === pts.length - 2;
        if (gapSegment(a, b, fi, grid)) {
          const n = Math.max(1, Math.round(distM(a, b) / DENSIFY_M));
          for (let k = 1; k < n; k++) {
            const t = k / n;
            next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        if (!last) next.push(b);
      }
      next.push(next[0]);
      ring.pts = next;
    });
  });
}

function allRings(parts) {
  const rings = [];
  parts.polys.forEach(poly => poly.forEach(r => rings.push(r)));
  return rings;
}

function touchCells(a, b, fn) {
  const steps = Math.max(1, Math.ceil(distM(a, b) / 15));
  let prev = '';
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const k = `${Math.floor((a[0] + (b[0] - a[0]) * t) / CELL)},${Math.floor((a[1] + (b[1] - a[1]) * t) / CELL)}`;
    if (k === prev) continue;
    prev = k;
    fn(k);
  }
}

function indexSegs(items) {
  const grid = new Map();
  const segs = [];
  items.forEach((item, fi) => {
    if (!item) return;
    allRings(item).forEach((ring, ri) => {
      const pts = ring.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a === b || distM(a, b) < 0.02) continue;
        const seg = { fi, ri, i, a, b };
        segs.push(seg);
        touchCells(a, b, (k) => {
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, bucket = []);
          bucket.push(seg);
        });
      }
    });
  });
  return { grid, segs };
}

function nearSegs(grid, p, rad = 1) {
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  const out = [];
  const seen = new Set();
  for (let dx = -rad; dx <= rad; dx++) {
    for (let dy = -rad; dy <= rad; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const seg of bucket) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        out.push(seg);
      }
    }
  }
  return out;
}

function ringAt(item, ri) {
  let n = 0;
  for (const poly of item.polys) {
    for (const ring of poly) {
      if (n === ri) return ring;
      n++;
    }
  }
  return null;
}

function applySplits(splits) {
  const byRing = new Map();
  splits.forEach(s => {
    if (!byRing.has(s.ring)) byRing.set(s.ring, []);
    byRing.get(s.ring).push(s);
  });
  byRing.forEach(list => {
    list.sort((a, b) => (a.i !== b.i ? b.i - a.i : b.t - a.t));
    const seen = new Set();
    list.forEach(s => {
      const key = `${s.i}:${s.t.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pts = s.ring.pts;
      const at = s.i + 1;
      if (pts[at] === s.p || pts[s.i] === s.p) return;
      if (distM(pts[s.i], s.p) < 0.03 || distM(pts[at], s.p) < 0.03) return;
      pts.splice(at, 0, s.p);
    });
  });
}

function breaksSharedEdge(grid, fi, ring, vi, dest) {
  const pts = ring.pts;
  const p = pts[vi];
  const neighbors = [];
  if (pts.length >= 2) neighbors.push(vi === 0 ? pts[pts.length - 2] : pts[vi - 1], pts[vi + 1]);
  for (const q of neighbors) {
    if (!q || q === p) continue;
    if (proj(dest, p, q).d < 0.15) continue;
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    for (const other of nearSegs(grid, mid)) {
      if (other.fi === fi) continue;
      if (proj(mid, other.a, other.b).d <= COINCIDE_M) return true;
    }
  }
  return false;
}

function snapPass(items) {
  const { grid } = indexSegs(items);
  const moves = [];
  const splits = [];
  items.forEach((item, fi) => {
    if (!item) return;
    allRings(item).forEach(ring => {
      const pts = ring.pts;
      for (let vi = 0; vi < pts.length - 1; vi++) {
        const p = pts[vi];
        let best = null;
        for (const seg of nearSegs(grid, p)) {
          if (seg.fi >= fi) continue;
          const hit = proj(p, seg.a, seg.b);
          if (hit.d > SNAP_M) continue;
          if (!best || hit.d < best.d) best = { d: hit.d, t: hit.t, p: hit.p, seg };
        }
        if (!best || best.d < 0.02) continue;
        if (breaksSharedEdge(grid, fi, ring, vi, best.p)) continue;
        moves.push({ ring, vi, p: best.p });
        if (best.t > 0.002 && best.t < 0.998) {
          const target = ringAt(items[best.seg.fi], best.seg.ri);
          if (target) splits.push({ ring: target, i: best.seg.i, t: best.t, p: best.p });
        }
      }
    });
  });
  moves.forEach(m => {
    const pts = m.ring.pts;
    pts[m.vi] = m.p;
    if (m.vi === 0) pts[pts.length - 1] = m.p;
  });
  applySplits(splits);
}

// Đỉnh của polygon chỉ số thấp hơn nằm sát cạnh polygon cao hơn: chèn vào cạnh đó để góc không bị vát.
function alreadyShared(grid, seg) {
  const mid = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
  for (const other of nearSegs(grid, mid)) {
    if (other === seg || other.fi === seg.fi) continue;
    if (proj(mid, other.a, other.b).d <= COINCIDE_M) return true;
  }
  return false;
}

function absorbPass(items) {
  const { grid } = indexSegs(items);
  const splits = [];
  items.forEach((item, fi) => {
    if (!item) return;
    allRings(item).forEach(ring => {
      const pts = ring.pts;
      for (let vi = 0; vi < pts.length - 1; vi++) {
        const p = pts[vi];
        let best = null;
        let nearest = Infinity;
        for (const seg of nearSegs(grid, p)) {
          if (seg.fi <= fi) continue;
          const hit = proj(p, seg.a, seg.b);
          if (hit.d < nearest) nearest = hit.d;
          if (hit.d > SNAP_M || hit.t < 0.002 || hit.t > 0.998) continue;
          if (!best || hit.d < best.d) best = { seg, t: hit.t, d: hit.d };
        }
        if (!best || nearest < 0.02 || best.d > nearest + 0.05) continue;
        // Cạnh đã khít polygon này rồi thì không chèn đỉnh lệch vào, kẻo võng cạnh đang trùng.
        if (alreadyShared(grid, best.seg)) continue;
        const target = ringAt(items[best.seg.fi], best.seg.ri);
        if (target) splits.push({ ring: target, i: best.seg.i, t: best.t, p });
      }
    });
  });
  applySplits(splits);
}

function thin(pts) {
  if (pts.length < 4) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1];
    const c = pts[i + 1];
    if (proj(pts[i], a, c).d > COLINEAR_M) keep.push(pts[i]);
  }
  keep.push(keep[0]);
  return keep;
}

function toGeometry(item) {
  const polys = item.polys.map(poly => poly.map(r => r.pts.map(p => [p[0], p[1]]))).filter(poly => poly[0] && poly[0].length >= 4);
  if (!polys.length) return null;
  if (item.type === 'Polygon') return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}

function wardKey(props, name) {
  return String(name || (props && (props.tenXa || props.NAME_2 || props.name)) || '');
}

function chainLines(segs) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const adj = new Map();
  const items = [];
  segs.forEach(s => {
    const ka = key(s.a), kb = key(s.b);
    if (ka === kb) return;
    const e = { a: s.a, b: s.b, ka, kb };
    items.push(e);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(e);
    adj.get(kb).push(e);
  });
  const used = new Set();
  const walk = (k) => {
    const pts = [];
    for (;;) {
      const next = (adj.get(k) || []).find(e => !used.has(e));
      if (!next) return pts;
      used.add(next);
      const forward = next.ka === k;
      pts.push(forward ? next.b : next.a);
      k = forward ? next.kb : next.ka;
    }
  };
  const lines = [];
  items.forEach(start => {
    if (used.has(start)) return;
    used.add(start);
    const ahead = walk(start.kb);
    const behind = walk(start.ka).reverse();
    const coords = [...behind, start.a, start.b, ...ahead];
    if (coords.length >= 2) lines.push(coords.map(([lng, lat]) => [lat, lng]));
  });
  return lines;
}

function dedupedSegments(items) {
  const kept = [];
  const keptGrid = new Map();
  const put = (seg) => {
    kept.push(seg);
    touchCells(seg.a, seg.b, (k) => {
      let bucket = keptGrid.get(k);
      if (!bucket) keptGrid.set(k, bucket = []);
      bucket.push(seg);
    });
  };
  items.forEach(item => {
    if (!item) return;
    allRings(item).forEach(ring => {
      const pts = ring.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (distM(a, b) < 0.05) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let covered = false;
        for (const seg of nearSegs(keptGrid, mid)) {
          if (proj(mid, seg.a, seg.b).d <= DEDUPE_M) { covered = true; break; }
        }
        if (!covered) put({ a: [a[0], a[1]], b: [b[0], b[1]] });
      }
    });
  });
  return kept;
}

export function sealWardDraw(features) {
  const list = (features || []).filter(f => f && f.geometry);
  const items = list.map(f => loadParts(f.geometry));
  densifyGaps(items);
  for (let pass = 0; pass < PASSES; pass++) snapPass(items);
  absorbPass(items);
  items.forEach(item => {
    if (!item) return;
    allRings(item).forEach(r => {
      r.pts = thin(r.pts);
      if (r.pts.length >= 2) r.pts[r.pts.length - 1] = r.pts[0];
    });
  });
  const lines = chainLines(dedupedSegments(items));
  const outFeatures = [];
  const byName = new Map();
  list.forEach((f, i) => {
    const item = items[i];
    if (!item) return;
    const geometry = toGeometry(item);
    if (!geometry) return;
    const feature = { type: 'Feature', geometry, properties: f.properties || {} };
    outFeatures.push(feature);
    const name = wardKey(f.properties, f.name);
    if (name) byName.set(name, geometry);
  });
  return { features: outFeatures, lines, byName };
}

let cached = null;

export function prepareWardDraw(features) {
  cached = sealWardDraw(features);
  return cached;
}

export function getWardDraw() {
  return cached;
}

export function wardDrawGeometry(name) {
  return (cached && cached.byName.get(name)) || null;
}
