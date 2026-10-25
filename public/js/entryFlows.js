// Ba luồng nhập: Hành chính, Quy hoạch và hạ tầng, Kiến trúc.
// Quản trị ghi thẳng lớp công bố. Cán bộ CanBo gửi hàng chờ. Chưa đăng nhập thì không gửi.
import { map } from './mapEngine.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, announceTool } from './utils.js';
import { SECTORS, FACET_LEVELS, listAreas } from './facetStore.js';
import { EVAL_URBANS, fieldsForScope, gapRows } from './urbanEntrySchema.js';
import { readUnit, writeUnit, replaceAll, officerCanEdit, readAll } from './urbanInputs.js';
import { readDrawingFile, tagFeatures, asCollection, DRAW_MAX_BYTES } from './drawingReaders.js';
import { SCHEME_EDGE_M, schemeBoundaryOf, clipSchemeLots, clipSentence } from './schemeLotClip.js';
import { putSignedPdf, PDF_INLINE_MAX_BYTES } from './pdfLimits.js';
import { loadCongSuat } from './congSuat.js';
import { hosoCapacityHtml, readHosoCapacity, gateHosoCapacity, storeHosoCapacity } from './congSuatUi.js';

const MB = 1024 * 1024;
const $ = (id) => document.getElementById(id);

let submitInfraPoint = async () => {};
let updateRadiusPreview = () => {};
let preview = null;
let previewRenderer = null;

function lotRenderer() {
  if (!map.getPane('lotPreview')) {
    const pane = map.createPane('lotPreview');
    pane.style.zIndex = '460';
  }
  if (!previewRenderer) previewRenderer = L.svg({ pane: 'lotPreview' });
  return previewRenderer;
}
let stepId = 'qd';
let hoCs = { id: '', parent: '', values: {} };
let crsId = 'HUE_3';
let crsLon0 = '';
const held = {};

const TYPE_OPTIONS = `
  <option value="1-CV">1. Công viên, điểm xanh, vườn hoa</option>
  <option value="2-BDX">2. Bãi đỗ xe, trạm sạc xe điện</option>
  <option value="3-MN">3. Trường Mầm non</option>
  <option value="4-TH">4. Trường Tiểu học</option>
  <option value="5-THCS">5. Trường THCS</option>
  <option value="6-THPT">6. Trường THPT</option>
  <option value="7-YT">7. Bệnh viện, Trạm y tế</option>
  <option value="8-VH">8. Nhà văn hóa, thể thao</option>
  <option value="9-TM">9. Chợ, Trung tâm thương mại</option>
  <option value="10-PCCC">10. Trụ sở cảnh sát PCCC</option>
  <option value="11-NT">11. Nhà tang lễ, nghĩa trang</option>
  <option value="12-CSD" selected>12. Cơ sở chưa sử dụng</option>
  <option value="13-BUS">13. Trạm dừng xe buýt</option>
  <option value="14-NOXH">14. Chung cư</option>`;

