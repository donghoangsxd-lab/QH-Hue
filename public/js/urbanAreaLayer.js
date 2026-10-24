// Lớp "Phân loại đô thị": tô phường, xã theo trình độ phát triển đô thị, nét ranh và ký hiệu loại đô thị; trỏ chuột xem thông tin.
// Bản đồ hiện trạng: Quyết định 614/QĐ-UBND (urbanStatus.js, ranh dựng bằng scripts/build-urban614.js; đô thị trên một phần
// phường, xã tô riêng theo ranh thị trấn, xã cũ). Bản đồ quy hoạch: hệ thống đô thị sau năm 2030 theo Quyết định 756/QĐ-UBND
// (urbanVision.js, ranh dựng bằng scripts/build-urban-vision.js). Cùng một checkbox, mỗi bản đồ vẽ nội dung của mình.
import { map } from './mapEngine.js';
import { getWardDraw } from './wardSeam.js';
import { planMap, isCompareOn, isSplitOn, whenMapsIdle } from './planMap.js';
import { isLevelPair, sideOf, onSplitPair } from './splitPair.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { STATUS_REF, URBANS_614, RURAL_RULE, wardLevel614, urbans614Of } from './urbanStatus.js';
import { VISION_REF, VISION_STAGE, VISION_CLAUSE, URBANS_VISION, visionLevel, visionUrbansOf } from './urbanVision.js';
import { planUrbanOf } from './urbanClass.js';

// Bấm ký hiệu / nét ranh đô thị: detail = { id, side } — id trong urbanStatus.js (side 'HT') hoặc urbanVision.js (side 'QH');
// viewFlow.js quyết định chọn đô thị hay mở view riêng
export const URBAN_PICK_EVENT = 'qh:urban-pick';

const FILL_PANE = 'urbanAreaPane';
const TOWN_PANE = 'urbanTownPane';
const LINE_PANE = 'urbanLinePane';
// Trên nét ranh đô thị (410), QHC (420), viền đồ án (445), điều chỉnh (447) và phường đang chọn (448);
// dưới nhãn nền (450) và ký hiệu (markerPane 600) để highlight không bị ranh lớp khác che.
const HOVER_PANE = 'urbanHoverPane';
const HOVER_Z = 449;
const HIT_WEIGHT = 14;
const WARD_HOVER_MAX_ZOOM = 12;
const LEVEL_FILL = { II: '#ef4444', III: '#fb923c' };
const RURAL_FILL = '#4ade80';
const LINE_STYLE = {
  I: { color: '#facc15', weight: 3.5, dashArray: null },
  II: { color: '#f8fafc', weight: 3, dashArray: null },
  III: { color: '#f8fafc', weight: 2.5, dashArray: '7 5' }
};
const CLS_RANK = { I: 0, II: 1, III: 2 };
// Thu nhỏ (≤ 12) tô đậm như bản đồ phân vùng; phóng to thì nhạt dần để không che công trình
const fillOpacity = (z) => (z <= 10 ? 0.55 : z <= 11 ? 0.42 : z <= 12 ? 0.3 : z <= 14 ? 0.14 : 0.06);

