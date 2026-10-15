// Dựng PDF vector bằng jsPDF cho khung in (printLayout.js):
// - đối tượng Leaflet L.Path (ranh lô, đường, vùng phủ, vòng tròn) vẽ lại từ tọa độ, không qua ảnh chụp;
// - khối HTML đã dàn trang (cột thông tin, chú giải) chép sang PDF theo vị trí đo trên trình duyệt.
// Chữ nhúng font Be Vietnam Pro (public/fonts, giấy phép OFL). jsPDF không ghép dấu tổ hợp nên chuỗi chuẩn hóa NFC;
// khối HTML phải dàn trang bằng cùng font (PRINT_FONT) để bề rộng chữ khớp với PDF.

export const PX_MM = 25.4 / 96;
export const PRINT_FONT = 'PrintVN';
const PDF_FONT = 'BeVietnamPro';
const FONT_FILES = [
  { style: 'normal', weight: '400', file: 'BeVietnamPro-Regular.ttf' },
  { style: 'bold', weight: '700', file: 'BeVietnamPro-Bold.ttf' }
];
// Ký tự có thể thiếu trong font nhúng (PDF hiện ô trống thay vì chuyển font như trình duyệt)
const GLYPH_FALLBACK = [[/≈/g, '~'], [/≥/g, '>='], [/≤/g, '<='], [/→/g, '->']];
// Ô hoa văn TT16 trên bản đồ là CanvasPattern: in tô đặc cùng màu, nhạt hơn để giữ cảm giác nền hoa văn
const PATTERN_FILL_ALPHA = 0.45;
// Bỏ đỉnh cách đỉnh trước dưới ngưỡng này (mm trên giấy) cho file nhẹ
const MIN_STEP_MM = 0.04;

let fontsPromise = null;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Tải font in (một lần): đăng ký FontFace cho trình duyệt dàn trang, giữ base64 để nhúng vào PDF */
export function loadPrintFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(FONT_FILES.map(async (f) => {
      const res = await fetch(new URL(`../fonts/${f.file}`, import.meta.url));
      if (!res.ok) throw new Error(`không tải được font ${f.file}`);
      const buf = await res.arrayBuffer();
      const face = new FontFace(PRINT_FONT, buf.slice(0), { weight: f.weight });
      document.fonts.add(await face.load());
      return { ...f, b64: toBase64(buf) };
    })).catch(err => {
      fontsPromise = null;
      throw err;
    });
  }
  return fontsPromise;
}

export function createPdf(format, fonts) {
  const pdf = new window.jspdf.jsPDF({ unit: 'mm', format, orientation: 'landscape', compress: true });
  fonts.forEach(f => {
    pdf.addFileToVFS(f.file, f.b64);
    pdf.addFont(f.file, PDF_FONT, f.style);
  });
  pdf.setFont(PDF_FONT, 'normal');
  return pdf;
}

export function cleanText(s) {
  let out = String(s ?? '').normalize('NFC');
  GLYPH_FALLBACK.forEach(([re, rep]) => { out = out.replace(re, rep); });
  return out;
}

export function setFont(pdf, bold, sizePx) {
  pdf.setFont(PDF_FONT, bold ? 'bold' : 'normal');
  pdf.setFontSize(sizePx * 0.75);
}

// ================== MÀU, ĐỘ TRONG ==================
const colorCtx = document.createElement('canvas').getContext('2d');
const colorCache = new Map();

/** Mọi chuỗi màu CSS → { r, g, b, a }; null nếu không phải chuỗi */
export function parseColor(value) {
  if (typeof value !== 'string' || !value) return null;
  if (colorCache.has(value)) return colorCache.get(value);
  colorCtx.fillStyle = 'rgba(0, 0, 0, 0)';
  colorCtx.fillStyle = value;
  const v = colorCtx.fillStyle;
  let out = null;
  if (v.startsWith('#')) {
    out = { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 1 };
  } else {
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map(Number);
      out = { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
  }
  colorCache.set(value, out);
  return out;
}

const gstates = new WeakMap();
export function setAlpha(pdf, fill = 1, stroke = fill) {
  let cache = gstates.get(pdf);
  if (!cache) gstates.set(pdf, cache = new Map());
  const key = `${fill.toFixed(3)}/${stroke.toFixed(3)}`;
  let gs = cache.get(key);
  if (!gs) {
    gs = new pdf.GState({ opacity: fill, 'stroke-opacity': stroke });
    cache.set(key, gs);
  }
  pdf.setGState(gs);
}

export function withClip(pdf, r, fn) {
  pdf.saveGraphicsState();
  pdf.rect(r.x, r.y, r.w, r.h, null);
  pdf.clip();
  pdf.discardPath();
  try {
    fn();
  } finally {
    pdf.restoreGraphicsState();
  }
}

function dashOf(dashArray, k) {
  if (!dashArray) return [];
  const parts = String(dashArray).split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0);
  if (!parts.length || parts.every(n => n === 0)) return [];
  const d = parts.length % 2 ? [...parts, ...parts] : parts;
  return d.map(n => n * k);
}

