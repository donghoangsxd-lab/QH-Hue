// Khớp services/pdfLimits.js. Người dùng tối đa 2 MB (gửi kèm request). Admin tối đa 10 MB;
// phần trên 2 MB PUT thẳng lên bucket.
export const PDF_USER_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_ADMIN_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_INLINE_MAX_BYTES = PDF_USER_MAX_BYTES;

export function pdfMaxBytes(admin) {
  return admin ? PDF_ADMIN_MAX_BYTES : PDF_USER_MAX_BYTES;
}

export function pdfLimitText(admin) {
  return admin ? '10 MB' : '2 MB';
}

export function pdfSizeError(size, admin) {
  if (!(size > 0)) return 'File PDF rỗng.';
  if (size > pdfMaxBytes(admin)) return `File PDF tối đa ${pdfLimitText(admin)}.`;
  return '';
}

export async function putSignedPdf(sign, file) {
  const res = await fetch(sign.url, { method: 'PUT', headers: sign.headers, body: file });
  if (!res.ok) {
    throw new Error('Không tải được PDF lên bucket. Kiểm tra CORS của bucket cho phép PUT, kèm header Content-Type và x-goog-content-length-range.');
  }
}
