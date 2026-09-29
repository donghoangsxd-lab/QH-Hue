// Tab Đề xuất → "Nhập hàng loạt": đọc file DXF/KML/KMZ/GeoJSON, xem trước các lô trên bản đồ và báo cáo kiểm tra trước khi ghi
import { state, infraLabels, BUFFER_COLORS } from './state.js';
import { map } from './mapEngine.js';
import { geeApi } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, distanceMeters } from './utils.js';
import { parseDxf, buildParcels, buildParcelsLonLat, assignWards, matchExisting, layerToType, CRS_PRESETS } from './cadImport.js';
import { parseKml, unzipKml } from './kmlImport.js';
import { parseGeoJson } from './geojsonImport.js';
import { createManualMapping, selectField, setCode, clearCodes, applyManualMapping, manualMappingHtml } from './cadTypeMapping.js';

// Diện tích tối thiểu theo loại (khớp config/constants.js → infraConfig.minSize)
const MIN_SIZE = { "1-CV": 300, "2-BDX": 200, "3-MN": 800, "4-TH": 2000, "5-THCS": 2500, "6-YT": 1000, "7-VH": 500, "8-TM": 1500 };
const MAX_LISTED = 200;
// Mỗi lần gửi: tối đa 300 lô (giới hạn máy chủ) và ~2,5 MB (Vercel nhận tối đa 4,5 MB/yêu cầu)
const CHUNK_MAX_ITEMS = 250;
const CHUNK_MAX_CHARS = 2500000;

// Lựa chọn cho lô chứa nhiều công trình cùng loại (ngoài ID công trình cần cập nhật)
const CHOICE_NEW = '__new';
const CHOICE_SKIP = '__skip';

let current = null;   // { fileName, format: 'dxf'|'kml'|'geojson', wgs84, stats, result, manual (khớp thủ công), items: Map ID → công trình đang có }
let previewLayer = null;
let submitting = false;
let onImported = null;
let dupTargets = new Set();   // ID công trình bị nhiều lô cùng chọn cập nhật

const $ = (id) => document.getElementById(id);