// ================== ĐỐI TƯỢNG VECTOR LEAFLET ==================
function visibleAlpha(el, stop) {
  let a = 1;
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    a *= Number(cs.opacity);
  }
  return a;
}

/** Nhóm L.Path theo bộ vẽ (canvas / svg), xếp theo pane rồi theo thứ tự vẽ trong bộ vẽ */
function pathGroups(m) {
  const byRenderer = new Map();
  m.eachLayer(l => {
    if (!(l instanceof L.Path) || !l._renderer) return;
    if (!byRenderer.has(l._renderer)) byRenderer.set(l._renderer, new Set());
    byRenderer.get(l._renderer).add(l);
  });
  const host = m.getContainer();
  const groups = [];
  byRenderer.forEach((set, r) => {
    const el = r._container;
    if (!el) return;
    const alpha = visibleAlpha(el, host);
    if (alpha <= 0.01) return;
    let list = null;
    if (r._drawFirst) {
      list = [];
      for (let o = r._drawFirst; o; o = o.next) list.push(o.layer);
    } else if (r._rootGroup) {
      const byPath = new Map([...set].map(l => [l._path, l]));
      list = [...r._rootGroup.children].map(p => byPath.get(p));
    }
    list = (list || [...set]).filter(l => l && set.has(l));
    const pane = el.closest('.leaflet-pane');
    groups.push({ el, alpha, list, z: pane ? (parseInt(getComputedStyle(pane).zIndex, 10) || 0) : 0 });
  });
  return groups.sort((a, b) => a.z - b.z || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** Phần tử DOM chứa vector đã vẽ lại trong PDF (bỏ khỏi ảnh chụp nền) */
export function vectorContainers(maps) {
  const out = new Set();
  maps.forEach(m => m?.eachLayer(l => {
    if (l instanceof L.Path && l._renderer?._container) out.add(l._renderer._container);
  }));
  return out;
}

function ringsOf(latlngs) {
  if (!latlngs || !latlngs.length) return [];
  if (L.LineUtil.isFlat(latlngs)) return [latlngs];
  return latlngs.flatMap(ringsOf);
}

function applyStroke(pdf, o, color, k, state) {
  pdf.setDrawColor(color.r, color.g, color.b);
  pdf.setLineWidth(Math.max(0.05, (o.weight || 1) * k));
  pdf.setLineCap(o.lineCap || 'round');
  pdf.setLineJoin(o.lineJoin || 'round');
  const dash = dashOf(o.dashArray, k);
  const key = dash.join(',');
  if (key !== state.dash) {
    pdf.setLineDashPattern(dash, 0);
    state.dash = key;
  }
}

function drawPath(pdf, l, alpha, ctx) {
  const o = l.options;
  const stroke = o.stroke !== false && o.weight > 0 ? parseColor(o.color) : null;
  const sAlpha = stroke ? (o.opacity ?? 1) * stroke.a * alpha : 0;
  let fill = null;
  let fAlpha = 0;
  if (o.fill) {
    const solid = typeof o.fillColor === 'string';
    fill = parseColor(solid ? o.fillColor : o.color);
    if (fill) fAlpha = (o.fillOpacity ?? 0.2) * fill.a * alpha * (solid ? 1 : PATTERN_FILL_ALPHA);
  }
  const doStroke = sAlpha > 0.01;
  const doFill = fAlpha > 0.01;
  if (!doStroke && !doFill) return false;

  if (l instanceof L.CircleMarker) {
    const c = l.getLatLng();
    const inView = l instanceof L.Circle ? ctx.bounds.intersects(l.getBounds()) : ctx.bounds.contains(c);
    if (!inView) return false;
    const rx = (l._radius || o.radius || 0) * ctx.k;
    const ry = (l._radiusY || l._radius || o.radius || 0) * ctx.k;
    if (rx <= 0) return false;
    const [x, y] = ctx.toMm(c);
    if (doStroke) applyStroke(pdf, o, stroke, ctx.k, ctx.state);
    if (doFill) pdf.setFillColor(fill.r, fill.g, fill.b);
    setAlpha(pdf, doFill ? fAlpha : 1, doStroke ? sAlpha : 1);
    pdf.ellipse(x, y, rx, ry, doFill && doStroke ? 'FD' : doFill ? 'F' : 'S');
    return true;
  }
  if (!(l instanceof L.Polyline)) return false;
  const b = l.getBounds();
  if (!b.isValid() || !ctx.bounds.intersects(b)) return false;
  const closed = l instanceof L.Polygon;
  const paths = [];
  ringsOf(l._latlngs).forEach(ring => {
    const pts = [];
    let last = null;
    ring.forEach(ll => {
      const p = ctx.toMm(ll);
      if (last && Math.abs(p[0] - last[0]) < MIN_STEP_MM && Math.abs(p[1] - last[1]) < MIN_STEP_MM) return;
      pts.push(p);
      last = p;
    });
    if (pts.length >= 2) paths.push(pts);
  });
  if (!paths.length) return false;
  const fillIt = closed && doFill;
  if (!fillIt && !doStroke) return false;
  if (doStroke) applyStroke(pdf, o, stroke, ctx.k, ctx.state);
  if (fillIt) pdf.setFillColor(fill.r, fill.g, fill.b);
  setAlpha(pdf, fillIt ? fAlpha : 1, doStroke ? sAlpha : 1);
  paths.forEach(pts => {
    pdf.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) pdf.lineTo(pts[i][0], pts[i][1]);
    if (closed) pdf.close();
  });
  if (fillIt && doStroke) pdf.fillStrokeEvenOdd();
  else if (fillIt) pdf.fillEvenOdd();
  else pdf.stroke();
  return true;
}

/**
 * Vẽ mọi L.Path đang hiện của bản đồ m vào khung giấy.
 * rect: vùng in theo px khung bản đồ m; frame: vị trí trên giấy (mm). Nét theo px bản đồ × (mm / px) để đồng bộ với icon.
 */
export function drawMapPaths(pdf, m, rect, frame) {
  const k = frame.w / rect.w;
  const zoom = m.getZoom();
  const origin = m.getPixelOrigin();
  const pane = m._getMapPanePos();
  const pad = 0.05 * Math.max(rect.w, rect.h);
  const bounds = L.latLngBounds(
    m.containerPointToLatLng([rect.x - pad, rect.y - pad]),
    m.containerPointToLatLng([rect.x + rect.w + pad, rect.y + rect.h + pad])
  );
  const ctx = {
    k,
    bounds,
    state: { dash: '' },
    toMm: (ll) => {
      const p = m.project(ll, zoom);
      return [frame.x + (p.x - origin.x + pane.x - rect.x) * k, frame.y + (p.y - origin.y + pane.y - rect.y) * k];
    }
  };
  pdf.setLineDashPattern([], 0);
  let n = 0;
  pathGroups(m).forEach(g => g.list.forEach(l => { if (drawPath(pdf, l, g.alpha, ctx)) n++; }));
  pdf.setLineDashPattern([], 0);
  setAlpha(pdf, 1, 1);
  return n;
}

// ================== CHÉP KHỐI HTML SANG PDF ==================
const measureCtx = document.createElement('canvas').getContext('2d');

async function rasterImages(root) {
  const out = new Map();
  await Promise.all([...root.querySelectorAll('img')].map(async (img) => {
    try { await img.decode(); } catch (e) { return; }
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.ceil(r.width * 4);
    const h = Math.ceil(r.height * 4);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    try { out.set(img, { data: cv.toDataURL('image/png'), alias: `img:${img.src}:${w}x${h}` }); } catch (e) { /* ảnh khác nguồn */ }
  }));
  return out;
}

function radiusOf(value, r) {
  const v = String(value || '0');
  if (v.endsWith('%')) return Math.min(r.w, r.h) * Math.min(50, parseFloat(v)) / 100;
  return Math.min((parseFloat(v) || 0) * PX_MM, r.w / 2, r.h / 2);
}

function drawGradient(pdf, css, r, op) {
  const stops = (css.match(/rgba?\([^)]*\)/g) || []).map(parseColor).filter(Boolean);
  if (stops.length < 2) return;
  const n = 64;
  const w = r.w / n;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(t));
    const f = t - j;
    const a = stops[j], b = stops[j + 1];
    const mix = (u, v) => Math.round(u + (v - u) * f);
    pdf.setFillColor(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b));
    setAlpha(pdf, (a.a + (b.a - a.a) * f) * op, 1);
    pdf.rect(r.x + i * w, r.y, w + 0.02, r.h, 'F');
  }
}

