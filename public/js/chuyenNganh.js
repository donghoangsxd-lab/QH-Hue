// Bốn trục là tab cấp một của panel Lớp dữ liệu. Cùng một cờ bật/tắt: checkbox có bind dùng lớp sẵn,
// lớp catalog chỉ tải GeoJSON khi bật và gỡ layer khi tắt.
import { map, focusWard, clearWardHighlight, centerOnCity, getLeftObstruction, getRightObstruction } from './mapEngine.js';
import { showUrbanPlanOnBase } from './urbanAreaLayer.js';
import { planMap, getViewMode, setViewMode, onViewChange } from './planMap.js';
import { getLevel, setLevel, LEVEL_EVENT, ensurePlanTab } from './mapLevel.js';
import { state } from './state.js';
import { escapeHtml, ico, showToast, RIGHT_TAB_EVENT } from './utils.js';
import { geeApi } from './api.js';
import { PDF_ADMIN_MAX_BYTES } from './pdfLimits.js';
import { withAssetVersion } from './gbaVersion.js';
import { toFeatureCollection } from './geoDoc.js';
import { GP_SCOPE_EVENT, URBAN_FOCUS_EVENT } from './generalPlan.js';
import { ROAD_CLASSES, RAIL_KINDS, ROAD_STAGES } from './qhcRoads.js';
import {
  AXES, AREA_TP, SECTORS, FACET_LEVELS, listAreas, areaLabel, formatKv, parseKv, getLayers,
  getAreaFilter, isLayerOn, setLayerFlag, layerPassesFilter, noteUrbanFocus, setBrowseState,
  setAreaFilter, readFacetUrl, loadFacetCatalog, onFacet, schemesAt, schemesForSector, layersFor, baseLayers, browseState
} from './facetStore.js';
import { DVHC_CITY, dvhcOf, shortPlaceName } from './dvhcStats.js';
import { wardMarks, PLAN_FOOT } from './doThiQd756.js';
import {
  HTKT_GROUPS, PIPE_SECTORS, SYNTH_LABEL, formAllows, gcsObjectPath, geomKind,
  isCotDenLayer, qhpkLayersFromHook
} from './htktModel.js';
import { formatRadius, getPlanRadii, loadPlanRadii, planRadiusM } from './planRadius.js';
import { loadCongSuat } from './congSuat.js';
import { capacityPanelHtml, initCapacityEditor, mountCapacityHosts } from './congSuatUi.js';
import { initXahoiList, paintXahoiList } from './xahoiList.js';
import {
  loadCapNuocDoc, initCapNuocMap, capNuocDossierHtml, capNuocLegendHtml, capNuocPopupExtra, capNuocPointStyle,
  capNuocPlant, syncCapNuoc, pickCapNuocPlant, pickCapNuocZone, setCapNuocZones, setCapNuocZoneOn, capNuocPlantLayer
} from './capNuocQhc.js';

const STORE_KEY = 'qh_axes_v1';
// Không ghi, không khôi phục. Bản lưu cũ có id này bị gỡ khi đọc, để mở trang không tự bật lớp.
const NO_PERSIST = new Set(['base-violate']);
const EXTRA_CHECKS = ['chk_gt25', 'chk_gt10', 'chk_gt25rail', 'chk_gt10rail', 'chk_bound', 'chk_urban', 'chk_projects', 'chk_qhct'];
// Ô cấp quy hoạch do mapLevel giữ. Khôi phục chúng từ bản lưu sẽ tắt QHC 1/25.000 rồi bật QHPK.
const LEVEL_BINDS = new Set(['chk_urban', 'chk_qhc25', 'chk_qhc10', 'chk_projects', 'chk_qhct']);
const SHARE_KEYS = ['ll', 'ly', 'lv', 'm', 'sp', 'bf', 'lb', 'tho', 'da'];
const KIND_LABEL = { 'hien-trang': 'Hiện trạng khi lập đồ án', 'quy-hoach': 'Quy hoạch' };

const ICONS = {
  'giao-thong': '<path d="M8 3 4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3"/>',
  'cap-nuoc': '<path d="M12 3s6 6.2 6 10.2A6 6 0 0 1 6 13.2C6 9.2 12 3 12 3z"/>',
  'cap-dien': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  'san-nen-thoat-mua': '<path d="m3 18 5-8 4 5 3-4 6 7"/><path d="M4 21h16"/>',
  'thoat-nuoc-thai': '<path d="M4 7h16M6 7c0 6 2 8 6 8s6-2 6-8"/><path d="M12 15v4M9 19h6"/>',
  'chat-thai-ran-nghia-trang': '<path d="M12 3v18M7 7.5h10M8.5 21l3.5-6 3.5 6"/>',
  'thong-tin-lien-lac': '<path d="M12 20v-6"/><path d="M8 14a6 6 0 0 1 8 0"/><path d="M5 11a10 10 0 0 1 14 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>',
  'tong-hop-duong-ong': '<path d="M3 8h7v8H3zM14 8h7v8h-7zM10 12h4"/>'
};
const SECTOR_COLOR = {
  'giao-thong': '#0284c7',
  'cap-nuoc': '#0369a1',
  'cap-dien': '#dc2626',
  'san-nen-thoat-mua': '#a16207',
  'thoat-nuoc-thai': '#7c2d12',
  'chat-thai-ran-nghia-trang': '#57534e',
  'thong-tin-lien-lac': '#7c3aed',
  'tong-hop-duong-ong': '#0f766e'
};
const DOCK_ICON = {
  hanhchinh: '<path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-6h4v6"/>',
  quyhoach: '<path d="M4 5h16v14H4z"/><path d="M4 10h16M10 10v9"/>',
  hatang: '<path d="M4 17h16M6 17V8h4v9M14 17V5h4v12"/>',
  xahoi: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.4"/><path d="M16 19a5 5 0 0 1 5-4"/>',
  kientruc: '<path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/>'
};

const NHOM_COLOR = {
  'duong-sat': '#b45309',
  'duong-thuy': '#0f766e',
  'mat-cat': '#64748b',
  'nang-luong': '#ea580c'
};
const fileCache = new Map();
const drawn = new Map();
const openSchemes = new Set([
  'qhc-hue-2045', 'qhc-trung-tam', 'qhc-khe-tre', 'qhc-chan-may',
  'qhc-tt-phu-loc-19e96a86', 'qhc-do-thi-moi-vinh-hung-8899f27b', 'qhc-khu-cong-nghiep-phong-dien-f997bd2c',
  'qhc-xa-thuong-long-3f2c4da4'
]);
const capOpen = new Set();
let layerQuery = '';
let applying = false;
let booted = false;
let ready = false;
let saveTimer = 0;
let kienTruc = null;
const archHidden = new Set();
const archOpen = new Set();
const archClosed = new Set();
let archPicked = null;
let archTab = 'congtrinh';
let archTep = null;
let archTepTask = null;
let archGroups = [];
const archById = new Map();
const ARCH_IMG_MAX = 2 * 1024 * 1024;
const ARCH_DROP = '<svg class="arch-drop" viewBox="0 0 70 96" width="22" height="30" aria-hidden="true"><path d="M35 2C16.8 2 2 16.8 2 35c0 21 24 41 31 57a2.2 2.2 0 004 0c7-16 31-36 31-57C68 16.8 53.2 2 35 2z" fill="#c2410c" stroke="#7c2d12" stroke-width="3"/><circle cx="35" cy="34" r="16" fill="#fff"/><path d="M35 22l12 10h-4v12H27V32h-4z" fill="#c2410c"/></svg>';

const icon = (id) => `<svg class="cn-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ''}</svg>`;

function hosts() {
  return [map, planMap].filter(Boolean);
}

function shownHost() {
  if (planMap && getViewMode() === 'QH' && planMap.getContainer()?.offsetParent) return planMap;
  return map;
}

function clearDrawn(id) {
  (drawn.get(id) || []).forEach(g => g.remove());
  drawn.delete(id);
}

function assetHref(file) {
  const path = gcsObjectPath(file);
  return path ? `/gcs/${path}` : file;
}

function loadFile(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, fetch(withAssetVersion(assetHref(file))).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json().then(toFeatureCollection);
    }).catch(err => { fileCache.delete(file); throw err; }));
  }
  return fileCache.get(file);
}

function featureColor(layer, props) {
  return NHOM_COLOR[props && props.nhom] || SECTOR_COLOR[layer.sector] || '#94a3b8';
}

function featureTitle(props, layer) {
  return props.tencongtrinh || props.tendoituong || props.tenduong || props.ten || props.name || layer.name;
}

function popupHtml(layer, props) {
  const title = featureTitle(props, layer);
  const bits = [];
  if (props.loai) bits.push(props.loai);
  if (props.capDuong) bits.push(props.capDuong);
  if (props.loGioi) bits.push(`lộ giới ${props.loGioi}`);
  if (props.matCat) bits.push(`mặt cắt ${props.matCat}`);
  let html = `<b>${escapeHtml(String(title || layer.name))}</b>`;
  if (geomKind(layer) === 'point') {
    html += `<br>Bán kính phục vụ: ${escapeHtml(formatRadius(planRadiusM(getPlanRadii(), layer)))}`;
  }
  if (bits.length) html += `<br>${escapeHtml(bits.join(' · '))}`;
  if (props.tam_thoi) {
    const scale = props.nguon_ty_le ? `1/${Number(props.nguon_ty_le).toLocaleString('vi-VN')}` : '';
    const src = [props.nguon_ten || props.nguon_do_an, props.nguon_nam, scale].filter(Boolean);
    html += `<br><small>Tạm thời. Nguồn: ${escapeHtml(src.join(' · ') || 'không rõ đồ án')}</small>`;
  } else if (!bits.length && !capNuocPlant(layer, props)) html += `<br>${escapeHtml(layer.name)}`;
  html += capNuocPopupExtra(layer, props);
  return html;
}

