// Vùng phục vụ thực tế của 1 công trình theo mạng đường OSM (chỉ tính khi click chọn công trình)
// Dijkstra trên đồ thị đường (đi 2 chiều) → tô các đoạn tới được lên lưới → nới SIDE_M, đóng hình CLOSE_M, lấp lỗ → dò viền, bo góc
import { geeApi } from './api.js';
import { roadDrawGroup, customRoadsVersion } from './wardRoads.js';

const SERVER_TIMEOUT_MS = 30000;     // máy chủ webapp cắt đường từ mạng lưới toàn thành phố đã lưu trên bucket
const SERVER_HEAD_START_MS = 6000;   // máy chủ chưa trả lời sau chừng này thì trình duyệt hỏi thẳng Overpass song song
const ROAD_MARGIN_M = 100;           // tải đường rộng hơn bán kính phục vụ (đường nối ngay ngoài vòng)
const SERVER_MAX_RADIUS_M = 3400;    // bán kính cắt (bậc 500 m) trên 3500 m máy chủ không trả (services/roadsService.js)

// Máy chủ Overpass công cộng hay quá tải (504) → gọi lần lượt có giãn cách, lấy kết quả về trước
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const HEDGE_MS = 4000;          // máy chủ trước chưa trả lời sau chừng này thì gọi thêm máy chủ kế tiếp
const WAYS_CACHE = 'qhhue-overpass-v1';
const WAYS_KEY_VERSION = 2; // 2 = đường có nhóm vẽ (trục chính / có tên / kiệt)
const WAYS_CACHE_DAYS = 14;
const EXCLUDED_HIGHWAYS = 'motorway|motorway_link|construction|proposed|planned|abandoned|disused|razed|raceway|bus_guideway|platform|corridor|elevator|escape|via_ferrata';
const SIDE_M = 50;      // nhà ven 2 bên đoạn đường tới được
const CLOSE_M = 150;    // lấp khe hẹp hơn 2 × CLOSE_M giữa các nhánh đường
const GAP_M = 25;       // tự nối đầu đường cụt với nút gần hơn GAP_M (bù lỗi nối nút của OSM)
const SNAP_MAX_M = 300; // công trình cách đường xa hơn thì không tính được
const FETCH_TIMEOUT_MS = 40000; // tổng thời gian chờ mọi máy chủ Overpass
const CACHE_MAX = 30;
const FLOW_DIRECTIONS = 16; // số hướng minh họa tuyến tiếp cận
const FLOW_MIN_M = 50;      // bỏ hướng có tuyến ngắn hơn (bị chặn ngay cạnh công trình)
const ACCESS_MIN_R = 1000;  // chỉ đường từ vị trí tra cứu: bán kính tải đường nhỏ nhất
const ACCESS_DETOUR = 1.3;  // đường đi thực tế dài hơn đường chim bay ~30%
const ACCESS_GRID_DEG = 0.003; // tâm tải đường làm tròn theo lưới (~330 m) để các click gần nhau dùng chung cache
const ACCESS_GRID_PAD_M = 250; // nửa đường chéo ô lưới: bù phần lệch tâm
const ACCESS_CELL_M = 100;  // ô chỉ mục nút đường khi nối công trình vào mạng
const ACCESS_SNAP_WEIGHT = 1.5; // đoạn đi bộ ngoài đường (từ nút tới công trình) tính nặng hơn khi chọn nút nối

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

// Chỉ giữ phần cần cho đồ thị (nút, tọa độ, cờ cầu) và nhóm vẽ để lưu cache gọn
const slimWays = (elements) => (elements || [])
  .filter(w => Array.isArray(w.nodes) && Array.isArray(w.geometry) && w.nodes.length === w.geometry.length)
  .map(w => ({
    nodes: w.nodes,
    geometry: w.geometry.map(p => ({ lat: p.lat, lon: p.lon })),
    tags: w.tags && w.tags.bridge ? { bridge: w.tags.bridge } : undefined,
    group: roadDrawGroup(w.tags)
  }));

