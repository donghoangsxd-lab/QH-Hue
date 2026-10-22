// Ô năm đã chốt lấy thẳng PNG trên bucket. Ô chưa có, hoặc lớp năm đang chạy, đi qua /api/gee?action=getSatTile.
// Giới hạn 4 ô cùng lúc và một lần thử lại: Earth Engine 429/quá hạn, và mỗi lần thử lại giữ hàm Fluid.
// Chỉ báo tileload khi có ảnh; tileerror sau khi hết lần thử — không tính ô lỗi là đã tải.

export const TILE_CONCURRENCY = 4;
export const TILE_RETRIES = 1;

let active = 0;
const waiters = [];

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function acquire(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active < TILE_CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      reject(abortError());
    };
    waiters.push(waiter);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) {
    active += 1;
    next();
  }
}

export function resetTileQueue() {
  active = 0;
  waiters.splice(0, waiters.length);
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}

// Ô heatmap/dân cư ngoài vùng tô màu: Earth Engine trả 400 «empty / fully masked», trình duyệt coi là ảnh hỏng.
// Đó không phải ô lỗi (đúng lý do một khung nhìn báo hàng chục «lỗi» trong khi vùng có hạ tầng vẫn hiện).
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

function emptyTile() {
  return new Blob([EMPTY_PNG], { type: 'image/png' });
}

function isMaskedTile(status, text) {
  return (status === 400 || status === 404) && /empty|fully masked|masked/i.test(String(text || ''));
}

/** Tải một ô. Ném lỗi khi hết lần thử. sleep tiêm vào để kiểm thử không chờ thật. */
export async function fetchGeeTile(url, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  const wait = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const signal = opts.signal;
  let last = new Error('tile');
  for (let attempt = 0; attempt <= TILE_RETRIES; attempt++) {
    if (signal?.aborted) throw abortError();
    await acquire(signal);
    let retry = false;
    try {
      const res = await doFetch(url, { signal, cache: 'default' });
      if (res.ok) {
        const blob = await res.blob();
        const type = blob.type || res.headers?.get?.('content-type') || '';
        if (!type || type.includes('image') || type.includes('octet-stream')) return blob;
        last = new Error('not-image');
        retry = true;
      } else {
        const text = await res.text().catch(() => '');
        if (isMaskedTile(res.status, text)) return emptyTile();
        last = new Error(`HTTP ${res.status}`);
        last.status = res.status;
        retry = shouldRetry(res.status);
        if (!retry) throw last;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      last = err;
      retry = !err?.status || shouldRetry(err.status);
      if (!retry) throw err;
    } finally {
      release();
    }
    if (!retry || attempt === TILE_RETRIES) break;
    await wait(300 * 2 ** attempt + Math.floor(Math.random() * 150));
  }
  throw last;
}

let GeeTiles = null;

function layerClass() {
  if (GeeTiles) return GeeTiles;
  GeeTiles = L.GridLayer.extend({
    options: { updateWhenZooming: false, keepBuffer: 1 },
    initialize(url, options) {
      this._url = url;
      L.GridLayer.prototype.initialize.call(this, options);
    },
    setUrl(url, fallback) {
      const next = fallback == null ? (this.options.fallbackUrl || '') : fallback;
      if (this._url === url && (this.options.fallbackUrl || '') === next) return this;
      this._url = url;
      if (fallback != null) this.options.fallbackUrl = fallback;
      this.redraw();
      return this;
    },
    getTileUrl(coords) {
      return L.Util.template(this._url, coords);
    },
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      const ctrl = new AbortController();
      img._abortGee = () => ctrl.abort();
      const fallback = this.options.fallbackUrl ? L.Util.template(this.options.fallbackUrl, coords) : '';
      const primary = this.getTileUrl(coords);
      const load = fetchGeeTile(primary, { signal: ctrl.signal }).catch(err => {
        if (!fallback || err?.name === 'AbortError') throw err;
        const status = err?.status;
        if (status && status !== 404 && status !== 403 && status < 500) throw err;
        return fetchGeeTile(fallback, { signal: ctrl.signal });
      });
      load.then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        if (ctrl.signal.aborted) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          if (!ctrl.signal.aborted) done(null, img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          img.classList.add('gee-tile-miss');
          if (!ctrl.signal.aborted) done(new Error('tile'), img);
        };
        img.src = blobUrl;
      }, err => {
        if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
        img.classList.add('gee-tile-miss');
        done(err, img);
      });
      return img;
    },
    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      this._onUnload = (ev) => { if (ev.tile && ev.tile._abortGee) ev.tile._abortGee(); };
      this.on('tileunload', this._onUnload);
    },
    onRemove(map) {
      if (this._onUnload) this.off('tileunload', this._onUnload);
      L.GridLayer.prototype.onRemove.call(this, map);
    }
  });
  return GeeTiles;
}

export function geeTileLayer(url, options) {
  return new (layerClass())(url, options);
}
