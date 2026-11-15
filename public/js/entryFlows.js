// Sáu trục đề xuất: Phát triển đô thị, Quy hoạch, Hạ tầng kỹ thuật, Hạ tầng xã hội, Kiến trúc, Dự án.
// Quản trị ghi thẳng lớp công bố. Cán bộ CanBo gửi hàng chờ. Chưa đăng nhập thì không gửi.
import { map } from './mapEngine.js';
import { planMap, getViewMode, isSplitOn, setViewMode } from './planMap.js';
import { setLevel } from './mapLevel.js';
import { state } from './state.js';
import { escapeHtml, announceTool, fmtNum } from './utils.js';
import { SECTORS, FACET_LEVELS, listAreas, setBrowseState } from './facetStore.js';
import {
  isAdminEntry, allowedEntryKeys, isEntrySignedIn, entryOfficerName, postEntry, assertOfficerUnit, stageOrPublish
} from './entryKernel.js';
import { FLOW_IDS as REGISTRY_FLOW_IDS } from './entryRegistry.js';
import { allEntrySteps, visibleEntrySteps, PUBLISH_KIND } from './entrySteps.js';
import { typeOptionsHtml } from './pointEntrySchema.js';
import { EVAL_URBANS, fieldsForScope, gapRows } from './urbanEntrySchema.js';
import { readUnit, writeUnit, replaceAll, officerCanEdit, readAll } from './urbanInputs.js';
import {
  ingestSchemeFile, ingestKhFile, tagFeatures, asCollection, DRAW_MAX_BYTES,
  SCHEME_EDGE_M, schemeBoundaryOf, clipSchemeLots, clipSentence
} from './schemeIngest.js';
import { PDF_ADMIN_MAX_BYTES } from './pdfLimits.js';
import { loadCongSuat } from './congSuat.js';
import { hosoCapacityHtml, readHosoCapacity, gateHosoCapacity, storeHosoCapacity } from './congSuatUi.js';
import { setAdjustPanelVisible } from './adjustImport.js';
import { planLevelOf } from './generalPlan.js';
import { INVEST_GROUPS, investGroupLabel } from './investClassify.js';
import { CRS_PRESETS, detectAxes, vn2000ToWgs84 } from './cadImport.js';
import {
  projectStamps, matchStamps, stampAreaM2, stampLabel, STAMP_AREA_TOL,
  lotMissingStampAttrs, lotsSameLandType, stampAreaVsLots, stampPendingWhy
} from './landStamp.js';
import { stampPendingBoxHtml, stampStatusNoteHtml } from './stampUi.js';
import { landColor } from './tt16Symbols.js';
import { ensureSoTayItems } from './catalogTable.js';
import { schemePickOptions } from './catalogTableCore.js';
import { projectAreaOf } from './projectFiles.js';
/** Phạm vi WGS84 quanh TP. Huế — tem chiếu ra ngoài coi là lệch CRS. */
const HUE_LAT = [15.5, 17.2];
const HUE_LNG = [106.5, 108.6];
function inHueBbox(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= HUE_LAT[0] && lat <= HUE_LAT[1]
    && lng >= HUE_LNG[0] && lng <= HUE_LNG[1];
}

const MB = 1024 * 1024;
const $ = (id) => document.getElementById(id);

/** Tooltip gọn — một vòng tròn, dấu ? giữa (không dùng SVG có sẵn vòng → tránh đôi viền). */
function tipHtml(text, label = 'Gợi ý') {
  const tip = String(text || '').trim();
  if (!tip) return '';
  return `<button type="button" class="entry-help" title="${escapeHtml(tip)}" aria-label="${escapeHtml(label)}"><span class="entry-help-q" aria-hidden="true">?</span></button>`;
}

/** Ba chỉ tiêu công suất gọn trên form đồ án mới (khớp CAPACITY_METRICS). */
const HO_CAP_INLINE = [
  { sector: 'cap-dien', chiTieu: 'cong-suat', label: 'Công suất cấp điện', unit: 'kVA' },
  { sector: 'cap-nuoc', chiTieu: 'cong-suat', label: 'Công suất cấp nước', unit: 'm³/ngđ' },
  { sector: 'thoat-nuoc-thai', chiTieu: 'cong-suat', label: 'Thoát nước', unit: 'm³/ngđ' }
];

function hoCapacityInlineHtml(draft = {}) {
  const values = draft.values || {};
  return `<div class="entry-row entry-row-3">${HO_CAP_INLINE.map((m) => {
    const row = values[m.sector] || {};
    return `<div class="entry-field">
      <label>${escapeHtml(m.label)}</label>
      <input data-ho-cs="${escapeHtml(m.sector)}" data-ho-chi="${escapeHtml(m.chiTieu)}" inputmode="decimal" value="${escapeHtml(row.giaTri || '')}" placeholder="${escapeHtml(m.unit)}" aria-label="${escapeHtml(m.label)}">
      <input type="hidden" data-ho-unit="${escapeHtml(m.sector)}" value="${escapeHtml(row.donVi || m.unit)}">
    </div>`;
  }).join('')}</div>`;
}

function entryPairs(fields) {
  const rows = [];
  for (let i = 0; i < fields.length; i += 2) {
    const a = fields[i] || '';
    const b = fields[i + 1] || '';
    rows.push(`<div class="entry-row">${a}${b}</div>`);
  }
  return rows.join('');
}

let submitInfraPoint = async () => {};
let updateRadiusPreview = () => {};
let preview = null;
let previewHalo = null;
let previewRenderer = null;
let previewHost = null;
/** Click / rê chuột bản đồ khi đang chế độ chọn lô gán tem. */
let stampLotClick = null;
let stampLotMove = null;
let stampHoverIdx = -1;

/** Cùng cadImportUi: đang xem QH thì planMap phủ kín — preview phải vẽ lên đó, không phải map hiện trạng ẩn. */
function viewMap() {
  return (planMap && getViewMode() === 'QH' && !isSplitOn() ? planMap : map);
}

/** Pane preview: trên projectFocusPane (620), dưới tooltip (650). */
const LOT_PREVIEW_Z = 635;

function lotRenderer() {
  const m = viewMap();
  if (!m) return null;
  if (!m.getPane('lotPreview')) {
    const pane = m.createPane('lotPreview');
    pane.style.zIndex = String(LOT_PREVIEW_Z);
  } else {
    m.getPane('lotPreview').style.zIndex = String(LOT_PREVIEW_Z);
  }
  if (previewHost !== m) {
    previewRenderer = null;
    previewHost = m;
  }
  // Canvas: nhiều lô QH không làm đơ SVG; cùng pane với halo/tem.
  if (!previewRenderer) previewRenderer = L.canvas({ pane: 'lotPreview' });
  return previewRenderer;
}
let stepId = 'ranh';
let hoMode = 'new';
let landMode = 'new';
let netSector = 'giao-thong';
let htktPane = 'net';
let ptTab = 'dvhc';
let ktMode = 'quyche';
let daGeom = null;
let hoCs = { id: '', parent: '', values: {} };
/** Diện tích (ha) / dân số HT·QH tùy chọn — diện tích lệch ranh > 1% thì lỗi. */
let hoExtra = { areaHa: '', danSoHt: '', danSoQh: '' };
let crsId = 'HUE_3';
let crsLon0 = '';
const held = {};
const AREA_TOL = 0.01;

const STEPS = allEntrySteps();
function visibleSteps() {
  return visibleEntrySteps({ hoMode, netSector, stepList: STEPS });
}

