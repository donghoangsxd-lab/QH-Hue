// Tải ranh lô theo đồ án: mở bản đồ chỉ có danh mục. File một đồ án tải khi zoom ≥ ngưỡng lô và ranh tổng giao khung nhìn,
// khi bật ranh lô công trình, khi bấm phóng tới (đồ án đang chọn giữ ở mọi zoom), khi đang chọn 1 phường và bật lớp
// Quy hoạch (mọi đồ án thuộc phường, mọi zoom), hoặc khi bật lớp lô đã lưu (showLand).
// Đồ án thư mục (dir) đọc hien-trang.json + su-dung-dat.json. Đồ án file gộp cũ đọc projects/<slug>.json.
// Điểm chức năng chỉ dùng gợi tên lô lúc nhập, không tải / không vẽ (diem-chuc-nang.json cũ trên bucket bỏ qua).
// Đồ án chưa chuyển đọc qua API. URL bucket do máy chủ trả về (?v= phiên bản trong danh mục).
import { state } from './state.js';
import { geeApi } from './api.js';

const CITY_NAME = 'Thành phố Huế';
// Tiến độ tải file đồ án (detail { done, total }; done = total là xong)
export const LOTS_PROGRESS_EVENT = 'qh:lots-progress';
const LOAD_CONCURRENCY = 4;
// Đang tải nhiều đồ án: vẽ dần phần đã có, tối đa 1 lần / khoảng này (vẽ lại toàn bộ lô khá nặng)
const PAINT_EVERY_MS = 600;

let minZoom = 15;
let getMap = () => null;
let lotZoom = () => minZoom;
let onChange = () => {};
let base = '';
let timer = null;
let seq = 0;
const force = new Set();
const cache = new Map();
const ward = { loaded: false, map: new Map(), lands: [] };

// zoom: ngưỡng lớp Đồ án; lotZoomFn: ngưỡng ranh lô công trình (thấp hơn khi chỉ bật vài nhóm, mapEngine.parcelMinZoom)
export function bindMap(fn, zoom, lotZoomFn) {
  getMap = fn;
  if (zoom) minZoom = zoom;
  if (lotZoomFn) lotZoom = lotZoomFn;
}

function parcelLayerOn(zoom) {
  return (state.showParcels && zoom >= lotZoom()) || (state.showProjects && zoom >= minZoom);
}
export function onChangeLots(fn) { onChange = fn; }

/** Đồ án đang chọn còn hiện trên bản đồ (lớp Quy hoạch bật, đồ án không bị ẩn) → Ten_QH, không thì null */
export function focusedProjectName() {
  const name = state.focusedProject;
  return name && state.showProjects && !state.hiddenProjects.has(name) ? name : null;
}

/** Phường đang chọn khi lớp Quy hoạch bật → vẽ toàn bộ lô trong phường ở mọi zoom; toàn TP / lớp tắt → null */
export function wardScopeName() {
  const w = state.selectedWard;
  return state.showProjects && w && w !== CITY_NAME ? w : null;
}

/** Đồ án (mục danh mục) có phần nằm trong phường (danh mục ghi sẵn các phường giao ranh) */
export const inWard = (entry, wardName) => Array.isArray(entry?.wards) && entry.wards.includes(wardName);

function intersects(bbox, bounds) {
  return bbox[0] <= bounds.getEast() && bbox[2] >= bounds.getWest()
    && bbox[1] <= bounds.getNorth() && bbox[3] >= bounds.getSouth();
}

function wanted() {
  const map = getMap();
  if (!map) return [];
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.15);
  const layerOn = parcelLayerOn(zoom) || state.showLand;
  const focus = focusedProjectName();
  const wardName = wardScopeName();
  return state.projectCatalog.filter(p => {
    if (!p || !p.tenQH || p.sheetOnly) return false;
    if (force.has(p.tenQH)) return state.showLand || !state.hiddenProjects.has(p.tenQH);
    if (p.tenQH === focus) return true;
    if (wardName && inWard(p, wardName) && !state.hiddenProjects.has(p.tenQH)) return true;
    if (!layerOn) return false;
    if (!state.showLand && state.showProjects && state.hiddenProjects.has(p.tenQH)) return false;
    if (!p.bbox) return !!state.showLand;
    return intersects(p.bbox, bounds);
  });
}

