// Cache-Control gắn lên object GCS. Chuỗi rỗng = không đụng object đó.
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const INFRA_JSON = 'public, max-age=60, must-revalidate';

export function cacheControlFor(name) {
  const n = String(name || '').replace(/^\/+/, '');
  if (!n || n.includes('..') || n.includes('\\')) return 'private, no-store';
  if (n === 'infrastructure_hue.json') return INFRA_JSON;
  if (n === 'cadastre/thuadat-2016.pmtiles') return IMMUTABLE;
  if (n === 'gba/buildings.pmtiles') return IMMUTABLE;
  if (n.startsWith('cache/sat/v1/') && n.endsWith('.png')) return IMMUTABLE;
  if (n.startsWith('chuyen-nganh/v1/')) return IMMUTABLE;
  if (n === 'cho-duyet' || n.startsWith('cho-duyet/')) return 'private, no-store';
  if (/^kien-truc\/[a-z0-9]+(?:-[a-z0-9]+)*\/quy-che\.pdf$/.test(n)) return INFRA_JSON;
  return '';
}

export function edgeCacheable(cacheControl) {
  const cc = String(cacheControl || '');
  if (!/public/.test(cc) || /no-store|private/.test(cc)) return false;
  const m = /max-age=(\d+)/.exec(cc);
  return !!(m && Number(m[1]) >= 60);
}
