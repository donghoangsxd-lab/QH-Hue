// Lớp QHCT 1/500 (quy hoạch chi tiết) trên bản đồ quy hoạch: lô tĩnh tại QHCT_URL + đồ án QHCT nhập (projectLayer.js vẽ
// theo planLevelOf). Định dạng lô tĩnh: FeatureCollection, properties { tenQH, kyHieu, chucNang, dienTich (m²), mau? }.
// Dòng lớp ghi số đồ án nhập và số lô tĩnh; chưa có cả hai thì "chưa có dữ liệu".
// Khi lớp QHCT tắt: ranh tím nét đứt chỉ hiện lúc đang mở một đồ án, và chỉ phần QHCT nằm trong ranh đồ án đó.
// Tổng quan QHPK 1/2.000 (chỉ ranh các đồ án) và chọn phường không vẽ các ranh này.
// Nhịp nét lệch nửa chu kỳ với ranh điều chỉnh cục bộ (adjustLayer.js, cyan, z 449) nên chỗ trùng ranh hiện xen kẽ tím / cyan.
import { state } from './state.js';
import { map, addPopupCollapseToggle, expandCollapsedPopup, syncFocusedProjectToLot, openDockPopup, attachSelectionOutline, ensureQuyHoachPane } from './mapEngine.js';
import { planMap, isSplitOn, getViewMode, setViewMode, passToolClick, whenMapsIdle } from './planMap.js';
import { isLevelPair, mapsForLevel, onSplitPair } from './splitPair.js';
import { escapeHtml, fmtNum } from './utils.js';
import { planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import { analyzeParcelPlan, parcelPlanHtml, planPlace } from './planLandStats.js';
import { annotateCompliance } from './planCompliance.js';
import { landPatternKey, TT16_STYLES, LOT_OPACITY_EVENT, getLotOpacity } from './tt16Symbols.js';
import { attachLotBuildup } from './lotBuildup.js';
import { lotBuildupSlotHtml } from './lotScreen.js';
import {
  lotHeading, shortLandUse, metricGridHtml, landUseBannerHtml, landCardTabsHtml,
  regulationsPaneHtml, bindLandCardTabs
} from './lotPopup.js';

export const QHCT_URL = 'data/qhct/index.json';
const PANE = 'qhctPane';
const DEFAULT_COLOR = '#f472b6';
// Dưới ranh điều chỉnh cục bộ (449) và tem đường (450)
const OUTLINE_PANE = 'qhctOutlinePane';
const OUTLINE_Z = 448;
const OUTLINE_STYLE = { color: '#d946ef', weight: 2, opacity: 1, dashArray: '10 6', lineCap: 'butt', fill: false };
const OUTLINE_HOVER = { color: '#f0abfc', weight: 4 };

const $ = (id) => document.getElementById(id);
const target = () => planMap || map;
let data = null;
let loading = null;
let outlines = null;
let outlineKey = null;
const outlineRenderers = new WeakMap();

function setHint(text) {
  const el = $('qhctHint');
  if (el) el.textContent = `(${text})`;
}

const qhctPlans = () => (state.projectCatalog || []).filter(p => p && p.tenQH && planLevelOf(p.tenQH) === 'QHCT');

// Đồ án đang mở: chỉ phần QHCT nằm trong ranh đồ án. Cắt lỗi thì giữ nguyên nếu còn giao nhau.
function clipToProject(geom, mask) {
  if (!mask || typeof turf === 'undefined') return null;
  try {
    const area = turf.feature(geom);
    const host = turf.feature(mask);
    if (!turf.booleanIntersects(area, host)) return null;
    try {
      const hit = turf.intersect(area, host);
      return hit ? hit.geometry : geom;
    } catch (e) { return geom; }
  } catch (e) { return null; }
}

function focusedHost() {
  const name = state.focusedProject;
  if (!name) return null;
  const p = (state.projectCatalog || []).find(x => x && x.tenQH === name && x.boundary);
  return p || null;
}

function idleHint() {
  const plans = qhctPlans().length;
  const lots = data ? data.features.length : 0;
  const parts = [plans && `${fmtNum(plans)} đồ án`, lots && `${fmtNum(lots)} lô`].filter(Boolean);
  return parts.join(', ') || 'chưa có dữ liệu';
}

function outlineRenderer(m) {
  let r = outlineRenderers.get(m);
  if (!r) {
    if (!m.getPane(OUTLINE_PANE)) m.createPane(OUTLINE_PANE).style.zIndex = OUTLINE_Z;
    r = L.svg({ pane: OUTLINE_PANE });
    outlineRenderers.set(m, r);
  }
  return r;
}

function drawOutlines(m, plans) {
  const r = outlineRenderer(m);
  outlines = L.layerGroup().addTo(m);
  plans.forEach(p => {
    const line = L.geoJSON(p.boundary, { renderer: r, bubblingMouseEvents: false, style: OUTLINE_STYLE });
    line.bindTooltip(`Đã có QHCT 1/500 · ${escapeHtml(p.tenQH)}`, { sticky: true, direction: 'top', className: 'dot-tip' });
    line.on('mouseover', () => line.setStyle(OUTLINE_HOVER));
    line.on('mouseout', () => line.setStyle(OUTLINE_STYLE));
    line.on('click', (e) => {
      if (!passToolClick(m, e)) document.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: p.tenQH }));
    });
    outlines.addLayer(line);
  });
}

