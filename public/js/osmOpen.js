// Lớp OpenStreetMap cho tiêu chí phân loại đô thị: thể thao (tách khỏi văn hóa), đường sắt, đường thủy nội địa.
// Tải một lần qua api/gee.js (Overpass). Gán phường khi đã có ranh 40 phường xã.
import { geeApi } from './api.js';
import { state } from './state.js';
import { bareName } from './urbanStatus.js';
import { escapeHtml, fmtNum } from './utils.js';

const $ = (id) => document.getElementById(id);
const GROUPS = [
  { id: 'chk_osmSport', group: 'sport', color: '#ea580c' },
  { id: 'chk_osmRail', group: 'rail', color: '#334155' },
  { id: 'chk_osmWater', group: 'water', color: '#0284c7' }
];

let maps = [];
let raw = null;
let indexed = null;
let indexedSource = null;
let promise = null;
let layers = [];
let loadError = '';

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

function indexRows() {
  if (!raw || !boundariesReady()) return null;
  if (indexed && indexedSource === state.wardLabelsList) return indexed;
  indexed = raw.map(f => {
    const p = f.properties || {};
    return { ...p, ward: wardAt(Number(p.lat), Number(p.lng)) };
  });
  indexedSource = state.wardLabelsList;
  return indexed;
}

export function loadOsmOpen() {
  if (!promise) {
    promise = fetch(geeApi('action=getOsmOpen'))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error || !d.geojson || !Array.isArray(d.geojson.features)) {
          const msg = d && d.rawDataList ? 'Máy chủ chưa hỗ trợ lớp OpenStreetMap' : ((d && d.message) || `HTTP ${r.status}`);
          throw new Error(msg);
        }
        raw = d.geojson.features;
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

function rowsOf(group) {
  const rows = indexRows();
  if (!rows) return null;
  return rows.filter(r => r.group === group || (group === 'rail' && r.group === 'railStop') || (group === 'water' && r.group === 'ferry'));
}

export function osmSportsReady() {
  return !!indexRows();
}

export function osmLoadNote() {
  return loadError;
}

export function sportsInWards(names) {
  const rows = rowsOf('sport');
  if (!rows) return null;
  const want = new Set((names || []).map(bareName));
  return rows.filter(r => r.group === 'sport' && want.has(bareName(r.ward))).length;
}

export function transitNote(names) {
  const rows = indexRows();
  if (!rows) return loadError || '';
  const want = names ? new Set(names.map(bareName)) : null;
  const inside = (r) => !want || want.has(bareName(r.ward));
  const stops = rows.filter(r => r.group === 'railStop' && inside(r)).length;
  const ferry = rows.filter(r => r.group === 'ferry' && inside(r)).length;
  const km = (group) => rows.filter(r => r.group === group).reduce((s, r) => s + (Number(r.lengthKm) || 0), 0);
  return `OSM (không tính vào % phủ): ${stops} ga trong phạm vi, ${fmtNum(Math.round(km('rail') * 10) / 10)} km đường sắt toàn thành phố, ${ferry} bến thủy trong phạm vi, ${fmtNum(Math.round(km('water') * 10) / 10)} km sông/kênh. OSM chưa đủ và chưa có đường sắt đô thị.`;
}

function anyOn() {
  return GROUPS.some(g => $(g.id)?.checked);
}

function draw() {
  layers.forEach(layer => maps.forEach(m => { if (m.hasLayer(layer)) m.removeLayer(layer); }));
  layers = [];
  if (!raw || !anyOn()) return;
  const on = new Set(GROUPS.filter(g => $(g.id)?.checked).map(g => g.group));
  const features = raw.filter(f => {
    const g = f.properties && f.properties.group;
    if (g === 'railStop') return on.has('rail');
    if (g === 'ferry') return on.has('water');
    return on.has(g);
  });
  const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: (f) => {
      const g = f.properties.group;
      const color = g === 'water' || g === 'ferry' ? '#0284c7' : (g === 'rail' || g === 'railStop' ? '#334155' : '#ea580c');
      return { color, weight: g === 'rail' || g === 'water' ? 2.5 : 1.5, fillColor: color, fillOpacity: 0.35 };
    },
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 5,
      color: f.properties.group === 'ferry' ? '#0284c7' : (f.properties.group === 'railStop' ? '#334155' : '#ea580c'),
      weight: 2,
      fillColor: '#fff',
      fillOpacity: 1
    }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      const extra = p.lengthKm > 0 ? `<div>${fmtNum(p.lengthKm)} km</div>` : '';
      layer.bindPopup(`<b>${escapeHtml(p.name || '')}</b><div>${escapeHtml(p.kind || '')}</div>${extra}<div>OpenStreetMap</div>`);
    }
  });
  maps.forEach(m => layer.addTo(m));
  layers = [layer];
}

function paintBox(data) {
  const box = $('osmOpenBox');
  const legend = $('osmOpenLegend');
  const stats = $('osmOpenStats');
  if (box) box.style.display = anyOn() ? '' : 'none';
  if (!anyOn()) return;
  if (legend) {
    legend.innerHTML = `<span><i class="sat-swatch" style="background:#ea580c"></i>Thể thao</span>
      <span><i class="sat-swatch" style="background:#334155"></i>Đường sắt, ga</span>
      <span><i class="sat-swatch" style="background:#0284c7"></i>Sông, kênh, bến thủy</span>`;
  }
  if (!stats) return;
  if (!data) {
    stats.innerHTML = `<div class="flood-muted">${escapeHtml(loadError || 'Đang tải OpenStreetMap…')}</div>`;
    return;
  }
  const c = data.counts || {};
  stats.innerHTML = `<div class="flood-wards">
      <span>Thể thao <b>${fmtNum(c.sport || 0)}</b></span>
      <span>Đoạn đường sắt <b>${fmtNum(c.rail || 0)}</b></span>
      <span>Ga <b>${fmtNum(c.railStop || 0)}</b></span>
      <span>Sông, kênh <b>${fmtNum(c.water || 0)}</b></span>
      <span>Bến thủy <b>${fmtNum(c.ferry || 0)}</b></span>
    </div>
    <div class="flood-muted">${escapeHtml(data.note || '')} Nguồn: ${escapeHtml(data.source || 'OpenStreetMap')}, ${escapeHtml(data.via || 'Overpass')}${data.at ? `, tải ${escapeHtml(data.at.slice(0, 10))}` : ''}.</div>`;
}

export function initOsmOpen(map, planMap) {
  maps = [map, planMap].filter(Boolean);
  if (!maps.length) return;
  const refresh = () => {
    paintBox(null);
    if (!anyOn()) { draw(); return; }
    loadOsmOpen().then(d => { paintBox(d); draw(); }).catch(err => {
      loadError = err.message || String(err);
      paintBox(null);
    });
  };
  GROUPS.forEach(g => $(g.id)?.addEventListener('change', refresh));
}
