// Lớp chung cư: icon riêng, dân số tách khỏi nhà thấp tầng. Admin sửa số và ghi tab sheet Chung cư.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, ico } from './utils.js';
import { postAdmin } from './wardRoads.js';
import { setWardPopHtml } from './uiComponents.js';
import {
  POP_METHOD_EVENT, apartmentPopulation, howLabel, popConfig, popItems, popMethod,
  restorePopMethod, setPopConfig, setPopData, setPopMethod, cityApartmentSummary, wardPopNote
} from './popMethod.js';

const $ = (id) => document.getElementById(id);
const CONF = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
const SOURCE = { noxh: 'Danh sách nhà ở xã hội', sheet: 'Tab Chung cư', manual: 'Bổ sung', thuongmai: 'Chung cư thương mại' };
const EXIST_STYLE = { color: '#ddd6fe', weight: 2, fillColor: '#6d28d9', fillOpacity: 0.35 };
const PLAN_STYLE = { color: '#fbbf24', weight: 2, dashArray: '6 4', fillColor: '#f59e0b', fillOpacity: 0.16 };

let on = false;
let planOn = false;
let groupL = null;
let groupR = null;
let planL = null;
let planR = null;
let loaded = false;
let planItems = [];

function isAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
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

function popupHtml(it) {
  const row = apartmentPopulation(it, popConfig());
  const people = row.how === 'thieu' ? 'Chưa tính được' : `${Math.round(row.pop).toLocaleString('vi-VN')} người`;
  const bits = [
    ['Phường, xã', it.ward],
    ['Tình trạng', it.detail || 'Đã hoàn thành'],
    ['Căn cứ', it.evidence || ''],
    ['Nguồn', SOURCE[it.source] || it.source],
    ['Độ tin cậy', CONF[it.confidence] || it.confidence],
    ['Diện tích khu', it.siteHa ? `${it.siteHa} ha` : ''],
    ['Dấu chân nhà', it.footprint ? `${Math.round(it.footprint).toLocaleString('vi-VN')} m²` : ''],
    ['Số tầng', it.floors || ''],
    ['Số căn', it.units || ''],
    ['Dân đã ghi', it.residents || ''],
    ['Cách tính', howLabel(row.how)],
    ['Xác minh', it.verified ? 'Đã xác minh' : 'Chưa xác minh']
  ].filter((pair) => pair[1]);
  const edit = isAdmin() ? `<form class="apt-edit" data-apt="${escapeHtml(it.id)}">
      <label>Số tầng <input name="floors" type="number" min="1" max="80" value="${it.floors || ''}"></label>
      <label>Số căn <input name="units" type="number" min="0" step="1" value="${it.units || ''}"></label>
      <label>Số dân <input name="residents" type="number" min="0" step="1" value="${it.residents || ''}"></label>
      <label class="apt-check"><input name="verified" type="checkbox"${it.verified ? ' checked' : ''}> Đã xác minh</label>
      <button type="submit">Ghi tab Chung cư</button>
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
  groupL = L.layerGroup();
  groupR = L.layerGroup();
  if (!on) return;
  popItems().forEach(it => {
    const html = () => popupHtml(it);
    addSite(groupL, it, EXIST_STYLE, html, false);
    addSite(groupR, it, EXIST_STYLE, html, false);
  });
  if (map) groupL.addTo(map);
  if (planMap) groupR.addTo(planMap);
}

function planHtml(it) {
  const bits = [
    ['Phường, xã', it.ward],
    ['Tình trạng', it.detail || 'Quy hoạch'],
    ['Diện tích', it.siteHa ? `${it.siteHa} ha` : ''],
    ['Số tầng', it.floors || ''],
    ['Số căn', it.units || ''],
    ['Dân số ghi trong bảng', it.plannedPop || '']
  ].filter((pair) => pair[1]);
  const warn = it.uncertain ? '<p>Số liệu chưa chắc vì cột trong bảng gốc bị lệch.</p>' : '';
  return `<div class="apt-pop"><b>${escapeHtml(it.name || 'Nhà ở xã hội')}</b><div class="apt-pop-n">Quy hoạch — không tính dân hiện trạng</div>
    ${warn}<dl>${bits.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl></div>`;
}

function drawPlan() {
  planL?.remove();
  planR?.remove();
  planL = L.layerGroup();
  planR = L.layerGroup();
  if (!planOn) return;
  planItems.forEach(it => {
    const html = () => planHtml(it);
    addSite(planL, it, PLAN_STYLE, html, true);
    addSite(planR, it, PLAN_STYLE, html, true);
  });
  if (map) planL.addTo(map);
  if (planMap) planR.addTo(planMap);
}

function summaryText() {
  const s = cityApartmentSummary();
  const warns = s.warns.length ? ` Cảnh báo vượt dân số: ${s.warns.join(', ')}.` : '';
  return `${s.n} chung cư hiện trạng, khoảng ${Math.round(s.apt).toLocaleString('vi-VN')} người.${warns}`;
}

function planSummaryText() {
  const unsure = planItems.filter(it => it.uncertain).length;
  const tail = unsure ? ` ${unsure} khu có số liệu chưa chắc.` : '';
  return `${planItems.length} khu chưa hoàn thành, không tính vào dân hiện trạng.${tail}`;
}

function paintBox() {
  const box = $('aptBox');
  if (box) box.style.display = on ? '' : 'none';
  const hint = $('aptHint');
  if (hint) hint.textContent = loaded ? '' : '';
  const sum = $('aptSummary');
  if (sum) sum.textContent = on && loaded ? summaryText() : '';
  const planBox = $('noxhPlanBox');
  if (planBox) planBox.style.display = planOn ? '' : 'none';
  const planSum = $('noxhPlanSummary');
  if (planSum) planSum.textContent = planOn && loaded ? planSummaryText() : '';
  const planHint = $('noxhPlanHint');
  if (planHint) planHint.textContent = loaded && planItems.length ? `(${planItems.length})` : '';
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
  draw();
}

async function load() {
  const seed = await fetch('data/gba/apartments.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('seed')))).catch(() => null);
  const plan = await fetch('data/gba/noxh-plan.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  planItems = (plan && plan.items) || [];
  const weights = await fetch('data/gba/pop-b.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const faq = await fetch('data/gba/pop-faq.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  let items = (seed && seed.items) || [];
  try {
    const live = await fetch(geeApi('action=getChungCu')).then(r => (r.ok ? r.json() : null));
    if (live && Array.isArray(live.items) && live.items.length) {
      const by = new Map(items.map(it => [it.id, { ...it }]));
      live.items.forEach(it => {
        if (!it || !it.id) return;
        by.set(it.id, { ...(by.get(it.id) || {}), ...it });
      });
      items = [...by.values()];
    }
  } catch (e) { /* sheet chưa có trên máy chủ */ }
  setPopData(seed ? { ...seed, items } : { v: 1, items }, weights, faq && faq.questions);
  loaded = true;
  paintBox();
  if (on) draw();
  if (planOn) drawPlan();
}

async function saveItem(it) {
  const status = $('aptStatus');
  if (!isAdmin()) return;
  if (status) status.textContent = 'Đang ghi sheet…';
  try {
    await postAdmin('saveChungCu', { items: [it] });
    if (status) status.textContent = `Đã ghi ${it.id} lên tab Chung cư.`;
  } catch (err) {
    if (status) status.textContent = err.message || 'Chưa ghi được sheet. Deploy Code.gs mới rồi thử lại.';
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
  it.source = it.source || 'sheet';
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
  $('chk_apt')?.addEventListener('change', (e) => {
    on = !!e.target.checked;
    if (on && !loaded) load().then(draw);
    else draw();
    paintBox();
  });
  $('chk_noxhPlan')?.addEventListener('change', (e) => {
    planOn = !!e.target.checked;
    if (planOn && !loaded) load().then(drawPlan);
    else drawPlan();
    paintBox();
  });
  $('aptMethod')?.addEventListener('change', (e) => {
    if (!isAdmin()) return;
    setPopMethod(e.target.value);
  });
  ['aptHh', 'aptM2', 'aptEff'].forEach(id => $(id)?.addEventListener('change', readCfg));
  async function askIngest(rebuild) {
    const status = $('popNhaStatus');
    if (status) status.textContent = rebuild ? 'Đang nạp lại từ CSV trên bucket…' : 'Đang hỏi máy chủ…';
    try {
      const data = await postAdmin('ingestPopNha', rebuild ? { rebuild: true } : {});
      if (status) status.textContent = data.message || data.state || 'Đã gửi.';
    } catch (err) {
      if (status) status.textContent = err.message || 'Chưa nạp được raster nhà ở.';
    }
  }
  $('btnPopNha')?.addEventListener('click', () => askIngest(false));
  $('btnPopNhaRebuild')?.addEventListener('click', () => askIngest(true));
  document.addEventListener('submit', onPopupSubmit);
  document.addEventListener('auth:change', () => {
    if (!isAdmin() && popMethod() === 'old') setPopMethod('b');
    paintBox();
    if (on) draw();
    if (planOn) drawPlan();
  });
  window.addEventListener(POP_METHOD_EVENT, paintBox);
  load().catch(() => { /* file seed thiếu thì lớp trống */ });
}
