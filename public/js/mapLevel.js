// Lớp quy hoạch đang xem (droplist trên thanh tiêu đề). Mỗi lớp một luồng tương tác riêng; viewFlow.js định tuyến click
// bản đồ quy hoạch theo lớp đang chọn (không lớp nào chọn phường từ bản đồ; chọn phường ở droplist bảng tổng hợp):
//  urban  Hệ thống đô thị (chk_urban)   bấm đô thị → nổi ranh + phạm vi đã có QHC / QHPK / QHCT (urbanFocus.js), bấm vùng
//                                        đồ án → chi tiết
//  qhc25  QHC 1/25.000 (chk_qhc25)       bấm vùng → chức năng khu vực; bấm bản đồ không đổi địa bàn
//  qhc10  QHC 1/10.000 (chk_qhc10)       ranh + tên các đồ án QHC, bấm đồ án mới hiện lô; ranh mở rộng QĐ 756,
//                                        QHPK lọc theo vùng lõi
//  qhpk   QHPK 1/2.000 (chk_projects)    ranh mọi đồ án; bấm ranh hoặc tick đồ án mới hiện lô.
//                                        Ranh điều chỉnh và QHCT chỉ khi đang mở một đồ án. Chọn phường: lô cả phường
//  qhct   QHCT 1/500 (chk_qhct)          ranh + tên các đồ án QHCT nhập, bấm đồ án → chi tiết; lô QHCT tĩnh (qhctLayer.js)
// Chọn từ droplist: bật lớp đó, tắt 4 lớp còn lại. Bật thêm lớp ở panel Lớp dữ liệu để so sánh: lớp đang chọn giữ nguyên;
// lớp đang chọn bị tắt mà còn lớp khác bật thì chuyển sang lớp đó.
import { escapeHtml, ico } from './utils.js';

export const LEVELS = [
  { id: 'urban', chk: 'chk_urban', label: 'HỆ THỐNG ĐÔ THỊ' },
  { id: 'qhc25', chk: 'chk_qhc25', label: 'QHC 1/25.000' },
  { id: 'qhc10', chk: 'chk_qhc10', label: 'QHC 1/10.000', scope: 'QHC' },
  { id: 'qhpk', chk: 'chk_projects', label: 'QHPK 1/2.000' },
  { id: 'qhct', chk: 'chk_qhct', label: 'QHCT 1/500', scope: 'QHCT' }
];
export const DEFAULT_LEVEL = 'urban';
/** detail: { level, prev, origin } */
export const LEVEL_EVENT = 'qh:level';

const byId = new Map(LEVELS.map(l => [l.id, l]));
const byChk = new Map(LEVELS.map(l => [l.chk, l]));
let level = DEFAULT_LEVEL;
// Lớp đã chuyển sang lớp hiện tại (VD mở QHPK khi đang xem QHC 1/10.000 → 'qhc10') để thoát đồ án thì quay lại
let origin = null;
let applying = false;
let button = null;
let menu = null;

export const getLevel = () => level;
export const levelOrigin = () => origin;
export const levelChk = (id) => byId.get(id)?.chk || null;
/** Cấp đồ án nhập (planLevelOf) hiện ranh theo lớp đang xem dù lớp QHPK (chk_projects) tắt; null = không có */
export const levelScope = () => byId.get(level)?.scope || null;
const isOn = (id) => !!document.getElementById(id)?.checked;

