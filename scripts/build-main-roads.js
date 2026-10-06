// Rút đường trục chính (nhóm vẽ 1) từ roads/v2 trên bucket thành một file nhẹ cho mức phóng toàn thành phố.
//   node scripts/build-main-roads.js [đường-dẫn-ra]
// Không gồm tuyến Admin vẽ bổ sung: máy chủ ghép thêm khi trả getMainRoads.
const fs = require('fs');

const BASE = 'https://storage.googleapis.com/hue-infra-data-us/roads/v2/';
const TOL = 0.0002; // ~22 m, đủ mượt đến sát mức phóng vẽ đường chi tiết

function slug(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function simplify(pts) {
  if (pts.length <= 2) return pts;
  const tol2 = TOL * TOL;
  const d2 = (p, a, b) => {
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const l2 = dx * dx + dy * dy || 1e-18;
    let t = ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = p[1] - (a[1] + t * dx), ey = p[0] - (a[0] + t * dy);
    return ex * ex + ey * ey;
  };
  const out = [pts[0]];
  const rec = (a, b) => {
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const dd = d2(pts[i], pts[a], pts[b]);
      if (dd > max) { max = dd; idx = i; }
    }
    if (idx >= 0 && max > tol2) { rec(a, idx); rec(idx, b); }
    else out.push(pts[b]);
  };
  rec(0, pts.length - 1);
  return out;
}

function toLine(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const line = simplify(pts).map(([lat, lng]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
  return line.length >= 2 ? line : null;
}

async function getJson(name) {
  const res = await fetch(`${BASE}${name}.json?v=${Date.now()}`);
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const index = await getJson('index');
  const wards = Object.entries(index.wards || {});
  const seen = new Set();
  const lines = [];
  let ways = 0, pts = 0;
  for (const [name, w] of wards) {
    for (let i = 0; i < w.parts; i++) {
      const part = await getJson(`net_${slug(name)}_${i}`);
      for (const way of part.ways || []) {
        const [id, , , flat, group] = way;
        if (group !== 1 || seen.has(id) || !Array.isArray(flat)) continue;
        seen.add(id);
        ways++;
        pts += flat.length / 2;
        const line = toLine(flat);
        if (line) lines.push(line);
      }
    }
    process.stdout.write(`\r${lines.length} tuyến`);
  }
  const out = { v: 1, lines };
  const text = JSON.stringify(out);
  const dest = process.argv[2] || require('path').join(require('os').tmpdir(), 'main-overview.json');
  fs.writeFileSync(dest, text);
  const kept = lines.reduce((s, l) => s + l.length, 0);
  console.log(`\n${ways} tuyến trục chính, ${pts} đỉnh → ${kept} đỉnh, ${(text.length / 1024).toFixed(0)} KB → ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