async function showFile(layer, frame) {
  if (!layer.file || typeof L === 'undefined') return;
  const fc = await loadFile(layer.file);
  if (!isLayerOn(layer.id)) return;
  clearDrawn(layer.id);
  const dash = layer.kind === 'quy-hoach' ? '8 6' : null;
  const groups = hosts().map(m => L.geoJSON(fc, {
    style: (f) => {
      const props = f.properties || {};
      const color = featureColor(layer, props);
      const polygon = /Polygon/.test(f.geometry && f.geometry.type || '');
      return {
        color, weight: props.nhom === 'mat-cat' ? 1.5 : 2.6, opacity: 0.95, dashArray: dash,
        fillColor: color, fillOpacity: polygon ? 0.18 : 0
      };
    },
    pointToLayer: (f, latlng) => {
      const props = f.properties || {};
      const styled = capNuocPointStyle(layer, props);
      const color = styled ? styled.fill : featureColor(layer, props);
      return L.circleMarker(latlng, { radius: styled ? styled.radius : 5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 });
    },
    onEachFeature: (f, l) => {
      const props = f.properties || {};
      const plant = capNuocPlant(layer, props);
      if (props.tam_thoi) {
        const src = props.nguon_ten || props.nguon_do_an || 'đồ án';
        l.bindTooltip(`Nguồn: ${src}`, { sticky: true, opacity: 0.95 });
      } else if (plant) {
        l.bindTooltip(plant.ten, { sticky: true, direction: 'top', opacity: 0.95 });
      }
      l.bindPopup(popupHtml(layer, props));
    }
  }).addTo(m));
  drawn.set(layer.id, groups);
  if (!frame) return;
  const host = shownHost();
  const bounds = layer.bbox
    ? L.latLngBounds([layer.bbox[1], layer.bbox[0]], [layer.bbox[3], layer.bbox[2]])
    : groups[0]?.getBounds();
  if (host && bounds && bounds.isValid()) host.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
}

function reflectBind(bind, on) {
  const el = document.getElementById(bind);
  if (!el || el.checked === on) return;
  applying = true;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  applying = false;
}

async function setLayerOn(layer, on, { frame = false } = {}) {
  setLayerFlag(layer.id, on);
  if (layer.bind) reflectBind(layer.bind, on);
  if (!layer.bind) {
    if (!on) clearDrawn(layer.id);
    else {
      try { await showFile(layer, frame); }
      catch (err) {
        setLayerFlag(layer.id, false);
        showToast('Không tải được lớp.', 'error');
        console.warn('Lớp', layer.file, err);
      }
    }
  }
  paint();
  scheduleSave();
}

function seedFromDom() {
  getLayers().forEach(l => { if (l.bind) setLayerFlag(l.id, !!document.getElementById(l.bind)?.checked); });
}

function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || raw.v !== 1 || typeof raw !== 'object') return null;
    if (Array.isArray(raw.on) && raw.on.some((id) => NO_PERSIST.has(id))) {
      raw.on = raw.on.filter((id) => !NO_PERSIST.has(id));
      try { localStorage.setItem(STORE_KEY, JSON.stringify(raw)); } catch (e) { /* chế độ riêng tư */ }
    }
    return raw;
  } catch (e) {
    return null;
  }
}

function scheduleSave() {
  if (!ready) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}

function saveNow() {
  if (!ready) return;
  const on = getLayers().filter(l => isLayerOn(l.id) && !NO_PERSIST.has(l.id)).map(l => l.id);
  const extra = EXTRA_CHECKS.filter(id => document.getElementById(id)?.checked);
  const b = browseState();
  const area = getAreaFilter();
  const data = {
    v: 1, axis: b.axis, sector: b.sector, level: b.level, mapLevel: getLevel(),
    kv: area ? formatKv(area) : 'TP', on, extra
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* chế độ riêng tư */ }
}

function searchParams() {
  if (typeof location === 'undefined') return new URLSearchParams();
  return new URLSearchParams(location.search);
}

function legendHtml(sector) {
  const dash = '<span><i></i>Hiện trạng khi lập đồ án</span><span><i class="is-dash"></i>Quy hoạch</span>';
  if (sector === 'giao-thong') {
    const roads = ['ct', 'ql', 'dt', 'dothi', 'kv'].map(id => {
      const c = ROAD_CLASSES[id];
      return `<span><i style="background:${c.color}"></i>${escapeHtml(c.short || c.label)}</span>`;
    });
    const rails = Object.values(RAIL_KINDS).map(k => `<span><i style="background:${k.color}"></i>${escapeHtml(k.short || k.label)}</span>`);
    const stages = ROAD_STAGES.map(s => `<span><i class="${s.dash ? 'is-dash' : ''}"></i>${escapeHtml(s.label)}</span>`);
    return `<div class="cn-legend" aria-label="Chú giải giao thông">${roads.join('')}${rails.join('')}${stages.join('')}${dash}</div>`;
  }
  const color = SECTOR_COLOR[sector] || '#94a3b8';
  const label = SECTORS.find(s => s.id === sector)?.label || '';
  const water = sector === 'cap-nuoc' && browseState().axis === 'hatang' && !pipeOn ? capNuocLegendHtml() : '';
  return `<div class="cn-legend" aria-label="Chú giải ${escapeHtml(label)}"><span><i style="background:${color}"></i>${escapeHtml(label)}</span>${dash}</div>${water}`;
}

function areaOptions() {
  const current = getAreaFilter() || AREA_TP;
  const rows = [];
  const push = (area) => {
    if (!area) return;
    const key = formatKv(area);
    if (!key || rows.some(row => formatKv(row) === key)) return;
    rows.push(area.name ? area : { ...area, name: areaLabel(area) });
  };
  push(listAreas('tp')[0] || { ...AREA_TP, name: 'Toàn thành phố' });
  listAreas('dothi').forEach(push);
  listAreas('xa').forEach(push);
  push(current);
  const now = formatKv(current);
  return rows.map(area => {
    const key = formatKv(area);
    return `<option value="${escapeHtml(key)}"${key === now ? ' selected' : ''}>${escapeHtml(area.name || areaLabel(area))}</option>`;
  }).join('');
}

function pickRow(group, level) {
  const opt = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return `<div class="cn-picks">
    <label><span>Loại hạ tầng</span><select data-cn-sector-pick aria-label="Loại hạ tầng">${HTKT_GROUPS.map(s => opt(s.id, s.label, s.id === group)).join('')}</select></label>
    <label><span>Cấp QH</span><select data-cn-level-pick aria-label="Cấp quy hoạch">${FACET_LEVELS.map(l => opt(l.id, l.label, l.id === level)).join('')}</select></label>
    <label><span>Phạm vi</span><select data-cn-area-pick aria-label="Phạm vi">${areaOptions()}</select></label>
  </div>`;
}

function syncGeomChecks() {
  document.querySelectorAll('#legendHtkt [data-cn-form]').forEach(el => {
    const id = el.dataset.cnForm;
    el.checked = pipeOn ? id === 'line' : !!geomOn[id];
    el.disabled = pipeOn && id !== 'line';
  });
  const note = document.getElementById('legendHtktNote');
  if (note) note.hidden = !pipeOn;
}

let synthDoc = {
  synth: [],
  gcs: [],
  qhpkHook: { id: 'qhpk-htkt', status: 'pending', layers: [], parents: [], note: 'Chưa có lớp HTKT cấp QHPK.' }
};
let pipeOn = false;
let geomOn = { point: true, line: true, polygon: true };

function rawSectorLayers(sector, level, slug) {
  if (pipeOn) {
    return PIPE_SECTORS.flatMap(sec => layersFor(sec, level, slug, { filter: false }));
  }
  return layersFor(sector, level, slug, { filter: false });
}

function synthRowsFor(sector, level, slug) {
  return (synthDoc.synth || []).filter(row => {
    if (row.level !== level) return false;
    const hit = row.scheme === slug || (row.aliases || []).includes(slug);
    if (!hit) return false;
    if (pipeOn) return !!row.pipe;
    return row.sector === sector;
  });
}

function layersByFiles(files) {
  const want = new Set(files || []);
  return getLayers().filter(layer => want.has(layer.file) || want.has(layer.id));
}

function shownSynthLayers(rows) {
  return layersByFiles([].concat(...(rows || []).map(row => row.files || [])))
    .filter(layerPassesFilter)
    .filter(layer => formAllows(layer, geomOn, pipeOn));
}

function listedForScheme(sector, level, slug) {
  const shown = rawSectorLayers(sector, level, slug).filter(layerPassesFilter).filter(layer => formAllows(layer, geomOn, pipeOn));
  const extra = shownSynthLayers(synthRowsFor(sector, level, slug));
  const seen = new Set();
  return [...shown, ...extra].filter(layer => {
    if (!layer || seen.has(layer.id)) return false;
    seen.add(layer.id);
    return true;
  });
}

