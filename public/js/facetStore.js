// Bốn trục: Hành chính (phạm vi) · Quy hoạch · Hạ tầng · Kiến trúc.
// Mỗi lớp: { area, level|null, scheme|null, sector|null, kind: hien-trang|quy-hoach }.
// Hiện trạng thực tế: level = null (kho chung, lọc theo phạm vi và trục).
// status trên catalog đồ án là «Hiện trạng khi lập đồ án», không phải kho này.
// Khu vực: Thành phố > (Đô thị | Xã/phường) > Tổ dân phố. TDP chỉ thêm bản ghi areas[], không sửa code.
// Ranh có sẵn: public/data/ward-boundary.json, urban614.geojson, urbanVision.geojson, generalPlan.geojson.
import { bareName, URBANS_614 } from './urbanStatus.js';
import { URBANS_VISION } from './urbanVision.js';
import { CORE_AREAS, GENERAL_PLANS, planLevelOf, planProjectOf } from './generalPlan.js';
import { namesOfProject } from './projectNames.js';

export const AXES = [
  { id: 'hanhchinh', label: 'Hành chính' },
  { id: 'quyhoach', label: 'Quy hoạch' },
  { id: 'hatang', label: 'Hạ tầng' },
  { id: 'kientruc', label: 'Kiến trúc' }
];
const AXIS_IDS = new Set(AXES.map(a => a.id));

export const SECTORS = [
  { id: 'giao-thong', label: 'Giao thông', alias: 'giaothong' },
  { id: 'cap-nuoc', label: 'Cấp nước', alias: 'capnuoc' },
  { id: 'cap-dien', label: 'Cấp điện', alias: 'capdien' },
  { id: 'san-nen-thoat-mua', label: 'San nền và thoát nước mưa', alias: 'sannen' },
  { id: 'thoat-nuoc-thai', label: 'Thoát nước thải', alias: 'thoatnuocthai' },
  { id: 'chat-thai-ran-nghia-trang', label: 'Chất thải rắn và nghĩa trang', alias: 'ctr-nghiatrang' },
  { id: 'thong-tin-lien-lac', label: 'Thông tin liên lạc', alias: 'ttll' }
];

const SECTOR_ALIAS = { sdd: 'sdd' };
SECTORS.forEach(s => {
  SECTOR_ALIAS[s.id] = s.id;
  SECTOR_ALIAS[s.alias] = s.id;
});

export function canonicalSector(raw) {
  if (raw == null || raw === '') return null;
  const id = SECTOR_ALIAS[String(raw).trim()];
  return id === undefined ? undefined : id;
}

export const FACET_LEVELS = [
  { id: 'QHC25', label: 'QHC 1/25.000', scale: '25000' },
  { id: 'QHC10', label: 'QHC 1/10.000', scale: '10000' },
  { id: 'QHPK', label: 'QHPK', scale: '2000' },
  { id: 'QHCT', label: 'QHCT', scale: '500' }
];
const LEVEL_IDS = new Set(FACET_LEVELS.map(l => l.id));
const SCALE_LEVEL = Object.fromEntries(FACET_LEVELS.map(l => [l.scale, l.id]));
const KIND_ALIAS = { HT: 'hien-trang', QH: 'quy-hoach', 'hien-trang': 'hien-trang', 'quy-hoach': 'quy-hoach' };

export const AREA_TP = { type: 'tp', code: 'TP', parent: null };
const AREA_TRUNG_TAM = { type: 'dothi', code: 'trung-tam', parent: 'TP' };

export const WARD_NAMES = [
  'Phường An Cựu', 'Phường Dương Nỗ', 'Phường Hóa Châu', 'Phường Hương An', 'Phường Hương Thủy',
  'Phường Hương Trà', 'Phường Kim Long', 'Phường Kim Trà', 'Phường Mỹ Thượng', 'Phường Phong Dinh',
  'Phường Phong Phú', 'Phường Phong Quảng', 'Phường Phong Thái', 'Phường Phong Điền', 'Phường Phú Bài',
  'Phường Phú Xuân', 'Phường Thanh Thủy', 'Phường Thuận An', 'Phường Thuận Hóa', 'Phường Thủy Xuân',
  'Phường Vỹ Dạ', 'Xã A Lưới 1', 'Xã A Lưới 2', 'Xã A Lưới 3', 'Xã A Lưới 4', 'Xã A Lưới 5',
  'Xã Bình Điền', 'Xã Chân Mây - Lăng Cô', 'Xã Đan Điền', 'Xã Hưng Lộc', 'Xã Khe Tre',
  'Xã Long Quảng', 'Xã Lộc An', 'Xã Nam Đông', 'Xã Phú Hồ', 'Xã Phú Lộc', 'Xã Phú Vang',
  'Xã Phú Vinh', 'Xã Quảng Điền', 'Xã Vinh Lộc'
];

