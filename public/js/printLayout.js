// Chụp bản đồ (PNG) và in khung bản đồ khổ A3 ngang (PDF): khung + lưới tọa độ VN-2000, hướng Bắc, tỷ lệ, chú giải theo lớp đang bật.
// html2canvas không hiểu clip-path → khi so sánh chụp riêng 2 bản đồ rồi ghép theo vị trí thanh trượt.
import { map } from './mapEngine.js';
import { planMap, isCompareOn } from './planMap.js';
import { state } from './state.js';
import { wgs84ToVn2000 } from './cadImport.js';
import { satPrintLegend } from './satLayers.js';
import { escapeHtml, distanceMeters, loadHtml2Canvas, loadHtml2Pdf, showToast, inlineSpriteIcons } from './utils.js';

const CITY_NAME = 'Thành phố Huế';
const SKIP_CLASSES = ['leaflet-control-container', 'leaflet-popup-pane', 'leaflet-tooltip-pane'];

// Trang A3 ngang ở 96 dpi (420 × 297 mm); cao 1122 px để html2pdf không tràn sang trang 2
const PAGE_W = 1587, PAGE_H = 1122;
const M = 24;          // lề tới đường viền ngoài
const SIDE_W = 372;    // cột thông tin bên phải
const GUT_X = 44, GUT_Y = 36; // khoảng ghi tọa độ quanh khung bản đồ
const FRAME = { x: M + GUT_X, y: M + GUT_Y, w: PAGE_W - M - SIDE_W - (M + GUT_X) - GUT_X, h: PAGE_H - 2 * M - 2 * GUT_Y };
const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];

const INFRA_LEGEND = [
  ['chk_c1', 'Park.png'], ['chk_c2', 'Parking.png'], ['chk_c3', 'Mamnon.png'], ['chk_c4', 'Tieuhoc.png'],
  ['chk_c5', 'THCS.png'], ['chk_c10', 'THPT.png'], ['chk_c6', 'Yte.png'], ['chk_c7', 'Vanhoa.png'],
  ['chk_c8', 'Cho.png'], ['chk_c9', 'Unused.png'], ['chk_c11', 'Bus.svg'], ['chk_c12', 'Pccc.svg'], ['chk_c13', 'Nghiatrang.svg']
];

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const checked = (id) => !!$(id)?.checked;
const spaced = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dotted = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
let busy = false;

// ================== CHỤP BẢN ĐỒ ==================
function snap(el, scale, size) {
  return window.html2canvas(el, {
    useCORS: true,
    logging: false,
    backgroundColor: '#0f172a',
    scale,
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(window.innerWidth, size.x + 20),
    windowHeight: Math.max(window.innerHeight, size.y + 20),
    onclone: inlineSpriteIcons,
    ignoreElements: (n) => SKIP_CLASSES.some(c => n.classList?.contains(c))
  });
}

