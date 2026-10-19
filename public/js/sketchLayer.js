// Phác thảo trên bản đồ đang xem (quy hoạch hoặc hiện trạng): đường thẳng, đường gấp khúc, đa giác, mũi tên, vòng tròn, chữ (nhiều dòng, gõ Telex).
// Hình chỉ nằm trong bộ nhớ trang: không gửi máy chủ, không ghi Sheet / bucket / localStorage → người khác không thấy,
// đóng hoặc tải lại trang là mất; nút Lưu tải về máy file KML hoặc DXF (sketchExport.js).
// Mỗi hình gắn với bản đồ lúc vẽ: xem quy hoạch thì nằm trên bản đồ quy hoạch, xem hiện trạng thì trên bản đồ hiện trạng.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, shownMaps, isSplitOn, getSplitKind, onViewChange } from './planMap.js';
import { escapeHtml, fmtNum, ico, announceTool, showToast, TOOL_START_EVENT } from './utils.js';
import { kmlTextFromFile, sketchShapesFromKml } from './kmlLoad.js';
import { setDrawAssist } from './drawAssist.js';
import { attachTelex } from './telex.js';
import { exportKml, exportDxf } from './sketchExport.js';

const TOOLS = {
  line: { label: 'Đường thẳng', hint: 'Click điểm đầu, rồi click điểm cuối', points: 2 },
  polyline: { label: 'Đường gấp khúc', hint: 'Click các đỉnh · nháy đúp hoặc Enter để kết thúc', min: 2 },
  polygon: { label: 'Đa giác', hint: 'Click các đỉnh · nháy đúp, Enter hoặc click đỉnh đầu để khép vùng', min: 3 },
  arrow: { label: 'Mũi tên', hint: 'Click điểm gốc, rồi click điểm mũi tên', points: 2 },
  circle: { label: 'Vòng tròn', hint: 'Click tâm, rồi click 1 điểm trên đường tròn', points: 2 },
  text: { label: 'Chữ', hint: 'Click chỗ đặt chữ rồi gõ · Enter: ghi · Shift+Enter: xuống dòng · Esc: hủy' }
};
const COLORS = ['#f43f5e', '#facc15', '#22d3ee', '#a3e635', '#ffffff'];
const CLOSE_PX = 10;        // click gần đỉnh đầu (px) → khép đa giác
const DUP_PX = 4;           // click trùng đỉnh cuối (nháy đúp) → bỏ qua
const VERTEX_HIT_PX = 16;   // đỉnh gần con trỏ trong bán kính này (px, theo mức phóng) sáng lên; chuột phải xóa đỉnh đó

const $ = (id) => document.getElementById(id);
const hosts = new Map();    // bản đồ Leaflet → { group, draft }
let drawMap = null;         // bản đồ của nét đang vẽ
let shapes = [];            // [L.FeatureGroup] theo thứ tự vẽ (để hoàn tác); fg.sketch = dữ liệu để xuất file; fg.sketchHost = bản đồ chứa hình
let pts = [];               // đỉnh của hình đang vẽ
let cursor = null;
let snapAt = -1;
let snapHost = null;
let snapMark = null;
let color = COLORS[0];
let open = false;
let collapsed = false;      // đã chọn công cụ: thanh thu thành 1 nút cạnh nút Phác thảo
let telexOn = true;
let sketchBtnTitle = '';
let editor = null;          // { el, latlng, restore, map } ô gõ chữ đang mở
let hoverFg = null;         // hình đang nằm dưới con trỏ
let pickFg = null;          // hình vừa click — viền sáng giữ đến khi bấm chỗ khác
let pickAt = 0;

