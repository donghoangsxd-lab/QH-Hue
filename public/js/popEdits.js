// Hiệu chỉnh raster phân bổ dân cư: Admin vẽ vùng xóa pixel dân cư (sông, ruộng, khu công nghiệp...) hoặc thêm pixel
// (khu dân cư mới) → pop/edits.json trên bucket; máy chủ áp các vùng lên raster khi tính (services/popEditsService.js).
// Dân số phường giữ nguyên: đổi pixel chỉ đổi cách phân bổ dân trong phường (độ phủ, dân số được phục vụ).
import { state } from './state.js';
import { geeApi } from './api.js';
import { map, clearMeasure, loadPopulationLayer } from './mapEngine.js';
import { escapeHtml, fmtNum } from './utils.js';
import { postAdmin } from './wardRoads.js';
import { reloadWardStats } from './uiComponents.js';

const PIXEL_M2 = 900; // ô raster 30 m × 30 m (ước lượng số pixel trong vùng)
const MIN_AREA_M2 = 100;
const OPS = {
  remove: { label: 'Xóa pixel dân cư', color: '#f87171' },
  add: { label: 'Thêm pixel dân cư', color: '#4ade80' }
};

const $ = (id) => document.getElementById(id);

let edits = [];          // danh sách trên bucket
let savedAt = 0;         // phiên bản đang sửa (gửi kèm khi lưu)
let loaded = false;
let busy = false;
let vertices = [];       // vùng đang vẽ: [{ lat, lng }]
let listLayer = null, drawLayer = null;

