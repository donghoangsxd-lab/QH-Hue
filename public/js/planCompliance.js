// Gắn kết luận tuân thủ vào bảng thông tin quy hoạch (QHCT và QHPK).
// QHCT đối chiếu lô QHPK cha; QHPK đối chiếu ô QHC 1/10.000. Thiếu dữ liệu thì chưa đủ dữ liệu.
import { state } from './state.js';
import { planLotsIn } from './projectFiles.js';
import { landOf, QHC2045 } from './qhc2045.js';
import { schemeRecords, setSchemeCatalog, SCHEME_ALIAS } from './facetStore.js';
import { landPatternKey } from './tt16Symbols.js';
import { escapeHtml } from './utils.js';
import { SHELL_V, withAssetVersion } from './gbaVersion.js';
import {
  assessCompliance, classify, compilePrinciples, turfOps, bboxOf, bboxHits, CONCLUSION, parentLinkMap
} from './planComplianceCore.js';

export const PRINCIPLES_URL = 'data/tuan-thu-lo/principles.json';
const CAPACITY_URL = 'data/htkt/cong-suat.json';

const SEA_CODE = 31;
const TRUNG_TAM = ['qhc-trung-tam', ...Object.keys(SCHEME_ALIAS).filter(slug => SCHEME_ALIAS[slug] === 'qhc-trung-tam')];

let principlesPromise = null;
let schemesPromise = null;
let linksPromise = null;
let qhcCache = null;

function loadPrinciples() {
  if (!principlesPromise) {
    const url = new URL(PRINCIPLES_URL, document.baseURI);
    url.searchParams.set('v', SHELL_V);
    principlesPromise = fetch(url.href)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(compilePrinciples);
    principlesPromise.catch(() => { principlesPromise = null; });
  }
  return principlesPromise;
}

function loadCapacityLinks() {
  if (!linksPromise) {
    linksPromise = fetch(withAssetVersion(CAPACITY_URL))
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(doc => parentLinkMap(doc && doc.links))
      .catch(err => {
        linksPromise = null;
        console.warn('Chưa đọc liên kết đồ án cha:', err);
        return new Map();
      });
  }
  return linksPromise;
}

function declaredParents(scheme, slugs, linkMap) {
  const parentSlugs = scheme && scheme.parent ? [String(scheme.parent)] : [];
  const linkSlugs = [];
  (slugs || []).forEach(slug => {
    const parent = linkMap && linkMap.get(String(slug));
    if (parent && !linkSlugs.includes(parent)) linkSlugs.push(parent);
  });
  return { parentSlugs, linkSlugs };
}

function ensureSchemes() {
  if (schemeRecords().length) return Promise.resolve(schemeRecords());
  if (!schemesPromise) {
    const url = new URL('data/chuyen-nganh/schemes.json', document.baseURI);
    schemesPromise = fetch(url.href)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(doc => {
        if (!schemeRecords().length) setSchemeCatalog(doc);
        return schemeRecords();
      });
    schemesPromise.catch(() => { schemesPromise = null; });
  }
  return schemesPromise;
}

const isLandLot = (lot) => lot && lot.geometry && (!lot.kind || lot.kind === 'DXF');

function readCode(lot) {
  const n = Number(lot && (lot.code != null ? lot.code : lot.c));
  return Number.isInteger(n) ? n : null;
}

function schemeFor(file, schemes, catalog) {
  const entry = (catalog || []).find(row => row && row.tenQH === file);
  const slug = entry && entry.slug ? String(entry.slug) : '';
  return (schemes || []).find(row => row && (row.name === file || row.slug === slug || row.catalogScheme === slug)) || null;
}

function slugsFor(file, scheme, catalog) {
  const entry = (catalog || []).find(row => row && row.tenQH === file);
  return [...new Set([entry && entry.slug, scheme && scheme.slug, scheme && scheme.catalogScheme].filter(Boolean).map(String))];
}

function isQhc10(scheme, name) {
  if (scheme && (Number(scheme.scale) === 10000 || scheme.catalogScheme === 'qhc-trung-tam' || scheme.slug === 'qhc-trung-tam')) return true;
  const text = `${(scheme && scheme.name) || ''} ${name || ''}`;
  return /1\s*\/\s*10(?:\s*\.\s*000|\s*000)/.test(text) && !/1\s*\/\s*25/.test(text);
}

async function landLots(level, box) {
  const { projects, wardLots } = await planLotsIn(box, { level, includeHidden: true });
  const lots = [];
  (projects || []).forEach(proj => {
    (proj.lots || []).forEach(lot => {
      if (isLandLot(lot)) lots.push({ ...lot, file: lot.file || proj.tenQH });
    });
  });
  if (level === 'QHPK') {
    (wardLots || []).forEach(lot => { if (isLandLot(lot)) lots.push(lot); });
  }
  return lots;
}

function fromProjectLot(lot, levelId, principles, schemes, catalog, linkMap) {
  const file = lot.file || '';
  const scheme = schemeFor(file, schemes, catalog);
  if (levelId === 'QHC10' && !isQhc10(scheme, file)) return null;
  const texts = [lot.nhom, lot.chucNang, lot.layer, lot.name, lot.kyHieu].filter(Boolean).map(String);
  const patternKey = landPatternKey(String(lot.layer || lot.nhom || ''), texts.join(' '));
  const found = classify(principles, { code: readCode(lot), patternKey, texts });
  const schemeSlugs = slugsFor(file, scheme, catalog);
  return {
    level: levelId,
    geometry: lot.geometry,
    schemeSlugs,
    schemeName: (scheme && scheme.name) || file,
    ...declaredParents(scheme, schemeSlugs, linkMap),
    ...found,
    display: lot.nhom || lot.chucNang || lot.layer || found.label || 'chưa rõ chức năng'
  };
}

