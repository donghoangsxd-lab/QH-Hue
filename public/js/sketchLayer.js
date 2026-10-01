// Lớp vẽ tạm trên bản đồ hiện trạng: đường thẳng, đường gấp khúc, đa giác, mũi tên, vòng tròn.
// Hình chỉ nằm trong bộ nhớ trang: không gửi máy chủ, không ghi Sheet / bucket / localStorage → người khác không thấy,
// đóng hoặc tải lại trang là mất.
import { state } from './state.js';
import { map, clearMeasure } from './mapEngine.js';
import { fmtNum, ico } from './utils.js';
import { setDrawAssist } from './drawAssist.js';

const TOOLS = {
  line: { label: 'Đường thẳng', hint: 'Click điểm đầu, rồi click điểm cuối', points: 2 },
  polyline: { label: 'Đường gấp khúc', hint: 'Click các đỉnh · nháy đúp hoặc Enter để kết thúc', min: 2 },
  polygon: { label: 'Đa giác', hint: 'Click các đỉnh · nháy đúp, Enter hoặc click đỉnh đầu để khép vùng', min: 3 },
  arrow: { label: 'Mũi tên', hint: 'Click điểm gốc, rồi click điểm mũi tên', points: 2 },
  circle: { label: 'Vòng tròn', hint: 'Click tâm, rồi click 1 điểm trên đường tròn', points: 2 }
};
const COLORS = ['#f43f5e', '#facc15', '#22d3ee', '#a3e635', '#ffffff'];
const CLOSE_PX = 10;        // click gần đỉnh đầu (px) → khép đa giác
const DUP_PX = 4;           // click trùng đỉnh cuối (nháy đúp) → bỏ qua

const $ = (id) => document.getElementById(id);
let group = null;           // các hình đã vẽ
let draft = null;           // hình đang vẽ (xem trước theo con trỏ)
let shapes = [];            // [L.FeatureGroup] theo thứ tự vẽ (để hoàn tác)
let pts = [];               // đỉnh của hình đang vẽ
let cursor = null;
let color = COLORS[0];
let open = false;