function setStatus(text, color) {
  const el = $('cadStatus');
  if (!el) return;
  el.style.color = color || '';
  el.textContent = text || '';
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

// ID công trình lô sẽ cập nhật (null = tạo mới / bỏ qua / ngoài TP)
function targetId(p) {
  if (!p.ward) return null;
  if (p.matchConflict) return p.choice === CHOICE_NEW || p.choice === CHOICE_SKIP ? null : p.choice || null;
  return p.matchId || null;
}

function refreshDupTargets(parcels) {
  const seen = new Map();
  parcels.forEach(p => { const id = targetId(p); if (id) seen.set(id, (seen.get(id) || 0) + 1); });
  dupTargets = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
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
  if (p.existingId) return { key: 'exists', label: `Đã có ${p.existingId}`, cls: 'warn' };
  if (p.matchConflict && p.choice === CHOICE_SKIP) return { key: 'skip', label: 'Bỏ qua', cls: 'warn' };
  const id = targetId(p);
  if (id && dupTargets.has(id)) return { key: 'dup', label: `Trùng ${id}`, cls: 'bad' };
  if (id) return { key: 'update', label: `Cập nhật ${id}`, cls: 'info', id };
  return { key: 'new', label: 'Tạo mới', cls: 'ok' };
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

// Tên layer hiển thị; lô khớp thủ công kèm mã loại đã gán
const layerText = (p) => (p.manual ? `${p.layer} → ${p.prefix}` : p.layer);

function parcelTip(p) {
  return `<b>${escapeHtml(layerText(p))}</b> · ${sizeText(p)}<br>${escapeHtml(p.ward || 'Ngoài TP. Huế')}${p.crossWard ? ' · <span style="color:#f87171">vắt ranh</span>' : ''}<br>${escapeHtml(parcelAction(p).label)}`;
}

function clearPreview() {
  if (previewLayer) previewLayer.remove();
  previewLayer = null;
}

// fit = false (đổi khớp thủ công): giữ khung nhìn, trừ lần đầu có lô để xem
function drawPreview(parcels, fit = true) {
  const hadPreview = !!previewLayer;
  clearPreview();
  if (!map || !parcels.length) return;
  if (!hadPreview) fit = true;
  previewLayer = L.featureGroup();
  parcels.forEach((p, idx) => {
    const color = BUFFER_COLORS[p.type] || '#38bdf8';
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
      : p.crossWard
        ? { color: '#ef4444', weight: 2.5, dashArray: '6,4', fillColor: color, fillOpacity: 0.3 }
        : { color, weight: 2, fillColor: color, fillOpacity: 0.35 };
    const poly = L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }, { style, interactive: true }).bindTooltip(() => parcelTip(p), { sticky: true });
    poly.on('click', () => focusRow(idx));
    previewLayer.addLayer(poly);
    previewLayer.addLayer(L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }));
  });
  previewLayer.addTo(map);
  if (fit) map.fitBounds(previewLayer.getBounds(), { padding: [40, 40], maxZoom: 17 });
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
  const phase = $('cadPhase')?.value === 'QH' ? 'QH' : 'HT';
  const parcels = result.parcels;
  refreshDupTargets(parcels);
  const byType = {};
  const count = { out: 0, exists: 0, skip: 0, dup: 0, update: 0, new: 0, cross: 0, small: 0, multi: 0, newPoint: 0 };
  parcels.forEach(p => {
    const a = parcelAction(p);
    count[a.key]++;
    if (p.ward && p.matchConflict) count.multi++;
    if (p.ward && p.crossWard) count.cross++;
    if (p.ward && !isPoint(p) && MIN_SIZE[p.type] && p.area < MIN_SIZE[p.type]) count.small++;
    if (a.key === 'new' && isPoint(p)) count.newPoint++;
    const t = byType[p.type] || (byType[p.type] = { n: 0, area: 0 });
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
  if (count.cross) alerts.push(['warn', `${count.cross} lô vắt ranh phường (lấn ≥ 5%): ghi quy mô = 0, diện tích thật ghi vào Ghi chú.`]);
  if (count.out) alerts.push(['bad', `${count.out} lô nằm ngoài TP. Huế (đưa lên đầu danh sách, viền xám trên bản đồ): bỏ qua — sẽ hỏi xác nhận trước khi ghi.`]);
  if (count.update) alerts.push(['info', `${count.update} lô chứa công trình cùng loại đã có: cập nhật tọa độ + diện tích ${phase === 'QH' ? 'QH' : 'HT'} cho công trình đó.`]);
  if (count.multi) alerts.push(['warn', `${count.multi} lô chứa nhiều công trình cùng loại (đưa lên đầu danh sách): chọn công trình cần cập nhật — mặc định gợi ý công trình gần tâm lô nhất, các công trình còn lại giữ nguyên.`]);
  if (count.dup) alerts.push(['bad', `${count.dup} lô cùng cập nhật 1 công trình: chọn lại (tạo mới / bỏ qua) trước khi ghi.`]);
  if (count.skip) alerts.push(['info', `${count.skip} lô được chọn bỏ qua.`]);
  if (count.small) alerts.push(['info', `${count.small} lô nhỏ hơn diện tích tối thiểu của loại (vẫn nhập).`]);
  if (count.newPoint) alerts.push(['info', `${count.newPoint} điểm (không có ranh) tạo mới với quy mô = 0 (có công trình, chưa rõ diện tích) — bổ sung diện tích trong Sheet sau.`]);
  if (count.exists) alerts.push(['warn', `${count.exists} điểm cách công trình cùng loại đã có dưới 20 m: coi là đã có, bỏ qua.`]);
  if (result.pointsInLots) alerts.push(['info', `${result.pointsInLots} điểm nằm trong lô cùng loại của file (điểm ghi chú của lô): bỏ qua.`]);
  const unknown = Object.entries(result.unknownLayers);
  if (unknown.length) {
    const nUnknown = unknown.reduce((s, [, n]) => s + n, 0);
    const listed = unknown.slice(0, 8).map(([l, n]) => `${escapeHtml(l)} (${n})`).join(', ');
    alerts.push(['warn', `${UNKNOWN_LABEL[current.format]}: ${nUnknown} đối tượng bị bỏ qua — ${listed}${unknown.length > 8 ? ', …' : ''}. Gán loại ở khung <b>Khớp thủ công</b> bên dưới nếu cần nhập.`]);
  }
  const manualCount = parcels.filter(p => p.manual).length;
  if (manualCount) alerts.push(['info', `${manualCount} lô được gán loại thủ công (ghi chú trong Sheet kèm tên layer gốc).`]);
  if (stats.insert) alerts.push(['warn', `${stats.insert} block (INSERT) bị bỏ qua — nếu block chứa ranh lô, explode block trước khi xuất DXF.`]);
  if (stats.splineEdges) alerts.push(['info', `${stats.splineEdges} cạnh spline được tính gần đúng.`]);
  if (!state.wardLabelsList.some(w => w.geometry)) alerts.push(['bad', 'Chưa tải xong ranh 40 phường xã — mở lại file sau ít giây.']);

  const typeRows = Object.entries(byType).sort().map(([type, t]) => `
    <tr><td><i class="cad-dot" style="background:${BUFFER_COLORS[type] || '#38bdf8'}"></i>${escapeHtml(infraLabels[type] || type)}</td>
    <td>${t.n}</td><td>${fmtArea(t.area)}</td></tr>`).join('');

  // Lô cần admin chọn (nhiều công trình / trùng) rồi lô ngoài TP lên đầu để không bị khuất sau giới hạn MAX_LISTED
  const rank = (p) => ((p.ward && p.matchConflict) || parcelAction(p).key === 'dup' ? 2 : !p.ward ? 1 : 0);
  const order = parcels.map((_, idx) => idx).sort((a, b) => rank(parcels[b]) - rank(parcels[a]));
  const listRows = order.slice(0, MAX_LISTED).map(idx => {
    const p = parcels[idx];
    const a = parcelAction(p);
    return `<div class="cad-row" data-idx="${idx}" title="Xem trên bản đồ">
      <i class="cad-dot" style="background:${BUFFER_COLORS[p.type] || '#38bdf8'}"></i>
      <span class="cad-row-main">${escapeHtml(layerText(p))} · ${p.crossWard ? `<s>${fmtArea(p.area)}</s> 0` : sizeText(p)}<br><small>${escapeHtml(p.ward || '—')}</small>
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
    <div class="cad-file">📄 <b>${escapeHtml(fileName)}</b> · ${parcels.length} lô${dupText}
      <div class="cad-filter">Nhận: <b>${kept}</b>${skipped ? `<br>Bỏ qua (bộ lọc mặc định): ${skipped}` : ''}</div></div>
    ${alerts.map(([cls, text]) => `<div class="cad-alert ${cls}">${text}</div>`).join('')}
    ${manualMappingHtml(current.manual)}
    ${parcels.length ? `<table class="cad-table"><thead><tr><th>Loại</th><th>Số lô</th><th>Diện tích tính</th></tr></thead><tbody>${typeRows}</tbody></table>
    <div class="cad-list">${listRows}${parcels.length > MAX_LISTED ? `<div class="cad-more">… và ${parcels.length - MAX_LISTED} lô khác</div>` : ''}</div>` : ''}
    <div class="cad-foot"><span>Sẽ ghi: ${count.new} mới · ${count.update} cập nhật${count.new + count.update ? ` <small>(${countText(kindCounts(writable(parcels), current.format))})</small>` : ''}</span><button type="button" id="btnCadClear" class="cad-clear">✕ Xóa xem trước</button></div>`;

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
  box.querySelectorAll('.cad-row').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('.cad-pick')) return;
    const p = parcels[Number(row.dataset.idx)];
    if (p && map && isPoint(p)) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
    else if (p && map) map.fitBounds(L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }).getBounds(), { padding: [60, 60], maxZoom: 18 });
  }));
  box.querySelectorAll('.cad-pick').forEach(sel => sel.addEventListener('change', () => {
    const p = parcels[Number(sel.dataset.idx)];
    if (!p) return;
    p.choice = sel.value;
    renderReport();
  }));
  $('btnCadClear')?.addEventListener('click', () => resetImport());
  if (btn) {
    btn.disabled = submitting || !(count.new + count.update) || count.dup > 0 || !result.axes.valid;
    btn.title = state.currentUserRole === 'ADMIN' ? '' : 'Cần đăng nhập Admin';
  }
}

