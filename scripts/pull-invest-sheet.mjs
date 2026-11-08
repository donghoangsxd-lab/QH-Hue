// Kéo invest_calls.json từ GCS về public/data/invest-sheet.json để đóng gói tĩnh
// khớp bản Apps Script (không đụng ranh KML — vẫn dùng build-invest.js).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/data/invest-sheet.json');
const url = 'https://storage.googleapis.com/hue-infra-data-us/invest_calls.json';

const res = await fetch(url);
if (!res.ok) {
  console.error('Không tải được invest_calls.json', res.status);
  process.exit(1);
}
const data = await res.json();
if (!data || !Array.isArray(data.rows)) {
  console.error('invest_calls.json thiếu rows');
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify(data));
console.log('rows', data.rows.length, 'bytes', fs.statSync(out).size, '→', path.relative(root, out));
