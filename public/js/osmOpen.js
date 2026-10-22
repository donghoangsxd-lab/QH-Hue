// Lớp OpenStreetMap: đường sắt và đường thủy nội địa. Công trình thể thao nằm trong mã 8-VH, không còn lớp riêng.
// Tải một lần qua api/gee.js (Overpass). Gán phường khi đã có ranh 40 phường xã.
import { geeApi } from './api.js';
import { state } from './state.js';
import { bareName } from './urbanStatus.js';
import { escapeHtml, fmtNum } from './utils.js';
import { clipOsmFeatures, countGroups } from './osmClip.js';
import { trackWork } from './loadProgress.js';

const $ = (id) => document.getElementById(id);
// Cùng mốc đường trục chính (CITY_PIE_MAX_ZOOM + 1): dưới mức này chỉ gợi ý phóng to, không vẽ nét.
const RAIL_MIN_ZOOM = 11;
const GROUPS = [
  { id: 'chk_osmRail', group: 'rail' },
  { id: 'chk_osmWater', group: 'water' }
];

let maps = [];
let raw = null;
let clipped = null;
let clippedSource = null;
let indexed = null;
let indexedSource = null;
let promise = null;
let layers = [];
let loadError = '';
let waitTimer = null;

function wardAt(lat, lng) {
  if (typeof turf === 'undefined' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let pt = null;
  try { pt = turf.point([lng, lat]); } catch (e) { return null; }
  for (const w of state.wardLabelsList || []) {
    if (!w.geometry) continue;
    try {
      if (turf.booleanPointInPolygon(pt, turf.feature(w.geometry))) return w.name;
    } catch (e) { /* ranh lỗi */ }
  }
  return null;
}

function boundariesReady() {
  return (state.wardLabelsList || []).some(w => w.geometry);
}

function hueFeatures() {
  if (!raw || !boundariesReady()) return null;
  if (clipped && clippedSource === state.wardLabelsList) return clipped;
  const geometries = (state.wardLabelsList || []).map(w => w.geometry).filter(Boolean);
  clipped = clipOsmFeatures(raw, geometries);
  clippedSource = state.wardLabelsList;
  indexed = null;
  return clipped;
}

function indexRows() {
  const feats = hueFeatures();
  if (!feats) return null;
  if (indexed && indexedSource === state.wardLabelsList) return indexed;
  indexed = feats.map(f => {
    const p = f.properties || {};
    return { ...p, ward: wardAt(Number(p.lat), Number(p.lng)) };
  });
  indexedSource = state.wardLabelsList;
  return indexed;
}

/** Sông, kênh đang dùng cho lớp đường thủy: phần trong ranh khi đã có ranh, không thì cả khung tải. */
export function osmWaterInput() {
  return hueFeatures() || raw;
}

export function loadOsmOpen() {
  if (!promise) {
    promise = trackWork('Đường sắt, đường thủy', fetch(geeApi('action=getOsmOpen')))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error || !d.geojson || !Array.isArray(d.geojson.features)) {
          const msg = d && d.rawDataList ? 'Máy chủ chưa hỗ trợ lớp OpenStreetMap' : ((d && d.message) || `HTTP ${r.status}`);
          throw new Error(msg);
        }
        raw = d.geojson.features;
        clipped = null;
        indexed = null;
        return d;
      })
      .catch(err => {
        loadError = err.message || String(err);
        promise = null;
        throw err;
      });
  }
  return promise;
}

export function osmTransitReady() {
  return !!indexRows();
}

export function transitNote(names) {
  const rows = indexRows();
  if (!rows) return loadError || '';
  const want = names ? new Set(names.map(bareName)) : null;
  const inside = (r) => !want || want.has(bareName(r.ward));
  const stops = rows.filter(r => r.group === 'railStop' && inside(r)).length;
  const ferry = rows.filter(r => r.group === 'ferry' && inside(r)).length;
  const km = (group) => rows.filter(r => r.group === group).reduce((s, r) => s + (Number(r.lengthKm) || 0), 0);
  return `OSM (không tính vào % phủ): ${stops} ga trong phạm vi, ${fmtNum(Math.round(km('rail') * 10) / 10)} km đường sắt trong ranh 40 phường xã, ${ferry} bến thủy trong phạm vi, ${fmtNum(Math.round(km('water') * 10) / 10)} km sông/kênh trong ranh 40 phường xã. OSM chưa đủ và chưa có đường sắt đô thị.`;
}

function groupOn(id) {
  return !!$(id)?.checked;
}

function anyOn() {
  return GROUPS.some(g => groupOn(g.id));
}

const RAIL_BASE = { color: '#1e293b', weight: 5.5, opacity: 1 };
const RAIL_TIES = { color: '#f8fafc', weight: 2, opacity: 0.95, dashArray: '7 7' };

function popupOf(f, layer) {
  const p = f.properties || {};
  const extra = p.lengthKm > 0 ? `<div>${fmtNum(p.lengthKm)} km</div>` : '';
  layer.bindPopup(`<b>${escapeHtml(p.name || '')}</b><div>${escapeHtml(p.kind || '')}</div>${extra}<div>OpenStreetMap, trong ranh 40 phường xã</div>`);
}