// Ranh khu vực đã có QHCT khi lớp QHCT tắt: chỉ đồ án đang mở, cắt theo ranh đồ án đó
function refreshOutlines() {
  if (isLevelPair()) {
    outlines?.remove();
    outlines = null;
    outlineKey = null;
    return;
  }
  const m = target();
  const host = focusedHost();
  const on = !!m && !$('chk_qhct')?.checked && !!host;
  const key = on ? `${host.tenQH}|${state.projectCatalog}` : null;
  if (key === outlineKey && (!on || outlines)) return;
  outlineKey = key;
  outlines?.remove();
  outlines = null;
  if (!on || typeof L === 'undefined') return;
  const plans = qhctPlans().filter(p => p.boundary && p.tenQH !== host.tenQH).map(p => {
    const boundary = clipToProject(p.boundary, host.boundary);
    return boundary ? { ...p, boundary } : null;
  }).filter(Boolean);
  if (plans.length) drawOutlines(m, plans);
}

/** Cập nhật dòng lớp + ranh khu vực QHCT khi danh mục đồ án đổi (projectLayer.js) */
export function refreshQhct() {
  if (!loading) setHint(idleHint());
  refreshOutlines();
}

function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch(QHCT_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(fc => { data = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] }; return data; })
      .finally(() => { loading = null; });
  }
  return loading;
}

/** Lô QHCT 1/500 (FeatureCollection rỗng khi chưa có file) */
export const loadQhct = () => load();

/** Hình (thửa hoặc vùng đo) cắt với đồ án QHCT đã nạp rồi tới lô tĩnh, kể cả khi lớp QHCT đang tắt */
export async function parcelQhctHtml(geometry, recorded, place) {
  const w = planPlace(place);
  const fc = await load();
  const extras = (fc.features || []).filter(f => f && f.geometry).map(f => {
    const p = f.properties || {};
    const name = p.kyHieu || p.chucNang || 'Lô QHCT';
    return {
      geometry: f.geometry,
      label: p.chucNang || 'Lô QHCT',
      color: p.mau || DEFAULT_COLOR,
      key: '',
      name,
      sub: [p.tenQH, p.kyHieu && p.chucNang ? p.chucNang : ''].filter(Boolean).join(' · '),
      file: p.tenQH || ''
    };
  });
  const res = await analyzeParcelPlan(geometry, { level: 'QHCT', includeHidden: true, extras });
  await annotateCompliance('QHCT', geometry, res.parts);
  const slip = place === 'measure' || place === 'invest' || place === 'lot' ? '' : ' Sai số ranh khoảng 0,5 m.';
  return {
    html: parcelPlanHtml(res, recorded, {
      title: 'Thông tin quy hoạch:',
      noneLabel: 'Chưa có lô QHCT',
      empty: `${w.it} chưa nằm trong lô QHCT 1/500 (lô tĩnh hoặc đồ án đã nạp).`,
      place,
      compact: place !== 'measure' && place !== 'invest',
      note: `Cắt hình học ${w.cut} với lô QHCT 1/500, kể cả khi lớp QHCT hoặc đồ án đang tắt. Đồ án nhập giữ phần chồng lên lô tĩnh.${slip}`
    }),
    shapes: res.shapes
  };
}

