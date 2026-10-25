// Cache-Control gắn lên object GCS. Chuỗi rỗng = không đụng object đó.
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const INFRA_JSON = 'public, max-age=60, must-revalidate';
// PDF docs/ ghi đè cùng khóa (quyết định đã ban hành). Không immutable.
export const DOCS_PDF = 'public, max-age=86400';

export function cacheControlFor(name) {
  const n = String(name || '').replace(/^\/+/, '');
  if (!n || n.includes('..') || n.includes('\\')) return 'private, no-store';
  if (n === 'infrastructure_hue.json') return INFRA_JSON;
  if (n === 'cadastre/thuadat-2016.pmtiles') return IMMUTABLE;
  if (n === 'gba/buildings.pmtiles') return IMMUTABLE;
  if (n.startsWith('cache/sat/v1/') && n.endsWith('.png')) return IMMUTABLE;
  if (n.startsWith('chuyen-nganh/v1/')) return IMMUTABLE;
  if (n === 'cho-duyet' || n.startsWith('cho-duyet/')) return 'private, no-store';
  if (n === 'projects/_pdf-in' || n.startsWith('projects/_pdf-in/')) return 'private, no-store';
  if (n === 'quyet-dinh-cho.pdf' || n.endsWith('/quyet-dinh-cho.pdf')) return 'private, no-store';
  if (/^kien-truc\/[a-z0-9]+(?:-[a-z0-9]+)*\/quy-che\.pdf$/.test(n)) return INFRA_JSON;
  if (/^docs\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf$/.test(n)) return DOCS_PDF;
  return '';
}

export function edgeCacheable(cacheControl) {
  const cc = String(cacheControl || '');
  if (!/public/.test(cc) || /no-store|private/.test(cc)) return false;
  const m = /max-age=(\d+)/.exec(cc);
  return !!(m && Number(m[1]) >= 60);
}
