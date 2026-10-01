// Trợ giúp khi vẽ trên bản đồ hiện trạng (tuyến đường, vùng dân cư, lớp vẽ tạm):
// - chuột dừng sát mép phần bản đồ nhìn thấy → bản đồ tự trôi theo hướng đó để vẽ tiếp tuyến dài
// - cho phóng tới cấp 19 (ảnh vệ tinh Esri ở Huế chỉ có tới cấp 18, cấp 19 phóng ảnh cấp 18)
import { map, getRightObstruction } from './mapEngine.js';
import { planMap } from './planMap.js';

const EDGE_PX = 44;            // bề rộng dải mép kích hoạt
const MAX_SPEED_PX = 18;       // tốc độ trôi tối đa mỗi khung hình (sát mép nhất)
const DWELL_MS = 160;          // chuột phải ở dải mép ít nhất chừng này mới trôi (tránh trôi khi lướt qua)
const MOVEEND_MS = 280;        // khi đang trôi: báo "moveend" thưa để lớp vẽ / mạng lưới đường cập nhật
const BASE_MAX_ZOOM = 18;
const DRAW_MAX_ZOOM = 19;

const users = new Set();
let pointer = null;            // { x, y } trong khung bản đồ, null = chuột không ở trên bản đồ
let zoneSince = 0;
let raf = 0;
let lastEnd = 0;
let panned = false;

function edgeVector() {
  if (!pointer) return null;
  const size = map.getSize();
  const right = size.x - getRightObstruction();
  const { x, y } = pointer;
  if (x < 0 || y < 0 || x > right || y > size.y) return null;
  const speed = (d) => (d >= EDGE_PX ? 0 : MAX_SPEED_PX * Math.pow(1 - Math.max(0, d) / EDGE_PX, 1.5));
  const dx = speed(right - x) - speed(x);
  const dy = speed(size.y - y) - speed(y);
  return dx || dy ? [dx, dy] : null;
}

function finishPan() {
  if (!panned) return;
  panned = false;
  map.fire('moveend');
}

function tick(now) {
  raf = 0;
  const v = edgeVector();
  if (!v || !users.size) { zoneSince = 0; finishPan(); return; }
  if (!zoneSince) zoneSince = now;
  if (now - zoneSince >= DWELL_MS) {
    if (typeof map._rawPanBy === 'function') {
      if (!panned) { panned = true; lastEnd = now; map.fire('movestart'); }
      map._rawPanBy(L.point(Math.round(v[0]), Math.round(v[1])));
      map.fire('move');
      if (now - lastEnd > MOVEEND_MS) { lastEnd = now; map.fire('moveend'); }
    } else {
      map.panBy(v, { animate: false });
    }
  }
  raf = requestAnimationFrame(tick);
}

function onMove(e) {
  // Đang giữ chuột (kéo bản đồ) hoặc chuột trên panel / thanh công cụ: không trôi
  if (e.buttons || !map.getContainer().contains(e.target) || e.target.closest('.leaflet-control-container, .leaflet-popup')) {
    pointer = null;
  } else {
    const r = map.getContainer().getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  if (!raf && pointer) raf = requestAnimationFrame(tick);
}

function onLeave(e) {
  if (!e.relatedTarget || !map.getContainer().contains(e.relatedTarget)) pointer = null;
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
  const el = map.getContainer();
  if (active) {
    setMaxZoom(DRAW_MAX_ZOOM);
    document.addEventListener('mousemove', onMove, { passive: true });
    el.addEventListener('mouseleave', onLeave);
  } else {
    document.removeEventListener('mousemove', onMove);
    el.removeEventListener('mouseleave', onLeave);
    pointer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    zoneSince = 0;
    finishPan();
    setMaxZoom(BASE_MAX_ZOOM);
  }
}
