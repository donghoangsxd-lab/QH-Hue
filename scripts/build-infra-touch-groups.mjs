// Dựng public/data/infra-touch-groups.json từ ranh lô trên GCS (một lần).
// Cùng đồ án, cùng giai đoạn, cùng loại, khe <= dung sai: một công trình.
// Không ghi đè polygon. Đếm số GET để ghi vào mục tác động chi phí.
import { writeFileSync } from 'node:fs';
import {
  TOUCH_TOLERANCE_M, clusterTouching, outerRings, groupCentroid, compareIds, joinLabels, infraCategory
} from '../public/js/touchGroups.js';

const BASE = 'https://storage.googleapis.com/hue-infra-data-us/';
const OUT = new URL('../public/data/infra-touch-groups.json', import.meta.url);
const CONCURRENCY = 4;
let gets = 0;

async function getJson(path) {
  const url = `${BASE}${path}`;
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    gets += 1;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    last = `HTTP ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`${path} ${last}`);
}

function takeInfra(parcels, project, phaseFallback) {
  const out = [];
  (parcels || []).forEach(p => {
    if (!p || !p.geometry) return;
    const kind = String(p.kind || 'INFRA').toUpperCase();
    if (kind === 'DXF' || kind === 'PROJECT' || kind === 'POINT' || p.land) return;
    const id = String(p.id || '');
    if (!id || /\.\d+$/.test(id)) return;
    const phase = p.phase === 'QH' || p.phase === 'HT' ? p.phase : phaseFallback;
    const type = infraCategory(p);
    if (!type || !phase) return;
    const rings = outerRings(p.geometry);
    if (!rings.length) return;
    out.push({ id, type, phase, project, rings, area: Number(p.area) || 0 });
  });
  return out;
}

function centroidOf(members) {
  return groupCentroid(members.map(m => ({ rings: m.rings, area: m.area })));
}

function emitGroups(lots, toleranceM) {
  const clusters = clusterTouching(lots, toleranceM);
  return clusters.map(idxs => idxs.map(i => lots[i]));
}

function pointOf(ft) {
  const props = ft.properties || {};
  const id = String(props.ID_DoiTuong || '');
  if (!id || /\.\d+$/.test(id)) return null;
  const coords = (ft.geometry && ft.geometry.coordinates) || [];
  return {
    id,
    name: String(props.Ten_CongTrinh || ''),
    lotCode: String(props.KyHieu || '').trim(),
    tenQH: String(props.Ten_QH || ''),
    tab: String(props.Tab || '')
  };
}

async function pool(list, n, fn) {
  const queue = list.slice();
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(runners);
}

const index = await getJson('projects/index.json');
const projects = ((index && index.projects) || []).filter(p => p && p.tenQH && p.slug && !p.deleted);
const infra = await getJson('infrastructure_hue.json');
const points = new Map();
((infra && infra.features) || []).forEach(ft => {
  const row = pointOf(ft);
  if (row) points.set(row.id, row);
});

const groups = [];
const byType = new Map();
let files = 0;
let done = 0;

await pool(projects, CONCURRENCY, async (project) => {
  const lots = [];
  if (project.dir) {
    const [ht, qh] = await Promise.all([
      getJson(`projects/${project.slug}/hien-trang.json`),
      getJson(`projects/${project.slug}/su-dung-dat.json`)
    ]);
    files += 2;
    lots.push(...takeInfra(ht && ht.parcels, project.tenQH, 'HT'));
    lots.push(...takeInfra(qh && qh.parcels, project.tenQH, 'QH'));
  } else {
    const doc = await getJson(`projects/${project.slug}.json`);
    files += 1;
    lots.push(...takeInfra(doc && doc.parcels, project.tenQH, ''));
  }
  emitGroups(lots, TOUCH_TOLERANCE_M).forEach(members => {
    const ids = [...new Set(members.map(m => m.id))].filter(id => points.has(id)).sort(compareIds);
    if (ids.length < 2) return;
    const center = centroidOf(members);
    if (!center) return;
    const recs = ids.map(id => points.get(id));
    const type = members[0].type;
    const row = {
      ids,
      name: joinLabels(recs),
      lat: Math.round(center.lat * 1e6) / 1e6,
      lng: Math.round(center.lng * 1e6) / 1e6,
      type,
      phase: members[0].phase,
      project: project.tenQH,
      n: ids.length,
      area: Math.round(members.reduce((s, m) => s + (Number(m.area) || 0), 0) * 10) / 10
    };
    groups.push(row);
    byType.set(type, (byType.get(type) || 0) + 1);
  });
  done += 1;
  if (done % 20 === 0) console.log(`đã đọc ${done}/${projects.length} đồ án`);
});

const sig = (g) => `${g.ids.join('|')}`;
const best = new Map();
groups.forEach(g => {
  const prev = best.get(sig(g));
  if (!prev || g.n > prev.n || (g.n === prev.n && g.phase === 'QH')) best.set(sig(g), g);
});
const out = [...best.values()].sort((a, b) => a.type.localeCompare(b.type) || a.project.localeCompare(b.project, 'vi') || compareIds(a.ids[0], b.ids[0]));

const payload = {
  v: 1,
  toleranceM: TOUCH_TOLERANCE_M,
  groups: out.map(g => ({
    ids: g.ids, name: g.name, lat: g.lat, lng: g.lng, type: g.type, phase: g.phase, project: g.project, n: g.n, area: g.area
  }))
};
writeFileSync(OUT, `${JSON.stringify(payload)}\n`);

const counts = [...byType.entries()].sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({
  gets,
  files,
  projects: projects.length,
  points: points.size,
  groups: out.length,
  byType: Object.fromEntries(counts),
  largest: out.slice().sort((a, b) => b.n - a.n).slice(0, 12).map(g => ({
    n: g.n, type: g.type, phase: g.phase, project: g.project, name: g.name, lat: g.lat, lng: g.lng, area: g.area
  })),
  compact: out.filter(g => g.n >= 7 && g.n <= 12).map(g => ({
    n: g.n, type: g.type, phase: g.phase, project: g.project, name: g.name, lat: g.lat, lng: g.lng, area: g.area, ids: g.ids
  }))
}, null, 2));
