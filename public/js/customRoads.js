// Tuyến đường hiện trạng Admin vẽ bổ sung (đường mới chưa có trên OpenStreetMap) → roads/v2/custom.json trên bucket.
// Máy chủ trộn vào mạng lưới OSM khi trả đường cho "phạm vi thực tế"; chiều dài cộng vào mật độ đường theo phường.
// Đỉnh đặt gần nút đường sẵn có (≤ SNAP_M) dùng lại mã nút đó để tuyến mới nối vào đồ thị đường.
// Sửa tuyến đã lưu: kéo / chèn / xóa đỉnh trên bản nháp rồi lưu đè đúng mã tuyến (đỉnh bị kéo bỏ mã nút cũ, bắt dính lại).
import { state } from './state.js';
import { geeApi } from './api.js';
import { map, wardNameAt, clearMeasure } from './mapEngine.js';
import { escapeHtml, fmtNum, ico, setStatusContent } from './utils.js';
import { postAdmin, refreshRoadsMeta } from './wardRoads.js';
import { roadWaysAround } from './serviceArea.js';
import { refreshRoadNetwork } from './roadNetworkLayer.js';
import { setDrawAssist } from './drawAssist.js';

const SNAP_M = 1;                   // chỉ bắt dính khi đỉnh cách nút < 1 m (click gần như trùng nút)
const NET_RADIUS_M = 1000;          // tải mạng lưới quanh đỉnh để bắt dính
const NODE_BASE = 8e15;             // mã nút tuyến bổ sung (OSM hiện ~1,3e10, không trùng)
const MIN_LENGTH_M = 5;
const TYPES = {
  1: { label: 'Đường trục chính', color: '#fb923c' },
  2: { label: 'Đường khu vực', color: '#60a5fa' },
  0: { label: 'Đường nội bộ', color: '#cbd5e1' },
  3: { label: 'Đường xe đạp', color: '#4ade80' }
};

const $ = (id) => document.getElementById(id);
const R = 6371008.8, RAD = Math.PI / 180;
const distM = (a, b) => R * Math.hypot((b.lat - a.lat) * RAD, (b.lng - a.lng) * RAD * Math.cos((a.lat + b.lat) / 2 * RAD));

let roads = [];          // danh sách trên bucket
let savedAt = 0;         // phiên bản danh sách đang sửa (gửi kèm khi lưu)
let loaded = false;
let busy = false;
let vertices = [];       // tuyến đang vẽ: [{ lat, lng, node: mã nút đã bắt dính | null }]
let editingId = null;    // mã tuyến đang sửa hình dạng (null = vẽ tuyến mới)
let netNodes = new Map(); // mã nút → { lat, lng } quanh các vùng đã tải
let netAreas = [];       // [{ lat, lng, r }]
let listLayer = null, drawLayer = null;
let guideLine = null;    // nét đứt từ đỉnh cuối tới con trỏ
let draftLines = [];     // viền + nét tuyến nháp, cập nhật trực tiếp khi kéo đỉnh

function setStatus(text, color) {
  const el = $('roadStatus');
  if (!el) return;
  setStatusContent(el, text);
  el.style.color = color || '';
}

const selectedType = () => Number($('roadType')?.value ?? 2);
const drawing = () => state.adminDrawMode === 'road';
const lengthM = (pts) => pts.slice(1).reduce((s, p, i) => s + distM(pts[i], p), 0);
const fmtLen = (m) => (m >= 1000 ? `${fmtNum(Math.round(m / 10) / 100)} km` : `${fmtNum(Math.round(m))} m`);

// ================== BẮT DÍNH VÀO MẠNG LƯỚI ==================
async function ensureNetwork(ll) {
  if (netAreas.some(a => distM(a, ll) < a.r - 150)) return true;
  try {
    const ways = await roadWaysAround(ll.lat, ll.lng, NET_RADIUS_M);
    ways.forEach(w => w.nodes.forEach((id, i) => netNodes.set(id, { lat: w.geometry[i].lat, lng: w.geometry[i].lon })));
    netAreas.push({ lat: ll.lat, lng: ll.lng, r: NET_RADIUS_M });
    return true;
  } catch (e) {
    return false;
  }
}