function hatangSchemes(sector, level) {
  const catalog = state.projectCatalog || [];
  if (!pipeOn) return schemesForSector(sector, level, catalog);
  const seen = new Set();
  const rows = [];
  PIPE_SECTORS.forEach(sec => {
    schemesForSector(sec, level, catalog).forEach(scheme => {
      const key = `${scheme.level}|${scheme.slug}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(scheme);
    });
  });
  return rows;
}

function hatangLayers(sector, level) {
  const seen = new Set();
  return hatangSchemes(sector, level).flatMap(scheme => listedForScheme(sector, scheme.level, scheme.slug)).filter(layer => {
    if (seen.has(layer.id)) return false;
    seen.add(layer.id);
    return true;
  });
}

function layerRow(layer, synth) {
  const bits = [];
  if (layer.featureCount != null) bits.push(`<small>${layer.featureCount}</small>`);
  if (gcsObjectPath(layer.file)) bits.push('<small>GCS</small>');
  if (synth) bits.push(`<small>${escapeHtml(SYNTH_LABEL)}</small>`);
  return `<label class="cn-layer"><input type="checkbox" data-cn-layer="${escapeHtml(layer.id)}"${isLayerOn(layer.id) ? ' checked' : ''}><span>${escapeHtml(layer.name)}</span>${bits.join('')}</label>`;
}

function synthBlock(rows) {
  if (!rows.length) return '';
  const byDonor = new Map();
  rows.forEach(row => {
    if (!byDonor.has(row.donorScheme)) byDonor.set(row.donorScheme, { name: row.donorName, files: [] });
    byDonor.get(row.donorScheme).files.push(...(row.files || []));
  });
  return [...byDonor.values()].map(donor => {
    const layers = shownSynthLayers([{ files: [...new Set(donor.files)] }]);
    const lines = layers.length ? layers.map(layer => layerRow(layer, true)).join('') : '<p class="cn-empty">Chưa có lớp nguồn.</p>';
    return `<div class="cn-synth"><b>${escapeHtml(SYNTH_LABEL)}</b><small>Theo ${escapeHtml(donor.name || 'đồ án cùng cấp')}</small>${lines}</div>`;
  }).join('');
}

function schemeBlock(sector, levelId, scheme) {
  const all = rawSectorLayers(sector, levelId, scheme.slug);
  const poles = all.filter(isCotDenLayer);
  const shown = all.filter(layerPassesFilter).filter(layer => formAllows(layer, geomOn, pipeOn));
  const synth = synthRowsFor(sector, levelId, scheme.slug);
  const has = shown.length > 0;
  const hasSynth = synth.length > 0;
  const listed = listedForScheme(sector, levelId, scheme.slug);
  const on = listed.length > 0 && listed.every(layer => isLayerOn(layer.id));
  const some = listed.some(layer => isLayerOn(layer.id));
  const open = (has || hasSynth || poles.length > 0) && openSchemes.has(scheme.slug);
  const groups = ['hien-trang', 'quy-hoach'].map(kind => {
    const rows = shown.filter(layer => layer.kind === kind);
    if (!rows.length && !open) return '';
    const body = rows.length ? rows.map(layer => layerRow(layer, false)).join('') : '<p class="cn-empty">Chưa có lớp</p>';
    return `<div class="cn-status"><b>${KIND_LABEL[kind]}</b>${body}</div>`;
  }).join('');
  const poleNote = !shown.length && poles.length ? '<p class="cn-empty">Đã gỡ lớp cột đèn.</p>' : '';
  const badge = has ? 'Có dữ liệu' : hasSynth ? SYNTH_LABEL : 'Chưa có';
  const canOpen = has || hasSynth || poles.length > 0;
  const capHtml = (open || capOpen.has(scheme.slug)) ? capacityPanelHtml({
    schemeId: scheme.slug,
    schemeName: scheme.name,
    cap: scheme.level || levelId,
    sector,
    pipe: pipeOn
  }) : '';
  return `<div class="cn-scheme${canOpen ? '' : ' is-missing'}">
    <div class="cn-scheme-row">
      <label><input type="checkbox" data-cn-scheme="${escapeHtml(scheme.slug)}" data-cn-level="${escapeHtml(levelId)}"${on ? ' checked' : ''}${canOpen ? '' : ' disabled'}${some && !on ? ' data-mixed="1"' : ''}><span>${escapeHtml(scheme.name)}</span></label>
      <b class="cn-badge ${has || hasSynth ? 'is-on' : 'is-off'}">${escapeHtml(badge)}</b>
      ${canOpen ? `<button type="button" class="cn-fold" data-cn-fold="${escapeHtml(scheme.slug)}" aria-expanded="${open}">${ico(open ? 'chev-down' : 'chev-right')}</button>` : `<button type="button" class="cn-cap-btn" data-cs-open="${escapeHtml(scheme.slug)}" aria-expanded="${capOpen.has(scheme.slug)}">Quy mô</button>`}
    </div>
    ${open ? `<div class="cn-groups">${groups}${synthBlock(synth)}${poleNote}${capHtml}</div>` : capHtml}
  </div>`;
}


function qhpkHookHtml() {
  if (browseState().level !== 'QHPK') return '';
  const hook = synthDoc.qhpkHook || {};
  const extra = qhpkLayersFromHook(hook).map(layer => {
    const known = getLayers().find(row => row.file === layer.file || row.id === layer.id);
    return known ? layerRow(known, false) : `<p class="cn-layer"><span>${escapeHtml(layer.name || 'Lớp')}</span><small>Chưa gắn</small></p>`;
  }).join('');
  return `<div id="qhpkHtktHook" data-htkt-hook="${escapeHtml(hook.id || 'qhpk-htkt')}"><p class="cn-empty">${escapeHtml(hook.note || 'Chưa có lớp HTKT cấp QHPK.')}</p>${extra}</div>`;
}

function paintHaTang() {
  const box = document.getElementById('browseNganh');
  if (!box || browseState().axis !== 'hatang') {
    syncCapNuoc(false);
    return;
  }
  const { sector, level } = browseState();
  const scroller = box.querySelector('.cn-body');
  const top = scroller ? scroller.scrollTop : 0;
  const group = pipeOn ? 'tong-hop-duong-ong' : sector;
  const schemes = hatangSchemes(sector, level);
  box.innerHTML = `${pickRow(group, level)}
    ${qhpkHookHtml()}
    <div class="cn-body">
      ${sector === 'cap-nuoc' && !pipeOn ? capNuocDossierHtml() : ''}
      <div class="cn-schemes">${schemes.length ? schemes.map(s => schemeBlock(sector, s.level, s)).join('') : '<p class="cn-empty">Chưa có đồ án ở cấp này.</p>'}</div>
    </div>`;
  box.querySelectorAll('[data-mixed="1"]').forEach(el => { el.indeterminate = true; });
  const next = box.querySelector('.cn-body');
  if (next) next.scrollTop = top;
  syncGeomChecks();
  syncCapNuoc(sector === 'cap-nuoc' && !pipeOn);
}

function paintBase(axisId, hostId, sector) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const rows = baseLayers({ axis: axisId, sector, filter: true });
  if (!rows.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<h3 class="axis-base-title">Dữ liệu hiện trạng</h3>${rows.map(l => `<label class="cn-layer"${l.hint ? ` title="${escapeHtml(l.hint)}"` : ''}><input type="checkbox" data-cn-layer="${escapeHtml(l.id)}"${isLayerOn(l.id) ? ' checked' : ''}><span>${escapeHtml(l.name)}</span></label>`).join('')}`;
}

function paintAdmin() {
  const scope = document.getElementById('axisScopeAdmin');
  if (scope) scope.textContent = `Phạm vi: ${areaLabel(getAreaFilter() || AREA_TP)}`;
  paintAdminList();
}

const POP_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const KM_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statText(value, fmt) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : fmt.format(Number(value));
}

function paintAdminList() {
  const wardsHost = document.getElementById('axisWardList');
  const tools = document.getElementById('axisAreaTools');
  if (!wardsHost) return;
  const top = wardsHost.scrollTop;
  const current = formatKv(getAreaFilter() || AREA_TP);
  const q = foldQuery(layerQuery);
  const hit = (...parts) => !q || parts.some(p => foldQuery(p).includes(q));
  const htMode = columnMode() === 'HT';
  const lvCell = (text, title) => {
    const muted = text === '—';
    const tip = title ? ` title="${escapeHtml(title)}"` : '';
    return `<span class="axis-lv${muted ? ' is-muted' : ''}"${tip}>${escapeHtml(text)}</span>`;
  };
  const button = (area, label, num) => {
    const kv = formatKv(area);
    const on = kv === current;
    const stats = area.type === 'tp' ? DVHC_CITY : dvhcOf(label);
    const pop = statText(stats && stats.pop, POP_FMT);
    const km = statText(stats && stats.km2, KM_FMT);
    const numHtml = num ? `${num}.` : '';
    const marks = wardMarks(label);
    const shown = shortPlaceName(label);
    const bits = [`${label}: dân số ${pop}, diện tích ${km} km²`];
    if (marks.ht !== '—') bits.push(`HT ${marks.ht}${marks.htTitle ? ` (${marks.htTitle})` : ''}`);
    if (marks.plan !== '—') bits.push(`2030 ${marks.plan}${marks.planTitle ? ` (${marks.planTitle})` : ''}`);
    if (marks.note) bits.push(`Ghi chú: ${marks.note}`);
    const loai = htMode ? lvCell(marks.ht, marks.htTitle) : lvCell(marks.plan, marks.planTitle);
    return `<button type="button" class="axis-area axis-dvhc${area.type === 'tp' ? ' axis-area-city' : ''}${on ? ' active' : ''}" data-kv="${escapeHtml(kv)}" data-name="${escapeHtml(label)}" aria-pressed="${on}" title="${escapeHtml(bits.join('. '))}"><span class="axis-num">${numHtml}</span><span class="axis-area-name">${escapeHtml(shown)}</span><span class="axis-area-pop">${escapeHtml(pop)}</span><span class="axis-area-km">${escapeHtml(km)}</span>${loai}</button>`;
  };
  const wards = listAreas('xa');
  const tp = listAreas('tp')[0] || { ...AREA_TP, name: DVHC_CITY.name };
  const loaiHead = htMode
    ? '<span class="axis-lv" title="Trình độ phát triển đô thị hiện trạng theo QĐ 614">Loại HT</span>'
    : '<span class="axis-lv" title="Trình độ định hướng đến 2030 theo QĐ 756">Loại 2030</span>';
  const rows = [`<div class="axis-area-head axis-dvhc"><span class="axis-num"></span><span class="axis-area-name">Đơn vị</span><span class="axis-area-pop">Dân số</span><span class="axis-area-km">km²</span>${loaiHead}</div>`];
  if (hit(DVHC_CITY.name, shortPlaceName(DVHC_CITY.name), tp.name, 'TP')) rows.push(button({ ...tp, type: 'tp' }, DVHC_CITY.name, null));
  wards.forEach((area, i) => {
    if (hit(area.name, shortPlaceName(area.name), area.code)) rows.push(button(area, area.name, i + 1));
  });
  const onlyHead = rows.length === 1;
  const footNote = htMode ? 'Theo QĐ 614; loại trước chuyển tiếp' : PLAN_FOOT;
  const foot = `<p class="axis-qd-foot">${escapeHtml(footNote)}</p>`;
  wardsHost.innerHTML = (onlyHead ? (q ? '<p class="cn-empty">Không khớp</p>' : rows[0]) : rows.join('')) + foot;
  wardsHost.scrollTop = top;
  if (tools) tools.innerHTML = '';
  filterGp();
}

function archItems() {
  return kienTruc?.congTrinh?.items || [];
}

function archDecision() {
  return kienTruc?.congTrinh?.quyetDinh || null;
}

function archCite() {
  const qd = archDecision();
  if (!qd?.so) return '';
  return `QĐ ${qd.so}${qd.ngay ? ` ngày ${qd.ngay}` : ''}${qd.coQuan ? ` · ${qd.coQuan}` : ''}`;
}

function archByKey(id) {
  return archItems().find(it => it.id === id) || null;
}

function clearArchLayers() {
  archGroups.forEach(g => g.remove());
  archGroups = [];
  archById.clear();
}

function archAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

function ensureArchTep() {
  if (archTep || archTepTask) return;
  archTepTask = fetch('/gcs/kien-truc/ct-phap/tep.json', { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(doc => {
      archTep = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : { v: 1, anh: {} };
      if (!archTep.anh || typeof archTep.anh !== 'object') archTep.anh = {};
      if (browseState().axis === 'kientruc') paintKienTruc();
    });
}

function archPhotos(id) {
  const list = archTep?.anh?.[id];
  return Array.isArray(list) ? list.filter(p => p && p.n >= 1 && p.n <= 3 && p.ext) : [];
}

function archPhotoUrl(id, photo) {
  const at = photo.at ? `?v=${encodeURIComponent(photo.at)}` : '';
  return `/gcs/kien-truc/ct-phap/anh/${id}-${photo.n}.${photo.ext}${at}`;
}

function archPdfUrl() {
  if (!archTep?.quyetDinh) return '';
  const at = archTep.quyetDinh.at ? `?v=${encodeURIComponent(archTep.quyetDinh.at)}` : '';
  return `/gcs/kien-truc/ct-phap/qd-1152.pdf${at}`;
}

function restyleArchMarkers() {
  archById.forEach((list, id) => {
    const picked = id === archPicked;
    list.forEach(marker => {
      marker.getElement()?.classList.toggle('is-picked', picked);
      marker.setZIndexOffset(picked ? 500 : 0);
    });
  });
}

function watchArchZoom(m) {
  if (m._archZoom) return;
  m._archZoom = true;
  const paint = () => m.getContainer().classList.toggle('arch-pins-far', m.getZoom() < 16);
  m.on('zoomend', paint);
  paint();
}

function syncArchMarkers() {
  clearArchLayers();
  if (browseState().axis !== 'kientruc' || typeof L === 'undefined') return;
  const items = archItems().filter(it => !archHidden.has(it.id));
  hosts().forEach(m => {
    watchArchZoom(m);
    const group = L.layerGroup();
    items.forEach(item => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const picked = item.id === archPicked;
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: `arch-pin${picked ? ' is-picked' : ''}`,
          html: `<div class="arch-pin-wrap">${ARCH_DROP}<span class="arch-pin-name">${escapeHtml(item.ten || '')}</span></div>`,
          iconSize: [160, 88],
          iconAnchor: [80, 30]
        }),
        zIndexOffset: picked ? 500 : 0
      });
      marker.on('click', () => revealArch(item.id));
      const list = archById.get(item.id) || [];
      list.push(marker);
      archById.set(item.id, list);
      group.addLayer(marker);
    });
    group.addTo(m);
    archGroups.push(group);
  });
}

