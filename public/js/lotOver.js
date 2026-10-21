// Số lô vượt mật độ và tầng cao theo phường, xã (public/data/gba/lot-over.json).
// Cùng quy tắc với đối chiếu từng lô: mật độ = dấu chân cắt trong ranh; tầng = làm tròn mét / 3,3.
import { map, flyToVisible } from './mapEngine.js';
import { escapeHtml, fmtNum } from './utils.js';
import { setLotCounts, setWardLotHtml } from './uiComponents.js';

const LIST_CAP = 20;

let byName = new Map();
let ready = false;
const shown = new Map();
let mark = null;

function score(it) {
  const cover = it.oc ? Math.max(0, Number(it.c) - Number(it.cl)) : 0;
  const floors = it.of ? Math.max(0, Number(it.f) - Number(it.fl)) * 5 : 0;
  return cover + floors;
}

function detailLine(it) {
  const bits = [];
  if (it.oc && it.cl != null) bits.push(`mật độ ${fmtNum(it.c)}% / ≤ ${fmtNum(it.cl)}%`);
  if (it.of && it.fl != null && it.f != null) bits.push(`tầng ${fmtNum(it.f)} / ≤ ${fmtNum(it.fl)}`);
  return bits.join(' · ');
}

function wardHtml(name) {
  if (!ready) return '';
  const w = byName.get(name) || { cover: 0, floors: 0, withCover: 0, withFloors: 0, items: [] };
  const items = [...(w.items || [])].sort((a, b) => score(b) - score(a)).slice(0, LIST_CAP);
  shown.set(name, items);
  const more = Math.max(0, (w.items || []).length - items.length);
  const denom = (n) => (n > 0 ? `<em>/ ${fmtNum(n)} lô có chỉ tiêu</em>` : '');
  const rows = items.map((it, i) => `<button type="button" class="lot-over-item" data-i="${i}">
      <b>${escapeHtml(it.id || 'Lô')}</b> ${escapeHtml(it.qh || '')}
      <span>${escapeHtml(detailLine(it))}</span>
    </button>`).join('');
  return `<section class="lot-over" data-ward="${escapeHtml(name)}">
    <h4>Lô vượt chỉ tiêu xây dựng</h4>
    <div class="lot-over-kpis">
      <div><span>Số lô vượt mật độ</span><b>${fmtNum(w.cover)}</b>${denom(w.withCover)}</div>
      <div><span>Số lô vượt tầng cao</span><b>${fmtNum(w.floors)}</b>${denom(w.withFloors)}</div>
    </div>
    ${rows ? `<div class="lot-over-list">${rows}</div>` : '<p class="lot-over-empty">Không có lô vượt chỉ tiêu.</p>'}
    ${more > 0 ? `<p class="lot-over-more">và ${fmtNum(more)} lô khác</p>` : ''}
  </section>`;
}

function focusLot(it) {
  if (!map || !Number.isFinite(Number(it.lat)) || !Number.isFinite(Number(it.lng))) return;
  if (mark) {
    map.removeLayer(mark);
    mark = null;
  }
  mark = L.circleMarker([Number(it.lat), Number(it.lng)], {
    radius: 12,
    color: '#b91c1c',
    weight: 3,
    fillColor: '#fecaca',
    fillOpacity: 0.55,
    interactive: false
  }).addTo(map);
  flyToVisible([Number(it.lat), Number(it.lng)], 17, { animate: false });
}

function onLotClick(e) {
  const btn = e.target.closest('.lot-over-item');
  if (!btn) return;
  const sec = btn.closest('.lot-over');
  const list = sec && shown.get(sec.dataset.ward);
  const it = list && list[Number(btn.dataset.i)];
  if (it) focusLot(it);
}

export function initLotOver() {
  setWardLotHtml(wardHtml);
  document.addEventListener('click', onLotClick);
  const url = new URL('data/gba/lot-over.json', document.baseURI).href;
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).then((data) => {
    byName = new Map((data.wards || []).map((w) => [w.name, w]));
    ready = true;
    setLotCounts((name) => {
      const w = byName.get(name);
      return w ? { cover: w.cover || 0, floors: w.floors || 0 } : { cover: 0, floors: 0 };
    });
  }).catch((err) => console.warn('Số lô vượt chỉ tiêu:', err));
}