function fromQhcFeature(fc, principles, box) {
  if (!qhcCache || qhcCache.fc !== fc) {
    qhcCache = {
      fc,
      rows: (fc.features || []).map((feature, index) => ({ feature, index, box: bboxOf(feature && feature.geometry) }))
    };
  }
  const zones = fc.zones;
  const out = [];
  qhcCache.rows.forEach(({ feature, index, box: featureBox }) => {
    const props = feature && feature.properties;
    if (!feature || !feature.geometry || !props || props.c === SEA_CODE || !bboxHits(featureBox, box)) return;
    const zone = Array.isArray(zones) ? zones[props.z] : null;
    const land = landOf(zone, props.c);
    const found = classify(principles, { code: props.c, patternKey: land.key || '', texts: [land.label] });
    out.push({
      level: 'QHC10',
      geometry: feature.geometry,
      schemeSlugs: TRUNG_TAM,
      schemeName: QHC2045.short,
      index,
      ...found,
      display: land.label
    });
  });
  return out;
}

function childOf(part, principles, schemes, catalog, linkMap) {
  const lot = part.lot || {};
  const file = lot.file || '';
  const texts = [part.label, part.name, part.sub, lot.nhom, lot.chucNang, lot.layer, lot.name, lot.kyHieu].filter(Boolean).map(String);
  const patternKey = part.key || landPatternKey(String(lot.layer || part.label || ''), texts.join(' '));
  const found = classify(principles, { code: readCode(lot), patternKey, texts });
  const scheme = schemeFor(file, schemes, catalog);
  return {
    geom: part.geom || part.sourceGeom || lot.geometry || null,
    anchorSlugs: [],
    ...declaredParents(scheme, slugsFor(file, scheme, catalog), linkMap),
    ...found,
    display: part.label || part.name || found.label || 'chưa rõ chức năng'
  };
}

async function assessLevel(level, queryGeom, parts) {
  if (!globalThis.turf) throw new Error('Chưa có thư viện hình học');
  const box = bboxOf(queryGeom);
  if (!box) throw new Error('không có khung hình');
  const [principles, schemes, linkMap] = await Promise.all([loadPrinciples(), ensureSchemes(), loadCapacityLinks()]);
  const catalog = state.projectCatalog || [];
  const ops = turfOps(globalThis.turf);
  const wantQhc = level === 'QHPK' || level === 'QHCT';
  const [parentLots, qhcLots, land] = await Promise.all([
    landLots(level === 'QHCT' ? 'QHPK' : 'QHC', box),
    level === 'QHCT' ? landLots('QHC', box) : Promise.resolve([]),
    wantQhc ? import('./qhc2045Layer.js').then(mod => mod.loadQhcLand()).catch(err => {
      console.warn('Chưa tải lớp QHC 1/10.000 để đối chiếu:', err);
      return null;
    }) : Promise.resolve(null)
  ]);
  const projectQhc = (level === 'QHCT' ? qhcLots : parentLots)
    .map(lot => fromProjectLot(lot, 'QHC10', principles, schemes, catalog, linkMap))
    .filter(Boolean);
  const staticQhc = land ? fromQhcFeature(land, principles, box) : [];
  const anchors = [...staticQhc, ...projectQhc];
  const parents = level === 'QHCT'
    ? parentLots.map(lot => fromProjectLot(lot, 'QHPK', principles, schemes, catalog, linkMap)).filter(Boolean)
    : anchors;
  return assessCompliance({
    principles,
    childLevel: level,
    parts: parts.map(part => childOf(part, principles, schemes, catalog, linkMap)),
    parents,
    anchors,
    queryGeom,
    ops
  });
}

function complianceHtml(row) {
  const status = row && CONCLUSION[row.status] ? row.status : 'chua-du-du-lieu';
  const cls = status === 'phu-hop' ? 'pls-comp-ok' : status === 'chua-phu-hop' ? 'pls-comp-bad' : 'pls-comp-gap';
  const line = (label, value, klass) => `<div class="pp-row"><span>${label}</span><b${klass ? ` class="${klass}"` : ''}>${escapeHtml(value)}</b></div>`;
  return `<div class="pls-comp">${line('Chức năng cấp trên', (row && row.parentText) || 'Chưa xác định')}${line('Chỉ tiêu so sánh', (row && row.compareText) || 'Chưa đủ dữ liệu')}${line('Kết luận', CONCLUSION[status], cls)}</div>`;
}

const gapRow = () => ({
  status: 'chua-du-du-lieu',
  parentText: 'Chưa xác định',
  compareText: 'Chưa đối chiếu được với cấp trên.',
  failed: []
});

/** Ghi complianceHtml lên từng lô của bảng QHCT hoặc QHPK. Lỗi đối chiếu không xóa các dòng lô sẵn có. */
export async function annotateCompliance(level, queryGeom, parts) {
  if (!parts || !parts.length || (level !== 'QHCT' && level !== 'QHPK')) return;
  let rows;
  try {
    rows = await assessLevel(level, queryGeom, parts);
  } catch (err) {
    console.warn('Đối chiếu tuân thủ cấp trên:', err);
    rows = parts.map(gapRow);
  }
  parts.forEach((part, index) => { part.complianceHtml = complianceHtml(rows[index] || gapRow()); });
}
