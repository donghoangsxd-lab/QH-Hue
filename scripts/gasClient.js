// Dùng chung cho các script đẩy lớp tĩnh lên bucket qua Apps Script (push-thoatnuoc.js, push-luuvuc.js).
// Cần GAS_BASE_URL và GAS_SECRET (biến môi trường, hoặc .env.local / .env do `vercel env pull` tạo).
const fs = require('fs');
const path = require('path');

function loadEnvFile(name) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) return;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
}

function loadEnv() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
}

async function postToAppsScript(action, content) {
  const base = process.env.GAS_BASE_URL;
  const secret = process.env.GAS_SECRET;
  if (!base || !secret) throw new Error('Thiếu GAS_BASE_URL / GAS_SECRET (đặt biến môi trường hoặc chạy `vercel env pull .env.local`)');
  const url = `${base}?action=${action}&key=${encodeURIComponent(secret)}`;
  // Giống api/gee.js: text/plain để Apps Script nhận nguyên body; doPost trả 302 → GET theo location
  let res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, content }),
    signal: AbortSignal.timeout(120000)
  });
  const loc = res.headers.get('location');
  if (loc && res.status >= 300 && res.status < 400) res = await fetch(new URL(loc, url), { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* phản hồi không phải JSON */ }
  if (!data) throw new Error(`Apps Script trả về phản hồi lạ (HTTP ${res.status})`);
  if (data.error) {
    const hint = String(data.error).indexOf('Action không hợp lệ') === 0
      ? ` — Apps Script chưa có ${action}: dán apps-script/Code.gs rồi Deploy → Manage deployments → Edit → New version`
      : '';
    throw new Error(`Apps Script: ${data.error}${hint}`);
  }
  if (data.saved !== true) throw new Error('Apps Script chưa ghi được file lên bucket (xem Executions trong Apps Script)');
  return data;
}

module.exports = { loadEnv, postToAppsScript };
