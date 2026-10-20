// Sổ hạ tầng từ thửa đất địa chính 2016 (mã DCH, DKV, DVH, DXH, DYT, DGD, DTT).
// Mỗi dòng xuất ra phải có đủ diện tích (m² và ha), tên phường/xã và tên công trình.
// Tên: OSM trước, rồi thuộc tính tên/chủ trên thửa nếu có, rồi Google Places khi có khóa API, còn lại tên chung cần rà soát.
// Diện tích một cơ sở = tổng diện tích hình học các thửa đã gộp, không phải diện tích phần hợp.
const constants = require('../config/constants');

const TARGET_CODES = ['DCH', 'DKV', 'DVH', 'DXH', 'DYT', 'DGD', 'DTT'];
// Khi một ô loại đất chứa nhiều mã hạ tầng, lấy mã ưu tiên này (y tế và giáo dục trước văn hóa, cây xanh, chợ, xã hội).
const CODE_PRIORITY = ['DYT', 'DGD', 'DTT', 'DVH', 'DKV', 'DCH', 'DXH'];
const TARGET_SET = new Set(TARGET_CODES);
const SCRIPT_ID = 'parcel-infra-1';
const OSM_SCRIPT_IDS = ['osm-vh-1', 'parcel-infra-1'];
const MATCH_M = 30;
const DEDUPE_M = 80;
const NAME_MIN = 8;
const THUA_REF_RE = /THUA:\d+\/[^\s,;|]{1,40}\/[^\s,;|]{1,40}/g;
const SOURCE = 'Thửa đất + OSM';

const COMPAT_TYPES = {
  DGD: ['3-MN', '4-TH', '5-THCS', '6-THPT'],
  DYT: ['7-YT'],
  DVH: ['8-VH'],
  DTT: ['8-VH'],
  DXH: ['8-VH'],
  DKV: ['1-CV'],
  DCH: ['9-TM']
};

const ATTR_KEYS = new Set([
  'TEN', 'TENCHU', 'TENCHUSUDUNG', 'CHUSUDUNG', 'OWNER', 'NAME', 'HOTEN',
  'TENCSD', 'TENDONVI', 'TENCOSO', 'TENCONGTRINH'
]);
const FACILITY_WORD = /trường|bệnh viện|trạm y tế|chợ|công viên|nhà văn hóa|nhà trẻ|mầm non|thư viện|nhà thi đấu|trung tâm y tế|sân vận động|sân thể thao|nhà văn hoá/i;

const GENERIC = {
  '3-MN': 'Trường mầm non chưa xác định tên',
  '4-TH': 'Trường học chưa xác định tên',
  '5-THCS': 'Trường THCS chưa xác định tên',
  '6-THPT': 'Trường THPT chưa xác định tên',
  'dao-tao': 'Cơ sở đào tạo chưa xác định tên',
  DYT: 'Cơ sở y tế chưa xác định tên',
  DTT: 'Công trình thể thao chưa xác định tên',
  DVH: 'Cơ sở văn hóa chưa xác định tên',
  DKV: 'Công viên chưa xác định tên',
  DCH: 'Chợ chưa xác định tên',
  DXH: 'Cơ sở xã hội chưa xác định tên'
};

const CSV_HEADERS = ['ID_DoiTuong', 'Ten_CongTrinh', 'Ten_XaPhuong', 'Nhom_HaTang', 'Latitude', 'Longitude',
  'QuyMo_HT', 'QuyMo_QH', 'Ten_QH', 'TrangThai', 'ThoiGianCapNhat', 'Note', 'Geojson', 'TangCao', 'MatDoXD', 'HeSoSDD', 'KyHieu',
  'DienTich_ha', 'MaDat', 'DoTinCay', 'ThuaIds', 'CanRaSoat'];

const PLACE_TYPES = {
  DGD: ['school', 'primary_school', 'secondary_school', 'university', 'preschool'],
  DYT: ['hospital', 'doctor', 'health', 'pharmacy'],
  DCH: ['shopping_mall'],
  DKV: ['park'],
  DVH: ['library', 'museum', 'art_gallery'],
  DTT: ['stadium', 'gym'],
  DXH: []
};

function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').trim().toUpperCase();
}

function compactKey(s) {
  return foldName(s).replace(/[^A-Z0-9]/g, '');
}

