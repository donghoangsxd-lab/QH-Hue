// Tab Đề xuất → "Hàng loạt (DXF)": đọc file CAD, xem trước các lô trên bản đồ và báo cáo kiểm tra trước khi ghi
import { state, infraLabels, BUFFER_COLORS } from './state.js';
import { map } from './mapEngine.js';
import { escapeHtml, fmtNum } from './utils.js';
import { parseDxf, buildParcels, assignWards, matchExisting, CRS_PRESETS } from './cadImport.js';

// Diện tích tối thiểu theo loại (khớp config/constants.js → infraConfig.minSize)
const MIN_SIZE = { "1-CV": 300, "2-BDX": 200, "3-MN": 800, "4-TH": 2000, "5-THCS": 2500, "6-YT": 1000, "7-VH": 500, "8-TM": 1500 };
const MAX_LISTED = 200;

let current = null;   // { fileName, stats, result }
let previewLayer = null;

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

// Trạng thái xử lý của 1 lô khi ghi: bỏ qua / cập nhật / tạo mới; vắt ranh thì quy mô = 0
function parcelAction(p) {
  if (!p.ward) return { key: 'out', label: 'Ngoài TP', cls: 'bad' };
  if (p.matchConflict) return { key: 'conflict', label: `Chứa ${p.matchConflict.length} công trình`, cls: 'warn' };
  if (p.matchId) return { key: 'update', label: `Cập nhật ${p.matchId}`, cls: 'info' };
  return { key: 'new', label: 'Tạo mới', cls: 'ok' };
}

function clearPreview() {
  if (previewLayer) previewLayer.remove();
  previewLayer = null;
}