function archPhotoStrip(item) {
  const photos = archPhotos(item.id);
  if (!photos.length) return '';
  const cells = photos.map(photo => {
    const url = archPhotoUrl(item.id, photo);
    const del = archAdmin()
      ? `<button type="button" class="arch-photo-del" data-arch-photo-del="${escapeHtml(item.id)}:${photo.n}" title="Gỡ ảnh" aria-label="Gỡ ảnh">${ico('close')}</button>`
      : '';
    return `<span class="arch-photo"><a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(item.ten || '')}"></a>${del}</span>`;
  }).join('');
  return `<div class="arch-photos">${cells}</div>`;
}

function archWard(name) {
  const s = String(name || '').trim();
  if (s.startsWith('Phường ')) return `phường ${s.slice(7)}`;
  if (s.startsWith('Xã ')) return `xã ${s.slice(3)}`;
  return s;
}

function archPlace(item) {
  const ward = archWard(item.phuong);
  const street = String(item.diaChi || '').trim();
  if (!ward) return street;
  if (street.toLowerCase().includes(ward.toLowerCase())) return street;
  return street ? `${street}, ${ward}` : ward;
}

function archDossier(item) {
  const rows = [
    ['Địa điểm', archPlace(item)],
    ['Cơ quan quản lý', item.coQuan],
    ['Quy mô', item.quyMo],
    ['Năm xây dựng', item.namXayDung],
    ['Chất lượng', item.chatLuong],
    ['Xếp hạng di tích', item.xepHang],
    ['Ghi chú', item.ghiChu]
  ].filter(([, value]) => value);
  const body = rows.map(([label, value]) => `<div class="project-dossier-row"><span class="project-dossier-label">${escapeHtml(label)}</span><span class="project-dossier-meta">${escapeHtml(value)}</span></div>`).join('');
  return `<div class="project-dossier">${body}</div>`;
}

function archRow(item) {
  const on = !archHidden.has(item.id);
  const open = archOpen.has(item.id);
  const picked = item.id === archPicked;
  const blob = [item.ten, archPlace(item), item.coQuan, item.xepHang, item.namXayDung, item.chatLuong, archCite()].filter(Boolean).join(' ');
  const photoBtn = archAdmin()
    ? `<label class="project-btn" title="Tải ảnh công trình, tối đa 3 ảnh, mỗi ảnh 2 MB">${ico('camera')}<input class="arch-file" type="file" accept="image/jpeg,image/png,image/webp" multiple data-arch-photo="${escapeHtml(item.id)}"></label>`
    : '';
  return `<div class="project-row${on ? '' : ' is-off'}${picked ? ' is-picked' : ''}" data-arch-text="${escapeHtml(blob)}">
      <label class="project-name" title="${escapeHtml([item.ten, archPlace(item)].filter(Boolean).join(' — '))}">
        <input type="checkbox" data-arch="${escapeHtml(item.id)}"${on ? ' checked' : ''} title="Hiện công trình trên bản đồ"><span data-arch-focus="${escapeHtml(item.id)}">${item.stt}. ${escapeHtml(item.ten || item.id)}</span></label>
      <span class="project-tools">
        ${photoBtn}
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-arch-expand="${escapeHtml(item.id)}" title="${open ? 'Ẩn' : 'Xem'} thông tin công trình" aria-label="Thông tin công trình" aria-expanded="${open}">${ico('chev-down')}</button>
      </span>
    </div>${archPhotoStrip(item)}${open ? archDossier(item) : ''}`;
}

function revealArch(id) {
  const item = archByKey(id);
  if (!item) return;
  archPicked = id;
  archTab = 'congtrinh';
  archOpen.add(id);
  if (item.nhom) archClosed.delete(item.nhom);
  document.body.classList.remove('right-collapsed');
  paintKienTruc();
  const showInfo = () => {
    const row = document.querySelector(`#axisKienTruc [data-arch-focus="${CSS.escape(id)}"]`)?.closest('.project-row');
    const next = row?.nextElementSibling;
    const target = next && (next.classList.contains('arch-photos') || next.classList.contains('project-dossier')) ? next : row;
    target?.scrollIntoView({ block: 'nearest' });
  };
  showInfo();
  requestAnimationFrame(showInfo);
  restyleArchMarkers();
}

function focusArch(id) {
  const item = archByKey(id);
  if (!item) return;
  const wasHidden = archHidden.has(id);
  archHidden.delete(id);
  archPicked = id;
  archTab = 'congtrinh';
  if (item.nhom) archClosed.delete(item.nhom);
  paintKienTruc();
  if (wasHidden) syncArchMarkers();
  else restyleArchMarkers();
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  const host = shownHost();
  if (host && Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const opts = { animate: true, duration: 0.8 };
      const shift = (getLeftObstruction() - getRightObstruction()) / 2;
      if (!shift || typeof L === 'undefined') host.flyTo([lat, lng], 17, opts);
      else {
        const target = host.project(L.latLng(lat, lng), 17).subtract([shift, 0]);
        host.flyTo(host.unproject(target, 17), 17, opts);
      }
    } catch (err) {
      console.warn('Không phóng tới công trình', err);
    }
  }
  const row = document.querySelector(`#axisKienTruc [data-arch-focus="${CSS.escape(id)}"]`)?.closest('.project-row');
  row?.scrollIntoView({ block: 'nearest' });
}

