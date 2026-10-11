// Tỷ lệ phủ kín quy hoạch phân khu theo từng đô thị (Giới thiệu tổng quan › Báo cáo thống kê):
// tổng diện tích các đồ án QHPK 1/2.000 nằm trong phạm vi đô thị (phần chồng lấn tính 1 lần) / diện tích đồ án QHC của đô thị.
// Ranh QHC: đồ án QHC đã nạp có ranh GIS (planProjectOf); còn lại phạm vi lập QHC (data/generalPlan.geojson).
// Đồ án QHC đã nạp không khớp đô thị nào (QHC thị trấn cũ...) có dòng riêng, tính trên ranh của chính đồ án.
// Ranh QHPK hợp nhất 1 lần cho mọi đô thị: ghép từng cặp theo cây (ghép dồn từng mảnh chậm gấp ~10 lần với ~100 đồ án).
import { state } from './state.js';
import { GENERAL_PLANS, CORE_AREAS, CORE_ZONE_ID, GP_KINDS, planLevelOf, planProjectOf } from './generalPlan.js';
import { loadScopes } from './generalPlanUi.js';
import { bareName } from './urbanStatus.js';

const ROUND_PRECISIONS = [7, 6];
// Đồ án thuộc phường khi lô đất của đồ án trong phường đạt từ 5 ha
const WARD_MIN_M2 = 50000;
// Danh mục đồ án tải lúc khởi động (loadCadParcels); hộp giới thiệu có thể mở trước khi tải xong
const CATALOG_WAIT_MS = 30000;
const FAILED = Symbol('failed');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const boxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function retry(op, a, b) {
  try { return op(a, b); } catch (e) { /* thử lại với tọa độ làm tròn */ }
  for (const precision of ROUND_PRECISIONS) {
    try { return op(turf.truncate(a, { precision }), turf.truncate(b, { precision })); } catch (e) { /* giảm độ chính xác */ }
  }
  return FAILED;
}

async function catalogReady() {
  for (let waited = 0; !(state.projectCatalog || []).length && waited < CATALOG_WAIT_MS; waited += 1000) await sleep(1000);
  return state.projectCatalog || [];
}

// Ghép cặp các đồ án gần nhau (sắp theo mép tây) để khối trung gian gọn
async function dissolve(features, onStep) {
  let list = features.map(f => ({ f, x: turf.bbox(f)[0] })).sort((a, b) => a.x - b.x).map(o => o.f);
  const total = Math.max(1, list.length - 1);
  let done = 0;
  while (list.length > 1) {
    const next = [];
    for (let i = 0; i < list.length; i += 2) {
      if (i + 1 >= list.length) { next.push(list[i]); continue; }
      const u = retry(turf.union, list[i], list[i + 1]);
      next.push(u && u !== FAILED ? u : list[i]);
      onStep(++done / total);
      await sleep(0);
    }
    list = next;
  }
  const g = list[0] && list[0].geometry;
  if (!g) return [];
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(c => ({ c, box: turf.bbox(turf.polygon(c)) }));
}

// Diện tích (m²) phần khối QHPK trong ranh; chỉ đưa các polygon của khối giao khung bao ranh vào phép cắt
function coveredIn(shape, cover) {
  const box = turf.bbox(shape);
  const hits = cover.filter(p => boxHit(box, p.box)).map(p => p.c);
  if (!hits.length) return 0;
  const x = retry(turf.intersect, shape, hits.length === 1 ? turf.polygon(hits[0]) : turf.multiPolygon(hits));
  return x === FAILED ? null : x ? turf.area(x) : 0;
}

const sumOf = (o) => Object.values(o || {}).reduce((s, v) => s + (Number(v) || 0), 0);

// Phường của đồ án theo landArea danh mục ({ phường: { loại đất: m² } }): mỗi lô gán phường chứa trên 50% diện tích lô
// (lô vắt ranh lớn đã tách mảnh theo phường khi nhập, assignWards trong cadImport.js); phường có từ WARD_MIN_M2 lô đất.
// Đồ án không phường nào đủ ngưỡng thuộc phường có nhiều lô đất nhất; chưa có landArea thì theo danh sách phường.
function homeWards(p) {
  const byWard = Object.entries(p.landArea || {}).map(([w, o]) => [w, sumOf(o)]).filter(([, a]) => a > 0);
  if (!byWard.length) return (p.wards || []).map(bareName);
  const big = byWard.filter(([, a]) => a >= WARD_MIN_M2);
  return (big.length ? big : [byWard.reduce((m, x) => (x[1] > m[1] ? x : m))]).map(([w]) => bareName(w));
}

// units null = toàn thành phố
function countByUnits(units, members) {
  if (!units) return members.length;
  const want = new Set(units.map(bareName));
  return members.filter(wards => wards.some(w => want.has(w))).length;
}

