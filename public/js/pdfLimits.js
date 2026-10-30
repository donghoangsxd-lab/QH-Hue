// Khớp services/pdfLimits.js. Người dùng tối đa 2 MB; admin tối đa 10 MB.
// Cả hai gửi base64 qua /api (Cloud Run). Không PUT thẳng bucket: thiếu CORS → Failed to fetch.
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

/** Đọc PDF thành base64 (không tiền tố data:). Dùng cho admin ≤ 10 MB và cán bộ ≤ 2 MB. */
export function fileToPdfBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Không đọc được file PDF.'));
    reader.readAsDataURL(file);
  });
}

/** Giữ cho mã cũ; bucket không mở CORS nên PUT thường thất bại. */
export async function putSignedPdf(sign, file) {
  let res;
  try {
    res = await fetch(sign.url, { method: 'PUT', headers: sign.headers, body: file });
  } catch (err) {
    throw new Error('Không tải được PDF lên bucket (Failed to fetch). Gửi lại qua máy chủ, không PUT thẳng storage.googleapis.com.');
  }
  if (!res.ok) {
    throw new Error('Không tải được PDF lên bucket. Kiểm tra CORS của bucket cho phép PUT, kèm header Content-Type và x-goog-content-length-range.');
  }
}
