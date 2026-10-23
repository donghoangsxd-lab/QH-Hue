// Dựng hiện trạng tạm thời toàn thành phố cho Giao thông, Cấp điện, Cấp nước.
//   node scripts/build-hien-trang-tam.mjs
// Mỗi ngành một file public/data/hien-trang-tam/<ngành>.geojson. Thay file đó khi có số liệu chính thức.
import fs from 'node:fs';
import path from 'node:path';
import {
  SECTORS, UNKNOWN_SCALE, POINT_METERS, LINE_METERS, LINE_COVER,
  nhomOf, familyOf, declaredScale, rankOf, repPoint, geomContains, mergeRecords
} from './hien-trang-tam.mjs';

const repo = path.resolve(path.join(import.meta.dirname, '..'));
const outDir = path.join(repo, 'public', 'data', 'hien-trang-tam');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
}

function schemeById(schemes, id) {
  return schemes.find(s => s && (s.slug === id || s.catalogScheme === id)) || null;
}

function loadBoundary(scheme) {
  if (!scheme || !scheme.boundaryFile) return null;
  const file = path.join(repo, scheme.boundaryFile);
  if (!fs.existsSync(file)) return null;
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const features = (fc.features || []).filter(f => f && f.geometry && /Polygon/.test(f.geometry.type));
  return features.length ? features : null;
}

function loadWards() {
  const file = path.join(repo, 'public', 'data', 'ward-boundary.json');
  if (!fs.existsSync(file)) return [];
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (fc.features || []).filter(f => f && f.geometry && f.properties && f.properties.tenXa);
}

function wardAt(wards, point) {
  if (!point) return '';
  const hit = wards.find(w => geomContains(point, w.geometry));
  return hit ? hit.properties.tenXa : '';
}

function yearOf(scheme) {
  const y = scheme && scheme.decisionDate ? Number(String(scheme.decisionDate).slice(0, 4)) : 0;
  return Number.isFinite(y) && y ? y : null;
}

function collect(index, schemes, boundaries) {
  const bySector = Object.fromEntries(SECTORS.map(id => [id, []]));
  const input = Object.fromEntries(SECTORS.map(id => [id, {}]));
  (index.layers || []).forEach(layer => {
    if (!layer || layer.status !== 'hien-trang' || !SECTORS.includes(layer.sector)) return;
    if (!layer.file || /^https?:/i.test(layer.file)) return;
    const scheme = schemeById(schemes, layer.scheme);
    if (!scheme) return;
    const fc = readJson(layer.file);
    const rows = Array.isArray(fc.features) ? fc.features : [];
    input[layer.sector][scheme.slug] = input[layer.sector][scheme.slug] || { in: 0, kept: 0, name: scheme.name };
    rows.forEach(feature => {
      const geometry = feature && feature.geometry;
      const family = familyOf(geometry && geometry.type);
      if (!family) return;
      const point = repPoint(geometry);
      const overrideDrop = boundaries.some(b => b.overrides.includes(scheme.slug) && geomContains(point, b.geometry));
      input[layer.sector][scheme.slug].in += 1;
      const scale = declaredScale(layer.scale, scheme.scale);
      const props = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
      bySector[layer.sector].push({
        schemeId: scheme.slug,
        rank: rankOf(scheme, layer.scale),
        family,
        nhom: nhomOf(layer.name),
        geometry,
        overrideDrop,
        properties: {
          ...props,
          nhom: nhomOf(layer.name),
          nguon_do_an: scheme.slug,
          nguon_ten: scheme.name,
          nguon_mapid: scheme.mapid == null ? null : scheme.mapid,
          nguon_nam: yearOf(scheme),
          nguon_ty_le: scale,
          nguon_lop: layer.name,
          tam_thoi: true
        }
      });
    });
  });
  return { bySector, input };
}

function emptySchemes(schemes, input) {
  return schemes.filter(s => s && !s.skipLayers && !input[s.slug]).map(s => ({
    slug: s.slug, name: s.name, mapid: s.mapid == null ? null : s.mapid
  }));
}

