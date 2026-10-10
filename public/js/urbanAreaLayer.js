// Lớp "Loại đô thị hiện trạng" trên bản đồ hiện trạng theo Quyết định 614/QĐ-UBND (urbanStatus.js):
// tô 21 phường theo trình độ phát triển đô thị, nét ranh 14 đô thị và ký hiệu loại đô thị; trỏ chuột xem thông tin.
// Ranh đô thị dựng sẵn bằng scripts/build-urban614.js; 9 đô thị trên một phần xã chưa có ranh thị trấn, xã cũ nên chỉ có ký hiệu.
import { map } from './mapEngine.js';
import { getViewMode, setViewMode, isSplitOn } from './planMap.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { STATUS_REF, URBANS_614, RURAL_RULE, wardLevel614, urbans614Of } from './urbanStatus.js';
import { planUrbanOf } from './urbanClass.js';

const DATA_URL = 'data/urban614.geojson';
const FILL_PANE = 'urbanAreaPane';
const LINE_PANE = 'urbanLinePane';
const HIT_WEIGHT = 14;
const WARD_HOVER_MAX_ZOOM = 12;
const LEVEL_FILL = { II: '#ef4444', III: '#fb923c' };
const RURAL_FILL = '#4ade80';
const CLS_LINE = { I: '#facc15', III: '#f8fafc' };
// Thu nhỏ (≤ 12) tô đậm như bản đồ phân vùng; phóng to thì nhạt dần để không che công trình
const fillOpacity = (z) => (z <= 10 ? 0.55 : z <= 11 ? 0.42 : z <= 12 ? 0.3 : z <= 14 ? 0.14 : 0.06);
const BADGE_MAX_ZOOM = 15;
const BADGE_SMALL_ZOOM = 10;

const $ = (id) => document.getElementById(id);
const $chk = () => $('chk_urban');

let visible = false;
let dataPromise = null;
let fillRenderer = null;
let lineRenderer = null;
const groups = { wards: null, lines: null, badges: null };

function loadData() {
  if (!dataPromise) {
    dataPromise = fetch(DATA_URL)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { dataPromise = null; throw err; });
  }
  return dataPromise;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function urbanTip(u, { approx = false, hasArea = true } = {}) {
  const plan = planUrbanOf(u.plan);
  const rows = [
    `<b class="ua-tip-name">${escapeHtml(u.name)}</b> <b class="uc-${u.cls}">loại ${u.cls}</b>`,
    `Trước chuyển tiếp: ${escapeHtml(u.before.name)} (loại ${u.before.cls})`,
    `Phạm vi: ${escapeHtml(u.scope)}`,
    plan ? `Định hướng 2030: ${escapeHtml(plan.name)} (loại ${plan.cls})` : '',
    `<span class="ua-tip-muted">Công nhận: ${escapeHtml(u.basis)}</span>`,
    hasArea ? '' : `<span class="ua-tip-muted">Chưa có ranh ${u.before.name.startsWith('Thị trấn') ? 'thị trấn' : 'xã'} cũ, ký hiệu đặt tại ${approx ? 'trung tâm xã mới (gần đúng)' : 'trung tâm cũ'}.</span>`,
    `<span class="ua-tip-muted">${STATUS_REF}</span>`
  ];
  return rows.filter(Boolean).join('<br>');
}

function wardTip(name) {
  const lvl = wardLevel614(name);
  const urbans = urbans614Of(name);
  const rows = [`<b class="ua-tip-name">${escapeHtml(name)}</b>`];
  if (lvl) {
    rows.push(`Trình độ phát triển đô thị <b class="uc-${lvl.level}">loại ${lvl.level}</b> (trước 01/7/2025: loại ${lvl.before})`);
    rows.push(`<span class="ua-tip-muted">Nhập từ: ${escapeHtml(lvl.from)}</span>`);
    if (lvl.rural) rows.push(`<span class="ua-tip-muted">${escapeHtml(RURAL_RULE)}</span>`);
  } else {
    rows.push('Đơn vị hành chính nông thôn');
  }
  const city = URBANS_614.find(u => u.city);
  const own = urbans.map(u => `${escapeHtml(u.name)} (${u.cls}${u.part ? `, ${escapeHtml(lowerFirst(u.scope))}` : ''})`);
  rows.push(`Thuộc: ${escapeHtml(city.name)} (I)${own.length ? ` · ${own.join(' · ')}` : ''}`);
  return rows.join('<br>');
}

