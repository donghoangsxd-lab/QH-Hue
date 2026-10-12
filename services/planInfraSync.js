// Đối chiếu lô hạ tầng trong đồ án quy hoạch (su-dung-dat.json) với dòng Sheet.
// Chỉ đề xuất ghi cột QuyMo_QH: dòng đã đúng diện tích thì bỏ qua, để chạy lại không đè tên / ghi chú.

const CODE_META = {
  CV: { type: '1-CV', nhom: 'Cấp đơn vị ở' },
  CV_DT: { type: '1-CV', nhom: 'Cấp đô thị' },
  BDX: { type: '2-BDX', nhom: 'Cấp đơn vị ở' },
  BDX_DT: { type: '2-BDX', nhom: 'Cấp đô thị' },
  MN: { type: '3-MN', nhom: 'Cấp đơn vị ở' },
  TH: { type: '4-TH', nhom: 'Cấp đơn vị ở' },
  THCS: { type: '5-THCS', nhom: 'Cấp đơn vị ở' },
  THPT: { type: '4-TH', nhom: 'Cấp đô thị' },
  YT: { type: '7-YT', nhom: 'Cấp đơn vị ở' },
  YT_DT: { type: '7-YT', nhom: 'Cấp đô thị' },
  VH: { type: '8-VH', nhom: 'Cấp đơn vị ở' },
  VH_DT: { type: '8-VH', nhom: 'Cấp đô thị' },
  TM: { type: '9-TM', nhom: 'Cấp đơn vị ở' },
  TM_DT: { type: '9-TM', nhom: 'Cấp đô thị' },
  NT: { type: '11-NT', nhom: 'Cấp đơn vị ở' }
};

const isFragment = (id) => /\.\d+$/.test(String(id || ''));