export function areaCodeFromName(name) {
  return bareName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const areas = [];
const byKey = new Map();

function putArea(row) {
  const key = `${row.type}:${row.code}`;
  const prev = byKey.get(key);
  if (prev) {
    if (row.name && row.name !== row.code) prev.name = row.name;
    if (row.parent) prev.parent = row.parent;
    return prev;
  }
  const item = { type: row.type, code: row.code, parent: row.parent ?? null, name: row.name || row.code };
  areas.push(item);
  byKey.set(key, item);
  return item;
}

function buildBaseAreas() {
  putArea({ ...AREA_TP, name: 'Toàn thành phố' });
  WARD_NAMES.forEach(name => putArea({ type: 'xa', code: areaCodeFromName(name), parent: 'TP', name }));
  const addTown = (id, name) => {
    if (!id || id === 'hue') return;
    putArea({ type: 'dothi', code: String(id), parent: 'TP', name: name || String(id) });
  };
  URBANS_VISION.forEach(u => { if (!u.city) addTown(u.id, u.name); });
  URBANS_614.forEach(u => { if (!u.city) addTown(u.id, u.name); });
  CORE_AREAS.forEach(a => addTown(a.id, a.name));
  GENERAL_PLANS.forEach(p => { if (!p.city) addTown(p.id, p.name); });
  const city = GENERAL_PLANS.find(p => p.city);
  (city?.zones || []).forEach(z => addTown(z.id, z.name));
}
buildBaseAreas();

export function listAreas(type) {
  return areas.filter(a => !type || a.type === type).map(a => ({ ...a }));
}

export function findArea(type, code) {
  const hit = byKey.get(`${type}:${code}`);
  return hit ? { ...hit } : null;
}

export function registerAreas(list) {
  (list || []).forEach(raw => {
    const area = normalizeArea(raw);
    if (!area) return;
    putArea({ ...area, name: raw && raw.name ? String(raw.name) : area.code });
  });
}

export function normalizeArea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (type === 'tp') return { ...AREA_TP };
  if (type !== 'dothi' && type !== 'xa' && type !== 'tdp') return null;
  const code = String(raw.code || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(code)) return null;
  let parent = raw.parent == null || raw.parent === '' ? null : String(raw.parent);
  if ((type === 'dothi' || type === 'xa') && !parent) parent = 'TP';
  return { type, code, parent };
}

export function formatKv(area) {
  if (!area) return '';
  if (area.type === 'tp') return 'TP';
  return `${area.type}:${area.code}`;
}

export function parseKv(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^(tp|TP)$/.test(s) || /^tp:TP$/i.test(s)) return { ...AREA_TP };
  const m = /^(dothi|xa|tdp):([A-Za-z0-9][A-Za-z0-9_-]{0,80})$/.exec(s);
  if (!m) return null;
  const known = findArea(m[1], m[2]);
  if (known) return { type: known.type, code: known.code, parent: known.parent };
  const parent = m[1] === 'tdp' ? null : 'TP';
  return { type: m[1], code: m[2], parent };
}

export function areaLabel(area) {
  if (!area) return '';
  if (area.type === 'tp') return 'Toàn thành phố';
  return findArea(area.type, area.code)?.name || area.code;
}

function normalizeLevel(raw, scale) {
  const id = String(raw || '').trim();
  if (LEVEL_IDS.has(id)) return id;
  // Catalog ghi cấp đồ án «QHC». Tab 1/25.000 và 1/10.000 tách theo scale; QHC không ghi scale (thị trấn, KCN, 1/2.000) nằm cùng tab QHC10 vì schemesAt xếp mọi đồ án QHC vào đó.
  if (id === 'QHC') {
    const s = String(scale ?? '');
    if (s === '25000') return 'QHC25';
    if (s === '10000') return 'QHC10';
    return 'QHC10';
  }
  return SCALE_LEVEL[String(scale ?? '').trim()] || null;
}