const proj = (ll) => L.CRS.EPSG3857.project(L.latLng(ll));
const unproj = (p) => L.CRS.EPSG3857.unproject(p);
const distM = (a, b) => L.latLng(a).distanceTo(b);
const fmtLen = (m) => (m >= 1000 ? `${fmtNum(Math.round(m / 10) / 100)} km` : `${fmtNum(Math.round(m))} m`);
const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`);
const pathLen = (lls) => lls.slice(1).reduce((s, p, i) => s + distM(lls[i], p), 0);
const polyArea = (lls) => turf.area(turf.polygon([[...lls, lls[0]].map(p => [p.lng, p.lat])]));
const pxDist = (a, b) => map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));

/** Đầu mũi tên (tam giác) tại b, cỡ theo chiều dài thân và vĩ độ (tính trên mặt phẳng Mercator) */
function arrowHead(a, b) {
  const pa = proj(a), pb = proj(b);
  const len = pa.distanceTo(pb);
  if (!len) return null;
  const size = Math.min(len * 0.28, Math.max(len * 0.12, 12 / Math.cos(b.lat * Math.PI / 180)));
  const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
  const bx = pb.x - ux * size, by = pb.y - uy * size, w = size * 0.55;
  return [b, unproj(L.point(bx - uy * w, by + ux * w)), unproj(L.point(bx + uy * w, by - ux * w))];
}

function shapeLayers(tool, lls, c, preview) {
  const line = { color: c, weight: 3, opacity: 0.95, interactive: !preview };
  const halo = { color: '#020617', weight: 6, opacity: 0.45, interactive: false };
  const out = [];
  if (tool === 'circle') {
    const r = distM(lls[0], lls[1]);
    out.push(L.circle(lls[0], { ...line, radius: r, fillColor: c, fillOpacity: 0.12 }));
    if (preview) out.push(L.polyline(lls, { color: c, weight: 1.5, dashArray: '4,5', interactive: false }));
    return { layers: out, text: `Bán kính ${fmtLen(r)} · diện tích ${fmtArea(Math.PI * r * r)}` };
  }
  if (tool === 'polygon' && lls.length >= 3) {
    out.push(L.polygon(lls, { ...line, fillColor: c, fillOpacity: 0.15 }));
    return { layers: out, text: `Diện tích ${fmtArea(polyArea(lls))} · chu vi ${fmtLen(pathLen([...lls, lls[0]]))}` };
  }
  out.push(L.polyline(lls, halo), L.polyline(lls, { ...line, dashArray: preview ? '6,6' : null }));
  if (tool === 'arrow' && lls.length === 2) {
    const head = arrowHead(lls[0], lls[1]);
    if (head) out.push(L.polygon(head, { ...line, weight: 1, fillColor: c, fillOpacity: 1 }));
  }
  return { layers: out, text: `Dài ${fmtLen(pathLen(lls))}` };
}

function renderDraft() {
  if (!draft) return;
  draft.clearLayers();
  const tool = TOOLS[state.sketchTool];
  if (!tool || !pts.length) return setHint(tool ? tool.hint : '');
  const lls = cursor ? [...pts, cursor] : pts.slice();
  if (lls.length >= 2) {
    const { layers, text } = shapeLayers(state.sketchTool, lls, color, true);
    layers.forEach(l => l.addTo(draft));
    setHint(`${tool.label}: ${text}`);
  }
  pts.forEach((p, i) => L.circleMarker(p, {
    radius: i === 0 && state.sketchTool === 'polygon' && pts.length >= 3 ? 6 : 4,
    color, weight: 2, fillColor: '#0f172a', fillOpacity: 1, interactive: false
  }).addTo(draft));
}

function finish() {
  const t = state.sketchTool;
  const tool = TOOLS[t];
  if (!tool) return;
  const need = tool.points || tool.min;
  if (pts.length < need) { pts = []; renderDraft(); return; }
  const { layers, text } = shapeLayers(t, pts, color, false);
  const fg = L.featureGroup(layers);
  fg.bindTooltip(`${tool.label} · ${text}`, { sticky: true, className: 'sketch-tip' });
  fg.on('click', (e) => {
    if (state.sketchTool) return;          // đang vẽ: click để đặt đỉnh, không mở menu
    L.DomEvent.stopPropagation(e);
    const btn = L.DomUtil.create('button', 'ui-btn-format sketch-del');
    btn.type = 'button';
    btn.innerHTML = `${ico('trash')}Xóa hình này`;
    const popup = L.popup({ className: 'sketch-popup', closeButton: false }).setLatLng(e.latlng).setContent(btn).openOn(map);
    btn.addEventListener('click', () => { removeShape(fg); map.closePopup(popup); });
  });
  fg.addTo(group);
  shapes.push(fg);
  pts = [];
  renderDraft();
  syncButtons();
}

function removeShape(fg) {
  group?.removeLayer(fg);
  shapes = shapes.filter(s => s !== fg);
  syncButtons();
}

/** Click bản đồ hiện trạng khi đang chọn 1 công cụ vẽ tạm */
export function handleSketchClick(latlng) {
  const tool = TOOLS[state.sketchTool];
  if (!tool) return;
  const last = pts[pts.length - 1];
  if (last && pxDist(last, latlng) < DUP_PX) return;
  if (state.sketchTool === 'polygon' && pts.length >= 3 && pxDist(pts[0], latlng) < CLOSE_PX) { finish(); return; }
  pts.push(latlng);
  if (tool.points && pts.length >= tool.points) { finish(); return; }
  renderDraft();
}

function onMouseMove(e) {
  if (!state.sketchTool || !pts.length) return;
  cursor = e.latlng;
  renderDraft();
}

function onDblClick() {
  if (state.sketchTool && !TOOLS[state.sketchTool].points) finish();
}

function setHint(text) {
  const el = $('sketchHint');
  if (el) el.textContent = text || (state.sketchTool ? '' : 'Chọn công cụ để vẽ · hình chỉ có trong phiên này, không lưu, người khác không thấy');
}

function syncButtons() {
  document.querySelectorAll('#sketchPalette [data-tool]').forEach(b => {
    const on = b.dataset.tool === state.sketchTool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#sketchPalette [data-color]').forEach(b => b.classList.toggle('active', b.dataset.color === color));
  const undo = $('btnSketchUndo'), clear = $('btnSketchClear');
  if (undo) undo.disabled = !pts.length && !shapes.length;
  if (clear) clear.disabled = !shapes.length;
  const btn = $('btnSketch');
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-pressed', String(open));
  }
}

function setTool(tool) {
  if (tool && !TOOLS[tool]) tool = null;
  pts = [];
  cursor = null;
  state.sketchTool = tool;
  if (tool) {
    clearMeasure();
    state.isPickMode = false;
    map.doubleClickZoom.disable();
  } else {
    map.doubleClickZoom.enable();
  }
  map.getContainer().classList.toggle('sketch-mode', !!tool);
  setDrawAssist('sketch', !!tool);
  renderDraft();
  setHint(tool ? TOOLS[tool].hint : '');
  syncButtons();
}

/** Tắt công cụ đang chọn (khi bật đo đạc, tra cứu, vẽ tuyến...); các hình đã vẽ vẫn giữ */
export function stopSketchTool() {
  if (state.sketchTool) setTool(null);
}

function setOpen(on) {
  open = on;
  const pal = $('sketchPalette'), btn = $('btnSketch');
  if (pal) {
    pal.hidden = !on;
    if (on && btn) pal.style.top = `${btn.offsetTop}px`;
  }
  if (!on) setTool(null);
  setHint('');
  syncButtons();
}

export function initSketchLayer() {
  if (!map) return;
  group = L.featureGroup().addTo(map);
  draft = L.layerGroup().addTo(map);
  map.on('mousemove', onMouseMove);
  map.on('dblclick', onDblClick);

  const pal = $('sketchPalette');
  pal?.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); });
  $('btnSketch')?.addEventListener('click', () => setOpen(!open));
  pal?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { setTool(state.sketchTool === t.dataset.tool ? null : t.dataset.tool); return; }
    const c = e.target.closest('[data-color]');
    if (c) { color = c.dataset.color; renderDraft(); syncButtons(); return; }
    if (e.target.closest('#btnSketchUndo')) {
      if (pts.length) { pts.pop(); renderDraft(); syncButtons(); }
      else if (shapes.length) removeShape(shapes[shapes.length - 1]);
      return;
    }
    if (e.target.closest('#btnSketchClear')) {
      if (shapes.length && confirm(`Xóa toàn bộ ${shapes.length} hình vẽ tạm?`)) {
        group.clearLayers();
        shapes = [];
        syncButtons();
      }
      return;
    }
    if (e.target.closest('#btnSketchClose')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (!state.sketchTool || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { if (pts.length) { pts = []; renderDraft(); syncButtons(); } else setTool(null); }
    else if (e.key === 'Enter') finish();
    else if (e.key === 'Backspace' && pts.length) { e.preventDefault(); pts.pop(); renderDraft(); syncButtons(); }
  });
  syncButtons();
}
