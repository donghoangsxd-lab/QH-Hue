// ==========================
// 1. Khởi tạo và cấu hình server
// ==========================
const express = require("express");
const ee = require("@google/earthengine");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// Port động để tránh xung đột khi deploy
const PORT = process.env.PORT || 3000;

// ==========================
// 2. Cấu hình Google Sheets
// ==========================
const SPREADSHEET_ID = "1mtOJYO3_o_tcKbDPo1s8XqWbK7mR_09GjNIAqd-48iU";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "key2.json", // file JSON chứa private key
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}

// ==========================
// 3. Phục vụ file tĩnh (frontend)
// ==========================
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// 4. Khởi tạo Earth Engine
// ==========================
const key = require("./key2.json");
ee.data.authenticateViaPrivateKey(
  {
    client_email: key.client_email,
    private_key: key.private_key.replace(/\\n/g, "\n"),
  },
  () => {
    ee.initialize(null, null, () => {
      console.log("Earth Engine initialized");
    });
  },
  (err) => {
    if (err) console.error("EE auth error:", err);
  }
);

// ==========================
// 5. Hàm tiện ích Earth Engine
// ==========================
function getFeatureCollection() {
  const fc = ee.FeatureCollection(
    "projects/optimistic-yew-488501-s0/assets/Mamnon-Hue-2021-loc"
  );
  return fc.map((f) => {
    const lon = f.get("X") || f.get("lon");
    const lat = f.get("Y") || f.get("lat");
    return f.geometry() ? f : f.setGeometry(ee.Geometry.Point([lon, lat]));
  });
}

// ==========================
// 6. Endpoint: lấy dữ liệu điểm trường
// ==========================
app.get("/api/schools", (req, res) => {
  const fc = ee.FeatureCollection(
    "projects/optimistic-yew-488501-s0/assets/Mamnon-Hue-2021-loc"
  );
  fc.evaluate((geojson, err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Lỗi lấy dữ liệu từ GEE");
    }
    const fixedGeojson = {
      type: "FeatureCollection",
      features: geojson.features.map((f) => {
        const lon = parseFloat(f.properties.X || f.properties.lon);
        const lat = parseFloat(f.properties.Y || f.properties.lat);
        let geometry = f.geometry;
        if (!geometry && !isNaN(lon) && !isNaN(lat)) {
          geometry = { type: "Point", coordinates: [lon, lat] };
        }
        return { type: "Feature", geometry, properties: f.properties };
      }),
    };
    res.json(fixedGeojson);
  });
});

// ==========================
// 7. Endpoint: buffer 500m
// ==========================
app.get("/api/gee/buffer500", (req, res) => {
  const fcWithBuffer = getFeatureCollection().map((f) => f.buffer(500));
  fcWithBuffer.evaluate((geojson) => res.json(geojson));
});

// ==========================
// 8. Endpoint: buffer 1000m
// ==========================
app.get("/api/gee/buffer1000", (req, res) => {
  const fcWithBuffer = getFeatureCollection().map((f) => f.buffer(1000));
  fcWithBuffer.evaluate((geojson) => res.json(geojson));
});

// ==========================
// 9. Endpoint: thêm trường mới
// ==========================
app.post("/api/schools/add", async (req, res) => {
  const { tentruong, dientich, lon, lat, phuongXaTT } = req.body;
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:F",
      valueInputOption: "RAW",
      requestBody: {
        values: [[lon, lat, tentruong, dientich, phuongXaTT || "Chưa rõ", false]],
      },
    });
    res.json({ status: "ok", message: "Đã thêm trường vào Google Sheet" });
  } catch (err) {
    console.error("Sheets error:", err);
    res.status(500).send("Lỗi ghi vào Google Sheet");
  }
});

// ==========================
// 10. Endpoint: cập nhật trường học
// ==========================
app.post("/api/schools/update/:rowNumber", async (req, res) => {
  const rowNumber = req.params.rowNumber;
  const { tenTruong, phuongXa, dienTich, lon, lat, approve } = req.body;
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[lon, lat, tenTruong, dienTich, phuongXa || "Chưa rõ", approve]],
      },
    });
    res.json({ status: "ok", message: `Đã cập nhật dòng ${rowNumber}` });
  } catch (err) {
    console.error("Sheets error:", err);
    res.status(500).send("Lỗi ghi vào Google Sheet");
  }
});

// ==========================
// 11. Khởi động server
// ==========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});