// Lớp 14. Chung cư: mỗi dòng tab 14-NOXH là giọt nước cùng kiểu Noxh.svg.
// Polygon lấy tâm; multipolygon lấy điểm nằm trên mặt. Ranh lô chỉ hiện khi bấm điểm.
// Bật hay tắt lớp không đổi gói dân đưa vào setPopData.
import { map, WARD_BOUNDS_EVENT } from './mapEngine.js';
import { assignNoxhWards } from './noxhWard.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, ico } from './utils.js';
import { postAdmin } from './wardRoads.js';
import { setWardPopHtml } from './uiComponents.js';
import {
  POP_METHOD_EVENT, apartmentPopulation, popConfig, popItems, popMethod,
  restorePopMethod, setPopConfig, setPopData, setPopMethod, cityApartmentSummary, wardPopNote
} from './popMethod.js';

const $ = (id) => document.getElementById(id);
const CONF = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
const KIND = { noxh: 'Nhà ở xã hội', thuongmai: 'Thương mại' };
const DROP = 'M35 2C16.8 2 2 16.8 2 35c0 21 24 41 31 57a2.2 2.2 0 004 0c7-16 31-36 31-57C68 16.8 53.2 2 35 2z';
const HOUSE = 'M35 14L14 32h6v18h30V32h6z';
const PIN = { noxh: ['#144677', '#0d2f52'], thuongmai: ['#0369a1', '#075985'] };

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
const aptOpen = new Set();
const aptHidden = new Set();
const aptMarkers = new Map();
let aptPicked = '';

function isAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

function pinOf(it) {
  return PIN[it && it.kind === 'thuongmai' ? 'thuongmai' : 'noxh'];
}

