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

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseWktPolygon(wkt) {
  const text = String(wkt || '').trim();
  if (!/^POLYGON/i.test(text)) return null;
  const rings = [];
  const re = /\(([^()]+)\)/g;
  let match = re.exec(text);
  while (match) {
    const pts = match[1].split(',').map(part => {
      const xy = part.trim().split(/\s+/).map(Number);
      if (xy.length < 2 || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
      return [xy[0], xy[1]];
    }).filter(Boolean);
    if (pts.length >= 4) rings.push(pts);
    match = re.exec(text);
  }
  if (!rings.length) return null;
  return { type: 'Polygon', coordinates: rings };
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
  if (geometry && geometry.type === 'Polygon') return ringAreaM2(geometry.coordinates[0]);
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
  const ring = geometry && geometry.type === 'Polygon' ? geometry.coordinates[0] : null;
  if (!ring || !ring.length) return null;
  let lng = 0;
  let lat = 0;
  const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return { lng: lng / n, lat: lat / n };
}

/** Dòng sheet hoặc seed apartments.json → bản ghi dùng cho bản đồ và raster. */
function normalizeNoxhItem(row, index) {
  if (!row || typeof row !== 'object') return null;
  const geometry = row.geometry && (row.geometry.type === 'Polygon' || row.geometry.type === 'MultiPolygon')
    ? row.geometry
    : parseWktPolygon(row.wkt || row.WKT || row.WKT_simplified);
  const center = centroidOf(geometry && geometry.type === 'Polygon' ? geometry : null);
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
    it.id, it.status, it.pop, it.kind, it.lng, it.lat, it.areaM2, it.geometry ? JSON.stringify(it.geometry.coordinates) : ''
  ]))).digest('hex').slice(0, 16);
  return { v: 1, version, items };
}

module.exports = {
  HH, fold, phaseOf, kindOf, parseWktPolygon, peopleOf, normalizeNoxhItem, normalizeNoxhPack
};
