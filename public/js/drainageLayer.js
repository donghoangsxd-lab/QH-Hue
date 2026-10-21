// Lớp "Thoát nước, khe tụ thủy": mạng lưới dòng chảy (drainage/thoatnuoc.topojson trên bucket, đường vẽ xuôi dòng).
// Nét đứt xanh ngọc trượt theo chiều nước chảy, mũi tên ở cuối mỗi đoạn chỉ hạ lưu; nét dày theo bậc Shreve (m).
// Từ ARROW_MIN_ZOOM thêm mũi tên hướng thoát nước mặt vùng xây dựng (drainage/huongthoat/, scripts/build-huongthoat.js):
// chia ô z12, chỉ tải ô phủ khung nhìn; nét đứt cyan dài dọc phố.
// Lúc xem, sông và kênh của lớp đường thủy nội địa chuẩn hóa cửa xả và mũi tên (drainageNorm.js): bám mép, đảo hướng
// nếu lệch tuyến nước, gắn nguồn tiếp nhận. File trên bucket giữ nguyên. Mũi tên cần rà vẽ hổ phách.
// Mỗi bản đồ 2 canvas: nền + mũi tên vẽ lại khi dừng kéo / zoom; nét đứt vẽ lại mỗi khung (≤ 30 fps), chỉ đổi lineDashOffset.
import { map } from './mapEngine.js';
import { planMap, isCompareOn } from './planMap.js';
import { geeApi } from './api.js';
import { loadOsmOpen, osmWaterInput } from './osmOpen.js';
import {
  buildWaterIndex, waterwaysFromFeatures, normalizePolyline, outfallIndexes, mercXY, unmerc
} from './drainageNorm.js';

const $ = (id) => document.getElementById(id);

// 4 cấp nét theo bậc Shreve: khe đầu nguồn → dòng chính
const CLASSES = [
  { minM: 1, w: 1.1 },
  { minM: 2, w: 1.7 },
  { minM: 8, w: 2.5 },
  { minM: 64, w: 3.6 }
].map(c => ({ ...c, dash: [c.w * 3 + 4, c.w * 3 + 7], speed: 16 + c.w * 6 }));
const FPS_MS = 33;
// Canvas nét đứt vẽ lại mỗi khung: giữ 1 pixel/CSS px (màn hình 2x đỡ 4 lần khối lượng tô)
const FLOW_DPR = 1;
const SIMPLIFY_PX = 1.5;
const ARROW_MIN_PX = 36;
const ARROW_MIN_ZOOM = 14;
const SURFACE = { w: 2.5, dash: [7, 6], speed: 14, head: 11, headW: 5.5 };

/** Thu nhỏ bản đồ thì chỉ vẽ dòng có nhiều nhánh đổ về (bậc ≥ ngưỡng) — đỡ rối và đỡ tốn khung hình */
function minMagFor(z) {
  if (z >= 13) return 1;
  if (z >= 12) return 2;
  if (z >= 11) return 4;
  if (z >= 10) return 8;
  return 32;
}

function classOf(m) {
  for (let i = CLASSES.length - 1; i > 0; i--) if (m >= CLASSES[i].minM) return i;
  return 0;
}

// Web Mercator ở zoom 0 (0..256), trùng map.project(latlng, 0) của Leaflet — cùng công thức drainageNorm.js
const mercX = (lng) => mercXY(lng, 0)[0];
const mercY = (lat) => mercXY(0, lat)[1];

/** TopoJSON → [{ c: Float64Array [x0,y0,x1,y1…] Mercator zoom 0, minX, minY, maxX, maxY, m }] */
function decodeTopo(topo) {
  const tf = topo.transform;
  const arcs = topo.arcs.map(arc => {
    const out = new Float64Array(arc.length * 2);
    let x = 0, y = 0;
    arc.forEach((pt, i) => {
      let lng = pt[0], lat = pt[1];
      if (tf) {
        x += pt[0]; y += pt[1];
        lng = x * tf.scale[0] + tf.translate[0];
        lat = y * tf.scale[1] + tf.translate[1];
      }
      out[i * 2] = mercX(lng);
      out[i * 2 + 1] = mercY(lat);
    });
    return out;
  });
  const obj = topo.objects && (topo.objects.data || Object.values(topo.objects)[0]);
  const lines = [];
  (obj && obj.geometries || []).forEach(g => {
    if (g.type !== 'LineString' || !Array.isArray(g.arcs)) return;
    const parts = g.arcs.map(i => {
      if (i >= 0) return arcs[i];
      const a = arcs[~i], r = new Float64Array(a.length);
      for (let k = 0; k < a.length; k += 2) { r[k] = a[a.length - 2 - k]; r[k + 1] = a[a.length - 1 - k]; }
      return r;
    });
    const n = parts.reduce((s, p) => s + p.length, 0);
    const c = new Float64Array(n);
    let off = 0;
    parts.forEach(p => { c.set(p, off); off += p.length; });
    if (c.length < 4) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < c.length; k += 2) {
      if (c[k] < minX) minX = c[k];
      if (c[k] > maxX) maxX = c[k];
      if (c[k + 1] < minY) minY = c[k + 1];
      if (c[k + 1] > maxY) maxY = c[k + 1];
    }
    const p = g.properties || {};
    lines.push({ c, minX, minY, maxX, maxY, m: Number(p.m) || 1 });
  });
  return lines;
}

