// Giao diện module Quy hoạch chung (generalPlan.js): mục "Đô thị" ở panel phải, trang 4 bảng tổng hợp
// (uiComponents.js › setPart2Page: tổng quan các QHC | chi tiết hồ sơ, phân vùng, QHPK 1/2.000 triển khai, chỉ số trưởng thành)
// và nét ranh phạm vi trên bản đồ (data/generalPlan.geojson). Khu vực vùng lõi là mục con của QHC thành phố Huế.
// Chọn ở panel phải hay bảng dưới đều dùng chung picked; không import uiComponents.js (tránh vòng import), mở trang bằng nút sẵn có.
import { state } from './state.js';
import { map, highlightWardNames, highlightWardBoundary, focusWard, getLeftObstruction, getRightObstruction } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn, getViewMode, onViewChange } from './planMap.js';
import { escapeHtml, fmtNum, ico } from './utils.js';
import { namesOfProject } from './projectNames.js';
import { loadBuiltAreas } from './wardRoads.js';
import { measure2A, ensureClassRoads, CLASS_REF, URBANS } from './urbanClass.js';
import { STATUS_REF, URBANS_614, bareName } from './urbanStatus.js';
import { URBANS_VISION } from './urbanVision.js';
import { DOTHI_2030, DOTHI_SAU, HT_GROUPS, HT_URBANS, NOTE_2030 } from './doThiQd756.js';
import { DVHC_WARDS, DVHC_CITY, shortPlaceName } from './dvhcStats.js';
import { PART_BOUNDS, loadPartGeoms, partFeature } from './urbanPartGeom.js';
import { AREA_TP, setAreaFilter, parseKv } from './facetStore.js';
import { getLevel } from './mapLevel.js';
import {
  GENERAL_PLANS, CORE_AREAS, CORE_ZONE_ID, GP_KINDS, GP_STATUS, GP_PARENT_REF, OPEN_PROJECT_EVENT, MATURITY_GROUPS,
  GP_SCOPE_EVENT, URBAN_FOCUS_EVENT,
  generalPlanOf, generalPlansOfWard, childProjects, planProjectOf, qhpkCoverage, maturityOf, scopeUnits, outerUnits
} from './generalPlan.js';

const GP_PAGE = 3;
const SCOPE_URL = 'data/generalPlan.geojson';
// Ranh phạm vi trùng nét ranh đô thị của lớp Phân loại đô thị (pane 410, urbanAreaLayer.js) nên vẽ ở pane riêng nằm trên.
// Cyan cho phạm vi đô thị, xanh lam cho phạm vi lõi 1/10.000. Không vàng: nét vàng là ranh phường xã và ranh đô thị loại I
const SCOPE_PANE = 'gpScopePane';
const SCOPE_STYLE = { color: '#22d3ee', weight: 3.5, dashArray: '10 6', fillColor: '#22d3ee', fillOpacity: 0.06, interactive: false, pane: SCOPE_PANE };
const CORE_STYLE = { color: '#60a5fa', weight: 2.5, dashArray: '4 5', fillColor: '#60a5fa', fillOpacity: 0.05, interactive: false, pane: SCOPE_PANE };

const $ = (id) => document.getElementById(id);
const CITY_PLAN = GENERAL_PLANS.find(p => p.city);
const CORE_ZONE = CITY_PLAN.zones[0];
const OUTER_ZONE = CITY_PLAN.zones[1];
const KIND_ORDER = ['city', 'satellite', 'town'];

let picked = null;
let gpPeriod = '2030';
const POP_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const KM_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let rerenderPage = null;
let roadsReady = false;
let scopePromise = null;
let scopeLayers = [];
let scopeId = null;

const ctx = () => ({ wards: state.wardStatsData || [], catalog: state.projectCatalog || [], measure2A });
const pctText = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const meterHtml = (ratio, level) => `<span class="uc-meter lv-${level}"><i style="width:${ratio == null ? 0 : (ratio * 100).toFixed(1)}%"></i></span>`;
const levelCls = (level) => (level === 'hi' ? 'c-green' : level === 'no' ? 'c-red' : level === 'wait' ? 'uc-skip' : 'c-orange');
const statusChip = (plan) => (plan.parent
  ? `<span class="gp-st gp-st-sub" title="Không lập QHC riêng; chỉ tiêu do ${escapeHtml(plan.parent.name)} quy định">Theo QHC TP Huế</span>`
  : `<span class="gp-st gp-st-${plan.status}">${GP_STATUS[plan.status]}</span>`);
const waitIcon = (note) => `<span class="gtx-wait" title="${escapeHtml(note || 'Chờ số liệu')}">${ico('clock')}</span>`;
const skip = (text = 'Chưa cập nhật') => `<span class="uc-skip">${escapeHtml(text)}</span>`;

function nowText(plan) {
  const list = plan.now.map(n => `${n.name} (${n.cls})`);
  if (!list.length && plan.parent) list.push('Trong Đô thị Huế (I)');
  return list.join(', ') || '—';
}

