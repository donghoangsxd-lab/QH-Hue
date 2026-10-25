// Tên object PDF chờ duyệt. Khóa chỉ ở máy chủ (GAS_SECRET, không thì GEE_PRIVATE_KEY)
// để đường dẫn không suy ra từ slug đồ án đang công khai.
const crypto = require('crypto');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PENDING_PDF_RE = /^cho-duyet\/[a-f0-9]{32}\.pdf$/;

function pendingSecret() {
  return process.env.PDF_PENDING_SECRET || process.env.GAS_SECRET || process.env.GEE_PRIVATE_KEY || '';
}

function pendingDecisionObject(slug, secret) {
  const key = secret == null ? pendingSecret() : String(secret);
  if (!key) {
    const err = new Error('Thiếu khóa để giấu file PDF chờ duyệt');
    err.status = 500;
    err.code = 'NO_SA';
    throw err;
  }
  if (!SLUG_RE.test(String(slug || ''))) {
    const err = new Error('Mã đồ án không hợp lệ');
    err.status = 400;
    throw err;
  }
  const id = crypto.createHmac('sha256', key).update(`quyet-dinh:${slug}`).digest('hex').slice(0, 32);
  return `cho-duyet/${id}.pdf`;
}

module.exports = { pendingDecisionObject, pendingSecret, PENDING_PDF_RE, SLUG_RE };