function schemeForScale(scale) {
  const s = String(scale ?? '');
  if (s === '25000') return 'qhc-hue-2045';
  if (s === '10000') return 'qhc-trung-tam';
  return '';
}

// Mục sheetOnly mapid 21817. Lớp sử dụng đất nằm ở đồ án tĩnh. Khớp aliases trong su-dung-dat-index.json.
export const SCHEME_ALIAS = {
  'qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1': 'qhc-hue-2045',
  'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72': 'qhc-trung-tam'
};

function areaForScale(scale) {
  return String(scale ?? '') === '10000' ? { ...AREA_TRUNG_TAM } : { ...AREA_TP };
}

let seq = 0;
const schemeBySlug = new Map();

export function setSchemeCatalog(doc) {
  schemeBySlug.clear();
  const list = doc && Array.isArray(doc.schemes) ? doc.schemes : [];
  list.forEach(row => {
    if (!row || !row.slug) return;
    schemeBySlug.set(String(row.slug), row);
    if (row.catalogScheme) schemeBySlug.set(String(row.catalogScheme), row);
  });
}

function schemeMeta(slug) {
  return slug ? schemeBySlug.get(String(slug)) : null;
}

export function normalizeLayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sector = canonicalSector(raw.sector ?? '');
  const isBase = raw.base === true;
  if (sector === undefined) return null;
  if (!sector && !isBase) return null;
  const kind = KIND_ALIAS[String(raw.kind || raw.status || '').trim()] || (isBase ? 'hien-trang' : null);
  if (!kind) return null;
  let level = null;
  let scheme = null;
  if (!isBase) {
    level = normalizeLevel(raw.level, raw.scale);
    if (!level) return null;
    scheme = raw.scheme == null || raw.scheme === '' ? schemeForScale(raw.scale) : String(raw.scheme);
  }
  const meta = schemeMeta(scheme);
  if (meta && meta.catalogScheme) scheme = String(meta.catalogScheme);
  const area = normalizeArea(raw.area) || normalizeArea(meta && meta.area) || (isBase ? { ...AREA_TP } : areaForScale(raw.scale));
  const file = String(raw.file || '').trim();
  const name = String(raw.name || file || sector || 'Lớp');
  const bind = typeof raw.bind === 'string' && /^chk_[\w-]+$/.test(raw.bind) ? raw.bind : '';
  const hint = String(raw.hint || '').trim();
  const id = String(raw.id || bind || file || `${sector}|${level}|${kind}|${scheme}|${seq++}`);
  const featureCount = Number.isFinite(Number(raw.featureCount)) ? Number(raw.featureCount) : null;
  const fields = Array.isArray(raw.fields) ? raw.fields.map(f => String(f)) : [];
  const bbox = Array.isArray(raw.bbox) && raw.bbox.length === 4 && raw.bbox.every(n => Number.isFinite(Number(n)))
    ? raw.bbox.map(Number) : null;
  const axes = Array.isArray(raw.axes) ? raw.axes.filter(a => AXIS_IDS.has(a)) : null;
  return {
    id, sector, level, scheme, kind, area, name, bind, file, hint, base: isBase,
    axes: axes && axes.length ? axes : null,
    geomType: String(raw.geomType || ''),
    featureCount, fields, bbox
  };
}

const SDD = [
  {
    id: 'sdd25', sector: 'sdd', level: 'QHC25', kind: 'quy-hoach', area: { ...AREA_TP },
    name: 'Sơ đồ phát triển không gian TP', geomType: 'Polygon',
    file: 'data/qhc2045/dinhhuong.json', scheme: 'qhc-hue-2045', bind: 'chk_qhc25', axes: ['quyhoach']
  },
  {
    id: 'sdd10', sector: 'sdd', level: 'QHC10', kind: 'quy-hoach', area: { ...AREA_TRUNG_TAM },
    name: 'QH sử dụng đất (trung tâm)', geomType: 'Polygon',
    file: 'data/qhc2045/sdd.json', scheme: 'qhc-trung-tam', bind: 'chk_qhc10', axes: ['quyhoach']
  }
];

