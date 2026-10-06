// Lớp Đồ án quy hoạch (panel Lớp dữ liệu): mỗi đồ án (Ten_QH) bật/tắt riêng, phóng tới, Admin xóa toàn bộ đồ án.
// Zoom < PARCEL_MIN_ZOOM chỉ vẽ ranh tổng đồ án; từ ngưỡng đó vẽ ranh lô (mapEngine.js) và bỏ ranh tổng.
import { state } from './state.js';
import { map, PARCEL_MIN_ZOOM, refreshProjectLots, focusProjectLots, loadCadParcels } from './mapEngine.js';
import { planMap, onCompareChange } from './planMap.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, ico } from './utils.js';

const HIDDEN_KEY = 'qh_hidden_projects';
// Ranh tổng = hợp các lô nới GAP_M rồi co lại GAP_M: lấp đường / khe giữa các lô rộng ≤ 2·GAP_M
const GAP_M = 15;
// Khớp CAD_GEOJSON_MAX_CHARS (api/gee.js) và giới hạn ô Sheet
const BOUNDARY_MAX_CHARS = 45000;
// Quá số lô này thì hợp ranh quá chậm trên trình duyệt → dùng bao lồi
const EXACT_MAX_LOTS = 4000;
const OUTLINE_STYLE = { color: '#e879f9', weight: 2.4, opacity: 0.95, dashArray: '8 5', fillColor: '#e879f9', fillOpacity: 0.05 };

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let projects = [];
let onDeleted = null;
let busy = null;
let belowZoom = null;
const outlineGroups = new Map();
const fallbackCache = new Map();

// ============================ RANH TỔNG ĐỒ ÁN ============================

const round6 = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round6));

function exteriorOnly(g) {
  if (!g) return null;
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: [g.coordinates[0]] };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(p => [p[0]]) };
  return null;
}

function mergedOutline(list) {
  let parts = list.map(g => {
    const lot = turf.simplify(turf.feature(g), { tolerance: 0.00001 });
    return turf.buffer(lot, GAP_M, { units: 'meters', steps: 2 });
  }).filter(f => f && f.geometry);
  while (parts.length > 1) {
    const next = [];
    for (let i = 0; i < parts.length; i += 2) {
      next.push(parts[i + 1] ? (turf.union(parts[i], parts[i + 1]) || parts[i]) : parts[i]);
    }
    parts = next;
  }
  if (!parts.length) return null;
  const shrunk = turf.buffer(parts[0], -GAP_M, { units: 'meters', steps: 2 });
  return exteriorOnly((shrunk && shrunk.geometry) || parts[0].geometry);
}

function hullOf(features) {
  const hull = features.length ? turf.convex(turf.featureCollection(features)) : null;
  return hull ? hull.geometry : null;
}

// Đơn giản hóa dần tới khi vừa 1 ô Sheet; vẫn quá thì lấy bao lồi
function fitSize(geom) {
  for (const tol of [0, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001]) {
    const g = tol ? turf.simplify(turf.feature(geom), { tolerance: tol }).geometry : geom;
    const out = { type: g.type, coordinates: round6(g.coordinates) };
    if (JSON.stringify(out).length <= BOUNDARY_MAX_CHARS) return out;
  }
  const hull = hullOf([turf.feature(geom)]);
  return hull ? { type: hull.type, coordinates: round6(hull.coordinates) } : null;
}

/** Ranh tổng đồ án từ ranh các lô (GeoJSON Polygon / MultiPolygon); không dựng được → null */
export function projectBoundary(geometries) {
  if (typeof turf === 'undefined') return null;
  const list = (geometries || []).filter(g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
  if (!list.length) return null;
  let shape = null;
  if (list.length <= EXACT_MAX_LOTS) {
    try { shape = mergedOutline(list); } catch (e) { console.warn('Không hợp được ranh lô đồ án, dùng bao lồi:', e); }
  }
  try {
    if (!shape) shape = hullOf(list.map(g => turf.feature(g)));
    return shape ? fitSize(shape) : null;
  } catch (e) {
    console.warn('Không dựng được ranh tổng đồ án:', e);
    return null;
  }
}

// ============================ DANH SÁCH ĐỒ ÁN ============================

function loadHidden() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    if (Array.isArray(saved)) state.hiddenProjects = new Set(saved.map(String));
  } catch (e) { /* chế độ riêng tư */ }
}

function saveHidden() {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hiddenProjects])); } catch (e) { /* chế độ riêng tư */ }
}