const STEPS = [
  { id: 'qd', label: 'Quyết định', hint: 'Quyết định phê duyệt đồ án.', file: 'pdf', max: 2 * MB, accept: '.pdf' },
  { id: 'ql', label: 'Quy chế', hint: 'Quy chế theo đồ án. Khác quyết định phê duyệt.', file: 'pdf', max: 10 * MB, accept: '.pdf', docRole: 'quy-dinh' },
  { id: 'tm', label: 'Thuyết minh', file: 'pdf', max: 10 * MB, accept: '.pdf', docRole: 'thuyet-minh' },
  { id: 'ranh', label: 'Bản vẽ ranh giới quy hoạch', file: 'draw', draw: 'boundary', sector: '', phase: 'quy-hoach', role: 'ranh-hoso' },
  { id: 'dat-ht', label: 'Hiện trạng sử dụng đất', file: 'draw', draw: 'land', sector: 'sdd', phase: 'hien-trang', role: 'ht-dat-hoso' },
  { id: 'dat-qh', label: 'Quy hoạch sử dụng đất', file: 'draw', draw: 'land', sector: 'sdd', phase: 'quy-hoach', role: 'qh-dat-hoso' }
];
const NET_ROLE = {
  'giao-thong:hien-trang': 'ht-giao-thong',
  'giao-thong:quy-hoach': 'qh-giao-thong',
  'cap-nuoc:hien-trang': 'ht-cap-nuoc',
  'cap-nuoc:quy-hoach': 'qh-cap-nuoc',
  'cap-dien:hien-trang': 'ht-cap-dien',
  'cap-dien:quy-hoach': 'qh-cap-dien',
  'san-nen-thoat-mua:hien-trang': 'ht-san-nen',
  'san-nen-thoat-mua:quy-hoach': 'qh-san-nen',
  'thoat-nuoc-thai:hien-trang': 'ht-thoat-thai',
  'thoat-nuoc-thai:quy-hoach': 'qh-thoat-thai',
  'chat-thai-ran-nghia-trang:hien-trang': 'ht-chat-thai',
  'chat-thai-ran-nghia-trang:quy-hoach': 'qh-chat-thai',
  'thong-tin-lien-lac:hien-trang': 'ht-vien-thong',
  'thong-tin-lien-lac:quy-hoach': 'qh-vien-thong'
};
SECTORS.forEach(s => {
  ['hien-trang', 'quy-hoach'].forEach(phase => {
    const id = `${s.id}-${phase === 'hien-trang' ? 'ht' : 'qh'}`;
    STEPS.push({
      id,
      label: `${phase === 'hien-trang' ? 'Hiện trạng' : 'Quy hoạch'} — ${s.label}`,
      file: 'draw',
      draw: 'network',
      sector: s.id,
      phase,
      role: NET_ROLE[`${s.id}:${phase}`]
    });
  });
});

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;
const PUBLISH_KIND = { ranh: 'ranh-gioi', 'dat-ht': 'hien-trang', 'dat-qh': 'su-dung-dat' };

function allowedKeys() {
  if (isAdmin()) return null;
  return Array.isArray(state.entryUnits) ? state.entryUnits : [];
}

function signedIn() {
  return isAdmin() || (Array.isArray(state.entryUnits) && !!state.authToken);
}

function clearPreview() {
  if (preview && map) map.removeLayer(preview);
  preview = null;
}

function showPreview(features, review) {
  clearPreview();
  const draw = [];
  (review || []).forEach(item => {
    if (!item || !item.geometry) return;
    draw.push({
      type: 'Feature',
      geometry: item.geometry,
      properties: { _mau: 'do', _status: item.status }
    });
  });
  (features || []).forEach(feature => draw.push(feature));
  if (!map || typeof L === 'undefined' || !draw.length) return;
  const fc = asCollection(draw);
  preview = L.geoJSON(fc, {
    pane: 'lotPreview',
    renderer: lotRenderer(),
    style: (f) => {
      if (f.properties && f.properties._mau === 'ranh') {
        return { color: '#0f172a', weight: 2, fillOpacity: 0 };
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
      return {
        color: f.geometry && f.geometry.type === 'LineString' ? '#2563eb' : '#7c3aed',
        weight: 2,
        fillColor: '#c4b5fd',
        fillOpacity: 0.28
      };
    },
    pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, color: '#b45309', weight: 2, fillColor: '#fbbf24', fillOpacity: 0.95 })
  });
  preview.addTo(map);
  try {
    const b = preview.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.2));
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
    return `<p class="entry-note">Đang đăng nhập quản trị. Chỉ tiêu, công trình và bản vẽ ghi thẳng bản công bố. Đồ án đã có lớp sử dụng đất hoặc ranh thì không thêm bản sao.</p>`;
  }
  if (signedIn()) {
    const who = state.authUser && (state.authUser.name || state.authUser.email) || '';
    return `<p class="entry-note">Cán bộ ${escapeHtml(who)}. Danh sách đơn vị lấy từ tab CanBo. Bản gửi vào hàng chờ, chưa hiện trên bản đồ công khai.</p>`;
  }
  return `<p class="entry-note">Đăng nhập Google. Email có trong tab CanBo và Trạng thái TRUE mới gửi được, đúng đơn vị được giao. Quản trị không bị khóa đơn vị.</p>`;
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

