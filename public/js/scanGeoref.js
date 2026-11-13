// Ghép ảnh tờ bản vẽ scan lên bản đồ:
//  - Kéo / xoay / stretch (mặc định): dời, xoay, co giãn độc lập theo cạnh; đồ án SDD căn khít ranh (tightFit).
//  - Chấm điểm: cặp điểm ảnh ↔ bản đồ, affine 6 tham số.
// Trước khi ghép đồ án: autoCropWhiteMargins cắt lề trắng rồi nén.
// Định vị lưu 3 góc ảnh (tl, tr, bl); ScanOverlay dùng CSS matrix.
import { attachBasemap, detachBasemap, MAP_MAX_ZOOM } from './basemap.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';

export const SCAN_MAX_BYTES = 2 * 1024 * 1024 - 8192;
export const SDD_SCAN_MAX_BYTES = 5 * 1024 * 1024 - 8192;
const SCAN_INPUT_MAX_BYTES = 40 * 1024 * 1024;
const SCAN_MAX_SIDE = 6000;
const SCAN_TYPES = /^image\/(webp|png|jpeg)$/;
const SNAP_PX = 14;
const WARN_M = 3;
const RANH = '#2f80ff';
const FIT_SHEET_PER_RANH = 5;
const FIT_ANCHOR = [0.22, 0.36];
const NUDGE_PX = 1;
const NUDGE_FAST_PX = 10;
const MERCATOR_WORLD_M = 40075016.686;
const WHITE_MIN = 245;
const WHITE_ROW_RATIO = 0.96;

// ============================ LỚP ẢNH XOAY ============================

/** Ảnh đặt theo 3 góc [lat, lng]: tl (pixel 0,0), tr (w,0), bl (0,h). Opacity 0–1. */
export const ScanOverlay = (typeof L === 'undefined') ? null : L.Layer.extend({
  options: { opacity: 0.7, pane: 'overlayPane' },

  initialize(url, corners, options) {
    this._url = url;
    this._corners = corners;
    L.setOptions(this, options);
  },

  onAdd(map) {
    if (!this._img) {
      const img = this._img = L.DomUtil.create('img', 'leaflet-image-layer scan-overlay');
      img.alt = '';
      img.draggable = false;
      img.style.visibility = 'hidden';
      if (map._zoomAnimated) L.DomUtil.addClass(img, 'leaflet-zoom-animated');
      img.onload = () => { img.style.visibility = ''; this._reset(); };
      img.src = this._url;
    }
    this.getPane().appendChild(this._img);
    this._img.style.opacity = this.options.opacity;
    this._reset();
  },

  onRemove() {
    L.DomUtil.remove(this._img);
  },

  getEvents() {
    const ev = { zoom: this._reset, viewreset: this._reset };
    if (this._zoomAnimated) ev.zoomanim = this._animateZoom;
    return ev;
  },

  setOpacity(o) {
    this.options.opacity = o;
    if (this._img) this._img.style.opacity = o;
    return this;
  },

  setCorners(corners) {
    this._corners = corners;
    this._reset();
    return this;
  },

  _reset() {
    if (!this._map || !this._img) return;
    this._apply(this._corners.map(ll => this._map.latLngToLayerPoint(L.latLng(ll[0], ll[1]))));
  },

  _animateZoom(e) {
    this._apply(this._corners.map(ll => this._map._latLngToNewLayerPoint(L.latLng(ll[0], ll[1]), e.zoom, e.center)));
  },

  _apply([tl, tr, bl]) {
    const img = this._img;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
  }
});

/** Thông số định vị đã lưu → 3 góc cho ScanOverlay */
export const cornersOf = (g) => [g.tl, g.tr, g.bl];

// ============================ PHÉP BIẾN ĐỔI ============================

const project = (ll) => L.CRS.EPSG3857.project(L.latLng(ll[0], ll[1]));
const unproject = (x, y) => {
  const p = L.CRS.EPSG3857.unproject(L.point(x, y));
  return [p.lat, p.lng];
};

/**
 * gcps: [{ px: [x, y], ll: [lat, lng] }] (≥ 3 cặp không thẳng hàng).
 * Trả { toMap(x, y), corners(w, h), residuals (m), rms (m, cần ≥ 4 cặp), mpp (m/pixel), mirrored } hoặc null.
 */
