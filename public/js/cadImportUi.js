// Tab Đề xuất → "Nhập hàng loạt": đọc file DXF/KML/KMZ/GeoJSON/shapefile (.zip), xem trước các lô trên bản đồ và báo cáo kiểm tra trước khi ghi.
// Đồ án gServer: nạp cùng lúc lớp Chức năng sử dụng đất (vùng) và lớp Điểm chức năng (điểm) — tên điểm gộp vào lô chứa nó.
import { state, infraLabels, BUFFER_COLORS } from './state.js';
import { landColor, landLabel } from './tt16Symbols.js';
import { map } from './mapEngine.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, distanceMeters, ico, setStatusContent, planRows } from './utils.js';
import {
  parseDxf, buildParcels, buildParcelsLonLat, assignWards, matchExisting, layerToType, tt16Layer, linkStages, sameSite,
  filePhaseFromName, LAYER_PREFIXES, SCHOOL_PENDING, CRS_PRESETS, detectAxes, vn2000ToWgs84,
  attachPoints, planAttrsOf, lotCodeOf, isMarketName, schoolLevelOf
} from './cadImport.js';
import { parseKml, unzipKml } from './kmlImport.js';
import { parseGeoJson } from './geojsonImport.js';
import { parseShapefileZip } from './shpImport.js';
import { createManualMapping, selectField, setCode, clearCodes, applyManualMapping, manualMappingHtml } from './cadTypeMapping.js';
import { projectBoundary } from './projectLayer.js';

// Diện tích tối thiểu theo loại (khớp config/constants.js → infraConfig.minSize)
const MIN_SIZE = { "1-CV": 300, "2-BDX": 200, "3-MN": 800, "4-TH": 2000, "5-THCS": 2500, "7-YT": 1000, "8-VH": 500, "9-TM": 1500 };
const MAX_LISTED = 200;
const LAND_KEY = 'zz-land';
// Mỗi lần gửi: tối đa 300 lô (giới hạn máy chủ) và ~2,5 MB (Vercel nhận tối đa 4,5 MB/yêu cầu)
const CHUNK_MAX_ITEMS = 250;
const CHUNK_MAX_CHARS = 2500000;
// Người dùng chưa đăng nhập: chỉ gửi file ≤ 2 MB vào hàng chờ duyệt trên bucket (máy chủ kiểm tra lại), không ghi Sheet
const GUEST_MAX_BYTES = 2 * 1024 * 1024;
const FILE_EXT_RE = /\.(dxf|kml|kmz|geojson|json|zip)$/i;

// Lựa chọn cho lô chứa nhiều công trình cùng loại (ngoài ID công trình cần cập nhật)
const CHOICE_NEW = '__new';
const CHOICE_SKIP = '__skip';

// current: { fileName, format: 'dxf'|'kml'|'geojson'|'shp', wgs84, stats, tt16 (file đặt tên layer theo TT16), base (lô trước khi khớp),
//   result, manual (khớp thủ công), items: Map ID → công trình đang có, levels: Map src → MN/TH/THCS/reject (Admin chọn),
//   autoLevels: Map src → cấp trường nhận theo tên điểm / ký hiệu lô, reviewSrc,
//   takeOver: Set parcelKey lô được chuyển công trình từ đồ án khác sang đồ án đang nhập,
//   points: { fileName, entities, wgs84, crs } lớp điểm chức năng, pointStats, notMarket (số lô dịch vụ chuyển sang sheet DXF),
//   raw: { ext, text } nội dung file (KMZ đã giải nén, shapefile đã chuyển GeoJSON) để gửi hàng chờ, pendingId: hồ sơ chờ duyệt Admin đang mở }
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

// Đồ án khác đang quản lý công trình id ('' = chưa gắn đồ án hoặc chính đồ án đang nhập)
function ownerOf(id) {
  const owner = String(current.items.get(id)?.tenQH || '').trim();
  return owner && owner !== projectName(current.fileName) ? owner : '';
}
const takesOver = (p) => !!current.takeOver?.has(parcelKey(p));

// Trạng thái xử lý của 1 lô khi ghi: bỏ qua / cập nhật / tạo mới; vắt ranh thì quy mô = 0.
// Công trình thuộc đồ án khác: mặc định không ghi đè (overlap), admin tích chuyển sang đồ án đang nhập.
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
  const owner = id ? ownerOf(id) : '';
  if (owner && !takesOver(p)) return { key: 'overlap', label: `${id} thuộc đồ án ${owner}`, cls: 'warn', id, owner };
  if (id) return { key: 'update', label: `Cập nhật ${id}${owner ? ` · chuyển từ ${owner}` : ''}${both}`, cls: 'info', id, owner };
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
const layerText = (p) => (p.manual || (p.school && p.prefix) ? `${p.layer} → ${p.prefix || 'chọn cấp'}` : p.layer);
// "Thuận Hóa 1.200 m² · Phú Xuân 300 m²" (lô vắt ranh đã tách theo phường)
const partsText = (p) => p.wardParts.map(x => `${x.ward} ${fmtArea(x.area)}`).join(' · ');
const typeColor = (p) => (p.pending ? '#facc15' : p.land ? (landColor(p.layer) || '#94a3b8') : BUFFER_COLORS[p.type] || '#38bdf8');