const proj = (ll) => L.CRS.EPSG3857.project(L.latLng(ll));
const unproj = (p) => L.CRS.EPSG3857.unproject(p);
const distM = (a, b) => L.latLng(a).distanceTo(b);
const fmtLen = (m) => (m >= 1000 ? `${fmtNum(Math.round(m / 10) / 100)} km` : `${fmtNum(Math.round(m))} m`);
const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`);
const pathLen = (lls) => lls.slice(1).reduce((s, p, i) => s + distM(lls[i], p), 0);
const polyArea = (lls) => turf.area(turf.polygon([[...lls, lls[0]].map(p => [p.lng, p.lat])]));
const pxDist = (a, b) => {
  const m = drawMap || map;
  return m.latLngToContainerPoint(a).distanceTo(m.latLngToContainerPoint(b));
};
const metersPerPixel = (lat, m) => 40075016.686 * Math.cos(lat * Math.PI / 180) / Math.pow(2, (m || map).getZoom() + 8);
const textSize = () => Number($('sketchTextSize')?.value) || 16;
const stateName = (m) => (m === planMap ? 'quy hoạch' : 'hiện trạng');
const offsetSplit = () => isSplitOn() && getSplitKind() === 'offset';

function targetPhrase() {
  const shown = shownMaps();
  if (shown.length > 1) return 'bản đồ đang bấm (quy hoạch hoặc hiện trạng)';
  return shown[0] === planMap ? 'bản đồ quy hoạch' : 'bản đồ hiện trạng';
}

function toolHint(tool) {
  if (!tool) return '';
  const del = tool === 'text' ? '' : ' · đỉnh sáng gần con trỏ: chuột phải để xóa';
  return `${TOOLS[tool].hint}${del} · vẽ trên ${targetPhrase()}`;
}

function hostOf(m) {
  if (!m) return null;
  let h = hosts.get(m);
  if (h) return h;
  h = { group: L.featureGroup().addTo(m), draft: L.layerGroup().addTo(m), snap: L.layerGroup().addTo(m) };
  hosts.set(m, h);
  m.on('mousemove', onMouseMove);
  m.on('dblclick', onDblClick);
  m.on('contextmenu', onSketchContextMenu);
  m.on('zoomend', () => {
    if (m !== drawMap || !cursor || !state.sketchTool || state.sketchTool === 'text') return;
    setSnap(nearestSketchIndex(m, cursor), m);
  });
  m.on('click', () => {
    if (performance.now() - pickAt < 40) return;
    setPick(null);
  });
  return h;
}

function clearDraft() {
  hosts.forEach(h => h.draft.clearLayers());
}

function nearestSketchIndex(m, latlng) {
  if (!m || !latlng || !pts.length) return -1;
  const p = m.latLngToContainerPoint(latlng);
  let best = -1;
  let bestD = VERTEX_HIT_PX;
  pts.forEach((pt, i) => {
    const d = p.distanceTo(m.latLngToContainerPoint(pt));
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function clearSnap() {
  if (snapMark) {
    snapMark.unbindTooltip();
    snapMark.remove();
  }
  snapMark = null;
  snapAt = -1;
  snapHost = null;
}

function setSnap(index, m) {
  const ll = index >= 0 ? pts[index] : null;
  const same = index === snapAt && (index < 0 || (m === snapHost && snapMark && ll && snapMark.getLatLng().equals(L.latLng(ll))));
  if (same) return;
  clearSnap();
  snapAt = index;
  snapHost = m || null;
  if (!ll || !m) return;
  const layer = hosts.get(m)?.snap;
  if (!layer) return;
  snapMark = L.marker(ll, {
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
    icon: L.divIcon({ className: 'vtx-snap', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] })
  }).addTo(layer);
  snapMark.bindTooltip('Chuột phải để xóa điểm', {
    permanent: true, direction: 'top', offset: [0, -12], className: 'vtx-snap-tip', opacity: 1
  });
}

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
    if (!preview) out.push(L.circle(lls[0], { color: '#ffffff', radius: r, weight: 8, opacity: 0, fill: false, interactive: false }));
    out.push(L.circle(lls[0], { ...line, radius: r, fillColor: c, fillOpacity: 0.12 }));
    if (preview) out.push(L.polyline(lls, { color: c, weight: 1.5, dashArray: '4,5', interactive: false }));
    return { layers: out, text: `Bán kính ${fmtLen(r)} · diện tích ${fmtArea(Math.PI * r * r)}` };
  }
  if (tool === 'polygon' && lls.length >= 3) {
    if (!preview) out.push(L.polygon(lls, { color: '#ffffff', weight: 8, opacity: 0, fill: false, interactive: false }));
    out.push(L.polygon(lls, { ...line, fillColor: c, fillOpacity: 0.15 }));
    return { layers: out, text: `Diện tích ${fmtArea(polyArea(lls))} · chu vi ${fmtLen(pathLen([...lls, lls[0]]))}` };
  }
  out.push(L.polyline(lls, halo), L.polyline(lls, { ...line, dashArray: preview ? '6,6' : null }));
  // Nét trong suốt, rộng hơn nét thấy được, để rê chuột và chuột phải trúng đường mảnh
  if (!preview) out.push(L.polyline(lls, { color: c, weight: 18, opacity: 0, className: 'sketch-hit' }));
  if (tool === 'arrow' && lls.length === 2) {
    const head = arrowHead(lls[0], lls[1]);
    if (head) {
      if (!preview) out.push(L.polygon(head, { color: '#ffffff', weight: 6, opacity: 0, fill: false, interactive: false }));
      out.push(L.polygon(head, { ...line, weight: 1, fillColor: c, fillOpacity: 1 }));
    }
  }
  return { layers: out, text: `Dài ${fmtLen(pathLen(lls))}` };
}

function stopShapeEvent(e) {
  L.DomEvent.stop(e);
  const raw = e.originalEvent;
  if (!raw) return;
  raw._stopped = true;
  L.DomEvent.preventDefault(raw);
  L.DomEvent.stopPropagation(raw);
}

function pointerInside(fg, e) {
  const to = e?.originalEvent?.relatedTarget;
  if (!to) return false;
  let inside = false;
  fg.eachLayer(l => {
    const el = l.getElement?.();
    if (el && (el === to || el.contains?.(to))) inside = true;
  });
  return inside;
}

function applyChrome(fg) {
  if (!fg) return;
  const hot = fg === hoverFg || fg === pickFg;
  const picked = fg === pickFg;
  fg.eachLayer(l => {
    const hit = String(l.options?.className || '').includes('sketch-hit');
    if (hit) return;
    const el = l.getElement?.();
    if (l.setStyle) {
      if (!l._skBase) {
        l._skBase = {
          color: l.options.color, weight: l.options.weight, opacity: l.options.opacity,
          fillColor: l.options.fillColor, fillOpacity: l.options.fillOpacity
        };
      }
      const halo = l.options.interactive === false;
      if (hot) {
        l.setStyle(halo
          ? { color: picked ? '#38bdf8' : '#ffffff', weight: (l._skBase.weight || 6) + (picked ? 5 : 3), opacity: 0.95 }
          : { weight: (l._skBase.weight || 3) + (picked ? 2 : 1), opacity: 1 });
      } else l.setStyle(l._skBase);
      el?.classList.toggle('sketch-edge', hot && !halo);
      el?.classList.toggle('sketch-picked', picked && !halo);
    } else {
      const body = el?.querySelector?.('.sketch-text-body');
      body?.classList.toggle('sketch-edge', hot);
      body?.classList.toggle('sketch-picked', picked);
    }
  });
  if (hot) fg.bringToFront();
}

function setHover(fg) {
  if (hoverFg === fg) return;
  const prev = hoverFg;
  hoverFg = fg;
  if (prev) applyChrome(prev);
  if (fg) applyChrome(fg);
}

function setPick(fg) {
  if (fg) pickAt = performance.now();
  if (pickFg === fg) return;
  const prev = pickFg;
  pickFg = fg;
  if (prev) applyChrome(prev);
  if (fg) applyChrome(fg);
}

function armHit(fg) {
  fg.eachLayer(l => {
    if (!String(l.options?.className || '').includes('sketch-hit')) return;
    const el = l.getElement?.();
    if (el) el.style.pointerEvents = 'stroke';
  });
}

function renderDraft() {
  const draft = drawMap && hosts.get(drawMap)?.draft;
  if (!draft) return;
  draft.clearLayers();
  const tool = TOOLS[state.sketchTool];
  if (!tool || !pts.length) return setHint(tool ? toolHint(state.sketchTool) : '');
  const lls = cursor ? [...pts, cursor] : pts.slice();
  if (lls.length >= 2) {
    const { layers, text } = shapeLayers(state.sketchTool, lls, color, true);
    layers.forEach(l => l.addTo(draft));
    setHint(`${tool.label}: ${text} · ${stateName(drawMap)} · đỉnh sáng: chuột phải để xóa`);
  }
  pts.forEach((p, i) => L.circleMarker(p, {
    radius: i === 0 && state.sketchTool === 'polygon' && pts.length >= 3 ? 6 : 4,
    color, weight: 2, fillColor: '#0f172a', fillOpacity: 1, interactive: false
  }).addTo(draft));
}

function openShapeMenu(fg, e) {
  const m = fg.sketchHost || map;
  const box = L.DomUtil.create('div', 'sketch-menu');
  if (fg.sketch.tool === 'text') {
    const edit = L.DomUtil.create('button', 'ui-btn-format sketch-del', box);
    edit.type = 'button';
    edit.innerHTML = `${ico('pen')}Sửa chữ`;
    edit.addEventListener('click', () => {
      m.closePopup();
      const s = fg.sketch;
      removeShape(fg);
      openTextEditor(s.pts[0], { text: s.text, color: s.color, sizePx: s.sizePx, restore: fg }, m);
    });
  }
  const del = L.DomUtil.create('button', 'ui-btn-format sketch-del', box);
  del.type = 'button';
  del.innerHTML = `${ico('trash')}Xóa hình này`;
  del.addEventListener('click', () => { removeShape(fg); m.closePopup(); });
  L.popup({ className: 'sketch-popup', closeButton: false }).setLatLng(e.latlng).setContent(box).openOn(m);
}

/** Hình đã vẽ: rê hoặc click sáng viền; chuột phải mới mở nút xóa (và sửa chữ). */
function bindShapeMenu(fg) {
  fg.on('mouseover', () => setHover(fg));
  fg.on('mouseout', (e) => {
    if (pointerInside(fg, e) || hoverFg !== fg) return;
    setHover(null);
  });
  fg.on('click', (e) => {
    if (state.sketchTool && state.sketchTool !== 'text' && pts.length) return;
    stopShapeEvent(e);
    (fg.sketchHost || map).closePopup();
    setPick(fg);
  });
  fg.on('contextmenu', (e) => {
    if (state.sketchTool && state.sketchTool !== 'text' && pts.length) return;
    stopShapeEvent(e);
    setPick(fg);
    openShapeMenu(fg, e);
  });
}

function addShape(fg, m) {
  const host = m || fg.sketchHost || drawMap || map;
  fg.sketchHost = host;
  bindShapeMenu(fg);
  fg.addTo(hostOf(host).group);
  armHit(fg);
  shapes.push(fg);
  syncButtons();
}

function finish() {
  const t = state.sketchTool;
  const tool = TOOLS[t];
  if (!tool || t === 'text') return;
  const need = tool.points || tool.min;
  if (pts.length < need) { pts = []; clearSnap(); renderDraft(); return; }
  const m = drawMap || map;
  const { layers, text } = shapeLayers(t, pts, color, false);
  const fg = L.featureGroup(layers);
  fg.bindTooltip(`${tool.label} · ${text} · ${stateName(m)} · chuột phải để xóa`, { sticky: true, className: 'sketch-tip' });
  fg.sketch = { tool: t, pts: pts.map(p => L.latLng(p)), color };
  if (t === 'arrow') fg.sketch.head = arrowHead(pts[0], pts[1]);
  addShape(fg, m);
  pts = [];
  clearSnap();
  renderDraft();
}

function removeShape(fg) {
  if (hoverFg === fg) hoverFg = null;
  if (pickFg === fg) pickFg = null;
  hosts.get(fg.sketchHost)?.group.removeLayer(fg);
  shapes = shapes.filter(s => s !== fg);
  syncButtons();
}

// ================== CHỮ (MTEXT) ==================
const textHtml = (text, c, sizePx) =>
  `<div class="sketch-text-body" style="color:${c};font-size:${sizePx}px;">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