function paintGroup(selector, attr, value) {
  document.querySelectorAll(selector).forEach(btn => {
    const on = btn.getAttribute(attr) === value;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

const isAdmin = isAdminEntry;
const signedIn = isEntrySignedIn;
const allowedKeys = allowedEntryKeys;

function setStampLotPickCursor(on) {
  [map, planMap].filter(Boolean).forEach((m) => {
    try {
      const el = m.getContainer && m.getContainer();
      if (el) el.classList.toggle('stamp-lot-pick', !!on);
    } catch (e) { /* map chưa sẵn */ }
  });
}

function unbindStampLotClick() {
  [previewHost, map, planMap].filter(Boolean).forEach((m) => {
    if (stampLotClick) try { m.off('click', stampLotClick); } catch (e) { /* khác host */ }
    if (stampLotMove) try { m.off('mousemove', stampLotMove); } catch (e) { /* khác host */ }
  });
  stampLotClick = null;
  stampLotMove = null;
  stampHoverIdx = -1;
  setStampLotPickCursor(false);
}

function clearPreview() {
  unbindStampLotClick();
  [previewHost, map, planMap].filter(Boolean).forEach((m) => {
    if (previewHalo) try { m.removeLayer(previewHalo); } catch (e) { /* khác host */ }
    if (preview) try { m.removeLayer(preview); } catch (e) { /* khác host */ }
  });
  previewHalo = null;
  preview = null;
}

/** Chừa panel đề xuất bên phải khi zoom tới tem / lô. */
function previewFitOpts(pad = 40, maxZoom = 18) {
  const opts = { maxZoom, animate: true, paddingTopLeft: [pad, pad], paddingBottomRight: [pad, pad] };
  const host = viewMap();
  if (!host) return opts;
  try {
    const m = host.getContainer().getBoundingClientRect();
    const panel = $('tabAdd') || $('rightPanel');
    const r = panel && !panel.hidden && panel.offsetWidth ? panel.getBoundingClientRect() : null;
    const cover = r && r.left < m.right && r.bottom > m.top
      ? Math.min(Math.max(0, m.right - r.left), m.width * 0.6)
      : 0;
    opts.paddingBottomRight = [pad + cover, pad];
  } catch (e) { /* bỏ padding panel */ }
  return opts;
}

function focusStampOnMap(bag, id) {
  const host = viewMap();
  if (!host || typeof L === 'undefined' || !bag || !id) return;
  const s = (bag.stampView || []).find(x => x.id === id);
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
  try {
    host.fitBounds(L.latLng(s.lat, s.lng).toBounds(120), previewFitOpts(48, 18));
  } catch (e) { /* tem lệch CRS */ }
}

function showPreview(features, review, opts = {}) {
  clearPreview();
  const fit = opts.fit !== false;
  const draw = [];
  (review || []).forEach(item => {
    if (!item || !item.geometry) return;
    // Lô «bỏ» ngoài ranh không vẽ — dễ nhầm tem KH lệch / đám đỏ ngoài khung.
    if (item.status === 'bo') return;
    draw.push({
      type: 'Feature',
      geometry: item.geometry,
      properties: { _mau: 'do', _status: item.status }
    });
  });
  (features || []).forEach(feature => draw.push(feature));
  const host = viewMap();
  if (!host || typeof L === 'undefined' || !draw.length) return;
  const fc = asCollection(draw);
  const ranhNew = draw.filter(f => f.properties && f.properties._mau === 'ranh-moi');
  const renderer = lotRenderer();
  // Viền trắng dưới nét đỏ — đọc được trên lớp QH nhiều màu.
  if (ranhNew.length) {
    previewHalo = L.geoJSON(asCollection(ranhNew), {
      pane: 'lotPreview',
      renderer,
      interactive: false,
      style: { color: '#ffffff', weight: 10, opacity: 0.95, fill: false }
    }).addTo(host);
  }
  preview = L.geoJSON(fc, {
    pane: 'lotPreview',
    renderer,
    style: (f) => {
      if (f.properties && f.properties._mau === 'ranh') {
        return { color: '#0f172a', weight: 2, dashArray: '6 4', fillOpacity: 0 };
      }
      if (f.properties && f.properties._mau === 'do') {
        const cut = f.properties._status === 'cat';
        return {
          color: '#dc2626',
          weight: cut ? 3 : 2,
          dashArray: cut ? '5 4' : null,
          fillColor: '#f87171',
          fillOpacity: cut ? 0.2 : 0.55
        };
      }
      if (f.properties && f.properties._mau === 'ranh-moi') {
        return {
          color: '#ef4444',
          weight: 5,
          opacity: 1,
          fillColor: '#ef4444',
          fillOpacity: 0.14
        };
      }
      // Lô sử dụng đất: màu theo layer / TT16 (không cam đồng loạt).
      if (f.properties && f.properties._mau === 'lo') {
        const hex = landColor(f.properties.layer || f.properties.nhan || '') || '#94a3b8';
        return {
          color: hex,
          weight: 1.8,
          opacity: 1,
          fillColor: hex,
          fillOpacity: 0.48
        };
      }
      return {
        color: f.geometry && f.geometry.type === 'LineString' ? '#2563eb' : '#7c3aed',
        weight: 2,
        fillColor: '#c4b5fd',
        fillOpacity: 0.28
      };
    },
    // Ranh / lô cắt chỉ xem — không chặn click chọn lô gán tem.
    onEachFeature: (f, layer) => {
      const mau = f.properties && f.properties._mau;
      const block = mau === 'ranh-moi' || mau === 'ranh' || mau === 'do';
      const setOff = (ly) => {
        if (!ly || !ly.options) return;
        if (block) ly.options.interactive = false;
      };
      setOff(layer);
      if (layer.eachLayer) layer.eachLayer(setOff);
    },
    pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
      pane: 'lotPreview',
      renderer,
      radius: 6, color: '#b45309', weight: 2, fillColor: '#fbbf24', fillOpacity: 0.95
    })
  });
  preview.addTo(host);
  previewHost = host;
  if (previewHalo && previewHalo.bringToFront) previewHalo.bringToFront();
  if (preview.bringToFront) preview.bringToFront();
  if (!fit) return;
  try {
    const b = preview.getBounds();
    if (b.isValid()) host.fitBounds(b, previewFitOpts(40, 17));
  } catch (e) { /* ranh rỗng */ }
}

function areasOf(type) {
  if (type === 'tp') return [{ type: 'tp', code: 'TP', parent: null, name: 'Thành phố Huế' }];
  return listAreas(type);
}

function unitKeyOf(type, code) {
  if (type === 'tp') return 'tp:TP';
  return `${type}:${code}`;
}

function optionsHtml(type, selected) {
  const allow = allowedKeys();
  return areasOf(type).filter(a => !allow || allow.includes(unitKeyOf(a.type, a.code))).map(a => {
    const key = unitKeyOf(a.type, a.code);
    return `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(a.name)}</option>`;
  }).join('');
}

function selectedArea(scopeId, unitId) {
  const key = $(unitId)?.value || '';
  const type = $(scopeId)?.value || 'tp';
  const hit = areasOf(type).find(a => unitKeyOf(a.type, a.code) === key);
  if (!hit) return null;
  return { type: hit.type, code: hit.code, parent: hit.parent ?? (hit.type === 'tp' ? null : 'TP') };
}

function officerBar() {
  if (isAdmin()) {
    const who = state.authUser && (state.authUser.email || state.authUser.name) || 'Quản trị';
    return `<div class="entry-officer-bar"><span class="entry-badge" title="${escapeHtml(who)}">${escapeHtml(who)}</span>${tipHtml('Đang đăng nhập quản trị. Chỉ tiêu, công trình và bản vẽ ghi thẳng bản công bố. Đồ án đã có lớp sử dụng đất hoặc ranh thì không thêm bản sao.')}</div>`;
  }
  if (signedIn()) {
    const who = state.authUser && (state.authUser.email || state.authUser.name) || 'Cán bộ';
    return `<div class="entry-officer-bar"><span class="entry-badge" title="${escapeHtml(who)}">${escapeHtml(who)}</span>${tipHtml('Danh sách đơn vị lấy từ tab CanBo. Bản gửi vào hàng chờ, chưa hiện trên bản đồ công khai.')}</div>`;
  }
  return `<div class="entry-officer-bar"><span class="entry-badge">Chưa đăng nhập</span>${tipHtml('Đăng nhập Google. Email có trong tab CanBo và Trạng thái TRUE mới gửi được, đúng đơn vị được giao. Quản trị không bị khóa đơn vị.')}</div>`;
}

function paintOfficer() {
  const box = $('entryOfficer');
  if (!box) return;
  box.innerHTML = officerBar();
}

function scopeOfKey(key) {
  if (!key || key === 'tp:TP') return 'tp';
  if (key.startsWith('dothi:')) return 'dothi';
  if (key.startsWith('xa:')) return 'xa';
  return 'tp';
}

function unitName(key) {
  if (!key) return '';
  const urban = EVAL_URBANS.find(u => u.key === key);
  if (urban) return urban.name;
  const [type, code] = key.split(':');
  const hit = areasOf(type === 'tp' ? 'tp' : type).find(a => unitKeyOf(a.type, a.code) === key);
  return hit?.name || '';
}

function isPhuongUnit(key) {
  return /^phường\b/i.test(unitName(key));
}

function hcActions(root) {
  root.querySelector('#hcUnit')?.addEventListener('change', renderHanhChinh);
  root.querySelector('#hcSave')?.addEventListener('click', saveHanhChinh);
  root.querySelector('#hcLoad')?.addEventListener('click', loadHanhChinh);
}

function renderHanhChinh() {
  const root = $('flowPhatTrienBody');
  if (!root) return;
  const allow = allowedKeys();
  const locked = Array.isArray(allow) && allow.length === 1;
  const prev = $('hcUnit')?.value || '';
  if (ptTab === 'dothi') {
    const choices = EVAL_URBANS.filter(u => !allow || allow.includes(u.key));
    let unit = choices.some(u => u.key === prev) ? prev : (choices[0]?.key || '');
    if (locked && choices.some(u => u.key === allow[0])) unit = allow[0];
    const scope = unit.startsWith('tp:') ? 'tp' : 'dothi';
    const saved = { ...(readUnit(unit) || {}) };
    const urban = EVAL_URBANS.find(u => u.key === unit);
    if (urban && !saved.loaiDoThi) saved.loaiDoThi = urban.cls;
    if (urban && scope === 'dothi' && !saved.hienTrangDoThi) {
      saved.hienTrangDoThi = urban.partial ? 'mot-phan' : (/mới/i.test(urban.name) ? 'moi' : 'hien-huu');
    }
    const inputs = fieldsForScope(scope).map(f => fieldHtml(f, saved[f.key] || ''));
    const opts = choices.map(u => `<option value="${escapeHtml(u.key)}"${u.key === unit ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
    root.innerHTML = `<div class="entry-head">${tipHtml('Cập nhật chỉ tiêu đô thị, hiện trạng đô thị và loại đô thị. Thời điểm cập nhật theo tháng.')}</div>
      ${choices.length ? '' : '<p class="entry-note lot-flag">Đơn vị được giao không phải đô thị. Nhập ở tab Đơn vị hành chính.</p>'}
      <div class="entry-form">
        <div class="entry-field entry-field-full">
          <label for="hcUnit">Đô thị${urban?.partial ? tipHtml(`Đô thị này là một phần xã ${urban.partial}. Dân số ước theo ranh hiện trạng; ô dân số để đính chính.`) : ''}</label>
          <select id="hcUnit"${locked && choices.length < 2 ? ' disabled' : ''}>${opts}</select>
        </div>
        ${entryPairs(inputs)}
      </div>
      <button type="button" class="btn-submit" id="hcSave">Lưu trên máy và gửi bảng</button>
      <button type="button" class="btn-submit btn-secondary" id="hcLoad">Nạp số đã gửi</button>
      <div id="hcStatus" class="rp-status" role="status"></div>
      <details class="entry-legacy"><summary>Ô còn thiếu của đơn vị này</summary>${missHtml(unit)}</details>`;
  } else {
    let unit = prev.startsWith('xa:') ? prev : (locked && String(allow[0] || '').startsWith('xa:') ? allow[0] : optionsFirst('xa'));
    const saved = readUnit(unit) || {};
    const phuong = isPhuongUnit(unit);
    const fields = fieldsForScope('xa').filter(f => (phuong ? f.key !== 'xaDatChuan' : f.key !== 'loaiPhuong'));
    const inputs = fields.map(f => fieldHtml(f, saved[f.key] || ''));
    root.innerHTML = `<div class="entry-head">${tipHtml('Cập nhật dân số và diện tích theo hiện trạng. Thời điểm cập nhật theo tháng. Phường: trình độ loại II hoặc III. Xã: mức đạt chuẩn.')}</div>
      <div class="entry-form">
        <div class="entry-field entry-field-full">
          <label for="hcUnit">Đơn vị</label>
          <select id="hcUnit"${locked ? ' disabled' : ''}>${optionsHtml('xa', unit)}</select>
        </div>
        ${entryPairs(inputs)}
      </div>
      <button type="button" class="btn-submit" id="hcSave">Lưu trên máy và gửi bảng</button>
      <button type="button" class="btn-submit btn-secondary" id="hcLoad">Nạp số đã gửi</button>
      <div id="hcStatus" class="rp-status" role="status"></div>
      <details class="entry-legacy"><summary>Ô còn thiếu của đơn vị này</summary>${missHtml(unit)}</details>`;
  }
  hcActions(root);
}

function optionsFirst(scope) {
  const allow = allowedKeys();
  const list = areasOf(scope).filter(a => !allow || allow.includes(unitKeyOf(a.type, a.code)));
  const first = list[0];
  return first ? unitKeyOf(first.type, first.code) : '';
}

function fieldHtml(f, value) {
  const id = `hc-${f.key}`;
  if (f.kind === 'month') {
    return `<div class="entry-field"><label for="${id}">${escapeHtml(f.label)}</label>
      <input id="${id}" data-field="${f.key}" type="month" value="${escapeHtml(value)}"></div>`;
  }
  if (f.kind === 'num') {
    return `<div class="entry-field"><label for="${id}">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ''}</label>
      <input id="${id}" data-field="${f.key}" type="number" min="0" step="any" value="${escapeHtml(value)}" placeholder="${f.optional ? 'Không bắt buộc' : ''}"></div>`;
  }
  const opts = (f.options || []).map(o => `<option value="${o.value}"${value === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<div class="entry-field"><label for="${id}">${escapeHtml(f.label)}</label>
    <select id="${id}" data-field="${f.key}"><option value="">Chưa nhập</option>${opts}</select></div>`;
}

function missHtml(unitKey) {
  const rows = gapRows().filter(r => r.unitKey === unitKey);
  if (!rows.length) return '<p class="entry-note">Chưa có dòng đối chiếu cho đơn vị này.</p>';
  const body = rows.map(r => {
    const filled = r.key && readUnit(unitKey)?.[r.key];
    const label = filled ? 'Đã nhập trên máy' : r.label;
    return `<tr><td>${escapeHtml(r.field)}</td><td>${escapeHtml(r.code)}</td><td>${escapeHtml(label)}</td></tr>`;
  }).join('');
  return `<table class="entry-miss"><thead><tr><th>Trường</th><th>Mã</th><th>Trạng thái</th></tr></thead><tbody>${body}</tbody></table>`;
}

function collectFields(root) {
  const fields = {};
  root?.querySelectorAll('[data-field]').forEach(el => {
    fields[el.dataset.field] = el.value;
  });
  return fields;
}

const postJson = postEntry;

async function saveHanhChinh() {
  const status = $('hcStatus');
  const unit = $('hcUnit')?.value || '';
  const gate = assertOfficerUnit(unit);
  if (!gate.ok) {
    if (status) status.textContent = gate.message;
    return;
  }
  const fields = collectFields($('flowPhatTrienBody'));
  const officer = entryOfficerName();
  writeUnit(unit, fields, { officer });
  const [type, code] = unit.split(':');
  const name = areasOf(type === 'tp' ? 'tp' : type).find(a => unitKeyOf(a.type, a.code) === unit)?.name || unit;
  let message = '';
  try {
    const data = await postJson('saveUrbanInputs', { unitKey: unit, unitType: type, unitCode: code, unitName: name, officer, fields });
    message = data.staged ? 'Đã lưu trên máy và gửi hàng chờ duyệt.' : 'Đã lưu trên máy và ghi bảng chỉ tiêu.';
  } catch (err) {
    message = `Đã lưu trên máy. Chưa gửi được bảng: ${err.message}`;
  }
  renderHanhChinh();
  const again = $('hcStatus');
  if (again) again.textContent = message;
}

async function loadHanhChinh() {
  const status = $('hcStatus');
  try {
    const data = await postJson('getUrbanInputs', {});
    const map = {};
    (data.rows || []).forEach(r => {
      if (!r.unitKey || !r.field) return;
      if (!map[r.unitKey]) map[r.unitKey] = {};
      map[r.unitKey][r.field] = r.value;
    });
    const local = readAll();
    Object.entries(local).forEach(([k, row]) => {
      map[k] = { ...(map[k] || {}), ...row };
    });
    replaceAll(map);
    const message = `Đã nạp ${data.rows?.length || 0} ô từ bảng.`;
    renderHanhChinh();
    const again = $('hcStatus');
    if (again) again.textContent = message;
  } catch (err) {
    if (status) status.textContent = `Chưa nạp được bảng: ${err.message}`;
  }
}

function applyLandClip(step, source) {
  const prev = held[step.id] || {};
  const base = { ...prev, source };
  if (step.draw !== 'land') {
    held[step.id] = { ...base, features: source, review: [], counts: null, clipNote: '' };
    return;
  }
  const boundary = schemeBoundaryOf((held.ranh && held.ranh.source) || []);
  if (!boundary) {
    held[step.id] = {
      ...base,
      features: source,
      review: [],
      counts: null,
      clipNote: 'Chưa có ranh đồ án trong hồ sơ này, chưa lọc lô.'
    };
    applyKhToHeld(step);
    return;
  }
  const clip = clipSchemeLots(source, boundary);
  held[step.id] = { ...base, features: clip.features, review: clip.review, counts: clip.counts, clipNote: '' };
  applyKhToHeld(step);
}

function reclipLands() {
  STEPS.forEach(step => {
    if (step.draw !== 'land') return;
    const bag = held[step.id];
    if (!bag || !bag.source) return;
    applyLandClip(step, bag.source);
  });
}

function featureAreaM2(f) {
  if (!f || !f.geometry || typeof turf === 'undefined') return 0;
  try { return turf.area(f); } catch (e) { return 0; }
}

function featureRings(f) {
  const g = f && f.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function clearStampProps(features) {
  (features || []).forEach(f => {
    const p = f.properties || (f.properties = {});
    delete p.lotCode;
    delete p.kyHieu;
    delete p.TangCao;
    delete p.MatDoXD;
    delete p.HeSoSDD;
    delete p.floors;
    delete p.coverage;
    delete p.far;
    delete p.stampArea;
  });
}

function writeStampProps(feature, stamp) {
  const p = feature.properties || (feature.properties = {});
  if (stamp.code) {
    p.lotCode = stamp.code;
    p.kyHieu = stamp.code;
  }
  if (stamp.floors) {
    p.TangCao = String(stamp.floors);
    p.floors = String(stamp.floors);
  }
  if (stamp.coverage) {
    p.MatDoXD = String(stamp.coverage);
    p.coverage = String(stamp.coverage);
  }
  if (stamp.far) {
    p.HeSoSDD = String(stamp.far);
    p.far = String(stamp.far);
  }
  const m2 = stampAreaM2(stamp.areaRaw, featureAreaM2(feature));
  if (m2) p.stampArea = m2;
}

function stampCrsList() {
  if (crsId === 'WGS84') return [{ wgs84: true, label: 'WGS84' }];
  if (crsId === 'custom') {
    return [{
      label: `VN-2000 KTT ${Number(crsLon0)}°`,
      lon0: Number(crsLon0),
      k0: Math.abs(Number(crsLon0) - 105) < 0.2 ? 0.9996 : 0.9999
    }];
  }
  const picked = CRS_PRESETS[crsId] || CRS_PRESETS.HUE_3;
  return [picked, CRS_PRESETS.HUE_3, CRS_PRESETS.HUE_107_45, CRS_PRESETS.UTM48_6]
    .filter((c, i, arr) => c && arr.findIndex(q => q.lon0 === c.lon0 && q.k0 === c.k0) === i);
}

function stampProjectorFor(axes, crs) {
  if (crs && crs.wgs84) return (x, y) => [y, x];
  const f = axes && axes.valid ? axes.f : (x, y) => [x, y];
  return (x, y) => {
    const [E, N] = f(x, y);
    if ((!axes || !axes.valid) && E > 100 && E < 120 && N > 8 && N < 24) return [N, E];
    return vn2000ToWgs84(E, N, crs || CRS_PRESETS.HUE_3);
  };
}

/** Thử nhiều CRS/trục; chọn phương án nhiều tem trong bbox Huế + nhiều lô khớp nhất. */
function projectKhBest(stamps, lots) {
  const axesTries = [
    detectAxes((stamps || []).map(s => ({ pt: [s.x, s.y] }))),
    { valid: true, note: 'đảo X/Y', f: (x, y) => [y, x] },
    { valid: false, note: '', f: (x, y) => [x, y] }
  ];
  let best = null;
  stampCrsList().forEach((crs) => {
    axesTries.forEach((axes) => {
      const all = projectStamps(stamps, stampProjectorFor(axes, crs));
      const inHue = all.filter(s => inHueBbox(s.lat, s.lng));
      const pool = inHue.length ? inHue : [];
      const matched = pool.length ? matchStamps(pool, lots).assigned.length : 0;
      const score = matched * 10000 + pool.length * 10 - (all.length - pool.length);
      if (!best || score > best.score) {
        best = { projected: pool, all, score, matched, note: `${crs.label || ''}${axes.note ? ` · ${axes.note}` : ''}` };
      }
    });
  });
  return best || { projected: [], all: [], score: 0, matched: 0, note: '' };
}

/** Gán tem KH vào lô đất đang giữ (sau cắt ranh). ≥ 2 tiêu chí tự khớp; còn lại hỏi tay trên bản đồ. */
function applyKhToHeld(step) {
  const bag = held[step.id];
  if (!bag || step.draw !== 'land') return;
  clearStampProps(bag.features);
  const stamps = bag.khStamps || [];
  if (!stamps.length || !bag.features?.length) {
    bag.stampMatch = null;
    bag.stampView = null;
    bag.stampCrsNote = '';
    return;
  }
  const lots = bag.features.map((f, i) => ({
    key: String(i),
    area: featureAreaM2(f),
    rings: featureRings(f),
    layer: String(f.properties?.layer || ''),
    name: String(f.properties?.nhan || f.properties?.lotCode || '')
  }));
  const best = projectKhBest(stamps, lots);
  const projected = best.projected;
  bag.stampCrsNote = best.note || '';
  if (!projected.length) {
    bag.stampMatch = null;
    bag.stampView = [];
    bag.stampPick = null;
    bag.khWarn = `Tem KH không nằm trong phạm vi Huế sau khi chiếu (${stamps.length} tem). Kiểm tra hệ tọa độ / điểm INSERT — không vẽ ngoài bản đồ.`;
    return;
  }
  bag.khWarn = projected.length < stamps.length
    ? `Đã lọc ${stamps.length - projected.length}/${stamps.length} tem ngoài phạm vi Huế (${best.note}).`
    : '';
  const match = matchStamps(projected, lots, {
    assign: bag.stampAssign || {},
    skip: bag.stampSkip || []
  });
  bag.stampMatch = match;
  bag.stampView = projected;
  bag.stampLots = lots;
  match.assigned.forEach(a => {
    const keys = a.keys || [a.key];
    keys.forEach(k => {
      const f = bag.features[Number(k)];
      if (f) writeStampProps(f, a.stamp);
    });
  });
  if (!bag.stampDraft) bag.stampDraft = {};
  Object.keys(bag.stampDraft).forEach(id => {
    if (!match.pending.some(s => s.id === id)) delete bag.stampDraft[id];
  });
  if (!bag.stampPick || !match.pending.some(s => s.id === bag.stampPick)) {
    bag.stampPick = match.pending[0] ? match.pending[0].id : null;
    bag.stampAssignMode = false;
  }
  if (!match.pending.length) bag.stampAssignMode = false;
}

function stampBoxHtml(bag) {
  const match = bag && bag.stampMatch;
  const n = (bag && bag.khStamps && bag.khStamps.length) || 0;
  if (!bag?.khFile) return '';
  const warn = bag.khWarn
    ? `<p class="entry-note lot-flag">${escapeHtml(bag.khWarn)}</p>`
    : '';
  if (!n) {
    return warn + stampStatusNoteHtml({ fileName: bag.khFile.name, n: 0, noStamps: true });
  }
  if (!bag.features?.length) {
    return warn + stampStatusNoteHtml({ fileName: bag.khFile.name, n, noFeatures: true });
  }
  if (bag.khWarn && !(bag.stampView && bag.stampView.length)) {
    return warn + stampStatusNoteHtml({ fileName: bag.khFile.name, n, noFeatures: false, done: 0, left: n });
  }
  const pend = (match && match.pending) || [];
  const done = (match && match.assigned.length) || 0;
  const left = (match && match.unmatchedLots && match.unmatchedLots.length) || 0;
  if (!pend.length) {
    return warn + stampStatusNoteHtml({ fileName: bag.khFile.name, n, done, left });
  }
  return warn + stampPendingBoxHtml({
    pending: pend,
    pickId: bag.stampPick,
    assignMode: !!bag.stampAssignMode,
    draft: bag.stampDraft || {},
    lots: bag.stampLots || [],
    pickAttr: 'data-ho-stamp',
    skipAttr: 'data-ho-stamp-skip',
    whyAttr: 'data-ho-stamp-why',
    plusAttr: 'data-ho-stamp-plus',
    okAttr: 'data-ho-stamp-ok'
  });
}

function hasRanhPolygon() {
  const feats = held.ranh && held.ranh.features;
  return !!(feats && feats.some(f => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')));
}

function ranhMeasuredHa() {
  const feats = held.ranh && held.ranh.features;
  if (!feats || !feats.length) return null;
  let m2 = 0;
  feats.forEach(f => { m2 += featureAreaM2(f); });
  if (!(m2 > 0)) return null;
  return m2 / 10000;
}

function parseAreaHaInput(raw) {
  const s = String(raw || '').trim().replace(/\s/g, '').replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** null = không kiểm (ô trống); chuỗi = lỗi lệch > 1%. */
function areaInputError() {
  const typed = parseAreaHaInput(hoExtra.areaHa);
  if (typed == null) return null;
  if (!Number.isFinite(typed)) return 'Diện tích nhập không hợp lệ.';
  if (!(typed > 0)) return null;
  const measured = ranhMeasuredHa();
  if (!(measured > 0)) return 'Chưa đo được diện tích từ ranh — tải ranh giới trước.';
  const ratio = Math.abs(typed - measured) / measured;
  if (ratio > AREA_TOL) {
    return `Diện tích nhập (${fmtNum(typed)} ha) lệch hơn 1% so với ranh đo được (${fmtNum(Math.round(measured * 100) / 100)} ha).`;
  }
  return null;
}

function rememberHoExtra() {
  if ($('hoAreaHa')) hoExtra.areaHa = $('hoAreaHa').value || '';
  if ($('hoDanSoHt')) hoExtra.danSoHt = $('hoDanSoHt').value || '';
  if ($('hoDanSoQh')) hoExtra.danSoQh = $('hoDanSoQh').value || '';
  // Tương thích ô dân số cũ nếu còn trong DOM.
  if ($('hoDanSo') && !$('hoDanSoHt')) hoExtra.danSoHt = $('hoDanSo').value || '';
}

function showStepPreview(opts = {}) {
  const step = STEPS.find(s => s.id === stepId);
  const bag = step && held[step.id];
  if (!bag || ((!bag.features || !bag.features.length) && !(bag.review && bag.review.length))) {
    clearPreview();
    return;
  }
  const isRanh = step.draw === 'boundary';
  const isLand = step.draw === 'land';
  const focusStamp = !!(opts.focusStamp && bag.stampPick && bag.stampView?.length);
  const fit = opts.fit != null ? opts.fit : !focusStamp;
  const draw = (bag.features || []).map((f, i) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      ...(f.properties || {}),
      _lotIdx: i,
      ...(isRanh ? { _mau: 'ranh-moi' } : {}),
      ...(isLand ? { _mau: 'lo' } : {})
    }
  }));
  if (isLand && held.ranh && (held.ranh.features || held.ranh.source)) {
    (held.ranh.features || held.ranh.source).forEach(feature => {
      if (!feature || !feature.geometry) return;
      draw.push({
        type: 'Feature',
        geometry: feature.geometry,
        properties: { ...(feature.properties || {}), _mau: 'ranh-moi' }
      });
    });
  }
  showPreview(draw, bag.review || [], { fit });
  paintStampMarkers(bag);
  if (focusStamp) focusStampOnMap(bag, bag.stampPick);
}

function lotCentroidLatLng(feature) {
  if (!feature?.geometry) return null;
  try {
    if (typeof turf !== 'undefined' && turf.centroid) {
      const c = turf.centroid(feature).geometry.coordinates;
      return [c[1], c[0]];
    }
  } catch (_) { /* fallback */ }
  const rings = featureRings(feature);
  const ring = rings[0] && rings[0][0];
  if (!ring || ring.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  ring.forEach(pt => {
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
    sx += pt[0];
    sy += pt[1];
    n += 1;
  });
  if (!n) return null;
  return [sy / n, sx / n];
}

function stampLotMeta(bag, idx) {
  const f = bag.features[idx];
  if (!f) return null;
  return {
    key: String(idx),
    area: featureAreaM2(f),
    rings: featureRings(f),
    layer: String(f.properties?.layer || ''),
    name: String(f.properties?.nhan || f.properties?.lotCode || '')
  };
}

function commitStampAssign(bag, stampId, keys, { warn = true } = {}) {
  const stamp = (bag.stampView || []).find(s => s.id === stampId);
  const lots = keys.map(k => stampLotMeta(bag, Number(k))).filter(Boolean);
  const cmp = stamp ? stampAreaVsLots(stamp, lots, keys) : null;
  bag.stampAssign = { ...(bag.stampAssign || {}), [stampId]: keys.length === 1 ? keys[0] : keys };
  if (bag.stampDraft) delete bag.stampDraft[stampId];
  bag.stampAssignMode = false;
  applyKhToHeld(STEPS.find(s => s.id === stepId));
  if (warn && cmp && cmp.ratio != null && cmp.ratio > STAMP_AREA_TOL) {
    const pct = Math.round(cmp.ratio * 1000) / 10;
    announceTool(`Cảnh báo: diện tích lô lệch ${pct}% so với tem (cho phép ≤ 1%).`);
  }
}

function lotBaseStyle(feat) {
  const hex = landColor(feat?.properties?.layer || feat?.properties?.nhan || '') || '#94a3b8';
  return { color: hex, weight: 1.8, opacity: 1, fillColor: hex, fillOpacity: 0.48 };
}

function applyLotOutline(layer, kind) {
  if (!layer) return;
  const paint = (ly) => {
    if (!ly || !ly.setStyle) return;
    if (kind === 'hover') {
      ly.setStyle({ color: '#fde047', weight: 3.5, opacity: 1, fillOpacity: 0.55 });
    } else if (kind === 'draft') {
      ly.setStyle({ color: '#fbbf24', weight: 3, opacity: 1, fillOpacity: 0.52 });
    } else if (kind === 'base' && ly.feature) {
      ly.setStyle(lotBaseStyle(ly.feature));
    }
  };
  paint(layer);
  if (layer.eachLayer) layer.eachLayer(paint);
}

function findLotLayer(idx) {
  if (!preview || idx == null) return null;
  let found = null;
  preview.eachLayer((layer) => {
    if (found) return;
    if (layer.feature?.properties?._lotIdx === idx) found = layer;
  });
  return found;
}

function refreshStampLotOutlines(bag) {
  if (!preview || !bag) return;
  const draft = new Set((bag.stampDraft && bag.stampPick && bag.stampDraft[bag.stampPick]) || []);
  preview.eachLayer((layer) => {
    const idx = layer.feature?.properties?._lotIdx;
    if (idx == null) return;
    if (draft.has(String(idx))) applyLotOutline(layer, 'draft');
    else if (stampHoverIdx === idx) applyLotOutline(layer, 'hover');
    else applyLotOutline(layer, 'base');
  });
}

/** Bấm lô đỏ khi đang chế độ +: thêm/bỏ nháp — chưa ghi cho đến khi OK. */
function toggleStampLot(bag, lotIdx) {
  if (!bag?.stampAssignMode) return;
  const id = bag.stampPick;
  if (!id) return;
  const stamp = (bag.stampView || []).find(s => s.id === id);
  if (!stamp) return;
  const feat = bag.features[lotIdx];
  if (!feat) return;
  if (!lotMissingStampAttrs(feat.properties)) return;
  const key = String(lotIdx);
  const draft = [...((bag.stampDraft && bag.stampDraft[id]) || [])];
  const at = draft.indexOf(key);
  if (at >= 0) {
    draft.splice(at, 1);
  } else {
    if (draft.length) {
      const first = stampLotMeta(bag, Number(draft[0]));
      const next = stampLotMeta(bag, lotIdx);
      if (!lotsSameLandType(first, next)) {
        announceTool('Chỉ chọn các lô cùng loại (chấm đỏ).');
        return;
      }
    }
    const trial = [...draft, key];
    const metas = trial.map(k => stampLotMeta(bag, Number(k))).filter(Boolean);
    const cmp = stampAreaVsLots(stamp, metas, trial);
    if (draft.length >= 1 && cmp.stampM2 > 0 && cmp.lotM2 > cmp.stampM2 * (1 + STAMP_AREA_TOL)) {
      announceTool('Tổng diện tích các lô vượt tem hơn 1% — bỏ chọn bớt hoặc chọn lô khác.');
      return;
    }
    draft.push(key);
  }
  bag.stampDraft = { ...(bag.stampDraft || {}), [id]: draft };
  renderActive({ fit: false, focusStamp: false });
}

/** Bấm + → vào chế độ chọn lô (con trỏ dấu cộng). */
function startStampAssignMode(bag, stampId) {
  bag.stampPick = stampId;
  bag.stampAssignMode = true;
  announceTool('Đang chọn lô: bấm các lô chấm đỏ, rồi OK để ghi.');
  renderActive({ fit: false, focusStamp: true });
}

/** OK → ghi nháp tem → lô. */
function confirmStampOk(bag, stampId) {
  const id = stampId || bag.stampPick;
  if (!id) return;
  bag.stampPick = id;
  const draft = (bag.stampDraft && bag.stampDraft[id]) || [];
  if (!draft.length) {
    announceTool('Chưa chọn lô đỏ nào.');
    return;
  }
  const stamp = (bag.stampView || []).find(s => s.id === id);
  const metas = draft.map(k => stampLotMeta(bag, Number(k))).filter(Boolean);
  const cmp = stamp ? stampAreaVsLots(stamp, metas, draft) : null;
  if (draft.length > 1 && !(cmp && cmp.ok)) {
    announceTool('Nhiều lô: tổng diện tích phải khớp tem trong ± 1% trước khi OK.');
    return;
  }
  commitStampAssign(bag, id, draft, { warn: true });
  renderActive({ fit: false, focusStamp: true });
}

function pointInLotRings(lng, lat, rings) {
  if (!rings?.length) return false;
  const inRing = (ring) => {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  for (const poly of rings) {
    if (!poly?.[0] || !inRing(poly[0])) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) if (inRing(poly[k])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

/** Chỉ số lô trong bag.features chứa điểm click (lô tạm / đã cắt ranh vẫn chọn được). */
function lotIndexAt(bag, lat, lng) {
  const feats = bag && bag.features;
  if (!feats?.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return -1;
  if (typeof turf !== 'undefined' && turf.booleanPointInPolygon && turf.point) {
    const pt = turf.point([lng, lat]);
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      if (!f?.geometry) continue;
      const t = f.geometry.type;
      if (t !== 'Polygon' && t !== 'MultiPolygon') continue;
      try {
        if (turf.booleanPointInPolygon(pt, f)) return i;
      } catch (_) { /* geom lỗi */ }
    }
    return -1;
  }
  for (let i = 0; i < feats.length; i++) {
    if (pointInLotRings(lng, lat, featureRings(feats[i]))) return i;
  }
  return -1;
}

function bindStampLotPick(bag) {
  unbindStampLotClick();
  const host = viewMap();
  if (!host || !bag?.stampAssignMode || !bag.stampPick || !(bag.features || []).length) {
    setStampLotPickCursor(false);
    return;
  }
  setStampLotPickCursor(true);
  stampLotClick = (e) => {
    if (!e?.latlng) return;
    const idx = lotIndexAt(bag, e.latlng.lat, e.latlng.lng);
    if (idx < 0) return;
    const feat = bag.features[idx];
    if (!lotMissingStampAttrs(feat?.properties)) return;
    toggleStampLot(bag, idx);
  };
  stampLotMove = (e) => {
    if (!e?.latlng) return;
    const idx = lotIndexAt(bag, e.latlng.lat, e.latlng.lng);
    const feat = idx >= 0 ? bag.features[idx] : null;
    const can = !!(feat && lotMissingStampAttrs(feat.properties));
    const next = can ? idx : -1;
    if (next === stampHoverIdx) return;
    const prev = stampHoverIdx;
    stampHoverIdx = next;
    const draft = new Set((bag.stampDraft && bag.stampDraft[bag.stampPick]) || []);
    if (prev >= 0 && !draft.has(String(prev))) applyLotOutline(findLotLayer(prev), 'base');
    if (next >= 0 && !draft.has(String(next))) applyLotOutline(findLotLayer(next), 'hover');
  };
  host.on('click', stampLotClick);
  host.on('mousemove', stampLotMove);
  refreshStampLotOutlines(bag);
}

function paintStampMarkers(bag) {
  if (!preview || typeof L === 'undefined') return;
  const renderer = lotRenderer();
  const pending = new Set((bag.stampMatch?.pending || []).map(s => s.id));
  const draftKeys = new Set((bag.stampDraft && bag.stampPick && bag.stampDraft[bag.stampPick]) || []);

  (bag.features || []).forEach((f, i) => {
    const ll = lotCentroidLatLng(f);
    if (!ll) return;
    const missing = lotMissingStampAttrs(f.properties);
    const inDraft = draftKeys.has(String(i));
    const color = missing ? (inDraft ? '#fbbf24' : '#ef4444') : '#22c55e';
    L.circleMarker(ll, {
      pane: 'lotPreview',
      renderer,
      radius: inDraft ? 7 : 5,
      color: '#fff',
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.95,
      interactive: false
    }).addTo(preview);
  });

  // Chỉ vẽ tem còn chờ gán (cam) / đang chọn (hồng + nhấp nháy) — không chấm cyan tem đã khớp.
  (bag.stampView || []).forEach(s => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
    const on = pending.has(s.id);
    if (!on) return;
    const cur = s.id === bag.stampPick;
    const color = cur ? '#f472b6' : '#fb923c';
    if (cur && bag.stampAssignMode) {
      L.marker([s.lat, s.lng], {
        pane: 'lotPreview',
        interactive: false,
        icon: L.divIcon({
          className: 'stamp-pick-pulse',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          html: '<span class="stamp-pick-ring"></span>'
        })
      }).addTo(preview);
    }
    const mark = L.circleMarker([s.lat, s.lng], {
      pane: 'lotPreview',
      renderer,
      radius: cur ? 11 : 8,
      color: '#fff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95
    }).bindTooltip(stampLabel(s), { sticky: true });
    mark.on('click', (e) => {
      if (L.DomEvent) L.DomEvent.stop(e);
      startStampAssignMode(bag, s.id);
    });
    mark.addTo(preview);
  });
  bindStampLotPick(bag);
}

function reviewBody(step, bag, tagged) {
  const meta = hoMeta(step);
  const area = meta.area || {};
  return (bag.review || []).map(item => {
    const taggedProps = item.status === 'cat' && tagged[item.index] ? tagged[item.index].properties : null;
    const props = taggedProps || {
      ...(item.props || {}),
      scheme: meta.scheme || '',
      level: meta.level || '',
      sector: meta.sector || '',
      kind: meta.kind || '',
      areaType: area.type || '',
      areaCode: area.code || '',
      areaParent: area.parent == null ? '' : String(area.parent),
      step: meta.step || ''
    };
    return {
      id: item.id,
      status: item.status,
      index: item.index,
      name: item.name || '',
      geometry: item.geometry,
      props
    };
  });
}

function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function nameHits(names, query) {
  const words = foldName(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return names;
  return names.filter(n => {
    const parts = foldName(n).split(/[^a-z0-9]+/).filter(Boolean);
    return words.every(w => parts.some(p => p.startsWith(w)));
  });
}

let schemeOptsCache = [];

function schemeNames() {
  return schemeOptsCache.map(o => o.value);
}

function schemeOptHits(opts, query) {
  const words = foldName(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return opts;
  return opts.filter(o => {
    const parts = foldName(`${o.label} ${o.value}`).split(/[^a-z0-9]+/).filter(Boolean);
    return words.every(w => parts.some(p => p.startsWith(w)));
  });
}

function schemeOptionHtml(o) {
  const text = o.note ? `${o.label} · ${o.note}` : o.label;
  return `<option value="${escapeHtml(o.value)}" title="${escapeHtml(text)}">${escapeHtml(text)}</option>`;
}

async function refreshSchemeOpts() {
  let sheet = [];
  try { sheet = (await ensureSoTayItems()) || []; } catch { sheet = []; }
  schemeOptsCache = schemePickOptions(sheet, state.projectCatalog || [], {
    areaHaOf: (p) => {
      const m2 = projectAreaOf(p.tenQH);
      if (!Number.isFinite(m2) || m2 === Infinity || m2 <= 0) return null;
      return m2 / 10000;
    }
  });
  return schemeOptsCache;
}

/** Cấp facet từ tên đồ án (QHC mặc định 1/10.000; tên ghi 1/25.000 → QHC25). */
function facetLevelOf(name) {
  const kind = planLevelOf(name);
  if (kind === 'QHCT') return 'QHCT';
  if (kind === 'QHPK') return 'QHPK';
  if (/1\s*\/\s*25\.?000\b|25000/.test(String(name || ''))) return 'QHC25';
  return 'QHC10';
}

/** Facet hồ sơ (QHC25/…) → nút cấp trục B (qhc25/qhpk/…). */
const FACET_TO_MAP_LEVEL = {
  QHC25: 'qhc25',
  QHC10: 'qhc10',
  QHPK: 'qhpk',
  QHCT: 'qhct'
};

/**
 * Đưa bản đồ về trục B + đúng cấp đồ án đang nhập, chế độ xem QH —
 * để preview ranh/lô đối chiếu lớp nền cùng tỷ lệ (VD QHPK → QHPK 1/2.000).
 */
function syncPlanViewToEntryLevel(facetRaw) {
  const facet = String(facetRaw || '').trim();
  const mapLv = FACET_TO_MAP_LEVEL[facet];
  if (!mapLv) return;
  document.dispatchEvent(new CustomEvent('qh:axis-tab', {
    detail: { id: 'quyhoach', keepCamera: true }
  }));
  setBrowseState({ axis: 'quyhoach', level: facet }, { url: true });
  setLevel(mapLv, { keepView: true });
  if (!isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
}

function entryFacetLevel() {
  return $('hoLevel')?.value || facetLevelOf(schemeName()) || '';
}

function captureScheme() {
  const el = $('hoScheme');
  const neu = $('hoSchemeNew')?.value || '';
  if (!el) return { pick: '', neu };
  if (el.tagName === 'SELECT') return { pick: el.value || '', neu };
  const v = String(el.value || '').trim();
  if (v && schemeNames().includes(v)) return { pick: v, neu: '' };
  return { pick: '', neu: v || neu };
}

function schemeName() {
  const pick = $('hoScheme')?.value?.trim() || '';
  if (pick) return pick;
  if (hoMode === 'new') return $('hoSchemeNew')?.value?.trim() || '';
  return '';
}

function syncSchemeNewRow() {
  const row = $('hoSchemeNewRow');
  if (!row) return;
  if (hoMode !== 'new') {
    row.hidden = true;
    return;
  }
  row.hidden = !!($('hoScheme')?.value || '');
}

function fillHoSchemes(prefer) {
  const sel = $('hoScheme');
  if (!sel || sel.tagName !== 'SELECT') return;
  const cur = prefer != null ? prefer : (sel.value || '');
  const paint = (opts) => {
    const query = $('hoSchemeSearch')?.value || '';
    const hits = schemeOptHits(opts, query);
    const curOpt = cur && opts.find(o => o.value === cur);
    const shown = curOpt && !hits.some(o => o.value === cur) ? [curOpt, ...hits] : hits;
    sel.innerHTML = `<option value="">Chọn đồ án</option>${shown.map(schemeOptionHtml).join('')}`;
    sel.value = cur && shown.some(o => o.value === cur) ? cur : '';
    sel.size = Math.min(6, Math.max(2, shown.length + 1));
    const count = $('hoSchemeCount');
    if (count) {
      count.textContent = opts.length
        ? (foldName(query).trim() ? `${hits.length}/${opts.length} đồ án` : `${opts.length} đồ án`)
        : 'Chưa tải danh mục đồ án';
    }
    syncSchemeNewRow();
  };
  if (schemeOptsCache.length) paint(schemeOptsCache);
  void refreshSchemeOpts().then(paint);
}

function onSchemePicked() {
  syncSchemeNewRow();
  const name = $('hoScheme')?.value || '';
  if (!name) return;
  const level = $('hoLevel');
  if (level) level.value = facetLevelOf(name);
  syncPlanViewToEntryLevel(level?.value || facetLevelOf(name));
}

function hoMeta(step) {
  const area = selectedArea('hoScope', 'hoUnit');
  return {
    scheme: schemeName(),
    level: $('hoLevel')?.value || '',
    sector: step.sector || '',
    kind: step.phase || '',
    area,
    step: step.id
  };
}

function rememberHosoCapacity() {
  if (!$('hoCsParent') && !document.querySelector('[data-ho-cs]')) return;
  hoCs = readHosoCapacity(document);
}

function hoMetaHtml(locked, scope, unit, levels) {
  return `<div class="entry-form">
      <div class="entry-field entry-field-full">
        <label for="hoLevel">Cấp <span class="entry-req">*</span></label>
        <select id="hoLevel" required>${levels}</select>
      </div>
      <div class="entry-row">
        <div class="entry-field">
          <label for="hoScope">Đơn vị</label>
          <select id="hoScope"${locked ? ' disabled' : ''}>
            <option value="tp"${scope === 'tp' ? ' selected' : ''}>Thành phố</option>
            <option value="dothi"${scope === 'dothi' ? ' selected' : ''}>Đô thị</option>
            <option value="xa"${scope === 'xa' ? ' selected' : ''}>Xã, phường</option>
          </select>
        </div>
        <div class="entry-field">
          <label for="hoUnit">Phạm vi</label>
          <select id="hoUnit"${locked ? ' disabled' : ''}>${optionsHtml(scope, unit)}</select>
        </div>
      </div>
    </div>`;
}

/** Meta đồ án mới: tên|cấp; Diện tích|DS HT|DS QH; công suất điện|nước|thoát nước; đơn vị|phạm vi. */
function hoNewMetaHtml(locked, scope, unit, levels, schemeNew) {
  const measured = ranhMeasuredHa();
  const measuredShort = measured != null
    ? `${fmtNum(Math.round(measured * 100) / 100)} (đo từ ranh)`
    : 'Đo từ ranh khi có';
  const areaErr = areaInputError();
  const areaTip = 'Để trống thì dùng diện tích đo từ ranh. Nhập số lệch hơn 1% so với ranh → báo lỗi, không lưu.';
  return `<div class="entry-form" id="hoSchemeNewRow">
      <div class="entry-row entry-row-name-level">
        <div class="entry-field">
          <label for="hoSchemeNew">Tên đồ án <span class="entry-req">*</span></label>
          <input id="hoSchemeNew" maxlength="120" required placeholder="Tên trên bản đồ / bucket" value="${escapeHtml(schemeNew)}">
        </div>
        <div class="entry-field">
          <label for="hoLevel">Cấp <span class="entry-req">*</span></label>
          <select id="hoLevel" required>${levels}</select>
        </div>
      </div>
      <div class="entry-row entry-row-3">
        <div class="entry-field">
          <label for="hoAreaHa">Diện tích (ha)${tipHtml(areaTip)}</label>
          <input id="hoAreaHa" type="text" inputmode="decimal" placeholder="${escapeHtml(measuredShort)}" value="${escapeHtml(hoExtra.areaHa)}">
          <span id="hoAreaMeasured" class="entry-sub" title="${escapeHtml(measuredShort)}">${escapeHtml(measured != null ? measuredShort : 'Chưa có ranh')}</span>
          ${areaErr ? `<p class="entry-note lot-flag" id="hoAreaWarn">${escapeHtml(areaErr)}</p>` : ''}
        </div>
        <div class="entry-field">
          <label for="hoDanSoHt">Dân số hiện trạng</label>
          <input id="hoDanSoHt" type="text" inputmode="numeric" placeholder="người" value="${escapeHtml(hoExtra.danSoHt)}">
        </div>
        <div class="entry-field">
          <label for="hoDanSoQh">Dân số quy hoạch</label>
          <input id="hoDanSoQh" type="text" inputmode="numeric" placeholder="người" value="${escapeHtml(hoExtra.danSoQh)}">
        </div>
      </div>
      ${hoCapacityInlineHtml(hoCs)}
      <div class="entry-row">
        <div class="entry-field">
          <label for="hoScope">Đơn vị</label>
          <select id="hoScope"${locked ? ' disabled' : ''}>
            <option value="tp"${scope === 'tp' ? ' selected' : ''}>Thành phố</option>
            <option value="dothi"${scope === 'dothi' ? ' selected' : ''}>Đô thị</option>
            <option value="xa"${scope === 'xa' ? ' selected' : ''}>Xã, phường</option>
          </select>
        </div>
        <div class="entry-field">
          <label for="hoUnit">Phạm vi</label>
          <select id="hoUnit"${locked ? ' disabled' : ''}>${optionsHtml(scope, unit)}</select>
        </div>
      </div>
    </div>`;
}

function schemeSearchHtml() {
  return `<label class="cad-pair" for="hoSchemeSearch">Đồ án
      <input type="search" id="hoSchemeSearch" class="cad-pair-search" placeholder="Tìm tên đồ án" autocomplete="off" aria-controls="hoScheme" title="Gõ một phần tên, không phân biệt dấu">
      <span class="cad-pair-count" id="hoSchemeCount"></span>
      <select id="hoScheme" class="cad-pair-list" size="6" title="Chọn đồ án đã có để bổ sung hồ sơ.">
        <option value="">Chọn đồ án</option>
      </select>
    </label>`;
}

function renderHtktPoint() {
  const root = $('htktPointBox');
  if (!root) return;
  root.hidden = false;
  if ($('htktBox')) $('htktBox').hidden = true;
  root.innerHTML = `<div class="entry-head">${tipHtml('Đề xuất điểm hạ tầng kỹ thuật lẻ (nhà máy, trạm…). Khác form hạ tầng xã hội. Trạng thái chờ duyệt như điểm HTXH; quản trị duyệt trên popup hoặc hàng chờ.')}</div>
    <div class="entry-form">
      <div class="entry-row">
        <div class="entry-field"><label for="htktType">Loại</label><select id="htktType">${typeOptionsHtml('htkt', '16-CN')}</select></div>
        <div class="entry-field"><label for="htktPhase">Giai đoạn</label>
          <select id="htktPhase"><option value="HT" selected>Hiện trạng</option><option value="QH">Quy hoạch mới</option></select>
        </div>
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="htktNhomHaTang">Phân cấp</label>
          <select id="htktNhomHaTang" disabled><option value="Cấp đô thị" selected>Cấp đô thị</option></select>
        </div>
        <div class="entry-field"><label for="htktName">Tên</label>
          <input type="text" id="htktName" placeholder="Tên công trình / trạm…" maxlength="150">
        </div>
      </div>
      <div class="entry-field entry-field-full"><label for="htktLat">Tọa độ</label>
        <div class="rp-coord-row">
          <input type="text" id="htktLat" placeholder="Vĩ độ">
          <input type="text" id="htktLng" placeholder="Kinh độ">
          <button type="button" id="btnHtktPick" title="Ghim trên bản đồ" aria-label="Ghim tọa độ"><svg class="ico"><use href="#i-pin"/></svg></button>
        </div>
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="htktWard">Phường/Xã</label>
          <input type="text" id="htktWard" placeholder="Tự nhận diện theo tọa độ">
        </div>
        <div class="entry-field"><label for="htktSize">Diện tích</label>
          <input type="number" id="htktSize" placeholder="m² (không bắt buộc)" min="0" step="1">
        </div>
      </div>
      <div class="entry-field entry-field-full"><label for="htktRadius">Bán kính</label>
        <output id="htktRadius" class="rp-radius">—</output>
      </div>
    </div>
    <button type="button" class="btn-submit" id="btnSubmitHtktPoint"><svg class="ico"><use href="#i-send"/></svg>Gửi đề xuất</button>
    <div id="htktStatus" class="rp-status" role="status" aria-live="polite"></div>`;
  updateRadiusPreview('htkt');
  ['htktType', 'htktNhomHaTang', 'htktWard', 'htktName', 'htktSize'].forEach(id => {
    $(id)?.addEventListener('input', () => updateRadiusPreview('htkt'));
    $(id)?.addEventListener('change', () => updateRadiusPreview('htkt'));
  });
  $('btnSubmitHtktPoint')?.addEventListener('click', () => submitInfraPoint('htkt'));
  $('btnHtktPick')?.addEventListener('click', () => {
    state.isPickMode = true;
    state.pickTarget = 'htkt';
    announceTool('Chọn vị trí trên bản đồ cho điểm HTKT.');
  });
}

function renderHoSo() {
  if (hoMode === 'net' && htktPane === 'diem') {
    renderHtktPoint();
    return;
  }
  if ($('htktPointBox')) $('htktPointBox').hidden = true;
  if ($('htktBox') && hoMode === 'net') $('htktBox').hidden = false;
  const rootId = hoMode === 'net' ? 'htktBox' : 'hoSoBox';
  const root = $(rootId);
  const idle = $(rootId === 'htktBox' ? 'hoSoBox' : 'htktBox');
  if (!root) return;
  rememberHosoCapacity();
  rememberHoExtra();
  const allow = allowedKeys();
  const locked = Array.isArray(allow) && allow.length === 1;
  const { pick: schemePick, neu: schemeNew } = captureScheme();
  const level = $('hoLevel')?.value || (schemePick ? facetLevelOf(schemePick) : 'QHPK');
  const scope = locked ? scopeOfKey(allow[0]) : ($('hoScope')?.value || 'xa');
  const unit = locked ? allow[0] : ($('hoUnit')?.value || optionsFirst(scope));
  if (idle) idle.innerHTML = '';
  const steps = visibleSteps();
  if (hoMode === 'new' && !steps.some(s => s.id === stepId)) stepId = 'ranh';
  else if (steps.length && !steps.some(s => s.id === stepId)) stepId = steps[0].id;
  const ranhReady = hasRanhPolygon();
  const ranhTip = 'Bắt buộc với đồ án mới. DXF / KML / KMZ (ô RG). Polyline chưa khép sẽ tự đóng thành vùng. Bản vẽ VN-2000 cần đúng kinh tuyến trục. Quy ước tên: RG / HT / QH / KH - tên đồ án.';
  const nav = steps.map((s, i) => {
    const done = held[s.id] && !held[s.id].error && ((held[s.id].features && held[s.id].features.length) || held[s.id].file);
    const lockOpt = hoMode === 'new' && s.id !== 'ranh' && !ranhReady;
    const req = s.requiredNew && hoMode === 'new' ? ' *' : '';
    const tip = s.id === 'ranh' ? tipHtml(ranhTip, 'Gợi ý ranh giới') : '';
    return `<button type="button" class="entry-step-btn${s.id === stepId ? ' on' : ''}${lockOpt ? ' locked' : ''}" data-step="${s.id}"${lockOpt ? ' disabled title="Tải ranh giới trước"' : ''}><span class="entry-step-label">${i + 1}. ${escapeHtml(s.label)}${req}${done ? ' · có file' : ''}</span>${tip}</button>`;
  }).join('');
  const levels = FACET_LEVELS.map(l => `<option value="${l.id}"${l.id === level ? ' selected' : ''}>${escapeHtml(l.label)}</option>`).join('');
  const files = `<div class="entry-steps" id="hoNav">${nav}</div>
    <div id="hoActive"></div>
    <button type="button" class="btn-submit" id="hoSave">Lưu hồ sơ</button>
    <button type="button" class="btn-submit btn-secondary" id="hoDownload">Tải GeoJSON đã gắn trục</button>
    <div id="hoStatus" class="rp-status" role="status"></div>`;
  const clipNote = `Lô sử dụng đất lọc theo ranh đã tải trong hồ sơ: lệch không quá ${SCHEME_EDGE_M} m thì giữ nguyên hình; lô đỏ là lô bị bỏ hoặc bị cắt. Quản trị tick lô đỏ muốn giữ hình gốc khi duyệt.`;
  const tipNew = `Đồ án mới: (1) tải ranh DXF/KML/KMZ — polyline hở tự khép, bản đồ phóng tới ranh; (2) nhập tên + cấp (bắt buộc). Tối thiểu tên + ranh để hiện trên bản đồ. PDF / sử dụng đất / lớp hạ tầng / dân số / diện tích / công suất là tùy chọn. ${clipNote}`;
  const tipAdd = `Bổ sung quyết định, quy chế, thuyết minh, ranh, sử dụng đất hoặc lớp hạ tầng vào đồ án đã có. ${clipNote}`;
  const tipAdjust = 'Điều chỉnh cục bộ: chọn đồ án, gửi PDF quyết định / DXF / ảnh scan ở khung bên dưới. Không chấm QCVN; lô gốc đồ án giữ nguyên. Quản trị ghi thẳng, cán bộ vào hàng chờ.';
  let modeTip = '';
  let body = '';
  if (hoMode === 'adjust') {
    modeTip = tipAdjust;
    body = '';
  } else if (hoMode === 'net') {
    const sectors = `<div class="add-mode-switch entry-sub" id="htktSectors" role="tablist" aria-label="Ngành hạ tầng kỹ thuật">${
      SECTORS.map(s => `<button type="button" class="entry-sub-btn${s.id === netSector ? ' active' : ''}" data-sector="${s.id}">${escapeHtml(s.label)}</button>`).join('')
    }</div>`;
    body = `<div class="entry-head">${tipHtml('Chọn đồ án đã có, rồi tải bản vẽ hiện trạng hoặc quy hoạch của ngành.')}</div>
      ${sectors}
      ${schemeSearchHtml()}
      ${hoMetaHtml(locked, scope, unit, levels)}
      ${files}`;
  } else if (hoMode === 'add') {
    modeTip = tipAdd;
    body = `${schemeSearchHtml()}
      ${hoMetaHtml(locked, scope, unit, levels)}
      ${hosoCapacityHtml(hoCs)}
      ${files}`;
  } else {
    modeTip = tipNew;
    body = `${hoNewMetaHtml(locked, scope, unit, levels, schemeNew)}
      ${files}`;
  }
  root.innerHTML = body;
  const modeHelp = $('qhModeHelp');
  if (modeHelp) modeHelp.innerHTML = modeTip ? tipHtml(modeTip) : '';
  $('htktSectors')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sector]');
    if (!btn) return;
    netSector = btn.dataset.sector;
    renderHoSo();
  });
  fillHoSchemes(schemePick);
  $('hoSchemeSearch')?.addEventListener('input', () => fillHoSchemes());
  $('hoScheme')?.addEventListener('focus', () => fillHoSchemes());
  $('hoScheme')?.addEventListener('change', onSchemePicked);
  $('hoLevel')?.addEventListener('change', () => {
    syncPlanViewToEntryLevel($('hoLevel').value);
    if ($('hoActive')) renderActive({ fit: false });
  });
  $('hoScope')?.addEventListener('change', () => { if ($('hoUnit')) $('hoUnit').innerHTML = optionsHtml($('hoScope').value, ''); renderActive(); });
  $('hoAreaHa')?.addEventListener('input', () => {
    rememberHoExtra();
    const warn = $('hoAreaWarn');
    const measured = $('hoAreaMeasured');
    const err = areaInputError();
    if (err) {
      if (warn) warn.textContent = err;
      else measured?.insertAdjacentHTML('afterend', `<p class="entry-note lot-flag" id="hoAreaWarn">${escapeHtml(err)}</p>`);
    } else if (warn) warn.remove();
  });
  $('hoDanSoHt')?.addEventListener('input', rememberHoExtra);
  $('hoDanSoQh')?.addEventListener('input', rememberHoExtra);
  $('hoDanSo')?.addEventListener('input', rememberHoExtra);
  // Tip trong nút bước không đổi step.
  $('hoNav')?.querySelectorAll('.entry-help').forEach((btn) => {
    btn.addEventListener('click', (e) => e.stopPropagation());
  });
  $('hoNav')?.addEventListener('click', (e) => {
    if (e.target.closest('.entry-help')) return;
    const btn = e.target.closest('[data-step]');
    if (!btn || btn.disabled) return;
    if (hoMode === 'new' && btn.dataset.step !== 'ranh' && !hasRanhPolygon()) {
      announceTool('Tải ranh giới quy hoạch trước, rồi mới đính kèm file khác.');
      return;
    }
    rememberHoExtra();
    stepId = btn.dataset.step;
    renderHoSo();
  });
  $('hoSave')?.addEventListener('click', saveHoSo);
  $('hoDownload')?.addEventListener('click', downloadHoSo);
  syncQuyHoachPanels();
  if ($('hoActive')) renderActive();
}

function syncQuyHoachPanels() {
  const flow = $('flowQuyHoach');
  const onAdjust = hoMode === 'adjust' && flow && !flow.hidden;
  flow?.classList.toggle('qh-adjust-on', !!onAdjust);
  setAdjustPanelVisible(!!onAdjust);
  paintAdminTools();
}

function paintAdminTools() {
  const legacy = $('entryLegacy');
  if (!legacy) return;
  const flow = $('flowQuyHoach');
  const onQh = !!(flow && !flow.hidden && (hoMode === 'new' || hoMode === 'add'));
  const admin = isAdmin();
  legacy.hidden = !(onQh && admin);
  if (legacy.hidden) legacy.removeAttribute('open');
}

/** Slot bản vẽ cùng pattern #cad-dxf-slots (RG / HT|QH / KH). */
function drawSlotsHtml(step, got) {
  if (step.file !== 'draw') return '';
  const mainTitle = step.id === 'ranh' ? 'Ranh giới QH'
    : step.id === 'dat-ht' ? 'Hiện trạng sử dụng đất'
    : step.id === 'dat-qh' ? 'Quy hoạch sử dụng đất'
    : step.label;
  const mainHint = step.id === 'ranh' ? 'RG - ….dxf'
    : step.id === 'dat-ht' ? 'HT - ….dxf'
    : step.id === 'dat-qh' ? 'QH - ….dxf'
    : '….dxf / .kml / .kmz';
  const hasMain = !!got?.file;
  const mainName = hasMain
    ? `${got.file.name}${got.warning ? ` — ${got.warning}` : ''}${got.error ? ` — ${got.error}` : ''}${got.features ? ` — ${got.features.length} đối tượng` : ''}`
    : mainHint;
  let html = `<div class="cad-dxf-slots">
    <div class="cad-slot-row${hasMain ? ' has-file' : ''}" data-ho-slot="main">
      <label class="cad-drop cad-slot" for="hoFile">
        <span class="cad-drop-main"><b>${escapeHtml(mainTitle)}</b></span>
        <span class="cad-slot-name">${escapeHtml(mainName)}</span>
        <input type="file" id="hoFile" accept=".dxf,.kml,.kmz" hidden>
      </label>
      <button type="button" class="cad-slot-clear" id="hoFileClear"${hasMain ? '' : ' hidden'} title="Bỏ file" aria-label="Bỏ file">×</button>
    </div>`;
  if (step.draw === 'land') {
    const hasKh = !!got?.khFile;
    const khName = hasKh
      ? `${got.khFile.name}${got.khStamps?.length ? ` · ${fmtNum(got.khStamps.length)} tem` : ''}${got.khError ? ` · ${got.khError}` : ''}`
      : 'KH - ….dxf · không bắt buộc';
    html += `
    <div class="cad-slot-row${hasKh ? ' has-file' : ''}" data-ho-slot="KH">
      <label class="cad-drop cad-slot" for="hoKhFile">
        <span class="cad-drop-main"><b>Ký hiệu lô (tem đất)</b></span>
        <span class="cad-slot-name">${escapeHtml(khName)}</span>
        <input type="file" id="hoKhFile" accept=".dxf" hidden>
      </label>
      <button type="button" class="cad-slot-clear" id="hoKhClear"${hasKh ? '' : ' hidden'} title="Bỏ file ký hiệu" aria-label="Bỏ file ký hiệu">×</button>
    </div>
    ${stampBoxHtml(got)}`;
  }
  html += '</div>';
  return html;
}

function clearHeldDraw(step) {
  const bag = held[step.id] || {};
  delete bag.file;
  delete bag.error;
  delete bag.warning;
  delete bag.needCrs;
  delete bag.features;
  delete bag.source;
  delete bag.counts;
  delete bag.clipNote;
  held[step.id] = bag;
  clearPreview();
}

function clearHeldKh(step) {
  const bag = held[step.id] || {};
  delete bag.khFile;
  delete bag.khStamps;
  delete bag.khError;
  delete bag.khWarn;
  delete bag.stampCrsNote;
  bag.stampAssign = {};
  bag.stampSkip = [];
  bag.stampDraft = {};
  bag.stampPick = null;
  bag.stampAssignMode = false;
  bag.stampMatch = null;
  bag.stampView = null;
  bag.stampLots = null;
  held[step.id] = bag;
  clearStampProps(bag.features);
}

function renderActive(previewOpts = {}) {
  const box = $('hoActive');
  const step = STEPS.find(s => s.id === stepId) || STEPS[0];
  if (!box) return;
  const got = held[step.id];
  const cap = pdfCap(step);
  const limit = step.file === 'pdf'
    ? (isAdmin() ? `PDF tối đa ${cap / MB} MB, ghi thẳng bucket` : `PDF tối đa ${cap / MB} MB, gửi chờ duyệt`)
    : 'DXF, KML hoặc KMZ, tối đa 20 MB';
  const crsOpts = [
    ['auto', 'Tự nhận'],
    ['WGS84', 'WGS84 (kinh, vĩ)'],
    ['HUE_3', 'VN-2000 KTT 107°, múi 3°'],
    ['HUE_107_45', 'VN-2000 KTT 107°45\', múi 3°'],
    ['UTM48_6', 'VN-2000 UTM 48, múi 6°'],
    ['custom', 'Kinh tuyến trục khác']
  ].map(([id, label]) => `<option value="${id}"${id === crsId ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const crs = step.file === 'draw' ? `<div class="entry-form">
      <div class="entry-row">
        <div class="entry-field">
          <label for="hoCrs">Hệ tọa độ${tipHtml('Bản vẽ VN-2000 cần đúng kinh tuyến trục trước khi xem trên bản đồ. Quy ước tên: RG / HT / QH / KH - tên đồ án.')}</label>
          <select id="hoCrs">${crsOpts}</select>
        </div>
        <div class="entry-field">
          <label for="hoLon0">Kinh tuyến trục</label>
          <input id="hoLon0" type="number" min="102" max="110" step="0.25" placeholder="Ví dụ 107.5" value="${escapeHtml(crsLon0)}"${crsId === 'custom' ? '' : ' disabled'}>
        </div>
      </div>
    </div>` : '';
  const clipHtml = got?.clipNote
    ? `<p class="entry-note">${escapeHtml(got.clipNote)}</p>`
    : (got?.counts ? `<p class="entry-note lot-flag">${escapeHtml(clipSentence(got.counts))}</p>` : '');
  const pdfDrop = step.file === 'pdf' ? `
    <label class="cad-drop" for="hoFile">
      <span class="cad-drop-main"><b>Chọn file</b></span>
      <span class="cad-drop-sub">${escapeHtml(step.label)}</span>
      <input type="file" id="hoFile" accept=".pdf" hidden>
    </label>
    ${got ? `<p class="entry-note">${escapeHtml(got.file?.name || '')}${got.error ? ` — ${escapeHtml(got.error)}` : ''}</p>` : ''}` : '';
  const stepTip = [limit, step.hint || '', step.file === 'draw' && step.id !== 'ranh' ? 'Bản vẽ VN-2000 cần đúng kinh tuyến trục. Quy ước tên: RG / HT / QH / KH - tên đồ án.' : '']
    .filter(Boolean).join(' ');
  // Ranh: tip đã gắn vào nút checklist — không lặp tiêu đề + ? riêng hàng.
  const title = step.id === 'ranh'
    ? ''
    : `<h3 class="entry-step-title">${escapeHtml(step.label)}${tipHtml(stepTip)}</h3>`;
  box.innerHTML = `${title}
    ${crs}
    ${pdfDrop}
    ${drawSlotsHtml(step, got)}
    ${clipHtml}`;
  $('hoCrs')?.addEventListener('change', () => {
    crsId = $('hoCrs').value;
    if ($('hoLon0')) $('hoLon0').disabled = crsId !== 'custom';
    if (got?.file && step.file === 'draw') takeDraw(step, got.file);
    else if (got?.khStamps?.length) { applyKhToHeld(step); renderActive(); }
  });
  $('hoLon0')?.addEventListener('change', () => {
    crsLon0 = $('hoLon0').value;
    if (got?.file) takeDraw(step, got.file);
    else if (got?.khStamps?.length) { applyKhToHeld(step); renderActive(); }
  });
  $('hoFile')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (step.file === 'pdf') takePdf(step, file);
    else takeDraw(step, file);
  });
  $('hoFileClear')?.addEventListener('click', () => {
    clearHeldDraw(step);
    if (step.id === 'ranh') reclipLands();
    renderActive();
  });
  $('hoKhFile')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) takeKh(step, file);
  });
  $('hoKhClear')?.addEventListener('click', () => {
    clearHeldKh(step);
    renderActive();
  });
  box.querySelectorAll('[data-ho-stamp]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ho-stamp-why],[data-ho-stamp-skip],[data-ho-stamp-plus]')) return;
      const bag = held[step.id];
      if (!bag) return;
      bag.stampPick = el.getAttribute('data-ho-stamp');
      renderActive({ fit: false, focusStamp: true });
    });
  });
  box.querySelectorAll('[data-ho-stamp-why]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bag = held[step.id];
      if (!bag) return;
      const id = btn.getAttribute('data-ho-stamp-why');
      const stamp = (bag.stampView || bag.stampMatch?.pending || []).find(s => s.id === id);
      announceTool(stampPendingWhy(stamp, bag.stampLots || []));
    });
  });
  box.querySelectorAll('[data-ho-stamp-plus]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bag = held[step.id];
      if (!bag) return;
      startStampAssignMode(bag, btn.getAttribute('data-ho-stamp-plus'));
    });
  });
  box.querySelectorAll('[data-ho-stamp-ok]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bag = held[step.id];
      if (!bag || btn.disabled) return;
      confirmStampOk(bag, btn.getAttribute('data-ho-stamp-ok'));
    });
  });
  box.querySelectorAll('[data-ho-stamp-skip]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bag = held[step.id];
      if (!bag) return;
      const id = btn.getAttribute('data-ho-stamp-skip');
      bag.stampSkip = [...(bag.stampSkip || []), id];
      if (bag.stampDraft) delete bag.stampDraft[id];
      if (bag.stampAssign) delete bag.stampAssign[id];
      bag.stampAssignMode = false;
      applyKhToHeld(step);
      const next = bag.stampMatch?.pending?.[0];
      renderActive(next
        ? { fit: false, focusStamp: true }
        : { fit: true });
    });
  });
  // Có tem chờ gán: phóng tới tem đang chọn (tránh fitBounds cả file nuốt zoom).
  const opts = { ...previewOpts };
  if (opts.focusStamp == null && opts.fit == null
    && got?.stampPick && got?.stampMatch?.pending?.length) {
    opts.fit = false;
    opts.focusStamp = true;
  }
  showStepPreview(opts);
}