function drawTiles(pdf, css, cs, r, op) {
  const m = css.match(/url\("?(.*?)"?\)/);
  if (!m || !m[1].startsWith('data:image/png')) return;
  const size = String(cs.backgroundSize).split(/\s+/).map(parseFloat);
  const tw = (size[0] || 0) * PX_MM;
  const th = (size[1] || size[0] || 0) * PX_MM;
  if (tw < 0.2 || th < 0.2) return;
  setAlpha(pdf, op, 1);
  withClip(pdf, r, () => {
    for (let y = r.y; y < r.y + r.h; y += th) {
      for (let x = r.x; x < r.x + r.w; x += tw) pdf.addImage(m[1], 'PNG', x, y, tw, th, `bg:${m[1].length}:${m[1].slice(-32)}`);
    }
  });
}

function drawBorders(pdf, cs, r, op, radius) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map(s => ({
    w: (parseFloat(cs[`border${s}Width`]) || 0) * PX_MM,
    style: cs[`border${s}Style`],
    color: parseColor(cs[`border${s}Color`])
  }));
  const shown = sides.map(s => s.w > 0 && s.style !== 'none' && s.style !== 'hidden' && s.color && s.color.a > 0);
  if (!shown.some(Boolean)) return;
  const dash = (s) => (s.style === 'dashed' ? [s.w * 3, s.w * 2] : s.style === 'dotted' ? [s.w, s.w] : []);
  const same = shown.every(Boolean) && sides.every(s => s.w === sides[0].w && s.style === sides[0].style
    && s.color.r === sides[0].color.r && s.color.g === sides[0].color.g && s.color.b === sides[0].color.b);
  if (same) {
    const s = sides[0];
    pdf.setDrawColor(s.color.r, s.color.g, s.color.b);
    pdf.setLineWidth(s.w);
    pdf.setLineDashPattern(dash(s), 0);
    setAlpha(pdf, 1, s.color.a * op);
    const x = r.x + s.w / 2, y = r.y + s.w / 2, w = r.w - s.w, h = r.h - s.w;
    if (radius > s.w / 2) pdf.roundedRect(x, y, w, h, radius - s.w / 2, radius - s.w / 2, 'S');
    else pdf.rect(x, y, w, h, 'S');
    pdf.setLineDashPattern([], 0);
    return;
  }
  const lines = [
    [r.x, r.y + sides[0].w / 2, r.x + r.w, r.y + sides[0].w / 2],
    [r.x + r.w - sides[1].w / 2, r.y, r.x + r.w - sides[1].w / 2, r.y + r.h],
    [r.x, r.y + r.h - sides[2].w / 2, r.x + r.w, r.y + r.h - sides[2].w / 2],
    [r.x + sides[3].w / 2, r.y, r.x + sides[3].w / 2, r.y + r.h]
  ];
  sides.forEach((s, i) => {
    if (!shown[i]) return;
    pdf.setDrawColor(s.color.r, s.color.g, s.color.b);
    pdf.setLineWidth(s.w);
    pdf.setLineCap('butt');
    pdf.setLineDashPattern(dash(s), 0);
    setAlpha(pdf, 1, s.color.a * op);
    pdf.line(...lines[i]);
  });
  pdf.setLineDashPattern([], 0);
}