function clsTip(plan) {
  return [
    plan.future ? plan.future.note : '',
    plan.vision ? `QĐ 756: ${plan.vision.name} — ${plan.vision.change}` : 'Chưa có trong danh mục đô thị sau 2030 (QĐ 756)'
  ].filter(Boolean).join('\n');
}

function clsHtml(plan) {
  const now = `<b class="uc-${plan.cls}">${plan.cls}</b>`;
  return plan.target === plan.cls ? now : `${now} ${ico('chev-right')} <b class="uc-${plan.target}">${plan.target}</b>`;
}

function scopeText(plan) {
  return plan.city ? 'Toàn thành phố' : `${plan.units.length} phường, xã`;
}

// ---------- Ranh phạm vi trên bản đồ ----------
export function loadScopes() {
  if (!scopePromise) {
    scopePromise = fetch(SCOPE_URL)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { scopePromise = null; throw err; });
  }
  return scopePromise;
}

function clearScope() {
  scopeLayers.forEach(l => l.remove());
  scopeLayers = [];
  if (scopeId) document.dispatchEvent(new CustomEvent(GP_SCOPE_EVENT, { detail: null }));
  scopeId = null;
}

// QHC thành phố Huế và khu vực vùng lõi vẽ kèm nét vùng lõi 1/10.000 để thấy quan hệ phạm vi.
// Vẽ trên cả bản đồ hiện trạng và bản đồ quy hoạch (2 bản đồ đồng bộ khung nhìn); phóng tới trên bản đồ đang hiện.
// Lớp Hệ thống đô thị: bản đồ quy hoạch không vẽ nét phạm vi mà chọn đô thị (urbanFocus.js qua GP_SCOPE_EVENT)
function showScope(id) {
  clearScope();
  if (!map || !id) return;
  scopeId = id;
  const plan = generalPlanOf(id);
  const withCore = id !== CORE_ZONE_ID && plan && (plan.city || plan.parent);
  loadScopes().then(fc => {
    if (scopeId !== id) return;
    const byId = (key) => (fc.features || []).find(f => f.properties && f.properties.id === key);
    const main = byId(id);
    if (!main) { focusUrbanFallback(id); return; }
    const core = withCore ? byId(CORE_ZONE_ID) : null;
    const urbanLevel = getLevel() === 'urban';
    scopeLayers = [map, planMap].filter(m => m && !(urbanLevel && m === planMap)).map(m => {
      if (!m.getPane(SCOPE_PANE)) {
        const pane = m.createPane(SCOPE_PANE);
        pane.style.zIndex = 415;
        pane.style.pointerEvents = 'none';
      }
      const group = L.featureGroup();
      if (core) L.geoJSON(core, { style: CORE_STYLE }).addTo(group);
      L.geoJSON(main, { style: id === CORE_ZONE_ID ? CORE_STYLE : SCOPE_STYLE }).addTo(group);
      return group.addTo(m);
    });
    document.dispatchEvent(new CustomEvent(GP_SCOPE_EVENT, {
      detail: { id, name: plan ? plan.name : id, geometry: main.geometry, city: !!plan?.city }
    }));
    const shown = planMap && isCompareOn() && !isSplitOn() ? planMap : map;
    fitGeom(shown, main);
  }).catch(err => console.warn('Quy hoạch chung – không tải được ranh phạm vi:', err));
}

function fitGeom(shown, feature) {
  if (!shown || !feature) return;
  const bounds = L.geoJSON(feature).getBounds();
  if (!bounds || !bounds.isValid()) return;
  shown.fitBounds(bounds, {
    paddingTopLeft: [40 + getLeftObstruction(), 40],
    paddingBottomRight: [40 + getRightObstruction(), 40]
  });
}

function paintGeom(id, feature) {
  if (!map || !feature) return;
  const urbanLevel = getLevel() === 'urban';
  scopeLayers = [map, planMap].filter(m => m && !(urbanLevel && m === planMap)).map(m => {
    if (!m.getPane(SCOPE_PANE)) {
      const pane = m.createPane(SCOPE_PANE);
      pane.style.zIndex = 415;
      pane.style.pointerEvents = 'none';
    }
    const group = L.featureGroup();
    L.geoJSON(feature, { style: SCOPE_STYLE }).addTo(group);
    return group.addTo(m);
  });
  const shown = planMap && isCompareOn() && !isSplitOn() ? planMap : map;
  fitGeom(shown, feature);
  document.dispatchEvent(new CustomEvent(GP_SCOPE_EVENT, {
    detail: { id, name: id, geometry: feature.geometry, city: id === 'hue' }
  }));
}

function unitNames(id) {
  const zone = (CITY_PLAN.zones || []).find(z => z.id === id);
  const sources = [generalPlanOf(id), CORE_AREAS.find(a => a.id === id), URBANS.find(u => u.id === id), URBANS_VISION.find(u => u.id === id), URBANS_614.find(u => u.id === id), zone];
  for (const s of sources) {
    if (!s) continue;
    if (s.city) return null;
    if (s.units && s.units.length) return s.units;
  }
  return null;
}

