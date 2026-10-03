// Đề xuất → Thẩm định đồ án: đọc hatch DXF, chấm QCVN 01:2026. Chỉ vào hàng chờ duyệt khi người dùng bấm Gửi.
import { map } from './mapEngine.js';
import { state, BUFFER_COLORS } from './state.js';
import { geeApi } from './api.js';
import { parseDxf, buildParcels, CRS_PRESETS, tt16Layer } from './cadImport.js';
import { escapeHtml, fmtNum, ico, showToast, loadHtml2Pdf } from './utils.js';
import { setBottomPanelMaximized } from './uiComponents.js';
import {
  REVIEW_MAX_BYTES, REVIEW_CHOICES, tagParcel, lotRadius, scoreRows, layerRollup, rowLabel, needsTypeCode, unitsFromPop, UNIT_POP, housingLayer
} from './projectReviewCore.js';

const STORE_KEY = 'qh_review_dossiers';
// Hàng chờ duyệt (submitCadPending) nhận tối đa 2 MB nội dung
const SEND_MAX_BYTES = 2 * 1024 * 1024;
const ASK_COLOR = '#fb923c';
const FOCUS_COLOR = '#facc15';
const $ = (id) => document.getElementById(id);

let session = null;
let manual = new Map();
let layerGroup = null;
let svgRenderer = null;
let lotLayers = [];
let focused = '';
let maxWasOn = false;
let sending = false;
let pdfName = 'do-an';

const roleLabel = (role, key) => (role === 'housing' ? 'Đất ở' : role === 'score' ? rowLabel(key) : role === 'other' ? 'Không chấm' : 'Chưa rõ');
const baseName = (f) => String(f || '').replace(/\.(dxf|kml|kmz|geojson|json)$/i, '');

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

// ---- Bản đồ xem trước ----

function clearMap() {
  layerGroup?.remove();
  layerGroup = null;
  lotLayers = [];
}

function lotStyle(p) {
  if (p.role === 'ask') return { color: ASK_COLOR, weight: 2.5, dashArray: '6 4', fillColor: ASK_COLOR, fillOpacity: 0.35 };
  const color = p.role === 'housing' ? '#4ade80' : p.role === 'other' ? '#94a3b8' : (BUFFER_COLORS[p.type] || '#38bdf8');
  return { color, weight: 1.2, dashArray: null, fillColor: color, fillOpacity: p.role === 'housing' ? 0.18 : 0.45 };
}

/** Khung bản đồ trừ phần panel phải đè lên */
function fitTo(bounds) {
  if (!map || !bounds || !bounds.isValid()) return;
  const rp = document.querySelector('.right-panel');
  const right = rp && rp.offsetParent !== null ? rp.offsetWidth + 24 : 24;
  map.fitBounds(bounds, { paddingTopLeft: [24, 24], paddingBottomRight: [right, 24], maxZoom: 18 });
}

function drawMap(lots, hull, fit) {
  clearMap();
  if (!map) return;
  svgRenderer = svgRenderer || L.svg({ padding: 0.3 });
  layerGroup = L.featureGroup().addTo(map);
  if (hull) L.geoJSON(hull, { renderer: svgRenderer, interactive: false, style: { color: FOCUS_COLOR, weight: 2, dashArray: '7 5', fill: false } }).addTo(layerGroup);
  lots.forEach(p => {
    const g = geometryOf(p);
    if (!g) return;
    const lyr = L.geoJSON(g, { renderer: svgRenderer, style: () => ({ ...lotStyle(p), className: p.role === 'ask' ? 'review-ask-lot' : '' }) })
      .bindTooltip(`<b>${escapeHtml(p.layer)}</b> · ${fmtNum(Math.round(p.area))} m²<br>${escapeHtml(roleLabel(p.role, p.scoreKey))}${p.role === 'ask' ? ' — bấm để chọn nhóm' : ''}`, { sticky: true })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        focusLayer(p.layer, false);
        revealInSheet(p.layer);
      })
      .addTo(layerGroup);
    lotLayers.push({ p, lyr });
  });
  if (focused) focusLayer(focused, false);
  if (fit) fitTo(layerGroup.getBounds());
}

