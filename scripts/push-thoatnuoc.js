// Đẩy mạng lưới thoát nước, khe tụ thủy (TopoJSON xuất từ QGIS / GRASS r.stream.extract) lên bucket qua Apps Script.
//   node scripts/push-thoatnuoc.js [Thoatnuoc.topojson]         → rút gọn rồi ghi drainage/thoatnuoc.topojson
//   node scripts/push-thoatnuoc.js [file] --out ban-rut-gon.json  → chỉ ghi bản rút gọn ra máy, không gửi
//   Mặc định cắt theo ranh 40 phường xã (tải từ webapp); --boundary ranh.geojson dùng file có sẵn, --no-clip không cắt.
// Cần GAS_BASE_URL và GAS_SECRET (xem scripts/gasClient.js).
// Đường trong file phải vẽ xuôi dòng (đầu nguồn → hạ lưu): webapp chạy hiệu ứng và đặt mũi tên theo thứ tự đỉnh.
// Đường vẽ tay trong QGIS (không có thuộc tính GRASS) tự nối vào mạng: xem snapHand.
const fs = require('fs');
const path = require('path');
const { loadEnv, postToAppsScript } = require('./gasClient');
const { loadBoundary, makeInside } = require('./wardBoundary');

// Khoảng hở tối đa (m) giữa đầu mút đường vẽ tay và đường cần nối
const SNAP_M = 400;
// Bậc tối thiểu của đường vẽ tay (luồng đầm phá bắt đầu giữa mặt nước, không nhánh nào đổ vào): ≥ 8 thì webapp hiện từ zoom 10
const HAND_MIN_M = 8;

function decodeArc(arc) {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
}

const key = (p) => `${p[0]},${p[1]}`;

/** TopoJSON → [{ pts, props, hand }]; hand = đường vẽ tay trong QGIS (không có thuộc tính của GRASS r.stream.extract) */
function readLines(topo) {
  const obj = topo.objects && (topo.objects.data || Object.values(topo.objects)[0]);
  if (!obj || !Array.isArray(obj.geometries)) throw new Error('Không thấy objects trong TopoJSON');
  const decoded = topo.transform ? topo.arcs.map(decodeArc) : topo.arcs;
  return obj.geometries
    .filter(g => g.type === 'LineString' && Array.isArray(g.arcs) && g.arcs.length)
    .map((g, id) => {
      const props = g.properties || {};
      const pts = g.arcs.flatMap(i => (i < 0 ? decoded[~i].slice().reverse() : decoded[i]))
        .filter((p, k, a) => !k || p[0] !== a[k - 1][0] || p[1] !== a[k - 1][1]);
      return { id, pts, props, hand: props.type_code == null && props.stream_type == null };
    })
    .filter(it => it.pts.length >= 2);
}

/**
 * Nối đường vẽ tay (luồng đầm phá…) vào mạng lưới. Mạng chỉ coi là nối khi điểm cuối đoạn trên trùng điểm đầu đoạn dưới,
 * nên đầu mút cụt cách đường khác ≤ SNAP_M m được kéo tới điểm gần nhất của đường đó, đường đó cắt đôi tại điểm nối:
 *  1. cuối sông GRASS chưa đổ vào đâu → đường vẽ tay gần nhất;
 *  2. cuối đường vẽ tay chưa đổ vào đâu → đường gần nhất;
 *  3. đầu đường vẽ tay chưa có dòng đổ vào → tách nhánh từ đường gần nhất.
 * Không nối một đường vào chính nó (kể cả phần đã cắt ra) để không tạo vòng.
 * mx, my: số mét của 1 đơn vị tọa độ theo kinh / vĩ.
 */
