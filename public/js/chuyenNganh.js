// Bốn trục là tab cấp một của panel Lớp dữ liệu, cùng tab Khu đất. Cùng một cờ bật/tắt: checkbox có bind dùng lớp sẵn,
// lớp catalog chỉ tải GeoJSON khi bật và gỡ layer khi tắt.
import { map } from './mapEngine.js';
import { planMap, getViewMode } from './planMap.js';
import { getLevel, setLevel, LEVEL_EVENT } from './mapLevel.js';
import { state } from './state.js';
import { escapeHtml, ico, showToast, RIGHT_TAB_EVENT } from './utils.js';
import { withAssetVersion } from './gbaVersion.js';
import { toFeatureCollection } from './geoDoc.js';
import { GP_SCOPE_EVENT, URBAN_FOCUS_EVENT } from './generalPlan.js';
import { ROAD_CLASSES, RAIL_KINDS, ROAD_STAGES } from './qhcRoads.js';
import {
  AXES, AREA_TP, SECTORS, FACET_LEVELS, listAreas, areaLabel, formatKv, parseKv, getLayers,
  getAreaFilter, isLayerOn, setLayerFlag, layerPassesFilter, noteUrbanFocus, setBrowseState,
  setAreaFilter, readFacetUrl, loadFacetCatalog, onFacet, schemesAt, schemesForSector, layersFor, baseLayers, browseState
} from './facetStore.js';

const STORE_KEY = 'qh_axes_v1';
const EXTRA_CHECKS = ['chk_gt25', 'chk_gt10', 'chk_gt25rail', 'chk_gt10rail', 'chk_bound', 'chk_urban', 'chk_projects', 'chk_qhct'];
const SHARE_KEYS = ['ll', 'ly', 'lv', 'm', 'sp', 'bf', 'lb', 'tho', 'da'];
const KIND_LABEL = { 'hien-trang': 'Hiện trạng khi lập đồ án', 'quy-hoach': 'Quy hoạch' };

const ICONS = {
  'giao-thong': '<path d="M8 3 4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3"/>',
  'cap-nuoc': '<path d="M12 3s6 6.2 6 10.2A6 6 0 0 1 6 13.2C6 9.2 12 3 12 3z"/>',
  'cap-dien': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  'san-nen-thoat-mua': '<path d="m3 18 5-8 4 5 3-4 6 7"/><path d="M4 21h16"/>',
  'thoat-nuoc-thai': '<path d="M4 7h16M6 7c0 6 2 8 6 8s6-2 6-8"/><path d="M12 15v4M9 19h6"/>',
  'chat-thai-ran-nghia-trang': '<path d="M12 3v18M7 7.5h10M8.5 21l3.5-6 3.5 6"/>',
  'thong-tin-lien-lac': '<path d="M12 20v-6"/><path d="M8 14a6 6 0 0 1 8 0"/><path d="M5 11a10 10 0 0 1 14 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>'
};
const SECTOR_COLOR = {
  'giao-thong': '#0284c7',
  'cap-nuoc': '#0369a1',
  'cap-dien': '#dc2626',
  'san-nen-thoat-mua': '#a16207',
  'thoat-nuoc-thai': '#7c2d12',
  'chat-thai-ran-nghia-trang': '#57534e',
  'thong-tin-lien-lac': '#7c3aed'
};
const DOCK_ICON = {
  hanhchinh: '<path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-6h4v6"/>',
  quyhoach: '<path d="M4 5h16v14H4z"/><path d="M4 10h16M10 10v9"/>',
  hatang: '<path d="M4 17h16M6 17V8h4v9M14 17V5h4v12"/>',
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
  'qhc-tt-phu-loc-19e96a86', 'qhc-do-thi-moi-vinh-hung-8899f27b', 'qhc-khu-cong-nghiep-phong-dien-f997bd2c'
]);
let areaQuery = '';
let applying = false;
let booted = false;
let ready = false;
let saveTimer = 0;
let kienTruc = null;