function textShape(latlng, text, c, sizePx, m) {
  const marker = L.marker(latlng, {
    icon: L.divIcon({ className: 'sketch-text', html: textHtml(text, c, sizePx), iconSize: null, iconAnchor: [0, 0] }),
    keyboard: false
  });
  const fg = L.featureGroup([marker]);
  fg.bindTooltip('Chữ · chuột phải để sửa hoặc xóa', { sticky: true, className: 'sketch-tip' });
  // Chiều cao chữ ngoài thực địa theo mức phóng lúc ghi (để DXF ra đúng cỡ như đang thấy)
  fg.sketch = { tool: 'text', pts: [L.latLng(latlng)], color: c, text, sizePx, heightM: sizePx * metersPerPixel(latlng.lat, m) };
  return fg;
}

function placeEditor() {
  if (!editor) return;
  const p = editor.map.latLngToContainerPoint(editor.latlng);
  editor.el.style.left = `${Math.round(p.x)}px`;
  editor.el.style.top = `${Math.round(p.y)}px`;
}

function fitEditor() {
  if (!editor) return;
  const el = editor.el;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function styleEditor() {
  if (!editor) return;
  editor.el.style.color = editor.color;
  editor.el.style.fontSize = `${editor.sizePx}px`;
  fitEditor();
}

function closeEditor(commit) {
  if (!editor) return;
  const ed = editor;
  editor = null;
  ed.map.off('move zoom', placeEditor);
  ed.el.remove();
  const text = ed.el.value.replace(/\s+$/, '');
  if (commit && text.trim()) addShape(textShape(ed.latlng, text, ed.color, ed.sizePx, ed.map), ed.map);
  else if (!commit && ed.restore) addShape(ed.restore, ed.map);
  syncButtons();
}

function openTextEditor(latlng, opts = {}, m) {
  closeEditor(true);
  const host = m || drawMap || map;
  const el = L.DomUtil.create('textarea', 'sketch-text-editor', host.getContainer());
  el.rows = 1;
  el.spellcheck = false;
  el.placeholder = 'Gõ chữ…';
  el.setAttribute('aria-label', 'Nội dung chữ phác thảo');
  el.value = opts.text || '';
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  editor = { el, latlng: L.latLng(latlng), color: opts.color || color, sizePx: opts.sizePx || textSize(), restore: opts.restore || null, map: host };
  attachTelex(el, () => telexOn);
  el.addEventListener('input', fitEditor);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
  });
  // Bấm sang bảng công cụ (đổi màu, cỡ chữ, Telex) không đóng ô gõ
  el.addEventListener('blur', (e) => {
    if (e.relatedTarget && $('sketchPalette')?.contains(e.relatedTarget)) return;
    setTimeout(() => { if (editor && editor.el === el && document.activeElement !== el) closeEditor(true); }, 0);
  });
  host.on('move zoom', placeEditor);
  placeEditor();
  styleEditor();
  setTimeout(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 0);
}

