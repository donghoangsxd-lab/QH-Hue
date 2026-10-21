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

let on = false;
let groupL = null;
let groupR = null;
let loaded = false;

function isAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

function icon(conf) {
  const tone = conf === 'high' ? '#6d28d9' : conf === 'medium' ? '#7c3aed' : '#a78bfa';
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
    ['Độ tin cậy', CONF[it.confidence] || it.confidence],
    ['Nguồn', it.source],
    ['Dấu chân', it.footprint ? `${Math.round(it.footprint).toLocaleString('vi-VN')} m²` : ''],
    ['Số tầng', it.floors || ''],
    ['Số căn', it.units || ''],
    ['Dân đã ghi', it.residents || ''],
    ['Cách tính', howLabel(row.how)],
    ['Xác minh', it.verified ? 'Đã xác minh' : 'Ứng viên']
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

function draw() {
  groupL?.remove();
  groupR?.remove();
  groupL = L.layerGroup();
  groupR = L.layerGroup();
  if (!on) return;
  popItems().forEach(it => {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) return;
    const opt = { icon: icon(it.confidence), bubblingMouseEvents: false };
    const left = L.marker([it.lat, it.lng], opt).bindPopup(() => popupHtml(it), { maxWidth: 280 });
    const right = L.marker([it.lat, it.lng], opt).bindPopup(() => popupHtml(it), { maxWidth: 280 });
    groupL.addLayer(left);
    groupR.addLayer(right);
  });
  if (map) groupL.addTo(map);
  if (planMap) groupR.addTo(planMap);
}

function summaryText() {
  const s = cityApartmentSummary();
  const warns = s.warns.length ? ` Cảnh báo vượt dân số: ${s.warns.join(', ')}.` : '';
  return `${s.n} ứng viên, ${s.verified} đã xác minh, ${s.estimated} có số dân, ${s.missing} còn thiếu số tầng.${warns}`;
}

function paintBox() {
  const box = $('aptBox');
  if (box) box.style.display = on ? '' : 'none';
  const hint = $('aptHint');
  if (hint) hint.textContent = loaded ? '' : '';
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
  draw();
}

async function load() {
  const seed = await fetch('data/gba/apartments.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('seed')))).catch(() => null);
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
  $('aptMethod')?.addEventListener('change', (e) => {
    if (!isAdmin()) return;
    setPopMethod(e.target.value);
  });
  ['aptHh', 'aptM2', 'aptEff'].forEach(id => $(id)?.addEventListener('change', readCfg));
  $('btnPopNha')?.addEventListener('click', async () => {
    const status = $('popNhaStatus');
    if (status) status.textContent = 'Đang hỏi máy chủ…';
    try {
      const data = await postAdmin('ingestPopNha', {});
      if (status) status.textContent = data.message || data.state || 'Đã gửi.';
    } catch (err) {
      if (status) status.textContent = err.message || 'Chưa nạp được raster nhà ở.';
    }
  });
  document.addEventListener('submit', onPopupSubmit);
  document.addEventListener('auth:change', () => {
    if (!isAdmin() && popMethod() === 'old') setPopMethod('b');
    paintBox();
    if (on) draw();
  });
  window.addEventListener(POP_METHOD_EVENT, paintBox);
  load().catch(() => { /* file seed thiếu thì lớp trống */ });
}