// Cache Storage của trình duyệt (còn sau khi tải lại trang); không hỗ trợ thì bỏ qua
async function cachedWays(key) {
  try {
    if (typeof caches === 'undefined') return null;
    const res = await (await caches.open(WAYS_CACHE)).match(key);
    if (!res) return null;
    const saved = Number(res.headers.get('x-saved')) || 0;
    if (Date.now() - saved > WAYS_CACHE_DAYS * 86400000) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function saveWays(key, ways) {
  try {
    if (typeof caches === 'undefined') return;
    const body = JSON.stringify(ways);
    await (await caches.open(WAYS_CACHE)).put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'x-saved': String(Date.now()) } }));
  } catch (e) { /* hết dung lượng / chế độ riêng tư: bỏ qua */ }
}

async function queryOverpass(url, q, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
    signal
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  // Máy chủ quá tải có thể trả 200 kèm remark lỗi và danh sách rỗng
  if (data.remark && /error|timed out|out of memory/i.test(data.remark) && !(data.elements || []).length) throw new Error(data.remark);
  return data;
}

/** Hỏi lần lượt các máy chủ Overpass (giãn cách hedgeMs), lấy kết quả về trước → JSON Overpass */
export async function queryOverpassHedged(q, timeoutMs = FETCH_TIMEOUT_MS, hedgeMs = HEDGE_MS) {
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const data = await new Promise((resolve, reject) => {
      let next = 0, failed = 0, done = false, lastErr = null, hedge = null;
      const launch = () => {
        clearTimeout(hedge);
        if (done || next >= OVERPASS_URLS.length) return;
        const url = OVERPASS_URLS[next++];
        queryOverpass(url, q, ctrl.signal).then(d => { done = true; clearTimeout(hedge); resolve(d); }, err => {
          lastErr = err;
          if (++failed >= OVERPASS_URLS.length || ctrl.signal.aborted) { done = true; clearTimeout(hedge); reject(lastErr); }
          else launch();
        });
        hedge = setTimeout(launch, hedgeMs);
      };
      ctrl.signal.addEventListener('abort', () => { if (!done) { done = true; clearTimeout(hedge); reject(lastErr || new Error('Máy chủ dữ liệu đường quá tải')); } });
      launch();
    });
    return data;
  } finally {
    clearTimeout(deadline);
    ctrl.abort();
  }
}

// Trình duyệt tự hỏi Overpass (khi máy chủ webapp chậm / lỗi / vị trí không phải công trình trong dữ liệu)
async function fetchWaysDirect(lat, lng, r) {
  const q = `[out:json][timeout:25];way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!="no"](around:${r},${lat},${lng});out body geom;`;
  const ways = slimWays((await queryOverpassHedged(q)).elements);
  ways.direct = true;
  return ways;
}

// Dạng gọn từ máy chủ: [cầu ? 1 : 0, [id nút...], [lat, lon, lat, lon, ...], nhóm vẽ?] → dạng Overpass rút gọn
const unpackWays = (packed) => (packed || []).map(([bridge, nodes, flat, group]) => ({
  nodes,
  geometry: nodes.map((_, i) => ({ lat: flat[2 * i], lon: flat[2 * i + 1] })),
  tags: bridge ? { bridge: 'yes' } : undefined,
  group: group ?? null
}));

