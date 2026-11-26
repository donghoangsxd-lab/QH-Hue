// Trục A — chọn hỗn hợp phường/xã hoặc đô thị (chuột phải / chuột trái).
// Resolve hit theo nút HT/QH; tô ranh + đổi tab; thẻ thông tin hai khối Hiện trạng | Quy hoạch.
import { wardNameAt, map, isShiftClick } from './mapEngine.js';
import { planMap } from './planMap.js';
import { browseState } from './facetStore.js';
import { DVHC_CITY, dvhcOf, shortPlaceName } from './dvhcStats.js';
import { wardMarks, HT_URBANS, DOTHI_2030, DOTHI_SAU, PLAN_FOOT } from './doThiQd756.js';
import { STATUS_REF as STATUS_614 } from './urbanStatus.js';
import { urbanStatusAt, urbanVisionAt } from './urbanAreaLayer.js';
import { pickUrbanFromMap, clearUrbanMapPick } from './generalPlanUi.js';
import {
  columnMode, isDvhcBrowse, isDothiBrowse, ensureAdminTab, selectDvhcName, getSelectedDvhcNames
} from './chuyenNganh.js';
import { escapeHtml, ico, fmtNum } from './utils.js';

const POP_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const KM_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let infoEl = null;
let chooserEl = null;

export function isAdminAxis() {
  return browseState().axis === 'hanhchinh';
}

export function closeAdminInfoCard() {
  infoEl?.remove();
  infoEl = null;
}