function nearestNode(ll) {
  let best = null, bestD = SNAP_M;
  const check = (id, p) => {
    const d = distM(ll, p);
    if (d < bestD) { bestD = d; best = { node: id, lat: p.lat, lng: p.lng }; }
  };
  netNodes.forEach((p, id) => check(id, p));
  roads.forEach(r => r.nodes.forEach((id, i) => check(id, { lat: r.flat[2 * i], lng: r.flat[2 * i + 1] })));
  return best;
}

async function addVertex(ll) {
  if (busy) return;
  busy = true;
  setStatus('⏳ Đang dò nút đường gần đỉnh...', 'var(--accent-orange)');
  const ok = await ensureNetwork(ll);
  busy = false;
  const snap = nearestNode(ll);
  const v = snap || { lat: ll.lat, lng: ll.lng, node: null };
  const last = vertices[vertices.length - 1];
  if (last && ((v.node && last.node === v.node) || distM(last, v) < 1)) { setStatus(''); return; }
  vertices.push(v);
  setStatus(ok ? '' : '⚠ Chưa tải được mạng lưới quanh đỉnh — đỉnh không bắt dính', ok ? '' : 'var(--accent-orange)');
  renderDraft();
}

// ================== VẼ ==================
function onGuideMove(e) {
  const last = vertices[vertices.length - 1];
  if (!drawing() || !drawLayer || !last) { guideLine?.remove(); guideLine = null; return; }
  const latlngs = [[last.lat, last.lng], e.latlng];
  if (guideLine) guideLine.setLatLngs(latlngs);
  else guideLine = L.polyline(latlngs, { color: TYPES[selectedType()].color, weight: 2, opacity: 0.85, dashArray: '4,6', interactive: false }).addTo(drawLayer);
}

// Đỉnh kéo được (chuột phải: xóa); chấm giữa đoạn: kéo / bấm để chèn đỉnh
const vertexIcon = (v, color) => L.divIcon({ className: `road-vtx${v.node ? ' snapped' : ''}`, iconSize: [14, 14], html: `<span style="--c:${color}"></span>` });
const midIcon = () => L.divIcon({ className: 'road-mid', iconSize: [11, 11], html: '<span></span>' });

/** Đỉnh vừa kéo sang chỗ mới: bỏ mã nút cũ, bắt dính lại nếu thả sát nút đường khác */
async function resnap(v) {
  v.node = null;
  busy = true;
  renderDraft();
  const ok = await ensureNetwork(v);
  busy = false;
  const snap = nearestNode(v);
  if (snap) Object.assign(v, snap);
  setStatus(ok ? '' : '⚠ Chưa tải được mạng lưới quanh đỉnh — đỉnh không bắt dính', ok ? '' : 'var(--accent-orange)');
  renderDraft();
}

function updateDraftInfo() {
  const info = $('roadDrawInfo');
  if (!info) return;
  const editing = editingId && roads.find(r => r.id === editingId);
  const snapped = vertices.filter(v => v.node).length;
  const head = editing ? `Đang sửa <b>${escapeHtml(editing.name || 'Tuyến không tên')}</b> · ` : '';
  info.innerHTML = vertices.length
    ? `${head}<b>${vertices.length}</b> đỉnh · dài <b>${fmtLen(lengthM(vertices))}</b> · <span style="color:#22c55e;">${snapped} đỉnh nối mạng lưới</span>`
    : (drawing() ? 'Click lên bản đồ hiện trạng để đặt đỉnh đầu tiên' : '');
}

