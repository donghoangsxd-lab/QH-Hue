// Lớp 15 — dự án kêu gọi đầu tư (sheet 15-DA): ranh từ KML, thuộc tính từ danh sách.
// Cùng nhóm «sử dụng hạ tầng» với nhà ở xã hội: không bán kính phục vụ, không tính độ phủ.
// Bấm ranh: bảng góc trên trái. Nút kiểm tra quy hoạch cắt polygon với 4 cấp như bảng thửa / vùng đo.
import { map } from './mapEngine.js';
import { planMap, onCompareChange } from './planMap.js';
import { geeApi } from './api.js';
import { state } from './state.js';
import { escapeHtml, fmtNum, ico, showToast, TOOL_START_EVENT } from './utils.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { matchInvestRows, sheetProjectName } from './investMatch.js';
import { analyzeParcelPlan, parcelPlanHtml, planPlace, mountParcelPies, clearParcelPies } from './planLandStats.js';
import { parcelQhcHtml } from './qhc2045Layer.js';
import { parcelQhctHtml } from './qhctLayer.js';

const PANE = 'investPane';
// Trên lớp đô thị đang chọn (urbanFocus 444–446, hover 449) để bấm được ranh dự án.
const PANE_Z = 460;
const HL_PANE = 'investHighlightPane';
const HL_PANE_Z = 628;
const BASE = { color: '#fb923c', weight: 1.6, opacity: 0.95, fillColor: '#fb923c', fillOpacity: 0.14, fillRule: 'nonzero' };
const HOVER = { color: '#fff7ed', weight: 3, opacity: 1, fillColor: '#fdba74', fillOpacity: 0.4 };
const SELECTED = { color: '#fde047', weight: 3.5, opacity: 1, fillColor: '#facc15', fillOpacity: 0.28 };
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
let leftGroup = null;
let rightGroup = null;
let hovered = null;
let selected = null;
let card = null;
let highlight = null;
let landFill = null;
let openSeq = 0;
let drawToken = 0;

function toolBusy() {
  return !!(state.sketchTool || state.adminDrawMode || state.isPickMode || state.activeMeasureType || state.isInspectMode);
}

function titleOf(props) {
  return sheetProjectName(props.sheet) || props.name || 'Ranh dự án';
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

function fieldsHtml(props) {
  const row = props.sheet;
  const pairs = row
    ? Object.entries(row).filter(([k]) => !String(k).startsWith('_'))
    : [['Lĩnh vực', props.folder || ''], ...Object.entries(props.kml || {})].filter(([, v]) => v);
  const rows = pairs.map(([k, v]) => `<div class="pp-row invest-field"><span>${escapeHtml(k)}</span><b>${fieldValue(v)}</b></div>`).join('');
  const note = row
    ? ''
    : '<div class="invest-note">Chưa khớp tên với danh sách sheet 15-DA. Đang hiện thông tin ghi trên ranh.</div>';
  return `${rows}${note}`;
}

function setHint(text) {
  const el = $('investHint');
  if (el) el.textContent = text || '';
}

async function loadPack() {
  if (!ready) {
    ready = Promise.all([
      fetch('./data/invest-boundary.geojson').then(r => (r.ok ? r.json() : Promise.reject(new Error('không tải được ranh')))),
      loadRows()
    ]).then(([fc, rows]) => {
      const features = (fc && fc.features) || [];
      const idx = matchInvestRows(features, rows);
      let hit = 0;
      features.forEach((f, i) => {
        f.properties = f.properties || {};
        f.properties.sheet = idx[i] >= 0 ? rows[idx[i]] : null;
        if (idx[i] >= 0) hit++;
      });
      setHint(`(${features.length} ranh · ${hit} khớp danh sách)`);
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
      if (data && Array.isArray(data.rows) && data.rows.length) return data.rows;
    }
  } catch { /* bản đóng gói theo file Excel hiện có */ }
  const res = await fetch('./data/invest-sheet.json');
  if (!res.ok) return [];
  const data = await res.json();
  return data.rows || [];
}

function ensurePane(m, name, z) {
  if (m.getPane(name)) return;
  const pane = m.createPane(name);
  pane.style.zIndex = String(z);
  if (name === HL_PANE) pane.style.pointerEvents = 'none';
}

function drawOn(m, features) {
  ensurePane(m, PANE, PANE_Z);
  const group = L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: PANE,
    style: () => BASE,
    onEachFeature: (f, layer) => {
      const tip = titleOf(f.properties || {});
      layer.bindTooltip(tip, { sticky: true, className: 'invest-tip', opacity: 0.95 });
      layer.on('mouseover', () => {
        hovered = layer;
        if (layer !== selected) layer.setStyle(HOVER);
        layer.bringToFront();
      });
      layer.on('mouseout', () => {
        if (hovered === layer) hovered = null;
        layer.setStyle(layer === selected ? SELECTED : BASE);
      });
      layer.on('click', (e) => {
        if (toolBusy()) return;
        L.DomEvent.stopPropagation(e);
        openCard(f, layer, m);
      });
    }
  });
  group.addTo(m);
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
  if (selected && selected !== layer) selected.setStyle(BASE);
  selected = layer || null;
  if (layer) layer.setStyle(SELECTED);
  clearHighlight();
  if (!geom || !targetMap) return;
  ensurePane(targetMap, HL_PANE, HL_PANE_Z);
  highlight = L.geoJSON(geom, {
    pane: HL_PANE,
    interactive: false,
    style: { color: '#111827', weight: 7, opacity: 0.45, fill: false }
  }).addTo(targetMap);
}