function parseLandCodes(raw) {
  const parts = String(raw || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const found = new Set(parts.filter(p => TARGET_SET.has(p)));
  return CODE_PRIORITY.filter(c => found.has(c));
}

function primaryCode(raw) {
  return parseLandCodes(raw)[0] || '';
}

function displayWard(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^(phường|xã|thị trấn)\s+/i.test(s)) return s;
  return `${constants.wardProfile(s) === 'DT' ? 'Phường' : 'Xã'} ${s}`;
}

function genericName(code, level, ward) {
  const head = code === 'DGD' ? (GENERIC[level] || GENERIC['4-TH']) : GENERIC[code];
  return `${head || 'Công trình chưa xác định tên'} – ${ward}`;
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

function pointInRing(lng, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringsOf(p) {
  if (Array.isArray(p.rings) && p.rings.length && Array.isArray(p.rings[0])) {
    if (typeof p.rings[0][0] === 'number') return [p.rings];
    return p.rings.filter(r => Array.isArray(r) && r.length >= 3);
  }
  if (Array.isArray(p.ring) && p.ring.length >= 3) return [p.ring];
  return [];
}

function pointInParcel(lng, lat, parcel) {
  return ringsOf(parcel).some(ring => pointInRing(lng, lat, ring));
}

function quyMoM2(area) {
  const n = Number(area);
  if (!(n > 0)) return 0;
  if (n < 0.5) return 1;
  return Math.round(n);
}

function dienTichHa(area) {
  const n = Number(area);
  if (!(n > 0)) return '';
  const ha = n / 10000;
  return ha >= 0.0001 ? ha.toFixed(4) : ha.toFixed(6);
}

function chooseArea(p) {
  const geom = Number(p.geomArea) || 0;
  const attr = Number(p.attrArea) || 0;
  // Hình học tile bị cắt (quá nhỏ) hoặc bị đếm chồng (quá lớn) thì lấy diện tích thuộc tính, vẫn không để trống.
  if (geom > 0 && attr > 0 && (geom < 0.5 * attr || geom > 1.5 * attr)) {
    return { areaM2: attr, source: 'attribute-fallback' };
  }
  if (geom > 0) return { areaM2: geom, source: 'geometry' };
  if (attr > 0) return { areaM2: attr, source: 'attribute-fallback' };
  return { areaM2: 0, source: 'none' };
}

function attributeName(parcel) {
  const props = parcel.props || {};
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    if (!ATTR_KEYS.has(compactKey(keys[i]))) continue;
    const v = String(props[keys[i]] || '').replace(/\s+/g, ' ').trim();
    if (v) return v.slice(0, 150);
  }
  const d = String(parcel.diachi || props.d || props.diachi || '').replace(/\s+/g, ' ').trim();
  if (d && FACILITY_WORD.test(d)) return d.slice(0, 150);
  return '';
}

function isDeadOsm(tags) {
  const t = tags || {};
  if (t.disused === 'yes' || t.abandoned === 'yes' || t.demolished === 'yes' || t.razed === 'yes') return true;
  return Object.keys(t).some(k => /^(abandoned|disused|razed|demolished|proposed|construction):/.test(k));
}

function osmCompatible(code, tags) {
  const t = tags || {};
  const a = t.amenity || '';
  const l = t.leisure || '';
  if (code === 'DGD') return ['school', 'kindergarten', 'childcare', 'college', 'university'].includes(a);
  if (code === 'DYT') return ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy'].includes(a);
  if (code === 'DCH') return a === 'marketplace';
  if (code === 'DKV') return ['park', 'playground', 'garden'].includes(l);
  if (code === 'DVH') return ['community_centre', 'arts_centre', 'theatre', 'library'].includes(a);
  if (code === 'DTT') return ['pitch', 'sports_centre', 'stadium', 'track', 'fitness_centre', 'swimming_pool'].includes(l);
  if (code === 'DXH') return a === 'social_facility' || a === 'community_centre';
  return false;
}

function poiFromElement(el) {
  if (!el || !el.tags || isDeadOsm(el.tags)) return null;
  const tags = el.tags;
  if (!TARGET_CODES.some(c => osmCompatible(c, tags))) return null;
  const name = String(tags['name:vi'] || tags.name || tags['name:en'] || '').trim();
  let lat = null;
  let lng = null;
  let ring = null;
  if (el.type === 'node') {
    lat = Number(el.lat);
    lng = Number(el.lon);
  } else if (el.center) {
    lat = Number(el.center.lat);
    lng = Number(el.center.lon);
  }
  const geom = Array.isArray(el.geometry) ? el.geometry : null;
  if (geom && geom.length >= 4) {
    const a = geom[0];
    const b = geom[geom.length - 1];
    if (a && b && a.lat === b.lat && a.lon === b.lon) {
      ring = geom.map(p => [p.lon, p.lat]);
      if (!Number.isFinite(lat)) {
        lat = geom.reduce((s, p) => s + p.lat, 0) / geom.length;
        lng = geom.reduce((s, p) => s + p.lon, 0) / geom.length;
      }
    }
  }
  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && el.type === 'relation') {
    const outers = (el.members || []).filter(m => m && m.role !== 'inner' && Array.isArray(m.geometry) && m.geometry.length);
    const pts = [];
    outers.forEach(m => m.geometry.forEach(p => { if (p) pts.push(p); }));
    if (pts.length) {
      lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      lng = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      const g = outers[0].geometry;
      const a = g[0];
      const b = g[g.length - 1];
      if (a && b && a.lat === b.lat && a.lon === b.lon) ring = g.map(p => [p.lon, p.lat]);
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { ref: `OSM:${el.type}/${el.id}`, name: name.slice(0, 150), lat, lng, tags, ring };
}

function buildPoiIndex(pois) {
  const cell = 0.002;
  const grid = new Map();
  (pois || []).forEach((p, i) => {
    const k = `${Math.floor(p.lng / cell)}:${Math.floor(p.lat / cell)}`;
    const arr = grid.get(k) || [];
    arr.push(i);
    grid.set(k, arr);
  });
  return { pois: pois || [], grid, cell };
}

function betterMatch(score, best) {
  for (let i = 0; i < score.length; i++) {
    if (score[i] !== best[i]) return score[i] < best[i];
  }
  return false;
}

function bestOsmMatch(parcel, index) {
  if (!index || !parcel || !parcel.code) return null;
  const { pois, grid, cell } = index;
  const rings = ringsOf(parcel);
  let minX = parcel.lng, maxX = parcel.lng, minY = parcel.lat, maxY = parcel.lat;
  rings.forEach(ring => ring.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  const pad = 0.0004;
  const cells = [];
  const x0 = Math.floor((minX - pad) / cell);
  const x1 = Math.floor((maxX + pad) / cell);
  const y0 = Math.floor((minY - pad) / cell);
  const y1 = Math.floor((maxY + pad) / cell);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
    cells.push(`${Math.floor(parcel.lng / cell)}:${Math.floor(parcel.lat / cell)}`);
  } else {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) cells.push(`${x}:${y}`);
    }
  }
  let best = null;
  const seen = new Set();
  cells.forEach(k => {
    (grid.get(k) || []).forEach(i => {
      if (seen.has(i)) return;
      seen.add(i);
      const poi = pois[i];
      if (!osmCompatible(parcel.code, poi.tags)) return;
      const contained = rings.some(ring => pointInRing(poi.lng, poi.lat, ring))
        || (poi.ring && pointInRing(parcel.lng, parcel.lat, poi.ring));
      const dist = distMeters(parcel.lat, parcel.lng, poi.lat, poi.lng);
      if (!contained && dist > MATCH_M) return;
      const score = [
        contained ? 0 : 1,
        poi.name ? 0 : 1,
        poi.tags && poi.tags.amenity === 'pharmacy' ? 1 : 0,
        dist
      ];
      if (!best || betterMatch(score, best.score)) {
        best = { ref: poi.ref, name: poi.name, lat: poi.lat, lng: poi.lng, tags: poi.tags, dist, contained, score };
      }
    });
  });
  return best;
}

