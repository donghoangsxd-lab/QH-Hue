// Nút trên thẻ lô mới cắt dấu chân theo ranh và đối chiếu mật độ, hệ số, tầng cao.
// Mở thẻ không gọi mạng và không tính.
import { setLotBuildup } from './mapEngine.js';
import { gbaFootprintsIn } from './gbaLayer.js';
import { heightAt, loadBuildingHeights } from './bldgHeight.js';
import { buildupHtml, floorsFromHeight, lotBuildupButtonHtml } from './lotScreen.js';
import { withAssetVersion } from './gbaVersion.js';

const MAX_TILES = 48;

let overridesP = null;

function asFeature(geom) {
  if (!geom) return null;
  if (geom.type === 'Feature') return geom;
  if (geom.type === 'FeatureCollection') return (geom.features && geom.features[0]) || null;
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
    return { type: 'Feature', properties: {}, geometry: geom };
  }
  return null;
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return ring.concat([a]);
}

function featureFromRings(rings) {
  const turf = globalThis.turf;
  if (!turf || !rings.length) return null;
  const parts = [];
  let current = null;
  rings.forEach((ring) => {
    const closed = closeRing(ring);
    if (closed.length < 4) return;
    let sum = 0;
    for (let i = 0, j = closed.length - 1; i < closed.length - 1; j = i++) {
      sum += (closed[j][0] - closed[i][0]) * (closed[j][1] + closed[i][1]);
    }
    if (sum <= 0) {
      if (current) parts.push(current);
      current = [closed];
    } else if (current) current.push(closed);
    else parts.push([closed]);
  });
  if (current) parts.push(current);
  try {
    if (parts.length === 1) return turf.polygon(parts[0]);
    if (parts.length > 1) return turf.multiPolygon(parts);
  } catch (e) { /* vòng không khép */ }
  return null;
}

function bboxOf(feature) {
  const turf = globalThis.turf;
  try {
    const box = turf.bbox(feature);
    return { west: box[0], south: box[1], east: box[2], north: box[3] };
  } catch (e) {
    return null;
  }
}

function ringsBbox(rings) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  rings.forEach((ring) => ring.forEach(([lng, lat]) => {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }));
  return [west, south, east, north];
}

function overlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function loadOverridePack() {
  const turf = globalThis.turf;
  if (!turf) return Promise.resolve({ parts: [], zones: [] });
  if (!overridesP) {
    const url = withAssetVersion('data/gba/bldg-overrides.geojson');
    overridesP = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).then((fc) => {
      const parts = [];
      const zones = [];
      (fc.features || []).forEach((f) => {
        if (!f.properties || !f.geometry) return;
        const g = f.geometry;
        const coords = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const floors = Number(f.properties.labelFloors);
        coords.forEach((ring) => {
          try {
            let poly = turf.polygon(ring);
            if (turf.rewind) poly = turf.rewind(poly);
            if (turf.area(poly) < 80) return;
            if (f.properties.draw) parts.push(poly);
            if (floors > 0) zones.push({ poly, floors, minArea: Number(f.properties.minArea) || 0 });
          } catch (e) { /* vòng hỏng */ }
        });
      });
      return { parts, zones };
    }).catch((err) => {
      overridesP = null;
      throw err;
    });
  }
  return overridesP;
}

function publishedFloors(center, areaM2, zones) {
  const turf = globalThis.turf;
  if (!center || !zones.length) return null;
  const pt = turf.point(center);
  let best = null;
  zones.forEach((z) => {
    if (z.minArea && areaM2 < z.minArea) return;
    try {
      if (turf.booleanPointInPolygon(pt, z.poly) && (best == null || z.floors > best)) best = z.floors;
    } catch (e) { /* điểm ngoài vòng */ }
  });
  return best;
}

function insideOverride(center, extras) {
  const turf = globalThis.turf;
  if (!center || !extras.length) return false;
  const pt = turf.point(center);
  return extras.some((poly) => {
    try { return turf.booleanPointInPolygon(pt, poly); } catch (e) { return false; }
  });
}

async function measure(lotFeature, polys, heights, heightReady, zones) {
  const turf = globalThis.turf;
  let footM2 = 0;
  let count = 0;
  let gfaM2 = 0;
  let missingHeight = 0;
  let knownArea = 0;
  let maxF = null;
  let minM = null;
  let maxM = null;
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    let clipped = null;
    try { clipped = turf.intersect(poly, lotFeature); } catch (e) { clipped = null; }
    if (!clipped) continue;
    const area = turf.area(clipped);
    if (!(area >= 0.5)) continue;
    count += 1;
    footM2 += area;
    let center = null;
    try { center = turf.centroid(poly).geometry.coordinates; } catch (e) { center = null; }
    const meters = heightReady && center ? heightAt(center[0], center[1], heights) : null;
    if (meters > 0) {
      if (minM == null || meters < minM) minM = meters;
      if (maxM == null || meters > maxM) maxM = meters;
    }
    const published = center ? publishedFloors(center, turf.area(poly), zones) : null;
    const storey = published != null ? published : floorsFromHeight(meters);
    if (storey == null) {
      if (heightReady) missingHeight += 1;
      continue;
    }
    if (maxF == null || storey > maxF) maxF = storey;
    knownArea += area;
    gfaM2 += area * storey;
    if (i % 250 === 249) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    footM2,
    count,
    gfaM2,
    missingHeight,
    maxF,
    meanF: knownArea > 0 ? gfaM2 / knownArea : null,
    minM,
    maxM
  };
}

