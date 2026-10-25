// Object chờ duyệt. Bucket đang public-read nên tên là 32 hex, không ghi vào chỉ mục công khai.
// Worker từ chối prefix này. Xóa khi quản trị duyệt hoặc từ chối.
const crypto = require('crypto');
const gcsWrite = require('./gcsWrite');

const ID_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^cho-duyet\/[a-f0-9]{32}\.(json|pdf)$/;
const JSON_RE = /^cho-duyet\/[a-f0-9]{32}\.json$/;
const MAX_CHARS = 1500000;
const MAX_PDF = 2 * 1024 * 1024;

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

function pdfObject(id) {
  return objectName(id).replace(/\.json$/, '.pdf');
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

async function putPdf(id, buffer) {
  const name = pdfObject(id);
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.length > MAX_PDF) {
    const err = new Error(buffer && buffer.length > MAX_PDF ? 'File PDF tối đa 2 MB.' : 'File PDF rỗng.');
    err.status = buffer && buffer.length > MAX_PDF ? 413 : 400;
    throw err;
  }
  if (buffer.slice(0, 4).toString('ascii') !== '%PDF') {
    const err = new Error('Chỉ nhận file PDF.');
    err.status = 400;
    throw err;
  }
  await gcsWrite.putObject(name, buffer, 'application/pdf');
  try { await gcsWrite.patchCacheControl(name, 'private, no-store'); } catch (err) { /* metadata không chặn lần ghi */ }
  return name;
}

async function readPdf(name) {
  const key = assertName(name);
  if (!key.endsWith('.pdf')) {
    const err = new Error('Đường dẫn chờ duyệt không hợp lệ');
    err.status = 400;
    throw err;
  }
  const meta = await gcsWrite.objectMeta(key);
  if (!meta) {
    const err = new Error('Không còn file PDF chờ duyệt');
    err.status = 404;
    throw err;
  }
  if (meta.size > MAX_PDF || meta.size < 5) {
    const err = new Error(meta.size > MAX_PDF ? 'File PDF tối đa 2 MB.' : 'File PDF rỗng.');
    err.status = meta.size > MAX_PDF ? 413 : 400;
    throw err;
  }
  const buffer = await gcsWrite.readBytes(key, 0, meta.size - 1);
  if (buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== '%PDF') {
    const err = new Error('Chỉ nhận file PDF.');
    err.status = 400;
    throw err;
  }
  return buffer;
}

async function readJson(name) {
  if (!JSON_RE.test(String(name || ''))) {
    const err = new Error('Đường dẫn chờ duyệt không hợp lệ');
    err.status = 400;
    throw err;
  }
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

module.exports = { newId, objectName, pdfObject, putJson, putPdf, readJson, readPdf, remove, MAX_CHARS, MAX_PDF, NAME_RE };