function schoolLevel(name, tags) {
  const amenity = tags && tags.amenity;
  const f = foldName(name);
  if (amenity === 'kindergarten' || amenity === 'childcare' || /MAM NON|NHA TRE|MAU GIAO/.test(f)) return '3-MN';
  if (/THCS|TRUNG HOC CO SO|CAP 2\b/.test(f)) return '5-THCS';
  if (/THPT|PHO THONG|CAP 3\b/.test(f)) return '6-THPT';
  if (amenity === 'university' || amenity === 'college' || /DAI HOC|CAO DANG|HOC VIEN/.test(f)) return 'dao-tao';
  if (/TIEU HOC|CAP 1\b/.test(f)) return '4-TH';
  return 'unknown';
}

function isHospital(name, tags) {
  if (tags && tags.amenity === 'hospital') return true;
  const f = foldName(name);
  return /BENH VIEN/.test(f) && !/TRAM/.test(f);
}

function isWholesale(name, tags) {
  if (tags && (tags.marketplace === 'wholesale' || tags.wholesale === 'yes')) return true;
  return /DAU MOI/.test(foldName(name));
}

function tabOf(code, level) {
  if (code === 'DGD') {
    if (level === 'dao-tao') return '6-THPT';
    if (level === '3-MN' || level === '5-THCS' || level === '6-THPT') return level;
    return '4-TH';
  }
  if (code === 'DYT') return '7-YT';
  if (code === 'DVH' || code === 'DTT' || code === 'DXH') return '8-VH';
  if (code === 'DKV') return '1-CV';
  if (code === 'DCH') return '9-TM';
  return '';
}

