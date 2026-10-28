// Lớp 15 — dự án kêu gọi đầu tư (sheet 15-DA): ranh từ KML, thuộc tính từ danh sách.
// Cùng nhóm «sử dụng hạ tầng» với nhà ở xã hội: không bán kính phục vụ, không tính độ phủ.
// Bấm ranh: bảng góc trên trái. Nút kiểm tra quy hoạch cắt polygon với 4 cấp như bảng thửa / vùng đo.
import { map } from './mapEngine.js';
import { signOutAdmin } from './uiComponents.js';
import { planMap, onCompareChange, isCompareOn, isSplitOn } from './planMap.js';
import { geeApi } from './api.js';
import { state } from './state.js';
import { escapeHtml, fmtNum, ico, showToast, TOOL_START_EVENT } from './utils.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { applyInspectLevel, geometryPoint, inspectLevelSyncing } from './viewFlow.js';
import { matchInvestDetail, sheetProjectName, sheetMapPoint } from './investMatch.js';
import { editInvestGroups, settleInvestSync } from './investGroups.js';
import {
  classifyInvestGroup, classifyDvtmSub, INVEST_GROUPS, DVTM_SUBGROUPS, DVTM_SUB_DEFAULT,
  isInvestGroupId, investGroupLabel
} from './investClassify.js';
import { readDrawingFile } from './drawingReaders.js';
import { countApartments } from './apartmentLayer.js';
import { analyzeParcelPlan, parcelPlanHtml, planPlace, mountParcelPies, clearParcelPies } from './planLandStats.js';
import { parcelQhcHtml } from './qhc2045Layer.js';
import { parcelQhctHtml } from './qhctLayer.js';
import { setQuietProjectOutline, restoreInspectFocus } from './projectLayer.js';

const PANE = 'investPane';
// Trên lớp đô thị đang chọn (urbanFocus 444–446, hover 449) để bấm được ranh dự án.
const PANE_Z = 460;
const HL_PANE = 'investHighlightPane';
const HL_PANE_Z = 628;
const MARK_PANE = 'investMarkPane';
const MARK_PANE_Z = 640;
const PICK = {
  color: '#22d3ee', weight: 3, opacity: 1, dashArray: null,
  fillColor: '#22d3ee', fillOpacity: 0.22, fillRule: 'nonzero', lineJoin: 'round'
};
const GROUP_STORE = 'qh_invest_groups';
const SECTORS = [
  [/y tế|bệnh viện/i, 'cross', '#f87171'],
  [/giáo dục|đào tạo|trường học/i, 'book', '#60a5fa'],
  [/nông nghiệp|trồng trọt/i, 'leaf', '#4ade80'],
  [/năng lượng|điện|mặt trời/i, 'bolt', '#facc15'],
  [/công nghiệp/i, 'factory', '#c4b5fd'],
  [/công nghệ|thông tin/i, 'cpu', '#22d3ee'],
  [/du lịch|nghỉ dưỡng/i, 'tour', '#fbbf24'],
  [/thương mại|dịch vụ|chợ|cảng/i, 'shop', '#fb7185'],
  [/văn h[oó]a|thể thao/i, 'flag', '#f472b6'],
  [/hạ tầng|giao thông/i, 'road', '#94a3b8'],
  [/bất động sản|đô thị|dân cư|nhà ở/i, 'home', '#38bdf8']
];
const MAGENTA = '#ff00ff';
const BASE = {
  color: MAGENTA, weight: 2.4, opacity: 1, dashArray: '8 5',
  fillColor: MAGENTA, fillOpacity: 0.14, fillRule: 'nonzero', lineJoin: 'round'
};
const HOVER = { ...BASE, weight: 2.8, fillOpacity: 0.24 };
const HALO = { color: '#ffffff', weight: 7, opacity: 1, fill: false, lineJoin: 'round' };
const LINE = { ...BASE, fill: false };
const PLAN_TABS = [
  { id: 'qhc25', name: 'QHC', scale: '1/25.000' },
  { id: 'qhc10', name: 'QHC', scale: '1/10.000' },
  { id: 'qhpk', name: 'QHPK', scale: '1/2.000' },
  { id: 'qhct', name: 'QHCT', scale: '1/500' }
];

const $ = (id) => document.getElementById(id);
const isPlanLevel = (id) => PLAN_TABS.some(t => t.id === id);

let visible = false;
let ready = null;
let pack = null;
let sheetRows = [];
let sheetOnly = [];
const investOpen = new Set();
const investHidden = new Set();
/** Nhóm con DVTM đang mở danh sách (mặc định chỉ nhóm khách sạn / du lịch). */
const dvtmFoldOpen = new Set([DVTM_SUB_DEFAULT]);
let dvtmMapDefaultDone = false;
let investPicked = '';
let investDrawRaf = 0;
let leftGroup = null;
let rightGroup = null;
let projectCache = null;
const centerMemo = new WeakMap();
let hovered = null;
let selected = null;
let card = null;
let highlight = null;
let landFill = null;
let openSeq = 0;
let drawToken = 0;
let groups = [];

function activeDtTab() {
  return document.querySelector('#levelPickDt .level-pick-btn.is-on')?.dataset?.dtTab || 'dvtm';
}

function rowAlias(row) {
  if (!row) return '';
  return String(row._alias || sheetProjectName(row) || '').replace(/\s+/g, ' ').trim();
}

function rowGroupId(row, title) {
  return classifyInvestGroup(row, title, row?._groupId);
}

function rowDvtmSub(row, title, groupId) {
  if (groupId !== 'dvtm') return '';
  return classifyDvtmSub(row, title);
}

/** Lần đầu có pack: ẩn mọi dự án DVTM không thuộc nhóm 1 để bớt lag khi mở tab. */
function applyDvtmMapDefault() {
  if (dvtmMapDefaultDone || !pack) return;
  dvtmMapDefaultDone = true;
  projectList().forEach(p => {
    if (p.dtGroup !== 'dvtm') return;
    if (p.dvtmSub !== DVTM_SUB_DEFAULT) investHidden.add(projectKey(p));
  });
}

function setDvtmSubMap(subId, on) {
  projectList().forEach(p => {
    if (p.dtGroup !== 'dvtm' || p.dvtmSub !== subId) return;
    const id = projectKey(p);
    if (!id) return;
    if (on) investHidden.delete(id);
    else investHidden.add(id);
  });
}

function dvtmSubMapOn(subId, items) {
  return items.some(p => !investHidden.has(projectKey(p)));
}

function toolBusy() {
  return !!(state.sketchTool || state.adminDrawMode || state.isPickMode || state.activeMeasureType || state.isInspectMode);
}

function isAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

function featureKey(feature) {
  const name = String(feature?.properties?.name || '').replace(/\s+/g, ' ').trim();
  const geom = feature?.geometry;
  const ring = geom?.type === 'Polygon' ? geom.coordinates?.[0] : geom?.type === 'MultiPolygon' ? geom.coordinates?.[0]?.[0] : null;
  const pt = ring && ring[0] ? ring[0] : [0, 0];
  return `${name}|${Number(pt[0]).toFixed(5)},${Number(pt[1]).toFixed(5)}`;
}

function sectorOf(text) {
  const label = String(text || '').replace(/\s+/g, ' ').trim().replace(/^lĩnh vực\s+/i, '');
  for (const [re, icon, color] of SECTORS) {
    if (re.test(label)) return { icon, color, label: label || 'Dự án' };
  }
  return { icon: 'layers', color: '#e2e8f0', label: label || 'Dự án' };
}

function entry(row, re) {
  if (!row) return '';
  const key = Object.keys(row).find(k => re.test(k) && !String(k).startsWith('_'));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

function fieldKind(key) {
  const k = String(key || '');
  if (/tên dự án|lĩnh vực|địa điểm|diện tích|ưu tiên|mục tiêu/i.test(k)) return 'overview';
  return 'detail';
}

function shortLabel(key) {
  const k = String(key || '');
  if (/ưu tiên/i.test(k)) return 'Mức độ ưu tiên';
  if (/địa điểm/i.test(k)) return 'Địa điểm';
  if (/diện tích/i.test(k)) return 'Diện tích';
  if (/lĩnh vực/i.test(k)) return 'Lĩnh vực';
  if (/hiện trạng/i.test(k)) return 'Hiện trạng sử dụng đất';
  if (/mục tiêu/i.test(k)) return 'Mục tiêu và nhu cầu đầu tư';
  if (/phù hợp/i.test(k)) return 'Sự phù hợp quy hoạch';
  if (/kết nối/i.test(k)) return 'Kết nối hạ tầng';
  if (/cần triển khai/i.test(k)) return 'Thủ tục cần triển khai';
  if (/thủ tục đã/i.test(k)) return 'Thủ tục đã thực hiện';
  if (/hình thức/i.test(k)) return 'Hình thức lựa chọn nhà đầu tư';
  if (/google|vị trí/i.test(k)) return 'Vị trí bản đồ';
  if (/^stt$/i.test(k)) return 'Số thứ tự';
  return k;
}

function sheetOf(members, anchor) {
  if (anchor?.properties?.sheet) return anchor.properties.sheet;
  for (const m of members || []) if (m.properties?.sheet) return m.properties.sheet;
  return null;
}

function membersOf(feature) {
  const id = feature?.properties?.groupId;
  if (!id || !pack) return [feature];
  const list = pack.filter(f => f.properties?.groupId === id);
  return list.length ? list : [feature];
}

function unionGeom(members) {
  if (!members?.length) return null;
  if (members.length === 1) return members[0].geometry;
  const polys = [];
  members.forEach(f => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  });
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : members[0].geometry;
}