function pdfCap(step) {
  if (step.file !== 'pdf') return step.max;
  if (isAdmin()) return step.max;
  return Math.min(step.max, 2 * MB);
}

function fileError(file, step) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (step.file === 'pdf') {
    if (ext !== 'pdf') return 'Chỉ nhận file PDF.';
    const cap = pdfCap(step);
    if (file.size > cap) return isAdmin() ? `File tối đa ${cap / MB} MB.` : `Cán bộ gửi PDF tối đa ${cap / MB} MB. File lớn hơn để quản trị ghi thẳng.`;
  } else if (!['dxf', 'kml', 'kmz'].includes(ext)) return 'Chỉ nhận DXF, KML hoặc KMZ.';
  else if (file.size > DRAW_MAX_BYTES) return 'File tối đa 20 MB.';
  if (!(file.size > 0)) return 'File rỗng.';
  return '';
}

function takePdf(step, file) {
  const error = fileError(file, step);
  held[step.id] = { file, error };
  renderActive();
}

async function takeDraw(step, file) {
  const error = fileError(file, step);
  const prev = held[step.id] || {};
  if (error) {
    held[step.id] = { ...prev, file, error };
    renderActive();
    return;
  }
  const choice = {
    id: $('hoCrs')?.value || 'HUE_3',
    lon0: $('hoLon0')?.value
  };
  try {
    const parsed = await ingestSchemeFile(file, step.draw, choice);
    let features = parsed.error ? [] : tagFeatures(parsed.features, hoMeta(step));
    let error = parsed.error || '';
    if (!error && step.draw === 'boundary' && !features.length) {
      error = 'Không có vùng ranh. Polyline cần ≥ 3 đỉnh để tự khép thành vùng.';
    }
    held[step.id] = {
      ...prev,
      file,
      error,
      warning: parsed.warning || '',
      needCrs: parsed.needCrs,
      closedCount: parsed.closedCount || 0
    };
    applyLandClip(step, features);
    // Đổi trục B + cấp trước khi vẽ preview (planMap + lớp nền cùng tỷ lệ).
    syncPlanViewToEntryLevel(entryFacetLevel());
    if (step.id === 'ranh') {
      reclipLands();
      stepId = 'ranh';
      renderHoSo();
      return;
    }
  } catch (err) {
    held[step.id] = { ...prev, file, error: err.message || 'Không đọc được bản vẽ.' };
    clearPreview();
  }
  renderActive();
}

