// Nút «Xem 3D» mở khung nổi trong webapp (không tab mới). Kéo thanh tiêu đề, giãn góc, phóng to.
// Điện thoại ngang: khung phủ hết màn hình.
// Gửi điểm + ranh lô hạ tầng (màu hatch TT16) vào iframe.
import { state, layerType, BUFFER_COLORS } from './state.js';
import { announceFloat, FLOAT_OPEN_EVENT, isApproved, distanceMeters } from './utils.js';
import { infraStyleKey, TT16_STYLES } from './tt16Symbols.js';

let panelEl = null;
let ring = null;

const TYPE_TO_FAC = {
  '1-CV': 'park',
  '2-BDX': 'parking',
  '3-MN': 'school',
  '4-TH': 'school',
  '5-THCS': 'school',
  '6-THPT': 'school',
  '7-YT': 'health',
  '8-VH': 'culture',
  '9-TM': 'market',
  '13-BUS': 'bus'
};

function packLocalInfra(lat, lng, r) {
  const lim = Math.max(r, 2000);
  const out = [];
  for (const it of state.rawDataList || []) {
    if (!isApproved(it.status)) continue;
    const code = layerType(it) || it.type;
    const fac = TYPE_TO_FAC[code];
    if (!fac) continue;
    const la = Number(it.lat);
    const ln = Number(it.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    const dist = distanceMeters(lat, lng, la, ln);
    if (dist > lim) continue;
    out.push({ id: fac, name: it.name || '', lat: la, lng: ln, dist });
  }
  return out;
}

function outerRings(geometry) {
  const g = geometry && geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates?.[0] ? [g.coordinates[0]] : [];
  if (g.type === 'MultiPolygon') {
    return (g.coordinates || []).map((poly) => poly?.[0]).filter((ring) => ring && ring.length >= 4);
  }
  return [];
}

function slimRing(ring, max = 48) {
  if (!ring || ring.length < 4) return null;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const body = closed ? ring.slice(0, -1) : ring.slice();
  if (body.length < 3) return null;
  if (body.length <= max) {
    const out = body.map((p) => [Number(p[0]), Number(p[1])]);
    out.push(out[0]);
    return out;
  }
  const step = Math.ceil(body.length / max);
  const out = [];
  for (let i = 0; i < body.length; i += step) out.push([Number(body[i][0]), Number(body[i][1])]);
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < ring.length; i++) {
    if (i && ring[i][0] === ring[0][0] && ring[i][1] === ring[0][1]) continue;
    x += ring[i][0];
    y += ring[i][1];
    n += 1;
  }
  return n ? [x / n, y / n] : null;
}

function hatchColor(type, layer, name) {
  const key = infraStyleKey(type, layer, name);
  if (key && TT16_STYLES[key]?.color) return TT16_STYLES[key].color;
  return BUFFER_COLORS[type] || '#38bdf8';
}

function packLocalLots(lat, lng, r) {
  const lim = r + 40;
  const out = [];
  const seen = new Set();
  const byId = new Map();
  for (const it of state.rawDataList || []) {
    if (!it?.id) continue;
    byId.set(it.id, it);
  }
  const pushGeom = (geometry, color, name, key) => {
    if (!geometry || seen.has(key)) return;
    const rings = [];
    for (const raw of outerRings(geometry)) {
      const ring = slimRing(raw);
      if (!ring) continue;
      const c = ringCentroid(ring);
      if (!c) continue;
      if (distanceMeters(lat, lng, c[1], c[0]) > lim) continue;
      rings.push(ring);
    }
    if (!rings.length) return;
    seen.add(key);
    out.push({ color, name: name || '', rings });
  };

  for (const it of state.rawDataList || []) {
    if (!isApproved(it.status)) continue;
    const code = layerType(it) || it.type;
    const parcel = state.cadParcels?.get(`HT|${it.id}`) || state.cadParcels?.get(`QH|${it.id}`);
    if (!parcel?.geometry) continue;
    pushGeom(parcel.geometry, hatchColor(code, parcel.layer, it.name), it.name, `p|${it.id}`);
  }
  for (const lot of state.projectInfraLots || []) {
    if (!lot?.geometry || !lot.id) continue;
    const point = byId.get(lot.id);
    const code = point ? (layerType(point) || point.type) : null;
    const color = hatchColor(code, lot.layer, point?.name || '');
    pushGeom(lot.geometry, color, point?.name || lot.id, `l|${lot.phase || 'HT'}|${lot.id}`);
  }
  return out.slice(0, 60);
}

