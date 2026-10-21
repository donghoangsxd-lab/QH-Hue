// Chuẩn hóa dòng tab NOXH: hiện trạng tính dân, quy hoạch không tính.
// Cả NOXH và thương mại đều là chung cư khi tính dân. Cột loại chỉ để ghi nhãn.

const crypto = require('crypto');

const HH = 3.3;

function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function phaseOf(value) {
  const t = fold(value);
  if (!t) return 'quy_hoach';
  if (t === 'hientrang' || t === 'dahoanthanh' || t === 'hoanthanh' || t === 'true' || t === '1') return 'hien_trang';
  if (t.includes('hientrang') || t.includes('dahoanthanh')) return 'hien_trang';
  return 'quy_hoach';
}

function kindOf(value) {
  const t = fold(value);
  if (!t) return '';
  if (t.includes('thuongmai') || t === 'thuongmai' || t === 'tm') return 'thuongmai';
  if (t.includes('noxh') || t.includes('xahoi')) return 'noxh';
  return '';
}

function confidenceOf(value) {
  const raw = String(value || '').trim();
  const t = fold(raw);
  if (!t) return '';
  if (t === 'high' || t === 'cao' || t === 'tot') return 'high';
  if (t === 'medium' || t === 'vua' || t === 'tb' || t === 'trungbinh') return 'medium';
  if (t === 'low' || t === 'thap' || t === 'yeu') return 'low';
  return raw;
}

/** Đúng tên NOXH trước; không có thì tab đánh số như 14-NOXH. */
function isNoxhSheetName(name) {
  const n = String(name || '');
  return n === 'NOXH' || /^\s*\d+\s*[-_.]\s*NOXH\s*$/i.test(n);
}