function popupHtml(p, opts) {
  const type = shortLandUse(p.chucNang || 'Lô đất QHCT 1/500');
  const code = String(p.kyHieu || '').trim();
  const title = lotHeading(type, code, type) || type;
  const areaText = p.dienTich ? `${fmtNum(Math.round(p.dienTich))} m²` : '';
  const key = landPatternKey([p.chucNang, p.kyHieu].filter(Boolean).join(' '));
  const tone = (key && TT16_STYLES[key]?.color) || p.mau || DEFAULT_COLOR;
  const swatch = `<i class="lp-swatch" style="background:${tone};"></i>`;
  const project = !opts?.hideProject && p.tenQH
    ? `<span class="lp-project-name" title="${escapeHtml(p.tenQH)}">${escapeHtml(p.tenQH)}</span>`
    : '';
  const rows = [
    project ? `<div class="pp-row lp-project-row"><span>Đồ án</span><b>${project}</b></div>` : '',
    code && title !== code ? `<div class="pp-row"><span>Ký hiệu lô</span><b>${escapeHtml(code)}</b></div>` : ''
  ].filter(Boolean).join('');
  const sameAsType = !!(type && title.trim().toLowerCase() === type.trim().toLowerCase());
  const titleRow = sameAsType ? '' : `<div class="lp-title-row"><span class="lp-title">${escapeHtml(title)}</span></div>`;
  return `<div class="pp land-popup land-popup-card">
    <div class="pp-title lp-head" title="${escapeHtml([p.chucNang, code].filter(Boolean).join(' · '))}">
      <div class="lp-head-main">
        <div class="lp-eyebrow">
          <span class="lp-eyebrow-label">Quy hoạch chi tiết</span>
          <span class="lp-phase lp-phase-qh">Quy hoạch</span>
        </div>
        ${titleRow}
      </div>
    </div>
    ${landCardTabsHtml('chi-tieu')}
    <div class="lp-pane is-on" data-lp-pane="chi-tieu" role="tabpanel">
      ${metricGridHtml(areaText, null)}
      ${landUseBannerHtml(type, swatch)}
      ${rows ? `<div class="lp-meta lp-info">${rows}</div>` : ''}
      ${lotBuildupSlotHtml()}
    </div>
    <div class="lp-pane" data-lp-pane="quy-dinh" role="tabpanel" hidden>
      ${regulationsPaneHtml(null)}
    </div>
  </div>`;
}

const drawn = new WeakMap();
let qhctLotPop = null;

function clearLots(m) {
  const d = drawn.get(m);
  if (!d) return;
  d.layer?.remove();
  drawn.delete(m);
}

function lotFill(f) {
  const p = f.properties || {};
  const key = landPatternKey([p.chucNang, p.kyHieu].filter(Boolean).join(' '));
  const c = (key === 'BBC' && TT16_STYLES.BBC.color) || p.mau || DEFAULT_COLOR;
  return { color: c, weight: 1, fillColor: c, fillOpacity: (key === 'BBC' ? 0.55 : 0.45) * getLotOpacity() };
}

function restyleLots() {
  qhctMaps().forEach(m => drawn.get(m)?.layer?.setStyle(lotFill));
}

function pointInFeature(f, lng, lat) {
  if (!f?.geometry) return false;
  let box = f._qhBox;
  if (!box) {
    try { box = turf.bbox(f); } catch { box = null; }
    f._qhBox = box;
  }
  if (!box || lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) return false;
  try { return turf.booleanPointInPolygon([lng, lat], f); } catch { return false; }
}

