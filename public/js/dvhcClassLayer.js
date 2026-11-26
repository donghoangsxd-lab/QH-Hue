// Bản đồ phân loại ĐVHC (tab Hành chính): tô phường/xã theo trình độ + ký hiệu II/III trên phường.
// HT → QĐ 614 (wardMarks.ht); QH → QĐ 756 (wardMarks.plan). Xã / chưa xếp loại: nền xanh, không số.
import { map, WARD_BOUNDS_EVENT } from './mapEngine.js';
import { getWardDraw } from './wardSeam.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { wardMarks } from './doThiQd756.js';
import { DVHC_CITY, dvhcOf } from './dvhcStats.js';

const FILL_PANE = 'dvhcClassPane';
const BADGE_PANE = 'dvhcBadgePane';
const LEVEL_FILL = { II: '#ef4444', III: '#fb923c' };
const XA_FILL = '#4ade80';
const BADGE_MAX_ZOOM = 15;
const BADGE_SMALL_ZOOM = 10;
let userFillMul = 1;
const zoomFill = (z) => (z <= 10 ? 0.55 : z <= 11 ? 0.42 : z <= 12 ? 0.3 : z <= 14 ? 0.14 : 0.06);
const fillOpacity = (z) => zoomFill(z) * userFillMul;

