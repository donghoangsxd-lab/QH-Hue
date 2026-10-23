// Đối chiếu lớp sử dụng đất đã công bố. Commit trong repo (build-chuyen-nganh) và
// bản quản trị ghi qua form nhập đều là bản công bố. Cán bộ không ghi các file này.
// Chỉ mục tĩnh: public/data/su-dung-dat-index.json. Không đọc GCS ở đây.
const fs = require('fs');
const path = require('path');

function norm(value) {
  return String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function schemeHasLand(index, ids, role) {
  const want = norm(role);
  const slug = norm(ids && ids.slug);
  const name = norm(ids && ids.tenQH);
  const schemes = new Set();
  if (slug) schemes.add(slug);
  ((index && index.aliases) || []).forEach(alias => {
    const aliasSlug = norm(alias.slug);
    const aliasScheme = norm(alias.scheme);
    if (slug && (aliasSlug === slug || aliasScheme === slug)) {
      if (aliasScheme) schemes.add(aliasScheme);
      if (aliasSlug) schemes.add(aliasSlug);
    }
  });
  return ((index && index.layers) || []).some(layer => {
    if (norm(layer.role) !== want) return false;
    const scheme = norm(layer.scheme);
    const layerName = norm(layer.name);
    if (scheme && schemes.has(scheme)) return true;
    if (name && (layerName === name || scheme === name)) return true;
    return false;
  });
}

function loadLandIndex() {
  const file = path.join(__dirname, '..', 'public', 'data', 'su-dung-dat-index.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function polygonFeatures(features) {
  return (Array.isArray(features) ? features : []).filter(feature => {
    const geometry = feature && feature.geometry;
    return geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon');
  });
}

function landsFromFeatures(features, phase) {
  const want = phase === 'QH' ? 'QH' : 'HT';
  return polygonFeatures(features).map(feature => {
    const props = feature.props && typeof feature.props === 'object'
      ? feature.props
      : (feature.properties || {});
    return {
      phase: want,
      geometry: feature.geometry,
      layer: String(props.loai || props.layer || '').slice(0, 80),
      name: String(props.nhan || feature.name || '').slice(0, 120)
    };
  });
}

function boundaryFromFeatures(features) {
  const polys = polygonFeatures(features).map(feature => feature.geometry);
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  const coordinates = [];
  polys.forEach(geometry => {
    if (geometry.type === 'Polygon') coordinates.push(geometry.coordinates);
    else (geometry.coordinates || []).forEach(poly => coordinates.push(poly));
  });
  return coordinates.length ? { type: 'MultiPolygon', coordinates } : null;
}

function dxfCount(doc, phase) {
  const parcels = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
  return parcels.filter(parcel => parcel && parcel.kind === 'DXF' && parcel.geometry
    && (phase === 'QH' ? parcel.phase === 'QH' : parcel.phase !== 'QH')).length;
}

module.exports = {
  norm, schemeHasLand, loadLandIndex, polygonFeatures, landsFromFeatures, boundaryFromFeatures, dxfCount
};