function centerOf(geom) {
  if (!geom) return null;
  if (centerMemo.has(geom)) return centerMemo.get(geom);
  let at = null;
  try {
    const p = turf.pointOnFeature(geom);
    const c = p.geometry.coordinates;
    if (c && c.length >= 2) at = L.latLng(c[1], c[0]);
  } catch { at = null; }
  centerMemo.set(geom, at);
  return at;
}

function invalidateProjects() {
  projectCache = null;
}

function projectList(features) {
  const src = features || pack || [];
  const useCache = !features || features === pack;
  if (useCache && projectCache) return projectCache;
  const seen = new Set();
  const matchedRows = new Set();
  const out = [];
  const byGroup = new Map();
  src.forEach(f => {
    const gid = f.properties?.groupId;
    if (!gid) return;
    let list = byGroup.get(gid);
    if (!list) byGroup.set(gid, list = []);
    list.push(f);
  });
  src.forEach(feature => {
    const id = feature.properties?.groupId || feature.properties?._key;
    if (!id || seen.has(id)) return;
    seen.add(id);
    const members = feature.properties?.groupId
      ? (byGroup.get(feature.properties.groupId) || [feature])
      : [feature];
    const sheet = sheetOf(members, feature);
    if (sheet) matchedRows.add(sheet);
    const title = sheetProjectName(sheet) || feature.properties?.name || 'Ranh dự án';
    const sectorText = entry(sheet, /lĩnh vực/i) || members.map(m => m.properties?.folder).find(Boolean) || '';
    const geom = unionGeom(members);
    const pin = !geom && sheet ? sheetMapPoint(sheet) : null;
    out.push({
      feature: members[0],
      members,
      geom,
      pin,
      sheet,
      sector: sectorOf(sectorText),
      matched: !!sheet,
      hasBoundary: !!geom,
      sheetOnly: !!feature.properties?._sheetOnly,
      title,
      areaText: areaTextOf(sheet, geom),
      dtGroup: rowGroupId(sheet, title)
    });
    const last = out[out.length - 1];
    last.dvtmSub = rowDvtmSub(sheet, title, last.dtGroup);
  });
  sheetOnly.forEach(p => {
    if (p.sheet && matchedRows.has(p.sheet)) return;
    const id = projectKey(p);
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (!p.areaText) p.areaText = areaTextOf(p.sheet, p.geom || null);
    if (!p.dvtmSub) p.dvtmSub = rowDvtmSub(p.sheet, p.title, p.dtGroup);
    out.push(p);
  });
  if (useCache) projectCache = out;
  return out;
}

function projectsForTab(tab) {
  const id = tab || activeDtTab();
  return projectList().filter(p => p.dtGroup === id);
}

function planMapLive() {
  return !!(planMap && (isCompareOn() || isSplitOn()));
}

function readStore() {
  try {
    const data = JSON.parse(localStorage.getItem(GROUP_STORE) || '{}');
    const list = Array.isArray(data.groups) ? data.groups.filter(g => g && Array.isArray(g.keys) && g.keys.length >= 2) : [];
    const ops = Array.isArray(data.ops) ? data.ops.filter(op => op && Array.isArray(op.keys) && op.keys.length) : [];
    return { groups: list, ops };
  } catch { return { groups: [], ops: [] }; }
}

function writeStore(list, ops) {
  try { localStorage.setItem(GROUP_STORE, JSON.stringify({ groups: list, ops: ops || [] })); } catch { /* bộ nhớ trình duyệt đầy */ }
}

function adoptGroups(server) {
  const store = readStore();
  const settled = settleInvestSync(server, store.groups, store.ops);
  groups = settled.groups;
  writeStore(groups, settled.ops);
}

function stampGroups() {
  const mapKey = new Map();
  groups.forEach(g => {
    if (!g || !Array.isArray(g.keys) || g.keys.length < 2) return;
    g.keys.forEach(k => mapKey.set(k, g.id || g.keys[0]));
  });
  (pack || []).forEach(f => {
    f.properties.groupId = mapKey.get(f.properties._key) || '';
  });
  invalidateProjects();
}

function commitGroups(keys, clear) {
  const store = readStore();
  groups = editInvestGroups(groups, keys, clear, 'g' + Date.now().toString(36));
  const opKeys = [];
  const seen = new Set();
  keys.forEach(k => {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    opKeys.push(key);
  });
  const ops = opKeys.length ? store.ops.concat([{ keys: opKeys, clear: !!clear }]) : store.ops;
  writeStore(groups, ops);
  stampGroups();
}

function planInspecting() {
  const box = $('investCard')?.querySelector('.invest-plan');
  return !!(card && box && !box.hidden);
}

function styleFor(feature) {
  if (card?.grouping && card.picks?.has(feature?.properties?._key)) return PICK;
  if (planInspecting() && card.members?.includes(feature)) return LINE;
  return BASE;
}

function eachPoly(fn) {
  [leftGroup, rightGroup].forEach(g => g?.eachLayer(layer => {
    if (layer.feature?.geometry) fn(layer);
  }));
}

function findLayer(feature, host) {
  const group = host === planMap ? rightGroup : leftGroup;
  let found = null;
  group?.eachLayer(layer => { if (layer.feature === feature) found = layer; });
  return found;
}

function paintPicks() {
  eachPoly(layer => layer.setStyle(styleFor(layer.feature)));
}

function titleOf(props) {
  return sheetProjectName(props.sheet) || props.name || 'Ranh dự án';
}

function viewOf(st) {
  const props = { ...(st.feature?.properties || {}) };
  props.sheet = st.sheet || null;
  if (!props.folder) props.folder = (st.members || []).map(m => m.properties?.folder).find(Boolean) || '';
  return props;
}

function recordedM2(row) {
  if (!row) return 0;
  const key = Object.keys(row).find(k => /diện tích/i.test(k));
  if (!key) return 0;
  let s = String(row[key]).replace(/ha|m²|m2/ig, '').trim();
  let n;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return /ha/i.test(key) || /ha/i.test(row[key]) ? n * 10000 : n;
}