function paintKienTruc() {
  const box = document.getElementById('axisKienTruc');
  if (!box || browseState().axis !== 'kientruc') return;
  ensureArchTep();
  const top = box.scrollTop;
  const quy = kienTruc?.quyChe?.items || [];
  const ct = archItems();
  const list = (items, render) => items.length ? `<ul class="axis-arch-list">${items.map(render).join('')}</ul>` : '<p class="cn-empty">Chưa có dữ liệu</p>';
  const docHref = (url) => {
    const href = typeof url === 'string' ? url.trim() : '';
    if ((href.startsWith('/') && !href.startsWith('//')) || /^https?:\/\//i.test(href)) return href;
    return '';
  };
  const tab = (id, label) => `<button type="button" class="arch-tab${archTab === id ? ' active' : ''}" role="tab" data-arch-tab="${id}" aria-selected="${archTab === id}">${label}</button>`;
  const quyHtml = `<section class="axis-arch">${list(quy, item => {
    const name = escapeHtml(item.name || item.id || 'Quy chế');
    const title = item.doc?.title ? `<small>${escapeHtml(item.doc.title)}</small>` : '';
    const body = `<b>${name}</b>${title}`;
    const href = docHref(item.doc?.url);
    return href ? `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${body}</a></li>` : `<li>${body}</li>`;
  })}</section>`;
  const groups = kienTruc?.congTrinh?.nhom || [];
  const pdfUrl = archPdfUrl();
  const pdfBtn = pdfUrl
    ? `<a class="project-btn has-decision" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener" title="Mở PDF quyết định" aria-label="Mở PDF quyết định">${ico('file')}</a>`
    : `<span class="project-btn is-empty" title="Chưa có file PDF" aria-label="Chưa có file PDF">${ico('file')}</span>`;
  const uploadBtn = archAdmin()
    ? `<label class="project-btn" title="Quản trị tải PDF quyết định, tối đa 10 MB">${ico('save')}<input class="arch-file" type="file" accept="application/pdf,.pdf" data-arch-pdf-file></label>`
    : '';
  const groupHtml = groups.map(group => {
    const items = ct.filter(it => it.nhom === group.id);
    if (!items.length) return '';
    const open = !archClosed.has(group.id);
    return `<div class="pl-group${open ? ' open' : ''}" data-arch-group="${escapeHtml(group.id)}">
      <div class="pl-hrow">
        <button type="button" class="pl-head" data-arch-group-toggle="${escapeHtml(group.id)}" aria-expanded="${open}" title="${open ? 'Thu gọn' : 'Xem'} ${escapeHtml(group.ten || '')}">
          ${ico('chev-right')}<span>${escapeHtml(group.ten || group.id)}</span><small>${items.length}</small></button>
      </div>
      <div class="pl-body"${open ? '' : ' hidden'}>${items.map(archRow).join('')}</div>
    </div>`;
  }).join('');
  const loose = ct.filter(it => !groups.some(group => group.id === it.nhom));
  const catalog = `<section class="axis-arch"><div class="arch-catalog-head"><h3>Danh mục công trình kiến trúc Pháp (Quyết định số 1152/QĐ-UBND)</h3><span class="project-tools">${pdfBtn}${uploadBtn}</span></div><div class="project-list">${groupHtml || (ct.length ? ct.map(archRow).join('') : '<p class="cn-empty">Chưa có dữ liệu</p>')}${loose.map(archRow).join('')}</div></section>`;
  box.innerHTML = `<div class="arch-tabs" role="tablist">${tab('quyche', 'Quy chế kiến trúc')}${tab('congtrinh', 'Công trình có giá trị')}</div>${archTab === 'quyche' ? quyHtml : catalog}`;
  box.scrollTop = top;
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Không đọc được file'));
    reader.readAsDataURL(file);
  });
}