let dataPromise = null;
let lines = null;

function loadDrainage() {
  if (lines) return Promise.resolve(lines);
  if (!dataPromise) {
    dataPromise = fetch(geeApi('action=getDrainage'))
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.message || `HTTP ${r.status}`);
        }
        return r.json();
      })
        .then(topo => { lines = decodeTopo(topo); if (waterIndex) applyOutfalls(); return lines; })
      .catch(err => { dataPromise = null; throw err; });
  }
  return dataPromise;
}

// Mũi tên thoát nước mặt: index { z, at, tiles }; ô thô giữ để chuẩn hóa lại khi đổi tuyến nước.
// arrowTiles: key → { stamp, list: [{ c: Float64Array Mercator zoom 0, flag, snapped, reoriented, receiver }] }
let arrowIndex = null;
let arrowIndexPromise = null;
const arrowRaw = new Map();
const arrowTiles = new Map();
const arrowInflight = new Set();
let waterIndex = null;
let waterSrc = null;
let indexStamp = 0;
let outfallBackup = null;
let outfallSnapped = 0;
let outfallReoriented = 0;
let outfallFlagged = 0;

function fetchJson(url) {
  return fetch(url).then(async r => {
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.message || `HTTP ${r.status}`);
    }
    return r.json();
  });
}

/** Ô: { a: [[x0, y0, dx1, dy1, …]] } kinh / vĩ độ × 1e5, đỉnh sau là độ lệch. Có tuyến nước thì bám mép và đảo hướng. */
function decodeArrowTile(tile) {
  return (tile && Array.isArray(tile.a) ? tile.a : []).map(a => {
    const ll = [];
    let x = 0, y = 0;
    for (let k = 0; k + 1 < a.length; k += 2) {
      x += a[k]; y += a[k + 1];
      ll.push([x / 1e5, y / 1e5]);
    }
    return ll;
  }).filter(ll => ll.length >= 2).map(ll => {
    const norm = waterIndex ? normalizePolyline(ll, waterIndex, 'arrow') : {
      coords: ll, snapped: false, reoriented: false, flag: '', receiver: ''
    };
    const c = new Float64Array(norm.coords.length * 2);
    norm.coords.forEach((p, i) => {
      c[i * 2] = mercX(p[0]);
      c[i * 2 + 1] = mercY(p[1]);
    });
    return { c, flag: norm.flag, snapped: norm.snapped, reoriented: norm.reoriented, receiver: norm.receiver || '' };
  }).filter(a => a.c.length >= 4);
}

function storeArrow(key, tile) {
  arrowRaw.set(key, tile);
  arrowTiles.set(key, { stamp: indexStamp, list: decodeArrowTile(tile) });
  refreshCounts();
  refreshViews();
}

/** Tải hết các ô để số liệu bám / đảo / rà là toàn bộ lớp, không chỉ khung nhìn */
function prefetchArrows() {
  if (!arrowIndex || !waterIndex) return;
  const keys = Object.keys(arrowIndex.tiles);
  let active = 0;
  const next = () => {
    while (active < 4 && keys.length) {
      const key = keys.shift();
      if (!arrowIndex.tiles[key] || arrowRaw.has(key) || arrowInflight.has(key)) continue;
      active++;
      arrowInflight.add(key);
      fetchJson(geeApi(`action=getDrainArrows&t=${key}&v=${encodeURIComponent(arrowIndex.at)}`))
        .then(tile => storeArrow(key, tile))
        .catch(err => { console.warn(`Ô mũi tên thoát nước ${key}:`, err.message); })
        .then(() => { arrowInflight.delete(key); active--; next(); });
    }
  };
  next();
}

