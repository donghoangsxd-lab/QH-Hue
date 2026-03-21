const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Google Sheets auth qua biến môi trường
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheetId = process.env.SHEET_ID;

// API thêm dữ liệu
app.post('/addSchool', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const { tentruong, dientich, lon, lat, isAdmin } = req.body;
    const approve = isAdmin ? 'yes' : 'no';

    const row = [String(tentruong || ''), String(dientich || ''), String(lon || ''), String(lat || ''), approve];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:E',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    res.send({ status: 'success', approve });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Error writing to sheet');
  }
});

// API đọc dữ liệu
app.get('/schools', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:E'
    });

    const rows = result.data.values || [];
    const data = rows.slice(1).map((r, i) => ({
      id: i + 2,
      tentruong: r[0],
      dientich: r[1],
      lon: parseFloat(r[2]),
      lat: parseFloat(r[3]),
      approve: r[4]
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error reading sheet');
  }
});

// API duyệt điểm
app.post('/approve/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Sheet1!E${id}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['yes']] }
    });

    res.send({ status: 'approved', id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error approving');
  }
});

// Phục vụ file tĩnh
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));