function snapHand(items, mx, my, quantized) {
  const startN = new Map(), endN = new Map();
  const inc = (m, p, d) => { const k = key(p); m.set(k, (m.get(k) || 0) + d); if (!m.get(k)) m.delete(k); };
  items.forEach(it => { inc(startN, it.pts[0], 1); inc(endN, it.pts[it.pts.length - 1], 1); });

  const queue = [];
  items.forEach(it => { if (!it.hand && !startN.has(key(it.pts[it.pts.length - 1]))) queue.push({ it, at: 'end' }); });
  items.forEach(it => { if (it.hand && !startN.has(key(it.pts[it.pts.length - 1]))) queue.push({ it, at: 'end' }); });
  items.forEach(it => { if (it.hand && !endN.has(key(it.pts[0]))) queue.push({ it, at: 'start' }); });

  const nearest = (p, self, accept, radius = SNAP_M) => {
    let best = null;
    items.forEach(o => {
      if (o.id === self.id || !accept(o)) return;
      const q = o.pts;
      for (let j = 0; j < q.length - 1; j++) {
        const ax = (q[j][0] - p[0]) * mx, ay = (q[j][1] - p[1]) * my;
        const bx = (q[j + 1][0] - p[0]) * mx, by = (q[j + 1][1] - p[1]) * my;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d <= radius && (!best || d < best.d)) best = { o, j, t, d };
      }
    });
    return best;
  };
  const sameM = (u, v) => Math.hypot((u[0] - v[0]) * mx, (u[1] - v[1]) * my) < 1;
  const nearPoint = ({ o, j, t }) => {
    const a = o.pts[j], b = o.pts[j + 1];
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return quantized ? [Math.round(q[0]), Math.round(q[1])] : q;
  };

  /** Cắt o tại q (trên đoạn j); trùng đỉnh có sẵn thì cắt tại đỉnh. Phần sau thành đường mới cùng thuộc tính → điểm cắt */
  const splitAt = (o, j, q) => {
    let k = -1;
    if (sameM(o.pts[j], q)) k = j; else if (sameM(o.pts[j + 1], q)) k = j + 1;
    const head = k >= 0 ? o.pts.slice(0, k + 1) : [...o.pts.slice(0, j + 1), q];
    const tail = k >= 0 ? o.pts.slice(k) : [q, ...o.pts.slice(j + 1)];
    const pivot = head[head.length - 1];
    o.pts = head;
    const rest = { id: o.id, pts: tail, props: o.props, hand: o.hand };
    items.push(rest);
    inc(endN, pivot, 1);
    inc(startN, pivot, 1);
    queue.forEach(e => { if (e.it === o && e.at === 'end') e.it = rest; });
    return pivot;
  };

  /** Đi xuôi dòng từ a có gặp b không (nối thêm sẽ tạo vòng) */
  const reaches = (a, b) => {
    const seen = new Set([a]);
    const stack = [a];
    while (stack.length) {
      const x = stack.pop();
      if (x === b) return true;
      const k = key(x.pts[x.pts.length - 1]);
      items.forEach(y => { if (!seen.has(y) && key(y.pts[0]) === k) { seen.add(y); stack.push(y); } });
    }
    return false;
  };

  const report = { end: 0, start: 0, split: 0, skipped: [] };
  // Nhiều lượt: hợp lưu 3 nhánh vẽ tay chỉ nối được sau khi một nhánh đã nối tiếp xuống hạ lưu
  for (let pass = 0; pass < 3; pass++) {
    const done = report.end + report.start;
    report.skipped = [];
    for (const e of queue) {
      const it = e.it;
      const p = e.at === 'end' ? it.pts[it.pts.length - 1] : it.pts[0];
      if (e.at === 'end' ? startN.has(key(p)) : endN.has(key(p))) continue;
      let hit = nearest(p, it, (o) => it.hand || o.hand);
      if (!hit) continue;
      // Hai dòng cùng đổ về gần một điểm (hợp lưu vẽ tay chưa có đoạn tiếp): tìm đoạn hạ lưu xa hơn, bỏ qua các dòng cùng đổ về
      if (e.at === 'end' && sameM(nearPoint(hit), hit.o.pts[hit.o.pts.length - 1])) {
        const endFar = (o) => { const z = o.pts[o.pts.length - 1]; return Math.hypot((z[0] - p[0]) * mx, (z[1] - p[1]) * my) > SNAP_M; };
        const far = nearest(p, it, (o) => (it.hand || o.hand) && endFar(o), 2 * SNAP_M);
        if (far && !sameM(nearPoint(far), far.o.pts[far.o.pts.length - 1])) hit = far;
      }
      const { o, j } = hit;
      let q = nearPoint(hit);
      const other = e.at === 'end' ? it.pts[0] : it.pts[it.pts.length - 1];
      if (sameM(q, other) || (e.at === 'end' ? reaches(o, it) : reaches(it, o))) {
        report.skipped.push({ p, d: hit.d, why: 'nối vào sẽ tạo vòng lặp — kiểm tra chiều vẽ của các luồng quanh đây' });
        continue;
      }
      const first = o.pts[0], last = o.pts[o.pts.length - 1];
      if (sameM(q, first)) {
        if (e.at === 'start') { report.skipped.push({ p, d: hit.d, why: 'hai đường cùng xuất phát một điểm, không dòng nào đổ vào' }); continue; }
        q = first;
      } else if (sameM(q, last)) {
        if (e.at === 'end') { report.skipped.push({ p, d: hit.d, why: 'hai đường cùng đổ về một điểm — có thể một đường vẽ ngược chiều' }); continue; }
        q = last;
      } else {
        q = splitAt(o, j, q);
        report.split++;
      }
      if (q[0] !== p[0] || q[1] !== p[1]) {
        if (e.at === 'end') { inc(endN, p, -1); it.pts.push(q); inc(endN, q, 1); } else { inc(startN, p, -1); it.pts.unshift(q); inc(startN, q, 1); }
      }
      report[e.at]++;
    }
    if (report.end + report.start === done) break;
  }
  return report;
}