// Nền bán trong suốt vẽ từng polygon bị khử răng cưa thành khe sáng 1 px trên cạnh chung.
// Vẽ đặc (kèm nét cùng màu 2 px để lấp mép) rồi hạ opacity cả canvas — mép và lòng cùng độ đục.
const SealCanvas = L.Canvas.extend({
  onAdd(map) {
    L.Canvas.prototype.onAdd.call(this, map);
    this._applySealOpacity();
  },
  setSealOpacity(op) {
    this.options.sealOpacity = op;
    this._applySealOpacity();
  },
  _applySealOpacity() {
    if (this._container && this.options.sealOpacity != null) this._container.style.opacity = String(this.options.sealOpacity);
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
const BADGE_MAX_ZOOM = 15;
const BADGE_SMALL_ZOOM = 10;

const $ = (id) => document.getElementById(id);
const $chk = () => $('chk_urban');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const muted = (text) => `<span class="ua-tip-muted">${escapeHtml(text)}</span>`;
const clsTag = (cls) => `<b class="uc-${cls}">loại ${cls}</b>`;
const tipOpts = { sticky: true, direction: 'top', offset: [0, -8], className: 'ua-tip', opacity: 1 };

function ringsOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.flatMap(p => p).map(ring => ring.map(([lng, lat]) => [lat, lng]));
}

// ---------- Hiện trạng (QĐ 614) ----------
const statusContent = {
  side: 'HT',
  dataUrl: 'data/urban614.geojson',
  urbans: URBANS_614,
  wardLevel: (name) => wardLevel614(name)?.level || null,
  urbanTip(u, { approx = false, hasArea = true } = {}) {
    const plan = planUrbanOf(u.plan);
    return [
      `<b class="ua-tip-name">${escapeHtml(u.name)}</b> ${clsTag(u.cls)}`,
      `Trước chuyển tiếp: ${escapeHtml(u.before.name)} (loại ${u.before.cls})`,
      `Phạm vi: ${escapeHtml(u.scope)}`,
      plan ? `Định hướng 2030: ${escapeHtml(plan.name)} (loại ${plan.cls})` : '',
      muted(`Công nhận: ${u.basis}`),
      hasArea ? '' : muted(`Chưa có ranh ${u.before.name.startsWith('Thị trấn') ? 'thị trấn' : 'xã'} cũ, ký hiệu đặt tại ${approx ? 'trung tâm xã mới (gần đúng)' : 'trung tâm cũ'}.`),
      muted(STATUS_REF)
    ].filter(Boolean).join('<br>');
  },
  wardTip(name) {
    const lvl = wardLevel614(name);
    const rows = [`<b class="ua-tip-name">${escapeHtml(name)}</b>`];
    if (lvl) {
      rows.push(`Trình độ phát triển đô thị ${clsTag(lvl.level)} (trước 01/7/2025: loại ${lvl.before})`);
      rows.push(muted(`Nhập từ: ${lvl.from}`));
      if (lvl.rural) rows.push(muted(RURAL_RULE));
    } else {
      rows.push('Đơn vị hành chính nông thôn');
    }
    const city = URBANS_614.find(u => u.city);
    const own = urbans614Of(name).map(u => `${escapeHtml(u.name)} (${u.cls}${u.part ? `, ${escapeHtml(lowerFirst(u.scope))}` : ''})`);
    rows.push(`Thuộc: ${escapeHtml(city.name)} (I)${own.length ? ` · ${own.join(' · ')}` : ''}`);
    return rows.join('<br>');
  }
};

// ---------- Quy hoạch dài hạn (QĐ 756, sau 2030) ----------
const visionContent = {
  side: 'QH',
  dataUrl: 'data/urbanVision.geojson',
  urbans: URBANS_VISION,
  wardLevel: (name) => visionLevel(name)?.level || null,
  urbanTip(u) {
    return [
      `<b class="ua-tip-name">${escapeHtml(u.name)}</b> ${clsTag(u.cls)}`,
      `${VISION_STAGE}: ${escapeHtml(u.change)}`,
      `Phạm vi: ${escapeHtml(u.scope)}`,
      muted(`${VISION_REF}, ${VISION_CLAUSE}`)
    ].join('<br>');
  },
  wardTip(name) {
    const lvl = visionLevel(name);
    const rows = [`<b class="ua-tip-name">${escapeHtml(name)}</b>`];
    if (lvl) {
      rows.push(`${VISION_STAGE}: trình độ phát triển đô thị ${clsTag(lvl.level)}`);
    } else {
      rows.push('Đơn vị hành chính nông thôn, chưa định hướng đạt trình độ phát triển đô thị');
    }
    const city = URBANS_VISION.find(u => u.city);
    const own = visionUrbansOf(name).map(u => `${escapeHtml(u.name)} (${u.cls})`);
    rows.push(`Thuộc: ${escapeHtml(city.name)} (I)${own.length ? ` · ${own.join(' · ')}` : ''}`);
    rows.push(muted(VISION_REF));
    return rows.join('<br>');
  }
};

/** Lớp phân loại đô thị trên một bản đồ Leaflet với nội dung (hiện trạng / quy hoạch) cho trước. */
function createUrbanLayer(content) {
  let m = null;
  let visible = false;
  let dataPromise = null;
  let urbanRenderer = null;
  let ruralRenderer = null;
  let townRenderer = null;
  let lineRenderer = null;
  let hoverRenderer = null;
  const groups = { wards: L.layerGroup(), towns: L.layerGroup(), lines: L.layerGroup(), badges: L.layerGroup(), hover: L.layerGroup() };
  let hoverId = null;
  const byId = new Map(content.urbans.map(u => [u.id, u]));

  // Nền tô phường không nhận chuột (để không chặn công trình, lô đất); tra phường bằng điểm-trong-đa-giác khi rê chuột ở zoom nhỏ
  let wardHits = [];
  let wardHover = null;
  let pointerOnUrban = false;

  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch(content.dataUrl)
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .catch(err => { dataPromise = null; throw err; });
    }
    return dataPromise;
  }

  function clearWardHover() {
    if (!wardHover) return;
    wardHover.outline.remove();
    m.closeTooltip(wardHover.tip);
    wardHover = null;
  }

  function clearUrbanHover() {
    groups.hover.clearLayers();
    hoverId = null;
  }

  // Quầng và nét trắng vẽ ở pane trên cùng, không phụ thuộc thứ tự loại I → III trong pane ranh
  function showUrbanHover(id, rings, style) {
    if (hoverId === id) return;
    groups.hover.clearLayers();
    hoverId = id;
    const weight = style.weight || 3;
    const base = { pane: HOVER_PANE, renderer: hoverRenderer, interactive: false, lineJoin: 'round', lineCap: 'round' };
    groups.hover.addLayer(L.polyline(rings, { ...base, color: '#facc15', weight: weight + 8, opacity: 0.9 }));
    groups.hover.addLayer(L.polyline(rings, { ...base, color: '#ffffff', weight: Math.max(weight, 3), opacity: 1, dashArray: style.dashArray || null }));
  }

  function enterUrban(id, rings, style) {
    pointerOnUrban = true;
    clearWardHover();
    if (rings) showUrbanHover(id, rings, style);
  }

  function leaveUrban() {
    pointerOnUrban = false;
    clearUrbanHover();
  }

  function wardAt({ lat, lng }) {
    return wardHits.find(w => lng >= w.bbox[0] && lng <= w.bbox[2] && lat >= w.bbox[1] && lat <= w.bbox[3]
      && turf.booleanPointInPolygon([lng, lat], w.feat));
  }

  // Trỏ vào lớp có tooltip riêng (vùng đồ án, lô, công trình...) thì nhường tooltip cho lớp đó
  const overLayer = (ev) => !!ev?.target?.closest?.('.leaflet-interactive');

  function onMouseMove(e) {
    if (!visible || pointerOnUrban || overLayer(e.originalEvent) || m.getZoom() > WARD_HOVER_MAX_ZOOM) { clearWardHover(); return; }
    const w = wardAt(e.latlng);
    if (!w) { clearWardHover(); return; }
    if (wardHover?.name !== w.name) {
      clearWardHover();
      wardHover = {
        name: w.name,
        outline: L.polyline(ringsOf(w.feat.geometry), { pane: HOVER_PANE, renderer: hoverRenderer, interactive: false, color: '#f8fafc', weight: 2.5, opacity: 1 }).addTo(m),
        tip: L.tooltip({ ...tipOpts, sticky: false }).setContent(content.wardTip(w.name))
      };
    }
    wardHover.tip.setLatLng(e.latlng);
    if (!m.hasLayer(wardHover.tip)) m.openTooltip(wardHover.tip);
  }

  function drawWards() {
    groups.wards.clearLayers();
    clearWardHover();
    wardHits = [];
    syncFillOpacity();
    const pack = getWardDraw();
    const pending = [];
    (state.wardLabelsList || []).forEach(w => {
      if (!w.geometry) return;
      const level = content.wardLevel(w.name);
      const geometry = (pack && pack.byName.get(w.name)) || w.geometry;
      const rural = !level;
      const layer = L.geoJSON(geometry, {
        pane: FILL_PANE, renderer: rural ? ruralRenderer : urbanRenderer, interactive: false, smoothFactor: 0,
        style: { stroke: false, fill: true, fillColor: level ? LEVEL_FILL[level] : RURAL_FILL, fillOpacity: 1 }
      });
      pending.push({ rural, layer });
      const feat = { type: 'Feature', properties: {}, geometry: w.geometry };
      wardHits.push({ name: w.name, feat, bbox: turf.bbox(feat) });
    });
    pending.filter(p => p.rural).forEach(p => groups.wards.addLayer(p.layer));
    pending.filter(p => !p.rural).forEach(p => groups.wards.addLayer(p.layer));
  }

  function drawUrbans(fc) {
    groups.towns.clearLayers();
    groups.lines.clearLayers();
    groups.badges.clearLayers();
    clearUrbanHover();
    syncFillOpacity();
    const pick = (id) => document.dispatchEvent(new CustomEvent(URBAN_PICK_EVENT, { detail: { id, side: content.side } }));
    // Loại I vẽ trước, loại III sau cùng để nét đô thị nhỏ nằm trên
    const rank = (f) => CLS_RANK[byId.get(f.properties.id)?.cls] ?? 3;
    [...fc.features].sort((a, b) => rank(a) - rank(b)).forEach(f => {
      const u = byId.get(f.properties.id);
      if (!u) return;
      const isArea = f.geometry.type !== 'Point';
      const rings = isArea ? ringsOf(f.geometry) : null;
      const style = LINE_STYLE[u.cls] || LINE_STYLE.III;
      if (isArea && u.part && LEVEL_FILL[u.cls]) {
        groups.towns.addLayer(L.geoJSON(f.geometry, {
          pane: TOWN_PANE, renderer: townRenderer, interactive: false, smoothFactor: 0,
          style: { stroke: false, fill: true, fillColor: LEVEL_FILL[u.cls], fillOpacity: 1 }
        }));
      }
      if (rings) {
        const casing = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, interactive: false, color: '#0f172a', weight: style.weight + 2.5, opacity: 0.55 });
        const line = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, interactive: false, ...style, opacity: 0.95 });
        // Nét trong suốt rộng hơn để dễ trỏ trúng ranh
        const hit = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, weight: HIT_WEIGHT, opacity: 0, bubblingMouseEvents: false });
        hit.bindTooltip(content.urbanTip(u), tipOpts);
        hit.on('mouseover', () => enterUrban(u.id, rings, style));
        hit.on('mouseout', leaveUrban);
        hit.on('click', () => pick(u.id));
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
      L.marker([lat, lng], { icon, keyboard: false, zIndexOffset: 600 - 50 * (CLS_RANK[u.cls] ?? 2) })
        .bindTooltip(content.urbanTip(u, { approx: !!f.properties.approx, hasArea: isArea }), { ...tipOpts, sticky: false, offset: [0, -16] })
        .on('mouseover', () => enterUrban(u.id, rings, style))
        .on('mouseout', leaveUrban)
        .on('click', () => pick(u.id))
        .addTo(groups.badges);
    });
  }

  function syncFillOpacity() {
    if (!m) return;
    const op = fillOpacity(m.getZoom());
    urbanRenderer?.setSealOpacity(op);
    ruralRenderer?.setSealOpacity(op * 0.5);
    townRenderer?.setSealOpacity(op);
  }

  function restyle() {
    if (!visible) return;
    const z = m.getZoom();
    syncFillOpacity();
    m.getContainer().classList.toggle('ua-zoom-low', z <= BADGE_SMALL_ZOOM);
    if (z > BADGE_MAX_ZOOM) groups.badges.remove();
    else if (!m.hasLayer(groups.badges)) groups.badges.addTo(m);
  }

  return {
    init(target) {
      m = target;
      // Nền dưới lớp phủ (overlayPane 400); nét ranh ở pane SVG trên cùng nhưng gốc không nhận chuột,
      // chỉ nét trong suốt nhận, nên không chặn canvas của các lớp phủ bên dưới
      const fillPane = m.getPane(FILL_PANE) || m.createPane(FILL_PANE);
      fillPane.style.zIndex = 390;
      fillPane.style.pointerEvents = 'none';
      // Đô thị trên một phần xã tô trên nền phường, xã (canvas riêng để không bị nền vẽ lại đè lên)
      const townPane = m.getPane(TOWN_PANE) || m.createPane(TOWN_PANE);
      townPane.style.zIndex = 395;
      townPane.style.pointerEvents = 'none';
      const linePane = m.getPane(LINE_PANE) || m.createPane(LINE_PANE);
      linePane.style.zIndex = 410;
      linePane.style.pointerEvents = 'none';
      const hoverPane = m.getPane(HOVER_PANE) || m.createPane(HOVER_PANE);
      hoverPane.style.zIndex = HOVER_Z;
      hoverPane.style.pointerEvents = 'none';
      const op = fillOpacity(m.getZoom());
      ruralRenderer = new SealCanvas({ pane: FILL_PANE, sealOpacity: op * 0.5 });
      urbanRenderer = new SealCanvas({ pane: FILL_PANE, sealOpacity: op });
      townRenderer = new SealCanvas({ pane: TOWN_PANE, sealOpacity: op });
      lineRenderer = L.svg({ pane: LINE_PANE });
      hoverRenderer = L.svg({ pane: HOVER_PANE });
      m.on('zoomend', restyle);
      m.on('mousemove', onMouseMove);
      m.on('mouseout', clearWardHover);
      // Lớp chặn sự kiện lan lên bản đồ (bubblingMouseEvents: false) thì map không nhận mousemove, bắt ở DOM
      m.getContainer().addEventListener('mousemove', (ev) => { if (wardHover && overLayer(ev)) clearWardHover(); });
    },
    async setVisible(on) {
      if (!m) return;
      visible = !!on;
      if (!visible) {
        Object.values(groups).forEach(g => g.remove());
        clearWardHover();
        clearUrbanHover();
        pointerOnUrban = false;
        m.getContainer().classList.remove('ua-zoom-low');
        return;
      }
      groups.wards.addTo(m);
      groups.towns.addTo(m);
      groups.lines.addTo(m);
      groups.hover.addTo(m);
      drawWards();
      try {
        const fc = await loadData();
        if (!visible) return;
        await whenMapsIdle([m]);
        if (!visible) return;
        drawUrbans(fc);
      } catch (err) {
        console.warn(`Không tải được ranh đô thị ${content.dataUrl}:`, err);
        return;
      }
      if (visible) restyle();
    },
    refresh() {
      if (visible) drawWards();
    },
    bounds() {
      let b = null;
      groups.lines.eachLayer(l => { b = b ? b.extend(l.getBounds()) : l.getBounds(); });
      return b;
    },
    /** Đô thị có ranh (bỏ đô thị chỉ có ký hiệu điểm) → { id, name, cls, city, geometry } */
    async feature(id) {
      const fc = await loadData();
      const f = fc.features.find(x => x.properties.id === id && x.geometry.type !== 'Point');
      const u = byId.get(id);
      return f && u ? { id, name: u.name, cls: u.cls, city: !!u.city, geometry: f.geometry } : null;
    },
    /** Đô thị nhỏ nhất (không tính đô thị loại I toàn thành phố) chứa điểm latlng */
    async at({ lat, lng }) {
      const fc = await loadData();
      let best = null;
      fc.features.forEach(f => {
        const u = byId.get(f.properties.id);
        if (!u || u.city || f.geometry.type === 'Point') return;
        if (!turf.booleanPointInPolygon([lng, lat], f)) return;
        const area = turf.area(f);
        if (!best || area < best.area) best = { area, f, u };
      });
      return best ? { id: best.u.id, name: best.u.name, cls: best.u.cls, city: false, geometry: best.f.geometry } : null;
    }
  };
}

