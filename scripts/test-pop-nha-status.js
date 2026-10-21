const { popNhaStatusText } = require('../services/popNhaStatus');

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
  at
}, now);
assert(queued.includes('chưa bắt đầu'), 'READY không được gọi là đang xuất');
assert(!queued.includes('Bấm lại sau vài phút'), 'không giữ câu cũ');
assert(queued.includes('77DVYMBW'), 'có mã tác vụ');
assert(queued.includes('210 phút'), 'có thời gian chờ');

const running = popNhaStatusText({ phase: 'image', state: 'RUNNING', task: 'ABCDEFGH999', at: now - 5 * 60 * 1000 }, now);
assert(running.startsWith('Đang xuất raster'), 'RUNNING là đang xuất');
assert(running.includes('5 phút'), 'RUNNING có số phút');

const failed = popNhaStatusText({ phase: 'table', state: 'FAILED', error: 'Not found: gs://bucket/file', task: 'TABLE1234' }, now);
assert(failed.includes('Nạp bảng điểm lỗi'), 'bảng lỗi');
assert(failed.includes('Not found'), 'kèm lỗi Earth Engine');
assert(failed.includes('Chạy lại'), 'nhắc chạy lại');

assert(popNhaStatusText({ phase: 'ready', state: 'READY' }, now).includes('sẵn sàng'), 'xong thì sẵn sàng');
assert(popNhaStatusText({ phase: 'image', state: 'CANCELLED', error: '' }, now).includes('đã hủy'), 'hủy');

console.log('pop-nha-status: ok');