function fullWardNames(units) {
  return (units || []).map(u => {
    const b = bareName(u);
    return Object.keys(DVHC_WARDS).find(k => bareName(k) === b) || null;
  }).filter(Boolean);
}

function focusUrbanFallback(id) {
  if (id === 'hue') { focusWard(DVHC_CITY.name); return; }
  loadPartGeoms().then(() => {
    if (scopeId !== id) return;
    const part = partFeature(id);
    if (part) { paintGeom(id, part); return; }
    const names = fullWardNames(unitNames(id));
    if (names.length) highlightWardNames(names, { fitView: true });
  }).catch(() => {});
}

function openPage() {
  if (document.body.classList.contains('bottom-collapsed')) $('btnExpandBottomPanel')?.click();
  document.querySelector(`#part2Dots i[data-page="${GP_PAGE}"]`)?.click();
}

const geomPromises = new Map();

function loadGeom(file) {
  if (file === SCOPE_URL) return loadScopes();
  if (!geomPromises.has(file)) {
    const pending = fetch(file)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { geomPromises.delete(file); throw err; });
    geomPromises.set(file, pending);
  }
  return geomPromises.get(file);
}

// Danh sách Đô thị: vẽ đúng polygon đã dẫn, hoặc ranh thành phố với dòng quy hoạch Huế.
// Dòng chưa có ranh chỉ bỏ lớp cũ, không gọi showScope (showScope sẽ lấy ranh cả xã trong generalPlan).
function showListGeom(id, { geom, cityPlan } = {}) {
  clearScope();
  highlightWardBoundary('', { fitView: false });
  if (!id) return;
  scopeId = id;
  if (cityPlan) {
    focusWard(DVHC_CITY.name);
    return;
  }
  if (!geom || !geom.file || !geom.id) return;
  const token = id;
  loadGeom(geom.file).then(fc => {
    if (scopeId !== token) return;
    const feature = (fc.features || []).find(f => f.properties && f.properties.id === geom.id);
    if (!feature) return;
    paintGeom(token, feature);
  }).catch(err => console.warn('Đô thị – không tải được ranh:', err));
}

function pick(id, { page = false, list = false, geom = null, cityPlan = false } = {}) {
  picked = id;
  if (list) showListGeom(id, { geom, cityPlan });
  else if (id) showScope(id);
  else clearScope();
  renderPanel();
  if (page) openPage();
  else rerenderPage?.();
}

/** Mở hồ sơ một QHC ở trang Quy hoạch chung (bảng dưới) và vẽ phạm vi */
export const showGeneralPlan = (id) => pick(id, { page: true });

// Tab Đô thị: lớp Phân loại đô thị (chk_urban). Mẫu số là 14 đô thị Phụ lục I QĐ 614.
let urbanTotal = 0;
function paintUrbanCount() {
  const count = $('urbanTabCount');
  if (count) count.textContent = `(${$('chk_urban')?.checked ? urbanTotal : 0}/${urbanTotal})`;
}

function wardStat(short) {
  const b = bareName(short);
  const key = Object.keys(DVHC_WARDS).find(k => bareName(k) === b);
  return key ? DVHC_WARDS[key] : null;
}

function sumUnits(units) {
  if (!units || !units.length) return { pop: null, km2: null };
  let pop = 0;
  let km2 = 0;
  for (const u of units) {
    const row = wardStat(u);
    if (!row) return { pop: null, km2: null };
    pop += row.pop;
    km2 += row.km2;
  }
  return { pop, km2: Math.round(km2 * 100) / 100 };
}

// period ht: dân số và km² hiện trạng trong repo. period qh: không có dân số dự báo → «—»; km² là tổng địa giới các đơn vị trong phạm vi, hoặc PART_BOUNDS nếu chỉ một phần xã.
function resolved(item) {
  if (item.units && item.units.length) return item;
  const zone = (CITY_PLAN.zones || []).find(z => z.id === item.id);
  if (zone && zone.units && zone.units.length) return { ...item, units: zone.units };
  const u = URBANS_614.find(x => x.id === item.id);
  if (u) return { ...item, units: u.units, part: item.part || u.part, city: item.city || u.city };
  return item;
}

function statsFor(raw, period) {
  const item = resolved(raw);
  const partial = !!(item.partial || item.part);
  if (item.city || item.id === 'hue') {
    return period === 'ht'
      ? { pop: DVHC_CITY.pop, km2: DVHC_CITY.km2 }
      : { pop: null, km2: DVHC_CITY.km2 };
  }
  if (partial) {
    const km = PART_BOUNDS[item.id] && PART_BOUNDS[item.id].km2;
    return { pop: null, km2: km == null ? null : km };
  }
  if (item.units && item.units.length) {
    const s = sumUnits(item.units);
    return period === 'ht' ? s : { pop: null, km2: s.km2 };
  }
  return { pop: null, km2: null };
}

