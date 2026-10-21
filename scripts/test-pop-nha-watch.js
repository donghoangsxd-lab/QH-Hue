const fs = require('fs');
const path = require('path');
const popWatch = require('../services/popNhaWatch');
const { popNhaStatusText } = require('../services/popNhaStatus');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const running = {
  id: 'R5VL6OZT',
  state: 'RUNNING',
  description: '',
  sources: [],
  destinations: [],
  updated: 20,
  created: 10
};
const picked = popWatch.pickActiveTask([
  { id: 'OTHER', state: 'RUNNING', description: 'ảnh khác', sources: [], destinations: [] },
  { ...running },
  { id: 'R5VL6OZT', state: 'COMPLETED', description: '', sources: [], destinations: [], updated: 30 }
]);
assert(picked && picked.id === 'R5VL6OZT' && picked.state === 'RUNNING', 'nhận tác vụ đang chạy dù mô tả trống');
assert(!popWatch.pickActiveTask([{ id: 'R5VL6OZT', state: 'COMPLETED', description: '' }]), 'tác vụ đã xong không giữ chỗ');
assert(popWatch.assetOfTask(running) === popWatch.TABLE, 'tác vụ đang chạy ghi vào bảng gốc');
assert(popWatch.assetOfTask({
  id: 'NEW1',
  description: '',
  destinations: ['projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-diem-new']
}) === popWatch.TABLE_NEW, 'bảng tạm khi đích có hậu tố -new');
assert(popWatch.otherTable(popWatch.TABLE) === popWatch.TABLE_NEW, 'đổi sang bảng tạm');
assert(popWatch.otherTable(popWatch.TABLE_NEW) === popWatch.TABLE, 'đổi về bảng gốc');
assert(popWatch.isBusyState('READY') && popWatch.isBusyState('RUNNING'), 'READY và RUNNING đang bận');
assert(!popWatch.isBusyState('COMPLETED') && !popWatch.isBusyState('FAILED'), 'xong hoặc lỗi thì không bận');
assert(popWatch.csvChanged(null, { md5: 'a', updated: '1' }) === false, 'chưa có dấu vân tay thì chưa coi là đổi');
assert(popWatch.csvChanged({ ingestedMd5: '' }, { md5: 'a', updated: '1' }) === false, 'chưa ghi nhận lần nạp thì không tự nạp lại');
assert(popWatch.csvChanged({ ingestedMd5: 'a', ingestedUpdated: '1' }, { md5: 'b', updated: '1' }) === true, 'md5 khác thì nạp');
assert(popWatch.csvChanged({ ingestedMd5: 'a', ingestedUpdated: '1' }, { md5: 'a', updated: '2' }) === true, 'ngày sửa khác thì nạp');
assert(popWatch.csvChanged({ ingestedMd5: 'a', ingestedUpdated: '1' }, { md5: 'a', updated: '1' }) === false, 'trùng dấu thì không nạp');

const now = 1_800_000_000_000;
const line = popNhaStatusText({
  phase: 'table',
  state: 'RUNNING',
  task: 'R5VL6OZT',
  at: now - 12 * 60 * 1000
}, now);
assert(line.includes('Đang cập nhật dữ liệu dân số mới'), 'câu trạng thái bảng');
assert(line.includes('12 phút'), 'có số phút');
assert(line.includes('…'), 'có dấu chờ');
assert(!/bấm/i.test(line), 'không nhắc bấm');

const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'gee.js'), 'utf8');
assert(!src.includes('POP_NHA_STALE_MS'), 'không còn tự hủy tác vụ chờ lâu');
const fn = src.slice(src.indexOf('async function advancePopNha'), src.indexOf('// ============================ HÌNH HỌC PHƯỜNG'));
assert(fn.includes('async function advancePopNha'), 'cắt đúng hàm');
assert((fn.match(/cancelPopNha\(/g) || []).length === 1, 'chỉ hủy khi bấm Hủy tác vụ');
assert(!fn.includes("beginPopNha('table')"), 'không nạp thêm ở cuối hàm');
assert(fn.includes('liveTable: asset'), 'xong thì trỏ bảng vừa nạp');
assert(fn.includes("body.watch === true") === false, 'cờ watch nằm ở handler, không ở trong hàm');
assert(src.includes('action === \'syncPopNha\''), 'có lịch đồng bộ');
assert(src.includes('watch: body.watch === true'), 'nút và lịch cùng một lối');
assert(!src.includes('promoteNhaAsset'), 'không xóa ảnh đang dùng để đổi tên');

const imageTask = {
  id: 'IMG123',
  state: 'RUNNING',
  description: 'QH-Hue_Pixel-danso-nha',
  sources: [],
  destinations: ['projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-next']
};
assert(popWatch.isPopImageTask(imageTask), 'nhận tác vụ xuất ảnh');
assert(!popWatch.isPopImageTask(running), 'tác vụ bảng không phải ảnh');
assert(popWatch.pickActiveImage([imageTask]) && popWatch.pickActiveImage([imageTask]).id === 'IMG123', 'giữ ảnh đang chạy');
assert(!popWatch.pickActiveImage([{ ...imageTask, state: 'COMPLETED' }]), 'ảnh đã xong không giữ chỗ');
assert(popWatch.imageAssetOfTask(imageTask) === popWatch.IMAGE_NEXT, 'ảnh tạm khi đích có -next');
assert(popWatch.pickActiveTask([imageTask, running]).id === 'R5VL6OZT', 'bảng đang chạy vẫn được nhận khi có ảnh');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const base = html.slice(html.indexOf('id="layerPaneBase"'), html.indexOf('id="layerPaneEnv"'));
assert(!base.includes('aptAdmin') && !base.includes('btnPopNha') && !base.includes('Nạp raster') && !base.includes('Nạp lại'), 'Bản đồ nền không còn nút nạp');
assert(!html.includes('Mở nút nạp raster') && !html.includes('btnPopBake') && !html.includes('Hủy tác vụ'), 'không còn nút nạp tay');
assert(html.includes('id="popNhaLive"'), 'dòng trạng thái nằm ở Quản trị');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'apartmentLayer.js'), 'utf8');
assert(client.includes('Đang cập nhật dữ liệu dân số…'), 'câu trạng thái ngắn');
assert(!client.includes('btnPopNha'), 'giao diện không gắn nút nạp');

console.log('pop-nha-watch: ok');