function closeCard() {
  openSeq++;
  card = null;
  if (selected) selected.setStyle(BASE);
  selected = null;
  hovered = null;
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
    const land = e.target.closest('[data-land]');
    if (land) { toggleLand(land.dataset.land, land.dataset.color); return; }
    const tab = e.target.closest('[data-invest-tab]');
    if (tab) { showTab(tab.dataset.investTab); return; }
    if (e.target.closest('.invest-plan-btn')) { togglePlan(); return; }
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

async function showTab(id) {
  const st = card;
  if (!st || !isPlanLevel(id)) return;
  const seq = st.seq;
  st.tab = id;
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
  if (open) showTab(st.tab);
}

function openCard(feature, layer, targetMap) {
  if (!feature?.geometry) return;
  document.dispatchEvent(new CustomEvent('qh-dock-card', { detail: 'invest' }));
  clearParcelPies();
  const seq = ++openSeq;
  const props = feature.properties || {};
  const el = ensureCard();
  const tab = isPlanLevel(getLevel()) ? getLevel() : 'qhpk';
  let area = 0;
  try { area = turf.area(feature); } catch { area = 0; }
  const areaText = area >= 10000 ? `${fmtNum(area / 10000)} ha` : `${fmtNum(Math.round(area))} m²`;
  card = {
    seq, tab, cache: new Map(), map: targetMap, geom: feature.geometry,
    recorded: recordedM2(props.sheet), bounds: null, landKey: null
  };
  el.innerHTML = `<button type="button" class="cad-card-x" title="Đóng" aria-label="Đóng bảng dự án">${ico('close')}</button>
    <div class="invest-body">
      <div class="cad-id">
        <div class="lp-title">${escapeHtml(titleOf(props))}</div>
        <div class="lp-sub">${areaText}${props.folder ? ` · ${escapeHtml(props.folder)}` : ''}</div>
        <div class="invest-fields">${fieldsHtml(props)}</div>
        <button type="button" class="proof-btn invest-plan-btn" title="Diện tích từng loại đất quy hoạch trong ranh dự án, đủ 4 cấp">${ico('area')}Kiểm tra quy hoạch theo ranh giới dự án</button>
      </div>
      <div class="invest-plan" hidden>
        ${tabsBar(tab)}
        <div class="cad-page" role="tabpanel"></div>
      </div>
    </div>`;
  el.hidden = false;
  selectLayer(layer, targetMap, feature.geometry);
  let bounds = null;
  try { bounds = L.geoJSON(feature).getBounds(); } catch { bounds = null; }
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
  document.addEventListener(TOOL_START_EVENT, () => closeCard());
  document.addEventListener(LEVEL_EVENT, (e) => {
    const box = $('investCard')?.querySelector('.invest-plan');
    if (card && box && !box.hidden && isPlanLevel(e.detail?.level)) showTab(e.detail.level);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !card) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    closeCard();
  });
  onCompareChange(() => { if (visible && planMap && !rightGroup && ready) loadPack().then(features => { if (visible && planMap && !rightGroup) rightGroup = drawOn(planMap, features); }); });
  $('chk_invest')?.addEventListener('change', (e) => setVisible(e.target.checked));
  if ($('chk_invest')?.checked) setVisible(true);
}
