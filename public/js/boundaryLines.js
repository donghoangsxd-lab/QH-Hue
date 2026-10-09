// Nối các đoạn ranh có đầu mút cách nhau ≤ dung sai, khép vòng, chỉ giữ vòng ngoài.
// Thử dung sai tăng dần (ranh gServer có chỗ hở vài mét); dung sai trên 1 m chỉ khép khi chỗ hở ≤ CLOSE_RATIO chiều dài vòng.
// Không khép được vòng nào → geometry null (người gọi quay về ranh tự dựng).

const TOLS_M = [1, 5, 25];
const CLOSE_RATIO = 0.005;

function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.hypot((b[1] - a[1]) * 111320, (b[0] - a[0]) * 111320 * Math.cos(lat));
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return s / 2;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = (yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function clusterOf(pt, clusters, tol) {
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].some(q => distM(q, pt) <= tol)) {
      clusters[i].push(pt);
      return i;
    }
  }
  clusters.push([pt.slice()]);
  return clusters.length - 1;
}

function stitch(lines, tol) {
  let paths = lines.map(l => l.map(p => p.slice())).filter(l => l.length >= 2);
  let guard = 0;
  while (paths.length > 1 && guard++ < 10000) {
    const clusters = [];
    const ends = paths.map(p => [clusterOf(p[0], clusters, tol), clusterOf(p[p.length - 1], clusters, tol)]);
    const uses = clusters.map(() => []);
    ends.forEach((e, i) => {
      if (e[0] === e[1]) return;
      uses[e[0]].push({ i, end: 0 });
      uses[e[1]].push({ i, end: 1 });
    });
    const pair = uses.find(u => u.length === 2 && u[0].i !== u[1].i);
    if (!pair) break;
    const A = paths[pair[0].i];
    const B = paths[pair[1].i];
    const a = pair[0].end === 0 ? A.slice().reverse() : A.slice();
    const b = pair[1].end === 1 ? B.slice().reverse() : B.slice();
    const drop = new Set([pair[0].i, pair[1].i]);
    paths = paths.filter((_, i) => !drop.has(i));
    paths.push(a.concat(b.slice(1)));
  }
  return paths;
}

function closeIfNear(line, tol) {
  if (line.length < 3) return null;
  const a = line[0];
  const b = line[line.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return line.length >= 4 ? line : null;
  const gap = distM(a, b);
  if (gap > tol) return null;
  if (gap > 1) {
    let len = 0;
    for (let i = 1; i < line.length; i++) len += distM(line[i - 1], line[i]);
    if (gap > len * CLOSE_RATIO) return null;
  }
  const closed = line.concat([[a[0], a[1]]]);
  return closed.length >= 4 ? closed : null;
}

function centroid(ring) {
  let sx = 0, sy = 0, a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    sx += (ring[i][0] + ring[i + 1][0]) * cross;
    sy += (ring[i][1] + ring[i + 1][1]) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-18) return ring[0];
  return [sx / (3 * a), sy / (3 * a)];
}

/** lines: các đường [[lng, lat], ...]. Trả { geometry, open } — open là số đoạn không khép. */
export function boundaryFromLines(lines) {
  const tries = [];
  for (const tol of TOLS_M) {
    const res = boundaryAt(lines || [], tol);
    if (res.geometry && !res.open) return res;
    tries.push(res);
  }
  return tries.find(r => r.geometry) || tries[tries.length - 1];
}

function boundaryAt(lines, tol) {
  const paths = stitch(lines, tol);
  const rings = [];
  let open = 0;
  paths.forEach(p => {
    const ring = closeIfNear(p, tol);
    if (ring && Math.abs(ringArea(ring)) > 0) rings.push(ring);
    else open++;
  });
  if (!rings.length) return { geometry: null, open };
  const info = rings.map(r => ({ r, area: Math.abs(ringArea(r)), c: centroid(r) }));
  const outers = info.filter(x => !info.some(y => y !== x && y.area > x.area && pointInRing(x.c, y.r)));
  if (!outers.length) return { geometry: null, open };
  const geometry = outers.length === 1
    ? { type: 'Polygon', coordinates: [outers[0].r] }
    : { type: 'MultiPolygon', coordinates: outers.map(o => [o.r]) };
  return { geometry, open, rings: outers.length };
}
