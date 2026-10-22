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
async function putObject(name, body, contentType, generation) {
  const access = await accessToken();
  const q = new URLSearchParams({ uploadType: 'media', name });
  if (generation != null && generation !== '') q.set('ifGenerationMatch', String(generation));
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${constants.GCS_BUCKET}/o?${q}`;
  const res = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': contentType },
    timeout: 55000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
    transformRequest: [(data) => data]
  });
  if (res.status !== 200) throw fail(name, res.status, 'Ghi');
  await applyCache(name);
  return { generation: String((res.data && res.data.generation) || '') };
}

async function putJson(name, text, generation) {
  return putObject(name, text, 'application/json', generation);
}

/** JSON đã ghi. null nếu chưa có. generation dùng cho ifGenerationMatch ở lần ghi sau. */
async function readJson(name) {
  const access = await accessToken();
  const metaRes = await axios.get(objectApiUrl(name), {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 15000,
    validateStatus: () => true
  });
  if (metaRes.status === 404) return null;
  if (metaRes.status !== 200) throw fail(name, metaRes.status, 'Đọc');
  const media = await axios.get(`${objectApiUrl(name)}?alt=media`, {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true
  });
  if (media.status !== 200) throw fail(name, media.status, 'Đọc');
  return { generation: String(metaRes.data.generation || ''), data: media.data };
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

function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeObjectPath(name) {
  return String(name || '').split('/').map(rfc3986).join('/');
}

function utcStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
    + `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

// URL PUT V4, khóa Content-Type và đúng số byte. Trình duyệt phải gửi đúng các header trả về.
function signPutUrl({ name, contentType, bytes, expiresSec = 600, key, now }) {
  const sa = key || account();
  const date = now || new Date();
  const datetime = utcStamp(date);
  const datestamp = datetime.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;
  const credential = `${sa.client_email}/${credentialScope}`;
  const range = `${bytes},${bytes}`;
  const host = 'storage.googleapis.com';
  const signedHeaders = 'content-type;host;x-goog-content-length-range';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-goog-content-length-range:${range}\n`;
  const canonicalUri = `/${constants.GCS_BUCKET}/${encodeObjectPath(name)}`;
  const pairs = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', credential],
    ['X-Goog-Date', datetime],
    ['X-Goog-Expires', String(expiresSec)],
    ['X-Goog-SignedHeaders', signedHeaders]
  ].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const hash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['GOOG4-RSA-SHA256', datetime, credentialScope, hash].join('\n');
  const signature = crypto.createSign('RSA-SHA256').update(stringToSign).sign(sa.private_key).toString('hex');
  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`,
    headers: { 'Content-Type': contentType, 'x-goog-content-length-range': range },
    stringToSign
  };
}

function objectApiUrl(name) {
  return `https://storage.googleapis.com/storage/v1/b/${constants.GCS_BUCKET}/o/${encodeURIComponent(name)}`;
}

async function objectMeta(name) {
  const access = await accessToken();
  const res = await axios.get(objectApiUrl(name), {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 15000,
    validateStatus: () => true
  });
  if (res.status === 404) return null;
  if (res.status !== 200) throw fail(name, res.status, 'Đọc');
  const data = res.data || {};
  return {
    size: Number(data.size) || 0,
    contentType: String(data.contentType || ''),
    contentEncoding: String(data.contentEncoding || ''),
    md5: String(data.md5Hash || ''),
    updated: String(data.updated || ''),
    generation: String(data.generation || '')
  };
}

async function readBytes(name, start, end) {
  const access = await accessToken();
  const res = await axios.get(`${objectApiUrl(name)}?alt=media`, {
    headers: { Authorization: `Bearer ${access}`, Range: `bytes=${start}-${end}` },
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: end - start + 4096,
    validateStatus: () => true
  });
  if (res.status !== 200 && res.status !== 206) throw fail(name, res.status, 'Đọc');
  return Buffer.from(res.data);
}

async function rewriteObject(src, dest) {
  const access = await accessToken();
  let rewriteToken = '';
  for (let i = 0; i < 8; i++) {
    const q = rewriteToken ? `?rewriteToken=${encodeURIComponent(rewriteToken)}` : '';
    const url = `${objectApiUrl(src)}/rewriteTo/b/${constants.GCS_BUCKET}/o/${encodeURIComponent(dest)}${q}`;
    const res = await axios.post(url, null, {
      headers: { Authorization: `Bearer ${access}` },
      timeout: 30000,
      validateStatus: () => true
    });
    if (res.status !== 200) throw fail(dest, res.status, 'Chép');
    if (res.data && res.data.done) return;
    rewriteToken = res.data && res.data.rewriteToken;
    if (!rewriteToken) throw fail(dest, 502, 'Chép');
  }
  throw fail(dest, 502, 'Chép');
}

module.exports = { accessToken, putJson, readJson, putObject, removeObject, signPutUrl, objectMeta, readBytes, rewriteObject, patchCacheControl, listObjects };

async function patchCacheControl(name, cacheControl) {
  const access = await accessToken();
  const res = await axios.patch(`${objectApiUrl(name)}?updateMask=cacheControl`, { cacheControl }, {
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    timeout: 20000,
    validateStatus: () => true
  });
  if (res.status !== 200) throw fail(name, res.status, 'Sửa metadata');
}

async function applyCache(name) {
  try {
    const { cacheControlFor } = await import('../config/gcsCachePolicy.mjs');
    const desired = cacheControlFor(name);
    if (!desired || /no-store/.test(desired)) return;
    await patchCacheControl(name, desired);
  } catch (err) {
    console.warn('Không gắn Cache-Control:', name, err.message);
  }
}

async function listObjects(prefix, pageToken) {
  const access = await accessToken();
  const q = new URLSearchParams({ maxResults: '1000' });
  if (prefix) q.set('prefix', prefix);
  if (pageToken) q.set('pageToken', pageToken);
  const res = await axios.get(`https://storage.googleapis.com/storage/v1/b/${constants.GCS_BUCKET}/o?${q}`, {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 30000,
    validateStatus: () => true
  });
  if (res.status !== 200) throw fail(prefix || '/', res.status, 'Liệt kê');
  return {
    items: ((res.data && res.data.items) || []).map((it) => ({
      name: it.name,
      cacheControl: it.cacheControl || ''
    })),
    nextPageToken: (res.data && res.data.nextPageToken) || ''
  };
}