function refocusEditor() {
  if (!editor) return;
  styleEditor();
  setTimeout(() => editor?.el.focus(), 0);
}

/** Click bản đồ đang xem khi đang chọn 1 công cụ phác thảo. targetMap: bản đồ nhận click (quy hoạch hoặc hiện trạng). */
export function handleSketchClick(latlng, targetMap) {
  const tool = TOOLS[state.sketchTool];
  if (!tool) return;
  let m = targetMap || drawMap || map;
  const shown = shownMaps();
  if (shown.length === 1 && !shown.includes(m)) m = shown[0];
  if (!m) return;
  if (state.sketchTool === 'text') { openTextEditor(latlng, {}, m); return; }
  // Nét dở thuộc một bản đồ. Chia đôi lệch tâm thì click bên kia là tọa độ khác, bỏ qua.
  if (pts.length && drawMap && m !== drawMap && offsetSplit()) return;
  if (!pts.length) drawMap = m;
  hostOf(drawMap);
  const last = pts[pts.length - 1];
  if (last && pxDist(last, latlng) < DUP_PX) return;
  if (state.sketchTool === 'polygon' && pts.length >= 3 && pxDist(pts[0], latlng) < CLOSE_PX) { finish(); return; }
  pts.push(latlng);
  if (tool.points && pts.length >= tool.points) { finish(); return; }
  cursor = latlng;
  setSnap(pts.length - 1, drawMap);
  renderDraft();
}