// Lô công trình theo phường: theo nút Ranh lô / lớp Đồ án, từ ngưỡng zoom
function wardLotsOn() {
  const map = getMap();
  return !!map && (parcelLayerOn(map.getZoom()) || !!wardScopeName());
}

// Lô đất cũ chưa gắn đồ án: như lô đất đồ án (showLand mọi zoom, lớp Đồ án từ ngưỡng zoom hoặc đang chọn phường)
function wardLandsOn() {
  const map = getMap();
  if (!map) return false;
  return state.showLand || (state.showProjects && map.getZoom() >= minZoom) || !!wardScopeName();
}

function wantsWard() {
  return wardLotsOn() || wardLandsOn();
}

// Diện tích ranh tổng (m²) theo danh mục, để vẽ đồ án lớn dưới, đồ án nhỏ lồng bên trong nằm trên.
// Đồ án chưa có ranh và lô phường (không thuộc đồ án) → Infinity (dưới cùng).
let entryIndex = { catalog: null, byName: new Map() };
const boundaryArea = new WeakMap();
export function projectAreaOf(tenQH) {
  if (entryIndex.catalog !== state.projectCatalog) {
    entryIndex = { catalog: state.projectCatalog, byName: new Map((state.projectCatalog || []).filter(p => p && p.tenQH).map(p => [p.tenQH, p])) };
  }
  const g = tenQH ? entryIndex.byName.get(tenQH)?.boundary : null;
  if (!g || typeof turf === 'undefined') return Infinity;
  if (!boundaryArea.has(g)) {
    let area = Infinity;
    try { area = turf.area(turf.feature(g)); } catch (e) { /* ranh lỗi: coi như chưa có */ }
    boundaryArea.set(g, area);
  }
  return boundaryArea.get(g);
}

/** So sánh để sort: đồ án diện tích lớn trước (vẽ trước = nằm dưới) */
export function byProjectAreaDesc(a, b) {
  const x = projectAreaOf(a);
  const y = projectAreaOf(b);
  return x === y ? 0 : x < y ? 1 : -1;
}

// Lớp dữ liệu chính của đồ án, mỗi lớp = 1 file projects/<slug>/<key>.json: 2 lớp QH (vùng sử dụng đất, ranh giới)
// + lớp hiện trạng (file HT-). Lớp mới (cấp điện, cấp nước…) thêm 1 dòng ở đây và ở LAYER_ROLES (services/projectStore.js).
export const PROJECT_LAYERS = [
  { key: 'su-dung-dat', phase: 'QH', kind: 'lots', label: 'Sử dụng đất quy hoạch', color: '#fb923c' },
  { key: 'ranh-gioi', phase: 'QH', kind: 'boundary', label: 'Ranh giới quy hoạch', color: '#e879f9' },
  { key: 'hien-trang', phase: 'HT', kind: 'lots', label: 'Sử dụng đất hiện trạng', color: '#22d3ee' }
];
const LOT_LAYER = { HT: 'hien-trang', QH: 'su-dung-dat' };

// Danh sách đồ án (projectLayer) → bảng thông tin 1 đồ án (projectReview), detail = tenQH
export const PROJECT_INFO_EVENT = 'qh:project-info';

export const layerKey = (tenQH, key) => `${tenQH}|${key}`;
export const isLayerHidden = (tenQH, key) => state.hiddenProjectLayers.has(layerKey(tenQH, key));

