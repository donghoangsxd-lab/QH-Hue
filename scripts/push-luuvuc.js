// Đẩy ranh lưu vực, đường phân thủy lên bucket qua Apps Script → drainage/luuvuc.topojson (lớp basinLayer.js).
// Lưu vực sông, tiểu lưu vực: node scripts/build-luuvuc.js; ô tiêu nước vùng thấp: node scripts/build-otieunuoc.js.
// Hoặc tính trong QGIS/GRASS từ FABDEM, cùng DEM với mạng thoát nước (push-thoatnuoc.js) nên khớp với khe tụ thủy:
//   r.carve (khắc Thoatnuoc vào DEM) → r.watershed → r.stream.basins (tiểu lưu vực) / r.water.outlet (lưu vực sông)
//   → r.to.vect type=area -s → xuất GeoJSON, CRS EPSG:4326.
//   Vùng thấp dưới +10 m (đồng bằng, nội thị) không có đường phân thủy địa hình đáng tin: chia ô tiêu nước theo sông, kênh
//   bao quanh trong QGIS (Difference vùng thấp − mặt nước sông → Split with lines theo kênh, mương → Multipart to singleparts).
//   node scripts/push-luuvuc.js [--major LuuVucSong.geojson] [--sub TieuLuuVuc.geojson] [--low OTieuNuoc.geojson]
//     (mặc định đọc 3 file này ở gốc dự án nếu có)
//     --out ban-rut-gon.json   chỉ ghi bản rút gọn ra máy, không gửi
//     --tol 15                 sai số rút gọn Douglas–Peucker (m)
//     --min-km2 0.05           bỏ mảnh vụn / lỗ nhỏ hơn ngưỡng (r.to.vect sinh nhiều mảnh 1–2 ô)
//     --min-elev 10            chỉ giữ tiểu lưu vực có cao độ thấp nhất (cửa xả) ≥ ngưỡng (m, FABDEM hệ EGM2008);
//                              cần cột cao độ nhỏ nhất: v.rast.stats method=minimum column_prefix=z (z_minimum)
//                              hoặc Zonal statistics của QGIS (_min). Lưu vực sông cắt theo cao độ ngay trong GRASS.
// Tên lưu vực lấy từ cột Ten / ten / name; các mảnh cùng tên (hoặc cùng value / cat của r.to.vect) gộp thành một lưu vực.
// Cạnh chung của 2 lưu vực tách thành cung dùng chung (như TopoJSON) và rút gọn một lần: không hở, không vẽ 2 nét lệch nhau.
// Cần GAS_BASE_URL và GAS_SECRET (xem scripts/gasClient.js).
const fs = require('fs');
const path = require('path');
const { loadEnv, postToAppsScript } = require('./gasClient');

const NAME_KEYS = ['Ten', 'ten', 'TEN', 'name', 'Name', 'NAME'];
const ID_KEYS = ['value', 'cat', 'basin', 'id', 'ID', 'fid'];
const ELEV_KEYS = ['z_minimum', 'zmin', 'ZMIN', '_min', 'min', 'elev_min'];
const SCALE = 1e-5;           // lượng tử tọa độ ≈ 1,1 m
const KEY_SPAN = 4194304;     // 2^22 đơn vị lượng tử ≈ 42° — đủ rộng cho mọi vùng tỉnh
const R = 6378137;
const D2R = Math.PI / 180;

function pick(props, keys) {
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Diện tích vòng trên mặt cầu (m², luôn dương) */
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += (ring[i + 1][0] - ring[i][0]) * D2R * (2 + Math.sin(ring[i][1] * D2R) + Math.sin(ring[i + 1][1] * D2R));
  }
  return Math.abs(s) * R * R / 2;
}

const polyArea = (poly) => ringArea(poly[0]) - poly.slice(1).reduce((s, r) => s + ringArea(r), 0);

/**
 * GeoJSON → [{ cap, ten, ma, zmin, polys: [[vỏ, ...lỗ]] }], gộp các mảnh theo tên hoặc mã; bỏ mảnh / lỗ < minM2.
 * minElev ≠ null: bỏ lưu vực có cao độ thấp nhất < minElev (cả lưu vực nằm trên ngưỡng, ranh vẫn là đường phân thủy thật).
 */