// Danh mục lấy từ index (không cần đã tải ranh từng lô). infra/lands là số đếm { size }.
// Đồ án chưa có ranh tổng: ranh tạm dựng từ điểm công trình Ten_QH (đã có trong rawDataList)
function collectProjects() {
  const pointsOf = new Map();
  [...state.rawDataList, ...state.planDataList].forEach(it => {
    const name = String(it.tenQH || '').trim();
    const lat = Number(it.lat), lng = Number(it.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!pointsOf.has(name)) pointsOf.set(name, []);
    pointsOf.get(name).push([lng, lat]);
  });
  return state.projectCatalog.map(p => ({
    name: p.tenQH,
    slug: p.slug || '',
    legacy: !!p.legacy,
    infra: { size: Number(p.infra) || 0 },
    lands: { size: Number(p.lands) || 0 },
    shapes: [],
    points: p.boundary ? [] : (pointsOf.get(p.tenQH) || []),
    area: p.boundary ? {
      id: p.tenQH,
      geometry: p.boundary,
      ward: Array.isArray(p.wards) ? p.wards.join(', ') : '',
      time: p.time || '',
      infraCount: Number(p.infra) || 0,
      landCount: Number(p.lands) || 0
    } : null
  })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// Đồ án nhập trước khi có tab DS_DoAn: ranh tạm = bao lồi các lô / điểm (nhanh), nhập lại file để có ranh đúng
function outlineOf(p) {
  if (p.area) return p.area.geometry;
  if (typeof turf === 'undefined') return null;
  const key = `${p.name}|${p.shapes.length}|${p.points.length}`;
  if (fallbackCache.has(key)) return fallbackCache.get(key);
  let geom = null;
  try {
    geom = hullOf([...p.shapes.map(g => turf.feature(g)), ...p.points.map(c => turf.point(c))]);
  } catch (e) { geom = null; }
  fallbackCache.set(key, geom);
  return geom;
}

function boundsOf(p) {
  const geom = outlineOf(p);
  if (geom) return L.geoJSON(geom).getBounds();
  if (p.points.length) return L.latLngBounds(p.points.map(([lng, lat]) => [lat, lng]));
  return null;
}

function zoomTo(p) {
  const b = boundsOf(p);
  if (!b || !b.isValid() || !map) return;
  map.fitBounds(b.pad(0.1), { maxZoom: PARCEL_MIN_ZOOM + 1 });
  focusProjectLots(p.name);
}

function metaText(p) {
  const parts = [`${fmtNum(p.infra.size)} CT`, `${fmtNum(p.lands.size)} lô đất`];
  if (p.area && p.area.time) parts.push(p.area.time.split(' ')[0]);
  return parts.join(' · ');
}

function renderList() {
  const box = $('projectList');
  const count = $('projectCount');
  if (count) count.textContent = projects.length ? `${projects.length} đồ án` : 'chưa có';
  if (!box) return;
  box.hidden = !state.showProjects || !projects.length;
  if (box.hidden) { box.innerHTML = ''; return; }
  const admin = isAdmin();
  const legacyN = projects.filter(p => p.legacy).length;
  const migrating = busy === '__migrate__';
  const migrateBtn = admin && legacyN
    ? `<button type="button" class="project-migrate" data-migrate ${migrating || busy ? ' disabled' : ''}>${migrating ? 'Đang chuyển…' : `Chuyển ${legacyN} đồ án cũ lên bucket`}</button>`
    : '';
  box.innerHTML = migrateBtn + projects.map((p, idx) => {
    const on = !state.hiddenProjects.has(p.name);
    const deleting = busy === p.name;
    const tempNote = p.area ? '' : ' · ranh tạm (bao lồi) — nhập lại file để có ranh đúng';
    const where = p.legacy ? 'còn ở file cad_parcels' : 'file riêng trên bucket';
    return `<div class="project-row${on ? '' : ' is-off'}">
      <label class="project-name" title="${escapeHtml(p.name)}${p.area?.ward ? ` — ${escapeHtml(p.area.ward)}` : ''}">
        <input type="checkbox" data-project="${idx}"${on ? ' checked' : ''}><span>${escapeHtml(p.name)}</span></label>
      <small class="project-meta" title="Số đếm theo danh mục đồ án (${where})${tempNote}">${metaText(p)}${p.area ? '' : ' *'}${p.legacy ? ' · cũ' : ''}</small>
      <button type="button" class="project-btn" data-zoom="${idx}" title="Phóng tới đồ án" aria-label="Phóng tới đồ án">${ico('locate')}</button>
      ${admin ? `<button type="button" class="project-btn danger" data-del="${idx}" title="Xóa toàn bộ đồ án" aria-label="Xóa đồ án"${busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
    </div>`;
  }).join('');
}

// ============================ VẼ RANH TỔNG ============================

function drawOutlinesOn(m, list) {
  const old = outlineGroups.get(m);
  if (old) {
    old.clearLayers();
    m.removeLayer(old);
    outlineGroups.delete(m);
  }
  if (!list.length) return;
  const group = L.featureGroup();
  list.forEach(p => {
    const geom = outlineOf(p);
    if (!geom) return;
    const shape = L.geoJSON(geom, {
      style: p.area ? OUTLINE_STYLE : { ...OUTLINE_STYLE, dashArray: '2 6' },
      bubblingMouseEvents: false
    });
    shape.bindTooltip(escapeHtml(p.name), { sticky: true, direction: 'top', className: 'dot-tip' });
    shape.on('click', () => {
      if (state.isPickMode || state.activeMeasureType || state.adminDrawMode || state.sketchTool) return;
      zoomTo(p);
    });
    group.addLayer(shape);
  });
  group.addTo(m);
  outlineGroups.set(m, group);
}

function redrawOutlines() {
  const below = !!map && map.getZoom() < PARCEL_MIN_ZOOM;
  const list = state.showProjects && below ? projects.filter(p => !state.hiddenProjects.has(p.name)) : [];
  if (map) drawOutlinesOn(map, list);
  if (planMap) drawOutlinesOn(planMap, list);
}

function refreshAll() {
  redrawOutlines();
  refreshProjectLots();
  renderList();
}

function rebuild() {
  projects = collectProjects();
  const names = new Set(projects.map(p => p.name));
  [...fallbackCache.keys()].forEach(k => { if (!names.has(k.split('|')[0])) fallbackCache.delete(k); });
  redrawOutlines();
  renderList();
}

// ============================ XÓA ĐỒ ÁN ============================

async function deleteProject(p) {
  if (!isAdmin() || busy) return;
  const typed = prompt(`XÓA TOÀN BỘ ĐỒ ÁN «${p.name}»:\n`
    + `• ${p.infra.size} công trình hạ tầng có Ten_QH = đồ án (kể cả công trình có từ trước đã gán vào đồ án)\n`
    + `• ${p.lands.size} lô đất của đồ án (file trên bucket${p.legacy ? ' / tab DXF cũ' : ''})\n`
    + '• ranh lô trên CAD_Polygon, dòng danh mục DS_DoAn và file projects của đồ án\n\n'
    + 'Không hoàn tác được. Gõ đúng tên đồ án để xác nhận:');
  if (typed === null) return;
  if (typed.trim() !== p.name) { alert('Tên đồ án không khớp, chưa xóa.'); return; }
  busy = p.name;
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=deleteProject'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ project: p.name })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    state.hiddenProjects.delete(p.name);
    saveHidden();
    alert(`Đã xóa đồ án «${p.name}»: ${data.infra} dòng hạ tầng, ${data.lands} lô đất, ${data.polygons} ranh CAD_Polygon.`);
    busy = null;
    if (onDeleted) await onDeleted();
  } catch (err) {
    alert(`Không xóa được đồ án: ${err.message}`);
  } finally {
    busy = null;
    renderList();
  }
}

async function migrateLegacy() {
  if (!isAdmin() || busy) return;
  const n = projects.filter(p => p.legacy).length;
  if (!n) return;
  if (!confirm(`Chuyển ${n} đồ án còn trong cad_parcels.json sang file riêng trên bucket?\n\nNên bật Object versioning của bucket trước. Trong lúc chuyển, bản đồ vẫn đọc dữ liệu cũ.`)) return;
  busy = '__migrate__';
  renderList();
  try {
    let cursor = 0;
    let total = 1;
    let last = {};
    while (cursor < total) {
      const prev = cursor;
      const res = await fetch(geeApi('action=migrateProjects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
        body: JSON.stringify({ cursor })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) signOutAdmin();
      if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
      cursor = Number(data.cursor) || 0;
      total = Number(data.total) || 0;
      last = data;
      if (data.done) break;
      if (cursor <= prev) throw new Error('Máy chủ không chuyển tiếp được');
    }
    alert(`Đã chuyển ${last.projects != null ? last.projects : n} đồ án lên bucket${last.wardParcels != null ? `. Ranh lô theo phường còn ${last.wardParcels}` : ''}.`);
    await loadCadParcels();
    rebuild();
  } catch (err) {
    alert(`Chưa chuyển xong: ${err.message}. Bấm lại để chuyển tiếp.`);
  } finally {
    busy = null;
    renderList();
  }
}

// ============================ KHỞI TẠO ============================

/** opts.onDeleted: gọi sau khi xóa đồ án để tải lại dữ liệu bản đồ */
export function initProjectLayer(opts = {}) {
  onDeleted = opts.onDeleted || null;
  loadHidden();
  const master = $('chk_projects');
  if (master) {
    state.showProjects = master.checked;
    master.addEventListener('change', () => {
      state.showProjects = master.checked;
      refreshAll();
    });
  }
  $('projectList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-project]');
    const p = box && projects[Number(box.dataset.project)];
    if (!p) return;
    if (box.checked) state.hiddenProjects.delete(p.name);
    else state.hiddenProjects.add(p.name);
    saveHidden();
    refreshAll();
  });
  $('projectList')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-migrate]')) { migrateLegacy(); return; }
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) { const p = projects[Number(zoom.dataset.zoom)]; if (p) zoomTo(p); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const p = projects[Number(del.dataset.del)]; if (p) deleteProject(p); }
  });
  document.addEventListener('cadparcels:loaded', rebuild);
  document.addEventListener('auth:change', renderList);
  map?.on('zoomend', () => {
    const below = map.getZoom() < PARCEL_MIN_ZOOM;
    if (below === belowZoom) return;
    belowZoom = below;
    if (!state.showProjects) return;
    redrawOutlines();
    refreshProjectLots();
  });
  onCompareChange(redrawOutlines);
  belowZoom = map ? map.getZoom() < PARCEL_MIN_ZOOM : null;
  rebuild();
}