function statCell(value, fmt) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : fmt.format(Number(value));
}

function isCityRow(raw) {
  const item = raw && raw.qd756 ? raw : resolved(raw);
  const name = item.short || item.name;
  return item.id === 'hue' || item.city === true || name === DVHC_CITY.name;
}

function tagHtml(item) {
  const tags = [];
  if (item.strive) tags.push('(phấn đấu)');
  if (item.core) tags.push(`(lõi: ${item.core})`);
  if (item.missing) tags.push('(chưa có ranh)');
  if (!tags.length) return '';
  return tags.map(text => `<span class="axis-tag">${escapeHtml(text)}</span>`).join('');
}

function areaBtn(raw, n, period) {
  const qd = !!(raw && raw.qd756);
  const item = qd ? raw : resolved(raw);
  const stats = qd
    ? { pop: period === 'ht' ? item.pop : null, km2: item.km2 }
    : statsFor(item, period);
  const pop = statCell(stats.pop, POP_FMT);
  const km = statCell(stats.km2, KM_FMT);
  const full = item.name || item.short || '';
  const name = shortPlaceName(item.short || item.name);
  const city = isCityRow(item);
  const kv = item.kv || (city ? 'TP' : `dothi:${item.id}`);
  const on = item.id === picked;
  const num = `${n}.`;
  const tags = qd ? tagHtml(item) : '';
  const nameCls = tags ? 'axis-area-name has-tags' : 'axis-area-name';
  const nameInner = tags ? `<span class="axis-area-label">${escapeHtml(name)}</span>${tags}` : escapeHtml(name);
  const mark = city || item.hue ? ' axis-area-city' : '';
  const geom = item.geom;
  const qdAttr = qd
    ? ` data-gp-qd="1"${item.cityPlan ? ' data-gp-city="1"' : ''}${geom ? ` data-gp-file="${escapeHtml(geom.file)}" data-gp-geom="${escapeHtml(geom.id)}"` : ''}`
    : '';
  const tipBase = item.tip || `${full}: dân số ${pop}, diện tích ${km} km²`;
  const tip = full && !tipBase.includes(full) ? `${full}. ${tipBase}` : tipBase;
  return `<button type="button" class="axis-area gp-row${mark}${on ? ' active' : ''}" data-gp-pick="${escapeHtml(item.id)}" data-kv="${escapeHtml(kv)}" data-name="${escapeHtml(full)}"${qdAttr} aria-pressed="${on}" title="${escapeHtml(tip)}"><span class="axis-num">${num}</span><span class="${nameCls}">${nameInner}</span><span class="axis-area-pop">${pop}</span><span class="axis-area-km">${km}</span></button>`;
}

function groupHtml(groups, period) {
  let n = 0;
  return groups.map(g => {
    const rows = g.rows.map(item => areaBtn(item, ++n, period)).join('');
    return `<div class="gp-grp">${escapeHtml(g.title)}</div>${rows}`;
  }).join('');
}

const AREA_HEAD = `<div class="axis-area-head"><span class="axis-num"></span><span class="axis-area-name">Đô thị</span><span class="axis-area-pop">Dân số</span><span class="axis-area-km">km²</span></div>`;

let columnListed = null;

function renderPanel() {
  const box = $('gpList');
  if (!box) return;
  const htOn = (columnListed || (getViewMode() === 'HT' ? 'HT' : 'QH')) === 'HT';
  urbanTotal = HT_URBANS.length;
  paintUrbanCount();
  if (htOn) {
    box.innerHTML = `<div class="gp-sec">Hiện trạng</div>${AREA_HEAD}${groupHtml(HT_GROUPS, 'ht')}`;
    return;
  }
  const groups = gpPeriod === 'vision' ? DOTHI_SAU : DOTHI_2030;
  const note = gpPeriod === 'vision' ? '' : `<p class="gp-qd-note">${escapeHtml(NOTE_2030)}</p>`;
  const periods = `<div class="admin-tabs gp-periods" role="tablist" aria-label="Giai đoạn quy hoạch đô thị"><button type="button" class="admin-tab${gpPeriod === '2030' ? ' active' : ''}" data-gp-period="2030" aria-selected="${gpPeriod === '2030'}">Đến 2030</button><button type="button" class="admin-tab${gpPeriod === 'vision' ? ' active' : ''}" data-gp-period="vision" aria-selected="${gpPeriod === 'vision'}">Sau 2030</button></div>`;
  box.innerHTML = `<div class="gp-sec">Quy hoạch</div>${periods}${AREA_HEAD}${groupHtml(groups, 'qh')}${note}`;
}

export const refreshGeneralPlanPanel = renderPanel;

// ---------- Trang 4 bảng tổng hợp: tổng quan ----------
const OV_COLS = 9;

function groupRow(kind, n) {
  const label = kind === 'city'
    ? `${GP_KINDS.city} · loại I · vùng lõi ${CORE_ZONE.scale}, các vùng còn lại ${OUTER_ZONE.scale}`
    : `${GP_KINDS[kind]} · ${n} đô thị`;
  return `<tr class="uc-group"><td colspan="${OV_COLS}"><b>${escapeHtml(label)}</b></td></tr>`;
}

