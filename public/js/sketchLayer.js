// Phác thảo trên bản đồ hiện trạng: đường thẳng, đường gấp khúc, đa giác, mũi tên, vòng tròn, chữ (nhiều dòng, gõ Telex).
// Hình chỉ nằm trong bộ nhớ trang: không gửi máy chủ, không ghi Sheet / bucket / localStorage → người khác không thấy,
// đóng hoặc tải lại trang là mất; nút Lưu tải về máy file KML hoặc DXF (sketchExport.js).
import { state } from './state.js';
import { map, clearMeasure } from './mapEngine.js';
import { escapeHtml, fmtNum, ico } from './utils.js';
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

const $ = (id) => document.getElementById(id);
let group = null;           // các hình đã vẽ
let draft = null;           // hình đang vẽ (xem trước theo con trỏ)
let shapes = [];            // [L.FeatureGroup] theo thứ tự vẽ (để hoàn tác); fg.sketch = dữ liệu để xuất file
let pts = [];               // đỉnh của hình đang vẽ
let cursor = null;
let color = COLORS[0];
let open = false;
let telexOn = true;
let editor = null;          // { el, latlng, restore } ô gõ chữ đang mở

const proj = (ll) => L.CRS.EPSG3857.project(L.latLng(ll));
const unproj = (p) => L.CRS.EPSG3857.unproject(p);
const distM = (a, b) => L.latLng(a).distanceTo(b);
const fmtLen = (m) => (m >= 1000 ? `${fmtNum(Math.round(m / 10) / 100)} km` : `${fmtNum(Math.round(m))} m`);
const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`);
const pathLen = (lls) => lls.slice(1).reduce((s, p, i) => s + distM(lls[i], p), 0);
const polyArea = (lls) => turf.area(turf.polygon([[...lls, lls[0]].map(p => [p.lng, p.lat])]));
const pxDist = (a, b) => map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));
const metersPerPixel = (lat) => 40075016.686 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
const textSize = () => Number($('sketchTextSize')?.value) || 16;

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

/** Click hình đã vẽ (khi không chọn công cụ) → menu nhỏ: sửa chữ / xóa */
function bindShapeMenu(fg) {
  fg.on('click', (e) => {
    if (state.sketchTool) return;          // đang vẽ: click để đặt đỉnh, không mở menu
    L.DomEvent.stopPropagation(e);
    const box = L.DomUtil.create('div', 'sketch-menu');
    if (fg.sketch.tool === 'text') {
      const edit = L.DomUtil.create('button', 'ui-btn-format sketch-del', box);
      edit.type = 'button';
      edit.innerHTML = `${ico('pen')}Sửa chữ`;
      edit.addEventListener('click', () => {
        map.closePopup();
        const s = fg.sketch;
        removeShape(fg);
        openTextEditor(s.pts[0], { text: s.text, color: s.color, sizePx: s.sizePx, restore: fg });
      });
    }
    const del = L.DomUtil.create('button', 'ui-btn-format sketch-del', box);
    del.type = 'button';
    del.innerHTML = `${ico('trash')}Xóa hình này`;
    del.addEventListener('click', () => { removeShape(fg); map.closePopup(); });
    L.popup({ className: 'sketch-popup', closeButton: false }).setLatLng(e.latlng).setContent(box).openOn(map);
  });
}

function addShape(fg) {
  bindShapeMenu(fg);
  fg.addTo(group);
  shapes.push(fg);
  syncButtons();
}

function finish() {
  const t = state.sketchTool;
  const tool = TOOLS[t];
  if (!tool || t === 'text') return;
  const need = tool.points || tool.min;
  if (pts.length < need) { pts = []; renderDraft(); return; }
  const { layers, text } = shapeLayers(t, pts, color, false);
  const fg = L.featureGroup(layers);
  fg.bindTooltip(`${tool.label} · ${text}`, { sticky: true, className: 'sketch-tip' });
  fg.sketch = { tool: t, pts: pts.map(p => L.latLng(p)), color };
  if (t === 'arrow') fg.sketch.head = arrowHead(pts[0], pts[1]);
  addShape(fg);
  pts = [];
  renderDraft();
}

function removeShape(fg) {
  group?.removeLayer(fg);
  shapes = shapes.filter(s => s !== fg);
  syncButtons();
}

// ================== CHỮ (MTEXT) ==================
const textHtml = (text, c, sizePx) =>
  `<div class="sketch-text-body" style="color:${c};font-size:${sizePx}px;">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