function nhomOf(code, level, name, tags, area) {
  if (code === 'DGD') return level === '6-THPT' || level === 'dao-tao' ? 'Cấp đô thị' : 'Cấp DVO';
  if (code === 'DYT') return isHospital(name, tags) ? 'Cấp đô thị' : 'Cấp DVO';
  if (code === 'DCH') return isWholesale(name, tags) ? 'Cấp đô thị' : 'Cấp DVO';
  if (code === 'DKV') {
    const tier = constants.parkTier({ size: area, id: '' });
    return tier && tier.urban ? 'Cấp đô thị' : 'Cấp DVO';
  }
  if (code === 'DTT') {
    const leisure = tags && tags.leisure;
    if (leisure === 'stadium' || leisure === 'sports_centre') return 'Cấp đô thị';
    if (/SAN VAN DONG|NHA THI DAU|TRUNG TAM THE THAO/.test(foldName(name))) return 'Cấp đô thị';
    return 'Cấp DVO';
  }
  if (/NHA HAT|BAO TANG|THU VIEN TINH|TRUNG TAM VAN HOA/.test(foldName(name))) return 'Cấp đô thị';
  return 'Cấp DVO';
}

function specificIdentity(p) {
  if (p.osm && p.osm.ref && p.osm.name) return { kind: 'osm', id: p.osm.ref, name: foldName(p.osm.name) };
  if (p.osm && p.osm.ref && !p.attrName) return { kind: 'osm', id: p.osm.ref, name: '' };
  if (p.attrName) return { kind: 'attr', id: '', name: foldName(p.attrName) };
  if (p.osm && p.osm.ref) return { kind: 'osm', id: p.osm.ref, name: '' };
  return null;
}

function canMerge(a, b) {
  if (!a || !b || a.code !== b.code) return false;
  const na = specificIdentity(a);
  const nb = specificIdentity(b);
  if (na && nb) {
    if (na.kind === 'osm' && nb.kind === 'osm') return na.id && na.id === nb.id;
    if (na.name && nb.name) return na.name === nb.name;
    return false;
  }
  if (!na && !nb) return true;
  const named = na ? a : b;
  const other = na ? b : a;
  if (named.osm && Number.isFinite(named.osm.lat)) {
    return distMeters(other.lat, other.lng, named.osm.lat, named.osm.lng) <= MATCH_M;
  }
  return false;
}

function mergeParcels(parcels) {
  const n = parcels.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  const cell = 0.00011;
  const buckets = new Map();
  parcels.forEach((p, i) => {
    const keys = new Set();
    ringsOf(p).forEach(ring => ring.forEach(([lng, lat]) => {
      keys.add(`${Math.round(lng / cell)}:${Math.round(lat / cell)}`);
    }));
    keys.forEach(k => {
      const [gx, gy] = k.split(':').map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(`${p.code}|${gx + dx}:${gy + dy}`);
          if (!arr) continue;
          arr.forEach(j => {
            if (find(j) !== find(i) && canMerge(parcels[j], p)) union(j, i);
          });
        }
      }
    });
    keys.forEach(k => {
      const key = `${p.code}|${k}`;
      const arr = buckets.get(key) || [];
      arr.push(i);
      buckets.set(key, arr);
    });
  });
  const groups = new Map();
  parcels.forEach((p, i) => {
    const id = find(i);
    const arr = groups.get(id) || [];
    arr.push(p);
    groups.set(id, arr);
  });
  return [...groups.values()];
}