function overviewRow(plan, stt, c, here) {
  const kids = childProjects(plan, c.catalog);
  const cov = qhpkCoverage(plan, c.catalog, c.wards);
  const mat = maturityOf(plan, c);
  const tr = ['uc-row', plan.parent ? 'gp-sub' : '', here.has(plan.id) ? 'uc-here' : '', plan.id === picked ? 'uc-sel' : ''].filter(Boolean).join(' ');
  return `<tr class="${tr}" data-gp-pick="${plan.id}">
    <td>${stt}</td>
    <td class="uc-name"><button type="button" class="uc-link" data-gp-pick="${plan.id}" title="Xem hồ sơ và chỉ số trưởng thành">${escapeHtml(plan.name)}</button></td>
    <td class="gp-clsc" title="${escapeHtml(clsTip(plan))}">${clsHtml(plan)}</td>
    <td class="uc-scope" title="${escapeHtml(STATUS_REF)}">${escapeHtml(nowText(plan))}</td>
    <td class="uc-scope" title="${escapeHtml(plan.city ? 'Toàn thành phố' : plan.units.join(', '))}">${escapeHtml(scopeText(plan))}</td>
    <td class="uc-scope">${escapeHtml(plan.scale || '—')}</td>
    <td>${statusChip(plan)}</td>
    <td class="uc-val" title="Đồ án QHPK 1/2.000 trong phạm vi · phường, xã đã có QHPK / tổng">${kids.length} · <span class="c-muted">${cov.covered}/${cov.total}</span></td>
    <td class="uc-val" title="${escapeHtml(`Có số liệu ${mat.evaluated}/${mat.total} chỉ tiêu; trung bình các nhóm có số liệu`)}">
      <span class="uc-cell"><b class="${levelCls(mat.level)}">${pctText(mat.pct)}</b>${meterHtml(mat.pct, mat.level)}</span></td>
  </tr>`;
}

function wardBanner(wardName) {
  if (!wardName) return '';
  const mine = generalPlansOfWard(wardName);
  const parts = mine.map(p => (p.parent ? `${p.name} (vùng lõi ${CITY_PLAN.name}, ${CORE_ZONE.scale})` : p.name));
  if (!mine.some(p => p.parent)) parts.push(`các vùng còn lại của ${CITY_PLAN.name} (${OUTER_ZONE.scale})`);
  return `<div class="uc-note">${ico('info')} ${escapeHtml(wardName)} thuộc phạm vi ${escapeHtml(parts.join('; '))}.</div>`;
}

function overviewHtml(wardName) {
  const c = ctx();
  const here = new Set(wardName ? generalPlansOfWard(wardName).map(p => p.id) : []);
  let stt = 0;
  const rows = KIND_ORDER.map(kind => {
    const list = GENERAL_PLANS.filter(p => p.kind === kind);
    return groupRow(kind, list.length) + list.map(plan => {
      const n = ++stt;
      return overviewRow(plan, n, c, here)
        + (plan.city ? CORE_AREAS.map((a, i) => overviewRow(a, `${n}.${i + 1}`, c, here)).join('') : '');
    }).join('');
  }).join('');
  return `<div class="uc-bar"><span class="uc-summary" title="${escapeHtml(GP_PARENT_REF)}"><b>${GENERAL_PLANS.length} quy hoạch chung</b>
        · QHC thành phố Huế (vùng lõi ${CORE_AREAS.length} khu vực đô thị) và ${GENERAL_PLANS.length - 1} QHC đô thị</span>
      <span class="gp-chain">QĐ 756 ${ico('chev-right')} Quy hoạch chung ${ico('chev-right')} QHPK 1/2.000</span></div>
    ${wardBanner(wardName)}
    <div class="uc-dsplit"><div class="table-container gp-wrap">
      <table class="data-table uc-table gp-table">
        <thead><tr>
          <th>STT</th><th>Quy hoạch chung</th><th title="Loại đô thị theo nhu cầu lập quy hoạch → loại định hướng (mở rộng phạm vi hoặc QĐ 756)">Loại</th>
          <th title="${escapeHtml(STATUS_REF)}">Hiện trạng</th><th>Phạm vi</th><th>Tỷ lệ</th><th>Hồ sơ QHC</th>
          <th title="Số đồ án QHPK 1/2.000 · phường, xã đã có QHPK / tổng">QHPK 1/2.000</th>
          <th title="Chỉ số trưởng thành đô thị: hiện trạng so với chỉ tiêu QHC (chưa có thì mức tối đa Bảng 2A ${escapeHtml(CLASS_REF)} của loại định hướng)">Trưởng thành</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>`;
}

// ---------- Trang 4: chi tiết 1 QHC hoặc khu vực vùng lõi ----------
function decisionText(plan) {
  const d = plan.decision;
  if (!d) return skip();
  return escapeHtml(`${d.no || ''}${d.date ? ` ngày ${d.date}` : ''}${d.by ? ` của ${d.by}` : ''}`);
}

