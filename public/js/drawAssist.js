// Trợ giúp khi vẽ (tuyến đường, vùng dân cư, phác thảo):
// - chuột dừng sát mép phần bản đồ nhìn thấy → bản đồ dưới chuột tự trôi để vẽ tiếp tuyến dài
// - cho phóng tới cấp 19 (ảnh vệ tinh Esri ở Huế chỉ có tới cấp 18, cấp 19 phóng ảnh cấp 18)
import { map } from './mapEngine.js';
import { planMap, isSplitOn } from './planMap.js';

const EDGE_PX = 44;            // bề rộng dải mép kích hoạt
const MAX_SPEED_PX = 18;       // tốc độ trôi tối đa mỗi khung hình (sát mép nhất)
const DWELL_MS = 160;          // chuột phải ở dải mép ít nhất chừng này mới trôi (tránh trôi khi lướt qua)
const MOVEEND_MS = 280;        // khi đang trôi: báo "moveend" thưa để lớp vẽ / mạng lưới đường cập nhật
const BASE_MAX_ZOOM = 18;
const DRAW_MAX_ZOOM = 19;

const users = new Set();
let pointer = null;            // { x, y } trong khung bản đồ đang trỏ, null = chuột không ở trên bản đồ
let panTarget = null;          // bản đồ dưới chuột (hiện trạng hoặc quy hoạch)
let zoneSince = 0;
let raf = 0;
let lastEnd = 0;
let panned = false;
let pannedOn = null;

function mapUnder(target) {
  if (!target || !map) return null;
  const planEl = planMap?.getContainer();
  if (planEl && planEl.contains(target) && planEl.offsetParent !== null) return planMap;
  if (map.getContainer().contains(target)) return map;
  return null;
}

// Phần nhìn thấy của bản đồ m: chia đôi thì mỗi bên một nửa, trừ panel phải
function visibleEdges(m) {
  const size = m.getSize();
  let left = 0;
  let right = size.x;
  const rp = document.getElementById('rightPanel');
  if (rp && !document.body.classList.contains('right-collapsed')) {
    const panelW = Math.max(0, m.getContainer().getBoundingClientRect().right - rp.getBoundingClientRect().left);
    if (size.x - panelW >= 240) right -= panelW;
  }
  if (isSplitOn()) {
    const x = document.getElementById('swipeDivider')?.offsetLeft ?? Math.round(size.x / 2);
    if (m === planMap) left = Math.max(left, x);
    else right = Math.min(right, x);
  }
  if (right - left < 240) return null;
  return { left, right, bottom: size.y };
}

function edgeVector() {
  if (!pointer || !panTarget) return null;
  const box = visibleEdges(panTarget);
  if (!box) return null;
  const { x, y } = pointer;
  if (x < box.left || y < 0 || x > box.right || y > box.bottom) return null;
  const speed = (d) => (d >= EDGE_PX ? 0 : MAX_SPEED_PX * Math.pow(1 - Math.max(0, d) / EDGE_PX, 1.5));
  const dx = speed(box.right - x) - speed(x - box.left);
  const dy = speed(box.bottom - y) - speed(y);
  return dx || dy ? [dx, dy] : null;
}

function finishPan() {
  if (!panned || !pannedOn) { panned = false; pannedOn = null; return; }
  panned = false;
  pannedOn.fire('moveend');
  pannedOn = null;
}

function tick(now) {
  raf = 0;
  const v = edgeVector();
  const m = panTarget;
  if (!v || !users.size || !m) { zoneSince = 0; finishPan(); return; }
  if (!zoneSince) zoneSince = now;
  if (now - zoneSince >= DWELL_MS) {
    if (typeof m._rawPanBy === 'function') {
      if (!panned || pannedOn !== m) {
        if (panned && pannedOn) pannedOn.fire('moveend');
        panned = true;
        pannedOn = m;
        lastEnd = now;
        m.fire('movestart');
      }
      m._rawPanBy(L.point(Math.round(v[0]), Math.round(v[1])));
      m.fire('move');
      if (now - lastEnd > MOVEEND_MS) { lastEnd = now; m.fire('moveend'); }
    } else {
      m.panBy(v, { animate: false });
    }
  }
  raf = requestAnimationFrame(tick);
}

function onMove(e) {
  const host = mapUnder(e.target);
  // Đang giữ chuột (kéo bản đồ) hoặc chuột trên panel / thanh công cụ: không trôi
  if (e.buttons || !host || e.target.closest('.leaflet-control-container, .leaflet-popup')) {
    pointer = null;
    panTarget = null;
  } else {
    const r = host.getContainer().getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    panTarget = host;
  }
  if (!raf && pointer) raf = requestAnimationFrame(tick);
}

function onLeave(e) {
  const next = e.relatedTarget;
  if (next && (map.getContainer().contains(next) || planMap?.getContainer()?.contains(next))) return;
  pointer = null;
  panTarget = null;
}

function setMaxZoom(z) {
  // Mở rộng: bản đồ quy hoạch trước (đồng bộ khung nhìn không bị chặn); thu lại: hiện trạng trước
  if (z > BASE_MAX_ZOOM) { planMap?.setMaxZoom(z); map.setMaxZoom(z); }
  else { map.setMaxZoom(z); planMap?.setMaxZoom(z); }
}

/** key: tên công cụ đang vẽ ('road', 'pop', 'sketch'...). Tắt hết mới trả về giới hạn zoom thường */
export function setDrawAssist(key, on) {
  if (!map) return;
  const before = users.size > 0;
  if (on) users.add(key); else users.delete(key);
  const active = users.size > 0;
  if (active === before) return;
  const els = [map, planMap].filter(Boolean).map(m => m.getContainer());
  if (active) {
    setMaxZoom(DRAW_MAX_ZOOM);
    document.addEventListener('mousemove', onMove, { passive: true });
    els.forEach(el => el.addEventListener('mouseleave', onLeave));
  } else {
    document.removeEventListener('mousemove', onMove);
    els.forEach(el => el.removeEventListener('mouseleave', onLeave));
    pointer = null;
    panTarget = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    zoneSince = 0;
    finishPan();
    setMaxZoom(BASE_MAX_ZOOM);
  }
}