function thuaRef(maxa, to, thua) {
  const clean = (v) => String(v == null ? '' : v).replace(/[^\w.-]/g, '').slice(0, 40) || '0';
  return `THUA:${clean(maxa)}/${clean(to)}/${clean(thua)}`;
}

function namesMatch(a, b) {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const short = fa.length <= fb.length ? fa : fb;
  const long = fa.length <= fb.length ? fb : fa;
  return short.length >= NAME_MIN && long.includes(short);
}

function isGenericName(name) {
  return foldName(name).includes('CHUA XAC DINH TEN');
}

function compatibleType(code, type) {
  return (COMPAT_TYPES[code] || []).includes(type);
}

function rowArea(r) {
  const exact = Number(r && r.areaM2);
  if (exact > 0) return exact;
  const size = Number(r && r.size);
  return size > 0 ? size : 0;
}

function hasHa(r) {
  if (!r) return false;
  if (r.areaHa == null || r.areaHa === '') return false;
  return Number(r.areaHa) > 0;
}

function missingCounts(rows) {
  let area = 0;
  let ward = 0;
  let name = 0;
  (rows || []).forEach(r => {
    if (!(rowArea(r) > 0) || !hasHa(r)) area++;
    if (!String(r.ward || '').trim()) ward++;
    if (!String(r.name || '').trim()) name++;
  });
  return { area, ward, name, rows: (rows || []).length };
}

function validateRows(rows) {
  const counts = missingCounts(rows);
  if (counts.area || counts.ward || counts.name) {
    const err = new Error(`Kiểm tra thất bại: ${counts.area} dòng thiếu diện tích, ${counts.ward} dòng thiếu phường/xã, ${counts.name} dòng thiếu tên (trên ${counts.rows} dòng).`);
    err.counts = counts;
    throw err;
  }
  return { ok: true, rows: counts.rows, missingArea: 0, missingWard: 0, missingName: 0 };
}

function pickPlacesName(results, code) {
  const allow = new Set(PLACE_TYPES[code] || []);
  if (!allow.size) return '';
  for (const r of results || []) {
    const name = String(r && r.name || '').replace(/\s+/g, ' ').trim();
    const types = Array.isArray(r && r.types) ? r.types : [];
    if (name && types.some(t => allow.has(t))) return name.slice(0, 150);
  }
  return '';
}

function prepareParcel(raw) {
  const code = raw.code || primaryCode(raw.codeRaw);
  if (!code) return { drop: 'noCode' };
  if (!Number.isFinite(Number(raw.lat)) || !Number.isFinite(Number(raw.lng))) return { drop: 'outside' };
  const ward = displayWard(raw.ward);
  if (!ward) return { drop: 'outside' };
  const area = chooseArea(raw);
  if (!(area.areaM2 > 0)) return { drop: 'noArea' };
  const attrName = attributeName(raw);
  const osm = raw.osm && raw.osm.ref ? raw.osm : null;
  const placesName = String(raw.placesName || '').trim();
  return {
    drop: '',
    parcel: {
      ...raw,
      code,
      ward,
      areaM2: area.areaM2,
      areaSource: area.source,
      attrName,
      osm,
      placesName,
      lat: Number(raw.lat),
      lng: Number(raw.lng)
    }
  };
}

function nameOfMember(p) {
  if (p.osm && p.osm.name) return { name: p.osm.name, confidence: 'ten-osm' };
  if (p.attrName) return { name: p.attrName, confidence: 'ten-thuoc-tinh' };
  if (p.placesName) return { name: p.placesName, confidence: 'ten-google' };
  return { name: '', confidence: 'chua-ten' };
}

