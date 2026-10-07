// Tính lưu vực sông (cấp 1) và tiểu lưu vực (cấp 2) cho vùng cao từ +10 m trở lên, thay bước GRASS
// → LuuVucSong.geojson, TieuLuuVuc.geojson cho push-luuvuc.js (đẩy cùng OTieuNuoc.geojson của build-otieunuoc.js).
//   node scripts/build-luuvuc.js [--elev 10] [--zoom 12] [--major-km2 30] [--sub-km2 20] [--min-km2 2]
//     --boundary ranh.geojson   ranh phường xã có sẵn thay vì tải từ webapp
//     --refresh-osm             tải lại sông, kênh OSM (dùng chung .cache/osm-nuoc.json với build-otieunuoc.js)
//     --debug-png luuvuc.png    ghi ảnh màu các lưu vực để soát nhanh
// 1. Lưới FABDEM (cùng nguồn build-otieunuoc.js) phủ ranh 40 phường xã + lề MARGIN_DEG để dòng chảy từ ngoài ranh vẫn được tính.
// 2. Khắc sông, kênh, suối OSM vào DEM (BURN_M, như r.carve) để dòng chảy ở đồng bằng phẳng đi theo lòng sông thật.
// 3. Điểm thoát: biển, phá (khối cao độ ≤ 0 m từ TERM_KM2 trở lên, ngoài lòng sông OSM; mặt nước OSM water=lagoon),
//    pixel không dữ liệu, mép lưới.
// 4. Priority-flood (Barnes 2014) từ điểm thoát: lấp trũng, mỗi pixel chảy về pixel đã lan tới nó (D8; vùng phẳng đi theo
//    hàng đợi FIFO) → cây dòng chảy không vòng lặp; cộng dồn diện tích từ thượng nguồn về.
// 5. Lưu vực sông: các pixel cùng cửa đổ ra biển / phá, cửa có diện tích ≥ --major-km2.
//    Tiểu lưu vực: cắt tại hợp lưu hai nhánh cùng ≥ --sub-km2 và tại chỗ dòng chảy xuống dưới ngưỡng cao độ;
//    tiểu lưu vực < --min-km2 gộp vào tiểu lưu vực hạ lưu. Mảnh sườn nhỏ đổ thẳng xuống vùng thấp: liền nhau đủ --min-km2
//    thành "khu giữa", còn lại nhập tiểu lưu vực kề bên cùng lưu vực sông (đồi cát, đồi sót lẻ giữa đồng bằng thì bỏ).
// 6. Chỉ giữ pixel cao độ ≥ --elev trong ranh; d3-contour từng lưu vực (cạnh chung trùng tọa độ) → GeoJSON.
//    Tên theo sông, suối OSM đầu tiên gặp khi đi ngược dòng chính từ cửa; không có tên thì theo phường xã.
// Cao độ FABDEM hệ EGM2008, không phải Hòn Dấu; lệch vài mét so với cao độ quốc gia.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const turf = require('@turf/turf');
const osmtogeojson = require('osmtogeojson');
const { loadBoundary, makeInside } = require('./wardBoundary');
const { ROOT, lng2tx, lat2ty, tx2lng, ty2lat, demSource, loadDem, cellSizeM, loadOsm, maskToPolygon } = require('./hydroCommon');

const MARGIN_DEG = 0.03;
// Độ sâu khắc (m): sông khắc sâu để giữ dòng chính qua đồng bằng; kênh nông vì nối nhiều hệ sông, khắc sâu dễ chuyển lưu vực
const BURN_M = { river: 6, stream: 3, canal: 2 };
const NAME_RANK = { river: 3, stream: 2, canal: 1 };
const TERM_KM2 = 1;
const FRAG_KM2 = 0.05;
// Lưu vực sông chủ yếu nằm ngoài ranh (sông Cu Đê…) chỉ vẽ khi phần trong ranh đủ lớn
const MAJOR_IN_KM2 = 5;
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

class MinHeap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
}

