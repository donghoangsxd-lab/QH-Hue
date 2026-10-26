// Hồ sơ điều chỉnh cục bộ: đủ ranh + lô, hoặc chỉ quyết định (pdfOnly) kèm tóm tắt.
// Bản vẽ DXF và ảnh scan gắn sau, không chặn lần gửi đầu.

function adjustSubmitMode({ pdfOnly, hasBoundary, lotCount, title }) {
  if (pdfOnly) {
    if (!String(title || '').trim()) {
      return { ok: false, status: 400, message: 'Nhập tóm tắt điều chỉnh cục bộ' };
    }
    return { ok: true, mode: 'pdf' };
  }
  if (!hasBoundary) {
    return { ok: false, status: 400, message: 'Ranh điều chỉnh không hợp lệ hoặc nằm ngoài TP. Huế' };
  }
  if (!(Number(lotCount) > 0)) {
    return { ok: false, status: 400, message: 'Hồ sơ chưa có lô đất trong ranh điều chỉnh' };
  }
  return { ok: true, mode: 'draw' };
}

module.exports = { adjustSubmitMode };
