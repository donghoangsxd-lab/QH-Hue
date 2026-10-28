// Leaflet 1.9.4 (khi không khai báo riêng): scrollWheelZoom true, wheelDebounceTime 40,
// wheelPxPerZoomLevel 60, zoomSnap 1, zoomDelta 1. Delta còn bị chia cho wheelPxFactor
// (Linux Chrome = devicePixelRatio, macOS = 3×, còn lại 2×) rồi đưa qua sigmoid trong
// _performZoom, nên một nấc lúc +1 lúc +2 và một vòng xoay nhanh bị nén.
// Mặc định: mỗi sự kiện nấc chuột = đúng 1 cấp (không nhân theo |deltaY| lớn).
// deltaY pixel dưới NOTCH_PX, hoặc ctrl/meta (pinch trackpad), giữ tỉ lệ
// TRACK_PX_PER_LEVEL px = 1 mức và không làm tròn giữa chừng.

export const NOTCH_PX = 40;
export const TRACK_PX_PER_LEVEL = 100;
export const NOTCH_FLUSH_MS = 50;
export const TRACK_SNAP_MS = 180;

export function wheelPixels(e) {
  const dy = Number(e && e.deltaY) || 0;
  const mode = (e && e.deltaMode) || 0;
  if (mode === 1) return dy * 16;
  if (mode === 2) return dy * 400;
  return dy;
}

/** Dương = phóng to. 0 = không phải nấc rời (trackpad). Mỗi nấc tối đa ±1 cấp. */
export function wheelNotches(e) {
  const dy = Number(e && e.deltaY) || 0;
  if (!dy) return 0;
  const sign = dy > 0 ? -1 : 1;
  const mode = (e && e.deltaMode) || 0;
  if (mode === 1) return Math.abs(dy) >= 1 ? sign : 0;
  if (mode === 2) return Math.abs(dy) >= 1 ? sign : 0;
  const px = Math.abs(dy);
  if (px < NOTCH_PX) return 0;
  return sign;
}

export function isPinchWheel(e) {
  return !!(e && (e.ctrlKey || e.metaKey));
}

export function classifyWheel(e) {
  if (isPinchWheel(e)) {
    const pixels = wheelPixels(e);
    return pixels ? { kind: 'track', pixels } : { kind: 'ignore' };
  }
  const steps = wheelNotches(e);
  if (steps) return { kind: 'notch', steps };
  const pixels = wheelPixels(e);
  if (pixels) return { kind: 'track', pixels };
  return { kind: 'ignore' };
}

export function notchZoom(zoom, steps, limits = {}) {
  if (!steps) return zoom;
  const snap = limits.zoomSnap || 0;
  const delta = limits.zoomDelta == null ? 1 : limits.zoomDelta;
  const base = snap ? Math.round(zoom / snap) * snap : zoom;
  const next = base + steps * delta;
  const min = Number.isFinite(limits.minZoom) ? limits.minZoom : -Infinity;
  const max = Number.isFinite(limits.maxZoom) ? limits.maxZoom : Infinity;
  return Math.min(max, Math.max(min, next));
}

export function trackZoom(zoom, pixels, limits = {}) {
  if (!pixels) return zoom;
  const per = limits.pxPerLevel || TRACK_PX_PER_LEVEL;
  const next = zoom - pixels / per;
  const min = Number.isFinite(limits.minZoom) ? limits.minZoom : -Infinity;
  const max = Number.isFinite(limits.maxZoom) ? limits.maxZoom : Infinity;
  return Math.min(max, Math.max(min, next));
}

export function snapZoom(zoom, limits = {}) {
  const snap = limits.zoomSnap || 0;
  const next = snap ? Math.round(zoom / snap) * snap : zoom;
  const min = Number.isFinite(limits.minZoom) ? limits.minZoom : -Infinity;
  const max = Number.isFinite(limits.maxZoom) ? limits.maxZoom : Infinity;
  return Math.min(max, Math.max(min, next));
}

function liveZoom(map) {
  if (map._animatingZoom && Number.isFinite(map._animateToZoom)) return map._animateToZoom;
  return map.getZoom();
}

