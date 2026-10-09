// Nhập lô đất từ shapefile nén .zip (.shp + .dbf, nên kèm .prj, .cpg): Polygon, PolyLine khép kín, Point.
// Mỗi .shp trong file zip là 1 lớp; DBF không có trường Layer thì lấy tên file .shp làm tên layer (VD HT_DAT_HTXH_Yte.shp).
// Hệ tọa độ theo .prj: GEOGCS = WGS84 (độ), PROJCS kinh tuyến trục 107° / 105° = VN-2000 múi 3° / UTM 48.
import { readZip } from './kmlImport.js';
import { parseFeatures, LAYER_FIELD } from './geojsonImport.js';

const SHP_POINT = new Set([1, 11, 21]);
const SHP_LINE = new Set([3, 13, 23]);
const SHP_POLYGON = new Set([5, 15, 25]);
const SHP_MULTIPOINT = new Set([8, 18, 28]);

// .shp: phần XY của mọi kiểu hình (bản Z / M có thêm dải giá trị phía sau, bỏ qua)
function readShp(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 100 || v.getInt32(0, false) !== 9994) throw new Error('File .shp hỏng (sai mã nhận dạng).');
  const shapes = [];
  let o = 100;
  while (o + 8 <= buf.byteLength) {
    const len = v.getInt32(o + 4, false) * 2;
    const c = o + 8;
    o = c + len;
    if (len < 4 || o > buf.byteLength) break;
    const type = v.getInt32(c, true);
    const pt = (at) => [v.getFloat64(at, true), v.getFloat64(at + 8, true)];
    if (SHP_POINT.has(type)) {
      shapes.push({ type: 'Point', coordinates: pt(c + 4) });
    } else if (SHP_MULTIPOINT.has(type)) {
      const n = v.getInt32(c + 36, true);
      shapes.push({ type: 'MultiPoint', coordinates: Array.from({ length: n }, (_, i) => pt(c + 40 + i * 16)) });
    } else if (SHP_LINE.has(type) || SHP_POLYGON.has(type)) {
      const nParts = v.getInt32(c + 36, true);
      const nPts = v.getInt32(c + 40, true);
      const starts = Array.from({ length: nParts }, (_, i) => v.getInt32(c + 44 + i * 4, true));
      const base = c + 44 + nParts * 4;
      const parts = starts.map((s, i) => {
        const end = i + 1 < nParts ? starts[i + 1] : nPts;
        return Array.from({ length: Math.max(0, end - s) }, (_, k) => pt(base + (s + k) * 16));
      });
      // Polygon: mọi vòng (ngoài + lỗ) đưa chung, bộ dựng lô tự xếp vòng ngoài / lỗ theo độ lồng nhau
      shapes.push(SHP_POLYGON.has(type)
        ? { type: 'Polygon', coordinates: parts }
        : { type: 'MultiLineString', coordinates: parts });
    } else {
      shapes.push(null);
    }
  }
  return shapes;
}

// Bảng mã DBF theo .cpg: UTF-8 / 65001, hoặc số trang mã (1258 = tiếng Việt Windows)
function dbfDecoder(cpg, bytes) {
  const s = String(cpg || '').trim().toLowerCase();
  if (/utf-?8|65001/.test(s)) return new TextDecoder('utf-8');
  const cp = s.match(/(\d{3,4})/);
  if (cp) { try { return new TextDecoder(`windows-${cp[1]}`); } catch (e) { /* trang mã trình duyệt không có */ } }
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return new TextDecoder('utf-8'); } catch (e) { return new TextDecoder('windows-1258'); }
}

