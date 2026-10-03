// Đẩy mạng lưới thoát nước, khe tụ thủy (TopoJSON xuất từ QGIS / GRASS r.stream.extract) lên bucket qua Apps Script.
//   node scripts/push-thoatnuoc.js [Thoatnuoc.topojson]         → rút gọn rồi ghi drainage/thoatnuoc.topojson
//   node scripts/push-thoatnuoc.js [file] --out ban-rut-gon.json  → chỉ ghi bản rút gọn ra máy, không gửi
//   Mặc định cắt theo ranh 40 phường xã (tải từ webapp); --boundary ranh.geojson dùng file có sẵn, --no-clip không cắt.
// Cần GAS_BASE_URL và GAS_SECRET (biến môi trường, hoặc .env.local / .env do `vercel env pull` tạo).
// Đường trong file phải vẽ xuôi dòng (đầu nguồn → hạ lưu): webapp chạy hiệu ứng và đặt mũi tên theo thứ tự đỉnh.
const fs = require('fs');
const path = require('path');

function loadEnvFile(name) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) return;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
}

function decodeArc(arc) {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
}

/**
 * Giữ LineString, thuộc tính rút gọn: t = 0 đầu nguồn / 1 dòng chính, n = mạng lưới,
 * m = bậc Shreve (số nhánh đầu nguồn đổ về đoạn này) để webapp chia độ dày nét và lọc theo mức phóng.
 */
function compact(topo, inside) {
  const obj = topo.objects && (topo.objects.data || Object.values(topo.objects)[0]);
  if (!obj || !Array.isArray(obj.geometries)) throw new Error('Không thấy objects trong TopoJSON');
  const decoded = topo.transform ? topo.arcs.map(decodeArc) : topo.arcs;
  const lines = obj.geometries.filter(g => g.type === 'LineString' && Array.isArray(g.arcs) && g.arcs.length);
  const ptsOf = (g) => g.arcs.flatMap(i => (i < 0 ? decoded[~i].slice().reverse() : decoded[i]));
  const key = (p) => `${p[0]},${p[1]}`;
  const byStart = new Map();
  const ends = lines.map((g, i) => {
    const pts = ptsOf(g);
    const s = key(pts[0]);
    if (!byStart.has(s)) byStart.set(s, []);
    byStart.get(s).push(i);
    return key(pts[pts.length - 1]);
  });
  // Kahn: đoạn i đổ vào đoạn bắt đầu tại điểm cuối của i
  const down = ends.map(e => (byStart.get(e) || [])[0]);
  const indeg = new Array(lines.length).fill(0);
  down.forEach(d => { if (d !== undefined) indeg[d]++; });
  const mag = indeg.map(n => (n === 0 ? 1 : 0));
  const queue = indeg.map((n, i) => (n === 0 ? i : -1)).filter(i => i >= 0);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const d = down[i];
    if (d === undefined) continue;
    mag[d] += mag[i];
    if (--indeg[d] === 0) queue.push(d);
  }
  if (queue.length !== lines.length) console.warn(`⚠ ${lines.length - queue.length} đoạn nằm trong vòng lặp, bậc đặt = 1`);

  // Bậc tính trên toàn mạng lưới trước khi cắt: dòng chảy từ ngoài ranh vào vẫn giữ đúng độ dày
  const tf = topo.transform;
  const toLL = tf ? (p) => [p[0] * tf.scale[0] + tf.translate[0], p[1] * tf.scale[1] + tf.translate[1]] : (p) => p;
  const arcs = [];
  const geometries = [];
  lines.forEach((g, i) => {
    const p = g.properties || {};
    const props = { t: Number(p.type_code) === 1 || p.stream_type === 'intermediate' ? 1 : 0, n: Number(p.network) || 0, m: mag[i] || 1 };
    const runs = inside ? clipLine(ptsOf(g), inside, toLL, !!tf) : [ptsOf(g)];
    runs.forEach(run => {
      geometries.push({ type: 'LineString', arcs: [arcs.length], properties: props });
      arcs.push(tf ? run.map((pt, k) => (k ? [pt[0] - run[k - 1][0], pt[1] - run[k - 1][1]] : pt)) : run);
    });
  });
  const out = { type: 'Topology', objects: { data: { type: 'GeometryCollection', geometries } }, arcs };
  if (tf) out.transform = tf;
  if (topo.bbox) out.bbox = topo.bbox;
  return { out, lines: lines.length, kept: geometries.length, outlets: down.filter(d => d === undefined).length, maxMag: Math.max(...mag) };
}