async function compute(lot) {
  const turf = globalThis.turf;
  const feature = asFeature(lot && lot.geometry);
  if (!turf || !feature) return '<span>Không có ranh lô để đối chiếu.</span>';
  const box = bboxOf(feature);
  if (!box) return '<span>Không tính được diện tích lô.</span>';
  const lotM2 = turf.area(feature);
  let pack;
  try {
    pack = await gbaFootprintsIn(box);
  } catch (e) {
    return '<span>Chưa tải được dấu chân công trình.</span>';
  }
  if (pack.tiles > MAX_TILES) {
    return `<span>Lô phủ ${pack.tiles} ô bản đồ. Chỉ cắt dấu chân khi lô nằm trong ${MAX_TILES} ô mức 16.</span>`;
  }
  let extras = [];
  let zones = [];
  try {
    const pack = await loadOverridePack();
    extras = pack.parts;
    zones = pack.zones;
  } catch (e) { extras = []; zones = []; }
  const lotBox = [box.west, box.south, box.east, box.north];
  const extraHits = extras.filter((poly) => {
    const b = bboxOf(poly);
    return b && overlaps([b.west, b.south, b.east, b.north], lotBox);
  });
  const polys = extraHits.slice();
  const seen = new Set();
  pack.features.forEach((item) => {
    if (!overlaps(ringsBbox(item.rings), lotBox)) return;
    const poly = featureFromRings(item.rings);
    if (!poly) return;
    let center = null;
    try { center = turf.centroid(poly).geometry.coordinates; } catch (e) { center = null; }
    if (center) {
      const key = `${center[0].toFixed(5)}|${center[1].toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (insideOverride(center, extraHits)) return;
    }
    let hit = false;
    try { hit = turf.booleanIntersects(poly, feature); } catch (e) { hit = false; }
    if (!hit) return;
    polys.push(poly);
  });
  let heights = null;
  let heightReady = true;
  try {
    heights = await loadBuildingHeights();
  } catch (e) {
    heightReady = false;
  }
  const measured = await measure(feature, polys, heights, heightReady, zones);
  return buildupHtml({
    lotM2,
    ...measured,
    heightReady,
    plan: lot.plan || null
  });
}

const LOADING = 'Đang đối chiếu dấu chân công trình…';

function relayout(popup) {
  try {
    if (typeof popup._updateLayout === 'function') popup._updateLayout();
    if (typeof popup._updatePosition === 'function') popup._updatePosition();
  } catch (e) { /* thẻ đã đóng */ }
}

function stopMapClick(e) {
  e.preventDefault();
  e.stopPropagation();
  globalThis.L?.DomEvent?.stop(e);
}

export function attachLotBuildup(popup, lot) {
  const arm = () => {
    const root = popup.getElement();
    if (!root || root.dataset.buildupArmed === '1') return;
    root.dataset.buildupArmed = '1';
    let el = root.querySelector('[data-lot-buildup]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'lot-buildup';
      el.setAttribute('data-lot-buildup', '');
      root.querySelector('.pp, .qhc-pop')?.appendChild(el) || root.appendChild(el);
    }
    // Popup không có icon hàng công cụ (QHCT tĩnh): giữ nút chữ trong khung kết quả.
    if (!root.querySelector('[data-lot-buildup-run]')) el.innerHTML = lotBuildupButtonHtml();
    const run = (e) => {
      const btn = e.target.closest?.('[data-lot-buildup-run]');
      if (!btn || !root.contains(btn)) return;
      stopMapClick(e);
      if (el.dataset.running === '1') return;
      el.dataset.running = '1';
      const token = `${Date.now()}-${Math.random()}`;
      el.dataset.token = token;
      el.textContent = LOADING;
      relayout(popup);
      const alive = () => popup.isOpen?.() !== false && el.dataset.token === token;
      compute(lot).then((html) => {
        if (!alive()) return;
        el.innerHTML = html;
        delete el.dataset.running;
        relayout(popup);
      }).catch(() => {
        if (!alive()) return;
        el.dataset.running = '';
        el.innerHTML = `<span class="is-miss">Chưa đối chiếu được dấu chân công trình.</span>${lotBuildupButtonHtml()}`;
        relayout(popup);
      });
    };
    root.addEventListener('click', run);
  };
  if (popup.getElement()) arm();
  else popup.once('add', arm);
}

export function initLotBuildup() {
  setLotBuildup(attachLotBuildup);
}
