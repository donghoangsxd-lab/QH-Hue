// Lọc nền thửa theo ranh phường/xã sau sáp nhập. Không dùng mã xã cũ trên thửa.

export const CITY_SCOPE = 'Thành phố Huế';

function walkGeometry(geometry, onPolygon) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') onPolygon(geometry.coordinates);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(onPolygon);
  else if (geometry.type === 'GeometryCollection') (geometry.geometries || []).forEach(g => walkGeometry(g, onPolygon));
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, coordinates) {
  if (!coordinates || !coordinates[0] || !pointInRing(lng, lat, coordinates[0])) return false;
  for (let i = 1; i < coordinates.length; i++) {
    if (pointInRing(lng, lat, coordinates[i])) return false;
  }
  return true;
}

function ringBBox(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  ring.forEach(([lng, lat]) => {
    if (lng < west) west = lng;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lat > north) north = lat;
  });
  return [west, south, east, north];
}

export function clipFromGeometry(geometry) {
  const polys = [];
  const rings = [];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  walkGeometry(geometry, (coordinates) => {
    if (!coordinates || !coordinates[0] || coordinates[0].length < 3) return;
    polys.push(coordinates);
    coordinates.forEach((ring) => {
      const bbox = ringBBox(ring);
      rings.push({ ring, bbox });
      if (bbox[0] < west) west = bbox[0];
      if (bbox[1] < south) south = bbox[1];
      if (bbox[2] > east) east = bbox[2];
      if (bbox[3] > north) north = bbox[3];
    });
  });
  if (!polys.length) return null;
  return { polys, rings, bbox: [west, south, east, north] };
}

export function wardClipFor(selectedWard, wards) {
  if (!selectedWard || selectedWard === CITY_SCOPE) return null;
  const ward = (wards || []).find(w => w && w.name === selectedWard);
  if (!ward || !ward.geometry) return null;
  return clipFromGeometry(ward.geometry);
}

export function pointInClip(lng, lat, clip) {
  if (!clip) return true;
  const b = clip.bbox;
  if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return false;
  return clip.polys.some(coordinates => pointInPolygon(lng, lat, coordinates));
}

export function boundsOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function tileBounds(z, x, y) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const lat = (t) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return [west, lat(y + 1), east, lat(y)];
}

export function lngLatToTileLocal(lng, lat, z, tileX, tileY, extent) {
  const n = 2 ** z;
  const wx = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const wy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [(wx - tileX) * extent, (wy - tileY) * extent];
}

export function tileLocalToLngLat(z, tileX, tileY, extent, px, py) {
  const n = 2 ** z;
  const lng = ((tileX + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}
