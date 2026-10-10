// Lớp "Phân loại đô thị": tô phường, xã theo trình độ phát triển đô thị, nét ranh và ký hiệu loại đô thị; trỏ chuột xem thông tin.
// Bản đồ hiện trạng: Quyết định 614/QĐ-UBND (urbanStatus.js, ranh dựng bằng scripts/build-urban614.js; đô thị trên một phần
// phường, xã tô riêng theo ranh thị trấn, xã cũ). Bản đồ quy hoạch: hệ thống đô thị sau năm 2030 theo Quyết định 756/QĐ-UBND
// (urbanVision.js, ranh dựng bằng scripts/build-urban-vision.js). Cùng một checkbox, mỗi bản đồ vẽ nội dung của mình.
import { map } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn } from './planMap.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { STATUS_REF, URBANS_614, RURAL_RULE, wardLevel614, urbans614Of } from './urbanStatus.js';
import { VISION_REF, VISION_STAGE, VISION_CLAUSE, URBANS_VISION, visionLevel, visionUrbansOf } from './urbanVision.js';
import { planUrbanOf } from './urbanClass.js';

const FILL_PANE = 'urbanAreaPane';
const TOWN_PANE = 'urbanTownPane';
const LINE_PANE = 'urbanLinePane';
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
  dataUrl: 'data/urban614.geojson',
  urbans: URBANS_614,
  wardLevel: (name) => wardLevel614(name)?.level || null,
  urbanTip(u, { approx = false, hasArea = true, inferred = false } = {}) {
    const plan = planUrbanOf(u.plan);
    return [
      `<b class="ua-tip-name">${escapeHtml(u.name)}</b> ${clsTag(u.cls)}`,
      `Trước chuyển tiếp: ${escapeHtml(u.before.name)} (loại ${u.before.cls})`,
      `Phạm vi: ${escapeHtml(u.scope)}`,
      plan ? `Định hướng 2030: ${escapeHtml(plan.name)} (loại ${plan.cls})` : '',
      muted(`Công nhận: ${u.basis}`),
      hasArea ? '' : muted(`Chưa có ranh ${u.before.name.startsWith('Thị trấn') ? 'thị trấn' : 'xã'} cũ, ký hiệu đặt tại ${approx ? 'trung tâm xã mới (gần đúng)' : 'trung tâm cũ'}.`),
      inferred ? muted(`Suy ra: ranh là vùng không tên chứa trung tâm ${lowerFirst(u.before.name)} cũ trên bản đồ địa giới trước 2020.`) : '',
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
  dataUrl: 'data/urbanVision.geojson',
  urbans: URBANS_VISION,
  wardLevel: (name) => visionLevel(name)?.level || null,
  urbanTip(u) {
    const before = (u.from2030 || []).map(planUrbanOf).filter(Boolean)
      .map(p => `${escapeHtml(p.name)} (${p.cls})`);
    return [
      `<b class="ua-tip-name">${escapeHtml(u.name)}</b> ${clsTag(u.cls)}`,
      `${VISION_STAGE}: ${escapeHtml(u.change)}`,
      `Phạm vi: ${escapeHtml(u.scope)}`,
      before.length ? `Đến 2030: ${before.join(' · ')}` : '',
      u.inferred ? muted(`Suy ra: ${u.inferred}`) : '',
      muted(`${VISION_REF}, ${VISION_CLAUSE}`)
    ].filter(Boolean).join('<br>');
  },
  wardTip(name) {
    const lvl = visionLevel(name);
    const rows = [`<b class="ua-tip-name">${escapeHtml(name)}</b>`];
    if (lvl) {
      const by2030 = lvl.by2030 ? `loại ${lvl.by2030}` : 'chưa đạt';
      rows.push(`${VISION_STAGE}: trình độ phát triển đô thị ${clsTag(lvl.level)} (đến 2030: ${by2030})`);
      rows.push(muted(`${lvl.inferred ? 'Suy ra: ' : ''}${lvl.basis}`));
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
  let fillRenderer = null;
  let townRenderer = null;
  let lineRenderer = null;
  const groups = { wards: L.layerGroup(), towns: L.layerGroup(), lines: L.layerGroup(), badges: L.layerGroup() };
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

  function wardAt({ lat, lng }) {
    return wardHits.find(w => lng >= w.bbox[0] && lng <= w.bbox[2] && lat >= w.bbox[1] && lat <= w.bbox[3]
      && turf.booleanPointInPolygon([lng, lat], w.feat));
  }

  function onMouseMove(e) {
    if (!visible || pointerOnUrban || m.getZoom() > WARD_HOVER_MAX_ZOOM) { clearWardHover(); return; }
    const w = wardAt(e.latlng);
    if (!w) { clearWardHover(); return; }
    if (wardHover?.name !== w.name) {
      clearWardHover();
      wardHover = {
        name: w.name,
        outline: L.polyline(ringsOf(w.feat.geometry), { pane: FILL_PANE, renderer: fillRenderer, interactive: false, color: '#f8fafc', weight: 1.5, opacity: 0.9 }).addTo(m),
        tip: L.tooltip({ ...tipOpts, sticky: false }).setContent(content.wardTip(w.name))
      };
    }
    wardHover.tip.setLatLng(e.latlng);
    if (!m.hasLayer(wardHover.tip)) m.openTooltip(wardHover.tip);
  }

  const urbanHover = (on) => () => { pointerOnUrban = on; if (on) clearWardHover(); };

  function drawWards() {
    groups.wards.clearLayers();
    clearWardHover();
    wardHits = [];
    const op = fillOpacity(m.getZoom());
    (state.wardLabelsList || []).forEach(w => {
      if (!w.geometry) return;
      const level = content.wardLevel(w.name);
      const layer = L.geoJSON(w.geometry, {
        pane: FILL_PANE, renderer: fillRenderer, interactive: false,
        style: { stroke: false, fillColor: level ? LEVEL_FILL[level] : RURAL_FILL, fillOpacity: level ? op : op * 0.5 }
      });
      layer.eachLayer(l => { l.options.uaRural = !level; });
      groups.wards.addLayer(layer);
      const feat = { type: 'Feature', properties: {}, geometry: w.geometry };
      wardHits.push({ name: w.name, feat, bbox: turf.bbox(feat) });
    });
  }

  function drawUrbans(fc) {
    groups.towns.clearLayers();
    groups.lines.clearLayers();
    groups.badges.clearLayers();
    const op = fillOpacity(m.getZoom());
    // Loại I vẽ trước, loại III sau cùng để nét đô thị nhỏ nằm trên
    const rank = (f) => CLS_RANK[byId.get(f.properties.id)?.cls] ?? 3;
    [...fc.features].sort((a, b) => rank(a) - rank(b)).forEach(f => {
      const u = byId.get(f.properties.id);
      if (!u) return;
      const isArea = f.geometry.type !== 'Point';
      const inferred = !!f.properties.inferred;
      if (isArea && u.part && LEVEL_FILL[u.cls]) {
        groups.towns.addLayer(L.geoJSON(f.geometry, {
          pane: TOWN_PANE, renderer: townRenderer, interactive: false,
          style: { stroke: false, fillColor: LEVEL_FILL[u.cls], fillOpacity: op }
        }));
      }
      if (isArea) {
        const rings = ringsOf(f.geometry);
        const style = LINE_STYLE[u.cls] || LINE_STYLE.III;
        const casing = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, interactive: false, color: '#0f172a', weight: style.weight + 2.5, opacity: 0.55 });
        const line = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, interactive: false, ...style, opacity: 0.95 });
        // Nét trong suốt rộng hơn để dễ trỏ trúng ranh
        const hit = L.polyline(rings, { pane: LINE_PANE, renderer: lineRenderer, weight: HIT_WEIGHT, opacity: 0, bubblingMouseEvents: false });
        hit.bindTooltip(content.urbanTip(u, { inferred }), tipOpts);
        hit.on('mouseover', () => { urbanHover(true)(); line.setStyle({ weight: style.weight + 1.5 }); });
        hit.on('mouseout', () => { urbanHover(false)(); line.setStyle({ weight: style.weight }); });
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
        .bindTooltip(content.urbanTip(u, { approx: !!f.properties.approx, hasArea: isArea, inferred }), { ...tipOpts, sticky: false, offset: [0, -16] })
        .on('mouseover', urbanHover(true))
        .on('mouseout', urbanHover(false))
        .addTo(groups.badges);
    });
  }

  function restyle() {
    if (!visible) return;
    const z = m.getZoom();
    const op = fillOpacity(z);
    groups.wards.eachLayer(g => g.eachLayer?.(l => l.setStyle({ fillOpacity: l.options.uaRural ? op * 0.5 : op })));
    groups.towns.eachLayer(g => g.setStyle?.({ fillOpacity: op }));
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
      fillRenderer = L.canvas({ pane: FILL_PANE });
      townRenderer = L.canvas({ pane: TOWN_PANE });
      lineRenderer = L.svg({ pane: LINE_PANE });
      m.on('zoomend', restyle);
      m.on('mousemove', onMouseMove);
      m.on('mouseout', clearWardHover);
    },
    async setVisible(on) {
      if (!m) return;
      visible = !!on;
      if (!visible) {
        Object.values(groups).forEach(g => g.remove());
        clearWardHover();
        pointerOnUrban = false;
        m.getContainer().classList.remove('ua-zoom-low');
        return;
      }
      groups.wards.addTo(m);
      groups.towns.addTo(m);
      groups.lines.addTo(m);
      drawWards();
      try {
        drawUrbans(await loadData());
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
    }
  };
}

const statusLayer = createUrbanLayer(statusContent);
const visionLayer = createUrbanLayer(visionContent);

async function setVisible(on, { fit = false } = {}) {
  const legend = $('urbanLegend');
  if (legend) legend.style.display = on ? '' : 'none';
  await Promise.all([statusLayer.setVisible(on), visionLayer.setVisible(on)]);
  if (!on || !fit) return;
  const shown = isCompareOn() && !isSplitOn() && planMap ? planMap : map;
  const b = statusLayer.bounds() || visionLayer.bounds();
  if (shown.getZoom() > 11 && b && b.isValid()) shown.flyToBounds(b, { padding: [20, 20], maxZoom: 10, duration: 0.8 });
}

/** Gọi lại khi ranh 40 phường xã tải xong (lớp có thể đã bật trước đó). */
export function refreshUrbanAreaLayer() {
  statusLayer.refresh();
  visionLayer.refresh();
}

export function initUrbanAreaLayer() {
  if (!map) return;
  statusLayer.init(map);
  if (planMap) visionLayer.init(planMap);
  $chk()?.addEventListener('change', (e) => setVisible(e.target.checked, { fit: true }));
  if ($chk()?.checked) setVisible(true);
}
