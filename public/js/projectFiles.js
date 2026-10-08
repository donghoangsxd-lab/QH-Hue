// Tải ranh lô theo đồ án: mở bản đồ chỉ có danh mục. File một đồ án tải khi zoom ≥ ngưỡng lô và ranh tổng giao khung nhìn,
// khi bật ranh lô công trình, khi bấm phóng tới, hoặc khi bật lớp lô đã lưu (showLand).
// Đồ án thư mục (dir) đọc hien-trang.json + su-dung-dat.json + diem-chuc-nang.json. Đồ án file gộp cũ đọc projects/<slug>.json.
// Đồ án chưa chuyển đọc qua API. URL bucket do máy chủ trả về (?v= phiên bản trong danh mục).
import { state } from './state.js';
import { geeApi } from './api.js';

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
  return state.projectCatalog.filter(p => {
    if (!p || !p.tenQH || p.sheetOnly) return false;
    if (force.has(p.tenQH)) return state.showLand || !state.hiddenProjects.has(p.tenQH);
    if (!layerOn) return false;
    if (!state.showLand && state.showProjects && state.hiddenProjects.has(p.tenQH)) return false;
    if (!p.bbox) return !!state.showLand;
    return intersects(p.bbox, bounds);
  });
}

// Lô công trình theo phường: theo nút Ranh lô / lớp Đồ án, từ ngưỡng zoom
function wardLotsOn() {
  const map = getMap();
  return !!map && parcelLayerOn(map.getZoom());
}

// Lô đất cũ chưa gắn đồ án: như lô đất đồ án (showLand mọi zoom, lớp Đồ án từ ngưỡng zoom)
function wardLandsOn() {
  const map = getMap();
  if (!map) return false;
  return state.showLand || (state.showProjects && map.getZoom() >= minZoom);
}

function wantsWard() {
  return wardLotsOn() || wardLandsOn();
}

// Lớp dữ liệu chính của đồ án, mỗi lớp = 1 file projects/<slug>/<key>.json. 3 lớp QH nhập từ bộ shapefile
// (vùng sử dụng đất, điểm chức năng, ranh giới) + lớp hiện trạng (file HT-). Lớp mới (cấp điện, cấp nước…)
// thêm 1 dòng ở đây và ở LAYER_ROLES (services/projectStore.js).
export const PROJECT_LAYERS = [
  { key: 'su-dung-dat', phase: 'QH', kind: 'lots', label: 'Sử dụng đất quy hoạch', color: '#fb923c' },
  { key: 'diem-chuc-nang', phase: 'QH', kind: 'points', label: 'Điểm chức năng', color: '#facc15' },
  { key: 'ranh-gioi', phase: 'QH', kind: 'boundary', label: 'Ranh giới quy hoạch', color: '#e879f9' },
  { key: 'hien-trang', phase: 'HT', kind: 'lots', label: 'Sử dụng đất hiện trạng', color: '#22d3ee' }
];
const LOT_LAYER = { HT: 'hien-trang', QH: 'su-dung-dat' };

export const layerKey = (tenQH, key) => `${tenQH}|${key}`;
export const isLayerHidden = (tenQH, key) => state.hiddenProjectLayers.has(layerKey(tenQH, key));

async function fetchRole(entry, role) {
  const res = await fetch(`${base}${entry.slug}/${role}.json?v=${entry.saved || 0}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDir(entry) {
  const [ht, qh, pts] = await Promise.all([
    fetchRole(entry, LOT_LAYER.HT),
    fetchRole(entry, LOT_LAYER.QH),
    fetchRole(entry, 'diem-chuc-nang').catch(err => { console.warn(`Không đọc điểm chức năng «${entry.tenQH}»:`, err); return null; })
  ]);
  return {
    parcels: [...((ht && ht.parcels) || []), ...((qh && qh.parcels) || [])],
    points: (pts && Array.isArray(pts.points)) ? pts.points : []
  };
}

async function loadEntry(entry) {
  const prev = cache.get(entry.tenQH);
  if (prev && prev.saved === (entry.saved || 0) && prev.legacy === !!entry.legacy && prev.parcels) return prev;
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
  const row = { saved: entry.saved || 0, legacy: !!entry.legacy, parcels: data.parcels || [], points: data.points || [] };
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
  const points = [];
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
    if (got.points && got.points.length && !isLayerHidden(entry.tenQH, 'diem-chuc-nang')) {
      got.points.forEach(pt => points.push({ name: pt.name || '', layer: pt.layer || '', lat: pt.lat, lng: pt.lng, file: entry.tenQH }));
    }
  });
  state.cadParcels = next;
  state.landParcels = lands;
  state.projectPoints = points;
  state.projectInfraLots = infra;
  state.projectInfraFiles = new Set(infra.map(l => l.file));
}

export async function syncLots() {
  const token = ++seq;
  if (wantsWard()) await ensureWard();
  if (token !== seq) return;
  const list = wanted();
  await pool(list, 3, async (entry) => {
    try { await loadEntry(entry); }
    catch (err) { console.warn(`Không tải lô đồ án «${entry.tenQH}»:`, err); }
  });
  if (token !== seq) return;
  composeNow();
  onChange();
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

// Admin vừa sửa 1 lô đất: chép vào bản đã tải, đổi saved để lần đọc sau khớp danh mục (không tải lại file đồ án)
export function patchCachedLand(tenQH, land, saved) {
  const row = cache.get(tenQH);
  const hit = row && row.parcels.find(p => p && p.kind === 'DXF' && p.id === land.id && (p.phase === 'QH' ? 'QH' : 'HT') === land.phase);
  if (hit) {
    hit.name = land.name;
    hit.nhom = land.nhom;
    if (land.plan) hit.plan = land.plan;
    else delete hit.plan;
  }
  if (row) row.saved = saved;
  const entry = state.projectCatalog.find(p => p && p.tenQH === tenQH);
  if (entry) entry.saved = saved;
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
    } else if (def.kind === 'points') {
      out.count = (row.points || []).length;
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
    if (def.kind === 'points') row.points = [];
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
