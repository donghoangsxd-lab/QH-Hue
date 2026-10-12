// Giao diện module Quy hoạch chung (generalPlan.js): mục "Đô thị" ở panel phải, trang 4 bảng tổng hợp
// (uiComponents.js › setPart2Page: tổng quan các QHC | chi tiết hồ sơ, phân vùng, QHPK 1/2.000 triển khai, chỉ số trưởng thành)
// và nét ranh phạm vi trên bản đồ (data/generalPlan.geojson). Khu vực vùng lõi là mục con của QHC thành phố Huế.
// Chọn ở panel phải hay bảng dưới đều dùng chung picked; không import uiComponents.js (tránh vòng import), mở trang bằng nút sẵn có.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn } from './planMap.js';
import { escapeHtml, fmtNum, ico } from './utils.js';
import { loadBuiltAreas } from './wardRoads.js';
import { measure2A, ensureClassRoads, CLASS_REF } from './urbanClass.js';
import { STATUS_REF } from './urbanStatus.js';
import {
  GENERAL_PLANS, CORE_AREAS, CORE_ZONE_ID, GP_KINDS, GP_STATUS, GP_PARENT_REF, OPEN_PROJECT_EVENT, MATURITY_GROUPS,
  generalPlanOf, generalPlansOfWard, childProjects, planProjectOf, qhpkCoverage, maturityOf, scopeUnits, outerUnits
} from './generalPlan.js';

const GP_PAGE = 3;
const SCOPE_URL = 'data/generalPlan.geojson';
// Ranh phạm vi trùng nét ranh đô thị của lớp Phân loại đô thị (pane 410, urbanAreaLayer.js) nên vẽ ở pane riêng nằm trên
const SCOPE_PANE = 'gpScopePane';
const SCOPE_STYLE = { color: '#facc15', weight: 3.5, dashArray: '10 6', fillColor: '#facc15', fillOpacity: 0.06, interactive: false, pane: SCOPE_PANE };
const CORE_STYLE = { color: '#fb923c', weight: 2.5, dashArray: '4 5', fillColor: '#fb923c', fillOpacity: 0.05, interactive: false, pane: SCOPE_PANE };

const $ = (id) => document.getElementById(id);
const CITY_PLAN = GENERAL_PLANS.find(p => p.city);
const CORE_ZONE = CITY_PLAN.zones[0];
const OUTER_ZONE = CITY_PLAN.zones[1];
const KIND_ORDER = ['city', 'satellite', 'town'];

let picked = null;
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
  scopeId = null;
}

// QHC thành phố Huế và khu vực vùng lõi vẽ kèm nét vùng lõi 1/10.000 để thấy quan hệ phạm vi.
// Vẽ trên cả bản đồ hiện trạng và bản đồ quy hoạch (2 bản đồ đồng bộ khung nhìn); phóng tới trên bản đồ đang hiện
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
    if (!main) return;
    const core = withCore ? byId(CORE_ZONE_ID) : null;
    scopeLayers = [map, planMap].filter(Boolean).map(m => {
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
    const shown = planMap && isCompareOn() && !isSplitOn() ? planMap : map;
    shown.fitBounds(L.geoJSON(main).getBounds(), { padding: [40, 40] });
  }).catch(err => console.warn('Quy hoạch chung – không tải được ranh phạm vi:', err));
}

function openPage() {
  if (document.body.classList.contains('bottom-collapsed')) $('btnExpandBottomPanel')?.click();
  document.querySelector(`#part2Dots i[data-page="${GP_PAGE}"]`)?.click();
}

function pick(id, { page = false } = {}) {
  picked = id;
  if (id) showScope(id); else clearScope();
  renderPanel();
  if (page) openPage();
  else rerenderPage?.();
}

/** Mở hồ sơ một QHC ở trang Quy hoạch chung (bảng dưới) và vẽ phạm vi */
export const showGeneralPlan = (id) => pick(id, { page: true });