function main() {
  const schemesDoc = readJson('public/data/chuyen-nganh/schemes.json');
  const schemes = schemesDoc.schemes || [];
  const index = readJson('public/data/chuyen-nganh/index.json');
  const wards = loadWards();
  const boundaries = [];
  schemes.forEach(scheme => {
    const parts = loadBoundary(scheme);
    (parts || []).forEach(feature => {
      boundaries.push({ overrides: scheme.overrides || [], geometry: feature.geometry, slug: scheme.slug });
    });
  });
  const { bySector, input } = collect(index, schemes, boundaries);
  fs.mkdirSync(outDir, { recursive: true });
  const coverage = {
    tam_thoi: true,
    rule: [
      'Giữ đối tượng của đồ án chi tiết hơn (mẫu số tỷ lệ nhỏ hơn).',
      `Đồ án không ghi tỷ lệ xếp như 1/${UNKNOWN_SCALE.toLocaleString('vi-VN')}.`,
      'Cùng tỷ lệ thì năm phê duyệt mới hơn, rồi priority trong schemes.json, rồi slug.',
      `Trùng điểm: trong ${POINT_METERS} m, cùng nhóm.`,
      `Trùng đường: ít nhất ${Math.round(LINE_COVER * 100)}% điểm mẫu nằm trong ${LINE_METERS} m của đường đã giữ, cùng nhóm (đường bộ, đường sắt, đường thủy, mặt cắt, năng lượng không xóa lẫn nhau).`,
      'Cùng một đồ án không tự loại.',
      'Trong ranh KCN, bỏ đối tượng của đồ án bị ghi đè (Phong Điền), kể cả khi không trùng hình.'
    ],
    replace: 'Thay public/data/hien-trang-tam/<ngành>.geojson. Lớp giao diện trỏ đúng đường dẫn đó.',
    sectors: {}
  };
  SECTORS.forEach(sector => {
    const merged = mergeRecords(bySector[sector]);
    merged.kept.forEach(row => {
      if (input[sector][row.schemeId]) input[sector][row.schemeId].kept += 1;
    });
    const wardCount = {};
    let outside = 0;
    merged.kept.forEach(row => {
      const name = wardAt(wards, repPoint(row.geometry));
      if (!name) outside += 1;
      else wardCount[name] = (wardCount[name] || 0) + 1;
    });
    const wardNames = wards.map(w => w.properties.tenXa);
    const emptyWards = wardNames.filter(name => !wardCount[name]);
    const fc = {
      type: 'FeatureCollection',
      name: sector,
      tam_thoi: true,
      features: merged.kept.map(row => ({ type: 'Feature', properties: row.properties, geometry: row.geometry }))
    };
    const file = path.join(outDir, `${sector}.geojson`);
    fs.writeFileSync(file, JSON.stringify(fc));
    const bytes = fs.statSync(file).size;
    coverage.sectors[sector] = {
      file: `data/hien-trang-tam/${sector}.geojson`,
      bytes,
      kept: merged.kept.length,
      lines: merged.kept.filter(r => r.family === 'line').length,
      points: merged.kept.filter(r => r.family === 'point').length,
      polygons: merged.kept.filter(r => r.family === 'polygon').length,
      droppedDuplicate: merged.droppedDuplicate,
      droppedOverride: merged.droppedOverride,
      byScheme: input[sector],
      noHienTrang: emptySchemes(schemes, input[sector]),
      wardsWithData: Object.keys(wardCount).length,
      wardsEmpty: emptyWards,
      outsideWard: outside
    };
  });
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  const brief = {};
  SECTORS.forEach(id => {
    const row = coverage.sectors[id];
    brief[id] = {
      kept: row.kept,
      lines: row.lines,
      points: row.points,
      droppedDuplicate: row.droppedDuplicate,
      droppedOverride: row.droppedOverride,
      bytes: row.bytes,
      schemes: Object.fromEntries(Object.entries(row.byScheme).map(([k, v]) => [k, `${v.kept}/${v.in}`])),
      noHienTrang: row.noHienTrang.map(s => s.name),
      emptyWards: row.wardsEmpty.length
    };
  });
  console.log(JSON.stringify(brief, null, 2));
}

main();