function facilityFromGroup(members) {
  const areaM2 = members.reduce((s, p) => s + p.areaM2, 0);
  const biggest = members.reduce((a, b) => (b.areaM2 > a.areaM2 ? b : a));
  const lat = members.reduce((s, p) => s + p.lat * p.areaM2, 0) / areaM2;
  const lng = members.reduce((s, p) => s + p.lng * p.areaM2, 0) / areaM2;
  const named = members.map(nameOfMember).find(n => n.name) || { name: '', confidence: 'chua-ten' };
  const osm = members.find(p => p.osm && p.osm.ref);
  const tags = (osm && osm.osm.tags) || null;
  const level = biggest.code === 'DGD' ? schoolLevel(named.name, tags) : '';
  const ward = biggest.ward;
  const name = named.name || genericName(biggest.code, level, ward);
  const confidence = named.name ? named.confidence : 'chua-ten';
  const training = biggest.code === 'DGD' && level === 'dao-tao';
  const capChuaXacDinh = biggest.code === 'DGD' && level === 'unknown';
  const review = confidence === 'chua-ten' || capChuaXacDinh || training;
  const approved = confidence !== 'chua-ten' && !capChuaXacDinh && !training;
  const type = tabOf(biggest.code, level);
  const refs = [];
  members.slice().sort((a, b) => b.areaM2 - a.areaM2).forEach(p => {
    const ref = thuaRef(p.maxa, p.to, p.thua);
    if (!refs.includes(ref)) refs.push(ref);
  });
  const ref = refs[0];
  const ids = refs.join(' | ').slice(0, 500);
  const ha = dienTichHa(areaM2);
  const osmBit = osm
    ? (osm.osm.name ? osm.osm.ref : `chưa có tên (${osm.osm.ref})`)
    : 'không';
  const bits = [
    `Nguồn: ${SOURCE}`,
    `Khớp OSM: ${osmBit}`,
    `Mã đất: ${biggest.codeRaw || biggest.code}`,
    `Độ tin cậy: ${confidence}`,
    `Thửa: ${ref}${refs.length > 1 ? ` (gộp ${refs.length} thửa)` : ''}`,
    `Diện tích: ${areaM2.toFixed(1)} m² (${ha} ha)`
  ];
  if (members.some(p => p.areaSource === 'attribute-fallback')) bits.push('Diện tích lấy theo thuộc tính thửa vì hình học bị cắt hoặc lệch');
  if (capChuaXacDinh) bits.push('Cấp trường chưa xác định, chờ rà soát');
  if (confidence === 'chua-ten') bits.push('Cần rà soát tên');
  if (biggest.code === 'DXH') bits.push('Mã DXH ghi tab 8-VH vì không có tab cơ sở xã hội riêng');
  const wards = [...new Set(members.map(p => p.ward))];
  if (wards.length > 1) bits.push(`Thửa trải hơn một phường/xã: ${wards.join(', ')}`);
  const rings = [];
  members.forEach(p => ringsOf(p).forEach(r => rings.push(r)));
  return {
    type,
    name: name.slice(0, 150),
    ward,
    nhom: nhomOf(biggest.code, level, name, tags, areaM2),
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    size: quyMoM2(areaM2),
    areaM2,
    areaHa: ha,
    ref,
    thuaIds: ids,
    note: bits.join('. ').slice(0, 500),
    approved,
    keepWard: true,
    confidence,
    code: biggest.code,
    codeRaw: String(biggest.codeRaw || biggest.code),
    review,
    training,
    capChuaXacDinh,
    level: level || '',
    memberCount: refs.length,
    areaSource: members.some(p => p.areaSource === 'attribute-fallback') ? 'attribute-fallback' : 'geometry',
    rings
  };
}