function renderDraft() {
  updateDraftButtons();
  if (!drawLayer) return;
  drawLayer.clearLayers();
  guideLine = null;
  const color = TYPES[selectedType()].color;
  const latlngs = vertices.map(v => [v.lat, v.lng]);
  draftLines = [
    L.polyline(latlngs, { color: '#020617', weight: 7, opacity: 0.6, interactive: false }).addTo(drawLayer),
    L.polyline(latlngs, { color, weight: 4, dashArray: '8,6', interactive: false }).addTo(drawLayer)
  ];
  const redrawLines = () => {
    const ll = vertices.map(v => [v.lat, v.lng]);
    draftLines.forEach(l => l.setLatLngs(ll));
    updateDraftInfo();
  };

  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i];
    let added = null;
    L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { icon: midIcon(), draggable: true, keyboard: false, title: 'Kéo hoặc bấm để thêm đỉnh' })
      .on('dragstart', (e) => { const p = e.target.getLatLng(); added = { lat: p.lat, lng: p.lng, node: null }; vertices.splice(i, 0, added); })
      .on('drag', (e) => { const p = e.target.getLatLng(); added.lat = p.lat; added.lng = p.lng; redrawLines(); })
      .on('dragend', () => resnap(added))
      .on('click', () => {
        if (added) return;
        vertices.splice(i, 0, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2, node: null });
        renderDraft();
      })
      .addTo(drawLayer);
  }
  vertices.forEach((v, i) => {
    let start = null;
    L.marker([v.lat, v.lng], {
      icon: vertexIcon(v, color), draggable: true, keyboard: false, zIndexOffset: 500,
      title: `Đỉnh ${i + 1}${v.node ? ' (nối mạng lưới)' : ''} — kéo để di chuyển, chuột phải để xóa`
    })
      .on('dragstart', () => { start = { lat: v.lat, lng: v.lng }; })
      .on('drag', (e) => { const p = e.target.getLatLng(); v.lat = p.lat; v.lng = p.lng; redrawLines(); })
      .on('dragend', () => {
        if (start && distM(start, v) >= 0.5) resnap(v);
        else renderDraft();
      })
      .on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        vertices.splice(i, 1);
        renderDraft();
      })
      .addTo(drawLayer);
  });
  updateDraftInfo();
}

function updateDraftButtons() {
  const save = $('btnRoadSave');
  if (save) {
    save.disabled = vertices.length < 2 || busy;
    save.innerHTML = `${ico('save')}${editingId ? 'LƯU THAY ĐỔI (ADMIN)' : 'LƯU TUYẾN (ADMIN)'}`;
  }
  const undo = $('btnRoadUndo');
  if (undo) undo.disabled = !vertices.length;
  const cancel = $('btnRoadCancel');
  if (cancel) cancel.hidden = !editingId;
}

function renderRoads() {
  if (listLayer) {
    listLayer.clearLayers();
    roads.forEach(r => {
      const latlngs = [];
      for (let i = 0; i < r.flat.length; i += 2) latlngs.push([r.flat[i], r.flat[i + 1]]);
      const t = TYPES[r.g] || TYPES[2];
      if (r.id === editingId) {
        L.polyline(latlngs, { color: '#94a3b8', weight: 2, opacity: 0.7, dashArray: '2,6', interactive: false }).addTo(listLayer);
        return;
      }
      L.polyline(latlngs, { color: '#020617', weight: 7, opacity: 0.5, interactive: false }).addTo(listLayer);
      L.polyline(latlngs, { color: t.color, weight: 4 })
        .bindTooltip(`${escapeHtml(r.name || 'Tuyến không tên')} · ${t.label}`, { sticky: true })
        .addTo(listLayer);
    });
  }
  const list = $('roadList');
  if (!list) return;
  if (!loaded) { list.innerHTML = `<div class="cad-row">${ico('clock')}Đang tải danh sách tuyến bổ sung...</div>`; return; }
  if (!roads.length) { list.innerHTML = ''; return; }
  list.innerHTML = roads.slice().sort((a, b) => b.at - a.at).map(r => {
    const t = TYPES[r.g] || TYPES[2];
    const pts = [];
    for (let i = 0; i < r.flat.length; i += 2) pts.push({ lat: r.flat[i], lng: r.flat[i + 1] });
    const wards = Object.keys(r.len).join(', ');
    return `<div class="cad-row${r.id === editingId ? ' reviewing' : ''}" data-road="${r.id}" title="Bấm để phóng tới tuyến">
      <span class="cad-dot" style="background:${t.color};"></span>
      <div class="cad-row-main"><b>${escapeHtml(r.name || 'Tuyến không tên')}</b><br>
        <small>${t.label} · ${fmtLen(lengthM(pts))}${wards ? ` · ${escapeHtml(wards)}` : ''}</small></div>
      <button type="button" class="road-del road-edit" data-edit="${r.id}" title="Sửa hình dạng tuyến (kéo, thêm, xóa đỉnh)" aria-label="Sửa tuyến">${ico('pen')}</button>
      <button type="button" class="road-del" data-del="${r.id}" title="Xóa tuyến khỏi bucket" aria-label="Xóa tuyến">${ico('trash')}</button>
    </div>`;
  }).join('');
}