function parcelTip(p) {
  const pair = p.partner ? `<br>+ ${escapeHtml(p.partner.layer)} · ${sizeText(p.partner)}` : '';
  const name = displayName(p);
  const plan = planRows(planOf(p)).map(([k, v]) => `${k} ${escapeHtml(v)}`).join(' · ');
  return `${name ? `<b>${escapeHtml(name)}</b><br>` : ''}<b>${escapeHtml(layerText(p))}</b>${p.lotCode ? ` ${escapeHtml(p.lotCode)}` : ''} · ${sizeText(p)}${pair}`
    + `${plan ? `<br>${plan}` : ''}<br>${p.wardParts ? `Tách theo ranh phường: ${escapeHtml(partsText(p))}` : escapeHtml(p.ward || 'Ngoài TP. Huế')}${p.crossWard ? ' · <span style="color:#f87171">vắt ranh</span>' : ''}<br>${escapeHtml(parcelAction(p).label)}`;
}

// ---- Lớp điểm chức năng & chỉ tiêu quy hoạch gộp vào lô ----

// Nhãn chung của lớp điểm gServer (không phải tên riêng), VD "Trung tâm dịch vụ, thương mại", "Điểm tôn giáo"
const GENERIC_POINT_RE = /^(trung tam|diem|tram)( (dich vu|thuong mai|van hoa|y te|ton giao|tin nguong|di tich|giao duc|dao tao|hanh chinh|chinh tri|the duc|the thao|truong hoc))+$/;
const POINT_KIND_FIELD = /^loai_?doi_?tu/i;
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isGenericPoint = (pt) => !pt.name || plain(pt.name) === plain(pt.kind) || GENERIC_POINT_RE.test(plain(pt.name));
const lotPoints = (p) => [...(p.points || []), ...(p.partner?.points || [])];

// Tên riêng các điểm chức năng trong lô (tối đa 3, cách nhau "; ")
function pointLabel(p) {
  const names = [...new Set(lotPoints(p).filter(pt => !isGenericPoint(pt)).map(pt => pt.name))];
  return names.slice(0, 3).join('; ');
}

const displayName = (p) => ownName(p) || pointLabel(p);

// Chỉ tiêu quy hoạch: ưu tiên lô giai đoạn QH của cặp HT + QH
function planOf(p) {
  const list = [p, p.partner].filter(Boolean);
  const qh = list.find(s => phaseOf(s) === 'QH' && s.plan);
  return (qh || list.find(s => s.plan) || {}).plan || null;
}

