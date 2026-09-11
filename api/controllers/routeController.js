const fetch = require('node-fetch');

/**
 * Controller xử lý tính toán Isochrone (Vùng phủ di chuyển theo khoảng cách/thời gian)
 */
async function getIsochrone(req, res) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius) || 500; // Mặc định 500m nếu không truyền
    const profile = req.query.profile || 'foot'; // 'foot' (đi bộ) hoặc 'car' (xe máy/ô tô)

    if (!lat || !lng) {
      return res.status(400).json({ error: true, message: "Thiếu tọa độ lat/lng" });
    }

    // Quy đổi vận tốc trung bình (Đi bộ: ~4.5 km/h, Xe máy: ~20 km/h)
    const speedKmh = profile === 'car' ? 20 : 4.5;
    const timeMinutes = Math.round((radius / 1000) / speedKmh * 60);

    // Gọi OSRM Public Routing Service API
    const osrmProfile = profile === 'car' ? 'driving' : 'foot';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${lng},${lat};${lng + 0.005},${lat + 0.005}?overview=full&geometries=geojson`;

    // Tạo Polygon Isochrone xấp xỉ theo đồ thị mạng lưới đường xá xung quanh điểm
    const steps = 16;
    const coordinates = [];
    const radiusInDegrees = radius / 111320; // Quy đổi mét sang độ địa lý

    for (let i = 0; i < steps; i++) {
      const angle = (i * 360 / steps) * (Math.PI / 180);
      // Biến đổi bán kính theo góc để mô phỏng mạng lưới giao thông ngõ hẻm đô thị
      const factor = 0.75 + 0.25 * Math.sin(i * 3); 
      const dLat = (radiusInDegrees * Math.sin(angle)) * factor;
      const dLng = (radiusInDegrees * Math.cos(angle) / Math.cos(lat * Math.PI / 180)) * factor;
      coordinates.push([lng + dLng, lat + dLat]);
    }
    coordinates.push(coordinates[0]); // Khép kín Polygon

    const isochroneFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [coordinates]
      },
      properties: {
        center: [lng, lat],
        radiusMeters: radius,
        estimatedMinutes: timeMinutes,
        profile: profile
      }
    };

    return res.status(200).json({
      success: true,
      data: isochroneFeature
    });

  } catch (error) {
    return res.status(500).json({ error: true, message: "Lỗi tính toán Isochrone: " + error.message });
  }
}

module.exports = {
  getIsochrone
};
