// Mũi tên xu hướng thoát nước khái quát cho vùng xây dựng: từ đường phân thủy (tâm lưu vực) chảy về sông, kênh, hồ bao quanh.
// Thế thoát nước = cao độ FABDEM làm trơn + BETA × khoảng cách tới mặt nước gần nhất: vùng phẳng (dốc < BETA, cao độ nhiễu)
// do khoảng cách quyết định, vùng gò đồi do cao độ quyết định. Lấp trũng ưu tiên (priority-flood) từ mặt nước → cây dòng chảy
// mọi ô đều về được sông hồ; đường phân thủy là điểm xa nhất (theo chiều dài đường chảy) đổ vào mỗi nhánh. Mũi tên đặt ở POS
// (3/4) đường chảy từ phân thủy tới mép nước, bám đoạn đường phố gần đó cùng hướng (thoát nước đô thị bám theo đường), kéo dài
// dọc tuyến phố đó ARROW_MIN_M–ARROW_M m; tuyến cùng hướng thoát nước (gần vuông góc bờ sông) ngắn hơn thì bỏ.
//   node scripts/build-huongthoat.js [--out HuongThoat.geojson] [--preview .cache/huongthoat-preview.html] [--bbox w,s,e,n]
//     --spacing 200     khoảng cách tối thiểu giữa 2 mũi tên (m)
//     --pos 0.75        vị trí mũi tên trên quãng phân thủy → mép nước (0 = tâm, 1 = sát sông)
//     --built 80        mật độ đường tối thiểu (m/ha, cửa sổ 300 m) để coi là vùng xây dựng — chỉ vẽ mũi tên ở đây
//     --step 600        lưu vực dài: thêm mũi tên cách nhau step m dọc đường chảy, ngược lên phía phân thủy (0 = chỉ vị trí POS)
//     --beta 0.005      trọng số khoảng cách tới mặt nước (m cao độ / m) — dốc địa hình nhỏ hơn coi như phẳng
//     --no-dem          bỏ cao độ, chỉ dùng khoảng cách tới mặt nước
//     --refresh-roads   tải lại roads/v2 từ bucket (mặc định dùng bản lưu .cache/roads-v2/)
//     --refresh-osm     tải lại sông, kênh OSM (Overpass)
// Đường: roads/v2 trên bucket (OSM theo phường + tuyến vẽ bổ sung). Mặt nước: OSM (sông, kênh, hồ ≥ MIN_LAKE_M2, phá).
// Cao độ: ô Terrarium FABDEM mức DEM_Z qua hydroCommon (cache .cache/dem/), hệ EGM2008.
const fs = require('fs');
const path = require('path');
const { ROOT, D2R, lng2tx, lat2ty, demSource, loadDem, loadOsm } = require('./hydroCommon');

const ROADS_BASE = 'https://storage.googleapis.com/hue-infra-data-us/roads/v2/';
const ROADS_CACHE = path.join(ROOT, '.cache', 'roads-v2');
const RES = 10;                // ô lưới khoảng cách (m)
const COARSE = 100;            // ô lưới mật độ đường (m)
const MARGIN_M = 1500;         // lấy rộng quanh mỗi cụm xây dựng để mặt nước ngoài cụm vẫn tính khoảng cách
const MIN_CLUSTER_HA = 30;
const MIN_R = 120;             // khu đất có đường phân thủy cách mặt nước < 120 m (dải hẹp giữa 2 kênh) không vẽ
const SNAP_M = 60;             // ô ứng viên không có đoạn phố cùng hướng trong 60 m → không vẽ mũi tên
const SNAP_DEG = 40;
const TURN_DEG = 60;           // mũi tên đi tiếp sang tuyến khác ở nút khi lệch hướng < 60°
const SLOPE_WIN_M = 20;
const MIN_DESCENT = 0.6;       // cả mũi tên: thế giảm ≥ 0,6 × độ dốc thế mỗi mét (lệch hướng thoát nước ≤ ~53°)
const STEP_DESCENT = 0.4;      // từng quãng SLOPE_WIN_M: lệch ≤ ~66° (phố cong nhẹ vẫn đi tiếp)
const ARROW_M = 260;           // chiều dài mũi tên mong muốn dọc phố
const ARROW_MIN_M = 200;       // tuyến phố cùng hướng thoát nước ngắn hơn không đủ thể hiện hướng chảy → bỏ
const OVERLAP_M = 30;
const MIN_STRAIGHT = 0.8;      // khoảng cách đầu – cuối / chiều dài: mũi tên bẻ góc chữ L sang phố khác thì bỏ
const MIN_LAKE_M2 = 5000;      // ao, hồ nhỏ hơn không nhận nước của khu vực
const CELL_M = 100;
const DEM_Z = 12;              // ô Terrarium mức 12 ≈ 37 m, sát độ phân giải 30 m của FABDEM
const DEM_SMOOTH_PX = 4;       // lọc hộp bán kính 4 ô 10 m, 2 lượt (~90 m) để bỏ nhiễu cao độ cục bộ
const FILL_EPS = 1e-3;         // độ nâng mỗi ô khi lấp trũng — vùng trũng kín có dốc thế ~0 nên không đặt mũi tên
// Nửa bề rộng dòng chỉ có đường tâm; mương, rãnh nhỏ (drain, ditch) không tính là nơi nhận nước của cả khu
const LINE_HW = { river: 12, canal: 5, tidal_channel: 5, stream: 3 };

