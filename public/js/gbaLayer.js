// Dấu chân Global Building Atlas: PMTiles z13–16. Mã c trong tile là phân vị cũ;
// màu vẽ theo số tầng (chiều cao mét / 4) từ bldg-hf.bin. Nhà có labelFloors giữ số công bố.
// Từ mức phóng 17, số tầng ghi trên dấu chân đủ rộng, tại điểm xa biên nhất.
// Lưới cường độ 150 m không còn là lớp riêng. Số liệu lô / phường vẫn lấy từ agg.json.
import { map, setLandPopupExtra } from './mapEngine.js';
import { planMap } from './planMap.js';
import { MAP_MAX_ZOOM } from './basemap.js';
import { geeApi } from './api.js';
import { setWardGbaHtml } from './uiComponents.js';
import { GBA_FLOOR_CLASSES, GBA_FLOOR_COLORS, floorClassIndex, floorLabelVisible, floorsForReading, gbaLotKey, gbaStatsHtml, gbaWardExtra, poleOfInaccessibility } from './gbaStats.js';
import { heightAt, loadBuildingHeights } from './bldgHeight.js';
import { withAssetVersion } from './gbaVersion.js';
import { trackWork, watchTiles } from './loadProgress.js';

const LIBS = {
  pmtiles: 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm',
  vectorTile: 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.5/+esm',
  pbf: 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm'
};
const LAYER = 'gba';
const MIN_ZOOM = 13;
const DATA_ZOOM = 16;
const FOOT_PANE = 'gbaPane';
const FOOT_Z = 408;
const TILE_CACHE = 64;
const ATTR = 'Công trình © TUM (Global Building Atlas), Google, Microsoft, OpenStreetMap · CC BY-NC 4.0, ODbL';

const $ = (id) => document.getElementById(id);

let feetOn = false;
let agg = null;
let aggP = null;
let ready = null;
let floorZonesP = null;
let floorZones = [];
let heightsIdx = null;
const tiles = new Map();
const repaints = [];
let footL = null, footR = null;
let attrOn = false;

function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  let phone = false;
  try { phone = window.matchMedia('(pointer: coarse), (max-width: 840px)').matches; } catch (e) { /* không có matchMedia */ }
  return phone ? 1 : Math.min(dpr, 2);
}

function localSources() {
  return {
    pmtiles: new URL('data/gba/buildings.pmtiles', document.baseURI).href,
    agg: new URL('data/gba/agg.json', document.baseURI).href
  };
}

function versionedSources(info) {
  return {
    pmtiles: withAssetVersion(info.pmtiles),
    agg: withAssetVersion(info.agg)
  };
}

function sources() {
  const local = versionedSources(localSources());
  return fetch(geeApi('action=getGbaInfo'))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('api'))))
    .then((info) => {
      if (!info || !info.pmtiles || !info.agg) throw new Error('api');
      const remote = versionedSources(info);
      return fetch(remote.pmtiles, { headers: { Range: 'bytes=0-7' } }).then((probe) => {
        if (probe.status === 206 || probe.ok) return remote;
        throw new Error('tiles');
      });
    })
    .catch(() => local);
}

function loadAgg() {
  if (agg) return Promise.resolve(agg);
  if (!aggP) {
    aggP = sources().then((info) => fetch(info.agg)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then((data) => { agg = data; return data; })
      .catch((err) => { aggP = null; throw err; });
  }
  return aggP;
}

// GCS trả 206. python http.server bỏ Range và trả cả file (200): tải một lần rồi cắt, kẻo PMTiles từ chối.
function byteSource(url) {
  let whole = null;
  let decided = null;
  return {
    getKey() { return url; },
    getBytes(offset, length) {
      if (whole) return Promise.resolve({ data: whole.slice(offset, offset + length) });
      if (!decided) {
        decided = fetch(url, { headers: { Range: 'bytes=0-16383' } }).then(async (res) => {
          if (!res.ok) throw new Error(`PMTiles HTTP ${res.status}`);
          const declared = Number(res.headers.get('Content-Length') || 0);
          if (res.status === 206 || (declared > 0 && declared <= 16384)) return 'range';
          whole = await res.arrayBuffer();
          return 'buffer';
        }).catch((err) => { decided = null; throw err; });
      }
      return decided.then(async (kind) => {
        if (kind === 'buffer') return { data: whole.slice(offset, offset + length) };
        const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (!res.ok) throw new Error(`PMTiles HTTP ${res.status}`);
        return { data: await res.arrayBuffer() };
      });
    }
  };
}

function ensureReady() {
  if (!ready) {
    ready = Promise.all([
      sources(),
      import(LIBS.pmtiles), import(LIBS.vectorTile), import(LIBS.pbf)
    ]).then(([info, pm, vt, pbf]) => ({
      info,
      archive: new pm.PMTiles(byteSource(info.pmtiles)),
      VectorTile: vt.VectorTile,
      Pbf: pbf.default
    }));
    ready.catch(() => { ready = null; });
  }
  return ready;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0]) inside = !inside;
  }
  return inside;
}