function onMouseMove(e) {
  if (!state.sketchTool || state.sketchTool === 'text' || !pts.length || !drawMap) return;
  if (e.target !== drawMap && offsetSplit()) return;
  cursor = e.latlng;
  if (e.target === drawMap) setSnap(nearestSketchIndex(drawMap, e.latlng), drawMap);
  else setSnap(-1, null);
  renderDraft();
}

function onSketchContextMenu(e) {
  if (!state.sketchTool || state.sketchTool === 'text' || !pts.length || e.target !== drawMap || !e.latlng) return;
  const hit = nearestSketchIndex(drawMap, e.latlng);
  if (hit < 0) return;
  pts.splice(hit, 1);
  if (!pts.length) cursor = null;
  setSnap(pts.length ? nearestSketchIndex(drawMap, e.latlng) : -1, drawMap);
  renderDraft();
  syncButtons();
}

function onDblClick(e) {
  const tool = TOOLS[state.sketchTool];
  if (!tool || tool.points || state.sketchTool === 'text' || !pts.length) return;
  if (drawMap && e.target !== drawMap && offsetSplit()) return;
  finish();
}

function setHint(text) {
  const el = $('sketchHint');
  if (el) el.textContent = text || (state.sketchTool ? '' : `Chọn công cụ để vẽ trên ${targetPhrase()} · hình chỉ có trong phiên này, người khác không thấy · bấm Lưu để tải KML / DXF`);
}

