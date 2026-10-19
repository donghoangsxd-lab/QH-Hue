// Hạn mức PDF đính kèm (quyết định, văn bản kèm, PDF hồ sơ điều chỉnh).
// Người dùng tối đa 2 MB, gửi base64 trong thân request (dưới giới hạn ~4,5 MB của Vercel).
// Admin tối đa 10 MB: phần trên 2 MB tải PUT thẳng lên bucket bằng URL ký, không đi qua thân hàm.
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
  return admin
    ? 'File PDF lớn hơn 2 MB không gửi kèm yêu cầu. Dùng đường tải trực tiếp, tối đa 10 MB.'
    : tooBigMessage(false);
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
  const clean = String(raw || '').replace(/\s+/g, '');
  if (!clean) throw fail('File PDF rỗng.', 400);
  if (clean.length > b64MaxChars(PDF_INLINE_MAX_BYTES)) throw fail(inlineTooBigMessage(!!admin), 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw fail('File PDF không hợp lệ.', 400);
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length < 5) throw fail('File PDF rỗng.', 400);
  if (buffer.length > PDF_INLINE_MAX_BYTES) throw fail(inlineTooBigMessage(!!admin), 413);
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
  b64MaxChars,
  inlineBuffer
};
