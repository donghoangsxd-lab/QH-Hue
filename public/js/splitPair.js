// Cặp so sánh khi chia đôi màn hình. Mặc định trái = hiện trạng, phải = quy hoạch (công trình) — đúng cách
// chia đôi cũ. Hai droplist trên thanh tiêu đề chọn linh hoạt từng bên: hiện trạng, quy hoạch, hoặc một cấp
// QH (hệ thống đô thị, QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500). Cấp đang chọn ở một bên
// bị loại khỏi droplist bên kia. Đổi cấp không đụng ô lớp ở panel.
import { isSplitOn, onViewChange, planMap } from './planMap.js';
import { LEVELS } from './mapLevel.js';

export const SPLIT_PAIR_EVENT = 'qh:split-pair';

export const PAIR_OPTIONS = [
  { id: 'ht', label: 'HIỆN TRẠNG', swipe: 'BẢN ĐỒ HIỆN TRẠNG' },
  { id: 'qh', label: 'QUY HOẠCH', swipe: 'BẢN ĐỒ QUY HOẠCH' },
  ...LEVELS.map(l => ({ id: l.id, label: l.label, swipe: l.label }))
];

const KEY = 'qh_split_pair';
const CLASSIC_TITLE = 'SO SÁNH HIỆN TRẠNG – QUY HOẠCH THÀNH PHỐ HUẾ';
const byId = new Map(PAIR_OPTIONS.map(o => [o.id, o]));
let leftMap = null;
let sides = { left: 'ht', right: 'qh' };
let wasSplit = false;
const listeners = [];

export const getSplitSides = () => ({ left: sides.left, right: sides.right });
export const pairOption = (id) => byId.get(id) || null;
export const pairLabel = (id) => byId.get(id)?.label || '';

/** true khi chia đôi và ít nhất một bên không còn là cặp hiện trạng | quy hoạch công trình */
export function isLevelPair() {
  return isSplitOn() && (sides.left !== 'ht' || sides.right !== 'qh');
}

/** Cấp đang giao cho bản đồ m khi đang chia đôi; null nếu không phải hai bản đồ của khung so sánh */
export function sideOf(m) {
  if (!isSplitOn() || !m) return null;
  if (m === planMap) return sides.right;
  if (m === leftMap) return sides.left;
  return null;
}

/**
 * Bản đồ phải vẽ cấp id.
 * null = không ép (giữ logic ô lớp). Mảng (có thể rỗng) = chỉ những bản đồ này.
 */
export function mapsForLevel(id) {
  if (!isLevelPair()) return null;
  const out = [];
  if (sides.left === id && leftMap) out.push(leftMap);
  if (sides.right === id && planMap) out.push(planMap);
  return out;
}

export function onSplitPair(fn) { listeners.push(fn); }

function emit() {
  const detail = { left: sides.left, right: sides.right, levelPair: isLevelPair() };
  listeners.forEach(fn => { try { fn(detail); } catch (err) { console.warn('split-pair:', err); } });
  document.dispatchEvent(new CustomEvent(SPLIT_PAIR_EVENT, { detail }));
}

function loadSides() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '');
    if (saved && byId.has(saved.left) && byId.has(saved.right)) sides = { left: saved.left, right: saved.right };
  } catch (e) { /* chưa lưu hoặc trình duyệt chặn */ }
  if (sides.left === sides.right) {
    const next = PAIR_OPTIONS.find(o => o.id !== sides.left);
    if (next) sides = { ...sides, right: next.id };
  }
}

function saveSides() {
  try { localStorage.setItem(KEY, JSON.stringify(sides)); } catch (e) { /* chế độ riêng tư */ }
}

export function setSplitSide(which, id) {
  const other = which === 'left' ? sides.right : sides.left;
  if ((which !== 'left' && which !== 'right') || !byId.has(id) || id === other || sides[which] === id) return;
  sides = { ...sides, [which]: id };
  saveSides();
  paint();
  emit();
}

function paint() {
  const box = document.getElementById('splitPair');
  const on = isSplitOn();
  if (box) box.hidden = !on;
  document.body.classList.toggle('level-pair', isLevelPair());
  ['left', 'right'].forEach(which => {
    const sel = document.getElementById(which === 'left' ? 'splitSideLeft' : 'splitSideRight');
    if (sel) fillSelect(sel, which);
  });
  const leftLabel = document.querySelector('.swipe-label-left');
  const rightLabel = document.querySelector('.swipe-label-right');
  if (leftLabel) leftLabel.textContent = byId.get(sides.left)?.swipe || '';
  if (rightLabel) rightLabel.textContent = byId.get(sides.right)?.swipe || '';
  const text = document.getElementById('mapTitleText');
  if (text && on) {
    const title = isLevelPair()
      ? `SO SÁNH ${pairLabel(sides.left)} – ${pairLabel(sides.right)}`
      : CLASSIC_TITLE;
    text.textContent = title;
    text.title = title;
  }
}

// Bên kia đang giữ cấp nào thì droplist này không còn mục đó (không so sánh một lớp với chính nó)
function fillSelect(el, which) {
  const other = which === 'left' ? sides.right : sides.left;
  const cur = sides[which];
  el.innerHTML = PAIR_OPTIONS.filter(o => o.id !== other).map(o => `<option value="${o.id}">${o.label}</option>`).join('');
  el.value = cur;
}

function buildSelect(id, which, label) {
  const el = document.createElement('select');
  el.id = id;
  el.className = `split-side-select split-side-${which}`;
  el.setAttribute('aria-label', label);
  el.title = label;
  fillSelect(el, which);
  el.addEventListener('change', () => setSplitSide(which, el.value));
  return el;
}

export function initSplitPair(map) {
  leftMap = map;
  loadSides();
  const host = document.querySelector('.map-title-split');
  if (host && !document.getElementById('splitPair')) {
    const box = document.createElement('div');
    box.className = 'map-title-pair';
    box.id = 'splitPair';
    box.hidden = true;
    box.append(
      buildSelect('splitSideLeft', 'left', 'Lớp bên trái'),
      buildSelect('splitSideRight', 'right', 'Lớp bên phải')
    );
    host.before(box);
  }
  onViewChange(({ split }) => {
    const prev = wasSplit;
    wasSplit = !!split;
    paint();
    if (prev !== wasSplit) emit();
  });
  paint();
  if (isSplitOn()) emit();
}
