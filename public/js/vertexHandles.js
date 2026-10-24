// Núm đỉnh và núm giữa cạnh dùng chung cho phác thảo và phép đo.
// Toán đỉnh nằm ở sketchEdit.js (createSketchEditSession). Bản đồ không kéo theo khi đang giữ núm.
import { ico, showToast } from './utils.js';

export function vertexMenuButton(box, label, cls, icon, fn) {
  const b = L.DomUtil.create('button', `ui-btn-format ${cls}`, box);
  b.type = 'button';
  b.innerHTML = `${ico(icon)}${label}`;
  b.addEventListener('click', fn);
  return b;
}

/**
 * @param {object} opt
 * @param {() => object|null} opt.sessionOf phiên createSketchEditSession
 * @param {() => object} opt.mapOf bản đồ đang sửa
 * @param {() => object} opt.layerOf nhóm chứa núm
 * @param {(pts: {lat:number,lng:number}[]) => void} opt.paint vẽ lại hình theo đỉnh đang sửa
 * @param {() => void} opt.finish ghi (Xong)
 * @param {() => string} opt.minLabel câu khi không xóa được vì chạm số đỉnh tối thiểu
 */
export function createVertexHandles(opt) {
  let vertexMarks = [];
  let midMarks = [];
  let vertexDragAt = 0;
  let mapDragWas = false;
  let mapDragMap = null;

  function session() {
    return opt.sessionOf() || null;
  }

  function lockMapDrag(m) {
    if (!m || mapDragMap) return;
    mapDragMap = m;
    mapDragWas = !!(m.dragging && m.dragging.enabled());
    if (mapDragWas) m.dragging.disable();
  }

  function unlockMapDrag() {
    if (mapDragWas && mapDragMap?.dragging) mapDragMap.dragging.enable();
    mapDragWas = false;
    mapDragMap = null;
  }

  function clear() {
    unlockMapDrag();
    vertexMarks.forEach(h => h.remove());
    midMarks.forEach(h => h.remove());
    vertexMarks = [];
    midMarks = [];
  }

  function apply(rebuild, active) {
    const s = session();
    if (!s?.isEditing()) return;
    opt.paint(s.workingPts());
    if (rebuild) draw();
    else sync(active);
  }

  function sync(active) {
    const s = session();
    if (!s?.isEditing()) return;
    const pts = s.workingPts();
    vertexMarks.forEach(h => {
      if (h === active) return;
      const p = pts[h._index];
      if (p) h.setLatLng([p.lat, p.lng]);
    });
    if (!midMarks.length || active?._role !== 'vertex') return;
    const mids = s.midpoints();
    if (mids.length !== midMarks.length) return;
    mids.forEach((mid, i) => {
      midMarks[i].setLatLng([mid.at.lat, mid.at.lng]);
      midMarks[i]._insertAt = mid.insertAt;
    });
  }

  function handleIcon(role) {
    return L.divIcon({
      className: `sketch-handle sketch-handle-${role}`,
      html: '<span></span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  function openVertexMenu(mk, e) {
    const s = session();
    if (!s?.isEditing() || mk._role !== 'vertex') return;
    const m = opt.mapOf();
    const box = L.DomUtil.create('div', 'sketch-menu');
    const items = s.vertexMenu();
    if (items.includes('Xóa đỉnh')) {
      vertexMenuButton(box, 'Xóa đỉnh', 'sketch-del', 'trash', () => {
        m.closePopup();
        const res = s.deleteVertex(mk._index);
        if (!res.removed) {
          showToast(opt.minLabel(), 'info');
          return;
        }
        apply(true);
      });
    }
    if (items.includes('Xong')) {
      vertexMenuButton(box, 'Xong', 'sketch-act', 'check', () => {
        m.closePopup();
        opt.finish();
      });
    }
    L.popup({ className: 'sketch-popup', closeButton: false, autoPan: false })
      .setLatLng(e.latlng || mk.getLatLng())
      .setContent(box)
      .openOn(m);
  }

  function bindHandle(mk, m) {
    const armDom = () => {
      const node = mk.getElement();
      if (!node || node.dataset.sketchHandle) return;
      node.dataset.sketchHandle = '1';
      L.DomEvent.disableClickPropagation(node);
      L.DomEvent.disableScrollPropagation(node);
      const title = mk._role === 'mid' ? 'Kéo để chèn đỉnh' : 'Kéo để dịch đỉnh. Chuột phải: Xóa đỉnh';
      node.title = title;
      node.setAttribute('aria-label', title);
      node.addEventListener('pointerdown', (ev) => {
        if (ev.button != null && ev.button !== 0) return;
        ev.stopPropagation();
        lockMapDrag(m);
        const up = () => {
          document.removeEventListener('pointerup', up, true);
          document.removeEventListener('pointercancel', up, true);
          unlockMapDrag();
        };
        document.addEventListener('pointerup', up, true);
        document.addEventListener('pointercancel', up, true);
      });
      node.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (mk._role === 'vertex') openVertexMenu(mk, { latlng: mk.getLatLng() });
      });
      if (mk._role !== 'vertex') return;
      let timer = 0;
      let x = 0;
      let y = 0;
      let pid = null;
      const clearTimer = () => { clearTimeout(timer); timer = 0; pid = null; };
      node.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'mouse') return;
        clearTimer();
        x = ev.clientX;
        y = ev.clientY;
        pid = ev.pointerId;
        timer = setTimeout(() => {
          timer = 0;
          if (mk._role === 'vertex') openVertexMenu(mk, { latlng: mk.getLatLng() });
        }, 560);
      });
      node.addEventListener('pointermove', (ev) => {
        if (ev.pointerId !== pid) return;
        if (Math.hypot(ev.clientX - x, ev.clientY - y) > 8) clearTimer();
      });
      node.addEventListener('pointerup', clearTimer);
      node.addEventListener('pointercancel', clearTimer);
    };
    mk.on('add', armDom);
    mk.on('dragstart', () => {
      vertexDragAt = performance.now();
      lockMapDrag(m);
      const s = session();
      if (mk._role !== 'mid' || !s?.isEditing()) return;
      const ll = mk.getLatLng();
      const at = mk._insertAt;
      s.insertMidpoint(at, { lat: ll.lat, lng: ll.lng });
      mk._role = 'vertex';
      mk._index = at;
      vertexMarks.splice(at, 0, mk);
      vertexMarks.forEach((h, i) => { h._index = i; });
      midMarks.forEach(h => { if (h !== mk) h.remove(); });
      midMarks = [];
      apply(false, mk);
    });
    mk.on('drag', () => {
      vertexDragAt = performance.now();
      const s = session();
      if (!s?.isEditing() || mk._role !== 'vertex') return;
      const ll = mk.getLatLng();
      s.dragVertex(mk._index, { lat: ll.lat, lng: ll.lng });
      apply(false, mk);
    });
    mk.on('dragend', () => {
      vertexDragAt = performance.now();
      unlockMapDrag();
      requestAnimationFrame(() => {
        if (session()?.isEditing()) apply(true);
      });
    });
  }

  function makeHandle(m, layer, role, p, index) {
    const mk = L.marker([p.lat, p.lng], {
      draggable: true,
      autoPan: false,
      keyboard: false,
      zIndexOffset: role === 'vertex' ? 1400 : 1200,
      bubblingMouseEvents: false,
      icon: handleIcon(role)
    });
    mk._role = role;
    if (role === 'vertex') mk._index = index;
    else mk._insertAt = index;
    bindHandle(mk, m);
    mk.addTo(layer);
    return mk;
  }

  function draw() {
    const s = session();
    if (!s?.isEditing()) return;
    const m = opt.mapOf();
    const layer = opt.layerOf();
    if (!m || !layer) return;
    clear();
    const pts = s.workingPts();
    pts.forEach((p, i) => vertexMarks.push(makeHandle(m, layer, 'vertex', p, i)));
    s.midpoints().forEach(mid => {
      midMarks.push(makeHandle(m, layer, 'mid', mid.at, mid.insertAt));
    });
  }

  return {
    draw,
    clear,
    dragAt: () => vertexDragAt
  };
}
