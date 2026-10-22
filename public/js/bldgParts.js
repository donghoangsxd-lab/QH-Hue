// Chỉ dấu chân đã công bố (properties.draw). Nhà chưa định vị và khối suy luận không có tấm.

export function confirmedPartFeatures(fc) {
  const features = [];
  for (const f of (fc && fc.features) || []) {
    const props = f.properties || {};
    if (!props.draw) continue;
    const parts = Array.isArray(props.parts) ? props.parts : [];
    for (const part of parts) {
      const geometry = part && part.geometry;
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue;
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          role: part.role === 'podium' ? 'podium' : 'tower',
          id: props.id || ''
        }
      });
    }
  }
  features.sort((a, b) => (a.properties.role === 'podium' ? 0 : 1) - (b.properties.role === 'podium' ? 0 : 1));
  return { type: 'FeatureCollection', features };
}