function drawSvg(pdf, svg, r, op) {
  const vb = svg.viewBox?.baseVal;
  const sx = vb && vb.width ? r.w / vb.width : PX_MM;
  const sy = vb && vb.height ? r.h / vb.height : PX_MM;
  const px = (x) => r.x + (x - (vb?.x || 0)) * sx;
  const py = (y) => r.y + (y - (vb?.y || 0)) * sy;
  svg.querySelectorAll('polygon, text').forEach(n => {
    const fill = parseColor(n.getAttribute('fill') || '#000');
    if (n.tagName.toLowerCase() === 'text') {
      if (!fill) return;
      const size = parseFloat(n.getAttribute('font-size')) || 12;
      setFont(pdf, Number(n.getAttribute('font-weight')) >= 600, size * sy / PX_MM);
      pdf.setTextColor(fill.r, fill.g, fill.b);
      setAlpha(pdf, fill.a * op, 1);
      const anchor = n.getAttribute('text-anchor');
      pdf.text(cleanText(n.textContent), px(parseFloat(n.getAttribute('x')) || 0), py(parseFloat(n.getAttribute('y')) || 0), {
        align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'
      });
      return;
    }
    const pts = (n.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    if (pts.length < 6) return;
    const stroke = parseColor(n.getAttribute('stroke') || 'none');
    const doFill = fill && fill.a > 0;
    const doStroke = stroke && stroke.a > 0;
    if (doFill) pdf.setFillColor(fill.r, fill.g, fill.b);
    if (doStroke) {
      pdf.setDrawColor(stroke.r, stroke.g, stroke.b);
      pdf.setLineWidth((parseFloat(n.getAttribute('stroke-width')) || 1) * sx);
      pdf.setLineJoin('miter');
    }
    setAlpha(pdf, doFill ? fill.a * op : 1, doStroke ? stroke.a * op : 1);
    pdf.moveTo(px(pts[0]), py(pts[1]));
    for (let i = 2; i + 1 < pts.length; i += 2) pdf.lineTo(px(pts[i]), py(pts[i + 1]));
    pdf.close();
    if (doFill && doStroke) pdf.fillStroke();
    else if (doFill) pdf.fill();
    else if (doStroke) pdf.stroke();
    else pdf.discardPath();
  });
}

function drawText(pdf, node, cs, op, rel) {
  const raw = node.textContent;
  if (!/\S/.test(raw)) return;
  const color = parseColor(cs.color);
  if (!color || color.a * op < 0.02) return;
  const px = parseFloat(cs.fontSize) || 12;
  const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
  const upper = cs.textTransform === 'uppercase';
  const spacing = cs.letterSpacing === 'normal' ? 0 : (parseFloat(cs.letterSpacing) || 0) * PX_MM;
  measureCtx.font = `${bold ? 700 : 400} ${px}px ${PRINT_FONT}`;
  const ascent = measureCtx.measureText('Hg').fontBoundingBoxAscent ?? px * 0.95;
  setFont(pdf, bold, px);
  pdf.setTextColor(color.r, color.g, color.b);
  setAlpha(pdf, color.a * op, 1);
  const range = document.createRange();
  const re = /\S+/g;
  let m;
  while ((m = re.exec(raw))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const box = range.getClientRects()[0];
    if (!box || !box.width) continue;
    const word = cleanText(upper ? m[0].toLocaleUpperCase('vi') : m[0]);
    const p = rel(box.left, box.top + ascent);
    pdf.text(word, p.x, p.y, { baseline: 'alphabetic', charSpace: spacing });
  }
}

/** Chép cây HTML root sang PDF; origin = phần tử có góc trên trái trùng góc giấy (px CSS ở 96 dpi = mm × 96 / 25,4) */
export async function drawDom(pdf, root, origin) {
  const o = origin.getBoundingClientRect();
  const rel = (x, y) => ({ x: (x - o.left) * PX_MM, y: (y - o.top) * PX_MM });
  const rectOf = (b) => ({ ...rel(b.left, b.top), w: b.width * PX_MM, h: b.height * PX_MM });
  const images = await rasterImages(root);

  const walk = (el, op) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const alpha = op * Number(cs.opacity);
    if (alpha <= 0.01) return;
    const r = rectOf(el.getBoundingClientRect());
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const im = images.get(el);
      if (im) {
        setAlpha(pdf, alpha, 1);
        pdf.addImage(im.data, 'PNG', r.x, r.y, r.w, r.h, im.alias);
      }
      return;
    }
    if (tag === 'svg') {
      drawSvg(pdf, el, r, alpha);
      return;
    }
    const radius = radiusOf(cs.borderTopLeftRadius, r);
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.a > 0 && r.w > 0 && r.h > 0) {
      pdf.setFillColor(bg.r, bg.g, bg.b);
      setAlpha(pdf, bg.a * alpha, 1);
      if (radius > 0.05) pdf.roundedRect(r.x, r.y, r.w, r.h, radius, radius, 'F');
      else pdf.rect(r.x, r.y, r.w, r.h, 'F');
    }
    const img = cs.backgroundImage;
    if (img && img !== 'none' && r.w > 0 && r.h > 0) {
      if (img.startsWith('linear-gradient')) drawGradient(pdf, img, r, alpha);
      else drawTiles(pdf, img, cs, r, alpha);
    }
    drawBorders(pdf, cs, r, alpha, radius);
    const drawChildren = () => el.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) drawText(pdf, child, cs, alpha, rel);
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child, alpha);
    });
    if (cs.overflow === 'visible') drawChildren();
    else withClip(pdf, r, drawChildren);
  };
  walk(root, 1);
  setAlpha(pdf, 1, 1);
}