/** "Sông Hương" → "sông Hương" khi ghép sau "LV" / "TLV"; tên riêng (A Sáp…) giữ nguyên */
const lowerKind = (name) => name.replace(/^(Sông|Suối|Khe|Kênh|Rào|Hói|Lạch)\s/, (m) => m.toLowerCase());

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const cutoff = Number(opt('--elev') ?? 10);
  const z = Number(opt('--zoom') ?? 12);
  const majorKm2 = Number(opt('--major-km2') ?? 30);
  const subKm2 = Number(opt('--sub-km2') ?? 20);
  const minKm2 = Number(opt('--min-km2') ?? 2);
  const majorFile = opt('--out-major') || path.join(ROOT, 'LuuVucSong.geojson');
  const subFile = opt('--out-sub') || path.join(ROOT, 'TieuLuuVuc.geojson');
  const debugPng = opt('--debug-png');
  if (!Number.isFinite(cutoff)) throw new Error('--elev phải là cao độ (m)');
  if (!Number.isInteger(z) || z < 10 || z > 13) throw new Error('--zoom từ 10 đến 13 (12 ≈ 36 m/pixel, sát DEM 30 m)');
  [['--major-km2', majorKm2], ['--sub-km2', subKm2], ['--min-km2', minKm2]].forEach(([k, v]) => {
    if (!(v > 0)) throw new Error(`${k} phải là diện tích km² > 0`);
  });

  const t0 = Date.now();
  const sec = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
  const wards = await loadBoundary(opt('--boundary'));
  const inside = makeInside(wards);
  const wb = turf.bbox(wards);
  console.log(`✓ Ranh: ${wards.features.length} phường xã`);

  const src = await demSource();
  console.log(`… Cao độ: ${src.name}, mức ô ${z}`);
  const grid = await loadDem([wb[0] - MARGIN_DEG, wb[1] - MARGIN_DEG, wb[2] + MARGIN_DEG, wb[3] + MARGIN_DEG], z, src);
  const { elev, W, H, tx0, ty0 } = grid;
  const N = W * H;
  const px2km2 = cellSizeM((wb[1] + wb[3]) / 2, z) ** 2 / 1e6;
  const lngOf = (x) => tx2lng(tx0 + (x + 0.5) / 256, z);
  const latOf = (y) => ty2lat(ty0 + (y + 0.5) / 256, z);
  console.log(`✓ Lưới ${W} × ${H} pixel (${grid.tiles} ô cao độ, ${grid.empty} ô trống), pixel ≈ ${(Math.sqrt(px2km2) * 1000).toFixed(0)} m · ${sec()}`);

  const inB = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const lat = latOf(y);
    if (lat < wb[1] || lat > wb[3]) continue;
    for (let x = 0; x < W; x++) if (inside(lngOf(x), lat)) inB[y * W + x] = 1;
  }

  const gj = osmtogeojson(await loadOsm(wb, args.includes('--refresh-osm')));
  const tagsOf = (f) => (f.properties && (f.properties.tags || f.properties)) || {};
  const burn = new Uint8Array(N);
  const nameId = new Int32Array(N);
  const nameRank = new Uint8Array(N);
  const names = [''];
  const nameIdx = new Map();
  const riverPolys = [], lagoons = [];
  let lines = 0;
  const toPx = ([lng, lat]) => [(lng2tx(lng, z) - tx0) * 256, (lat2ty(lat, z) - ty0) * 256];
  gj.features.forEach(f => {
    const g = f.geometry;
    if (!g) return;
    const t = tagsOf(f);
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      if (t.water === 'lagoon') lagoons.push(f);
      else if (t.waterway === 'riverbank' || t.water === 'river' || t.water === 'canal') riverPolys.push(f);
      return;
    }
    const depth = BURN_M[t.waterway];
    if (!depth || (g.type !== 'LineString' && g.type !== 'MultiLineString')) return;
    lines++;
    let id = 0;
    const nm = [t['name:vi'], t.name].find(s => s && /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/.test(s));
    if (nm) {
      if (!nameIdx.has(nm)) { nameIdx.set(nm, names.length); names.push(nm); }
      id = nameIdx.get(nm);
    }
    const rank = NAME_RANK[t.waterway];
    (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(line => {
      for (let i = 1; i < line.length; i++) {
        const [x0, y0] = toPx(line[i - 1]), [x1, y1] = toPx(line[i]);
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
        for (let s = 0; s <= n; s++) {
          const x = Math.floor(x0 + (x1 - x0) * s / n), y = Math.floor(y0 + (y1 - y0) * s / n);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const c = y * W + x;
          if (depth > burn[c]) burn[c] = depth;
          if (id && rank > nameRank[c]) { nameId[c] = id; nameRank[c] = rank; }
        }
      }
    });
  });
  console.log(`✓ OSM: khắc ${lines} đoạn sông / suối / kênh (${names.length - 1} tên), ${riverPolys.length} mặt nước lòng sông, ${lagoons.length} phá · ${sec()}`);

  // Điểm thoát
  const term = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (Number.isNaN(elev[c])) term[c] = 1;
  for (let x = 0; x < W; x++) { term[x] = 1; term[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { term[y * W] = 1; term[y * W + W - 1] = 1; }
  if (lagoons.length) {
    const inLagoon = makeInside(turf.featureCollection(lagoons));
    for (let y = 0; y < H; y++) {
      const lat = latOf(y);
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (!term[c] && elev[c] < 5 && inLagoon(lngOf(x), lat)) term[c] = 1;
      }
    }
  }
  const inRiver = riverPolys.length ? makeInside(turf.featureCollection(riverPolys)) : () => false;
  const seen = new Uint8Array(N);
  const buf = new Int32Array(N);
  const termPx = TERM_KM2 / px2km2;
  for (let c0 = 0; c0 < N; c0++) {
    if (seen[c0] || term[c0] || !(elev[c0] <= 0) || burn[c0]) continue;
    let n = 0;
    buf[n++] = c0; seen[c0] = 1;
    for (let i = 0; i < n; i++) {
      const c = buf[i], x = c % W, y = (c - x) / W;
      for (const [xx, yy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = yy * W + xx;
        if (seen[d] || term[d] || !(elev[d] <= 0) || burn[d]) continue;
        seen[d] = 1; buf[n++] = d;
      }
    }
    if (n < termPx) continue;
    for (let i = 0; i < n; i++) {
      const c = buf[i], x = c % W;
      if (!inRiver(lngOf(x), latOf((c - x) / W))) term[c] = 1;
    }
  }

  // Priority-flood: dem là cao độ đã khắc rồi lấp trũng
  const dem = new Float32Array(N);
  for (let c = 0; c < N; c++) dem[c] = Number.isNaN(elev[c]) ? -1e9 : elev[c] - burn[c];
  const parent = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  let nOrd = 0;
  const heap = new MinHeap(N);
  const fifo = buf;
  let qh = 0, qt = 0;
  seen.fill(0);
  for (let c = 0; c < N; c++) if (term[c]) seen[c] = 1;
  for (let c = 0; c < N; c++) {
    if (!term[c]) continue;
    const x = c % W, y = (c - x) / W;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && !term[yy * W + xx]) { heap.push(dem[c], c); break; }
    }
  }
  while (qh < qt || heap.n) {
    const c = qh < qt ? fifo[qh++] : heap.pop();
    const lv = dem[c], x = c % W, y = (c - x) / W;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const d = yy * W + xx;
      if (seen[d]) continue;
      seen[d] = 1;
      parent[d] = c;
      order[nOrd++] = d;
      if (dem[d] <= lv) { dem[d] = lv; fifo[qt++] = d; } else heap.push(dem[d], d);
    }
  }
  console.log(`✓ Hướng dòng chảy: ${nOrd.toLocaleString('vi-VN')} pixel đổ về ${(N - nOrd).toLocaleString('vi-VN')} pixel thoát · ${sec()}`);

  const acc = new Uint32Array(N);
  for (let i = nOrd - 1; i >= 0; i--) {
    const c = order[i], p = parent[c];
    acc[c] += 1;
    if (!term[p]) acc[p] += acc[c];
  }
  const mainKid = new Int32Array(N).fill(-1);
  const bigKids = new Uint8Array(N);
  const subPx = subKm2 / px2km2;
  for (let i = 0; i < nOrd; i++) {
    const c = order[i], p = parent[c];
    if (term[p]) continue;
    if (mainKid[p] < 0 || acc[c] > acc[mainKid[p]]) mainKid[p] = c;
    if (acc[c] >= subPx && bigKids[p] < 255) bigKids[p]++;
  }

  // Cửa lưu vực sông (root) và cửa tiểu lưu vực (sub), duyệt từ hạ lưu lên thượng lưu
  const root = new Int32Array(N).fill(-1);
  const sub = new Int32Array(N).fill(-1);
  const outlets = [];
  const high = (c) => elev[c] >= cutoff;
  for (let i = 0; i < nOrd; i++) {
    const c = order[i], p = parent[c];
    root[c] = term[p] ? c : root[p];
    if (!high(c)) continue;
    if (term[p] || !high(p) || (acc[c] >= subPx && bigKids[p] >= 2)) { sub[c] = c; outlets.push(c); } else sub[c] = sub[p];
  }
  const cnt = new Map(outlets.map(o => [o, 0]));
  for (let c = 0; c < N; c++) if (inB[c] && sub[c] >= 0) cnt.set(sub[c], cnt.get(sub[c]) + 1);
  const target = new Map();
  const find = (o) => {
    let r = o;
    while (target.has(r)) { const t = target.get(r); if (t < 0) return -1; r = t; }
    return r;
  };
  const minPx = minKm2 / px2km2;
  let merged = 0, droppedPx = 0;
  for (let i = outlets.length - 1; i >= 0; i--) {
    const o = outlets[i];
    if (cnt.get(o) >= minPx) continue;
    const p = parent[o];
    const d = !term[p] && high(p) ? find(sub[p]) : -1;
    if (d >= 0) { cnt.set(d, cnt.get(d) + cnt.get(o)); merged++; } else droppedPx += cnt.get(o);
    target.set(o, d);
  }

  // Tiểu lưu vực cuối cùng theo pixel trong ranh (khóa = pixel cửa); sườn đổ thẳng xuống vùng thấp còn -1
  const key = new Int32Array(N).fill(-1);
  const finalOf = new Map();
  for (let c = 0; c < N; c++) {
    if (!inB[c] || sub[c] < 0) continue;
    if (!finalOf.has(sub[c])) finalOf.set(sub[c], find(sub[c]));
    key[c] = finalOf.get(sub[c]);
  }
  // Khu giữa: mảnh sườn liền nhau cùng lưu vực sông, đủ lớn thì thành tiểu lưu vực riêng (khóa ≥ N), nhỏ thì nhập tiểu lưu vực kề bên
  const zoneMin = new Map();
  let small = [];
  seen.fill(0);
  for (let c0 = 0; c0 < N; c0++) {
    if (seen[c0] || !inB[c0] || key[c0] >= 0 || !high(c0)) continue;
    let n = 0;
    buf[n++] = c0; seen[c0] = 1;
    for (let i = 0; i < n; i++) {
      const c = buf[i], x = c % W, y = (c - x) / W;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = yy * W + xx;
        if (seen[d] || !inB[d] || key[d] >= 0 || !high(d) || root[d] !== root[c0]) continue;
        seen[d] = 1; buf[n++] = d;
      }
    }
    if (n >= minPx) {
      const k = N + zoneMin.size;
      let zmin = Infinity;
      for (let i = 0; i < n; i++) { key[buf[i]] = k; zmin = Math.min(zmin, elev[buf[i]]); }
      zoneMin.set(k, zmin);
    } else {
      for (let i = 0; i < n; i++) small.push(buf[i]);
    }
  }
  for (let pass = 0; pass < 500 && small.length; pass++) {
    const left = [], upd = [];
    for (const c of small) {
      const x = c % W, y = (c - x) / W;
      let hit = -1;
      for (let k = 0; k < 8 && hit < 0; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = yy * W + xx;
        if (key[d] >= 0 && root[d] === root[c]) hit = key[d];
      }
      if (hit >= 0) upd.push(c, hit); else left.push(c);
    }
    if (!upd.length) break;
    for (let i = 0; i < upd.length; i += 2) key[upd[i]] = upd[i + 1];
    small = left;
  }
  console.log(`✓ Khu giữa: ${zoneMin.size} tiểu lưu vực sườn đổ thẳng xuống vùng thấp`
    + `${small.length ? `, bỏ ${(small.length * px2km2).toFixed(1)} km² mảnh lẻ` : ''} · ${sec()}`);

  // Nhãn gọn 1..K, chỉ pixel ≥ ngưỡng cao độ trong ranh
  const majorPx = majorKm2 / px2km2;
  const labS = new Int32Array(N), labM = new Int32Array(N);
  const subs = new Map(), majors = new Map();
  const region = (map, key) => {
    if (!map.has(key)) map.set(key, { id: map.size + 1, key, n: 0, x0: W, y0: H, x1: -1, y1: -1 });
    return map.get(key);
  };
  const grow = (r, x, y) => {
    r.n++;
    if (x < r.x0) r.x0 = x; if (x > r.x1) r.x1 = x;
    if (y < r.y0) r.y0 = y; if (y > r.y1) r.y1 = y;
  };
  for (let c = 0; c < N; c++) {
    if (!inB[c] || !high(c)) continue;
    const x = c % W, y = (c - x) / W;
    if (key[c] >= 0) { const r = region(subs, key[c]); labS[c] = r.id; grow(r, x, y); }
    const m = root[c];
    if (m >= 0 && acc[m] >= majorPx) { const r = region(majors, m); labM[c] = r.id; grow(r, x, y); }
  }
  console.log(`✓ ${majors.size} lưu vực sông, ${subs.size} tiểu lưu vực (gộp ${merged} tiểu lưu vực < ${minKm2} km² vào hạ lưu;`
    + ` ${(droppedPx * px2km2).toFixed(0)} km² sườn đổ thẳng xuống vùng thấp chia vào khu giữa) · ${sec()}`);

  /**
   * Đi ngược dòng chính từ cửa trong cùng vùng: tên OSM loại cao nhất (sông > suối > kênh), trong cùng loại lấy tên có tổng
   * diện tích tích lũy lớn nhất — đoạn hạ lưu nặng ký hơn đầu nguồn, đoạn kênh ngắn ở cửa không lấn tên sông chính.
   */
  const nameUp = (start, same) => {
    const score = new Map();
    let bestRank = 0;
    for (let c = start; c >= 0 && same(c); c = mainKid[c]) {
      const id = nameId[c];
      if (!id || nameRank[c] < bestRank) continue;
      if (nameRank[c] > bestRank) { bestRank = nameRank[c]; score.clear(); }
      score.set(id, (score.get(id) || 0) + acc[c]);
    }
    let best = 0, max = 0;
    score.forEach((s, id) => { if (s > max) { max = s; best = id; } });
    return names[best];
  };
  const wardOf = (pt) => {
    const w = wards.features.find(f => f.geometry && turf.booleanPointInPolygon(pt, f));
    return w ? String(w.properties.tenXa || w.properties.name || '').replace(/^(Phường|Xã)\s+/i, '') : '';
  };
  const fragPx = FRAG_KM2 / px2km2;

  async function vectorize(regions, lab, prefix, nameOf, minN = 0) {
    const out = [];
    for (const r of regions.values()) {
      if (r.n < minN) continue;
      const w = r.x1 - r.x0 + 3, h = r.y1 - r.y0 + 3;
      const mask = new Uint8Array(w * h);
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) if (lab[y * W + x] === r.id) mask[(y - r.y0 + 1) * w + x - r.x0 + 1] = 1;
      }
      const mp = await maskToPolygon({ mask, W: w, H: h, ox: r.x0 - 1, oy: r.y0 - 1, tx0, ty0 }, z, fragPx);
      if (!mp.geometry.coordinates.length) continue;
      const geom = turf.truncate(mp, { precision: 6 });
      out.push({ r, geom, base: nameOf(r) || `${prefix(r)} ${wardOf(turf.pointOnFeature(geom)) || 'ngoài ranh'}` });
    }
    const byName = new Map();
    out.forEach(o => { if (!byName.has(o.base)) byName.set(o.base, []); byName.get(o.base).push(o); });
    byName.forEach(list => {
      list.sort((a, b) => b.r.n - a.r.n);
      const sep = /\d$/.test(list[0].base) ? ' – ' : ' ';
      list.forEach((o, i) => { o.Ten = list.length > 1 ? `${o.base}${sep}${i + 1}` : o.base; });
    });
    return out;
  }

  const majorOut = await vectorize(majors, labM, () => 'LV', (r) => {
    const n = nameUp(r.key, (c) => root[c] === r.key);
    return n ? `LV ${lowerKind(n)}` : '';
  }, MAJOR_IN_KM2 / px2km2);
  const isZone = (r) => r.key >= N;
  const subOut = await vectorize(subs, labS, (r) => (isZone(r) ? 'TLV khu giữa' : 'TLV'), (r) => {
    if (isZone(r)) return '';
    const n = nameUp(r.key, (c) => sub[c] >= 0 && find(sub[c]) === r.key);
    return n ? `TLV ${lowerKind(n)}` : '';
  });
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const save = (file, list, props) => fs.writeFileSync(file,
    JSON.stringify(turf.featureCollection(list.map(o => turf.feature(o.geom.geometry, { Ten: o.Ten, km2: round(o.r.n * px2km2, 2), ...props(o) })))));
  save(majorFile, majorOut, (o) => ({ cua_km2: round(acc[o.r.key] * px2km2, 1) }));
  save(subFile, subOut, (o) => ({ zmin: round(isZone(o.r) ? zoneMin.get(o.r.key) : elev[o.r.key], 1) }));
  majorOut.sort((a, b) => b.r.n - a.r.n).forEach(o => {
    console.log(`  ${o.Ten}: ${(o.r.n * px2km2).toFixed(0)} km² trên +${cutoff} m (cả lưu vực tới cửa ${(acc[o.r.key] * px2km2).toFixed(0)} km²)`);
  });
  console.log(`✓ Đã ghi ${path.relative(ROOT, majorFile)} (${majorOut.length}), ${path.relative(ROOT, subFile)} (${subOut.length}) · ${sec()}`);

  if (debugPng) {
    const S = 2, w = Math.floor(W / S), h = Math.floor(H / S);
    const png = new PNG({ width: w, height: h });
    const hue = (id, sat, lit) => {
      const hh = (id * 137.508) % 360 / 60, cc = (1 - Math.abs(2 * lit - 1)) * sat, xx = cc * (1 - Math.abs(hh % 2 - 1));
      const [r, g, b] = hh < 1 ? [cc, xx, 0] : hh < 2 ? [xx, cc, 0] : hh < 3 ? [0, cc, xx] : hh < 4 ? [0, xx, cc] : hh < 5 ? [xx, 0, cc] : [cc, 0, xx];
      const m = lit - cc / 2;
      return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = y * S * W + x * S, o = (y * w + x) * 4;
        let col;
        if (term[c]) col = [30, 80, 160];
        else if (labS[c]) col = hue(labM[c] || 0, labM[c] ? 0.7 : 0.1, 0.35 + (labS[c] % 5) * 0.08);
        else if (burn[c]) col = [90, 170, 255];
        else col = inB[c] ? [70, 70, 70] : [25, 25, 25];
        png.data[o] = col[0]; png.data[o + 1] = col[1]; png.data[o + 2] = col[2]; png.data[o + 3] = 255;
      }
    }
    fs.writeFileSync(debugPng, PNG.sync.write(png));
    console.log(`✓ Ảnh soát: ${debugPng}`);
  }
}

main().catch(err => {
  console.error(`✗ ${err.stack || err.message}`);
  process.exit(1);
});
