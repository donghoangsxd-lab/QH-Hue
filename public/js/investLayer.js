// Lớp 15 — dự án kêu gọi đầu tư (sheet 15-DA): ranh từ KML, thuộc tính từ danh sách.
// Cùng nhóm «sử dụng hạ tầng» với nhà ở xã hội: không bán kính phục vụ, không tính độ phủ.
// Bấm ranh: bảng góc trên trái. Nút kiểm tra quy hoạch cắt polygon với 4 cấp như bảng thửa / vùng đo.
import { map } from './mapEngine.js';
import { signOutAdmin } from './uiComponents.js';
import { planMap, onCompareChange } from './planMap.js';
import { geeApi } from './api.js';
import { state } from './state.js';
import { escapeHtml, fmtNum, ico, showToast, TOOL_START_EVENT } from './utils.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { applyInspectLevel, geometryPoint, inspectLevelSyncing } from './viewFlow.js';
import { matchInvestDetail, sheetProjectName } from './investMatch.js';
import { editInvestGroups, settleInvestSync } from './investGroups.js';
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
let leftGroup = null;
let rightGroup = null;
let hovered = null;
let selected = null;
let card = null;
let highlight = null;
let landFill = null;
let openSeq = 0;
let drawToken = 0;
let groups = [];

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
  try {
    const p = turf.pointOnFeature(geom);
    const c = p.geometry.coordinates;
    if (!c || c.length < 2) return null;
    return L.latLng(c[1], c[0]);
  } catch { return null; }
}

function projectList(features) {
  const seen = new Set();
  const out = [];
  (features || []).forEach(feature => {
    const id = feature.properties?.groupId || feature.properties?._key;
    if (!id || seen.has(id)) return;
    seen.add(id);
    const members = feature.properties?.groupId
      ? features.filter(f => f.properties?.groupId === feature.properties.groupId)
      : [feature];
    const sheet = sheetOf(members, feature);
    const sectorText = entry(sheet, /lĩnh vực/i) || members.map(m => m.properties?.folder).find(Boolean) || '';
    out.push({
      feature: members[0],
      members,
      geom: unionGeom(members),
      sheet,
      sector: sectorOf(sectorText),
      matched: !!sheet,
      title: sheetProjectName(sheet) || feature.properties?.name || 'Ranh dự án'
    });
  });
  return out;
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
  const chip = row ? '' : `<span class="invest-chip">${ambiguous ? 'Chưa chắc' : 'Chưa ghép'}</span>`;
  const alert = row
    ? ''
    : ambiguous
      ? '<div class="invest-alert">Tên gần với nhiều dòng sheet 15-DA, chưa ghép tự động.</div>'
      : '<div class="invest-alert">Chưa khớp tên với danh sách sheet 15-DA. Đang hiện thông tin ghi trên ranh.</div>';
  const goalHtml = goal
    ? `<div class="invest-lead"><small>Mục tiêu và nhu cầu đầu tư</small><p>${escapeHtml(goal)}</p></div>`
    : '';
  return `<div class="invest-head">
      <span class="invest-badge" style="color:${sector.color}">${ico(sector.icon)}</span>
      <div class="invest-head-main">
        <div class="invest-kicker"><b>${escapeHtml(sector.label)}</b>${pieces}${chip}</div>
        <div class="lp-title">${escapeHtml(titleOf(props))}</div>
      </div>
    </div>
    <div class="invest-stats">
      ${statHtml('Diện tích ranh', st.areaText, 'area', false)}
      ${statHtml('Diện tích danh sách', listed, 'parcel', false)}
      ${statHtml('Địa điểm', place, 'pin', true)}
      ${statHtml('Mức độ ưu tiên', priority, 'flag', !place)}
    </div>
    ${goalHtml}${alert}${groupHtml(st)}`;
}

function detailHtml(props) {
  const blocks = rowEntries(props).filter(([k]) => props.sheet ? fieldKind(k) === 'detail' : !/lĩnh vực/i.test(k));
  if (!blocks.length) return '<div class="invest-empty">Không có mô tả hiện trạng hay thủ tục thêm.</div>';
  return blocks.map(([k, v]) => `<section class="invest-block"><h4>${escapeHtml(shortLabel(k))}</h4><div class="invest-copy">${fieldValue(v)}</div></section>`).join('');
}