// Điểm của lớp điểm chức năng → WGS84; VN-2000 theo .prj của lớp điểm, không có thì theo ô Hệ tọa độ
function pointsWgs84() {
  const src = current.points;
  if (!src || !src.entities.length) return [];
  let toLatLng = ([x, y]) => [y, x];
  if (!src.wgs84) {
    const axes = detectAxes(src.entities);
    const crs = CRS_PRESETS[src.crs] || CRS_PRESETS[$('cadCrs')?.value] || CRS_PRESETS.HUE_3;
    toLatLng = ([x, y]) => vn2000ToWgs84(...axes.f(x, y), crs);
  }
  return src.entities.map(e => {
    const [lat, lng] = toLatLng(e.pt);
    const kindKey = Object.keys(e.attrs || {}).find(k => POINT_KIND_FIELD.test(k));
    return { lat, lng, name: String(e.name || '').trim(), kind: kindKey ? e.attrs[kindKey] : '' };
  }).filter(pt => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
}

/**
 * Gộp thuộc tính vào lô: điểm chức năng, chỉ tiêu quy hoạch, ký hiệu lô; cấp trường tự nhận;
 * lô dịch vụ / khớp thủ công vào nhóm TM chỉ giữ khi tên lô, giá trị nhận diện hoặc tên điểm là chợ / siêu thị / TTTM, còn lại → sheet DXF.
 */
function enrichParcels(parcels) {
  const pts = pointsWgs84();
  const outside = attachPoints(parcels, pts);
  parcels.forEach(p => {
    p.plan = planAttrsOf(p.attrs);
    p.lotCode = lotCodeOf(p.attrs);
  });
  current.pointStats = pts.length ? { total: pts.length, outside, lots: parcels.filter(p => p.points.length).length } : null;
  let notMarket = 0;
  parcels.forEach(p => {
    if (p.land || p.type !== '9-TM' || !(p.marketCheck || p.manual)) return;
    if ([p.layer, p.name, ...p.points.map(pt => pt.name)].some(isMarketName)) return;
    Object.assign(p, { land: true, type: null, prefix: `LAND:${p.layer}`, nhom: '', manual: false, notMarket: true });
    notMarket++;
  });
  current.notMarket = notMarket;
  current.autoLevels = new Map();
  parcels.forEach(p => {
    if (!p.school) return;
    const lv = schoolLevelOf([p.name, ...p.points.map(pt => pt.name)], p.lotCode);
    if (lv) current.autoLevels.set(p.src, lv);
  });
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
    (p.wardParts || []).slice(1).forEach(part => previewLayer.addLayer(L.geoJSON({ type: 'MultiPolygon', coordinates: part.polygons },
      { style: { color: '#fff', weight: 1.5, dashArray: '3,3', fill: false }, interactive: false })));
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
// Admin chọn thắng cấp tự nhận theo tên điểm / ký hiệu lô
const levelOf = (src) => current.levels.get(src) || current.autoLevels?.get(src) || null;

function applyLevels(parcels) {
  parcels.forEach(p => {
    if (!p.school) return;
    const lv = levelOf(p.src);
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
    if (q !== p && !levelOf(q.src) && q.stage !== p.stage && sameSite(spot(q), spot(p))) current.levels.set(q.src, level);
  });
  refreshParcels();
  drawPreview(current.result.parcels, false);
  const next = [...lots.slice(at + 1), ...lots.slice(0, at)].find(q => !levelOf(q.src));
  if (next) openReview(next.src);
  else { current.reviewSrc = null; renderReport(); clearReviewMark(); }
}

function reviewHtml() {
  const lots = schoolLots();
  if (!lots.length) return '';
  const left = lots.filter(p => !levelOf(p.src)).length;
  const auto = lots.filter(p => !current.levels.has(p.src) && current.autoLevels?.has(p.src)).length;
  const autoNote = auto ? ` ${auto} lô tự nhận cấp theo tên điểm chức năng / ký hiệu lô.` : '';
  const at = lots.findIndex(p => p.src === current.reviewSrc);
  if (at < 0) {
    return `<div class="cad-review done">${ico(left ? 'alert' : 'check')}${left ? `Còn <b>${left}</b>/${lots.length} lô trường học chưa rõ cấp (layer Truonghoc thiếu hậu tố _MN / _TH / _THCS hoặc khớp thủ công «Trường học – chọn cấp từng lô»).`
      : `Đã rõ cấp ${lots.length} lô trường học cần chọn cấp.`}${autoNote}
      <button type="button" class="cad-rev-open" data-src="${(lots.find(p => !levelOf(p.src)) || lots[0]).src}">${left ? 'Duyệt tiếp' : 'Xem lại'}</button></div>`;
  }
  const p = lots[at];
  const lv = levelOf(p.src);
  const btn = (code, label, cls = '') => `<button type="button" class="cad-rev-btn${cls}${lv === code ? ' on' : ''}" data-lv="${code}">${label}</button>`;
  return `<div class="cad-review">
    <div class="cad-review-head">${ico('alert')}Lô trường học chưa rõ cấp <b>${at + 1}/${lots.length}</b> · còn ${left} lô chưa duyệt</div>
    <div class="cad-review-info">${displayName(p) ? `<b>${escapeHtml(displayName(p))}</b> · ` : ''}${escapeHtml(p.layer)}${p.lotCode ? ` ${escapeHtml(p.lotCode)}` : ''} · ${sizeText(p)} · ${escapeHtml(p.wardParts ? partsText(p) : p.ward)}${p.crossWard ? ' · vắt ranh' : ''}</div>
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
    out: 0, exists: 0, skip: 0, dup: 0, update: 0, new: 0, pending: 0, rejected: 0, merged: 0, overlap: 0,
    cross: 0, split: 0, takeOver: 0, small: 0, multi: 0, newPoint: 0, tt16HT: 0, tt16QH: 0, land: 0
  };
  const owners = new Set();
  parcels.forEach(p => {
    const a = parcelAction(p);
    count[a.key]++;
    if (a.owner) (a.key === 'overlap' ? owners.add(a.owner) : count.takeOver++);
    if (p.ward && p.matchConflict) count.multi++;
    if (p.ward && p.crossWard && !p.rejected && !p.land) count.cross++;
    if (p.wardParts && (a.key === 'new' || a.key === 'update')) count.split++;
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
    geojson: 'Không nhận diện được loại (thuộc tính Layer / tên)',
    shp: 'Không nhận diện được loại (trường Layer / tên file .shp)'
  };
  const alerts = [];
  if (!result.axes.valid) alerts.push(['bad', current.wgs84
    ? 'Tọa độ không nằm trong khu vực TP. Huế — kiểm tra lại hệ tọa độ khi xuất file (phải là WGS84 hoặc VN-2000).'
    : 'Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra lại hệ tọa độ / đơn vị bản vẽ.']);
  else if (result.axes.note) alerts.push(['info', `Đã tự nhận diện bản vẽ: ${escapeHtml(result.axes.note)}.`]);
  if (current.format === 'geojson') alerts.push(['info', current.wgs84 ? 'Tọa độ GeoJSON: WGS84 (kinh độ, vĩ độ).' : 'Tọa độ GeoJSON: mét — tính theo hệ VN-2000 đang chọn ở ô Hệ tọa độ.']);
  if (current.format === 'shp') {
    const src = current.crs ? 'theo file .prj' : 'đoán theo độ lớn tọa độ (không có .prj hoặc .prj không rõ)';
    alerts.push([current.crs ? 'info' : 'warn', `Shapefile ${fmtNum(current.layers.length)} lớp (${escapeHtml(current.layers.slice(0, 6).join(', '))}${current.layers.length > 6 ? ', …' : ''}). Tọa độ ${current.wgs84 ? 'WGS84 (kinh độ, vĩ độ)' : 'mét — hệ VN-2000 ở ô Hệ tọa độ'}, ${src}.`]);
    if (current.crsUnknown) alerts.push(['warn', 'File .prj dùng hệ tọa độ khác WGS84 / VN-2000 KTT 107° / UTM 48 hoặc các lớp khác hệ nhau — xuất lại về một hệ.']);
  }
  if (current.pointStats) {
    const s = current.pointStats;
    const named = parcels.filter(p => pointLabel(p)).length;
    alerts.push(['info', `Lớp điểm chức năng: ${fmtNum(s.total)} điểm nằm trong ${fmtNum(s.lots)} lô${s.outside ? `, ${fmtNum(s.outside)} điểm ngoài mọi lô (bỏ qua)` : ''} — ${fmtNum(named)} lô lấy tên công trình theo điểm.`]);
  } else if (current.points) {
    alerts.push(['warn', 'Lớp điểm chức năng không có điểm hợp lệ (kiểm tra hệ tọa độ).']);
  }
  if (current.notMarket) {
    alerts.push(['info', `${fmtNum(current.notMarket)} lô đất dịch vụ / thương mại không mang tên chợ, siêu thị hay TTTM: không vào nhóm Chợ, TTTM — ranh lô ghi vào sheet DXF của đồ án.${current.points ? '' : ' Nạp kèm lớp Điểm chức năng để nhận ra chợ / siêu thị / TTTM theo tên.'}`]);
  }
  const planned = parcels.filter(p => planOf(p)).length;
  if (planned) alerts.push(['info', `${fmtNum(planned)} lô có chỉ tiêu quy hoạch: ghi vào cột TangCao, MatDoXD, HeSoSDD của Sheet.`]);
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
    if (count.merged) alerts.push(['info', `${count.merged} cặp lô HT_ và QH cùng vị trí, cùng loại: gộp thành 1 công trình, ghi cả QuyMo_HT và QuyMo_QH.`]);
    if (result.stageDupes) alerts.push(['info', `${result.stageDupes} lô QHDD_ trùng vị trí lô QHDH_ cùng loại: bỏ, dùng diện tích QHDH_.`]);
  }
  if (count.pending) alerts.push(['warn', `${count.pending} lô trường học chưa rõ cấp (viền vàng nét đứt): chọn cấp trường hoặc từ chối từng lô ở khung duyệt bên dưới trước khi ghi.`]);
  if (count.rejected) alerts.push(['info', `${count.rejected} lô trường học đã từ chối: không ghi.`]);
  if (count.split) alerts.push(['warn', `${count.split} lô vắt ranh phường (phần lấn ≥ 5% và ≥ 50 m², nét đứt trắng là ranh cắt): dòng chính giữ nguyên lô (tên, diện tích, ranh, đồ án) tại phường chiếm phần lớn; mỗi phần ở phường khác ghi thêm 1 dòng <code>&lt;ID&gt;.2</code> chỉ để tính diện tích chỉ tiêu phường — không tính thêm số công trình.`]);
  if (count.cross) alerts.push(['warn', `${count.cross} lô vắt ranh phường không cắt được theo ranh: ghi quy mô = 0, diện tích thật ghi vào Ghi chú.`]);
  if (count.overlap) alerts.push(['warn', `${count.overlap} lô trùng công trình đang thuộc đồ án khác (${escapeHtml([...owners].slice(0, 3).join(', '))}${owners.size > 3 ? ', …' : ''}): mặc định không ghi đè. Tích «Chuyển sang đồ án này» ở từng lô nếu đồ án đang nhập thay thế đồ án cũ.`]);
  if (count.takeOver) alerts.push(['info', `${count.takeOver} lô chuyển công trình từ đồ án khác sang đồ án «${escapeHtml(projectName(fileName))}».`]);
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
  const rank = (p) => {
    const key = parcelAction(p).key;
    return p.ward && p.pending ? 3 : (p.ward && p.matchConflict) || key === 'dup' || key === 'overlap' ? 2 : !p.ward ? 1 : 0;
  };
  const order = parcels.map((_, idx) => idx).sort((a, b) => rank(parcels[b]) - rank(parcels[a]));
  const listRows = order.slice(0, MAX_LISTED).map(idx => {
    const p = parcels[idx];
    const a = parcelAction(p);
    const pair = p.partner ? `<br><small>+ ${escapeHtml(p.partner.layer)} · ${p.partner.crossWard ? `<s>${fmtArea(p.partner.area)}</s> 0` : sizeText(p.partner)}</small>` : '';
    const name = displayName(p);
    const take = a.owner ? `<label class="cad-take" title="Công trình ${escapeHtml(a.id)} đang thuộc đồ án ${escapeHtml(a.owner)}"><input type="checkbox" data-take="${idx}"${a.key === 'update' ? ' checked' : ''}>Chuyển sang đồ án này</label>` : '';
    const badge = p.crossWard && a.key !== 'out' ? `${a.label} · vắt ranh` : p.wardParts ? `${a.label} · tách ${p.wardParts.length} phường` : a.label;
    return `<div class="cad-row${p.src === current.reviewSrc ? ' reviewing' : ''}" data-idx="${idx}" title="Xem trên bản đồ">
      <i class="cad-dot" style="background:${typeColor(p)}"></i>
      <span class="cad-row-main">${name ? `<b>${escapeHtml(name)}</b><br>` : ''}${escapeHtml(layerText(p))}${p.lotCode ? ` ${escapeHtml(p.lotCode)}` : ''} · ${p.crossWard ? `<s>${fmtArea(p.area)}</s> 0` : sizeText(p)}${pair}<br><small>${escapeHtml(p.wardParts ? partsText(p) : p.ward || '—')}</small>
        ${p.ward && p.matchConflict ? pickHtml(p, idx) : ''}${take}</span>
      <span class="cad-badge ${a.cls}">${escapeHtml(badge)}</span>
    </div>`;
  }).join('');
  const listScroll = box.querySelector('.cad-list')?.scrollTop || 0;
  const mapScroll = box.querySelector('.cad-map-list')?.scrollTop || 0;

  const kept = countText(kindCounts(current.entities, current.format)) || 'không có đối tượng hợp lệ';
  const skipped = countText(stats.skipped || {}, true);
  const dupText = result.duplicatesDropped ? ` · bỏ ${result.duplicatesDropped} ${isVector ? 'đường trùng polygon' : 'polyline trùng hatch'}` : '';

  // Khách chỉ gửi được 1 file vào hàng chờ: ô lớp điểm dành cho Admin
  const pointSlot = isAdmin() ? `<div class="cad-points">${ico('pin')}<span class="cad-row-main">Lớp điểm chức năng: ${current.points
    ? `<b>${escapeHtml(current.points.fileName)}</b>`
    : '<i>chưa có</i><br><small>Nạp kèm để lấy tên công trình, nhận chợ / siêu thị / TTTM và cấp trường</small>'}</span>
    <label class="cad-clear" for="cadPointFile">${current.points ? 'Đổi' : 'Chọn file'}</label>${current.points ? '<button type="button" id="cadPointsClear" class="cad-clear">Bỏ</button>' : ''}</div>` : '';

  box.innerHTML = `
    <div class="cad-file">${ico('file')}<b>${escapeHtml(fileName)}</b> · ${parcels.length} lô${dupText}
      <div class="cad-filter">Nhận: <b>${kept}</b>${skipped ? `<br>Bỏ qua (bộ lọc mặc định): ${skipped}` : ''}</div></div>
    ${pointSlot}
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
    if (e.target.closest('.cad-pick, .cad-take')) return;
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
  box.querySelectorAll('[data-take]').forEach(chk => chk.addEventListener('change', () => {
    const p = parcels[Number(chk.dataset.take)];
    if (!p) return;
    current.takeOver = current.takeOver || new Set();
    current.takeOver[chk.checked ? 'add' : 'delete'](parcelKey(p));
    renderReport();
  }));
  $('btnCadClear')?.addEventListener('click', () => { if (!submitting) resetImport(); });
  $('cadPointsClear')?.addEventListener('click', () => {
    if (submitting || !current) return;
    current.points = null;
    analyse({ fit: false });
  });
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
    const base = String(it.fileName || 'hoso').replace(FILE_EXT_RE, '');
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
  enrichParcels(base.parcels);
  current.base = base;
  refreshParcels();
  // Lần phân tích đầu: mở ngay lô trường học đầu tiên cần chọn cấp
  const first = current.reviewStarted ? null : schoolLots().find(p => !levelOf(p.src));
  current.reviewStarted = true;
  if (first) current.reviewSrc = first.src;
  renderReport();
  drawPreview(current.result.parcels, fit, first);
  if (current.reviewSrc != null) markReview(schoolLots().find(p => p.src === current.reviewSrc));
}

// Lỗi định dạng / dung lượng trước khi đọc ('' = hợp lệ)
function fileProblem(file) {
  if (!FILE_EXT_RE.test(file.name)) {
    return /\.(shp|shx|dbf|prj|cpg)$/i.test(file.name)
      ? '⚠️ Shapefile: nén các file .shp, .shx, .dbf, .prj (và .cpg nếu có) thành 1 file .zip rồi nhập.'
      : '⚠️ Chỉ nhận file .dxf (AutoCAD: Save As → DXF), .kml, .kmz, .geojson, .json hoặc shapefile nén .zip.';
  }
  if (!isAdmin() && file.size > GUEST_MAX_BYTES) {
    return `⚠️ Chưa đăng nhập: chỉ nhận file ≤ 2 MB (file này ${fmtMB(file.size)}) — tách nhỏ file theo phường / nhóm layer rồi gửi từng phần.`;
  }
  return '';
}

// File → { file, format, parsed, text, wgs84 }
async function readImportFile(file) {
  const ext = file.name.match(FILE_EXT_RE)[1].toLowerCase();
  let parsed, text;
  if (ext === 'dxf') {
    const head = await file.slice(0, 22).text();
    if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF dạng nhị phân chưa hỗ trợ — lưu lại dạng ASCII DXF.');
    text = await file.text();
    parsed = parseDxf(text);
  } else if (ext === 'json' || ext === 'geojson') {
    text = await file.text();
    parsed = parseGeoJson(text);
  } else if (ext === 'zip') {
    parsed = await parseShapefileZip(await file.arrayBuffer());
    text = JSON.stringify(parsed.geojson);
  } else {
    text = ext === 'kmz' ? await unzipKml(await file.arrayBuffer()) : await file.text();
    parsed = parseKml(text);
  }
  if (!parsed.entities.length) {
    const skipped = countText(parsed.stats.skipped || {}, true);
    throw new Error(`${file.name}: không có ${ext === 'dxf' ? 'HATCH hoặc polyline khép kín' : 'Polygon, đường khép kín hoặc Point'} nào để nhập${skipped ? ` (bỏ qua ${skipped})` : ''}.`);
  }
  const format = ext === 'dxf' ? 'dxf' : ext === 'kml' || ext === 'kmz' ? 'kml' : ext === 'zip' ? 'shp' : 'geojson';
  const wgs84 = format === 'kml' || ((format === 'geojson' || format === 'shp') && !!parsed.wgs84);
  return { file, format, parsed, text, wgs84 };
}

const onlyPoints = (r) => r.parsed.entities.every(e => e.kind === 'POINT');
const pointSource = (r) => ({
  fileName: r.file.name, entities: r.parsed.entities.filter(e => e.kind === 'POINT'), wgs84: r.wgs84, crs: r.parsed.crs || null
});

const loadFile = (file, pendingId = null) => loadFiles(file ? [file] : [], pendingId);

/**
 * Nạp 1 file, hoặc 2 file chọn cùng lúc: lớp vùng (Chức năng sử dụng đất) + lớp điểm (Điểm chức năng) của cùng đồ án.
 * pendingId: Admin mở hồ sơ chờ duyệt (ghi xong thì tự xóa khỏi hàng chờ)
 */
async function loadFiles(files, pendingId = null) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length || submitting) return;
  if (list.length > 2) {
    setStatus('⚠️ Chọn tối đa 2 file: lớp Chức năng sử dụng đất và lớp Điểm chức năng của cùng đồ án.', 'var(--accent-red)');
    return;
  }
  const problem = list.map(fileProblem).find(Boolean);
  if (problem) { setStatus(problem, 'var(--accent-red)'); return; }
  setStatus('⏳ Đang đọc file...', 'var(--accent-orange)');
  await new Promise(r => setTimeout(r, 30));
  try {
    const read = await Promise.all(list.map(readImportFile));
    let main = read[0], points = null;
    if (read.length === 2) {
      const pts = read.map(onlyPoints);
      if (pts[0] === pts[1]) throw new Error('Chọn 2 file thì cần 1 lớp vùng (Chức năng sử dụng đất) và 1 lớp chỉ có điểm (Điểm chức năng).');
      [main, points] = pts[0] ? [read[1], read[0]] : read;
    }
    openParsed(main, pendingId, points);
  } catch (err) {
    current = null;
    lockCrs(false);
    renderReport();
    clearPreview();
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  }
}

