// Nhập lô đất từ GeoJSON (.geojson / .json): Polygon, MultiPolygon và đường khép kín.
// Loại hạ tầng theo thuộc tính Layer, không có thì theo tên; tọa độ độ (WGS84) hoặc mét (VN-2000, xuất từ QGIS giữ nguyên hệ).
import { layerToType, tt16Layer } from './cadImport.js';
import { openRing } from './kmlImport.js';
import { landRule, landPatternKey } from './tt16Symbols.js';

// autocad_la: tên layer CAD gốc trên gServer Huế (DBF cắt tên trường còn 10 ký tự)
export const LAYER_FIELD = /^(layer|layer_?name|ten_?layer|lop|(?:autocad|cad)_?la(?:yer)?)$/i;
// tendoituong (gServer), DBF cắt còn tendoituon
const NAME_FIELD = /^(ten_?cong_?trinh|name|ten|ten_?doi_?tuon?g?)$/i;

function pickProp(props, re) {
  const key = Object.keys(props).find(k => re.test(k));
  const v = key ? props[key] : null;
  return v == null ? '' : String(v).trim();
}

// Tên chức năng sử dụng đất (gServer: chucnangsudungdat, DBF cắt còn chucnangsu; loaidat), ưu tiên theo thứ tự
const CLASS_FIELDS = [/^chuc_?nang/i, /^loai_?dat$/i, /^ten_?loai/i, /^muc_?dich/i];
// Ký hiệu lô (CXCD.A-01, OHT.C-11): chỉ dùng khi nhận ra loại đất
const CODE_FIELDS = [/^ky_?hieu/i, /^ma_?lo$/i, /^kh_?lo$/i, /^ma_?dat$/i];

const knownLand = (s) => !!(tt16Layer(s) || landRule(s) || landPatternKey(s));

function resolveLayer(props, name) {
  const field = pickProp(props, LAYER_FIELD);
  if (field && layerToType(field)) return field;
  const t = name && layerToType(name);
  if (t) return t.prefix;
  // Tên layer CAD (hoặc tên file .shp khi DBF không có trường Layer) không cho biết loại đất: lấy tên chức năng sử dụng đất,
  // ưu tiên giá trị nhận ra nhóm đất, không thì giá trị đầu tiên có chữ (tên loại đất luôn đọc được), cuối cùng là ký hiệu lô
  if (!field || !knownLand(field)) {
    const classes = CLASS_FIELDS.map(re => pickProp(props, re)).filter(v => /\p{L}/u.test(v));
    const cls = classes.find(knownLand) || classes[0];
    if (cls) return cls;
    const code = CODE_FIELDS.map(re => pickProp(props, re)).find(v => v && landPatternKey(v));
    if (code) return code;
  }
  return field || name || '(không tên)';
}

const isPt = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
const toPts = (coords) => (Array.isArray(coords) ? coords.filter(isPt).map(c => [c[0], c[1]]) : []);

// Gom vòng polygon / đường khép kín của 1 geometry (kể cả GeometryCollection)
function collect(g, out) {
  if (!g || typeof g !== 'object') return;
  const c = g.coordinates;
  switch (g.type) {
    case 'Polygon': (c || []).forEach(r => { const ring = openRing(toPts(r)); if (ring) out.poly.push(ring); }); break;
    case 'MultiPolygon': (c || []).forEach(p => collect({ type: 'Polygon', coordinates: p }, out)); break;
    case 'LineString': {
      const pts = toPts(c);
      if (pts.length < 2) { out.other++; break; }
      const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      const ring = closed ? openRing(pts) : null;
      if (ring) out.line.push(ring);
      else out.open.push(pts);
      break;
    }
    case 'MultiLineString': (c || []).forEach(l => collect({ type: 'LineString', coordinates: l }, out)); break;
    case 'GeometryCollection': (g.geometries || []).forEach(sub => collect(sub, out)); break;
    case 'Point': if (isPt(c)) out.points.push([c[0], c[1]]); break;
    case 'MultiPoint': out.points.push(...toPts(c)); break;
    default: out.other++; break;
  }
}

/**
 * Đọc GeoJSON (văn bản) → { entities: [{kind, layer, name, attrs, rings, pt?}], stats, wgs84 }.
 * Bộ lọc mặc định: Polygon, đường khép kín và Point. Đường hở của feature không có vùng giữ lại dạng LINE (ranh giới).
 */
export function parseGeoJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('File JSON lỗi cú pháp.'); }
  const features = data?.type === 'FeatureCollection' ? data.features
    : data?.type === 'Feature' ? [data]
    : data?.type && (data.coordinates || data.geometries) ? [{ type: 'Feature', properties: {}, geometry: data }]
    : null;
  if (!Array.isArray(features)) throw new Error('Không phải GeoJSON (cần FeatureCollection hoặc Feature).');
  return parseFeatures(features);
}

/** Mảng Feature GeoJSON (đã đọc) → kết quả như parseGeoJson; dùng chung cho shapefile */
export function parseFeatures(features) {
  const stats = { feature: features.length, polygon: 0, polyline: 0, line: 0, point: 0, skipped: {} };
  const skip = (label, n = 1) => { if (n) stats.skipped[label] = (stats.skipped[label] || 0) + n; };
  const entities = [];
  for (const f of features) {
    const props = (f && f.properties) || {};
    const name = pickProp(props, NAME_FIELD);
    const layer = resolveLayer(props, name);
    // Thuộc tính dạng chữ/số (để khớp thủ công khi tên không theo quy ước)
    const attrs = {};
    Object.entries(props).forEach(([k, v]) => {
      if (v != null && typeof v !== 'object') attrs[k] = String(v).trim();
    });
    const out = { poly: [], line: [], open: [], points: [], other: 0 };
    collect(f && f.geometry, out);
    skip('hình khác', out.other);
    if (out.poly.length) { entities.push({ kind: 'POLYGON', layer, name, attrs, rings: out.poly }); stats.polygon++; }
    if (out.line.length) { entities.push({ kind: 'POLYLINE', layer, name, attrs, rings: out.line }); stats.polyline++; }
    if (out.open.length && !out.poly.length) {
      out.open.forEach(pts => { entities.push({ kind: 'LINE', layer, name, attrs, rings: [pts] }); stats.line++; });
    } else skip('line hở', out.open.length);
    // Point đi kèm vùng trong cùng feature (GeometryCollection) là điểm nhãn của vùng → không nhập riêng
    if (!out.poly.length && !out.line.length && !out.open.length) {
      out.points.forEach(pt => { entities.push({ kind: 'POINT', layer, name, attrs, rings: [], pt }); stats.point++; });
      if (!out.points.length && !out.other) skip('feature không có hình');
    }
  }
  const sample = entities.slice(0, 50).map(e => e.pt || e.rings[0][0]);
  const wgs84 = sample.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  return { entities, stats, wgs84 };
}
