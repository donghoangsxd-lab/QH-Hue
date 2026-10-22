// Ẩn mộ bị nhận nhầm là nhà: nằm trong đất nghĩa trang, nhỏ và thấp.
// PMTiles không bị sửa. enabled = false trong cemetery-mask.geojson thì vẽ lại hết.

export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0]) inside = !inside;
  }
  return inside;
}

export function prepareGraveMask(data) {
  if (!data || data.enabled === false) return { enabled: false, maxAreaM2: 20, maxHeightM: 2.5, parts: [] };
  const parts = [];
  for (const feature of data.features || []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 3) continue;
      let minx = Infinity;
      let miny = Infinity;
      let maxx = -Infinity;
      let maxy = -Infinity;
      for (const pt of outer) {
        if (pt[0] < minx) minx = pt[0];
        if (pt[1] < miny) miny = pt[1];
        if (pt[0] > maxx) maxx = pt[0];
        if (pt[1] > maxy) maxy = pt[1];
      }
      parts.push({ bbox: [minx, miny, maxx, maxy], outer, holes: poly.slice(1) });
    }
  }
  return {
    enabled: true,
    maxAreaM2: Number(data.maxAreaM2) > 0 ? Number(data.maxAreaM2) : 20,
    maxHeightM: Number(data.maxHeightM) > 0 ? Number(data.maxHeightM) : 2.5,
    parts
  };
}

export function insideGraveMask(mask, lng, lat) {
  if (!mask || !mask.enabled) return false;
  for (const part of mask.parts) {
    const box = part.bbox;
    if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue;
    if (!pointInRing(lng, lat, part.outer)) continue;
    if (part.holes.some((hole) => hole && hole.length >= 3 && pointInRing(lng, lat, hole))) continue;
    return true;
  }
  return false;
}

/** Chiều cao không có thì giữ. Ngưỡng là không quá maxHeightM và diện tích dưới maxAreaM2. */
export function isCemeteryGrave(mask, area, height, lng, lat) {
  if (!mask || !mask.enabled) return false;
  if (!(area < mask.maxAreaM2)) return false;
  if (height == null || !(height <= mask.maxHeightM)) return false;
  return insideGraveMask(mask, lng, lat);
}