function openParsed({ file, format, parsed, text, wgs84 }, pendingId, points) {
  if (format === 'shp' && parsed.crs && CRS_PRESETS[parsed.crs] && $('cadCrs')) $('cadCrs').value = parsed.crs;
  const filePhase = format === 'dxf' || format === 'shp' ? filePhaseFromName(file.name) : null;
  // File đặt tên layer theo TT16: chỉ nhận layer đúng tên, không khớp thủ công các layer khác
  const tt16 = parsed.entities.some(e => tt16Layer(e.layer));
  current = {
    fileName: file.name, format, wgs84, tt16, filePhase, entities: parsed.entities, stats: parsed.stats, base: null, result: null,
    manual: tt16 ? null : createManualMapping(parsed.entities), levels: new Map(), autoLevels: new Map(), takeOver: new Set(),
    reviewSrc: null, reviewStarted: false,
    raw: { ext: format === 'shp' ? 'geojson' : format, text }, pendingId,
    crs: parsed.crs || null, crsUnknown: !!parsed.crsUnknown, layers: parsed.layers || [],
    points: points ? pointSource(points) : null
  };
  lockCrs(wgs84);
  syncPhaseSelect();
  analyse();
  setStatus(pendingId ? 'Đang mở hồ sơ chờ duyệt — kiểm tra rồi bấm Ghi; ghi xong hồ sơ tự xóa khỏi hàng chờ.' : '');
  renderPendingList();
}