function drawPreview(parcels) {
  clearPreview();
  if (!map || !parcels.length) return;
  previewLayer = L.featureGroup();
  parcels.forEach((p, idx) => {
    const color = BUFFER_COLORS[p.type] || '#38bdf8';
    const style = !p.ward
      ? { color: '#94a3b8', weight: 2, dashArray: '4,4', fillColor: '#94a3b8', fillOpacity: 0.2 }
      : p.crossWard
        ? { color: '#ef4444', weight: 2.5, dashArray: '6,4', fillColor: color, fillOpacity: 0.3 }
        : { color, weight: 2, fillColor: color, fillOpacity: 0.35 };
    const tip = `<b>${escapeHtml(p.layer)}</b> · ${fmtArea(p.area)}<br>${escapeHtml(p.ward || 'Ngoài TP. Huế')}${p.crossWard ? ' · <span style="color:#f87171">vắt ranh</span>' : ''}<br>${escapeHtml(parcelAction(p).label)}`;
    const poly = L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }, { style, interactive: true }).bindTooltip(tip, { sticky: true });
    poly.on('click', () => focusRow(idx));
    previewLayer.addLayer(poly);
    previewLayer.addLayer(L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }));
  });
  previewLayer.addTo(map);
  map.fitBounds(previewLayer.getBounds(), { padding: [40, 40], maxZoom: 17 });
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
  const byType = {};
  const count = { out: 0, conflict: 0, update: 0, new: 0, cross: 0, small: 0 };
  parcels.forEach(p => {
    const a = parcelAction(p);
    count[a.key]++;
    if (p.ward && p.crossWard) count.cross++;
    if (p.ward && MIN_SIZE[p.type] && p.area < MIN_SIZE[p.type]) count.small++;
    const t = byType[p.type] || (byType[p.type] = { n: 0, area: 0 });
    t.n++;
    if (p.ward && !p.crossWard) t.area += p.area;
  });

  const alerts = [];
  if (!result.axes.valid) alerts.push(['bad', 'Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra lại hệ tọa độ / đơn vị bản vẽ.']);
  else if (result.axes.note) alerts.push(['info', `Đã tự nhận diện bản vẽ: ${escapeHtml(result.axes.note)}.`]);
  if (count.cross) alerts.push(['warn', `${count.cross} lô vắt ranh phường (lấn ≥ 5%): ghi quy mô = 0, diện tích thật ghi vào Ghi chú.`]);
  if (count.out) alerts.push(['bad', `${count.out} lô nằm ngoài TP. Huế: bỏ qua.`]);
  if (count.update) alerts.push(['info', `${count.update} lô chứa công trình cùng loại đã có: cập nhật tọa độ + diện tích ${phase === 'QH' ? 'QH' : 'HT'} cho công trình đó.`]);
  if (count.conflict) alerts.push(['warn', `${count.conflict} lô chứa nhiều công trình cùng loại: tạm bỏ qua, cần chọn công trình cần cập nhật.`]);
  if (count.small) alerts.push(['info', `${count.small} lô nhỏ hơn diện tích tối thiểu của loại (vẫn nhập).`]);
  const unknown = Object.entries(result.unknownLayers);
  if (unknown.length) alerts.push(['warn', `Layer không nhận diện (bỏ qua): ${unknown.map(([l, n]) => `${escapeHtml(l)} (${n})`).join(', ')}.`]);
  if (stats.insert) alerts.push(['warn', `${stats.insert} block (INSERT) chưa được đọc — explode block trước khi xuất DXF.`]);
  if (stats.splineEdges) alerts.push(['info', `${stats.splineEdges} cạnh spline được tính gần đúng.`]);
  if (!state.wardLabelsList.some(w => w.geometry)) alerts.push(['bad', 'Chưa tải xong ranh 40 phường xã — mở lại file sau ít giây.']);

  const typeRows = Object.entries(byType).sort().map(([type, t]) => `
    <tr><td><i class="cad-dot" style="background:${BUFFER_COLORS[type] || '#38bdf8'}"></i>${escapeHtml(infraLabels[type] || type)}</td>
    <td>${t.n}</td><td>${fmtArea(t.area)}</td></tr>`).join('');

  const listRows = parcels.slice(0, MAX_LISTED).map((p, idx) => {
    const a = parcelAction(p);
    return `<div class="cad-row" data-idx="${idx}" title="Xem trên bản đồ">
      <i class="cad-dot" style="background:${BUFFER_COLORS[p.type] || '#38bdf8'}"></i>
      <span class="cad-row-main">${escapeHtml(p.layer)} · ${p.crossWard ? `<s>${fmtArea(p.area)}</s> 0` : fmtArea(p.area)}<br><small>${escapeHtml(p.ward || '—')}</small></span>
      <span class="cad-badge ${a.cls}">${escapeHtml(p.crossWard && a.key !== 'out' ? `${a.label} · vắt ranh` : a.label)}</span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="cad-file">📄 <b>${escapeHtml(fileName)}</b> · ${parcels.length} lô (${stats.hatch} hatch, ${stats.polyline} polyline khép kín${result.duplicatesDropped ? `, bỏ ${result.duplicatesDropped} polyline trùng hatch` : ''})</div>
    ${alerts.map(([cls, text]) => `<div class="cad-alert ${cls}">${text}</div>`).join('')}
    ${parcels.length ? `<table class="cad-table"><thead><tr><th>Loại</th><th>Số lô</th><th>Diện tích tính</th></tr></thead><tbody>${typeRows}</tbody></table>
    <div class="cad-list">${listRows}${parcels.length > MAX_LISTED ? `<div class="cad-more">… và ${parcels.length - MAX_LISTED} lô khác</div>` : ''}</div>` : ''}
    <div class="cad-foot"><span>Sẽ ghi: ${count.new} mới · ${count.update} cập nhật</span><button type="button" id="btnCadClear" class="cad-clear">✕ Xóa xem trước</button></div>`;

  box.querySelectorAll('.cad-row').forEach(row => row.addEventListener('click', () => {
    const p = parcels[Number(row.dataset.idx)];
    if (p && map) map.fitBounds(L.geoJSON({ type: 'MultiPolygon', coordinates: p.polygons }).getBounds(), { padding: [60, 60], maxZoom: 18 });
  }));
  $('btnCadClear')?.addEventListener('click', resetImport);
  if (btn) {
    btn.disabled = !(count.new + count.update) || !result.axes.valid;
    btn.title = state.currentUserRole === 'ADMIN' ? '' : 'Cần đăng nhập Admin';
  }
}

function analyse() {
  if (!current) return;
  const crs = CRS_PRESETS[$('cadCrs')?.value] || CRS_PRESETS.HUE_3;
  const result = buildParcels(current.entities, { crs });
  assignWards(result.parcels, state.wardLabelsList || []);
  matchExisting(result.parcels, [...state.rawDataList, ...state.planDataList]);
  current.result = result;
  renderReport();
  drawPreview(result.parcels);
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.dxf$/i.test(file.name)) { setStatus('⚠️ Chỉ nhận file .dxf (AutoCAD: Save As → DXF).', 'var(--accent-red)'); return; }
  setStatus('⏳ Đang đọc file...', 'var(--accent-orange)');
  await new Promise(r => setTimeout(r, 30));
  try {
    const head = await file.slice(0, 22).text();
    if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF dạng nhị phân chưa hỗ trợ — lưu lại dạng ASCII DXF.');
    const { entities, stats } = parseDxf(await file.text());
    if (!entities.length) throw new Error('Không tìm thấy HATCH hoặc polyline khép kín nào.');
    current = { fileName: file.name, entities, stats, result: null };
    analyse();
    setStatus('');
  } catch (err) {
    current = null;
    renderReport();
    clearPreview();
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  }
}

function resetImport() {
  current = null;
  clearPreview();
  renderReport();
  setStatus('');
  const input = $('cadFile');
  if (input) input.value = '';
}

export function initCadImport() {
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
  $('btnCadSubmit')?.addEventListener('click', () => {
    if (state.currentUserRole !== 'ADMIN') { setStatus('🔒 Cần đăng nhập Admin để ghi hàng loạt.', 'var(--accent-red)'); return; }
    setStatus('⏳ Chức năng ghi hàng loạt đang chờ cập nhật Apps Script (doPost).', 'var(--accent-orange)');
  });
}
