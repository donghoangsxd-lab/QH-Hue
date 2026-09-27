const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');

// token đã xác minh -> { email, name, exp }; tránh gọi Google cho mỗi thao tác của cùng 1 phiên đăng nhập
const verifiedTokens = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function readBearerToken(req) {
  const header = String((req.headers && req.headers.authorization) || '');
  const match = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  return match ? match[1] : '';
}

// Xác minh chữ ký + hạn + client ID của Google ID token qua endpoint tokeninfo của Google
async function verifyGoogleIdToken(token) {
  if (!token) throw httpError(401, 'Chưa đăng nhập');
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = verifiedTokens.get(key);
  if (cached && cached.exp > nowSec) return cached;

  let info;
  try {
    const res = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
      params: { id_token: token },
      timeout: 8000
    });
    info = res.data || {};
  } catch (e) {
    throw httpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
  }

  const exp = Number(info.exp || 0);
  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== constants.GOOGLE_CLIENT_ID || !emailVerified || exp <= nowSec
      || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) {
    throw httpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
  }

  const user = { email: String(info.email || '').toLowerCase(), name: info.name || info.email, exp };
  if (verifiedTokens.size > 200) verifiedTokens.clear();
  verifiedTokens.set(key, user);
  return user;
}

async function requireAdmin(req) {
  const user = await verifyGoogleIdToken(readBearerToken(req));
  if (!constants.ADMIN_EMAILS.includes(user.email)) {
    throw httpError(403, `Tài khoản ${user.email} không có quyền quản trị`);
  }
  return user;
}

module.exports = { requireAdmin, httpError };
