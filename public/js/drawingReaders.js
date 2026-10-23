// Đọc bản vẽ hồ sơ trên trình duyệt. Không ghi catalog, không gọi máy chủ.
// Sử dụng đất: polygon + block tem (ATTRIB), gộp thuộc tính theo điểm trong vùng.
// Hạ tầng đường/điểm: polyline có layer + block ký hiệu thành điểm công trình đầu mối.
import { CRS_PRESETS, detectAxes, readDxfBag, vn2000ToWgs84 } from './cadImport.js';
import { parseKml, unzipKml } from './kmlImport.js';

export const DRAW_MAX_BYTES = 20 * 1024 * 1024;
const HUE = { minLng: 107.0, maxLng: 108.35, minLat: 15.75, maxLat: 16.85 };

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInRings(x, y, rings) {
  if (!rings || !rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(x, y, rings[k])) return false;
  return true;
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0], b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) return ring.concat([[a[0], a[1]]]);
  return ring;
}

function attrBag(attrs, layer) {
  const out = {};
  if (layer) out.layer = String(layer).slice(0, 80);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    const key = String(k || '').trim().slice(0, 40);
    const val = String(v ?? '').trim().slice(0, 120);
    if (key && val && !(key in out)) out[key] = val;
  });
  const nhan = Object.entries(out).filter(([k]) => k !== 'layer').map(([k, v]) => `${k}=${v}`).join('; ').slice(0, 120);
  if (nhan) out.nhan = nhan;
  return out;
}

function looksGeographic(pts) {
  if (!pts.length) return false;
  const geo = pts.filter(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  return geo.length >= pts.length * 0.9;
}

function sampleOf(bag) {
  const pts = [];
  bag.polygons.forEach(p => { if (p.rings[0] && p.rings[0][0]) pts.push(p.rings[0][0]); });
  bag.lines.forEach(l => { if (l.pts && l.pts[0]) pts.push(l.pts[0]); });
  bag.inserts.forEach(ins => pts.push([ins.x, ins.y]));
  return pts.slice(0, 50);
}

/** id: auto | WGS84 | HUE_3 | HUE_107_45 | UTM48_6 | custom. custom cần lon0 (độ). */
export function resolveCrs(pts, choice) {
  const id = choice && choice.id || 'auto';
  if (id === 'WGS84') return { crs: { wgs84: true, label: 'WGS84' }, axes: { f: (x, y) => [x, y], note: '', valid: true } };
  if (id === 'custom') {
    const lon0 = Number(choice.lon0);
    if (!Number.isFinite(lon0) || lon0 < 102 || lon0 > 110) {
      return { error: 'Nhập kinh tuyến trục từ 102 đến 110 độ.' };
    }
    const k0 = Math.abs(lon0 - 105) < 0.2 ? 0.9996 : 0.9999;
    return { crs: { label: `VN-2000 KTT ${lon0}°`, lon0, k0 }, axes: { f: (x, y) => [x, y], note: '', valid: true } };
  }
  if (id !== 'auto' && CRS_PRESETS[id]) {
    return { crs: CRS_PRESETS[id], axes: { f: (x, y) => [x, y], note: '', valid: true } };
  }
  if (looksGeographic(pts)) return { crs: { wgs84: true, label: 'WGS84' }, axes: { f: (x, y) => [x, y], note: 'nhận dạng kinh vĩ độ', valid: true } };
  const fake = pts.map(([x, y]) => ({ pt: [x, y], rings: [] }));
  const axes = fake.length ? detectAxes(fake) : { f: (x, y) => [x, y], note: '', valid: false };
  if (!axes.valid) return { error: 'Tọa độ không phải kinh vĩ độ và chưa khớp VN-2000. Chọn kinh tuyến trục.', needCrs: true };
  return { crs: CRS_PRESETS.HUE_3, axes };
}

function toLngLat(x, y, crs, axes) {
  if (crs.wgs84) return [x, y];
  const [E, N] = axes.f(x, y);
  const [lat, lng] = vn2000ToWgs84(E, N, crs);
  return [lng, lat];
}

function mapRing(ring, crs, axes) {
  return ring.map(([x, y]) => toLngLat(x, y, crs, axes));
}

function inHue(lng, lat) {
  return lng >= HUE.minLng && lng <= HUE.maxLng && lat >= HUE.minLat && lat <= HUE.maxLat;
}

function hueWarning(features) {
  let n = 0, out = 0;
  const take = (lng, lat) => { n++; if (!inHue(lng, lat)) out++; };
  features.forEach(f => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === 'Point') take(g.coordinates[0], g.coordinates[1]);
    else if (g.type === 'LineString') g.coordinates.forEach(c => take(c[0], c[1]));
    else if (g.type === 'Polygon') (g.coordinates[0] || []).forEach(c => take(c[0], c[1]));
  });
  if (n && out / n > 0.5) return 'Phần lớn tọa độ nằm ngoài TP Huế. Kiểm tra lại kinh tuyến trục.';
  return '';
}

function mergeLabels(polys, inserts) {
  const used = new Set();
  polys.forEach(p => {
    inserts.forEach((ins, i) => {
      if (used.has(i)) return;
      if (!pointInRings(ins.x, ins.y, p.rings)) return;
      p.attrs = { ...(ins.attrs || {}), ...(p.attrs || {}) };
      if (ins.name) p.block = ins.name;
      used.add(i);
    });
  });
  return inserts.filter((_, i) => !used.has(i));
}

function polyFeature(p, crs, axes) {
  const rings = p.rings.map(r => closeRing(mapRing(r, crs, axes)));
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: rings },
    properties: attrBag(p.attrs, p.layer)
  };
}