function horizonText(plan) {
  const h = plan.horizon;
  if (!h) return skip();
  return escapeHtml([h.base && h.target ? `${h.base} – ${h.target}` : h.target, h.vision ? `tầm nhìn ${h.vision}` : ''].filter(Boolean).join(', '));
}

function recordTable(plan) {
  const c = ctx();
  const built = plan.targets.builtHa;
  const row = (label, html) => `<tr><td class="uc-name">${label}</td><td>${html}</td></tr>`;
  const vision = plan.vision
    ? `${escapeHtml(`${plan.vision.name} (loại ${plan.vision.cls})`)}<br><span class="c-muted">${escapeHtml(plan.vision.change)}</span>`
    : skip('Chưa có trong danh mục đô thị sau 2030');
  const scope = plan.city
    ? escapeHtml(`Toàn thành phố (${scopeUnits(plan, c.wards).length} phường, xã)`)
    : escapeHtml(plan.units.join(', ')) + (plan.future ? `<br><span class="c-muted">${escapeHtml(plan.future.note)}</span>` : '');
  const common = `
    ${row('Loại đô thị', `${clsHtml(plan)}${plan.future ? ` <span class="c-muted">· mở rộng lên loại ${plan.future.cls}</span>` : ''}`)}
    ${row('Định hướng QĐ 756', vision)}
    ${row('Hiện trạng', `${escapeHtml(nowText(plan))} <span class="c-muted">· ${escapeHtml(STATUS_REF)}</span>`)}
    ${row('Phạm vi', scope)}
    ${row('Tỷ lệ bản vẽ', plan.scale ? escapeHtml(plan.scale) : skip())}`;
  const builtRow = row('Đất xây dựng đô thị', built ? `${fmtNum(built)} ha` : skip());
  if (plan.parent) {
    return `<table class="data-table uc-table uc-dtable gp-rec"><colgroup><col style="width:11em"><col></colgroup>
      <thead><tr><th colspan="2">Khu vực đô thị trong vùng lõi</th></tr></thead><tbody>
      ${row('Thuộc', `<button type="button" class="uc-link" data-gp-pick="${plan.parent.id}">${escapeHtml(plan.parent.name)}</button>
        <br><span class="c-muted">${escapeHtml(CORE_ZONE.name)} (${CORE_ZONE.scale}) — không lập QHC riêng</span>`)}
      ${common}
      ${row('Hồ sơ', `${statusChip(plan.parent)} <span class="c-muted">· theo ${escapeHtml(plan.parent.name)}</span>`)}
      ${row('Chỉ tiêu', `Do ${escapeHtml(plan.parent.name)} quy định`)}
      ${builtRow}
      </tbody></table>`;
  }
  const project = planProjectOf(plan, c.catalog);
  return `<table class="data-table uc-table uc-dtable gp-rec"><colgroup><col style="width:11em"><col></colgroup>
    <thead><tr><th colspan="2">Hồ sơ quy hoạch chung</th></tr></thead><tbody>
    ${row('Cấp trên', escapeHtml(GP_PARENT_REF))}
    ${row('Loại hình', escapeHtml(GP_KINDS[plan.kind]))}
    ${common}
    ${row('Trạng thái', statusChip(plan))}
    ${row('Quyết định phê duyệt', decisionText(plan))}
    ${row('Thời hạn quy hoạch', horizonText(plan))}
    ${builtRow}
    ${row('Đồ án trong danh mục', project
      ? `<button type="button" class="uc-link" data-gp-open="${escapeHtml(project.tenQH)}" title="${escapeHtml(namesOfProject(project).tenDayDu)}">${escapeHtml(namesOfProject(project).tenRutGon)}</button>`
      : skip('Chưa nạp ranh lô QHC (tên đồ án bắt đầu bằng "QHC" để xếp vào cấp QHC 1/10.000)'))}
    </tbody></table>`;
}