async function fetchRole(entry, role) {
  const res = await fetch(`${base}${entry.slug}/${role}.json?v=${entry.saved || 0}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDir(entry) {
  const [ht, qh] = await Promise.all([fetchRole(entry, LOT_LAYER.HT), fetchRole(entry, LOT_LAYER.QH)]);
  return { parcels: [...((ht && ht.parcels) || []), ...((qh && qh.parcels) || [])] };
}

function isFresh(entry) {
  const prev = cache.get(entry.tenQH);
  return !!prev && prev.saved === (entry.saved || 0) && prev.legacy === !!entry.legacy && !!prev.parcels;
}

// Cùng 1 file đang tải (bấm đồ án = vẽ lô + mở bảng thông tin) thì dùng chung 1 lần tải
const inflight = new Map();
function loadEntry(entry) {
  if (isFresh(entry)) return Promise.resolve(cache.get(entry.tenQH));
  const key = `${entry.tenQH}|${entry.saved || 0}|${!!entry.legacy}`;
  if (!inflight.has(key)) inflight.set(key, fetchEntry(entry).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function fetchEntry(entry) {
  if (!entry.legacy && entry.slug && base && entry.dir) {
    try {
      const row = { saved: entry.saved || 0, legacy: false, ...(await loadDir(entry)) };
      cache.set(entry.tenQH, row);
      return row;
    } catch (err) {
      console.warn(`Đọc thư mục đồ án «${entry.tenQH}» lỗi, hỏi qua API:`, err);
    }
  }
  if (!entry.legacy && entry.slug && base && !entry.dir) {
    try {
      const res = await fetch(`${base}${entry.slug}.json?v=${entry.saved || 0}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const row = { saved: entry.saved || 0, legacy: false, parcels: data.parcels || [] };
      cache.set(entry.tenQH, row);
      return row;
    } catch (err) {
      console.warn(`Đọc thẳng file đồ án «${entry.tenQH}» lỗi, hỏi qua API:`, err);
    }
  }
  const q = entry.legacy
    ? `action=getProjectLots&project=${encodeURIComponent(entry.tenQH)}`
    : `action=getProjectLots&slug=${encodeURIComponent(entry.slug || '')}`;
  const res = await fetch(geeApi(q));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  const row = { saved: entry.saved || 0, legacy: !!entry.legacy, parcels: data.parcels || [] };
  cache.set(entry.tenQH, row);
  return row;
}