function renderHanhChinh() {
  const root = $('flowHanhChinh');
  if (!root) return;
  const allow = allowedKeys();
  const locked = Array.isArray(allow) && allow.length === 1;
  const scope = locked ? scopeOfKey(allow[0]) : ($('hcScope')?.value || 'dothi');
  const unit = locked ? allow[0] : ($('hcUnit')?.value || optionsFirst(scope));
  const partial = EVAL_URBANS.find(u => u.key === unit && u.partial);
  const known = !unit || EVAL_URBANS.some(u => u.key === unit) || unit.startsWith('xa:') || unit === 'tp:TP';
  const fields = fieldsForScope(scope === 'tp' ? 'tp' : scope === 'xa' ? 'xa' : 'dothi');
  const saved = readUnit(unit) || {};
  const inputs = fields.map(f => fieldHtml(f, saved[f.key] || '')).join('');
  const miss = missHtml(unit);
  root.innerHTML = `<p class="entry-note">Nhập chỉ tiêu dùng khi chấm phân loại, nâng cấp đô thị. Dân số và diện tích cả phường đã có trong bảng thống kê; ô dưới để đính chính. Đô thị một phần xã: nhập phần trong ranh hiện trạng, không nhập cả xã.</p>
    <div class="form-grid">
      <label for="hcScope">Cấp</label>
      <select id="hcScope"${locked ? ' disabled' : ''}>
        <option value="tp"${scope === 'tp' ? ' selected' : ''}>Thành phố</option>
        <option value="dothi"${scope === 'dothi' ? ' selected' : ''}>Đô thị</option>
        <option value="xa"${scope === 'xa' ? ' selected' : ''}>Xã, phường</option>
      </select>
      <label for="hcUnit">Đơn vị</label>
      <select id="hcUnit"${locked ? ' disabled' : ''}>${optionsHtml(scope, unit)}</select>
    </div>
    ${partial ? `<p class="entry-note">Đô thị này là một phần xã ${escapeHtml(partial.partial)}. Dân số ước theo ranh hiện trạng; ô dân số để đính chính.</p>` : ''}
    ${!known ? '<p class="entry-note">Đơn vị này không thuộc 16 đô thị của Quyết định 756. Số vẫn lưu; bảng chấm hiện chỉ đọc 16 đô thị đó và các xã, phường.</p>' : ''}
    <div class="form-grid">${inputs}</div>
    <button type="button" class="btn-submit" id="hcSave">Lưu trên máy và gửi bảng</button>
    <button type="button" class="btn-submit btn-secondary" id="hcLoad">Nạp số đã gửi</button>
    <div id="hcStatus" class="rp-status" role="status"></div>
    <details class="entry-legacy"><summary>Ô còn thiếu của đơn vị này</summary>${miss}</details>`;
  $('hcScope')?.addEventListener('change', renderHanhChinh);
  $('hcUnit')?.addEventListener('change', renderHanhChinh);
  $('hcSave')?.addEventListener('click', saveHanhChinh);
  $('hcLoad')?.addEventListener('click', loadHanhChinh);
}

function optionsFirst(scope) {
  const allow = allowedKeys();
  const list = areasOf(scope).filter(a => !allow || allow.includes(unitKeyOf(a.type, a.code)));
  const first = list[0];
  return first ? unitKeyOf(first.type, first.code) : '';
}

