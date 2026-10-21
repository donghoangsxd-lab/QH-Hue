// Lớp 14. Chung cư (Khu đất): vẽ mọi dòng tab 14-NOXH. Hiện trạng tính dân; quy hoạch chỉ để xem.
// Bật hay tắt lớp không đổi gói dân đưa vào setPopData.
import { map, WARD_BOUNDS_EVENT } from './mapEngine.js';
import { assignNoxhWards } from './noxhWard.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, RIGHT_TAB_EVENT } from './utils.js';
import { postAdmin } from './wardRoads.js';
import { setWardPopHtml } from './uiComponents.js';
import {
  POP_METHOD_EVENT, apartmentPopulation, popConfig, popItems, popMethod,
  restorePopMethod, setPopConfig, setPopData, setPopMethod, cityApartmentSummary, wardPopNote
} from './popMethod.js';

const $ = (id) => document.getElementById(id);
const CONF = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
const KIND = { noxh: 'Nhà ở xã hội', thuongmai: 'Thương mại' };
const STYLES = {
  noxh: { color: '#ddd6fe', weight: 2, fillColor: '#6d28d9', fillOpacity: 0.35 },
  thuongmai: { color: '#7dd3fc', weight: 2, fillColor: '#0369a1', fillOpacity: 0.35 },
  plan: { color: '#fbbf24', weight: 2, dashArray: '6 4', fillColor: '#f59e0b', fillOpacity: 0.16 },
  planTm: { color: '#38bdf8', weight: 2, dashArray: '6 4', fillColor: '#0284c7', fillOpacity: 0.16 }
};

let on = false;
let groupL = null;
let groupR = null;
let planL = null;
let planR = null;
let loaded = false;
let planItems = [];
let rawLive = [];
let rawPlan = [];
let popWeights = null;
let faqQuestions = [];
let kindFilter = '';

function isAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

function styleOf(it) {
  const plan = it.status === 'quy_hoach';
  const tm = it.kind === 'thuongmai';
  if (plan) return tm ? STYLES.planTm : STYLES.plan;
  return tm ? STYLES.thuongmai : STYLES.noxh;
}

function yearOf(it) {
  return String(it.year || it.nam || '').trim();
}