/** Kéo thẻ theo thanh tiêu đề (giống Street View / 3D). */
function enableInfoCardDrag(el, handle) {
  if (!el || !handle) return;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    el.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (m) => {
      el.style.left = `${Math.max(0, Math.min(m.clientX - dx, innerWidth - r.width))}px`;
      el.style.top = `${Math.max(0, Math.min(m.clientY - dy, innerHeight - 40))}px`;
      el.style.right = el.style.bottom = 'auto';
    };
    const up = () => {
      el.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export function closeAdminChooser() {
  chooserEl?.remove();
  chooserEl = null;
}

function useVisionUrban(m) {
  return columnMode() === 'QH'
    || document.body.classList.contains('urban-plan-on-base')
    || (!!planMap && m === planMap);
}

function flatGroups(groups) {
  return groups.flatMap(g => g.rows);
}

function bare(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ').trim().toUpperCase()
    .replace(/^(PHUONG|XA|DO THI|KHU VUC DO THI)\s+/, '');
}

function htUrbanRow(u) {
  if (!u) return null;
  return HT_URBANS.find(r =>
    r.id === u.id
    || r.id === `ht-${u.id}`
    || bare(r.name) === bare(u.name)
  ) || null;
}

function planUrbanRow(u, list) {
  if (!u) return null;
  return list.find(r => r.id === u.id || bare(r.name) === bare(u.name)) || null;
}

function fmtPop(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : POP_FMT.format(Number(n));
}

function fmtKm(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : KM_FMT.format(Number(n));
}

function clampBox(el, x, y) {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  el.style.maxHeight = `${Math.max(120, vh - pad * 2)}px`;
  el.style.maxWidth = `${Math.max(180, vw - pad * 2)}px`;
  const r = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + r.width > vw - pad) left = vw - pad - r.width;
  if (top + r.height > vh - pad) top = vh - pad - r.height;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

/** ward + urban tại điểm; urban theo HT/QH đang bật. */
export async function resolveAdminHits(latlng, m) {
  const rawWard = latlng ? wardNameAt(latlng.lat, latlng.lng) : null;
  const ward = {
    name: rawWard || DVHC_CITY.name,
    city: !rawWard || rawWard === DVHC_CITY.name
  };
  let urban = null;
  if (latlng) {
    urban = useVisionUrban(m)
      ? await urbanVisionAt(latlng).catch(() => null)
      : await urbanStatusAt(latlng).catch(() => null);
  }
  return { ward, urban, mode: columnMode(), hasWardGeom: !!rawWard };
}

export function adminHitLabels(hits) {
  const wardLabel = hits.ward?.city
    ? DVHC_CITY.name
    : (hits.ward?.name || DVHC_CITY.name);
  const urbanLabel = hits.urban?.name || null;
  return { wardLabel, urbanLabel };
}

function wardInfoBlocks(name) {
  const stats = name === DVHC_CITY.name ? DVHC_CITY : dvhcOf(name);
  const marks = wardMarks(name);
  return {
    title: name,
    pop: stats?.pop ?? null,
    km2: stats?.km2 ?? null,
    ht: {
      label: 'Hiện trạng',
      kind: marks?.ht || '—',
      detail: marks?.htTitle || STATUS_614
    },
    qh: {
      label: 'Quy hoạch',
      kind: marks?.plan || '—',
      detail: marks?.planTitle || PLAN_FOOT
    }
  };
}

function urbanInfoBlocks(u) {
  const ht = htUrbanRow(u);
  const p2030 = planUrbanRow(u, flatGroups(DOTHI_2030));
  const pSau = planUrbanRow(u, flatGroups(DOTHI_SAU));
  const pop = p2030?.pop ?? ht?.pop ?? null;
  const km2 = (columnMode() === 'QH' ? (p2030?.km2 ?? pSau?.km2) : ht?.km2) ?? p2030?.km2 ?? ht?.km2 ?? null;
  const htKind = ht?.cls || u.cls || '—';
  const htDetail = [
    ht?.before ? `Trước chuyển tiếp: ${ht.before}` : '',
    ht?.basis || STATUS_614,
    ht?.note || ''
  ].filter(Boolean).join('\n');
  const qhKind = p2030?.cls || pSau?.cls || '—';
  const qhDetail = [
    p2030 ? `Đến 2030: loại ${p2030.cls}${p2030.strive ? ' (phấn đấu)' : ''}` : '',
    pSau ? `Sau 2030: loại ${pSau.cls}${pSau.strive ? ' (phấn đấu)' : ''}` : '',
    p2030?.note || pSau?.note || PLAN_FOOT
  ].filter(Boolean).join('\n');
  return {
    title: u.name || ht?.name || p2030?.name || 'Đô thị',
    pop,
    km2,
    ht: { label: 'Hiện trạng', kind: htKind, detail: htDetail },
    qh: { label: 'Quy hoạch', kind: qhKind, detail: qhDetail }
  };
}

function blockHtml(block) {
  const kind = block.kind && block.kind !== '—' ? `Loại ${block.kind}` : '—';
  return `<section class="admin-info-block" title="${escapeHtml(block.detail || '')}">
    <header>${escapeHtml(block.label)}</header>
    <b>${escapeHtml(kind)}</b>
    ${block.detail ? `<p>${escapeHtml(block.detail)}</p>` : ''}
  </section>`;
}

function pctOf(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
  return (p / t) * 100;
}

function fmtPct(pct) {
  const n = Number(pct) || 0;
  if (n >= 10) return `${fmtNum(Math.round(n))}%`;
  if (n >= 1) return `${fmtNum(Math.round(n * 10) / 10)}%`;
  if (n > 0) return '< 1%';
  return '0%';
}

/** Tổng hợp nhiều phường/xã (Shift): bảng Đơn vị | Dân số | Diện tích | Tỷ lệ + hàng TỔNG CỘNG.
 * Giữ mở khi pan/zoom; kéo theo tiêu đề; đóng bằng nút X hoặc Esc / đổi trục. */
export function openMultiWardInfoCard(names, ev) {
  const keepLeft = infoEl?.classList.contains('admin-info-multi') ? infoEl.style.left : '';
  const keepTop = infoEl?.classList.contains('admin-info-multi') ? infoEl.style.top : '';
  closeAdminInfoCard();
  const list = [...new Set((names || []).map(s => String(s || '').trim()).filter(Boolean))];
  if (list.length < 2) {
    if (list[0]) openAdminInfoCard({ kind: 'ward', name: list[0] }, ev);
    return;
  }
  const rows = list.map(name => {
    const stats = dvhcOf(name) || { pop: null, km2: null };
    return { name, pop: Number(stats.pop) || 0, km2: Number(stats.km2) || 0 };
  }).sort((a, b) => b.km2 - a.km2 || a.name.localeCompare(b.name, 'vi'));
  const totalPop = rows.reduce((s, r) => s + r.pop, 0);
  const totalKm = rows.reduce((s, r) => s + r.km2, 0);
  // Tỷ lệ theo diện tích trên tổng đã chọn (cột gọn một số %).
  const body = rows.map(r => {
    const kmPct = pctOf(r.km2, totalKm);
    return `<tr title="${escapeHtml(r.name)}">
      <th scope="row">${escapeHtml(shortPlaceName(r.name))}</th>
      <td>${fmtPop(r.pop)}</td>
      <td>${fmtKm(r.km2)}</td>
      <td>${escapeHtml(fmtPct(kmPct))}</td>
    </tr>`;
  }).join('');
  const el = document.createElement('aside');
  el.className = 'place-card admin-info-card admin-info-multi';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Tổng hợp đơn vị hành chính');
  el.innerHTML = `<header class="place-head"><span>${ico('locate')}Đã chọn ${list.length} đơn vị</span>
      <button type="button" class="place-x" title="Đóng" aria-label="Đóng">${ico('close')}</button></header>
    <table class="admin-multi-table">
      <thead><tr><th scope="col">Đơn vị</th><th scope="col">Dân số</th><th scope="col">Diện tích<br><span>km²</span></th><th scope="col">Tỷ lệ</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <th scope="row">TỔNG CỘNG</th>
        <td>${fmtPop(totalPop)}</td>
        <td>${fmtKm(totalKm)}</td>
        <td>100%</td>
      </tr></tfoot>
    </table>`;
  document.body.appendChild(el);
  infoEl = el;
  if (keepLeft) {
    el.style.left = keepLeft;
    el.style.top = keepTop || el.style.top;
    el.style.right = 'auto';
  }
  el.querySelector('.place-x')?.addEventListener('click', closeAdminInfoCard);
  enableInfoCardDrag(el, el.querySelector('.place-head'));
}

export function openAdminInfoCard(payload, ev) {
  closeAdminInfoCard();
  const data = payload.kind === 'urban'
    ? urbanInfoBlocks(payload.urban)
    : wardInfoBlocks(payload.name || DVHC_CITY.name);
  const el = document.createElement('aside');
  el.className = 'place-card admin-info-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Thông tin đơn vị');
  el.innerHTML = `<header class="place-head"><span>${ico('locate')}${escapeHtml(shortPlaceName(data.title))}</span>
      <button type="button" class="place-x" title="Đóng" aria-label="Đóng">${ico('close')}</button></header>
    <button type="button" class="place-row" disabled>
      <span>Tên đầy đủ</span><b>${escapeHtml(data.title)}</b></button>
    <button type="button" class="place-row" disabled>
      <span>Dân số</span><b>${fmtPop(data.pop)}</b></button>
    <button type="button" class="place-row" disabled>
      <span>Diện tích</span><b>${fmtKm(data.km2)} km²</b></button>
    <div class="admin-info-cols">
      ${blockHtml(data.ht)}
      ${blockHtml(data.qh)}
    </div>`;
  document.body.appendChild(el);
  infoEl = el;
  const x = ev?.clientX ?? 80;
  const y = ev?.clientY ?? 80;
  clampBox(el, x, y);
  el.querySelector('.place-x')?.addEventListener('click', closeAdminInfoCard);
}

export function selectAdminWard(name, { tipAt, zoom = true, infoEv, shift } = {}) {
  ensureAdminTab('dvhc');
  const useShift = shift != null ? !!shift : isShiftClick(infoEv);
  selectDvhcName(name || DVHC_CITY.name, { tipAt, zoom, shift: useShift });
  const names = getSelectedDvhcNames();
  if (names.length >= 2) openMultiWardInfoCard(names, infoEv);
  else if (infoEv) openAdminInfoCard({ kind: 'ward', name: names[0] || name || DVHC_CITY.name }, infoEv);
  else closeAdminInfoCard();
}

export function selectAdminUrban(u, { infoEv } = {}) {
  if (!u) return;
  ensureAdminTab('dothi');
  pickUrbanFromMap(u);
  if (infoEv) openAdminInfoCard({ kind: 'urban', urban: u }, infoEv);
}

/**
 * Chuột trái trên tab ĐVHC / Đô thị — khóa theo tab đang mở (không nhảy tab):
 * Đô thị chỉ chọn đô thị; ĐVHC chỉ chọn phường/xã. Chuột phải vẫn mở menu hai lựa chọn.
 */
export async function consumeAdminHybridClick(latlng, m, ev) {
  if (!isDvhcBrowse() && !isDothiBrowse()) return false;
  if (!latlng) return false;
  closeAdminChooser();
  const hits = await resolveAdminHits(latlng, m || map);

  if (isDothiBrowse()) {
    if (hits.urban) selectAdminUrban(hits.urban);
    else clearUrbanMapPick();
    return true;
  }

  const shift = isShiftClick(ev);
  if (hits.hasWardGeom) selectAdminWard(hits.ward.name, { tipAt: latlng, shift, infoEv: shift ? ev : null });
  else selectAdminWard(DVHC_CITY.name, { tipAt: latlng, shift: false });
  return true;
}

/** HTML khối đầu menu chuột phải trục A (resolve xong mới gắn). */
export function adminContextMenuHtml(hits) {
  const { wardLabel, urbanLabel } = adminHitLabels(hits);
  const urbanBtn = urbanLabel
    ? `<button type="button" class="map-ctx-item" role="menuitem" data-act="admin-urban">${ico('layers')}<span>Đô thị: ${escapeHtml(urbanLabel)}</span></button>`
    : `<button type="button" class="map-ctx-item" role="menuitem" disabled>${ico('layers')}<span>Không có đô thị tại đây</span></button>`;
  return [
    `<div class="map-ctx-note">Đơn vị tại điểm</div>`,
    `<button type="button" class="map-ctx-item" role="menuitem" data-act="admin-ward">${ico('map')}<span>Phường/xã: ${escapeHtml(shortPlaceName(wardLabel))}</span></button>`,
    urbanBtn,
    '<div class="map-ctx-sep"></div>'
  ].join('');
}

document.addEventListener('pointerdown', (e) => {
  if (chooserEl && !chooserEl.contains(e.target)) closeAdminChooser();
  // Thẻ nhiều ĐVHC: không đóng khi pan/zoom bản đồ — chỉ X / Esc / đổi trục.
  if (infoEl?.classList.contains('admin-info-multi')) return;
  if (infoEl && !infoEl.contains(e.target) && !e.target.closest?.('#axisWardList, [data-admin-tab]')) {
    closeAdminInfoCard();
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (chooserEl) { closeAdminChooser(); e.stopPropagation(); }
  else if (infoEl) closeAdminInfoCard();
});

// Danh sách ĐVHC / map: khi ≥ 2 đơn vị thì mở thẻ tổng hợp bên trái.
document.addEventListener('qh:dvhc-multi', (e) => {
  const names = Array.isArray(e.detail) ? e.detail : [];
  if (names.length >= 2) openMultiWardInfoCard(names);
  else if (!infoEl?.classList.contains('admin-info-multi')) { /* giữ thẻ đơn nếu đang mở */ }
  else closeAdminInfoCard();
});

document.addEventListener('qh:admin-release', () => closeAdminInfoCard());
