// Tab Đề xuất → "Nhập hàng loạt": đọc file DXF/KML/KMZ/GeoJSON, xem trước các lô trên bản đồ và báo cáo kiểm tra trước khi ghi
import { state, infraLabels, BUFFER_COLORS } from './state.js';
import { landColor, landLabel } from './tt16Symbols.js';
import { map } from './mapEngine.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, distanceMeters, ico, setStatusContent } from './utils.js';
import {
  parseDxf, buildParcels, buildParcelsLonLat, assignWards, matchExisting, layerToType, tt16Layer, linkStages, sameSite,
  filePhaseFromName, LAYER_PREFIXES, SCHOOL_PENDING, CRS_PRESETS
} from './cadImport.js';
import { parseKml, unzipKml } from './kmlImport.js';
import { parseGeoJson } from './geojsonImport.js';
import { createManualMapping, selectField, setCode, clearCodes, applyManualMapping, manualMappingHtml } from './cadTypeMapping.js';

// Diện tích tối thiểu theo loại (khớp config/constants.js → infraConfig.minSize)
const MIN_SIZE = { "1-CV": 300, "2-BDX": 200, "3-MN": 800, "4-TH": 2000, "5-THCS": 2500, "7-YT": 1000, "8-VH": 500, "9-TM": 1500 };
const MAX_LISTED = 200;
const LAND_KEY = 'zz-land';
// Mỗi lần gửi: tối đa 300 lô (giới hạn máy chủ) và ~2,5 MB (Vercel nhận tối đa 4,5 MB/yêu cầu)
const CHUNK_MAX_ITEMS = 250;
const CHUNK_MAX_CHARS = 2500000;
// Người dùng chưa đăng nhập: chỉ gửi file ≤ 2 MB vào hàng chờ duyệt trên bucket (máy chủ kiểm tra lại), không ghi Sheet
const GUEST_MAX_BYTES = 2 * 1024 * 1024;

// Lựa chọn cho lô chứa nhiều công trình cùng loại (ngoài ID công trình cần cập nhật)
const CHOICE_NEW = '__new';
const CHOICE_SKIP = '__skip';

// current: { fileName, format: 'dxf'|'kml'|'geojson', wgs84, stats, tt16 (file đặt tên layer theo TT16), base (lô trước khi khớp),
//   result, manual (khớp thủ công), items: Map ID → công trình đang có, levels: Map src → MN/TH/THCS/reject, reviewSrc,
//   raw: { ext, text } nội dung file (KMZ đã giải nén) để gửi hàng chờ, pendingId: hồ sơ chờ duyệt Admin đang mở }
let current = null;
let pendingItems = null;      // hồ sơ chờ duyệt (Admin), null = chưa tải
let previewLayer = null;
let reviewLayer = null;
let submitting = false;
let onImported = null;
let dupTargets = new Set();   // "giai đoạn|ID" công trình bị nhiều lô cùng chọn cập nhật

// Cấp trường cho lô Truonghoc thiếu hậu tố
const SCHOOL_LEVELS = [['MN', 'Mầm non'], ['TH', 'Tiểu học'], ['THCS', 'THCS']];
const LEVEL_REJECT = 'reject';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;
const fmtMB = (bytes) => `${fmtNum(Math.round(bytes / 1024 / 1024 * 100) / 100)} MB`;

function setStatus(text, color) {
  const el = $('cadStatus');
  if (!el) return;
  el.style.color = color || '';
  setStatusContent(el, text);
}

function fmtArea(m2) {
  return m2 >= 10000 ? `${fmtNum(Math.round(m2 / 100) / 100)} ha` : `${fmtNum(Math.round(m2))} m²`;
}

const isPoint = (p) => p.kind === 'POINT';
const sizeText = (p) => (isPoint(p) ? 'điểm' : fmtArea(p.area));

// Tên loại đối tượng được nhận (theo định dạng file) dùng trong câu tóm tắt
function kindLabel(kind, format) {
  if (kind === 'POINT') return 'điểm';
  if (kind === 'HATCH') return 'hatch';
  if (kind === 'POLYGON') return 'polygon';
  return format === 'dxf' ? 'polyline kín' : 'đường khép kín';
}

// "a, b và c"
function joinVi(parts) {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} và ${parts[parts.length - 1]}` : parts.join('');
}

// { nhãn: số } → "50 hatch, 30 polygon và 10 điểm" (giữ thứ tự hatch / polygon / polyline / điểm)
function countText(counts, sortByCount = false) {
  const list = Object.entries(counts).filter(([, n]) => n > 0);
  if (sortByCount) list.sort((a, b) => b[1] - a[1]);
  return joinVi(list.map(([label, n]) => `${fmtNum(n)} ${label}`));
}

function kindCounts(list, format) {
  const counts = {};
  ['HATCH', 'POLYGON', 'LWPOLYLINE', 'POLYLINE', 'POINT'].forEach(k => {
    const n = list.filter(x => x.kind === k).length;
    if (n) counts[kindLabel(k, format)] = (counts[kindLabel(k, format)] || 0) + n;
  });
  return counts;
}

// Giai đoạn ghi quy mô: tên file DXF (QH- / HT-) thắng ô Giai đoạn; không có tiền tố thì layer TT16, còn lại theo ô
const globalPhase = () => ($('cadPhase')?.value === 'QH' ? 'QH' : 'HT');
const phaseOf = (p) => p.phase || globalPhase();
const phasesOf = (p) => (p.keep ? ['HT', 'QH'] : p.partner ? [phaseOf(p), phaseOf(p.partner)] : [phaseOf(p)]);

// Tên file quyết định cột quy mô: HT- → QuyMo_HT, QH- → QuyMo_QH (kể cả layer có tiền tố HT).
function applyFilePhase(parcels) {
  const fp = current && current.filePhase;
  if (fp !== 'HT' && fp !== 'QH') return;
  parcels.forEach(p => {
    p.keep = false;
    p.phase = fp;
    p.stage = fp;
  });
}

function markUnchanged() {}

function syncPhaseSelect() {
  const sel = $('cadPhase');
  if (!sel) return;
  const locked = current && (current.filePhase === 'HT' || current.filePhase === 'QH');
  sel.disabled = !!locked;
  if (locked) sel.value = current.filePhase;
  sel.title = locked
    ? `Theo tên file: ${current.filePhase === 'QH' ? 'quy hoạch (mọi layer ghi QuyMo_QH)' : 'hiện trạng (mọi layer ghi QuyMo_HT)'}`
    : 'Áp dụng khi tên file không có tiền tố HT / QH. Layer TT16 lấy giai đoạn theo tiền tố HT_ / QHDD_ / QHDH_.';
}

// ID công trình lô sẽ cập nhật (null = tạo mới / bỏ qua / ngoài TP)
function targetId(p) {
  if (!p.ward) return null;
  if (p.matchConflict) return p.choice === CHOICE_NEW || p.choice === CHOICE_SKIP ? null : p.choice || null;
  return p.matchId || null;
}

// Cặp HT + QH: công trình khớp với lô HT, không có thì với lô QH
const recordId = (p) => targetId(p) || (p.partner ? targetId(p.partner) : null);
const idle = (p) => p.pending || p.rejected || p.merged;

function refreshDupTargets(parcels) {
  const seen = new Map();
  parcels.forEach(p => {
    const id = !idle(p) && recordId(p);
    if (id) phasesOf(p).forEach(ph => seen.set(`${ph}|${id}`, (seen.get(`${ph}|${id}`) || 0) + 1));
  });
  dupTargets = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

// Mặc định cho lô chứa nhiều công trình: công trình gần tâm lô nhất
function nearestChoice(p) {
  let best = CHOICE_SKIP, bestD = Infinity;
  p.matchConflict.forEach(id => {
    const it = current.items.get(id);
    if (!it) return;
    const d = distanceMeters(p.lat, p.lng, Number(it.lat), Number(it.lng));
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

const writable = (parcels) => parcels.filter(p => ['new', 'update'].includes(parcelAction(p).key));

// Trạng thái xử lý của 1 lô khi ghi: bỏ qua / cập nhật / tạo mới; vắt ranh thì quy mô = 0
function parcelAction(p) {
  if (!p.ward) return { key: 'out', label: 'Ngoài TP', cls: 'bad' };
  if (p.land) return { key: 'land', label: 'Sheet đồ án', cls: 'info' };
  if (p.pending) return { key: 'pending', label: 'Chờ chọn cấp trường', cls: 'warn' };
  if (p.rejected) return { key: 'rejected', label: 'Đã từ chối', cls: 'bad' };
  if (p.merged) return { key: 'merged', label: 'Gộp với lô HT', cls: 'info' };
  if (p.existingId) return { key: 'exists', label: `Đã có ${p.existingId}`, cls: 'warn' };
  if (p.matchConflict && p.choice === CHOICE_SKIP) return { key: 'skip', label: 'Bỏ qua', cls: 'warn' };
  const id = recordId(p);
  const both = p.partner ? ' · HT+QH' : p.keep ? ' · giữ nguyên' : '';
  if (id && phasesOf(p).some(ph => dupTargets.has(`${ph}|${id}`))) return { key: 'dup', label: `Trùng ${id}`, cls: 'bad' };
  if (id) return { key: 'update', label: `Cập nhật ${id}${both}`, cls: 'info', id };
  return { key: 'new', label: `Tạo mới${both}`, cls: 'ok' };
}

function pickHtml(p, idx) {
  const options = p.matchConflict.map(id => {
    const it = current.items.get(id);
    const d = it ? Math.round(distanceMeters(p.lat, p.lng, Number(it.lat), Number(it.lng))) : null;
    const label = `Cập nhật ${id}${it ? ` · ${it.name}` : ''}${d != null ? ` · cách tâm ${fmtNum(d)} m` : ''}`;
    return `<option value="${escapeHtml(id)}"${p.choice === id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  });
  options.push(`<option value="${CHOICE_NEW}"${p.choice === CHOICE_NEW ? ' selected' : ''}>+ Tạo công trình mới</option>`);
  options.push(`<option value="${CHOICE_SKIP}"${p.choice === CHOICE_SKIP ? ' selected' : ''}>Bỏ qua lô này</option>`);
  return `<select class="cad-pick" data-idx="${idx}" title="Lô chứa ${p.matchConflict.length} công trình cùng loại">${options.join('')}</select>`;
}

