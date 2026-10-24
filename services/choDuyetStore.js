// Object chờ duyệt. Bucket đang public-read nên tên là 32 hex, không ghi vào chỉ mục công khai.
// Worker từ chối prefix này. Xóa khi quản trị duyệt hoặc từ chối.
const crypto = require('crypto');
const gcsWrite = require('./gcsWrite');

const ID_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^cho-duyet\/[a-f0-9]{32}\.json$/;
const MAX_CHARS = 1500000;

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function objectName(id) {
  if (!ID_RE.test(String(id || ''))) {
    const err = new Error('Mã hàng chờ không hợp lệ');
    err.status = 400;
    throw err;
  }
  return `cho-duyet/${id}.json`;
}

function assertName(name) {
  if (!NAME_RE.test(String(name || ''))) {
    const err = new Error('Đường dẫn chờ duyệt không hợp lệ');
    err.status = 400;
    throw err;
  }
  return name;
}

async function putPrivate(name, text) {
  if (text.length > MAX_CHARS) {
    const err = new Error('Hồ sơ chờ duyệt lớn hơn 1,5 MB');
    err.status = 413;
    throw err;
  }
  await gcsWrite.putJson(name, text);
  try { await gcsWrite.patchCacheControl(name, 'private, no-store'); } catch (err) { /* metadata không chặn lần ghi */ }
  return name;
}

async function putJson(id, body) {
  const name = objectName(id);
  return putPrivate(name, JSON.stringify(body));
}

async function readJson(name) {
  const got = await gcsWrite.readJson(assertName(name));
  if (!got || !got.data || typeof got.data !== 'object') {
    const err = new Error('Không còn file chờ duyệt');
    err.status = 404;
    throw err;
  }
  return got.data;
}

async function remove(name) {
  await gcsWrite.removeObject(assertName(name));
}

module.exports = { newId, objectName, putJson, readJson, remove, MAX_CHARS, NAME_RE };