// Ô "Lớp điểm chức năng": thêm / đổi lớp điểm cho file vùng đang mở
async function loadPointsFile(file) {
  if (!file || !current || submitting) return;
  const problem = fileProblem(file);
  if (problem) { setStatus(problem, 'var(--accent-red)'); return; }
  try {
    const read = await readImportFile(file);
    if (!read.parsed.entities.some(e => e.kind === 'POINT')) throw new Error(`${file.name} không có đối tượng điểm.`);
    current.points = pointSource(read);
    analyse({ fit: false });
    setStatus('');
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    if ($('cadPointFile')) $('cadPointFile').value = '';
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
  ['cadFile', 'cadPointFile'].forEach(id => { if ($(id)) $(id).value = ''; });
  renderPendingList();
}

// Tên Placemark (KML) bỏ mã loại ở đầu, VD "MN - Trường Hoa Sen" → "Trường Hoa Sen"; chỉ còn mã / số hiệu → ''
function ownName(p) {
  let s = String(p.name || '').trim();
  const t = s && layerToType(s);
  if (t) s = s.replace(new RegExp(`^${t.prefix.replace(/_/g, '[\\s_-]+')}(?![A-Za-z])[\\s_\\-–:.]*`, 'i'), '');
  return /\p{L}{2,}/u.test(s) && !/^(HT|QH|DT|DV)$/i.test(s) ? s : '';
}

// Tên ghi Sheet: tên riêng trong file → tên riêng điểm chức năng → nhãn chung của điểm + ký hiệu lô → "<loại> <ký hiệu lô> – <tên file> #<thứ tự>"
function lotName(p, tag, fileBase, idx) {
  const named = displayName(p);
  if (named) return named;
  const code = p.lotCode || p.partner?.lotCode || '';
  const generic = lotPoints(p).find(pt => pt.name)?.name;
  if (generic && code) return `${generic} ${code}`;
  return `${tag}${code ? ` ${code}` : ''} – ${fileBase} #${idx + 1}`;
}

const polysGeometry = (polys) => (polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });

