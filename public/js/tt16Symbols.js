// Ký hiệu ranh lô theo TT 16/2025/TT-BXD (Phụ lục I, Mục 4 – QHPK 1/2.000, 1/5.000): màu theo mã ACI của bảng + hoa văn vẽ gần đúng.
// Viền: hiện trạng (HT_) mảnh; quy hoạch đợt đầu (QHDD_) đậm liền; quy hoạch dài hạn (QHDH_) đậm nét đứt.

import { ico } from './utils.js';

// color: màu ACI (nền + nét); ink: màu nét hoa văn / viền khi màu ACI khó nhìn trên ảnh vệ tinh; edge: màu viền riêng
export const TT16_STYLES = {
  "1-CV": { label: 'Cây xanh sử dụng công cộng', layer: 'DAT_HTXH_CayxanhCC', aci: 72, color: '#66cc00', pattern: 'dots' },
  "2-BDX": { label: 'Đất bãi đỗ xe', layer: 'DAT_HTKT_Baidoxe', aci: 252, color: '#696969', ink: '#d4d4d4', pattern: 'dashLines' },
  "3-MN": { label: 'Trường THCS, tiểu học, mầm non', layer: 'DAT_HTXH_Truonghoc', aci: 15, color: '#994c4c', ink: '#d98c8c', pattern: 'brickSmall' },
  "THPT": { label: 'Trường THPT', layer: 'DAT_HTXH_TruongTHPT', aci: 24, color: '#992600', ink: '#e0703f', pattern: 'brick' },
  "6-YT": { label: 'Y tế', layer: 'DAT_HTXH_Yte', aci: 220, color: '#ff00bf', pattern: 'grid' },
  "7-VH": { label: 'Văn hóa', layer: 'DAT_HTXH_Vanhoa', aci: 243, color: '#cc667f', ink: '#f29db2', pattern: 'lattice' },
  "TDTT": { label: 'Thể dục thể thao', layer: 'DAT_HTXH_Theducthethao', aci: 94, color: '#009900', ink: '#33cc33', pattern: 'speckle' },
  "8-TM": { label: 'Khu dịch vụ (chợ, TTTM)', layer: 'DAT_Dichvu', aci: 12, color: '#cc0000', ink: '#ff4d4d', pattern: 'weave' },
  "9-CSD": { label: 'Chưa sử dụng', layer: 'DAT_KHAC_Chuasudung', aci: 9, color: '#c0c0c0', ink: '#374151', edge: '#f5f5f5', pattern: 'dashes', fillOpacity: 0.45 }
};
TT16_STYLES["4-TH"] = TT16_STYLES["3-MN"];
TT16_STYLES["5-THCS"] = TT16_STYLES["3-MN"];

// Thứ tự hiển thị trong chú giải
const LEGEND_KEYS = ["1-CV", "2-BDX", "3-MN", "THPT", "6-YT", "7-VH", "TDTT", "8-TM", "9-CSD"];

const FILL_OPACITY = 0.3;
const PATTERN_BG_ALPHA = 0.25;

// Ô mẫu hoa văn: [rộng, cao, hàm vẽ nét]
const PATTERNS = {
  dots: [8, 8, (c) => { dot(c, 2, 2, 1.1); dot(c, 6, 6, 1.1); }],
  dashLines: [10, 5, (c) => line(c, 0, 2.5, 7, 2.5)],
  brickSmall: [12, 8, (c) => { line(c, 0, 0.5, 12, 0.5); line(c, 0, 4.5, 12, 4.5); line(c, 0.5, 0, 0.5, 4.5); line(c, 6.5, 4.5, 6.5, 8); }],
  brick: [20, 12, (c) => { line(c, 0, 0.5, 20, 0.5); line(c, 0, 6.5, 20, 6.5); line(c, 0.5, 0, 0.5, 6.5); line(c, 10.5, 6.5, 10.5, 12); }],
  grid: [8, 8, (c) => { line(c, 0.5, 0, 0.5, 8); line(c, 0, 0.5, 8, 0.5); }],
  lattice: [10, 10, (c) => { line(c, 0, 0, 10, 10); line(c, 10, 0, 0, 10); }],
  speckle: [12, 12, (c) => { [[2, 3], [7, 1.5], [10.5, 6], [4, 9], [8.5, 10.5], [6, 6]].forEach(([x, y]) => dot(c, x, y, 0.9)); }],
  weave: [16, 16, (c) => {
    line(c, 0, 0.5, 16, 0.5); line(c, 0, 8.5, 16, 8.5); line(c, 0.5, 0, 0.5, 16); line(c, 8.5, 0, 8.5, 16);
    [3, 5.5].forEach(d => { line(c, 0.5, d, 8.5, d); line(c, 8.5, 8 + d, 16, 8 + d); line(c, 8 + d, 0.5, 8 + d, 8.5); line(c, d, 8.5, d, 16); });
  }],
  dashes: [12, 8, (c) => { line(c, 1, 5, 4, 2); line(c, 7, 2, 10, 5); }]
};

