// Raster IMAGE từ gisHue mapid 21817 (XYZ Web Mercator đã nắn). Ưu tiên Bản đồ 09 SDD dưới lớp lô vector.
// Tile lấy trực tiếp từ gissonganh (CORS *); cache cục bộ .cache/gishue/raster/<id>/ để mirror GCS sau.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';

const PANE = 'qhcRasterPane';
const PANE_Z = 350;
const HOST = 'https://gissonganh.hue.gov.vn';
const CAT = 'data/qhc-raster/catalog.json';

const $ = (id) => document.getElementById(id);

let catalog = null;
let layerByMap = new WeakMap(); // map → L.TileLayer
let activeId = 'bando_qhsdd_kvdttt_1_10n';

function ensurePane(m) {
  if (!m) return;
  const pane = m.getPane(PANE) || m.createPane(PANE);
  pane.style.zIndex = String(PANE_Z);
  pane.style.pointerEvents = 'none';
}

function tileUrl(entry) {
  const path = String(entry.path || '').replace(/\$\{z\}/g, '{z}').replace(/\$\{x\}/g, '{x}').replace(/\$\{y\}/g, '{y}');
  return `${HOST}${path}`;
}

function entryOf(id) {
  const list = (catalog && catalog.layers) || [];
  return list.find((row) => row.id === id) || list[0] || null;
}

function hosts() {
  return [map, planMap].filter(Boolean);
}

function wanted() {
  const chk = $('chk_qhc10raster09');
  if (chk && !chk.checked) return false;
  return getLevel() === 'qhc10';
}

function paintOne(m) {
  if (!m) return;
  const prev = layerByMap.get(m);
  if (prev) {
    try { m.removeLayer(prev); } catch (e) { /* */ }
    layerByMap.delete(m);
  }
  if (!wanted()) return;
  const entry = entryOf(activeId);
  if (!entry) return;
  ensurePane(m);
  const layer = L.tileLayer(tileUrl(entry), {
    pane: PANE,
    minZoom: entry.zMin || 9,
    maxZoom: Math.max(entry.zMax || 18, 19),
    maxNativeZoom: entry.zMax || 18,
    opacity: 0.88,
    crossOrigin: true,
    attribution: 'gisHue mapid 21817'
  });
  layer.addTo(m);
  layerByMap.set(m, layer);
}

function paintAll() {
  hosts().forEach(paintOne);
}

async function loadCatalog() {
  if (catalog) return catalog;
  try {
    const res = await fetch(CAT, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = await res.json();
    if (catalog.defaultId) activeId = catalog.defaultId;
  } catch (err) {
    console.warn('Không tải catalog raster QHC:', err.message);
    catalog = {
      defaultId: activeId,
      layers: [{
        id: activeId,
        path: '/gservices/rest/maps/bando_qhsdd_kvdttt_1_10n/tile/${z}/${x}/${y}.png',
        zMin: 9,
        zMax: 18
      }]
    };
  }
  return catalog;
}

export function initQhcRasterLayer() {
  loadCatalog().then(() => paintAll());
  $('chk_qhc10raster09')?.addEventListener('change', () => paintAll());
  document.addEventListener(LEVEL_EVENT, () => paintAll());
  // Khi bật/tắt QHC10 vector vẫn giữ raster nếu ô raster đang tick
  $('chk_qhc10')?.addEventListener('change', () => {
    if (getLevel() === 'qhc10') paintAll();
  });
  $('chk_qhc10head')?.addEventListener('change', () => paintAll());
}
