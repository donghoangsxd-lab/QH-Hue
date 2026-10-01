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
const COUNT_MS = 900;
const CSD_MIN_COVERAGE_PCT = 0.5;   // khớp api/gee.js: dưới ngưỡng này xếp hạng theo thiếu quy mô
const SPOTLIGHT_OPACITY = 0.5;   // làm tối bản đồ ngoài phạm vi khu đất
// Lớp tối nằm trên icon công trình (markerPane 600), vòng khu đất và chấm minh chứng nằm trên lớp tối, dưới tooltip (650)
const MASK_PANE = 'proofMask';
const TOP_PANE = 'proofTop';

function ensurePanes(m) {
  if (!m.getPane(MASK_PANE)) {
    const p = m.createPane(MASK_PANE);
    p.style.zIndex = 610;
    p.style.pointerEvents = 'none';
  }
  if (!m.getPane(TOP_PANE)) m.createPane(TOP_PANE).style.zIndex = 620;
}

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
  return L.marker([lat, lng], { icon, keyboard: false, pane: TOP_PANE })
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

function legendItem(swatchStyle, text) {
  return `<span class="proof-legend-item"><i class="proof-swatch" style="${swatchStyle}"></i>${text}</span>`;
}

const pctOf = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

// Số đếm dần từ 0 khi mở bảng (data-count = giá trị, data-dec = số chữ số thập phân)
function countUp(root) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count) || 0;
    const dec = Number(el.dataset.dec) || 0;
    const fmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      el.textContent = fmt.format(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // Thanh biểu đồ chạy từ 0 tới độ dài thật
  requestAnimationFrame(() => root.querySelectorAll('[data-w]').forEach(el => { el.style.width = `${el.dataset.w}%`; }));
}

const bar = (w, cls) => `<span class="proof-bar-seg ${cls}" data-w="${w.toFixed(2)}"></span>`;

// ① Dân cư trong phạm vi phục vụ của khu đất: đã có công trình cùng loại phục vụ / sẽ được phục vụ thêm
function coverageBlockHtml(data, label) {
  const px = data.pixels;
  const coveredPct = pctOf(px.covered, px.buffer), netPct = pctOf(px.net, px.buffer);
  return `<section class="proof-block">
    <div class="proof-block-title"><span>Dân cư trong bán kính ${fmtNum(data.candidate.radius)} m</span><b>${fmtNum(px.buffer)} ô</b></div>
    <div class="proof-bar">${bar(coveredPct, 'seg-covered')}${bar(netPct, 'seg-net')}</div>
    <div class="proof-bar-legend">
      <span><i class="seg-covered"></i>Đã có ${label} phục vụ <b>${fmtNum(Math.round(coveredPct))}%</b></span>
      <span><i class="seg-net"></i>Phục vụ thêm <b>${fmtNum(Math.round(netPct))}%</b></span>
    </div>
  </section>`;
}

// ② Quy mô loại công trình của phường so với chỉ tiêu: hiện có / khu đất bổ sung / còn thiếu
function scaleBlockHtml(data, label) {
  const sc = data.scale;
  if (!sc) return '';
  const addPct = Math.max(0, sc.afterPct - sc.currentPct);
  const used = Math.min(sc.siteArea, sc.deficit);
  return `<section class="proof-block">
    <div class="proof-block-title"><span>Quy mô ${label} của phường</span><b>cần ${fmtNum(sc.required)} m²</b></div>
    <div class="proof-bar proof-bar-scale">${bar(sc.currentPct, 'seg-exist')}${bar(addPct, 'seg-add')}</div>
    <div class="proof-bar-legend">
      <span><i class="seg-exist"></i>Hiện có ${fmtNum(sc.existing)} m² <b>${fmtNum(sc.currentPct)}%</b></span>
      <span><i class="seg-add"></i>Khu đất +${fmtNum(used)} m² <b>+${fmtNum(Math.round(addPct * 10) / 10)}%</b></span>
      <span><i class="seg-gap"></i>Còn thiếu ${fmtNum(Math.max(0, sc.deficit - used))} m²</span>
    </div>
  </section>`;
}

