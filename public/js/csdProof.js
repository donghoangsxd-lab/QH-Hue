/**
 * Minh chứng trực quan cho đề xuất chuyển đổi khu đất chưa sử dụng (CSD):
 * vùng phục vụ của khu đất, công trình cùng loại lân cận đã trừ, vùng giao còn trống và đúng các pixel dân cư đã đếm.
 * Mọi hình và số liệu lấy từ server (action=explainCSD) — cùng phép tính với % độ phủ trong popup / bảng phường.
 */
import { state, BUFFER_COLORS } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';

const CANDIDATE_COLOR = '#facc15';
const NET_COLOR = '#22d3ee';
const MAX_LISTED_EXISTING = 6;
const PER_PIXEL_FORMAT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mỗi lúc chỉ 1 lớp minh chứng; requestSeq bỏ qua kết quả trả về muộn của lần bấm trước
let active = null;
let requestSeq = 0;

export function clearCsdProof() {
  requestSeq++;
  if (!active) return;
  active.group.remove();
  active.panel.remove();
  active = null;
}

function pulseMarker(lat, lng, color, tooltip, permanent = false) {
  const icon = L.divIcon({
    className: 'proof-pulse-icon',
    html: `<span style="--pulse-color:${color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
  return L.marker([lat, lng], { icon, keyboard: false })
    .bindTooltip(tooltip, { permanent, direction: 'top', offset: [0, -10], className: 'proof-tooltip' });
}

// Bề rộng thanh công cụ dọc bên trái đang đè lên bản đồ (px)
function leftToolbarWidth(targetMap) {
  const tb = document.querySelector('.map-toolbar');
  if (!tb || !tb.offsetParent) return 0;
  return Math.max(0, tb.getBoundingClientRect().right - targetMap.getContainer().getBoundingClientRect().left);
}

// Ngang hàng thanh công cụ; nếu nhãn so sánh (HIỆN TRẠNG / QUY HOẠCH) nằm trên cùng dải ngang thì xuống dưới nhãn
function panelTopOffset(targetMap, leftClear, panelWidth) {
  const box = targetMap.getContainer().getBoundingClientRect();
  const tb = document.querySelector('.map-toolbar');
  let top = tb && tb.offsetParent ? Math.max(0, tb.getBoundingClientRect().top - box.top) : 12;
  const x0 = box.left + leftClear, x1 = x0 + panelWidth;
  document.querySelectorAll('.swipe-label').forEach(label => {
    if (!label.offsetParent) return;
    const r = label.getBoundingClientRect();
    if (r.right > x0 && r.left < x1 && r.top - box.top <= top + 4) top = Math.max(top, r.bottom - box.top + 6);
  });
  return top;
}

function legendRow(swatchStyle, text) {
  return `<div class="proof-legend-row"><span class="proof-swatch" style="${swatchStyle}"></span><span>${text}</span></div>`;
}

function buildPanelHtml(data, typeColor) {
  const px = data.pixels;
  const pop = data.population;
  const existingN = data.existing.length;
  const label = escapeHtml(data.label);
  const cell = fmtNum(data.pixelSize);
  const listed = data.existing.slice(0, MAX_LISTED_EXISTING)
    .map(e => `<li>${escapeHtml(e.name || e.id)} <span class="proof-muted">(phục vụ ${fmtNum(e.radius)} m)</span></li>`).join('');
  const more = existingN > MAX_LISTED_EXISTING ? `<li class="proof-muted">… và ${existingN - MAX_LISTED_EXISTING} công trình khác</li>` : '';

  return `
    <div class="proof-head">
      <b>${ico('book')}THUYẾT MINH PHƯƠNG ÁN CHỌN: ${label}</b>
      <button type="button" class="proof-close" aria-label="Đóng thuyết minh">${ico('close')}</button>
    </div>
    <div class="proof-muted">${escapeHtml(data.candidate.name || 'Khu đất chưa sử dụng')} · ${escapeHtml(data.ward)}</div>
    <div class="proof-summary">Nếu xây ${label} tại đây: phục vụ thêm khoảng <b>${fmtNum(pop.added)} người</b>, độ phủ của phường tăng <b>${fmtNum(data.coverageAddPct)}%</b>.</div>
    <div class="proof-legend">
      ${legendRow(`border:2px dashed ${CANDIDATE_COLOR};`, `Phạm vi phục vụ nếu xây tại khu đất này (bán kính ${fmtNum(data.candidate.radius)} m)`)}
      ${legendRow(`background:${typeColor}33; border:1.5px solid ${typeColor};`, existingN ? `${existingN} ${label} hiện có ở gần và phạm vi của chúng` : `Chưa có ${label} nào ở gần`)}
      ${legendRow(`background:${NET_COLOR}22; border:2px solid ${NET_COLOR};`, `Khu vực trong phường hiện chưa có ${label} phục vụ`)}
      ${legendRow('background:#22c55e;', 'Nơi có dân ở, đã được phục vụ')}
      ${legendRow('background:#ffd400;', 'Nơi có dân ở, sẽ được phục vụ thêm')}
    </div>
    ${existingN ? `<details class="proof-existing"><summary>Xem các ${label} hiện có ở gần</summary><ul>${listed}${more}</ul></details>` : ''}
    <div class="proof-muted proof-note">Bản đồ dân cư được chia thành các ô vuông ${cell} × ${cell} m; dưới đây đếm các ô có người ở.</div>
    <table class="proof-table">
      <tr class="proof-group"><td colspan="2">① Độ phủ tăng thêm</td></tr>
      <tr><td>Ô dân cư trong phạm vi phục vụ</td><td>${fmtNum(px.buffer)} ô</td></tr>
      <tr><td>− Đã có ${label} khác phục vụ</td><td>${fmtNum(px.covered)} ô</td></tr>
      <tr class="proof-strong"><td>= Được phục vụ thêm</td><td>${fmtNum(px.net)} ô</td></tr>
      <tr><td>÷ Tổng số ô dân cư của phường</td><td>${fmtNum(px.wardTotal)} ô</td></tr>
      <tr class="proof-result"><td>= Độ phủ của phường tăng thêm</td><td>${fmtNum(data.coverageAddPct)}%</td></tr>
      <tr class="proof-group"><td colspan="2">② Số dân được phục vụ thêm</td></tr>
      <tr><td>Dân số phường</td><td>${fmtNum(pop.ward)} người</td></tr>
      <tr><td>÷ ${fmtNum(px.wardTotal)} ô = bình quân mỗi ô</td><td>${PER_PIXEL_FORMAT.format(pop.perPixel || 0)} người</td></tr>
      <tr><td>× Số ô được phục vụ thêm</td><td>${fmtNum(px.net)} ô</td></tr>
      <tr class="proof-result"><td>= Số dân được phục vụ thêm</td><td>≈ ${fmtNum(pop.added)} người</td></tr>
    </table>
    <div class="proof-muted proof-foot">Diện tích khu đất đáp ứng ${fmtNum(data.scaleAddPct)}% nhu cầu ${label} của phường theo chỉ tiêu.</div>`;
}

/**
 * @param csd       khu đất (id, lat, lng, size)
 * @param suggestion đề xuất được chọn (code, label)
 * @param targetMap bản đồ đang mở popup
 * @param fit       { padTopLeft, padBottomRight } — vùng bản đồ không bị che (panel phải / thanh so sánh)
 */
export async function showCsdProof(csd, suggestion, targetMap, fit) {
  clearCsdProof();
  const seq = requestSeq;
  showToast(`Đang lập thuyết minh "${suggestion.label}"...`, 'info');

  let data;
  try {
    const q = `action=explainCSD&id=${encodeURIComponent(csd.id || '')}&lat=${csd.lat}&lng=${csd.lng}`
      + `&size=${Number(csd.size) || 0}&code=${encodeURIComponent(suggestion.code)}`;
    const res = await fetch(geeApi(q));
    data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || `HTTP ${res.status}`);
  } catch (err) {
    if (seq === requestSeq) showToast(`Không lập được thuyết minh: ${err.message}`, 'error');
    return;
  }
  if (seq !== requestSeq) return;

  const typeColor = BUFFER_COLORS[data.code] || '#2ecc71';
  const c = data.candidate;
  const group = L.layerGroup();

  if (data.tileUrl) group.addLayer(L.tileLayer(data.tileUrl, { opacity: 0.65, zIndex: 50 }));

  const wardInfo = (state.wardLabelsList || []).find(w => w.name === data.ward);
  if (wardInfo && wardInfo.geometry) {
    group.addLayer(L.geoJSON(wardInfo.geometry, {
      interactive: false,
      style: { color: '#ffffff', weight: 2, dashArray: '2,6', fill: false, opacity: 0.9 }
    }));
  }

  data.existing.forEach(e => {
    group.addLayer(L.circle([e.lat, e.lng], {
      radius: e.radius, interactive: false,
      color: typeColor, weight: 1.5, fillColor: typeColor, fillOpacity: 0.16
    }));
  });

  if (data.netGeometry) {
    try {
      group.addLayer(L.geoJSON(data.netGeometry, {
        interactive: false,
        style: { color: NET_COLOR, weight: 2.5, fillColor: NET_COLOR, fillOpacity: 0.12 }
      }));
    } catch (e) {
      // Vùng trống rỗng (đã phủ kín) → không có hình để vẽ
    }
  }

  group.addLayer(L.circle([c.lat, c.lng], {
    radius: c.radius, interactive: false,
    color: CANDIDATE_COLOR, weight: 3, dashArray: '10,7', fill: false
  }));

  data.existing.forEach(e => {
    group.addLayer(pulseMarker(e.lat, e.lng, typeColor, `${escapeHtml(e.name || e.id)} · R ${fmtNum(e.radius)} m`));
  });
  group.addLayer(pulseMarker(c.lat, c.lng, CANDIDATE_COLOR, `Khu đất đề xuất · ${escapeHtml(data.label)}`, true));

  group.addTo(targetMap);

  const padTopLeft = (fit && fit.padTopLeft) || [20, 20];
  const leftClear = Math.max(padTopLeft[0], leftToolbarWidth(targetMap) + 8);

  const panel = L.control({ position: 'topleft' });
  panel.onAdd = () => {
    const div = L.DomUtil.create('div', 'proof-panel');
    div.innerHTML = buildPanelHtml(data, typeColor);
    div.style.marginLeft = `${leftClear}px`;
    div.style.marginTop = `${panelTopOffset(targetMap, leftClear, 370)}px`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    div.querySelector('.proof-close').addEventListener('click', clearCsdProof);
    return div;
  };
  panel.addTo(targetMap);

  active = { group, panel };

  targetMap.closePopup();
  const bounds = L.latLng(c.lat, c.lng).toBounds(c.radius * 2.3);
  data.existing.forEach(e => bounds.extend(L.latLng(e.lat, e.lng)));
  const padBottomRight = (fit && fit.padBottomRight) || [20, 20];
  // Bản đồ đủ rộng thì dồn vùng minh chứng sang phải bảng số liệu để không bị che
  const panelRight = leftClear + panel.getContainer().offsetWidth + 16;
  const roomRight = targetMap.getSize().x - panelRight - padBottomRight[0];
  targetMap.fitBounds(bounds, {
    paddingTopLeft: [roomRight >= 320 ? panelRight : leftClear, padTopLeft[1]],
    paddingBottomRight: padBottomRight,
    maxZoom: 17
  });
}
