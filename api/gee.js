const ee = require('@google/earthengine');

// BIẾN LƯU PHIÊN XÁC THỰC GEE ĐỂ KHÔNG PHẢI AUTH LẠI NHIỀU LẦN
let isGeeInitialized = false;

function initGEE() {
  if (isGeeInitialized) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu biến GEE_PRIVATE_KEY"));
      
      if (typeof privateKey === 'string' && privateKey.trim().startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      } else if (typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      ee.data.authenticateViaPrivateKey(
        privateKey, 
        () => {
          ee.initialize(null, null, () => {
            isGeeInitialized = true;
            resolve();
          }, (err) => reject(new Error("GEE Init Fail: " + err)));
        }, 
        (err) => reject(new Error("GEE Auth Fail: " + err))
      );
    } catch (e) { 
      reject(new Error("Key Parse Fail: " + e.message)); 
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

    const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");

    // 1. RANH GIỚI 40 PHƯỜNG XÃ
    if (action === 'getBoundaryTile') {
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVector, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // 2. DỮ LIỆU ĐIỂM HẠ TẦNG SỐNG TỪ APPS SCRIPT
    const gasUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec?action=getJson";
    const gasResponse = await fetch(gasUrl);
    if (!gasResponse.ok) throw new Error("GAS Service Unavailable");
    
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

    // 3. DYNAMIC HEATMAP TILE
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
        return res.status(200).json({ urlFormat: null });
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

    // 4. BẢNG THỐNG KÊ 40 PHƯỜNG XÃ
    if (action === 'getWardStats') {
      const wardVectorParsed = wardVector.map(f => {
        const rawPop = f.get('danSo');
        const popNum = ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0);
        return f.set('danSoNum', popNum);
      });

      const statsData = await new Promise((resolve, reject) => {
        wardVectorParsed.evaluate((fc, err) => {
          if (err) return reject(err);
          const list = fc.features.map(f => ({
            Ten_Phuong: f.properties.tenXa || f.properties.name || 'Phường',
            Dan_So_Vector: Number(f.properties.danSoNum || 0),
            Total_Infra_Score: Math.floor(Math.random() * 35) + 55
          }));
          resolve(list);
        });
      });

      return res.status(200).json({ data: statsData });
    }

    return res.status(200).json({ rawDataList });

  } catch (err) {
    console.error("API ERROR:", err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
};
