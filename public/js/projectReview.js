// Đề xuất → Thẩm định đồ án: đọc hatch DXF, chấm QCVN 01:2026, không ghi Sheet.
import { map } from './mapEngine.js';
import { BUFFER_COLORS } from './state.js';
import { parseDxf, buildParcels, CRS_PRESETS, tt16Layer } from './cadImport.js';
import { escapeHtml, fmtNum, ico, showToast, loadHtml2Pdf } from './utils.js';
import { setBottomPanelMaximized } from './uiComponents.js';
import {
  REVIEW_MAX_BYTES, REVIEW_CHOICES, tagParcel, lotRadius, scoreRows, layerRollup, rowLabel, needsTypeCode, unitsFromPop, UNIT_POP, housingLayer
} from './projectReviewCore.js';

const STORE_KEY = 'qh_review_dossiers';
const $ = (id) => document.getElementById(id);

let session = null;
let manual = new Map();
let layerGroup = null;
let maxWasOn = false;

const roleLabel = (role, key) => (role === 'housing' ? 'Đất ở' : role === 'score' ? rowLabel(key) : role === 'other' ? 'Không chấm' : 'Chưa rõ');

function loadStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function saveStore(list) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 30)));
}

function geometryOf(p) {
  if (!p.polygons.length) return null;
  return p.polygons.length === 1
    ? { type: 'Polygon', coordinates: p.polygons[0] }
    : { type: 'MultiPolygon', coordinates: p.polygons };
}

function featureOf(p) {
  const g = geometryOf(p);
  if (!g || typeof turf === 'undefined') return null;
  try { return turf.feature(g); } catch (e) { return null; }
}

function unionAll(features) {
  let acc = null;
  features.forEach(f => {
    if (!f) return;
    if (!acc) { acc = f; return; }
    try { acc = turf.union(acc, f) || acc; } catch (e) { /* giữ khối đã gộp */ }
  });
  return acc;
}