function fieldValue(value) {
  const text = String(value ?? '');
  const url = text.match(/https?:\/\/\S+/);
  if (!url) return escapeHtml(text);
  const href = url[0].replace(/[),.;]+$/, '');
  return escapeHtml(text.replace(href, '')).trim()
    ? `${escapeHtml(text.replace(href, '').trim())} <a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(href)}</a>`
    : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Mở liên kết</a>`;
}

function rowEntries(props) {
  const row = props.sheet;
  if (row) return Object.entries(row).filter(([k, v]) => k && !String(k).startsWith('_') && String(v ?? '').trim());
  const list = [];
  if (props.folder) list.push(['Lĩnh vực', props.folder]);
  Object.entries(props.kml || {}).forEach(([k, v]) => { if (String(v ?? '').trim()) list.push([k, v]); });
  return list;
}

function listedArea(row) {
  const key = row && Object.keys(row).find(k => /diện tích/i.test(k));
  if (!key) return '';
  const raw = String(row[key] || '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/ha|m²|m2/ig, '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return raw;
  const unit = /m²|m2/i.test(key + raw) && !/ha/i.test(key) ? 'm²' : 'ha';
  return `${fmtNum(n)} ${unit}`;
}

/** Diện tích hiện trên danh sách: ưu tiên cột sheet, không có thì đo ranh; thiếu thì `-`. */
function areaTextOf(sheet, geom) {
  const listed = listedArea(sheet);
  if (listed) return listed;
  if (geom) {
    try {
      const a = turf.area(geom);
      if (a > 0) return a >= 10000 ? `${fmtNum(a / 10000)} ha` : `${fmtNum(Math.round(a))} m²`;
    } catch { /* ranh hỏng thì bỏ */ }
  }
  return '-';
}

function statHtml(label, value, icon, wide) {
  if (!value) return '';
  return `<div class="invest-stat${wide ? ' is-wide' : ''}"><small>${icon ? ico(icon) : ''}${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`;
}

function overviewHtml(st, props) {
  const row = props.sheet;
  const sectorText = entry(row, /lĩnh vực/i) || props.folder || '';
  const sector = sectorOf(sectorText);
  const goal = entry(row, /mục tiêu/i);
  const place = entry(row, /địa điểm/i);
  const priority = entry(row, /ưu tiên/i);
  const listed = listedArea(row);
  const pieces = st.pieces > 1 ? `<span class="invest-pieces">${st.pieces} mảnh</span>` : '';
  const ambiguous = !row && !!props._ambiguous;
  const noBound = !st.geom;
  const chip = noBound
    ? '<span class="invest-chip">Chưa có ranh</span>'
    : (row ? '' : `<span class="invest-chip">${ambiguous ? 'Chưa chắc' : 'Chưa ghép'}</span>`);
  const alert = noBound
    ? '<div class="invest-alert">Dự án chưa có ranh giới. Admin có thể tải file KML hoặc DXF để bổ sung.</div>'
    : row
      ? ''
      : ambiguous
        ? '<div class="invest-alert">Tên gần với nhiều dòng sheet 15-DA, chưa ghép tự động.</div>'
        : '<div class="invest-alert">Chưa khớp tên với danh sách sheet 15-DA. Đang hiện thông tin ghi trên ranh.</div>';
  const goalHtml = goal
    ? `<div class="invest-lead"><small>Mục tiêu và nhu cầu đầu tư</small><p>${escapeHtml(goal)}</p></div>`
    : '';
  const groupName = investGroupLabel(st.dtGroup || rowGroupId(row, titleOf(props)));
  return `<div class="invest-head">
      <span class="invest-badge" style="color:${sector.color}">${ico(sector.icon)}</span>
      <div class="invest-head-main">
        <div class="invest-kicker"><b>${escapeHtml(sector.label)}</b><span class="invest-pieces">${escapeHtml(groupName)}</span>${pieces}${chip}</div>
        <div class="lp-title">${escapeHtml(titleOf(props))}</div>
      </div>
    </div>
    <div class="invest-stats">
      ${statHtml('Diện tích ranh', st.areaText, 'area', false)}
      ${statHtml('Diện tích danh sách', listed, 'parcel', false)}
      ${statHtml('Địa điểm', place, 'pin', true)}
      ${statHtml('Mức độ ưu tiên', priority, 'flag', !place)}
    </div>
    ${goalHtml}${alert}${adminToolsHtml(st)}${groupHtml(st)}`;
}

function detailHtml(props) {
  const blocks = rowEntries(props).filter(([k]) => props.sheet ? fieldKind(k) === 'detail' : !/lĩnh vực/i.test(k));
  if (!blocks.length) return '<div class="invest-empty">Không có mô tả hiện trạng hay thủ tục thêm.</div>';
  return blocks.map(([k, v]) => `<section class="invest-block"><h4>${escapeHtml(shortLabel(k))}</h4><div class="invest-copy">${fieldValue(v)}</div></section>`).join('');
}

function adminToolsHtml(st) {
  if (!isAdmin()) return '';
  const cur = st.dtGroup || rowGroupId(st.sheet, titleOf(viewOf(st)));
  const opts = INVEST_GROUPS.map(g =>
    `<option value="${g.id}"${g.id === cur ? ' selected' : ''}>${escapeHtml(g.label)}</option>`
  ).join('');
  return `<div class="invest-admin-tools">
    <label class="invest-group-move">Nhóm tab
      <select class="invest-group-select" aria-label="Chuyển nhóm dự án">${opts}</select>
    </label>
    <label class="invest-bound-upload proof-btn">${ico('layers')}Tải ranh KML/DXF
      <input type="file" class="invest-bound-file" accept=".kml,.kmz,.dxf,application/vnd.google-earth.kml+xml" hidden>
    </label>
  </div>`;
}

function groupHtml(st) {
  if (!isAdmin() || !st.geom) return '';
  if (st.grouping) {
    return `<div class="invest-group-bar"><b>Gộp ranh thành một dự án</b><span>Bấm ranh trên bản đồ để thêm hoặc bỏ. Đang chọn ${st.picks.size} mảnh.</span>
      <div class="invest-edit-actions"><button type="button" class="proof-btn invest-group-save">Lưu thành một dự án</button><button type="button" class="invest-group-cancel">Hủy</button></div></div>`;
  }
  const grouped = (st.members || []).length > 1;
  return `<div class="invest-group-actions">
    <button type="button" class="invest-group">${ico('layers')}Gộp thêm ranh vào dự án này</button>
    ${grouped ? '<button type="button" class="invest-ungroup">Tách ranh khỏi dự án</button><button type="button" class="invest-ungroup-all">Bỏ gộp cả nhóm</button>' : ''}
  </div>`;
}

function editPairs(props) {
  const row = props.sheet;
  const pairs = row
    ? Object.entries(row).filter(([k]) => k && !String(k).startsWith('_'))
    : [['Lĩnh vực', props.folder || ''], ...Object.entries(props.kml || {})];
  if (!pairs.some(([k]) => /tên dự án/i.test(k))) pairs.unshift(['Tên dự án', titleOf(props)]);
  return pairs;
}

function editRowHtml(key, value, fresh) {
  const keyHtml = fresh
    ? '<input class="invest-edit-key" maxlength="80" placeholder="Tên trường">'
    : `<span class="invest-edit-key" data-key="${escapeHtml(key)}">${escapeHtml(key)}</span>`;
  return `<label class="invest-edit-row">${keyHtml}<textarea class="invest-edit-val" maxlength="2000" rows="2">${escapeHtml(value || '')}</textarea></label>`;
}

function editButtonHtml() {
  return isAdmin()
    ? `<button type="button" class="invest-edit" title="Sửa thông tin dự án" aria-label="Sửa thông tin dự án">${ico('pen')}</button>`
    : '';
}

function groupCounts() {
  const all = projectList(pack || []);
  const counts = Object.fromEntries(INVEST_GROUPS.map(g => [g.id, 0]));
  all.forEach(p => { if (counts[p.dtGroup] != null) counts[p.dtGroup] += 1; });
  counts.chungcu += countApartments();
  return counts;
}

function paintDtCounts() {
  const counts = groupCounts();
  let total = 0;
  INVEST_GROUPS.forEach(g => {
    const n = counts[g.id] || 0;
    total += n;
    const btn = document.querySelector(`#levelPickDt [data-dt-tab="${g.id}"]`);
    const span = btn?.querySelector('span');
    if (span) span.textContent = `${g.label} (${n})`;
    if (btn) btn.title = `${g.title} (${n})`;
  });
  const mag = $('dtMagLabel');
  const magBtn = document.querySelector('#layerMagTrack [data-main-tab="dautu"]');
  const title = total ? `F. Dự án đầu tư (${total} dự án)` : 'F. Dự án đầu tư';
  if (mag) mag.textContent = title;
  if (magBtn) magBtn.title = title;
  const menuBtn = document.querySelector('#layerMagMenu [data-mag-go="dautu"]');
  if (menuBtn) menuBtn.textContent = title;
}

function refreshHint() {
  paintDtCounts();
}