// Khóa nhận diện lô qua các lần phân tích lại (đổi khớp thủ công / hệ tọa độ) để giữ lựa chọn công trình của admin
const parcelKey = (p) => `${p.layer}|${p.lat}|${p.lng}|${p.area}`;

function analyse({ fit = true } = {}) {
  if (!current) return;
  const crs = CRS_PRESETS[$('cadCrs')?.value] || CRS_PRESETS.HUE_3;
  const entities = applyManualMapping(current.entities, current.manual);
  const result = current.wgs84 ? buildParcelsLonLat(entities) : buildParcels(entities, { crs });
  assignWards(result.parcels, state.wardLabelsList || []);
  const existing = [...state.rawDataList, ...state.planDataList];
  matchExisting(result.parcels, existing);
  current.items = new Map(existing.filter(it => it.id).map(it => [it.id, it]));
  const prevChoices = new Map((current.result?.parcels || []).filter(p => p.choice).map(p => [parcelKey(p), p.choice]));
  current.result = result;
  result.parcels.forEach(p => {
    if (!p.matchConflict) { p.choice = null; return; }
    const prev = prevChoices.get(parcelKey(p));
    p.choice = prev && (prev === CHOICE_NEW || prev === CHOICE_SKIP || p.matchConflict.includes(prev)) ? prev : nearestChoice(p);
  });
  renderReport();
  drawPreview(result.parcels, fit);
}