/**
 * Giữ LineString, thuộc tính rút gọn: t = 0 đầu nguồn / 1 dòng chính (đường vẽ tay coi là dòng chính), n = mạng lưới,
 * m = bậc Shreve (số nhánh đầu nguồn đổ về đoạn này) để webapp chia độ dày nét và lọc theo mức phóng.
 */
function compact(lines, tf, bbox, inside) {
  const ptsOf = (g) => g.pts;
  const byStart = new Map();
  const ends = lines.map((g, i) => {
    const pts = ptsOf(g);
    const s = key(pts[0]);
    if (!byStart.has(s)) byStart.set(s, []);
    byStart.get(s).push(i);
    return key(pts[pts.length - 1]);
  });
  // Kahn: đoạn i đổ vào các đoạn bắt đầu tại điểm cuối của i; chỗ phân lưu (luồng vẽ tay tách nhánh) mỗi nhánh nhận đủ bậc phía trên
  const downs = ends.map(e => byStart.get(e) || []);
  const indeg = new Array(lines.length).fill(0);
  downs.forEach(ds => ds.forEach(d => { indeg[d]++; }));
  const mag = indeg.map(n => (n === 0 ? 1 : 0));
  const queue = indeg.map((n, i) => (n === 0 ? i : -1)).filter(i => i >= 0);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    downs[i].forEach(d => {
      mag[d] += mag[i];
      if (--indeg[d] === 0) queue.push(d);
    });
  }
  if (queue.length !== lines.length) console.warn(`⚠ ${lines.length - queue.length} đoạn nằm trong vòng lặp, bậc đặt = 1`);

  // Bậc tính trên toàn mạng lưới trước khi cắt: dòng chảy từ ngoài ranh vào vẫn giữ đúng độ dày
  const toLL = toLLOf(tf);
  const arcs = [];
  const geometries = [];
  lines.forEach((g, i) => {
    const p = g.props;
    const main = g.hand || Number(p.type_code) === 1 || p.stream_type === 'intermediate';
    const props = { t: main ? 1 : 0, n: Number(p.network) || 0, m: Math.max(mag[i] || 1, g.hand ? HAND_MIN_M : 1) };
    const runs = inside ? clipLine(ptsOf(g), inside, toLL, !!tf) : [ptsOf(g)];
    runs.forEach(run => {
      geometries.push({ type: 'LineString', arcs: [arcs.length], properties: props });
      arcs.push(tf ? run.map((pt, k) => (k ? [pt[0] - run[k - 1][0], pt[1] - run[k - 1][1]] : pt)) : run);
    });
  });
  const out = { type: 'Topology', objects: { data: { type: 'GeometryCollection', geometries } }, arcs };
  if (tf) out.transform = tf;
  if (bbox) out.bbox = bbox;
  return { out, lines: lines.length, kept: geometries.length, outlets: downs.filter(ds => !ds.length).length, maxMag: Math.max(...mag) };
}