/** Ảnh bản đồ đang xem (ghép hiện trạng | quy hoạch khi so sánh); splitX = vị trí thanh trượt (px CSS) hoặc null */
async function captureMapCanvas(scale) {
  await loadHtml2Canvas();
  const size = map.getSize();
  const canvas = await snap($('map'), scale, size);
  if (!isCompareOn() || !planMap) return { canvas, splitX: null };
  const right = await snap($('mapPlan'), scale, size);
  const divider = $('swipeDivider');
  const splitX = divider ? divider.offsetLeft : size.x / 2;
  const sx = Math.round(splitX * scale);
  canvas.getContext('2d').drawImage(right, sx, 0, right.width - sx, right.height, sx, 0, right.width - sx, right.height);
  return { canvas, splitX };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Chụp khung bản đồ (kể cả chế độ so sánh) thành ảnh PNG; lỗi thì quay về hộp thoại in của trình duyệt
export async function captureMapScreenshot() {
  if (!map || busy) return;
  busy = true;
  try {
    showToast('⏳ Đang chụp ảnh bản đồ...');
    const { canvas } = await captureMapCanvas(window.devicePixelRatio || 1);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Không tạo được ảnh');
    download(blob, `Ban-do-ha-tang-Hue-${new Date().toISOString().slice(0, 10)}.png`);
    showToast('✓ Đã lưu ảnh bản đồ', 'success');
  } catch (err) {
    console.warn('Chụp ảnh bản đồ lỗi, chuyển sang in:', err);
    window.print();
  } finally {
    busy = false;
  }
}

// ================== DỰNG BẢN ĐỒ THEO TỶ LỆ KHUNG A3 ==================
/** Chờ các lớp ảnh nền / heatmap tải xong ô (tối đa timeout) */
async function waitTiles(maps, timeout = 12000) {
  await sleep(200);
  const loading = [];
  maps.forEach(m => m.eachLayer(l => { if (l instanceof L.GridLayer && l.isLoading()) loading.push(l); }));
  await Promise.race([Promise.all(loading.map(l => new Promise(r => l.once('load', r)))), sleep(timeout)]);
  await sleep(500);
}

/** Tạm phóng khung bản đồ thành W × H px (giữ tâm, cấp zoom) để vùng in đúng tỷ lệ khung A3; trả về hàm khôi phục */
async function stageMap(W, H) {
  const area = $('mapArea');
  const center = map.getCenter(), zoom = map.getZoom();
  const maps = [map, isCompareOn() ? planMap : null].filter(Boolean);
  const apply = () => maps.forEach(m => { m.invalidateSize({ pan: false }); m.setView(center, zoom, { animate: false }); });
  area.style.setProperty('--print-w', `${W}px`);
  area.style.setProperty('--print-h', `${H}px`);
  area.classList.add('print-staging');
  apply();
  await waitTiles(maps);
  return () => {
    area.classList.remove('print-staging');
    area.style.removeProperty('--print-w');
    area.style.removeProperty('--print-h');
    apply();
  };
}

// ================== LƯỚI TỌA ĐỘ VN-2000 ==================
/** Giao điểm của đường lưới (E hoặc N chia hết cho step) với 1 cạnh khung: [{ value, t }] với t = vị trí px dọc cạnh */
function edgeCrossings(pointAt, len, axis, step) {
  const out = [];
  let prev = null;
  for (let t = 0; t <= len; t += 2) {
    const ll = map.containerPointToLatLng(pointAt(t));
    const v = wgs84ToVn2000(ll.lat, ll.lng)[axis];
    if (prev) {
      const a = Math.floor(prev.v / step), b = Math.floor(v / step);
      if (a !== b) {
        const value = Math.max(a, b) * step;
        out.push({ value, t: prev.t + (t - prev.t) * (value - prev.v) / (v - prev.v) });
      }
    }
    prev = { t, v };
  }
  return out;
}

function niceStep(span, target, steps) {
  return steps.find(s => span / s <= target) || steps[steps.length - 1];
}

function computeGrid(size) {
  const e = (x, y) => { const ll = map.containerPointToLatLng([x, y]); return wgs84ToVn2000(ll.lat, ll.lng); };
  const spanE = Math.abs(e(size.x, size.y / 2)[0] - e(0, size.y / 2)[0]);
  const spanN = Math.abs(e(size.x / 2, 0)[1] - e(size.x / 2, size.y)[1]);
  const step = niceStep(Math.max(spanE, spanN), 7, NICE_STEPS);
  return {
    step,
    top: edgeCrossings(t => [t, 0], size.x, 0, step),
    bottom: edgeCrossings(t => [t, size.y], size.x, 0, step),
    left: edgeCrossings(t => [0, t], size.y, 1, step),
    right: edgeCrossings(t => [size.x, t], size.y, 1, step)
  };
}

// ================== CHÚ GIẢI ==================
function legendRows() {
  const rows = [];
  const infra = INFRA_LEGEND.filter(([id]) => checked(id));
  infra.forEach(([id, file]) => {
    const text = ($(id)?.labels?.[0]?.textContent || '').trim().replace(/^\d+\.\s*/, '');
    rows.push(`<div class="pa3-lg-row"><img class="pa3-lg-icon" src="./icons/${file}" alt="">${escapeHtml(text)}</div>`);
  });
  if (infra.length) {
    rows.push('<div class="pa3-lg-row"><img class="pa3-lg-icon" src="./icons/Park2.png" alt="">Công trình chờ duyệt (đề xuất)</div>');
  }
  if (document.querySelector('.btn-dot-buffer[aria-pressed="true"]')) {
    rows.push('<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-buffer"></i>Vùng phủ / bán kính phục vụ</div>');
  }
  if (state.selectedWard && state.selectedWard !== CITY_NAME) {
    rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-ward"></i>Phạm vi ${escapeHtml(state.selectedWard)}</div>`);
  }
  if (checked('chk_bound')) rows.push('<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-bound"></i>Ranh giới phường, xã</div>');
  if (checked('chk_roads')) {
    [['#fb923c', 3, 'Đường trục chính'], ['#60a5fa', 2, 'Đường khu vực'], ['#cbd5e1', 2, 'Đường nội bộ, kiệt']].forEach(([c, w, t]) => {
      rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-line" style="--c:${c}; --w:${w}px"></i>${t}</div>`);
    });
    rows.push('<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-line pa3-lg-dash" style="--c:#4ade80; --w:2px"></i>Đường xe đạp</div>');
  }
  const ramps = [];
  if (checked('chk_heat')) {
    ramps.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">Độ phủ hạ tầng (số nhóm tiếp cận được)</div>
      <div class="pa3-lg-bar pa3-lg-heat"></div><div class="pa3-lg-ticks">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<span>${n}</span>`).join('')}</div></div>`);
  }
  if (checked('chk_pop')) {
    ramps.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">Phân bổ dân cư (người / ô 30 m)</div>
      <div class="pa3-lg-bar pa3-lg-pop"></div><div class="pa3-lg-ticks">${[0, 1, 2, 3, 4, '≥5'].map(n => `<span>${n}</span>`).join('')}</div></div>`);
  }
  return rows.join('') + ramps.join('') + satPrintLegend();
}

// ================== DỰNG TRANG A3 ==================
const NORTH_SVG = '<svg class="pa3-north-svg" viewBox="0 0 40 60" aria-hidden="true">'
  + '<polygon points="20,4 32,48 20,40" fill="#111"/><polygon points="20,4 8,48 20,40" fill="#fff" stroke="#111" stroke-width="1.5"/>'
  + '<text x="20" y="59" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#111">B</text></svg>';

function scaleInfo(size, frameW) {
  const c = map.getSize().divideBy(2);
  const a = map.containerPointToLatLng([c.x - 50, c.y]), b = map.containerPointToLatLng([c.x + 50, c.y]);
  const mPerMapPx = distanceMeters(a.lat, a.lng, b.lat, b.lng) / 100;
  const mPerFramePx = mPerMapPx * size.x / frameW;
  const ratio = mPerFramePx / (25.4 / 96 / 1000);
  const mag = Math.pow(10, Math.floor(Math.log10(ratio)) - 1);
  const lenM = NICE_STEPS.filter(s => s / mPerFramePx <= 260).pop() || NICE_STEPS[0];
  return { ratio: Math.round(ratio / mag) * mag, lenM, px: lenM / mPerFramePx };
}

function scaleBarHtml({ lenM, px }) {
  const fmt = (m) => (lenM >= 1000 ? `${(m / 1000).toLocaleString('vi-VN')}` : `${Math.round(m)}`);
  const unit = lenM >= 1000 ? 'km' : 'm';
  const seg = [0, 1, 2, 3].map(i => `<i class="${i % 2 ? 'w' : 'b'}"></i>`).join('');
  return `<div class="pa3-scalebar" style="width:${px.toFixed(1)}px">${seg}</div>
    <div class="pa3-scalebar-lbl" style="width:${px.toFixed(1)}px"><span>0</span><span>${fmt(lenM / 2)}</span><span>${fmt(lenM)} ${unit}</span></div>`;
}

function gridHtml(grid, fx, fy) {
  const lines = [], labels = [];
  const F = FRAME;
  const pair = (a, b) => {
    const m = new Map(b.map(p => [p.value, p.t]));
    return a.filter(p => m.has(p.value)).map(p => [p, m.get(p.value)]);
  };
  pair(grid.top, grid.bottom).forEach(([p, tb]) => {
    lines.push(`<line x1="${(F.x + p.t * fx).toFixed(1)}" y1="${F.y}" x2="${(F.x + tb * fx).toFixed(1)}" y2="${F.y + F.h}"/>`);
  });
  pair(grid.left, grid.right).forEach(([p, tr]) => {
    lines.push(`<line x1="${F.x}" y1="${(F.y + p.t * fy).toFixed(1)}" x2="${F.x + F.w}" y2="${(F.y + tr * fy).toFixed(1)}"/>`);
  });
  const ticks = [];
  grid.top.forEach(p => { const x = F.x + p.t * fx; ticks.push(`<line x1="${x}" y1="${F.y - 7}" x2="${x}" y2="${F.y}"/>`); labels.push(`<div class="pa3-gl pa3-gl-top" style="left:${x}px; top:${F.y - 9}px">${spaced(p.value)}</div>`); });
  grid.bottom.forEach(p => { const x = F.x + p.t * fx; ticks.push(`<line x1="${x}" y1="${F.y + F.h}" x2="${x}" y2="${F.y + F.h + 7}"/>`); labels.push(`<div class="pa3-gl pa3-gl-bottom" style="left:${x}px; top:${F.y + F.h + 9}px">${spaced(p.value)}</div>`); });
  grid.left.forEach(p => { const y = F.y + p.t * fy; ticks.push(`<line x1="${F.x - 7}" y1="${y}" x2="${F.x}" y2="${y}"/>`); labels.push(`<div class="pa3-gl pa3-gl-side" style="left:${F.x - 17}px; top:${y}px">${spaced(p.value)}</div>`); });
  grid.right.forEach(p => { const y = F.y + p.t * fy; ticks.push(`<line x1="${F.x + F.w}" y1="${y}" x2="${F.x + F.w + 7}" y2="${y}"/>`); labels.push(`<div class="pa3-gl pa3-gl-side" style="left:${F.x + F.w + 17}px; top:${y}px">${spaced(p.value)}</div>`); });
  return `<svg class="pa3-svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
      <g class="pa3-gridlines">${lines.join('')}</g>
      <g class="pa3-ticks">${ticks.join('')}</g>
      <rect class="pa3-frame-border" x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}"/>
      <rect class="pa3-outer" x="${M}" y="${M}" width="${PAGE_W - 2 * M}" height="${PAGE_H - 2 * M}"/>
      <rect class="pa3-outer-in" x="${M + 4}" y="${M + 4}" width="${PAGE_W - 2 * M - 8}" height="${PAGE_H - 2 * M - 8}"/>
      <line class="pa3-side-sep" x1="${PAGE_W - M - SIDE_W}" y1="${M + 4}" x2="${PAGE_W - M - SIDE_W}" y2="${PAGE_H - M - 4}"/>
    </svg>${labels.join('')}`;
}

function pageHtml({ img, title, place, grid, size, splitX, scale }) {
  const F = FRAME;
  const fx = F.w / size.x, fy = F.h / size.y;
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const date = `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const sideX = PAGE_W - M - SIDE_W;
  const compare = splitX != null
    ? `<div class="pa3-split" style="left:${F.x + splitX * fx}px; top:${F.y}px; height:${F.h}px"></div>
       <div class="pa3-split-lbl" style="left:${F.x + 10}px; top:${F.y + 10}px">HIỆN TRẠNG</div>
       <div class="pa3-split-lbl" style="left:${F.x + F.w - 10}px; top:${F.y + 10}px; transform:translateX(-100%)">QUY HOẠCH</div>`
    : '';
  return `<div class="pa3-page" style="width:${PAGE_W}px; height:${PAGE_H}px">
    <img class="pa3-map" src="${img}" alt="" style="left:${F.x}px; top:${F.y}px; width:${F.w}px; height:${F.h}px">
    ${compare}
    ${gridHtml(grid, fx, fy)}
    <div class="pa3-side" style="left:${sideX + 16}px; top:${M + 16}px; width:${SIDE_W - 32}px; height:${PAGE_H - 2 * M - 32}px">
      <div class="pa3-org"><div>UBND THÀNH PHỐ HUẾ</div><b>SỞ XÂY DỰNG</b></div>
      <div class="pa3-title">${escapeHtml(title)}</div>
      <div class="pa3-place">${escapeHtml(place)}</div>
      <div class="pa3-scale-block">
        <div class="pa3-north">${NORTH_SVG}</div>
        <div class="pa3-scale">
          <div class="pa3-ratio">Tỷ lệ ≈ 1:${dotted(scale.ratio)}</div>
          ${scaleBarHtml(scale)}
          <div class="pa3-ratio-note">(khi in đúng khổ A3)</div>
        </div>
      </div>
      <div class="pa3-legend">
        <div class="pa3-sec">CHÚ GIẢI</div>
        <div class="pa3-lg">${legendRows() || '<div class="pa3-lg-row">Không bật lớp chuyên đề nào</div>'}</div>
      </div>
      <div class="pa3-info">
        <div><b>Hệ tọa độ:</b> VN-2000, KTT 107°00', múi 3° — lưới ${dotted(grid.step)} m</div>
        <div><b>Ảnh nền:</b> Esri World Imagery</div>
        <div><b>Dữ liệu:</b> Hạ tầng đô thị TP. Huế (Sở Xây dựng), mạng lưới đường OpenStreetMap</div>
        <div><b>Ngày xuất:</b> ${date}</div>
        <div class="pa3-note">Bản đồ phục vụ tham khảo, không thay thế hồ sơ quy hoạch được phê duyệt.</div>
      </div>
    </div>
  </div>`;
}