/** Lô tĩnh QHCT 1/500 nhỏ nhất chứa điểm. null nếu không có. */
export async function qhctFeatureAt(latlng) {
  if (!latlng) return null;
  const fc = await load();
  let best = null;
  let bestA = Infinity;
  for (const f of fc.features || []) {
    if (!pointInFeature(f, latlng.lng, latlng.lat)) continue;
    const a = Number(f.properties?.dienTich) || 0;
    let area = a;
    if (!area) {
      try { area = turf.area(f); } catch { area = Infinity; }
    }
    if (area < bestA) { best = f; bestA = area; }
  }
  return best;
}

/** Cùng popup bấm trái lên lô tĩnh. hideProject: không hiện dòng đồ án. */
export function showQhctLot(m, f, latlng, opts) {
  openQhctPopup(m, f, latlng, opts);
}

function openQhctPopup(m, f, latlng, opts) {
  if (qhctLotPop && qhctLotPop.f === f && qhctLotPop.map === m && expandCollapsedPopup(qhctLotPop.popup)) return;
  const props = f.properties || {};
  if (!opts?.hideProject && props.tenQH) syncFocusedProjectToLot(props.tenQH);
  ensureQuyHoachPane();
  const popup = openDockPopup(m, 'qhct-popup land-lot-popup', popupHtml(props, opts));
  attachSelectionOutline(m, f.geometry, popup);
  qhctLotPop = { popup, f, map: m };
  attachLotBuildup(popup, {
    geometry: f.geometry,
    plan: null,
    phase: 'QH',
    file: props.tenQH || '',
    id: props.kyHieu || '',
    layer: props.chucNang || '',
    name: props.chucNang || ''
  });
  bindLandCardTabs(popup.getElement());
  addPopupCollapseToggle(popup, 'viền lô', 'Bấm lại vào lô đất để hiện bảng thông tin');
  popup.on('remove', () => { if (qhctLotPop?.popup === popup) qhctLotPop = null; });
}

function draw(m) {
  clearLots(m);
  const pane = m.getPane(PANE) || m.createPane(PANE);
  pane.style.zIndex = 380;
  const renderer = L.canvas({ pane: PANE });
  const layer = L.geoJSON(data, {
    pane: PANE,
    renderer,
    style: lotFill
  }).on('click', (e) => openQhctPopup(m, e.layer.feature, e.latlng));
  layer.addTo(m);
  drawn.set(m, { layer, renderer });
}

function qhctMaps() {
  if (isLevelPair()) return mapsForLevel('qhct') || [];
  return $('chk_qhct')?.checked && target() ? [target()] : [];
}

async function setVisible(on) {
  const maps = isLevelPair() ? qhctMaps() : (on && target() ? [target()] : []);
  [map, planMap].filter(Boolean).forEach(m => { if (!maps.includes(m)) clearLots(m); });
  if (!maps.length) {
    setHint(idleHint());
    return;
  }
  if (!isLevelPair() && planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setHint('đang tải…');
  await load();
  if (!isLevelPair() && !$('chk_qhct')?.checked) return;
  await whenMapsIdle([map, planMap]);
  if (!isLevelPair() && !$('chk_qhct')?.checked) return;
  const shown = qhctMaps();
  [map, planMap].filter(Boolean).forEach(m => { if (!shown.includes(m)) clearLots(m); });
  shown.forEach(m => { if (data?.features?.length) draw(m); });
  setHint(idleHint());
}

export function initQhctLayer() {
  $('chk_qhct')?.addEventListener('change', (e) => {
    if (isLevelPair()) { setVisible(true); refreshOutlines(); return; }
    setVisible(e.target.checked);
    refreshOutlines();
  });
  $('chk_projects')?.addEventListener('change', refreshOutlines);
  onSplitPair(() => { setVisible(!!$('chk_qhct')?.checked); refreshOutlines(); });
  window.addEventListener(LOT_OPACITY_EVENT, restyleLots);
}
