// Thẩm định đồ án (nút cam trên thanh công cụ trái): nộp hồ sơ QHC 1/10.000 hoặc QHPK 1/2.000 gồm dân số HT / QH,
// file HT-<mã>.dxf và QH-<mã>.dxf → bảng cân đối sử dụng đất theo mẫu TT16 (Mục 2 / Mục 4) → bảng QCVN 01:2026
// (quy mô, độ phủ trên đất ở) → chuyển phê duyệt vào hàng chờ → Admin phê duyệt thì ghi Sheet qua khung Nhập hàng loạt
// (Ten_QH = <mã>, khớp / gộp công trình đã có). Bản đồ đẩy lớp hiện trạng lên trước rồi lớp quy hoạch; chia đôi màn hình
// thì hiện trạng bên trái, quy hoạch bên phải.
import { map } from './mapEngine.js';
import { planMap, isCompareOn, onCompareChange, toggleCompareMode } from './planMap.js';
import { state, BUFFER_COLORS } from './state.js';
import { geeApi } from './api.js';
import { parseDxf, buildParcels, CRS_PRESETS, layerToType } from './cadImport.js';
import { escapeHtml, fmtNum, ico, showToast, loadHtml2Pdf } from './utils.js';
import { setBottomPanelMaximized } from './uiComponents.js';
import { importReviewDossier, rejectPending, REVIEW_DOSSIER_EVENT } from './cadImportUi.js';
import {
  REVIEW_MAX_BYTES, LANDUSE_TABLES, classifyLand, landChoices, landRowByKey, landUseSummary, importLayerName, decisionKind,
  tagParcel, lotRadius, scoreRows, rowLabel, UNIT_POP, projectOfFile
} from './projectReviewCore.js';

const STORE_KEY = 'qh_review_dossiers_v2';
// Hàng chờ duyệt (submitCadPending) nhận tối đa 2 MB nội dung
const SEND_MAX_BYTES = 2 * 1024 * 1024;
const ASK_COLOR = '#fb923c';
const FOCUS_COLOR = '#facc15';
const QH_DELAY_MS = 900;
const SCHOOL_CHOICES = [['MN', 'Mầm non'], ['TH', 'Tiểu học'], ['THCS', 'THCS'], ['NO', 'Không phải trường']];
const MARKET_CHOICES = [['CHO', 'Chợ'], ['TTTM', 'Trung tâm thương mại'], ['NO', 'Không — dịch vụ khác']];
const DECISION_NAME = { MN: 'Trường Mầm non', TH: 'Trường Tiểu học', THCS: 'Trường THCS', CHO: 'Chợ', TTTM: 'Trung tâm thương mại' };
const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

// session: { kind QHC/QHPK, project, popHT, popQH, files {HT, QH}, lots, layerChoice Map layer → đầu mục | 'skip',
//   decisions Map lotId → MN/TH/THCS/CHO/TTTM/NO, reviewId (lô đang hỏi), pendingId (Admin mở hồ sơ chờ), dossierText }
let session = null;
let show = { HT: true, QH: true, buffer: true };
const drawn = { HT: null, QH: null };
let lotLayers = [];
let focusKey = '';
let qhTimer = null;
let maxWasOn = false;
let sending = false;

const isUnresolvedDecision = (lot) => lot.decisionKind && !session.decisions.has(lot.id);
const usable = (lot) => lot.landKey && lot.landKey !== 'skip';

// ============================ PHÂN LOẠI LÔ ============================

function applyTags() {
  const kind = session.kind;
  session.lots.forEach(lot => {
    const chosen = session.layerChoice.get(lot.layer);
    const auto = classifyLand(lot.layer, kind);
    lot.landKey = chosen || (auto ? auto.key : null);
    lot.ask = !lot.landKey;
    lot.prefix = null; lot.type = null; lot.nhom = ''; lot.role = 'other'; lot.scoreKey = null; lot.radius = 0;
    lot.decisionKind = ''; lot.importLayer = null;
    if (!usable(lot)) return;
    const chosenKey = chosen && chosen !== 'skip' ? chosen : null;
    lot.decisionKind = decisionKind(importLayerName(lot, kind, chosenKey, null));
    const dec = lot.decisionKind ? session.decisions.get(lot.id) : undefined;
    lot.importLayer = importLayerName(lot, kind, chosenKey, lot.decisionKind === 'school' || dec === 'NO' ? dec : undefined);
    const t = lot.decisionKind && !dec ? null : layerToType(lot.importLayer);
    if (t) { lot.prefix = t.prefix; lot.type = t.type; lot.nhom = t.nhom; }
    const tag = tagParcel(lot, kind);
    lot.role = tag.role;
    lot.scoreKey = tag.scoreKey;
    lot.radius = lot.role === 'score' ? lotRadius(lot) : 0;
  });
}

function askLayers() {
  const byLayer = new Map();
  session.lots.forEach(lot => {
    if (!lot.ask && !session.layerChoice.has(lot.layer)) return;
    const r = byLayer.get(lot.layer) || { layer: lot.layer, n: 0, area: 0, phases: new Set() };
    r.n++;
    r.area += lot.area;
    r.phases.add(lot.phase);
    byLayer.set(lot.layer, r);
  });
  return [...byLayer.values()].sort((a, b) => b.area - a.area);
}

const decisionQueue = () => session.lots.filter(l => usable(l) && l.decisionKind)
  .sort((a, b) => (a.decisionKind === b.decisionKind ? 0 : a.decisionKind === 'school' ? -1 : 1) || (a.phase === b.phase ? 0 : a.phase === 'HT' ? -1 : 1));

function unresolved() {
  return {
    layers: session.lots.filter(l => l.ask).reduce((s, l) => s.add(l.layer), new Set()).size,
    lots: session.lots.filter(l => usable(l) && isUnresolvedDecision(l)).length
  };
}