// ---- Cắt theo ranh 40 phường xã (đất liền TP. Huế) ----

const BOUNDARY_URL = process.env.BOUNDARY_URL || 'https://web-hatang-hue-4.vercel.app/api/gee?action=getBoundaryVector&v=2';

async function loadBoundary(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(BOUNDARY_URL, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Không tải được ranh phường xã (HTTP ${res.status}) — dùng --boundary <file.geojson>`);
  return res.json();
}

/**
 * Hàm (lng, lat) → nằm trong ranh. Tia ngang chẵn–lẻ trên mọi vòng của các phường xã (không chồng nhau, cạnh chung
 * được đếm 2 lần vẫn đúng chẵn lẻ); cạnh chia theo dải vĩ độ để mỗi điểm chỉ xét vài chục cạnh.
 */
function makeInside(fc) {
  const E = [];
  let minY = Infinity, maxY = -Infinity;
  (fc.features || []).forEach(f => {
    const g = f && f.geometry;
    const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    polys.forEach(poly => poly.forEach(ring => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (a[1] === b[1]) continue;
        E.push(a[0], a[1], b[0], b[1]);
        minY = Math.min(minY, a[1], b[1]);
        maxY = Math.max(maxY, a[1], b[1]);
      }
    }));
  });
  if (!E.length) throw new Error('Ranh phường xã rỗng');
  const BANDS = 4096;
  const h = (maxY - minY) / BANDS;
  const band = (y) => Math.min(BANDS - 1, Math.max(0, Math.floor((y - minY) / h)));
  const buckets = Array.from({ length: BANDS }, () => []);
  for (let e = 0; e < E.length; e += 4) {
    const b0 = band(Math.min(E[e + 1], E[e + 3])), b1 = band(Math.max(E[e + 1], E[e + 3]));
    for (let b = b0; b <= b1; b++) buckets[b].push(e);
  }
  return (x, y) => {
    if (y < minY || y >= maxY) return false;
    let inside = false;
    for (const e of buckets[band(y)]) {
      const x1 = E[e], y1 = E[e + 1], x2 = E[e + 2], y2 = E[e + 3];
      if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  };
}

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

async function postToAppsScript(content) {
  const base = process.env.GAS_BASE_URL;
  const secret = process.env.GAS_SECRET;
  if (!base || !secret) throw new Error('Thiếu GAS_BASE_URL / GAS_SECRET (đặt biến môi trường hoặc chạy `vercel env pull .env.local`)');
  const url = `${base}?action=saveDrainage&key=${encodeURIComponent(secret)}`;
  // Giống api/gee.js: text/plain để Apps Script nhận nguyên body; doPost trả 302 → GET theo location
  let res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveDrainage', content }),
    signal: AbortSignal.timeout(120000)
  });
  const loc = res.headers.get('location');
  if (loc && res.status >= 300 && res.status < 400) res = await fetch(new URL(loc, url), { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* phản hồi không phải JSON */ }
  if (!data) throw new Error(`Apps Script trả về phản hồi lạ (HTTP ${res.status})`);
  if (data.error) {
    const hint = String(data.error).indexOf('Action không hợp lệ') === 0
      ? ' — Apps Script chưa có saveDrainage: dán apps-script/Code.gs rồi Deploy → Manage deployments → Edit → New version'
      : '';
    throw new Error(`Apps Script: ${data.error}${hint}`);
  }
  if (data.saved !== true) throw new Error('Apps Script chưa ghi được file lên bucket (xem Executions trong Apps Script)');
  return data;
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
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
  const { out, lines, kept, outlets, maxMag } = compact(topo, inside);
  const content = JSON.stringify(out);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`✓ ${lines} đoạn dòng chảy, ${outlets} cửa xả, bậc lớn nhất ${maxMag}`
    + `${inside ? ` · cắt theo ranh còn ${kept} đoạn` : ''} · ${kb(raw.length)} → ${kb(content.length)}`);
  if (outFile) {
    fs.writeFileSync(outFile, content);
    console.log(`✓ Đã ghi bản rút gọn: ${outFile}`);
    return;
  }
  const data = await postToAppsScript(content);
  console.log(`✓ Đã ghi gs://hue-infra-data-us/drainage/thoatnuoc.topojson (${kb(data.size || content.length)})`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
