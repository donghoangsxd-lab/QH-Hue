const axios = require('axios');
const turf = require('@turf/turf');
const constants = require('../config/constants');

/**
 * Tính toán Đa giác Vùng phủ Isochrone bám sát tuyến đường (90% + 10%)
 * @param {number} lat - Vĩ độ công trình
 * @param {number} lng - Kinh độ công trình
 * @param {number} banKinh - Bán kính phục vụ R (m)
 */
async function calculateNetworkIsochrone(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  
  // Lấy tỷ lệ cấu hình từ constants.js (mặc định 90% di chuyển OSRM + 10% offset buffer làm mịn)
  const reachRatio = constants.ISOCHRONE_CONFIG?.REACH_RATIO || 0.9;
  const offsetRatio = constants.ISOCHRONE_CONFIG?.OFFSET_RATIO || 0.1;
  const sampleAngles = constants.ISOCHRONE_CONFIG?.SAMPLE_ANGLES || 12;

  const reachDistanceKm = (R * reachRatio) / 1000;  
  const offsetDistanceKm = (R * offsetRatio) / 1000; 

  // Quét các hướng bức xạ giao thông (mặc định 12 hướng)
  const angleStep = 360 / sampleAngles;
  const angles = Array.from({ length: sampleAngles }, (_, i) => i * angleStep);
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
      // Ưu tiên lấy item.radius (tên biến chuẩn Frontend) hoặc item.banKinh
      const effectiveRadius = item.radius || item.banKinh || 500;
      const poly = await calculateNetworkIsochrone(item.lat, item.lng, effectiveRadius);
      
      return {
        type: 'Feature',
        geometry: poly.geometry,
        properties: {
          id: item.id,
          name: item.name,
          type: item.type,
          ward: item.ward,
          banKinh: effectiveRadius,
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