// Tên layer hiển thị; lô khớp thủ công / lô trường học đã chọn cấp kèm mã loại đã gán
const layerText = (p) => (p.manual || (p.school && p.prefix) ? `${p.layer} → ${p.prefix}` : p.layer);
const typeColor = (p) => (p.pending ? '#facc15' : p.land ? (landColor(p.layer) || '#94a3b8') : BUFFER_COLORS[p.type] || '#38bdf8');

function parcelTip(p) {
  const pair = p.partner ? `<br>+ ${escapeHtml(p.partner.layer)} · ${sizeText(p.partner)}` : '';
  return `<b>${escapeHtml(layerText(p))}</b> · ${sizeText(p)}${pair}<br>${escapeHtml(p.ward || 'Ngoài TP. Huế')}${p.crossWard ? ' · <span style="color:#f87171">vắt ranh</span>' : ''}<br>${escapeHtml(parcelAction(p).label)}`;
}

function clearReviewMark() {
  if (reviewLayer) reviewLayer.remove();
  reviewLayer = null;
}

function clearPreview() {
  if (previewLayer) previewLayer.remove();
  previewLayer = null;
  clearReviewMark();
}

// Lề khi zoom: chừa thêm phần bản đồ bị panel phải (nổi trên bản đồ) che, tối đa 60% bề ngang
function viewPadding(pad) {
  const m = map.getContainer().getBoundingClientRect();
  const panel = $('rightPanel');
  const r = panel && panel.offsetWidth ? panel.getBoundingClientRect() : null;
  const cover = r && r.left < m.right && r.bottom > m.top ? Math.min(m.right - r.left, m.width * 0.6) : 0;
  return { paddingTopLeft: [pad, pad], paddingBottomRight: [pad + Math.max(0, cover), pad] };
}

// fit = false (đổi khớp thủ công): giữ khung nhìn, trừ lần đầu có lô để xem; focus: zoom tới lô này thay cho toàn bộ file
// (Leaflet bỏ qua lệnh zoom mới khi đang chạy hiệu ứng zoom trước, nên chỉ gọi 1 lệnh)
function drawPreview(parcels, fit = true, focus = null) {
  const hadPreview = !!previewLayer;
  clearPreview();
  if (!map || !parcels.length) return;
  if (!hadPreview) fit = true;
  previewLayer = L.featureGroup();
  parcels.forEach((p, idx) => {
    const color = typeColor(p);
    if (isPoint(p)) {
      const dot = L.circleMarker([p.lat, p.lng], {
        radius: 7, weight: 2, color: '#fff', dashArray: p.ward ? null : '3,3',
        fillColor: p.ward ? color : '#94a3b8', fillOpacity: p.existingId ? 0.35 : 0.95
      }).bindTooltip(() => parcelTip(p), { sticky: true });
      dot.on('click', () => focusRow(idx));
      previewLayer.addLayer(dot);
      return;
    }
    const style = !p.ward
      ? { color: '#94a3b8', weight: 2, dashArray: '4,4', fillColor: '#94a3b8', fillOpacity: 0.2 }
      : p.rejected
        ? { color: '#64748b', weight: 1.5, dashArray: '2,4', fillColor: '#64748b', fillOpacity: 0.12 }
        : p.pending
          ? { color, weight: 2.5, dashArray: '6,4', fillColor: color, fillOpacity: 0.3 }
          : p.crossWard
            ? { color: '#ef4444', weight: 2.5, dashArray: '6,4', fillColor: color, fillOpacity: 0.3 }
            : p.merged
              ? { color, weight: 2, dashArray: '3,5', fillColor: color, fillOpacity: 0.08 }
              : { color, weight: 2, fillColor: color, fillOpacity: 0.35 };
    const poly = L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }, { style, interactive: true }).bindTooltip(() => parcelTip(p), { sticky: true });
    poly.on('click', () => focusRow(idx));
    previewLayer.addLayer(poly);
    previewLayer.addLayer(L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }));
  });
  previewLayer.addTo(map);
  if (focus) zoomToParcel(focus);
  else if (fit) map.fitBounds(previewLayer.getBounds(), { ...viewPadding(40), maxZoom: 17 });
}

function zoomToParcel(p, maxZoom = 18) {
  if (!map || !p) return;
  const bounds = isPoint(p) ? L.latLng(p.lat, p.lng).toBounds(120) : L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }).getBounds();
  map.fitBounds(bounds, { ...viewPadding(60), maxZoom });
}

// ---- Duyệt từng lô Truonghoc thiếu hậu tố cấp trường ----

// Lô cần duyệt (trong TP), theo thứ tự trong file
const schoolLots = () => (current?.base?.parcels || []).filter(p => p.school && p.ward);

function applyLevels(parcels) {
  parcels.forEach(p => {
    if (!p.school) return;
    const lv = current.levels.get(p.src);
    const chosen = lv && lv !== LEVEL_REJECT;
    p.pending = !lv;
    p.rejected = lv === LEVEL_REJECT;
    p.prefix = chosen ? lv : '';
    p.type = chosen ? LAYER_PREFIXES[lv] : SCHOOL_PENDING;
  });
}

