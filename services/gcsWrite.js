// Ghi / xóa object trên bucket bằng service account GEE (GEE_PRIVATE_KEY là JSON có client_email + private_key).
// Bucket đang public-read: đọc vẫn dùng URL công khai. Quyền ghi là roles/storage.objectAdmin trên hue-infra-data-us.
const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';
let token = null;

function account() {
  let key = process.env.GEE_PRIVATE_KEY;
  if (!key) {
    const err = new Error('Thiếu GEE_PRIVATE_KEY');
    err.code = 'NO_SA';
    throw err;
  }
  if (typeof key === 'string') {
    const text = key.trim();
    if (!text.startsWith('{')) {
      const err = new Error('GEE_PRIVATE_KEY không phải JSON service account');
      err.code = 'NO_SA';
      throw err;
    }
    key = JSON.parse(text);
  }
  if (!key || !key.client_email || !key.private_key) {
    const err = new Error('Service account thiếu client_email hoặc private_key');
    err.code = 'NO_SA';
    throw err;
  }
  if (String(key.private_key).includes('\\n')) key.private_key = String(key.private_key).replace(/\\n/g, '\n');
  return key;
}

async function accessToken() {
  if (token && token.exp > Date.now() + 60000) return token.access;
  const sa = account();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600
  })).toString('base64url');
  const unsigned = `${header}.${claim}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(sa.private_key, 'base64url');
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${sig}`
  }), { timeout: 10000, validateStatus: () => true });
  if (res.status !== 200 || !res.data || !res.data.access_token) {
    const err = new Error(`Không lấy được token ghi bucket (HTTP ${res.status})`);
    err.status = res.status === 200 ? 502 : res.status;
    err.code = 'NO_SA';
    throw err;
  }
  token = { access: res.data.access_token, exp: Date.now() + (Number(res.data.expires_in) || 3600) * 1000 };
  return token.access;
}

function fail(name, status, verb) {
  const err = new Error(`${verb} ${name} lỗi HTTP ${status}`);
  err.status = status;
  if (status === 401 || status === 403) err.code = 'NO_SA';
  if (status === 412) err.code = 'GEN';
  return err;
}

/** Ghi đè object. generation = nếu khớp (0 = chỉ tạo mới); bỏ qua khi không có. */
async function putJson(name, text, generation) {
  const access = await accessToken();
  const q = new URLSearchParams({ uploadType: 'media', name });
  if (generation != null && generation !== '') q.set('ifGenerationMatch', String(generation));
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${constants.GCS_BUCKET}/o?${q}`;
  const res = await axios.post(url, text, {
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    timeout: 55000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });
  if (res.status !== 200) throw fail(name, res.status, 'Ghi');
  return { generation: String((res.data && res.data.generation) || '') };
}

async function removeObject(name) {
  const access = await accessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${constants.GCS_BUCKET}/o/${encodeURIComponent(name)}`;
  const res = await axios.delete(url, {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 20000,
    validateStatus: () => true
  });
  if (res.status === 200 || res.status === 204 || res.status === 404) return;
  throw fail(name, res.status, 'Xóa');
}

module.exports = { putJson, removeObject };