function pickNoxhSheetName(names) {
  const list = names || [];
  if (list.indexOf('NOXH') >= 0) return 'NOXH';
  return list.find(n => /^\s*\d+\s*[-_.]\s*NOXH\s*$/i.test(String(n))) || '';
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseWktCoords(body) {
  const pts = String(body || '').split(',').map(part => {
    const xy = part.trim().split(/\s+/).map(Number);
    if (xy.length < 2 || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
    return [xy[0], xy[1]];
  }).filter(Boolean);
  return pts.length >= 4 ? pts : null;
}

/** POLYGON hoặc MULTIPOLYGON (mỗi mảnh có thể có lỗ). */
function parseWktPolygon(wkt) {
  const text = String(wkt || '').trim();
  const multi = /^MULTIPOLYGON/i.test(text);
  if (!multi && !/^POLYGON/i.test(text)) return null;
  let i = text.indexOf('(');
  if (i < 0) return null;
  const skip = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  const parseRing = () => {
    skip();
    if (text[i] !== '(') return null;
    const end = text.indexOf(')', i + 1);
    if (end < 0) return null;
    const pts = parseWktCoords(text.slice(i + 1, end));
    i = end + 1;
    return pts;
  };
  const parsePoly = () => {
    skip();
    if (text[i] !== '(') return null;
    i += 1;
    const rings = [];
    while (i < text.length) {
      skip();
      if (text[i] === ')') { i += 1; break; }
      if (text[i] === ',') { i += 1; continue; }
      const ring = parseRing();
      if (!ring) break;
      rings.push(ring);
    }
    return rings.length ? rings : null;
  };
  if (multi) {
    i += 1;
    const polys = [];
    while (i < text.length) {
      skip();
      if (text[i] === ')') break;
      if (text[i] === ',') { i += 1; continue; }
      const poly = parsePoly();
      if (!poly) break;
      polys.push(poly);
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  const rings = parsePoly();
  return rings ? { type: 'Polygon', coordinates: rings } : null;
}

function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates && geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).map(poly => poly && poly[0]).filter(Boolean);
  }
  return [];
}

function ringAreaM2(ring) {
  if (!ring || ring.length < 4) return 0;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const m = 111320;
  const cos = Math.cos(lat * Math.PI / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * m * cos;
    const y1 = ring[i][1] * m;
    const x2 = ring[i + 1][0] * m * cos;
    const y2 = ring[i + 1][1] * m;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function areaM2Of(row, geometry) {
  const ha = num(row.siteHa);
  if (ha != null && ha > 0 && ha < 100) return ha * 10000;
  if (ha != null && ha >= 100) return ha;
  const fp = num(row.footprint);
  if (fp != null && fp > 0) return fp;
  const rings = outerRings(geometry);
  if (rings.length) return rings.reduce((sum, ring) => sum + ringAreaM2(ring), 0);
  return 0;
}

function peopleOf(row) {
  const residents = num(row.residents);
  if (residents != null && residents > 0) return residents;
  const units = num(row.units);
  if (units != null && units > 0) return units * HH;
  const pop = num(row.pop);
  if (pop != null && pop > 0) return pop;
  return 0;
}

function centroidOf(geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return null;
  let ring = rings[0];
  let best = ringAreaM2(ring);
  for (let i = 1; i < rings.length; i++) {
    const area = ringAreaM2(rings[i]);
    if (area > best) { ring = rings[i]; best = area; }
  }
  let lng = 0;
  let lat = 0;
  const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return n ? { lng: lng / n, lat: lat / n } : null;
}

/** Dòng sheet hoặc seed apartments.json → bản ghi dùng cho bản đồ và raster. */
function normalizeNoxhItem(row, index) {
  if (!row || typeof row !== 'object') return null;
  const wktRaw = String(row.wkt || row.WKT || row.WKT_simplified || '').trim();
  const geometry = row.geometry && (row.geometry.type === 'Polygon' || row.geometry.type === 'MultiPolygon')
    ? row.geometry
    : parseWktPolygon(wktRaw);
  const center = centroidOf(geometry);
  const lat = num(row.lat) != null ? num(row.lat) : (center && center.lat);
  const lng = num(row.lng) != null ? num(row.lng) : (center && center.lng);
  if (lat == null || lng == null) return null;
  const status = row.status === 'hien_trang' || row.status === 'quy_hoach' ? row.status : phaseOf(row.status || row.detail);
  const pop = status === 'hien_trang' ? peopleOf(row) : 0;
  const given = String(row.id || '').trim();
  const slug = fold(row.name).slice(0, 48);
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(given) ? given : (slug ? `NOXH-${slug}` : `NOXH-${index + 1}`);
  return {
    id,
    name: String(row.name || '').trim(),
    detail: String(row.detail || '').trim(),
    ward: String(row.ward || '').trim(),
    lat,
    lng,
    floors: num(row.floors),
    units: num(row.units),
    residents: num(row.residents),
    siteHa: num(row.siteHa),
    footprint: num(row.footprint),
    coverage: num(row.coverage),
    far: num(row.far),
    status,
    kind: kindOf(row.kind) || (row.kind === 'thuongmai' || row.kind === 'noxh' ? row.kind : ''),
    kindDetail: String(row.kindDetail || row.loai_chi_tiet || '').trim(),
    confidence: confidenceOf(row.confidence != null ? row.confidence : row.do_tin_cay),
    locateNote: String(row.locateNote || row.ghi_chu_dinh_vi || '').trim(),
    wkt: /^(MULTI)?POLYGON\s*\(/i.test(wktRaw) && wktRaw.length <= 45000 ? wktRaw : '',
    geometry: geometry || null,
    areaM2: areaM2Of(row, geometry),
    pop: Math.round(pop),
    source: row.source || 'noxh'
  };
}

function normalizeNoxhPack(raw) {
  const rows = (raw && raw.items) || [];
  const items = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const it = normalizeNoxhItem(row, i);
    if (!it) return;
    if (seen.has(it.id)) it.id = `${it.id}-${i + 1}`;
    seen.add(it.id);
    items.push(it);
  });
  const version = crypto.createHash('sha1').update(JSON.stringify(items.map(it => [
    it.id, it.status, it.pop, it.kind, it.kindDetail, it.confidence, it.locateNote, it.lng, it.lat, it.areaM2,
    it.geometry ? JSON.stringify(it.geometry.coordinates) : ''
  ]))).digest('hex').slice(0, 16);
  return { v: 1, version, items };
}

module.exports = {
  HH, fold, phaseOf, kindOf, confidenceOf, isNoxhSheetName, pickNoxhSheetName,
  parseWktPolygon, peopleOf, normalizeNoxhItem, normalizeNoxhPack
};
