/**
 * Tiện ích dùng chung: chống XSS khi ghép HTML, định dạng số kiểu Việt Nam, khoảng cách, tải thư viện khi cần.
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Mọi chuỗi lấy từ dữ liệu (tên công trình, phường, ghi chú...) phải qua hàm này trước khi đưa vào innerHTML
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
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
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
