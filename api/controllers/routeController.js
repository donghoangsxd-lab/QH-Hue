const axios = require('axios');
const turf = require('@turf/turf');

/**
 * Tính toán Đa giác Vùng phủ Isochrone bám sát tuyến đường (90% + 10%)
 * @param {number} lat - Vĩ độ công trình
 * @param {number} lng - Kinh độ công trình
 * @param {number} banKinh - Bán kính phục vụ R (m) trích xuất từ cột H của Google Sheet
 */
async function calculateNetworkIsochrone(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  const reachDistanceKm = (R * 0.9) / 1000;  // 90% di chuyển mạng lưới giao thông OSRM
  const offsetDistanceKm = (R * 0.1) / 1000; // 10% buffer offset làm mịn đa giác

  // Quét 12 hướng bức xạ giao thông
  const angles = Array.from({ length: 12 }, (_, i) => i * 30);
  const allVertices = [];

  const routePromises = angles.map(async (angle) => {
    const dest = turf.destination([lng, lat], reachDistanceKm, angle, { units: 'kilometers' });
    const [destLng, destLat] = dest.geometry.coordinates;
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`;

    try {
      const res = await axios.get(osrmUrl, { timeout: 2500 });
      if (res.data && res.data.routes && res.data.routes[0]) {
        return res.data.routes[0].geometry.coordinates;
      }
    } catch (e) {
      // Fallback khi OSRM timeout: Lấy thẳng đường chim bay 90%
      return [[lng, lat], [destLng, destLat]];
    }
    return null;
  });

  const results = await Promise.all(routePromises);
  results.forEach(coords => {
    if (coords) coords.forEach(pt => allVertices.push(pt));
  });

  if (allVertices.length >= 3) {
    const pointsFeature = turf.featureCollection(allVertices.map(pt => turf.point(pt)));
    const hullPolygon = turf.convex(pointsFeature);
    if (hullPolygon) {
      // Buffer offset 10% R để bọc trọn lề đường và làm mịn đa giác
      return turf.buffer(hullPolygon, offsetDistanceKm, { units: 'kilometers' });
    }
  }

  // Fallback an toàn: Buffer đường tròn 100% R nếu không dựng được Hull
  return turf.buffer(turf.point([lng, lat]), R / 1000, { units: 'kilometers' });
}

// Controller Handler trả GeoJSON FeatureCollection toàn bộ Isochrones
exports.getNetworkIsochrones = async (req, res) => {
  try {
    const { features } = req.body;
    if (!features || !Array.isArray(features)) {
      return res.status(400).json({ success: false, message: 'Invalid features array' });
    }

    const isoPromises = features.map(async (item) => {
      const poly = await calculateNetworkIsochrone(item.lat, item.lng, item.banKinh);
      return {
        type: 'Feature',
        geometry: poly.geometry,
        properties: {
          id: item.id,
          name: item.name,
          type: item.type,
          ward: item.ward,
          banKinh: item.banKinh,
          status: item.status
        }
      };
    });

    const isochroneFeatures = await Promise.all(isoPromises);
    return res.json({
      type: 'FeatureCollection',
      features: isochroneFeatures
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
