/**
 * Live Server (cổng 5500) chỉ phục vụ file tĩnh, không chạy /api/gee.
 * Khi preview tĩnh, gọi API production (CORS * đã bật trên Vercel).
 */
const PROD_GEE = 'https://web-hatang-hue-4.vercel.app/api/gee';
const STATIC_DEV_PORTS = new Set(['5500', '5501', '8080', '8000']);

export function geeApi(search = '') {
  const useRemote =
    location.protocol === 'file:' ||
    STATIC_DEV_PORTS.has(String(location.port));
  const base = useRemote ? PROD_GEE : '/api/gee';
  if (!search) return base;
  return `${base}?${String(search).replace(/^\?/, '')}`;
}
