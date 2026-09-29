// Nhắc Admin: công trình có Ten_XaPhuong (Sheet) khác phường theo tọa độ (bảng thống kê luôn tính theo tọa độ).
// Nút "Ghi vào cột Note" nhờ máy chủ ghi dấu "⚠ Phường/xã theo tọa độ: …" vào Sheet để sửa nhanh.
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, showToast } from './utils.js';
import { wardNameAt, zoomToPoint } from './mapEngine.js';

// Khớp api/gee.js (WARD_NOTE_PREFIX) và apps-script/Code.gs
const NOTE_PREFIX = '⚠ Phường/xã theo tọa độ:';
const OUTSIDE_TEXT = 'ngoài ranh 40 phường/xã';
const MAX_LISTED = 100;

let onSynced = null;
let dismissedSig = null;
let expanded = false;
let busy = false;

const wardKey = (s) => String(s || '').normalize('NFC').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim().toLowerCase();
const shortWard = (s) => String(s || '').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim();

/** [{ it, coord, noted }] — noted: cột Note đã có đúng dấu nhắc */
export function findWardMismatches() {
  if (!state.wardLabelsList.some(w => w.geometry)) return [];
  const seen = new Set();
  const out = [];
  [...state.rawDataList, ...state.planDataList].forEach(it => {
    if (!it.id || seen.has(it.id)) return;
    seen.add(it.id);
    const coord = wardNameAt(it.lat, it.lng);
    if (coord && wardKey(coord) === wardKey(it.ward)) return;
    const mark = `${NOTE_PREFIX} ${coord ? shortWard(coord) : OUTSIDE_TEXT}`;
    out.push({ it, coord, noted: String(it.note || '').includes(mark) });
  });
  return out.sort((a, b) => Number(a.noted) - Number(b.noted) || String(a.it.id).localeCompare(String(b.it.id)));
}

function ensureBox() {
  let box = document.getElementById('wardCheckBanner');
  if (!box) {
    box = document.createElement('div');
    box.id = 'wardCheckBanner';
    box.className = 'ward-check';
    box.setAttribute('role', 'status');
    box.hidden = true;
    document.body.appendChild(box);
    box.addEventListener('click', onBoxClick);
  }
  return box;
}

function rowHtml({ it, coord, noted }) {
  return `<button type="button" class="ward-check-row" data-lat="${Number(it.lat)}" data-lng="${Number(it.lng)}" data-name="${escapeHtml(it.name || '')}" title="Phóng tới công trình">
    <span><b>${escapeHtml(it.id)}</b> · ${escapeHtml(it.name || '')}</span>
    <small>Sheet: <s>${escapeHtml(it.ward || 'trống')}</s> → tọa độ: <b>${escapeHtml(coord ? shortWard(coord) : OUTSIDE_TEXT)}</b>${noted ? ' <em>đã ghi Note</em>' : ''}</small>
  </button>`;
}

/** Vẽ lại băng nhắc (gọi sau khi tải dữ liệu, đăng nhập / đăng xuất Admin) */
export function refreshWardCheck() {
  const box = ensureBox();
  if (state.currentUserRole !== 'ADMIN' || !state.rawDataList.length) { box.hidden = true; return; }
  const list = findWardMismatches();
  const pending = list.filter(m => !m.noted).length;
  const sig = `${list.length}|${pending}`;
  if (!list.length || dismissedSig === sig) { box.hidden = true; return; }

  box.innerHTML = `
    <div class="ward-check-head">
      <span class="ward-check-text">⚠ <b>${list.length}</b> công trình có tên phường trong Sheet khác phường theo tọa độ<br>
        <small>${pending ? `<b>${pending}</b> chưa ghi vào cột Note` : 'Đã ghi chú trong cột Note — chờ sửa cột Ten_XaPhuong'}</small></span>
      <button type="button" class="ward-check-btn" data-act="toggle" aria-expanded="${expanded}">${expanded ? 'Ẩn' : 'Xem'} danh sách</button>
      ${pending ? `<button type="button" class="ward-check-btn primary" data-act="sync"${busy ? ' disabled' : ''}>${busy ? '⏳ Đang ghi...' : '📝 Ghi vào cột Note'}</button>` : ''}
      <button type="button" class="ward-check-close" data-act="close" aria-label="Ẩn nhắc">✕</button>
    </div>
    ${expanded ? `<div class="ward-check-list">${list.slice(0, MAX_LISTED).map(rowHtml).join('')}${list.length > MAX_LISTED ? `<div class="ward-check-more">… và ${list.length - MAX_LISTED} công trình khác</div>` : ''}</div>` : ''}`;
  box.hidden = false;
}

async function syncNotes() {
  if (busy) return;
  busy = true;
  refreshWardCheck();
  try {
    const res = await fetch(geeApi('action=syncWardNotes'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.authToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new Error('Phiên Admin hết hạn — đăng nhập lại');
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    const missing = (data.noNoteColumn || []).length ? ` · tab thiếu cột Note: ${data.noNoteColumn.join(', ')}` : '';
    showToast(data.unchanged
      ? '✓ Cột Note đã đầy đủ dấu nhắc, không cần ghi thêm'
      : `✓ Đã ghi ${data.marked} dấu nhắc, gỡ ${data.cleared} dấu đã sửa${missing}`, missing ? 'error' : 'success');
    busy = false;
    if (onSynced) await onSynced();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    busy = false;
    refreshWardCheck();
  }
}

function onBoxClick(e) {
  const row = e.target.closest('.ward-check-row');
  if (row) {
    zoomToPoint(Number(row.dataset.lat), Number(row.dataset.lng), row.dataset.name);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') { expanded = !expanded; refreshWardCheck(); }
  else if (act === 'sync') syncNotes();
  else if (act === 'close') {
    const list = findWardMismatches();
    dismissedSig = `${list.length}|${list.filter(m => !m.noted).length}`;
    refreshWardCheck();
  }
}

/** opts.onSynced: tải lại dữ liệu sau khi máy chủ ghi Sheet */
export function initWardCheck(opts = {}) {
  onSynced = opts.onSynced || null;
}
