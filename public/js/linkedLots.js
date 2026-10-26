// Đồ án QHC xã: lô đất đọc GeoJSON sẵn có (data/chuyen-nganh hoặc /gcs/…), không nhân bản sang projects/<slug>/.
// Chỉ polygon chức năng / hiện trạng. Điểm chức năng và chỉ giới không vào lớp lô của đồ án.

const POLY = new Set(['Polygon', 'MultiPolygon']);

function foldKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function prop(props, keys) {
  if (!props || typeof props !== 'object') return '';
  const map = new Map(Object.keys(props).map(k => [foldKey(k), k]));
  for (const key of keys) {
    const hit = map.get(key);
    if (hit == null) continue;
    const text = String(props[hit] ?? '').trim();
    if (text) return text;
  }
  return '';
}

/** FeatureCollection sử dụng đất → lô DXF đúng pha HT hoặc QH. */
export function parcelsFromCollection(doc, phase) {
  const features = doc && doc.type === 'FeatureCollection' ? doc.features
    : doc && doc.type === 'Feature' ? [doc]
      : [];
  const want = phase === 'HT' ? 'HT' : 'QH';
  const parcels = [];
  let n = 0;
  (features || []).forEach(f => {
    const g = f && f.geometry;
    if (!g || !POLY.has(g.type)) return;
    n += 1;
    const layer = prop(f.properties, ['chucnangsudungdat', 'loaidat', 'tendoituong']).slice(0, 120);
    const code = prop(f.properties, ['kyhieulodat', 'solo']).slice(0, 40);
    const area = Number(prop(f.properties, ['dientich']));
    const row = {
      kind: 'DXF',
      id: `DXF-${n < 1000 ? String(n).padStart(3, '0') : String(n)}`,
      phase: want,
      layer,
      name: code || layer,
      area: Number.isFinite(area) && area > 0 ? Math.round(area * 10) / 10 : null,
      geometry: g
    };
    if (code) row.lotCode = code;
    parcels.push(row);
  });
  return parcels;
}

/** File tĩnh trong repo, hoặc URL bucket công khai → đường /gcs/ cùng Worker. */
export function linkedAssetHref(file, version) {
  const raw = String(file || '');
  const m = /^https:\/\/storage\.googleapis\.com\/hue-infra-data-us\/(.+)$/.exec(raw);
  const path = m ? `/gcs/${m[1]}` : raw;
  if (!version) return path;
  return `${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function sameProject(p, row) {
  if (!p || !row) return false;
  if (row.tenQH && p.tenQH === row.tenQH) return true;
  return !!(row.slug && p.slug === row.slug);
}

/**
 * Ghép đồ án liên kết vào danh mục getProjectIndex.
 * Đồ án đã có thư mục projects/ và đã có lô thì giữ nguyên (không đè file bucket).
 */
export function mergeLinkedProjects(projects, linked) {
  const list = Array.isArray(projects) ? projects.slice() : [];
  (linked || []).forEach(row => {
    if (!row || !row.tenQH || !row.linkedLots) return;
    const i = list.findIndex(p => sameProject(p, row));
    if (i < 0) {
      list.push(row);
      return;
    }
    const cur = list[i];
    if (cur.dir && Number(cur.lands) > 0 && !cur.linked) return;
    list[i] = {
      ...cur,
      tenQH: cur.tenQH || row.tenQH,
      slug: row.slug || cur.slug,
      tenDayDu: cur.tenDayDu || row.tenDayDu,
      tenRutGon: cur.tenRutGon || row.tenRutGon,
      wards: Array.isArray(cur.wards) && cur.wards.length ? cur.wards : (row.wards || []),
      boundary: row.boundary || cur.boundary || null,
      boundarySource: row.boundary ? (row.boundarySource || 'gis') : (cur.boundarySource || null),
      bbox: row.bbox || cur.bbox || null,
      lands: Number(row.lands) || Number(cur.lands) || 0,
      infra: Number(cur.infra) || 0,
      linked: true,
      linkedLots: row.linkedLots,
      sheetOnly: false,
      dir: false,
      legacy: false,
      saved: row.saved || cur.saved || 0
    };
  });
  return list;
}
