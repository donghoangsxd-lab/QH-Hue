// Lớp quy hoạch đang xem (droplist trên thanh tiêu đề). Mỗi lớp một luồng tương tác riêng; viewFlow.js định tuyến click
// bản đồ quy hoạch theo lớp đang chọn:
//  urban  Hệ thống đô thị (chk_urban)   bấm phường → chọn phường, sang QHPK như luồng cũ; ký hiệu đô thị trung tâm → QHC 1/10.000
//  qhc25  QHC 1/25.000 (chk_qhc25)       bấm vùng → chức năng khu vực; bấm bản đồ không đổi địa bàn
//  qhc10  QHC 1/10.000 (chk_qhc10)       thẻ Khu vực trung tâm: tra cứu lô, chọn phường lõi, chọn QHPK
//  qhpk   QHPK 1/2.000 (chk_projects)    bấm ranh / lô → đồ án; bấm nền khi nhìn rộng → chọn phường
//  qhct   QHCT 1/500 (chk_qhct)          bấm lô → thông tin lô (chờ dữ liệu)
// Chọn từ droplist: bật lớp đó, tắt 4 lớp còn lại. Bật thêm lớp ở panel Lớp dữ liệu để so sánh: lớp đang chọn giữ nguyên;
// lớp đang chọn bị tắt mà còn lớp khác bật thì chuyển sang lớp đó.
import { escapeHtml } from './utils.js';

export const LEVELS = [
  { id: 'urban', chk: 'chk_urban', label: 'Hệ thống đô thị', scale: 'QĐ 614 · QĐ 756', note: 'Phân loại đô thị, trình độ phát triển đô thị 40 phường, xã' },
  { id: 'qhc25', chk: 'chk_qhc25', label: 'QHC 1/25.000', scale: 'Toàn đô thị', note: 'Định hướng phát triển không gian toàn đô thị (QHC 2045)' },
  { id: 'qhc10', chk: 'chk_qhc10', label: 'QHC 1/10.000', scale: 'Khu vực trung tâm', note: 'Quy hoạch sử dụng đất khu vực đô thị trung tâm (QHC 2045)' },
  { id: 'qhpk', chk: 'chk_projects', label: 'QHPK 1/2.000', scale: 'Phân khu', note: 'Quy hoạch phân khu theo phường, xã' },
  { id: 'qhct', chk: 'chk_qhct', label: 'QHCT 1/500', scale: 'Chi tiết', note: 'Quy hoạch chi tiết, chưa có dữ liệu' }
];
export const DEFAULT_LEVEL = 'urban';
/** detail: { level, prev, origin } */
export const LEVEL_EVENT = 'qh:level';

const byId = new Map(LEVELS.map(l => [l.id, l]));
const byChk = new Map(LEVELS.map(l => [l.chk, l]));
let level = DEFAULT_LEVEL;
// Lớp đã chuyển sang lớp hiện tại (VD mở QHPK từ thẻ Khu vực trung tâm → 'qhc10') để thoát đồ án thì quay lại
let origin = null;
let applying = false;
let button = null;
let menu = null;

export const getLevel = () => level;
export const levelOrigin = () => origin;
export const levelChk = (id) => byId.get(id)?.chk || null;
const isOn = (id) => !!document.getElementById(id)?.checked;

function setChecked(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function emit(prev) {
  paint();
  document.dispatchEvent(new CustomEvent(LEVEL_EVENT, { detail: { level, prev, origin } }));
}

/** Chọn lớp: bật lớp này, tắt 4 lớp còn lại (gọi lại cùng lớp để đặt lại về chỉ một lớp). opts.origin: lớp chuyển sang */
export function setLevel(id, { origin: from = null } = {}) {
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
  emit(prev);
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
    button.title = `Lớp đang xem: ${cur.label} — ${cur.note}. Bấm để chọn lớp khác`;
    button.dataset.level = level;
  }
  if (!menu) return;
  menu.querySelectorAll('[data-level]').forEach(el => {
    const on = el.dataset.level === level;
    el.classList.toggle('is-sel', on);
    el.setAttribute('aria-selected', String(on));
    el.classList.toggle('is-on', isOn(byId.get(el.dataset.level).chk));
  });
}

function placeMenu() {
  const r = button.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.left = `${Math.round(Math.max(8, r.right - menu.offsetWidth))}px`;
}

function openMenu(on) {
  if (!menu || !button) return;
  menu.hidden = !on;
  button.setAttribute('aria-expanded', String(on));
  if (!on) return;
  paint();
  placeMenu();
  (menu.querySelector('.is-sel') || menu.querySelector('[data-level]'))?.focus();
}

function buildMenu() {
  menu = document.createElement('div');
  menu.className = 'level-menu';
  menu.id = 'mapLevelMenu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Chọn lớp quy hoạch');
  menu.hidden = true;
  menu.innerHTML = `<div class="level-menu-head">Lớp quy hoạch <small>chọn một lớp · so sánh nhiều lớp: bật ở panel Lớp dữ liệu</small></div>`
    + LEVELS.map((l, i) => `<button type="button" class="level-item" role="option" data-level="${l.id}" aria-selected="false">
        <span class="level-item-idx">${i + 1}</span>
        <span class="level-item-body"><b>${escapeHtml(l.label)}</b><small>${escapeHtml(l.note)}</small></span>
        <span class="level-item-scale">${escapeHtml(l.scale)}</span>
      </button>`).join('');
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-level]');
    if (!item) return;
    openMenu(false);
    setLevel(item.dataset.level);
    button.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[data-level]')];
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
    button.addEventListener('click', () => openMenu(menu.hidden));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) openMenu(false);
    });
    window.addEventListener('resize', () => { if (!menu.hidden) placeMenu(); });
  }
  document.addEventListener('change', onLayerChange);
  const first = LEVELS.find(l => isOn(l.chk));
  level = first ? first.id : DEFAULT_LEVEL;
  paint();
}