function limitsOf(map) {
  return {
    zoomDelta: map.options.zoomDelta == null ? 1 : map.options.zoomDelta,
    zoomSnap: map.options.zoomSnap == null ? 1 : map.options.zoomSnap,
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom()
  };
}

function commitZoom(map, point, zoom, fractional) {
  if (map._animatingZoom) {
    map._animatingZoom = false;
    if (map._mapPane) map._mapPane.classList.remove('leaflet-zoom-anim');
  }
  const prev = map.options.zoomSnap;
  if (fractional) map.options.zoomSnap = 0;
  try {
    map.setZoomAround(point, zoom, { animate: false });
  } finally {
    map.options.zoomSnap = prev;
  }
}

export function bindNotchZoom(map) {
  if (!map || map._notchZoomBound) return;
  map._notchZoomBound = true;
  if (map.scrollWheelZoom) map.scrollWheelZoom.disable();

  const el = map.getContainer();
  el.dataset.notchZoom = '1';
  let acc = 0;
  let flushTimer = 0;
  let snapTimer = 0;
  let point = null;

  function flush() {
    flushTimer = 0;
    if (!acc) return;
    // Một lần flush = đúng 1 cấp; nấc còn lại xếp hàng để không nhảy nhiều cấp cùng lúc.
    const steps = acc > 0 ? 1 : -1;
    acc -= steps;
    const cur = liveZoom(map);
    const next = notchZoom(cur, steps, limitsOf(map));
    if (Math.abs(next - cur) >= 1e-6) commitZoom(map, point, next, false);
    if (acc) flushTimer = setTimeout(flush, NOTCH_FLUSH_MS);
  }

  function snapIdle() {
    snapTimer = 0;
    const next = snapZoom(liveZoom(map), limitsOf(map));
    if (Math.abs(next - map.getZoom()) < 1e-6) return;
    commitZoom(map, point, next, false);
  }

  el.addEventListener('wheel', (e) => {
    if (!map._loaded) return;
    L.DomEvent.stop(e);
    point = map.mouseEventToContainerPoint(e);
    const kind = classifyWheel(e);
    if (kind.kind === 'notch') {
      if (snapTimer) {
        clearTimeout(snapTimer);
        snapTimer = 0;
      }
      acc += kind.steps;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, NOTCH_FLUSH_MS);
      return;
    }
    if (kind.kind !== 'track') return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }
    const next = trackZoom(liveZoom(map), kind.pixels, limitsOf(map));
    commitZoom(map, point, next, true);
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(snapIdle, TRACK_SNAP_MS);
  }, { passive: false, capture: true });
}

export function bindDeckNotchZoom(el, getState, setZoom) {
  if (!el || el._deckNotchZoom) return;
  el._deckNotchZoom = true;
  let acc = 0;
  let timer = 0;

  function state() {
    return getState() || { zoom: 0 };
  }

  function limits() {
    const s = state();
    return {
      zoomDelta: 1,
      zoomSnap: 0,
      minZoom: Number.isFinite(s.minZoom) ? s.minZoom : -Infinity,
      maxZoom: Number.isFinite(s.maxZoom) ? s.maxZoom : Infinity
    };
  }

  function apply(zoom) {
    el._wheelZoom = zoom;
    setZoom(zoom);
  }

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const kind = classifyWheel(e);
    if (kind.kind === 'notch') {
      acc += kind.steps;
      if (timer) clearTimeout(timer);
      const drain = () => {
        timer = 0;
        if (!acc) return;
        const steps = acc > 0 ? 1 : -1;
        acc -= steps;
        const cur = state().zoom;
        const next = notchZoom(cur, steps, limits());
        if (Math.abs(next - cur) >= 1e-6) apply(next);
        if (acc) timer = setTimeout(drain, NOTCH_FLUSH_MS);
      };
      timer = setTimeout(drain, NOTCH_FLUSH_MS);
      return;
    }
    if (kind.kind !== 'track') return;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      if (acc) {
        apply(notchZoom(state().zoom, acc, limits()));
        acc = 0;
      }
    }
    apply(trackZoom(state().zoom, kind.pixels, limits()));
  }, { capture: true, passive: false });

  const s0 = state();
  if (Number.isFinite(s0.zoom)) el._wheelZoom = s0.zoom;
}
