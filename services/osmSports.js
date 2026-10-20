// Công trình thể thao OpenStreetMap (leisure) → dòng tab 8-VH (nhà văn hóa, thể thao hiện trạng).
// Khớp ô chọn Admin trong public/js/osmImport.js. Không đưa 8-VH vào NETWORK_CODES.
const LEISURE_VI = {
  sports_centre: 'Nhà thi đấu, trung tâm thể thao',
  pitch: 'Sân thể thao',
  stadium: 'Sân vận động',
  track: 'Đường chạy',
  fitness_centre: 'Cơ sở tập luyện',
  swimming_pool: 'Bể bơi',
  golf_course: 'Sân gôn'
};
const LEISURE_KINDS = new Set(Object.keys(LEISURE_VI));
// Sân vận động, nhà thi đấu, sân gôn phục vụ đô thị; sân nhỏ / bể bơi / phòng tập là cấp đơn vị ở
const URBAN_KINDS = new Set(['stadium', 'sports_centre', 'golf_course']);
// Cùng tên (đã bỏ dấu) và gần hơn ngưỡng này (m) → coi là một công trình, bỏ qua
const DUP_M = 80;
// Tên chung ("Sân thể thao") nằm sát một công trình đã có tên riêng → bản không tên của cùng chỗ
const GENERIC_M = 25;
const OSM_REF_RE = /OSM:(node|way|relation)\/\d+/;

function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').trim().toUpperCase();
}

function compactName(s) {
  return foldName(s).replace(/[^A-Z0-9]/g, '');
}

const SPORT_NAME_RE = /THETHAO|THEDUC|TDTT|SANVANDONG|SANGOLF|SANGON|SANBONG|NHATHIDAU|BEBOI|DUONGCHAY|TAPLUYEN|HOBOI|STADIUM|SWIMMING|GOLF|FITNESS|PITCH|SPORT/;

function looksLikeSport(name) {
  const s = compactName(name);
  return SPORT_NAME_RE.test(s) && !s.includes('VANHOA');
}

function isGenericSportName(name) {
  const f = foldName(name);
  if (!f) return true;
  if (Object.values(LEISURE_VI).some(label => foldName(label) === f)) return true;
  return LEISURE_KINDS.has(String(name || '').trim());
}

function deadLeisure(tags) {
  const t = tags || {};
  if (t.disused === 'yes' || t.abandoned === 'yes' || t.demolished === 'yes' || t.razed === 'yes') return true;
  return Object.keys(t).some(k => /^(abandoned|disused|razed|demolished|proposed|construction):/.test(k));
}

function rawName(tags) {
  const t = tags || {};
  return String(t['name:vi'] || t.name || t['name:en'] || '').trim();
}

function sportTitle(tags, kind) {
  const label = LEISURE_VI[kind] || 'Công trình thể thao';
  const name = rawName(tags);
  if (!name) return label;
  const titled = looksLikeSport(name) ? name : `${name} (${label})`;
  return titled.slice(0, 150);
}

function sportNhom(kind) {
  return URBAN_KINDS.has(kind) ? 'Cấp đô thị' : 'Cấp DVO';
}

function sportAddress(tags) {
  const t = tags || {};
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return String(t['addr:full'] || street || '').trim().slice(0, 120);
}

function sportNote(tags, kind, ref) {
  const label = LEISURE_VI[kind] || kind;
  const addr = sportAddress(tags);
  const bits = [`Nguồn: OSM (${ref})`, `Loại: ${label}`];
  if (addr) bits.push(`Địa chỉ OSM: ${addr}`);
  return bits.join('. ').slice(0, 400);
}

function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function ringAreaM2(pts) {
  if (!pts || pts.length < 4) return 0;
  const lat0 = pts[0].lat;
  const lon0 = pts[0].lon;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const ky = 110540;
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].lon - lon0) * kx * (pts[i].lat - lat0) * ky - (pts[i].lon - lon0) * kx * (pts[j].lat - lat0) * ky;
  }
  return Math.abs(a / 2);
}

function isClosed(g) {
  return Array.isArray(g) && g.length >= 4
    && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
}

function areaOfElement(el) {
  if (el.type === 'way') return isClosed(el.geometry) ? ringAreaM2(el.geometry) : 0;
  if (el.type !== 'relation') return 0;
  return Math.max(0, (el.members || []).reduce((s, m) => {
    if (m.type !== 'way' || !isClosed(m.geometry)) return s;
    return s + (m.role === 'inner' ? -1 : 1) * ringAreaM2(m.geometry);
  }, 0));
}