function dropletSvg(kind, plan) {
  const [pin, edge] = PIN[kind === 'thuongmai' ? 'thuongmai' : 'noxh'];
  const dash = plan ? ' stroke-dasharray="14 8"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 96" class="apt-drop" aria-hidden="true">
    <path d="${DROP}" fill="${plan ? '#ffffff' : pin}" stroke="${plan ? pin : edge}" stroke-width="${plan ? 4.5 : 1.5}"${dash}/>
    <circle cx="35" cy="35" r="26" fill="${plan ? 'none' : '#fff'}" ${plan ? `stroke="${pin}" stroke-width="2.5" stroke-dasharray="7 5"` : ''}/>
    <path d="${HOUSE}" fill="#fab005" stroke="#c77c02" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="24" y="35" width="7" height="6" fill="#fff"/>
    <rect x="39" y="35" width="7" height="6" fill="#fff"/>
    <rect x="31.5" y="42" width="7" height="8" fill="#7a4a00"/>
  </svg>`;
}

function markerIcon(it) {
  const plan = it.status === 'quy_hoach';
  return L.divIcon({
    className: 'apt-pin',
    html: dropletSvg(it.kind, plan),
    iconSize: [22, 30],
    iconAnchor: [11, 30]
  });
}

function markerLatLng(it) {
  const g = it && it.geometry;
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && typeof turf !== 'undefined') {
    try {
      const feature = turf.feature(g);
      const pt = g.type === 'MultiPolygon' ? turf.pointOnFeature(feature) : turf.centroid(feature);
      const [lng, lat] = pt.geometry.coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    } catch (e) { /* điểm sheet */ }
  }
  const lat = Number(it && it.lat);
  const lng = Number(it && it.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  return null;
}

function paintLegend() {
  document.querySelectorAll('.apt-mark').forEach(el => {
    if (el.dataset.drawn) return;
    el.innerHTML = dropletSvg(el.dataset.kind, el.dataset.plan === '1');
    el.dataset.drawn = '1';
  });
}

function yearOf(it) {
  return String(it.year || it.nam || '').trim();
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

function clearFoot(group) {
  if (!group || !group._aptFoot) return;
  group.removeLayer(group._aptFoot);
  group._aptFoot = null;
}

function showFoot(group, it) {
  clearFoot(group);
  if (!it.geometry) return;
  const plan = it.status === 'quy_hoach';
  const [color] = pinOf(it);
  const layer = L.geoJSON(it.geometry, {
    interactive: false,
    style: {
      color,
      weight: 2,
      dashArray: plan ? '6 4' : null,
      fillColor: color,
      fillOpacity: 0.22
    }
  });
  group.addLayer(layer);
  layer.eachLayer(path => path.getElement()?.classList.add('apt-foot'));
  group._aptFoot = layer;
}

function addSite(group, it) {
  const latlng = markerLatLng(it);
  if (!latlng) return;
  const marker = L.marker(latlng, { icon: markerIcon(it), bubblingMouseEvents: false, zIndexOffset: 400 });
  marker.bindPopup(() => popupHtml(it), { maxWidth: 300 });
  marker.on('popupopen', () => showFoot(group, it));
  marker.on('popupclose', () => clearFoot(group));
  group.addLayer(marker);
  if (group === groupL) aptMarkers.set(it.id, marker);
}

function draw() {
  groupL?.remove();
  groupR?.remove();
  planL?.remove();
  planR?.remove();
  planL = null;
  planR = null;
  aptMarkers.clear();
  groupL = L.layerGroup();
  groupR = L.layerGroup();
  if (!on) return;
  [...popItems(), ...planItems].filter(it => passesKind(it) && !aptHidden.has(it.id)).forEach(it => {
    addSite(groupL, it);
    addSite(groupR, it);
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

function dossierHtml(rows) {
  const body = rows.filter(([, value]) => String(value || '').trim()).map(([label, value]) =>
    `<div class="project-dossier-row"><span class="project-dossier-label">${escapeHtml(label)}</span><span class="project-dossier-meta">${escapeHtml(String(value))}</span></div>`
  ).join('');
  return body ? `<div class="project-dossier">${body}</div>` : '';
}

function aptCatalog() {
  return [...popItems(), ...planItems].filter(passesKind)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
}

function aptDetail(it) {
  const plan = it.status === 'quy_hoach';
  const row = apartmentPopulation(it, popConfig());
  const recorded = Number(it.residents);
  const dan = plan
    ? (Number.isFinite(recorded) && recorded > 0 ? Math.round(recorded) : null)
    : (row.how === 'thieu' ? null : Math.round(row.pop));
  const scale = [
    it.units ? `${it.units} căn` : '',
    it.floors ? `${it.floors} tầng` : '',
    it.siteHa ? `${it.siteHa} ha` : ''
  ].filter(Boolean).join(', ');
  return [
    ['Địa điểm', it.ward],
    ['Loại', KIND[it.kind] || it.kindDetail || ''],
    ['Quy mô', scale],
    ['Dân số', dan != null ? `${dan.toLocaleString('vi-VN')} người` : ''],
    ['Năm xây dựng', yearOf(it)],
    ['Trạng thái', plan ? 'Quy hoạch' : 'Hiện trạng'],
    ['Độ tin cậy', CONF[it.confidence] || ''],
    ['Ghi chú', it.locateNote || it.detail || '']
  ];
}

function aptRow(it, n) {
  const id = escapeHtml(it.id);
  const open = aptOpen.has(it.id);
  const shown = !aptHidden.has(it.id);
  const rows = aptDetail(it);
  const blob = [it.name, ...rows.map(([, v]) => v)].filter(Boolean).join(' ');
  return `<div class="project-row${shown ? '' : ' is-off'}${it.id === aptPicked ? ' is-picked' : ''}" data-dt-text="${escapeHtml(blob)}">
      <label class="project-name" title="${escapeHtml(it.name || '')}">
        <input type="checkbox" data-apt="${id}"${shown ? ' checked' : ''} title="Hiện công trình trên bản đồ"><span data-apt-focus="${id}">${n}. ${escapeHtml(it.name || it.id)}</span></label>
      <span class="project-tools">
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-apt-expand="${id}" title="${open ? 'Ẩn' : 'Xem'} thông tin công trình" aria-label="Thông tin công trình" aria-expanded="${open}">${ico('chev-down')}</button>
      </span>
    </div>${open ? dossierHtml(rows) : ''}`;
}

function paintAptList() {
  const host = $('aptList');
  if (!host) return;
  const scroller = $('dtList');
  const y = scroller?.scrollTop || 0;
  const items = aptCatalog();
  host.innerHTML = items.length
    ? items.map((it, i) => aptRow(it, i + 1)).join('')
    : (loaded ? '<div class="project-empty">Chưa có đồ án.</div>' : '');
  if (scroller) scroller.scrollTop = y;
}

function focusApt(id) {
  const it = [...popItems(), ...planItems].find(item => item.id === id);
  if (!it) return;
  aptHidden.delete(id);
  aptOpen.add(id);
  aptPicked = id;
  const go = () => {
    paintAptList();
    const ll = markerLatLng(it);
    if (map && ll) map.flyTo(ll, Math.max(map.getZoom(), 17));
    aptMarkers.get(id)?.openPopup();
  };
  const box = $('chk_c14');
  if (box && !box.checked) {
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(go, 0);
    return;
  }
  if (on) draw();
  go();
}

function paintBox() {
  const box = $('aptBox');
  if (box) box.style.display = on ? '' : 'none';
  const hint = $('aptHint');
  if (hint) hint.textContent = loaded ? `(${popItems().length + planItems.length})` : '';
  const sum = $('aptSummary');
  if (sum) sum.textContent = on && loaded ? summaryText() : '';
  const mode = $('aptMethod');
  if (mode && mode.value !== popMethod()) mode.value = popMethod();
  const c = popConfig();
  const hh = $('aptHh');
  const m2 = $('aptM2');
  const eff = $('aptEff');
  if (hh && document.activeElement !== hh) hh.value = String(c.hhSize);
  if (m2 && document.activeElement !== m2) m2.value = String(c.m2PerPerson);
  if (eff && document.activeElement !== eff) eff.value = String(c.efficiency);
  paintAptList();
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
  paintLegend();
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
  let popNhaWatchTimer = null;
  let popNhaBusy = false;
  const POP_NHA_LIVE = new Set(['READY', 'RUNNING', 'UNKNOWN', 'STARTING']);
  function paintPopNhaLive(data) {
    const el = $('popNhaLive');
    if (!el) return;
    const show = data && (data.phase === 'table' || data.phase === 'image') && POP_NHA_LIVE.has(data.state);
    el.hidden = !show;
    el.textContent = show ? 'Đang cập nhật dữ liệu dân số…' : '';
  }
  function armPopNhaWatch() {
    if (popNhaWatchTimer || !isAdmin()) return;
    popNhaWatchTimer = setInterval(() => askIngest('watch'), 60000);
  }
  function stopPopNhaWatch() {
    clearInterval(popNhaWatchTimer);
    popNhaWatchTimer = null;
    const el = $('popNhaLive');
    if (el) { el.hidden = true; el.textContent = ''; }
  }
  async function askIngest(mode) {
    if (mode !== 'watch' || popNhaBusy) return;
    popNhaBusy = true;
    try {
      const data = await postAdmin('ingestPopNha', { watch: true });
      paintPopNhaLive(data);
    } catch (err) { /* dòng trạng thái chỉ hiện khi máy chủ trả về */ }
    finally { popNhaBusy = false; }
  }
  $('aptKind')?.addEventListener('change', (e) => {
    kindFilter = e.target.value || '';
    paintAptList();
    if (on) draw();
  });
  $('aptList')?.addEventListener('click', (e) => {
    const expand = e.target.closest('[data-apt-expand]');
    if (expand) {
      const id = expand.dataset.aptExpand;
      if (aptOpen.has(id)) aptOpen.delete(id);
      else aptOpen.add(id);
      paintAptList();
      return;
    }
    const focus = e.target.closest('[data-apt-focus]');
    if (focus) {
      e.preventDefault();
      focusApt(focus.dataset.aptFocus);
    }
  });
  $('aptList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-apt]');
    if (!box) return;
    const id = box.dataset.apt;
    if (box.checked) aptHidden.delete(id);
    else aptHidden.add(id);
    box.closest('.project-row')?.classList.toggle('is-off', !box.checked);
    if (box.checked && !$('chk_c14')?.checked) {
      $('chk_c14').checked = true;
      $('chk_c14').dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (on) draw();
  });
  document.addEventListener('submit', onPopupSubmit);
  document.addEventListener('auth:change', () => {
    if (!isAdmin() && popMethod() === 'old') setPopMethod('b');
    paintBox();
    if (on) draw();
    if (isAdmin()) {
      armPopNhaWatch();
      askIngest('watch');
    } else {
      stopPopNhaWatch();
    }
  });
  if (isAdmin()) {
    armPopNhaWatch();
    askIngest('watch');
  }
  window.addEventListener(POP_METHOD_EVENT, paintBox);
  window.addEventListener(WARD_BOUNDS_EVENT, () => {
    if (!loaded) return;
    publishPop();
    paintBox();
    if (on) draw();
  });
  load().catch(() => { /* file seed thiếu thì lớp trống */ });
}