function dedupeFacilities(facilities, existing) {
  const kept = [];
  let duplicates = 0;
  const pool = (existing || [])
    .filter(it => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)))
    .map(it => ({
      name: it.name || '',
      lat: Number(it.lat),
      lng: Number(it.lng),
      type: it.type || '',
      note: String(it.note || '')
    }));
  const refs = new Set();
  pool.forEach(it => {
    const found = it.note.match(THUA_REF_RE);
    if (found) found.forEach(r => refs.add(r));
  });
  const ordered = facilities.slice().sort((a, b) => b.areaM2 - a.areaM2);
  ordered.forEach(f => {
    if (refs.has(f.ref)) { duplicates++; return; }
    const inside = f.rings && f.rings.length && pool.some(it =>
      compatibleType(f.code, it.type) && f.rings.some(ring => pointInRing(it.lng, it.lat, ring)));
    if (inside) { duplicates++; return; }
    if (!isGenericName(f.name)) {
      const namedNear = pool.some(it => compatibleType(f.code, it.type)
        && !isGenericName(it.name)
        && namesMatch(f.name, it.name)
        && distMeters(f.lat, f.lng, it.lat, it.lng) < DEDUPE_M);
      if (namedNear) { duplicates++; return; }
    }
    kept.push(f);
    refs.add(f.ref);
    pool.push({ name: f.name, lat: f.lat, lng: f.lng, type: f.type, note: f.ref });
  });
  return { kept, duplicates };
}

function tally(rows, extra) {
  const byCode = {};
  const byWard = {};
  const byTab = {};
  let matchedOsm = 0;
  let matchedAttribute = 0;
  let matchedGoogle = 0;
  let unnamed = 0;
  let capChuaXacDinh = 0;
  let daoTao = 0;
  let geometryFallback = 0;
  rows.forEach(r => {
    byCode[r.code] = (byCode[r.code] || 0) + 1;
    byWard[r.ward] = (byWard[r.ward] || 0) + 1;
    const tab = r.training ? 'DGD-dao-tao' : r.type;
    byTab[tab] = (byTab[tab] || 0) + 1;
    if (r.confidence === 'ten-osm') matchedOsm++;
    else if (r.confidence === 'ten-thuoc-tinh') matchedAttribute++;
    else if (r.confidence === 'ten-google') matchedGoogle++;
    else unnamed++;
    if (r.capChuaXacDinh) capChuaXacDinh++;
    if (r.training) daoTao++;
    if (r.areaSource === 'attribute-fallback') geometryFallback++;
  });
  return {
    facilities: rows.length,
    byCode, byWard, byTab,
    matchedOsm, matchedAttribute, matchedGoogle, unnamed,
    capChuaXacDinh, daoTao, geometryFallback,
    ...extra
  };
}

function assembleInventory(rawParcels, opts = {}) {
  const prepared = [];
  const excluded = { noCode: 0, outside: 0, noArea: 0 };
  (rawParcels || []).forEach(raw => {
    const out = prepareParcel(raw);
    if (out.drop) { excluded[out.drop] = (excluded[out.drop] || 0) + 1; return; }
    prepared.push(out.parcel);
  });
  const groups = mergeParcels(prepared);
  const facilities = groups.map(facilityFromGroup);
  const { kept, duplicates } = dedupeFacilities(facilities, opts.existing || []);
  const main = kept.filter(r => !r.training);
  const training = kept.filter(r => r.training);
  const validation = validateRows(kept);
  const stats = tally(kept, {
    parcels: (rawParcels || []).length,
    parcelsKept: prepared.length,
    groups: groups.length,
    duplicatesSkipped: duplicates,
    outsideWard: excluded.outside,
    missingAreaExcluded: excluded.noArea,
    noCode: excluded.noCode,
    validation
  });
  return { rows: main, training, stats };
}