export function solveAffine(gcps) {
  const pts = (gcps || []).filter(g => g && g.px && g.ll).map(g => ({ x: g.px[0], y: g.px[1], m: project(g.ll), lat: g.ll[0] }));
  const n = pts.length;
  if (n < 3) return null;
  const mean = (f) => pts.reduce((s, p) => s + f(p), 0) / n;
  const mx = mean(p => p.x), my = mean(p => p.y), MX = mean(p => p.m.x), MY = mean(p => p.m.y);
  let sxx = 0, sxy = 0, syy = 0, sxX = 0, syX = 0, sxY = 0, syY = 0;
  pts.forEach(p => {
    const x = p.x - mx, y = p.y - my, X = p.m.x - MX, Y = p.m.y - MY;
    sxx += x * x; sxy += x * y; syy += y * y;
    sxX += x * X; syX += y * X; sxY += x * Y; syY += y * Y;
  });
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-6 * sxx * syy) || !(sxx > 0) || !(syy > 0)) return null;
  const a = (sxX * syy - syX * sxy) / det, b = (syX * sxx - sxX * sxy) / det;
  const d = (sxY * syy - syY * sxy) / det, e = (syY * sxx - sxY * sxy) / det;
  const fwd = (x, y) => [MX + a * (x - mx) + b * (y - my), MY + d * (x - mx) + e * (y - my)];
  const k = Math.cos(mean(p => p.lat) * Math.PI / 180);
  const residuals = pts.map(p => {
    const [X, Y] = fwd(p.x, p.y);
    return Math.hypot(X - p.m.x, Y - p.m.y) * k;
  });
  const toMap = (x, y) => unproject(...fwd(x, y));
  return {
    toMap,
    corners: (w, h) => ({ tl: toMap(0, 0), tr: toMap(w, 0), bl: toMap(0, h) }),
    residuals,
    rms: n > 3 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n) : 0,
    mpp: Math.sqrt(Math.abs(a * e - b * d)) * k,
    mirrored: a * e - b * d > 0
  };
}

/** t = { cx, cy, sx, sy, a } — sx/sy mét Mercator / pixel; a rad ngược chiều kim đồng hồ */
function normT(t) {
  if (!t) return null;
  const sx = Number(t.sx != null ? t.sx : t.s);
  const sy = Number(t.sy != null ? t.sy : t.s);
  if (!(sx > 0) || !(sy > 0)) return null;
  return { cx: t.cx, cy: t.cy, sx, sy, s: (sx + sy) / 2, a: t.a || 0 };
}

function similarityAt(t, w, h, x, y) {
  const dx = (x - w / 2) * t.sx, dy = (y - h / 2) * t.sy;
  const c = Math.cos(t.a), s = Math.sin(t.a);
  return unproject(t.cx + dx * c + dy * s, t.cy + dx * s - dy * c);
}

function similarityCorners(t, w, h) {
  const at = (x, y) => similarityAt(t, w, h, x, y);
  return {
    tl: at(0, 0), tr: at(w, 0), br: at(w, h), bl: at(0, h),
    rot: at(w / 2, -h * 0.08),
    eL: at(0, h / 2), eR: at(w, h / 2), eT: at(w / 2, 0), eB: at(w / 2, h)
  };
}

/** 3 góc đã lưu → phép gần nhất (có stretch nếu cạnh đứng ≠ cạnh ngang) */
function similarityFrom(g, w, h) {
  const tl = project(g.tl), tr = project(g.tr), bl = project(g.bl);
  const ux = tr.x - tl.x, uy = tr.y - tl.y;
  const vx = bl.x - tl.x, vy = bl.y - tl.y;
  const sx = Math.hypot(ux, uy) / w;
  const sy = Math.hypot(vx, vy) / (h || w);
  const brx = tr.x + bl.x - tl.x, bry = tr.y + bl.y - tl.y;
  return normT({ cx: (tl.x + brx) / 2, cy: (tl.y + bry) / 2, sx, sy, a: Math.atan2(uy, ux) });
}

/** Tờ rộng hơn ranh (điều chỉnh cục bộ): giữ tỷ lệ ảnh */
function similarityGuess(bounds, w, h) {
  if (!bounds || !bounds.isValid()) return null;
  const sw = project([bounds.getSouth(), bounds.getWest()]), ne = project([bounds.getNorth(), bounds.getEast()]);
  const s = Math.max(ne.x - sw.x, (ne.y - sw.y) * w / h) * FIT_SHEET_PER_RANH / w;
  const mx = (sw.x + ne.x) / 2, my = (sw.y + ne.y) / 2;
  return normT({
    cx: mx - s * (FIT_ANCHOR[0] * w - w / 2),
    cy: my + s * (FIT_ANCHOR[1] * h - h / 2),
    sx: s, sy: s, a: 0
  });
}