const SealCanvas = L.Canvas.extend({
  onAdd(host) {
    L.Canvas.prototype.onAdd.call(this, host);
    this._applySealOpacity();
  },
  setSealOpacity(op) {
    this.options.sealOpacity = op;
    this._applySealOpacity();
  },
  _applySealOpacity() {
    if (this._container && this.options.sealOpacity != null) {
      this._container.style.opacity = String(this.options.sealOpacity);
    }
  },
  _fillStroke(ctx, layer) {
    const options = layer.options;
    if (!options.fill) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = options.fillColor || options.color;
    ctx.fill(options.fillRule || 'evenodd');
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
});

const tipOpts = { sticky: true, direction: 'top', offset: [0, -8], className: 'ua-tip', opacity: 1 };
const POP_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const KM_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const $chk = () => document.getElementById('chk_dvhc');

let mode = 'HT';
let visible = false;
let fillRenderer = null;
let xaRenderer = null;
const groups = { fills: L.layerGroup(), badges: L.layerGroup() };

function classOf(name) {
  const marks = wardMarks(name);
  const raw = mode === 'QH' ? marks.plan : marks.ht;
  if (raw === 'II') return 'II';
  if (raw === 'III' || raw === 'PĐ III') return 'III';
  return null;
}

function isPhuong(name) {
  return String(name || '').startsWith('Phường ');
}

function tipHtml(name) {
  const lvl = classOf(name);
  const stats = name === DVHC_CITY.name ? DVHC_CITY : dvhcOf(name);
  const pop = stats && Number.isFinite(Number(stats.pop)) ? POP_FMT.format(Number(stats.pop)) : '—';
  const km = stats && Number.isFinite(Number(stats.km2)) ? KM_FMT.format(Number(stats.km2)) : '—';
  const marks = wardMarks(name);
  const detail = mode === 'QH' ? (marks.planTitle || '') : (marks.htTitle || '');
  const rows = [
    `<b class="ua-tip-name">${escapeHtml(name)}</b>`,
    `Dân số: ${escapeHtml(pop)} · ${escapeHtml(km)} km²`
  ];
  if (lvl) {
    rows.push(`Phường trình độ phát triển đô thị <b class="uc-${lvl}">loại ${lvl}</b>`);
    if (detail) rows.push(`<span class="ua-tip-muted">${escapeHtml(detail)}</span>`);
  } else if (isPhuong(name)) {
    rows.push('<span class="ua-tip-muted">Phường chưa xếp loại II/III trên bản đồ này</span>');
  } else {
    rows.push('<span class="ua-tip-muted">Xã — nền xanh, không ký hiệu số</span>');
  }
  return rows.join('<br>');
}

function syncOpacity() {
  if (!map) return;
  const op = fillOpacity(map.getZoom());
  fillRenderer?.setSealOpacity(op);
  xaRenderer?.setSealOpacity(op * 0.5);
}

function draw() {
  groups.fills.clearLayers();
  groups.badges.clearLayers();
  if (!map || !visible) return;
  syncOpacity();
  const pack = getWardDraw();
  const pending = [];
  (state.wardLabelsList || []).forEach((w) => {
    if (!w?.geometry || !w.name) return;
    const lvl = classOf(w.name);
    const geometry = (pack && pack.byName.get(w.name)) || w.geometry;
    const fill = lvl ? LEVEL_FILL[lvl] : XA_FILL;
    const rural = !lvl;
    const layer = L.geoJSON(geometry, {
      pane: FILL_PANE,
      renderer: rural ? xaRenderer : fillRenderer,
      interactive: false,
      smoothFactor: 0,
      style: { stroke: false, fill: true, fillColor: fill, fillOpacity: 1 }
    });
    pending.push({ rural, layer });

    // Ký hiệu II/III chỉ trên phường đã xếp loại.
    if (lvl && isPhuong(w.name) && w.lat != null && w.lng != null) {
      const icon = L.divIcon({
        className: 'ua-badge-icon dvhc-badge-icon',
        html: `<div class="ua-badge ua-badge-${lvl}"><span>${lvl}</span></div>`,
        iconSize: [0, 0]
      });
      const mk = L.marker([w.lat, w.lng], {
        icon,
        interactive: true,
        keyboard: false,
        pane: BADGE_PANE,
        zIndexOffset: 200
      });
      mk.bindTooltip(tipHtml(w.name), { ...tipOpts, sticky: false, offset: [0, -16] });
      mk.on('click', () => {
        document.dispatchEvent(new CustomEvent('qh:dvhc-at', {
          detail: L.latLng(w.lat, w.lng)
        }));
      });
      groups.badges.addLayer(mk);
    }
  });
  pending.filter((p) => p.rural).forEach((p) => groups.fills.addLayer(p.layer));
  pending.filter((p) => !p.rural).forEach((p) => groups.fills.addLayer(p.layer));
  restyle();
}

function restyle() {
  if (!map || !visible) return;
  const z = map.getZoom();
  syncOpacity();
  map.getContainer().classList.toggle('dvhc-zoom-low', z <= BADGE_SMALL_ZOOM);
  if (z > BADGE_MAX_ZOOM) groups.badges.remove();
  else if (!map.hasLayer(groups.badges)) groups.badges.addTo(map);
}

export function setDvhcClassMode(next) {
  const m = next === 'QH' ? 'QH' : 'HT';
  if (m === mode) return;
  mode = m;
  if (visible) draw();
}

export function getDvhcClassMode() {
  return mode;
}

export async function setDvhcClassVisible(on) {
  if (!map) return;
  visible = !!on;
  if (!visible) {
    groups.fills.remove();
    groups.badges.remove();
    map.getContainer().classList.remove('dvhc-zoom-low');
    return;
  }
  groups.fills.addTo(map);
  draw();
}

export function refreshDvhcClassLayer() {
  if (visible) draw();
}

/** Hệ số độ đục nền tô phân loại phường/xã (0–1); gắn thanh Độ trong suốt trục A. */
export function setDvhcClassFillOpacity(v) {
  const next = Math.max(0, Math.min(1, Number(v)));
  if (!Number.isFinite(next)) return;
  userFillMul = next;
  syncOpacity();
}

export function initDvhcClassLayer() {
  if (!map) return;
  const fillPane = map.getPane(FILL_PANE) || map.createPane(FILL_PANE);
  fillPane.style.zIndex = '388';
  fillPane.style.pointerEvents = 'none';
  const badgePane = map.getPane(BADGE_PANE) || map.createPane(BADGE_PANE);
  badgePane.style.zIndex = '625';
  const op = fillOpacity(map.getZoom());
  xaRenderer = new SealCanvas({ pane: FILL_PANE, sealOpacity: op * 0.5 });
  fillRenderer = new SealCanvas({ pane: FILL_PANE, sealOpacity: op });
  map.on('zoomend', restyle);
  $chk()?.addEventListener('change', (e) => {
    setDvhcClassVisible(!!e.target.checked);
  });
  window.addEventListener(WARD_BOUNDS_EVENT, () => refreshDvhcClassLayer());
  if ($chk()?.checked) setDvhcClassVisible(true);
}