const BASE = [
  { id: 'base-roads', base: true, sector: 'giao-thong', kind: 'hien-trang', name: 'Mạng lưới đường', bind: 'chk_roads', axes: ['hatang'], area: { ...AREA_TP } },
  { id: 'base-rail', base: true, sector: 'giao-thong', kind: 'hien-trang', name: 'Đường sắt hiện trạng', bind: 'chk_osmRail', axes: ['hatang'], area: { ...AREA_TP } },
  { id: 'base-water', base: true, sector: 'giao-thong', kind: 'hien-trang', name: 'Đường thủy nội địa', bind: 'chk_osmWater', axes: ['hatang'], area: { ...AREA_TP } },
  { id: 'base-cadastre', base: true, sector: '', kind: 'hien-trang', name: 'Thửa đất địa chính 2016', bind: 'chk_cadastre', axes: ['quyhoach'], area: { ...AREA_TP } },
  { id: 'base-gba', base: true, sector: '', kind: 'hien-trang', name: 'Công trình xây dựng (GBA)', bind: 'chk_gba', axes: ['kientruc'], area: { ...AREA_TP } },
  { id: 'base-violate', base: true, sector: '', kind: 'hien-trang', name: 'Công trình vi phạm', bind: 'chk_violate', axes: ['quyhoach', 'kientruc'], area: { ...AREA_TP } },
  {
    id: 'ht-tam-giao-thong', base: true, sector: 'giao-thong', kind: 'hien-trang',
    name: 'Hiện trạng (tạm thời, tổng hợp từ các đồ án)',
    hint: 'Tổng hợp tạm thời từ hiện trạng các đồ án. Bấm đối tượng để xem đồ án nguồn.',
    file: 'data/hien-trang-tam/giao-thong.geojson', geomType: 'LineString', axes: ['hatang'], area: { ...AREA_TP }
  },
  {
    id: 'ht-tam-cap-dien', base: true, sector: 'cap-dien', kind: 'hien-trang',
    name: 'Hiện trạng (tạm thời, tổng hợp từ các đồ án)',
    hint: 'Tổng hợp tạm thời từ hiện trạng các đồ án. Bấm đối tượng để xem đồ án nguồn.',
    file: 'data/hien-trang-tam/cap-dien.geojson', geomType: 'LineString', axes: ['hatang'], area: { ...AREA_TP }
  },
  {
    id: 'ht-tam-cap-nuoc', base: true, sector: 'cap-nuoc', kind: 'hien-trang',
    name: 'Hiện trạng (tạm thời, tổng hợp từ các đồ án)',
    hint: 'Tổng hợp tạm thời từ hiện trạng các đồ án. Bấm đối tượng để xem đồ án nguồn.',
    file: 'data/hien-trang-tam/cap-nuoc.geojson', geomType: 'LineString', axes: ['hatang'], area: { ...AREA_TP }
  }
];

// Chỉ khi manifest 404. Không gộp vào catalog 91 lớp (chk_gt25/chk_gt10 là bộ khác).
const GT_FALLBACK = [
  {
    id: 'gt25', sector: 'giao-thong', level: 'QHC25', kind: 'quy-hoach', area: { ...AREA_TP },
    name: 'QH giao thông (toàn TP)', geomType: 'LineString',
    file: 'data/qhc2045/giaothong25.json', scheme: 'qhc-hue-2045', bind: 'chk_gt25'
  },
  {
    id: 'gt10', sector: 'giao-thong', level: 'QHC10', kind: 'quy-hoach', area: { ...AREA_TRUNG_TAM },
    name: 'QH giao thông (trung tâm)', geomType: 'LineString',
    file: 'data/qhc2045/giaothong10.json', scheme: 'qhc-trung-tam', bind: 'chk_gt10'
  }
];

let layers = [];
const visible = new Set();
let areaFilter = null;
let areaSource = null;
let axis = 'quyhoach';
let sectorId = 'giao-thong';
let facetLevel = 'QHC25';
let catalogFrom = 'empty';
const listeners = new Set();

function emit(kind) {
  listeners.forEach(fn => { try { fn(kind); } catch (err) { console.warn('facet', err); } });
}