function buildPanelHtml(data, typeColor) {
  const px = data.pixels;
  const pop = data.population;
  const sc = data.scale;
  const existingN = data.existing.length;
  const label = escapeHtml(data.label);
  const cell = fmtNum(data.pixelSize);
  const isScale = isScaleBasis(data);
  const listed = data.existing.slice(0, MAX_LISTED_EXISTING)
    .map(e => `<li>${escapeHtml(e.name || e.id)} <span class="proof-muted">(phục vụ ${fmtNum(e.radius)} m)</span></li>`).join('');
  const more = existingN > MAX_LISTED_EXISTING ? `<li class="proof-muted">… và ${existingN - MAX_LISTED_EXISTING} công trình khác</li>` : '';
  const scaleKpi = sc
    ? `<div class="proof-kpi k-green"><b><span data-count="${sc.currentPct}" data-dec="1">0</span>→<span data-count="${sc.afterPct}" data-dec="1">0</span>%</b><span>quy mô theo chỉ tiêu</span></div>`
    : `<div class="proof-kpi k-green"><b>+<span data-count="${data.scaleAddPct}" data-dec="1">0</span>%</b><span>nhu cầu diện tích</span></div>`;

  return `
    <div class="proof-head">
      <div class="proof-title">
        <span class="proof-kicker">${ico('book')}Thuyết minh phương án</span>
        <b><i class="proof-type-dot" style="background:${typeColor}"></i>${label}</b>
      </div>
      <button type="button" class="proof-close" aria-label="Đóng thuyết minh">${ico('close')}</button>
    </div>
    <div class="proof-site">${ico('pin')}${escapeHtml(data.candidate.name || 'Khu đất chưa sử dụng')} · ${escapeHtml(data.ward)}</div>
    <div class="proof-verdict ${isScale ? 'v-scale' : 'v-coverage'}">
      <span class="proof-badge">${isScale ? 'BÙ THIẾU QUY MÔ' : 'MỞ RỘNG ĐỘ PHỦ'}</span>
      ${summaryHtml(data, label)}
    </div>
    <div class="proof-kpis">
      <div class="proof-kpi k-yellow${pop.added ? '' : ' is-zero'}"><b>+<span data-count="${pop.added}">0</span></b><span>người được phục vụ thêm</span></div>
      <div class="proof-kpi k-cyan${data.coverageAddPct ? '' : ' is-zero'}"><b>+<span data-count="${data.coverageAddPct}" data-dec="1">0</span>%</b><span>độ phủ của phường</span></div>
      ${scaleKpi}
    </div>
    ${isScale ? scaleBlockHtml(data, label) + coverageBlockHtml(data, label) : coverageBlockHtml(data, label) + scaleBlockHtml(data, label)}
    <div class="proof-legend">
      ${legendItem(`border:2px dashed ${CANDIDATE_COLOR};`, 'Phạm vi khu đất')}
      ${legendItem(`background:${typeColor}22; border:1.5px dashed ${typeColor};`, existingN ? `${existingN} ${label} hiện có` : `Chưa có ${label} gần đây`)}
      ${legendItem(`background:${NET_COLOR}22; border:2px solid ${NET_COLOR};`, 'Vùng chưa được phục vụ')}
      ${legendItem('background:#22c55e;', 'Dân đã được phục vụ')}
      ${legendItem('background:#ffd400;', 'Dân sẽ được phục vụ thêm')}
    </div>
    ${existingN ? `<details class="proof-more"><summary>${label} hiện có ở gần (${existingN})</summary><ul>${listed}${more}</ul></details>` : ''}
    <details class="proof-more">
      <summary>Cách tính chi tiết</summary>
      <div class="proof-muted proof-note">Bản đồ dân cư chia thành ô vuông ${cell} × ${cell} m; chỉ đếm ô có người ở.</div>
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
      ${scaleRowsHtml(data)}
      </table>
    </details>`;
}

// Độ phủ không tăng (khu đất đã nằm trong phạm vi công trình cùng loại): lý do chọn là phường còn thiếu quy mô theo chỉ tiêu
const isScaleBasis = (data) => (data.basis ? data.basis === 'scale' : data.coverageAddPct < CSD_MIN_COVERAGE_PCT);

function summaryHtml(data, label) {
  const sc = data.scale;
  if (isScaleBasis(data)) {
    const n = data.existing.length;
    const head = `Khu đất đã nằm trong phạm vi của ${n ? `${n} ${label} hiện có` : `${label} hiện có`} nên độ phủ không tăng.`;
    if (!sc) return `<p>${head} Diện tích khu đất đáp ứng thêm <b class="c-green">${fmtNum(data.scaleAddPct)}%</b> nhu cầu ${label} của phường theo chỉ tiêu.</p>`;
    return `<p>${head} Phường mới đạt <b class="c-red">${fmtNum(sc.currentPct)}%</b> chỉ tiêu (thiếu ${fmtNum(sc.deficit)} m²) —
      bổ sung khu đất giúp <b>giảm tải</b> cho các cơ sở hiện có.</p>`;
  }
  return `<p>Xây ${label} tại đây phục vụ thêm khoảng <b>${fmtNum(data.population.added)} người</b> hiện chưa có ${label} trong bán kính phục vụ.</p>`;
}

