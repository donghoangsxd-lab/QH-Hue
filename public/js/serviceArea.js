// Vùng phục vụ thực tế của 1 công trình theo mạng đường OSM (chỉ tính khi click chọn công trình)
// Dijkstra trên đồ thị đường (đi 2 chiều) → tô các đoạn tới được lên lưới → nới SIDE_M, đóng hình CLOSE_M, lấp lỗ → dò viền, bo góc

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const EXCLUDED_HIGHWAYS = 'motorway|motorway_link|construction|proposed|planned|abandoned|disused|razed|raceway|bus_guideway|platform|corridor|elevator|escape|via_ferrata';
const SIDE_M = 50;      // nhà ven 2 bên đoạn đường tới được
const CLOSE_M = 150;    // lấp khe hẹp hơn 2 × CLOSE_M giữa các nhánh đường
const GAP_M = 25;       // tự nối đầu đường cụt với nút gần hơn GAP_M (bù lỗi nối nút của OSM)
const SNAP_MAX_M = 300; // công trình cách đường xa hơn thì không tính được
const FETCH_TIMEOUT_MS = 25000;
const CACHE_MAX = 30;

const cache = new Map();

function projector(lat0, lng0) {
  const kLat = 111320, kLng = 111320 * Math.cos(lat0 * Math.PI / 180);
  return {
    toXY: (lat, lng) => [(lng - lng0) * kLng, (lat - lat0) * kLat],
    toLngLat: (x, y) => [lng0 + x / kLng, lat0 + y / kLat],
    toLatLng: (x, y) => [lat0 + y / kLat, lng0 + x / kLng]
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function fetchWays(lat, lng, radius) {
  const q = `[out:json][timeout:25];way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!="no"](around:${Math.round(radius)},${lat},${lng});out body geom;`;
  let lastErr = null;
  for (const url of OVERPASS_URLS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      return (data.elements || []).filter(w => Array.isArray(w.nodes) && Array.isArray(w.geometry) && w.nodes.length === w.geometry.length);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Không tải được dữ liệu đường');
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l][0] < a[s][0]) s = l;
        if (r < a.length && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

function buildGraph(ways, proj) {
  const pos = new Map(), adj = new Map(), onBridge = new Set(), segs = [];
  const link = (a, b, w) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, w]);
    adj.get(b).push([a, w]);
  };
  for (const w of ways) {
    const bridge = !!(w.tags && w.tags.bridge && w.tags.bridge !== 'no');
    const xy = w.geometry.map(p => proj.toXY(p.lat, p.lon));
    w.nodes.forEach((id, i) => {
      pos.set(id, xy[i]);
      if (bridge) onBridge.add(id);
    });
    for (let i = 1; i < w.nodes.length; i++) {
      const len = dist(xy[i - 1], xy[i]);
      link(w.nodes[i - 1], w.nodes[i], len);
      segs.push([w.nodes[i - 1], w.nodes[i], len]);
    }
  }

  // Đầu đường cụt không nối lên mặt cầu (đường dưới gầm cầu khác cao độ)
  const cellOf = (p) => `${Math.floor(p[0] / GAP_M)}:${Math.floor(p[1] / GAP_M)}`;
  const grid = new Map();
  for (const [id, p] of pos) {
    if (onBridge.has(id)) continue;
    const k = cellOf(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
  }
  for (const [id, p] of pos) {
    const nb = adj.get(id) || [];
    if (nb.length !== 1 || onBridge.has(id)) continue;
    const own = new Set(nb.map(x => x[0]));
    const cx = Math.floor(p[0] / GAP_M), cy = Math.floor(p[1] / GAP_M);
    let best = null, bestD = GAP_M;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(`${cx + dx}:${cy + dy}`) || []) {
          if (o === id || own.has(o)) continue;
          const d = dist(p, pos.get(o));
          if (d < bestD) { bestD = d; best = o; }
        }
      }
    }
    if (best !== null) link(id, best, bestD);
  }
  return { pos, adj, segs };
}