// ============================ ĐỘ PHỦ ============================

function featureOf(lot) {
  const g = geometryOf(lot);
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

/** Độ phủ = diện tích đất ở nằm trong bán kính tâm lô / tổng diện tích đất ở. */
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

function geometryOf(lot) {
  if (!lot.polygons || !lot.polygons.length) return null;
  return lot.polygons.length === 1
    ? { type: 'Polygon', coordinates: lot.polygons[0] }
    : { type: 'MultiPolygon', coordinates: lot.polygons };
}

// ============================ BẢN ĐỒ ============================

function clearPhase(phase) {
  const g = drawn[phase];
  if (g) { g.clearLayers(); g.remove(); }
  drawn[phase] = null;
  lotLayers = lotLayers.filter(x => x.lot.phase !== phase);
}

function clearMap() {
  clearTimeout(qhTimer);
  clearPhase('HT');
  clearPhase('QH');
  lotLayers = [];
}

function landColorOf(lot) {
  if (lot.ask) return ASK_COLOR;
  return landRowByKey(session.kind, lot.landKey)?.color || '#94a3b8';
}

function lotStyle(lot) {
  if (lot.ask || isUnresolvedDecision(lot)) {
    return { color: ASK_COLOR, weight: 2.5, opacity: 1, dashArray: '6 4', fillColor: ASK_COLOR, fillOpacity: 0.3 };
  }
  const color = landColorOf(lot);
  const qh = lot.phase === 'QH';
  return { color, weight: lot.role === 'score' ? 2 : 1, opacity: 0.95, dashArray: qh ? null : '4 3', fillColor: color, fillOpacity: lot.role === 'score' ? 0.55 : 0.32 };
}

const targetMap = (phase) => (phase === 'QH' && isCompareOn() && planMap ? planMap : map);

function lotTip(lot) {
  const what = lot.ask ? 'Layer chưa đúng quy định — chọn đầu mục ở bảng'
    : lot.decisionKind && !session.decisions.has(lot.id) ? (lot.decisionKind === 'school' ? 'Chọn cấp trường' : 'Có phải chợ / TTTM?')
      : lot.role === 'score' ? rowLabel(lot.scoreKey) : landRowByKey(session.kind, lot.landKey)?.label || 'Không tính';
  return `<b>${lot.phase}</b> · ${escapeHtml(lot.layer)} · ${fmtNum(Math.round(lot.area))} m²<br>${escapeHtml(what)}${lot.radius ? ` · R ${fmtNum(lot.radius)} m` : ''}`;
}

function drawPhase(phase) {
  clearPhase(phase);
  const m = targetMap(phase);
  if (!session || !show[phase] || !m) return;
  const g = L.featureGroup();
  session.lots.forEach(lot => {
    if (lot.phase !== phase || lot.landKey === 'skip') return;
    const geom = geometryOf(lot);
    if (!geom) return;
    const shape = L.geoJSON(geom, { style: () => lotStyle(lot), bubblingMouseEvents: false })
      .bindTooltip(lotTip(lot), { sticky: true })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (lot.decisionKind && !session.pendingId) { openDecision(lot.id); return; }
        focusRow(lot.ask ? `ask:${lot.layer}` : `land:${lot.landKey}`, false);
      });
    g.addLayer(shape);
    lotLayers.push({ lot, shape });
    if (lot.role === 'score') {
      const color = BUFFER_COLORS[lot.type] || '#38bdf8';
      g.addLayer(L.circleMarker([lot.lat, lot.lng], { radius: 4.5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }));
      if (phase === 'QH' && show.buffer && lot.radius > 0) {
        g.addLayer(L.circle([lot.lat, lot.lng], { radius: lot.radius, color, weight: 1.2, dashArray: '6 5', fillColor: color, fillOpacity: 0.05, interactive: false }));
      }
    }
  });
  g.addTo(m);
  drawn[phase] = g;
  if (focusKey) applyFocus(false);
}

/** sequential: đẩy lớp hiện trạng lên trước, sau QH_DELAY_MS mới đến lớp quy hoạch */
function drawAll(sequential = false) {
  clearTimeout(qhTimer);
  drawPhase('HT');
  if (sequential && show.HT && session.lots.some(l => l.phase === 'HT')) {
    clearPhase('QH');
    qhTimer = setTimeout(() => drawPhase('QH'), QH_DELAY_MS);
  } else {
    drawPhase('QH');
  }
}

/** Khung bản đồ trừ phần panel phải đè lên */
function fitTo(bounds, maxZoom = 18) {
  if (!map || !bounds || !bounds.isValid()) return;
  const rp = document.querySelector('.right-panel');
  const right = rp && rp.offsetParent !== null ? rp.offsetWidth + 24 : 24;
  map.fitBounds(bounds, { paddingTopLeft: [24, 24], paddingBottomRight: [right, 24], maxZoom });
}

function allBounds() {
  const b = L.latLngBounds([]);
  session.lots.forEach(lot => lot.polygons.forEach(poly => poly[0].forEach(([lng, lat]) => b.extend([lat, lng]))));
  return b;
}

const focusMatch = (lot) => {
  if (!focusKey) return false;
  const [k, v] = [focusKey.slice(0, focusKey.indexOf(':')), focusKey.slice(focusKey.indexOf(':') + 1)];
  if (k === 'lot') return lot.id === v;
  if (k === 'ask') return lot.layer === v;
  if (k === 'land') return lot.landKey === v || (landRowByKey(session.kind, v)?.sumOf || []).includes(lot.landKey);
  if (k === 'score') return lot.phase === 'QH' && (lot.scoreKey === v || (REVIEW_SUM[v] || []).includes(lot.scoreKey));
  return false;
};
const REVIEW_SUM = { DVCC_TOTAL: ['YT_DV', 'VH_DV', 'TM_DV'], DVCC_ALL: ['3-MN', '4-TH', '5-THCS', 'YT_DV', 'VH_DV', 'TM_DV'] };

