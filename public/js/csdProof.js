/**
 * Minh chứng trực quan cho đề xuất chuyển đổi khu đất chưa sử dụng (CSD):
 * vùng phục vụ của khu đất, công trình cùng loại lân cận đã trừ, vùng giao còn trống và đúng các pixel dân cư đã đếm.
 * Mọi hình và số liệu lấy từ server (action=explainCSD) — cùng phép tính với % độ phủ trong popup / bảng phường.
 */
import { state, BUFFER_COLORS } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, showToast } from './utils.js';

const CANDIDATE_COLOR = '#facc15';
const NET_COLOR = '#22d3ee';
const MAX_LISTED_EXISTING = 6;

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

function legendRow(swatchStyle, text) {
  return `<div class="proof-legend-row"><span class="proof-swatch" style="${swatchStyle}"></span><span>${text}</span></div>`;
}

function buildPanelHtml(data, typeColor) {
  const px = data.pixels;
  const existingN = data.existing.length;
  const radiusNote = data.candidate.radiusFromSheet ? 'cột BanKinh' : 'mặc định của loại, cột BanKinh trống';
  const listed = data.existing.slice(0, MAX_LISTED_EXISTING)
    .map(e => `<li>${escapeHtml(e.name || e.id)} <span class="proof-muted">(R ${fmtNum(e.radius)} m)</span></li>`).join('');
  const more = existingN > MAX_LISTED_EXISTING ? `<li class="proof-muted">… và ${existingN - MAX_LISTED_EXISTING} công trình khác</li>` : '';

  return `
    <div class="proof-head">
      <b>🔍 MINH CHỨNG: ${escapeHtml(data.label)}</b>
      <button type="button" class="proof-close" aria-label="Tắt minh chứng">✕</button>
    </div>
    <div class="proof-muted">${escapeHtml(data.candidate.name || 'Khu đất chưa sử dụng')} · ${escapeHtml(data.ward)}</div>
    <div class="proof-legend">
      ${legendRow(`border:2px dashed ${CANDIDATE_COLOR};`, `Vùng phục vụ của khu đất C, R = ${fmtNum(data.candidate.radius)} m (${radiusNote})`)}
      ${legendRow(`background:${typeColor}33; border:1.5px solid ${typeColor};`, `${existingN} công trình ${escapeHtml(data.label)} hiện có chạm tới C`)}
      ${legendRow(`background:${NET_COLOR}22; border:2px solid ${NET_COLOR};`, 'Vùng còn trống = C − vùng đã phủ, trong ranh phường')}
      ${legendRow('background:#8a8a8a;', 'Pixel dân cư trong C đã được phục vụ')}
      ${legendRow('background:#ffd400;', 'Pixel dân cư được phục vụ thêm (được đếm)')}
    </div>
    ${existingN ? `<details class="proof-existing"><summary>Công trình cùng loại đã trừ</summary><ul>${listed}${more}</ul></details>` : ''}
    <table class="proof-table">
      <tr><td>Pixel dân cư trong C (thuộc phường)</td><td>${fmtNum(px.buffer)}</td></tr>
      <tr><td>− Đã được ${existingN} công trình cùng loại phủ</td><td>${fmtNum(px.covered)}</td></tr>
      <tr class="proof-strong"><td>= Được phục vụ thêm</td><td>${fmtNum(px.net)}</td></tr>
      <tr><td>÷ Tổng pixel dân cư của phường</td><td>${fmtNum(px.wardTotal)}</td></tr>
      <tr class="proof-result"><td>= Độ phủ tăng thêm</td><td>${fmtNum(data.coverageAddPct)}%</td></tr>
    </table>
    <div class="proof-muted proof-foot">Ô lưới dân cư ${fmtNum(data.pixelScale)} m · quy mô bổ sung ${fmtNum(data.scaleAddPct)}%</div>`;
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
  showToast(`Đang dựng minh chứng "${suggestion.label}"...`, 'info');

  let data;
  try {
    const q = `action=explainCSD&id=${encodeURIComponent(csd.id || '')}&lat=${csd.lat}&lng=${csd.lng}`
      + `&size=${Number(csd.size) || 0}&code=${encodeURIComponent(suggestion.code)}`;
    const res = await fetch(geeApi(q));
    data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || `HTTP ${res.status}`);
  } catch (err) {
    if (seq === requestSeq) showToast(`Không dựng được minh chứng: ${err.message}`, 'error');
    return;
  }
  if (seq !== requestSeq) return;

  const typeColor = BUFFER_COLORS[data.code] || '#2ecc71';
  const c = data.candidate;
  const group = L.layerGroup();

  if (data.tileUrl) group.addLayer(L.tileLayer(data.tileUrl, { opacity: 0.9, zIndex: 50 }));

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
  group.addLayer(pulseMarker(c.lat, c.lng, CANDIDATE_COLOR, `C · ${escapeHtml(data.label)}`, true));

  group.addTo(targetMap);

  const padTopLeft = (fit && fit.padTopLeft) || [20, 20];
  const leftClear = Math.max(padTopLeft[0], leftToolbarWidth(targetMap) + 8);

  const panel = L.control({ position: 'bottomleft' });
  panel.onAdd = () => {
    const div = L.DomUtil.create('div', 'proof-panel');
    div.innerHTML = buildPanelHtml(data, typeColor);
    div.style.marginLeft = `${leftClear}px`;
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
  targetMap.fitBounds(bounds, {
    paddingTopLeft: [leftClear, padTopLeft[1]],
    paddingBottomRight: (fit && fit.padBottomRight) || [20, 20],
    maxZoom: 17
  });
}
