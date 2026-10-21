const { popNhaStatusText } = require('../services/popNhaStatus');
const { scalesFromGroups } = require('../services/geeService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = 1_800_000_000_000;
const at = now - 210 * 60 * 1000;
const queued = popNhaStatusText({
  phase: 'image',
  state: 'READY',
  task: '77DVYMBWDAL63HTGLFFWGF4D',
  message: 'Đang xuất raster Pixel-danso-nha. Bấm lại sau vài phút.',
  note: 'Chạy lại tác vụ.',
  at
}, now);
assert(queued.includes('chưa bắt đầu'), 'READY không được gọi là đang xuất');
assert(!queued.includes('Bấm lại sau vài phút'), 'không giữ câu cũ');
assert(!/bấm/i.test(queued), 'không nhắc bấm');
assert(queued.includes('bảng điểm'), 'nói rõ đang tính từ bảng điểm');
assert(queued.includes('77DVYMBW'), 'có mã tác vụ');
assert(queued.includes('210 phút'), 'có thời gian chờ');

const running = popNhaStatusText({ phase: 'image', state: 'RUNNING', task: 'ABCDEFGH999', at: now - 5 * 60 * 1000 }, now);
assert(running.startsWith('Đang xuất raster'), 'RUNNING là đang xuất');
assert(running.includes('5 phút'), 'RUNNING có số phút');

const failed = popNhaStatusText({ phase: 'table', state: 'FAILED', error: 'Not found: gs://bucket/file', task: 'TABLE1234' }, now);
assert(failed.includes('Nạp bảng điểm lỗi'), 'bảng lỗi');
assert(failed.includes('Not found'), 'kèm lỗi Earth Engine');
assert(!/bấm|chạy lại/i.test(failed), 'lỗi không nhắc bấm tiếp');

const imageFailed = popNhaStatusText({ phase: 'image', state: 'FAILED', error: 'quota', task: 'IMG12345' }, now);
assert(imageFailed.includes('bảng điểm'), 'xuất lỗi vẫn nói bảng điểm');
assert(!/bấm/i.test(imageFailed), 'xuất lỗi không nhắc bấm');

assert(popNhaStatusText({ phase: 'ready', state: 'ASSET_READY' }, now).includes('sẵn sàng'), 'xong thì sẵn sàng');
assert(!/bấm/i.test(popNhaStatusText({ phase: 'ready', state: 'ASSET_READY' }, now)), 'xong không nhắc bấm');
assert(popNhaStatusText({ phase: 'image', state: 'CANCELLED', error: '' }, now).includes('đã hủy'), 'hủy');
assert(!/bấm/i.test(popNhaStatusText({ phase: 'idle', state: 'CANCELLED' }, now)), 'idle không nhắc bấm');
assert(popNhaStatusText({ phase: 'image', state: 'ASSET_MISSING', popFromTable: true }, now).includes('bảng điểm'), 'thiếu ảnh nhưng còn bảng');
assert(popNhaStatusText({ phase: 'ready', state: 'TABLE_READY', popFromTable: true }, now).includes('không cần ảnh raster'), 'bảng đủ để tính');

const scaled = scalesFromGroups(
  { groups: [{ ID_Phuong: 1, sum: 80 }, { ID_Phuong: 2, sum: 0 }] },
  { groups: [{ ID_Phuong: 1, sum: 40 }, { ID_Phuong: 2, sum: 10 }] },
  { groups: [{ ID_Phuong: 1, first: 100 }, { ID_Phuong: 2, first: 50 }] }
);
assert(scaled.wards === 2, 'đủ phường');
assert(scaled.ids[0] === 1 && Math.abs(scaled.scales[0] - 0.75) < 1e-9, 'phường 1 co 0,75');
assert(scaled.ids[1] === 2 && scaled.scales[1] === 0, 'hết nhà thấp tầng thì hệ số 0');
const over = scalesFromGroups(
  { groups: [{ ID_Phuong: 3, sum: 20 }] },
  { groups: [{ ID_Phuong: 3, sum: 80 }] },
  { groups: [{ ID_Phuong: 3, first: 50 }] }
);
assert(over.scales[0] === 0, 'chung cư lớn hơn dân số thì không còn nhà thấp tầng');

console.log('pop-nha-status: ok');