function markReview(p) {
  clearReviewMark();
  if (!map || !p) return;
  reviewLayer = isPoint(p)
    ? L.circleMarker([p.lat, p.lng], { radius: 14, color: '#facc15', weight: 3, fill: false, interactive: false })
    : L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }, { style: { color: '#facc15', weight: 4, fill: false }, interactive: false });
  reviewLayer.addTo(map);
}

// Mở lô src để duyệt: tô sáng + zoom tới lô
function openReview(src) {
  const p = schoolLots().find(x => x.src === src);
  current.reviewSrc = p ? p.src : null;
  renderReport();
  markReview(p);
  zoomToParcel(p);
}

// Chọn cấp / từ chối lô đang duyệt; áp dụng luôn cho lô Truonghoc chưa duyệt cùng vị trí ở giai đoạn khác, rồi sang lô kế tiếp
function decideReview(level) {
  const lots = schoolLots();
  const at = lots.findIndex(p => p.src === current.reviewSrc);
  const p = lots[at];
  if (!p) return;
  current.levels.set(p.src, level);
  const spot = (x) => ({ ...x, type: SCHOOL_PENDING, prefix: '' });
  lots.forEach(q => {
    if (q !== p && !current.levels.has(q.src) && q.stage !== p.stage && sameSite(spot(q), spot(p))) current.levels.set(q.src, level);
  });
  refreshParcels();
  drawPreview(current.result.parcels, false);
  const next = [...lots.slice(at + 1), ...lots.slice(0, at)].find(q => !current.levels.has(q.src));
  if (next) openReview(next.src);
  else { current.reviewSrc = null; renderReport(); clearReviewMark(); }
}

function reviewHtml() {
  const lots = schoolLots();
  if (!lots.length) return '';
  const left = lots.filter(p => !current.levels.has(p.src)).length;
  const at = lots.findIndex(p => p.src === current.reviewSrc);
  if (at < 0) {
    return `<div class="cad-review done">${ico(left ? 'alert' : 'check')}${left ? `Còn <b>${left}</b>/${lots.length} lô trường học chưa rõ cấp (layer Truonghoc thiếu hậu tố _MN / _TH / _THCS).`
      : `Đã duyệt ${lots.length} lô trường học chưa rõ cấp.`}
      <button type="button" class="cad-rev-open" data-src="${(lots.find(p => !current.levels.has(p.src)) || lots[0]).src}">${left ? 'Duyệt tiếp' : 'Xem lại'}</button></div>`;
  }
  const p = lots[at];
  const lv = current.levels.get(p.src);
  const btn = (code, label, cls = '') => `<button type="button" class="cad-rev-btn${cls}${lv === code ? ' on' : ''}" data-lv="${code}">${label}</button>`;
  return `<div class="cad-review">
    <div class="cad-review-head">${ico('alert')}Lô trường học chưa rõ cấp <b>${at + 1}/${lots.length}</b> · còn ${left} lô chưa duyệt</div>
    <div class="cad-review-info">${escapeHtml(p.layer)} · ${sizeText(p)} · ${escapeHtml(p.ward)}${p.crossWard ? ' · vắt ranh' : ''}</div>
    <div class="cad-review-btns">${SCHOOL_LEVELS.map(([code, label]) => btn(code, `${ico('check')}${label}`)).join('')}${btn(LEVEL_REJECT, `${ico('close')}Từ chối`, ' rej')}</div>
    <div class="cad-review-nav">
      <button type="button" class="cad-rev-go" data-src="${lots[(at - 1 + lots.length) % lots.length].src}">‹ Lô trước</button>
      <button type="button" class="cad-rev-go" data-src="${lots[(at + 1) % lots.length].src}">Lô sau ›</button>
      <button type="button" class="cad-rev-close">Đóng</button>
    </div>
  </div>`;
}

function bindReview(box) {
  box.querySelectorAll('.cad-rev-btn').forEach(b => b.addEventListener('click', () => decideReview(b.dataset.lv)));
  box.querySelectorAll('.cad-rev-go, .cad-rev-open').forEach(b => b.addEventListener('click', () => openReview(Number(b.dataset.src))));
  box.querySelector('.cad-rev-close')?.addEventListener('click', () => { current.reviewSrc = null; renderReport(); clearReviewMark(); });
}