const icon = (id) => `<svg class="cn-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ''}</svg>`;
const soon = (label) => `<button type="button" class="cn-soon" disabled>${escapeHtml(label)} <small>Sắp có</small></button>`;

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

function loadFile(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, fetch(withAssetVersion(file)).then(res => {
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
  if (bits.length) html += `<br>${escapeHtml(bits.join(' · '))}`;
  if (props.tam_thoi) {
    const scale = props.nguon_ty_le ? `1/${Number(props.nguon_ty_le).toLocaleString('vi-VN')}` : '';
    const src = [props.nguon_ten || props.nguon_do_an, props.nguon_nam, scale].filter(Boolean);
    html += `<br><small>Tạm thời. Nguồn: ${escapeHtml(src.join(' · ') || 'không rõ đồ án')}</small>`;
  } else if (!bits.length) html += `<br>${escapeHtml(layer.name)}`;
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
      const color = featureColor(layer, f.properties || {});
      return L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 });
    },
    onEachFeature: (f, l) => {
      const props = f.properties || {};
      if (props.tam_thoi) {
        const src = props.nguon_ten || props.nguon_do_an || 'đồ án';
        l.bindTooltip(`Nguồn: ${src}`, { sticky: true, opacity: 0.95 });
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
  const on = getLayers().filter(l => isLayerOn(l.id)).map(l => l.id);
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
  return `<div class="cn-legend" aria-label="Chú giải ${escapeHtml(label)}"><span><i style="background:${color}"></i>${escapeHtml(label)}</span>${dash}</div>`;
}

function scopeHtml() {
  const area = getAreaFilter() || AREA_TP;
  return `<p class="axis-scope">Phạm vi: ${escapeHtml(areaLabel(area))}</p>`;
}

function schemeBlock(sector, levelId, scheme) {
  const all = layersFor(sector, levelId, scheme.slug, { filter: false });
  const shown = all.filter(layerPassesFilter);
  const has = shown.length > 0;
  const on = has && shown.every(l => isLayerOn(l.id));
  const some = shown.some(l => isLayerOn(l.id));
  const open = has && openSchemes.has(scheme.slug);
  const groups = ['hien-trang', 'quy-hoach'].map(kind => {
    const rows = shown.filter(l => l.kind === kind);
    if (!rows.length && !open) return '';
    const body = rows.length
      ? rows.map(l => `<label class="cn-layer"><input type="checkbox" data-cn-layer="${escapeHtml(l.id)}"${isLayerOn(l.id) ? ' checked' : ''}><span>${escapeHtml(l.name)}</span>${l.featureCount != null ? `<small>${l.featureCount}</small>` : ''}</label>`).join('')
      : '<p class="cn-empty">Chưa có lớp</p>';
    return `<div class="cn-status"><b>${KIND_LABEL[kind]}</b>${body}</div>`;
  }).join('');
  return `<div class="cn-scheme${has ? '' : ' is-missing'}">
    <div class="cn-scheme-row">
      <label><input type="checkbox" data-cn-scheme="${escapeHtml(scheme.slug)}" data-cn-level="${escapeHtml(levelId)}"${on ? ' checked' : ''}${has ? '' : ' disabled'}${some && !on ? ' data-mixed="1"' : ''}><span>${escapeHtml(scheme.name)}</span></label>
      <b class="cn-badge ${has ? 'is-on' : 'is-off'}">${has ? 'Có dữ liệu' : 'Chưa có'}</b>
      ${has ? `<button type="button" class="cn-fold" data-cn-fold="${escapeHtml(scheme.slug)}" aria-expanded="${open}">${ico(open ? 'chev-down' : 'chev-right')}</button>` : ''}
    </div>
    ${open ? `<div class="cn-groups">${groups}</div>` : ''}
  </div>`;
}

function paintHaTang() {
  const box = document.getElementById('browseNganh');
  if (!box || browseState().axis !== 'hatang') return;
  const { sector, level } = browseState();
  const pane = document.getElementById('layerPaneHaTang');
  const top = pane ? pane.scrollTop : 0;
  const catalog = state.projectCatalog || [];
  const schemes = schemesForSector(sector, level, catalog);
  const listed = schemes.flatMap(s => layersFor(sector, s.level, s.slug));
  const allOn = listed.length > 0 && listed.every(l => isLayerOn(l.id));
  box.innerHTML = `<div class="cn-sectors" role="tablist" aria-label="Hạ tầng">${SECTORS.map(s => `<button type="button" class="cn-sector${s.id === sector ? ' active' : ''}" role="tab" data-cn-sector="${s.id}" aria-selected="${s.id === sector}" title="${escapeHtml(s.label)}">${icon(s.id)}<span>${escapeHtml(s.label)}</span></button>`).join('')}</div>
    <div class="cn-tools">
      <div class="cn-levels" role="group" aria-label="Cấp đồ án">${FACET_LEVELS.map(l => `<button type="button" class="cn-level${l.id === level ? ' active' : ''}" data-cn-level="${l.id}">${escapeHtml(l.label)}</button>`).join('')}</div>
      <button type="button" class="layer-eye-btn" data-cn-all ${listed.length ? '' : 'disabled'}>${allOn ? 'Tắt tất cả' : 'Bật tất cả'}</button>
      ${soon('Thống kê')}${soon('Khớp nối')}${soon('So sánh hiện trạng – quy hoạch')}
    </div>
    ${scopeHtml()}
    ${legendHtml(sector)}
    <div class="cn-schemes">${schemes.length ? schemes.map(s => schemeBlock(sector, s.level, s)).join('') : '<p class="cn-empty">Chưa có đồ án ở cấp này.</p>'}</div>`;
  box.querySelectorAll('[data-mixed="1"]').forEach(el => { el.indeterminate = true; });
  if (pane) pane.scrollTop = top;
}

function paintBase(axisId, hostId, sector) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const rows = baseLayers({ axis: axisId, sector, filter: true });
  if (!rows.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<h3 class="axis-base-title">Dữ liệu hiện trạng</h3>${rows.map(l => `<label class="cn-layer"${l.hint ? ` title="${escapeHtml(l.hint)}"` : ''}><input type="checkbox" data-cn-layer="${escapeHtml(l.id)}"${isLayerOn(l.id) ? ' checked' : ''}><span>${escapeHtml(l.name)}</span></label>`).join('')}`;
}

function paintAdmin() {
  const box = document.getElementById('axisHanhChinh');
  if (!box) return;
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `<p class="axis-scope" id="axisScopeAdmin"></p>
      <input type="search" id="axisAreaFilter" class="project-search" placeholder="Tìm đô thị, xã, phường..." aria-label="Tìm khu vực">
      <div id="axisAreaList"></div>
      <div id="axisAreaTools"></div>`;
    box.querySelector('#axisAreaFilter')?.addEventListener('input', (e) => {
      areaQuery = e.target.value || '';
      paintAdminList();
    });
  }
  const scope = document.getElementById('axisScopeAdmin');
  if (scope) scope.textContent = `Phạm vi: ${areaLabel(getAreaFilter() || AREA_TP)}`;
  paintAdminList();
}

function paintAdminList() {
  const list = document.getElementById('axisAreaList');
  const tools = document.getElementById('axisAreaTools');
  if (!list) return;
  const current = formatKv(getAreaFilter() || AREA_TP);
  const q = areaQuery.trim().toLowerCase();
  const match = (a) => !q || a.name.toLowerCase().includes(q) || a.code.includes(q);
  const button = (a) => {
    const kv = formatKv(a);
    const on = kv === current;
    return `<button type="button" class="axis-area${on ? ' active' : ''}" data-kv="${escapeHtml(kv)}" aria-pressed="${on}">${escapeHtml(a.name)}</button>`;
  };
  const towns = listAreas('dothi').filter(match);
  const wards = listAreas('xa').filter(match);
  const tp = listAreas('tp')[0] || { ...AREA_TP, name: 'Toàn thành phố' };
  list.innerHTML = `${match(tp) ? button(tp) : ''}
    <details class="axis-area-group" open><summary>Đô thị (${towns.length})</summary><div class="axis-area-list">${towns.map(button).join('') || '<p class="cn-empty">Không khớp</p>'}</div></details>
    <details class="axis-area-group" ${q ? 'open' : ''}><summary>Xã/phường (${wards.length})</summary><div class="axis-area-list">${wards.map(button).join('') || '<p class="cn-empty">Không khớp</p>'}</div></details>`;
  const area = getAreaFilter() || AREA_TP;
  if (tools) {
    tools.innerHTML = (area.type === 'dothi' || area.type === 'xa')
      ? `<div class="cn-tools">${soon('Đánh giá phân loại đô thị')}</div>` : '';
  }
}

function paintKienTruc() {
  const box = document.getElementById('axisKienTruc');
  if (!box || browseState().axis !== 'kientruc') return;
  const quy = kienTruc?.quyChe?.items || [];
  const ct = kienTruc?.congTrinh?.items || [];
  const list = (items, render) => items.length ? `<ul class="axis-arch-list">${items.map(render).join('')}</ul>` : '<p class="cn-empty">Chưa có dữ liệu</p>';
  box.innerHTML = `${scopeHtml()}
    <section class="axis-arch"><h3>Quy chế quản lý kiến trúc</h3>${list(quy, item => `<li><b>${escapeHtml(item.name || item.id || 'Quy chế')}</b>${item.doc?.title ? `<small>${escapeHtml(item.doc.title)}</small>` : ''}</li>`)}</section>
    <section class="axis-arch"><h3>Công trình kiến trúc có giá trị</h3>${list(ct, item => `<li><b>${escapeHtml(item.ten || item.id || 'Công trình')}</b>${item.phuong ? `<small>${escapeHtml(item.phuong)}</small>` : ''}</li>`)}</section>`;
}

function paintScopes() {
  const q = document.getElementById('axisScopeQuyHoach');
  if (q) q.innerHTML = `Phạm vi: ${escapeHtml(areaLabel(getAreaFilter() || AREA_TP))}`;
}

function paintDock() {
  const axis = browseState().axis;
  document.querySelectorAll('[data-axis], [data-axis-dock]').forEach(btn => {
    const id = btn.dataset.axis || btn.dataset.axisDock;
    const on = id === axis;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

function paint() {
  paintDock();
  paintScopes();
  const axis = browseState().axis;
  paintAdmin();
  if (axis === 'hatang') paintHaTang();
  if (axis === 'kientruc') paintKienTruc();
  paintBase('quyhoach', 'baseQuyHoach');
  paintBase('hatang', 'baseHaTang', browseState().sector);
  paintBase('kientruc', 'baseKienTruc');
  const tools = document.getElementById('axisToolsQuyHoach');
  if (tools && !tools.dataset.ready) {
    tools.dataset.ready = '1';
    tools.innerHTML = `${soon('Thống kê')}${soon('Khớp nối')}${soon('So sánh hiện trạng – quy hoạch')}`;
  }
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
let listenLevel = false;
let levelTab = false;
let axisBeforeUrban = null;

function showAxis(id, { openPanel = false, url = true } = {}) {
  if (!AXES.some(a => a.id === id)) return;
  setBrowseState({ axis: id }, { url });
  openingAxis = true;
  document.querySelector(`[data-main-tab="${id}"]`)?.click();
  openingAxis = false;
  if (openPanel) document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLayers', open: true } }));
  paint();
  scheduleSave();
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
    const on = want.has(l.id);
    if (l.bind) {
      setLayerFlag(l.id, on);
      reflectBind(l.bind, on);
      return;
    }
    if (on) setLayerOn(l, true);
    else setLayerFlag(l.id, false);
  });
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
  if (browseState().axis === 'kientruc') paintKienTruc();
}

export function initChuyenNganh() {
  if (booted || !document.getElementById('axisHanhChinh')) return;
  booted = true;
  const q = searchParams();
  const shareView = SHARE_KEYS.some(k => q.has(k));
  const facetLink = ['kv', 'nganh', 'truc', 'tt'].some(k => q.has(k));
  const saved = !shareView && !facetLink ? readSaved() : null;
  const deep = readFacetUrl();

  if (saved) {
    if (saved.kv) setAreaFilter(parseKv(saved.kv) || AREA_TP, 'saved', { url: false });
    setBrowseState({ axis: saved.axis || 'quyhoach', sector: saved.sector, level: saved.level }, { url: false });
    setLevel(saved.mapLevel || 'qhc25', { keepView: true });
    showPlanPane();
  } else if (!shareView) {
    if (!q.has('kv')) setAreaFilter({ ...AREA_TP }, 'startup', { url: false });
    setBrowseState({ axis: deep.axis || 'quyhoach', sector: deep.nganh || browseState().sector, level: 'QHC25' }, { url: false });
    setLevel('qhc25', { keepView: true });
    showPlanPane();
    openQhc25Layers();
  } else if (deep.axis || deep.nganh) {
    setBrowseState({ axis: deep.axis || (deep.nganh ? 'hatang' : 'quyhoach'), sector: deep.nganh || undefined }, { url: false });
  }

  document.getElementById('layerMain')?.addEventListener('click', (e) => {
    const sectorBtn = e.target.closest('[data-cn-sector]');
    if (sectorBtn) {
      setBrowseState({ sector: sectorBtn.dataset.cnSector, axis: 'hatang' });
      paint();
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
    const kvBtn = e.target.closest('[data-kv]');
    if (kvBtn) {
      setAreaFilter(parseKv(kvBtn.dataset.kv) || AREA_TP, 'user');
      return;
    }
    if (e.target.closest('[data-cn-all]')) {
      const { sector, level } = browseState();
      const listed = schemesForSector(sector, level, state.projectCatalog || []).flatMap(s => layersFor(sector, s.level, s.slug));
      const turnOn = listed.some(l => !isLayerOn(l.id));
      listed.forEach(l => setLayerOn(l, turnOn));
    }
  });
  document.getElementById('layerMain')?.addEventListener('change', (e) => {
    const layerId = e.target.closest('[data-cn-layer]')?.dataset.cnLayer;
    if (layerId) {
      const layer = getLayers().find(l => l.id === layerId);
      if (layer) setLayerOn(layer, e.target.checked, { frame: e.target.checked && !layer.bind });
      return;
    }
    const schemeEl = e.target.closest('[data-cn-scheme]');
    const slug = schemeEl?.dataset.cnScheme;
    if (!slug) return;
    const { sector, level } = browseState();
    const rows = layersFor(sector, schemeEl.dataset.cnLevel || level, slug);
    if (e.target.checked) openSchemes.add(slug);
    rows.forEach(l => setLayerOn(l, e.target.checked));
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

  const openDeep = q.has('nganh') || q.has('truc');
  if (openDeep) showAxis(browseState().axis, { openPanel: true, url: false });
  else paint();
  listenLevel = true;

  loadKienTruc();
  loadFacetCatalog().then(() => {
    seedFromDom();
    if (saved) {
      applyExtra(saved);
      applySavedLayers(saved);
      seedFromDom();
    }
    ready = true;
    paint();
  }).catch(err => {
    ready = true;
    console.warn('Bốn trục', err);
  });
}