function scaleRowsHtml(data) {
  const sc = data.scale;
  if (!sc) return `<tr><td colspan="2" class="proof-muted">Diện tích khu đất đáp ứng ${fmtNum(data.scaleAddPct)}% nhu cầu của phường theo chỉ tiêu.</td></tr>`;
  const used = Math.min(sc.siteArea, sc.deficit);
  return `
      <tr class="proof-group"><td colspan="2">③ Bù thiếu quy mô theo chỉ tiêu</td></tr>
      <tr><td>Nhu cầu của phường theo chỉ tiêu</td><td>${fmtNum(sc.required)} m²</td></tr>
      <tr><td>− Hiện có (đạt ${fmtNum(sc.currentPct)}%)</td><td>${fmtNum(sc.existing)} m²</td></tr>
      <tr class="proof-strong"><td>= Còn thiếu</td><td>${fmtNum(sc.deficit)} m²</td></tr>
      <tr><td>Khu đất bù vào${sc.siteArea > sc.deficit ? ' (chỉ tính phần thiếu)' : ''}</td><td>${fmtNum(used)} m²</td></tr>
      <tr class="proof-result"><td>= Quy mô sau bổ sung</td><td>${fmtNum(sc.currentPct)}% → ${fmtNum(sc.afterPct)}%</td></tr>`;
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

  const typeColor = BUFFER_COLORS[data.code] || BUFFER_COLORS['9-CSD'];
  const c = data.candidate;
  const group = L.layerGroup();
  ensurePanes(targetMap);

  if (data.tileUrl) group.addLayer(L.tileLayer(data.tileUrl, { maxZoom: 19, opacity: 0.8, zIndex: 50 }));

  // Làm tối bản đồ ngoài phạm vi khu đất (cả icon) để mắt tập trung vào vùng phân tích
  const hole = turf.circle([c.lng, c.lat], c.radius / 1000, { steps: 128 }).geometry.coordinates[0].map(([x, y]) => [y, x]);
  group.addLayer(L.polygon([[[-89, -179.9], [89, -179.9], [89, 179.9], [-89, 179.9]], hole], {
    pane: MASK_PANE, className: 'proof-mask', stroke: false,
    fillColor: '#020617', fillOpacity: SPOTLIGHT_OPACITY, interactive: false
  }));

  const wardInfo = (state.wardLabelsList || []).find(w => w.name === data.ward);
  if (wardInfo && wardInfo.geometry) {
    group.addLayer(L.geoJSON(wardInfo.geometry, {
      interactive: false,
      style: { color: '#ffffff', weight: 2, dashArray: '2,6', fill: false, opacity: 0.9 }
    }));
  }

  // Phạm vi công trình cùng loại hiện có: viền đứt, nền rất nhạt để nhiều vòng chồng nhau không thành mảng màu
  data.existing.forEach(e => {
    group.addLayer(L.circle([e.lat, e.lng], {
      radius: e.radius, interactive: false,
      color: typeColor, weight: 1.2, opacity: 0.8, dashArray: '5,5', fillColor: typeColor, fillOpacity: 0.05
    }));
  });

  if (data.netGeometry) {
    try {
      group.addLayer(L.geoJSON(data.netGeometry, {
        interactive: false,
        style: { color: NET_COLOR, weight: 2, fillColor: NET_COLOR, fillOpacity: 0.08 }
      }));
    } catch (e) {
      // Vùng trống rỗng (đã phủ kín) → không có hình để vẽ
    }
  }

  group.addLayer(L.circle([c.lat, c.lng], {
    radius: c.radius, interactive: false, pane: TOP_PANE, className: 'proof-ring',
    color: CANDIDATE_COLOR, weight: 3, dashArray: '12,8', fill: false
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
    div.style.marginTop = `${panelTopOffset(targetMap, leftClear, 340)}px`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    div.querySelector('.proof-close').addEventListener('click', clearCsdProof);
    return div;
  };
  panel.addTo(targetMap);
  countUp(panel.getContainer());

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