function pushInfraToFrame(frame, lat, lng, r) {
  if (!frame) return;
  const points = packLocalInfra(lat, lng, r);
  const lots = packLocalLots(lat, lng, r);
  const send = () => {
    try {
      frame.contentWindow?.postMessage({ type: 'qh-3d-infra', points, lots }, location.origin);
    } catch (e) { /* iframe chưa sẵn */ }
  };
  frame.addEventListener('load', send, { once: true });
  setTimeout(send, 600);
  setTimeout(send, 2000);
}

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

function mapWell() {
  const tb = document.querySelector('.map-toolbar')?.getBoundingClientRect();
  const title = document.getElementById('mapTitle')?.getBoundingClientRect();
  const panel = document.getElementById('rightPanel');
  const panelOn = panel && !document.body.classList.contains('right-collapsed');
  const pr = panelOn ? panel.getBoundingClientRect() : null;
  const bottomEl = document.getElementById('bottomPanel');
  const bottomOn = bottomEl && !document.body.classList.contains('bottom-collapsed');
  const br = bottomOn ? bottomEl.getBoundingClientRect() : null;
  let left = 12;
  let right = 12;
  let top = (title?.bottom || 12) + 8;
  let bottom = 12;
  if (tb && tb.width > 8) {
    if ((tb.left + tb.right) / 2 < window.innerWidth / 2) left = Math.max(left, tb.right + 8);
    else right = Math.max(right, window.innerWidth - tb.left + 8);
  }
  if (pr && pr.width > 40 && pr.height > 40) {
    if (pr.top > window.innerHeight * 0.4 && pr.height < window.innerHeight * 0.7) bottom = Math.max(bottom, window.innerHeight - pr.top + 8);
    else if (pr.left > window.innerWidth / 2) right = Math.max(right, window.innerWidth - pr.left + 8);
    else left = Math.max(left, pr.right + 8);
  }
  if (br && br.height > 24 && br.top < window.innerHeight - 8) bottom = Math.max(bottom, window.innerHeight - br.top + 8);
  return { left, top, right, bottom };
}

function layout(el) {
  const full = phoneLandscape() || el.classList.contains('is-max');
  el.classList.toggle('is-full', phoneLandscape());
  if (full) {
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    return;
  }
  if (el.style.left) return;
  const well = mapWell();
  const availW = window.innerWidth - well.left - well.right;
  const availH = window.innerHeight - well.top - well.bottom;
  const w = Math.max(160, Math.min(980, availW));
  const h = Math.max(140, Math.min(700, availH));
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.left = `${well.left}px`;
  el.style.top = `${well.top}px`;
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
  announceFloat('view3d');
  layout(el);
  const q = new URLSearchParams({ lat: la.toFixed(5), lng: ln.toFixed(5), r: String(r), view: 'gop' });
  const frame = el.querySelector('.view3d-frame');
  const next = `phan-tich-3d.html?${q}`;
  if (frame.getAttribute('src') !== next) frame.src = next;
  pushInfraToFrame(frame, la, ln, r);
  el.querySelector('.view3d-title').textContent = `Phân tích 3D · bán kính ${r} m`;
  placeRing(la, ln, r, targetMap);
}

export function initView3d(maps) {
  document.addEventListener(FLOAT_OPEN_EVENT, (e) => { if (e.detail !== 'view3d') closePanel(); });
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