function footprintAreaM2(z, x, y, ring, extent) {
  if (!ring || ring.length < 3) return 0;
  const ll = ring.map(([px, py]) => lngLatOf(z, x, y, px, py, extent));
  const mlat = 110540;
  const mlng = 111320 * Math.cos(ll[0][1] * Math.PI / 180);
  let sum = 0;
  for (let i = 0, j = ll.length - 1; i < ll.length; j = i++) {
    sum += (ll[j][0] * mlng) * (ll[i][1] * mlat) - (ll[i][0] * mlng) * (ll[j][1] * mlat);
  }
  return Math.abs(sum) / 2;
}

function loadFloorZones() {
  if (!floorZonesP) {
    const url = new URL('data/gba/bldg-overrides.geojson', document.baseURI).href;
    floorZonesP = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).then((fc) => {
      floorZones = (fc.features || []).flatMap((f) => {
        const floors = Number(f.properties && f.properties.labelFloors);
        const geom = f.geometry;
        if (!(floors > 0) || !geom) return [];
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
        if (!polys.length) return [];
        return [{ floors, minArea: Number(f.properties.minArea) || 0, polys }];
      });
      return floorZones;
    }).catch(() => { floorZonesP = null; floorZones = []; return []; });
  }
  return floorZonesP;
}

function zoneFloors(lng, lat, area, zones) {
  let best = null;
  (zones || []).forEach((z) => {
    if (z.minArea && area < z.minArea) return;
    const hit = z.polys.some((poly) => poly[0] && pointInRing(lng, lat, poly[0]));
    if (hit && (best == null || z.floors > best)) best = z.floors;
  });
  return best;
}

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let p = tiles.get(key);
  if (p) { tiles.delete(key); tiles.set(key, p); return p; }
  p = Promise.all([ensureReady(), loadFloorZones()]).then(async ([{ archive, VectorTile, Pbf }]) => {
    const res = await archive.getZxy(z, x, y);
    if (!res || !res.data) return [];
    const layer = new VectorTile(new Pbf(new Uint8Array(res.data))).layers[LAYER];
    const out = [];
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      const rings = f.loadGeometry().map((r) => r.map((pt) => [pt.x, pt.y]));
      const ring = rings[0] || [];
      let sx = 0;
      let sy = 0;
      ring.forEach(([px, py]) => { sx += px; sy += py; });
      const n = ring.length || 1;
      const [lng, lat] = lngLatOf(z, x, y, sx / n, sy / n, layer.extent);
      out.push({
        rings,
        extent: layer.extent,
        lng,
        lat,
        area: footprintAreaM2(z, x, y, ring, layer.extent)
      });
    }
    return out;
  });
  p.catch(() => tiles.delete(key));
  tiles.set(key, p);
  while (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value);
  return p;
}

function paintFeatures(raw) {
  return raw.map((ft) => {
    const h = heightsIdx ? heightAt(ft.lng, ft.lat, heightsIdx) : null;
    const floors = floorsForReading(h, zoneFloors(ft.lng, ft.lat, ft.area, floorZones));
    const anchor = floors == null ? null : poleOfInaccessibility(ft.rings, 8);
    return {
      rings: ft.rings,
      extent: ft.extent,
      fc: floorClassIndex(h, floors),
      floors,
      label: anchor
    };
  });
}