function focusRow(idx) {
  const row = document.querySelector(`#cadReport [data-idx="${idx}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 900);
}

function renderReport() {
  const box = $('cadReport');
  const btn = $('btnCadSubmit');
  if (!box) return;
  if (!current) { box.innerHTML = ''; if (btn) btn.disabled = true; return; }

  const { fileName, stats, result } = current;
  const phase = globalPhase();
  const parcels = result.parcels;
  refreshDupTargets(parcels);
  const byType = {};
  const count = {
    out: 0, exists: 0, skip: 0, dup: 0, update: 0, new: 0, pending: 0, rejected: 0, merged: 0,
    cross: 0, small: 0, multi: 0, newPoint: 0, tt16HT: 0, tt16QH: 0, land: 0
  };
  parcels.forEach(p => {
    const a = parcelAction(p);
    count[a.key]++;
    if (p.ward && p.matchConflict) count.multi++;
    if (p.ward && p.crossWard && !p.rejected && !p.land) count.cross++;
    if (p.ward && !isPoint(p) && MIN_SIZE[p.type] && p.area < MIN_SIZE[p.type]) count.small++;
    if (a.key === 'new' && isPoint(p)) count.newPoint++;
    if (p.tt16 && !p.land && p.ward && !p.rejected) count[p.phase === 'HT' ? 'tt16HT' : 'tt16QH']++;
    if (p.rejected) return;
    const key = p.land ? LAND_KEY : p.type;
    const t = byType[key] || (byType[key] = { n: 0, area: 0 });
    t.n++;
    if (p.ward && !p.crossWard) t.area += p.area;
  });

  const isVector = current.format !== 'dxf';
  const UNKNOWN_LABEL = {
    dxf: 'Layer không nhận diện',
    kml: 'Không nhận diện được loại (trường Layer / Folder / tên Placemark)',
    geojson: 'Không nhận diện được loại (thuộc tính Layer / tên)'
  };
  const alerts = [];
  if (!result.axes.valid) alerts.push(['bad', current.wgs84
    ? 'Tọa độ không nằm trong khu vực TP. Huế — kiểm tra lại hệ tọa độ khi xuất file (phải là WGS84 hoặc VN-2000).'
    : 'Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra lại hệ tọa độ / đơn vị bản vẽ.']);
  else if (result.axes.note) alerts.push(['info', `Đã tự nhận diện bản vẽ: ${escapeHtml(result.axes.note)}.`]);
  if (current.format === 'geojson') alerts.push(['info', current.wgs84 ? 'Tọa độ GeoJSON: WGS84 (kinh độ, vĩ độ).' : 'Tọa độ GeoJSON: mét — tính theo hệ VN-2000 đang chọn ở ô Hệ tọa độ.']);
  if (current.filePhase === 'QH') {
    alerts.push(['info', `File <b>${escapeHtml(fileName)}</b>: tiền tố QH — mọi layer, kể cả layer HT, ghi vào QuyMo_QH.`]);
  } else if (current.filePhase === 'HT') {
    alerts.push(['info', `File <b>${escapeHtml(fileName)}</b>: tiền tố HT — toàn bộ lô ghi vào hiện trạng (QuyMo_HT).`]);
  }
  if (current.tt16) {
    const legacy = parcels.filter(p => !p.tt16).length;
    const phaseNote = current.filePhase
      ? 'Giai đoạn lấy theo tên file.'
      : `<b>${count.tt16HT}</b> lô HT_ → QuyMo_HT, <b>${count.tt16QH}</b> lô QHDD_ / QHDH_ → QuyMo_QH.${legacy ? ` ${legacy} lô đặt theo mã webapp ghi vào giai đoạn ${phase === 'QH' ? 'Quy hoạch' : 'Hiện trạng'} (ô Giai đoạn).` : ''}`;
    alerts.push(['info', `Tên layer theo TT 16/2025/TT-BXD — duyệt thẳng, không hỏi xác nhận: ${phaseNote} Hậu tố _CT / _CV / _QG = cấp đô thị, _DVO = cấp đơn vị ở.`]);
    if (count.pending) alerts.push(['warn', `${count.pending} lô Truonghoc thiếu hậu tố _MN / _TH / _THCS (viền vàng nét đứt): chọn cấp trường hoặc từ chối từng lô ở khung duyệt bên dưới trước khi ghi.`]);
    if (count.rejected) alerts.push(['info', `${count.rejected} lô trường học đã từ chối: không ghi.`]);
    if (count.merged) alerts.push(['info', `${count.merged} cặp lô HT_ và QH cùng vị trí, cùng loại: gộp thành 1 công trình, ghi cả QuyMo_HT và QuyMo_QH.`]);
    if (result.stageDupes) alerts.push(['info', `${result.stageDupes} lô QHDD_ trùng vị trí lô QHDH_ cùng loại: bỏ, dùng diện tích QHDH_.`]);
  }
  if (count.cross) alerts.push(['warn', `${count.cross} lô vắt ranh phường (lấn ≥ 5%): ghi quy mô = 0, diện tích thật ghi vào Ghi chú.`]);
  if (count.out) alerts.push(['bad', `${count.out} lô nằm ngoài TP. Huế (đưa lên đầu danh sách, viền xám trên bản đồ): bỏ qua${current.tt16 ? '' : ' — sẽ hỏi xác nhận trước khi ghi'}.`]);
  if (count.update) alerts.push(['info', `${count.update} lô chứa công trình cùng loại đã có: giữ tên trên Sheet, ghi đè tọa độ bằng tâm hatch và diện tích ${current.filePhase === 'QH' ? 'vào QuyMo_QH' : current.filePhase === 'HT' ? 'vào QuyMo_HT' : current.tt16 ? 'theo giai đoạn của layer' : phase}.`]);
  if (count.multi) alerts.push(['warn', `${count.multi} lô chứa nhiều công trình cùng loại (đưa lên đầu danh sách): chọn công trình cần cập nhật — mặc định gợi ý công trình gần tâm lô nhất, các công trình còn lại giữ nguyên.`]);
  if (count.dup) alerts.push(['bad', `${count.dup} lô cùng cập nhật 1 công trình: chọn lại (tạo mới / bỏ qua) trước khi ghi.`]);
  if (count.skip) alerts.push(['info', `${count.skip} lô được chọn bỏ qua.`]);
  if (count.small) alerts.push(['info', `${count.small} lô nhỏ hơn diện tích tối thiểu của loại (vẫn nhập).`]);
  if (count.newPoint) alerts.push(['info', `${count.newPoint} điểm (không có ranh) tạo mới với quy mô = 0 (có công trình, chưa rõ diện tích) — bổ sung diện tích trong Sheet sau.`]);
  if (count.exists) alerts.push(['warn', `${count.exists} điểm cách công trình cùng loại đã có dưới 20 m: coi là đã có, bỏ qua.`]);
  if (result.pointsInLots) alerts.push(['info', `${result.pointsInLots} điểm nằm trong lô cùng loại của file (điểm ghi chú của lô): bỏ qua.`]);
  const unknown = Object.entries(result.unknownLayers);
  const other = Object.entries(result.tt16Other || {});
  const sumOf = (list) => list.reduce((s, [, n]) => s + n, 0);
  const landSheet = `sheet DXF của đồ án «${escapeHtml(projectName(fileName))}»`;
  if (current.tt16) {
    if (unknown.length || other.length) {
      alerts.push(['info', `${fmtNum(sumOf(other))} đối tượng ở ${other.length} layer TT16 ngoài 13 nhóm hạ tầng và ${fmtNum(sumOf(unknown))} đối tượng ở ${unknown.length} layer không theo TT16: ranh lô ghi vào ${landSheet} (điểm bỏ qua).`]);
    }
  } else if (unknown.length) {
    const listed = unknown.slice(0, 8).map(([l, n]) => `${escapeHtml(l)} (${n})`).join(', ');
    alerts.push(['warn', `${UNKNOWN_LABEL[current.format]}: ${sumOf(unknown)} đối tượng — ${listed}${unknown.length > 8 ? ', …' : ''}. Ranh lô ghi vào ${landSheet}; gán loại ở khung <b>Khớp thủ công</b> bên dưới nếu là hạ tầng.`]);
  }
  const manualCount = parcels.filter(p => p.manual).length;
  if (manualCount) alerts.push(['info', `${manualCount} lô được gán loại thủ công (ghi chú trong Sheet kèm tên layer gốc).`]);
  if (stats.insert) alerts.push(['warn', `${stats.insert} block (INSERT) bị bỏ qua — nếu block chứa ranh lô, explode block trước khi xuất DXF.`]);
  if (stats.splineEdges) alerts.push(['info', `${stats.splineEdges} cạnh spline được tính gần đúng.`]);
  if (!state.wardLabelsList.some(w => w.geometry)) alerts.push(['bad', 'Chưa tải xong ranh 40 phường xã — mở lại file sau ít giây.']);

  const typeRows = Object.entries(byType).sort().map(([type, t]) => `
    <tr><td><i class="cad-dot" style="background:${type === SCHOOL_PENDING ? '#facc15' : type === LAND_KEY ? '#a3a3a3' : BUFFER_COLORS[type] || '#38bdf8'}"></i>${escapeHtml(type === SCHOOL_PENDING ? 'Trường học chưa rõ cấp' : type === LAND_KEY ? 'Đất ngoài nhóm hạ tầng (sheet DXF)' : infraLabels[type] || type)}</td>
    <td>${t.n}</td><td>${fmtArea(t.area)}</td></tr>`).join('');

  // Lô cần admin chọn (chờ chọn cấp / nhiều công trình / trùng) rồi lô ngoài TP lên đầu để không bị khuất sau giới hạn MAX_LISTED
  const rank = (p) => (p.ward && p.pending ? 3 : (p.ward && p.matchConflict) || parcelAction(p).key === 'dup' ? 2 : !p.ward ? 1 : 0);
  const order = parcels.map((_, idx) => idx).sort((a, b) => rank(parcels[b]) - rank(parcels[a]));
  const listRows = order.slice(0, MAX_LISTED).map(idx => {
    const p = parcels[idx];
    const a = parcelAction(p);
    const pair = p.partner ? `<br><small>+ ${escapeHtml(p.partner.layer)} · ${p.partner.crossWard ? `<s>${fmtArea(p.partner.area)}</s> 0` : sizeText(p.partner)}</small>` : '';
    return `<div class="cad-row${p.src === current.reviewSrc ? ' reviewing' : ''}" data-idx="${idx}" title="Xem trên bản đồ">
      <i class="cad-dot" style="background:${typeColor(p)}"></i>
      <span class="cad-row-main">${escapeHtml(layerText(p))} · ${p.crossWard ? `<s>${fmtArea(p.area)}</s> 0` : sizeText(p)}${pair}<br><small>${escapeHtml(p.ward || '—')}</small>
        ${p.ward && p.matchConflict ? pickHtml(p, idx) : ''}</span>
      <span class="cad-badge ${a.cls}">${escapeHtml(p.crossWard && a.key !== 'out' ? `${a.label} · vắt ranh` : a.label)}</span>
    </div>`;
  }).join('');
  const listScroll = box.querySelector('.cad-list')?.scrollTop || 0;
  const mapScroll = box.querySelector('.cad-map-list')?.scrollTop || 0;

  const kept = countText(kindCounts(current.entities, current.format)) || 'không có đối tượng hợp lệ';
  const skipped = countText(stats.skipped || {}, true);
  const dupText = result.duplicatesDropped ? ` · bỏ ${result.duplicatesDropped} ${isVector ? 'đường trùng polygon' : 'polyline trùng hatch'}` : '';

  box.innerHTML = `
    <div class="cad-file">${ico('file')}<b>${escapeHtml(fileName)}</b> · ${parcels.length} lô${dupText}
      <div class="cad-filter">Nhận: <b>${kept}</b>${skipped ? `<br>Bỏ qua (bộ lọc mặc định): ${skipped}` : ''}</div></div>
    ${reviewHtml()}
    ${alerts.map(([cls, text]) => `<div class="cad-alert ${cls}">${text}</div>`).join('')}
    ${manualMappingHtml(current.manual)}
    ${parcels.length ? `<table class="cad-table"><thead><tr><th>Loại</th><th>Số lô</th><th>Diện tích tính</th></tr></thead><tbody>${typeRows}</tbody></table>
    <div class="cad-list">${listRows}${parcels.length > MAX_LISTED ? `<div class="cad-more">… và ${parcels.length - MAX_LISTED} lô khác</div>` : ''}</div>` : ''}
    <div class="cad-foot"><span>Sẽ ghi: ${count.new} mới · ${count.update} cập nhật${count.land ? ` · ${count.land} lô đất (DXF)` : ''}${count.new + count.update ? ` <small>(${countText(kindCounts(writable(parcels), current.format))})</small>` : ''}</span><button type="button" id="btnCadClear" class="cad-clear">${ico('close')}Xóa xem trước</button></div>`;

  const list = box.querySelector('.cad-list');
  if (list) list.scrollTop = listScroll;
  const mapList = box.querySelector('.cad-map-list');
  if (mapList) mapList.scrollTop = mapScroll;
  $('cadMapField')?.addEventListener('change', (e) => {
    selectField(current.manual, e.target.value, current.entities);
    analyse({ fit: false });
  });
  box.querySelectorAll('.cad-map-type').forEach(sel => sel.addEventListener('change', () => {
    setCode(current.manual, Number(sel.dataset.k), sel.value);
    analyse({ fit: false });
  }));
  $('cadMapClear')?.addEventListener('click', () => {
    clearCodes(current.manual);
    analyse({ fit: false });
  });
  bindReview(box);
  box.querySelectorAll('.cad-row').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('.cad-pick')) return;
    const p = parcels[Number(row.dataset.idx)];
    if (p && p.school && p.ward) openReview(p.src);
    else zoomToParcel(p);
  }));
  box.querySelectorAll('.cad-pick').forEach(sel => sel.addEventListener('change', () => {
    const p = parcels[Number(sel.dataset.idx)];
    if (!p) return;
    p.choice = sel.value;
    renderReport();
  }));
  $('btnCadClear')?.addEventListener('click', () => { if (!submitting) resetImport(); });
  if (btn) {
    // Khách gửi file gốc vào hàng chờ: Admin tự duyệt cấp trường / khớp công trình khi mở hồ sơ
    btn.disabled = isAdmin()
      ? submitting || !(count.new + count.update + count.land) || count.dup > 0 || count.pending > 0 || !result.axes.valid
      : submitting || !result.axes.valid || !parcels.some(p => p.ward);
    btn.title = !isAdmin() ? 'Gửi file vào hàng chờ để Admin kiểm tra (file ≤ 2 MB)'
      : count.pending ? `Còn ${count.pending} lô trường học chờ chọn cấp` : '';
  }
}

// Nút ghi / khung thông tin người gửi theo vai trò (gọi khi đăng nhập / đăng xuất)
function syncRoleUi() {
  const admin = isAdmin();
  const btn = $('btnCadSubmit');
  if (btn) btn.innerHTML = admin ? `${ico('save')}GHI VÀO HỆ THỐNG (ADMIN)` : `${ico('send')}GỬI HỒ SƠ CHỜ DUYỆT`;
  const guest = $('cadGuest');
  if (guest) guest.hidden = admin;
  const box = $('cadPendingBox');
  if (box) box.hidden = !admin;
}

export function refreshCadRole() {
  syncRoleUi();
  renderReport();
  if (isAdmin()) loadPendingList();
  else { pendingItems = null; renderPendingList(); }
}

// ---- Hồ sơ chờ duyệt (Admin) ----

async function postAdminCad(action, body) {
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body || {})
  });
  if (res.status === 401 || res.status === 403) signOutAdmin();
  return res;
}

async function loadPendingList() {
  if (!isAdmin()) return;
  try {
    const res = await postAdminCad('getCadPending');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.items)) throw new Error(data.message || `HTTP ${res.status}`);
    pendingItems = data.items.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  } catch (err) {
    pendingItems = { error: err.message };
  }
  renderPendingList();
}

function renderPendingList() {
  const box = $('cadPendingBox');
  if (!box) return;
  box.hidden = !isAdmin();
  if (!isAdmin()) { box.innerHTML = ''; return; }
  const list = Array.isArray(pendingItems) ? pendingItems : [];
  const head = `<div class="cad-pending-head">${ico('clock')}<b>Hồ sơ chờ duyệt</b>${Array.isArray(pendingItems) ? ` (${list.length})` : ''}
    <button type="button" class="cad-pending-reload" title="Tải lại danh sách" aria-label="Tải lại danh sách hồ sơ chờ duyệt">${ico('flip')}</button></div>`;
  let body;
  if (pendingItems === null) body = `<div class="cad-pending-empty">Đang tải...</div>`;
  else if (!Array.isArray(pendingItems)) body = `<div class="cad-pending-empty c-red">Chưa tải được: ${escapeHtml(pendingItems.error)}</div>`;
  else if (!list.length) body = `<div class="cad-pending-empty">Không có hồ sơ nào.</div>`;
  else {
    body = list.map(it => {
      const s = it.summary || {};
      const at = it.at ? new Date(it.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const info = [
        s.parcels ? `${fmtNum(s.parcels)} lô trong TP` : '',
        s.create || s.update ? `${fmtNum(s.create || 0)} mới · ${fmtNum(s.update || 0)} cập nhật` : '',
        (s.wards || []).slice(0, 4).join(', ') + ((s.wards || []).length > 4 ? '…' : '')
      ].filter(Boolean).join(' · ');
      const opening = current && current.pendingId === it.id;
      return `<div class="cad-pending-row${opening ? ' on' : ''}">
        <div class="cad-row-main"><b>${escapeHtml(it.fileName || it.id)}</b> <small>${fmtMB(it.size || 0)} · ${it.phase === 'QH' ? 'QH' : 'HT'} · ${escapeHtml(at)}</small>
          ${it.kind === 'review' ? `<br><small class="c-orange">Hồ sơ thẩm định${s.kinds ? ` · ${escapeHtml(s.kinds)}` : ''}</small>` : ''}
          ${info ? `<br><small>${escapeHtml(info)}</small>` : ''}
          ${it.sender || it.note ? `<br><small class="c-cyan">${escapeHtml([it.sender, it.note].filter(Boolean).join(' — '))}</small>` : ''}</div>
        <button type="button" class="cad-pending-btn" data-open="${escapeHtml(it.id)}" title="${it.kind === 'review' ? 'Mở kết quả thẩm định để kiểm tra và phê duyệt' : 'Mở file để kiểm tra và ghi'}">${ico('folder')}Mở</button>
        <button type="button" class="road-del" data-del="${escapeHtml(it.id)}" title="Từ chối, xóa khỏi hàng chờ" aria-label="Xóa hồ sơ">${ico('trash')}</button>
      </div>`;
    }).join('');
  }
  box.innerHTML = `${head}<div class="cad-pending-list">${body}</div>`;
}

async function openPending(id) {
  const it = Array.isArray(pendingItems) && pendingItems.find(x => x.id === id);
  if (!it || submitting) return;
  setStatus('⏳ Đang tải file hồ sơ...', 'var(--accent-orange)');
  try {
    const res = await postAdminCad('getCadPendingFile', { id });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    const text = await res.text();
    // Hồ sơ thẩm định: mở bảng thẩm định để Admin xem kết quả, phê duyệt thì quay lại đây ghi (importReviewDossier)
    if (it.kind === 'review') {
      setStatus('');
      document.dispatchEvent(new CustomEvent(REVIEW_DOSSIER_EVENT, { detail: { id, item: it, text } }));
      return;
    }
    if ($('cadCrs') && it.crs && [...$('cadCrs').options].some(o => o.value === it.crs)) $('cadCrs').value = it.crs;
    if ($('cadPhase')) $('cadPhase').value = it.phase === 'QH' ? 'QH' : 'HT';
    const base = String(it.fileName || 'hoso').replace(/\.(dxf|kml|kmz|geojson|json)$/i, '');
    await loadFile(new File([text], `${base}.${it.ext}`), id);
  } catch (err) {
    setStatus(`❌ Không mở được hồ sơ: ${err.message}`, 'var(--accent-red)');
  }
}

export const REVIEW_DOSSIER_EVENT = 'review-dossier-open';

/**
 * Admin phê duyệt hồ sơ thẩm định: nạp GeoJSON (layer đã chuẩn hóa TT16) vào khung Nhập hàng loạt để khớp công trình đã có,
 * gộp HT + QH cùng vị trí rồi bấm Ghi; ghi xong hồ sơ tự xóa khỏi hàng chờ. fileName "<Ten_QH>.geojson"
 */
export async function importReviewDossier(text, fileName, pendingId) {
  if (!isAdmin()) return;
  document.querySelector('.tab-btn[data-tab="tabAdd"]')?.click();
  document.querySelector('.add-mode-btn[data-mode="addBulk"]')?.click();
  await loadFile(new File([text], fileName), pendingId);
}

export function reloadPendingList() {
  if (isAdmin()) loadPendingList();
}

/** Admin từ chối hồ sơ (hỏi xác nhận) → true nếu đã xóa khỏi hàng chờ */
export function rejectPending(id) {
  return removePending(id, true);
}

async function removePending(id, ask = true) {
  const it = Array.isArray(pendingItems) && pendingItems.find(x => x.id === id);
  if (ask && !confirm(`Từ chối và xóa hồ sơ "${it ? it.fileName : id}" khỏi hàng chờ?`)) return false;
  try {
    const res = await postAdminCad('removeCadPending', { id });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
    if (current && current.pendingId === id) current.pendingId = null;
    return true;
  } catch (err) {
    setStatus(`❌ Chưa xóa được hồ sơ khỏi hàng chờ: ${err.message}`, 'var(--accent-red)');
    return false;
  } finally {
    loadPendingList();
  }
}

// ---- Khách gửi hồ sơ ----

async function submitPending() {
  const raw = current.raw;
  if (!raw) return;
  const bytes = new TextEncoder().encode(raw.text).length;
  if (bytes > GUEST_MAX_BYTES) {
    setStatus(`⚠️ Nội dung file ${fmtMB(bytes)} vượt giới hạn 2 MB cho người dùng chưa đăng nhập — tách nhỏ file rồi gửi lại.`, 'var(--accent-red)');
    return;
  }
  const parcels = current.result.parcels;
  const inCity = parcels.filter(p => p.ward);
  const keys = parcels.map(p => parcelAction(p).key);
  const wards = [...new Set(inCity.map(p => p.ward))];
  const sender = String($('cadSender')?.value || '').trim();
  const note = String($('cadNote')?.value || '').trim();
  if (!confirm(`Gửi file "${current.fileName}" (${fmtMB(bytes)}) vào hàng chờ duyệt?\n• ${inCity.length} lô trong TP. Huế (${wards.length} phường/xã)\n• Admin kiểm tra rồi mới đưa lên bản đồ; hồ sơ lưu tạm tối đa 30 ngày.`)) return;
  submitting = true;
  renderReport();
  setStatus('⏳ Đang gửi hồ sơ...', 'var(--accent-orange)');
  try {
    const res = await fetch(geeApi('action=submitCadPending'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: current.fileName, ext: raw.ext, content: raw.text, phase: globalPhase(), crs: $('cadCrs')?.value || '',
        sender, note,
        summary: {
          parcels: inCity.length,
          create: keys.filter(k => k === 'new').length,
          update: keys.filter(k => k === 'update').length,
          wards: wards.slice(0, 12),
          kinds: countText(kindCounts(inCity, current.format))
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    const name = current.fileName;
    submitting = false;
    resetImport(true);
    if ($('cadNote')) $('cadNote').value = '';
    setStatus(`✓ Đã gửi hồ sơ "${name}" — Admin sẽ kiểm tra trước khi đưa lên bản đồ.`, 'var(--accent-green)');
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    submitting = false;
    renderReport();
  }
}

// Khóa nhận diện lô qua các lần phân tích lại (đổi khớp thủ công / hệ tọa độ) để giữ lựa chọn công trình của admin
const parcelKey = (p) => `${p.layer}|${p.lat}|${p.lng}|${p.area}`;

// Áp cấp trường đã chọn → khớp công trình đã có → nối giai đoạn HT / QH; giữ lựa chọn công trình của lô nhiều công trình
function refreshParcels() {
  const base = current.base;
  applyLevels(base.parcels);
  applyFilePhase(base.parcels);
  const existing = [...state.rawDataList, ...state.planDataList];
  matchExisting(base.parcels, existing);
  current.items = new Map(existing.filter(it => it.id).map(it => [it.id, it]));
  const prevChoices = new Map((current.result?.parcels || []).filter(p => p.choice).map(p => [parcelKey(p), p.choice]));
  base.parcels.forEach(p => {
    if (!p.matchConflict) { p.choice = null; return; }
    const prev = prevChoices.get(parcelKey(p));
    p.choice = prev && (prev === CHOICE_NEW || prev === CHOICE_SKIP || p.matchConflict.includes(prev)) ? prev : nearestChoice(p);
  });
  const linked = linkStages(base.parcels);
  markUnchanged(linked.parcels);
  current.result = { ...base, parcels: linked.parcels, stageDupes: linked.stageDupes };
}

function analyse({ fit = true } = {}) {
  if (!current) return;
  const crs = CRS_PRESETS[$('cadCrs')?.value] || CRS_PRESETS.HUE_3;
  const entities = applyManualMapping(current.entities, current.manual);
  const base = current.wgs84 ? buildParcelsLonLat(entities) : buildParcels(entities, { crs });
  assignWards(base.parcels, state.wardLabelsList || []);
  current.base = base;
  refreshParcels();
  // Lần phân tích đầu: mở ngay lô trường học đầu tiên cần chọn cấp
  const first = current.reviewStarted ? null : schoolLots().find(p => !current.levels.has(p.src));
  current.reviewStarted = true;
  if (first) current.reviewSrc = first.src;
  renderReport();
  drawPreview(current.result.parcels, fit, first);
  if (current.reviewSrc != null) markReview(schoolLots().find(p => p.src === current.reviewSrc));
}

// pendingId: Admin mở hồ sơ chờ duyệt (ghi xong thì tự xóa khỏi hàng chờ)
async function loadFile(file, pendingId = null) {
  if (!file || submitting) return;
  const ext = (file.name.match(/\.(dxf|kml|kmz|geojson|json)$/i) || [])[1]?.toLowerCase();
  if (!ext) { setStatus('⚠️ Chỉ nhận file .dxf (AutoCAD: Save As → DXF), .kml, .kmz, .geojson hoặc .json.', 'var(--accent-red)'); return; }
  if (!isAdmin() && file.size > GUEST_MAX_BYTES) {
    setStatus(`⚠️ Chưa đăng nhập: chỉ nhận file ≤ 2 MB (file này ${fmtMB(file.size)}) — tách nhỏ file theo phường / nhóm layer rồi gửi từng phần.`, 'var(--accent-red)');
    return;
  }
  setStatus('⏳ Đang đọc file...', 'var(--accent-orange)');
  await new Promise(r => setTimeout(r, 30));
  try {
    let parsed, text;
    if (ext === 'dxf') {
      const head = await file.slice(0, 22).text();
      if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF dạng nhị phân chưa hỗ trợ — lưu lại dạng ASCII DXF.');
      text = await file.text();
      parsed = parseDxf(text);
    } else if (ext === 'json' || ext === 'geojson') {
      text = await file.text();
      parsed = parseGeoJson(text);
    } else {
      text = ext === 'kmz' ? await unzipKml(await file.arrayBuffer()) : await file.text();
      parsed = parseKml(text);
    }
    if (!parsed.entities.length) {
      const skipped = countText(parsed.stats.skipped || {}, true);
      throw new Error(`Không có ${ext === 'dxf' ? 'HATCH hoặc polyline khép kín' : 'Polygon, đường khép kín hoặc Point'} nào để nhập${skipped ? ` (bỏ qua ${skipped})` : ''}.`);
    }
    const format = ext === 'dxf' ? 'dxf' : ext === 'kml' || ext === 'kmz' ? 'kml' : 'geojson';
    const wgs84 = format === 'kml' || (format === 'geojson' && parsed.wgs84);
    const filePhase = format === 'dxf' ? filePhaseFromName(file.name) : null;
    // File đặt tên layer theo TT16: chỉ nhận layer đúng tên, không khớp thủ công các layer khác
    const tt16 = parsed.entities.some(e => tt16Layer(e.layer));
    current = {
      fileName: file.name, format, wgs84, tt16, filePhase, entities: parsed.entities, stats: parsed.stats, base: null, result: null,
      manual: tt16 ? null : createManualMapping(parsed.entities), levels: new Map(), reviewSrc: null, reviewStarted: false,
      raw: { ext: format, text }, pendingId
    };
    lockCrs(wgs84);
    syncPhaseSelect();
    analyse();
    setStatus(pendingId ? 'Đang mở hồ sơ chờ duyệt — kiểm tra rồi bấm Ghi; ghi xong hồ sơ tự xóa khỏi hàng chờ.' : '');
    renderPendingList();
  } catch (err) {
    current = null;
    lockCrs(false);
    renderReport();
    clearPreview();
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  }
}

// File tọa độ WGS84 (KML/KMZ, GeoJSON dạng độ) → khóa ô chọn hệ tọa độ VN-2000
function lockCrs(on) {
  const sel = $('cadCrs');
  if (!sel) return;
  sel.disabled = on;
  sel.title = on ? 'File dùng tọa độ WGS84 (kinh độ, vĩ độ)' : '';
}

function resetImport(keepStatus = false) {
  current = null;
  syncPhaseSelect();
  lockCrs(false);
  clearPreview();
  renderReport();
  if (!keepStatus) setStatus('');
  const input = $('cadFile');
  if (input) input.value = '';
  renderPendingList();
}

// Tên Placemark (KML) bỏ mã loại ở đầu, VD "MN - Trường Hoa Sen" → "Trường Hoa Sen"; chỉ còn mã / số hiệu → ''
function ownName(p) {
  let s = String(p.name || '').trim();
  const t = s && layerToType(s);
  if (t) s = s.replace(new RegExp(`^${t.prefix.replace(/_/g, '[\\s_-]+')}(?![A-Za-z])[\\s_\\-–:.]*`, 'i'), '');
  return /\p{L}{2,}/u.test(s) && !/^(HT|QH|DT|DV)$/i.test(s) ? s : '';
}

// Lô sẽ ghi (tạo mới / cập nhật) → dữ liệu gửi máy chủ; tên theo Placemark, không có thì "<layer> – <tên file> #<thứ tự>" để admin sửa sau
function buildItems() {
  const fileBase = current.fileName.replace(/\.(dxf|kml|kmz|geojson|json)$/i, '');
  const items = [];
  refreshDupTargets(current.result.parcels);
  // Máy chủ giữ tối đa 60 ký tự: rút gọn tên gốc để còn mã loại đã gán ở cuối
  const layerOut = (p) => (p.manual || (p.school && p.prefix) ? `${p.layer.slice(0, 45)} → ${p.prefix}` : p.layer);
  const geometryOf = (p) => (isPoint(p) ? null
    : p.polygons.length === 1
      ? { type: 'Polygon', coordinates: p.polygons[0] }
      : { type: 'MultiPolygon', coordinates: p.polygons });
  current.result.parcels.forEach((p, idx) => {
    const action = parcelAction(p);
    if (action.key !== 'new' && action.key !== 'update') return;
    items.push({
      type: p.type,
      idPrefix: p.prefix.replace(/_DV$/, ''),
      nhom: p.nhom,
      name: ownName(p) || `${p.tt16 ? p.prefix : p.layer} – ${fileBase} #${idx + 1}`,
      ward: p.ward,
      lat: p.lat,
      lng: p.lng,
      area: p.area,
      point: isPoint(p),
      kind: p.kind,
      crossWard: !!p.crossWard,
      layer: layerOut(p),
      matchId: action.key === 'update' ? action.id : null,
      keep: !!p.keep,
      // Quy mô + ranh theo từng giai đoạn: 1 lô, cặp HT + QH cùng vị trí, hoặc layer HT trong file QH (hai cột bằng nhau)
      stages: p.keep
        ? ['HT', 'QH'].map(phase => ({
          phase, area: p.area, point: isPoint(p), crossWard: !!p.crossWard, layer: layerOut(p), geometry: geometryOf(p)
        }))
        : [p, p.partner].filter(Boolean).map(s => ({
          phase: phaseOf(s), area: s.area, point: isPoint(s), crossWard: !!s.crossWard, layer: layerOut(s), geometry: geometryOf(s)
        }))
    });
  });
  return items;
}