// ================== ĐỌC / LƯU ==================
async function loadRoads() {
  loaded = false;
  renderRoads();
  try {
    const res = await fetch(geeApi('action=getCustomRoads'), { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(d.roads)) throw new Error(d.message || `HTTP ${res.status}`);
    roads = d.roads;
    savedAt = Number(d.saved) || 0;
    loaded = true;
  } catch (err) {
    setStatus(`❌ Chưa tải được danh sách tuyến bổ sung: ${err.message}`, 'var(--accent-red)');
  }
  renderRoads();
}

async function persist(next, okText) {
  const data = await postAdmin('saveCustomRoads', { roads: next, base: savedAt });
  roads = next;
  savedAt = Number(data.at) || Date.now();
  netAreas = [];               // tải lại mạng lưới (gồm tuyến vừa lưu) cho lần bắt dính sau
  netNodes = new Map();
  renderRoads();
  await refreshRoadsMeta();
  refreshRoadNetwork();
  setStatus(okText, 'var(--accent-green)');
}

function nextNodeId() {
  let max = NODE_BASE;
  roads.forEach(r => r.nodes.forEach(id => { if (id > max) max = id; }));
  return max + 1;
}

/** Chiều dài từng đoạn cộng vào phường chứa trung điểm → { tên phường: km } */
function wardLengths(pts) {
  const out = {};
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ward = wardNameAt(((a.lat + b.lat) / 2).toFixed(6), ((a.lng + b.lng) / 2).toFixed(6));
    if (ward) out[ward] = (out[ward] || 0) + distM(a, b) / 1000;
  }
  Object.keys(out).forEach(k => { out[k] = Math.round(out[k] * 1000) / 1000; });
  return out;
}

async function saveDraft() {
  if (busy || !loaded || vertices.length < 2) return;
  if (state.currentUserRole !== 'ADMIN') { setStatus('Cần đăng nhập Admin.', 'var(--accent-red)'); return; }
  const len = lengthM(vertices);
  if (len < MIN_LENGTH_M) { setStatus(`Tuyến quá ngắn (< ${MIN_LENGTH_M} m).`, 'var(--accent-orange)'); return; }
  const editing = editingId && roads.find(r => r.id === editingId);
  if (editingId && !editing) { setStatus('Tuyến đang sửa không còn trong danh sách (đã bị xóa ở phiên khác).', 'var(--accent-red)'); return; }
  let id = nextNodeId();
  const nodes = vertices.map(v => v.node || id++);
  const g = selectedType();
  const name = String($('roadName')?.value || '').trim().slice(0, 120);
  const road = {
    id: editing ? editing.id : `R${Date.now().toString(36)}`,
    g, name, nodes,
    flat: vertices.flatMap(v => [Math.round(v.lat * 1e6) / 1e6, Math.round(v.lng * 1e6) / 1e6]),
    len: wardLengths(vertices),
    at: Date.now()
  };
  busy = true;
  renderDraft();
  setStatus('⏳ Đang ghi tuyến lên bucket...', 'var(--accent-orange)');
  try {
    const label = `"${name || 'Tuyến không tên'}" (${TYPES[g].label}, ${fmtLen(len)})`;
    await persist(editing ? roads.map(r => (r.id === editing.id ? road : r)) : [...roads, road],
      editing ? `✓ Đã cập nhật ${label}` : `✓ Đã lưu ${label}`);
    vertices = [];
    if ($('roadName')) $('roadName').value = '';
    if (editing) {
      editingId = null;
      setDrawing(false);
      renderRoads();
    }
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderDraft();
  }
}

async function deleteRoad(id) {
  const r = roads.find(x => x.id === id);
  if (!r || busy) return;
  if (!confirm(`Xóa tuyến "${r.name || 'Tuyến không tên'}" (${(TYPES[r.g] || TYPES[2]).label}) khỏi bucket?`)) return;
  if (id === editingId) cancelEdit();
  busy = true;
  setStatus('⏳ Đang xóa tuyến...', 'var(--accent-orange)');
  try {
    await persist(roads.filter(x => x.id !== id), '✓ Đã xóa tuyến');
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderDraft();
  }
}

function zoomToRoad(id) {
  const r = roads.find(x => x.id === id);
  if (!r || !map) return;
  const latlngs = [];
  for (let i = 0; i < r.flat.length; i += 2) latlngs.push([r.flat[i], r.flat[i + 1]]);
  map.fitBounds(L.latLngBounds(latlngs), { maxZoom: 18, padding: [40, 40] });
}

