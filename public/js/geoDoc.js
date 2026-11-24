// Đưa GeoJSON, bản vẽ { features }, hoặc file đồ án { parcels } về FeatureCollection.
export function toFeatureCollection(data) {
  if (!data || typeof data !== 'object') return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) return data;
  if (Array.isArray(data.parcels)) {
    const features = [];
    data.parcels.forEach((p) => {
      if (!p || !p.geometry || !p.geometry.type) return;
      const layer = p.layer || '';
      features.push({
        type: 'Feature',
        geometry: p.geometry,
        properties: {
          id: p.id,
          ten: p.name || layer || p.id,
          layer,
          loaidat: layer,
          chucnangsudungdat: layer,
          phase: p.phase,
          kind: p.kind,
          dientich: p.area,
          nhom: p.nhom || ''
        }
      });
    });
    return { type: 'FeatureCollection', features };
  }
  const rows = Array.isArray(data.features) ? data.features : data.type === 'Feature' ? [data] : [];
  const features = [];
  rows.forEach(row => {
    const geometry = row && row.geometry;
    if (!geometry || !geometry.type) return;
    const props = { ...(row.properties || {}), ...(row.props || {}) };
    if (row.name && !props.ten && !props.tencongtrinh && !props.name) props.ten = row.name;
    features.push({ type: 'Feature', geometry, properties: props });
  });
  return { type: 'FeatureCollection', features };
}