// Tên đồ án = tên file bỏ tiền tố HT- / QH- và phần mở rộng (khớp projectTitle trong Apps Script)
function projectName(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '').replace(/^(HT|QH)[-_\s]+/i, '').trim() || 'DXF';
}

function buildLands() {
  const fileBase = projectName(current.fileName);
  const lands = [];
  current.result.parcels.forEach((p, idx) => {
    if (parcelAction(p).key !== 'land' || isPoint(p)) return;
    lands.push({
      name: ownName(p) || `${p.layer} – ${fileBase} #${idx + 1}`,
      ward: p.ward,
      nhom: landLabel(p.layer),
      layer: p.layer,
      lat: p.lat,
      lng: p.lng,
      area: p.area,
      phase: phaseOf(p),
      crossWard: !!p.crossWard,
      geometry: p.polygons.length === 1
        ? { type: 'Polygon', coordinates: p.polygons[0] }
        : { type: 'MultiPolygon', coordinates: p.polygons }
    });
  });
  return lands;
}

// Câu báo kết quả kiểu "50 hatch, 30 polygon và 10 điểm (bỏ qua 5 line, 7 pline hở và 15 mtext)"
function importSummary(items) {
  const { stats, result, format } = current;
  const skipped = { ...(stats.skipped || {}) };
  const add = (label, n) => { if (n) skipped[label] = (skipped[label] || 0) + n; };
  add(format === 'dxf' ? 'polyline trùng hatch' : 'đường trùng polygon', result.duplicatesDropped);
  add('điểm trong lô cùng loại', result.pointsInLots);
  add('lô QHDD trùng QHDH', result.stageDupes);
  const counts = { out: 0, exists: 0, skip: 0, rejected: 0 };
  result.parcels.forEach(p => { const k = parcelAction(p).key; if (k in counts) counts[k]++; });
  add('ngoài TP. Huế', counts.out);
  add('điểm đã có', counts.exists);
  add('lô chọn bỏ qua', counts.skip);
  add('lô trường học từ chối', counts.rejected);
  const skippedText = countText(skipped, true);
  return `${countText(kindCounts(items, format))}${skippedText ? ` (bỏ qua ${skippedText})` : ''}`;
}