function syncWater() {
  const src = osmWaterInput();
  if (!src) return false;
  if (src === waterSrc && waterIndex) return true;
  const linesW = waterwaysFromFeatures(src);
  if (!linesW.length) return false;
  waterSrc = src;
  waterIndex = buildWaterIndex(linesW);
  indexStamp++;
  applyOutfalls();
  arrowRaw.forEach((tile, key) => {
    arrowTiles.set(key, { stamp: indexStamp, list: decodeArrowTile(tile) });
  });
  prefetchArrows();
  refreshCounts();
  refreshViews();
  return true;
}

function reversePairs(c) {
  const n = c.length;
  for (let k = 0; k < n / 2; k += 2) {
    const x = c[k], y = c[k + 1];
    c[k] = c[n - 2 - k];
    c[k + 1] = c[n - 1 - k];
    c[n - 2 - k] = x;
    c[n - 1 - k] = y;
  }
}

/** Cửa xả: điểm cuối không có đoạn khác bắt đầu tại đó. Bám sông, kênh; đảo nếu hạ lưu xa tuyến hơn thượng lưu. */
function applyOutfalls() {
  if (outfallBackup && lines) {
    outfallBackup.forEach(b => { lines[b.i].c.set(b.c); });
  }
  outfallBackup = [];
  outfallSnapped = 0;
  outfallReoriented = 0;
  outfallFlagged = 0;
  if (!lines || !waterIndex) return;
  const ll = lines.map(ln => {
    const c = ln.c;
    return [unmerc(c[0], c[1]), unmerc(c[c.length - 2], c[c.length - 1])];
  });
  const mouths = new Set(outfallIndexes(ll));
  lines.forEach((ln, i) => {
    if (!mouths.has(i)) return;
    const [s, e] = ll[i];
    const norm = normalizePolyline([s, e], waterIndex, 'outfall');
    if (!norm.snapped && !norm.reoriented && !norm.flag) return;
    const c = ln.c;
    outfallBackup.push({ i, c: Float64Array.from(c) });
    if (norm.reoriented) {
      reversePairs(c);
      outfallReoriented++;
    }
    if (norm.snapped) {
      const p = norm.coords[norm.coords.length - 1];
      const m = mercXY(p[0], p[1]);
      c[c.length - 2] = m[0];
      c[c.length - 1] = m[1];
      outfallSnapped++;
    }
    if (norm.flag) outfallFlagged++;
    ln.receiver = norm.receiver || '';
  });
}

/**
 * Mũi tên của các ô phủ vùng (Mercator zoom 0) đã có sẵn; ô chưa có thì tải nền, xong gọi onReady để vẽ lại.
 * Lỗi index (chưa đẩy dữ liệu) → coi như không có ô nào trong phiên; lỗi 1 ô → bỏ ô đó.
 */
function ensureArrowIndex() {
  if (arrowIndex) return Promise.resolve(arrowIndex);
  if (!arrowIndexPromise) {
    arrowIndexPromise = fetchJson(geeApi('action=getDrainArrows&t=index'))
      .then(idx => {
        arrowIndex = { z: Number(idx.z) || 12, at: String(idx.at || ''), tiles: idx.tiles || {} };
        prefetchArrows();
        refreshCounts();
      })
      .catch(err => {
        console.warn('Không tải được mũi tên thoát nước mặt:', err.message);
        arrowIndex = { z: 12, at: '', tiles: {} };
      });
  }
  return arrowIndexPromise;
}

function arrowsIn(minX, minY, maxX, maxY, onReady) {
  if (!arrowIndex) {
    ensureArrowIndex().then(onReady);
    return [];
  }
  const { z, at, tiles } = arrowIndex;
  const n = Math.pow(2, z) / 256;
  const out = [];
  for (let tx = Math.floor(minX * n); tx <= Math.floor(maxX * n); tx++) {
    for (let ty = Math.floor(minY * n); ty <= Math.floor(maxY * n); ty++) {
      const key = `${z}_${tx}_${ty}`;
      if (!tiles[key]) continue;
      const cached = arrowTiles.get(key);
      if (cached && cached.stamp === indexStamp) {
        out.push(...cached.list);
        continue;
      }
      if (arrowRaw.has(key)) {
        const list = decodeArrowTile(arrowRaw.get(key));
        arrowTiles.set(key, { stamp: indexStamp, list });
        out.push(...list);
        continue;
      }
      if (arrowInflight.has(key)) continue;
      arrowInflight.add(key);
      fetchJson(geeApi(`action=getDrainArrows&t=${key}&v=${encodeURIComponent(at)}`))
        .then(tile => storeArrow(key, tile))
        .catch(err => { console.warn(`Ô mũi tên thoát nước ${key}:`, err.message); })
        .then(() => arrowInflight.delete(key));
    }
  }
  return out;
}