export function onFacet(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function catalogSource() { return catalogFrom; }
export function getLayers() { return layers.map(l => ({ ...l, area: { ...l.area } })); }
export function getAreaFilter() { return areaFilter ? { ...areaFilter } : null; }
export function isLayerOn(id) { return visible.has(id); }
export function browseState() {
  return { axis, sector: sectorId, level: facetLevel };
}

export function setLayerFlag(id, on) {
  if (on) visible.add(id); else visible.delete(id);
}

// Phạm vi TP hoặc chưa chọn: mọi lớp. Phạm vi hẹp hơn: đúng nút đó, cộng lớp gắn TP.
export function layerPassesFilter(layer) {
  if (!areaFilter || areaFilter.type === 'tp') return true;
  const area = layer && layer.area;
  if (!area || area.type === 'tp') return true;
  return area.type === areaFilter.type && area.code === areaFilter.code;
}

export function setAreaFilter(area, source = 'user', { url = true } = {}) {
  areaFilter = area ? (normalizeArea(area) || null) : null;
  if (areaFilter) putArea(areaFilter);
  areaSource = areaFilter ? source : null;
  emit('area');
  if (url) syncFacetUrl();
}

export function noteUrbanFocus(key, city = false) {
  if (!key) {
    if (areaSource === 'urban') setAreaFilter({ ...AREA_TP }, 'urban');
    return;
  }
  const id = String(key).replace(/^(u:|gp:)/, '');
  if (!id) return;
  if (city || id === 'hue') setAreaFilter({ ...AREA_TP }, 'urban');
  else setAreaFilter({ type: 'dothi', code: id, parent: 'TP' }, 'urban');
}

export function setBrowseState(next = {}, { url = true } = {}) {
  if (next.axis && AXIS_IDS.has(next.axis)) axis = next.axis;
  const sector = canonicalSector(next.sector || '');
  if (sector && sector !== 'sdd') sectorId = sector;
  if (next.level && LEVEL_IDS.has(next.level)) facetLevel = next.level;
  if (url) syncFacetUrl();
}

export function facetQuery() {
  const q = {};
  if (areaFilter && areaFilter.type !== 'tp') q.kv = formatKv(areaFilter);
  if (axis && axis !== 'quyhoach') q.truc = axis;
  if (axis === 'hatang' && sectorId) q.nganh = sectorId;
  return q;
}

export function applyFacetSearch(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const droppedTt = q.has('tt');
  const kv = parseKv(q.get('kv'));
  if (kv) {
    areaFilter = kv;
    areaSource = 'url';
    putArea(kv);
  }
  const truc = q.get('truc');
  if (AXIS_IDS.has(truc)) axis = truc;
  const nganh = canonicalSector(q.get('nganh') || '');
  if (nganh && nganh !== 'sdd') {
    sectorId = nganh;
    if (!q.get('truc')) axis = 'hatang';
  }
  return {
    nganh: nganh && nganh !== 'sdd' ? nganh : null,
    axis: q.has('truc') || (nganh && nganh !== 'sdd') ? axis : null,
    droppedTt
  };
}

export function readFacetUrl() {
  if (typeof location === 'undefined') return { nganh: null, axis: null, droppedTt: false };
  const applied = applyFacetSearch(location.search);
  if (applied.droppedTt) syncFacetUrl();
  return applied;
}

export function syncFacetUrl() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const url = new URL(location.href);
  const next = facetQuery();
  ['kv', 'tt', 'nganh', 'truc'].forEach(k => {
    if (next[k]) url.searchParams.set(k, next[k]);
    else url.searchParams.delete(k);
  });
  const built = `${url.pathname}${url.search}${url.hash}`;
  const now = `${location.pathname}${location.search}${location.hash}`;
  if (built !== now) history.replaceState(null, '', built);
}

function mergeAlways(list, source) {
  const extras = [...SDD, ...BASE, ...(source === 'fallback' ? GT_FALLBACK : [])];
  const haveFile = new Set(list.map(l => l.file).filter(Boolean));
  const haveBind = new Set(list.map(l => l.bind).filter(Boolean));
  const haveId = new Set(list.map(l => l.id));
  const add = extras.map(normalizeLayer).filter(Boolean).filter(b => !haveId.has(b.id)
    && !(b.file && haveFile.has(b.file)) && !(b.bind && haveBind.has(b.bind)));
  return [...list, ...add];
}

export function replaceLayers(list, source) {
  layers = mergeAlways(list.map(normalizeLayer).filter(Boolean), source);
  const ids = new Set(layers.map(l => l.id));
  [...visible].forEach(id => { if (!ids.has(id)) visible.delete(id); });
  catalogFrom = source || catalogFrom;
  emit('catalog');
}

function catalogUrl(file) {
  return typeof document !== 'undefined'
    ? new URL(file, document.baseURI).href
    : file;
}

