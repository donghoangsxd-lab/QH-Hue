// Quản trị: hàng chờ cán bộ. Tải danh sách và xem bản đồ chỉ khi bấm nút.
import { map } from './mapEngine.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);
const KIND_LABEL = {
  'chi-tieu': 'Chỉ tiêu đô thị',
  'kien-truc': 'Công trình kiến trúc',
  'su-dung-dat': 'Sử dụng đất quy hoạch',
  'hien-trang': 'Sử dụng đất hiện trạng',
  'ranh-gioi': 'Ranh giới',
  'ban-ve': 'Bản vẽ hạ tầng'
};

let preview = null;

function clearPreview() {
  if (preview && map) map.removeLayer(preview);
  preview = null;
}

async function post(action, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.message || `Lỗi ${res.status}`);
  return data;
}

function showFeatures(features) {
  clearPreview();
  if (!map || typeof L === 'undefined' || !features.length) return;
  const fc = {
    type: 'FeatureCollection',
    features: features.map(row => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: row.props || {}
    }))
  };
  preview = L.geoJSON(fc, {
    style: { color: '#b45309', weight: 2, fillColor: '#fdba74', fillOpacity: 0.35 },
    pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, color: '#9a3412', weight: 2, fillColor: '#fb923c', fillOpacity: 0.95 })
  });
  preview.addTo(map);
  try {
    const bounds = preview.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  } catch (e) { /* ranh rỗng */ }
}

function rowHtml(row) {
  const id = escapeHtml(row.id || '');
  const kind = KIND_LABEL[row.kind] || row.kind || '';
  return `<article class="cad-item">
    <b>${escapeHtml(kind)}</b>
    <span>${escapeHtml(row.unit || '')}${row.tenQH ? ` · ${escapeHtml(row.tenQH)}` : ''}</span>
    <span>${escapeHtml(row.summary || '')}</span>
    <span>${escapeHtml(row.email || '')}</span>
    <button type="button" class="btn-submit btn-secondary" data-act="preview" data-id="${id}">Xem trên bản đồ</button>
    <button type="button" class="btn-submit" data-act="approve" data-id="${id}">Duyệt</button>
    <input data-reason="${id}" maxlength="300" placeholder="Lý do từ chối">
    <button type="button" class="btn-submit btn-secondary" data-act="reject" data-id="${id}">Từ chối</button>
  </article>`;
}

async function loadList() {
  const status = $('choStatus');
  const list = $('choList');
  if (!list) return;
  clearPreview();
  if (status) status.textContent = 'Đang tải hàng chờ.';
  try {
    const data = await post('listChoDuyet', {});
    const rows = data.rows || [];
    list.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<p class="entry-note">Không có hồ sơ chờ duyệt.</p>';
    if (status) status.textContent = `${rows.length} hồ sơ chờ duyệt.`;
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

async function onListClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const id = button.dataset.id || '';
  const status = $('choStatus');
  try {
    if (button.dataset.act === 'preview') {
      const data = await post('previewChoDuyet', { id });
      const features = data.features || [];
      if (features.length) showFeatures(features);
      else clearPreview();
      if (status) status.textContent = features.length
        ? `Đang xem ${features.length} đối tượng. Chưa công bố.`
        : (data.summary || 'Hồ sơ này không có hình để vẽ.');
      return;
    }
    if (button.dataset.act === 'approve') {
      if (status) status.textContent = 'Đang duyệt.';
      const data = await post('approveChoDuyet', { id });
      clearPreview();
      await loadList();
      if (status) status.textContent = data.note || (data.published ? 'Đã công bố.' : 'Đã xử lý.');
      return;
    }
    if (button.dataset.act === 'reject') {
      const reason = document.querySelector(`[data-reason="${CSS.escape(id)}"]`)?.value.trim() || '';
      if (!reason) {
        if (status) status.textContent = 'Nhập lý do từ chối.';
        return;
      }
      await post('rejectChoDuyet', { id, reason });
      clearPreview();
      if (status) status.textContent = 'Đã từ chối.';
      await loadList();
    }
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

export function initReviewQueue() {
  $('btnChoLoad')?.addEventListener('click', loadList);
  $('choList')?.addEventListener('click', onListClick);
  document.addEventListener('qh-admin-changed', () => {
    if (state.currentUserRole !== 'ADMIN') clearPreview();
  });
}
