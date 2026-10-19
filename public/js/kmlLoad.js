// Đọc file KML/KMZ trên trình duyệt (KMZ giải bằng readZip sẵn có, không thêm thư viện).
// Tọa độ coi là WGS84. Dùng cho phác thảo và ranh đồ án.
import { parseKml, unzipKml } from './kmlImport.js';

export const KML_MAX_BYTES = 8 * 1024 * 1024;
export const SKETCH_MAX_SHAPES = 400;
const HUE = { minLat: 15.5, maxLat: 17.2, minLng: 106.4, maxLng: 108.8 };
// Khớp constants.HUE_BOUNDS: máy chủ từ chối cả ranh nếu một đỉnh nằm ngoài khung này
const HUE_STRICT = { minLat: 15.9, maxLat: 16.9, minLng: 106.9, maxLng: 108.3 };

const inWgs = (lng, lat) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
const inBox = (box, lng, lat) => lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat;
const inHue = (lng, lat) => inBox(HUE, lng, lat);
const ringInside = (box, ring) => ring.every(([lng, lat]) => inBox(box, lng, lat));

export function wgsPair(pair) {
  if (!pair || pair.length < 2) return null;
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  return inWgs(lng, lat) ? [lng, lat] : null;
}

/** Vòng kín đã bỏ điểm đóng: giữ đỉnh WGS84, bỏ đỉnh lặp. null nếu dưới 3 đỉnh. */
export function cleanRing(ring) {
  const out = [];
  for (const p of ring || []) {
    const q = wgsPair(p);
    if (!q) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    out.push(q);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** Đường hở: ít nhất 2 đỉnh WGS84. */
export function cleanLine(line) {
  const out = [];
  for (const p of line || []) {
    const q = wgsPair(p);
    if (!q) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    out.push(q);
  }
  return out.length >= 2 ? out : null;
}

export function touchesHue(rings) {
  for (const ring of rings) {
    for (const p of ring) if (inHue(p[0], p[1])) return true;
  }
  return false;
}

/** File .kml hoặc .kmz → văn bản KML. Lỗi tiếng Việt. */
export async function kmlTextFromFile(file) {
  if (!file) throw new Error('Chưa chọn file.');
  const name = String(file.name || '');
  if (file.size > KML_MAX_BYTES) throw new Error('File lớn hơn 8 MB. Rút gọn hình rồi nhập lại.');
  if (!/\.kml$/i.test(name) && !/\.kmz$/i.test(name)) throw new Error('Chỉ nhận file .kml hoặc .kmz.');
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { throw new Error('Không đọc được file.'); }
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  const zip = head.length === 2 && head[0] === 0x50 && head[1] === 0x4b;
  if (zip || /\.kmz$/i.test(name)) {
    if (!zip) throw new Error('File KMZ hỏng (không phải file nén).');
    try { return await unzipKml(buf); }
    catch (e) { throw new Error(e.message || 'Không giải nén được file KMZ.'); }
  }
  const text = new TextDecoder().decode(buf).replace(/^\uFEFF/, '');
  if (!/<kml[\s>]/i.test(text) && !/<Placemark[\s>]/i.test(text)) throw new Error('File không phải KML.');
  return text;
}

/**
 * Phác thảo: Polygon / MultiGeometry, đường khép, đường hở, điểm.
 * Trả { shapes: [{tool, pts:[LatLng-like {lat,lng}], text?}], skipped, stats }.
 */
export function sketchShapesFromKml(text) {
  let parsed;
  try { parsed = parseKml(text, { openLines: true }); }
  catch (e) { throw new Error(e.message || 'File KML lỗi cấu trúc XML.'); }
  const shapes = [];
  let dropped = 0;
  const ringsSeen = [];
  const push = (tool, lnglats, textLabel) => {
    if (shapes.length >= SKETCH_MAX_SHAPES) { dropped++; return; }
    const pts = lnglats.map(([lng, lat]) => ({ lat, lng }));
    shapes.push(textLabel ? { tool, pts, text: textLabel } : { tool, pts });
  };
  for (const e of parsed.entities) {
    if (e.kind === 'POLYGON' || e.kind === 'POLYLINE') {
      for (const ring of e.rings || []) {
        const clean = cleanRing(ring);
        if (!clean) { dropped++; continue; }
        ringsSeen.push(clean);
        push('polygon', clean);
      }
    } else if (e.kind === 'LINE') {
      for (const line of e.rings || []) {
        const clean = cleanLine(line);
        if (!clean) { dropped++; continue; }
        ringsSeen.push(clean);
        push(clean.length === 2 ? 'line' : 'polyline', clean);
      }
    } else if (e.kind === 'POINT') {
      const q = wgsPair(e.pt);
      if (!q) { dropped++; continue; }
      ringsSeen.push([q]);
      const label = String(e.name || '').trim();
      if (label) push('text', [q], label.slice(0, 200));
      else {
        const lat = q[1];
        const dLng = 25 / (111320 * Math.cos(lat * Math.PI / 180));
        push('circle', [q, [q[0] + dLng, lat]]);
      }
    }
  }
  if (!shapes.length) {
    const why = Object.entries(parsed.stats.skipped || []).map(([k, n]) => `${k}: ${n}`).join(', ');
    throw new Error(why ? `Không có hình hợp lệ (${why}).` : 'File không có vùng, đường hoặc điểm hợp lệ.');
  }
  if (!touchesHue(ringsSeen)) throw new Error('Tọa độ không nằm quanh Huế. File cần kinh độ, vĩ độ WGS84.');
  return { shapes, dropped, stats: parsed.stats };
}

/** Ranh đồ án: chỉ vùng (Polygon hoặc đường khép kín), mỗi vòng là một Polygon GeoJSON. */
export function boundaryPolygonsFromKml(text) {
  let parsed;
  try { parsed = parseKml(text); }
  catch (e) { throw new Error(e.message || 'File KML lỗi cấu trúc XML.'); }
  const polygons = [];
  let outside = 0;
  for (const e of parsed.entities) {
    if (e.kind !== 'POLYGON' && e.kind !== 'POLYLINE') continue;
    for (const ring of e.rings || []) {
      const clean = cleanRing(ring);
      if (!clean) continue;
      if (!ringInside(HUE_STRICT, clean)) { outside++; continue; }
      polygons.push({ type: 'Polygon', coordinates: [[...clean, clean[0]]] });
    }
  }
  if (!polygons.length) {
    throw new Error(outside
      ? 'Không có vùng nào nằm trọn trong thành phố Huế (vĩ độ 15,9–16,9, kinh độ 106,9–108,3).'
      : 'File không có vùng (Polygon hoặc đường khép kín). Đường hở và điểm không dùng làm ranh.');
  }
  return polygons;
}