const statusLayer = createUrbanLayer(statusContent);
const visionLayer = createUrbanLayer(visionContent);
const visionLeft = createUrbanLayer(visionContent);

async function setVisible(on, { fit = false } = {}) {
  await Promise.all([statusLayer.setVisible(on), visionLayer.setVisible(on)]);
  if (isLevelPair()) return syncUrbanPair();
  await visionLeft.setVisible(false);
  if (!on || !fit) return;
  const shown = isCompareOn() && !isSplitOn() && planMap ? planMap : map;
  const b = statusLayer.bounds() || visionLayer.bounds();
  if (shown.getZoom() > 11 && b && b.isValid()) shown.flyToBounds(b, { padding: [20, 20], maxZoom: 10, duration: 0.8 });
}

async function syncUrbanPair() {
  if (!isLevelPair()) {
    await visionLeft.setVisible(false);
    await setVisible(!!$chk()?.checked);
    return;
  }
  await statusLayer.setVisible(false);
  await visionLayer.setVisible(sideOf(planMap) === 'urban');
  await visionLeft.setVisible(sideOf(map) === 'urban');
}

/** Gọi lại khi ranh 40 phường xã tải xong (lớp có thể đã bật trước đó). */
export function refreshUrbanAreaLayer() {
  statusLayer.refresh();
  visionLayer.refresh();
}

/** Đô thị sau 2030 (QĐ 756) theo id, có ranh; null nếu chỉ có ký hiệu điểm */
export const urbanVisionFeature = (id) => visionLayer.feature(id).catch(() => null);
/** Đô thị sau 2030 (QĐ 756) chứa điểm bấm trên bản đồ quy hoạch */
export const urbanVisionAt = (latlng) => visionLayer.at(latlng).catch(() => null);

let initialDraw = Promise.resolve();

/** Ranh đô thị vẽ xong lần đầu (lớp bật sẵn khi mở trang); nền tô phường còn chờ ranh 40 phường xã (refresh) */
export function urbanAreaReady() {
  return initialDraw;
}

export function initUrbanAreaLayer() {
  if (!map) return;
  statusLayer.init(map);
  visionLeft.init(map);
  if (planMap) visionLayer.init(planMap);
  $chk()?.addEventListener('change', (e) => {
    if (isLevelPair()) { syncUrbanPair(); return; }
    setVisible(e.target.checked, { fit: true });
  });
  onSplitPair(() => { syncUrbanPair(); });
  if ($chk()?.checked) initialDraw = setVisible(true);
}