function textShape(latlng, text, c, sizePx) {
  const marker = L.marker(latlng, {
    icon: L.divIcon({ className: 'sketch-text', html: textHtml(text, c, sizePx), iconSize: null, iconAnchor: [0, 0] }),
    keyboard: false
  });
  const fg = L.featureGroup([marker]);
  // Chiều cao chữ ngoài thực địa theo mức phóng lúc ghi (để DXF ra đúng cỡ như đang thấy)
  fg.sketch = { tool: 'text', pts: [L.latLng(latlng)], color: c, text, sizePx, heightM: sizePx * metersPerPixel(latlng.lat) };
  return fg;
}

function placeEditor() {
  if (!editor) return;
  const p = map.latLngToContainerPoint(editor.latlng);
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
  map.off('move zoom', placeEditor);
  ed.el.remove();
  const text = ed.el.value.replace(/\s+$/, '');
  if (commit && text.trim()) addShape(textShape(ed.latlng, text, ed.color, ed.sizePx));
  else if (!commit && ed.restore) addShape(ed.restore);
  syncButtons();
}

function openTextEditor(latlng, opts = {}) {
  closeEditor(true);
  const el = L.DomUtil.create('textarea', 'sketch-text-editor', map.getContainer());
  el.rows = 1;
  el.spellcheck = false;
  el.placeholder = 'Gõ chữ…';
  el.setAttribute('aria-label', 'Nội dung chữ phác thảo');
  el.value = opts.text || '';
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  editor = { el, latlng: L.latLng(latlng), color: opts.color || color, sizePx: opts.sizePx || textSize(), restore: opts.restore || null };
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
  map.on('move zoom', placeEditor);
  placeEditor();
  styleEditor();
  setTimeout(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 0);
}

function refocusEditor() {
  if (!editor) return;
  styleEditor();
  setTimeout(() => editor?.el.focus(), 0);
}

/** Click bản đồ hiện trạng khi đang chọn 1 công cụ phác thảo */
export function handleSketchClick(latlng) {
  const tool = TOOLS[state.sketchTool];
  if (!tool) return;
  if (state.sketchTool === 'text') { openTextEditor(latlng); return; }
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
  const tool = TOOLS[state.sketchTool];
  if (tool && !tool.points && state.sketchTool !== 'text') finish();
}

function setHint(text) {
  const el = $('sketchHint');
  if (el) el.textContent = text || (state.sketchTool ? '' : 'Chọn công cụ để vẽ · hình chỉ có trong phiên này, người khác không thấy · bấm Lưu để tải KML / DXF');
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
  }
}

function setTool(tool) {
  if (tool && !TOOLS[tool]) tool = null;
  if (tool !== 'text') closeEditor(true);
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
  map.getContainer().classList.toggle('sketch-text-mode', tool === 'text');
  setDrawAssist('sketch', !!tool && tool !== 'text');
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
  group = L.featureGroup().addTo(map);
  draft = L.layerGroup().addTo(map);
  map.on('mousemove', onMouseMove);
  map.on('dblclick', onDblClick);

  const pal = $('sketchPalette');
  pal?.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); });
  $('btnSketch')?.addEventListener('click', () => setOpen(!open));
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
      if (pts.length) { pts.pop(); renderDraft(); syncButtons(); }
      else if (shapes.length) removeShape(shapes[shapes.length - 1]);
      return;
    }
    if (e.target.closest('#btnSketchClear')) {
      if (shapes.length && confirm(`Xóa toàn bộ ${shapes.length} hình phác thảo?`)) {
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
