// Câu trạng thái nạp raster nhà ở. Không dùng lại câu cũ: trạng thái Earth Engine mới hơn câu đã lưu.

function minutesSince(at, now) {
  const n = Number(at);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.round((now - n) / 60000));
}

function taskHint(rec) {
  const id = String(rec.task || '');
  return id ? ` Mã ${id.slice(0, 8)}.` : '';
}

function waitHint(rec, now) {
  const mins = minutesSince(rec.at, now);
  return mins == null ? '' : ` Đã ${mins} phút.`;
}

function popNhaStatusText(rec, now = Date.now()) {
  const row = rec || {};
  const state = String(row.state || '');
  const err = row.error ? ` Lỗi: ${row.error}` : '';
  const hint = taskHint(row) + waitHint(row, now);
  if (row.phase === 'csv') return row.message || 'Chưa có CSV trên bucket.';
  if (row.phase === 'ready' || state === 'ASSET_READY') {
    return 'Nền nhà thấp tầng đã sẵn sàng. Thêm chung cư ở tab NOXH, không cần nạp lại CSV. Tải lại trang sau khoảng 1 phút.';
  }
  if (row.phase === 'idle' || state === 'CANCELLED' && row.phase === 'idle') {
    return row.message || 'Đã hủy tác vụ. Bấm Chạy lại để nạp tiếp.';
  }
  if (state === 'FAILED') {
    const what = row.phase === 'table' ? 'Nạp bảng điểm' : 'Xuất raster';
    return `${what} lỗi.${err}${hint} Bấm Chạy lại.`;
  }
  if (state === 'CANCELLED') {
    const what = row.phase === 'table' ? 'Nạp bảng điểm' : 'Xuất raster';
    return `${what} đã hủy.${err}${hint} Bấm Chạy lại.`;
  }
  if (row.phase === 'table') {
    if (state === 'RUNNING') return `Đang nạp bảng điểm lên Earth Engine.${hint}`;
    return `Bảng điểm đang chờ Earth Engine, chưa chạy.${hint}${err}`;
  }
  if (row.phase === 'image') {
    if (state === 'RUNNING') return `Đang xuất raster Pixel-danso-nha.${hint}`;
    if (state === 'ASSET_MISSING') return 'Earth Engine báo xuất xong nhưng chưa đọc được ảnh. Bấm Chạy lại sau một phút.';
    return `Raster đang chờ Earth Engine, chưa bắt đầu xuất.${hint}${err}`;
  }
  return 'Đang xử lý raster dân nhà ở.' + hint;
}

module.exports = { popNhaStatusText, minutesSince };
