// Câu trạng thái nạp raster nhà ở. Không dùng lại câu cũ và không nhắc bấm thêm.

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
  if (state === 'TABLE_READY' || (row.phase === 'ready' && row.popFromTable)) {
    return 'Bảng điểm đã có trên Earth Engine. Dân số nhà ở tính từ bảng này, không cần ảnh raster.';
  }
  if (row.phase === 'ready' || state === 'ASSET_READY') {
    return 'Nền nhà thấp tầng đã sẵn sàng. Thêm chung cư ở tab NOXH, không cần nạp lại CSV.';
  }
  if (row.phase === 'idle') return 'Đã hủy tác vụ xuất ảnh. Dân số nhà ở vẫn tính từ bảng điểm đã nạp.';
  if (state === 'FAILED') {
    const what = row.phase === 'table' ? 'Nạp bảng điểm' : 'Xuất raster';
    const tail = row.phase === 'table' ? '' : ' Dân số nhà ở vẫn tính từ bảng điểm đã nạp.';
    return `${what} lỗi.${err}${hint}${tail}`;
  }
  if (state === 'CANCELLED') {
    const what = row.phase === 'table' ? 'Nạp bảng điểm' : 'Xuất raster';
    const tail = row.phase === 'table' ? '' : ' Dân số nhà ở vẫn tính từ bảng điểm đã nạp.';
    return `${what} đã hủy.${err}${hint}${tail}`;
  }
  if (row.phase === 'table') {
    if (state !== 'FAILED' && state !== 'CANCELLED' && state !== 'COMPLETED') {
      const mins = minutesSince(row.at, now);
      const n = mins == null ? 'vài phút' : `${mins} phút`;
      return `Đang cập nhật dữ liệu dân số mới (${n})…`;
    }
    return `Bảng điểm đang chờ Earth Engine, chưa chạy.${hint}${err}`;
  }
  if (row.phase === 'image') {
    if (state === 'RUNNING') return `Đang xuất raster Pixel-danso-nha.${hint}`;
    if (state === 'ASSET_MISSING') {
      return row.popFromTable
        ? 'Chưa đọc được ảnh raster. Dân số nhà ở vẫn tính từ bảng điểm Pixel-danso-nha-diem.'
        : 'Chưa đọc được ảnh raster và chưa có bảng điểm.';
    }
    return `Raster đang chờ Earth Engine, chưa bắt đầu xuất.${hint}${err} Dân số nhà ở vẫn tính từ bảng điểm Pixel-danso-nha-diem.`;
  }
  return 'Đang xử lý raster dân nhà ở.' + hint;
}

module.exports = { popNhaStatusText, minutesSince };