function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Ô mẫu vẽ ở độ phân giải màn hình (retina) để nét không nhòe
const tileCache = new Map();
function tileFor(key) {
  if (tileCache.has(key)) return tileCache.get(key);
  const s = TT16_STYLES[key];
  const def = s && PATTERNS[s.pattern];
  let tile = null;
  if (def && typeof document !== 'undefined') {
    const [w, h, draw] = def;
    const r = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const cv = document.createElement('canvas');
    cv.width = w * r;
    cv.height = h * r;
    const c = cv.getContext('2d');
    c.scale(r, r);
    c.fillStyle = hexToRgba(s.color, s.fillOpacity || PATTERN_BG_ALPHA);
    c.fillRect(0, 0, w, h);
    c.strokeStyle = c.fillStyle = s.ink || s.color;
    c.lineWidth = 1;
    draw(c);
    tile = { canvas: cv, w, h, r, pattern: null };
  }
  tileCache.set(key, tile);
  return tile;
}

function patternFor(key) {
  const tile = tileFor(key);
  if (!tile) return null;
  if (!tile.pattern) {
    tile.pattern = tile.canvas.getContext('2d').createPattern(tile.canvas, 'repeat');
    if (tile.r > 1 && tile.pattern.setTransform && typeof DOMMatrix !== 'undefined') {
      tile.pattern.setTransform(new DOMMatrix().scale(1 / tile.r));
    }
  }
  return tile.pattern;
}

// Loại hạ tầng + tên layer gốc → khóa ký hiệu (lô Thể dục thể thao dùng ký hiệu riêng trong nhóm Văn hóa, thể thao)
function styleKey(type, layer) {
  if (type === '7-VH' && /THEDUCTHETHAO/i.test(layer || '')) return 'TDTT';
  return TT16_STYLES[type] ? type : '9-CSD';
}

/**
 * Style Leaflet cho ranh lô. layer: tên layer gốc trong file (tiền tố HT_ / QHDD_ / QHDH_ quyết định kiểu viền);
 * scenario: 'QH' khi vẽ trên bản đồ quy hoạch (layer không có tiền tố thì coi là quy hoạch đợt đầu);
 * detailed: phóng to gần lô → tô hoa văn thay cho màu nền; approved = false → viền đỏ nét đứt (chờ duyệt).
 */
export function tt16ParcelStyle(type, layer, { scenario, detailed, approved }) {
  const key = styleKey(type, layer);
  const s = TT16_STYLES[key];
  const stage = String(layer || '').trim().toUpperCase().split(/[_\s]/)[0];
  const plan = stage === 'QHDD' || stage === 'QHDH' || stage === 'QH' || (stage !== 'HT' && scenario === 'QH');
  const pattern = detailed ? patternFor(key) : null;
  return {
    color: approved ? (s.edge || s.ink || s.color) : '#f87171',
    weight: plan ? 2.6 : 1.3,
    opacity: 0.95,
    dashArray: !approved ? '4,4' : stage === 'QHDH' ? '9,5' : null,
    fillColor: pattern || s.color,
    fillOpacity: pattern ? 1 : s.fillOpacity || FILL_OPACITY
  };
}

/** Chú giải ký hiệu lô đất TT16 vào phần tử container */
export function renderTt16Legend(container) {
  if (!container) return;
  const rows = LEGEND_KEYS.map(key => {
    const s = TT16_STYLES[key];
    const tile = tileFor(key);
    const bg = tile ? `background-image:url(${tile.canvas.toDataURL()});background-size:${tile.w}px ${tile.h}px;` : `background:${s.color};`;
    return `<div class="tt16-row" title="${s.layer} · màu ACI ${s.aci}">
      <i class="tt16-swatch" style="${bg}border-color:${s.edge || s.ink || s.color};"></i><span>${s.label}</span><small>${s.aci}</small></div>`;
  }).join('');
  container.innerHTML = `<details class="fold">
    <summary class="tt16-title">${ico('parcel')}Ranh lô đất <small>(ký hiệu TT 16/2025/TT-BXD)</small></summary>
    ${rows}
    <div class="tt16-borders">
      <span><i class="tt16-line"></i>Hiện trạng</span>
      <span><i class="tt16-line thick"></i>QH đợt đầu</span>
      <span><i class="tt16-line thick dashed"></i>QH dài hạn</span>
    </div>
    <div class="tt16-note">Zoom 15–16: màu nền · 17–18: hoa văn</div></details>`;
}