function readBasins(file, cap, minM2, minElev) {
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : null;
  if (!Array.isArray(feats)) throw new Error(`${file}: không phải GeoJSON FeatureCollection`);
  const groups = new Map();
  let dropped = 0;
  feats.forEach((f, i) => {
    const g = f && f.geometry;
    const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const first = polys[0] && polys[0][0] && polys[0][0][0];
    if (first && (Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90)) {
      throw new Error(`${file}: tọa độ không phải độ kinh / vĩ — xuất lại GeoJSON với CRS EPSG:4326`);
    }
    const props = (f && f.properties) || {};
    const ten = pick(props, NAME_KEYS);
    const ma = pick(props, ID_KEYS) || String(i + 1);
    const key = ten || `#${ma}`;
    const zRaw = pick(props, ELEV_KEYS);
    const z = zRaw ? Number(zRaw.replace(',', '.')) : NaN;
    polys.forEach(poly => {
      const rings = (poly || []).filter(r => Array.isArray(r) && r.length >= 4);
      if (!rings.length || ringArea(rings[0]) < minM2) { dropped++; return; }
      if (!groups.has(key)) groups.set(key, { cap, ten, ma, zmin: null, polys: [] });
      const b = groups.get(key);
      b.polys.push([rings[0], ...rings.slice(1).filter(r => ringArea(r) >= minM2)]);
      if (Number.isFinite(z)) b.zmin = b.zmin === null ? z : Math.min(b.zmin, z);
    });
  });
  let basins = [...groups.values()];
  let low = 0;
  if (minElev !== null) {
    const missing = basins.filter(b => b.zmin === null).length;
    if (missing) {
      throw new Error(`${file}: ${missing} lưu vực thiếu cột cao độ nhỏ nhất (${ELEV_KEYS.join(' / ')})`
        + ' — chạy v.rast.stats method=minimum column_prefix=z hoặc Zonal statistics trước khi xuất');
    }
    low = basins.filter(b => b.zmin < minElev).length;
    basins = basins.filter(b => b.zmin >= minElev);
  }
  basins.forEach(b => { b.km2 = b.polys.reduce((s, p) => s + polyArea(p), 0) / 1e6; });
  return { basins, features: feats.length, dropped, low };
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const ex = px - ax - t * dx, ey = py - ay - t * dy;
  return ex * ex + ey * ey;
}