function applyFocus(fit) {
  const bounds = L.latLngBounds([]);
  lotLayers.forEach(({ lot, shape }) => {
    if (focusMatch(lot)) {
      shape.setStyle({ color: FOCUS_COLOR, weight: 3.5, dashArray: null, fillColor: FOCUS_COLOR, fillOpacity: 0.5 });
      shape.bringToFront();
      bounds.extend(shape.getBounds());
    } else {
      shape.setStyle(lotStyle(lot));
    }
  });
  document.querySelectorAll('#projectReviewHost [data-focus]').forEach(el => el.classList.toggle('on', el.dataset.focus === focusKey));
  if (fit) fitTo(bounds, focusKey.startsWith('lot:') ? 18 : 17);
}

function focusRow(key, fit = true) {
  focusKey = focusKey === key && !fit ? '' : key;
  applyFocus(fit);
  const el = document.querySelector(`#projectReviewHost [data-focus="${CSS.escape(focusKey)}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ============================ DUYỆT TỪNG ĐỐI TƯỢNG (TRƯỜNG HỌC / THƯƠNG MẠI) ============================

function openDecision(id) {
  session.reviewId = id;
  renderHost();
  focusRow(`lot:${id}`, true);
}

function nextDecision(afterId) {
  const queue = decisionQueue();
  const at = queue.findIndex(l => l.id === afterId);
  const ordered = [...queue.slice(at + 1), ...queue.slice(0, at + 1)];
  return ordered.find(l => !session.decisions.has(l.id)) || null;
}

function decide(value) {
  const id = session.reviewId;
  if (!id) return;
  session.decisions.set(id, value);
  applyTags();
  const next = nextDecision(id);
  session.reviewId = next ? next.id : null;
  renderHost();
  drawAll(false);
  if (next) focusRow(`lot:${next.id}`, true);
  else { focusKey = ''; applyFocus(false); }
}

function decisionHtml() {
  const queue = decisionQueue();
  if (!queue.length) return '';
  const left = queue.filter(l => !session.decisions.has(l.id)).length;
  const lot = queue.find(l => l.id === session.reviewId);
  const schools = queue.filter(l => l.decisionKind === 'school').length;
  const markets = queue.length - schools;
  const intro = `${schools ? `${schools} lô trường học chưa rõ cấp` : ''}${schools && markets ? ' · ' : ''}${markets ? `${markets} lô thương mại dịch vụ cần xác nhận chợ / TTTM` : ''}`;
  if (!lot) {
    return `<div class="review-decide${left ? '' : ' done'}">${ico(left ? 'alert' : 'check')}${left ? `Còn <b>${left}</b>/${queue.length} lô cần xác nhận (${intro}).` : `Đã xác nhận đủ ${queue.length} lô (${intro}).`}
      <button type="button" class="bp-btn" data-decide-start>${left ? 'Duyệt từng lô' : 'Xem lại'}</button></div>`;
  }
  const at = queue.indexOf(lot);
  const choices = lot.decisionKind === 'school' ? SCHOOL_CHOICES : MARKET_CHOICES;
  const cur = session.decisions.get(lot.id);
  const q = lot.decisionKind === 'school' ? 'Lô trường học chưa rõ cấp — chọn cấp trường' : 'Lô thương mại dịch vụ — đây có phải chợ hoặc trung tâm thương mại không? (cửa hàng, karaoke… chọn Không)';
  return `<div class="review-decide active">
    <div class="review-decide-head">${ico('alert')}${q} <b>${at + 1}/${queue.length}</b> · còn ${left}</div>
    <div class="review-decide-info">${lot.phase === 'HT' ? 'Hiện trạng' : 'Quy hoạch'} · ${escapeHtml(lot.layer)} · ${fmtNum(Math.round(lot.area))} m²</div>
    <div class="review-decide-btns">${choices.map(([v, label]) => `<button type="button" class="bp-btn${cur === v ? ' on' : ''}${v === 'NO' ? ' rej' : ''}" data-decide="${v}">${label}</button>`).join('')}</div>
    <div class="review-decide-nav">
      <button type="button" class="bp-btn" data-decide-nav="-1">‹ Trước</button>
      <button type="button" class="bp-btn" data-decide-nav="1">Sau ›</button>
      <button type="button" class="bp-btn" data-decide-close>Đóng</button>
    </div>
  </div>`;
}

// ============================ BẢNG ============================

const haCell = (v) => (v > 0 ? fmtNum(v) : '');
const pctTxt = (v) => (v > 0 ? fmtNum(v) : '');

function landTableHtml() {
  const table = LANDUSE_TABLES[session.kind];
  const sum = landUseSummary(session.lots, session.kind);
  const body = sum.rows.map(r => {
    if (r.kind === 'section') {
      return `<tr class="lu-section"><td>${r.section}</td><td colspan="2">${escapeHtml(r.label)}</td>
        <td>${haCell(r.htHa)}</td><td>${pctTxt(r.htPct)}</td><td>${haCell(r.qhHa)}</td><td>${pctTxt(r.qhPct)}</td></tr>`;
    }
    const key = `land:${r.key}`;
    return `<tr class="lu-row${r.sub ? ' lu-sub' : ''}${focusKey === key ? ' on' : ''}" data-focus="${key}" title="Bấm để xem các lô trên bản đồ">
      <td>${r.stt}</td><td>${escapeHtml(r.label)}</td>
      <td class="lu-code"><i style="background:${r.color}"></i>${r.code ? `<small>${escapeHtml(r.code)}</small>` : ''}</td>
      <td>${haCell(r.htHa)}</td><td>${pctTxt(r.htPct)}</td><td>${haCell(r.qhHa)}</td><td>${pctTxt(r.qhPct)}</td></tr>`;
  }).join('');
  const totalLabel = sum.sections.length ? `TỔNG CỘNG (${sum.sections.join(' + ')})` : 'TỔNG CỘNG';
  return `<h4>Bảng tổng hợp sử dụng đất — ${escapeHtml(table.short)}</h4>
    <div class="review-sub">${escapeHtml(table.title)}</div>
    <div class="ward-table-scroll-container"><table class="ward-table review-landuse">
      <thead>
        <tr><th rowspan="2">STT</th><th rowspan="2">${session.kind === 'QHC' ? 'Nhóm chức năng / Loại chức năng sử dụng đất' : 'Chức năng sử dụng của ô phố / ô đất'}</th><th rowspan="2">Ký hiệu</th><th colspan="2">Hiện trạng</th><th colspan="2">Quy hoạch</th></tr>
        <tr><th>Diện tích (ha)</th><th>Tỷ lệ (%)</th><th>Diện tích (ha)</th><th>Tỷ lệ (%)</th></tr>
      </thead>
      <tbody>${body}
        <tr class="lu-total"><td></td><td colspan="2">${totalLabel}</td><td>${haCell(sum.totalHT)}</td><td>${sum.totalHT > 0 ? '100' : ''}</td><td>${haCell(sum.totalQH)}</td><td>${sum.totalQH > 0 ? '100' : ''}</td></tr>
      </tbody>
    </table></div>`;
}

function askHtml() {
  const asks = askLayers();
  if (!asks.length || session.pendingId) return '';
  const choices = landChoices(session.kind);
  return `<div class="review-ask"><b>${ico('alert')}Layer đặt tên chưa đúng quy định TT16 (viền cam trên bản đồ) — xác minh đầu mục sử dụng đất</b>${asks.map(r => {
    const cur = session.layerChoice.get(r.layer) || '';
    const opts = [`<option value="">Chọn đầu mục…</option>`]
      .concat(choices.map(c => `<option value="${c.key}"${cur === c.key ? ' selected' : ''}>${escapeHtml(c.label)}</option>`))
      .concat(`<option value="skip"${cur === 'skip' ? ' selected' : ''}>Không tính (không phải đất quy hoạch)</option>`);
    const key = `ask:${r.layer}`;
    return `<div class="review-ask-item${focusKey === key ? ' on' : ''}" data-focus="${escapeHtml(key)}">
      <span class="review-ask-name">${ico('locate')}${escapeHtml(r.layer)} <small>(${[...r.phases].join(' + ')} · ${r.n} hatch · ${fmtNum(Math.round(r.area))} m²)</small></span>
      <select data-layer="${escapeHtml(r.layer)}">${opts.join('')}</select>
    </div>`;
  }).join('')}</div>`;
}

function pctCell(pct) {
  if (pct == null) return '<span class="c-muted">—</span>';
  return `<b class="${pct >= 100 ? 'c-green' : 'c-red'}">${fmtNum(pct)}%</b>`;
}

const QCVN_HEAD = '<thead><tr><th></th><th>Loại hạ tầng</th><th>Diện tích</th><th>Chỉ tiêu</th><th>Nhu cầu</th><th>Số lượng</th><th>Quy mô</th><th>Độ phủ</th></tr></thead>';

function scoreTableHtml(scored) {
  const body = [];
  let last = '';
  scored.rows.forEach(row => {
    if (row.section !== last) {
      last = row.section;
      const title = row.section === 'A' ? 'A · CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ' : `B · CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (quy hoạch: ${scored.units} đơn vị ở)`;
      body.push(`<tr class="wt-section wt-${row.section === 'A' ? 'a' : 'b'}"><td>${row.section}</td><td colspan="7">${title}</td></tr>`);
    }
    const count = row.perUnit && scored.units > 0 ? `${row.count} / ${scored.units}` : fmtNum(row.count);
    const key = `score:${row.key}`;
    body.push(`<tr class="wt-main${focusKey === key ? ' on' : ''}" data-focus="${key}" title="Bấm để xem các lô và bán kính phục vụ">
      <td></td><td>${escapeHtml(row.label)}</td>
      <td>${fmtNum(row.area)} m²</td>
      <td>${row.quota > 0 ? `${fmtNum(row.quota)} m²/người` : '—'}</td>
      <td>${row.demand ? `${fmtNum(row.demand)} m²` : '—'}</td>
      <td>${count}</td>
      <td>${pctCell(row.scalePct)}</td>
      <td>${row.members.length ? pctCell(row.coverPct) : '<span class="c-muted">—</span>'}</td>
    </tr>`);
  });
  return `<h4>Thẩm định QCVN 01:2026/BXD — lớp quy hoạch</h4>
    <div class="ward-table-scroll-container"><table class="ward-table review-score">${QCVN_HEAD}<tbody>${body.join('')}</tbody></table></div>`;
}

function computeScore() {
  const qhLots = session.lots.filter(l => l.phase === 'QH' && usable(l) && !l.ask);
  const scored = scoreRows(qhLots, session.popQH);
  const housingFeature = unionAll(scored.housing.map(featureOf));
  scored.rows.forEach(row => {
    row.coverPct = row.members.some(p => p.radius > 0) ? coverPct(row.members, housingFeature) : null;
  });
  session.scored = scored;
  return scored;
}

function actionsHtml(open) {
  if (session.pendingId) {
    return `<div class="review-foot review-noprint">
      <span>Hồ sơ chờ duyệt${session.sender ? ` · người gửi: <b>${escapeHtml(session.sender)}</b>` : ''}. Phê duyệt: dữ liệu chuyển sang khung Nhập hàng loạt để khớp công trình đã có rồi ghi Sheet (Ten_QH = <b>${escapeHtml(session.project)}</b>).</span>
      <button type="button" class="bp-btn rej" id="btnReviewReject">${ico('close')}Từ chối</button>
      <button type="button" class="bp-btn review-approve" id="btnReviewApprove">${ico('check')}Phê duyệt & ghi Sheet</button>
    </div>`;
  }
  const blocked = open.layers || open.lots;
  return `<div class="review-foot review-noprint">
    ${blocked ? `<span class="c-orange">Còn ${open.layers ? `${open.layers} layer chưa rõ đầu mục` : ''}${open.layers && open.lots ? ' và ' : ''}${open.lots ? `${open.lots} lô chưa xác nhận` : ''} — xử lý trước khi chuyển phê duyệt.</span>` : '<span>Kết quả chưa cộng vào bảng phường xã. Chuyển phê duyệt: hồ sơ vào hàng chờ, Admin duyệt rồi mới ghi Sheet.</span>'}
    <input type="text" id="reviewSender" maxlength="80" placeholder="Người gửi / đơn vị (tùy chọn)" value="${escapeHtml(session.sender || '')}">
    <button type="button" class="bp-btn rej" id="btnReviewCancel">${ico('close')}Hủy bỏ</button>
    <button type="button" class="bp-btn review-approve" id="btnReviewSend"${blocked || sending ? ' disabled' : ''}>${ico('send')}Chuyển phê duyệt</button>
    ${isAdmin() ? `<button type="button" class="bp-btn" id="btnReviewApprove"${blocked ? ' disabled' : ''} title="Admin: ghi thẳng vào Sheet, không qua hàng chờ">${ico('check')}Phê duyệt ngay</button>` : ''}
  </div>`;
}

function renderHost() {
  const host = $('projectReviewHost');
  if (!host || !session) return;
  const scored = computeScore();
  const open = unresolved();
  const table = LANDUSE_TABLES[session.kind];
  const htN = session.lots.filter(l => l.phase === 'HT').length;
  const qhN = session.lots.filter(l => l.phase === 'QH').length;
  const housingNote = scored.housingArea > 0
    ? `Đất ở quy hoạch (${session.kind === 'QHC' ? 'đơn vị ở + hỗn hợp' : 'nhóm nhà ở + hỗn hợp'}) ${fmtNum(scored.housingArea)} m². Độ phủ = phần đất ở nằm trong bán kính phục vụ tính từ tâm lô.`
    : `Chưa có lô đất ở quy hoạch (${session.kind === 'QHC' ? 'DAT_DD_Donvio, DAT_DD_Honhop' : 'DAT_O_Nhomnhao, DAT_O_Honhop_Nhomo'}) — cột độ phủ để trống.`;
  const scrollTop = host.scrollTop;
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head review-head">
      <b class="bp-part-title">THẨM ĐỊNH ${escapeHtml(table.short)} · ${escapeHtml(session.project)}</b>
      <div class="review-head-btns review-noprint">
        <label class="review-toggle"><input type="checkbox" data-show="HT"${show.HT ? ' checked' : ''}>Hiện trạng</label>
        <label class="review-toggle"><input type="checkbox" data-show="QH"${show.QH ? ' checked' : ''}>Quy hoạch</label>
        <label class="review-toggle"><input type="checkbox" data-show="buffer"${show.buffer ? ' checked' : ''}>Bán kính</label>
        <button type="button" class="bp-btn${isCompareOn() ? ' on' : ''}" id="btnReviewCompare" title="Chia đôi màn hình: hiện trạng bên trái, quy hoạch bên phải">${ico('compare')}Chia đôi</button>
        <button type="button" class="bp-btn" id="btnReviewPrint" title="Lưu bảng thẩm định ra file PDF">${ico('printer')}In PDF</button>
        <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
      </div>
    </div>
    <div class="review-note">
      ${escapeHtml(table.label)} · file ${session.files.HT ? `<b>${escapeHtml(session.files.HT)}</b> (${htN} lô)` : '<i>không có file hiện trạng</i>'} và <b>${escapeHtml(session.files.QH)}</b> (${qhN} lô).
      Dân số hiện trạng <b>${session.popHT > 0 ? fmtNum(session.popHT) : '—'}</b> (chỉ để so sánh) · dân số quy hoạch <b>${fmtNum(session.popQH)}</b> → <b>${scored.units}</b> đơn vị ở (${fmtNum(UNIT_POP)} người/đơn vị, làm tròn lên).
      ${housingNote}
    </div>
    ${askHtml()}
    ${session.pendingId ? '' : decisionHtml()}
    <div class="review-cols">
      <div class="review-col">${landTableHtml()}</div>
      <div class="review-col">${scoreTableHtml(scored)}</div>
    </div>
    ${actionsHtml(open)}
  </div>`;
  host.scrollTop = scrollTop;
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
  focusKey = '';
  const host = $('projectReviewHost');
  if (host) host.innerHTML = '';
  session = null;
}

// ============================ BƯỚC 1: ĐỌC HỒ SƠ ============================

function togglePanel(on) {
  const panel = $('reviewPanel');
  const btn = $('btnReviewOpen');
  if (!panel) return;
  const next = on == null ? panel.hidden : on;
  panel.hidden = !next;
  btn?.setAttribute('aria-pressed', String(next));
  btn?.classList.toggle('active', next);
  if (next) renderDrafts();
}

function fileLabel(slot) {
  const input = $(slot === 'HT' ? 'reviewFileHT' : 'reviewFileQH');
  const out = $(slot === 'HT' ? 'reviewFileHTName' : 'reviewFileQHName');
  const f = input?.files && input.files[0];
  if (out) out.textContent = f ? `${f.name} · ${fmtNum(Math.round(f.size / 1024))} KB` : (slot === 'HT' ? 'Chọn HT-<mã>.dxf' : 'Chọn QH-<mã>.dxf');
}

async function readHatches(file, phase, crs) {
  if (!/\.dxf$/i.test(file.name)) throw new Error(`${file.name}: chỉ nhận file .dxf`);
  if (file.size > REVIEW_MAX_BYTES) throw new Error(`${file.name}: lớn hơn 5 MB`);
  const head = await file.slice(0, 22).text();
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error(`${file.name}: DXF nhị phân chưa hỗ trợ — lưu dạng ASCII`);
  const parsed = parseDxf(await file.text());
  const hatches = parsed.entities.filter(e => e.kind === 'HATCH');
  if (!hatches.length) throw new Error(`${file.name}: không có hatch nào`);
  const built = buildParcels(hatches, { crs });
  if (!built.axes.valid) throw new Error(`${file.name}: tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra hệ tọa độ`);
  return built.parcels.filter(p => p.polygons && p.polygons.length).map((p, i) => ({
    id: `${phase}${i}`, phase, layer: p.layer, area: p.area, lat: p.lat, lng: p.lng, polygons: p.polygons
  }));
}

async function startReview() {
  const kind = document.querySelector('input[name="reviewKind"]:checked')?.value;
  const popHT = Number($('reviewPopHT')?.value) || 0;
  const popQH = Number($('reviewPopQH')?.value) || 0;
  const fHT = $('reviewFileHT')?.files?.[0] || null;
  const fQH = $('reviewFileQH')?.files?.[0] || null;
  if (!LANDUSE_TABLES[kind]) { showToast('Chọn loại hồ sơ QHC hoặc QHPK', 'error'); return; }
  if (!(popQH > 0)) { showToast('Nhập dân số quy hoạch', 'error'); $('reviewPopQH')?.focus(); return; }
  if (!fQH) { showToast('Thêm file quy hoạch QH-<mã>.dxf', 'error'); return; }
  if (!/^QH[-_\s]/i.test(fQH.name)) { showToast(`File quy hoạch phải đặt tên QH-<mã>.dxf (đang là ${fQH.name})`, 'error'); return; }
  if (fHT && !/^HT[-_\s]/i.test(fHT.name)) { showToast(`File hiện trạng phải đặt tên HT-<mã>.dxf (đang là ${fHT.name})`, 'error'); return; }
  const project = projectOfFile(fQH.name);
  if (fHT && projectOfFile(fHT.name).toLowerCase() !== project.toLowerCase()) {
    showToast(`Hai file khác mã đồ án: ${projectOfFile(fHT.name)} và ${project}`, 'error');
    return;
  }
  if (!project) { showToast('Tên file thiếu mã đồ án (VD QH-ABCD.dxf)', 'error'); return; }
  const btn = $('btnReviewStart');
  if (btn) btn.disabled = true;
  showToast('Đang đọc hatch…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const crs = CRS_PRESETS[$('reviewCrs')?.value] || CRS_PRESETS.HUE_3;
    const lots = [...(fHT ? await readHatches(fHT, 'HT', crs) : []), ...await readHatches(fQH, 'QH', crs)];
    clearMap();
    session = {
      kind, project, popHT, popQH, files: { HT: fHT ? fHT.name : '', QH: fQH.name }, lots,
      layerChoice: new Map(), decisions: new Map(), reviewId: null, pendingId: null, sender: '', scored: null
    };
    focusKey = '';
    applyTags();
    const first = decisionQueue()[0];
    session.reviewId = !askLayers().length && first ? first.id : null;
    togglePanel(false);
    openHost();
    renderHost();
    fitTo(allBounds(), 17);
    drawAll(true);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================ BƯỚC 4: CHUYỂN PHÊ DUYỆT ============================

const round6 = (v) => (Array.isArray(v) ? v.map(round6) : Math.round(v * 1e6) / 1e6);

function lotName(lot, idx) {
  const dec = session.decisions.get(lot.id);
  return DECISION_NAME[dec] ? `${DECISION_NAME[dec]} ${session.project} ${idx + 1}` : '';
}

function dossierGeoJson() {
  const scored = session.scored;
  const land = landUseSummary(session.lots, session.kind);
  return {
    type: 'FeatureCollection',
    review: {
      v: 2, kind: session.kind, project: session.project, popHT: session.popHT, popQH: session.popQH, files: session.files,
      units: scored.units, housingArea: scored.housingArea,
      landuse: land.rows.filter(r => r.kind === 'row').map(r => ({ key: r.key, htHa: r.htHa, qhHa: r.qhHa })),
      rows: scored.rows.map(r => ({ key: r.key, area: r.area, count: r.count, demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct }))
    },
    features: session.lots.filter(usable).map((lot, idx) => {
      const g = geometryOf(lot);
      const name = lotName(lot, idx);
      return g && {
        type: 'Feature',
        properties: {
          Layer: lot.importLayer,
          LayerGoc: lot.layer,
          GiaiDoan: lot.phase,
          DienTich: Math.round(lot.area * 10) / 10,
          Lat: round6(lot.lat),
          Lng: round6(lot.lng),
          Muc: lot.landKey,
          Chon: session.layerChoice.get(lot.layer) || '',
          QuyetDinh: session.decisions.get(lot.id) || '',
          ...(name ? { Ten: name } : {})
        },
        geometry: { type: g.type, coordinates: round6(g.coordinates) }
      };
    }).filter(Boolean)
  };
}

function resultSummary() {
  const rated = session.scored.rows.filter(r => r.scalePct != null);
  const passed = rated.filter(r => r.scalePct >= 100).length;
  return `${LANDUSE_TABLES[session.kind].short} · ${fmtNum(session.popQH)} dân QH · ${session.scored.units} đơn vị ở · đạt quy mô ${passed}/${rated.length} chỉ tiêu`;
}

async function sendDossier() {
  if (sending || !session) return;
  const open = unresolved();
  if (open.layers || open.lots) { showToast('Còn layer / lô chưa xác nhận', 'error'); return; }
  session.sender = String($('reviewSender')?.value || '').trim();
  const content = JSON.stringify(dossierGeoJson());
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > SEND_MAX_BYTES) {
    showToast(`Hồ sơ sau chuyển đổi ${fmtNum(Math.round(bytes / 104857.6) / 10)} MB, vượt 2 MB — tách đồ án thành nhiều phần`, 'error');
    return;
  }
  const kinds = resultSummary();
  if (!confirm(`Chuyển phê duyệt hồ sơ "${session.project}"?\n• ${kinds}\n• Hồ sơ ở trạng thái chờ; Admin kiểm tra rồi mới ghi Sheet (lưu tạm tối đa 30 ngày).`)) return;
  sending = true;
  renderHost();
  try {
    const res = await fetch(geeApi('action=submitCadPending'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: `${session.project}.geojson`, ext: 'geojson', content, phase: 'QH', crs: '',
        sender: session.sender,
        note: `Thẩm định ${LANDUSE_TABLES[session.kind].short}`,
        kind: 'review',
        summary: { parcels: session.lots.filter(usable).length, create: 0, update: 0, wards: [], kinds }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    rememberSent(data.id);
    showToast(`Đã chuyển phê duyệt hồ sơ "${session.project}" — chờ Admin duyệt`, 'success');
    closeReview();
  } catch (err) {
    showToast(`Chưa gửi được: ${err.message}`, 'error');
  } finally {
    sending = false;
    if (session) renderHost();
  }
}

// ============================ BƯỚC 5: ADMIN PHÊ DUYỆT ============================

async function approve() {
  if (!session || !isAdmin()) return;
  const text = session.dossierText || JSON.stringify(dossierGeoJson());
  const fileName = `${session.project}.geojson`;
  const pendingId = session.pendingId;
  closeReview();
  await importReviewDossier(text, fileName, pendingId);
  showToast('Kiểm tra khớp công trình đã có trong khung Nhập hàng loạt rồi bấm GHI VÀO HỆ THỐNG', 'info');
}

async function reject() {
  if (!session?.pendingId) return;
  if (await rejectPending(session.pendingId)) {
    showToast('Đã từ chối hồ sơ', 'success');
    closeReview();
  }
}

function polygonsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function openDossier({ id, item, text }) {
  let data;
  try { data = JSON.parse(text); } catch (e) { showToast('Hồ sơ hỏng, không đọc được', 'error'); return; }
  const meta = data.review || {};
  if (meta.v !== 2 || !LANDUSE_TABLES[meta.kind]) {
    showToast('Hồ sơ thẩm định theo mẫu cũ — mở trong khung Nhập hàng loạt', 'info');
    importReviewDossier(text, item.fileName || 'tham-dinh.geojson', id);
    return;
  }
  const layerChoice = new Map();
  const decisions = new Map();
  const lots = (data.features || []).map((f, i) => {
    const p = f.properties || {};
    const lot = {
      id: `${p.GiaiDoan === 'HT' ? 'HT' : 'QH'}${i}`, phase: p.GiaiDoan === 'HT' ? 'HT' : 'QH', layer: String(p.LayerGoc || p.Layer || ''),
      area: Number(p.DienTich) || 0, lat: Number(p.Lat), lng: Number(p.Lng), polygons: polygonsOf(f.geometry)
    };
    if (p.Chon) layerChoice.set(lot.layer, String(p.Chon));
    if (p.QuyetDinh) decisions.set(lot.id, String(p.QuyetDinh));
    return lot;
  }).filter(l => l.polygons.length && Number.isFinite(l.lat) && Number.isFinite(l.lng));
  clearMap();
  session = {
    kind: meta.kind, project: String(meta.project || projectOfFile(item.fileName)), popHT: Number(meta.popHT) || 0, popQH: Number(meta.popQH) || 0,
    files: meta.files || { HT: '', QH: item.fileName }, lots, layerChoice, decisions, reviewId: null,
    pendingId: id, dossierText: text, sender: item.sender || '', scored: null
  };
  focusKey = '';
  applyTags();
  openHost();
  renderHost();
  fitTo(allBounds(), 17);
  drawAll(true);
}

// ============================ HỒ SƠ ĐÃ GỬI TỪ MÁY NÀY ============================

function loadStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function saveStore(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* đầy bộ nhớ */ }
}

function rememberSent(sentId) {
  const land = landUseSummary(session.lots, session.kind);
  const list = loadStore();
  list.unshift({
    id: sentId || `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`,
    kind: session.kind, name: session.project, at: new Date().toISOString(),
    popHT: session.popHT, popQH: session.popQH, units: session.scored.units, housingArea: session.scored.housingArea,
    landHtml: landTableHtml(), totalQH: land.totalQH,
    rows: session.scored.rows.map(r => ({ section: r.section, label: r.label, area: r.area, count: r.count, demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct, quota: r.quota }))
  });
  saveStore(list);
}

function renderDrafts() {
  const box = $('reviewDrafts');
  if (!box) return;
  const list = loadStore();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="review-drafts"><b>Hồ sơ đã gửi từ máy này</b>${list.map(d => `<div>
    <span>${escapeHtml(d.kind)} · ${escapeHtml(d.name)} · ${fmtNum(d.popQH)} dân</span>
    <button type="button" data-open-draft="${escapeHtml(d.id)}">Xem</button>
    <button type="button" data-del-draft="${escapeHtml(d.id)}">Xóa</button>
  </div>`).join('')}</div>`;
}

function showDraft(id) {
  const d = loadStore().find(x => x.id === id);
  const host = $('projectReviewHost');
  if (!d || !host) return;
  clearMap();
  session = null;
  openHost();
  const body = d.rows.map(r => `<tr class="wt-main">
    <td>${r.section}</td><td>${escapeHtml(r.label)}</td><td>${fmtNum(r.area)} m²</td>
    <td>${r.quota > 0 ? `${fmtNum(r.quota)} m²/người` : '—'}</td>
    <td>${r.demand ? `${fmtNum(r.demand)} m²` : '—'}</td><td>${fmtNum(r.count)}</td>
    <td>${pctCell(r.scalePct)}</td><td>${pctCell(r.coverPct)}</td></tr>`).join('');
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head review-head"><b class="bp-part-title">HỒ SƠ ĐÃ GỬI · ${escapeHtml(d.kind)} · ${escapeHtml(d.name)}</b>
      <div class="review-head-btns review-noprint">
        <button type="button" class="bp-btn" id="btnReviewPrint">${ico('printer')}In PDF</button>
        <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
      </div></div>
    <div class="review-note">Dân số HT ${fmtNum(d.popHT || 0)} · QH ${fmtNum(d.popQH)} · ${d.units} đơn vị ở · đất ở ${fmtNum(d.housingArea)} m². Bản đồ chỉ hiện khi đang mở file.</div>
    <div class="review-cols">
      <div class="review-col">${d.landHtml || ''}</div>
      <div class="review-col"><h4>Thẩm định QCVN 01:2026/BXD</h4><div class="ward-table-scroll-container"><table class="ward-table">${QCVN_HEAD}<tbody>${body}</tbody></table></div></div>
    </div></div>`;
}

async function exportPdf() {
  const sheet = $('projectReviewSheet');
  if (!sheet) { showToast('Chưa có bảng thẩm định', 'error'); return; }
  if (session) {
    const open = unresolved();
    if (open.layers || open.lots) showToast('Còn layer / lô chưa xác nhận — kết quả trong PDF chưa đầy đủ', 'info');
  }
  try { await loadHtml2Pdf(); } catch (e) { showToast('Không tải được thư viện PDF', 'error'); return; }
  window.html2pdf().from(sheet).set({
    margin: 6,
    filename: `Tham-dinh-${session ? session.project : 'ho-so'}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2, useCORS: true, scrollY: 0,
      ignoreElements: (el) => !!(el.classList && el.classList.contains('review-noprint'))
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save();
}

// ============================ KHỞI TẠO ============================

export function initProjectReview() {
  $('btnReviewOpen')?.addEventListener('click', () => togglePanel());
  $('btnReviewPanelClose')?.addEventListener('click', () => togglePanel(false));
  ['HT', 'QH'].forEach(slot => $(slot === 'HT' ? 'reviewFileHT' : 'reviewFileQH')?.addEventListener('change', () => fileLabel(slot)));
  $('btnReviewStart')?.addEventListener('click', startReview);
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
    const t = e.target;
    if (t.closest('#btnReviewClose')) { closeReview(); return; }
    if (t.closest('#btnReviewPrint')) { exportPdf(); return; }
    if (!session) return;
    if (t.closest('#btnReviewCompare')) { toggleCompareMode(); return; }
    if (t.closest('#btnReviewCancel')) { if (confirm('Hủy bỏ hồ sơ thẩm định đang xem?')) closeReview(); return; }
    if (t.closest('#btnReviewSend')) { sendDossier(); return; }
    if (t.closest('#btnReviewApprove')) { approve(); return; }
    if (t.closest('#btnReviewReject')) { reject(); return; }
    const dec = t.closest('[data-decide]');
    if (dec) { decide(dec.dataset.decide); return; }
    if (t.closest('[data-decide-start]')) {
      const first = decisionQueue().find(l => !session.decisions.has(l.id)) || decisionQueue()[0];
      if (first) openDecision(first.id);
      return;
    }
    const nav = t.closest('[data-decide-nav]');
    if (nav) {
      const queue = decisionQueue();
      const at = queue.findIndex(l => l.id === session.reviewId);
      const next = queue[(at + Number(nav.dataset.decideNav) + queue.length) % queue.length];
      if (next) openDecision(next.id);
      return;
    }
    if (t.closest('[data-decide-close]')) { session.reviewId = null; focusKey = ''; renderHost(); applyFocus(false); return; }
    if (t.closest('select, input, label')) return;
    const row = t.closest('[data-focus]');
    if (row) focusRow(row.dataset.focus, true);
  });
  host?.addEventListener('change', (e) => {
    if (!session) return;
    const toggle = e.target.closest('input[data-show]');
    if (toggle) {
      show[toggle.dataset.show] = toggle.checked;
      drawAll(false);
      return;
    }
    const sel = e.target.closest('select[data-layer]');
    if (!sel) return;
    if (sel.value) session.layerChoice.set(sel.dataset.layer, sel.value);
    else session.layerChoice.delete(sel.dataset.layer);
    applyTags();
    renderHost();
    drawAll(false);
  });
  host?.addEventListener('input', (e) => {
    if (session && e.target.id === 'reviewSender') session.sender = e.target.value;
  });

  onCompareChange(() => {
    if (!session) return;
    drawAll(false);
    $('btnReviewCompare')?.classList.toggle('on', isCompareOn());
  });
  document.addEventListener(REVIEW_DOSSIER_EVENT, (e) => openDossier(e.detail || {}));
}
