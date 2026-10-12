// Gỡ lô INFRA nhập trùng trong file quy hoạch của 1 đồ án (cùng loại, ranh trùng từng đỉnh), giữ mã số nhỏ nhất.
//   node scripts/dedupe-plan-lots.js --project "<tenQH>" [--write]
// Dòng Sheet của mã bị gỡ trở thành dòng thừa không gắn lô: xóa tiếp bằng sync-plan-infra --dups --delete-dups.
const axios = require('axios');
const { loadEnv } = require('./gasClient');

const GCS = 'https://storage.googleapis.com/hue-infra-data-us/';

async function getJson(name) {
  const res = await axios.get(`${GCS}${name}?v=${Date.now()}`, { timeout: 60000, maxContentLength: Infinity, validateStatus: () => true });
  if (res.status !== 200) throw new Error(`Không đọc được ${name} (HTTP ${res.status})`);
  return res.data;
}

function ringKey(geometry) {
  const polys = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return JSON.stringify(polys.map(poly => poly.map(ring => ring.map(p => [Number(p[0]).toFixed(7), Number(p[1]).toFixed(7)]))));
}

function idNum(id) {
  const m = String(id).match(/-(\d+)$/);
  return m ? Number(m[1]) : Infinity;
}

function findLotDuplicates(parcels) {
  const byId = new Map();
  (parcels || []).forEach(p => {
    if (!p || p.kind !== 'INFRA') return;
    const base = String(p.id).replace(/\.\d+$/, '');
    if (!byId.has(base)) byId.set(base, []);
    byId.get(base).push(p);
  });
  const groups = new Map();
  byId.forEach((parts, base) => {
    const code = base.replace(/-\d+$/, '');
    const key = code + '|' + parts.map(p => ringKey(p.geometry)).sort().join('#');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ base, area: parts.reduce((s, p) => s + (Number(p.area) || 0), 0), layer: parts[0].layer || '' });
  });
  return [...groups.values()].filter(g => g.length > 1).map(g => {
    g.sort((a, b) => idNum(a.base) - idNum(b.base));
    return { keep: g[0], drop: g.slice(1) };
  });
}

(async () => {
  const args = process.argv.slice(2);
  const at = args.indexOf('--project');
  const wanted = String(at >= 0 ? args[at + 1] || '' : '').trim().normalize('NFC');
  if (!wanted) throw new Error('Thiếu --project "tên đồ án"');
  const index = await getJson('projects/index.json');
  const entry = (index.projects || []).find(p => p && !p.deleted && String(p.tenQH || '').normalize('NFC') === wanted);
  if (!entry || !entry.slug) throw new Error(`Không thấy đồ án «${wanted}» trong projects/index.json`);
  const plan = await getJson(`projects/${entry.slug}/su-dung-dat.json`);
  const dups = findLotDuplicates(plan.parcels);
  const ids = dups.flatMap(d => d.drop.map(x => x.base));
  dups.forEach(d => console.log(`  trùng  giữ ${d.keep.base}  gỡ ${d.drop.map(x => x.base).join(', ')}  (${d.keep.layer}, ${Math.round(d.keep.area * 10) / 10} m²)`));
  console.log(`${wanted}: ${dups.length} nhóm lô trùng ranh, ${ids.length} lô sẽ gỡ.`);
  if (!ids.length) return;
  if (!args.includes('--write')) {
    console.log('Chưa ghi. Thêm --write để gỡ lô trùng khỏi file đồ án.');
    return;
  }
  loadEnv();
  const out = await require('../services/projectStore').deleteInfraLots({ tenQH: entry.tenQH, ids });
  console.log(`Đã gỡ ${out.removed} lô khỏi file đồ án.`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