const tipOpts = { sticky: true, direction: 'top', offset: [0, -8], className: 'ua-tip', opacity: 1 };

function ringsOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.flatMap(p => p).map(ring => ring.map(([lng, lat]) => [lat, lng]));
}

function drawWards() {
  groups.wards.clearLayers();
  clearWardHover();
  wardHits = [];
  const op = fillOpacity(map.getZoom());
  (state.wardLabelsList || []).forEach(w => {
    if (!w.geometry) return;
    const lvl = wardLevel614(w.name);
    const color = lvl ? LEVEL_FILL[lvl.level] : RURAL_FILL;
    const layer = L.geoJSON(w.geometry, {
      pane: FILL_PANE, renderer: fillRenderer, interactive: false,
      style: { stroke: false, fillColor: color, fillOpacity: lvl ? op : op * 0.5 }
    });
    layer.eachLayer(l => { l.options.uaRural = !lvl; });
    groups.wards.addLayer(layer);
    const feat = { type: 'Feature', properties: {}, geometry: w.geometry };
    wardHits.push({ name: w.name, feat, bbox: turf.bbox(feat) });
  });
}

// Nền tô phường không nhận chuột (để không chặn công trình, lô đất); tra phường bằng điểm-trong-đa-giác khi rê chuột ở zoom nhỏ
let wardHits = [];
let wardHover = null;
let pointerOnUrban = false;

function clearWardHover() {
  if (!wardHover) return;
  wardHover.outline.remove();
  map.closeTooltip(wardHover.tip);
  wardHover = null;
}

function wardAt({ lat, lng }) {
  return wardHits.find(w => lng >= w.bbox[0] && lng <= w.bbox[2] && lat >= w.bbox[1] && lat <= w.bbox[3]
    && turf.booleanPointInPolygon([lng, lat], w.feat));
}

function onMapMouseMove(e) {
  if (!visible || pointerOnUrban || map.getZoom() > WARD_HOVER_MAX_ZOOM) { clearWardHover(); return; }
  const w = wardAt(e.latlng);
  if (!w) { clearWardHover(); return; }
  if (wardHover?.name !== w.name) {
    clearWardHover();
    wardHover = {
      name: w.name,
      outline: L.polyline(ringsOf(w.feat.geometry), { pane: FILL_PANE, renderer: fillRenderer, interactive: false, color: '#f8fafc', weight: 1.5, opacity: 0.9 }).addTo(map),
      tip: L.tooltip({ ...tipOpts, sticky: false }).setContent(wardTip(w.name))
    };
  }
  wardHover.tip.setLatLng(e.latlng);
  if (!map.hasLayer(wardHover.tip)) map.openTooltip(wardHover.tip);
}

const urbanHover = (on) => () => { pointerOnUrban = on; if (on) clearWardHover(); };

function drawUrbans(fc) {
  groups.lines.clearLayers();
  groups.badges.clearLayers();
  const byId = new Map(URBANS_614.map(u => [u.id, u]));
  // Loại I (toàn thành phố) vẽ trước để nét đô thị loại III nằm trên
  const feats = [...fc.features].sort((a, b) => (byId.get(a.properties.id)?.city ? -1 : 0) - (byId.get(b.properties.id)?.city ? -1 : 0));
  feats.forEach(f => {
    const u = byId.get(f.properties.id);
    if (!u) return;
    const isArea = f.geometry.type !== 'Point';
    if (isArea) {
      const rings = ringsOf(f.geometry);
      const weight = u.city ? 3.5 : 2.5;
      const casing = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, interactive: false, color: '#0f172a', weight: weight + 2.5, opacity: 0.55 });
      const line = L.polyline(rings, {
        pane: LINE_PANE, renderer: lineRenderer, interactive: false,
        color: CLS_LINE[u.cls] || CLS_LINE.III,
        weight,
        dashArray: u.city ? null : '7 5',
        opacity: 0.95
      });
      // Nét trong suốt rộng hơn để dễ trỏ trúng ranh
      const hit = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, weight: HIT_WEIGHT, opacity: 0, bubblingMouseEvents: false });
      hit.bindTooltip(urbanTip(u), tipOpts);
      hit.on('mouseover', () => { urbanHover(true)(); line.setStyle({ weight: weight + 1.5 }); });
      hit.on('mouseout', () => { urbanHover(false)(); line.setStyle({ weight }); });
      groups.lines.addLayer(casing);
      groups.lines.addLayer(line);
      groups.lines.addLayer(hit);
    }
    const [lng, lat] = isArea ? f.properties.anchor : f.geometry.coordinates;
    const icon = L.divIcon({
      className: 'ua-badge-icon',
      html: `<div class="ua-badge ua-badge-${u.cls}${isArea ? '' : ' ua-badge-point'}"><span>${u.cls}</span></div>`
        + `<b class="ua-badge-name">${escapeHtml(u.name)}</b>`,
      iconSize: [0, 0]
    });
    L.marker([lat, lng], { icon, keyboard: false, zIndexOffset: u.city ? 600 : 500 })
      .bindTooltip(urbanTip(u, { approx: !!f.properties.approx, hasArea: isArea }), { ...tipOpts, sticky: false, offset: [0, -16] })
      .on('mouseover', urbanHover(true))
      .on('mouseout', urbanHover(false))
      .addTo(groups.badges);
  });
}

