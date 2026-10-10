// Nhập lô đất từ KML/KMZ (xuất từ CAD/QGIS/ArcGIS): Polygon và đường khép kín, tọa độ WGS84.
// Loại hạ tầng dò theo thứ tự: trường thuộc tính Layer → tên Folder chứa (gần nhất trước) → tên Placemark.
import { layerToType } from './cadImport.js';

const LAYER_FIELD = /^(layer|layer_?name|ten_?layer|lop)$/i;
const CLOSE_TOL_DEG = 1e-7; // ~1 cm

const children = (el, name) => [...el.children].filter(c => c.localName === name);
const childText = (el, name) => { const c = children(el, name)[0]; return c ? c.textContent.trim() : ''; };
const descendants = (el, name) => [...el.getElementsByTagNameNS('*', name)];

// ExtendedData (SimpleData/Data) hoặc bảng thuộc tính HTML trong description (ArcGIS)
function layerField(pm) {
  for (const sd of descendants(pm, 'SimpleData')) {
    if (LAYER_FIELD.test(sd.getAttribute('name') || '')) return sd.textContent.trim();
  }
  for (const d of descendants(pm, 'Data')) {
    if (LAYER_FIELD.test(d.getAttribute('name') || '')) return childText(d, 'value');
  }
  const m = childText(pm, 'description').match(/<t[dh][^>]*>\s*(?:layer|layer_?name)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]*?)\s*</i);
  return m ? m[1] : '';
}

// Mọi thuộc tính của Placemark (để khớp thủ công khi tên không theo quy ước): ExtendedData, bảng HTML ArcGIS, Folder, tên
function placemarkAttrs(pm, name, folders) {
  const attrs = {};
  const put = (k, v) => { k = String(k || '').trim(); if (k && !(k in attrs)) attrs[k] = String(v ?? '').trim(); };
  descendants(pm, 'SimpleData').forEach(sd => put(sd.getAttribute('name'), sd.textContent));
  descendants(pm, 'Data').forEach(d => put(d.getAttribute('name'), childText(d, 'value')));
  const desc = childText(pm, 'description');
  for (const m of desc.matchAll(/<t[dh][^>]*>\s*([^<]{1,40}?)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]*?)\s*<\/t[dh]>/gi)) put(m[1], m[2]);
  folders.forEach((f, i) => put(i === 0 ? 'Folder' : `Folder cấp trên ${i}`, f));
  put('Tên Placemark', name);
  return attrs;
}

function folderNames(pm) {
  const names = [];
  for (let el = pm.parentElement; el; el = el.parentElement) {
    if (el.localName === 'Folder') { const n = childText(el, 'name'); if (n) names.push(n); }
  }
  return names;
}

// Tên layer dùng để nhận loại; lấy từ tên Placemark thì chỉ giữ mã loại (tên đầy đủ dùng làm tên công trình)
function resolveLayer(pm, name) {
  const field = layerField(pm);
  const folders = folderNames(pm);
  for (const c of [field, ...folders]) if (c && layerToType(c)) return c;
  const t = name && layerToType(name);
  if (t) return t.prefix;
  return field || folders[0] || name || '(không tên)';
}

function parseCoords(text) {
  const pts = [];
  for (const tok of String(text || '').trim().split(/\s+/)) {
    const [lng, lat] = tok.split(',').map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) pts.push([lng, lat]);
  }
  return pts;
}

function insidePolygon(el) {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === 'Polygon') return true;
  return false;
}

const samePt = (a, b) => Math.abs(a[0] - b[0]) < CLOSE_TOL_DEG && Math.abs(a[1] - b[1]) < CLOSE_TOL_DEG;

// Vòng mở (bỏ điểm đóng và điểm lặp liên tiếp); null nếu dưới 3 đỉnh
export function openRing(pts) {
  const r = [];
  for (const p of pts) if (!r.length || !samePt(r[r.length - 1], p)) r.push(p);
  if (r.length > 1 && samePt(r[0], r[r.length - 1])) r.pop();
  return r.length >= 3 ? r : null;
}

/**
 * Đọc KML (văn bản) → { entities: [{kind: 'POLYGON'|'POLYLINE'|'POINT', layer, name, attrs, rings, pt?}], stats }.
 * Bộ lọc mặc định: chỉ nhận Polygon, đường khép kín và Point (Placemark không có vùng); còn lại đếm vào stats.skipped.
 */