/** Tô vàng toàn bộ hatch của 1 layer trên bản đồ và dòng tương ứng trong bảng */
function focusLayer(layer, fit) {
  focused = layer || '';
  const bounds = L.latLngBounds([]);
  lotLayers.forEach(({ p, lyr }) => {
    if (focused && p.layer === focused) {
      lyr.setStyle({ color: FOCUS_COLOR, weight: 3.5, dashArray: null, fillColor: FOCUS_COLOR, fillOpacity: 0.5 });
      lyr.bringToFront();
      bounds.extend(lyr.getBounds());
    } else {
      lyr.setStyle(lotStyle(p));
    }
  });
  document.querySelectorAll('#projectReviewHost [data-layer-row]').forEach(el => el.classList.toggle('on', el.dataset.layerRow === focused));
  if (fit) fitTo(bounds);
}

function revealInSheet(layer) {
  const rows = [...document.querySelectorAll('#projectReviewHost [data-layer-row]')].filter(el => el.dataset.layerRow === layer);
  const el = rows.find(r => r.classList.contains('review-ask-item')) || rows[0];
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.querySelector('select')?.focus({ preventScroll: true });
}

// ---- Bảng thẩm định ----

function pctCell(pct) {
  if (pct == null) return '<span class="c-muted">—</span>';
  const cls = pct >= 100 ? 'c-green' : 'c-red';
  return `<b class="${cls}">${fmtNum(pct)}%</b>`;
}

function sheetHead(title) {
  return `<div class="bp-part-head review-head">
    <b class="bp-part-title">${title}</b>
    <div class="review-head-btns review-noprint">
      <button type="button" class="bp-btn" id="btnReviewPrint" title="Lưu bảng thẩm định ra file PDF">${ico('printer')}In PDF</button>
      <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
    </div>
  </div>`;
}

const QCVN_HEAD = '<thead><tr><th></th><th>Loại hạ tầng</th><th>Diện tích</th><th>Chỉ tiêu</th><th>Nhu cầu</th><th>Số lượng</th><th>Quy mô</th><th>Độ phủ</th></tr></thead>';

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
  const on = (layer) => (layer === focused ? ' on' : '');
  const landRows = rollup.map(r => `<tr data-layer-row="${escapeHtml(r.layer)}" data-focus-layer="${escapeHtml(r.layer)}" class="${r.role === 'ask' ? 'review-row-ask' : ''}${on(r.layer)}" title="Bấm để xem trên bản đồ">
    <td>${escapeHtml(r.layer)}</td>
    <td>${r.n}</td>
    <td>${fmtNum(Math.round(r.area))} m²</td>
    <td>${escapeHtml(roleLabel(r.role, r.scoreKey))}</td>
  </tr>`).join('');
  const askBox = asks.length ? `<div class="review-ask"><b>${ico('alert')}${asks.length} layer chưa rõ — viền cam nhấp nháy trên bản đồ. Bấm tên layer để phóng tới, rồi chọn nhóm</b>${asks.map(r => {
    const cur = manual.get(r.layer) || '';
    const opts = [`<option value="">Chọn nhóm…</option>`].concat(REVIEW_CHOICES.map(([id, label]) => `<option value="${id}"${cur === id ? ' selected' : ''}>${escapeHtml(label)}</option>`));
    return `<div class="review-ask-item${on(r.layer)}" data-layer-row="${escapeHtml(r.layer)}" data-focus-layer="${escapeHtml(r.layer)}">
      <span class="review-ask-name">${ico('locate')}${escapeHtml(r.layer)} <small>(${r.n} hatch, ${fmtNum(Math.round(r.area))} m²)</small></span>
      <select data-layer="${escapeHtml(r.layer)}">${opts.join('')}</select>
    </div>`;
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
    ${sheetHead(`THẨM ĐỊNH ĐỒ ÁN · ${escapeHtml(session.fileName)}`)}
    <div class="review-cols">
      <div class="review-col">
        <div class="review-note">
          Dân số quy hoạch <b>${pop > 0 ? fmtNum(pop) : 'chưa nhập'}</b> → <b>${units}</b> đơn vị ở (làm tròn lên, ${fmtNum(UNIT_POP)} người/đơn vị, đối chiếu số trường THCS).
          Ranh vàng nét đứt trên bản đồ là đường bao quanh các hatch, không đọc từ file.
          ${housingNote} Kết quả chưa cộng vào bảng phường hay thành phố.
        </div>
        ${askBox}
        <h4>Tổng diện tích theo layer</h4>
        <div class="ward-table-scroll-container"><table class="ward-table review-land">
          <thead><tr><th>Layer</th><th>Số hatch</th><th>Diện tích</th><th>Nhóm</th></tr></thead>
          <tbody>${landRows}</tbody>
        </table></div>
      </div>
      <div class="review-col">
        <h4>Đánh giá QCVN 01:2026/BXD</h4>
        <div class="ward-table-scroll-container"><table class="ward-table">${QCVN_HEAD}<tbody>${body.join('')}</tbody></table></div>
      </div>
    </div>
  </div>`;
  renderDrafts();
}