/** Đồ án SDD: stretch khít bbox ranh (loại trừ phần lớn lệch tỷ lệ sau crop) */
function tightFitGuess(bounds, w, h) {
  if (!bounds || !bounds.isValid() || !(w > 0) || !(h > 0)) return null;
  const sw = project([bounds.getSouth(), bounds.getWest()]), ne = project([bounds.getNorth(), bounds.getEast()]);
  const sx = Math.max(1e-6, (ne.x - sw.x) / w);
  const sy = Math.max(1e-6, (ne.y - sw.y) / h);
  return normT({ cx: (sw.x + ne.x) / 2, cy: (sw.y + ne.y) / 2, sx, sy, a: 0 });
}

// ============================ CẮT LỀ TRẮNG + CHUẨN BỊ ẢNH ============================

export function scanProblem(file) {
  if (!file) return '';
  if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !SCAN_TYPES.test(file.type)) return 'Ảnh scan chỉ nhận JPG, PNG hoặc WebP';
  if (file.size > SCAN_INPUT_MAX_BYTES) return 'Ảnh scan lớn hơn 40 MB';
  return '';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = src;
  });
}

const toBlob = (canvas, type, q) => new Promise(r => canvas.toBlob(r, type, q));

function isNearWhite(r, g, b, a) {
  if (a < 12) return true;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max >= WHITE_MIN && (max - min) <= 20;
}

/** Tìm bbox nội dung (bỏ lề trắng). Trả null nếu không cắt được / cắt quá ít. */
export function detectWhiteMarginBox(data, w, h) {
  if (!data || !(w > 8) || !(h > 8) || data.length < w * h * 4) return null;
  const rowWhite = (y) => {
    let n = 0;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
    }
    return n / w >= WHITE_ROW_RATIO;
  };
  const colWhite = (x) => {
    let n = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
    }
    return n / h >= WHITE_ROW_RATIO;
  };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < bottom && rowWhite(top)) top++;
  while (bottom > top && rowWhite(bottom)) bottom--;
  while (left < right && colWhite(left)) left++;
  while (right > left && colWhite(right)) right--;
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad);
  bottom = Math.min(h - 1, bottom + pad);
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw < 32 || ch < 32) return null;
  if (cw * ch > w * h * 0.97) return null;
  if (cw * ch < w * h * 0.08) return null;
  return { left, top, width: cw, height: ch };
}