function icon(conf, plan) {
  const tone = plan ? '#b45309' : conf === 'high' ? '#6d28d9' : conf === 'medium' ? '#7c3aed' : '#a78bfa';
  return L.divIcon({
    className: 'apt-pin',
    html: `<span style="background:${tone}"><svg class="ico"><use href="#i-floors"/></svg></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function passesKind(it) {
  if (!kindFilter) return true;
  if (kindFilter === 'thuongmai') return it.kind === 'thuongmai';
  return it.kind !== 'thuongmai';
}

function ringWkt(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return '';
  return `(${ring.map(p => `${p[0]} ${p[1]}`).join(', ')})`;
}

function wktOf(it) {
  const raw = String(it.wkt || '').trim();
  if (/^(MULTI)?POLYGON\s*\(/i.test(raw)) return raw;
  const g = it.geometry;
  if (!g || !Array.isArray(g.coordinates)) return '';
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map(ringWkt);
    if (!rings.length || rings.some(r => !r)) return '';
    return `POLYGON (${rings.join(', ')})`;
  }
  if (g.type === 'MultiPolygon') {
    const polys = [];
    for (const poly of g.coordinates) {
      if (!Array.isArray(poly)) return '';
      const rings = poly.map(ringWkt);
      if (!rings.length || rings.some(r => !r)) return '';
      polys.push(`(${rings.join(', ')})`);
    }
    return polys.length ? `MULTIPOLYGON (${polys.join(', ')})` : '';
  }
  return '';
}

function asPlan(it) {
  const detail = String(it.detail || '');
  return {
    ...it,
    plannedPop: it.plannedPop || it.residents || null,
    uncertain: !!it.uncertain || /lệch|lech/i.test(detail)
  };
}

function popupHtml(it) {
  const plan = it.status === 'quy_hoach';
  const row = apartmentPopulation(it, popConfig());
  const recorded = Number(it.residents);
  const dan = plan
    ? (Number.isFinite(recorded) && recorded > 0 ? Math.round(recorded) : null)
    : (row.how === 'thieu' ? null : Math.round(row.pop));
  const danText = dan != null
    ? dan.toLocaleString('vi-VN')
    : (plan ? 'Không tính vào dân hiện trạng' : 'Chưa có số');
  const people = plan ? 'Quy hoạch — không tính dân hiện trạng' : (dan != null ? `${dan.toLocaleString('vi-VN')} người` : 'Hiện trạng');
  const bits = [
    ['Loại', KIND[it.kind] || 'Chưa phân loại'],
    ['Số căn', it.units ? String(it.units) : 'Chưa có số'],
    ['Dân số', danText],
    ['Trạng thái', plan ? 'Quy hoạch' : 'Hiện trạng']
  ];
  const year = yearOf(it);
  if (year) bits.push(['Năm', year]);
  [
    ['Loại chi tiết', it.kindDetail],
    ['Phường, xã', it.ward],
    ['Ghi chú định vị', it.locateNote],
    ['Độ tin cậy', CONF[it.confidence] || it.confidence]
  ].forEach(pair => { if (pair[1]) bits.push(pair); });
  const edit = !plan && isAdmin() ? `<form class="apt-edit" data-apt="${escapeHtml(it.id)}">
      <label>Số tầng <input name="floors" type="number" min="1" max="80" value="${it.floors || ''}"></label>
      <label>Số căn <input name="units" type="number" min="0" step="1" value="${it.units || ''}"></label>
      <label>Số dân <input name="residents" type="number" min="0" step="1" value="${it.residents || ''}"></label>
      <label class="apt-check"><input name="verified" type="checkbox"${it.verified ? ' checked' : ''}> Đã xác minh</label>
      <button type="submit">Ghi tab NOXH</button>
    </form>` : '';
  return `<div class="apt-pop"><b>${escapeHtml(it.name || 'Chung cư')}</b><div class="apt-pop-n">${people}</div>
    <dl>${bits.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>${edit}</div>`;
}

function addSite(group, it, style, html, plan) {
  if (it.geometry) {
    group.addLayer(L.geoJSON(it.geometry, { style, bubblingMouseEvents: false }).bindPopup(html, { maxWidth: 300 }));
  }
  if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) return;
  const opt = { icon: icon(it.confidence, plan), bubblingMouseEvents: false };
  group.addLayer(L.marker([it.lat, it.lng], opt).bindPopup(html, { maxWidth: 300 }));
}

function draw() {
  groupL?.remove();
  groupR?.remove();
  planL?.remove();
  planR?.remove();
  planL = null;
  planR = null;
  groupL = L.layerGroup();
  groupR = L.layerGroup();
  if (!on) return;
  [...popItems(), ...planItems].filter(passesKind).forEach(it => {
    const html = () => popupHtml(it);
    const style = styleOf(it);
    const plan = it.status === 'quy_hoach';
    addSite(groupL, it, style, html, plan);
    addSite(groupR, it, style, html, plan);
  });
  if (map) groupL.addTo(map);
  if (planMap) groupR.addTo(planMap);
}

function summaryText() {
  const s = cityApartmentSummary();
  const ht = popItems();
  const noxh = ht.filter(it => it.kind !== 'thuongmai').length;
  const tm = ht.filter(it => it.kind === 'thuongmai').length;
  const warns = s.warns.length ? ` Cảnh báo vượt dân số: ${s.warns.join(', ')}.` : '';
  return `${ht.length} hiện trạng (${noxh} NOXH, ${tm} thương mại), ${planItems.length} quy hoạch. Dân hiện trạng khoảng ${Math.round(s.apt).toLocaleString('vi-VN')} người. Quy hoạch không tính dân.${warns}`;
}

function paintBox() {
  const box = $('aptBox');
  if (box) box.style.display = on ? '' : 'none';
  const hint = $('aptHint');
  if (hint) hint.textContent = loaded ? `(${popItems().length + planItems.length})` : '';
  const sum = $('aptSummary');
  if (sum) sum.textContent = on && loaded ? summaryText() : '';
  const admin = $('aptAdmin');
  if (admin) admin.hidden = !isAdmin();
  const mode = $('aptMethod');
  if (mode && mode.value !== popMethod()) mode.value = popMethod();
  const c = popConfig();
  const hh = $('aptHh');
  const m2 = $('aptM2');
  const eff = $('aptEff');
  if (hh && document.activeElement !== hh) hh.value = String(c.hhSize);
  if (m2 && document.activeElement !== m2) m2.value = String(c.m2PerPerson);
  if (eff && document.activeElement !== eff) eff.value = String(c.efficiency);
}

function readCfg() {
  setPopConfig({
    hhSize: $('aptHh')?.value,
    m2PerPerson: $('aptM2')?.value,
    efficiency: $('aptEff')?.value
  });
  paintBox();
  if (on) draw();
}

function publishPop() {
  const wards = state.wardLabelsList || [];
  const items = assignNoxhWards(rawLive, wards);
  planItems = assignNoxhWards(rawPlan, wards);
  setPopData({ v: 1, hhSize: 3.3, items }, popWeights, faqQuestions);
}

async function load() {
  popWeights = await fetch('data/gba/pop-b.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const faq = await fetch('data/gba/pop-faq.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  faqQuestions = (faq && faq.questions) || [];
  let items = [];
  let plans = [];
  let fromSheet = false;
  try {
    const live = await fetch(geeApi('action=getNoxh')).then(r => (r.ok ? r.json() : null));
    if (live && live.source === 'sheet' && Array.isArray(live.items)) {
      fromSheet = true;
      items = live.items.filter(it => it.status !== 'quy_hoach');
      plans = live.items.filter(it => it.status === 'quy_hoach').map(asPlan);
    }
  } catch (e) { /* tab NOXH chưa deploy */ }
  if (!fromSheet) {
    const seed = await fetch('data/gba/apartments.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    const plan = await fetch('data/gba/noxh-plan.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    items = (seed && seed.items) || [];
    plans = (plan && plan.items) || [];
  }
  rawLive = items;
  rawPlan = plans;
  publishPop();
  loaded = true;
  paintBox();
  if (on) draw();
}

async function saveItem(it) {
  const status = $('aptStatus');
  if (!isAdmin()) return;
  if (status) status.textContent = 'Đang ghi sheet…';
  try {
    await postAdmin('saveNoxh', {
      items: [{
        id: it.id,
        name: it.name,
        detail: it.detail || '',
        ward: it.sheetWard != null ? it.sheetWard : (it.ward || ''),
        lat: it.lat,
        lng: it.lng,
        floors: it.floors,
        units: it.units,
        residents: it.residents,
        siteHa: it.siteHa,
        footprint: it.footprint,
        status: it.status || 'hien_trang',
        kind: it.kind || 'noxh',
        kindDetail: it.kindDetail,
        confidence: it.confidence,
        locateNote: it.locateNote,
        wkt: wktOf(it)
      }]
    });
    if (status) status.textContent = `Đã ghi ${it.name || it.id} lên tab NOXH.`;
  } catch (err) {
    if (status) status.textContent = err.message || 'Chưa ghi được tab NOXH. Dán Code.gs mới rồi Deploy phiên bản mới.';
  }
}

function onPopupSubmit(e) {
  const form = e.target.closest && e.target.closest('.apt-edit');
  if (!form) return;
  e.preventDefault();
  const it = popItems().find(row => row.id === form.dataset.apt);
  if (!it) return;
  const num = (name) => {
    const v = form.elements[name].value;
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  it.floors = num('floors');
  it.units = num('units');
  it.residents = num('residents');
  it.verified = !!form.elements.verified.checked;
  it.source = 'sheet';
  it.status = it.status || 'hien_trang';
  draw();
  paintBox();
  saveItem(it);
}

export function initApartmentLayer() {
  if (!map) return;
  restorePopMethod();
  if (!isAdmin() && popMethod() === 'old') setPopMethod('b');
  setWardPopHtml(name => {
    if (popMethod() !== 'b') return '';
    const text = wardPopNote(name);
    return text ? `<p class="apt-ward">${escapeHtml(text)}</p>` : '';
  });
  const syncFromCheckbox = () => {
    on = !!$('chk_c14')?.checked;
    if (on && !loaded) load().then(draw);
    else draw();
    paintBox();
  };
  $('chk_c14')?.addEventListener('change', syncFromCheckbox);
  $('btnToggleAllIcons')?.addEventListener('click', () => { setTimeout(syncFromCheckbox, 0); });
  $('aptMethod')?.addEventListener('change', (e) => {
    if (!isAdmin()) return;
    setPopMethod(e.target.value);
  });
  ['aptHh', 'aptM2', 'aptEff'].forEach(id => $(id)?.addEventListener('change', readCfg));
  let popNhaTimer = null;
  let popNhaBusy = false;
  function popNhaLines(data) {
    const lines = [data.message || data.state || 'Đã gửi.'];
    if (data.assets) {
      lines.push(`Bảng điểm: ${data.assets.table ? 'có' : 'chưa có'}. Ảnh Pixel-danso-nha: ${data.assets.image ? 'có' : 'chưa có'}.`);
    }
    if (data.assetsError) lines.push(`Chưa kiểm tra được asset: ${data.assetsError}`);
    (data.tasks || []).forEach(t => {
      const name = t.description || t.type || 'Tác vụ';
      lines.push(`${name}: ${t.state}${t.error ? ` — ${t.error}` : ''}`);
    });
    if (data.tasksError) lines.push(`Chưa đọc được danh sách tác vụ: ${data.tasksError}`);
    if (Number.isFinite(data.queued)) lines.push(`Trong 40 tác vụ gần nhất có ${data.queued} tác vụ đang chờ hoặc đang chạy.`);
    return lines.join('\n');
  }
  function armPopNhaPoll(data) {
    clearInterval(popNhaTimer);
    popNhaTimer = null;
    const live = data && (data.phase === 'table' || data.phase === 'image') && data.state !== 'FAILED' && data.state !== 'CANCELLED' && data.state !== 'ASSET_MISSING';
    if (!live) return;
    popNhaTimer = setInterval(() => askIngest('status'), 20000);
  }
  async function askIngest(mode) {
    if (popNhaBusy) return;
    popNhaBusy = true;
    const status = $('popNhaStatus');
    if (status && mode !== 'status') {
      status.textContent = mode === 'rebuild' ? 'Đang nạp lại từ CSV trên bucket…'
        : mode === 'cancel' ? 'Đang hủy tác vụ…'
        : mode === 'restart' ? 'Đang gửi lại tác vụ…'
        : 'Đang hỏi máy chủ…';
    }
    try {
      const data = await postAdmin('ingestPopNha', {
        rebuild: mode === 'rebuild',
        cancel: mode === 'cancel',
        restart: mode === 'restart'
      });
      if (status) status.textContent = popNhaLines(data);
      armPopNhaPoll(data);
    } catch (err) {
      if (status) status.textContent = err.message || 'Chưa nạp được raster nhà ở.';
      clearInterval(popNhaTimer);
      popNhaTimer = null;
    } finally {
      popNhaBusy = false;
    }
  }
  $('btnPopNha')?.addEventListener('click', () => askIngest('check'));
  $('btnPopNhaRebuild')?.addEventListener('click', () => askIngest('rebuild'));
  $('btnPopNhaRestart')?.addEventListener('click', () => askIngest('restart'));
  $('btnPopNhaCancel')?.addEventListener('click', () => askIngest('cancel'));
  $('aptKind')?.addEventListener('change', (e) => {
    kindFilter = e.target.value || '';
    if (on) draw();
  });
  $('btnPopNhaJump')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLayers' } }));
    document.querySelector('[data-map-tab="base"]')?.click();
    $('aptIngest')?.scrollIntoView({ block: 'center' });
  });
  document.addEventListener('submit', onPopupSubmit);
  document.addEventListener('auth:change', () => {
    if (!isAdmin() && popMethod() === 'old') setPopMethod('b');
    paintBox();
    if (on) draw();
    if (isAdmin()) askIngest('status');
  });
  if (isAdmin()) askIngest('status');
  window.addEventListener(POP_METHOD_EVENT, paintBox);
  window.addEventListener(WARD_BOUNDS_EVENT, () => {
    if (!loaded) return;
    publishPop();
    paintBox();
    if (on) draw();
  });
  load().catch(() => { /* file seed thiếu thì lớp trống */ });
}