async function ensureWard(always = false) {
  if (ward.loaded || (!always && !wantsWard())) return;
  const res = await fetch(geeApi('action=getWardParcels'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const next = new Map();
  (data.parcels || []).forEach(p => {
    if (!p || !p.id || !p.geometry) return;
    const phase = p.phase === 'QH' ? 'QH' : 'HT';
    next.set(`${phase}|${p.id}`, { geometry: p.geometry, layer: p.layer || '', file: '' });
  });
  ward.map = next;
  ward.lands = (data.lands || []).filter(p => p && p.id && p.geometry)
    .map(p => ({ ...p, file: '', phase: p.phase === 'QH' ? 'QH' : 'HT' }));
  ward.loaded = true;
}

async function pool(list, n, fn) {
  const queue = list.slice();
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(runners);
}

export function composeNow() {
  const next = new Map(ward.loaded && wardLotsOn() ? ward.map : []);
  const lands = ward.loaded && wardLandsOn() ? ward.lands.slice() : [];
  const infra = [];
  wanted().forEach(entry => {
    const got = cache.get(entry.tenQH);
    if (!got) return;
    const off = { HT: isLayerHidden(entry.tenQH, LOT_LAYER.HT), QH: isLayerHidden(entry.tenQH, LOT_LAYER.QH) };
    got.parcels.forEach(p => {
      if (!p || !p.geometry || !p.id) return;
      const phase = p.phase === 'QH' ? 'QH' : 'HT';
      if (off[phase]) return;
      if (p.kind === 'DXF') {
        lands.push({ ...p, file: entry.tenQH, phase });
        return;
      }
      next.set(`${phase}|${p.id}`, { geometry: p.geometry, layer: p.layer || '', file: entry.tenQH });
      infra.push({ id: p.id, phase, layer: p.layer || '', area: p.area ?? null, geometry: p.geometry, file: entry.tenQH });
    });
  });
  state.cadParcels = next;
  state.landParcels = lands;
  state.projectInfraLots = infra;
  state.projectInfraFiles = new Set(infra.map(l => l.file));
}

function progress(done, total) {
  document.dispatchEvent(new CustomEvent(LOTS_PROGRESS_EVENT, { detail: { done, total } }));
}

// Đồ án ít lô tải trước để bản đồ có lô sớm; lần đồng bộ mới hơn (seq) thay lần cũ, chỉ lần mới nhất báo xong
export async function syncLots() {
  const token = ++seq;
  let total = 0;
  try {
    if (wantsWard()) await ensureWard();
    if (token !== seq) return;
    const pending = wanted().filter(e => !isFresh(e)).sort((a, b) => (Number(a.lands) || 0) - (Number(b.lands) || 0));
    total = pending.length;
    let done = 0;
    let painted = Date.now();
    if (total) progress(0, total);
    await pool(pending, LOAD_CONCURRENCY, async (entry) => {
      try { await loadEntry(entry); }
      catch (err) { console.warn(`Không tải lô đồ án «${entry.tenQH}»:`, err); }
      done += 1;
      if (token !== seq) return;
      progress(done, total);
      if (done < total && Date.now() - painted >= PAINT_EVERY_MS) {
        painted = Date.now();
        composeNow();
        onChange();
      }
    });
    if (token !== seq) return;
    composeNow();
    onChange();
  } finally {
    if (token === seq) progress(total, total);
  }
}

// "HT|<ID>" / "QH|<ID>" công trình đã có ranh lô: lô theo phường + file các đồ án tenQHs (không phụ thuộc lớp đang bật)
export async function lotKeysOf(tenQHs) {
  await ensureWard(true);
  const keys = new Set(ward.map.keys());
  const entries = state.projectCatalog.filter(p => p && !p.sheetOnly && tenQHs.includes(p.tenQH));
  await pool(entries, 3, async (entry) => {
    try {
      const row = await loadEntry(entry);
      row.parcels.forEach(p => {
        if (p && p.id && p.geometry && p.kind !== 'DXF') keys.add(`${p.phase === 'QH' ? 'QH' : 'HT'}|${p.id}`);
      });
    } catch (err) { console.warn(`Không tải lô đồ án «${entry.tenQH}»:`, err); }
  });
  return keys;
}

/**
 * Ranh lô công trình id theo thứ tự giai đoạn phases → { geometry, layer, file, phase } | null. Mỗi giai đoạn tìm lô đang vẽ,
 * file đồ án tenQH rồi lô theo phường; chỉ đọc bộ nhớ đệm / tải file, không đổi lớp đang vẽ.
 */
export async function infraLotOf(id, tenQH, phases = ['QH', 'HT']) {
  if (!id) return null;
  const entry = tenQH && state.projectCatalog.find(p => p && !p.sheetOnly && p.tenQH === tenQH);
  let row = null;
  let wardTried = false;
  for (const ph of phases) {
    const key = `${ph}|${id}`;
    if (state.cadParcels.has(key)) return { ...state.cadParcels.get(key), phase: ph };
    if (entry && !row) {
      row = await loadEntry(entry).catch(err => {
        console.warn(`Không tải lô đồ án «${entry.tenQH}»:`, err);
        return { parcels: [] };
      });
    }
    const p = row && row.parcels.find(x => x && x.id === id && x.kind !== 'DXF' && x.geometry && (x.phase === 'QH' ? 'QH' : 'HT') === ph);
    if (p) return { geometry: p.geometry, layer: p.layer || '', file: entry.tenQH, phase: ph };
    if (!wardTried) {
      wardTried = true;
      await ensureWard(true).catch(err => console.warn('Không tải lô theo phường:', err));
    }
    if (ward.map.has(key)) return { ...ward.map.get(key), phase: ph };
  }
  return null;
}

/**
 * Lô quy hoạch (giai đoạn QH) trong khung bbox [w, s, e, n]: file các đồ án có ranh tổng giao khung + lô QH theo phường.
 * Bỏ đồ án đang ẩn hoặc đã tắt lớp sử dụng đất QH; chỉ tải / đọc bộ nhớ đệm, không đổi lớp đang vẽ.
 * → { projects: [{ tenQH, bbox, lots }], wardLots }
 */
export async function planLotsIn(bbox) {
  const entries = state.projectCatalog.filter(p => p && p.tenQH && !p.sheetOnly && Array.isArray(p.bbox)
    && !state.hiddenProjects.has(p.tenQH) && !isLayerHidden(p.tenQH, LOT_LAYER.QH)
    && p.bbox[0] <= bbox[2] && p.bbox[2] >= bbox[0] && p.bbox[1] <= bbox[3] && p.bbox[3] >= bbox[1]);
  const projects = [];
  await pool(entries, 3, async (entry) => {
    try {
      const row = await loadEntry(entry);
      const lots = row.parcels.filter(p => p && p.geometry && p.phase === 'QH').map(p => ({ ...p, file: entry.tenQH }));
      if (lots.length) projects.push({ tenQH: entry.tenQH, bbox: entry.bbox, lots });
    } catch (err) { console.warn(`Không tải lô đồ án «${entry.tenQH}»:`, err); }
  });
  await ensureWard(true).catch(err => console.warn('Không tải lô theo phường:', err));
  const wardLots = [
    ...[...ward.map].filter(([k]) => k.startsWith('QH|')).map(([k, v]) => ({ ...v, id: k.slice(3), phase: 'QH' })),
    ...ward.lands.filter(p => p.phase === 'QH').map(p => ({ ...p, kind: 'DXF' }))
  ];
  return { projects, wardLots };
}

// Admin vừa sửa 1 lô đất: chép vào bản đã tải, đổi saved để lần đọc sau khớp danh mục (không tải lại file đồ án).
// Thay đối tượng lô mới để các bộ nhớ WeakMap theo lô (chỉ mục tìm lô, điểm neo) tính lại.
export function patchCachedLand(tenQH, land, saved) {
  const row = cache.get(tenQH);
  const i = row ? row.parcels.findIndex(p => p && p.kind === 'DXF' && p.id === land.id && (p.phase === 'QH' ? 'QH' : 'HT') === land.phase) : -1;
  if (i >= 0) {
    const next = { ...row.parcels[i], name: land.name, nhom: land.nhom };
    if (land.layer) next.layer = land.layer;
    if (land.geometry) Object.assign(next, { geometry: land.geometry, area: land.area, lat: land.lat, lng: land.lng });
    if (land.plan) next.plan = land.plan;
    else delete next.plan;
    row.parcels[i] = next;
  }
  if (row) row.saved = saved;
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry) entry.saved = saved;
  composeNow();
}

/** Admin vừa đổi loại công trình: lô INFRA mã id / id.N trong bộ nhớ đệm sang newId / newId.N, layer mới nếu có */
export function retypeCachedInfra(tenQH, { id, newId, layer }, saved) {
  const row = cache.get(tenQH);
  if (row) {
    row.parcels = row.parcels.map(p => {
      const s = p && p.kind === 'INFRA' ? String(p.id) : '';
      const sfx = s === id ? '' : (s.startsWith(`${id}.`) && /^\d+$/.test(s.slice(id.length + 1)) ? s.slice(id.length) : null);
      return sfx === null ? p : { ...p, id: `${newId}${sfx}`, ...(layer ? { layer } : {}) };
    });
    if (saved) row.saved = saved;
  }
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry && saved) entry.saved = saved;
  composeNow();
}