async function loadFile(file) {
  if (!file) return;
  const ext = (file.name.match(/\.(dxf|kml|kmz|geojson|json)$/i) || [])[1]?.toLowerCase();
  if (!ext) { setStatus('⚠️ Chỉ nhận file .dxf (AutoCAD: Save As → DXF), .kml, .kmz, .geojson hoặc .json.', 'var(--accent-red)'); return; }
  setStatus('⏳ Đang đọc file...', 'var(--accent-orange)');
  await new Promise(r => setTimeout(r, 30));
  try {
    let parsed;
    if (ext === 'dxf') {
      const head = await file.slice(0, 22).text();
      if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF dạng nhị phân chưa hỗ trợ — lưu lại dạng ASCII DXF.');
      parsed = parseDxf(await file.text());
    } else {
      parsed = ext === 'json' || ext === 'geojson' ? parseGeoJson(await file.text())
        : parseKml(ext === 'kmz' ? await unzipKml(await file.arrayBuffer()) : await file.text());
    }
    if (!parsed.entities.length) {
      const skipped = countText(parsed.stats.skipped || {}, true);
      throw new Error(`Không có ${ext === 'dxf' ? 'HATCH, polyline khép kín hoặc POINT' : 'Polygon, đường khép kín hoặc Point'} nào để nhập${skipped ? ` (bỏ qua ${skipped})` : ''}.`);
    }
    const format = ext === 'dxf' ? 'dxf' : ext === 'kml' || ext === 'kmz' ? 'kml' : 'geojson';
    const wgs84 = format === 'kml' || (format === 'geojson' && parsed.wgs84);
    current = { fileName: file.name, format, wgs84, entities: parsed.entities, stats: parsed.stats, result: null, manual: createManualMapping(parsed.entities) };
    lockCrs(wgs84);
    analyse();
    setStatus('');
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
  lockCrs(false);
  clearPreview();
  renderReport();
  if (!keepStatus) setStatus('');
  const input = $('cadFile');
  if (input) input.value = '';
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
  current.result.parcels.forEach((p, idx) => {
    const action = parcelAction(p);
    if (action.key !== 'new' && action.key !== 'update') return;
    items.push({
      type: p.type,
      idPrefix: p.prefix.replace(/_DV$/, ''),
      nhom: p.nhom,
      name: ownName(p) || `${p.layer} – ${fileBase} #${idx + 1}`,
      ward: p.ward,
      lat: p.lat,
      lng: p.lng,
      area: p.area,
      point: isPoint(p),
      kind: p.kind,
      crossWard: !!p.crossWard,
      // Máy chủ giữ tối đa 60 ký tự: rút gọn tên gốc để còn mã loại đã gán ở cuối
      layer: p.manual ? `${p.layer.slice(0, 45)} → ${p.prefix}` : p.layer,
      matchId: action.key === 'update' ? action.id : null,
      geometry: isPoint(p) ? null
        : p.polygons.length === 1
          ? { type: 'Polygon', coordinates: p.polygons[0] }
          : { type: 'MultiPolygon', coordinates: p.polygons }
    });
  });
  return items;
}

// Câu báo kết quả kiểu "50 hatch, 30 polygon và 10 điểm (bỏ qua 5 line, 7 pline hở và 15 mtext)"
function importSummary(items) {
  const { stats, result, format } = current;
  const skipped = { ...(stats.skipped || {}) };
  const add = (label, n) => { if (n) skipped[label] = (skipped[label] || 0) + n; };
  add('không rõ loại', Object.values(result.unknownLayers).reduce((s, n) => s + n, 0));
  add(format === 'dxf' ? 'polyline trùng hatch' : 'đường trùng polygon', result.duplicatesDropped);
  add('điểm trong lô cùng loại', result.pointsInLots);
  const counts = { out: 0, exists: 0, skip: 0 };
  result.parcels.forEach(p => { const k = parcelAction(p).key; if (k in counts) counts[k]++; });
  add('ngoài TP. Huế', counts.out);
  add('điểm đã có', counts.exists);
  add('lô chọn bỏ qua', counts.skip);
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
  if (state.currentUserRole !== 'ADMIN' || !state.authToken) {
    setStatus('🔒 Cần đăng nhập Admin để ghi hàng loạt.', 'var(--accent-red)');
    return;
  }
  const phase = $('cadPhase')?.value === 'QH' ? 'QH' : 'HT';
  const items = buildItems();
  if (!items.length) return;
  const outside = current.result.parcels.filter(p => !p.ward);
  if (outside.length) {
    const byLayer = {};
    outside.forEach(p => { byLayer[p.layer] = (byLayer[p.layer] || 0) + 1; });
    const detail = Object.entries(byLayer).map(([l, n]) => `${l}: ${n}`).join(', ');
    if (!confirm(`⚠️ Có ${outside.length} lô nằm ngoài TP. Huế (${detail}) sẽ bị BỎ QUA, không ghi vào Sheet.\n\nNếu đây là lỗi vẽ / sai vị trí, bấm Hủy để sửa file rồi nhập lại.\nBấm OK để tiếp tục ghi ${items.length} lô hợp lệ.`)) return;
  }
  const nUpdate = items.filter(it => it.matchId).length;
  const phaseLabel = phase === 'QH' ? 'Quy hoạch (QuyMo_QH)' : 'Hiện trạng (QuyMo_HT)';
  const summary = importSummary(items);
  if (!confirm(`Ghi ${items.length} lô vào Google Sheet?\n• ${summary}\n• ${items.length - nUpdate} tạo mới, ${nUpdate} cập nhật\n• Giai đoạn: ${phaseLabel}\n• TrangThai = TRUE (đã duyệt)`)) return;

  const chunks = chunkItems(items);
  const done = { created: [], updated: [], skipped: [], polygonsDropped: 0 };
  submitting = true;
  renderReport();
  try {
    for (let k = 0; k < chunks.length; k++) {
      setStatus(`⏳ Đang ghi ${chunks.length > 1 ? `phần ${k + 1}/${chunks.length}` : `${items.length} lô`}...`, 'var(--accent-orange)');
      const res = await fetch(geeApi('action=importCadBatch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
        body: JSON.stringify({ phase, fileName: current.fileName, sync: k === chunks.length - 1, items: chunks[k] })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) signOutAdmin();
      if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
      ['created', 'updated', 'skipped'].forEach(key => done[key].push(...(data[key] || [])));
      done.polygonsDropped += data.polygonsDropped || 0;
    }
    const extra = [
      done.skipped.length ? `máy chủ bỏ qua ${done.skipped.length}: ${done.skipped.slice(0, 3).join('; ')}` : '',
      done.polygonsDropped ? `${done.polygonsDropped} lô ranh quá phức tạp chỉ ghi điểm tâm` : ''
    ].filter(Boolean).join(' · ');
    submitting = false;
    resetImport(true);
    setStatus(`✓ Đã thêm ${summary} — ${done.created.length} mới, ${done.updated.length} cập nhật${extra ? ` · ${extra}` : ''}.`, 'var(--accent-green)');
    if (onImported) await onImported();
  } catch (err) {
    const written = done.created.length + done.updated.length;
    setStatus(`❌ ${err.message}${written ? ` — đã ghi ${written} lô vào Sheet trước khi lỗi, bản đồ cập nhật ở lần đồng bộ kế tiếp` : ''}`, 'var(--accent-red)');
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
  }));

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
