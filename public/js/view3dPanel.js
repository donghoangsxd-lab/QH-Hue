// Nút «Xem 3D» mở khung nổi trong webapp (không tab mới). Kéo thanh tiêu đề, giãn góc, phóng to.
// Điện thoại ngang: khung phủ hết màn hình.
import { state } from './state.js';

let panelEl = null;
let ring = null;

const phoneLandscape = () => window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;

function closePanel() {
  panelEl?.remove();
  panelEl = null;
  ring?.remove();
  ring = null;
}

function placeRing(lat, lng, radius, targetMap) {
  ring?.remove();
  ring = null;
  if (!targetMap || typeof L === 'undefined') return;
  ring = L.circle([lat, lng], {
    radius,
    color: '#38bdf8',
    weight: 2,
    dashArray: '6 4',
    fillColor: '#38bdf8',
    fillOpacity: 0.05,
    interactive: false
  }).addTo(targetMap);
}

function layout(el) {
  const full = phoneLandscape() || el.classList.contains('is-max');
  el.classList.toggle('is-full', phoneLandscape());
  if (full) {
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    return;
  }
  if (el.style.left) return;
  const w = Math.min(980, window.innerWidth - 36);
  const h = Math.min(700, window.innerHeight - 36);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.left = `${Math.max(12, window.innerWidth - w - 16)}px`;
  el.style.top = `${Math.max(12, (window.innerHeight - h) / 2)}px`;
}

function enableDrag(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button') || el.classList.contains('is-max') || el.classList.contains('is-full')) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    el.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (m) => {
      el.style.left = `${Math.max(0, Math.min(m.clientX - dx, innerWidth - 80))}px`;
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

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.className = 'view3d-panel';
  panelEl.innerHTML = `
    <div class="view3d-head">
      <span class="view3d-title">Phân tích 3D</span>
      <button type="button" class="view3d-max" title="Phóng to">⛶</button>
      <button type="button" class="view3d-close" title="Đóng">×</button>
    </div>
    <iframe class="view3d-frame" title="Phân tích 3D"></iframe>`;
  document.body.appendChild(panelEl);
  layout(panelEl);
  panelEl.querySelector('.view3d-close').addEventListener('click', closePanel);
  panelEl.querySelector('.view3d-max').addEventListener('click', () => {
    panelEl.classList.toggle('is-max');
    if (!panelEl.classList.contains('is-max')) panelEl.style.left = '';
    layout(panelEl);
  });
  enableDrag(panelEl, panelEl.querySelector('.view3d-head'));
  window.addEventListener('resize', () => { if (panelEl) layout(panelEl); });
  return panelEl;
}

function mapOf(btn, maps) {
  const root = btn.closest('.leaflet-container');
  return maps.find((m) => m && m.getContainer() === root) || maps.find(Boolean) || null;
}

export function openView3d(lat, lng, radius, targetMap) {
  const la = Number(lat);
  const ln = Number(lng);
  const r = Math.min(800, Math.max(150, Math.round(Number(radius) || 150)));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
  const el = ensurePanel();
  layout(el);
  const q = new URLSearchParams({ lat: la.toFixed(5), lng: ln.toFixed(5), r: String(r), view: 'gop' });
  const frame = el.querySelector('.view3d-frame');
  const next = `phan-tich-3d.html?${q}`;
  if (frame.getAttribute('src') !== next) frame.src = next;
  el.querySelector('.view3d-title').textContent = `Phân tích 3D · bán kính ${r} m`;
  placeRing(la, ln, r, targetMap);
}

export function initView3d(maps) {
  const list = (maps || []).filter(Boolean);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.pp-3d');
    if (!btn) return;
    e.preventDefault();
    openView3d(btn.dataset.lat, btn.dataset.lng, btn.dataset.r, mapOf(btn, list));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl && !state.sketchTool) closePanel();
  });
}