const toLLOf = (tf) => (tf ? (p) => [p[0] * tf.scale[0] + tf.translate[0], p[1] * tf.scale[1] + tf.translate[1]] : (p) => p);

// ---- Cắt theo ranh 40 phường xã (đất liền TP. Huế) ----

/** Tách 1 đường thành các đoạn nằm trong ranh; chỗ cắt ranh tìm giao điểm bằng chia đôi (12 lần) */
function clipLine(pts, inside, toLL, quantized) {
  const isIn = (p) => inside(...toLL(p));
  const cross = (outP, inP) => {
    let a = outP, b = inP;
    for (let k = 0; k < 12; k++) {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (isIn(mid)) b = mid; else a = mid;
    }
    return quantized ? [Math.round(b[0]), Math.round(b[1])] : b;
  };
  const flags = pts.map(isIn);
  const runs = [];
  let cur = null;
  const push = (p) => {
    const last = cur[cur.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) cur.push(p);
  };
  pts.forEach((p, i) => {
    if (flags[i]) {
      if (!cur) { cur = []; if (i > 0) push(cross(pts[i - 1], p)); }
      push(p);
    } else if (cur) {
      push(cross(p, pts[i - 1]));
      runs.push(cur);
      cur = null;
    }
  });
  if (cur) runs.push(cur);
  return runs.filter(r => r.length >= 2);
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const outFile = opt('--out');
  const boundaryFile = opt('--boundary');
  const optValues = new Set([outFile, boundaryFile].filter(Boolean));
  const input = args.find(a => !a.startsWith('--') && !optValues.has(a)) || path.join(__dirname, '..', 'Thoatnuoc.topojson');
  const raw = fs.readFileSync(input, 'utf8');
  const topo = JSON.parse(raw);
  if (topo.type !== 'Topology') throw new Error('File không phải TopoJSON');
  let inside = null;
  if (!args.includes('--no-clip')) {
    console.log(boundaryFile ? `… Đọc ranh phường xã: ${boundaryFile}` : '… Tải ranh 40 phường xã từ webapp');
    const fc = await loadBoundary(boundaryFile);
    inside = makeInside(fc);
    console.log(`✓ Ranh: ${(fc.features || []).length} phường xã`);
  }
  const tf = topo.transform;
  const items = readLines(topo);
  const hand = items.filter(it => it.hand).length;
  if (hand) {
    const toLL = toLLOf(tf);
    const lat = toLL(items.find(it => it.hand).pts[0])[1];
    const mx = (tf ? tf.scale[0] : 1) * 111320 * Math.cos(lat * Math.PI / 180), my = (tf ? tf.scale[1] : 1) * 110540;
    const r = snapHand(items, mx, my, !!tf);
    console.log(`✓ ${hand} đường vẽ tay: nối ${r.end} điểm cuối, ${r.start} điểm đầu vào mạng lưới (cắt ${r.split} chỗ, khoảng hở ≤ ${SNAP_M} m)`);
    r.skipped.forEach(s => {
      const [lng, lat2] = toLL(s.p);
      console.warn(`⚠ Chưa nối ${lat2.toFixed(5)}, ${lng.toFixed(5)} (cách ${Math.round(s.d)} m): ${s.why}`);
    });
  }
  const { out, lines, kept, outlets, maxMag } = compact(items, tf, topo.bbox, inside);
  const content = JSON.stringify(out);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`✓ ${lines} đoạn dòng chảy, ${outlets} cửa xả, bậc lớn nhất ${maxMag}`
    + `${inside ? ` · cắt theo ranh còn ${kept} đoạn` : ''} · ${kb(raw.length)} → ${kb(content.length)}`);
  if (outFile) {
    fs.writeFileSync(outFile, content);
    console.log(`✓ Đã ghi bản rút gọn: ${outFile}`);
    return;
  }
  const data = await postToAppsScript('saveDrainage', content);
  console.log(`✓ Đã ghi gs://hue-infra-data-us/drainage/thoatnuoc.topojson (${kb(data.size || content.length)})`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { readLines, snapHand, compact };
