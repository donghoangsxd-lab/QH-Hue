// Ẩn mộ bị nhận nhầm là nhà: trong thửa NTD 2016, đất nghĩa trang quy hoạch/OSM, hoặc cụm mộ sát thửa.
// Ngưỡng đọc từ file (mặc định 60 m² và 3,5 m). Nhà sát đường phố đã được đục khỏi mặt nạ.
// PMTiles không bị sửa. enabled = false trong cemetery-mask.geojson thì vẽ lại hết.
// Ô 0,02° chỉ để khỏi quét hàng chục nghìn thửa; kết quả giống quét tuần tự.

const CELL = 0.02;

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
  if (!data || data.enabled === false) return { enabled: false, maxAreaM2: 60, maxHeightM: 3.5, parts: [], cells: new Map() };
  const parts = [];
  const cells = new Map();
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
      const src = (feature.properties && feature.properties.src) || '';
      const part = { bbox: [minx, miny, maxx, maxy], outer, holes: poly.slice(1), loose: src === 'slope' };
      parts.push(part);
      const x0 = Math.floor(minx / CELL);
      const x1 = Math.floor(maxx / CELL);
      const y0 = Math.floor(miny / CELL);
      const y1 = Math.floor(maxy / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = x + ':' + y;
          const list = cells.get(key);
          if (list) list.push(part);
          else cells.set(key, [part]);
        }
      }
    }
  }
  return {
    enabled: true,
    maxAreaM2: Number(data.maxAreaM2) > 0 ? Number(data.maxAreaM2) : 60,
    maxHeightM: Number(data.maxHeightM) > 0 ? Number(data.maxHeightM) : 3.5,
    lowHeightM: Number(data.lowHeightM) > 0 ? Number(data.lowHeightM) : 2.5,
    slopeAreaM2: Number(data.slopeAreaM2) > 0 ? Number(data.slopeAreaM2) : 180,
    parts,
    cells
  };
}

function zoneAt(mask, lng, lat) {
  if (!mask || !mask.enabled || !mask.cells) return null;
  const list = mask.cells.get(Math.floor(lng / CELL) + ':' + Math.floor(lat / CELL));
  if (!list) return null;
  let found = null;
  for (const part of list) {
    const box = part.bbox;
    if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue;
    if (!pointInRing(lng, lat, part.outer)) continue;
    if (part.holes.some((hole) => hole && hole.length >= 3 && pointInRing(lng, lat, hole))) continue;
    found = part;
    if (part.loose) return part;
  }
  return found;
}

export function insideGraveMask(mask, lng, lat) {
  return !!zoneAt(mask, lng, lat);
}

/** Chiều cao không có thì giữ. Trên sườn, mộ rất thấp được ẩn tới slopeAreaM2. */
export function isCemeteryGrave(mask, area, height, lng, lat) {
  if (!mask || !mask.enabled) return false;
  const zone = zoneAt(mask, lng, lat);
  if (!zone) return false;
  if (height == null || !(height <= mask.maxHeightM)) return false;
  const cap = zone.loose && height <= mask.lowHeightM ? mask.slopeAreaM2 : mask.maxAreaM2;
  return area < cap;
}