// Phân vùng nghiên cứu của QHC thành phố Huế: vùng lõi 1/10.000 (các khu vực đô thị) và các vùng còn lại 1/25.000
function zoneTable() {
  const c = ctx();
  const outer = outerUnits(c.wards);
  const areaRows = CORE_AREAS.map(a => {
    const mat = c.wards.length ? maturityOf(a, c) : null;
    return `<tr class="gp-sub">
      <td class="uc-name"><button type="button" class="uc-link" data-gp-pick="${a.id}" title="${escapeHtml(a.units.join(', '))}">${escapeHtml(a.name)}</button></td>
      <td class="gp-clsc" title="${escapeHtml(clsTip(a))}">${clsHtml(a)}</td>
      <td class="uc-val">${a.units.length}</td>
      <td class="uc-val">${mat ? `<b class="${levelCls(mat.level)}">${pctText(mat.pct)}</b>` : '…'}</td></tr>`;
  }).join('');
  return `<table class="data-table uc-table uc-dtable"><colgroup><col><col style="width:5.5em"><col style="width:5em"><col style="width:6.5em"></colgroup>
    <thead><tr><th>Phân vùng nghiên cứu</th><th>Loại</th><th>Đơn vị</th><th>Trưởng thành</th></tr></thead><tbody>
    <tr class="uc-group"><td colspan="2">${escapeHtml(CORE_ZONE.name)} · ${CORE_ZONE.scale}
        <button type="button" class="uc-link" data-gp-map="${CORE_ZONE_ID}" title="Vẽ ranh vùng lõi">${ico('map')}</button></td>
      <td class="uc-val" title="${escapeHtml(CORE_ZONE.units.join(', '))}">${CORE_ZONE.units.length}</td><td></td></tr>
    ${areaRows}
    <tr class="uc-group"><td colspan="2">${escapeHtml(OUTER_ZONE.name)} · ${OUTER_ZONE.scale}</td>
      <td class="uc-val" title="${escapeHtml(outer.join(', '))}">${c.wards.length ? outer.length : '…'}</td><td></td></tr>
    </tbody></table>`;
}