/** Admin vừa chuyển lô đất DXF (id + giai đoạn) thành công trình: thay bằng lô INFRA server trả về */
export function convertCachedLand(tenQH, { id, phase }, lot, saved) {
  const row = cache.get(tenQH);
  if (row) {
    row.parcels = row.parcels.map(p => (p && p.kind === 'DXF' && p.id === id && (p.phase === 'QH' ? 'QH' : 'HT') === phase ? lot : p));
    if (saved) row.saved = saved;
  }
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry && saved) entry.saved = saved;
  composeNow();
}

/** Gỡ lô Admin vừa xóa khỏi bộ nhớ đệm: DXF theo id + giai đoạn, INFRA mọi giai đoạn của id */
export function removeCachedLot(tenQH, { kind, id, phase }, saved) {
  const row = cache.get(tenQH);
  const hit = (p) => p && (kind === 'INFRA'
    ? p.kind === 'INFRA' && String(p.id) === id
    : p.kind === 'DXF' && p.id === id && (p.phase === 'QH' ? 'QH' : 'HT') === phase);
  if (row) {
    row.parcels = row.parcels.filter(p => !hit(p));
    if (saved) row.saved = saved;
  }
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry && saved) entry.saved = saved;
  composeNow();
}

/**
 * Các lớp chính của 1 đồ án theo PROJECT_LAYERS (tải file đồ án nếu chưa có):
 * [{ ...định nghĩa lớp, present, lands, infra, area, count, source }]
 */
