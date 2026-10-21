// Quản trị: danh sách lô QH cần kiểm tra. Bay tới, đánh dấu Đã có hoặc Chưa có.
import { state, ICON_GROUP_KEYS, infraLabels, layerType } from './state.js';
import { geeApi, markDataWritten } from './api.js';
import { flyToVisible } from './mapEngine.js';
import { planMap, isCompareOn, setViewMode } from './planMap.js';
import { escapeHtml, showToast } from './utils.js';
import { reviewFromPack } from './qhClass.js';

const $ = (id) => document.getElementById(id);
let rows = [];
let shown = 40;
let fallback = false;
let onChanged = null;

const CLS_LABEL = { da_co: 'Đã có', chua_co: 'Chưa có', can_kiem_tra: 'Cần kiểm tra' };

function setMsg(text, kind) {
  const el = $('qhReviewStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = kind === 'error' ? 'var(--accent-red)' : kind === 'ok' ? 'var(--accent-green, var(--accent-cyan))' : '';
}

async function loadRows() {
  if (state.authToken) {
    const res = await fetch(geeApi('action=getQhReview'), {
      headers: { Authorization: `Bearer ${state.authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      fallback = false;
      return data.items || [];
    }
  }
  const pack = await fetch('data/gba/qh-hientrang.json').then(r => {
    if (!r.ok) throw new Error('Không đọc được file phân loại');
    return r.json();
  });
  fallback = true;
  return reviewFromPack(pack, [...state.rawDataList, ...state.planDataList]);
}

function filtered() {
  const q = ($('qhReviewSearch')?.value || '').trim().toLowerCase();
  const type = $('qhReviewType')?.value || '';
  const mode = $('qhReviewMode')?.value || 'pending';
  return rows.filter(r => {
    if (mode === 'pending' && r.cls !== 'can_kiem_tra') return false;
    if (mode === 'done' && !r.override) return false;
    if (type && layerType(r) !== type) return false;
    if (!q) return true;
    return `${r.id} ${r.name} ${r.ward} ${r.reason}`.toLowerCase().includes(q);
  });
}

function render() {
  const list = $('qhReviewList');
  if (!list) return;
  const all = filtered();
  const slice = all.slice(0, shown);
  const pending = rows.filter(r => r.cls === 'can_kiem_tra').length;
  const done = rows.filter(r => r.override).length;
  const sum = $('qhReviewSum');
  if (sum) {
    sum.textContent = `Cần kiểm tra: ${pending.toLocaleString('vi-VN')} · Đã quyết: ${done.toLocaleString('vi-VN')}`
      + (fallback ? ' · đang xem file phân loại đóng gói' : '');
  }
  if (!slice.length) {
    list.innerHTML = `<div class="cad-hint">Không có lô nào trong bộ lọc này.</div>`;
    return;
  }
  list.innerHTML = slice.map(r => {
    const label = infraLabels[layerType(r)] || r.type;
    const decided = r.override ? `<span class="qh-review-tag">${CLS_LABEL[r.cls] || r.cls}</span>` : '';
    return `<article class="qh-review-row" data-id="${escapeHtml(r.id)}">
      <div class="qh-review-main"><b>${escapeHtml(r.name || r.id)}</b> ${decided}
        <div class="pp-sub">${escapeHtml(r.id)} · ${escapeHtml(label)} · ${escapeHtml(r.ward || 'chưa rõ phường')}</div>
        <div class="pp-sub">${escapeHtml(r.reason || '')}</div>
      </div>
      <div class="qh-review-actions">
        <button type="button" data-fly="${escapeHtml(r.id)}">Bay tới</button>
        <button type="button" data-mark="da_co" data-id="${escapeHtml(r.id)}">Đã có</button>
        <button type="button" data-mark="chua_co" data-id="${escapeHtml(r.id)}">Chưa có</button>
        ${r.override ? `<button type="button" data-mark="" data-id="${escapeHtml(r.id)}">Hoàn tác</button>` : ''}
      </div>
    </article>`;
  }).join('') + (all.length > slice.length
    ? `<button type="button" class="layer-mini-btn" id="qhReviewMore">Xem thêm ${all.length - slice.length} lô</button>`
    : '');
}

function ensureLayer(row) {
  const key = ICON_GROUP_KEYS[layerType(row)];
  const el = key && document.getElementById(`chk_${key}`);
  if (el && !el.checked) {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function flyTo(row) {
  if (row.cls === 'da_co') setViewMode('HT');
  else setViewMode('QH');
  ensureLayer(row);
  const latlng = [row.lat, row.lng];
  flyToVisible(latlng, 17, { animate: true, duration: 0.7 });
  if (isCompareOn() && planMap) planMap.flyTo(latlng, 17, { animate: true, duration: 0.7 });
}

async function mark(id, cls) {
  const res = await fetch(geeApi('action=saveQhReview'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, cls: cls || null })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.saved) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  markDataWritten();
  if (onChanged) await onChanged();
  await refresh();
}

async function rerun() {
  const btn = $('btnQhReclassify');
  if (btn) btn.disabled = true;
  setMsg('Đang cập nhật phân loại…');
  try {
    const res = await fetch(geeApi('action=reclassifyQhLots'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.authToken}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.saved) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    markDataWritten();
    setMsg(`Đã cập nhật. Lô mới vào cần kiểm tra: ${data.added}. Bỏ lô không còn: ${data.dropped}.`, 'ok');
    if (onChanged) await onChanged();
    await refresh();
  } catch (err) {
    setMsg(err.message || 'Không cập nhật được', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refresh() {
  const box = $('addQh');
  if (!box || box.style.display === 'none') return;
  setMsg('Đang tải danh sách…');
  try {
    rows = await loadRows();
    shown = 40;
    setMsg('');
    render();
  } catch (err) {
    setMsg(err.message || 'Không tải được danh sách', 'error');
  }
}

export function initQhReview(opts = {}) {
  onChanged = opts.onChanged || null;
  $('btnQhReclassify')?.addEventListener('click', rerun);
  ['qhReviewSearch', 'qhReviewType', 'qhReviewMode'].forEach(id => {
    $(id)?.addEventListener('input', () => { shown = 40; render(); });
    $(id)?.addEventListener('change', () => { shown = 40; render(); });
  });
  $('qhReviewList')?.addEventListener('click', (e) => {
    const more = e.target.closest('#qhReviewMore');
    if (more) { shown += 40; render(); return; }
    const fly = e.target.closest('[data-fly]');
    if (fly) {
      const row = rows.find(r => r.id === fly.dataset.fly);
      if (row) flyTo(row);
      return;
    }
    const btn = e.target.closest('[data-mark]');
    if (!btn) return;
    mark(btn.dataset.id, btn.dataset.mark).catch(err => {
      showToast(err.message || 'Không lưu được quyết định', 'error');
      setMsg(err.message || 'Không lưu được quyết định', 'error');
    });
  });
  document.querySelectorAll('.admin-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.sub === 'addQh') refresh(); });
  });
  document.addEventListener('auth:change', () => {
    if (state.currentUserRole !== 'ADMIN') {
      rows = [];
      const list = $('qhReviewList');
      if (list) list.innerHTML = '';
    }
  });
}