function fieldHtml(f, value) {
  const id = `hc-${f.key}`;
  if (f.kind === 'num') {
    return `<label for="${id}">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ''}</label>
      <input id="${id}" data-field="${f.key}" type="number" min="0" step="any" value="${escapeHtml(value)}" placeholder="${f.optional ? 'Không bắt buộc' : ''}">`;
  }
  const opts = (f.options || []).map(o => `<option value="${o.value}"${value === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<label for="${id}">${escapeHtml(f.label)}</label>
    <select id="${id}" data-field="${f.key}"><option value="">Chưa nhập</option>${opts}</select>`;
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

async function postJson(action, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  const res = await fetch(geeApi(`action=${action}`), { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false || data.error) throw new Error(data.message || data.error || `Lỗi ${res.status}`);
  return data;
}

async function saveHanhChinh() {
  const status = $('hcStatus');
  const unit = $('hcUnit')?.value || '';
  if (!officerCanEdit(unit)) {
    if (status) status.textContent = 'Đăng nhập cán bộ hoặc quản trị, đúng đơn vị được giao.';
    return;
  }
  const fields = collectFields($('flowHanhChinh'));
  const officer = (state.authUser && (state.authUser.name || state.authUser.email)) || '';
  writeUnit(unit, fields, { officer });
  const [type, code] = unit.split(':');
  const name = areasOf(type === 'tp' ? 'tp' : type).find(a => unitKeyOf(a.type, a.code) === unit)?.name || unit;
  try {
    const data = await postJson('saveUrbanInputs', { unitKey: unit, unitType: type, unitCode: code, unitName: name, officer, fields });
    if (status) status.textContent = data.staged ? 'Đã lưu trên máy và gửi hàng chờ duyệt.' : 'Đã lưu trên máy và ghi bảng chỉ tiêu.';
  } catch (err) {
    if (status) status.textContent = `Đã lưu trên máy. Chưa gửi được bảng: ${err.message}`;
  }
  renderHanhChinh();
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
    if (status) status.textContent = `Đã nạp ${data.rows?.length || 0} ô từ bảng.`;
    renderHanhChinh();
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
    return;
  }
  const clip = clipSchemeLots(source, boundary);
  held[step.id] = { ...base, features: clip.features, review: clip.review, counts: clip.counts, clipNote: '' };
}

function reclipLands() {
  STEPS.forEach(step => {
    if (step.draw !== 'land') return;
    const bag = held[step.id];
    if (!bag || !bag.source) return;
    applyLandClip(step, bag.source);
  });
}

function showStepPreview() {
  const step = STEPS.find(s => s.id === stepId);
  const bag = step && held[step.id];
  if (!bag || ((!bag.features || !bag.features.length) && !(bag.review && bag.review.length))) {
    clearPreview();
    return;
  }
  const draw = (bag.features || []).slice();
  if (step.draw === 'land' && held.ranh && held.ranh.source) {
    held.ranh.source.forEach(feature => {
      if (!feature || !feature.geometry) return;
      draw.push({
        type: 'Feature',
        geometry: feature.geometry,
        properties: { ...(feature.properties || {}), _mau: 'ranh' }
      });
    });
  }
  showPreview(draw, bag.review || []);
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

function hoMeta(step) {
  const area = selectedArea('hoScope', 'hoUnit');
  return {
    scheme: $('hoScheme')?.value.trim() || '',
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

function renderHoSo() {
  const root = $('hoSoBox');
  if (!root) return;
  rememberHosoCapacity();
  const allow = allowedKeys();
  const locked = Array.isArray(allow) && allow.length === 1;
  const scheme = $('hoScheme')?.value || '';
  const level = $('hoLevel')?.value || 'QHPK';
  const scope = locked ? scopeOfKey(allow[0]) : ($('hoScope')?.value || 'xa');
  const unit = locked ? allow[0] : ($('hoUnit')?.value || optionsFirst(scope));
  const nav = STEPS.map((s, i) => {
    const done = held[s.id] && !held[s.id].error && (held[s.id].file || held[s.id].features);
    return `<button type="button" class="entry-step-btn${s.id === stepId ? ' on' : ''}" data-step="${s.id}">${i + 1}. ${escapeHtml(s.label)}${done ? ' · có file' : ''}</button>`;
  }).join('');
  const levels = FACET_LEVELS.map(l => `<option value="${l.id}"${l.id === level ? ' selected' : ''}>${escapeHtml(l.label)}</option>`).join('');
  root.innerHTML = `<p class="entry-note">Một đồ án, hai nhóm hồ sơ: quy hoạch sử dụng đất và bảy ngành hạ tầng. Quản trị: sử dụng đất và ranh thành lớp ngay, trừ đồ án đã có lớp đó. Cán bộ: gửi hàng chờ. Lô sử dụng đất lọc theo ranh đã tải trong hồ sơ: lệch không quá ${SCHEME_EDGE_M} m thì giữ nguyên hình; lô đỏ là lô bị bỏ hoặc bị cắt. Quản trị tick lô đỏ muốn giữ hình gốc khi duyệt.</p>
    <div class="form-grid">
      <label for="hoScheme">Đồ án</label>
      <input id="hoScheme" maxlength="120" placeholder="Tên đồ án đã có trên bucket" value="${escapeHtml(scheme)}">
      <label for="hoLevel">Cấp</label>
      <select id="hoLevel">${levels}</select>
      <label for="hoScope">Đơn vị</label>
      <select id="hoScope"${locked ? ' disabled' : ''}>
        <option value="tp"${scope === 'tp' ? ' selected' : ''}>Thành phố</option>
        <option value="dothi"${scope === 'dothi' ? ' selected' : ''}>Đô thị</option>
        <option value="xa"${scope === 'xa' ? ' selected' : ''}>Xã, phường</option>
      </select>
      <label for="hoUnit">Phạm vi</label>
      <select id="hoUnit"${locked ? ' disabled' : ''}>${optionsHtml(scope, unit)}</select>
    </div>
    ${hosoCapacityHtml(hoCs)}
    <div class="entry-steps" id="hoNav">${nav}</div>
    <div id="hoActive"></div>
    <button type="button" class="btn-submit" id="hoSave">Lưu hồ sơ</button>
    <button type="button" class="btn-submit btn-secondary" id="hoDownload">Tải GeoJSON đã gắn trục</button>
    <div id="hoStatus" class="rp-status" role="status"></div>`;
  $('hoScope')?.addEventListener('change', () => { if ($('hoUnit')) $('hoUnit').innerHTML = optionsHtml($('hoScope').value, ''); renderActive(); });
  $('hoNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    stepId = btn.dataset.step;
    renderHoSo();
  });
  $('hoSave')?.addEventListener('click', saveHoSo);
  $('hoDownload')?.addEventListener('click', downloadHoSo);
  renderActive();
}

function renderActive() {
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
  const crs = step.file === 'draw' ? `<div class="form-grid">
      <label for="hoCrs">Hệ tọa độ</label>
      <select id="hoCrs">${crsOpts}</select>
      <label for="hoLon0">Kinh tuyến trục</label>
      <input id="hoLon0" type="number" min="102" max="110" step="0.25" placeholder="Ví dụ 107.5" value="${escapeHtml(crsLon0)}"${crsId === 'custom' ? '' : ' disabled'}>
    </div>` : '';
  const clipHtml = got?.clipNote
    ? `<p class="entry-note">${escapeHtml(got.clipNote)}</p>`
    : (got?.counts ? `<p class="entry-note lot-flag">${escapeHtml(clipSentence(got.counts))}</p>` : '');
  const note = got
    ? `<p class="entry-note">${escapeHtml(got.file?.name || '')}${got.warning ? ` — ${escapeHtml(got.warning)}` : ''}${got.error ? ` — ${escapeHtml(got.error)}` : ''}${got.features ? ` — ${got.features.length} đối tượng` : ''}</p>${clipHtml}`
    : '';
  box.innerHTML = `<h3 class="entry-step-title">${escapeHtml(step.label)}</h3>
    <p class="entry-note">${limit}.${step.hint ? ` ${escapeHtml(step.hint)}` : ''} ${step.file === 'draw' ? 'Bản vẽ VN-2000 cần đúng kinh tuyến trục trước khi xem trên bản đồ.' : ''}</p>
    ${crs}
    <label class="cad-drop" for="hoFile">
      <span class="cad-drop-main"><b>Chọn file</b></span>
      <span class="cad-drop-sub">${escapeHtml(step.label)}</span>
      <input type="file" id="hoFile" accept="${step.file === 'pdf' ? '.pdf' : '.dxf,.kml,.kmz'}" hidden>
    </label>
    ${note}`;
  $('hoCrs')?.addEventListener('change', () => {
    crsId = $('hoCrs').value;
    if ($('hoLon0')) $('hoLon0').disabled = crsId !== 'custom';
    if (got?.file && step.file === 'draw') takeDraw(step, got.file);
  });
  $('hoLon0')?.addEventListener('change', () => {
    crsLon0 = $('hoLon0').value;
    if (got?.file) takeDraw(step, got.file);
  });
  $('hoFile')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (step.file === 'pdf') takePdf(step, file);
    else takeDraw(step, file);
  });
  showStepPreview();
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
  if (error) { held[step.id] = { file, error }; renderActive(); return; }
  const choice = {
    id: $('hoCrs')?.value || 'HUE_3',
    lon0: $('hoLon0')?.value
  };
  try {
    const parsed = await readDrawingFile(file, step.draw, choice);
    const features = parsed.error ? [] : tagFeatures(parsed.features, hoMeta(step));
    held[step.id] = { file, error: parsed.error || '', warning: parsed.warning || '', needCrs: parsed.needCrs };
    applyLandClip(step, features);
    if (step.id === 'ranh') reclipLands();
  } catch (err) {
    held[step.id] = { file, error: err.message || 'Không đọc được bản vẽ.' };
    clearPreview();
  }
  renderActive();
}

function taggedCollections() {
  const features = [];
  STEPS.forEach(step => {
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
  const body = { tenQH, docRole: step.docRole, name: file.name };
  if (file.size > PDF_INLINE_MAX_BYTES) {
    const sign = await postJson('signProjectPdf', { purpose: 'doc', bytes: file.size, name: file.name });
    await putSignedPdf(sign, file);
    await postJson('putProjectDoc', { ...body, staged: sign.token, bytes: file.size });
  } else {
    await postJson('putProjectDoc', { ...body, pdf: await fileBase64(file) });
  }
  return step.label;
}

async function saveHoSo() {
  const status = $('hoStatus');
  const tenQH = $('hoScheme')?.value.trim() || '';
  const features = taggedCollections();
  const notes = [];
  if (!tenQH) {
    if (status) status.textContent = features.length ? 'Đã có bản vẽ trên máy. Nhập tên đồ án khi cần ghi bucket.' : 'Chọn ít nhất một file.';
    if (features.length) downloadHoSo();
    return;
  }
  try {
    rememberHosoCapacity();
    const filled = String(hoCs.parent || '').trim() || Object.values(hoCs.values || {}).some(row => String(row && row.giaTri || '').trim());
    if (filled && !await loadCongSuat()) {
      if (status) status.textContent = 'Chưa tải được sổ quy mô. Chưa ghi.';
      return;
    }
    const gate = gateHosoCapacity({ name: tenQH, cap: $('hoLevel')?.value || '', draft: hoCs });
    if (!gate.accept) {
      if (status) status.textContent = gate.sentences.join(' ');
      return;
    }
    if (gate.entries.length) {
      storeHosoCapacity(gate, gate.entries);
      notes.push(gate.sentences.join(' ') || (gate.label === 'OK' ? 'quy mô hạ tầng: OK' : 'quy mô hạ tầng: chưa đủ dữ liệu'));
    }
    const area = selectedArea('hoScope', 'hoUnit');
    const unitKey = area ? unitKeyOf(area.type, area.code) : '';
    for (const step of STEPS) {
      if (step.file === 'pdf' && held[step.id]?.file && !held[step.id].error) {
        const saved = await savePdf(step, tenQH, unitKey);
        if (saved) notes.push(saved);
        else if (!isAdmin()) notes.push(`${step.label} giữ trên máy (chọn đúng đơn vị được giao, PDF tối đa 2 MB)`);
      }
    }
    if (!officerCanEdit(unitKey)) {
      notes.push('bản vẽ giữ trên máy — cần đăng nhập đúng đơn vị');
      } else if (isAdmin()) {
      for (const step of STEPS) {
        const bag = held[step.id];
        if (!bag?.features?.length) {
          if (bag?.counts) notes.push(`${step.label} (${clipSentence(bag.counts)}; không ghi)`);
          continue;
        }
        const rows = netPayload(tagFeatures(bag.features, hoMeta(step)));
        const kind = PUBLISH_KIND[step.id];
        if (kind) {
          const done = await postJson('publishSchemeDraw', { tenQH, kind, features: rows });
          const clipNote = bag.counts ? ` ${clipSentence(bag.counts)}` : '';
          notes.push(done.skipped ? `${step.label} (${done.note || 'đã có lớp'})` : `${step.label}.${clipNote}`.trim());
        } else if (step.role) {
          await postJson('putProjectNet', { tenQH, role: step.role, features: rows });
          notes.push(step.label);
        }
      }
    } else {
      for (const step of STEPS) {
        const bag = held[step.id];
        const hasDraw = bag?.features?.length || bag?.review?.length;
        if (!hasDraw) continue;
        const tagged = tagFeatures(bag.features || [], hoMeta(step));
        const rows = netPayload(tagged);
        const kind = PUBLISH_KIND[step.id] || 'ban-ve';
        const review = step.draw === 'land' ? reviewBody(step, bag, tagged) : [];
        await postJson('submitChoDuyet', {
          kind,
          unitKey,
          tenQH,
          role: kind === 'ban-ve' ? step.role : '',
          summary: `${step.label} · ${rows.length} đối tượng${bag.counts ? ` · đỏ ${bag.counts.bo + bag.counts.cat}` : ''}`.slice(0, 180),
          features: rows,
          lotReview: review,
          clip: bag.counts ? { edgeM: SCHEME_EDGE_M, ...bag.counts } : undefined
        });
        notes.push(`${step.label} (chờ duyệt)${bag.counts ? ` — ${clipSentence(bag.counts)}` : ''}`);
      }
    }
    if (features.length) downloadHoSo();
    if (status) status.textContent = notes.length ? `Đã xử lý: ${notes.join('; ')}.` : 'Chưa có file hợp lệ.';
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

function renderKienTruc() {
  const root = $('flowKienTruc');
  if (!root) return;
  const allow = allowedKeys();
  const locked = Array.isArray(allow) && allow.length === 1;
  const scope = locked ? scopeOfKey(allow[0]) : ($('ktScope')?.value || 'xa');
  const unit = locked ? allow[0] : ($('ktUnit')?.value || optionsFirst(scope));
  root.innerHTML = `<p class="entry-note">Quy chế quản lý kiến trúc theo phạm vi. Công trình có giá trị dùng cùng mẫu nhập một điểm hạ tầng và ghi tab ${'KienTruc'}.</p>
    <div class="form-grid">
      <label for="ktScope">Cấp</label>
      <select id="ktScope"${locked ? ' disabled' : ''}>
        <option value="tp"${scope === 'tp' ? ' selected' : ''}>Thành phố</option>
        <option value="dothi"${scope === 'dothi' ? ' selected' : ''}>Đô thị</option>
        <option value="xa"${scope === 'xa' ? ' selected' : ''}>Xã, phường</option>
      </select>
      <label for="ktUnit">Đơn vị</label>
      <select id="ktUnit"${locked ? ' disabled' : ''}>${optionsHtml(scope, unit)}</select>
    </div>
    <label class="cad-drop" for="ktPdf">
      <span class="cad-drop-main"><b>Quy chế quản lý kiến trúc</b></span>
      <span class="cad-drop-sub">Quản trị ghi thẳng, tối đa 10 MB. Cán bộ gửi chờ duyệt, tối đa 2 MB.</span>
      <input type="file" id="ktPdf" accept=".pdf" hidden>
    </label>
    <div id="ktPdfNote" class="entry-note"></div>
    <button type="button" class="btn-submit btn-secondary" id="ktPdfSave">Lưu quy chế</button>
    <div class="form-grid">
      <label for="ktType">Loại</label>
      <select id="ktType">${TYPE_OPTIONS}</select>
      <label for="ktPhase">Giai đoạn</label>
      <select id="ktPhase"><option value="HT" selected>Hiện trạng (bổ sung điểm)</option><option value="QH">Quy hoạch mới</option></select>
      <label for="ktNhomHaTang">Phân cấp</label>
      <select id="ktNhomHaTang"><option value="Cấp đô thị">Cấp đô thị</option><option value="Cấp đơn vị ở" selected>Cấp đơn vị ở</option></select>
      <label for="ktName">Tên</label>
      <input type="text" id="ktName" placeholder="Tên công trình kiến trúc">
      <label for="ktLat">Tọa độ</label>
      <div class="rp-coord-row">
        <input type="text" id="ktLat" placeholder="Vĩ độ">
        <input type="text" id="ktLng" placeholder="Kinh độ">
        <button type="button" id="ktPick" title="Ghim trên bản đồ" aria-label="Ghim tọa độ trên bản đồ"><svg class="ico"><use href="#i-pin"/></svg></button>
      </div>
      <label for="ktWard">Phường/Xã</label>
      <input type="text" id="ktWard" placeholder="Tự nhận diện theo tọa độ">
      <label for="ktSize">Diện tích</label>
      <input type="number" id="ktSize" placeholder="m²" min="0" step="1">
      <label for="ktRadius">Bán kính</label>
      <output id="ktRadius" class="rp-radius">—</output>
      <label for="ktLinkAnh">Thư mục ảnh</label>
      <input type="text" id="ktLinkAnh" maxlength="300" placeholder="Liên kết bucket, để trống nếu chưa có">
      <label for="ktLink3d">Thư mục dữ liệu 3D</label>
      <input type="text" id="ktLink3d" maxlength="300" placeholder="Liên kết bucket, để trống nếu chưa có">
    </div>
    <button type="button" class="btn-submit" id="ktSubmit">Gửi công trình</button>
    <div id="ktStatus" class="rp-status" role="status"></div>`;
  $('ktScope')?.addEventListener('change', renderKienTruc);
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
  $('ktSubmit')?.addEventListener('click', async () => {
    const area = selectedArea('ktScope', 'ktUnit');
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
        khuVuc: area ? `${area.type}:${area.code}` : ''
      }
    });
  });
  updateRadiusPreview('kt');
}

async function saveKtPdf() {
  const note = $('ktPdfNote');
  const file = held.ktPdf;
  const area = selectedArea('ktScope', 'ktUnit');
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
    const body = { unitKey, name: file.name };
    if (file.size > PDF_INLINE_MAX_BYTES) {
      const sign = await postJson('signProjectPdf', { purpose: 'doc', bytes: file.size, name: file.name });
      await putSignedPdf(sign, file);
      body.staged = sign.token;
      body.bytes = file.size;
    } else body.pdf = await fileBase64(file);
    const saved = await postJson('putKienTrucPdf', body);
    if (note) note.textContent = saved.url ? `Đã ghi quy chế: ${saved.url}` : 'Đã ghi quy chế.';
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

export function openEntryFlow(id, opts = {}) {
  document.querySelectorAll('.entry-flow-btn').forEach(btn => {
    const on = btn.dataset.flow === id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  ['flowHanhChinh', 'flowHoSo', 'flowKienTruc'].forEach(fid => {
    const el = $(fid);
    if (el) el.hidden = fid !== id;
  });
  if (id !== 'flowKienTruc') {
    state.isPickMode = false;
    state.pickTarget = 'infra';
  }
  if (id !== 'flowHoSo') clearPreview();
  if (opts.legacy) $('entryLegacy')?.setAttribute('open', '');
}

export function initEntryFlows(hooks = {}) {
  if (hooks.submitInfraPoint) submitInfraPoint = hooks.submitInfraPoint;
  if (hooks.updateRadiusPreview) updateRadiusPreview = hooks.updateRadiusPreview;
  paintOfficer();
  renderHanhChinh();
  renderHoSo();
  renderKienTruc();
  document.addEventListener('auth:change', () => {
    paintOfficer();
    renderHanhChinh();
    renderHoSo();
    renderKienTruc();
  });
  $('entryFlows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow]');
    if (!btn) return;
    openEntryFlow(btn.dataset.flow);
  });
}