async function takeKh(step, file) {
  const prev = held[step.id] || {};
  const { stamps, error } = await ingestKhFile(file);
  held[step.id] = {
    ...prev,
    khFile: file,
    khStamps: stamps,
    khError: error,
    stampAssign: {},
    stampSkip: [],
    stampDraft: {},
    stampPick: null,
    stampAssignMode: false
  };
  if (!error && stamps.length) applyKhToHeld(step);
  syncPlanViewToEntryLevel(entryFacetLevel());
  renderActive();
}

function taggedCollections() {
  const features = [];
  visibleSteps().forEach(step => {
    const bag = held[step.id];
    if (!bag || !bag.features) return;
    const again = tagFeatures(bag.features.map(f => ({ geometry: f.geometry, properties: { ...f.properties } })), hoMeta(step));
    features.push(...again);
  });
  return features;
}

function downloadHoSo() {
  const features = taggedCollections();
  const status = $('hoStatus');
  if (!features.length) {
    if (status) status.textContent = 'Chưa có bản vẽ để tải.';
    return;
  }
  const blob = new Blob([JSON.stringify(asCollection(features))], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ho-so-quy-hoach.geojson';
  a.click();
  URL.revokeObjectURL(a.href);
  if (status) status.textContent = `Đã tải ${features.length} đối tượng.`;
}

async function fileBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < buf.length; i += size) binary += String.fromCharCode.apply(null, buf.subarray(i, i + size));
  return btoa(binary);
}

