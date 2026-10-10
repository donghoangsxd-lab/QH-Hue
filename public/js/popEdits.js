// Hiệu chỉnh raster phân bổ dân cư: Admin tô cọ / vẽ vùng xóa pixel dân cư (sông, ruộng, khu công nghiệp...) hoặc thêm pixel
// (khu dân cư mới) → pop/edits.json trên bucket; máy chủ áp các vùng lên raster khi tính (services/popEditsService.js).
// Dân số phường giữ nguyên: đổi pixel chỉ đổi cách phân bổ dân trong phường (độ phủ, dân số được phục vụ).
// Cọ: mỗi nét = đường đi của chuột nới rộng nửa cỡ cọ; các nét gộp (union) thành vùng, lưu như vùng vẽ tay (có thể có lỗ).
import { state } from './state.js';
import { geeApi } from './api.js';
import { map, loadPopulationLayer } from './mapEngine.js';
import { escapeHtml, fmtNum, ico, setStatusContent, announceTool, TOOL_START_EVENT } from './utils.js';
import { postAdmin } from './wardRoads.js';
import { reloadWardStats } from './uiComponents.js';
import { setDrawAssist } from './drawAssist.js';

const PIXEL_M2 = 900; // ô raster 30 m × 30 m (ước lượng số pixel trong vùng)
const MIN_AREA_M2 = 100;
const MAX_RING_POINTS = 500;       // = giới hạn máy chủ (services/popEditsService.js)
const MAX_HOLES = 50;
const SIMPLIFY_DEG = [0.000005, 0.00001, 0.00002, 0.00004, 0.00008]; // ~0,5 → 8 m, thử dần tới khi đủ ít đỉnh
const OPS = {
  remove: { label: 'Xóa pixel dân cư', color: '#f87171' },
  add: { label: 'Thêm pixel dân cư', color: '#4ade80' }
};
const TOOL_TEXT = {
  brush: {
    draw: 'Bắt đầu tô', undo: 'Hoàn tác nét', undoTitle: 'Xóa nét cọ cuối (Backspace / Ctrl+Z)',
    hint: 'Giữ chuột trái và rê để tô (pixel có tâm nằm trong vùng tô sẽ đổi). Giữ phím Space + kéo để di chuyển bản đồ, lăn chuột để phóng. Esc: dừng tô.'
  },
  polygon: {
    draw: 'Vẽ vùng mới', undo: 'Xóa đỉnh', undoTitle: 'Xóa đỉnh cuối (Backspace)',
    hint: 'Click bản đồ hiện trạng để đặt đỉnh vùng (tự khép kín). Esc: dừng vẽ.'
  }
};

const $ = (id) => document.getElementById(id);
const R = 6371008.8, RAD = Math.PI / 180;
const distM = (a, b) => R * Math.hypot((b.lat - a.lat) * RAD, (b.lng - a.lng) * RAD * Math.cos((a.lat + b.lat) / 2 * RAD));

let edits = [];          // danh sách trên bucket
let savedAt = 0;         // phiên bản đang sửa (gửi kèm khi lưu)
let baseAsset = null;    // raster nền đã ghi cố định (null = Pixel-danso gốc)
let bake = null;         // tác vụ ghi cố định đang chạy: { task, asset, at }
let bakeTimer = null;
const BAKE_POLL_MS = 20000;
let loaded = false;
let busy = false;
let vertices = [];       // vùng đa giác đang vẽ: [{ lat, lng }]
let strokes = [];        // nét cọ đã tô: [Feature<Polygon>]
let merged = null;       // hợp các nét cọ: Feature<Polygon | MultiPolygon> | null
let stroke = null;       // nét đang tô: [{ lat, lng }]
let spaceDown = false;
let roadsWereOn = false; // lớp mạng lưới đường đang bật trước khi mở panel → bật lại khi đóng
let listLayer = null, drawLayer = null, cursorLayer = null;