// Đồ án QHC không gắn đô thị (không có danh sách phường): đồ án QHPK có từ WARD_MIN_M2 nằm trong ranh QHC
function countByShape(shape, qhpk) {
  const box = turf.bbox(shape);
  return qhpk.filter(f => {
    if (!boxHit(box, turf.bbox(f))) return false;
    const x = retry(turf.intersect, shape, f);
    return x && x !== FAILED && turf.area(x) >= WARD_MIN_M2;
  }).length;
}

function rowDefs(scopes, catalog) {
  const used = new Set();
  const defs = [];
  // Ranh đồ án QHC tự dựng từ đường bao các lô (boundarySource auto) thường rộng quá phạm vi: dùng ranh phạm vi QHC
  const add = (group, label, depth, plan, scopeId) => {
    const project = plan && !plan.parent && !plan.areas ? planProjectOf(plan, catalog) : null;
    if (project) used.add(project.tenQH);
    const own = project && project.boundary && project.boundarySource === 'gis';
    defs.push({
      group, label, depth, source: own ? project.tenQH : '', from614: !own && !!plan.scope614,
      shape: own ? turf.feature(project.boundary) : scopes.get(scopeId) || null, units: plan.city ? null : plan.units
    });
  };
  const city = GENERAL_PLANS.find(p => p.city);
  add(GP_KINDS.city, city.name, 0, city, city.id);
  add(GP_KINDS.city, `${city.zones[0].name} (1/10.000)`, 1, city.zones[0], CORE_ZONE_ID);
  CORE_AREAS.forEach(a => add(GP_KINDS.city, a.name, 2, a, a.id));
  ['satellite', 'town'].forEach(kind => GENERAL_PLANS.filter(p => p.kind === kind)
    .forEach(p => add(GP_KINDS[kind], `Đô thị ${p.short}`, 0, p, p.id)));
  catalog.filter(p => p && p.boundary && planLevelOf(p.tenQH) === 'QHC' && !used.has(p.tenQH)).forEach(p => defs.push({
    group: 'Đồ án QHC đã nạp khác', label: p.tenQH, depth: 0, source: p.tenQH, shape: turf.feature(p.boundary), units: undefined
  }));
  return defs;
}

let memo = { job: null, catalog: null, promise: null, onProgress: null };

/**
 * → { rows: [{ group, label, depth, source, total, covered (m²), projects, ratio }], qhpkCount }.
 * source = tên đồ án QHC làm mẫu số, '' = phạm vi lập QHC; total null = chưa có ranh, covered null = lỗi hình học.
 * onProgress(text): tiến độ khi đang tính (lần gọi sau thay hàm của lần trước).
 */
export function qhpkCoverRows(onProgress = null) {
  memo.onProgress = onProgress;
  if (memo.promise && memo.catalog === state.projectCatalog) return memo.promise;
  const job = {};
  const say = (text) => { if (memo.job === job && memo.onProgress) memo.onProgress(text); };
  memo = { job, catalog: state.projectCatalog, promise: null, onProgress };
  const promise = (async () => {
    say('Đang tải danh mục đồ án và ranh phạm vi QHC…');
    const [fc, catalog] = await Promise.all([loadScopes(), catalogReady()]);
    if (memo.job === job) memo.catalog = catalog;
    if (typeof turf === 'undefined') throw new Error('Chưa tải thư viện Turf');
    const scopes = new Map((fc.features || []).map(f => [f.properties && f.properties.id, f]));
    const all = catalog.filter(p => p && planLevelOf(p.tenQH) === 'QHPK');
    const members = all.map(homeWards);
    const qhpk = all.filter(p => p.boundary).map(p => turf.feature(p.boundary));
    const cover = await dissolve(qhpk, (r) => say(`Đang hợp nhất ranh ${qhpk.length} đồ án QHPK… ${Math.round(r * 100)}%`));
    const defs = rowDefs(scopes, catalog);
    const rows = [];
    for (const [i, def] of defs.entries()) {
      say(`Đang tính diện tích trong từng đô thị… ${i + 1}/${defs.length}`);
      await sleep(0);
      const total = def.shape ? turf.area(def.shape) : null;
      const covered = def.shape ? coveredIn(def.shape, cover) : null;
      rows.push({
        group: def.group, label: def.label, depth: def.depth, source: def.source, from614: !!def.from614,
        projects: def.units !== undefined ? countByUnits(def.units, members) : countByShape(def.shape, qhpk),
        total, covered: covered == null ? null : Math.min(covered, total),
        ratio: total > 0 && covered != null ? Math.min(covered, total) / total : null
      });
    }
    return { rows, qhpkCount: all.length };
  })();
  memo.promise = promise;
  promise.catch(() => { if (memo.job === job) memo = { job: null, catalog: null, promise: null, onProgress: null }; });
  return promise;
}