// Máy chủ webapp: cắt đường quanh điểm từ mạng lưới toàn thành phố trên bucket (404 nếu Admin chưa tải đủ)
async function requestServerRoads(lat, lng, radius, cv) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  try {
    const res = await fetch(geeApi(`action=getRoads&lat=${lat}&lng=${lng}&r=${Math.round(radius)}&g=1${cv ? `&cv=${cv}` : ''}`), { signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.ways)) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const fetchWaysFromServer = async (lat, lng, radius, cv) => unpackWays((await requestServerRoads(lat, lng, radius, cv)).ways);

// Cache trình duyệt → máy chủ webapp; máy chủ chưa trả lời sau SERVER_HEAD_START_MS (hoặc lỗi) thì hỏi thẳng Overpass, lấy bên về trước
// cv (phiên bản tuyến Admin bổ sung) nằm trong khóa cache: lưu tuyến mới thì các vùng phục vụ tính lại theo mạng lưới mới
async function fetchWays(lat, lng, radius, cv) {
  const r = Math.round(radius + ROAD_MARGIN_M);
  const key = `https://qhhue.cache/overpass?v=${WAYS_KEY_VERSION}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&r=${r}${cv ? `&cv=${cv}` : ''}`;
  const hit = await cachedWays(key);
  if (hit) return hit;

  const server = radius <= SERVER_MAX_RADIUS_M
    ? fetchWaysFromServer(lat, lng, radius, cv)
    : Promise.reject(new Error('Bán kính quá lớn để lưu sẵn'));
  const direct = new Promise((resolve, reject) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      fetchWaysDirect(lat, lng, r).then(resolve, reject);
    };
    const timer = setTimeout(start, SERVER_HEAD_START_MS);
    server.then(() => clearTimeout(timer), () => { clearTimeout(timer); start(); });
  });
  let ways;
  try {
    ways = await Promise.any([server, direct]);
  } catch (err) {
    throw (err.errors && err.errors[err.errors.length - 1]) || err;
  }
  // Mạng lưới lưu cũ chưa có nhóm vẽ: không giữ trong trình duyệt để có màu theo nhóm ngay khi Admin tải lại
  // Overpass trực tiếp không có tuyến Admin bổ sung: không giữ khi đã có tuyến bổ sung
  if (ways.length && ways.every(w => w.group != null) && !(cv && ways.direct)) saveWays(key, ways);
  return ways;
}

/** Đường quanh 1 điểm (gồm tuyến Admin bổ sung) → [{ nodes, geometry: [{ lat, lon }], group }] — dùng khi vẽ tuyến để bắt dính nút */
export async function roadWaysAround(lat, lng, radius) {
  return fetchWays(lat, lng, radius, await customRoadsVersion());
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
      segs.push([w.nodes[i - 1], w.nodes[i], len, w.group]);
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

// D: quãng đường ngắn nhất tới từng nút; P: nút liền trước trên đường ngắn nhất (để dựng lại tuyến đi)
function dijkstra(graph, src, startDist, radius) {
  const D = new Map([[src, startDist]]);
  const P = new Map();
  const heap = new MinHeap();
  heap.push([startDist, src]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > D.get(u) || d > radius) continue;
    for (const [v, w] of graph.adj.get(u) || []) {
      const nd = d + w;
      if (nd <= radius && nd < (D.get(v) ?? Infinity)) {
        D.set(v, nd);
        P.set(v, u);
        heap.push([nd, v]);
      }
    }
  }
  return { D, P };
}

