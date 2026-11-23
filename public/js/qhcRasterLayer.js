// Raster IMAGE từ gisHue mapid 21817 (XYZ Web Mercator đã nắn). Ưu tiên Bản đồ 09 SDD.
// Pane dưới qhcPane (350): trên tilePane vệ tinh (200), dưới lô QH sử dụng đất.
// Tile lấy trực tiếp từ gissonganh (không crossOrigin: server trả ACAO «*, *» nên trình duyệt chặn).
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';

const PANE = 'qhcRasterPane';
const PANE_Z = 250;
const HOST = 'https://gissonganh.hue.gov.vn';
const CAT = 'data/qhc-raster/catalog.json';
const DEFAULT_OPACITY = 0.7;

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

function opacityOf() {
  const el = $('qhcRaster09Opacity');
  if (!el) return DEFAULT_OPACITY;
  const n = Number(el.value);
  if (!Number.isFinite(n)) return DEFAULT_OPACITY;
  return Math.min(1, Math.max(0, n / 100));
}

function syncOpBox() {
  const box = $('qhcRaster09OpBox');
  if (!box) return;
  box.style.display = $('chk_qhc10raster09')?.checked ? '' : 'none';
}

function wanted() {
  const chk = $('chk_qhc10raster09');
  if (chk && !chk.checked) return false;
  return getLevel() === 'qhc10';
}

function applyOpacity() {
  const o = opacityOf();
  hosts().forEach((m) => {
    const layer = layerByMap.get(m);
    if (layer) layer.setOpacity(o);
  });
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
    opacity: opacityOf(),
    attribution: 'gisHue mapid 21817'
  });
  layer.addTo(m);
  layerByMap.set(m, layer);
}

function paintAll() {
  syncOpBox();
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
  $('qhcRaster09Opacity')?.addEventListener('input', () => applyOpacity());
  document.addEventListener(LEVEL_EVENT, () => paintAll());
  // Khi bật/tắt QHC10 vector vẫn giữ raster nếu ô raster đang tick
  $('chk_qhc10')?.addEventListener('change', () => {
    if (getLevel() === 'qhc10') paintAll();
  });
  $('chk_qhc10head')?.addEventListener('change', () => paintAll());
}