function setChecked(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function emit(prev, extra = {}) {
  paint();
  document.dispatchEvent(new CustomEvent(LEVEL_EVENT, { detail: { level, prev, origin, ...extra } }));
}

/** Chọn lớp: bật lớp này, tắt 4 lớp còn lại (gọi lại cùng lớp để đặt lại về chỉ một lớp).
 *  opts.origin: lớp chuyển sang. opts.keepView: droplist QHC 1/10.000 và 1/25.000 không phóng khung hình. */
export function setLevel(id, { origin: from = null, keepView = false } = {}) {
  const next = byId.get(id);
  if (!next) return;
  const prev = level;
  level = id;
  origin = from;
  applying = true;
  try {
    LEVELS.forEach(l => { if (l.id !== id) setChecked(l.chk, false); });
    setChecked(next.chk, true);
  } finally {
    applying = false;
  }
  emit(prev, keepView ? { keepView: true } : {});
}

function onLayerChange(e) {
  if (applying) return;
  const l = byChk.get(e.target?.id);
  if (!l) return;
  const prev = level;
  if (e.target.checked) {
    if (isOn(levelChk(level))) { paint(); return; }
    level = l.id;
  } else if (l.id === level) {
    const other = LEVELS.find(x => x.id !== level && isOn(x.chk));
    if (!other) { paint(); return; }
    level = other.id;
  } else {
    paint();
    return;
  }
  origin = null;
  emit(prev);
}

// ---------- Droplist ----------
function paint() {
  const cur = byId.get(level);
  document.body.dataset.level = level;
  if (button) {
    const text = button.querySelector('.map-title-level-text');
    if (text) text.textContent = cur.label;
    button.title = `Lớp đang xem: ${cur.label}. Bấm để chọn lớp khác`;
    button.dataset.level = level;
  }
  if (!menu) return;
  menu.querySelectorAll('[data-level]').forEach(el => {
    el.hidden = el.dataset.level === level;
    el.classList.toggle('is-on', isOn(byId.get(el.dataset.level).chk));
  });
}

// Nút giữ bề rộng của nhãn dài nhất: đổi lớp không làm nút (và menu thẳng hàng với nút) xê dịch
function fitButton() {
  const text = button?.querySelector('.map-title-level-text');
  if (!text) return;
  const cur = text.textContent;
  text.style.minWidth = '';
  const widest = Math.max(...LEVELS.map(l => { text.textContent = l.label; return text.scrollWidth; }));
  text.textContent = cur;
  const cap = parseFloat(getComputedStyle(text).maxWidth) || Infinity;
  text.style.minWidth = `${Math.ceil(Math.min(widest, cap))}px`;
}

// Cùng điều kiện với khối điện thoại trong style.css. Máy tính (chuột, cửa sổ hẹp) giữ menu trùng mép nút.
const PHONE_LAYOUT = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 500px) and (max-width: 1200px))');

// Desktop: menu trùng mép trái / phải với nút. Điện thoại: nút chỉ còn icon nên menu rộng bằng chữ, không cắt nhãn.
function placeMenu() {
  const r = button.getBoundingClientRect();
  const icon = button.querySelector('.ico');
  const inset = menu.clientLeft + parseFloat(getComputedStyle(menu).paddingLeft);
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  if (!PHONE_LAYOUT.matches) {
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.width = `${Math.round(r.width)}px`;
    menu.style.maxWidth = '';
  } else {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const items = [...menu.querySelectorAll('.level-item')];
    const hidden = items.map(el => el.hidden);
    items.forEach(el => { el.hidden = false; });
    menu.style.width = 'max-content';
    menu.style.maxWidth = 'none';
    items.forEach(el => {
      el.style.width = 'max-content';
      el.style.overflow = 'visible';
    });
    menu.querySelectorAll('.level-item span').forEach(el => {
      el.style.overflow = 'visible';
      el.style.minWidth = 'max-content';
    });
    const need = menu.scrollWidth;
    menu.querySelectorAll('.level-item, .level-item span').forEach(el => {
      el.style.width = '';
      el.style.overflow = '';
      el.style.minWidth = '';
    });
    items.forEach((el, i) => { el.hidden = hidden[i]; });
    const width = Math.min(Math.max(need, Math.round(r.width)), Math.max(160, vw - 16));
    menu.style.width = `${width}px`;
    let left = Math.round(r.right - width);
    if (left < 8) left = 8;
    if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
    menu.style.left = `${left}px`;
  }
  if (icon) menu.style.setProperty('--level-indent', `${Math.max(0, Math.round(icon.getBoundingClientRect().left - r.left - inset))}px`);
}

function openMenu(on) {
  if (!menu || !button) return;
  menu.hidden = !on;
  button.setAttribute('aria-expanded', String(on));
  if (!on) return;
  paint();
  placeMenu();
  menu.querySelector('[data-level]:not([hidden])')?.focus();
}

function buildMenu() {
  menu = document.createElement('div');
  menu.className = 'level-menu';
  menu.id = 'mapLevelMenu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Chọn lớp quy hoạch');
  menu.hidden = true;
  menu.innerHTML = LEVELS.map(l => `<button type="button" class="level-item${l.pending ? ' is-pending' : ''}" role="option" data-level="${l.id}"${l.pending ? ' title="Chưa có dữ liệu"' : ''}>${ico('layers')}<span>${escapeHtml(l.label)}</span></button>`).join('');
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-level]');
    if (!item) return;
    openMenu(false);
    setLevel(item.dataset.level, { keepView: item.dataset.level === 'qhc10' || item.dataset.level === 'qhc25' });
    button.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[data-level]:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { openMenu(false); button.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
  });
}

export function initMapLevel() {
  button = document.getElementById('btnMapLevel');
  if (button) {
    buildMenu();
    fitButton();
    document.fonts?.ready.then(fitButton);
    button.addEventListener('click', () => openMenu(menu.hidden));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) openMenu(false);
    });
    window.addEventListener('resize', () => { fitButton(); if (!menu.hidden) placeMenu(); });
  }
  document.addEventListener('change', onLayerChange);
  const first = LEVELS.find(l => isOn(l.chk));
  level = first ? first.id : DEFAULT_LEVEL;
  paint();
}