// Các đoạn (hoặc phần đoạn) tới được trong bán kính, toạ độ mét: [điểm đầu, điểm cuối, nhóm vẽ]
function reachableSegments(graph, D, radius) {
  const out = [];
  let total = 0;
  const partial = (from, to, dFrom, len, group) => {
    const f = Math.min(1, (radius - dFrom) / len);
    if (f <= 0) return;
    out.push([from, [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f], group]);
    total += len * f;
  };
  for (const [a, b, len, group] of graph.segs) {
    if (len <= 0) continue;
    const da = D.get(a), db = D.get(b), pa = graph.pos.get(a), pb = graph.pos.get(b);
    if (da != null && db != null && da + len <= radius + 1 && db + len <= radius + 1) {
      out.push([pa, pb, group]);
      total += len;
    } else {
      if (da != null) partial(pa, pb, da, len, group);
      if (db != null) partial(pb, pa, db, len, group);
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
    const { D, P } = dijkstra(graph, id, d, radius);
    const reach = reachableSegments(graph, D, radius);
    if (!best || reach.totalM > best.reach.totalM) best = { snapM: d, D, P, reach };
  }
  return best;
}

// Mỗi hướng (FLOW_DIRECTIONS hướng) lấy nút tới được xa nhất theo đường đi, dựng tuyến ngắn nhất từ nút đó về công trình
function flowPaths(graph, origin, proj) {
  const step = 360 / FLOW_DIRECTIONS;
  const far = new Array(FLOW_DIRECTIONS).fill(null);
  for (const [id, d] of origin.D) {
    const p = graph.pos.get(id);
    const k = Math.round(((Math.atan2(p[0], p[1]) * 180 / Math.PI + 360) % 360) / step) % FLOW_DIRECTIONS;
    if (!far[k] || d > far[k][1]) far[k] = [id, d];
  }
  return far
    .filter(f => f && f[1] - origin.snapM >= FLOW_MIN_M)
    .map(([id]) => {
      const path = [];
      for (let u = id; u !== undefined; u = origin.P.get(u)) path.push(proj.toLatLng(...graph.pos.get(u)));
      path.push(proj.toLatLng(0, 0));
      return path;
    });
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

// Nhóm vẽ → khóa: mạng lưới lưu cũ (chưa có nhóm) vào 'unknown'
const GROUP_KEYS = { 0: 'kiet', 1: 'main', 2: 'named', 3: 'bike' };
const groupKey = (group) => GROUP_KEYS[group] || 'unknown';
const byGroup = () => ({ main: [], named: [], kiet: [], bike: [], unknown: [] });

// Chỉ giữ các đoạn đường có cả 2 đầu nằm trong vùng giới hạn (đồ thị không đi xuyên ra ngoài ranh)
function clipWays(ways, feature) {
  const inside = new Map();
  const isIn = (id, p) => {
    if (!inside.has(id)) inside.set(id, turf.booleanPointInPolygon([p.lon, p.lat], feature));
    return inside.get(id);
  };
  const out = [];
  for (const w of ways) {
    let run = null;
    w.nodes.forEach((id, i) => {
      const p = w.geometry[i];
      if (!isIn(id, p)) { run = null; return; }
      if (!run) out.push(run = { nodes: [], geometry: [], tags: w.tags, group: w.group });
      run.nodes.push(id);
      run.geometry.push(p);
    });
  }
  return out.filter(w => w.nodes.length > 1);
}

const largestPolygon = (poly) => poly.geometry.type === 'MultiPolygon'
  ? poly.geometry.coordinates.map(c => turf.polygon([c[0]])).sort((a, b) => turf.area(b) - turf.area(a))[0]
  : poly;

async function compute(lat, lng, radius, cv, clip) {
  const proj = projector(lat, lng);
  const allWays = await fetchWays(lat, lng, radius, cv);
  const ways = clip ? clipWays(allWays, clip.feature) : allWays;
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
  let polygon = largestPolygon(turf.intersect(smooth, circle) || smooth);
  if (clip) {
    const inWard = turf.intersect(polygon, clip.feature);
    if (!inWard) throw new Error('Vùng phục vụ nằm ngoài ranh phường');
    polygon = largestPolygon(inWard);
  }

  const reachRoads = byGroup();
  origin.reach.segments.forEach(([p, q, group]) => reachRoads[groupKey(group)].push([proj.toLatLng(p[0], p[1]), proj.toLatLng(q[0], q[1])]));
  const allRoads = byGroup();
  allWays.forEach(w => allRoads[groupKey(w.group)].push(w.geometry.map(p => [p.lat, p.lon])));

  return {
    polygon,
    reachRoads,
    allRoads,
    flowPaths: flowPaths(graph, origin, proj),
    areaKm2: turf.area(polygon) / 1e6,
    circleKm2: Math.PI * (radius / 1000) ** 2,
    reachKm: origin.reach.totalM / 1000,
    snapM: origin.snapM
  };
}

/**
 * Vùng phục vụ thực tế: { polygon (GeoJSON), reachRoads, allRoads ({ main, named, kiet, unknown }: [[lat,lng]...] theo nhóm vẽ),
 * flowPaths (tuyến từ rìa về công trình), areaKm2, circleKm2, reachKm, snapM }
 * clip: { key, feature } — vùng giới hạn (ranh phường của công trình cấp đơn vị ở); đồ thị đường và vùng phục vụ không vượt ra ngoài
 */
export async function computeServiceArea(lat, lng, radius, clip = null) {
  const cv = await customRoadsVersion();
  const key = `${lat.toFixed(5)},${lng.toFixed(5)},${Math.round(radius)},${cv},${clip ? clip.key : ''}`;
  if (cache.has(key)) return cache.get(key);
  const pending = compute(lat, lng, radius, cv, clip);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return pending;
}

/**
 * Chỉ đường theo mạng giao thông từ 1 vị trí tới công trình gần nhất của từng nhóm.
 * groups: { khóa nhóm: [{ lat, lng, ref }] } — vài ứng viên gần nhất theo đường chim bay của mỗi nhóm.
 * Dijkstra 1 lần từ nút đường gần vị trí, mỗi ứng viên nối vào nút đã tới được gần nó (≤ SNAP_MAX_M).
 * → { routes: { khóa: { ref, distM, snapM, path: [[lat, lng]...] từ vị trí tới công trình } | null }, radius, snapM }
 */
export async function computeAccessRoutes(lat, lng, groups) {
  const proj = projector(lat, lng);
  const keys = Object.keys(groups);
  let need = 0;
  keys.forEach(key => {
    const nearest = Math.min(...groups[key].map(c => Math.hypot(...proj.toXY(c.lat, c.lng))));
    if (Number.isFinite(nearest)) need = Math.max(need, nearest);
  });
  const radius = Math.min(SERVER_MAX_RADIUS_M - ACCESS_GRID_PAD_M, Math.max(ACCESS_MIN_R, Math.ceil(need * ACCESS_DETOUR / 500) * 500));
  const lat0 = Math.round(lat / ACCESS_GRID_DEG) * ACCESS_GRID_DEG;
  const lng0 = Math.round(lng / ACCESS_GRID_DEG) * ACCESS_GRID_DEG;
  const ways = await fetchWays(lat0, lng0, radius + ACCESS_GRID_PAD_M, await customRoadsVersion());
  if (!ways.length) throw new Error('Không có đường giao thông quanh vị trí');
  const graph = buildGraph(ways, proj);

  // Nút xuất phát: nút gần nhất, trừ khi nó nằm trên mảng đường cụt nhỏ (lối trong khuôn viên) so với nút gần khác
  const near = [];
  for (const [id, p] of graph.pos) {
    const d = Math.hypot(p[0], p[1]);
    if (d <= SNAP_MAX_M) near.push([d, id]);
  }
  if (!near.length) throw new Error(`Vị trí cách đường giao thông quá xa (> ${SNAP_MAX_M} m)`);
  near.sort((a, b) => a[0] - b[0]);
  const limit = radius * 2;
  const tries = [];
  for (const [d, id] of near.slice(0, 5)) {
    if (tries.some(t => t.D.has(id))) continue;   // cùng mảng đường với nút đã thử
    tries.push({ snapM: d, ...dijkstra(graph, id, d, limit) });
  }
  const maxReach = Math.max(...tries.map(t => t.D.size));
  const origin = tries.find(t => t.D.size >= maxReach * 0.5);

  const grid = new Map();
  const cellKey = (cx, cy) => `${cx}:${cy}`;
  for (const id of origin.D.keys()) {
    const p = graph.pos.get(id);
    const k = cellKey(Math.floor(p[0] / ACCESS_CELL_M), Math.floor(p[1] / ACCESS_CELL_M));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
  }
  const span = Math.ceil(SNAP_MAX_M / ACCESS_CELL_M);
  const attach = (xy) => {
    const cx = Math.floor(xy[0] / ACCESS_CELL_M), cy = Math.floor(xy[1] / ACCESS_CELL_M);
    let best = null;
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (const id of grid.get(cellKey(cx + dx, cy + dy)) || []) {
          const snap = dist(xy, graph.pos.get(id));
          if (snap > SNAP_MAX_M) continue;
          const score = origin.D.get(id) + snap * ACCESS_SNAP_WEIGHT;
          if (!best || score < best.score) best = { id, snap, score };
        }
      }
    }
    return best;
  };

  const routes = {};
  keys.forEach(key => {
    let best = null;
    groups[key].forEach(c => {
      const a = attach(proj.toXY(c.lat, c.lng));
      if (!a) return;
      const distM = origin.D.get(a.id) + a.snap;
      if (!best || distM < best.distM) best = { c, a, distM };
    });
    if (!best) { routes[key] = null; return; }
    const path = [[best.c.lat, best.c.lng]];
    for (let u = best.a.id; u !== undefined; u = origin.P.get(u)) path.push(proj.toLatLng(...graph.pos.get(u)));
    path.push([lat, lng]);
    path.reverse();
    routes[key] = { ref: best.c.ref, distM: best.distM, snapM: best.a.snap, path };
  });
  return { routes, radius, snapM: origin.snapM };
}