function readDbf(buf, cpg) {
  if (!buf || buf.byteLength < 33) return [];
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = v.getUint32(4, true);
  const headLen = v.getUint16(8, true);
  const recLen = v.getUint16(10, true);
  const ascii = new TextDecoder('latin1');
  const fields = [];
  for (let o = 32; o + 32 <= headLen && buf[o] !== 0x0d; o += 32) {
    fields.push({ name: ascii.decode(buf.subarray(o, o + 11)).replace(/\0.*$/, '').trim(), type: String.fromCharCode(buf[o + 11]), len: buf[o + 16] });
  }
  const dec = dbfDecoder(cpg, buf.subarray(headLen, Math.min(buf.byteLength, headLen + recLen * 200)));
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = headLen + i * recLen;
    if (o + recLen > buf.byteLength) break;
    const deleted = buf[o] === 0x2a;
    o += 1;
    const row = {};
    for (const f of fields) {
      let val = dec.decode(buf.subarray(o, o + f.len)).replace(/\0/g, '').trim();
      o += f.len;
      if (f.type === 'L') val = /^[YyTt]$/.test(val) ? 'TRUE' : /^[NnFf]$/.test(val) ? 'FALSE' : '';
      if (val !== '') row[f.name] = val;
    }
    rows.push(deleted ? null : row);
  }
  return rows;
}

/** Nội dung .prj → 'WGS84' | mã CRS_PRESETS | null (không có / hệ khác) */
export function prjToCrs(prj) {
  const s = String(prj || '').trim().toUpperCase();
  if (!s) return null;
  if (!s.startsWith('PROJCS')) return s.startsWith('GEOGCS') ? 'WGS84' : null;
  const cm = s.match(/CENTRAL_MERIDIAN"\s*,\s*([-\d.]+)/);
  const lon0 = cm ? Number(cm[1]) : NaN;
  if (Math.abs(lon0 - 107) < 0.01) return 'HUE_3';
  if (Math.abs(lon0 - 105) < 0.01) return 'UTM48_6';
  return null;
}

/**
 * Shapefile nén (ArrayBuffer của .zip) → { entities, stats, wgs84, crs, layers, geojson }.
 * geojson: FeatureCollection đã chuyển (kèm thuộc tính Layer) để gửi hàng chờ duyệt như file GeoJSON.
 */
export async function parseShapefileZip(buf) {
  const entries = readZip(buf, 'ZIP');
  const byBase = new Map();
  for (const e of entries) {
    const m = e.name.match(/^(.*?)([^/\\]+)\.(shp|dbf|prj|cpg)$/i);
    if (!m || /__MACOSX/i.test(e.name)) continue;
    const key = (m[1] + m[2]).toLowerCase();
    const g = byBase.get(key) || { name: m[2] };
    g[m[3].toLowerCase()] = e;
    byBase.set(key, g);
  }
  const groups = [...byBase.values()].filter(g => g.shp);
  if (!groups.length) throw new Error('Trong file .zip không có shapefile (.shp).');
  const noDbf = groups.filter(g => !g.dbf).map(g => g.name);
  if (noDbf.length) throw new Error(`Thiếu file .dbf đi kèm: ${noDbf.join(', ')}.shp — nén đủ .shp, .shx, .dbf, .prj.`);

  const features = [];
  const fileLayers = new Set();
  const crsSet = new Set();
  let emptyShapes = 0;
  const text = async (e) => (e ? new TextDecoder().decode(await e.read()) : '');
  for (const g of groups) {
    const prj = await text(g.prj);
    crsSet.add(g.prj ? prjToCrs(prj) || 'OTHER' : 'NONE');
    const shapes = readShp(await g.shp.read());
    const rows = readDbf(await g.dbf.read(), await text(g.cpg));
    const hasLayer = rows.some(r => r && Object.keys(r).some(k => LAYER_FIELD.test(k)));
    if (!hasLayer) fileLayers.add(g.name);
    shapes.forEach((geometry, i) => {
      const row = rows[i];
      if (row === null) return;
      if (!geometry) { emptyShapes++; return; }
      const properties = { ...(row || {}) };
      if (!hasLayer) properties.Layer = g.name;
      features.push({ type: 'Feature', properties, geometry });
    });
  }
  const parsed = parseFeatures(features, { fileLayers });
  if (emptyShapes) parsed.stats.skipped['hình rỗng'] = emptyShapes;
  const known = [...crsSet].filter(c => c !== 'NONE' && c !== 'OTHER');
  const crs = known.length === 1 && crsSet.size === 1 ? known[0] : null;
  return {
    ...parsed,
    wgs84: crs ? crs === 'WGS84' : parsed.wgs84,
    crs,
    crsUnknown: crsSet.has('OTHER') || known.length > 1,
    layers: groups.map(g => g.name),
    geojson: { type: 'FeatureCollection', features }
  };
}
