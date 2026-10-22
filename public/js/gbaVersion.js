// Tăng khi thay buildings.pmtiles, agg.json hoặc bldg-hf.bin. Khớp tên cache trong sw.js.
export const GBA_V = '20261021';

export function withAssetVersion(href, base) {
  const root = base || (typeof document !== 'undefined' ? document.baseURI : 'https://local.invalid/');
  const u = new URL(href, root);
  u.searchParams.set('v', GBA_V);
  return u.href;
}