function openHost() {
  if (!document.body.classList.contains('project-review')) {
    maxWasOn = document.body.classList.contains('bottom-max');
    if (maxWasOn) setBottomPanelMaximized(false);
  }
  document.body.classList.add('project-review');
  map?.invalidateSize({ pan: false });
}

function closeReview() {
  const wasOpen = document.body.classList.contains('project-review');
  document.body.classList.remove('project-review');
  if (wasOpen && maxWasOn) setBottomPanelMaximized(true);
  maxWasOn = false;
  map?.invalidateSize({ pan: false });
  clearMap();
  focused = '';
  const host = $('projectReviewHost');
  if (host) host.innerHTML = '';
  session = null;
}

// ---- Danh sách đồ án trên web (theo tên file DXF đã ghi vào CAD_Polygon) ----

function projectList() {
  const byFile = new Map();
  state.cadParcels.forEach((v, key) => {
    const f = String(v.file || '').trim();
    if (!f) return;
    if (!byFile.has(f)) byFile.set(f, new Set());
    byFile.get(f).add(key.slice(key.indexOf('|') + 1));
  });
  return [...byFile.entries()].map(([file, ids]) => ({ file, n: ids.size })).sort((a, b) => a.file.localeCompare(b.file, 'vi'));
}

function fillReplaceList(preferFile) {
  const sel = $('reviewReplace');
  if (!sel) return;
  const cur = sel.value;
  const list = projectList();
  sel.innerHTML = '<option value="">Đồ án mới (không thay thế)</option>'
    + list.map(d => `<option value="${escapeHtml(d.file)}">${escapeHtml(baseName(d.file))} (${d.n} lô)</option>`).join('');
  const same = preferFile && list.find(d => baseName(d.file).toLowerCase() === baseName(preferFile).toLowerCase());
  if (same) sel.value = same.file;
  else if (list.some(d => d.file === cur)) sel.value = cur;
}

// ---- Hồ sơ đã gửi từ máy này ----