async function postArch(body) {
  const res = await fetch(geeApi(`action=${encodeURIComponent(body.action || '')}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.message || 'Không lưu được');
  if (body.action === 'putCtPhapTep' && !data.tep) throw new Error('Máy chủ chưa ghi được tệp.');
  return data;
}

async function uploadArchPdf(file) {
  if (!file || !archAdmin()) return;
  if ((file.name.split('.').pop() || '').toLowerCase() !== 'pdf' || file.size > PDF_ADMIN_MAX_BYTES) {
    showToast('Chỉ nhận PDF không quá 10 MB.');
    return;
  }
  try {
    const saved = await postArch({
      action: 'putCtPhapTep',
      kind: 'pdf',
      name: file.name,
      pdf: await fileBase64(file)
    });
    if (saved.tep) archTep = saved.tep;
    paintKienTruc();
    showToast('Đã ghi PDF quyết định.');
  } catch (err) {
    showToast(err.message || 'Không ghi được PDF');
  }
}

async function uploadArchPhotos(id, files) {
  if (!archAdmin() || !id) return;
  const list = [...(files || [])];
  if (!list.length) return;
  const used = new Set(archPhotos(id).map(p => p.n));
  const free = [1, 2, 3].filter(n => !used.has(n));
  if (!free.length) {
    showToast('Mỗi công trình tối đa 3 ảnh.');
    return;
  }
  let savedCount = 0;
  for (const file of list) {
    if (savedCount >= free.length) {
      showToast('Mỗi công trình tối đa 3 ảnh.');
      break;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > ARCH_IMG_MAX) {
      showToast(`${file.name}: chỉ nhận JPEG, PNG hoặc WebP, mỗi ảnh tối đa 2 MB.`);
      continue;
    }
    try {
      const saved = await postArch({
        action: 'putCtPhapTep',
        kind: 'anh',
        id,
        slot: free[savedCount],
        name: file.name,
        image: await fileBase64(file)
      });
      if (saved.tep) archTep = saved.tep;
      savedCount += 1;
    } catch (err) {
      showToast(err.message || 'Không tải được ảnh');
      break;
    }
  }
  if (savedCount) {
    archOpen.add(id);
    paintKienTruc();
    showToast(savedCount === 1 ? 'Đã lưu ảnh công trình.' : `Đã lưu ${savedCount} ảnh.`);
  }
}

async function removeArchPhoto(id, slot) {
  if (!archAdmin()) return;
  try {
    const saved = await postArch({ action: 'putCtPhapTep', kind: 'xoa', id, slot });
    if (saved.tep) archTep = saved.tep;
    paintKienTruc();
  } catch (err) {
    showToast(err.message || 'Không gỡ được ảnh');
  }
}

function paintScopes() {
  const q = document.getElementById('axisScopeQuyHoach');
  if (!q) return;
  const count = document.getElementById('planTabCount');
  q.textContent = `Phạm vi: ${areaLabel(getAreaFilter() || AREA_TP)} `;
  if (count) q.append(count);
}

function paintDock() {
  const axis = browseState().axis;
  document.querySelectorAll('[data-axis], [data-axis-dock]').forEach(btn => {
    const id = btn.dataset.axis || btn.dataset.axisDock;
    const on = id === axis;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  paintMag();
}

const MAG_ORDER = ['hanhchinh', 'quyhoach', 'hatang', 'xahoi', 'kientruc', 'dautu'];

function paintMag() {
  const track = document.getElementById('layerMagTrack');
  if (!track) return;
  const id = browseState().axis || 'quyhoach';
  const cur = Math.max(0, MAG_ORDER.indexOf(id));
  const items = [...track.querySelectorAll('[data-main-tab]')];
  items.forEach((btn, i) => {
    const dist = Math.abs(i - cur);
    const on = i === cur;
    btn.classList.toggle('is-current', on);
    btn.classList.toggle('is-before', i < cur);
    btn.classList.toggle('is-after', i > cur);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    if (dist) btn.dataset.dist = String(dist);
    else delete btn.dataset.dist;
    const label = btn.querySelector('.layer-main-label');
    if (label) label.style.fontSize = '';
  });
  const prev = document.querySelector('[data-mag-step="-1"]');
  const next = document.querySelector('[data-mag-step="1"]');
  if (prev) prev.disabled = cur <= 0;
  if (next) next.disabled = cur >= MAG_ORDER.length - 1;
  const menu = document.getElementById('layerMagMenu');
  if (menu && !menu.hidden) placeMagMenu();
}

function placeMagMenu() {
  const menu = document.getElementById('layerMagMenu');
  const cur = document.querySelector('#layerMagTrack .is-current');
  const host = document.getElementById('layerMag');
  if (!menu || !cur || !host) return;
  const r = cur.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const width = Math.round(Math.max(220, Math.min(r.width, h.width - 8)));
  const left = Math.round(r.left - h.left);
  menu.style.top = `${Math.round(r.bottom - h.top + 4)}px`;
  menu.style.left = `${Math.max(0, Math.min(left, h.width - width))}px`;
  menu.style.width = `${width}px`;
}

function fillMagMenu() {
  const menu = document.getElementById('layerMagMenu');
  const track = document.getElementById('layerMagTrack');
  if (!menu || !track || menu.dataset.ready) return;
  menu.dataset.ready = '1';
  menu.innerHTML = [...track.querySelectorAll('[data-main-tab]')].map(btn => {
    const id = btn.dataset.mainTab;
    const name = btn.title || btn.textContent;
    return `<button type="button" role="option" data-mag-go="${escapeHtml(id)}">${escapeHtml(name)}</button>`;
  }).join('');
}

function setMagMenu(open) {
  const menu = document.getElementById('layerMagMenu');
  if (!menu) return;
  fillMagMenu();
  const id = browseState().axis;
  menu.querySelectorAll('[data-mag-go]').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.magGo === id)));
  menu.hidden = !open;
  if (open) placeMagMenu();
}

function stepMag(dir) {
  const cur = Math.max(0, MAG_ORDER.indexOf(browseState().axis || 'quyhoach'));
  goMag(MAG_ORDER[cur + dir]);
}

function goMag(id) {
  if (!id) return;
  setMagMenu(false);
  magGoing = true;
  document.querySelector(`#layerMagTrack [data-main-tab="${id}"]`)?.click();
  magGoing = false;
}

let sectorHold = false;
function publishSectorLegend(open, sectorId) {
  if (pipeOn && browseState().axis === 'hatang') {
    const html = PIPE_SECTORS.map(id => {
      const label = HTKT_GROUPS.find(row => row.id === id)?.label || id;
      return `<span><i style="background:${SECTOR_COLOR[id] || '#94a3b8'}"></i>${escapeHtml(label)}</span>`;
    }).join('');
    document.dispatchEvent(new CustomEvent('qh:sector-legend', {
      detail: { on: true, open: !!open, label: 'Tổng hợp đường ống', html: `<div class="cn-legend" aria-label="Chú giải tổng hợp đường ống">${html}</div>` }
    }));
    return;
  }
  const b = browseState();
  const sector = sectorId || b.sector;
  const listed = schemesForSector(sector, b.level, state.projectCatalog || []).flatMap(s => layersFor(sector, s.level, s.slug));
  const layersOn = listed.some(l => isLayerOn(l.id));
  if (open) sectorHold = true;
  if (!open && !layersOn && b.axis !== 'hatang') sectorHold = false;
  const show = layersOn || sectorHold || b.axis === 'hatang';
  document.dispatchEvent(new CustomEvent('qh:sector-legend', {
    detail: {
      on: show,
      open: !!open && show,
      label: SECTORS.find(s => s.id === sector)?.label || 'Hạ tầng',
      html: legendHtml(sector)
    }
  }));
  document.querySelectorAll('#legendSector [data-cnu-partial]').forEach(el => { el.indeterminate = true; });
}

function paintXaHoi() {
  const scope = document.getElementById('axisScopeXaHoi');
  if (scope) scope.textContent = `Phạm vi: ${areaLabel(getAreaFilter() || AREA_TP)}`;
}

function paintAxisAll() {
  const btn = document.getElementById('btnAxisAll');
  const pane = document.querySelector(`#layerMain [data-main-pane="${browseState().axis}"]`);
  if (!btn || !pane) return;
  const boxes = [...pane.querySelectorAll('input[type="checkbox"]')].filter(el => {
    if (el.id === 'chk_parcel') return false;
    if (el.closest('#xahoiHeat')) return false;
    if (el.closest('#projectList') || el.closest('[hidden]') || el.closest('.is-filter-hide')) return false;
    return true;
  });
  const allOn = boxes.length > 0 && boxes.every(el => el.checked);
  btn.setAttribute('aria-pressed', String(allOn));
  btn.title = allOn ? 'Tắt các lớp đang hiện trong nhóm này' : 'Bật các lớp đang hiện trong nhóm này';
}

const foldQuery = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

function filterGp() {
  const box = document.getElementById('gpList');
  if (!box) return;
  const q = foldQuery(layerQuery);
  const rows = [...box.children];
  rows.forEach(el => {
    if (!el.classList.contains('gp-row')) return;
    const name = el.querySelector('.axis-area-name, .gp-name')?.textContent || '';
    const full = el.getAttribute('data-name') || '';
    el.classList.toggle('is-filter-hide', !!q && !foldQuery(`${name} ${full}`).includes(q));
  });
  rows.forEach(el => {
    if (!el.classList.contains('gp-grp')) return;
    let n = el.nextElementSibling;
    let any = !q;
    while (n && !n.classList.contains('gp-grp')) {
      if (n.classList.contains('gp-row') && !n.classList.contains('is-filter-hide')) any = true;
      n = n.nextElementSibling;
    }
    el.classList.toggle('is-filter-hide', !any);
  });
}

function applyLayerQuery() {
  const q = foldQuery(layerQuery);
  ['#layerPaneHaTang', '#layerPaneXaHoi', '#layerPaneKienTruc', '#layerPaneDauTu'].forEach(sel => {
    document.querySelectorAll(`${sel} .cn-scheme, ${sel} .layer-row, ${sel} .axis-arch li, ${sel} .cn-layer`).forEach(el => {
      el.classList.toggle('is-filter-hide', !!q && !foldQuery(el.textContent).includes(q));
    });
  });
  document.querySelectorAll('#axisQuyHoach .project-row, #axisQuyHoach .project-layer, #axisQuyHoach .layer-row').forEach(el => {
    if (el.closest('#projectList')) return;
    el.classList.toggle('is-filter-hide', !!q && !foldQuery(el.textContent).includes(q));
  });
  if (q && browseState().axis === 'dautu') {
    const hit = [...document.querySelectorAll('#axisDauTu [data-dt-pane]')].find(pane => {
      const row = pane.querySelector('.layer-row');
      return row && foldQuery(row.textContent).includes(q);
    });
    if (hit) document.querySelector(`#levelPickDt [data-dt-tab="${hit.dataset.dtPane}"]`)?.click();
  }
  if (q && browseState().axis === 'kientruc' && archTab !== 'congtrinh') {
    const hit = archItems().some(it => foldQuery([it.ten, it.diaChi, it.coQuan, it.phuong, it.chatLuong].filter(Boolean).join(' ')).includes(q));
    if (hit) {
      archTab = 'congtrinh';
      paintKienTruc();
    }
  }
  document.querySelectorAll('#layerPaneKienTruc .project-row').forEach(el => {
    const blob = el.getAttribute('data-arch-text') || el.textContent;
    const hide = !!q && !foldQuery(blob).includes(q);
    el.classList.toggle('is-filter-hide', hide);
    let next = el.nextElementSibling;
    while (next && (next.classList.contains('arch-photos') || next.classList.contains('project-dossier'))) {
      next.classList.toggle('is-filter-hide', hide);
      next = next.nextElementSibling;
    }
  });
  document.querySelectorAll('#layerPaneKienTruc .pl-group').forEach(group => {
    const rows = [...group.querySelectorAll('.project-row')];
    const any = rows.some(row => !row.classList.contains('is-filter-hide'));
    group.classList.toggle('is-filter-hide', !!q && !any);
    const body = group.querySelector('.pl-body');
    if (!body) return;
    if (q && any) body.hidden = false;
    else if (!q) body.hidden = archClosed.has(group.dataset.archGroup || '');
  });
  filterGp();
  const ps = document.getElementById('projectSearch');
  if (ps && ps.value !== layerQuery) {
    ps.value = layerQuery;
    ps.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function paintViewSwitch() {
  const mode = columnMode();
  document.querySelectorAll('#layerTools [data-view-mode]').forEach(btn => {
    const on = btn.dataset.viewMode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  paintAdminList();
  if (adminMapOn) {
    const titleEl = document.getElementById('mapTitleText');
    const title = mode === 'QH' ? 'BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ' : 'BẢN ĐỒ HIỆN TRẠNG THÀNH PHỐ HUẾ';
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.title = title;
    }
  }
  document.dispatchEvent(new CustomEvent('qh:view-column', { detail: { mode } }));
}

function toggleAxisAll() {
  if (browseState().axis === 'hatang') {
    const { sector, level } = browseState();
    const listed = hatangLayers(sector, level);
    if (!listed.length) return;
    const turnOn = listed.some(l => !isLayerOn(l.id));
    listed.forEach(l => setLayerOn(l, turnOn));
    publishSectorLegend(turnOn);
    return;
  }
  const pane = document.querySelector(`#layerMain [data-main-pane="${browseState().axis}"]`);
  if (!pane) return;
  const boxes = [...pane.querySelectorAll('input[type="checkbox"]')].filter(el => {
    if (el.id === 'chk_parcel') return false;
    if (el.closest('#xahoiHeat')) return false;
    if (el.closest('#projectList')) return false;
    if (el.closest('[hidden]') || el.closest('.is-filter-hide')) return false;
    return true;
  });
  if (!boxes.length) return;
  const turnOn = boxes.some(el => !el.checked);
  boxes.forEach(el => {
    if (el.checked === turnOn) return;
    el.checked = turnOn;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function paint() {
  paintDock();
  paintScopes();
  const axis = browseState().axis;
  paintAdmin();
  if (axis === 'hatang') paintHaTang();
  else syncCapNuoc(false);
  if (axis === 'kientruc') paintKienTruc();
  syncArchMarkers();
  // Quy hoạch và Kiến trúc không gắn mục «Dữ liệu hiện trạng». GBA và công trình vi phạm chỉ ở Lớp nền.
  paintBase('hatang', 'baseHaTang', pipeOn ? null : browseState().sector);
  paintXaHoi();
  paintXahoiList();
  paintAxisAll();
  const tools = document.getElementById('axisToolsQuyHoach');
  if (tools) tools.hidden = true;
  applyLayerQuery();
  publishSectorLegend(false);
  document.dispatchEvent(new CustomEvent('qh:legend-sync'));
}

function showPlanPane() {
  const id = browseState().axis || 'quyhoach';
  document.querySelector(`[data-main-tab="${id}"]`)?.click();
}

function openQhc25Layers() {
  const box = document.getElementById('qhc25Layers');
  const btn = document.querySelector('[data-qhc-expand="25"]');
  if (box) box.hidden = false;
  if (btn) {
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    btn.title = 'Ẩn các lớp dữ liệu';
  }
}

let openingAxis = false;
let magGoing = false;
let listenLevel = false;
let levelTab = false;
let axisBeforeUrban = null;
let adminViewHold = null;
let adminUrbanHeld = null;
let adminColumn = 'HT';
let adminMapOn = false;

export function columnMode() {
  if (adminMapOn) return adminColumn === 'QH' ? 'QH' : 'HT';
  return getViewMode() === 'HT' ? 'HT' : 'QH';
}

function setUrbanLayer(on) {
  const urban = document.getElementById('chk_urban');
  if (!urban || urban.checked === on) return;
  urban.checked = on;
  urban.dispatchEvent(new Event('change', { bubbles: true }));
}

function enterAdminMap() {
  if (adminViewHold == null) adminViewHold = getViewMode();
  adminMapOn = true;
  adminColumn = 'HT';
  if (getViewMode() !== 'HT') setViewMode('HT');
  showUrbanPlanOnBase(false);
  const urban = document.getElementById('chk_urban');
  if (urban && adminUrbanHeld == null) adminUrbanHeld = urban.checked;
  setUrbanLayer(true);
}

function leaveAdminMap() {
  adminMapOn = false;
  adminColumn = 'HT';
  if (adminUrbanHeld === false) setUrbanLayer(false);
  else showUrbanPlanOnBase(false);
  adminUrbanHeld = null;
  const back = adminViewHold;
  adminViewHold = null;
  if (back && back !== getViewMode()) setViewMode(back);
  else paintViewSwitch();
}

function placeIsoRadius(axis) {
  if (axis !== 'xahoi') return;
  const field = document.getElementById('isoRadiusField');
  const slot = document.getElementById('isoSlotXaHoi');
  if (field && slot && field.parentElement !== slot) slot.append(field);
}

function releaseAdminAnchor() {
  const area = getAreaFilter();
  if (!area || area.type !== 'tp') setAreaFilter({ ...AREA_TP }, 'axis');
  clearWardHighlight();
  if (state.selectedWard && state.selectedWard !== DVHC_CITY.name) focusWard(DVHC_CITY.name);
  document.dispatchEvent(new CustomEvent('qh:admin-release'));
}

function showAxis(id, { openPanel = false, url = true, keepCamera = false } = {}) {
  if (!AXES.some(a => a.id === id)) return;
  if (id !== 'hanhchinh') {
    leaveAdminMap();
    releaseAdminAnchor();
  } else enterAdminMap();
  if (id === 'quyhoach') ensurePlanTab('qhc25');
  placeIsoRadius(id);
  setBrowseState({ axis: id }, { url });
  openingAxis = true;
  document.querySelector(`[data-main-tab="${id}"]`)?.click();
  openingAxis = false;
  if (openPanel) document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLayers', open: true } }));
  paint();
  scheduleSave();
  if (id === 'hanhchinh' && !keepCamera) requestAnimationFrame(() => centerOnCity({ animate: false }));
}

function paintMatrix() {
  const box = document.getElementById('cnMatrixBody');
  if (!box) return;
  const catalog = state.projectCatalog || [];
  const schemes = FACET_LEVELS.flatMap(l => schemesAt(l.id, catalog).map(s => ({ ...s, levelLabel: l.label })));
  const head = SECTORS.map(s => `<th title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</th>`).join('');
  const body = schemes.map(s => {
    const cells = SECTORS.map(sec => {
      const has = layersFor(sec.id, s.level, s.slug, { filter: false }).length > 0;
      return `<td class="${has ? 'is-on' : ''}">${has ? 'Có' : '—'}</td>`;
    }).join('');
    return `<tr><th>${escapeHtml(s.levelLabel)}</th><th>${escapeHtml(s.name)}</th>${cells}</tr>`;
  }).join('');
  box.innerHTML = `<div class="cn-matrix-wrap"><table class="cn-matrix"><thead><tr><th>Cấp</th><th>Đồ án</th>${head}</tr></thead><tbody>${body || '<tr><td colspan="9">Chưa có đồ án</td></tr>'}</tbody></table></div>`;
}

function applyExtra(saved) {
  const want = new Set(saved.extra || []);
  EXTRA_CHECKS.forEach(id => {
    if (LEVEL_BINDS.has(id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    const on = want.has(id);
    if (el.checked === on) return;
    applying = true;
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    applying = false;
  });
}

function applySavedLayers(saved) {
  const want = new Set(saved.on || []);
  getLayers().forEach(l => {
    if (NO_PERSIST.has(l.id)) return;
    const on = want.has(l.id);
    if (l.bind) {
      if (LEVEL_BINDS.has(l.bind)) return;
      setLayerFlag(l.id, on);
      reflectBind(l.bind, on);
      return;
    }
    if (on) setLayerOn(l, true);
    else setLayerFlag(l.id, false);
  });
}

async function loadSynth() {
  try {
    const res = await fetch(withAssetVersion('data/htkt/synth.json'));
    if (!res.ok) return;
    const doc = await res.json();
    if (doc && typeof doc === 'object') synthDoc = doc;
  } catch (err) { /* không tổng hợp */ }
}

async function loadKienTruc() {
  const pull = async (file) => {
    try {
      const res = await fetch(new URL(file, document.baseURI).href);
      if (!res.ok) return { items: [] };
      const doc = await res.json();
      return doc && Array.isArray(doc.items) ? doc : { items: [] };
    } catch (e) {
      return { items: [] };
    }
  };
  const [quyChe, congTrinh] = await Promise.all([
    pull('data/kien-truc/quy-che.json'),
    pull('data/kien-truc/cong-trinh.json')
  ]);
  kienTruc = { quyChe, congTrinh };
  state.kienTruc = kienTruc;
  if (browseState().axis === 'kientruc') {
    paintKienTruc();
    syncArchMarkers();
  }
}

function showDauTuTab(id) {
  const pick = document.getElementById('levelPickDt');
  if (!pick || !id) return;
  pick.querySelectorAll('[data-dt-tab]').forEach(btn => {
    const on = btn.dataset.dtTab === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#axisDauTu [data-dt-pane]').forEach(pane => {
    pane.hidden = pane.dataset.dtPane !== id;
  });
  paintAxisAll();
}

function initDauTuTabs() {
  document.getElementById('levelPickDt')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dt-tab]');
    if (btn) showDauTuTab(btn.dataset.dtTab);
  });
}

export function initChuyenNganh() {
  if (booted || !document.getElementById('axisHanhChinh')) return;
  booted = true;
  initDauTuTabs();
  const q = searchParams();
  const shareView = SHARE_KEYS.some(k => q.has(k));
  const facetLink = ['kv', 'nganh', 'truc', 'tt'].some(k => q.has(k));
  const openDeep = q.has('nganh') || q.has('truc');
  const saved = !shareView && !facetLink ? readSaved() : null;
  const deep = readFacetUrl();

  // Không có link chia sẻ hay link sâu: trục Quy hoạch, QHC 1/25.000, phạm vi cả thành phố.
  // Lớp đã bật lần trước vẫn khôi phục ở applySavedLayers, trừ base-violate. Trục và cấp không bị bản lưu kéo đi.
  if (!shareView && !openDeep) {
    setAreaFilter({ ...AREA_TP }, 'startup', { url: false });
    setBrowseState({ axis: 'quyhoach', sector: saved?.sector || browseState().sector, level: 'QHC25' }, { url: false });
    setLevel('qhc25', { keepView: true });
    showPlanPane();
    openQhc25Layers();
  } else if (deep.axis || deep.nganh) {
    setBrowseState({ axis: deep.axis || (deep.nganh ? 'hatang' : 'quyhoach'), sector: deep.nganh || undefined }, { url: false });
  }

  document.getElementById('layerMain')?.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view-mode]');
    if (viewBtn) {
      const mode = viewBtn.dataset.viewMode === 'HT' ? 'HT' : 'QH';
      if (browseState().axis === 'hanhchinh') {
        adminColumn = mode;
        if (getViewMode() !== 'HT') setViewMode('HT');
        showUrbanPlanOnBase(mode === 'QH');
        paintViewSwitch();
        return;
      }
      setViewMode(mode);
      paintViewSwitch();
      return;
    }
    if (e.target.closest('#btnAxisAll')) {
      toggleAxisAll();
      return;
    }
    const archTabBtn = e.target.closest('[data-arch-tab]');
    if (archTabBtn) {
      const next = archTabBtn.dataset.archTab === 'quyche' ? 'quyche' : 'congtrinh';
      if (next !== archTab) {
        archTab = next;
        paintKienTruc();
      }
      return;
    }
    if (e.target.closest('[data-arch-photo], [data-arch-pdf-file]')) return;
    const photoDel = e.target.closest('[data-arch-photo-del]');
    if (photoDel) {
      const [id, slot] = String(photoDel.dataset.archPhotoDel || '').split(':');
      removeArchPhoto(id, Number(slot));
      return;
    }
    const archFocus = e.target.closest('[data-arch-focus]');
    if (archFocus) {
      e.preventDefault();
      focusArch(archFocus.dataset.archFocus);
      return;
    }
    const archExpand = e.target.closest('[data-arch-expand]');
    if (archExpand) {
      const id = archExpand.dataset.archExpand;
      if (archOpen.has(id)) archOpen.delete(id);
      else archOpen.add(id);
      paintKienTruc();
      return;
    }
    const archGroup = e.target.closest('[data-arch-group-toggle]');
    if (archGroup) {
      const id = archGroup.dataset.archGroupToggle;
      if (archClosed.has(id)) archClosed.delete(id);
      else archClosed.add(id);
      paintKienTruc();
      return;
    }
    const adminTab = e.target.closest('[data-admin-tab]');
    if (adminTab) {
      const id = adminTab.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach(btn => {
        const on = btn.dataset.adminTab === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('[data-admin-pane]').forEach(pane => { pane.hidden = pane.dataset.adminPane !== id; });
      if (id === 'dothi') document.dispatchEvent(new CustomEvent('qh:legend-open', { detail: { set: 'URBAN' } }));
      return;
    }
    const waterPlant = e.target.closest('[data-cnu-plant]');
    if (waterPlant) {
      pickCapNuocPlant(waterPlant.dataset.cnuPlant);
      const layer = capNuocPlantLayer(getLayers());
      if (layer && !isLayerOn(layer.id)) setLayerOn(layer, true, { frame: false });
      paint();
      return;
    }
    const sectorBtn = e.target.closest('[data-cn-sector]');
    if (sectorBtn) {
      const id = sectorBtn.dataset.cnSector;
      if (id === 'tong-hop-duong-ong') pipeOn = true;
      else {
        pipeOn = false;
        setBrowseState({ sector: id, axis: 'hatang' });
      }
      paint();
      publishSectorLegend(true);
      scheduleSave();
      return;
    }
    const levelBtn = e.target.closest('[data-cn-level]');
    if (levelBtn) {
      setBrowseState({ level: levelBtn.dataset.cnLevel });
      paint();
      scheduleSave();
      return;
    }
    const fold = e.target.closest('[data-cn-fold]');
    if (fold) {
      const slug = fold.dataset.cnFold;
      if (openSchemes.has(slug)) openSchemes.delete(slug); else openSchemes.add(slug);
      paint();
      return;
    }
    const capBtn = e.target.closest('[data-cs-open]');
    if (capBtn) {
      const slug = capBtn.dataset.csOpen;
      if (capOpen.has(slug)) capOpen.delete(slug); else capOpen.add(slug);
      paint();
      return;
    }
    const kvBtn = e.target.closest('[data-kv]');
    if (kvBtn) {
      const area = parseKv(kvBtn.dataset.kv) || { ...AREA_TP };
      setAreaFilter(area, 'user');
      if (area.type === 'xa') focusWard(areaLabel(area));
      else if (area.type === 'tp') focusWard(DVHC_CITY.name);
      return;
    }
  });
  document.getElementById('layerMain')?.addEventListener('change', (e) => {
    const pdfInput = e.target.closest('[data-arch-pdf-file]');
    if (pdfInput) {
      const file = pdfInput.files && pdfInput.files[0];
      pdfInput.value = '';
      uploadArchPdf(file);
      return;
    }
    const photoInput = e.target.closest('[data-arch-photo]');
    if (photoInput) {
      const files = [...(photoInput.files || [])];
      const id = photoInput.dataset.archPhoto;
      photoInput.value = '';
      uploadArchPhotos(id, files);
      return;
    }
    const archBox = e.target.closest('[data-arch]');
    if (archBox) {
      const id = archBox.dataset.arch;
      if (archBox.checked) archHidden.delete(id);
      else archHidden.add(id);
      archBox.closest('.project-row')?.classList.toggle('is-off', !archBox.checked);
      syncArchMarkers();
      paintAxisAll();
      return;
    }
    const layerId = e.target.closest('[data-cn-layer]')?.dataset.cnLayer;
    if (layerId) {
      const layer = getLayers().find(l => l.id === layerId);
      if (layer) setLayerOn(layer, e.target.checked, { frame: e.target.checked && !layer.bind });
      if (e.target.checked && layer) publishSectorLegend(true, layer.sector);
      return;
    }
    const schemeEl = e.target.closest('[data-cn-scheme]');
    const slug = schemeEl?.dataset.cnScheme;
    if (!slug) return;
    const { sector, level } = browseState();
    const rows = listedForScheme(sector, schemeEl.dataset.cnLevel || level, slug);
    if (e.target.checked) openSchemes.add(slug);
    rows.forEach(l => setLayerOn(l, e.target.checked));
    if (e.target.checked) publishSectorLegend(true);
  });
  document.addEventListener('qh:axis-tab', (e) => {
    const id = e.detail?.id;
    if (!id || openingAxis) return;
    levelTab = false;
    axisBeforeUrban = null;
    if (browseState().axis === id) return;
    showAxis(id);
  });
  document.addEventListener(LEVEL_EVENT, (e) => {
    if (!listenLevel) return;
    const { level, prev } = e.detail || {};
    if (!level || level === prev) return;
    if (level === 'urban') {
      if (browseState().axis !== 'hanhchinh') axisBeforeUrban = browseState().axis;
      levelTab = true;
      showAxis('hanhchinh', { url: false });
      document.querySelector('[data-admin-tab="dothi"]')?.click();
      return;
    }
    if (!levelTab || !axisBeforeUrban) return;
    const back = axisBeforeUrban;
    axisBeforeUrban = null;
    levelTab = false;
    showAxis(back, { url: false });
  });
  document.getElementById('axisDock')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-axis-dock]');
    if (tab) showAxis(tab.dataset.axisDock, { openPanel: true });
  });
  document.addEventListener('change', (e) => {
    if (applying) return;
    const id = e.target?.id;
    if (!id) return;
    const hits = getLayers().filter(l => l.bind === id);
    if (hits.length) {
      hits.forEach(l => setLayerFlag(l.id, !!e.target.checked));
      paint();
    }
    if (EXTRA_CHECKS.includes(id) || hits.length) scheduleSave();
  });
  document.addEventListener(URBAN_FOCUS_EVENT, (e) => {
    const key = e.detail || null;
    noteUrbanFocus(key, key === 'u:hue' || key === 'gp:hue');
  });
  document.addEventListener(GP_SCOPE_EVENT, (e) => {
    if (getLevel() === 'urban') return;
    const d = e.detail;
    if (!d) noteUrbanFocus(null, false);
    else noteUrbanFocus(`gp:${d.id}`, !!d.city || d.id === 'hue');
  });
  document.addEventListener('cadparcels:loaded', () => { paint(); paintMatrix(); });
  onFacet(() => paint());
  document.getElementById('cnMatrix')?.addEventListener('toggle', (e) => { if (e.target.open) paintMatrix(); });

  const track = document.getElementById('layerMagTrack');
  let swipeX = null;
  let swiped = false;
  track?.addEventListener('pointerdown', (e) => {
    swipeX = e.clientX;
    if (e.pointerType === 'touch') track.setPointerCapture?.(e.pointerId);
  });
  track?.addEventListener('pointerup', (e) => {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) < 42) return;
    stepMag(dx < 0 ? 1 : -1);
    swiped = true;
    setTimeout(() => { swiped = false; }, 0);
  });
  track?.addEventListener('click', (e) => {
    if (openingAxis || magGoing) return;
    if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); return; }
    const tab = e.target.closest('[data-main-tab]');
    if (!tab) return;
    if (tab.dataset.mainTab !== browseState().axis) { setMagMenu(false); return; }
    e.stopPropagation();
    e.preventDefault();
    const menu = document.getElementById('layerMagMenu');
    setMagMenu(!!menu?.hidden);
  }, true);
  document.getElementById('layerMag')?.addEventListener('click', (e) => {
    const step = e.target.closest('[data-mag-step]');
    if (step) { stepMag(Number(step.dataset.magStep)); return; }
    const go = e.target.closest('[data-mag-go]');
    if (!go) return;
    goMag(go.dataset.magGo);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#layerMag')) setMagMenu(false);
  });
  window.addEventListener('resize', () => { if (!document.getElementById('layerMagMenu')?.hidden) placeMagMenu(); });
  if (openDeep) showAxis(browseState().axis, { url: false, keepCamera: searchParams().has('ll') });
  else if (!shareView) showAxis('quyhoach', { url: false });
  else showAxis(getLevel() === 'urban' ? 'hanhchinh' : (browseState().axis || 'quyhoach'), { url: false });
  listenLevel = true;
  document.getElementById('layerMain')?.addEventListener('change', (e) => {
    const sectorPick = e.target.closest('[data-cn-sector-pick]');
    if (sectorPick) {
      const id = sectorPick.value;
      if (id === 'tong-hop-duong-ong') pipeOn = true;
      else {
        pipeOn = false;
        setBrowseState({ sector: id, axis: 'hatang' });
      }
      paint();
      publishSectorLegend(true);
      scheduleSave();
      return;
    }
    const levelPick = e.target.closest('[data-cn-level-pick]');
    if (levelPick) {
      setBrowseState({ level: levelPick.value });
      paint();
      scheduleSave();
      return;
    }
    const areaPick = e.target.closest('[data-cn-area-pick]');
    if (areaPick) {
      setAreaFilter(parseKv(areaPick.value) || { ...AREA_TP }, 'user');
      scheduleSave();
    }
  });
  document.getElementById('rpDock')?.addEventListener('click', (e) => {
    const waterZone = e.target.closest('[data-cnu-zone]');
    if (!waterZone || waterZone.matches('input')) return;
    pickCapNuocZone(waterZone.dataset.cnuZone);
    paint();
  });
  document.getElementById('rpDock')?.addEventListener('change', (e) => {
    const master = e.target.closest('[data-cnu-zones]');
    if (master) {
      setCapNuocZones(master.checked);
      paint();
      return;
    }
    const one = e.target.closest('[data-cnu-zone-on]');
    if (one) {
      setCapNuocZoneOn(one.dataset.cnuZoneOn, one.checked);
      paint();
      return;
    }
    const box = e.target.closest('#legendHtkt [data-cn-form]');
    if (!box) return;
    const id = box.dataset.cnForm;
    if (box.disabled || pipeOn) {
      box.checked = pipeOn ? id === 'line' : !!geomOn[id];
      return;
    }
    if (!box.checked && !['point', 'line', 'polygon'].some(key => key !== id && geomOn[key])) {
      box.checked = true;
      return;
    }
    geomOn[id] = box.checked;
    paint();
  });
  document.getElementById('layerSearch')?.addEventListener('input', (e) => {
    layerQuery = e.target.value || '';
    paintAdminList();
    paintXahoiList();
    applyLayerQuery();
  });
  onViewChange(({ view }) => {
    if (adminMapOn && view === 'QH') {
      adminColumn = 'QH';
      setViewMode('HT');
      showUrbanPlanOnBase(true);
      return;
    }
    paintViewSwitch();
  });
  paintViewSwitch();
  initXahoiList();
  const gp = document.getElementById('gpList');
  if (gp) new MutationObserver(() => filterGp()).observe(gp, { childList: true });

  loadKienTruc();
  initCapacityEditor();
  initCapNuocMap();
  Promise.all([loadFacetCatalog(), loadSynth(), loadPlanRadii(), loadCongSuat(), loadCapNuocDoc()]).then(() => {
    seedFromDom();
    if (saved) {
      applyExtra(saved);
      applySavedLayers(saved);
      seedFromDom();
    }
    // Bản lưu chạy sau setLevel đầu tiên. Gọi lại để cấp không bị ô QHPK kéo đi.
    if (!shareView && !openDeep) setLevel('qhc25', { keepView: true });
    ready = true;
    mountCapacityHosts();
    paint();
  }).catch(err => {
    ready = true;
    console.warn('Bốn trục', err);
  });
}