function roundArea(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function sameSize(current, area) {
  if (current === null || current === undefined || current === '') return false;
  const n = Number(current);
  return Number.isFinite(n) && Math.abs(n - area) < 0.05;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  return [];
}

function inRing(pt, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(geometry, lng, lat) {
  const pt = [Number(lng), Number(lat)];
  if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;
  return polygonsOf(geometry).some(poly => {
    if (!inRing(pt, poly[0])) return false;
    return !poly.slice(1).some(hole => inRing(pt, hole));
  });
}

function centroid(geometry) {
  const polys = polygonsOf(geometry);
  const ring = polys.map(p => p[0]).filter(r => r && r.length >= 3)
    .sort((a, b) => b.length - a.length)[0];
  if (!ring) return null;
  let sx = 0, sy = 0, n = 0;
  ring.forEach(p => {
    if (!Array.isArray(p) || p.length < 2) return;
    sx += Number(p[0]);
    sy += Number(p[1]);
    n += 1;
  });
  if (!n) return null;
  return { lng: Math.round((sx / n) * 1e6) / 1e6, lat: Math.round((sy / n) * 1e6) / 1e6 };
}

function sheetCode(row) {
  const prefix = String(row.id || '').split('-')[0].toUpperCase();
  if (prefix === 'THPT' || row.tab === '6-THPT') return 'THPT';
  return prefix;
}

// Cùng tab loại (CV và CV_DT chung 1-CV); THPT chung mã 4-TH nhưng không khớp với Tiểu học
function sameKind(meta, row) {
  const rowMeta = CODE_META[sheetCode(row)];
  if (!rowMeta || rowMeta.type !== meta.type) return false;
  return (meta.code === 'THPT') === (sheetCode(row) === 'THPT');
}

/**
 * classify(layer, name, kind) → { code, type, nhom } | null
 * sheet: [{ id, name, ward, tab, sizeQH, lat, lng }]
 * → mỗi lô quy hoạch thuộc mã được chọn: same | update | create | conflict | skip
 */
function diffPlanInfra(parcels, sheet, { codes, classify }) {
  const want = codes instanceof Set ? codes : new Set(codes || []);
  const all = (sheet || []).filter(r => r && want.has(sheetCode(r)));
  const rows = all.filter(r => !isFragment(r.id));
  const byId = new Map(all.map(r => [String(r.id), r]));
  const out = [];
  (parcels || []).forEach(p => {
    if (!p || !p.geometry || p.phase !== 'QH') return;
    const meta = classify(p.layer || '', p.name || '', p.kind === 'DXF' ? 'DXF' : 'INFRA');
    if (!meta || !want.has(meta.code)) return;
    const area = roundArea(p.area);
    const center = centroid(p.geometry);
    const base = {
      parcelId: String(p.id || ''),
      kind: p.kind === 'DXF' ? 'DXF' : 'INFRA',
      code: meta.code,
      type: meta.type,
      nhom: meta.nhom,
      layer: p.layer || '',
      name: p.name || '',
      ward: p.ward || '',
      area,
      lat: center && center.lat,
      lng: center && center.lng,
      geometry: p.geometry
    };
    if (!(area > 0)) {
      out.push({ ...base, action: 'skip', reason: 'không có diện tích' });
      return;
    }
    const byIdRow = base.kind === 'INFRA' && base.parcelId ? byId.get(base.parcelId) : null;
    const idHit = byIdRow && sameKind(meta, byIdRow) ? byIdRow : null;
    const inside = rows.filter(r => sameKind(meta, r) && contains(p.geometry, r.lng, r.lat));
    let sheetRow = idHit;
    let how = idHit ? 'id' : '';
    if (!sheetRow) {
      if (inside.length > 1) {
        out.push({ ...base, action: 'conflict', reason: `nhiều công trình trong lô: ${inside.map(r => r.id).join(', ')}` });
        return;
      }
      if (inside.length === 1) { sheetRow = inside[0]; how = 'inside'; }
    }
    if (!sheetRow) {
      if (isFragment(base.parcelId)) {
        out.push({ ...base, action: 'skip', reason: 'mảnh phường không còn dòng trên sheet' });
        return;
      }
      if (!base.ward) {
        out.push({ ...base, action: 'skip', reason: 'lô mới thiếu phường' });
        return;
      }
      out.push({ ...base, action: 'create' });
      return;
    }
    const linked = {
      ...base,
      sheetId: String(sheetRow.id),
      sheetSize: sheetRow.sizeQH,
      ward: base.ward || sheetRow.ward || '',
      name: base.name || sheetRow.name || '',
      how
    };
    out.push(sameSize(sheetRow.sizeQH, area)
      ? { ...linked, action: 'same' }
      : { ...linked, action: 'update' });
  });
  return out;
}

/**
 * Dòng Sheet của đồ án bị nhập nhiều lần: cùng tab loại, cùng tọa độ (6 số lẻ), cùng QuyMo_HT / QuyMo_QH.
 * linkedIds: mã INFRA đang gắn lô trong file đồ án → nhóm giữ các mã này, phần còn lại là dòng thừa.
 * → [{ keep: [id], extra: [id], lat, lng, sizeQH }]
 */
function findDuplicates(sheet, tenQH, linkedIds) {
  const linked = linkedIds instanceof Set ? linkedIds : new Set(linkedIds || []);
  const groups = new Map();
  const name = String(tenQH || '').normalize('NFC');
  (sheet || []).forEach(r => {
    if (!r || String(r.tenQH || '').normalize('NFC') !== name || isFragment(r.id) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
    const meta = CODE_META[sheetCode(r)];
    const kind = meta ? `${meta.type}|${sheetCode(r) === 'THPT'}` : sheetCode(r);
    const key = [kind, r.lng.toFixed(6), r.lat.toFixed(6), r.sizeHT ?? '', r.sizeQH ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const out = [];
  groups.forEach(list => {
    if (list.length < 2) return;
    const ids = list.map(r => String(r.id));
    let keep = ids.filter(id => linked.has(id));
    // Không dòng nào gắn lô: giữ mã nhỏ nhất, không đoán thêm
    if (!keep.length) keep = [ids.slice().sort()[0]];
    out.push({ keep, extra: ids.filter(id => !keep.includes(id)), lat: list[0].lat, lng: list[0].lng, sizeQH: list[0].sizeQH });
  });
  return out;
}

function selftest() {
  const poly = (lng, lat) => ({
    type: 'Polygon',
    coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]]
  });
  const classify = (layer) => (String(layer).includes('THPT') ? { code: 'THPT', type: '4-TH', nhom: 'Cấp đô thị' } : null);
  const sheet = [
    { id: 'THPT-001', ward: 'Thuận Hóa', tab: '6-THPT', sizeQH: 100, lat: 16.4605, lng: 107.585 },
    { id: 'THPT-002', ward: 'Thuận Hóa', tab: '6-THPT', sizeQH: 50, lat: 16.47, lng: 107.60 },
    { id: 'THPT-009', ward: 'Thuận Hóa', tab: '6-THPT', sizeQH: 80, lat: 16.4802, lng: 107.6102 },
    { id: 'TH-019', ward: 'Thuận Hóa', tab: '4-TH', sizeQH: 5070, lat: 16.5003, lng: 107.7003 }
  ];
  const parcels = [
    { id: 'THPT-001', kind: 'INFRA', phase: 'QH', layer: 'HT_DAT_HTXH_TruongTHPT', area: 100, geometry: poly(107.58, 16.46) },
    { id: 'THPT-002', kind: 'INFRA', phase: 'QH', layer: 'HT_DAT_HTXH_TruongTHPT', area: 70, geometry: poly(107.59, 16.46) },
    { id: 'DXF-1', kind: 'DXF', phase: 'QH', layer: 'QHDD_DAT_HTXH_TruongTHPT', area: 90, ward: 'Thuận Hóa', geometry: poly(107.61, 16.48) },
    { id: 'DXF-2', kind: 'DXF', phase: 'QH', layer: 'QHDD_DAT_HTXH_TruongTHPT', area: 40, ward: 'Thuận Hóa', geometry: poly(107.70, 16.50) },
    { id: 'CV-1', kind: 'INFRA', phase: 'QH', layer: 'HT_DAT_HTXH_CayxanhCC', area: 10, geometry: poly(107.58, 16.46) }
  ];
  const got = diffPlanInfra(parcels, sheet, { codes: ['THPT'], classify });
  const act = Object.fromEntries(got.map(r => [r.parcelId, r.action]));
  const expect = { 'THPT-001': 'same', 'THPT-002': 'update', 'DXF-1': 'update', 'DXF-2': 'create' };
  Object.entries(expect).forEach(([id, action]) => {
    if (act[id] !== action) throw new Error(`${id}: muốn ${action}, ra ${act[id]}`);
  });
  if (act['CV-1']) throw new Error('lô không phải THPT không được vào kết quả');
  if (got.find(r => r.parcelId === 'DXF-1').sheetId !== 'THPT-009') throw new Error('không khớp công trình nằm trong lô');
  if (got.find(r => r.parcelId === 'DXF-2').sheetId) throw new Error('lô THPT không được khớp trường Tiểu học nằm trong lô');

  const dupRows = ['CV-1', 'CV-2', 'CV-3'].map(id => ({ id, tab: '1-CV', tenQH: 'A', lat: 16.1, lng: 107.1, sizeHT: null, sizeQH: 5 }))
    .concat([{ id: 'CV-4', tab: '1-CV', tenQH: 'A', lat: 16.1, lng: 107.1, sizeHT: null, sizeQH: 6 }]);
  const dups = findDuplicates(dupRows, 'A', ['CV-3']);
  if (dups.length !== 1 || dups[0].keep.join() !== 'CV-3' || dups[0].extra.join() !== 'CV-1,CV-2') {
    throw new Error('findDuplicates giữ sai dòng gắn lô');
  }
  return got.length;
}

module.exports = { CODE_META, diffPlanInfra, findDuplicates, sheetCode, selftest };