function renderDrafts() {
  const box = $('reviewDrafts');
  if (!box) return;
  const list = loadStore();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="review-drafts"><b>Hồ sơ đã gửi từ máy này</b>${list.map(d => `<div>
    <span>${escapeHtml(d.name)} · ${fmtNum(d.pop)} dân · ${d.units} đơn vị ở${d.replaces ? ` · thay ${escapeHtml(baseName(d.replaces))}` : ''}</span>
    <button type="button" data-open-draft="${escapeHtml(d.id)}">Xem</button>
    <button type="button" data-del-draft="${escapeHtml(d.id)}">Xóa</button>
  </div>`).join('')}</div>`;
}

function rememberSent(pop, replaces, sentId) {
  const list = loadStore();
  list.unshift({
    id: sentId || `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`,
    name: baseName(session.fileName),
    fileName: session.fileName,
    at: new Date().toISOString(),
    pop,
    replaces,
    units: session.scored.units,
    housingArea: session.scored.housingArea,
    rows: session.scored.rows.map(r => ({
      section: r.section, key: r.key, label: r.label, area: r.area, count: r.count,
      demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct, quota: r.quota
    }))
  });
  saveStore(list);
  renderDrafts();
}

function showDraft(id) {
  const d = loadStore().find(x => x.id === id);
  const host = $('projectReviewHost');
  if (!d || !host) return;
  openHost();
  clearMap();
  session = null;
  pdfName = d.name;
  const body = d.rows.map(r => `<tr class="wt-main">
    <td>${r.section}</td><td>${escapeHtml(r.label)}</td><td>${fmtNum(r.area)} m²</td>
    <td>${r.quota > 0 ? `${fmtNum(r.quota)} m²/người` : '—'}</td>
    <td>${r.demand ? `${fmtNum(r.demand)} m²` : '—'}</td><td>${fmtNum(r.count)}</td>
    <td>${pctCell(r.scalePct)}</td><td>${pctCell(r.coverPct)}</td></tr>`).join('');
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    ${sheetHead(`HỒ SƠ ĐÃ GỬI · ${escapeHtml(d.name)}`)}
    <div class="review-note">Dân số ${fmtNum(d.pop)} · ${d.units} đơn vị ở · đất ở ${fmtNum(d.housingArea)} m²${d.replaces ? ` · đề xuất thay thế đồ án ${escapeHtml(baseName(d.replaces))}` : ''}. Bản đồ chỉ hiện khi đang mở file.</div>
    <div class="ward-table-scroll-container"><table class="ward-table">${QCVN_HEAD}<tbody>${body}</tbody></table></div></div>`;
}

// ---- Đọc file ----

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
  focused = '';
  applyTags(built.parcels);
  session = { fileName: file.name, parcels: built.parcels, hull: hullOf(built.parcels), scored: null };
  pdfName = baseName(file.name);
  if (!built.axes.valid) showToast('Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra hệ tọa độ', 'error');
  openHost();
  renderHost();
  drawMap(session.parcels, session.hull, true);
  fillReplaceList(file.name);
}

// ---- Gửi lên hệ thống: ranh lô (GeoJSON WGS84) + kết quả thẩm định vào hàng chờ duyệt ----

const round6 = (v) => (Array.isArray(v) ? v.map(round6) : Math.round(v * 1e6) / 1e6);

function dossierGeoJson(pop, replaces) {
  const scored = session.scored;
  return {
    type: 'FeatureCollection',
    review: {
      source: session.fileName, replaces, pop, units: scored.units, housingArea: scored.housingArea,
      rows: scored.rows.map(r => ({ key: r.key, area: r.area, count: r.count, demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct }))
    },
    features: session.parcels.map(p => {
      const g = geometryOf(p);
      return g && {
        type: 'Feature',
        properties: {
          Layer: p.layer,
          DienTich: Math.round(Number(p.area) || 0),
          GiaiDoan: p.phase,
          NhomThamDinh: p.role === 'score' ? p.scoreKey : p.role
        },
        geometry: { type: g.type, coordinates: round6(g.coordinates) }
      };
    }).filter(Boolean)
  };
}