async function encodeUnder(canvas, maxBytes) {
  let scale = 1;
  const W0 = canvas.width, H0 = canvas.height;
  for (let i = 0; i < 8; i++) {
    const w = Math.max(1, Math.round(W0 * scale)), h = Math.max(1, Math.round(H0 * scale));
    let src = canvas;
    if (w !== W0 || h !== H0) {
      src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      src.getContext('2d').drawImage(canvas, 0, 0, w, h);
    }
    for (const q of [0.86, 0.74, 0.62]) {
      let blob = await toBlob(src, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(src, 'image/jpeg', q);
      if (blob && blob.size <= maxBytes) return { blob, w, h };
    }
    scale *= 0.8;
  }
  throw new Error(`Không nén được ảnh xuống dưới ${Math.round(maxBytes / (1024 * 1024))} MB`);
}

/**
 * Ảnh ≤ maxBytes giữ nguyên nếu đúng loại và cạnh ≤ 6000; không thì nén WebP/JPEG.
 * opts.maxBytes mặc định SCAN_MAX_BYTES (2 MB).
 */
export async function prepareScan(file, opts = {}) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : SCAN_MAX_BYTES;
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('Ảnh rỗng');
    if (file.size <= maxBytes && SCAN_TYPES.test(file.type) && Math.max(W, H) <= SCAN_MAX_SIDE) {
      return { blob: file, w: W, h: H, cropped: false };
    }
    let scale = Math.min(1, SCAN_MAX_SIDE / Math.max(W, H));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await encodeUnder(canvas, maxBytes);
    return { ...out, cropped: false };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * Cắt lề trắng tự động (nếu có) rồi nén ≤ SDD_SCAN_MAX_BYTES (5 MB).
 * Trả { blob, w, h, cropped }.
 */
export async function prepareSchemeScan(file) {
  const bad = scanProblem(file);
  if (bad) throw new Error(bad);
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('Ảnh rỗng');
    const full = document.createElement('canvas');
    const drawW = Math.min(W, SCAN_MAX_SIDE);
    const drawH = Math.min(H, Math.round(H * (drawW / W)));
    full.width = drawW;
    full.height = drawH;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, drawW, drawH);
    fctx.drawImage(img, 0, 0, drawW, drawH);
    let canvas = full;
    let cropped = false;
    try {
      const box = detectWhiteMarginBox(fctx.getImageData(0, 0, drawW, drawH).data, drawW, drawH);
      if (box) {
        const cut = document.createElement('canvas');
        cut.width = box.width;
        cut.height = box.height;
        cut.getContext('2d').drawImage(full, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
        canvas = cut;
        cropped = true;
      }
    } catch (e) { /* getImageData lỗi → giữ nguyên */ }
    if (Math.max(canvas.width, canvas.height) > SCAN_MAX_SIDE) {
      const s = SCAN_MAX_SIDE / Math.max(canvas.width, canvas.height);
      const shrink = document.createElement('canvas');
      shrink.width = Math.round(canvas.width * s);
      shrink.height = Math.round(canvas.height * s);
      shrink.getContext('2d').drawImage(canvas, 0, 0, shrink.width, shrink.height);
      canvas = shrink;
    }
    if (!cropped && file.size <= SDD_SCAN_MAX_BYTES && SCAN_TYPES.test(file.type) && Math.max(W, H) <= SCAN_MAX_SIDE) {
      return { blob: file, w: W, h: H, cropped: false };
    }
    const out = await encodeUnder(canvas, SDD_SCAN_MAX_BYTES);
    return { ...out, cropped };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ============================ KHUNG GHÉP ẢNH ============================

function boundaryVertices(geometry) {
  const out = [];
  const polys = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  polys.forEach(poly => (poly || []).forEach(ring => (ring || []).slice(0, -1).forEach(c => out.push([c[1], c[0]]))));
  return out;
}

function pinIcon(n, side, warn) {
  return L.divIcon({
    className: `sg-pin sg-pin-${side}${warn ? ' sg-pin-warn' : ''}`,
    html: `<span>${n}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function handleIcon(kind, title) {
  return L.divIcon({ className: `sg-handle sg-handle-${kind}`, html: `<span title="${title}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

const mText = (m) => `${fmtNum(Math.round(m * 10) / 10)} m`;
const mppText = (m) => `${m.toFixed(2).replace('.', ',')} m/pixel`;
const degText = (rad) => {
  let d = rad * 180 / Math.PI;
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return `${fmtNum(Math.round(d * 10) / 10)}°`;
};

const HINTS = {
  fit: `Kéo ảnh để dời. Kéo góc để phóng đều; kéo chấm giữa cạnh để <b>stretch</b> ngang/dọc; chấm tròn để xoay.
    Nút ±0,1° / ±1° xoay tinh; phím mũi tên dời (Shift nhanh).`,
  gcp: `Bấm một điểm trên khung <b>bản vẽ đã phê duyệt</b> (trái), rồi bấm điểm tương ứng trên bản đồ (phải). Điểm bản đồ tự hít vào đỉnh ranh.
    Cần ít nhất 3 cặp, nên 4–6 cặp trải đều. Kéo chấm để chỉnh.`
};

/**
 * opts: { url, w, h, boundary, title, initial, tightFit }.
 * tightFit: căn stretch khít bbox ranh (đồ án SDD). Trả { w, h, tl, tr, bl, gcps, rms, mode } hoặc null.
 */
export function openGeoref(opts) {
  return new Promise((resolve) => {
    const { url, w, h, boundary } = opts;
    const initial = opts.initial && opts.initial.tl ? opts.initial : null;
    const pairs = ((initial && initial.gcps) || []).map(g => ({ px: g.px.slice(), ll: g.ll.slice() }));
    const vertices = boundaryVertices(boundary);
    let mode = initial && initial.mode === 'gcp' && pairs.length >= 3 ? 'gcp' : 'fit';
    let t = initial ? similarityFrom(initial, w, h) : null;
    let fit = null;
    let preview = null;
    let imgMap = null;
    let imgPins = null;
    let transparency = 40;

    const box = document.createElement('div');
    box.className = 'sg-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const rotBtn = (v, text) => `<button type="button" class="bp-btn" data-sg="rot" data-v="${v}" title="Xoay ${text}">${text}</button>`;
    box.innerHTML = `<div class="sg-box">
      <div class="sg-head">
        <b>Ghép bản vẽ scan</b>
        <span>${escapeHtml(opts.title || '')}</span>
        <div class="sg-modes" role="radiogroup" aria-label="Cách ghép">
          <label class="bulk-kind-btn"><input type="radio" name="sgMode" value="fit">Kéo, xoay, stretch</label>
          <label class="bulk-kind-btn" title="Chấm cặp điểm ảnh ↔ bản đồ"><input type="radio" name="sgMode" value="gcp">Chấm điểm</label>
        </div>
        <button type="button" class="bp-btn" data-sg="close">${ico('close')}Hủy</button>
      </div>
      <div class="sg-hint" id="sgHint"></div>
      <div class="sg-panes" id="sgPanes">
        <div class="sg-pane"><div class="sg-map" id="sgImg"></div><div class="sg-tag">Ảnh scan</div></div>
        <div class="sg-pane"><div class="sg-map" id="sgMap"></div><div class="sg-tag">Bản đồ vệ tinh</div></div>
      </div>
      <div class="sg-foot">
        <div class="sg-list" id="sgList"></div>
        <div class="sg-tools" id="sgTools">
          ${rotBtn(-1, '↺ 1°')}${rotBtn(-0.1, '↺ 0,1°')}${rotBtn(0.1, '↻ 0,1°')}${rotBtn(1, '↻ 1°')}
          <button type="button" class="bp-btn" data-sg="zoom" data-v="0.99" title="Thu nhỏ ảnh 1%">− 1%</button>
          <button type="button" class="bp-btn" data-sg="zoom" data-v="1.01" title="Phóng to ảnh 1%">+ 1%</button>
          <button type="button" class="bp-btn" data-sg="reset" title="Đặt lại ảnh vào ranh">${ico('undo')}Đặt lại</button>
        </div>
        <label class="sg-op">Độ trong suốt <input type="range" id="sgOpacity" min="0" max="100" step="5" value="${transparency}"><output id="sgOpVal">${transparency}%</output></label>
        <button type="button" class="bp-btn" data-sg="undo" id="sgUndo">${ico('undo')}Xóa điểm cuối</button>
        <button type="button" class="bp-btn adj-primary" data-sg="save" disabled>${ico('save')}Lưu định vị</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    const panes = box.querySelector('#sgPanes');

    const geoMap = L.map(box.querySelector('#sgMap'), { maxZoom: MAP_MAX_ZOOM, touchZoom: true, attributionControl: false, zoomControl: true, keyboard: false });
    attachBasemap(geoMap, 'google');
    geoMap.createPane('sgScan').style.zIndex = 390;
    const ring = boundary ? L.geoJSON(boundary, { interactive: false, style: { color: RANH, weight: 3, dashArray: '10 6', fill: false } }) : null;
    const ringBounds = ring && ring.getBounds();

    function guessT() {
      if (opts.tightFit) return tightFitGuess(ringBounds, w, h) || similarityGuess(ringBounds, w, h);
      return similarityGuess(ringBounds, w, h);
    }

    function fitView() {
      if (mode === 'fit' && t) {
        const c = similarityCorners(t, w, h);
        geoMap.fitBounds(L.latLngBounds([c.tl, c.tr, c.br, c.bl, c.rot]), { padding: [30, 30], maxZoom: 19, animate: false });
      } else if (ringBounds && ringBounds.isValid()) geoMap.fitBounds(ringBounds, { padding: [60, 60], maxZoom: 19, animate: false });
      else geoMap.setView([16.4637, 107.5909], 14);
    }

    if (!t) t = guessT();
    fitView();
    if (!t) t = tightFitGuess(geoMap.getBounds().pad(-0.2), w, h) || similarityGuess(geoMap.getBounds().pad(-0.4), w, h);
    t = normT(t);
    ring?.addTo(geoMap);
    vertices.forEach(v => L.circleMarker(v, { radius: 3, color: RANH, weight: 1, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(geoMap));

    const geoPins = L.layerGroup();
    const handles = L.layerGroup();
    const hm = {};
    ['tl', 'tr', 'br', 'bl'].forEach(k => {
      hm[k] = L.marker([0, 0], { icon: handleIcon('scale', 'Kéo để phóng đều'), draggable: true, keyboard: false }).addTo(handles);
    });
    ['eL', 'eR'].forEach(k => {
      hm[k] = L.marker([0, 0], { icon: handleIcon('stretch-x', 'Kéo để stretch ngang'), draggable: true, keyboard: false }).addTo(handles);
    });
    ['eT', 'eB'].forEach(k => {
      hm[k] = L.marker([0, 0], { icon: handleIcon('stretch-y', 'Kéo để stretch dọc'), draggable: true, keyboard: false }).addTo(handles);
    });
    hm.rot = L.marker([0, 0], { icon: handleIcon('rot', 'Kéo để xoay'), draggable: true, keyboard: false }).addTo(handles);

    function showPreview(corners) {
      if (!corners) {
        if (preview) { geoMap.removeLayer(preview); preview = null; }
        return;
      }
      if (preview) preview.setCorners(corners);
      else preview = new ScanOverlay(url, corners, { pane: 'sgScan', opacity: 1 - transparency / 100 }).addTo(geoMap);
    }

    const centerOf = () => L.point(t.cx, t.cy);
    const angleTo = (p) => Math.atan2(p.y - t.cy, p.x - t.cx);
    let start = null;

    function renderFit(skip) {
      t = normT(t);
      const c = similarityCorners(t, w, h);
      showPreview([c.tl, c.tr, c.bl]);
      Object.keys(hm).forEach(k => { if (hm[k] !== skip) hm[k].setLatLng(c[k]); });
      drawList();
    }

    ['tl', 'tr', 'br', 'bl'].forEach(k => {
      const m = hm[k];
      m.on('dragstart', () => {
        start = { sx: t.sx, sy: t.sy, d: project([m.getLatLng().lat, m.getLatLng().lng]).distanceTo(centerOf()) };
      });
      m.on('drag', () => {
        if (!start || !(start.d > 0)) return;
        const d = project([m.getLatLng().lat, m.getLatLng().lng]).distanceTo(centerOf());
        const f = Math.max(0.05, d / start.d);
        t.sx = start.sx * f;
        t.sy = start.sy * f;
        renderFit(m);
      });
      m.on('dragend', () => { start = null; renderFit(); });
    });
    ['eL', 'eR'].forEach(k => {
      const m = hm[k];
      m.on('dragstart', () => {
        start = { sx: t.sx, d: Math.abs(project([m.getLatLng().lat, m.getLatLng().lng]).x - t.cx) };
      });
      m.on('drag', () => {
        if (!start || !(start.d > 0)) return;
        const d = Math.abs(project([m.getLatLng().lat, m.getLatLng().lng]).x - t.cx);
        t.sx = start.sx * Math.max(0.05, d / start.d);
        renderFit(m);
      });
      m.on('dragend', () => { start = null; renderFit(); });
    });
    ['eT', 'eB'].forEach(k => {
      const m = hm[k];
      m.on('dragstart', () => {
        start = { sy: t.sy, d: Math.abs(project([m.getLatLng().lat, m.getLatLng().lng]).y - t.cy) };
      });
      m.on('drag', () => {
        if (!start || !(start.d > 0)) return;
        const d = Math.abs(project([m.getLatLng().lat, m.getLatLng().lng]).y - t.cy);
        t.sy = start.sy * Math.max(0.05, d / start.d);
        renderFit(m);
      });
      m.on('dragend', () => { start = null; renderFit(); });
    });
    hm.rot.on('dragstart', () => { start = { a: t.a, b: angleTo(project([hm.rot.getLatLng().lat, hm.rot.getLatLng().lng])) }; });
    hm.rot.on('drag', () => {
      if (!start) return;
      t.a = start.a + angleTo(project([hm.rot.getLatLng().lat, hm.rot.getLatLng().lng])) - start.b;
      renderFit(hm.rot);
    });
    hm.rot.on('dragend', () => { start = null; renderFit(); });

    const cont = geoMap.getContainer();
    const llOf = (e) => { const ll = geoMap.mouseEventToLatLng(e); return [ll.lat, ll.lng]; };

    function insideImage(e) {
      const p = geoMap.mouseEventToContainerPoint(e);
      const c = similarityCorners(t, w, h);
      const q = [c.tl, c.tr, c.br, c.bl].map(ll => geoMap.latLngToContainerPoint(ll));
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (!cross) continue;
        if (sign && Math.sign(cross) !== sign) return false;
        sign = Math.sign(cross);
      }
      return true;
    }

    cont.addEventListener('pointerdown', (e) => {
      if (mode !== 'fit' || !t || e.button !== 0 || e.target.closest('.sg-handle, .leaflet-control')) return;
      if (!insideImage(e)) return;
      e.preventDefault();
      geoMap.dragging.disable();
      cont.classList.add('sg-moving');
      const p0 = project(llOf(e));
      const c0 = { cx: t.cx, cy: t.cy };
      const move = (ev) => {
        const p = project(llOf(ev));
        t.cx = c0.cx + p.x - p0.x;
        t.cy = c0.cy + p.y - p0.y;
        renderFit();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        geoMap.dragging.enable();
        cont.classList.remove('sg-moving');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }, true);
    cont.addEventListener('pointermove', (e) => {
      if (mode === 'fit' && t && !cont.classList.contains('sg-moving')) cont.classList.toggle('sg-over', insideImage(e));
    });

    function ensureImgMap() {
      if (imgMap) return;
      imgMap = L.map(box.querySelector('#sgImg'), {
        crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, attributionControl: false, zoomControl: true, keyboard: false
      });
      const imgBounds = [[-h, 0], [0, w]];
      imgMap.fitBounds(imgBounds);
      L.imageOverlay(url, imgBounds).addTo(imgMap);
      imgMap.setMaxBounds(L.latLngBounds(imgBounds).pad(0.3));
      imgPins = L.layerGroup().addTo(imgMap);
      imgMap.on('click', (e) => addPoint('px', toPx(e.latlng)));
    }

    function snap(latlng) {
      const p = geoMap.latLngToContainerPoint(latlng);
      let best = null, bestD = SNAP_PX;
      vertices.forEach(v => {
        const d = geoMap.latLngToContainerPoint(v).distanceTo(p);
        if (d < bestD) { best = v; bestD = d; }
      });
      return best ? best.slice() : [latlng.lat, latlng.lng];
    }

    const toPx = (ll) => [Math.min(w, Math.max(0, ll.lng)), Math.min(h, Math.max(0, -ll.lat))];

    function drawPairs() {
      imgPins?.clearLayers();
      geoPins.clearLayers();
      const done = pairs.filter(p => p.px && p.ll);
      fit = done.length >= 3 ? solveAffine(done) : null;
      let k = 0;
      pairs.forEach((p, i) => {
        const res = p.px && p.ll && fit ? fit.residuals[k++] : 0;
        const warn = fit && fit.rms > 0 && res > WARN_M;
        if (p.px && imgPins) {
          const m = L.marker([-p.px[1], p.px[0]], { icon: pinIcon(i + 1, 'img', warn), draggable: true }).addTo(imgPins);
          m.on('dragend', () => { p.px = toPx(m.getLatLng()); drawPairs(); });
        }
        if (p.ll) {
          const m = L.marker(p.ll, { icon: pinIcon(i + 1, 'geo', warn), draggable: true }).addTo(geoPins);
          m.on('dragend', () => { p.ll = snap(m.getLatLng()); drawPairs(); });
        }
      });
      if (fit && !fit.mirrored) {
        const c = fit.corners(w, h);
        showPreview([c.tl, c.tr, c.bl]);
      } else showPreview(null);
      drawList();
    }

    function addPoint(side, value) {
      if (mode !== 'gcp') return;
      const last = pairs[pairs.length - 1];
      const other = side === 'px' ? 'll' : 'px';
      if (last && !last[side] && last[other]) last[side] = value;
      else if (last && last[side] && !last[other]) last[side] = value;
      else pairs.push({ [side]: value });
      drawPairs();
    }

    geoMap.on('click', (e) => addPoint('ll', snap(e.latlng)));

    function drawList() {
      const list = box.querySelector('#sgList');
      const save = box.querySelector('[data-sg="save"]');
      if (mode === 'fit') {
        const k = Math.cos(unproject(t.cx, t.cy)[0] * Math.PI / 180);
        list.innerHTML = `<div class="sg-sum">Ngang ${mppText(t.sx * k)} · dọc ${mppText(t.sy * k)} · tờ ${fmtNum(Math.round(t.sx * k * w))}×${fmtNum(Math.round(t.sy * k * h))} m · xoay ${degText(t.a)}</div>`;
        save.disabled = false;
        return;
      }
      const done = pairs.filter(p => p.px && p.ll).length;
      let k = 0;
      const rows = pairs.map((p, i) => {
        let tail;
        let warn = false;
        if (!p.px) tail = 'chờ điểm trên ảnh';
        else if (!p.ll) tail = 'chờ điểm trên bản đồ';
        else if (fit && fit.rms > 0) {
          const r = fit.residuals[k++];
          tail = `lệch ${mText(r)}`;
          warn = r > WARN_M;
        } else tail = 'đã ghép';
        return `<span class="sg-chip${warn ? ' sg-warn' : ''}">#${i + 1} · ${tail}<button type="button" data-sg="del" data-i="${i}" title="Xóa cặp điểm">×</button></span>`;
      }).join('');
      let sum;
      if (done < 3) sum = `Còn thiếu ${3 - done} cặp điểm`;
      else if (!fit) sum = 'Các điểm gần thẳng hàng — chấm thêm điểm ở góc khác';
      else if (fit.mirrored) sum = 'Ảnh bị lật — kiểm tra lại thứ tự các cặp điểm';
      else sum = `${done} cặp · ${mppText(fit.mpp)} · ${fit.rms > 0 ? `RMS ${mText(fit.rms)}` : 'thêm cặp thứ 4 để kiểm tra sai số'}`;
      const bad = !fit || fit.mirrored;
      list.innerHTML = `<div class="sg-sum${!bad && fit.rms > WARN_M ? ' sg-warn' : ''}">${sum}</div>${rows}`;
      save.disabled = bad;
    }

    function setMode(next) {
      if (next === 'fit' && mode === 'gcp' && fit && !fit.mirrored) t = similarityFrom(fit.corners(w, h), w, h);
      mode = next;
      box.querySelector(`input[name="sgMode"][value="${mode}"]`).checked = true;
      panes.classList.toggle('sg-single', mode === 'fit');
      box.querySelector('#sgHint').innerHTML = HINTS[mode];
      box.querySelector('#sgTools').hidden = mode !== 'fit';
      box.querySelector('#sgUndo').hidden = mode !== 'gcp';
      cont.classList.remove('sg-over');
      if (mode === 'fit') { geoPins.remove(); handles.addTo(geoMap); } else { handles.remove(); geoPins.addTo(geoMap); }
      requestAnimationFrame(() => {
        geoMap.invalidateSize();
        if (mode === 'gcp') { ensureImgMap(); imgMap.invalidateSize(); drawPairs(); }
      });
      if (mode === 'fit') renderFit();
      else drawPairs();
    }

    function close(result) {
      document.removeEventListener('keydown', onKey);
      if (preview) preview.remove();
      imgMap?.remove();
      detachBasemap(geoMap);
      geoMap.remove();
      box.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') { close(null); return; }
      if (mode !== 'fit' || !t || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = (e.shiftKey ? NUDGE_FAST_PX : NUDGE_PX) * MERCATOR_WORLD_M / (256 * 2 ** geoMap.getZoom());
      t.cx += dir[0] * step;
      t.cy += dir[1] * step;
      renderFit();
    }
    document.addEventListener('keydown', onKey);

    box.querySelector('#sgOpacity').addEventListener('input', (e) => {
      transparency = Number(e.target.value) || 0;
      box.querySelector('#sgOpVal').textContent = `${transparency}%`;
      if (preview) preview.setOpacity(1 - transparency / 100);
    });

    box.addEventListener('change', (e) => {
      if (e.target.name === 'sgMode') setMode(e.target.value);
    });

    box.addEventListener('click', (e) => {
      const el = e.target.closest('[data-sg]');
      if (!el) return;
      const act = el.dataset.sg;
      if (act === 'close') close(null);
      else if (act === 'rot') { t.a -= Number(el.dataset.v) * Math.PI / 180; renderFit(); }
      else if (act === 'zoom') {
        const f = Number(el.dataset.v);
        t.sx *= f;
        t.sy *= f;
        renderFit();
      } else if (act === 'reset') {
        t = guessT() || t;
        renderFit();
        fitView();
      } else if (act === 'undo') {
        const last = pairs[pairs.length - 1];
        if (!last) return;
        if (last.px && last.ll) delete last.ll;
        else pairs.pop();
        drawPairs();
      } else if (act === 'del') {
        pairs.splice(Number(el.dataset.i), 1);
        drawPairs();
      } else if (act === 'save') {
        if (mode === 'fit') {
          const c = similarityCorners(t, w, h);
          close({ w, h, tl: c.tl, tr: c.tr, bl: c.bl, gcps: [], rms: 0, mode: 'fit' });
          return;
        }
        if (!fit || fit.mirrored) return;
        if (fit.rms > WARN_M && !confirm(`Sai số trung bình ${mText(fit.rms)} — vẫn lưu định vị này?`)) return;
        const c = fit.corners(w, h);
        close({ w, h, ...c, gcps: pairs.filter(p => p.px && p.ll).map(p => ({ px: p.px, ll: p.ll })), rms: fit.rms, mode: 'gcp' });
      }
    });

    setMode(mode);
    if (!vertices.length) showToast('Chưa có ranh — căn ảnh theo đường giao thông trên nền vệ tinh', 'info');
    else if (opts.tightFit) showToast('Đã căn stretch theo ranh — chỉnh xoay / cạnh nếu cần', 'info');
  });
}
