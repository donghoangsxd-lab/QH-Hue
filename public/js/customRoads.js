// Tuyến đường hiện trạng Admin vẽ bổ sung (đường mới chưa có trên OpenStreetMap) → roads/v2/custom.json trên bucket.
// Máy chủ trộn vào mạng lưới OSM khi trả đường cho "phạm vi thực tế"; chiều dài cộng vào mật độ đường theo phường.
// Đỉnh đặt gần nút đường sẵn có (≤ SNAP_M) dùng lại mã nút đó để tuyến mới nối vào đồ thị đường.
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
let netNodes = new Map(); // mã nút → { lat, lng } quanh các vùng đã tải
let netAreas = [];       // [{ lat, lng, r }]
let listLayer = null, drawLayer = null;
let guideLine = null;    // nét đứt từ đỉnh cuối tới con trỏ

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

function renderDraft() {
  if (!drawLayer) return;
  drawLayer.clearLayers();
  guideLine = null;
  const color = TYPES[selectedType()].color;
  const latlngs = vertices.map(v => [v.lat, v.lng]);
  if (latlngs.length >= 2) {
    L.polyline(latlngs, { color: '#020617', weight: 7, opacity: 0.6, interactive: false }).addTo(drawLayer);
    L.polyline(latlngs, { color, weight: 4, dashArray: '8,6', interactive: false }).addTo(drawLayer);
  }
  vertices.forEach(v => L.circleMarker([v.lat, v.lng], {
    radius: v.node ? 5 : 4, color: v.node ? '#22c55e' : color, weight: 2, fillColor: v.node ? '#22c55e' : '#0f172a', fillOpacity: 1, interactive: false
  }).addTo(drawLayer));

  const snapped = vertices.filter(v => v.node).length;
  const info = $('roadDrawInfo');
  if (info) {
    info.innerHTML = vertices.length
      ? `<b>${vertices.length}</b> đỉnh · dài <b>${fmtLen(lengthM(vertices))}</b> · <span style="color:#22c55e;">${snapped} đỉnh nối mạng lưới</span>`
      : (drawing() ? 'Click lên bản đồ hiện trạng để đặt đỉnh đầu tiên' : '');
  }
  const save = $('btnRoadSave');
  if (save) save.disabled = vertices.length < 2 || busy;
  const undo = $('btnRoadUndo');
  if (undo) undo.disabled = !vertices.length;
}

function renderRoads() {
  if (listLayer) {
    listLayer.clearLayers();
    roads.forEach(r => {
      const latlngs = [];
      for (let i = 0; i < r.flat.length; i += 2) latlngs.push([r.flat[i], r.flat[i + 1]]);
      const t = TYPES[r.g] || TYPES[2];
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
    return `<div class="cad-row" data-road="${r.id}" title="Bấm để phóng tới tuyến">
      <span class="cad-dot" style="background:${t.color};"></span>
      <div class="cad-row-main"><b>${escapeHtml(r.name || 'Tuyến không tên')}</b><br>
        <small>${t.label} · ${fmtLen(lengthM(pts))}${wards ? ` · ${escapeHtml(wards)}` : ''}</small></div>
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
  let id = nextNodeId();
  const nodes = vertices.map(v => v.node || id++);
  const g = selectedType();
  const name = String($('roadName')?.value || '').trim().slice(0, 120);
  const road = {
    id: `R${Date.now().toString(36)}`,
    g, name, nodes,
    flat: vertices.flatMap(v => [Math.round(v.lat * 1e6) / 1e6, Math.round(v.lng * 1e6) / 1e6]),
    len: wardLengths(vertices),
    at: Date.now()
  };
  busy = true;
  renderDraft();
  setStatus('⏳ Đang ghi tuyến lên bucket...', 'var(--accent-orange)');
  try {
    await persist([...roads, road], `✓ Đã lưu "${name || 'Tuyến không tên'}" (${TYPES[g].label}, ${fmtLen(len)})`);
    vertices = [];
    if ($('roadName')) $('roadName').value = '';
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
    btn.innerHTML = on ? `${ico('stop')}Dừng vẽ` : `${ico('pen')}Vẽ tuyến mới`;
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
  $('roadType')?.addEventListener('change', renderDraft);
  $('roadList')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteRoad(del.dataset.del); return; }
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
