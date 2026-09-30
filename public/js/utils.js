/**
 * Tiện ích dùng chung: chống XSS khi ghép HTML, định dạng số kiểu Việt Nam, khoảng cách, tải thư viện khi cần.
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Mọi chuỗi lấy từ dữ liệu (tên công trình, phường, ghi chú...) phải qua hàm này trước khi đưa vào innerHTML
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

/** 1 ô chỉ tiêu trong dòng thông tin phường: nhãn nhỏ phía trên, giá trị (HTML đã escape) + đơn vị phía dưới */
/** Icon nét mảnh trong sprite #i-* (index.html); kích thước theo cỡ chữ của phần tử chứa */
export function ico(name, cls = '') {
  return `<svg class="ico${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/** html2canvas vẽ SVG thành ảnh tách rời (mất <use href="#..."> và CSS): chép nội dung symbol + màu nét vào từng icon của bản sao */
export function inlineSpriteIcons(doc) {
  doc.querySelectorAll('svg.ico').forEach(svg => {
    const href = svg.querySelector('use')?.getAttribute('href');
    const sym = href && doc.querySelector(href);
    if (!sym) return;
    const cs = doc.defaultView.getComputedStyle(svg);
    svg.setAttribute('viewBox', sym.getAttribute('viewBox'));
    svg.setAttribute('width', parseFloat(cs.width) || 12);
    svg.setAttribute('height', parseFloat(cs.height) || 12);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', cs.color);
    svg.setAttribute('stroke-width', cs.strokeWidth || '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = sym.innerHTML.replaceAll('currentColor', cs.color);
  });
}

export function wardStatHtml(label, valueHtml, unit, title) {
  return `<div class="ward-stat"${title ? ` title="${escapeHtml(title)}"` : ''}>`
    + `<small>${escapeHtml(label)}</small><span><b>${valueHtml}</b>${unit ? ` <em>${escapeHtml(unit)}</em>` : ''}</span></div>`;
}

export function isApproved(status) {
  return status === true || String(status).trim().toUpperCase() === 'TRUE' || String(status).trim() === '1';
}

const NUM_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const PCT_FORMAT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtNum = (value) => NUM_FORMAT.format(Number(value) || 0);
export const fmtPct = (value) => `${PCT_FORMAT.format(Number(value) || 0)}%`;

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Cỡ chữ nhãn phường theo mức zoom (8px ở zoom 11 → 16px ở zoom 17)
export function wardLabelFontSize(zoom) {
  const minZoom = 11, maxZoom = 17, minSize = 8, maxSize = 16;
  const z = Math.max(minZoom, Math.min(maxZoom, zoom));
  return minSize + (z - minZoom) * (maxSize - minSize) / (maxZoom - minZoom);
}

/**
 * Điểm đặt nhãn trong ranh (pole of inaccessibility – thuật toán polylabel): điểm nằm TRONG polygon, xa ranh nhất.
 * Tâm hình học của phường cong/lõm có thể rơi sát ranh hoặc sang phường khác nên không dùng.
 * MultiPolygon lấy phần diện tích lớn nhất. Trả về { lat, lng, depthM } hoặc null.
 */
const CENTER_PULL = 0.35;
export function wardLabelPoint(geometry, precisionM = 20) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates
    : geometry?.type === 'GeometryCollection' ? (geometry.geometries || []).flatMap(g =>
      g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])
    : [];
  if (!polys.length) return null;

  // Chiếu phẳng cục bộ (x = kinh độ·cos(vĩ độ)) để khoảng cách theo 2 trục cùng tỉ lệ
  const lat0 = polys[0][0][0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const project = (rings) => rings.map(r => r.map(([lng, lat]) => [lng * kx, lat]));
  const ringArea = (r) => {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
    return Math.abs(s / 2);
  };
  const rings = polys.map(project).reduce((best, p) => (ringArea(p[0]) > ringArea(best[0]) ? p : best));

  // Khoảng cách có dấu tới ranh: dương = trong polygon (tính cả lỗ thủng)
  const signedDist = (x, y) => {
    let inside = false;
    let minSq = Infinity;
    rings.forEach(ring => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[j];
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        let dx = bx - ax, dy = by - ay;
        let px = ax, py = ay;
        if (dx || dy) {
          const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
          if (t > 1) { px = bx; py = by; } else if (t > 0) { px = ax + dx * t; py = ay + dy * t; }
        }
        dx = x - px; dy = y - py;
        minSq = Math.min(minSq, dx * dx + dy * dy);
      }
    });
    return (inside ? 1 : -1) * Math.sqrt(minSq);
  };

  const outer = rings[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  outer.forEach(([x, y]) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  });
  const cellSize = Math.min(maxX - minX, maxY - minY);
  const toResult = (c) => ({ lat: c.y, lng: c.x / kx, depthM: Math.max(0, c.d) * 111320 });
  if (!(cellSize > 0)) return toResult({ x: minX, y: minY, d: 0 });

  // Trọng tâm diện tích vòng ngoài (có thể nằm ngoài polygon, chỉ dùng làm điểm hút)
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const f = outer[i][0] * outer[j][1] - outer[j][0] * outer[i][1];
    cx += (outer[i][0] + outer[j][0]) * f;
    cy += (outer[i][1] + outer[j][1]) * f;
    a += f * 3;
  }
  if (a) { cx /= a; cy /= a; } else { cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; }

  // Điểm số = độ sâu × hệ số giảm dần theo khoảng cách tới trọng tâm: phường dài có nhiều chỗ sâu ngang nhau
  // thì chọn chỗ gần giữa phường (ổn định, không nhảy sang một đầu)
  const extent = Math.max(maxX - minX, maxY - minY);
  const centerFactor = (dc) => 1 - CENTER_PULL * Math.min(1, Math.max(0, dc) / extent);
  const makeCell = (x, y, h) => {
    const d = signedDist(x, y);
    const dc = Math.hypot(x - cx, y - cy);
    const r = h * Math.SQRT2;
    const up = d + r;
    return { x, y, h, d, score: d * centerFactor(dc), max: up > 0 ? up * centerFactor(dc - r) : up };
  };
  const precision = precisionM / 111320;
  const queue = [];
  const push = (c) => {
    let i = queue.length;
    while (i > 0 && queue[i - 1].max < c.max) i--;
    queue.splice(i, 0, c);
  };
  const h0 = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) push(makeCell(x + h0, y + h0, h0));
  }

  let best = makeCell(cx, cy, 0);
  const bboxCell = makeCell(minX + (maxX - minX) / 2, minY + (maxY - minY) / 2, 0);
  if (bboxCell.score > best.score) best = bboxCell;

  while (queue.length) {
    const cell = queue.shift();
    if (cell.score > best.score) best = cell;
    if (cell.max - best.score <= precision) continue;
    const h = cell.h / 2;
    push(makeCell(cell.x - h, cell.y - h, h));
    push(makeCell(cell.x + h, cell.y - h, h));
    push(makeCell(cell.x - h, cell.y + h, h));
    push(makeCell(cell.x + h, cell.y + h, h));
  }
  return toResult(best);
}

const scriptPromises = {};
export function loadScript(src, integrity) {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      if (integrity) {
        el.integrity = integrity;
        el.crossOrigin = 'anonymous';
      }
      el.onload = resolve;
      el.onerror = () => {
        delete scriptPromises[src];
        reject(new Error(`Không tải được ${src}`));
      };
      document.head.appendChild(el);
    });
  }
  return scriptPromises[src];
}

// html2pdf (kèm html2canvas) chỉ tải khi xuất PDF / chụp ảnh, không chặn lúc mở trang
export function loadHtml2Pdf() {
  return loadScript(
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'sha384-Yv5O+t3uE3hunW8uyrbpPW3iw6/5/Y7HitWJBLgqfMoA36NogMmy+8wWZMpn3HWc'
  );
}

export function loadHtml2Canvas() {
  return loadScript(
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H'
  );
}

// Ký hiệu đầu chuỗi thông báo → icon SVG (giữ quy ước viết thông báo cũ: "⏳ Đang...", "✓ Đã...", "❌ Lỗi...")
const STATUS_MARKS = [
  [/^(?:✅|✓)\s*/u, 'check'],
  [/^❌\s*/u, 'error'],
  [/^⚠\uFE0F?\s*/u, 'alert'],
  [/^(?:⏳|🔄|🚀)\s*/u, 'clock'],
  [/^(?:👉|🔒)\s*/u, 'info'],
];

/** Đặt nội dung thông báo cho el: ký hiệu đầu chuỗi đổi thành icon, phần chữ được escape */
export function setStatusContent(el, text, fallbackIcon = null) {
  let rest = String(text ?? '');
  let icon = fallbackIcon;
  for (const [re, name] of STATUS_MARKS) {
    const m = rest.match(re);
    if (m) { icon = name; rest = rest.slice(m[0].length); break; }
  }
  el.innerHTML = rest ? `${icon ? ico(icon) : ''}${escapeHtml(rest)}` : '';
}

const TOAST_ICONS = { success: 'check', error: 'error', info: 'info' };
let toastTimer = null;
export function showToast(message, type = 'info') {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = `app-toast ${type}`;
  setStatusContent(el, message, TOAST_ICONS[type]);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