function ensureInvestOn() {
  const box = $('chk_invest');
  if (!box) return;
  if (!box.checked) {
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (!visible) void setVisible(true);
}

function attachAdminBoundaries(features, rows, boundaries) {
  (boundaries || []).forEach(b => {
    if (!b?.geometry) return;
    const key = String(b.key || '').trim();
    const match = String(b.match || '').trim();
    let row = rows.find(r => r && r._alias === key);
    if (!row && match) row = rows.find(r => sheetProjectName(r) === match);
    if (!row && key) row = rows.find(r => sheetProjectName(r) === key);
    const name = sheetProjectName(row) || match || key || 'Ranh tải lên';
    const alias = rowAlias(row) || key || name;
    const existing = features.find(f => f.properties?._adminKey === alias || (row && f.properties?.sheet === row));
    if (existing) {
      existing.geometry = b.geometry;
      existing.properties = existing.properties || {};
      existing.properties._adminKey = alias;
      existing.properties.sheet = row || existing.properties.sheet;
      existing.properties._key = `admin:${alias}`;
      existing.properties._sheetOnly = false;
      return;
    }
    features.push({
      type: 'Feature',
      geometry: b.geometry,
      properties: {
        name,
        folder: entry(row, /lĩnh vực/i) || '',
        kml: {},
        sheet: row || null,
        _key: `admin:${alias}`,
        _adminKey: alias,
        _sheetOnly: false
      }
    });
  });
}

function rebuildSheetOnly(features, rows) {
  invalidateProjects();
  const used = new Set();
  (features || []).forEach(f => {
    const sheet = f.properties?.sheet;
    if (sheet) used.add(sheet);
  });
  sheetOnly = [];
  (rows || []).forEach(row => {
    if (!row || used.has(row)) return;
    const title = sheetProjectName(row);
    if (!title) return;
    const alias = rowAlias(row) || title;
    const pin = sheetMapPoint(row);
    const feature = {
      type: 'Feature',
      geometry: null,
      properties: {
        name: title,
        folder: entry(row, /lĩnh vực/i) || '',
        kml: {},
        sheet: row,
        _key: `sheet:${alias}`,
        _sheetOnly: true
      }
    };
    sheetOnly.push({
      feature,
      members: [feature],
      geom: null,
      pin,
      sheet: row,
      sector: sectorOf(entry(row, /lĩnh vực/i)),
      matched: true,
      hasBoundary: false,
      sheetOnly: true,
      title,
      areaText: areaTextOf(row, null),
      dtGroup: rowGroupId(row, title)
    });
    const last = sheetOnly[sheetOnly.length - 1];
    last.dvtmSub = rowDvtmSub(row, title, last.dtGroup);
  });
}

async function loadPack() {
  if (!ready) {
    ready = Promise.all([
      fetch('./data/invest-boundary.geojson').then(r => (r.ok ? r.json() : Promise.reject(new Error('không tải được ranh')))),
      loadRows()
    ]).then(async ([fc, loaded]) => {
      const features = (fc && fc.features) || [];
      const rows = loaded.rows || [];
      sheetRows = rows;
      const detail = matchInvestDetail(features, rows);
      features.forEach((f, i) => {
        f.properties = f.properties || {};
        f.properties._key = featureKey(f);
        f.properties.sheet = detail[i].index >= 0 ? rows[detail[i].index] : null;
        f.properties._ambiguous = !!detail[i].ambiguous;
        f.properties._sheetOnly = false;
      });
      attachAdminBoundaries(features, rows, loaded.boundaries);
      pack = features;
      adoptGroups(loaded.groups);
      if (isAdmin()) {
        try { await flushPending(); } catch { /* gửi lại nhóm chưa lưu lỗi thì vẫn hiện ranh */ }
      }
      stampGroups();
      rebuildSheetOnly(pack, rows);
      refreshHint();
      return features;
    });
    ready.catch(err => { ready = null; showToast(`Chưa tải được dự án kêu gọi đầu tư: ${err.message}`, 'error'); });
  }
  return ready;
}

async function loadRows() {
  try {
    const res = await fetch(geeApi('action=getInvestCalls'));
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.rows) && data.rows.length) {
        return {
          rows: data.rows,
          groups: Array.isArray(data.groups) ? data.groups : null,
          boundaries: Array.isArray(data.boundaries) ? data.boundaries : []
        };
      }
    }
  } catch { /* bản đóng gói theo file Excel hiện có */ }
  const res = await fetch('./data/invest-sheet.json');
  if (!res.ok) return { rows: [], groups: null, boundaries: [] };
  const data = await res.json();
  return { rows: data.rows || [], groups: null, boundaries: [] };
}

function ensurePane(m, name, z) {
  if (m.getPane(name)) return;
  const pane = m.createPane(name);
  pane.style.zIndex = String(z);
  if (name === HL_PANE) pane.style.pointerEvents = 'none';
}

function openFromMark(feature, layer, host, e) {
  if (toolBusy()) return;
  L.DomEvent.stopPropagation(e);
  if (card?.grouping && feature?.geometry) { toggleGroupPick(feature); return; }
  openCard(feature, layer, host);
}

function sectorMarker(sector, unmatched) {
  return L.divIcon({
    className: 'invest-pin',
    html: `<div class="invest-mark" style="color:${sector.color};--c:${sector.color}">${ico(sector.icon)}</div>`,
    iconSize: [26, 26],
    iconAnchor: unmatched ? [13, 36] : [13, 13]
  });
}

function projectKey(p) {
  return String(p.feature?.properties?.groupId || p.feature?.properties?._key || '');
}

function shownPack(features) {
  const tab = activeDtTab();
  const drop = new Set();
  projectList(features).forEach(p => {
    if (p.dtGroup !== tab || investHidden.has(projectKey(p))) p.members.forEach(f => drop.add(f));
  });
  return features.filter(f => f.geometry && !drop.has(f));
}

function drawOn(m, features) {
  const drawFeatures = shownPack(features);
  ensurePane(m, PANE, PANE_Z);
  ensurePane(m, MARK_PANE, MARK_PANE_Z);
  const byFeature = new Map();
  const tabProjects = projectsForTab();
  const titleByFeature = new Map();
  tabProjects.forEach(p => p.members.forEach(f => titleByFeature.set(f, p.title)));
  const group = L.geoJSON({ type: 'FeatureCollection', features: drawFeatures }, {
    pane: PANE,
    keyboard: false,
    style: f => styleFor(f),
    onEachFeature: (f, layer) => {
      byFeature.set(f, layer);
      layer.bindTooltip(titleByFeature.get(f) || titleOf(f.properties || {}), { sticky: true, className: 'invest-tip', opacity: 0.95 });
      layer.on('mouseover', () => {
        hovered = layer;
        if (planInspecting() && card?.members?.includes(f)) return;
        if (layer !== selected && !card?.picks?.has(f.properties?._key)) layer.setStyle(HOVER);
        layer.bringToFront();
      });
      layer.on('mouseout', () => {
        if (hovered === layer) hovered = null;
        layer.setStyle(styleFor(f));
      });
      layer.on('click', (e) => openFromMark(f, layer, m, e));
    }
  });
  group.addTo(m);
  tabProjects.filter(p => !investHidden.has(projectKey(p))).forEach(p => {
    let at = p.geom ? centerOf(p.geom) : null;
    if (!at && p.pin) at = L.latLng(p.pin[1], p.pin[0]);
    const layer = byFeature.get(p.feature);
    if (!at) return;
    if (!p.hasBoundary && p.pin) {
      const mark = L.marker(at, {
        pane: MARK_PANE,
        keyboard: false,
        zIndexOffset: 140,
        icon: sectorMarker(p.sector, true)
      });
      mark.bindTooltip(`${p.sector.label} · ${p.title} · chưa có ranh`, { className: 'invest-tip', direction: 'top', offset: [0, -28] });
      mark.on('click', (e) => openFromMark(p.feature, layer || mark, m, e));
      mark.addTo(group);
      return;
    }
    if (!layer) return;
    if (!p.matched) {
      const dot = L.marker(at, {
        pane: MARK_PANE,
        keyboard: false,
        zIndexOffset: 80,
        icon: L.divIcon({ className: 'invest-pin', html: '<div class="invest-dot" title="Chưa ghép với danh sách"></div>', iconSize: [12, 12], iconAnchor: [6, 6] })
      });
      dot.bindTooltip(p.title, { className: 'invest-tip', direction: 'top', offset: [0, -8] });
      dot.on('click', (e) => openFromMark(p.feature, layer, m, e));
      dot.addTo(group);
    }
    const mark = L.marker(at, {
      pane: MARK_PANE,
      keyboard: false,
      zIndexOffset: p.matched ? 120 : 160,
      icon: sectorMarker(p.sector, !p.matched)
    });
    mark.bindTooltip(`${p.sector.label} · ${p.title}`, { className: 'invest-tip', direction: 'top', offset: [0, p.matched ? -8 : -28] });
    mark.on('click', (e) => openFromMark(p.feature, layer, m, e));
    mark.addTo(group);
  });
  return group;
}

function clearHighlight() {
  highlight?.remove();
  highlight = null;
  landFill?.remove();
  landFill = null;
}

function paintLand(geoms, color) {
  const host = card?.map;
  if (!host || !geoms?.length) return;
  ensurePane(host, HL_PANE, HL_PANE_Z);
  landFill = L.geoJSON({
    type: 'FeatureCollection',
    features: geoms.map(geometry => ({ type: 'Feature', properties: {}, geometry }))
  }, {
    pane: HL_PANE,
    interactive: false,
    style: { color: '#111827', weight: 2, opacity: 1, fillColor: color || '#94a3b8', fillOpacity: 0.62 }
  }).addTo(host);
}

function markLand(key) {
  const el = $('investCard');
  el?.querySelectorAll('[data-land]').forEach(n => n.classList.toggle('is-on', n.dataset.land === key));
  const canvas = el?.querySelector('canvas');
  const chart = canvas && typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
  if (!chart?.$keys) return;
  const idx = chart.$keys.indexOf(key);
  chart.data.datasets[0].offset = chart.$keys.map((_, i) => i === idx ? 6 : 0);
  chart.setActiveElements(idx >= 0 ? [{ datasetIndex: 0, index: idx }] : []);
  chart.update();
}

function toggleLand(key, color) {
  if (!card || !key) return;
  if (card.landKey === key) {
    landFill?.remove();
    landFill = null;
    card.landKey = null;
    $('investCard')?.querySelectorAll('[data-land].is-on').forEach(n => n.classList.remove('is-on'));
    return;
  }
  landFill?.remove();
  landFill = null;
  const pack = card.cache.get(card.tab)?.shapes;
  const geoms = key === '__none' ? pack?.none : pack?.byLabel?.[key];
  if (!geoms?.length) return;
  paintLand(geoms, color);
  card.landKey = key;
  markLand(key);
}

