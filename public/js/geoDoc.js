// Đưa GeoJSON hoặc bản vẽ đồ án { features: [{ geometry, props, name }] } về FeatureCollection.
export function toFeatureCollection(data) {
  if (!data || typeof data !== 'object') return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) return data;
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