/** Độ phủ = diện tích đất ở nằm trong bán kính tâm hatch / tổng diện tích đất ở. */
function coverPct(members, housingFeature) {
  if (!housingFeature || typeof turf === 'undefined') return null;
  const base = turf.area(housingFeature);
  if (!(base > 0)) return null;
  const buffers = members.map(p => {
    if (!(p.radius > 0) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    try { return turf.buffer(turf.point([p.lng, p.lat]), p.radius, { units: 'meters' }); } catch (e) { return null; }
  }).filter(Boolean);
  const covered = unionAll(buffers);
  if (!covered) return 0;
  let hit = null;
  try { hit = turf.intersect(covered, housingFeature); } catch (e) { hit = null; }
  if (!hit) return 0;
  return Math.round(Math.min(100, turf.area(hit) / base * 100) * 10) / 10;
}

function hullOf(lots) {
  if (typeof turf === 'undefined') return null;
  const pts = [];
  lots.forEach(p => p.polygons.forEach(poly => poly[0].forEach(([lng, lat]) => pts.push(turf.point([lng, lat])))));
  if (pts.length < 3) return null;
  try { return turf.convex(turf.featureCollection(pts)); } catch (e) { return null; }
}

function applyTags(parcels) {
  parcels.forEach(p => {
    const tag = tagParcel(p, manual.get(p.layer));
    p.role = tag.role;
    p.scoreKey = tag.scoreKey;
    p.phase = tag.phase;
    p.radius = p.role === 'score' ? lotRadius(p) : 0;
  });
}

function clearMap() {
  layerGroup?.remove();
  layerGroup = null;
}

function drawMap(lots, hull) {
  clearMap();
  if (!map) return;
  layerGroup = L.featureGroup().addTo(map);
  if (hull) L.geoJSON(hull, { interactive: false, style: { color: '#facc15', weight: 2, dashArray: '7 5', fill: false } }).addTo(layerGroup);
  lots.forEach(p => {
    const g = geometryOf(p);
    if (!g) return;
    const color = p.role === 'housing' ? '#4ade80' : p.role === 'ask' ? '#94a3b8' : (BUFFER_COLORS[p.type] || '#38bdf8');
    L.geoJSON(g, { interactive: false, style: { color, weight: 1, fillColor: color, fillOpacity: p.role === 'housing' ? 0.18 : 0.45 } }).addTo(layerGroup);
  });
  const bounds = layerGroup.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
}

function pctCell(pct) {
  if (pct == null) return '<span class="c-muted">—</span>';
  const cls = pct >= 100 ? 'c-green' : 'c-red';
  return `<b class="${cls}">${fmtNum(pct)}%</b>`;
}

function renderHost() {
  const host = $('projectReviewHost');
  if (!host || !session) return;
  const pop = Number($('reviewPop')?.value);
  const scored = scoreRows(session.parcels, pop);
  const housingFeature = unionAll(scored.housing.map(featureOf));
  scored.rows.forEach(row => {
    row.coverPct = row.members.some(p => p.radius > 0) ? coverPct(row.members, housingFeature) : null;
  });
  session.scored = scored;
  const rollup = layerRollup(session.parcels);
  const asks = rollup.filter(r => r.role === 'ask');
  const units = unitsFromPop(pop);
  const landRows = rollup.map(r => `<tr>
    <td>${escapeHtml(r.layer)}</td>
    <td>${r.n}</td>
    <td>${fmtNum(Math.round(r.area))} m²</td>
    <td>${escapeHtml(roleLabel(r.role, r.scoreKey))}</td>
  </tr>`).join('');
  const askBox = asks.length ? `<div class="review-ask"><b>Layer chưa rõ — chọn nhóm trước khi chốt kết quả</b>${asks.map(r => {
    const cur = manual.get(r.layer) || '';
    const opts = [`<option value="">Chọn nhóm…</option>`].concat(REVIEW_CHOICES.map(([id, label]) => `<option value="${id}"${cur === id ? ' selected' : ''}>${escapeHtml(label)}</option>`));
    return `<label>${escapeHtml(r.layer)} <small>(${r.n} hatch, ${fmtNum(Math.round(r.area))} m²)</small><select data-layer="${escapeHtml(r.layer)}">${opts.join('')}</select></label>`;
  }).join('')}</div>` : '';
  const body = [];
  let last = '';
  scored.rows.forEach(row => {
    if (row.section !== last) {
      last = row.section;
      const title = row.section === 'A' ? 'A · CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ' : `B · CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (quy hoạch: ${units} đơn vị ở)`;
      body.push(`<tr class="wt-section wt-${row.section === 'A' ? 'a' : 'b'}"><td>${row.section}</td><td colspan="7">${title}</td></tr>`);
    }
    const count = row.perUnit && units > 0 ? `${row.count} / ${units}` : fmtNum(row.count);
    const lots = row.members.slice(0, 12).map(p => `${p.phase} · ${p.layer} · ${fmtNum(Math.round(p.area))} m²`).join('<br>');
    body.push(`<tr class="wt-main">
      <td></td>
      <td>${escapeHtml(row.label)}${lots ? `<div class="wt-light">${lots}${row.members.length > 12 ? '<br>…' : ''}</div>` : ''}</td>
      <td>${fmtNum(row.area)} m²</td>
      <td>${row.quota > 0 ? `${fmtNum(row.quota)} m²/người` : '—'}</td>
      <td>${row.demand ? `${fmtNum(row.demand)} m²` : '—'}</td>
      <td>${count}</td>
      <td>${pctCell(row.scalePct)}</td>
      <td>${row.members.length ? pctCell(row.coverPct) : '<span class="c-muted">—</span>'}</td>
    </tr>`);
  });
  const housingNote = scored.housingArea > 0
    ? `Đất ở ${fmtNum(scored.housingArea)} m². Độ phủ = phần đất ở nằm trong bán kính tâm hatch.`
    : 'Chưa thấy hatch đất ở (DAT_O, DAT_ODT, DAT_ONT). Hãy gán layer đất ở ở khung trên — chưa có thì cột độ phủ để trống.';
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head">
      <b class="bp-part-title">THẨM ĐỊNH ĐỒ ÁN · ${escapeHtml(session.fileName)}</b>
      <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
    </div>
    <div class="review-note">
      Dân số quy hoạch <b>${pop > 0 ? fmtNum(pop) : 'chưa nhập'}</b> → <b>${units}</b> đơn vị ở (làm tròn lên, ${fmtNum(UNIT_POP)} người/đơn vị, đối chiếu số trường THCS).
      Ranh vàng trên bản đồ là đường bao quanh các hatch, không đọc từ file.
      ${housingNote} Kết quả này chưa ghi vào bảng phường hay thành phố.
    </div>
    ${askBox}
    <h4>Tổng diện tích theo layer</h4>
    <div class="ward-table-scroll-container"><table class="ward-table review-land">
      <thead><tr><th>Layer</th><th>Số hatch</th><th>Diện tích</th><th>Nhóm</th></tr></thead>
      <tbody>${landRows}</tbody>
    </table></div>
    <h4>Đánh giá QCVN 01:2026/BXD</h4>
    <div class="ward-table-scroll-container"><table class="ward-table">
      <thead><tr><th></th><th>Loại hạ tầng</th><th>Diện tích</th><th>Chỉ tiêu</th><th>Nhu cầu</th><th>Số lượng</th><th>Quy mô</th><th>Độ phủ</th></tr></thead>
      <tbody>${body.join('')}</tbody>
    </table></div>
  </div>`;
  host.querySelectorAll('select[data-layer]').forEach(sel => sel.addEventListener('change', () => {
    const layer = sel.dataset.layer;
    if (sel.value) manual.set(layer, sel.value); else manual.delete(layer);
    applyTags(session.parcels);
    drawMap(session.parcels, session.hull);
    renderHost();
  }));
  $('btnReviewClose')?.addEventListener('click', closeReview);
  renderDrafts();
}

function openHost() {
  if (!document.body.classList.contains('project-review')) maxWasOn = document.body.classList.contains('bottom-max');
  document.body.classList.add('project-review');
  setBottomPanelMaximized(true);
}

function closeReview() {
  document.body.classList.remove('project-review');
  if (!maxWasOn) setBottomPanelMaximized(false);
  clearMap();
  const host = $('projectReviewHost');
  if (host) host.innerHTML = '';
  session = null;
}

function renderDrafts() {
  const box = $('reviewDrafts');
  if (!box) return;
  const list = loadStore();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="review-drafts"><b>Hồ sơ đã lưu trên trình duyệt</b>${list.map(d => `<div>
    <span>${escapeHtml(d.name)} · ${fmtNum(d.pop)} dân · ${d.units} đơn vị ở</span>
    <button type="button" data-open-draft="${escapeHtml(d.id)}">Xem</button>
    <button type="button" data-del-draft="${escapeHtml(d.id)}">Xóa</button>
  </div>`).join('')}</div>`;
}

async function readFile(file) {
  if (!file) return;
  if (!/\.dxf$/i.test(file.name)) { showToast('Chỉ nhận file .dxf', 'error'); return; }
  if (file.size > REVIEW_MAX_BYTES) { showToast('File lớn hơn 5 MB', 'error'); return; }
  const head = await file.slice(0, 22).text();
  if (head.startsWith('AutoCAD Binary DXF')) { showToast('DXF nhị phân chưa hỗ trợ — lưu dạng ASCII', 'error'); return; }
  showToast('Đang đọc hatch…');
  await new Promise(r => setTimeout(r, 30));
  const parsed = parseDxf(await file.text());
  const hatches = parsed.entities.filter(e => e.kind === 'HATCH');
  if (!hatches.length) { showToast('Không có hatch nào trong file', 'error'); return; }
  hatches.forEach(e => {
    const tt = tt16Layer(e.layer);
    if (housingLayer(e.layer)) e.reviewKind = 'housing';
    else if (tt && tt.school && !tt.prefix) e.reviewKind = 'school';
    else if (tt && tt.other) e.reviewKind = 'other';
    else if ((tt && tt.prefix) || !needsTypeCode(e.layer)) e.reviewKind = 'score';
    else e.reviewKind = 'ask';
    if (e.reviewKind !== 'score' && e.reviewKind !== 'school') e.typeCode = 'CSD';
  });
  const crs = CRS_PRESETS[$('reviewCrs')?.value] || CRS_PRESETS.HUE_3;
  const built = buildParcels(hatches, { crs });
  built.parcels.forEach(p => { p.reviewKind = hatches[p.src]?.reviewKind || 'ask'; });
  manual = new Map();
  applyTags(built.parcels);
  session = { fileName: file.name, parcels: built.parcels, hull: hullOf(built.parcels), scored: null };
  if (!built.axes.valid) showToast('Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra hệ tọa độ', 'error');
  openHost();
  drawMap(session.parcels, session.hull);
  renderHost();
}

function saveDraft() {
  if (!session?.scored) { showToast('Hãy tải file và nhập dân số trước', 'error'); return; }
  const pop = Number($('reviewPop')?.value) || 0;
  const id = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`;
  const list = loadStore();
  list.unshift({
    id,
    name: session.fileName.replace(/\.dxf$/i, ''),
    fileName: session.fileName,
    at: new Date().toISOString(),
    pop,
    units: session.scored.units,
    housingArea: session.scored.housingArea,
    rows: session.scored.rows.map(r => ({
      section: r.section, key: r.key, label: r.label, area: r.area, count: r.count,
      demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct, quota: r.quota
    }))
  });
  saveStore(list);
  renderDrafts();
  showToast('Đã lưu hồ sơ trên trình duyệt. Chưa ghi Sheet — gửi admin vào hệ thống là bước sau.');
}

function showDraft(id) {
  const d = loadStore().find(x => x.id === id);
  const host = $('projectReviewHost');
  if (!d || !host) return;
  openHost();
  clearMap();
  const body = d.rows.map(r => `<tr class="wt-main">
    <td>${r.section}</td><td>${escapeHtml(r.label)}</td><td>${fmtNum(r.area)} m²</td>
    <td>${r.quota > 0 ? `${fmtNum(r.quota)} m²/người` : '—'}</td>
    <td>${r.demand ? `${fmtNum(r.demand)} m²` : '—'}</td><td>${fmtNum(r.count)}</td>
    <td>${pctCell(r.scalePct)}</td><td>${pctCell(r.coverPct)}</td></tr>`).join('');
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head"><b class="bp-part-title">HỒ SƠ ĐÃ LƯU · ${escapeHtml(d.name)}</b>
      <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button></div>
    <div class="review-note">Dân số ${fmtNum(d.pop)} · ${d.units} đơn vị ở · đất ở ${fmtNum(d.housingArea)} m². Bản đồ chỉ hiện khi đang mở file.</div>
    <div class="ward-table-scroll-container"><table class="ward-table"><thead><tr>
      <th></th><th>Loại hạ tầng</th><th>Diện tích</th><th>Chỉ tiêu</th><th>Nhu cầu</th><th>Số lượng</th><th>Quy mô</th><th>Độ phủ</th>
    </tr></thead><tbody>${body}</tbody></table></div></div>`;
  $('btnReviewClose')?.addEventListener('click', closeReview);
}

async function exportPdf() {
  const sheet = $('projectReviewSheet');
  if (!sheet) { showToast('Chưa có bảng thẩm định', 'error'); return; }
  try { await loadHtml2Pdf(); } catch (e) { showToast('Không tải được thư viện PDF', 'error'); return; }
  const name = (session?.fileName || 'do-an').replace(/\.dxf$/i, '');
  window.html2pdf().from(sheet).set({
    margin: 6,
    filename: `Tham-dinh-${name}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save();
}

export function initProjectReview() {
  $('reviewFile')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    readFile(file);
  });
  $('reviewPop')?.addEventListener('input', () => { if (session) renderHost(); });
  $('reviewCrs')?.addEventListener('change', () => { if (session) showToast('Đổi hệ tọa độ thì hãy chọn lại file', 'info'); });
  $('btnReviewPdf')?.addEventListener('click', exportPdf);
  $('btnReviewSave')?.addEventListener('click', saveDraft);
  $('btnReviewDrop')?.addEventListener('click', () => { closeReview(); showToast('Đã xóa bản xem trước'); });
  $('reviewDrafts')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-draft]');
    if (open) { showDraft(open.dataset.openDraft); return; }
    const del = e.target.closest('[data-del-draft]');
    if (!del) return;
    saveStore(loadStore().filter(d => d.id !== del.dataset.delDraft));
    renderDrafts();
  });
  document.querySelectorAll('.add-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.mode !== 'addReview') clearMap(); });
  });
  renderDrafts();
}