/** In khung bản đồ khổ A3 ngang ra PDF (lưới VN-2000, hướng Bắc, tỷ lệ, chú giải theo lớp đang bật) */
export async function exportMapA3() {
  if (!map || busy) return;
  const city = !state.selectedWard || state.selectedWard === CITY_NAME;
  const place = city ? 'THÀNH PHỐ HUẾ' : state.selectedWard.toUpperCase();
  const defTitle = isCompareOn() ? 'BẢN ĐỒ SO SÁNH HIỆN TRẠNG – QUY HOẠCH HẠ TẦNG XÃ HỘI' : 'BẢN ĐỒ HIỆN TRẠNG HẠ TẦNG XÃ HỘI';
  const input = window.prompt('Tiêu đề bản đồ in khổ A3:', defTitle);
  if (input === null) return;
  const title = input.trim() || defTitle;
  busy = true;
  let restore = null, holder = null;
  try {
    showToast('⏳ Đang dựng khung in A3 (tải ảnh nền theo khung)...');
    await Promise.all([loadHtml2Canvas(), loadHtml2Pdf()]);
    const view = map.getSize();
    const k = Math.min(2.2, Math.max(1, view.x / FRAME.w, view.y / FRAME.h));
    const W = Math.round(FRAME.w * k), H = Math.round(FRAME.h * k);
    restore = await stageMap(W, H);
    const size = map.getSize();
    const grid = computeGrid(size);
    const scale = scaleInfo(size, FRAME.w);
    const { canvas, splitX } = await captureMapCanvas(Math.min(2, Math.max(1, (FRAME.w * 2) / size.x)));
    restore();
    restore = null;
    const img = canvas.toDataURL('image/jpeg', 0.92);

    holder = document.createElement('div');
    holder.className = 'pa3-holder';
    holder.innerHTML = pageHtml({ img, title, place, grid, size, splitX, scale });
    document.body.appendChild(holder);
    await Promise.all([...holder.querySelectorAll('img')].map(im => (im.complete ? null : new Promise(r => { im.onload = im.onerror = r; }))));
    const stamp = new Date().toISOString().slice(0, 10);
    await window.html2pdf().from(holder.firstElementChild).set({
      margin: 0,
      filename: `Ban-do-A3-${(city ? 'TP-Hue' : state.selectedWard).replace(/\s+/g, '-')}-${stamp}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: PAGE_W, windowHeight: PAGE_H, onclone: inlineSpriteIcons },
      jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
      pagebreak: { mode: [] }
    }).save();
    showToast('✓ Đã xuất bản đồ khổ A3 (PDF)', 'success');
  } catch (err) {
    console.error('In bản đồ A3 lỗi:', err);
    showToast(`❌ Không xuất được bản đồ A3: ${err.message || err}`, 'error');
  } finally {
    if (restore) restore();
    holder?.remove();
    busy = false;
  }
}