// ---------- Panel phải: mục Đô thị ----------
// Đô thị là dòng chính; QHC, QHPK, mức trưởng thành là thông tin phụ. Khu vực vùng lõi theo QHC thành phố Huế (1/10.000)
const URBAN_GROUPS = [
  { title: 'Đô thị loại I', list: () => [CITY_PLAN] },
  { title: 'Khu vực đô thị loại II', list: () => CORE_AREAS.filter(a => a.cls === 'II') },
  { title: 'Khu vực đô thị loại III', list: () => CORE_AREAS.filter(a => a.cls === 'III') },
  { title: 'Đô thị loại III', list: () => GENERAL_PLANS.filter(p => !p.city) }
];

function panelRow(plan, c, here) {
  const kids = childProjects(plan, c.catalog).length;
  const mat = c.wards.length ? maturityOf(plan, c) : null;
  const cls = ['gp-row', plan.id === picked ? 'is-sel' : '', here.has(plan.id) ? 'is-here' : ''].filter(Boolean).join(' ');
  const tip = [plan.name, plan.parent ? `Vùng lõi ${plan.parent.name} (1/10.000)` : GP_KINDS[plan.kind], clsTip(plan)].join('\n');
  const qhc = plan.parent
    ? `<span class="gp-st-sub" title="Không lập QHC riêng; chỉ tiêu do ${escapeHtml(plan.parent.name)} quy định">Theo QHC TP Huế</span>`
    : `<span class="gp-st-${plan.status}">QHC: ${GP_STATUS[plan.status]}</span>`;
  const to = plan.target !== plan.cls
    ? `<span class="gp-to uc-${plan.target}" title="Loại định hướng">${ico('chev-right')}${plan.target}</span>` : '';
  return `<button type="button" class="${cls}" data-gp-pick="${plan.id}" title="${escapeHtml(tip)}">
      <b class="gp-cls uc-${plan.cls}">${plan.cls}</b>
      <span class="gp-name">${escapeHtml(plan.short)}</span>
      ${to}
      <small class="gp-meta">${qhc} · ${kids} QHPK · trưởng thành ${mat ? pctText(mat.pct) : '…'}</small>
    </button>`;
}

// Tab Đô thị: lớp Phân loại đô thị (chk_urban) bật thì mọi đô thị trong danh sách đều đang hiện trên bản đồ
let urbanTotal = 0;
function paintUrbanCount() {
  const count = $('urbanTabCount');
  if (count) count.textContent = `(${$('chk_urban')?.checked ? urbanTotal : 0}/${urbanTotal})`;
}

function renderPanel() {
  const box = $('gpList');
  if (!box) return;
  const c = ctx();
  const here = new Set(state.selectedWard ? generalPlansOfWard(state.selectedWard).map(p => p.id) : []);
  const groups = URBAN_GROUPS.map(g => ({ title: g.title, list: g.list() })).filter(g => g.list.length);
  urbanTotal = groups.reduce((n, g) => n + g.list.length, 0);
  paintUrbanCount();
  box.innerHTML = groups.map(g => `<div class="gp-grp">${escapeHtml(g.title)}${g.list.length > 1 ? ` · ${g.list.length}` : ''}</div>
    ${g.list.map(plan => panelRow(plan, c, here)).join('')}`).join('');
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
      ? `<button type="button" class="uc-link" data-gp-open="${escapeHtml(project.tenQH)}">${escapeHtml(project.tenQH)}</button>`
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
        <td class="uc-name"><button type="button" class="uc-link" data-gp-open="${escapeHtml(p.tenQH)}" title="Mở đồ án trên bản đồ">${escapeHtml(p.tenQH)}</button></td>
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
    const row = e.target.closest('[data-gp-pick]');
    if (!row) return;
    const id = row.dataset.gpPick;
    if (id === picked && scopeLayers.length) pick(null);
    else pick(id, { page: true });
  });
  document.addEventListener('cadparcels:loaded', renderPanel);
  $('chk_urban')?.addEventListener('change', paintUrbanCount);
  renderPanel();
}
