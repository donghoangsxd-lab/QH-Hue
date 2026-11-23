// Raster IMAGE từ gisHue mapid 21817 (XYZ Web Mercator đã nắn).
// Pane dưới qhcPane (350): trên tilePane vệ tinh (200), dưới lô vector QHC.
// Phân cấp catalog.level = qhc25 | qhc10; phase HT | QH. Không crossOrigin (ACAO gisHue lỗi).
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';

const PANE = 'qhcRasterPane';
const PANE_Z = 250;
const HOST = 'https://gissonganh.hue.gov.vn';
const CAT = 'data/qhc-raster/catalog.json';
const DEFAULT_OPACITY = 70;
const SLOT = {
  qhc25: { HT: 'qhcRasterSlot25Ht', QH: 'qhcRasterSlot25Qh' },
  qhc10: { HT: 'qhcRasterSlot10Ht', QH: 'qhcRasterSlot10Qh' }
};

const $ = (id) => document.getElementById(id);

let catalog = null;
// map → Map(layerId → L.TileLayer)
const layersByMap = new WeakMap();
const opacityById = new Map();

function ensurePane(m) {
  if (!m) return;
  const pane = m.getPane(PANE) || m.createPane(PANE);
  pane.style.zIndex = String(PANE_Z);
  pane.style.pointerEvents = 'none';
}

function hosts() {
  return [map, planMap].filter(Boolean);
}

function bag(m) {
  let b = layersByMap.get(m);
  if (!b) {
    b = new Map();
    layersByMap.set(m, b);
  }
  return b;
}

function tileUrl(entry) {
  const path = String(entry.path || '').replace(/\$\{z\}/g, '{z}').replace(/\$\{x\}/g, '{x}').replace(/\$\{y\}/g, '{y}');
  return `${HOST}${path}`;
}

function chkId(id) {
  return `chk_qhcRaster_${id}`;
}

function opId(id) {
  return `qhcRasterOp_${id}`;
}

function opBoxId(id) {
  return `qhcRasterOpBox_${id}`;
}

function opacityOf(id) {
  if (opacityById.has(id)) return opacityById.get(id);
  const el = $(opId(id));
  const n = el ? Number(el.value) : DEFAULT_OPACITY;
  const o = Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : DEFAULT_OPACITY / 100;
  opacityById.set(id, o);
  return o;
}

function layerList() {
  return (catalog && catalog.layers) || [];
}

function wantedIds() {
  const level = getLevel();
  return layerList()
    .filter((row) => row.level === level && $(chkId(row.id))?.checked)
    .map((row) => row.id);
}

function entryOf(id) {
  return layerList().find((row) => row.id === id) || null;
}

function clearOne(m, id) {
  const b = bag(m);
  const prev = b.get(id);
  if (!prev) return;
  try { m.removeLayer(prev); } catch (e) { /* */ }
  b.delete(id);
}

function paintOne(m, id) {
  if (!m) return;
  clearOne(m, id);
  const entry = entryOf(id);
  if (!entry) return;
  ensurePane(m);
  const layer = L.tileLayer(tileUrl(entry), {
    pane: PANE,
    minZoom: entry.zMin || 9,
    maxZoom: Math.max(entry.zMax || 18, 19),
    maxNativeZoom: entry.zMax || 18,
    opacity: opacityOf(id),
    attribution: 'gisHue mapid 21817'
  });
  layer.addTo(m);
  bag(m).set(id, layer);
}

function paintAll() {
  const want = new Set(wantedIds());
  hosts().forEach((m) => {
    const b = bag(m);
    [...b.keys()].forEach((id) => {
      if (!want.has(id)) clearOne(m, id);
    });
    want.forEach((id) => {
      if (!b.has(id)) paintOne(m, id);
      else {
        const layer = b.get(id);
        if (layer) layer.setOpacity(opacityOf(id));
      }
    });
  });
  syncOpBoxes();
}

function applyOpacity(id) {
  const o = opacityOf(id);
  hosts().forEach((m) => {
    const layer = bag(m).get(id);
    if (layer) layer.setOpacity(o);
  });
}

function syncOpBoxes() {
  layerList().forEach((row) => {
    const box = $(opBoxId(row.id));
    if (box) box.style.display = $(chkId(row.id))?.checked ? '' : 'none';
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowHtml(row) {
  const label = `${row.short || row.name} (raster)`;
  const tip = `${row.name}. Tile XYZ gisHue (mapid 21817), trên vệ tinh, dưới lớp vector QHC.`;
  const op = Math.round(opacityOf(row.id) * 100);
  // Không gắn data-qhc-child: ô đầu dòng QHC không được bật hết raster.
  return `<div class="project-layer" data-qhc-raster="${escapeHtml(row.level === 'qhc25' ? '25' : '10')}">
    <label class="project-layer-name" title="${escapeHtml(tip)}">
      <input type="checkbox" id="${escapeHtml(chkId(row.id))}" data-qhc-raster-id="${escapeHtml(row.id)}">
      <i class="project-layer-dot" style="--dot:#f59e0b"></i>
      <span>${escapeHtml(label)}</span>
    </label>
    <span id="${escapeHtml(opBoxId(row.id))}" class="layer-slider" style="display:none;">
      <input type="range" id="${escapeHtml(opId(row.id))}" class="opacity-slider" min="0" max="100" value="${op}" title="Độ trong suốt ${escapeHtml(label)}" aria-label="Độ trong suốt ${escapeHtml(label)}">
    </span>
  </div>`;
}

function paintSlots() {
  Object.entries(SLOT).forEach(([level, phases]) => {
    Object.entries(phases).forEach(([phase, slotId]) => {
      const slot = $(slotId);
      if (!slot) return;
      const rows = layerList().filter((row) => row.level === level && row.phase === phase);
      slot.innerHTML = rows.map(rowHtml).join('');
      slot.hidden = !rows.length;
    });
  });
  layerList().forEach((row) => {
    $(chkId(row.id))?.addEventListener('change', () => {
      paintAll();
    });
    $(opId(row.id))?.addEventListener('input', (e) => {
      const n = Number(e.target.value);
      opacityById.set(row.id, Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : DEFAULT_OPACITY / 100);
      applyOpacity(row.id);
      syncOpBoxes();
    });
  });
  syncOpBoxes();
}

async function loadCatalog() {
  if (catalog) return catalog;
  try {
    const res = await fetch(CAT, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = await res.json();
  } catch (err) {
    console.warn('Không tải catalog raster QHC:', err.message);
    catalog = { layers: [] };
  }
  return catalog;
}

export function initQhcRasterLayer() {
  loadCatalog().then(() => {
    paintSlots();
    paintAll();
  });
  document.addEventListener(LEVEL_EVENT, () => paintAll());
}
