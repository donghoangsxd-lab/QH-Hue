// Tăng khi đổi file nặng (pmtiles, agg, bldg-hf, bldg-overrides, qh-hientrang, QHC 2045).
// ?v= là tên phiên bản: trình duyệt giữ bản immutable, file mới chỉ cần tăng số này.
// Khớp tên cache trong sw.js. HTML/JS/CSS không dùng số này — các file đó luôn tải mới.
export const GBA_V = '20261026';
// Đối chiếu query trên index.html. Đổi khi muốn cắt URL cũ của app.js / style.css.
export const SHELL_V = '20261052';

export function withAssetVersion(href, base) {
  const root = base || (typeof document !== 'undefined' ? document.baseURI : 'https://local.invalid/');
  const u = new URL(href, root);
  u.searchParams.set('v', GBA_V);
  return u.href;
}
