// Bộ nhớ trình duyệt cho file tĩnh và ô PMTiles (Range). Không tải trước, không giữ ảnh Google.
// Tên cache khớp GBA_V trong gbaVersion.js: đổi phiên bản thì bỏ cache cũ.
const CACHE = 'qh-hue-20261021';
const GCS = 'https://storage.googleapis.com/hue-infra-data-us/';

function versioned(url) {
  try { return new URL(url).searchParams.has('v'); } catch (e) { return false; }
}

function gbaAsset(url) {
  return url.includes('/gba/buildings.pmtiles') || url.includes('/gba/agg.json')
    || url.includes('/data/gba/bldg-hf.bin') || url.includes('/data/gba/bldg-hf.json');
}

function cacheable(url) {
  if (versioned(url) && gbaAsset(url)) return true;
  // GBA không có ?v= vẫn bị ghi đè cùng đường dẫn: không giữ.
  if (url.startsWith(GCS)) return !url.includes('/gba/');
  if (!url.startsWith(self.location.origin)) return false;
  if (url.includes('/data/ward-boundary.json')) return true;
  return /\/api\/gee\?[^#]*action=(getBoundaryVector|getOsmOpen|getMainRoads)(?:&|$)/.test(url);
}

function longLived(res) {
  const cc = res.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/.exec(cc);
  return !!(m && Number(m[1]) >= 86400);
}

function rangeKey(request) {
  const range = request.headers.get('range');
  if (!range) return request;
  const url = request.url + (request.url.includes('?') ? '&' : '?') + 'qh-range=' + encodeURIComponent(range);
  return new Request(url, { method: 'GET' });
}

function partial(buf, contentRange, contentType) {
  return new Response(buf, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(buf.byteLength),
      'Content-Range': contentRange,
      'Accept-Ranges': 'bytes'
    }
  });
}

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !cacheable(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = rangeKey(request);
    const hit = await cache.match(key);
    if (hit) {
      const contentRange = hit.headers.get('x-content-range');
      if (contentRange) return partial(await hit.arrayBuffer(), contentRange, hit.headers.get('content-type'));
      return hit;
    }
    const res = await fetch(request);
    if (res.type === 'opaque' || res.type === 'opaqueredirect') return res;
    const keep = versioned(request.url) || request.url.startsWith(self.location.origin) || longLived(res);
    if (res.status === 206) {
      const contentRange = res.headers.get('content-range');
      if (contentRange && keep) {
        const stored = new Response(res.clone().body, {
          status: 200,
          headers: {
            'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
            'X-Content-Range': contentRange
          }
        });
        cache.put(key, stored);
      }
      return res;
    }
    if (res.ok && keep) cache.put(key, res.clone());
    return res;
  })());
});