function existingTypeOf(id, tab) {
  const prefix = String(id || '').split('-')[0].toUpperCase().replace(/_DT$|_DV$/, '');
  if (prefix === 'THPT') return '6-THPT';
  if (constants.codeMap[prefix]) return constants.codeMap[prefix];
  const fromTab = String(tab || '').split('-')[0];
  if (constants.codeMap[fromTab]) return constants.codeMap[fromTab];
  return '';
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(item, id, stamp) {
  const cells = [
    id || '',
    item.name,
    item.ward,
    item.nhom,
    item.lat,
    item.lng,
    item.size,
    '',
    '',
    item.approved ? 'TRUE' : 'FALSE',
    stamp || '',
    item.note,
    '', '', '', '',
    '',
    item.areaHa,
    item.codeRaw || item.code,
    item.confidence,
    item.thuaIds || item.ref,
    item.review ? 'Có' : 'Không'
  ];
  return cells.map(csvCell).join(',');
}

function auditOutputRows(rows) {
  let blankName = 0;
  let blankWard = 0;
  let blankArea = 0;
  let blankHa = 0;
  (rows || []).forEach(r => {
    if (!String(r.name || '').trim()) blankName++;
    if (!String(r.ward || '').trim()) blankWard++;
    if (!(Number(r.size) > 0) || !(Number(r.areaM2) > 0)) blankArea++;
    if (!hasHa(r)) blankHa++;
  });
  return { blankName, blankWard, blankArea, blankHa, rows: (rows || []).length };
}

function prepareParcelImport(rawItems, existing, wardOf, opts = {}) {
  const strict = opts.strict !== false;
  const includeTraining = opts.includeTraining === true;
  const source = (rawItems || []).filter(it => includeTraining || !it || it.training !== true);
  const counts = missingCounts(source.map(it => ({
    name: it && it.name,
    ward: it && it.ward,
    areaM2: Number(it && (it.areaM2 || it.size)) || 0,
    size: Number(it && it.size) || 0,
    areaHa: it && (it.areaHa != null && it.areaHa !== '' ? it.areaHa : dienTichHa(it && (it.areaM2 || it.size)))
  })));
  if ((counts.area || counts.ward || counts.name) && strict) {
    const err = new Error(`Lô gửi lên thiếu dữ liệu: ${counts.area} thiếu diện tích, ${counts.ward} thiếu phường/xã, ${counts.name} thiếu tên.`);
    err.counts = counts;
    throw err;
  }
  const byType = {};
  const bump = (type, key) => {
    if (!byType[type]) byType[type] = { received: 0, outside: 0, duplicate: 0, invalid: 0, accepted: 0 };
    byType[type][key]++;
  };
  const accepted = [];
  let invalid = 0;
  source.forEach(raw => {
    const type = String(raw && raw.type || '');
    bump(type || '?', 'received');
    const area = Number(raw && (raw.areaM2 || raw.size)) || 0;
    const ha = raw && raw.areaHa != null && raw.areaHa !== '' ? raw.areaHa : dienTichHa(area);
    const name = String(raw && raw.name || '').trim();
    const wardIn = String(raw && raw.ward || '').trim();
    if (!(area > 0) || !(Number(ha) > 0) || !name || !wardIn) {
      invalid++;
      bump(type || '?', 'invalid');
      return;
    }
    let ward = displayWard(wardIn);
    if (typeof wardOf === 'function') {
      const live = displayWard(wardOf(Number(raw.lat), Number(raw.lng)));
      if (!live) {
        bump(type, 'outside');
        return;
      }
      ward = live;
    }
    accepted.push({
      ...raw,
      type,
      name: name.slice(0, 150),
      ward,
      size: quyMoM2(area),
      areaM2: area,
      areaHa: String(ha),
      keepWard: true,
      rings: []
    });
  });
  const { kept, duplicates } = dedupeFacilities(accepted, existing || []);
  const dupBy = new Map();
  accepted.forEach(it => {
    if (!kept.includes(it)) dupBy.set(it.type, (dupBy.get(it.type) || 0) + 1);
  });
  Object.keys(byType).forEach(type => {
    byType[type].duplicate += dupBy.get(type) || 0;
    byType[type].accepted = kept.filter(it => it.type === type).length;
  });
  const validation = validateRows(kept);
  return {
    accepted: kept.map(it => {
      const copy = { ...it };
      delete copy.rings;
      return copy;
    }),
    stats: { byType, invalid, duplicatesSkipped: duplicates, validation }
  };
}

module.exports = {
  TARGET_CODES,
  CODE_PRIORITY,
  SCRIPT_ID,
  OSM_SCRIPT_IDS,
  SOURCE,
  CSV_HEADERS,
  MATCH_M,
  parseLandCodes,
  primaryCode,
  displayWard,
  genericName,
  chooseArea,
  attributeName,
  osmCompatible,
  poiFromElement,
  buildPoiIndex,
  bestOsmMatch,
  schoolLevel,
  canMerge,
  mergeParcels,
  thuaRef,
  THUA_REF_RE,
  validateRows,
  missingCounts,
  pickPlacesName,
  assembleInventory,
  existingTypeOf,
  csvCell,
  csvRow,
  auditOutputRows,
  prepareParcelImport,
  isGenericName,
  namesMatch,
  pointInRing
};