function dijkstra(graph, src, startDist, radius) {
  const D = new Map([[src, startDist]]);
  const heap = new MinHeap();
  heap.push([startDist, src]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > D.get(u) || d > radius) continue;
    for (const [v, w] of graph.adj.get(u) || []) {
      const nd = d + w;
      if (nd <= radius && nd < (D.get(v) ?? Infinity)) {
        D.set(v, nd);
        heap.push([nd, v]);
      }
    }
  }
  return D;
}

// Các đoạn (hoặc phần đoạn) tới được trong bán kính, toạ độ mét
function reachableSegments(graph, D, radius) {
  const out = [];
  let total = 0;
  const partial = (from, to, dFrom, len) => {
    const f = Math.min(1, (radius - dFrom) / len);
    if (f <= 0) return;
    out.push([from, [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]]);
    total += len * f;
  };
  for (const [a, b, len] of graph.segs) {
    if (len <= 0) continue;
    const da = D.get(a), db = D.get(b), pa = graph.pos.get(a), pb = graph.pos.get(b);
    if (da != null && db != null && da + len <= radius + 1 && db + len <= radius + 1) {
      out.push([pa, pb]);
      total += len;
    } else {
      if (da != null) partial(pa, pb, da, len);
      if (db != null) partial(pb, pa, db, len);
    }
  }
  return { segments: out, totalM: total };
}

// Chọn nút xuất phát: trong vài nút gần nhất, lấy nút tới được nhiều đường nhất (tránh lối đi cụt lọt thỏm trong khuôn viên)
function bestOrigin(graph, radius) {
  const near = [];
  for (const [id, p] of graph.pos) {
    const d = Math.hypot(p[0], p[1]);
    if (d <= SNAP_MAX_M) near.push([d, id]);
  }
  near.sort((a, b) => a[0] - b[0]);
  let best = null;
  for (const [d, id] of near.slice(0, 5)) {
    const D = dijkstra(graph, id, d, radius);
    const reach = reachableSegments(graph, D, radius);
    if (!best || reach.totalM > best.reach.totalM) best = { snapM: d, D, reach };
  }
  return best;
}

function distanceTransform(src, W, H, cell) {
  const d = new Float32Array(W * H);
  const a = cell, b = cell * Math.SQRT2, INF = 1e9;
  for (let i = 0; i < W * H; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - W] + a);
        if (x > 0) v = Math.min(v, d[i - W - 1] + b);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + a);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + a);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + b);
        if (x > 0) v = Math.min(v, d[i + W - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

function floodFill(mask, W, H, seeds) {
  const out = new Uint8Array(W * H);
  const stack = [];
  for (const s of seeds) {
    if (mask[s] && !out[s]) { out[s] = 1; stack.push(s); }
  }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    const nbs = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const j of nbs) {
      if (j >= 0 && mask[j] && !out[j]) { out[j] = 1; stack.push(j); }
    }
  }
  return out;
}

function largestComponent(mask, W, H) {
  const seen = new Uint8Array(W * H);
  let best = null, bestSize = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const comp = floodFill(mask, W, H, [i]);
    let size = 0;
    for (let j = 0; j < W * H; j++) {
      if (comp[j]) { seen[j] = 1; size++; }
    }
    if (size > bestSize) { bestSize = size; best = comp; }
  }
  return best;
}

// Viền ngoài của khối ô: cạnh ô trong/ngoài có hướng (ô trong ở bên trái), nối thành vòng dài nhất
function traceOuterRing(solid, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && solid[y * W + x] === 1;
  const key = (x, y) => y * (W + 1) + x;
  const next = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) next.set(key(x, y), key(x + 1, y));
      if (!inside(x + 1, y)) next.set(key(x + 1, y), key(x + 1, y + 1));
      if (!inside(x, y + 1)) next.set(key(x + 1, y + 1), key(x, y + 1));
      if (!inside(x - 1, y)) next.set(key(x, y + 1), key(x, y));
    }
  }
  const seen = new Set();
  let best = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let k = start;
    while (!seen.has(k) && next.has(k)) {
      seen.add(k);
      ring.push(k);
      k = next.get(k);
    }
    if (ring.length > best.length) best = ring;
  }
  return best.map(k => [k % (W + 1), Math.floor(k / (W + 1))]);
}