const drawing = () => state.adminDrawMode === 'pop';
const selectedOp = () => ($('popOp')?.value === 'add' ? 'add' : 'remove');
const selectedTool = () => ($('popTool')?.value === 'polygon' ? 'polygon' : 'brush');
const brushing = () => drawing() && selectedTool() === 'brush';
const brushM = () => Math.max(30, Number($('popBrush')?.value) || 60);
const ringOf = (pts) => [...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]];
const areaM2 = (ring, holes) => turf.area(turf.polygon([ring, ...(holes || [])]));
const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`);
const fmtPixels = (m2) => `~${fmtNum(Math.max(1, Math.round(m2 / PIXEL_M2)))} pixel`;
const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);
const metersPerPixel = (lat) => 40075016.686 * Math.cos(lat * RAD) / Math.pow(2, map.getZoom() + 8);

function setStatus(text, color) {
  const el = $('popStatus');
  if (!el) return;
  setStatusContent(el, text);
  el.style.color = color || '';
}

/** Vùng tự cắt (hình nơ) → GEE tô sai, không cho lưu */
function selfIntersects(ring) {
  try { return turf.kinks(turf.polygon([ring])).features.length > 0; } catch (e) { return true; }
}

// ================== CỌ TÔ ==================
function strokeFeature(pts) {
  const coords = pts.map(p => [p.lng, p.lat]);
  const geom = coords.length === 1 ? turf.point(coords[0]) : turf.lineString(coords);
  return turf.buffer(geom, brushM() / 2, { units: 'meters', steps: 6 });
}

function unionAll(list) {
  let out = null;
  for (const f of list) {
    try { out = out ? turf.union(out, f) : f; } catch (e) { /* nét lỗi hình học: bỏ qua */ }
  }
  return out;
}

function updateCursor(latlng) {
  if (!cursorLayer) return;
  cursorLayer.clearLayers();
  if (!latlng || !brushing() || spaceDown) return;
  L.circle(latlng, { radius: brushM() / 2, color: OPS[selectedOp()].color, weight: 1.5, fill: false, interactive: false }).addTo(cursorLayer);
}

function onBrushDown(e) {
  if (!brushing() || busy || spaceDown || e.originalEvent.button !== 0) return;
  stroke = [e.latlng];
  renderDraft();
}

function onBrushMove(e) {
  if (!brushing()) return;
  updateCursor(e.latlng);
  if (!stroke) return;
  if (distM(stroke[stroke.length - 1], e.latlng) < brushM() / 5) return;
  stroke.push(e.latlng);
  renderStroke();
}

function onBrushUp() {
  if (!stroke) return;
  const pts = stroke;
  stroke = null;
  try {
    const f = strokeFeature(pts);
    strokes.push(f);
    merged = unionAll(merged ? [merged, f] : [f]);
  } catch (err) {
    setStatus('⚠ Nét cọ lỗi hình học, tô lại.', 'var(--accent-orange)');
  }
  renderDraft();
}

let strokeLine = null;
function renderStroke() {
  if (!drawLayer || !stroke) return;
  const weight = Math.max(2, brushM() / metersPerPixel(stroke[0].lat));
  const latlngs = stroke.length === 1 ? [stroke[0], stroke[0]] : stroke;
  if (strokeLine && drawLayer.hasLayer(strokeLine)) {
    strokeLine.setLatLngs(latlngs);
    strokeLine.setStyle({ weight });
  } else {
    strokeLine = L.polyline(latlngs, { color: OPS[selectedOp()].color, weight, opacity: 0.4, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(drawLayer);
  }
}

/** Space giữ = kéo bản đồ (như Photoshop); thả = tô tiếp */
function setSpace(on) {
  spaceDown = on;
  if (!map || !brushing()) return;
  if (on) map.dragging.enable(); else map.dragging.disable();
  map.getContainer().style.cursor = on ? 'grab' : 'crosshair';
  updateCursor(null);
}

/** Hợp các nét → các vùng lưu được: vòng ngoài + lỗ, đã giảm đỉnh ≤ MAX_RING_POINTS, không tự cắt */
function brushPolygons() {
  if (!merged) return { polys: [], dropped: 0 };
  const polys = [];
  let dropped = 0;
  turf.flatten(merged).features.forEach(f => {
    let ok = null;
    for (const tol of SIMPLIFY_DEG) {
      let g;
      try { g = turf.simplify(f, { tolerance: tol, highQuality: true }); } catch (e) { continue; }
      const [outer, ...rest] = g.geometry.coordinates;
      if (!outer || outer.length < 4 || outer.length > MAX_RING_POINTS + 1 || selfIntersects(outer)) continue;
      const holes = rest.filter(h => h.length >= 4 && h.length <= MAX_RING_POINTS + 1)
        .sort((a, b) => areaM2(b) - areaM2(a)).slice(0, MAX_HOLES);
      ok = { ring: outer, holes };
      break;
    }
    const round = (ring) => ring.map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
    if (ok && areaM2(ok.ring, ok.holes) >= MIN_AREA_M2) polys.push({ ring: round(ok.ring), holes: ok.holes.map(round) });
    else dropped++;
  });
  return { polys, dropped };
}

// ================== VẼ ==================
function renderDraft() {
  if (!drawLayer) return;
  drawLayer.clearLayers();
  strokeLine = null;
  const color = OPS[selectedOp()].color;
  const tool = selectedTool();
  let bad = false, ready = false;
  const info = $('popDrawInfo');

  if (tool === 'brush') {
    if (merged) L.geoJSON(merged, { style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.3 }, interactive: false }).addTo(drawLayer);
    renderStroke();
    ready = !!merged;
    if (info) {
      info.innerHTML = merged
        ? `<b>${strokes.length}</b> nét · <b>${fmtArea(turf.area(merged))}</b> · ${fmtPixels(turf.area(merged))} · cọ ${fmtNum(brushM())} m`
        : (drawing() ? `Giữ chuột trái và rê trên bản đồ hiện trạng để tô (cọ ${fmtNum(brushM())} m ≈ ${fmtNum(Math.round(brushM() / 30 * 10) / 10)} pixel)` : '');
    }
  } else {
    const latlngs = vertices.map(v => [v.lat, v.lng]);
    if (latlngs.length >= 3) L.polygon(latlngs, { color, weight: 2, dashArray: '6,5', fillColor: color, fillOpacity: 0.25, interactive: false }).addTo(drawLayer);
    else if (latlngs.length === 2) L.polyline(latlngs, { color, weight: 2, dashArray: '6,5', interactive: false }).addTo(drawLayer);
    latlngs.forEach(ll => L.circleMarker(ll, { radius: 4, color, weight: 2, fillColor: '#0f172a', fillOpacity: 1, interactive: false }).addTo(drawLayer));
    ready = vertices.length >= 3;
    if (info) {
      if (vertices.length >= 3) {
        const ring = ringOf(vertices);
        const m2 = areaM2(ring);
        bad = selfIntersects(ring);
        info.innerHTML = `<b>${vertices.length}</b> đỉnh · <b>${fmtArea(m2)}</b> · ${fmtPixels(m2)}`
          + (bad ? ' · <span style="color:var(--accent-red);">vùng tự cắt — sửa lại đỉnh</span>' : '');
      } else {
        info.innerHTML = vertices.length
          ? `<b>${vertices.length}</b> đỉnh — cần ít nhất 3 đỉnh`
          : (drawing() ? 'Click lên bản đồ hiện trạng để đặt đỉnh đầu tiên' : '');
      }
    }
  }
  const save = $('btnPopSave');
  if (save) save.disabled = !ready || bad || busy || !!bake;
  const undo = $('btnPopUndo');
  if (undo) undo.disabled = tool === 'brush' ? !strokes.length : !vertices.length;
}

function renderEdits() {
  if (listLayer) {
    listLayer.clearLayers();
    edits.forEach(e => {
      const o = OPS[e.op];
      L.polygon([toLatLngs(e.ring), ...(e.holes || []).map(toLatLngs)], { color: o.color, weight: 2, fillColor: o.color, fillOpacity: 0.15 })
        .bindTooltip(`${escapeHtml(e.name || 'Vùng không tên')} · ${o.label}`, { sticky: true })
        .addTo(listLayer);
    });
  }
  renderBake();
  const list = $('popList');
  if (!list) return;
  if (!loaded) { list.innerHTML = `<div class="cad-row">${ico('clock')}Đang tải danh sách vùng hiệu chỉnh...</div>`; return; }
  if (!edits.length) { list.innerHTML = ''; return; }
  list.innerHTML = edits.slice().sort((a, b) => b.at - a.at).map(e => {
    const o = OPS[e.op];
    const m2 = areaM2(e.ring, e.holes);
    return `<div class="cad-row" data-edit="${e.id}" title="Bấm để phóng tới vùng">
      <span class="cad-dot" style="background:${o.color};"></span>
      <div class="cad-row-main"><b>${escapeHtml(e.name || 'Vùng không tên')}</b><br>
        <small>${o.label} · ${fmtArea(m2)} · ${fmtPixels(m2)}</small></div>
      <button type="button" class="road-del" data-del="${e.id}" title="Xóa vùng khỏi bucket (khôi phục raster gốc)" aria-label="Xóa vùng">${ico('trash')}</button>
    </div>`;
  }).join('');
}

function syncToolUi() {
  const tool = selectedTool();
  const t = TOOL_TEXT[tool];
  ['popBrushLabel', 'popBrushRow'].forEach(id => { const el = $(id); if (el) el.style.display = tool === 'brush' ? '' : 'none'; });
  const val = $('popBrushVal');
  if (val) val.textContent = `${fmtNum(brushM())} m`;
  const btn = $('btnPopDraw');
  if (btn) {
    btn.innerHTML = drawing() ? `${ico('stop')}Dừng ${tool === 'brush' ? 'tô' : 'vẽ'}` : `${ico('pen')}${t.draw}`;
    btn.classList.toggle('active', drawing());
    btn.setAttribute('aria-pressed', String(drawing()));
  }
  const undo = $('btnPopUndo');
  if (undo) { undo.innerHTML = `${ico('undo')}${t.undo}`; undo.title = t.undoTitle; }
  const hint = $('popHint');
  if (hint) hint.textContent = `${t.hint} Tổng dân số phường giữ nguyên: xóa pixel thì dân dồn sang pixel còn lại.`;
}

function undoLast() {
  if (selectedTool() === 'brush') {
    strokes.pop();
    merged = unionAll(strokes);
  } else {
    vertices.pop();
  }
  renderDraft();
}

function clearDraft() {
  vertices = [];
  strokes = [];
  merged = null;
  stroke = null;
}

// ================== ĐỌC / LƯU ==================
async function loadEdits() {
  loaded = false;
  renderEdits();
  try {
    const res = await fetch(geeApi('action=getPopEdits'), { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(d.edits)) throw new Error(d.message || `HTTP ${res.status}`);
    edits = d.edits;
    savedAt = Number(d.saved) || 0;
    baseAsset = d.asset || null;
    bake = d.bake || null;
    loaded = true;
    if (bake) pollBake();
  } catch (err) {
    setStatus(`❌ Chưa tải được danh sách vùng hiệu chỉnh: ${err.message}`, 'var(--accent-red)');
  }
  renderEdits();
}

// ================== GHI CỐ ĐỊNH VÀO ASSET ==================
const assetName = (id) => String(id || '').split('/').pop();

function renderBake() {
  const info = $('popAssetInfo');
  if (info) {
    info.innerHTML = !loaded ? ''
      : bake ? `${ico('clock')}GEE đang xuất asset <b>${escapeHtml(assetName(bake.asset))}</b> (thường 2–10 phút) — tạm khóa sửa vùng`
        : `Raster nền: <b>${escapeHtml(baseAsset ? assetName(baseAsset) : 'Pixel-danso (gốc)')}</b>`
          + (edits.length ? ` · ${fmtNum(edits.length)} vùng đang áp khi tính` : ' · không có vùng chờ ghi');
  }
  const btn = $('btnPopBake');
  if (btn) btn.disabled = !loaded || busy || !!bake || !edits.length || state.currentUserRole !== 'ADMIN';
}

function stopBakePoll() {
  clearTimeout(bakeTimer);
  bakeTimer = null;
}

function pollBake() {
  stopBakePoll();
  if (!bake) return;
  bakeTimer = setTimeout(checkBake, BAKE_POLL_MS);
}

async function checkBake() {
  bakeTimer = null;
  if (!bake || !listLayer) return;
  try {
    const d = await postAdmin('popBakeStatus', {});
    if (d.state === 'DONE' || d.state === 'NONE') {
      bake = null;
      edits = [];
      baseAsset = d.asset || null;
      savedAt = Number(d.at) || Date.now();
      renderEdits();
      if (d.state === 'DONE') {
        setStatus(`✓ Đã ghi cố định vào asset ${assetName(baseAsset)} — đang tải lại lớp dân cư...`, 'var(--accent-green)');
        await loadPopulationLayer(savedAt);
        reloadWardStats();
        setStatus(`✓ Đã ghi cố định vào asset ${assetName(baseAsset)}; danh sách vùng đã gộp vào raster nền.`, 'var(--accent-green)');
      }
      return;
    }
    if (d.state === 'FAILED' || d.state === 'CANCELLED') {
      bake = null;
      renderEdits();
      renderDraft();
      setStatus(`❌ Tác vụ GEE ${d.state === 'FAILED' ? 'lỗi' : 'bị hủy'}${d.error ? `: ${d.error}` : ''} — các vùng vẫn áp như cũ.`, 'var(--accent-red)');
      return;
    }
  } catch (err) {
    setStatus(`⚠️ Chưa đọc được trạng thái tác vụ: ${err.message}`, 'var(--accent-orange)');
  }
  pollBake();
}

async function bakeNow() {
  if (busy || bake || !edits.length) return;
  if (!confirm(`Ghi cố định ${edits.length} vùng hiệu chỉnh vào asset GEE mới?\n\n`
    + '• GEE xuất raster chạy nền khoảng 2–10 phút; trong lúc đó không sửa vùng được (bản đồ vẫn hiển thị đúng).\n'
    + '• Xong: asset mới làm raster nền, danh sách vùng được xóa (đã nằm trong asset).\n'
    + '• Asset gốc Pixel-danso giữ nguyên.')) return;
  busy = true;
  renderBake();
  setStatus('⏳ Đang gửi tác vụ xuất asset lên GEE...', 'var(--accent-orange)');
  try {
    const d = await postAdmin('bakePopEdits', { base: savedAt });
    bake = d.bake;
    setStatus(`⏳ GEE đang xuất asset ${assetName(bake.asset)} — tự kiểm tra mỗi ${BAKE_POLL_MS / 1000} giây (đóng panel thì lần mở sau kiểm tra tiếp).`, 'var(--accent-orange)');
    pollBake();
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderEdits();
    renderDraft();
  }
}

/** Ghi đè danh sách → tải lại lớp dân cư + bảng thống kê phường (độ phủ tính lại theo raster mới) */
async function persist(next, okText) {
  const data = await postAdmin('savePopEdits', { edits: next, base: savedAt });
  edits = next;
  savedAt = Number(data.at) || Date.now();
  renderEdits();
  setStatus(`${okText} — đang tính lại lớp dân cư và độ phủ...`, 'var(--accent-green)');
  await loadPopulationLayer(savedAt);
  reloadWardStats();
  setStatus(okText, 'var(--accent-green)');
}

async function saveDraft() {
  if (busy || !loaded) return;
  if (state.currentUserRole !== 'ADMIN') { setStatus('Cần đăng nhập Admin.', 'var(--accent-red)'); return; }
  const op = selectedOp();
  const name = String($('popName')?.value || '').trim().slice(0, 120);
  let shapes, dropped = 0;
  if (selectedTool() === 'brush') {
    if (!merged) return;
    ({ polys: shapes, dropped } = brushPolygons());
    if (!shapes.length) { setStatus('Vùng tô quá nhỏ hoặc quá phức tạp — tô lại.', 'var(--accent-orange)'); return; }
  } else {
    if (vertices.length < 3) return;
    const ring = ringOf(vertices).map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
    if (areaM2(ring) < MIN_AREA_M2) { setStatus(`Vùng quá nhỏ (< ${MIN_AREA_M2} m²).`, 'var(--accent-orange)'); return; }
    if (selfIntersects(ring)) { setStatus('Vùng tự cắt — sửa lại đỉnh.', 'var(--accent-orange)'); return; }
    shapes = [{ ring, holes: [] }];
  }
  const now = Date.now();
  const used = new Set(edits.map(e => e.id));
  const added = shapes.map((s, i) => {
    let n = now + i;
    while (used.has(`P${n.toString(36)}`)) n++;
    used.add(`P${n.toString(36)}`);
    const edit = { id: `P${n.toString(36)}`, op, name, ring: s.ring, at: now };
    if (s.holes.length) edit.holes = s.holes;
    return edit;
  });
  const m2 = added.reduce((sum, e) => sum + areaM2(e.ring, e.holes), 0);
  busy = true;
  renderDraft();
  setStatus('⏳ Đang ghi vùng lên bucket...', 'var(--accent-orange)');
  try {
    await persist([...edits, ...added], `✓ Đã lưu "${name || 'Vùng không tên'}" (${OPS[op].label}, ${fmtArea(m2)}`
      + `${added.length > 1 ? `, ${added.length} vùng` : ''}${dropped ? `, bỏ ${dropped} mảnh quá nhỏ` : ''})`);
    clearDraft();
    if ($('popName')) $('popName').value = '';
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderDraft();
  }
}

async function deleteEdit(id) {
  const e = edits.find(x => x.id === id);
  if (!e || busy) return;
  if (bake) { setStatus('Đang ghi cố định vào asset — chờ tác vụ GEE xong rồi sửa tiếp.', 'var(--accent-orange)'); return; }
  if (!confirm(`Xóa vùng "${e.name || 'Vùng không tên'}" (${OPS[e.op].label})? Pixel trong vùng trở về như raster gốc.`)) return;
  busy = true;
  setStatus('⏳ Đang xóa vùng...', 'var(--accent-orange)');
  try {
    await persist(edits.filter(x => x.id !== id), '✓ Đã xóa vùng');
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderDraft();
  }
}

function zoomToEdit(id) {
  const e = edits.find(x => x.id === id);
  if (!e || !map) return;
  map.fitBounds(L.latLngBounds(toLatLngs(e.ring)), { maxZoom: 18, padding: [40, 40] });
}

// ================== CHẾ ĐỘ VẼ ==================
function setDrawing(on) {
  if (on) {
    if (!drawing()) announceTool('pop');
    state.adminDrawMode = 'pop';
  } else if (drawing()) state.adminDrawMode = null;
  stroke = null;
  spaceDown = false;
  if (map) {
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    // Cọ: giữ chuột trái là tô nên tắt kéo bản đồ (Space + kéo để di chuyển)
    if (on && selectedTool() === 'brush') map.dragging.disable(); else map.dragging.enable();
  }
  updateCursor(null);
  setDrawAssist('pop', on);
  syncToolUi();
  renderDraft();
}

/** Bật / tắt lớp mạng lưới đường qua ô chọn trong bảng lớp (giữ đồng bộ checkbox) */
function setRoadsLayer(on) {
  const chk = $('chk_roads');
  if (chk && chk.checked !== on) chk.click();
}

/** Panel "Pixel dân cư" đang hiện (Admin) → hiện các vùng + bật lớp dân cư, tắt lớp mạng lưới đường (nặng); ẩn panel → dừng vẽ, khôi phục */
function syncPanel() {
  const panel = $('addPop');
  const visible = !!panel && panel.offsetParent !== null && state.currentUserRole === 'ADMIN';
  if (!map) return;
  if (visible) {
    if (!listLayer) {
      listLayer = L.layerGroup().addTo(map);
      const chk = $('chk_pop');
      if (chk && !chk.checked) chk.click();
      roadsWereOn = !!$('chk_roads')?.checked;
      setRoadsLayer(false);
    }
    if (!drawLayer) drawLayer = L.layerGroup().addTo(map);
    if (!cursorLayer) cursorLayer = L.layerGroup().addTo(map);
    if (!loaded) loadEdits();
    syncToolUi();
    renderEdits();
    renderDraft();
  } else {
    if (drawing()) setDrawing(false);
    if (listLayer && roadsWereOn) setRoadsLayer(true);
    roadsWereOn = false;
    listLayer?.remove(); listLayer = null;
    drawLayer?.remove(); drawLayer = null;
    cursorLayer?.remove(); cursorLayer = null;
    stopBakePoll();
    loaded = false;
  }
}

/** Click bản đồ hiện trạng khi đang vẽ vùng (cọ tô xử lý qua mousedown / mousemove / mouseup) */
export function handlePopDrawClick(latlng) {
  if (busy || selectedTool() === 'brush') return;
  const last = vertices[vertices.length - 1];
  if (last && last.lat === latlng.lat && last.lng === latlng.lng) return;
  vertices.push({ lat: latlng.lat, lng: latlng.lng });
  renderDraft();
}

export function refreshPopPanel() {
  setTimeout(syncPanel, 0);
}

export function initPopEdits() {
  document.addEventListener(TOOL_START_EVENT, (e) => { if (e.detail !== 'pop' && drawing()) setDrawing(false); });
  // Chuyển công cụ con trong panel Admin: Tuyến đường / Pixel dân cư
  document.querySelectorAll('.admin-sub-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-sub-btn').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      const panel = $(b.dataset.sub);
      if (panel) panel.style.display = on ? '' : 'none';
    });
  }));
  document.querySelectorAll('.tab-btn, .add-mode-btn, .admin-sub-btn, .rp-collapse-btn, #btnExpandRightPanel')
    .forEach(b => b.addEventListener('click', refreshPopPanel));
  $('btnPopDraw')?.addEventListener('click', () => setDrawing(!drawing()));
  $('btnPopUndo')?.addEventListener('click', undoLast);
  $('btnPopSave')?.addEventListener('click', saveDraft);
  $('btnPopBake')?.addEventListener('click', bakeNow);
  $('popOp')?.addEventListener('change', renderDraft);
  $('popTool')?.addEventListener('change', () => {
    clearDraft();
    if (drawing()) setDrawing(true); else { syncToolUi(); renderDraft(); }
  });
  $('popBrush')?.addEventListener('input', () => { syncToolUi(); renderDraft(); });
  $('popList')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteEdit(del.dataset.del); return; }
    const row = e.target.closest('[data-edit]');
    if (row) zoomToEdit(row.dataset.edit);
  });
  if (map) {
    map.on('mousedown', onBrushDown);
    map.on('mousemove', onBrushMove);
    map.on('mouseout', () => updateCursor(null));
    map.on('zoomend', () => { if (stroke) renderStroke(); });
  }
  document.addEventListener('mouseup', onBrushUp);
  document.addEventListener('keydown', (e) => {
    if (!drawing() || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') setDrawing(false);
    if (e.code === 'Space' && brushing()) {
      e.preventDefault();
      if (!spaceDown && !e.repeat) setSpace(true);
      return;
    }
    const canUndo = selectedTool() === 'brush' ? strokes.length : vertices.length;
    if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && canUndo) {
      e.preventDefault();
      undoLast();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && spaceDown) setSpace(false);
  });
  syncToolUi();
}
