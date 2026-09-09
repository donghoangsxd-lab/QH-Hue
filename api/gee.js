const ee = require('@google/earthengine');

// HÀM KHỞI TẠO XÁC THỰC VỚI GEE
function initGEE() {
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu biến môi trường GEE_PRIVATE_KEY"));
      
      // Xử lý chuỗi JSON hoặc chuỗi Key có ký tự \n
      if (typeof privateKey === 'string' && privateKey.trim().startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      } else if (typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      ee.data.authenticateViaPrivateKey(
        privateKey, 
        () => ee.initialize(null, null, resolve, (err) => reject(new Error("GEE Init Error: " + err))), 
        (err) => reject(new Error("GEE Auth Error: " + err))
      );
    } catch (e) { 
      reject(new Error("Key Format Error: " + e.message)); 
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action || 'getInitData';

    // 1. RANH GIỚI 40 PHƯỜNG XÃ TỪ GEE
    if (action === 'getBoundaryTile') {
      const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVector, color: 1, width: 2 });
      
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // 2. TẢI DỮ LIỆU ĐIỂM HẠ TẦNG TỪ GOOGLE APPS SCRIPT
    const gasUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec?action=getJson";
    const gasResponse = await fetch(gasUrl);
    if (!gasResponse.ok) throw new Error("Lỗi đọc dữ liệu Google Sheet API");
    
    const geojson = await gasResponse.json();
    const features = geojson.features || [];

    const codeMap = { "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" };
    const rawDataList = features.map(ft => {
      const props = ft.properties || {};
      const coords = ft.geometry ? ft.geometry.coordinates : [107.5905, 16.4637];
      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: codeMap[prefix] || "9-CSD",
        lat: Number(coords[1]),
        lng: Number(coords[0]),
        size: Number(props.QuyMo_S) || 0,
        radius: Number(props.BanKinh) || 500,
        status: String(props.TrangThai).toLowerCase() === 'true'
      };
    });

    // 3. TẠO DYNAMIC TILE DÀNH CHO HEATMAP MA TRẬN
    if (action === 'getHeatmapTile') {
      const categoryImageLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach(code => {
        const groupFeatures = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500)));
        if (groupFeatures.length > 0) {
          categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(groupFeatures), color: 1 }));
        }
      });

      if (categoryImageLayers.length === 0) {
        return res.status(200).json({ urlFormat: null, message: "Không có dữ liệu vẽ Heatmap" });
      }

      const heatmapImage = ee.ImageCollection(categoryImageLayers).sum();
      const heatmapMasked = heatmapImage.updateMask(heatmapImage.gt(0));

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap(
          { min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    return res.status(200).json({ rawDataList });

  } catch (err) {
    console.error("SERVERLESS API ERROR:", err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
};
