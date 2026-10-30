// Hạn mức PDF đính kèm (quyết định, quy định quản lý, thuyết minh, PDF điều chỉnh).
// Người dùng tối đa 2 MB; admin tối đa 10 MB. Cả hai gửi base64 trong thân request qua Cloud Run
// (MAX_BODY 15 MB đủ chứa ~13,3 MB base64 của file 10 MB). Không PUT thẳng bucket từ trình duyệt:
// bucket không mở CORS → Failed to fetch.
const PDF_USER_MAX_BYTES = 2 * 1024 * 1024;
const PDF_ADMIN_MAX_BYTES = 10 * 1024 * 1024;
const PDF_INLINE_MAX_BYTES = PDF_USER_MAX_BYTES;
const PDF_PROXY_MAX_BYTES = 3 * 1024 * 1024;

function limitLabel(admin) {
  return admin ? '10 MB' : '2 MB';
}

function tooBigMessage(admin) {
  return `File PDF tối đa ${limitLabel(admin)}.`;
}

function inlineTooBigMessage(admin) {
  return tooBigMessage(!!admin);
}

function inlineMaxBytes(admin) {
  return admin ? PDF_ADMIN_MAX_BYTES : PDF_USER_MAX_BYTES;
}

function b64MaxChars(bytes) {
  return Math.ceil(bytes / 3) * 4;
}

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function inlineBuffer(raw, admin) {
  const max = inlineMaxBytes(!!admin);
  const clean = String(raw || '').replace(/\s+/g, '');
  if (!clean) throw fail('File PDF rỗng.', 400);
  if (clean.length > b64MaxChars(max)) throw fail(inlineTooBigMessage(!!admin), 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw fail('File PDF không hợp lệ.', 400);
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length < 5) throw fail('File PDF rỗng.', 400);
  if (buffer.length > max) throw fail(inlineTooBigMessage(!!admin), 413);
  return buffer;
}

module.exports = {
  PDF_USER_MAX_BYTES,
  PDF_ADMIN_MAX_BYTES,
  PDF_INLINE_MAX_BYTES,
  PDF_PROXY_MAX_BYTES,
  limitLabel,
  tooBigMessage,
  inlineTooBigMessage,
  inlineMaxBytes,
  b64MaxChars,
  inlineBuffer
};