function netPayload(features) {
  return features.map(f => {
    const p = f.properties || {};
    return {
      name: String(p.nhan || p.TEN || p.ten || p.layer || '').slice(0, 120),
      geometry: f.geometry,
      props: {
        ...p,
        loai: String(p.loai || p.layer || p.KYHIEU || '').slice(0, 80)
      }
    };
  });
}

async function savePdf(step, tenQH, unitKey) {
  const file = held[step.id]?.file;
  if (!file || held[step.id].error) return '';
  if (step.id === 'qd') {
    if (file.size > 2 * MB) return 'Quyết định vượt 2 MB.';
    const pdf = await fileBase64(file);
    if (isAdmin()) await postJson('putProjectDecision', { tenQH, name: file.name, pdf });
    else await postJson('submitDecisionProposal', { tenQH, name: file.name, pdf });
    return isAdmin() ? 'quyết định' : 'quyết định (chờ duyệt)';
  }
  if (!isAdmin()) {
    if (!unitKey) return '';
    if (file.size > 2 * MB) return 'PDF chờ duyệt tối đa 2 MB.';
    await postJson('submitChoDuyetPdf', {
      kind: 'van-ban',
      unitKey,
      tenQH,
      docRole: step.docRole,
      name: file.name,
      pdf: await fileBase64(file)
    });
    return `${step.label} (chờ duyệt)`;
  }
  if (file.size > PDF_ADMIN_MAX_BYTES) return 'File PDF tối đa 10 MB.';
  await postJson('putProjectDoc', { tenQH, docRole: step.docRole, name: file.name, pdf: await fileBase64(file) });
  return step.label;
}

