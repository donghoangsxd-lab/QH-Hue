// ==========================
// 1. Import thư viện cần thiết
// ==========================
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { ee, initEE } = require('./gee'); // Earth Engine
const { Storage } = require('@google-cloud/storage'); // Google Cloud Storage
const { google } = require('googleapis'); // Google Sheets API

// ==========================
// 2. Cấu hình Google Cloud Storage
// ==========================
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const storage = new Storage({
  projectId: credentials.project_id,
  credentials: {
    client_email: credentials.client_email,
    private_key: (credentials.private_key || "").replace(/\\n/g, '\n')
  }
});

const bucketName = 'mamnon-hue-data';
const bucketUrl = "https://storage.googleapis.com/mamnon-hue-data/mamnon.geojson";

// ==========================
// 3. Cấu hình Google Sheets
// ==========================
const SPREADSHEET_ID = process.env.SHEET_ID;

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: (credentials.private_key || "").replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ==========================
// 4. Khởi tạo Express App
// ==========================
const app = express();
const PORT = process.env.PORT || 3000;  // để Render tự cấp port

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo Earth Engine (nếu cần)
initEE();

// ==========================
// 5. Hàm cập nhật file mamnon.geojson từ Google Sheet lên bucket
// ==========================
async function updateMamnonFileToBucket() {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = res.data.values || [];

    const features = rows.slice(1) // bỏ header
      .map((r, idx) => {
        const [lon, lat, tentruong, dientich, phuongXaTT, approveRaw] = r;

        if (!lon || !lat || isNaN(parseFloat(lon)) || isNaN(parseFloat(lat))) {
          return null; // bỏ qua dòng trống
        }

        let approveVal = false;
        if (typeof approveRaw === "string") {
          const norm = approveRaw.trim().toLowerCase();
          approveVal = (norm === "yes" || norm === "true");
        } else if (approveRaw === true) {
          approveVal = true;
        }

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(lon), parseFloat(lat)]
          },
          properties: {
            X: parseFloat(lon),
            Y: parseFloat(lat),
            tenDoiTuon: tentruong,
            dienTichDa: dientich,
            phuongXaTT,
            approve: approveVal,
            rowNumber: idx + 2 // vì slice(1) nên vẫn +2
          }
        };
      })
      .filter(f => f !== null);

    const geojson = { type: "FeatureCollection", features };
    const file = storage.bucket(bucketName).file('mamnon.geojson');
    await file.save(JSON.stringify(geojson, null, 2), { contentType: 'application/json' });
    console.log("Đã cập nhật mamnon.geojson từ Sheet lên bucket");
  } catch (err) {
    console.error("Lỗi cập nhật từ Sheet:", err);
  }
}
// ==========================
// 6. API: Guest thêm trường mới
// ==========================
app.post('/api/schools/add', async (req, res) => {
  const { tentruong, dientich, lon, lat, phuongXaTT } = req.body;
  try {
    const lonFixed = parseFloat(lon.toString().replace(",", "."));
    const latFixed = parseFloat(lat.toString().replace(",", "."));

    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[lonFixed, latFixed, tentruong, dientich, phuongXaTT, false]]
      }
    });

    res.json({ status: 'ok', message: 'Đã thêm trường vào Sheet với trạng thái FALSE' });
    await updateMamnonFileToBucket();
  } catch (err) {
    console.error(err);
    res.status(500).send('Lỗi ghi vào Google Sheet');
  }
});

// ==========================
// 7. API: Admin duyệt điểm
// ==========================
app.post('/api/approve/:rowNumber', async (req, res) => {
  const rowNumber = req.params.rowNumber;
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!F${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[true]] }
    });
    await updateMamnonFileToBucket(); // thêm await ở đây
    res.json({ status: 'ok', row: rowNumber });
  } catch (err) {
    console.error(err);
    res.status(500).send('Lỗi ghi vào Google Sheet');
  }
});

// API: Admin cập nhật trường
app.post('/api/update/:rowNumber', async (req, res) => {
  const rowNumber = req.params.rowNumber;
  const { tenTruong, phuongXa, dienTich, lon, lat, approve } = req.body;
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!A${rowNumber}:F${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[lon, lat, tenTruong, dienTich, phuongXa, approve]]
      }
    });
    await updateMamnonFileToBucket();
    res.json({ status: 'ok', message: 'Đã cập nhật trường' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Lỗi ghi vào Google Sheet');
  }
});

// ==========================
// 7b. API: Sync thủ công
// ==========================
app.get('/api/sync', async (req, res) => {
  await updateMamnonFileToBucket();
  res.json({ status: 'ok', message: 'Bucket đã được cập nhật từ Sheet' });
});

// ==========================
// 8. Khởi động server
// ==========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
