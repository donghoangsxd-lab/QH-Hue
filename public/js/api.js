/**
 * Live Server (5500/5501), python -m http.server (8000/8766/8791)... chỉ phục vụ file tĩnh, không chạy /api/gee.
 * Khi preview tĩnh, gọi API production; POST cần nguồn nằm trong ALLOWED_ORIGINS (config/constants.js).
 */
const PROD_ORIGIN = 'https://qh-hue.donghoangsxd.workers.dev';
const PROD_GEE = `${PROD_ORIGIN}/api/gee`;
const STATIC_DEV_PORTS = new Set(['5500', '5501', '8080', '8000', '8766', '8791']);

function useRemoteApi() {
  return location.protocol === 'file:' || STATIC_DEV_PORTS.has(String(location.port));
}

export function geeApi(search = '') {
  const base = useRemoteApi() ? PROD_GEE : '/api/gee';
  if (!search) return base;
  return `${base}?${String(search).replace(/^\?/, '')}`;
}

/** Object GCS qua Worker `/gcs/…` (cùng origin khi Wrangler; preview tĩnh → production). */
export function gcsUrl(objectPath = '') {
  const name = String(objectPath || '').replace(/^\/+/, '');
  const base = useRemoteApi() ? PROD_ORIGIN : '';
  return `${base}/gcs/${name}`;
}

// Danh sách công trình: CDN giữ 10 phút + 1 giờ stale-while-revalidate (api/gee.js).
// Trình duyệt vừa ghi dữ liệu thì trong 3 phút gọi fresh= để bỏ qua bản CDN.
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