function childTable(plan) {
  const kids = childProjects(plan, ctx().catalog).sort((a, b) => String(a.tenQH).localeCompare(String(b.tenQH), 'vi'));
  const rows = kids.length
    ? kids.map((p, i) => `<tr><td>${i + 1}</td>
        <td class="uc-name"><button type="button" class="uc-link" data-gp-open="${escapeHtml(p.tenQH)}" title="${escapeHtml(namesOfProject(p).tenDayDu)}">${escapeHtml(namesOfProject(p).tenRutGon)}</button></td>
        <td class="uc-scope">${escapeHtml((p.wards || []).join(', '))}</td></tr>`).join('')
    : '<tr><td colspan="3" class="uc-skip">Chưa có đồ án QHPK 1/2.000 trong phạm vi</td></tr>';
  return `<table class="data-table uc-table uc-dtable"><colgroup><col style="width:2.4em"><col><col style="width:11em"></colgroup>
    <thead><tr><th colspan="3">QHPK 1/2.000 triển khai theo QHC · ${kids.length} đồ án</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function valueHtml(r) {
  if (r.text) return escapeHtml(r.text);
  if (r.value == null) return waitIcon(r.note);
  return `${r.lower ? '≥ ' : ''}${fmtNum(r.value)}`;
}

function maturityTable(plan) {
  const mat = maturityOf(plan, ctx());
  const rows = mat.groups.map(g => `<tr class="uc-group"><td colspan="4">${escapeHtml(g.group.name)}</td>
      <td class="uc-val"><b class="${levelCls(g.level)}">${pctText(g.pct)}</b></td></tr>`
    + g.items.map(r => {
      const tip = [r.item.code ? `Cách đo theo tiêu chuẩn ${r.item.code} (${CLASS_REF})` : '', r.note].filter(Boolean).join('\n');
      return `<tr>
        <td class="uc-name" title="${escapeHtml(tip)}">${escapeHtml(r.item.name)}${r.item.unit ? ` <span class="c-muted">(${escapeHtml(r.item.unit)})</span>` : ''}</td>
        <td class="uc-val">${valueHtml(r)}</td>
        <td class="uc-val">${r.target == null ? '—' : (r.item.calc === 'qhcApproved' ? 'Đã duyệt' : fmtNum(r.target))}</td>
        <td class="c-muted">${escapeHtml(r.targetSrc || '—')}</td>
        <td class="uc-val"><span class="uc-cell"><b class="${levelCls(r.level)}">${pctText(r.ratio)}</b>${meterHtml(r.ratio, r.level)}</span></td>
      </tr>`;
    }).join('')).join('');
  const ref = plan.city ? `ngưỡng Phụ lục I ${CLASS_REF} của đô thị loại I` : `mức tối đa Bảng 2A ${CLASS_REF} của loại ${plan.target} định hướng`;
  const own = plan.parent ? `chỉ tiêu ${plan.parent.name} quy định cho khu vực` : 'chỉ tiêu QHC xác lập';
  const sum = `<div class="uc-dsum">
      <div class="uc-side-score"><span>Có số liệu ${mat.evaluated}/${mat.total} chỉ tiêu · trung bình ${MATURITY_GROUPS.length} nhóm</span>
        <b class="${levelCls(mat.level)}">${pctText(mat.pct)}</b>${meterHtml(mat.pct, mat.level)}</div>
      <p>${ico('info')} Mức hoàn thành = hiện trạng / mục tiêu (tối đa 100%). Mục tiêu lấy ${escapeHtml(own)}; chưa có thì lấy
        ${escapeHtml(ref)} — đo mức sẵn sàng phân loại, nâng cấp đô thị. Chỉ tiêu chưa có số liệu không tính vào điểm.</p>
      <span class="uc-legend"><span class="c-green">Đạt 100%</span><span class="c-orange">50–99%</span><span class="c-red">Dưới 50%</span><span class="uc-skip">Chờ số liệu</span></span>
    </div>`;
  return `<table class="data-table uc-table uc-dtable gp-mat"><colgroup><col><col style="width:6.5em"><col style="width:6.5em"><col style="width:8.5em"><col style="width:7.5em"></colgroup>
    <thead><tr><th>Chỉ số trưởng thành đô thị</th><th>Hiện trạng</th><th>Mục tiêu</th>
      <th title="QHC = chỉ tiêu quy hoạch chung xác lập; Bảng 2A, Phụ lục I = ${escapeHtml(CLASS_REF)}; QĐ 756 = định hướng sau 2030">Nguồn mục tiêu</th><th>Hoàn thành</th></tr></thead>
    <tbody>${rows}</tbody></table>${sum}`;
}

function detailHtml(plan) {
  const units = scopeUnits(plan, ctx().wards);
  const back = plan.parent
    ? `<button type="button" class="bp-btn" data-gp-pick="${plan.parent.id}">${ico('chev-left')}QHC TP Huế</button>`
    : '';
  return `<div class="uc-bar">
      <button type="button" class="bp-btn" data-gp="all">${ico('chev-left')}${GENERAL_PLANS.length} QHC</button>${back}
      <span class="uc-summary"><b class="uc-${plan.cls}">Loại ${plan.cls}</b> <b>${escapeHtml(plan.name)}</b> · ${escapeHtml(`${units.length} phường, xã`)}</span>
      ${statusChip(plan)}
      <button type="button" class="bp-btn gp-map-btn" data-gp-map="${plan.id}" title="Phóng tới và vẽ ranh phạm vi">${ico('map')}Phạm vi</button>
    </div>
    <div class="uc-dsplit">
      <div class="uc-dcol">${recordTable(plan)}${plan.city ? zoneTable() : ''}${childTable(plan)}</div>
      <div class="uc-dcol">${maturityTable(plan)}</div>
    </div>`;
}

/** Vẽ trang Quy hoạch chung vào el. wardName rỗng = toàn thành phố. */
export function renderGeneralPlan(el, { wardName } = {}) {
  if (!el) return;
  loadBuiltAreas();
  const plan = picked ? generalPlanOf(picked) : null;
  el.innerHTML = plan ? detailHtml(plan) : overviewHtml(wardName || '');
  if (!roadsReady) {
    ensureClassRoads().then(() => { roadsReady = true; rerenderPage?.(); renderPanel(); })
      .catch(err => console.warn('Quy hoạch chung – mạng lưới đường lỗi:', err));
  }
}

export function initGeneralPlanEvents(el, rerender) {
  rerenderPage = rerender;
  el?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-gp-open]');
    if (open) { document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: open.dataset.gpOpen })); return; }
    const mapBtn = e.target.closest('[data-gp-map]');
    if (mapBtn) { showScope(mapBtn.dataset.gpMap); return; }
    if (e.target.closest('[data-gp="all"]')) { pick(null); return; }
    const row = e.target.closest('[data-gp-pick]');
    if (row) pick(row.dataset.gpPick);
  });
  $('gpList')?.addEventListener('click', (e) => {
    const period = e.target.closest('[data-gp-period]');
    if (period) {
      gpPeriod = period.dataset.gpPeriod === 'vision' ? 'vision' : '2030';
      renderPanel();
      e.stopPropagation();
      return;
    }
    const row = e.target.closest('[data-gp-pick]');
    if (!row) return;
    e.stopPropagation();
    const id = row.dataset.gpPick;
    const area = parseKv(row.dataset.kv) || { ...AREA_TP };
    setAreaFilter(area, 'user');
    if (row.dataset.gpQd === '1') {
      if (id === picked) pick(null, { list: true });
      else {
        const geom = row.dataset.gpFile ? { file: row.dataset.gpFile, id: row.dataset.gpGeom } : null;
        pick(id, { list: true, geom, cityPlan: row.dataset.gpCity === '1' });
      }
      return;
    }
    if (id === 'hue' || area.type === 'tp') focusWard(DVHC_CITY.name);
    if (id === picked && scopeLayers.length) pick(null);
    else pick(id);
  });
  onViewChange(() => renderPanel());
  document.addEventListener('qh:view-column', (e) => {
    if (e.detail?.mode === 'HT' || e.detail?.mode === 'QH') columnListed = e.detail.mode;
    renderPanel();
  });
  document.addEventListener('qh:admin-release', () => { if (picked) pick(null); });
  document.addEventListener('cadparcels:loaded', renderPanel);
  $('chk_urban')?.addEventListener('change', paintUrbanCount);
  // Chọn đô thị trên bản đồ thay cho đô thị đang chọn ở mục Đô thị
  document.addEventListener(URBAN_FOCUS_EVENT, (e) => {
    if (!picked || !e.detail || e.detail.startsWith('gp:')) return;
    picked = null;
    clearScope();
    renderPanel();
    rerenderPage?.();
  });
  renderPanel();
}
