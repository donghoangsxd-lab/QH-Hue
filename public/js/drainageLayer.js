// Lớp "Thoát nước, khe tụ thủy": mạng lưới dòng chảy (drainage/thoatnuoc.topojson trên bucket, đường vẽ xuôi dòng).
// Nét đứt xanh ngọc trượt theo chiều nước chảy, mũi tên ở cuối mỗi đoạn chỉ hạ lưu; nét dày theo bậc Shreve (m).
// Mỗi bản đồ 2 canvas: nền + mũi tên vẽ lại khi dừng kéo / zoom; nét đứt vẽ lại mỗi khung (≤ 30 fps), chỉ đổi lineDashOffset.
import { map } from './mapEngine.js';
import { planMap, isCompareOn } from './planMap.js';
import { geeApi } from './api.js';

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

// Web Mercator ở zoom 0 (0..256), trùng map.project(latlng, 0) của Leaflet
const D2R = Math.PI / 180;
const mercX = (lng) => (lng + 180) / 360 * 256;
const mercY = (lat) => {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};

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
      .then(topo => { lines = decodeTopo(topo); return lines; })
      .catch(err => { dataPromise = null; throw err; });
  }
  return dataPromise;
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
    lines.forEach(ln => {
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
    this._view = { tl, size, paths, used };

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
    fitCanvas(this._flow, size, FLOW_DPR);
  },

  _frame(now) {
    const m = this._map;
    if (!m || !lines || this._zooming) return;
    if (!this._isActive()) {
      if (this._view) {
        this._view = null;
        this._base.width = this._base.height = this._flow.width = this._flow.height = 0;
      }
      return;
    }
    if (!this._view) this._build();
    else if (this._reduce) return;
    const { tl, size, paths, used } = this._view;
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
  }
});

let visible = false;
let leftLayer = null, rightLayer = null;

function setStatus(text) {
  const el = $('drainageStatus');
  if (el) el.textContent = text;
}

function syncLayers() {
  const on = visible && !!lines && !!map;
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
  if (!visible) { syncLayers(); setStatus(''); return; }
  if (lines) { syncLayers(); setStatus(''); return; }
  setStatus('Đang tải mạng lưới thoát nước…');
  loadDrainage().then(() => {
    setStatus('');
    syncLayers();
  }).catch(err => {
    console.warn('Không tải được lớp thoát nước:', err);
    setStatus(`Chưa tải được: ${err.message}`);
  });
}

export function initDrainageLayer() {
  $('chk_drainage')?.addEventListener('change', (e) => setDrainageVisible(e.target.checked));
}