/** Douglas–Peucker trên tọa độ lượng tử đổi ra mét (kx, ky); cung khép kín tách ở đỉnh xa điểm đầu nhất và giữ ≥ 3 đỉnh */
function simplifyArc(pts, closed, tolM, kx, ky) {
  const n = pts.length;
  if (!(tolM > 0) || n <= (closed ? 4 : 2)) return pts;
  const X = (i) => pts[i][0] * kx, Y = (i) => pts[i][1] * ky;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [];
  let far = 0;
  if (closed) {
    let best = -1;
    for (let i = 1; i < n - 1; i++) {
      const d = (X(i) - X(0)) ** 2 + (Y(i) - Y(0)) ** 2;
      if (d > best) { best = d; far = i; }
    }
    keep[far] = 1;
    stack.push([0, far], [far, n - 1]);
  } else {
    stack.push([0, n - 1]);
  }
  const tol2 = tolM * tolM;
  while (stack.length) {
    const [a, b] = stack.pop();
    let idx = -1, max = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(X(i), Y(i), X(a), Y(a), X(b), Y(b));
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  if (closed && keep.reduce((s, k) => s + k, 0) < 4) {
    let idx = -1, max = -1;
    for (let i = 1; i < n - 1; i++) {
      if (i === far) continue;
      const d = segDist2(X(i), Y(i), X(0), Y(0), X(far), Y(far));
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0) keep[idx] = 1;
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chẵn–lẻ trên mọi vòng của 1 đa giác (vỏ + lỗ), tọa độ [lng, lat] */
function inPoly(poly, x, y) {
  let inside = false;
  poly.forEach(ring => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

/** Điểm đặt nhãn: điểm trong đa giác xa cạnh nhất, dò lưới 3 lượt thu hẹp dần (polylabel giản lược) */
function labelPoint(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  poly[0].forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const kx = Math.cos((minY + maxY) / 2 * D2R);
  const edgeDist2 = (x, y) => {
    let d = Infinity;
    poly.forEach(ring => {
      for (let i = 1; i < ring.length; i++) {
        d = Math.min(d, segDist2(x * kx, y, ring[i - 1][0] * kx, ring[i - 1][1], ring[i][0] * kx, ring[i][1]));
      }
    });
    return d;
  };
  const N = 12;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, w = maxX - minX, h = maxY - minY;
  let best = null, bestD = -1;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = cx - w / 2 + w * i / N, y = cy - h / 2 + h * j / N;
        if (!inPoly(poly, x, y)) continue;
        const d = edgeDist2(x, y);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (!best) break;
    [cx, cy] = best;
    w /= 4; h /= 4;
  }
  return best || poly[0][0];
}

/** Dựng TopoJSON: lượng tử → tìm điểm nút (đỉnh có cặp láng giềng khác nhau giữa các vòng) → cắt cung, gộp cung trùng → rút gọn */
function buildTopology(basins, tolM) {
  let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
  basins.forEach(b => b.polys.forEach(p => p.forEach(r => r.forEach(([x, y]) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }))));
  x0 = Math.floor(x0 / SCALE) * SCALE;
  y0 = Math.floor(y0 / SCALE) * SCALE;
  const key = (p) => p[0] * KEY_SPAN + p[1];

  const quantRing = (r) => {
    const out = [];
    r.forEach(pt => {
      const p = [Math.round((pt[0] - x0) / SCALE), Math.round((pt[1] - y0) / SCALE)];
      const l = out[out.length - 1];
      if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
    });
    const a = out[0], z = out[out.length - 1];
    if (out.length > 1 && a[0] === z[0] && a[1] === z[1]) out.pop();
    return out.length >= 3 ? out : null;
  };
  basins.forEach(b => {
    b.qpolys = b.polys
      .map(poly => (quantRing(poly[0]) ? poly.map(quantRing).filter(Boolean) : null))
      .filter(Boolean);
  });

  const nb = new Map();
  const junc = new Set();
  basins.forEach(b => b.qpolys.forEach(poly => poly.forEach(ring => {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const k = key(ring[i]);
      let a = key(ring[(i - 1 + m) % m]), c = key(ring[(i + 1) % m]);
      if (a > c) [a, c] = [c, a];
      const s = nb.get(k);
      if (!s) nb.set(k, [a, c]);
      else if (s[0] !== a || s[1] !== c) junc.add(k);
    }
  })));

  const arcs = [];
  const index = new Map();
  const addArc = (pts, closed) => {
    const f = pts.map(key).join(',');
    if (index.has(f)) return index.get(f);
    const r = pts.map(key).reverse().join(',');
    if (index.has(r)) return ~index.get(r);
    index.set(f, arcs.length);
    arcs.push({ pts, closed });
    return arcs.length - 1;
  };
  const ringToArcs = (ring) => {
    const m = ring.length;
    let j0 = ring.findIndex(p => junc.has(key(p)));
    if (j0 < 0) {
      // Vòng không có nút: xoay về đỉnh khóa nhỏ nhất để vòng trùng nhau (lỗ ↔ đảo) gộp được thành 1 cung
      j0 = 0;
      for (let i = 1; i < m; i++) if (key(ring[i]) < key(ring[j0])) j0 = i;
      return [addArc(ring.slice(j0).concat(ring.slice(0, j0), [ring[j0]]), true)];
    }
    const pts = ring.slice(j0).concat(ring.slice(0, j0), [ring[j0]]);
    const refs = [];
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (i === pts.length - 1 || junc.has(key(pts[i]))) {
        refs.push(addArc(pts.slice(start, i + 1), false));
        start = i;
      }
    }
    return refs;
  };
  basins.forEach(b => { b.refs = b.qpolys.map(poly => poly.map(ringToArcs)); });

  const before = arcs.reduce((s, a) => s + a.pts.length, 0);
  const ky = SCALE * 110540;
  const kx = SCALE * 111320 * Math.cos((y0 + y1) / 2 * D2R);
  arcs.forEach(a => { a.pts = simplifyArc(a.pts, a.closed, tolM, kx, ky); });
  const after = arcs.reduce((s, a) => s + a.pts.length, 0);

  const toLL = (p) => [p[0] * SCALE + x0, p[1] * SCALE + y0];
  const ringLL = (refs) => {
    const out = [];
    refs.forEach(r => {
      const a = arcs[r < 0 ? ~r : r].pts;
      const seq = r < 0 ? a.slice().reverse() : a;
      seq.forEach((p, i) => { if (i || !out.length) out.push(toLL(p)); });
    });
    return out;
  };
  basins.forEach(b => { b.llPolys = b.refs.map(poly => poly.map(ringLL)); });

  return {
    arcs: arcs.map(a => a.pts.map((p, i) => (i ? [p[0] - a.pts[i - 1][0], p[1] - a.pts[i - 1][1]] : p))),
    transform: { scale: [SCALE, SCALE], translate: [x0, y0] },
    junctions: junc.size, before, after
  };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const root = path.join(__dirname, '..');
  const fallback = (name) => (fs.existsSync(path.join(root, name)) ? path.join(root, name) : null);
  const majorFile = opt('--major') || fallback('LuuVucSong.geojson');
  const subFile = opt('--sub') || fallback('TieuLuuVuc.geojson');
  const lowFile = opt('--low') || fallback('OTieuNuoc.geojson');
  const outFile = opt('--out');
  const tolM = Number(opt('--tol') ?? 15);
  const minKm2 = Number(opt('--min-km2') ?? 0.05);
  const minElev = opt('--min-elev') === null ? null : Number(opt('--min-elev'));
  if (!majorFile && !subFile && !lowFile) {
    throw new Error('Không thấy dữ liệu: dùng --major <lưu vực sông.geojson>, --sub <tiểu lưu vực.geojson>, --low <ô tiêu nước.geojson>');
  }
  if (!Number.isFinite(tolM) || tolM < 0) throw new Error('--tol phải là số mét ≥ 0');
  if (!Number.isFinite(minKm2) || minKm2 < 0) throw new Error('--min-km2 phải là số ≥ 0');
  if (minElev !== null && !Number.isFinite(minElev)) throw new Error('--min-elev phải là cao độ (m)');

  const basins = [];
  [[majorFile, 1, 'lưu vực sông'], [subFile, 2, 'tiểu lưu vực'], [lowFile, 3, 'ô tiêu nước vùng thấp']].forEach(([file, cap, label]) => {
    if (!file) return;
    // Lưu vực sông luôn có cửa xả ở cao độ thấp (ra phá, biển): không lọc theo cửa xả, cắt theo cao độ trong GRASS
    const r = readBasins(file, cap, minKm2 * 1e6, cap === 2 ? minElev : null);
    console.log(`✓ ${path.basename(file)}: ${r.features} đối tượng → ${r.basins.length} ${label}`
      + `${r.dropped ? ` (bỏ ${r.dropped} mảnh < ${minKm2} km²)` : ''}`
      + `${r.low ? ` (bỏ ${r.low} lưu vực có cửa xả < +${minElev} m)` : ''}`);
    basins.push(...r.basins);
  });
  if (!basins.length) throw new Error('Không còn lưu vực nào sau khi lọc mảnh vụn / cao độ');

  const topo = buildTopology(basins, tolM);
  const kept = basins.filter(b => b.refs.length);
  kept.forEach(b => {
    let best = 0, bestA = -1;
    b.llPolys.forEach((p, i) => { const a = polyArea(p); if (a > bestA) { bestA = a; best = i; } });
    b.lp = labelPoint(b.llPolys[best]);
  });
  const majors = kept.filter(b => b.cap === 1);
  majors.forEach(m => { m.n = 0; });
  kept.filter(b => b.cap === 2).forEach(s => {
    const parent = majors.find(m => m.llPolys.some(p => inPoly(p, s.lp[0], s.lp[1])));
    if (parent) { s.p = parent.ten || `#${parent.ma}`; parent.n++; }
  });

  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const geometries = kept.map(b => {
    const properties = { cap: b.cap, km2: round(b.km2, 2), lp: [round(b.lp[0], 5), round(b.lp[1], 5)] };
    if (b.ten) properties.ten = b.ten; else properties.ma = b.ma;
    if (b.p) properties.p = b.p;
    if (b.zmin !== null) properties.z = round(b.zmin, 1);
    if (b.cap === 1) properties.n = b.n;
    return b.refs.length === 1
      ? { type: 'Polygon', arcs: b.refs[0], properties }
      : { type: 'MultiPolygon', arcs: b.refs, properties };
  });
  const out = {
    type: 'Topology',
    transform: topo.transform,
    objects: { data: { type: 'GeometryCollection', geometries } },
    arcs: topo.arcs
  };
  const content = JSON.stringify(out);
  console.log(`✓ ${topo.arcs.length} cung (${topo.junctions} điểm nút), đỉnh ${topo.before} → ${topo.after} (rút gọn ${tolM} m)`
    + ` · ${(content.length / 1024).toFixed(0)} KB`);

  if (outFile) {
    fs.writeFileSync(outFile, content);
    console.log(`✓ Đã ghi bản rút gọn: ${outFile}`);
    return;
  }
  const data = await postToAppsScript('saveBasins', content);
  console.log(`✓ Đã ghi gs://hue-infra-data-us/drainage/luuvuc.topojson (${((data.size || content.length) / 1024).toFixed(0)} KB)`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