function centerOfElement(el) {
  if (el.type === 'node') {
    const lat = Number(el.lat);
    const lng = Number(el.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const g = el.type === 'way' && Array.isArray(el.geometry) ? el.geometry.filter(p => p && Number.isFinite(p.lat)) : [];
  if (g.length) {
    const pts = isClosed(g) ? g.slice(0, -1) : g;
    return {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lon, 0) / pts.length
    };
  }
  if (el.type === 'relation') {
    const pts = [];
    (el.members || []).forEach(m => {
      if (m.role === 'inner' || !Array.isArray(m.geometry)) return;
      m.geometry.forEach(p => { if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) pts.push(p); });
    });
    if (pts.length) {
      return {
        lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
        lng: pts.reduce((s, p) => s + p.lon, 0) / pts.length
      };
    }
  }
  const b = el.bounds;
  return b ? { lat: (b.minlat + b.maxlat) / 2, lng: (b.minlon + b.maxlon) / 2 } : null;
}

/** Phần tử Overpass leisure → dòng 8-VH, hoặc null */
function itemFromElement(el) {
  const tags = el && el.tags || {};
  const kind = tags.leisure;
  if (!LEISURE_KINDS.has(kind) || deadLeisure(tags) || tags.historic) return null;
  const pt = centerOfElement(el);
  if (!pt) return null;
  const ref = `OSM:${el.type}/${el.id}`;
  if (!OSM_REF_RE.test(ref)) return null;
  const area = areaOfElement(el);
  return {
    type: '8-VH',
    kind,
    name: sportTitle(tags, kind),
    nhom: sportNhom(kind),
    lat: Number(pt.lat.toFixed(6)),
    lng: Number(pt.lng.toFixed(6)),
    size: area > 1 ? Math.round(area) : 0,
    ref,
    note: sportNote(tags, kind, ref),
    approved: true
  };
}

function osmRefOf(note) {
  const m = String(note || '').match(OSM_REF_RE);
  return m ? m[0] : '';
}

/**
 * candidates so với existing (dòng 8-VH đã có: { name, lat, lng, note }) và với nhau.
 * Trùng khi cùng mã OSM, hoặc cùng tên và cách nhau < DUP_M.
 * Tên chung sát một công trình đã có tên riêng (< GENERIC_M) cũng bị bỏ.
 */
function dedupeSports(candidates, existing) {
  const kept = [];
  const skipped = [];
  const refs = new Set();
  (existing || []).forEach(it => {
    const ref = osmRefOf(it.note);
    if (ref) refs.add(ref);
  });
  const pool = (existing || []).filter(it => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)))
    .map(it => ({ name: it.name, lat: Number(it.lat), lng: Number(it.lng) }));
  const ordered = [...(candidates || [])].sort((a, b) =>
    Number(isGenericSportName(a.name)) - Number(isGenericSportName(b.name))
    || String(a.ref).localeCompare(String(b.ref)));
  ordered.forEach(c => {
    if (!c || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lng))) {
      skipped.push({ item: c, reason: 'coord' });
      return;
    }
    if (c.ref && refs.has(c.ref)) {
      skipped.push({ item: c, reason: 'osm-id' });
      return;
    }
    const folded = foldName(c.name);
    const namedDup = pool.some(it => foldName(it.name) === folded
      && distMeters(c.lat, c.lng, it.lat, it.lng) < DUP_M);
    if (namedDup) {
      skipped.push({ item: c, reason: 'name-distance' });
      return;
    }
    if (isGenericSportName(c.name)) {
      const nearNamed = pool.some(it => !isGenericSportName(it.name)
        && distMeters(c.lat, c.lng, it.lat, it.lng) < GENERIC_M);
      if (nearNamed) {
        skipped.push({ item: c, reason: 'generic-near' });
        return;
      }
    }
    if (c.ref) refs.add(c.ref);
    kept.push(c);
    pool.push({ name: c.name, lat: Number(c.lat), lng: Number(c.lng) });
  });
  return { kept, skipped };
}

module.exports = {
  LEISURE_VI,
  LEISURE_KINDS,
  URBAN_KINDS,
  DUP_M,
  GENERIC_M,
  OSM_REF_RE,
  foldName,
  looksLikeSport,
  isGenericSportName,
  sportTitle,
  sportNhom,
  sportNote,
  itemFromElement,
  dedupeSports,
  distMeters,
  areaOfElement,
  centerOfElement
};