function addLayer(features, opts) {
  if (!features.length) return;
  maps.forEach(m => {
    const layer = L.geoJSON({ type: 'FeatureCollection', features }, opts);
    layer.addTo(m);
    layers.push(layer);
  });
}

let lastRailOk = null;

function draw() {
  layers.forEach(layer => maps.forEach(m => { if (m.hasLayer(layer)) m.removeLayer(layer); }));
  layers = [];
  lastRailOk = railZoomOk();
  const feats = hueFeatures();
  paintRail();
  if (!feats || !anyOn()) return;
  const rail = groupOn('chk_osmRail');
  const water = groupOn('chk_osmWater');
  const pick = (group) => feats.filter(f => f.properties && f.properties.group === group);
  if (water) {
    addLayer(pick('water').concat(pick('ferry')), {
      style: () => ({ color: '#0284c7', weight: 2.5 }),
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
        radius: 5, color: '#0284c7', weight: 2, fillColor: '#fff', fillOpacity: 1
      }),
      onEachFeature: popupOf
    });
  }
  if (!rail) return;
  if (!railZoomOk()) return;
  const lines = pick('rail');
  addLayer(lines, { style: () => ({ ...RAIL_BASE, interactive: false }) });
  addLayer(lines, { style: () => RAIL_TIES, onEachFeature: popupOf });
  addLayer(pick('railStop'), {
    pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
      radius: 5, color: '#1e293b', weight: 2, fillColor: '#fff', fillOpacity: 1
    }),
    onEachFeature: popupOf
  });
}

function railZoomOk() {
  const z = maps.reduce((best, m) => Math.max(best, m?.getZoom?.() || 0), 0);
  return z >= RAIL_MIN_ZOOM;
}

function paintRailHint() {
  const hint = $('railHint');
  if (!hint) return;
  const on = groupOn('chk_osmRail');
  if (!on) { hint.textContent = ''; return; }
  hint.textContent = railZoomOk() ? '' : '(phóng tới mức 11)';
}

function paintRail() {
  const legend = $('railLegend');
  const on = groupOn('chk_osmRail');
  if (legend) legend.style.display = on ? '' : 'none';
  paintRailHint();
  const st = $('railStatus');
  if (!st) return;
  st.classList.remove('is-warn');
  if (!on) { st.textContent = ''; return; }
  if (loadError && !raw) { st.textContent = 'Chưa tải được đường sắt.'; st.classList.add('is-warn'); return; }
  if (!hueFeatures()) { st.textContent = raw ? 'Đang cắt theo ranh phường, xã…' : 'Đang tải đường sắt…'; return; }
  st.textContent = '';
}

function paintBox(data) {
  const box = $('osmOpenBox');
  const legend = $('osmOpenLegend');
  const stats = $('osmOpenStats');
  const water = groupOn('chk_osmWater');
  paintRail();
  if (box) box.style.display = water ? '' : 'none';
  if (!water) return;
  if (legend) {
    legend.innerHTML = '<span><i class="sat-swatch" style="background:#0284c7"></i>Sông, kênh, bến thủy</span>';
  }
  if (!stats) return;
  if (!data) {
    stats.innerHTML = `<div class="flood-muted">${escapeHtml(loadError || 'Đang tải OpenStreetMap…')}</div>`;
    return;
  }
  const feats = hueFeatures();
  if (!feats) {
    stats.innerHTML = '<div class="flood-muted">Đang cắt theo ranh 40 phường, xã…</div>';
    return;
  }
  const c = countGroups(feats);
  stats.innerHTML = `<div class="flood-wards">
      <span>Sông, kênh <b>${fmtNum(c.water || 0)}</b></span>
      <span>Bến thủy <b>${fmtNum(c.ferry || 0)}</b></span>
    </div>
    <div class="flood-muted">${escapeHtml(data.note || '')} Số lượng và chiều dài chỉ tính phần nằm trong ranh 40 phường, xã, không lấy khung tìm rộng. Nguồn: ${escapeHtml(data.source || 'OpenStreetMap')}, ${escapeHtml(data.via || 'Overpass')}${data.at ? `, tải ${escapeHtml(data.at.slice(0, 10))}` : ''}.</div>`;
}

function watchBoundaries(refresh) {
  if (waitTimer || !anyOn() || boundariesReady()) return;
  waitTimer = setInterval(() => {
    if (!anyOn() || boundariesReady()) {
      clearInterval(waitTimer);
      waitTimer = null;
      if (anyOn() && boundariesReady()) refresh();
    }
  }, 400);
}

export function initOsmOpen(map, planMap) {
  maps = [map, planMap].filter(Boolean);
  if (!maps.length) return;
  const refresh = () => {
    paintBox(null);
    if (!anyOn()) {
      if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
      draw();
      return;
    }
    loadOsmOpen().then(d => { paintBox(d); draw(); watchBoundaries(refresh); }).catch(err => {
      loadError = err.message || String(err);
      paintBox(null);
    });
  };
  GROUPS.forEach(g => $(g.id)?.addEventListener('change', refresh));
  maps.forEach(m => m.on('zoomend', () => {
    const ok = railZoomOk();
    paintRailHint();
    if (ok === lastRailOk) return;
    if (groupOn('chk_osmRail')) draw();
    else lastRailOk = ok;
  }));
  paintRailHint();
}