async function saveHoSo() {
  const status = $('hoStatus');
  const btn = $('hoSave');
  rememberHoExtra();
  const tenQH = schemeName();
  const features = taggedCollections();
  const notes = [];
  const level = $('hoLevel')?.value || '';
  const setStatus = (msg) => {
    if (status) {
      status.textContent = msg;
      try { status.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* */ }
    }
    announceTool(msg);
  };
  if (hoMode === 'new') {
    if (!tenQH) {
      setStatus('Nhập tên đồ án (bắt buộc).');
      $('hoSchemeNew')?.focus();
      return;
    }
    if (!level) {
      setStatus('Chọn cấp quy hoạch (bắt buộc).');
      $('hoLevel')?.focus();
      return;
    }
    if (!hasRanhPolygon()) {
      setStatus('Tải ranh giới quy hoạch trước (DXF/KML/KMZ → vùng khép kín).');
      stepId = 'ranh';
      renderHoSo();
      return;
    }
    const areaErr = areaInputError();
    if (areaErr) {
      setStatus(areaErr);
      $('hoAreaHa')?.focus();
      return;
    }
  } else if (!tenQH) {
    setStatus(features.length
      ? 'Đã có bản vẽ trên máy. Chọn đồ án đã có hoặc nhập tên đồ án mới khi cần ghi bucket.'
      : 'Chọn ít nhất một file.');
    if (features.length) downloadHoSo();
    return;
  }
  if (btn) btn.disabled = true;
  setStatus('Đang lưu hồ sơ…');
  try {
    rememberHosoCapacity();
    const capacityOn = !!($('hoCsParent') || document.querySelector('[data-ho-cs]'));
    if (capacityOn) {
      const filled = String(hoCs.parent || '').trim() || Object.values(hoCs.values || {}).some(row => String(row && row.giaTri || '').trim());
      if (filled && !await loadCongSuat()) {
        setStatus('Chưa tải được sổ quy mô. Chưa ghi.');
        return;
      }
      const gate = gateHosoCapacity({ name: tenQH, cap: level || $('hoLevel')?.value || '', draft: hoCs });
      if (!gate.accept) {
        setStatus(gate.sentences.join(' '));
        return;
      }
      if (gate.entries.length) {
        storeHosoCapacity(gate, gate.entries);
        notes.push(gate.sentences.join(' ') || (gate.label === 'OK' ? 'quy mô hạ tầng: OK' : 'quy mô hạ tầng: chưa đủ dữ liệu'));
      }
    }
    if (hoExtra.danSoHt.trim()) notes.push(`dân số HT ${hoExtra.danSoHt.trim()}`);
    if (hoExtra.danSoQh.trim()) notes.push(`dân số QH ${hoExtra.danSoQh.trim()}`);
    const measured = ranhMeasuredHa();
    if (measured != null) notes.push(`ranh ${fmtNum(Math.round(measured * 100) / 100)} ha`);
    if (parseAreaHaInput(hoExtra.areaHa) > 0) notes.push(`diện tích nhập ${hoExtra.areaHa.trim()} ha`);
    else if (measured != null) notes.push(`diện tích theo ranh ${fmtNum(Math.round(measured * 100) / 100)} ha`);
    const area = selectedArea('hoScope', 'hoUnit');
    const unitKey = area ? unitKeyOf(area.type, area.code) : '';
    for (const step of visibleSteps()) {
      if (step.file === 'pdf' && held[step.id]?.file && !held[step.id].error) {
        const saved = await savePdf(step, tenQH, unitKey);
        if (saved) notes.push(saved);
        else if (!isAdmin()) notes.push(`${step.label} giữ trên máy (chọn đúng đơn vị được giao, PDF tối đa 2 MB)`);
      }
    }
    if (!officerCanEdit(unitKey)) {
      if (!signedIn()) {
        notes.push('chưa đăng nhập — chưa ghi lên máy chủ (chỉ tải GeoJSON tạm)');
      } else {
        notes.push('đơn vị không được giao — chưa ghi lên máy chủ (chỉ tải GeoJSON tạm)');
      }
    } else {
      let wrote = 0;
      for (const step of visibleSteps()) {
        const bag = held[step.id];
        const hasDraw = bag?.features?.length || bag?.review?.length;
        if (!hasDraw) {
          if (bag?.counts) notes.push(`${step.label} (${clipSentence(bag.counts)}; không ghi)`);
          continue;
        }
        const tagged = tagFeatures(bag.features || [], hoMeta(step));
        const rows = netPayload(tagged);
        if (!rows.length) {
          notes.push(`${step.label} (0 đối tượng sau gắn trục — không ghi)`);
          continue;
        }
        const kind = PUBLISH_KIND[step.id];
        const review = step.draw === 'land' ? reviewBody(step, bag, tagged) : [];
        const clipNote = bag.counts ? ` ${clipSentence(bag.counts)}` : '';
        const stageBody = {
          kind: kind || 'ban-ve',
          unitKey,
          tenQH,
          role: kind ? '' : (step.role || ''),
          summary: `${step.label} · ${rows.length} đối tượng${bag.counts ? ` · đỏ ${bag.counts.bo + bag.counts.cat}` : ''}`.slice(0, 180),
          features: rows,
          lotReview: review,
          clip: bag.counts ? { edgeM: SCHEME_EDGE_M, ...bag.counts } : undefined
        };
        if (kind) {
          const { staged, data } = await stageOrPublish({
            adminFn: () => postJson('publishSchemeDraw', { tenQH, kind, features: rows }),
            stageFn: () => postJson('submitChoDuyet', stageBody)
          });
          wrote += 1;
          if (staged) notes.push(`${step.label} (chờ duyệt)${bag.counts ? ` — ${clipSentence(bag.counts)}` : ''}`);
          else notes.push(data?.skipped ? `${step.label} (${data.note || 'đã có lớp'})` : `${step.label} · ${rows.length} đối tượng.${clipNote}`.trim());
        } else if (step.role) {
          const { staged } = await stageOrPublish({
            adminFn: () => postJson('putProjectNet', { tenQH, role: step.role, features: rows }),
            stageFn: () => postJson('submitChoDuyet', stageBody)
          });
          wrote += 1;
          notes.push(staged ? `${step.label} (chờ duyệt)` : step.label);
        }
      }
      if (!wrote && !notes.some(n => /không ghi|chờ duyệt|đối tượng/.test(n))) {
        notes.push('không có lớp bản vẽ nào để ghi (cần ranh và/hoặc sử dụng đất)');
      }
    }
    if (features.length) downloadHoSo();
    setStatus(notes.length ? `Đã xử lý: ${notes.join('; ')}.` : 'Chưa có file hợp lệ.');
  } catch (err) {
    setStatus(err.message || 'Lưu hồ sơ thất bại.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function ktChoices() {
  const allow = allowedKeys();
  const rows = EVAL_URBANS.filter(u => !allow || allow.includes(u.key));
  if (rows.length) return rows.map(u => ({ key: u.key, name: u.name }));
  if (Array.isArray(allow) && allow.length) return allow.map(key => ({ key, name: unitName(key) || key }));
  return EVAL_URBANS.map(u => ({ key: u.key, name: u.name }));
}

function ktArea() {
  const key = $('ktUrban')?.value || '';
  const [type, code] = key.split(':');
  if (!type || !code) return null;
  return { type, code, parent: type === 'tp' ? null : 'TP' };
}

function urbanSelectHtml() {
  const rows = ktChoices();
  const current = $('ktUrban')?.value || '';
  const selected = rows.some(u => u.key === current) ? current : (rows[0]?.key || '');
  const locked = rows.length < 2 && Array.isArray(allowedKeys());
  const opts = rows.map(u => `<option value="${escapeHtml(u.key)}"${u.key === selected ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
  return `<div class="entry-field entry-field-full">
      <label for="ktUrban">Đô thị</label>
      <select id="ktUrban"${locked ? ' disabled' : ''}>${opts}</select>
    </div>`;
}

function renderKienTruc() {
  const root = $('ktBody');
  if (!root) return;
  const urban = urbanSelectHtml();
  if (ktMode === 'congtrinh') {
    root.innerHTML = `<div class="entry-head">${tipHtml('Bổ sung danh mục công trình kiến trúc có giá trị. Ghi tab KienTruc.')}</div>
      <div class="entry-form">
      ${urban}
      <div class="entry-row">
        <div class="entry-field"><label for="ktType">Loại</label>
          <select id="ktType">
            <option value="KT-GT">Công trình kiến trúc có giá trị</option>
            <option value="KT-PHAP">Kiến trúc Pháp</option>
            <option value="KT-TG">Công trình tôn giáo, tín ngưỡng</option>
            <option value="KT-CC">Công trình công cộng</option>
            <option value="KT-KHAC">Khác</option>
          </select>
        </div>
        <div class="entry-field"><label for="ktPhase">Giai đoạn</label>
          <select id="ktPhase"><option value="HT" selected>Hiện trạng</option><option value="QH">Đề xuất mới</option></select>
        </div>
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="ktNhomHaTang">Phân cấp</label>
          <select id="ktNhomHaTang"><option value="Cấp đô thị" selected>Cấp đô thị</option><option value="Cấp đơn vị ở">Cấp đơn vị ở</option></select>
        </div>
        <div class="entry-field"><label for="ktName">Tên</label>
          <input type="text" id="ktName" placeholder="Tên công trình">
        </div>
      </div>
      <div class="entry-field entry-field-full"><label for="ktLat">Tọa độ</label>
        <div class="rp-coord-row">
          <input type="text" id="ktLat" placeholder="Vĩ độ">
          <input type="text" id="ktLng" placeholder="Kinh độ">
          <button type="button" id="ktPick" title="Ghim trên bản đồ" aria-label="Ghim tọa độ trên bản đồ"><svg class="ico"><use href="#i-pin"/></svg></button>
        </div>
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="ktWard">Phường/Xã</label>
          <input type="text" id="ktWard" placeholder="Tự nhận diện theo tọa độ">
        </div>
        <div class="entry-field"><label for="ktSize">Diện tích</label>
          <input type="number" id="ktSize" placeholder="m²" min="0" step="1">
        </div>
      </div>
      <div class="entry-field entry-field-full"><label for="ktRadius">Bán kính</label>
        <output id="ktRadius" class="rp-radius">—</output>
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="ktLinkAnh">Thư mục ảnh</label>
          <input type="text" id="ktLinkAnh" maxlength="300" placeholder="Liên kết bucket">
        </div>
        <div class="entry-field"><label for="ktLink3d">Thư mục 3D</label>
          <input type="text" id="ktLink3d" maxlength="300" placeholder="Liên kết bucket">
        </div>
      </div>
    </div>
    <button type="button" class="btn-submit" id="ktSubmit">Gửi công trình</button>
    <div id="ktStatus" class="rp-status" role="status"></div>`;
    ['ktType', 'ktNhomHaTang', 'ktWard', 'ktName', 'ktSize'].forEach(id => {
      const el = $(id);
      el?.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => updateRadiusPreview('kt'));
    });
    $('ktPick')?.addEventListener('click', () => {
      state.pickTarget = 'kientruc';
      state.isPickMode = true;
      announceTool('pick');
      const st = $('ktStatus');
      if (st) st.textContent = 'Chọn một điểm trên bản đồ.';
    });
    $('ktSubmit')?.addEventListener('click', async () => {
      const area = ktArea();
      if (!area || !officerCanEdit(unitKeyOf(area.type, area.code))) {
        const st = $('ktStatus');
        if (st) st.textContent = 'Đăng nhập cán bộ hoặc quản trị, đúng đơn vị được giao.';
        return;
      }
      await submitInfraPoint('kt', {
        statusId: 'ktStatus',
        fields: {
          linkAnh: $('ktLinkAnh')?.value || '',
          link3d: $('ktLink3d')?.value || '',
          khuVuc: `${area.type}:${area.code}`
        }
      });
    });
    updateRadiusPreview('kt');
    return;
  }
  root.innerHTML = `<div class="entry-head">${tipHtml('Thêm quy chế quản lý kiến trúc. Chọn đô thị trong danh sách. Quản trị ghi thẳng tối đa 10 MB; cán bộ gửi chờ duyệt tối đa 2 MB.')}</div>
    <div class="entry-form">${urban}</div>
    <label class="cad-drop" for="ktPdf" title="Quản trị ghi thẳng, tối đa 10 MB. Cán bộ gửi chờ duyệt, tối đa 2 MB.">
      <span class="cad-drop-main"><b>Quy chế quản lý kiến trúc</b></span>
      <span class="cad-drop-sub">PDF</span>
      <input type="file" id="ktPdf" accept=".pdf" hidden>
    </label>
    <div id="ktPdfNote" class="entry-note"></div>
    <button type="button" class="btn-submit btn-secondary" id="ktPdfSave">Lưu quy chế</button>`;
  $('ktPdf')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    const note = $('ktPdfNote');
    if (!file) return;
    const cap = isAdmin() ? 10 * MB : 2 * MB;
    if ((file.name.split('.').pop() || '').toLowerCase() !== 'pdf' || file.size > cap) {
      if (note) note.textContent = isAdmin() ? 'Chỉ nhận PDF không quá 10 MB.' : 'Cán bộ chỉ gửi PDF không quá 2 MB. File lớn hơn cần quản trị ghi thẳng.';
      held.ktPdf = null;
      return;
    }
    held.ktPdf = file;
    if (note) note.textContent = isAdmin()
      ? `${file.name} — ${(file.size / MB).toFixed(1)} MB. Bấm Lưu quy chế để ghi bucket.`
      : `${file.name} — ${(file.size / MB).toFixed(1)} MB. Bấm Lưu quy chế để gửi chờ duyệt.`;
  });
  $('ktPdfSave')?.addEventListener('click', saveKtPdf);
}

async function saveKtPdf() {
  const note = $('ktPdfNote');
  const file = held.ktPdf;
  const area = ktArea();
  if (!file) {
    if (note) note.textContent = 'Chọn file PDF quy chế.';
    return;
  }
  if (!area || !officerCanEdit(unitKeyOf(area.type, area.code))) {
    if (note) note.textContent = 'Đăng nhập cán bộ hoặc quản trị, đúng đơn vị được giao.';
    return;
  }
  const unitKey = unitKeyOf(area.type, area.code);
  if (!isAdmin()) {
    if (file.size > 2 * MB) {
      if (note) note.textContent = 'Cán bộ gửi PDF tối đa 2 MB.';
      return;
    }
    try {
      await postJson('submitChoDuyetPdf', { kind: 'quy-che', unitKey, name: file.name, pdf: await fileBase64(file) });
      if (note) note.textContent = 'Đã gửi quy chế, chờ quản trị duyệt. Người xem chưa mở được file.';
    } catch (err) {
      if (note) note.textContent = err.message;
    }
    return;
  }
  try {
    if (file.size > PDF_ADMIN_MAX_BYTES) {
      if (note) note.textContent = 'File PDF tối đa 10 MB.';
      return;
    }
    const saved = await postJson('putKienTrucPdf', { unitKey, name: file.name, pdf: await fileBase64(file) });
    if (note) note.textContent = saved.url ? `Đã ghi quy chế: ${saved.url}` : 'Đã ghi quy chế.';
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

function polygonsOf(features) {
  const polys = [];
  (features || []).forEach(f => {
    const g = f && f.geometry;
    if (!g) return;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    if (g.type === 'MultiPolygon') g.coordinates.forEach(c => polys.push(c));
  });
  if (!polys.length) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}

function renderDuAn() {
  const root = $('flowDuAn');
  if (!root) return;
  const name = $('daName')?.value || '';
  const group = $('daGroup')?.value || 'dvtm';
  const decision = $('daDecision')?.value || '';
  const crs = $('daCrs')?.value || 'HUE_3';
  const groups = INVEST_GROUPS.map(g => `<option value="${g.id}"${g.id === group ? ' selected' : ''}>${escapeHtml(g.title)}</option>`).join('');
  const crsOpts = [
    ['HUE_3', 'VN-2000 KTT 107°, múi 3°'],
    ['HUE_107_45', 'VN-2000 KTT 107°45\', múi 3°'],
    ['UTM48_6', 'VN-2000 UTM 48, múi 6°'],
    ['WGS84', 'WGS84 (kinh, vĩ)']
  ].map(([id, label]) => `<option value="${id}"${id === crs ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const note = isAdmin()
    ? 'Quản trị ghi thẳng lớp dự án (tên và/hoặc ranh).'
    : 'Đăng nhập Google để đề xuất: cần tên dự án hoặc file ranh (hoặc cả hai). Quản trị duyệt trong hàng chờ.';
  root.innerHTML = `<div class="entry-head">${tipHtml(note)}</div>
    <div class="entry-form">
      <div class="entry-field entry-field-full">
        <label for="daName">Tên dự án</label>
        <input id="daName" maxlength="200" value="${escapeHtml(name)}" placeholder="Tên dự án">
      </div>
      <div class="entry-row">
        <div class="entry-field"><label for="daGroup">Nhóm</label><select id="daGroup">${groups}</select></div>
        <div class="entry-field"><label for="daCrs">Hệ tọa độ</label><select id="daCrs">${crsOpts}</select></div>
      </div>
      <div class="entry-field entry-field-full">
        <label for="daDecision">Quyết định pháp lý</label>
        <input id="daDecision" maxlength="300" value="${escapeHtml(decision)}" placeholder="Số, ngày, cơ quan ban hành">
      </div>
    </div>
    <label class="cad-drop" for="daFile" title="DXF, KML hoặc KMZ. Vùng Polygon.">
      <span class="cad-drop-main"><b>Ranh giới</b></span>
      <span class="cad-drop-sub">DXF · KML · KMZ</span>
      <input type="file" id="daFile" accept=".dxf,.kml,.kmz" hidden>
    </label>
    <button type="button" class="btn-submit" id="daSave">${isAdmin() ? 'Lưu dự án' : 'Gửi đề xuất'}</button>
    <div id="daStatus" class="rp-status" role="status"></div>`;
  $('daFile')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const status = $('daStatus');
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['dxf', 'kml', 'kmz'].includes(ext)) {
      daGeom = null;
      if (status) status.textContent = 'Ranh chỉ nhận DXF, KML hoặc KMZ.';
      return;
    }
    try {
      const parsed = await ingestSchemeFile(file, 'boundary', { id: $('daCrs')?.value || 'HUE_3' });
      if (parsed.error) {
        daGeom = null;
        clearPreview();
        if (status) status.textContent = parsed.error;
        return;
      }
      daGeom = polygonsOf(parsed.features);
      if (!daGeom) {
        clearPreview();
        if (status) status.textContent = 'Không thấy vùng ranh trong file.';
        return;
      }
      showPreview((parsed.features || []).map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { ...(f.properties || {}), _mau: 'ranh-moi' }
      })), []);
      if (status) status.textContent = `${file.name} — đã đọc ranh.`;
    } catch (err) {
      daGeom = null;
      clearPreview();
      if (status) status.textContent = err.message || 'Không đọc được ranh.';
    }
  });
  $('daSave')?.addEventListener('click', saveDuAn);
}

