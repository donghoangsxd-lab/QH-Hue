// Tab B → QH756: lớp sử dụng đất QH tỉnh (mã RPH/ONT/…), nguồn DXF → public/data/qh756/sdd.json.
import { map } from './mapEngine.js';
import { planMap, getViewMode } from './planMap.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { withAssetVersion } from './assetVersion.js';
import { escapeHtml } from './utils.js';

const DATA_URL = 'data/qh756/sdd.json';
const PANE = 'qh756SddPane';
const $ = (id) => document.getElementById(id);

/** Màu hiển thị theo mã QH tỉnh (không dùng bảng TT16 đô thị). */
export const QH756_COLORS = {
  RPH: '#beff1e',
  RDD: '#6b8e23',
  RSX: '#9acd32',
  ONT: '#f4a460',
  ODT: '#ffa07a',
  CLN: '#90ee90',
  LUA: '#ffe4b5',
  LUC: '#f0e68c',
  NKH: '#daa520',
  NNL: '#bdb76b',
  NTD: '#d3d3d3',
  DGT: '#696969',
  DTL: '#87ceeb',
  DDD: '#cd5c5c',
  SON: '#1e90ff',
  MNC: '#00bfff',
  SKN: '#da70d6',
  SKS: '#ba55d3',
  CQP: '#8b0000',
  CAN: '#a52a2a',
  CKS: '#bc8f8f',
  CNT: '#708090'
};

const FALLBACK = '#94a3b8';

let fc = null;
let loadPromise = null;
let group = null;
let applying = false;

function hosts() {
  return [map, planMap].filter(Boolean);
}

function ensurePane(m) {
  if (!m.getPane(PANE)) {
    m.createPane(PANE);
    m.getPane(PANE).style.zIndex = 390;
  }
}

function colorOf(ma) {
  return QH756_COLORS[String(ma || '').toUpperCase()] || FALLBACK;
}

function styleOf(f) {
  const c = colorOf(f.properties?.ma);
  return {
    color: '#334155',
    weight: 0.4,
    opacity: 0.7,
    fillColor: c,
    fillOpacity: 0.55
  };
}

function tipHtml(f) {
  const p = f.properties || {};
  const ma = escapeHtml(p.ma || '—');
  const ten = escapeHtml(p.ten || '');
  const ha = Number(p.area) > 0 ? `${(Number(p.area) / 10000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ha` : '—';
  return `<b>${ma}</b>${ten ? ` — ${ten}` : ''}<br>Diện tích (CAD): ${ha}`;
}

function clearDrawn() {
  if (!group) return;
  hosts().forEach((m) => {
    if (m.hasLayer(group)) m.removeLayer(group);
  });
  group = null;
}

function paint() {
  clearDrawn();
  if (!fc?.features?.length) return;
  const host = getViewMode() === 'QH' && planMap ? planMap : map;
  if (!host) return;
  ensurePane(host);
  group = L.geoJSON(fc, {
    pane: PANE,
    style: styleOf,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(tipHtml(f), { sticky: true, opacity: 0.95, className: 'ua-tip' });
    }
  });
  group.addTo(host);
}

function load() {
  if (fc) return Promise.resolve(fc);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(withAssetVersion(DATA_URL))
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((doc) => {
      fc = doc;
      return fc;
    })
    .catch((err) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

function wanted() {
  return getLevel() === 'qh756' && !!$('chk_qh756')?.checked;
}

async function sync() {
  if (!wanted()) {
    clearDrawn();
    return;
  }
  try {
    await load();
    paint();
  } catch (err) {
    console.warn('QH756 SDD', err);
    clearDrawn();
  }
}

export function initQh756SddLayer() {
  $('chk_qh756')?.addEventListener('change', () => {
    if (applying) return;
    sync();
  });
  document.addEventListener(LEVEL_EVENT, () => { sync(); });
  if (wanted()) sync();
}
