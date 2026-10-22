// Dấu chân Microsoft chưa có trong GBA: trên 1000 m², giao dưới 25% diện tích tấm.
// Không có chiều cao nên không vào nhóm tầng và không ghi số.
export const MISSING_FILL = '#94a3b8';
export const MISSING_STROKE = '#0f172a';
export const MISSING_MIN_M2 = 1000;
export const MISSING_OVERLAP_MAX = 0.25;

export function tileOf(lng, lat, z = 16) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  return { z, x, y };
}

export function projectLngLat(lng, lat, tile, extent = 4096) {
  const n = 2 ** tile.z;
  const gx = ((lng + 180) / 360) * n;
  const rad = lat * Math.PI / 180;
  const gy = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
  return [(gx - tile.x) * extent, (gy - tile.y) * extent];
}

export function acceptMissingFeature(feature, enabled = true) {
  if (!enabled) return false;
  const props = (feature && feature.properties) || {};
  const geom = feature && feature.geometry;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return false;
  if (props.labelFloors != null || props.floors != null || props.parts != null || props.h != null) return false;
  if (!(Number(props.areaM2) > MISSING_MIN_M2)) return false;
  if (!(Number(props.overlap) < MISSING_OVERLAP_MAX)) return false;
  return true;
}

function polysOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function latFromNorm(t) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * (180 / Math.PI);
}

/** Giữ vòng kinh vĩ. Ô z13–16 và ô cha z16 khi phóng sâu hơn đều chiếu lúc vẽ. */
export function prepareMissingFootprints(fc) {
  const enabled = !fc || fc.enabled !== false;
  const out = [];
  for (const feature of (fc && fc.features) || []) {
    if (!acceptMissingFeature(feature, enabled)) continue;
    for (const poly of polysOf(feature.geometry)) {
      if (!poly || !poly[0] || poly[0].length < 4) continue;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const ring of poly) {
        for (const p of ring) {
          if (p[0] < west) west = p[0];
          if (p[0] > east) east = p[0];
          if (p[1] < south) south = p[1];
          if (p[1] > north) north = p[1];
        }
      }
      out.push({ rings: poly, west, south, east, north });
    }
  }
  return out;
}

export function missingPaintForTile(list, tile, extent = 4096) {
  if (!list || !list.length) return [];
  const n = 2 ** tile.z;
  const west = (tile.x / n) * 360 - 180;
  const east = ((tile.x + 1) / n) * 360 - 180;
  const north = latFromNorm(tile.y / n);
  const south = latFromNorm((tile.y + 1) / n);
  const out = [];
  for (const ft of list) {
    if (ft.east < west || ft.west > east || ft.north < south || ft.south > north) continue;
    out.push({
      rings: ft.rings.map((ring) => ring.map((p) => projectLngLat(p[0], p[1], tile, extent))),
      extent,
      unknown: true,
      floors: null,
      label: null
    });
  }
  return out;
}