const opt = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

function slug(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function getRoadFile(name, refresh) {
  const file = path.join(ROADS_CACHE, `${name}.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(`${ROADS_BASE}${name}.json?v=${Date.now()}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`roads/v2/${name}.json HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(ROADS_CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return JSON.parse(text);
}

/** → [{ nodes: [id], pts: [[lat, lng]], bridge, g }] không trùng id, bỏ đường xe đạp (nhóm vẽ 3) */
async function loadRoads(refresh) {
  const index = await getRoadFile('index', refresh);
  const seen = new Set();
  const ways = [];
  const add = (id, bridge, nodes, flat, g) => {
    if (seen.has(id) || g === 3 || !Array.isArray(flat) || flat.length < 4) return;
    if (!Array.isArray(nodes) || nodes.length * 2 !== flat.length) return;
    seen.add(id);
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    ways.push({ nodes, pts, bridge: !!bridge, g: g ?? 0 });
  };
  const wards = Object.entries(index.wards || {});
  for (const [name, w] of wards) {
    for (let i = 0; i < (w.parts || 0); i++) {
      const part = await getRoadFile(`net_${slug(name)}_${i}`, refresh);
      (part.ways || []).forEach(([id, bridge, nodes, flat, g]) => add(id, bridge, nodes, flat, g));
    }
  }
  try {
    const custom = await getRoadFile('custom', refresh);
    (custom.roads || []).forEach(r => add(`c:${r.id}`, 0, r.nodes, r.flat, r.g));
  } catch (e) { /* chưa có tuyến vẽ bổ sung */ }
  return { ways, wards: wards.length };
}

/** Phép chiếu phẳng cục bộ (m) quanh vĩ độ giữa vùng — sai số < 2% trong phạm vi tỉnh */
function makeProj(lat0, lng0) {
  const ky = 110540, kx = 111320 * Math.cos(lat0 * D2R);
  return {
    fwd: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky],
    inv: (x, y) => [y / ky + lat0, x / kx + lng0]
  };
}

const polyLen = (p) => {
  let s = 0;
  for (let k = 1; k < p.length; k++) s += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
  return s;
};

/** Phần đầu dài len (m) của đường gấp khúc */
function trimPoly(p, len) {
  const out = [p[0]];
  let s = 0;
  for (let k = 1; k < p.length; k++) {
    const l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    if (s + l >= len) {
      const t = l ? (len - s) / l : 0;
      if (t > 0) out.push([p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t]);
      return out;
    }
    out.push(p[k]);
    s += l;
  }
  return out;
}

/** Điểm cách đều step (m) dọc đường gấp khúc, gồm cả 2 đầu */
function samplePoly(p, step) {
  const out = [p[0]];
  let carry = 0;
  for (let k = 1; k < p.length; k++) {
    const [ax, ay] = p[k - 1], [bx, by] = p[k], l = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    for (; d <= l; d += step) out.push([ax + (bx - ax) * d / l, ay + (by - ay) * d / l]);
    carry = l - (d - step);
  }
  out.push(p[p.length - 1]);
  return out;
}

const shoelace = (p) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(s / 2);
};

/** OSM → mặt nước nhận nước: vùng (danh sách cạnh, tô theo chẵn lẻ) và đường tâm sông kênh có nửa bề rộng */
function buildWater(osm, proj) {
  const nodes = new Map(), ways = new Map();
  osm.elements.forEach(e => {
    if (e.type === 'node') nodes.set(e.id, proj.fwd(e.lat, e.lon));
    else if (e.type === 'way') ways.set(e.id, e);
  });
  const coords = (w) => (w.nodes || []).map(id => nodes.get(id)).filter(Boolean);
  const isArea = (t) => (t.natural === 'water' && t.water !== 'wastewater') || t.waterway === 'riverbank' || t.landuse === 'reservoir';
  const isFlowing = (t) => t.waterway === 'riverbank' || ['river', 'stream', 'canal', 'moat', 'lagoon', 'oxbow'].includes(t.water);
  const feats = [];
  const memberOf = new Set();
  osm.elements.forEach(e => {
    if (e.type !== 'relation' || !e.tags || !isArea(e.tags)) return;
    const lines = (e.members || []).filter(m => m.type === 'way' && ways.has(m.ref))
      .map(m => { memberOf.add(m.ref); return coords(ways.get(m.ref)); }).filter(l => l.length >= 2);
    if (lines.length) feats.push({ area: true, lines });
  });
  ways.forEach(w => {
    const t = w.tags;
    if (!t) return;
    const c = coords(w);
    if (c.length < 2) return;
    if (isArea(t) && !memberOf.has(w.id)) {
      if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) return;
      if (!isFlowing(t) && shoelace(c) < MIN_LAKE_M2) return;
      feats.push({ area: true, lines: [c] });
    } else if (LINE_HW[t.waterway]) {
      feats.push({ area: false, hw: LINE_HW[t.waterway], lines: [c] });
    }
  });
  feats.forEach(f => {
    f.minX = Infinity; f.minY = Infinity; f.maxX = -Infinity; f.maxY = -Infinity;
    f.lines.forEach(l => l.forEach(([x, y]) => {
      if (x < f.minX) f.minX = x; if (x > f.maxX) f.maxX = x;
      if (y < f.minY) f.minY = y; if (y > f.maxY) f.maxY = y;
    }));
  });
  return feats;
}

/** Lưới mặt nước (1 = nước) cho khung; hàng 0 ở phía bắc, tâm ô (gx0 + (i + 0.5)·RES, gy0 − (j + 0.5)·RES) */
function rasterWater(feats, gx0, gy0, W, H) {
  const mask = new Uint8Array(W * H);
  const gx1 = gx0 + W * RES, gy1 = gy0 - H * RES;
  feats.forEach(f => {
    const pad = f.area ? 0 : f.hw + RES;
    if (f.maxX + pad < gx0 || f.minX - pad > gx1 || f.maxY + pad < gy1 || f.minY - pad > gy0) return;
    if (f.area) {
      const edges = [];
      f.lines.forEach(l => { for (let k = 1; k < l.length; k++) edges.push(l[k - 1], l[k]); });
      const j0 = Math.max(0, Math.floor((gy0 - f.maxY) / RES)), j1 = Math.min(H - 1, Math.ceil((gy0 - f.minY) / RES));
      const xs = [];
      for (let j = j0; j <= j1; j++) {
        const y = gy0 - (j + 0.5) * RES;
        xs.length = 0;
        for (let k = 0; k < edges.length; k += 2) {
          const [ax, ay] = edges[k], [bx, by] = edges[k + 1];
          if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - gx0) / RES - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[k + 1] - gx0) / RES - 0.5));
          for (let i = i0; i <= i1; i++) mask[j * W + i] = 1;
        }
      }
    }
    // Viền vùng và đường tâm: vẽ dày tối thiểu 1 ô để kênh hẹp không bị đứt quãng
    const hw = f.area ? RES * 0.5 : f.hw + RES * 0.5;
    f.lines.forEach(l => {
      for (let k = 1; k < l.length; k++) {
        const [ax, ay] = l[k - 1], [bx, by] = l[k];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - gx0) / RES)), i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx) + hw - gx0) / RES));
        const j0 = Math.max(0, Math.floor((gy0 - Math.max(ay, by) - hw) / RES)), j1 = Math.min(H - 1, Math.floor((gy0 - Math.min(ay, by) + hw) / RES));
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
        for (let j = j0; j <= j1; j++) {
          const py = gy0 - (j + 0.5) * RES;
          for (let i = i0; i <= i1; i++) {
            const px = gx0 + (i + 0.5) * RES;
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
            if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= hw * hw) mask[j * W + i] = 1;
          }
        }
      }
    });
  });
  return mask;
}

/** Biến đổi khoảng cách Euclid chính xác (Felzenszwalb–Huttenlocher) → khoảng cách (m) tới ô nước gần nhất */
function distanceField(mask, W, H) {
  const INF = 1e20;
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const g = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) g[k] = mask[k] ? 0 : INF;
  const pass = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = g[j * W + i];
    pass(H);
    for (let j = 0; j < H; j++) g[j * W + i] = d[j];
  }
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = g[j * W + i];
    pass(W);
    for (let i = 0; i < W; i++) out[j * W + i] = Math.sqrt(d[i]) * RES;
  }
  return out;
}

/** Lọc hộp tách hàng / cột bán kính r ô, tại chỗ */
function boxBlur(a, W, H, r) {
  const pre = new Float64Array(Math.max(W, H) + 1);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) pre[i + 1] = pre[i] + a[j * W + i];
    for (let i = 0; i < W; i++) {
      const lo = Math.max(0, i - r), hi = Math.min(W, i + r + 1);
      a[j * W + i] = (pre[hi] - pre[lo]) / (hi - lo);
    }
  }
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) pre[j + 1] = pre[j] + a[j * W + i];
    for (let j = 0; j < H; j++) {
      const lo = Math.max(0, j - r), hi = Math.min(H, j + r + 1);
      a[j * W + i] = (pre[hi] - pre[lo]) / (hi - lo);
    }
  }
}

/** Cao độ (m) nội suy song tuyến từ lưới Terrarium về lưới RES của khung, đã làm trơn; ô không dữ liệu (biển) = 0 */
function sampleDem(dem, proj, gx0, gy0, W, H) {
  const px = new Float64Array(W), py = new Float64Array(H);
  for (let i = 0; i < W; i++) px[i] = (lng2tx(proj.inv(gx0 + (i + 0.5) * RES, 0)[1], DEM_Z) - dem.tx0) * 256 - 0.5;
  for (let j = 0; j < H; j++) py[j] = (lat2ty(proj.inv(0, gy0 - (j + 0.5) * RES)[0], DEM_Z) - dem.ty0) * 256 - 0.5;
  const v = (a, b) => {
    const h = a >= 0 && a < dem.W && b >= 0 && b < dem.H ? dem.elev[b * dem.W + a] : NaN;
    return Number.isNaN(h) ? 0 : h;
  };
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const b = Math.floor(py[j]), fy = py[j] - b;
    for (let i = 0; i < W; i++) {
      const a = Math.floor(px[i]), fx = px[i] - a;
      z[j * W + i] = (v(a, b) * (1 - fx) + v(a + 1, b) * fx) * (1 - fy) + (v(a, b + 1) * (1 - fx) + v(a + 1, b + 1) * fx) * fy;
    }
  }
  boxBlur(z, W, H, DEM_SMOOTH_PX);
  boxBlur(z, W, H, DEM_SMOOTH_PX);
  return z;
}

/**
 * Lấp trũng ưu tiên từ mép mặt nước theo thế pot → { fill (thế đã lấp), parent (ô hạ lưu kế tiếp), order (land ô đất, hạ lưu
 * luôn đứng trước thượng lưu) }. Mỗi ô đất do ô thấp nhất đã xử lý cạnh nó "nhận" → cây dòng chảy không chu trình.
 */
function floodTree(mask, pot, W, H) {
  const N = W * H;
  const fill = Float64Array.from(pot), parent = new Int32Array(N).fill(-1), seen = new Uint8Array(N);
  const hk = new Float64Array(N), hv = new Int32Array(N);
  let hn = 0;
  const push = (k, v) => {
    let i = hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p]; hv[i] = hv[p]; i = p;
    }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const top = hv[0], k = hk[--hn], v = hv[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= k) break;
      hk[i] = hk[c]; hv[i] = hv[c]; i = c;
    }
    hk[i] = k; hv[i] = v;
    return top;
  };
  const DI = [-1, 0, 1, -1, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 1, 1, 1];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const p = j * W + i;
      if (!mask[p]) continue;
      seen[p] = 1;
      for (let k = 0; k < 8; k++) {
        const a = i + DI[k], b = j + DJ[k];
        if (a >= 0 && a < W && b >= 0 && b < H && !mask[b * W + a]) { push(fill[p], p); break; }
      }
    }
  }
  const order = new Int32Array(N);
  let land = 0;
  while (hn) {
    const c = pop();
    if (!mask[c]) order[land++] = c;
    const i = c % W, j = (c - i) / W;
    for (let k = 0; k < 8; k++) {
      const a = i + DI[k], b = j + DJ[k];
      if (a < 0 || a >= W || b < 0 || b >= H) continue;
      const q = b * W + a;
      if (seen[q]) continue;
      seen[q] = 1;
      if (fill[q] < fill[c] + FILL_EPS) fill[q] = fill[c] + FILL_EPS;
      parent[q] = c;
      push(fill[q], q);
    }
  }
  return { fill, parent, order, land };
}

async function main() {
  const args = process.argv.slice(2);
  const outFile = opt(args, '--out') || path.join(ROOT, 'HuongThoat.geojson');
  const previewFile = opt(args, '--preview') || path.join(ROOT, '.cache', 'huongthoat-preview.html');
  const pbbox = (opt(args, '--bbox') || '107.55,16.43,107.64,16.49').split(',').map(Number);
  if (pbbox.length !== 4 || pbbox.some(v => !Number.isFinite(v))) throw new Error('--bbox phải là w,s,e,n (độ)');
  const spacing = Number(opt(args, '--spacing') ?? 200);
  const pos = Number(opt(args, '--pos') ?? 0.75);
  const built = Number(opt(args, '--built') ?? 80);
  const beta = Number(opt(args, '--beta') ?? 0.005);
  const step = Number(opt(args, '--step') ?? 600);
  if (!(spacing > 0) || !(pos > 0 && pos < 1) || !(built >= 0) || !(beta > 0) || !(step >= 0)) {
    throw new Error('--spacing > 0, 0 < --pos < 1, --built ≥ 0, --beta > 0, --step ≥ 0');
  }

  const { ways, wards } = await loadRoads(args.includes('--refresh-roads'));
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  ways.forEach(r => r.pts.forEach(([lat, lng]) => {
    if (lat < s) s = lat; if (lat > n) n = lat;
    if (lng < w) w = lng; if (lng > e) e = lng;
  }));
  console.log(`✓ Đường: ${ways.length} tuyến của ${wards} phường xã`);
  const osm = await loadOsm([w - 0.03, s - 0.03, e + 0.03, n + 0.03], args.includes('--refresh-osm'));
  const proj = makeProj((s + n) / 2, (w + e) / 2);
  const feats = buildWater(osm, proj);
  ways.forEach(r => { r.xy = r.pts.map(([lat, lng]) => proj.fwd(lat, lng)); });
  console.log(`✓ Mặt nước nhận nước: ${feats.filter(f => f.area).length} vùng, ${feats.filter(f => !f.area).length} sông kênh dạng đường`);
  let dem = null;
  if (!args.includes('--no-dem')) {
    let src = await demSource();
    // SRTM là cao độ bề mặt (còn mái nhà, tán cây) → không dùng cho đô thị; GEE lỗi thì dùng ô FABDEM đã lưu
    if (src.key !== 'fabdem') {
      if (!fs.existsSync(path.join(ROOT, '.cache', 'dem', 'fabdem', String(DEM_Z)))) {
        throw new Error('Không lấy được FABDEM qua GEE và chưa có bản lưu .cache/dem/fabdem — chạy lại sau hoặc dùng --no-dem');
      }
      src = { url: '', name: 'FABDEM (bản lưu .cache/dem, GEE không phản hồi)', key: 'fabdem' };
    }
    dem = await loadDem([w - 0.03, s - 0.03, e + 0.03, n + 0.03], DEM_Z, src);
    console.log(`✓ Cao độ: ${src.name}, ${dem.tiles} ô mức ${DEM_Z} (${dem.empty} ô trống), trọng số khoảng cách ${beta}`);
  }
  // Độ dốc thế đặc trưng của vùng phẳng: dưới nửa mức này coi là đỉnh phân thủy / đáy trũng, không đặt mũi tên
  const gFlat = dem ? beta : 1;

  // Mật độ đường trên lưới thô (m/ha, trung bình cửa sổ 3 × 3 ô) → vùng xây dựng → các cụm liền nhau
  const [bx0, by0] = proj.fwd(s, w), [bx1, by1] = proj.fwd(n, e);
  const CW = Math.ceil((bx1 - bx0) / COARSE) + 1, CH = Math.ceil((by1 - by0) / COARSE) + 1;
  const roadLen = new Float32Array(CW * CH);
  ways.forEach(r => {
    for (let k = 1; k < r.xy.length; k++) {
      const [ax, ay] = r.xy[k - 1], [cx, cy] = r.xy[k];
      const len = Math.hypot(cx - ax, cy - ay), parts = Math.max(1, Math.ceil(len / 25));
      for (let p = 0; p < parts; p++) {
        const t = (p + 0.5) / parts;
        const ci = Math.floor((ax + (cx - ax) * t - bx0) / COARSE), cj = Math.floor((ay + (cy - ay) * t - by0) / COARSE);
        if (ci >= 0 && ci < CW && cj >= 0 && cj < CH) roadLen[cj * CW + ci] += len / parts;
      }
    }
  });
  const isBuilt = new Uint8Array(CW * CH);
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = ci + di, b = cj + dj;
        if (a >= 0 && a < CW && b >= 0 && b < CH) sum += roadLen[b * CW + a];
      }
      if (sum / 9 >= built) isBuilt[cj * CW + ci] = 1;
    }
  }
  const cluster = new Int32Array(CW * CH).fill(-1);
  const clusters = [];
  for (let k = 0; k < CW * CH; k++) {
    if (!isBuilt[k] || cluster[k] >= 0) continue;
    const id = clusters.length, stack = [k], cells = [];
    cluster[k] = id;
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const ci = c % CW, cj = (c - ci) / CW;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = ci + di, b = cj + dj;
        if (a < 0 || a >= CW || b < 0 || b >= CH) continue;
        const q = b * CW + a;
        if (isBuilt[q] && cluster[q] < 0) { cluster[q] = id; stack.push(q); }
      }
    }
    clusters.push(cells);
  }
  const big = clusters.map((cells, id) => ({ id, cells })).filter(c => c.cells.length * COARSE * COARSE / 1e4 >= MIN_CLUSTER_HA);
  console.log(`✓ Vùng xây dựng (≥ ${built} m đường/ha): ${big.length} cụm ≥ ${MIN_CLUSTER_HA} ha,`
    + ` ${(big.reduce((t, c) => t + c.cells.length, 0) * COARSE * COARSE / 1e6).toFixed(1)} km²`);

  // Lưới đoạn đường để bám mũi tên vào phố cùng hướng
  const roadGrid = new Map();
  ways.forEach(r => {
    if (r.bridge) return;
    for (let k = 1; k < r.xy.length; k++) {
      const sg = [r.xy[k - 1][0], r.xy[k - 1][1], r.xy[k][0], r.xy[k][1], r, k];
      const x0 = Math.floor((Math.min(sg[0], sg[2]) - SNAP_M) / CELL_M), x1 = Math.floor((Math.max(sg[0], sg[2]) + SNAP_M) / CELL_M);
      const y0 = Math.floor((Math.min(sg[1], sg[3]) - SNAP_M) / CELL_M), y1 = Math.floor((Math.max(sg[1], sg[3]) + SNAP_M) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 100003 + cy;
        let arr = roadGrid.get(key);
        if (!arr) roadGrid.set(key, arr = []);
        arr.push(sg);
      }
    }
  });
  const cosSnap = Math.cos(SNAP_DEG * D2R);
  const snapToRoad = (x, y, fx, fy) => {
    let best = null;
    for (const sg of roadGrid.get(Math.floor(x / CELL_M) * 100003 + Math.floor(y / CELL_M)) || []) {
      const dx = sg[2] - sg[0], dy = sg[3] - sg[1], l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const dot = (dx * fx + dy * fy) / l;
      if (Math.abs(dot) < cosSnap) continue;
      const t = Math.max(0, Math.min(1, ((x - sg[0]) * dx + (y - sg[1]) * dy) / (l * l)));
      const px = sg[0] + t * dx, py = sg[1] + t * dy, dist = Math.hypot(x - px, y - py);
      if (dist > SNAP_M || (best && dist >= best.dist)) continue;
      const dir = dot > 0 ? 1 : -1;
      best = { x: px, y: py, dist, r: sg[4], next: dir > 0 ? sg[5] : sg[5] - 1, dir };
    }
    return best;
  };

  const nodeWays = new Map();
  ways.forEach(r => {
    if (r.bridge) return;
    r.nodes.forEach((id, i) => {
      if (!nodeWays.has(id)) nodeWays.set(id, []);
      nodeWays.get(id).push({ r, i });
    });
  });
  const cosTurn = Math.cos(TURN_DEG * D2R);
  /**
   * Đi dọc phố từ (x, y) về phía đỉnh `next` của tuyến r (chiều dir), hết tuyến thì sang tuyến đi thẳng nhất ở nút,
   * tối đa len mét; accept(ax, ay, bx, by) → phần (0..1) của đoạn được đi tiếp. → [[x, y], ...]
   */
  const walk = (x, y, r, next, dir, len, accept) => {
    const pts = [[x, y]];
    let cur = { r, i: next, dir }, done = 0, hx = 0, hy = 0;
    for (let guard = 0; guard < 500 && done < len; guard++) {
      const [nx, ny] = cur.r.xy[cur.i];
      const sl = Math.hypot(nx - x, ny - y);
      if (sl > 0.01) {
        const f = Math.min(1, (len - done) / sl, accept(x, y, nx, ny));
        if (f <= 0) break;
        const tx = x + (nx - x) * f, ty = y + (ny - y) * f;
        pts.push([tx, ty]);
        done += sl * f;
        hx = (nx - x) / sl; hy = (ny - y) / sl;
        x = tx; y = ty;
        if (f < 1) break;
      }
      const ni = cur.i + cur.dir;
      if (ni >= 0 && ni < cur.r.xy.length) { cur.i = ni; continue; }
      let best = null, bestDot = cosTurn;
      for (const { r: w, i } of nodeWays.get(cur.r.nodes[cur.i]) || []) {
        if (w === cur.r) continue;
        for (const d of [-1, 1]) {
          const j = i + d;
          if (j < 0 || j >= w.xy.length) continue;
          const ex = w.xy[j][0] - w.xy[i][0], ey = w.xy[j][1] - w.xy[i][1], el = Math.hypot(ex, ey);
          const dot = el ? (ex * hx + ey * hy) / el : -1;
          if (dot > bestDot) { bestDot = dot; best = { r: w, i: j, dir: d }; }
        }
      }
      if (!best) break;
      cur = best;
    }
    return pts;
  };

  const kept = [];
  const kgrid = new Map();
  const farFromKept = (x, y) => {
    const cx = Math.floor(x / spacing), cy = Math.floor(y / spacing);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      for (const k of kgrid.get(`${i},${j}`) || []) if (Math.hypot(k.x - x, k.y - y) < spacing) return false;
    }
    return true;
  };
  // Điểm mẫu 10 m của các mũi tên đã chọn: mũi tên mới đi sát (< OVERLAP_M) mũi tên cũ trên cùng tuyến thì bỏ
  const lgrid = new Map();
  const nearKeptLine = (x, y) => {
    const cx = Math.floor(x / OVERLAP_M), cy = Math.floor(y / OVERLAP_M);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const a = lgrid.get(`${i},${j}`);
      if (a) for (let k = 0; k < a.length; k += 2) if (Math.hypot(a[k] - x, a[k + 1] - y) < OVERLAP_M) return true;
    }
    return false;
  };
  let nCands = 0, unsnapped = 0, short = 0, bent = 0, downhill = 0, overlap = 0;
  const t0 = Date.now();
  big.forEach(c => {
    let ci0 = Infinity, ci1 = -Infinity, cj0 = Infinity, cj1 = -Infinity;
    c.cells.forEach(k => {
      const ci = k % CW, cj = (k - ci) / CW;
      if (ci < ci0) ci0 = ci; if (ci > ci1) ci1 = ci;
      if (cj < cj0) cj0 = cj; if (cj > cj1) cj1 = cj;
    });
    const gx0 = bx0 + ci0 * COARSE - MARGIN_M, gy0 = by0 + (cj1 + 1) * COARSE + MARGIN_M;
    const W = Math.ceil(((ci1 - ci0 + 1) * COARSE + 2 * MARGIN_M) / RES);
    const H = Math.ceil(((cj1 - cj0 + 1) * COARSE + 2 * MARGIN_M) / RES);
    const mask = rasterWater(feats, gx0, gy0, W, H);
    if (!mask.some(v => v)) return;
    const dist = distanceField(mask, W, H);
    const N = W * H;
    const pot = new Float64Array(N);
    if (dem) {
      const z = sampleDem(dem, proj, gx0, gy0, W, H);
      for (let p = 0; p < N; p++) pot[p] = z[p] + beta * dist[p];
    } else {
      pot.set(dist);
    }
    const { fill, parent, order, land } = floodTree(mask, pot, W, H);

    // L = chiều dài đường chảy tới mép nước; R = L lớn nhất trong các ô đổ về (điểm phân thủy của nhánh)
    const L = new Float32Array(N);
    for (let k = 0; k < land; k++) {
      const p = order[k], q = parent[p], dq = Math.abs(p - q);
      L[p] = (mask[q] ? 0 : L[q]) + (dq === 1 || dq === W ? RES : RES * Math.SQRT2);
    }
    const R = Float32Array.from(L);
    for (let k = land - 1; k >= 0; k--) {
      const p = order[k], q = parent[p];
      if (!mask[q] && R[p] > R[q]) R[q] = R[p];
    }
    const G = new Float32Array(N);
    for (let j = 2; j < H - 2; j++) {
      for (let i = 2; i < W - 2; i++) {
        const p = j * W + i;
        G[p] = Math.hypot(fill[p + 2] - fill[p - 2], fill[p - 2 * W] - fill[p + 2 * W]) / (4 * RES);
      }
    }

    // Ứng viên ở vị trí POS của đường chảy (bậc 0); lưu vực dài thêm bậc k cách thêm k × step ngược lên phía phân thủy
    const cands = [];
    for (let j = 2; j < H - 2; j++) {
      const y = gy0 - (j + 0.5) * RES;
      const cj = Math.floor((y - by0) / COARSE);
      for (let i = 2; i < W - 2; i++) {
        const p = j * W + i;
        if (mask[p] || R[p] < MIN_R) continue;
        const off = L[p] - (1 - pos) * R[p], k = step > 0 ? Math.max(0, Math.round(off / step)) : 0;
        if (Math.abs(off - k * step) > RES * 0.75 || (k > 0 && L[p] > R[p] - step * 0.5)) continue;
        const x = gx0 + (i + 0.5) * RES;
        const ci = Math.floor((x - bx0) / COARSE);
        if (ci < 0 || ci >= CW || cj < 0 || cj >= CH || cluster[cj * CW + ci] !== c.id) continue;
        const gx = (fill[p + 2] - fill[p - 2]) / (4 * RES), gy = (fill[p - 2 * W] - fill[p + 2 * W]) / (4 * RES);
        const gl = Math.hypot(gx, gy);
        if (gl < 0.5 * gFlat) continue;
        nCands++;
        const sn = snapToRoad(x, y, -gx / gl, -gy / gl);
        if (!sn) { unsnapped++; continue; }
        cands.push({ ...sn, R: R[p], k });
      }
    }

    // Ô lưới chứa điểm (−1 = nước hoặc ra ngoài khung)
    const cellAt = (x, y) => {
      const i = Math.floor((x - gx0) / RES), j = Math.floor((gy0 - y) / RES);
      return i < 2 || i >= W - 2 || j < 2 || j >= H - 2 || mask[j * W + i] ? -1 : j * W + i;
    };
    // Độ giảm thế cần có trên quãng len giữa 2 ô: MIN_DESCENT × len × độ dốc thế trung bình tại chỗ (tối thiểu nửa dốc vùng phẳng)
    const need = (c0, c1, len, rate = MIN_DESCENT) => rate * len * Math.max(0.5 * gFlat, (G[c0] + G[c1]) / 2);
    // Kiểm tra từng 5 m dọc đoạn: không vào nước; trên mỗi quãng SLOPE_WIN_M gần nhất thế phải giảm (xuôi dòng) hoặc tăng
    // (ngược dòng) đủ mức need — phố lệch hướng thoát nước quá ~53° hoặc đi vào đáy trũng kín thì mũi tên dừng
    const guard = (down) => {
      const ss = [0], cs = [];
      return (ax, ay, bx, by) => {
        const sl = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(sl / 5));
        if (!cs.length) {
          const c0 = cellAt(ax, ay);
          if (c0 < 0) return 0;
          cs.push(c0);
        }
        for (let k = 1; k <= steps; k++) {
          const cc = cellAt(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps);
          if (cc < 0) return (k - 1) / steps;
          const s = ss[ss.length - 1] + sl / steps;
          let w = ss.length - 1;
          while (w > 0 && s - ss[w - 1] <= SLOPE_WIN_M) w--;
          const win = s - ss[w], cw = cs[w];
          if (win >= SLOPE_WIN_M / 2 && (down ? fill[cw] - fill[cc] : fill[cc] - fill[cw]) < need(cw, cc, win, STEP_DESCENT)) return (k - 1) / steps;
          ss.push(s); cs.push(cc);
        }
        return 1;
      };
    };

    cands.sort((p, q) => p.k - q.k || q.R - p.R);
    cands.forEach(cd => {
      if (!farFromKept(cd.x, cd.y)) return;
      const down = walk(cd.x, cd.y, cd.r, cd.next, cd.dir, ARROW_M, guard(true));
      const up = walk(cd.x, cd.y, cd.r, cd.dir > 0 ? cd.next - 1 : cd.next + 1, -cd.dir, ARROW_M, guard(false));
      const dl = polyLen(down), ul = polyLen(up);
      if (dl + ul < ARROW_MIN_M) { short++; return; }
      // Lấy đủ ARROW_M, ưu tiên nửa xuôi dòng; phía nào bị chặn sớm thì bù sang phía kia
      const dt = Math.min(dl, Math.max(ARROW_M / 2, ARROW_M - ul)), ut = Math.min(ul, ARROW_M - dt);
      const line = trimPoly(up, ut).reverse().concat(trimPoly(down, dt).slice(1));
      const [sx, sy] = line[0], [ex, ey] = line[line.length - 1];
      if (Math.hypot(ex - sx, ey - sy) < MIN_STRAIGHT * (dt + ut)) { bent++; return; }
      const c0 = cellAt(sx, sy), c1 = cellAt(ex, ey);
      if (c0 < 0 || c1 < 0 || fill[c0] - fill[c1] < need(c0, c1, Math.hypot(ex - sx, ey - sy))) { downhill++; return; }
      const samples = samplePoly(line, 10);
      if (samples.some(([x, y]) => nearKeptLine(x, y))) { overlap++; return; }
      samples.forEach(([x, y]) => {
        const key = `${Math.floor(x / OVERLAP_M)},${Math.floor(y / OVERLAP_M)}`;
        if (!lgrid.has(key)) lgrid.set(key, []);
        lgrid.get(key).push(x, y);
      });
      const kp = { x: cd.x, y: cd.y, line, R: cd.R };
      kept.push(kp);
      const key = `${Math.floor(cd.x / spacing)},${Math.floor(cd.y / spacing)}`;
      if (!kgrid.has(key)) kgrid.set(key, []);
      kgrid.get(key).push(kp);
    });
  });
  console.log(`✓ Cây dòng chảy ${big.length} cụm (${((Date.now() - t0) / 1000).toFixed(1)} s): ${nCands} ô ở ${Math.round(pos * 100)}% quãng,`
    + ` ${unsnapped} không có phố cùng hướng trong ${SNAP_M} m`);

  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const features = kept.map(c => {
    const coords = c.line.map(([x, y]) => { const [lat, lng] = proj.inv(x, y); return [r5(lng), r5(lat)]; })
      .filter((p, k, a) => !k || p[0] !== a[k - 1][0] || p[1] !== a[k - 1][1]);
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { r: Math.round(c.R) } };
  }).filter(f => f.geometry.coordinates.length >= 2);
  fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`✓ ${features.length} mũi tên dọc phố dài ${ARROW_MIN_M}–${ARROW_M} m (cách nhau ≥ ${spacing} m; bỏ ${short} tuyến ngắn, ${bent} bẻ góc,`
    + ` ${downhill} không đi về mặt nước, ${overlap} chồng mũi tên khác)`
    + ` → ${path.relative(ROOT, outFile)}`);

  writePreview(previewFile, pbbox, ways, features);
  console.log(`✓ Trang soát: ${path.relative(ROOT, previewFile)}`);
}

/** Trang Leaflet nền vệ tinh: đường trong khung soát + mũi tên nét đứt xanh ngọc (thoát nước mặt) */
function writePreview(file, [w, s, e, n], ways, features) {
  const inBox = ([lat, lng]) => lat >= s && lat <= n && lng >= w && lng <= e;
  const roads = ways.filter(r => r.pts.some(inBox)).map(r => ({ g: r.g, b: r.bridge ? 1 : 0, p: r.pts }));
  const pts = features.filter(f => f.geometry.coordinates.some(([lng, lat]) => inBox([lat, lng])));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Soát hướng thoát nước</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{height:100%;margin:0}.info{background:#fff;padding:6px 10px;font:13px sans-serif;border-radius:4px}</style>
</head><body><div id="m"></div><script>
const roads=${JSON.stringify(roads)};
const pts=${JSON.stringify(pts)};
const m=L.map('m',{preferCanvas:true}).fitBounds([[${s},${w}],[${n},${e}]]);
const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(m);
const topo=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17});
const shade=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,opacity:.5});
L.control.layers({'Vệ tinh':sat,'Địa hình (đồng mức)':topo},{'Bóng đổ địa hình':shade}).addTo(m);
const W={1:3,2:2,0:1};
roads.forEach(r=>L.polyline(r.p,{color:r.b?'#f472b6':'#e5e7eb',weight:W[r.g]||1,opacity:.45}).addTo(m));
const heads=L.layerGroup().addTo(m);
function drawHeads(){
  heads.clearLayers();
  pts.forEach(f=>{
    const c=f.geometry.coordinates,a=m.latLngToLayerPoint([c[c.length-2][1],c[c.length-2][0]]),b=m.latLngToLayerPoint([c[c.length-1][1],c[c.length-1][0]]);
    const ang=Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI;
    const svg='<svg width="16" height="16" viewBox="-8 -8 16 16" style="transform:rotate('+ang+'deg)"><path d="M0,-7 L6,5 L0,2 L-6,5 Z" fill="#22d3ee" stroke="#083344" stroke-width="1"/></svg>';
    heads.addLayer(L.marker([c[c.length-1][1],c[c.length-1][0]],{icon:L.divIcon({html:svg,className:'',iconSize:[16,16],iconAnchor:[8,8]}),interactive:false}));
  });
}
pts.forEach(f=>{
  const ll=f.geometry.coordinates.map(([x,y])=>[y,x]);
  L.polyline(ll,{color:'#083344',weight:5,opacity:.35}).addTo(m);
  L.polyline(ll,{color:'#22d3ee',weight:2.5,dashArray:'7 6'}).addTo(m).bindTooltip('đường chảy từ phân thủy tới mặt nước '+f.properties.r+' m');
});
drawHeads();m.on('zoomend',drawHeads);
const info=L.control({position:'topright'});info.onAdd=()=>{const d=L.DomUtil.create('div','info');d.textContent=pts.length+' mũi tên trong khung';return d};info.addTo(m);
</script></body></html>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

main().catch(err => {
  console.error(`✗ ${err.stack || err.message}`);
  process.exit(1);
});