async function saveDuAn() {
  const status = $('daStatus');
  const name = $('daName')?.value.trim() || '';
  const groupId = $('daGroup')?.value || '';
  const decision = $('daDecision')?.value.trim() || '';
  if (!name && !daGeom) {
    if (status) status.textContent = 'Cần tên dự án hoặc file ranh giới.';
    return;
  }
  if (!name) {
    if (status) status.textContent = 'Có ranh thì cần nhập tên dự án để làm khóa.';
    return;
  }
  const fields = { 'Tên dự án': name, 'Nhóm dự án': investGroupLabel(groupId) };
  if (decision) fields['Quyết định pháp lý'] = decision;
  try {
    if (isAdmin()) {
      if (status) status.textContent = 'Đang ghi dự án…';
      const body = { key: name, match: name, groupId, fields };
      if (daGeom) body.geometry = daGeom;
      await postJson('saveInvestProject', body);
      if (status) status.textContent = daGeom ? 'Đã ghi dự án và ranh.' : 'Đã ghi dự án. Chưa có ranh.';
      return;
    }
    if (!state.authToken) {
      if (status) status.textContent = 'Đăng nhập Google để gửi đề xuất dự án.';
      return;
    }
    if (status) status.textContent = 'Đang gửi đề xuất…';
    const body = { key: name, name, groupId, decision, fields };
    if (daGeom) body.geometry = daGeom;
    const data = await postJson('submitInvestProposal', body);
    if (status) {
      status.textContent = data.id
        ? `Đã gửi hàng chờ duyệt (mã ${String(data.id).slice(0, 8)}…). Chưa hiện trên bản đồ.`
        : 'Đã gửi hàng chờ duyệt. Chưa hiện trên bản đồ.';
    }
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

const FLOW_ALIAS = { flowHanhChinh: 'flowPhatTrien', flowHoSo: 'flowQuyHoach' };
const FLOW_IDS = REGISTRY_FLOW_IDS;

export function openEntryFlow(id, opts = {}) {
  const flow = FLOW_ALIAS[id] || id;
  document.querySelectorAll('.entry-flow-btn').forEach(btn => {
    const on = btn.dataset.flow === flow;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  FLOW_IDS.forEach(fid => {
    const el = $(fid);
    if (el) el.hidden = fid !== flow;
  });
  if (flow !== 'flowKienTruc' && flow !== 'flowHtxh') {
    state.isPickMode = false;
    state.pickTarget = 'infra';
  } else if (flow === 'flowHtxh') state.pickTarget = 'infra';
  if (opts.qmode && opts.qmode !== 'net') {
    hoMode = opts.qmode;
    landMode = hoMode;
  }
  if (flow === 'flowHtkt') hoMode = 'net';
  else if (hoMode === 'net') hoMode = landMode;
  paintGroup('#ptTabs [data-pt]', 'data-pt', ptTab);
  paintGroup('#qhEntryTabs [data-qmode]', 'data-qmode', hoMode === 'net' ? 'add' : hoMode);
  paintGroup('#ktTabs [data-kmode]', 'data-kmode', ktMode);
  paintGroup('#htktPaneTabs [data-htkt-pane]', 'data-htkt-pane', htktPane);
  if (flow === 'flowQuyHoach' || flow === 'flowHtkt') renderHoSo();
  else {
    clearPreview();
    if ($('htktPointBox')) $('htktPointBox').hidden = true;
    syncQuyHoachPanels();
  }
  if (opts.legacy && isAdmin()) {
    const legacy = $('entryLegacy');
    if (legacy && !legacy.hidden) legacy.setAttribute('open', '');
  }
  if (opts.scheme && (hoMode === 'add' || hoMode === 'adjust' || hoMode === 'net')) {
    fillHoSchemes(opts.scheme);
    const sel = $('hoScheme');
    if (sel && opts.scheme) {
      if (![...sel.options].some(o => o.value === opts.scheme)) {
        sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(opts.scheme)}">${escapeHtml(opts.scheme)}</option>`);
      }
      sel.value = opts.scheme;
      onSchemePicked();
    }
  }
  if (flow === 'flowPhatTrien') renderHanhChinh();
  if (flow === 'flowKienTruc') renderKienTruc();
  if (flow === 'flowDuAn') renderDuAn();
}

/** Deep-link Bổ sung checklist (#hoSoBox) — Cân đối / Catalog; không nuốt DXF. */
export function focusHoSoSupplement(tenQH, opts = {}) {
  const qmode = opts.qmode === 'new' ? 'new' : 'add';
  openEntryFlow('flowQuyHoach', { qmode, scheme: String(tenQH || '').trim() });
  $('hoSoBox')?.scrollIntoView({ block: 'nearest' });
}

export function initEntryFlows(hooks = {}) {
  if (hooks.submitInfraPoint) submitInfraPoint = hooks.submitInfraPoint;
  if (hooks.updateRadiusPreview) updateRadiusPreview = hooks.updateRadiusPreview;
  paintOfficer();
  renderHanhChinh();
  renderHoSo();
  renderKienTruc();
  renderDuAn();
  document.addEventListener('auth:change', () => {
    paintOfficer();
    renderHanhChinh();
    renderHoSo();
    renderKienTruc();
    renderDuAn();
  });
  $('entryFlows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow]');
    if (!btn) return;
    openEntryFlow(btn.dataset.flow);
  });
  $('ptTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pt]');
    if (!btn) return;
    ptTab = btn.dataset.pt;
    paintGroup('#ptTabs [data-pt]', 'data-pt', ptTab);
    renderHanhChinh();
  });
  $('qhEntryTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qmode]');
    if (!btn) return;
    hoMode = btn.dataset.qmode;
    landMode = hoMode;
    if (hoMode === 'new') stepId = 'ranh';
    paintGroup('#qhEntryTabs [data-qmode]', 'data-qmode', hoMode);
    renderHoSo();
  });
  $('ktTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kmode]');
    if (!btn) return;
    ktMode = btn.dataset.kmode;
    paintGroup('#ktTabs [data-kmode]', 'data-kmode', ktMode);
    if (ktMode !== 'congtrinh') {
      state.isPickMode = false;
      state.pickTarget = 'infra';
    }
    renderKienTruc();
  });
  $('htktPaneTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-htkt-pane]');
    if (!btn) return;
    htktPane = btn.dataset.htktPane === 'diem' ? 'diem' : 'net';
    paintGroup('#htktPaneTabs [data-htkt-pane]', 'data-htkt-pane', htktPane);
    if (htktPane === 'diem') {
      state.pickTarget = 'htkt';
    } else {
      state.isPickMode = false;
      state.pickTarget = 'infra';
    }
    renderHoSo();
  });
}