const drawing = () => state.adminDrawMode === 'pop';
const selectedOp = () => ($('popOp')?.value === 'add' ? 'add' : 'remove');
const ringOf = (pts) => [...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]];
const areaM2 = (ring) => turf.area(turf.polygon([ring]));
const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`);
const fmtPixels = (m2) => `~${fmtNum(Math.max(1, Math.round(m2 / PIXEL_M2)))} pixel`;

function setStatus(text, color) {
  const el = $('popStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

/** Vùng tự cắt (hình nơ) → GEE tô sai, không cho lưu */
function selfIntersects(ring) {
  try { return turf.kinks(turf.polygon([ring])).features.length > 0; } catch (e) { return true; }
}

// ================== VẼ ==================
function renderDraft() {
  if (!drawLayer) return;
  drawLayer.clearLayers();
  const color = OPS[selectedOp()].color;
  const latlngs = vertices.map(v => [v.lat, v.lng]);
  if (latlngs.length >= 3) L.polygon(latlngs, { color, weight: 2, dashArray: '6,5', fillColor: color, fillOpacity: 0.25, interactive: false }).addTo(drawLayer);
  else if (latlngs.length === 2) L.polyline(latlngs, { color, weight: 2, dashArray: '6,5', interactive: false }).addTo(drawLayer);
  latlngs.forEach(ll => L.circleMarker(ll, { radius: 4, color, weight: 2, fillColor: '#0f172a', fillOpacity: 1, interactive: false }).addTo(drawLayer));

  let bad = false;
  const info = $('popDrawInfo');
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
  const save = $('btnPopSave');
  if (save) save.disabled = vertices.length < 3 || bad || busy;
  const undo = $('btnPopUndo');
  if (undo) undo.disabled = !vertices.length;
}

function renderEdits() {
  if (listLayer) {
    listLayer.clearLayers();
    edits.forEach(e => {
      const o = OPS[e.op];
      L.polygon(e.ring.map(([lng, lat]) => [lat, lng]), { color: o.color, weight: 2, fillColor: o.color, fillOpacity: 0.15 })
        .bindTooltip(`${escapeHtml(e.name || 'Vùng không tên')} · ${o.label}`, { sticky: true })
        .addTo(listLayer);
    });
  }
  const list = $('popList');
  if (!list) return;
  if (!loaded) { list.innerHTML = '<div class="cad-row">⏳ Đang tải danh sách vùng hiệu chỉnh...</div>'; return; }
  if (!edits.length) { list.innerHTML = ''; return; }
  list.innerHTML = edits.slice().sort((a, b) => b.at - a.at).map(e => {
    const o = OPS[e.op];
    const m2 = areaM2(e.ring);
    return `<div class="cad-row" data-edit="${e.id}" title="Bấm để phóng tới vùng">
      <span class="cad-dot" style="background:${o.color};"></span>
      <div class="cad-row-main"><b>${escapeHtml(e.name || 'Vùng không tên')}</b><br>
        <small>${o.label} · ${fmtArea(m2)} · ${fmtPixels(m2)}</small></div>
      <button type="button" class="road-del" data-del="${e.id}" title="Xóa vùng khỏi bucket (khôi phục raster gốc)" aria-label="Xóa vùng">🗑</button>
    </div>`;
  }).join('');
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
    loaded = true;
  } catch (err) {
    setStatus(`❌ Chưa tải được danh sách vùng hiệu chỉnh: ${err.message}`, 'var(--accent-red)');
  }
  renderEdits();
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
  if (busy || !loaded || vertices.length < 3) return;
  if (state.currentUserRole !== 'ADMIN') { setStatus('Cần đăng nhập Admin.', 'var(--accent-red)'); return; }
  const ring = ringOf(vertices).map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
  const m2 = areaM2(ring);
  if (m2 < MIN_AREA_M2) { setStatus(`Vùng quá nhỏ (< ${MIN_AREA_M2} m²).`, 'var(--accent-orange)'); return; }
  if (selfIntersects(ring)) { setStatus('Vùng tự cắt — sửa lại đỉnh.', 'var(--accent-orange)'); return; }
  const op = selectedOp();
  const name = String($('popName')?.value || '').trim().slice(0, 120);
  const edit = { id: `P${Date.now().toString(36)}`, op, name, ring, at: Date.now() };
  busy = true;
  renderDraft();
  setStatus('⏳ Đang ghi vùng lên bucket...', 'var(--accent-orange)');
  try {
    await persist([...edits, edit], `✓ Đã lưu "${name || 'Vùng không tên'}" (${OPS[op].label}, ${fmtArea(m2)})`);
    vertices = [];
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
  map.fitBounds(L.latLngBounds(e.ring.map(([lng, lat]) => [lat, lng])), { maxZoom: 18, padding: [40, 40] });
}

// ================== CHẾ ĐỘ VẼ ==================
function setDrawing(on) {
  if (on) {
    state.adminDrawMode = 'pop';
    clearMeasure();
    state.isPickMode = false;
  } else if (drawing()) state.adminDrawMode = null;
  const btn = $('btnPopDraw');
  if (btn) {
    btn.textContent = on ? '⏹ Dừng vẽ' : '✏️ Vẽ vùng mới';
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  if (map) map.getContainer().style.cursor = on ? 'crosshair' : '';
  renderDraft();
}

/** Panel "Pixel dân cư" đang hiện (Admin) → hiện các vùng + bật lớp dân cư; ẩn panel → dừng vẽ, gỡ lớp vùng */
function syncPanel() {
  const panel = $('addPop');
  const visible = !!panel && panel.offsetParent !== null && state.currentUserRole === 'ADMIN';
  if (!map) return;
  if (visible) {
    if (!listLayer) {
      listLayer = L.layerGroup().addTo(map);
      const chk = $('chk_pop');
      if (chk && !chk.checked) chk.click();
    }
    if (!drawLayer) drawLayer = L.layerGroup().addTo(map);
    if (!loaded) loadEdits();
    renderEdits();
    renderDraft();
  } else {
    if (drawing()) setDrawing(false);
    listLayer?.remove(); listLayer = null;
    drawLayer?.remove(); drawLayer = null;
    loaded = false;
  }
}

/** Click bản đồ hiện trạng khi đang vẽ vùng */
export function handlePopDrawClick(latlng) {
  if (busy) return;
  const last = vertices[vertices.length - 1];
  if (last && last.lat === latlng.lat && last.lng === latlng.lng) return;
  vertices.push({ lat: latlng.lat, lng: latlng.lng });
  renderDraft();
}

export function refreshPopPanel() {
  setTimeout(syncPanel, 0);
}

export function initPopEdits() {
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
  $('btnPopUndo')?.addEventListener('click', () => { vertices.pop(); renderDraft(); });
  $('btnPopSave')?.addEventListener('click', saveDraft);
  $('popOp')?.addEventListener('change', renderDraft);
  $('popList')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteEdit(del.dataset.del); return; }
    const row = e.target.closest('[data-edit]');
    if (row) zoomToEdit(row.dataset.edit);
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