function restyle() {
  if (!visible) return;
  const z = map.getZoom();
  const op = fillOpacity(z);
  groups.wards.eachLayer(g => g.eachLayer?.(l => l.setStyle({ fillOpacity: l.options.uaRural ? op * 0.5 : op })));
  map.getContainer().classList.toggle('ua-zoom-low', z <= BADGE_SMALL_ZOOM);
  if (z > BADGE_MAX_ZOOM) groups.badges.remove();
  else if (!map.hasLayer(groups.badges)) groups.badges.addTo(map);
}

function cityBounds() {
  let b = null;
  groups.lines.eachLayer(l => { b = b ? b.extend(l.getBounds()) : l.getBounds(); });
  return b;
}

async function setVisible(on, { fit = false } = {}) {
  visible = !!on;
  const legend = $('urbanLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  if (!visible) {
    Object.values(groups).forEach(g => g.remove());
    clearWardHover();
    pointerOnUrban = false;
    map.getContainer().classList.remove('ua-zoom-low');
    return;
  }
  if (fit && !isSplitOn() && getViewMode() === 'QH') setViewMode('HT');
  groups.wards.addTo(map);
  groups.lines.addTo(map);
  drawWards();
  try {
    drawUrbans(await loadData());
  } catch (err) {
    console.warn('Không tải được ranh đô thị QĐ 614:', err);
    return;
  }
  if (!visible) return;
  restyle();
  if (fit && map.getZoom() > 11) {
    const b = cityBounds();
    if (b && b.isValid()) map.flyToBounds(b, { padding: [20, 20], maxZoom: 10, duration: 0.8 });
  }
}

/** Gọi lại khi ranh 40 phường xã tải xong (lớp có thể đã bật trước đó). */
export function refreshUrbanAreaLayer() {
  if (visible) drawWards();
}

export function initUrbanAreaLayer() {
  if (!map) return;
  // Nền dưới lớp phủ (overlayPane 400); nét ranh ở pane SVG trên cùng nhưng gốc không nhận chuột,
  // chỉ nét trong suốt nhận, nên không chặn canvas của các lớp phủ bên dưới
  const fillPane = map.getPane(FILL_PANE) || map.createPane(FILL_PANE);
  fillPane.style.zIndex = 390;
  fillPane.style.pointerEvents = 'none';
  const linePane = map.getPane(LINE_PANE) || map.createPane(LINE_PANE);
  linePane.style.zIndex = 410;
  linePane.style.pointerEvents = 'none';
  fillRenderer = L.canvas({ pane: FILL_PANE });
  lineRenderer = L.svg({ pane: LINE_PANE });
  groups.wards = L.layerGroup();
  groups.lines = L.layerGroup();
  groups.badges = L.layerGroup();
  map.on('zoomend', restyle);
  map.on('mousemove', onMapMouseMove);
  map.on('mouseout', clearWardHover);
  $chk()?.addEventListener('change', (e) => setVisible(e.target.checked, { fit: true }));
  if ($chk()?.checked) setVisible(true);
}