function nudge(targetMap, bounds) {
  const el = $('investCard');
  if (!el || el.hidden || !targetMap || !bounds?.isValid?.()) return;
  const sw = targetMap.latLngToContainerPoint(bounds.getSouthWest());
  const ne = targetMap.latLngToContainerPoint(bounds.getNorthEast());
  const left = Math.min(sw.x, ne.x);
  const top = Math.min(sw.y, ne.y);
  const bottom = Math.max(sw.y, ne.y);
  const mr = targetMap.getContainer().getBoundingClientRect();
  const cr = el.getBoundingClientRect();
  const limit = cr.right - mr.left + 16;
  const overlapsY = bottom > cr.top - mr.top && top < cr.bottom - mr.top;
  if (overlapsY && left < limit - 8) targetMap.panBy([left - limit, 0], { animate: true, duration: 0.35 });
}

function frameProject(targetMap, bounds) {
  if (!targetMap || !bounds?.isValid?.()) return;
  const el = $('investCard');
  const cardW = el && !el.hidden ? el.getBoundingClientRect().width + 28 : 48;
  const padTL = L.point(cardW, 80);
  const padBR = L.point(40, 40);
  const fitZ = targetMap.getBoundsZoom(bounds, false, padTL.add(padBR));
  const zoom = Math.min(17, targetMap.getMaxZoom(), fitZ);
  if (targetMap.getZoom() < zoom - 0.2) {
    targetMap.once('moveend', () => nudge(targetMap, bounds));
    targetMap.flyToBounds(bounds, { paddingTopLeft: padTL, paddingBottomRight: padBR, maxZoom: zoom, duration: 0.55 });
    return;
  }
  nudge(targetMap, bounds);
}

function selectLayer(layer, targetMap, geom) {
  if (selected && selected !== layer) selected.setStyle(styleFor(selected.feature));
  selected = layer || null;
  if (layer) {
    layer.setStyle(styleFor(layer.feature));
    layer.bringToFront();
  }
  clearHighlight();
  if (!geom || !targetMap) return;
  ensurePane(targetMap, HL_PANE, HL_PANE_Z);
  highlight = L.layerGroup([
    L.geoJSON(geom, { pane: HL_PANE, interactive: false, keyboard: false, style: HALO }),
    L.geoJSON(geom, { pane: HL_PANE, interactive: false, keyboard: false, style: LINE })
  ]).addTo(targetMap);
}

function syncSelectionStyle() {
  paintPicks();
  if (selected && card) selectLayer(selected, card.map, card.geom);
}

function closeCard() {
  openSeq++;
  restoreInspectFocus();
  setQuietProjectOutline(false);
  card = null;
  selected = null;
  hovered = null;
  eachPoly(layer => layer.setStyle(BASE));
  clearHighlight();
  clearParcelPies();
  const el = $('investCard');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

function ensureCard() {
  let el = $('investCard');
  if (el) return el;
  el = document.createElement('aside');
  el.id = 'investCard';
  el.className = 'cad-card invest-card';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Dự án kêu gọi đầu tư');
  (document.getElementById('mapArea') || document.body).appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.pls-comp-fold')) return;
    const land = e.target.closest('[data-land]');
    if (land) { toggleLand(land.dataset.land, land.dataset.color); return; }
    const info = e.target.closest('[data-info-tab]');
    if (info && card) { showInfo(info.dataset.infoTab); return; }
    const tab = e.target.closest('[data-invest-tab]');
    if (tab) { showTab(tab.dataset.investTab); return; }
    if (e.target.closest('.invest-plan-btn')) { togglePlan(); return; }
    if (e.target.closest('.invest-group-save')) { saveGroup(); return; }
    if (e.target.closest('.invest-group-cancel')) { cancelGroup(); return; }
    if (e.target.closest('.invest-ungroup-all')) { ungroup(true); return; }
    if (e.target.closest('.invest-ungroup')) { ungroup(false); return; }
    if (e.target.closest('.invest-group')) { beginGroup(); return; }
    if (e.target.closest('.invest-edit')) { beginEdit(); return; }
    if (e.target.closest('.invest-add')) { addEditRow(); return; }
    if (e.target.closest('.invest-cancel')) { paintCard(); return; }
    if (e.target.closest('.invest-save')) { saveEdit(); return; }
    if (e.target.closest('.invest-bound-upload') && !e.target.closest('.invest-bound-file')) {
      el.querySelector('.invest-bound-file')?.click();
      return;
    }
    if (e.target.closest('.cad-card-x')) closeCard();
  });
  el.addEventListener('change', (e) => {
    const sel = e.target.closest('.invest-group-select');
    if (sel) { saveGroupMove(sel.value); return; }
    const file = e.target.closest('.invest-bound-file');
    if (file?.files?.[0]) {
      uploadBoundary(file.files[0]);
      file.value = '';
    }
  });
  el.addEventListener('pls-pick', (e) => toggleLand(e.detail?.key, e.detail?.color));
  return el;
}

function tabsBar(current) {
  const tabs = PLAN_TABS.map(t => {
    const on = t.id === current;
    return `<button type="button" class="cad-tab${on ? ' is-on' : ''}" role="tab" data-invest-tab="${t.id}" aria-selected="${on}" title="${t.name} ${t.scale}"><b>${t.name}</b><small>${t.scale}</small></button>`;
  }).join('');
  return `<div class="cad-tabs" role="tablist" aria-label="Quy hoạch trong ranh dự án">${tabs}</div>`;
}

function qhpkNote() {
  const w = planPlace('invest');
  return `Cắt hình học ${w.cut} với lô các đồ án QHPK 1/2.000 đã nạp, kể cả khi lớp QHPK hoặc đồ án đang tắt. Đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn.`;
}

function planPage(id, geometry, recorded) {
  const w = planPlace('invest');
  if (id === 'qhc25' || id === 'qhc10') return parcelQhcHtml(geometry, id, recorded, 'invest');
  if (id === 'qhct') return parcelQhctHtml(geometry, recorded, 'invest');
  return analyzeParcelPlan(geometry, { level: 'QHPK', includeHidden: true }).then(res => ({
    html: parcelPlanHtml(res, recorded, {
      title: `QHPK 1/2.000 ${w.on}`,
      noneLabel: 'Đất khác',
      empty: `${w.it} chưa nằm trong lô QHPK 1/2.000 đã nạp.`,
      place: 'invest',
      note: qhpkNote()
    }),
    shapes: res.shapes
  }));
}

