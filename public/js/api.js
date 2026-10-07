/**
 * Live Server (5500/5501), python -m http.server (8000/8766)... chỉ phục vụ file tĩnh, không chạy /api/gee.
 * Khi preview tĩnh, gọi API production; POST cần nguồn nằm trong ALLOWED_ORIGINS (config/constants.js).
 */
const PROD_GEE = 'https://web-hatang-hue-4.vercel.app/api/gee';
const STATIC_DEV_PORTS = new Set(['5500', '5501', '8080', '8000', '8766']);

export function geeApi(search = '') {
  const useRemote =
    location.protocol === 'file:' ||
    STATIC_DEV_PORTS.has(String(location.port));
  const base = useRemote ? PROD_GEE : '/api/gee';
  if (!search) return base;
  return `${base}?${String(search).replace(/^\?/, '')}`;
}

// Danh sách công trình được CDN giữ tối đa 30 s + 120 s stale-while-revalidate (api/gee.js):
// trình duyệt vừa ghi dữ liệu thì trong 3 phút luôn lấy bản mới, bỏ qua CDN
const WRITE_KEY = 'qh_data_written_at';
const FRESH_WINDOW_MS = 3 * 60 * 1000;

export function markDataWritten() {
  try { localStorage.setItem(WRITE_KEY, String(Date.now())); } catch (e) { /* chế độ riêng tư */ }
}

export function infraListUrl() {
  let writtenAt = 0;
  try { writtenAt = Number(localStorage.getItem(WRITE_KEY)) || 0; } catch (e) { /* chế độ riêng tư */ }
  return Date.now() - writtenAt < FRESH_WINDOW_MS ? geeApi(`fresh=${writtenAt}`) : geeApi();
}