function groupHtml(st) {
  if (!isAdmin()) return '';
  if (st.grouping) {
    return `<div class="invest-group-bar"><b>Gộp ranh thành một dự án</b><span>Bấm ranh trên bản đồ để thêm hoặc bỏ. Đang chọn ${st.picks.size} mảnh.</span>
      <div class="invest-edit-actions"><button type="button" class="proof-btn invest-group-save">Lưu thành một dự án</button><button type="button" class="invest-group-cancel">Hủy</button></div></div>`;
  }
  const grouped = (st.members || []).length > 1;
  return `<div class="invest-group-actions">
    <button type="button" class="invest-group">${ico('layers')}Gộp thêm ranh vào dự án này</button>
    ${grouped ? '<button type="button" class="invest-ungroup">Tách ranh đang xem</button><button type="button" class="invest-ungroup-all">Bỏ gộp cả nhóm</button>' : ''}
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

function setHint(text) {
  const el = $('investHint');
  if (el) el.textContent = text || '';
}

function refreshHint() {
  const projects = projectList(pack || []);
  const hit = projects.filter(p => p.matched).length;
  setHint(`(${(pack || []).length} ranh · ${projects.length} dự án · ${hit} khớp)`);
}

async function loadPack() {
  if (!ready) {
    ready = Promise.all([
      fetch('./data/invest-boundary.geojson').then(r => (r.ok ? r.json() : Promise.reject(new Error('không tải được ranh')))),
      loadRows()
    ]).then(async ([fc, loaded]) => {
      const features = (fc && fc.features) || [];
      const rows = loaded.rows || [];
      const detail = matchInvestDetail(features, rows);
      features.forEach((f, i) => {
        f.properties = f.properties || {};
        f.properties._key = featureKey(f);
        f.properties.sheet = detail[i].index >= 0 ? rows[detail[i].index] : null;
        f.properties._ambiguous = !!detail[i].ambiguous;
      });
      pack = features;
      adoptGroups(loaded.groups);
      if (isAdmin()) {
        try { await flushPending(); } catch { /* gửi lại nhóm chưa lưu lỗi thì vẫn hiện ranh */ }
      }
      stampGroups();
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
        return { rows: data.rows, groups: Array.isArray(data.groups) ? data.groups : null };
      }
    }
  } catch { /* bản đóng gói theo file Excel hiện có */ }
  const res = await fetch('./data/invest-sheet.json');
  if (!res.ok) return { rows: [], groups: null };
  const data = await res.json();
  return { rows: data.rows || [], groups: null };
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
  if (card?.grouping) { toggleGroupPick(feature); return; }
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

function drawOn(m, features) {
  ensurePane(m, PANE, PANE_Z);
  ensurePane(m, MARK_PANE, MARK_PANE_Z);
  const byFeature = new Map();
  const projects = projectList(features);
  const titleByFeature = new Map();
  projects.forEach(p => p.members.forEach(f => titleByFeature.set(f, p.title)));
  const group = L.geoJSON({ type: 'FeatureCollection', features }, {
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
  projects.forEach(p => {
    const at = centerOf(p.geom);
    const layer = byFeature.get(p.feature);
    if (!at || !layer) return;
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
    if (e.target.closest('.cad-card-x')) closeCard();
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
          <button type="button" class="proof-btn invest-plan-btn" title="Diện tích từng loại đất quy hoạch trong ranh dự án, đủ 4 cấp">${ico('area')}${planOpen ? 'Ẩn kiểm tra quy hoạch' : 'Kiểm tra quy hoạch theo ranh giới dự án'}</button>
          <div class="invest-plan"${planOpen ? '' : ' hidden'}>
            ${tabsBar(st.tab)}
            <div class="cad-page" role="tabpanel"></div>
          </div>
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
  if (visible && pack && planMap) rightGroup = drawOn(planMap, pack);
  refreshHint();
  if (feature && host && card) selectLayer(findLayer(feature, host), host, geom);
}

function applySaved(feature, fields) {
  const props = feature.properties || {};
  const key = props.name || '';
  const match = sheetProjectName(props.sheet) || '';
  const targets = (pack || [feature]).filter(f => {
    const p = f.properties || {};
    return f === feature || (key && p.name === key) || (match && sheetProjectName(p.sheet) === match);
  });
  membersOf(feature).forEach(f => { if (!targets.includes(f)) targets.push(f); });
  targets.forEach(f => {
    const prev = f.properties?.sheet;
    const sheet = { ...fields, _alias: key || f.properties?.name || '' };
    if (prev && prev._map) sheet._map = prev._map;
    f.properties.sheet = sheet;
  });
  if (card) card.sheet = sheetOf(membersOf(feature), feature);
  redrawMaps();
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
  const props = feature.properties || {};
  const key = String(props.name || titleOf(props)).trim();
  if (!key) {
    showToast('Ranh này chưa có tên để lưu', 'error');
    return;
  }
  st.saving = true;
  const btn = el.querySelector('.invest-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  try {
    const res = await fetch(geeApi('action=saveInvestProject'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ key, match: sheetProjectName(st.sheet || props.sheet) || '', fields })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || 'Không lưu được thông tin dự án');
    applySaved(feature, fields);
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
  if (!feature?.geometry) return;
  document.dispatchEvent(new CustomEvent('qh-dock-card', { detail: 'invest' }));
  clearParcelPies();
  const seq = ++openSeq;
  const members = membersOf(feature);
  const geom = unionGeom(members);
  const sheet = sheetOf(members, feature);
  ensureCard();
  setQuietProjectOutline(true);
  const tab = isPlanLevel(getLevel()) ? getLevel() : 'qhpk';
  let area = 0;
  members.forEach(m => { try { area += turf.area(m); } catch { /* mảnh hỏng thì bỏ qua */ } });
  const areaText = area >= 10000 ? `${fmtNum(area / 10000)} ha` : `${fmtNum(Math.round(area))} m²`;
  card = {
    seq, tab, infoTab: 'overview', cache: new Map(), map: targetMap, feature, members, geom, sheet,
    areaText, pieces: members.length, recorded: recordedM2(sheet), bounds: null,
    landKey: null, editing: false, saving: false, grouping: false, picks: new Set()
  };
  paintCard();
  selectLayer(layer, targetMap, geom);
  let bounds = null;
  try { bounds = geom ? L.geoJSON(geom).getBounds() : null; } catch { bounds = null; }
  card.bounds = bounds;
  if (seq !== openSeq) return;
  requestAnimationFrame(() => { if (card && card.seq === seq) frameProject(targetMap, bounds); });
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
  if (!leftGroup) leftGroup = drawOn(map, features);
  if (planMap && !rightGroup) rightGroup = drawOn(planMap, features);
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
  onCompareChange(() => { if (visible && planMap && !rightGroup && ready) loadPack().then(features => { if (visible && planMap && !rightGroup) rightGroup = drawOn(planMap, features); }); });
  $('chk_invest')?.addEventListener('change', (e) => setVisible(e.target.checked));
  if ($('chk_invest')?.checked) setVisible(true);
}