function syncButtons() {
  document.querySelectorAll('#sketchPalette [data-tool]').forEach(b => {
    const on = b.dataset.tool === state.sketchTool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#sketchPalette [data-color]').forEach(b => b.classList.toggle('active', b.dataset.color === color));
  const undo = $('btnSketchUndo'), clear = $('btnSketchClear'), save = $('btnSketchSave');
  if (undo) undo.disabled = !pts.length && !shapes.length;
  if (clear) clear.disabled = !shapes.length;
  if (save) save.disabled = !shapes.length;
  const saveRow = $('sketchSaveRow');
  if (saveRow && !shapes.length) saveRow.hidden = true;
  if (save) save.setAttribute('aria-expanded', String(!!saveRow && !saveRow.hidden));
  const textRow = $('sketchTextRow');
  if (textRow) textRow.hidden = state.sketchTool !== 'text';
  const telexBtn = $('btnSketchTelex');
  if (telexBtn) {
    telexBtn.classList.toggle('active', telexOn);
    telexBtn.setAttribute('aria-pressed', String(telexOn));
  }
  const btn = $('btnSketch');
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-pressed', String(open));
    if (sketchBtnTitle) btn.title = open ? 'Tắt phác thảo (hình đã vẽ vẫn giữ)' : sketchBtnTitle;
  }
  syncBar();
}

function placeFloat(el, btn) {
  if (el && btn && !el.hidden) el.style.top = `${btn.offsetTop}px`;
}

/** Thanh đầy đủ khi chưa chọn công cụ hoặc khi mở lại; đang vẽ thì chỉ còn nút biểu tượng công cụ */
function syncBar() {
  const pal = $('sketchPalette');
  const pin = $('btnSketchPin');
  const btn = $('btnSketch');
  const showPin = !!(open && collapsed && state.sketchTool);
  if (pal) pal.hidden = !(open && !showPin);
  if (pin) {
    pin.hidden = !showPin;
    pin.classList.toggle('active', showPin);
    pin.setAttribute('aria-pressed', String(showPin));
    if (showPin) {
      const href = document.querySelector(`#sketchPalette [data-tool="${state.sketchTool}"] use`)?.getAttribute('href');
      const use = pin.querySelector('use');
      if (href && use) use.setAttribute('href', href);
      const label = TOOLS[state.sketchTool]?.label || 'Phác thảo';
      pin.title = `${label} đang bật · bấm để mở lại bảng công cụ`;
      pin.setAttribute('aria-label', `${label}, mở lại bảng công cụ phác thảo`);
    }
  }
  placeFloat(pal, btn);
  placeFloat(pin, btn);
}

function setTool(tool) {
  if (tool && !TOOLS[tool]) tool = null;
  if (tool !== 'text') closeEditor(true);
  clearDraft();
  pts = [];
  cursor = null;
  clearSnap();
  drawMap = null;
  if (tool && !state.sketchTool) announceTool('sketch');
  state.sketchTool = tool;
  collapsed = !!tool;
  syncMapChrome();
  setDrawAssist('sketch', !!tool && tool !== 'text');
  renderDraft();
  setHint(tool ? toolHint(tool) : '');
  syncButtons();
}

function syncMapChrome() {
  const tool = state.sketchTool;
  const shown = new Set(shownMaps());
  [map, planMap].filter(Boolean).forEach(m => {
    const on = !!tool && shown.has(m);
    const el = m.getContainer();
    el.classList.toggle('sketch-mode', on);
    el.classList.toggle('sketch-text-mode', on && tool === 'text');
    if (tool) m.doubleClickZoom.disable();
    else m.doubleClickZoom.enable();
  });
}

/** Tắt phác thảo (công cụ và thanh); các hình đã vẽ vẫn giữ */
export function stopSketchTool() {
  if (open) setOpen(false);
}

function setOpen(on) {
  open = on;
  if (!on) {
    collapsed = false;
    setTool(null);
  }
  setHint('');
  syncButtons();
}

async function importKmlFile(file) {
  let pack;
  try {
    pack = sketchShapesFromKml(await kmlTextFromFile(file));
  } catch (err) {
    const msg = err.message || 'Không nhập được file KML/KMZ.';
    setHint(msg);
    showToast(`❌ ${msg}`, 'error');
    return;
  }
  const host = shownMaps()[0] || map;
  for (const s of pack.shapes) {
    if (s.tool === 'text') {
      addShape(textShape(s.pts[0], s.text, color, textSize(), host), host);
      continue;
    }
    const lls = s.pts.map(p => L.latLng(p.lat, p.lng));
    const { layers, text } = shapeLayers(s.tool, lls, color, false);
    const fg = L.featureGroup(layers);
    fg.sketch = { tool: s.tool, pts: lls, color };
    const label = TOOLS[s.tool]?.label || 'Hình';
    fg.bindTooltip(`${label} · ${text} · ${stateName(host)} · chuột phải để xóa`, { sticky: true, className: 'sketch-tip' });
    addShape(fg, host);
  }
  const bounds = L.latLngBounds(pack.shapes.flatMap(s => s.pts.map(p => [p.lat, p.lng])));
  if (bounds.isValid()) host.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  if (!open) setOpen(true);
  const extra = pack.dropped ? ` Bỏ qua ${pack.dropped} hình (lỗi tọa độ hoặc vượt 400 hình).` : '';
  const msg = `Đã nhập ${pack.shapes.length} hình từ ${file.name} vào phác thảo (chỉ phiên này).${extra}`;
  setHint(msg);
  showToast(`✓ Đã nhập ${pack.shapes.length} hình KML/KMZ`, 'success');
}

function saveAs(kind) {
  closeEditor(true);
  const items = shapes.map(fg => fg.sketch).filter(Boolean);
  if (!items.length) return;
  if (kind === 'dxf') exportDxf(items); else exportKml(items);
  setHint(kind === 'dxf'
    ? `Đã tải DXF (${items.length} hình, VN-2000 TT-Huế KTT 107°00', mét)`
    : `Đã tải KML (${items.length} hình, WGS84)`);
  const row = $('sketchSaveRow');
  if (row) row.hidden = true;
  syncButtons();
}

export function initSketchLayer() {
  if (!map) return;
  hostOf(map);
  if (planMap) hostOf(planMap);
  onViewChange(() => {
    syncMapChrome();
    if (editor?.map && !shownMaps().includes(editor.map)) closeEditor(true);
    if (drawMap && pts.length && !shownMaps().includes(drawMap)) {
      clearDraft();
      pts = [];
      cursor = null;
      clearSnap();
      drawMap = null;
      syncButtons();
    }
    if (state.sketchTool && !pts.length && !editor) setHint(toolHint(state.sketchTool));
    else if (open && !state.sketchTool && !pts.length) setHint('');
  });

  const pal = $('sketchPalette');
  const sketchBtn = $('btnSketch');
  sketchBtnTitle = sketchBtn?.title || '';
  pal?.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); });
  sketchBtn?.addEventListener('click', () => setOpen(!open));
  $('btnSketchPin')?.addEventListener('click', () => {
    collapsed = false;
    syncButtons();
  });
  // Bật đo đạc, tra cứu, ghim, vẽ tuyến…: bỏ chọn công cụ phác thảo (hình đã vẽ vẫn giữ)
  document.addEventListener(TOOL_START_EVENT, (e) => { if (e.detail !== 'sketch') stopSketchTool(); });
  $('sketchTextSize')?.addEventListener('change', () => {
    if (editor) { editor.sizePx = textSize(); refocusEditor(); }
  });
  pal?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { setTool(state.sketchTool === t.dataset.tool ? null : t.dataset.tool); return; }
    const c = e.target.closest('[data-color]');
    if (c) {
      color = c.dataset.color;
      if (editor) { editor.color = color; refocusEditor(); }
      renderDraft(); syncButtons(); return;
    }
    if (e.target.closest('#btnSketchTelex')) { telexOn = !telexOn; syncButtons(); refocusEditor(); return; }
    const exp = e.target.closest('[data-export]');
    if (exp) { saveAs(exp.dataset.export); return; }
    if (e.target.closest('#btnSketchSave')) {
      closeEditor(true);
      const row = $('sketchSaveRow');
      if (row && shapes.length) row.hidden = !row.hidden;
      syncButtons();
      return;
    }
    if (e.target.closest('#btnSketchUndo')) {
      if (pts.length) {
        pts.pop();
        setSnap(cursor && drawMap && pts.length ? nearestSketchIndex(drawMap, cursor) : -1, drawMap);
        renderDraft();
        syncButtons();
      } else if (shapes.length) removeShape(shapes[shapes.length - 1]);
      return;
    }
    if (e.target.closest('#btnSketchClear')) {
      if (shapes.length && confirm(`Xóa toàn bộ ${shapes.length} hình phác thảo?`)) {
        hosts.forEach(h => h.group.clearLayers());
        shapes = [];
        hoverFg = null;
        pickFg = null;
        syncButtons();
      }
      return;
    }
    if (e.target.closest('#btnSketchImport')) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) importKmlFile(file);
      });
      input.click();
      return;
    }
    if (e.target.closest('#btnSketchClose')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (!state.sketchTool || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { if (pts.length) { pts = []; cursor = null; clearSnap(); renderDraft(); syncButtons(); } else setTool(null); }
    else if (e.key === 'Enter') finish();
    else if (e.key === 'Backspace' && pts.length) {
      e.preventDefault();
      pts.pop();
      setSnap(cursor && drawMap && pts.length ? nearestSketchIndex(drawMap, cursor) : -1, drawMap);
      renderDraft();
      syncButtons();
    }
  });
  syncButtons();
}