export async function projectLayersOf(tenQH) {
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH && !p.sheetOnly);
  if (!entry) return [];
  const row = await loadEntry(entry);
  return PROJECT_LAYERS.map(def => {
    const out = { ...def, present: false, lands: 0, infra: 0, area: 0, count: 0, source: null };
    if (def.kind === 'lots') {
      row.parcels.forEach(p => {
        if (!p || !p.geometry || (p.phase === 'QH' ? 'QH' : 'HT') !== def.phase) return;
        if (p.kind === 'DXF') out.lands += 1;
        else out.infra += 1;
        out.area += Number(p.area) || 0;
      });
      out.count = out.lands + out.infra;
    } else if (def.kind === 'boundary') {
      out.count = entry.boundary ? 1 : 0;
      out.source = entry.boundary ? (entry.boundarySource === 'gis' ? 'gis' : 'auto') : null;
    }
    out.present = out.count > 0;
    return out;
  });
}

/** Lô (HT + QH) của đồ án đã tải (projectLayersOf tải trước); chưa tải → [] */
export function cachedLots(tenQH) {
  const row = cache.get(tenQH);
  return row ? row.parcels.filter(p => p && p.geometry) : [];
}

/** Gỡ lớp Admin vừa xóa khỏi bộ nhớ đệm; counts = { lands } mới của đồ án (lớp lô) */
export function removeCachedLayer(tenQH, key, saved, counts) {
  const def = PROJECT_LAYERS.find(d => d.key === key);
  const row = cache.get(tenQH);
  if (row && def) {
    if (def.kind === 'lots') row.parcels = row.parcels.filter(p => !(p && (p.phase === 'QH' ? 'QH' : 'HT') === def.phase));
    if (saved) row.saved = saved;
  }
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry) {
    if (saved) entry.saved = saved;
    if (counts && Number.isFinite(counts.lands)) entry.lands = counts.lands;
    if (def && def.kind === 'boundary') {
      entry.boundary = null;
      entry.boundarySource = null;
      state.projectAreas = state.projectAreas.filter(a => a.id !== tenQH);
    }
  }
  composeNow();
}

export function scheduleLots() {
  clearTimeout(timer);
  timer = setTimeout(() => { syncLots().catch(err => console.warn('Tải lô đồ án:', err)); }, 120);
}

export async function focusProject(tenQH) {
  force.add(tenQH);
  try { await syncLots(); }
  catch (err) { console.warn('Tải lô đồ án:', err); }
  finally { force.delete(tenQH); }
}

export async function loadCatalog() {
  const res = await fetch(geeApi('action=getProjectIndex'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  base = data.base || '';
  state.projectBase = base;
  state.projectCatalog = Array.isArray(data.projects) ? data.projects : [];
  state.projectAreas = state.projectCatalog.filter(p => p && p.boundary).map(p => ({
    id: p.tenQH,
    kind: 'PROJECT',
    ward: Array.isArray(p.wards) ? p.wards.join(', ') : '',
    infraCount: p.infra || 0,
    landCount: p.lands || 0,
    time: p.time || '',
    geometry: p.boundary
  }));
  const live = new Set(state.projectCatalog.map(p => p.tenQH));
  [...cache.keys()].forEach(name => {
    if (!live.has(name)) cache.delete(name);
    else {
      const entry = state.projectCatalog.find(p => p.tenQH === name);
      const prev = cache.get(name);
      if (prev && entry && (prev.saved !== (entry.saved || 0) || prev.legacy !== !!entry.legacy)) cache.delete(name);
    }
  });
  ward.loaded = false;
  ward.map = new Map();
  ward.lands = [];
}