function serviceMask(segments, radius, cell) {
  const half = radius + SIDE_M + CLOSE_M + 2 * cell;
  const W = Math.ceil(2 * half / cell), H = W;
  const toCell = (x, y) => [Math.floor((x + half) / cell), Math.floor((half - y) / cell)];
  const road = new Uint8Array(W * H);
  for (const [p, q] of segments) {
    const n = Math.max(1, Math.ceil(dist(p, q) / (cell / 2)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const [cx, cy] = toCell(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) road[cy * W + cx] = 1;
    }
  }
  // Đóng hình: nới (SIDE + CLOSE) rồi thu CLOSE; chỉ giữ phần trong vòng tròn bán kính
  const dRoad = distanceTransform(road, W, H, cell);
  const outside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) outside[i] = dRoad[i] > SIDE_M + CLOSE_M ? 1 : 0;
  const dOut = distanceTransform(outside, W, H, cell);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const cx = (x + 0.5) * cell - half, cy = half - (y + 0.5) * cell;
      mask[i] = dOut[i] > CLOSE_M && Math.hypot(cx, cy) <= radius ? 1 : 0;
    }
  }
  // Lấp lỗ: ô trống không thông ra mép lưới là lỗ bên trong
  const empty = mask.map(v => 1 - v);
  const borderSeeds = [];
  for (let x = 0; x < W; x++) borderSeeds.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) borderSeeds.push(y * W, y * W + W - 1);
  const outer = floodFill(empty, W, H, borderSeeds);
  for (let i = 0; i < W * H; i++) mask[i] = outer[i] ? 0 : 1;
  return { solid: largestComponent(mask, W, H), W, H, half };
}

async function compute(lat, lng, radius) {
  const proj = projector(lat, lng);
  const ways = await fetchWays(lat, lng, radius + 100);
  if (!ways.length) throw new Error('Không có đường giao thông quanh công trình');
  const graph = buildGraph(ways, proj);
  const origin = bestOrigin(graph, radius);
  if (!origin || !origin.reach.segments.length) throw new Error('Công trình cách đường giao thông quá xa');

  const cell = Math.max(10, Math.ceil(radius / 200));
  const { solid, W, H, half } = serviceMask(origin.reach.segments, radius, cell);
  if (!solid) throw new Error('Không dựng được vùng phục vụ');
  const ring = traceOuterRing(solid, W, H).map(([gx, gy]) => proj.toLngLat(gx * cell - half, half - gy * cell));
  if (ring.length < 4) throw new Error('Không dựng được vùng phục vụ');
  ring.push(ring[0]);

  const circle = turf.circle([lng, lat], radius / 1000, { steps: 96 });
  const degPerM = 1 / 111320;
  const rough = turf.simplify(turf.polygon([ring]), { tolerance: cell * 0.9 * degPerM });
  const smooth = turf.simplify(turf.polygonSmooth(rough, { iterations: 3 }).features[0], { tolerance: 2 * degPerM });
  let polygon = turf.intersect(smooth, circle) || smooth;
  if (polygon.geometry.type === 'MultiPolygon') {
    polygon = polygon.geometry.coordinates.map(c => turf.polygon([c[0]])).sort((a, b) => turf.area(b) - turf.area(a))[0];
  }

  const reachRoads = origin.reach.segments.map(([p, q]) => [proj.toLatLng(p[0], p[1]), proj.toLatLng(q[0], q[1])]);
  const allRoads = ways.map(w => w.geometry.map(p => [p.lat, p.lon]));

  return {
    polygon,
    reachRoads,
    allRoads,
    areaKm2: turf.area(polygon) / 1e6,
    circleKm2: Math.PI * (radius / 1000) ** 2,
    reachKm: origin.reach.totalM / 1000,
    snapM: origin.snapM
  };
}

/** Vùng phục vụ thực tế: { polygon (GeoJSON), reachRoads, allRoads ([[lat,lng]...]), areaKm2, circleKm2, reachKm, snapM } */
export async function computeServiceArea(lat, lng, radius) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)},${Math.round(radius)}`;
  if (cache.has(key)) return cache.get(key);
  const pending = compute(lat, lng, radius);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return pending;
}