function makeCanvas(pane, cls) {
  const c = L.DomUtil.create('canvas', cls, pane);
  c.style.position = 'absolute';
  c.style.pointerEvents = 'none';
  return c;
}

function fitCanvas(c, size, dpr) {
  const w = Math.round(size.x * dpr), h = Math.round(size.y * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.style.width = `${size.x}px`;
  c.style.height = `${size.y}px`;
}

const DrainageLayer = L.Layer.extend({
  initialize(isActive) {
    this._isActive = isActive || (() => true);
  },

  onAdd(m) {
    this._map = m;
    if (!m.getPane('drainagePane')) {
      const pane = m.createPane('drainagePane');
      pane.style.zIndex = '380';
      pane.style.pointerEvents = 'none';
    }
    const pane = m.getPane('drainagePane');
    // Nền + mũi tên: vẽ 1 lần mỗi khi dừng kéo / zoom. Nét đứt: canvas riêng, độ phân giải thấp, vẽ lại mỗi khung.
    this._base = makeCanvas(pane, 'drainage-canvas');
    this._flow = makeCanvas(pane, 'drainage-canvas drainage-flow');
    this._view = null;
    this._reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.on('zoomstart', this._hide, this);
    m.on('zoomend moveend viewreset resize', this._invalidate, this);
    this._last = 0;
    const tick = (now) => {
      this._raf = requestAnimationFrame(tick);
      if (now - this._last < FPS_MS) return;
      this._last = now;
      this._frame(now);
    };
    this._raf = requestAnimationFrame(tick);
  },

  onRemove(m) {
    cancelAnimationFrame(this._raf);
    m.off('zoomstart', this._hide, this);
    m.off('zoomend moveend viewreset resize', this._invalidate, this);
    L.DomUtil.remove(this._base);
    L.DomUtil.remove(this._flow);
    this._base = this._flow = null;
    this._view = null;
    this._map = null;
  },

  _hide() {
    this._zooming = true;
    if (this._base) this._base.style.display = this._flow.style.display = 'none';
  },

  _invalidate() {
    this._zooming = false;
    this._view = null;
    if (this._base) this._base.style.display = this._flow.style.display = '';
  },

  /** Dựng Path2D cho khung nhìn (+15% mỗi phía) theo tọa độ layer point, vẽ lớp nền + mũi tên */
  _build() {
    const m = this._map;
    const z = m.getZoom();
    const k = Math.pow(2, z);
    const o = m.getPixelOrigin(), size = m.getSize(), tl = m.containerPointToLayerPoint([0, 0]);
    const padX = size.x * 0.15, padY = size.y * 0.15;
    const minX = (tl.x + o.x - padX) / k, maxX = (tl.x + o.x + size.x + padX) / k;
    const minY = (tl.y + o.y - padY) / k, maxY = (tl.y + o.y + size.y + padY) / k;
    const minM = minMagFor(z);
    const paths = CLASSES.map(() => new Path2D());
    const arrows = new Path2D();
    const used = CLASSES.map(() => false);
    (lines || []).forEach(ln => {
      if (ln.m < minM || ln.maxX < minX || ln.minX > maxX || ln.maxY < minY || ln.minY > maxY) return;
      const ci = classOf(ln.m);
      const path = paths[ci];
      const c = ln.c, last = c.length - 2;
      let lx = c[0] * k - o.x, ly = c[1] * k - o.y, len = 0;
      path.moveTo(lx, ly);
      for (let i = 2; i <= last; i += 2) {
        const x = c[i] * k - o.x, y = c[i + 1] * k - o.y;
        if (i < last && Math.abs(x - lx) + Math.abs(y - ly) < SIMPLIFY_PX) continue;
        path.lineTo(x, y);
        len += Math.hypot(x - lx, y - ly);
        lx = x; ly = y;
      }
      used[ci] = true;
      if (len < ARROW_MIN_PX) return;
      // Hướng mũi tên: từ đỉnh cách điểm cuối ≥ 5 px về điểm cuối
      let bx = lx, by = ly;
      for (let i = last - 2; i >= 0; i -= 2) {
        bx = c[i] * k - o.x; by = c[i + 1] * k - o.y;
        if (Math.hypot(lx - bx, ly - by) >= 5) break;
      }
      const d = Math.hypot(lx - bx, ly - by);
      if (!(d > 0)) return;
      const ux = (lx - bx) / d, uy = (ly - by) / d;
      const w = CLASSES[ci].w;
      const al = 5 + w * 2.2, aw = 2.6 + w * 1.1;
      const tx = lx - ux * 1.5, ty = ly - uy * 1.5;
      arrows.moveTo(tx, ty);
      arrows.lineTo(tx - ux * al - uy * aw, ty - uy * al + ux * aw);
      arrows.lineTo(tx - ux * al * 0.62, ty - uy * al * 0.62);
      arrows.lineTo(tx - ux * al + uy * aw, ty - uy * al - ux * aw);
      arrows.closePath();
    });

    // Mũi tên thoát nước mặt: thân dừng trước đầu mũi tên để nét đứt không chờm lên
    let surface = null, surfaceHeads = null, surfaceFlag = null, headsFlag = null;
    if (z >= ARROW_MIN_ZOOM) {
      syncWater();
      const list = arrowsIn(minX, minY, maxX, maxY, refreshViews);
      if (list.length) {
        surface = new Path2D();
        surfaceHeads = new Path2D();
        surfaceFlag = new Path2D();
        headsFlag = new Path2D();
        const { head: al, headW: aw } = SURFACE;
        list.forEach(arrow => {
          const c = arrow.c;
          const body = arrow.flag ? surfaceFlag : surface;
          const heads = arrow.flag ? headsFlag : surfaceHeads;
          const n = c.length / 2;
          const xs = new Float64Array(n), ys = new Float64Array(n);
          for (let i = 0; i < n; i++) { xs[i] = c[i * 2] * k - o.x; ys[i] = c[i * 2 + 1] * k - o.y; }
          const ex = xs[n - 1], ey = ys[n - 1];
          let j = n - 2;
          while (j > 0 && Math.hypot(ex - xs[j], ey - ys[j]) < al) j--;
          const d = Math.hypot(ex - xs[j], ey - ys[j]);
          if (!(d > 0)) return;
          const ux = (ex - xs[j]) / d, uy = (ey - ys[j]) / d;
          body.moveTo(xs[0], ys[0]);
          for (let i = 1; i <= j; i++) body.lineTo(xs[i], ys[i]);
          body.lineTo(ex - ux * al * 0.6, ey - uy * al * 0.6);
          heads.moveTo(ex, ey);
          heads.lineTo(ex - ux * al - uy * aw, ey - uy * al + ux * aw);
          heads.lineTo(ex - ux * al * 0.62, ey - uy * al * 0.62);
          heads.lineTo(ex - ux * al + uy * aw, ey - uy * al - ux * aw);
          heads.closePath();
        });
      }
    }
    this._view = { tl, size, paths, used, surface, surfaceFlag };

    // Canvas đặt tại góc trên trái khung nhìn; khi kéo bản đồ cả pane trượt theo, không cần vẽ lại
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    [this._base, this._flow].forEach(cv => L.DomUtil.setPosition(cv, tl));
    fitCanvas(this._base, size, dpr);
    const ctx = this._base.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, -tl.x * dpr, -tl.y * dpr);
    ctx.clearRect(tl.x, tl.y, size.x, size.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    CLASSES.forEach((cls, i) => {
      if (!used[i]) return;
      ctx.lineWidth = cls.w * 3;
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.13)';
      ctx.stroke(paths[i]);
      ctx.lineWidth = cls.w;
      ctx.strokeStyle = 'rgba(14, 116, 144, 0.8)';
      ctx.stroke(paths[i]);
    });
    ctx.fillStyle = '#a5f3fc';
    ctx.strokeStyle = 'rgba(8, 47, 73, 0.85)';
    ctx.lineWidth = 0.8;
    ctx.fill(arrows);
    ctx.stroke(arrows);
    const paintArrows = (body, heads, fill) => {
      if (!body) return;
      ctx.lineWidth = SURFACE.w + 2.5;
      ctx.strokeStyle = 'rgba(8, 51, 68, 0.35)';
      ctx.stroke(body);
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#083344';
      ctx.lineWidth = 1;
      ctx.fill(heads);
      ctx.stroke(heads);
    };
    paintArrows(surface, surfaceHeads, '#22d3ee');
    paintArrows(surfaceFlag, headsFlag, '#fbbf24');
    fitCanvas(this._flow, size, FLOW_DPR);
  },

  _frame(now) {
    const m = this._map;
    if (!m || this._zooming) return;
    if (!this._isActive()) {
      if (this._view) {
        this._view = null;
        this._base.width = this._base.height = this._flow.width = this._flow.height = 0;
      }
      return;
    }
    if (!this._view) this._build();
    else if (this._reduce) return;
    const { tl, size, paths, used, surface, surfaceFlag } = this._view;
    const ctx = this._flow.getContext('2d');
    ctx.setTransform(FLOW_DPR, 0, 0, FLOW_DPR, -tl.x * FLOW_DPR, -tl.y * FLOW_DPR);
    ctx.clearRect(tl.x, tl.y, size.x, size.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#67e8f9';
    const t = this._reduce ? 0 : now / 1000;
    CLASSES.forEach((cls, i) => {
      if (!used[i]) return;
      const period = cls.dash[0] + cls.dash[1];
      ctx.lineWidth = cls.w;
      ctx.setLineDash(cls.dash);
      ctx.lineDashOffset = -((t * cls.speed) % period);
      ctx.stroke(paths[i]);
    });
    const dashFlow = (path, color) => {
      if (!path) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = SURFACE.w;
      ctx.setLineDash(SURFACE.dash);
      ctx.lineDashOffset = -((t * SURFACE.speed) % (SURFACE.dash[0] + SURFACE.dash[1]));
      ctx.stroke(path);
    };
    if (surface || surfaceFlag) {
      ctx.lineCap = 'butt';
      dashFlow(surface, '#22d3ee');
      dashFlow(surfaceFlag, '#fbbf24');
    }
  }
});

let visible = false;
let leftLayer = null, rightLayer = null;

function setStatus(text, warn) {
  const el = $('drainageStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-warn', !!warn);
}

/** Dữ liệu mới về (mạng lưới, ô mũi tên) → dựng lại khung nhìn ở khung hình kế tiếp */
function refreshViews() {
  [leftLayer, rightLayer].forEach(l => { if (l) l._view = null; });
}

function refreshCounts() {
  if (!visible) return;
  if (!waterIndex) {
    setStatus('Đang đối chiếu đường thủy nội địa…');
    return;
  }
  let snapped = outfallSnapped, reoriented = outfallReoriented, flagged = outfallFlagged, have = 0;
  arrowTiles.forEach(e => {
    if (!e || e.stamp !== indexStamp) return;
    have++;
    e.list.forEach(a => {
      if (a.snapped) snapped++;
      if (a.reoriented) reoriented++;
      if (a.flag) flagged++;
    });
  });
  const total = arrowIndex ? Object.keys(arrowIndex.tiles).length : 0;
  const tail = total && have < total ? ' Đang tải các ô còn lại.' : '';
  setStatus(`Đối chiếu đường thủy nội địa: bám ${snapped}, đảo hướng ${reoriented}, cần rà ${flagged}.${tail}`);
}

function syncLayers() {
  const on = visible && !!map;
  if (!on) {
    leftLayer?.remove(); leftLayer = null;
    rightLayer?.remove(); rightLayer = null;
    return;
  }
  if (!leftLayer) leftLayer = new DrainageLayer().addTo(map);
  if (planMap && !rightLayer) rightLayer = new DrainageLayer(isCompareOn).addTo(planMap);
}

export function setDrainageVisible(on) {
  visible = !!on;
  const legend = $('drainageLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  syncLayers();
  if (!visible) { setStatus(''); return; }
  if (!lines) setStatus('Đang tải mạng lưới thoát nước…');
  else refreshCounts();
  const net = lines ? Promise.resolve() : loadDrainage().then(() => { refreshViews(); refreshCounts(); });
  const water = loadOsmOpen().then(() => { syncWater(); ensureArrowIndex(); }).catch(() => {
    if (visible && !waterIndex) setStatus('Chưa đối chiếu được đường thủy nội địa.', true);
  });
  Promise.all([net, water]).catch(err => {
    console.warn('Không tải được lớp thoát nước:', err);
    if (!lines) setStatus(`Chưa tải được: ${err.message}`, true);
  });
}

export function initDrainageLayer() {
  $('chk_drainage')?.addEventListener('change', (e) => setDrainageVisible(e.target.checked));
}