async function sendDossier() {
  if (sending) return;
  if (!session?.scored) { showToast('Hãy tải file DXF đồ án trước', 'error'); return; }
  const pop = Number($('reviewPop')?.value) || 0;
  if (!(pop > 0)) { showToast('Nhập dân số quy hoạch trước khi gửi', 'error'); $('reviewPop')?.focus(); return; }
  const asks = layerRollup(session.parcels).filter(r => r.role === 'ask');
  if (asks.length) {
    showToast(`Còn ${asks.length} layer chưa rõ nhóm — chọn trong bảng thẩm định trước khi gửi`, 'error');
    focusLayer(asks[0].layer, true);
    revealInSheet(asks[0].layer);
    return;
  }
  const replaces = $('reviewReplace')?.value || '';
  const sender = String($('reviewSender')?.value || '').trim();
  const name = baseName(session.fileName);
  const content = JSON.stringify(dossierGeoJson(pop, replaces));
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > SEND_MAX_BYTES) {
    showToast(`Ranh lô sau chuyển đổi ${fmtNum(Math.round(bytes / 104857.6) / 10)} MB, vượt 2 MB — tách đồ án thành nhiều file`, 'error');
    return;
  }
  const rated = session.scored.rows.filter(r => r.scalePct != null);
  const passed = rated.filter(r => r.scalePct >= 100).length;
  const kinds = `${fmtNum(pop)} dân · ${session.scored.units} đơn vị ở · đạt quy mô ${passed}/${rated.length} chỉ tiêu`;
  const target = replaces ? `đề xuất THAY THẾ đồ án "${baseName(replaces)}"` : 'đồ án mới (không thay thế)';
  if (!confirm(`Gửi hồ sơ "${name}" lên hệ thống?\n• ${session.parcels.length} hatch · ${kinds}\n• ${target}\n• Admin kiểm tra rồi mới đưa lên bản đồ; hồ sơ lưu tạm tối đa 30 ngày.`)) return;
  const btn = $('btnReviewSend');
  sending = true;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(geeApi('action=submitCadPending'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: `${name}.geojson`, ext: 'geojson', content, phase: 'QH', crs: '',
        sender,
        note: replaces ? `Thẩm định, thay thế đồ án ${baseName(replaces)}` : 'Thẩm định, đồ án mới',
        kind: 'review',
        replaces,
        summary: { parcels: session.parcels.length, create: 0, update: 0, wards: [], kinds }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    rememberSent(pop, replaces, data.id);
    showToast(`Đã gửi hồ sơ "${name}" — Admin duyệt rồi mới đưa lên bản đồ`, 'success');
  } catch (err) {
    showToast(`Chưa gửi được: ${err.message}`, 'error');
  } finally {
    sending = false;
    if (btn) btn.disabled = false;
  }
}

async function exportPdf() {
  const sheet = $('projectReviewSheet');
  if (!sheet) { showToast('Chưa có bảng thẩm định', 'error'); return; }
  if (session && layerRollup(session.parcels).some(r => r.role === 'ask')) showToast('Còn layer chưa rõ nhóm — kết quả trong PDF chưa đầy đủ', 'info');
  try { await loadHtml2Pdf(); } catch (e) { showToast('Không tải được thư viện PDF', 'error'); return; }
  window.html2pdf().from(sheet).set({
    margin: 6,
    filename: `Tham-dinh-${pdfName}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2, useCORS: true, scrollY: 0,
      ignoreElements: (el) => !!(el.classList && el.classList.contains('review-noprint'))
    },
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
  $('btnReviewSend')?.addEventListener('click', sendDossier);
  $('btnReviewDrop')?.addEventListener('click', () => { closeReview(); showToast('Đã xóa bản xem trước'); });
  $('reviewDrafts')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-draft]');
    if (open) { showDraft(open.dataset.openDraft); return; }
    const del = e.target.closest('[data-del-draft]');
    if (!del) return;
    saveStore(loadStore().filter(d => d.id !== del.dataset.delDraft));
    renderDrafts();
  });
  const host = $('projectReviewHost');
  host?.addEventListener('click', (e) => {
    if (e.target.closest('#btnReviewClose')) { closeReview(); return; }
    if (e.target.closest('#btnReviewPrint')) { exportPdf(); return; }
    if (e.target.closest('select')) return;
    const row = e.target.closest('[data-focus-layer]');
    if (row && session) focusLayer(row.dataset.focusLayer, true);
  });
  host?.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-layer]');
    if (!sel || !session) return;
    const layer = sel.dataset.layer;
    if (sel.value) manual.set(layer, sel.value); else manual.delete(layer);
    applyTags(session.parcels);
    renderHost();
    drawMap(session.parcels, session.hull, false);
  });
  document.querySelectorAll('.add-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode !== 'addReview') { clearMap(); return; }
      fillReplaceList();
      if (session && !layerGroup) drawMap(session.parcels, session.hull, false);
    });
  });
  renderDrafts();
}
