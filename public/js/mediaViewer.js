// Khung xem ảnh nội bộ bên phải (công trình kiến trúc). Chỉ ảnh + nút đóng; không thanh tiêu đề dày.
import { announceFloat, FLOAT_OPEN_EVENT } from './utils.js';

let panelEl = null;
let inited = false;

function ensureInit() {
  if (inited) return;
  inited = true;
  document.addEventListener(FLOAT_OPEN_EVENT, (e) => {
    if (e.detail !== 'media') closeMedia();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl && !panelEl.hidden) {
      e.preventDefault();
      closeMedia();
    }
  });
}

function ensurePanel() {
  ensureInit();
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'mediaView';
  panelEl.className = 'media-view';
  panelEl.hidden = true;
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'Xem ảnh');
  panelEl.innerHTML = `
    <button type="button" class="media-close" title="Đóng" aria-label="Đóng">×</button>
    <img class="media-img" alt="">`;
  document.body.appendChild(panelEl);
  panelEl.querySelector('.media-close').addEventListener('click', closeMedia);
  return panelEl;
}

export function closeMedia() {
  if (!panelEl || panelEl.hidden) return;
  panelEl.hidden = true;
  const img = panelEl.querySelector('.media-img');
  if (img) {
    img.removeAttribute('src');
    img.alt = '';
  }
}

export function openMedia(url, title = '') {
  const src = String(url || '').trim();
  if (!src) return;
  const el = ensurePanel();
  const img = el.querySelector('.media-img');
  const label = String(title || 'Ảnh công trình').trim();
  img.alt = label;
  img.src = src;
  el.setAttribute('aria-label', label);
  el.hidden = false;
  announceFloat('media');
}

export function initMediaViewer() {
  ensureInit();
}