function chunkItems(items) {
  const chunks = [];
  let cur = [], chars = 0;
  for (const it of items) {
    const len = JSON.stringify(it).length;
    if (cur.length && (cur.length >= CHUNK_MAX_ITEMS || chars + len > CHUNK_MAX_CHARS)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function submitImport() {
  if (!current?.result || submitting) return;
  if (!isAdmin()) return submitPending();
  // Lần ghi trước lỗi giữa chừng: ghi tiếp từ phần lỗi, không gửi lại các phần đã ghi (tránh tạo trùng lô)
  if (current.pending) return writeChunks(current.pending);
  const phase = globalPhase();
  const items = buildItems();
  const lands = buildLands();
  if (!items.length && !lands.length) return;
  const summary = importSummary(items);
  // File đặt tên layer theo TT16: ghi thẳng, không hỏi xác nhận (lô ngoài TP tự bỏ qua)
  if (!current.tt16) {
    const outside = current.result.parcels.filter(p => !p.ward);
    if (outside.length) {
      const byLayer = {};
      outside.forEach(p => { byLayer[p.layer] = (byLayer[p.layer] || 0) + 1; });
      const detail = Object.entries(byLayer).map(([l, n]) => `${l}: ${n}`).join(', ');
      if (!confirm(`⚠️ Có ${outside.length} lô nằm ngoài TP. Huế (${detail}) sẽ bị BỎ QUA, không ghi vào Sheet.\n\nNếu đây là lỗi vẽ / sai vị trí, bấm Hủy để sửa file rồi nhập lại.\nBấm OK để tiếp tục ghi ${items.length} lô hợp lệ.`)) return;
    }
    const nUpdate = items.filter(it => it.matchId).length;
    const phaseLabel = current.filePhase === 'QH' ? 'Quy hoạch (QuyMo_QH) theo tên file'
      : current.filePhase === 'HT' ? 'Hiện trạng (QuyMo_HT) theo tên file'
        : phase === 'QH' ? 'Quy hoạch (QuyMo_QH)' : 'Hiện trạng (QuyMo_HT)';
    const landNote = lands.length ? `\n• ${lands.length} lô đất ngoài nhóm hạ tầng → sheet DXF của đồ án` : '';
    if (!confirm(`Ghi vào Google Sheet?\n• ${summary}\n• ${items.length - nUpdate} công trình mới, ${nUpdate} cập nhật (giữ tên, ghi đè tọa độ bằng tâm hatch)${landNote}\n• Giai đoạn: ${phaseLabel}\n• TrangThai = TRUE (đã duyệt)`)) return;
  }

  // Lô đất gửi thành các phần riêng sau lô hạ tầng; phần đất đầu tiên xóa dữ liệu cũ của sheet DXF đồ án
  const chunks = [
    ...chunkItems(items).map(c => ({ items: c, lands: [] })),
    ...chunkItems(lands).map((c, i) => ({ items: [], lands: c, landsReset: i === 0 }))
  ];
  return writeChunks({
    phase, summary, fileName: current.fileName, total: items.length + lands.length, chunks, next: 0,
    done: { created: [], updated: [], skipped: [], polygonsDropped: 0, lands: 0, landsDropped: 0 }, pendingId: current.pendingId || null
  });
}

// job: { phase, summary, fileName, total, chunks: [{ items, lands, landsReset }], next, done, pendingId }; lỗi ở phần nào thì giữ job trong current.pending để ghi tiếp
async function writeChunks(job) {
  const { chunks, done } = job;
  submitting = true;
  renderReport();
  try {
    for (; job.next < chunks.length; job.next++) {
      const k = job.next;
      setStatus(`⏳ Đang ghi ${chunks.length > 1 ? `phần ${k + 1}/${chunks.length}` : `${job.total} lô`}...`, 'var(--accent-orange)');
      markDataWritten();
      const res = await fetch(geeApi('action=importCadBatch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
        body: JSON.stringify({
          phase: job.phase, fileName: job.fileName, sync: k === chunks.length - 1,
          items: chunks[k].items, lands: chunks[k].lands, landsReset: !!chunks[k].landsReset
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) signOutAdmin();
      if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
      ['created', 'updated', 'skipped'].forEach(key => done[key].push(...(data[key] || [])));
      done.polygonsDropped += data.polygonsDropped || 0;
      done.lands += data.lands || 0;
      done.landsDropped += data.landsDropped || 0;
    }
    const extra = [
      done.lands ? `${done.lands} lô đất vào sheet DXF` : '',
      done.landsDropped ? `${done.landsDropped} lô đất không hợp lệ bị bỏ` : '',
      done.skipped.length ? `máy chủ bỏ qua ${done.skipped.length}: ${done.skipped.slice(0, 3).join('; ')}` : '',
      done.polygonsDropped ? `${done.polygonsDropped} lô ranh quá phức tạp chỉ ghi điểm tâm` : ''
    ].filter(Boolean).join(' · ');
    submitting = false;
    resetImport(true);
    setStatus(`✓ Đã thêm ${job.summary} — ${done.created.length} mới, ${done.updated.length} cập nhật${extra ? ` · ${extra}` : ''}.`, 'var(--accent-green)');
    if (job.pendingId) removePending(job.pendingId, false);
    if (onImported) await onImported();
  } catch (err) {
    const written = done.created.length + done.updated.length;
    if (current) current.pending = job;
    setStatus(`❌ ${err.message}${written ? ` — đã ghi ${written} lô vào Sheet` : ''}. Bấm Ghi lần nữa để ghi tiếp từ phần ${job.next + 1}/${chunks.length}.`, 'var(--accent-red)');
  } finally {
    submitting = false;
    renderReport();
  }
}

/** opts.onImported: gọi sau khi ghi xong để tải lại dữ liệu bản đồ */
export function initCadImport(opts = {}) {
  onImported = opts.onImported || null;
  document.querySelectorAll('.add-mode-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.add-mode-btn').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      const panel = $(b.dataset.mode);
      if (panel) panel.style.display = on ? '' : 'none';
    });
    if (btn.dataset.mode !== 'addSingle') state.isPickMode = false;
    if (btn.dataset.mode === 'addBulk' && isAdmin()) loadPendingList();
  }));
  $('cadPendingBox')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openPending(open.dataset.open); return; }
    const del = e.target.closest('[data-del]');
    if (del) { removePending(del.dataset.del); return; }
    if (e.target.closest('.cad-pending-reload')) { pendingItems = null; renderPendingList(); loadPendingList(); }
  });
  syncRoleUi();

  $('cadFile')?.addEventListener('change', (e) => loadFile(e.target.files && e.target.files[0]));
  const drop = $('cadDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files && e.dataTransfer.files[0]));
  }
  $('cadCrs')?.addEventListener('change', analyse);
  $('cadPhase')?.addEventListener('change', renderReport);
  $('btnCadSubmit')?.addEventListener('click', submitImport);
}