// ================== SỬA HÌNH DẠNG TUYẾN ĐÃ LƯU ==================
// Nạp tuyến vào bản nháp (giữ mã nút các đỉnh không di chuyển), lưu đè đúng mã tuyến
function startEdit(id) {
  const r = roads.find(x => x.id === id);
  if (!r || busy) return;
  if (vertices.length && !editingId && !confirm('Bỏ tuyến đang vẽ dở để sửa tuyến đã lưu?')) return;
  editingId = id;
  vertices = r.nodes.map((node, i) => ({ lat: r.flat[2 * i], lng: r.flat[2 * i + 1], node }));
  if ($('roadType')) $('roadType').value = String(r.g);
  if ($('roadName')) $('roadName').value = r.name || '';
  setStatus('Kéo đỉnh để di chuyển, chuột phải vào đỉnh để xóa, kéo/bấm chấm giữa đoạn để thêm đỉnh, click bản đồ để nối dài cuối tuyến.', 'var(--accent-cyan)');
  zoomToRoad(id);
  renderRoads();
  setDrawing(true);
}

function cancelEdit() {
  if (!editingId) return;
  editingId = null;
  vertices = [];
  if ($('roadName')) $('roadName').value = '';
  setStatus('');
  if (drawing()) setDrawing(false);
  renderRoads();
  renderDraft();
}

// ================== CHẾ ĐỘ VẼ ==================
function setDrawing(on) {
  if (on) state.adminDrawMode = 'road';
  else if (drawing()) state.adminDrawMode = null;
  if (on) {
    clearMeasure();
    state.isPickMode = false;
  }
  const btn = $('btnRoadDraw');
  if (btn) {
    btn.innerHTML = on ? `${ico('stop')}Dừng vẽ` : `${ico('pen')}${editingId ? 'Vẽ nối dài' : 'Vẽ tuyến mới'}`;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  if (map) {
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on) map.on('mousemove', onGuideMove); else map.off('mousemove', onGuideMove);
  }
  setDrawAssist('road', on);
  renderDraft();
}

/** Panel "Tuyến đường" đang hiện (tab Đề xuất, chế độ Tuyến đường, Admin) → hiện lớp tuyến bổ sung; ẩn panel → dừng vẽ */
function syncPanel() {
  const panel = $('addRoad');
  const visible = !!panel && panel.offsetParent !== null && state.currentUserRole === 'ADMIN';
  if (!map) return;
  if (visible) {
    if (!listLayer) {
      listLayer = L.layerGroup().addTo(map);
      const chk = $('chk_roads');
      if (chk && !chk.checked) chk.click();
    }
    if (!drawLayer) drawLayer = L.layerGroup().addTo(map);
    if (!loaded) loadRoads();
    renderRoads();
    renderDraft();
  } else {
    cancelEdit();
    if (drawing()) setDrawing(false);
    listLayer?.remove(); listLayer = null;
    drawLayer?.remove(); drawLayer = null;
    loaded = false;
  }
}

/** Click bản đồ hiện trạng khi đang vẽ tuyến */
export function handleRoadDrawClick(latlng) {
  addVertex(latlng);
}

export function refreshRoadPanel() {
  setTimeout(syncPanel, 0);
}

export function initCustomRoads() {
  document.querySelectorAll('.tab-btn, .add-mode-btn, .admin-sub-btn, .rp-collapse-btn, #btnExpandRightPanel')
    .forEach(b => b.addEventListener('click', refreshRoadPanel));
  $('btnRoadDraw')?.addEventListener('click', () => setDrawing(!drawing()));
  $('btnRoadUndo')?.addEventListener('click', () => { vertices.pop(); renderDraft(); });
  $('btnRoadSave')?.addEventListener('click', saveDraft);
  $('btnRoadCancel')?.addEventListener('click', cancelEdit);
  $('roadType')?.addEventListener('change', renderDraft);
  $('roadList')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteRoad(del.dataset.del); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { e.stopPropagation(); startEdit(edit.dataset.edit); return; }
    const row = e.target.closest('[data-road]');
    if (row) zoomToRoad(row.dataset.road);
  });
  document.addEventListener('keydown', (e) => {
    if (!drawing() || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') setDrawing(false);
    if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && vertices.length) {
      e.preventDefault();
      vertices.pop();
      renderDraft();
    }
  });
}