export function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('File KML lỗi cấu trúc XML.');
  const stats = { placemark: 0, polygon: 0, polyline: 0, point: 0, skipped: {} };
  const skip = (label, n = 1) => { stats.skipped[label] = (stats.skipped[label] || 0) + n; };
  const entities = [];
  for (const pm of descendants(doc, 'Placemark')) {
    stats.placemark++;
    const name = childText(pm, 'name');
    const layer = resolveLayer(pm, name);
    const attrs = placemarkAttrs(pm, name, folderNames(pm));
    const polyRings = [];
    for (const poly of descendants(pm, 'Polygon')) {
      for (const lr of descendants(poly, 'LinearRing')) {
        const r = openRing(parseCoords(childText(lr, 'coordinates')));
        if (r) polyRings.push(r);
      }
    }
    const lineRings = [];
    const lines = [...descendants(pm, 'LineString'), ...descendants(pm, 'LinearRing').filter(lr => !insidePolygon(lr))];
    for (const ln of lines) {
      const pts = parseCoords(childText(ln, 'coordinates'));
      const r = pts.length > 3 && samePt(pts[0], pts[pts.length - 1]) ? openRing(pts) : null;
      if (r) lineRings.push(r); else skip('line hở');
    }
    if (polyRings.length) { entities.push({ kind: 'POLYGON', layer, name, attrs, rings: polyRings }); stats.polygon++; }
    if (lineRings.length) { entities.push({ kind: 'POLYLINE', layer, name, attrs, rings: lineRings }); stats.polyline++; }
    const points = descendants(pm, 'Point');
    // Point đi kèm vùng trong cùng Placemark (MultiGeometry) là điểm nhãn của vùng → không nhập riêng
    if (polyRings.length || lineRings.length) continue;
    let added = 0;
    for (const p of points) {
      const pt = parseCoords(childText(p, 'coordinates'))[0];
      if (pt) { entities.push({ kind: 'POINT', layer, name, attrs, rings: [], pt }); stats.point++; added++; }
    }
    if (!added && !lines.length) skip(points.length ? 'point lỗi tọa độ' : 'placemark không có hình');
  }
  return { entities, stats };
}

/**
 * Danh sách file trong ZIP (KMZ, shapefile nén): [{ name, read() → Promise<Uint8Array> }].
 * label: tên định dạng dùng trong thông báo lỗi.
 */
export function readZip(buf, label = 'ZIP') {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`File ${label} hỏng (không đọc được nội dung nén).`);
  const dec = new TextDecoder();
  const entries = [];
  let p = view.getUint32(eocd + 16, true);
  for (let k = view.getUint16(eocd + 10, true); k > 0 && view.getUint32(p, true) === 0x02014b50; k--) {
    const nameLen = view.getUint16(p + 28, true);
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.push({
      name,
      method,
      size,
      usize,
      // maxBytes: dừng sau bấy nhiêu byte đã giải nén (đọc 100 byte đầu .shp, không giải cả file tọa độ)
      read: async (opts) => {
        const maxBytes = opts && opts.maxBytes > 0 ? opts.maxBytes : 0;
        if (size === 0xffffffff) throw new Error(`${label} dạng ZIP64 — chọn thư mục trên máy thay vì file nén.`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = new Uint8Array(buf, start, size);
        if (method === 0) return maxBytes ? data.subarray(0, maxBytes) : data;
        if (method !== 8) throw new Error(`${label} dùng kiểu nén chưa hỗ trợ — giải nén rồi nén lại bằng ZIP thường.`);
        if (typeof DecompressionStream === 'undefined') throw new Error(`Trình duyệt chưa hỗ trợ giải nén ${label} — dùng Chrome/Edge bản mới.`);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        if (!maxBytes) return new Uint8Array(await new Response(stream).arrayBuffer());
        const reader = stream.getReader();
        const chunks = [];
        let got = 0;
        while (got < maxBytes) {
          const step = await reader.read();
          if (step.done) break;
          chunks.push(step.value);
          got += step.value.length;
        }
        try { await reader.cancel(); } catch (e) { /* luồng đã đóng */ }
        const out = new Uint8Array(Math.min(got, maxBytes));
        let o = 0;
        for (const c of chunks) {
          const n = Math.min(c.length, out.length - o);
          if (n > 0) out.set(c.subarray(0, n), o);
          o += n;
          if (o >= out.length) break;
        }
        return out;
      }
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

/** KMZ (zip) → nội dung KML chính (doc.kml hoặc file .kml nằm nông nhất) */
export async function unzipKml(buf) {
  const kmls = readZip(buf, 'KMZ').filter(e => /\.kml$/i.test(e.name));
  const entry = kmls.find(e => /(^|\/)doc\.kml$/i.test(e.name))
    || kmls.sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!entry) throw new Error('Trong file KMZ không có file .kml.');
  return new TextDecoder().decode(await entry.read());
}
