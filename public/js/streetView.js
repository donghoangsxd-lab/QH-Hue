// Chuột phải trên bản đồ → menu "Xem Street View tại đây": mở khung Street View nổi ngay trong webapp.
// Nhúng kiểu cũ output=svembed không cần khóa Maps Embed API (khóa API bị Google giới hạn vùng); kiểu này Google
// không công bố chính thức, khung trắng thì dùng nút "Mở Google Maps" trên thanh tiêu đề.
import { state } from './state.js';
import { showToast } from './utils.js';

const EMBED_URL = 'https://maps.google.com/maps';
const PANO_URL = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=';

let menuEl = null;
let panelEl = null;
let marker = null;

const fmt = (ll) => `${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
const panoUrl = (ll) => PANO_URL + fmt(ll);
// cbp = 11,hướng,0,zoom,góc ngẩng
const embedUrl = (ll) => `${EMBED_URL}?${new URLSearchParams({ layer: 'c', cbll: fmt(ll), cbp: '11,0,0,0,0', hl: 'vi', output: 'svembed' })}`;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

function openMenu(ev, latlng, targetMap) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'map-ctx-menu';
  menuEl.innerHTML = `
    <button type="button" data-act="sv">Xem Street View tại đây</button>
    <button type="button" data-act="copy" title="Sao chép tọa độ">${fmt(latlng).replace(',', ', ')}</button>`;
  document.body.appendChild(menuEl);
  const { innerWidth: w, innerHeight: h } = window;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(ev.clientX, w - r.width - 4)}px`;
  menuEl.style.top = `${Math.min(ev.clientY, h - r.height - 4)}px`;
  menuEl.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === 'sv') openStreetView(latlng, targetMap);
    else navigator.clipboard?.writeText(fmt(latlng)).then(() => showToast('Đã sao chép tọa độ', 'success'), () => {});
  });
}

function placeMarker(latlng, targetMap) {
  marker?.remove();
  marker = L.marker(latlng, {
    icon: L.divIcon({ className: 'sv-pin', iconSize: [16, 16], iconAnchor: [8, 8] }),
    interactive: false,
    keyboard: false
  }).addTo(targetMap);
}

function closePanel() {
  panelEl?.remove();
  panelEl = null;
  marker?.remove();
  marker = null;
}

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.className = 'sv-panel';
  panelEl.innerHTML = `
    <div class="sv-head">
      <span class="sv-title">Street View</span>
      <a class="sv-ext" target="_blank" rel="noopener">Mở Google Maps</a>
      <button type="button" class="sv-close" title="Đóng">×</button>
    </div>
    <iframe class="sv-frame" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  document.body.appendChild(panelEl);
  // Neo theo góc trên trái để kéo giãn (resize) ở góc dưới phải không làm khung trôi lên
  const r = panelEl.getBoundingClientRect();
  Object.assign(panelEl.style, { left: `${r.left}px`, top: `${r.top}px`, bottom: 'auto' });
  panelEl.querySelector('.sv-close').addEventListener('click', closePanel);
  enableDrag(panelEl, panelEl.querySelector('.sv-head'));
  return panelEl;
}

// Kéo khung theo thanh tiêu đề; iframe nuốt sự kiện chuột nên tạm tắt pointer-events khi đang kéo
function enableDrag(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;
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
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function openStreetView(latlng, targetMap) {
  const el = ensurePanel();
  el.querySelector('.sv-frame').src = embedUrl(latlng);
  el.querySelector('.sv-ext').href = panoUrl(latlng);
  el.querySelector('.sv-title').textContent = `Street View · ${fmt(latlng).replace(',', ', ')}`;
  placeMarker(latlng, targetMap);
}

export function initStreetView(maps) {
  maps.filter(Boolean).forEach(m => {
    m.on('contextmenu', (e) => {
      if (state.sketchTool || state.adminDrawMode || state.activeMeasureType) return;
      openMenu(e.originalEvent, e.latlng, m);
    });
    m.on('movestart zoomstart', closeMenu);
  });
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) closeMenu();
    else if (panelEl) closePanel();
  });
}