function lineFeature(line, crs, axes) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: line.pts.map(([x, y]) => toLngLat(x, y, crs, axes)) },
    properties: attrBag(line.attrs, line.layer)
  };
}

function pointFeature(ins, crs, axes) {
  const [lng, lat] = toLngLat(ins.x, ins.y, crs, axes);
  const props = attrBag(ins.attrs, ins.layer);
  if (ins.name && !props.block) props.block = ins.name;
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props };
}

function finish(features, stats, extra) {
  const warning = [extra && extra.warning, hueWarning(features)].filter(Boolean).join(' ');
  return { features, stats, warning, crsLabel: extra && extra.crsLabel || '' };
}

function readBag(bag, kind, crs, axes) {
  if (kind === 'land') {
    const orphans = mergeLabels(bag.polygons, bag.inserts);
    const features = bag.polygons.map(p => polyFeature(p, crs, axes));
    return finish(features, { ...bag.stats, label: bag.inserts.length, labelOrphan: orphans.length }, { crsLabel: crs.label });
  }
  if (kind === 'boundary') {
    const features = [
      ...bag.polygons.map(p => polyFeature(p, crs, axes)),
      ...bag.lines.map(l => lineFeature(l, crs, axes))
    ];
    return finish(features, bag.stats, { crsLabel: crs.label });
  }
  const features = [
    ...bag.lines.map(l => lineFeature(l, crs, axes)),
    ...bag.polygons.map(p => lineFeature({ layer: p.layer, pts: p.rings[0], attrs: p.attrs }, crs, axes)),
    ...bag.inserts.map(ins => pointFeature(ins, crs, axes))
  ];
  return finish(features, bag.stats, { crsLabel: crs.label });
}

function kmlBag(text, kind) {
  const parsed = parseKml(text, { openLines: kind !== 'land' });
  const polygons = [];
  const lines = [];
  const inserts = [];
  parsed.entities.forEach(e => {
    if (e.kind === 'POLYGON' || e.kind === 'POLYLINE') {
      polygons.push({ layer: e.layer || e.name || '', rings: e.rings, attrs: e.attrs || {} });
    } else if (e.kind === 'LINE') {
      (e.rings || []).forEach(pts => lines.push({ layer: e.layer || e.name || '', pts, attrs: e.attrs || {} }));
    } else if (e.kind === 'POINT' && e.pt) {
      inserts.push({ layer: e.layer || '', name: e.name || '', x: e.pt[0], y: e.pt[1], attrs: e.attrs || {} });
    }
  });
  return { polygons, lines, inserts, stats: parsed.stats };
}

function fromDxf(text, kind, choice) {
  const bag = readDxfBag(text);
  const picked = resolveCrs(sampleOf(bag), choice);
  if (picked.error) return { features: [], stats: bag.stats, error: picked.error, needCrs: !!picked.needCrs };
  const axes = picked.axes || { f: (x, y) => [x, y] };
  if (kind === 'network' && picked.axes && picked.axes.f) {
    bag.lines.forEach(l => { l.pts = l.pts.map(([x, y]) => picked.axes.f(x, y)); });
    bag.polygons.forEach(p => { p.rings = p.rings.map(r => r.map(([x, y]) => picked.axes.f(x, y))); });
    bag.inserts.forEach(ins => { const [E, N] = picked.axes.f(ins.x, ins.y); ins.x = E; ins.y = N; });
    return readBag(bag, kind, picked.crs, { f: (x, y) => [x, y] });
  }
  return readBag(bag, kind, picked.crs, axes);
}

function fromKmlText(text, kind) {
  const bag = kmlBag(text, kind);
  const crs = { wgs84: true, label: 'WGS84' };
  const axes = { f: (x, y) => [x, y] };
  const sample = sampleOf(bag);
  if (sample.length && !looksGeographic(sample)) {
    return { features: [], stats: bag.stats, error: 'KML phải để tọa độ WGS84 (kinh độ, vĩ độ).', needCrs: false };
  }
  return readBag(bag, kind, crs, axes);
}

/** kind: land | network | boundary. choice: { id, lon0 }. */
export function readDrawingText(text, ext, kind, choice) {
  const e = String(ext || '').toLowerCase();
  if (e === 'dxf') return fromDxf(text, kind, choice);
  if (e === 'kml') return fromKmlText(text, kind);
  return { features: [], stats: {}, error: 'Chỉ nhận DXF, KML hoặc KMZ.' };
}

export async function readDrawingFile(file, kind, choice) {
  const name = String(file && file.name || '');
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!['dxf', 'kml', 'kmz'].includes(ext)) return { features: [], stats: {}, error: 'Chỉ nhận DXF, KML hoặc KMZ.' };
  if (file.size > DRAW_MAX_BYTES) return { features: [], stats: {}, error: 'Bản vẽ tối đa 20 MB.' };
  if (ext === 'kmz') {
    const text = await unzipKml(await file.arrayBuffer());
    return fromKmlText(text, kind);
  }
  return readDrawingText(await file.text(), ext, kind, choice);
}

/** Gắn đủ trục lên từng đối tượng. area = { type, code, parent }. */
export function tagFeatures(features, meta) {
  const area = meta && meta.area || {};
  const m = meta || {};
  return (features || []).map((f, i) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      ...(f.properties || {}),
      scheme: m.scheme || '',
      level: m.level || '',
      sector: m.sector || '',
      kind: m.kind || '',
      areaType: area.type || '',
      areaCode: area.code || '',
      areaParent: area.parent == null ? '' : String(area.parent),
      step: m.step || '',
      fid: i + 1
    }
  }));
}

export function asCollection(features) {
  return { type: 'FeatureCollection', features: features || [] };
}