async function pullJson(doFetch, file) {
  if (!doFetch) return null;
  try {
    const res = await doFetch(catalogUrl(file));
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function loadFacetCatalog(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const [doc, schemesDoc] = await Promise.all([
    pullJson(doFetch, 'data/chuyen-nganh/index.json'),
    pullJson(doFetch, 'data/chuyen-nganh/schemes.json')
  ]);
  setSchemeCatalog(schemesDoc);
  const listed = Array.isArray(doc) ? doc : doc && Array.isArray(doc.layers) ? doc.layers : null;
  const rawLayers = listed ? listed.filter(l => l && !l.ref) : null;
  if (!rawLayers) {
    replaceLayers([], 'fallback');
    return catalogFrom;
  }
  if (doc && Array.isArray(doc.areas)) registerAreas(doc.areas);
  replaceLayers(rawLayers, 'manifest');
  return catalogFrom;
}

function schemeRow(slug, name, level) {
  return { slug, name, level };
}

export function schemesAt(level, catalog = []) {
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    if (!row.slug || seen.has(row.slug)) return;
    seen.add(row.slug);
    rows.push(row);
  };
  if (level === 'QHC25') add(schemeRow('qhc-hue-2045', 'QHC đô thị Huế 2045', level));
  if (level === 'QHC10') {
    add(schemeRow('qhc-trung-tam', 'QHC đô thị TTHuế 2045 (Trung tâm)', level));
    GENERAL_PLANS.forEach(plan => {
      if (plan.city || planProjectOf(plan, catalog)) return;
      const slug = `qhc-${plan.id}`;
      const meta = schemeMeta(slug);
      add(schemeRow(slug, meta && meta.name || plan.name, level));
    });
  }
  (catalog || []).forEach(p => {
    if (!p || SCHEME_ALIAS[p.slug]) return;
    const kind = planLevelOf(p.tenQH);
    const lv = kind === 'QHC' ? 'QHC10' : kind === 'QHPK' ? 'QHPK' : kind === 'QHCT' ? 'QHCT' : '';
    if (lv !== level) return;
    const names = namesOfProject(p);
    add(schemeRow(p.slug || areaCodeFromName(p.tenQH), names.tenRutGon || names.tenQH, level));
  });
  layers.forEach(l => {
    if (l.level !== level || !l.scheme) return;
    const slug = SCHEME_ALIAS[l.scheme] || l.scheme;
    const meta = schemeMeta(slug);
    const project = (catalog || []).find(p => p && p.slug === slug);
    const name = project
      ? (namesOfProject(project).tenRutGon || project.tenQH || slug)
      : (meta && meta.name) || slug;
    add(schemeRow(slug, name, level));
  });
  return rows;
}

const CITY_SCHEMES = new Set(['qhc-hue-2045', 'qhc-trung-tam']);

// Đồ án QHC địa phương (Phú Lộc, Khe Tre, Vinh Hưng, KCN, Chân Mây) hiện ở cả hai tab QHC,
// không chỉ khi đang chọn đúng mức 1/10.000. Phạm vi hành chính vẫn lọc lớp.
export function schemesForSector(sector, level, catalog = []) {
  const rows = schemesAt(level, catalog).map(s => ({ ...s }));
  if (level !== 'QHC25' && level !== 'QHC10') return rows;
  const seen = new Set(rows.map(s => s.slug));
  const extras = [];
  ['QHC25', 'QHC10'].forEach(lv => {
    schemesAt(lv, catalog).forEach(s => {
      if (seen.has(s.slug) || CITY_SCHEMES.has(s.slug)) return;
      if (!layersFor(sector, lv, s.slug, { filter: false }).length) return;
      seen.add(s.slug);
      extras.push({ ...s, level: lv, local: true });
    });
  });
  const keep = (s) => {
    const all = layersFor(sector, s.level, s.slug, { filter: false });
    if (!all.length) return true;
    return layersFor(sector, s.level, s.slug).length > 0;
  };
  return rows.filter(keep).concat(extras.filter(keep));
}

export function layersFor(sector, level, scheme, { filter = true } = {}) {
  const id = canonicalSector(sector || '');
  return layers.filter(l => !l.base && l.sector === id && l.level === level && (l.scheme || '') === (scheme || '')
    && (!filter || layerPassesFilter(l)));
}

export function baseLayers({ axis: axisId, sector, filter = true } = {}) {
  const id = sector ? canonicalSector(sector) : null;
  return layers.filter(l => l.base
    && (!axisId || !l.axes || l.axes.includes(axisId))
    && (id == null || l.sector == null || l.sector === id)
    && (!filter || layerPassesFilter(l)));
}