async function showTab(id, { syncMap = true } = {}) {
  const st = card;
  if (!st || !isPlanLevel(id)) return;
  const seq = st.seq;
  st.tab = id;
  if (syncMap) applyInspectLevel(id, geometryPoint(st.geom, st.bounds), st.geom);
  const el = $('investCard');
  const page = el?.querySelector('.cad-page');
  if (!page) return;
  el.querySelectorAll('[data-invest-tab]').forEach(b => {
    const on = b.dataset.investTab === id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  landFill?.remove();
  landFill = null;
  st.landKey = null;
  if (st.cache.has(id)) {
    clearParcelPies();
    page.innerHTML = st.cache.get(id).html;
    mountParcelPies(page);
    return;
  }
  const tab = PLAN_TABS.find(t => t.id === id);
  clearParcelPies();
  page.innerHTML = `<div class="cad-busy">Đang đối chiếu ${escapeHtml(tab ? `${tab.name} ${tab.scale}` : id)}…</div>`;
  try {
    const pageData = await planPage(id, st.geom, st.recorded);
    if (card !== st || seq !== openSeq) return;
    st.cache.set(id, pageData);
    if (st.tab !== id) return;
    page.innerHTML = pageData.html;
    mountParcelPies(page);
  } catch (err) {
    console.warn('Tra quy hoạch ranh dự án lỗi:', err);
    if (card !== st || st.tab !== id) return;
    page.innerHTML = `<div class="sug-card ineligible">Không phân tích được: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function togglePlan() {
  const st = card;
  const el = $('investCard');
  const box = el?.querySelector('.invest-plan');
  const btn = el?.querySelector('.invest-plan-btn');
  if (!st || !box || !btn) return;
  const open = box.hidden;
  box.hidden = !open;
  btn.innerHTML = `${ico('area')}${open ? 'Ẩn kiểm tra quy hoạch' : 'Kiểm tra quy hoạch theo ranh giới dự án'}`;
  syncSelectionStyle();
  if (open) showTab(st.tab);
}

function showInfo(id) {
  const st = card;
  const el = $('investCard');
  if (!st || !el || (id !== 'overview' && id !== 'detail')) return;
  st.infoTab = id;
  el.querySelectorAll('[data-info-page]').forEach(p => { p.hidden = p.dataset.infoPage !== id; });
  el.querySelectorAll('[data-info-tab]').forEach(b => {
    const on = b.dataset.infoTab === id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
}

function paintCard() {
  const st = card;
  const feature = st?.feature;
  const el = $('investCard');
  if (!st || !feature || !el) return;
  const props = viewOf(st);
  const info = st.infoTab === 'detail' ? 'detail' : 'overview';
  st.infoTab = info;
  const planOpen = !!el.querySelector('.invest-plan') && !el.querySelector('.invest-plan').hidden;
  st.editing = false;
  st.saving = false;
  el.innerHTML = `${editButtonHtml()}<button type="button" class="cad-card-x" title="Đóng" aria-label="Đóng bảng dự án">${ico('close')}</button>
    <div class="invest-body">
      <div class="invest-switch" role="tablist" aria-label="Thông tin dự án">
        <button type="button" data-info-tab="overview" class="${info === 'overview' ? 'is-on' : ''}" aria-selected="${info === 'overview'}">Tổng quan</button>
        <button type="button" data-info-tab="detail" class="${info === 'detail' ? 'is-on' : ''}" aria-selected="${info === 'detail'}">Chi tiết</button>
      </div>
      <div class="invest-pages">
        <div data-info-page="overview"${info === 'overview' ? '' : ' hidden'}>
          ${overviewHtml(st, props)}
          ${st.geom ? `<button type="button" class="proof-btn invest-plan-btn" title="Diện tích từng loại đất quy hoạch trong ranh dự án, đủ 4 cấp">${ico('area')}${planOpen ? 'Ẩn kiểm tra quy hoạch' : 'Kiểm tra quy hoạch theo ranh giới dự án'}</button>
          <div class="invest-plan"${planOpen ? '' : ' hidden'}>
            ${tabsBar(st.tab)}
            <div class="cad-page" role="tabpanel"></div>
          </div>` : ''}
        </div>
        <div data-info-page="detail"${info === 'detail' ? '' : ' hidden'}>${detailHtml(props)}</div>
      </div>
    </div>`;
  el.hidden = false;
  if (planOpen && info === 'overview') showTab(st.tab, { syncMap: false });
}

function beginEdit() {
  const props = card ? viewOf(card) : null;
  const pages = $('investCard')?.querySelector('.invest-pages');
  const sw = $('investCard')?.querySelector('.invest-switch');
  if (!props || !pages || !isAdmin() || card.editing) return;
  if (card.grouping) { card.grouping = false; paintPicks(); }
  card.editing = true;
  if (sw) sw.hidden = true;
  pages.innerHTML = `<div class="invest-edit-form">${editPairs(props).map(([k, v]) => editRowHtml(k, v, false)).join('')}
    <button type="button" class="invest-add">Thêm trường</button>
    <div class="invest-edit-actions"><button type="button" class="proof-btn invest-save">Lưu</button><button type="button" class="invest-cancel">Hủy</button></div>
    </div>`;
}

function addEditRow() {
  const anchor = $('investCard')?.querySelector('.invest-add');
  if (!anchor) return;
  anchor.insertAdjacentHTML('beforebegin', editRowHtml('', '', true));
  anchor.previousElementSibling?.querySelector('input')?.focus();
}

function redrawMaps() {
  const host = card?.map;
  const feature = card?.feature;
  const geom = card?.geom;
  leftGroup?.remove();
  leftGroup = null;
  rightGroup?.remove();
  rightGroup = null;
  if (visible && pack && map) leftGroup = drawOn(map, pack);
  // Chỉ vẽ bản đồ phải khi đang so sánh / chia đôi — tránh dựng đôi lớp mỗi lần đổi tab.
  if (visible && pack && planMapLive()) rightGroup = drawOn(planMap, pack);
  if (feature && host && card) selectLayer(findLayer(feature, host), host, geom);
}

function saveKeyOf(st) {
  const sheet = st?.sheet;
  const props = st?.feature?.properties || {};
  return String(props._adminKey || rowAlias(sheet) || props.name || titleOf(props) || '').trim();
}

function applySaved(feature, fields, extra = {}) {
  const props = feature.properties || {};
  const key = props._adminKey || props.name || '';
  const match = sheetProjectName(props.sheet) || '';
  const targets = (pack || [feature]).filter(f => {
    const p = f.properties || {};
    return f === feature || (key && (p.name === key || p._adminKey === key)) || (match && sheetProjectName(p.sheet) === match);
  });
  membersOf(feature).forEach(f => { if (!targets.includes(f)) targets.push(f); });
  if (!targets.includes(feature)) targets.push(feature);
  targets.forEach(f => {
    const prev = f.properties?.sheet;
    const sheet = { ...(prev || {}), ...fields, _alias: rowAlias(prev) || key || f.properties?.name || '' };
    if (prev && prev._map) sheet._map = prev._map;
    if (extra.groupId) sheet._groupId = extra.groupId;
    f.properties.sheet = sheet;
    if (extra.geometry) {
      f.geometry = extra.geometry;
      f.properties._sheetOnly = false;
      f.properties._adminKey = sheet._alias || key;
      f.properties._key = f.properties._key?.startsWith('sheet:') ? `admin:${sheet._alias || key}` : (f.properties._key || `admin:${sheet._alias || key}`);
      if (pack && !pack.includes(f)) pack.push(f);
    }
  });
  rebuildSheetOnly(pack, sheetRows);
  if (card) {
    card.sheet = sheetOf(membersOf(feature), feature);
    if (extra.groupId) card.dtGroup = extra.groupId;
    if (extra.geometry) {
      card.geom = extra.geometry;
      card.members = membersOf(feature);
    }
  }
  redrawMaps();
  paintInvestList();
}

async function postInvestSave({ key, match, fields, groupId, geometry }) {
  const body = { key, match, fields };
  if (groupId !== undefined) body.groupId = groupId;
  if (geometry !== undefined) body.geometry = geometry;
  const res = await fetch(geeApi('action=saveInvestProject'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) signOutAdmin();
  if (!res.ok || !data.success) throw new Error(data.message || 'Không lưu được thông tin dự án');
  return data;
}

async function saveEdit() {
  const st = card;
  const feature = st?.feature;
  const el = $('investCard');
  if (!st || !feature || !el || st.saving) return;
  const fields = {};
  el.querySelectorAll('.invest-edit-row').forEach(row => {
    const keyEl = row.querySelector('.invest-edit-key');
    const key = String(keyEl?.dataset?.key || keyEl?.value || '').trim();
    const val = String(row.querySelector('.invest-edit-val')?.value || '').trim();
    if (key && val) fields[key] = val;
  });
  if (!sheetProjectName(fields)) {
    showToast('Cần giữ tên dự án', 'error');
    return;
  }
  const key = saveKeyOf(st);
  if (!key) {
    showToast('Dự án chưa có tên để lưu', 'error');
    return;
  }
  st.saving = true;
  const btn = el.querySelector('.invest-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  try {
    await postInvestSave({
      key,
      match: sheetProjectName(st.sheet) || '',
      fields,
      groupId: st.dtGroup || undefined
    });
    applySaved(feature, fields, { groupId: st.dtGroup });
    st.recorded = recordedM2(st.sheet || feature.properties.sheet);
    st.cache.clear();
    paintCard();
    showToast('Đã lưu thông tin dự án');
  } catch (err) {
    st.saving = false;
    if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'Lưu'; }
    showToast(err.message || 'Không lưu được thông tin dự án', 'error');
  }
}

async function saveGroupMove(groupId) {
  const st = card;
  if (!st || !isAdmin() || !isInvestGroupId(groupId) || st.saving) return;
  const fields = {};
  rowEntries(viewOf(st)).forEach(([k, v]) => { fields[k] = String(v); });
  if (!sheetProjectName(fields)) fields['Tên dự án'] = titleOf(viewOf(st));
  const key = saveKeyOf(st);
  if (!key) {
    showToast('Dự án chưa có tên để chuyển nhóm', 'error');
    return;
  }
  st.saving = true;
  try {
    await postInvestSave({ key, match: sheetProjectName(st.sheet) || '', fields, groupId });
    applySaved(st.feature, fields, { groupId });
    st.dtGroup = groupId;
    paintCard();
    paintInvestList();
    if (visible) redrawMaps();
    showToast(`Đã chuyển sang nhóm ${investGroupLabel(groupId)}`);
  } catch (err) {
    showToast(err.message || 'Không chuyển được nhóm', 'error');
    paintCard();
  } finally {
    st.saving = false;
  }
}

function unionBoundary(features) {
  const polys = [];
  (features || []).forEach(f => {
    const g = f?.geometry;
    if (!g) return;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  });
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

async function uploadBoundary(file) {
  const st = card;
  if (!st || !isAdmin() || !file || st.saving) return;
  st.saving = true;
  showToast('Đang đọc bản vẽ ranh…');
  try {
    const drawn = await readDrawingFile(file, 'boundary');
    if (drawn.error) throw new Error(drawn.error);
    const geometry = unionBoundary(drawn.features);
    if (!geometry) throw new Error('File không có polygon ranh');
    const fields = {};
    rowEntries(viewOf(st)).forEach(([k, v]) => { fields[k] = String(v); });
    if (!sheetProjectName(fields)) fields['Tên dự án'] = titleOf(viewOf(st));
    const key = saveKeyOf(st);
    if (!key) throw new Error('Dự án chưa có tên để gắn ranh');
    await postInvestSave({
      key,
      match: sheetProjectName(st.sheet) || '',
      fields,
      groupId: st.dtGroup || undefined,
      geometry
    });
    applySaved(st.feature, fields, { groupId: st.dtGroup, geometry });
    st.geom = geometry;
    st.cache.clear();
    let area = 0;
    try { area = turf.area(turf.feature(geometry)); } catch { area = 0; }
    st.areaText = area >= 10000 ? `${fmtNum(area / 10000)} ha` : `${fmtNum(Math.round(area))} m²`;
    paintCard();
    openCard(st.feature, findLayer(st.feature, st.map), st.map);
    showToast('Đã gắn ranh dự án');
  } catch (err) {
    showToast(err.message || 'Không tải được ranh', 'error');
  } finally {
    st.saving = false;
  }
}

function toggleGroupPick(feature) {
  if (!card?.grouping) return;
  const key = feature?.properties?._key;
  if (!key) return;
  if (card.picks.has(key)) card.picks.delete(key);
  else card.picks.add(key);
  const note = $('investCard')?.querySelector('.invest-group-bar span');
  if (note) note.textContent = `Bấm ranh trên bản đồ để thêm hoặc bỏ. Đang chọn ${card.picks.size} mảnh.`;
  paintPicks();
}

function beginGroup() {
  if (!card || !isAdmin()) return;
  card.grouping = true;
  card.infoTab = 'overview';
  card.picks = new Set((card.members || [card.feature]).map(f => f.properties?._key).filter(Boolean));
  paintCard();
  paintPicks();
}

function cancelGroup() {
  if (!card) return;
  card.grouping = false;
  paintPicks();
  paintCard();
}

async function postGroup(keys, clear) {
  try {
    const res = await fetch(geeApi('action=saveInvestGroup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ keys, clear })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) return false;
    const store = readStore();
    if (Array.isArray(data.groups)) {
      const settled = settleInvestSync(data.groups, groups, store.ops);
      groups = settled.groups;
      writeStore(groups, settled.ops);
      stampGroups();
    } else {
      writeStore(groups, store.ops.slice(1));
    }
    return true;
  } catch { return false; }
}

let flushing = false;
async function flushPending() {
  if (!isAdmin() || flushing) return;
  flushing = true;
  try {
    for (let i = 0; i < 20 && isAdmin(); i++) {
      const before = readStore().ops;
      if (!before.length) return;
      const op = before[0];
      const ok = await postGroup(op.keys, !!op.clear);
      if (!ok) return;
      const after = readStore().ops;
      const same = after.length === before.length && after[0] && op.keys.join('\0') === after[0].keys.join('\0') && !!after[0].clear === !!op.clear;
      if (same) writeStore(groups, after.slice(1));
    }
  } finally { flushing = false; }
}

async function finishGroup(keys, clear, feature, host, okText, failText) {
  commitGroups(keys, clear);
  if (card) card.grouping = false;
  redrawMaps();
  const ok = await postGroup(keys, clear);
  if (ok) redrawMaps();
  const next = (pack || []).find(f => f.properties?._key === feature?.properties?._key) || feature;
  if (next) openCard(next, findLayer(next, host), host);
  showToast(ok ? okText : failText, ok ? 'info' : 'error');
}

async function saveGroup() {
  const st = card;
  if (!st || st.saving) return;
  const keys = [...st.picks];
  if (keys.length < 2) {
    showToast('Chọn ít nhất hai ranh để gộp thành một dự án', 'error');
    return;
  }
  st.saving = true;
  await finishGroup(keys, false, st.feature, st.map, 'Đã gộp thành một dự án', 'Đã gộp trên máy này. Chưa ghi được lên máy chủ.');
}

async function ungroup(all) {
  const st = card;
  if (!st || st.saving) return;
  const keys = all
    ? (st.members || []).map(f => f.properties?._key).filter(Boolean)
    : [st.feature?.properties?._key].filter(Boolean);
  if (!keys.length) return;
  st.saving = true;
  await finishGroup(keys, true, st.feature, st.map, all ? 'Đã bỏ gộp nhóm' : 'Đã tách ranh khỏi dự án', 'Đã tách trên máy này. Chưa ghi được lên máy chủ.');
}

function openCard(feature, layer, targetMap) {
  if (!feature) return;
  document.dispatchEvent(new CustomEvent('qh-dock-card', { detail: 'invest' }));
  clearParcelPies();
  const seq = ++openSeq;
  const members = membersOf(feature);
  const geom = unionGeom(members.filter(m => m.geometry));
  const sheet = sheetOf(members, feature);
  const title = sheetProjectName(sheet) || feature.properties?.name || 'Dự án';
  ensureCard();
  setQuietProjectOutline(!!geom);
  const tab = isPlanLevel(getLevel()) ? getLevel() : 'qhpk';
  let area = 0;
  members.forEach(m => { if (!m.geometry) return; try { area += turf.area(m); } catch { /* mảnh hỏng thì bỏ qua */ } });
  const areaText = area > 0
    ? (area >= 10000 ? `${fmtNum(area / 10000)} ha` : `${fmtNum(Math.round(area))} m²`)
    : '';
  card = {
    seq, tab, infoTab: 'overview', cache: new Map(), map: targetMap || map, feature, members, geom, sheet,
    areaText, pieces: members.filter(m => m.geometry).length || 1, recorded: recordedM2(sheet), bounds: null,
    landKey: null, editing: false, saving: false, grouping: false, picks: new Set(),
    dtGroup: rowGroupId(sheet, title)
  };
  paintCard();
  if (geom) selectLayer(layer, targetMap || map, geom);
  else {
    selected = null;
    clearHighlight();
  }
  let bounds = null;
  try { bounds = geom ? L.geoJSON(geom).getBounds() : null; } catch { bounds = null; }
  if (!bounds) {
    const pin = sheetMapPoint(sheet);
    if (pin) bounds = L.latLngBounds([L.latLng(pin[1], pin[0])]);
  }
  card.bounds = bounds;
  if (seq !== openSeq) return;
  if (bounds) requestAnimationFrame(() => { if (card && card.seq === seq) frameProject(targetMap || map, bounds); });
}

function investDossierRows(p) {
  const props = viewOf(p);
  const rows = [];
  rows.push(['Nhóm', investGroupLabel(p.dtGroup)]);
  if (!p.hasBoundary) rows.push(['Ranh giới', 'Chưa có ranh']);
  if ((p.members || []).filter(m => m.geometry).length > 1) rows.push(['Quy mô', `${p.members.filter(m => m.geometry).length} mảnh`]);
  rowEntries(props).forEach(([k, v]) => {
    if (/tên dự án|^stt$/i.test(k)) return;
    let value = String(v).replace(/\s+/g, ' ').trim();
    if (/diện tích/i.test(k)) value = listedArea(props.sheet) || value;
    if (value) rows.push([shortLabel(k), value]);
  });
  if (!p.matched) rows.push(['Ghi chú', 'Chưa khớp tên với danh sách sheet 15-DA.']);
  return rows;
}

function investDossierHtml(rows) {
  const body = rows.map(([label, value]) =>
    `<div class="project-dossier-row"><span class="project-dossier-label">${escapeHtml(label)}</span><span class="project-dossier-meta">${escapeHtml(String(value))}</span></div>`
  ).join('');
  return body ? `<div class="project-dossier">${body}</div>` : '';
}

function investRow(p, n) {
  const id = projectKey(p);
  const safe = escapeHtml(id);
  const open = investOpen.has(id);
  const shown = !investHidden.has(id);
  const rows = investDossierRows(p);
  const badge = p.hasBoundary ? '' : ' <small class="layer-hint">Chưa có ranh</small>';
  const area = p.areaText || areaTextOf(p.sheet, p.geom) || '-';
  const blob = [p.title, area, ...rows.map(([, v]) => v)].filter(Boolean).join(' ');
  return `<div class="project-row${shown ? '' : ' is-off'}${id === investPicked ? ' is-picked' : ''}" data-dt-text="${escapeHtml(blob)}">
      <label class="project-name" title="${escapeHtml(p.title || '')}">
        <input type="checkbox" data-invest="${safe}"${shown ? ' checked' : ''} title="Hiện công trình trên bản đồ"><span data-invest-focus="${safe}">${n}. ${escapeHtml(p.title || id)}${badge}</span></label>
      <span class="project-meta dt-area${area === '-' ? ' is-miss' : ''}">${escapeHtml(area)}</span>
      <span class="project-tools">
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-invest-expand="${safe}" title="${open ? 'Ẩn' : 'Xem'} thông tin công trình" aria-label="Thông tin công trình" aria-expanded="${open}">${ico('chev-down')}</button>
      </span>
    </div>${open ? investDossierHtml(rows) : ''}`;
}

function paintDvtmList(host, items) {
  const empty = pack || sheetRows.length ? '<div class="project-empty">Chưa có đồ án.</div>' : '';
  if (!items.length) {
    host.innerHTML = empty;
    return;
  }
  host.innerHTML = DVTM_SUBGROUPS.map(sub => {
    const list = items.filter(p => p.dvtmSub === sub.id)
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'vi'));
    const open = dvtmFoldOpen.has(sub.id);
    const mapOn = dvtmSubMapOn(sub.id, list);
    const body = list.length
      ? list.map((p, i) => investRow(p, i + 1)).join('')
      : '<div class="project-empty">Chưa có dự án trong nhóm này.</div>';
    return `<div class="pl-group dt-dvtm-sub${open ? ' open' : ''}" data-dvtm-sub="${escapeHtml(sub.id)}">
      <div class="pl-hrow dt-sub-row">
        <span class="pl-head" title="${escapeHtml(sub.title)}">${ico(sub.icon)}<span>${escapeHtml(sub.label)}</span><small>${list.length}</small></span>
        <button type="button" class="project-btn pl-eye" data-dvtm-eye="${escapeHtml(sub.id)}" aria-pressed="${mapOn}" title="${mapOn ? 'Ẩn nhóm trên bản đồ' : 'Hiện nhóm trên bản đồ'}">${ico(mapOn ? 'eye' : 'eye-off')}</button>
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-dvtm-fold="${escapeHtml(sub.id)}" title="${open ? 'Thu danh sách' : 'Mở danh sách'}" aria-expanded="${open}" aria-label="${open ? 'Thu' : 'Mở'} ${escapeHtml(sub.label)}">${ico('chev-down')}</button>
      </div>
      <div class="pl-body"${open ? '' : ' hidden'}>${body}</div>
    </div>`;
  }).join('');
}

function paintInvestList(opts = {}) {
  const onlyTab = opts.tab || '';
  const scroller = $('dtList');
  const y = scroller?.scrollTop || 0;
  applyDvtmMapDefault();
  const all = projectList();
  const groups = onlyTab ? INVEST_GROUPS.filter(g => g.id === onlyTab) : INVEST_GROUPS;
  groups.forEach(g => {
    const host = $(`investList-${g.id}`);
    if (!host) return;
    const items = all.filter(p => p.dtGroup === g.id).sort((a, b) => String(a.title).localeCompare(String(b.title), 'vi'));
    if (g.id === 'dvtm') {
      paintDvtmList(host, items);
      return;
    }
    host.innerHTML = items.length
      ? items.map((p, i) => investRow(p, i + 1)).join('')
      : (pack || sheetRows.length ? '<div class="project-empty">Chưa có đồ án.</div>' : '');
  });
  if (scroller) scroller.scrollTop = y;
  if (opts.counts !== false) refreshHint();
}

/** Gộp nhiều lần đổi tab / tick ẩn hiện thành một lần vẽ lớp trong khung hình kế tiếp. */
function queueInvestDraw() {
  if (investDrawRaf) return;
  investDrawRaf = requestAnimationFrame(() => {
    investDrawRaf = 0;
    if (visible && pack) redrawMaps();
  });
}

async function ensureInvestList() {
  INVEST_GROUPS.forEach(g => {
    const host = $(`investList-${g.id}`);
    if (host && !pack) host.innerHTML = '<div class="project-empty">Đang tải danh sách.</div>';
  });
  try { await loadPack(); } catch { /* loadPack đã báo */ }
  if (!pack) {
    INVEST_GROUPS.forEach(g => {
      const host = $(`investList-${g.id}`);
      if (host) host.innerHTML = '<div class="project-empty">Chưa có đồ án.</div>';
    });
    return;
  }
  paintInvestList();
}

async function focusInvest(id) {
  investHidden.delete(id);
  investOpen.add(id);
  investPicked = id;
  let features;
  try { features = await loadPack(); } catch { return; }
  const p = projectList(features).find(item => projectKey(item) === id);
  paintInvestList();
  if (!p) return;
  if (p.dtGroup && p.dtGroup !== activeDtTab()) {
    document.querySelector(`#levelPickDt [data-dt-tab="${p.dtGroup}"]`)?.click();
  }
  const box = $('chk_invest');
  if (box && !box.checked) {
    box.checked = true;
    await setVisible(true);
  } else if (visible) redrawMaps();
  openCard(p.feature, findLayer(p.feature, map), map);
}

async function setVisible(on) {
  const token = ++drawToken;
  visible = !!on;
  if (!map) return;
  if (!visible) {
    closeCard();
    leftGroup?.remove();
    leftGroup = null;
    rightGroup?.remove();
    rightGroup = null;
    return;
  }
  let features;
  try { features = await loadPack(); } catch { return; }
  if (!visible || token !== drawToken || !features) return;
  paintInvestList();
  if (!leftGroup) leftGroup = drawOn(map, features);
  if (planMapLive() && !rightGroup) rightGroup = drawOn(planMap, features);
}

export function initInvestLayer() {
  if (!map) return;
  document.addEventListener('qh-dock-card', (e) => { if (e.detail !== 'invest') closeCard(); });
  document.addEventListener('auth:change', () => {
    if (ready) void flushPending();
    const el = $('investCard');
    if (!el || el.hidden || !card) return;
    if (!isAdmin()) card.grouping = false;
    if (!card.editing || !isAdmin()) paintCard();
    paintPicks();
  });
  document.addEventListener(TOOL_START_EVENT, () => closeCard());
  document.addEventListener(LEVEL_EVENT, (e) => {
    if (inspectLevelSyncing()) return;
    const box = $('investCard')?.querySelector('.invest-plan');
    if (card && box && !box.hidden && isPlanLevel(e.detail?.level)) showTab(e.detail.level, { syncMap: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !card) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (card.grouping) { cancelGroup(); return; }
    closeCard();
  });
  onCompareChange(() => {
    if (!visible || !ready) return;
    if (!planMapLive()) {
      rightGroup?.remove();
      rightGroup = null;
      return;
    }
    if (planMap && !rightGroup) {
      loadPack().then(features => {
        if (visible && planMapLive() && !rightGroup) rightGroup = drawOn(planMap, features);
      });
    }
  });
  $('chk_invest')?.addEventListener('change', (e) => setVisible(e.target.checked));
  const listHost = $('dtList');
  listHost?.addEventListener('click', (e) => {
    if (!e.target.closest('.invest-tab-list')) return;
    const fold = e.target.closest('[data-dvtm-fold]');
    if (fold) {
      const id = fold.dataset.dvtmFold;
      if (dvtmFoldOpen.has(id)) dvtmFoldOpen.delete(id);
      else dvtmFoldOpen.add(id);
      paintInvestList({ tab: 'dvtm', counts: false });
      return;
    }
    const eye = e.target.closest('[data-dvtm-eye]');
    if (eye) {
      const id = eye.dataset.dvtmEye;
      const items = projectList().filter(p => p.dtGroup === 'dvtm' && p.dvtmSub === id);
      const on = !dvtmSubMapOn(id, items);
      setDvtmSubMap(id, on);
      if (on) dvtmFoldOpen.add(id);
      if (on && !$('chk_invest')?.checked) {
        $('chk_invest').checked = true;
        $('chk_invest').dispatchEvent(new Event('change', { bubbles: true }));
      } else queueInvestDraw();
      paintInvestList({ tab: 'dvtm', counts: false });
      return;
    }
    const expand = e.target.closest('[data-invest-expand]');
    if (expand) {
      const id = expand.dataset.investExpand;
      if (investOpen.has(id)) investOpen.delete(id);
      else investOpen.add(id);
      paintInvestList({ tab: activeDtTab(), counts: false });
      return;
    }
    const focus = e.target.closest('[data-invest-focus]');
    if (focus) {
      e.preventDefault();
      focusInvest(focus.dataset.investFocus);
    }
  });
  listHost?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-invest]');
    if (!box) return;
    const id = box.dataset.invest;
    if (box.checked) investHidden.delete(id);
    else investHidden.add(id);
    box.closest('.project-row')?.classList.toggle('is-off', !box.checked);
    if (box.checked && !$('chk_invest')?.checked) {
      $('chk_invest').checked = true;
      $('chk_invest').dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    queueInvestDraw();
  });
  document.addEventListener('qh:dt-tab', () => {
    ensureInvestOn();
    // Danh sách HTML theo từng pane đã dựng sẵn — đổi tab chỉ cần vẽ lại ranh nhóm đang chọn.
    if (!pack) void ensureInvestList();
    else queueInvestDraw();
  });
  document.addEventListener('qh:axis-tab', (e) => {
    if (e.detail?.id === 'dautu') {
      ensureInvestOn();
      ensureInvestList();
    }
  });
  document.addEventListener('qh:dt-counts', () => paintDtCounts());
  if (document.querySelector('#layerPaneDauTu:not([hidden])')) {
    ensureInvestOn();
    ensureInvestList();
  } else if ($('chk_invest')?.checked) setVisible(true);
}