function drawFoot(canvas, feats, coords, dz, size, dpr) {
  if (!feats.length) return;
  const ctx = canvas.getContext('2d');
  const ext = feats[0].extent;
  const f = 2 ** dz;
  const ox = coords.x - ((coords.x >> dz) << dz);
  const oy = coords.y - ((coords.y >> dz) << dz);
  const k = (size * f * dpr) / ext;
  const view = [(ox * ext) / f, (oy * ext) / f, ((ox + 1) * ext) / f, ((oy + 1) * ext) / f];
  const px = (x) => (x - view[0]) * k;
  const py = (y) => (y - view[1]) * k;
  const by = new Map();
  feats.forEach((ft) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    ft.rings.forEach((r) => r.forEach(([x, y]) => {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    }));
    if (maxx < view[0] || minx > view[2] || maxy < view[1] || miny > view[3]) return;
    const c = Math.max(0, Math.min(3, ft.fc || 0));
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(ft);
  });
  ctx.lineWidth = (coords.z >= 16 ? 0.6 : 0.35) * dpr;
  ctx.lineJoin = 'round';
  by.forEach((list, c) => {
    ctx.beginPath();
    list.forEach((ft) => ft.rings.forEach((r) => {
      ctx.moveTo(px(r[0][0]), py(r[0][1]));
      for (let i = 1; i < r.length; i++) ctx.lineTo(px(r[i][0]), py(r[i][1]));
      ctx.closePath();
    }));
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = GBA_FLOOR_COLORS[c];
    ctx.fill('evenodd');
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#431407';
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  if (coords.z < 17) return;
  ctx.save();
  ctx.font = `600 ${Math.round(11 * dpr)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = 1.35 * dpr;
  ctx.strokeStyle = 'rgba(28, 16, 8, 0.92)';
  ctx.fillStyle = '#ffffff';
  feats.forEach((ft) => {
    const anchor = ft.label;
    if (!anchor || ft.floors == null) return;
    if (anchor.x < view[0] || anchor.y < view[1] || anchor.x >= view[2] || anchor.y >= view[3]) return;
    const cssR = (anchor.d * size * f) / ext;
    if (!floorLabelVisible(coords.z, ft.floors, cssR)) return;
    const x = px(anchor.x);
    const y = py(anchor.y);
    const text = String(ft.floors);
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  });
  ctx.restore();
}

const FootGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const canvas = document.createElement('canvas');
    const size = this.getTileSize().x;
    const dpr = pixelRatio();
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const dz = Math.max(0, coords.z - DATA_ZOOM);
    loadTile(coords.z - dz, coords.x >> dz, coords.y >> dz)
      .then((raw) => {
        const paint = () => drawFoot(canvas, paintFeatures(raw), coords, dz, size, dpr);
        paint();
        if (!heightsIdx) repaints.push(paint);
        done(null, canvas);
      })
      .catch((err) => done(err, canvas));
    return canvas;
  }
});

function pane(m, name, z) {
  if (m.getPane(name)) return;
  const el = m.createPane(name);
  el.style.zIndex = String(z);
  el.style.pointerEvents = 'none';
}

function syncAttr() {
  const on = feetOn;
  [map, planMap].forEach((m) => {
    if (!m || !m.attributionControl) return;
    if (on && !attrOn) m.attributionControl.addAttribution(ATTR);
    if (!on && attrOn) m.attributionControl.removeAttribution(ATTR);
  });
  attrOn = on;
}

function legendHtml() {
  const swatch = GBA_FLOOR_CLASSES.map((name, i) => `<span><i style="background:${GBA_FLOOR_COLORS[i]}"></i>${name}</span>`).join('');
  return `<div class="gba-legend" aria-label="Số tầng công trình, chiều cao chia 4">${swatch}</div>`;
}

function paintBox() {
  const box = $('gbaBox');
  if (box) box.style.display = feetOn ? '' : 'none';
  const hint = $('gbaHint');
  if (hint) hint.textContent = feetOn && map && map.getZoom() < MIN_ZOOM ? '(phóng tới mức 13)' : '';
}

function addFeet(m) {
  pane(m, FOOT_PANE, FOOT_Z);
  return watchTiles(new FootGrid({ pane: FOOT_PANE, minZoom: MIN_ZOOM, maxZoom: MAP_MAX_ZOOM, updateWhenZooming: false, keepBuffer: 1 }), 'Công trình xây dựng').addTo(m);
}

function applyFeet() {
  if (feetOn) {
    if (map && !footL) footL = addFeet(map);
    if (planMap && !footR) footR = addFeet(planMap);
  } else {
    footL?.remove(); footL = null;
    footR?.remove(); footR = null;
  }
}

function ensureAgg() {
  if (!agg) loadAgg().catch(() => {});
}

function wardHtml(name) {
  ensureAgg();
  const row = agg && (agg.wards || []).find((w) => w.name === name);
  if (!row) return '';
  const line = [row.n, row.fp, row.cov, row.cls, row.fai];
  if (Number.isFinite(Number(row.rn))) line.push(row.rn, row.rfp, row.rcov, null);
  return gbaStatsHtml(line, gbaWardExtra(row, { largeM2: agg.largeM2, smallM2: agg.smallM2 }));
}

function lotHtml(p) {
  ensureAgg();
  if (!agg || !p) return '';
  const key = gbaLotKey(p.file, p.phase, p.id);
  const row = agg.lots && agg.lots[key];
  return row ? gbaStatsHtml(row) : '';
}

function lngLatOf(z, x, y, px, py, extent) {
  const n = 2 ** z;
  const gx = x + px / extent;
  const gy = y + py / extent;
  const lng = (gx / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * (180 / Math.PI);
  return [lng, lat];
}

function tilesCovering(box) {
  const z = DATA_ZOOM;
  const n = 2 ** z;
  const latY = (lat) => {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  };
  const x0 = Math.max(0, Math.floor(((box.west + 180) / 360) * n));
  const x1 = Math.min(n - 1, Math.floor(((box.east + 180) / 360) * n));
  const y0 = Math.max(0, latY(box.north));
  const y1 = Math.min(n - 1, latY(box.south));
  const tiles = [];
  if (x1 < x0 || y1 < y0) return tiles;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  return tiles;
}

/** Dấu chân trong khung {west,south,east,north}, mức 16. Quá 48 ô thì chỉ trả số ô, không tải. */
export async function gbaFootprintsIn(box) {
  const tiles = tilesCovering(box);
  if (tiles.length > 48) return { tiles: tiles.length, features: [] };
  const loaded = await Promise.all(tiles.map(([x, y]) => loadTile(DATA_ZOOM, x, y)
    .then((feats) => ({ x, y, feats }))
    .catch(() => ({ x, y, feats: [] }))));
  const features = [];
  loaded.forEach(({ x, y, feats }) => {
    feats.forEach((ft) => {
      const extent = ft.extent || 4096;
      features.push({
        rings: ft.rings.map((ring) => ring.map(([px, py]) => lngLatOf(DATA_ZOOM, x, y, px, py, extent)))
      });
    });
  });
  return { tiles: tiles.length, features };
}

export function initGbaLayer() {
  if (!map) return;
  const box = $('gbaBox');
  if (box) box.innerHTML = legendHtml();
  setLandPopupExtra(lotHtml);
  setWardGbaHtml(wardHtml);
  map.on('zoomend', paintBox);
  $('chk_gba')?.addEventListener('change', (e) => {
    feetOn = !!e.target.checked;
    if (feetOn) {
      trackWork('Công trình xây dựng', loadAgg().catch(() => {}));
      trackWork('Công trình xây dựng', loadBuildingHeights().then((idx) => {
        heightsIdx = idx;
        const jobs = repaints.splice(0);
        jobs.forEach((paint) => { try { paint(); } catch (err) { /* ô đã gỡ */ } });
      }).catch(() => { repaints.length = 0; }));
    } else {
      repaints.length = 0;
    }
    applyFeet();
    syncAttr();
    paintBox();
  });
}