// Lô vắt ranh đã tách: dòng chính giữ nguyên lô, tọa độ đặt trong mảnh phường chính; mỗi phường phụ 1 dòng
// { ward, lat, lng, stages: [{ phase, area, geometry }] } chỉ để tính diện tích chỉ tiêu phường
function wardSplits(mainWard, stageLots) {
  const byWard = new Map();
  stageLots.forEach(({ s, phase }) => (s.wardParts || []).forEach(part => {
    if (part.ward === mainWard) return;
    const e = byWard.get(part.ward) || { ward: part.ward, lat: part.lat, lng: part.lng, stages: [] };
    if (!e.stages.some(st => st.phase === phase)) e.stages.push({ phase, area: part.area, geometry: polysGeometry(part.polygons) });
    byWard.set(part.ward, e);
  }));
  return byWard.size ? [...byWard.values()] : undefined;
}

// Lô sẽ ghi (tạo mới / cập nhật) → dữ liệu gửi máy chủ
function buildItems() {
  const fileBase = current.fileName.replace(FILE_EXT_RE, '');
  const items = [];
  refreshDupTargets(current.result.parcels);
  // Máy chủ giữ tối đa 60 ký tự: rút gọn tên gốc để còn mã loại đã gán ở cuối
  const layerOut = (p) => (p.manual || (p.school && p.prefix) ? `${p.layer.slice(0, 45)} → ${p.prefix}` : p.layer);
  const geometryOf = (p) => (isPoint(p) ? null : polysGeometry(p.polygons));
  current.result.parcels.forEach((p, idx) => {
    const action = parcelAction(p);
    if (action.key !== 'new' && action.key !== 'update') return;
    const stageLots = p.keep ? ['HT', 'QH'].map(phase => ({ s: p, phase })) : [p, p.partner].filter(Boolean).map(s => ({ s, phase: phaseOf(s) }));
    const anchor = p.wardParts ? p.wardParts[0] : p;
    items.push({
      type: p.type,
      idPrefix: p.prefix.replace(/_DV$/, ''),
      nhom: p.nhom,
      name: lotName(p, p.tt16 ? p.prefix : p.layer, fileBase, idx),
      ward: p.ward,
      lat: anchor.lat,
      lng: anchor.lng,
      splits: wardSplits(p.ward, stageLots),
      area: p.area,
      plan: planOf(p),
      point: isPoint(p),
      kind: p.kind,
      crossWard: !!p.crossWard,
      layer: layerOut(p),
      matchId: action.key === 'update' ? action.id : null,
      keep: !!p.keep,
      // Quy mô + ranh theo từng giai đoạn: 1 lô, cặp HT + QH cùng vị trí, hoặc layer HT trong file QH (hai cột bằng nhau)
      stages: stageLots.map(({ s, phase }) => ({
        phase, area: s.area, point: isPoint(s), crossWard: !!s.crossWard, layer: layerOut(s), geometry: geometryOf(s)
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
      name: lotName(p, p.layer, fileBase, idx),
      ward: p.ward,
      nhom: landLabel(p.layer),
      layer: p.layer,
      lat: p.lat,
      lng: p.lng,
      area: p.area,
      plan: planOf(p),
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

function landAreaByWard() {
  const out = {};
  const add = (ward, nhom, area) => {
    if (!ward || !(Number(area) > 0)) return;
    const row = out[ward] || (out[ward] = {});
    row[nhom] = Math.round(((row[nhom] || 0) + Number(area)) * 10) / 10;
  };
  current.result.parcels.forEach(p => {
    if (parcelAction(p).key !== 'land' || isPoint(p)) return;
    const nhom = landLabel(p.layer);
    if (p.wardParts && p.wardParts.length) p.wardParts.forEach(part => add(part.ward, nhom, part.area));
    else add(p.ward, nhom, p.area);
  });
  return out;
}

// Ranh tổng dựng từ mọi lô trong TP. Huế của file (kể cả lô trùng đồ án khác / không ghi), không chỉ lô ghi lần này
function projectRegistry(items, lands) {
  const geometries = current.result.parcels
    .filter(p => p.ward && !isPoint(p) && p.polygons && p.polygons.length)
    .map(p => polysGeometry(p.polygons));
  const wards = [
    ...items.flatMap(it => [it.ward, ...(it.splits || []).map(s => s.ward)]),
    ...lands.map(l => l.ward)
  ];
  return {
    boundary: projectBoundary(geometries),
    wards: [...new Set(wards.filter(Boolean))],
    infra: items.length,
    lands: lands.length,
    landArea: landAreaByWard()
  };
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
    const landNote = lands.length ? `\n• ${lands.length} lô đất ngoài nhóm hạ tầng → file đồ án trên bucket (không ghi tab DXF)` : '';
    if (!confirm(`Ghi vào Google Sheet?\n• ${summary}\n• ${items.length - nUpdate} công trình mới, ${nUpdate} cập nhật (giữ tên, ghi đè tọa độ bằng tâm hatch)${landNote}\n• Giai đoạn: ${phaseLabel}\n• TrangThai = TRUE (đã duyệt)`)) return;
  }

  // Lô đất gửi thành các phần riêng sau lô hạ tầng; phần đất đầu tiên xóa dữ liệu cũ của sheet DXF đồ án
  const chunks = [
    ...chunkItems(items).map(c => ({ items: c, lands: [] })),
    ...chunkItems(lands).map((c, i) => ({ items: [], lands: c, landsReset: i === 0 }))
  ];
  // Danh mục đồ án (tab DS_DoAn) ghi cùng phần cuối, trước khi đồng bộ lên bucket
  submitting = true;
  setStatus('⏳ Đang dựng ranh tổng đồ án...', 'var(--accent-orange)');
  await new Promise(r => setTimeout(r, 0));
  chunks[chunks.length - 1].registry = projectRegistry(items, lands);
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
          items: chunks[k].items, lands: chunks[k].lands, landsReset: !!chunks[k].landsReset, infraReset: k === 0,
          registry: chunks[k].registry || undefined
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
      done.lands ? `${done.lands} lô đất vào file đồ án` : '',
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

  $('cadFile')?.addEventListener('change', (e) => loadFiles(e.target.files));
  $('cadPointFile')?.addEventListener('change', (e) => loadPointsFile(e.target.files && e.target.files[0]));
  const drop = $('cadDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => loadFiles(e.dataTransfer.files));
  }
  $('cadCrs')?.addEventListener('change', analyse);
  $('cadPhase')?.addEventListener('change', renderReport);
  $('btnCadSubmit')?.addEventListener('click', submitImport);
}
