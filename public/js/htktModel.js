// Một lớp catalog giữ một lần. Panel chỉ lọc theo thẻ, không nhân bản GeoJSON.
// Dung sai bắt dính đầu cuối tuyến cùng nhóm, cùng phase, cùng đồ án (mét, theo cấp).
// QHPK chưa có lớp: hook qhpk-htkt chờ script gắn sau.

export const PIPE_SECTORS = [
  'giao-thong',
  'cap-nuoc',
  'cap-dien',
  'san-nen-thoat-mua',
  'thoat-nuoc-thai',
  'thong-tin-lien-lac'
];

export const HTKT_GROUPS = [
  { id: 'giao-thong', label: 'Giao thông' },
  { id: 'cap-nuoc', label: 'Cấp nước' },
  { id: 'san-nen-thoat-mua', label: 'Thoát nước mưa' },
  { id: 'thoat-nuoc-thai', label: 'Thoát nước thải' },
  { id: 'cap-dien', label: 'Cấp điện' },
  { id: 'thong-tin-lien-lac', label: 'Thông tin liên lạc' },
  { id: 'chat-thai-ran-nghia-trang', label: 'Chất thải rắn, nghĩa trang' },
  { id: 'tong-hop-duong-ong', label: 'Tổng hợp đường ống', pipe: true }
];

export const SNAP_TOLERANCE_M = {
  QHCT: 0.5,
  QHPK: 1,
  QHC10: 10,
  QHC25: 100
};

export const SYNTH_LABEL = 'dữ liệu tự tổng hợp';
export const QHPK_HOOK_ID = 'qhpk-htkt';

const LEVEL_IDS = new Set(['QHC25', 'QHC10', 'QHPK', 'QHCT']);
const SCALE_LEVEL = { 25000: 'QHC25', 10000: 'QHC10', 2000: 'QHPK', 500: 'QHCT' };

const PIPE_EXCLUDE = /bo[-_ ]?via|mat[-_ ]?cat|dong[-_ ]?muc|huong[-_ ]?(thoat|dong|phan)|cao[-_ ]?do|phan[-_ ]?o|mat[-_ ]?duong/;

export function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export function catalogLevel(rawLevel, scale) {
  const id = String(rawLevel || '').trim();
  if (LEVEL_IDS.has(id)) return id;
  if (id === 'QHC') {
    const s = String(scale ?? '');
    if (s === '25000') return 'QHC25';
    if (s === '10000') return 'QHC10';
    return 'QHC10';
  }
  return SCALE_LEVEL[String(scale ?? '').trim()] || null;
}

export function snapToleranceM(level) {
  if (Object.prototype.hasOwnProperty.call(SNAP_TOLERANCE_M, level)) return SNAP_TOLERANCE_M[level];
  return null;
}

export function withinSnap(distanceM, level) {
  const tol = snapToleranceM(level);
  const d = Number(distanceM);
  if (tol == null || !Number.isFinite(d)) return false;
  return d <= tol;
}

export function geomKind(layer) {
  const g = String(layer && layer.geomType || '');
  if (/Point/i.test(g) && !/Line|Polygon/i.test(g)) return 'point';
  if (/Line/i.test(g)) return 'line';
  if (/Polygon/i.test(g)) return 'polygon';
  if (/Mixed/i.test(g)) return 'mixed';
  return '';
}

export function isCotDenLayer(layer) {
  const n = foldName(`${layer && layer.name || ''} ${layer && layer.file || ''}`);
  return /cot[-_ ]?den/.test(n);
}

export function isHydrantLayer(layer) {
  if (!layer || layer.sector !== 'cap-nuoc') return false;
  const n = foldName(`${layer.name || ''} ${layer.file || ''}`);
  return /pccc|cuu hoa|hong cuu/.test(n);
}

export function isPipeLine(layer) {
  if (!layer || layer.base) return false;
  if (!PIPE_SECTORS.includes(layer.sector)) return false;
  if (isCotDenLayer(layer)) return false;
  const kind = geomKind(layer);
  if (kind !== 'line' && kind !== 'mixed') return false;
  const n = foldName(`${layer.name || ''} ${layer.file || ''}`);
  if (PIPE_EXCLUDE.test(n)) return false;
  return true;
}

export function subtypeOf(layer) {
  const file = String(layer && layer.file || '');
  const base = file.split('/').pop().replace(/\.(geo)?json$/i, '');
  if (base) return base;
  return foldName(layer && layer.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function layerTags(layer) {
  const tags = [];
  if (!layer) return tags;
  if (layer.sector) tags.push(`nhom:${layer.sector}`);
  const kind = geomKind(layer);
  if (kind) tags.push(`hinh:${kind}`);
  if (layer.kind) tags.push(`phase:${layer.kind}`);
  if (layer.scheme) tags.push(`doan:${layer.scheme}`);
  if (layer.level) tags.push(`cap:${layer.level}`);
  if (isPipeLine(layer)) tags.push('ong');
  if (isCotDenLayer(layer)) tags.push('an:cot-den');
  if (isHydrantLayer(layer)) tags.push('hong-cuu-hoa');
  if (/^https?:\/\//.test(String(layer.file || ''))) tags.push('gcs');
  return tags;
}

export function formAllows(layer, forms, pipe) {
  if (!layer || isCotDenLayer(layer)) return false;
  if (pipe) return isPipeLine(layer);
  const kind = geomKind(layer);
  if (kind === 'mixed') return !!(forms && (forms.point || forms.line));
  if (kind === 'point') return !!(forms && forms.point);
  if (kind === 'line') return !!(forms && forms.line);
  if (kind === 'polygon') return !!(forms && forms.polygon);
  return !!(forms && forms.line);
}

export function qhpkLayersFromHook(hook) {
  const list = hook && Array.isArray(hook.layers) ? hook.layers : [];
  return list.filter(layer => layer && catalogLevel(layer.level, layer.scale) === 'QHPK' && !isCotDenLayer(layer));
}

export function gcsObjectPath(file) {
  const m = /^https:\/\/storage\.googleapis\.com\/hue-infra-data-us\/(.+)$/.exec(String(file || ''));
  return m ? m[1] : '';
}
