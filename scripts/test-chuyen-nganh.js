const assert = require('assert');
const { classifySector, scaleOf, statusOf, slug } = require('./build-chuyen-nganh');

const cases = [
  ['Mạng lưới giao thông đường bộ', 'giao-thong'],
  ['Bó vỉa', 'giao-thong'],
  ['Mặt cắt', 'giao-thong'],
  ['Hiện trạng mặt cắt', 'giao-thong'],
  ['Cầu giao thông dạng đường', 'giao-thong'],
  ['Mạng lưới cấp nước', 'cap-nuoc'],
  ['Công trình đầu mối cấp nước', 'cap-nuoc'],
  ['Mạng lưới phân phối điện', 'cap-dien'],
  ['Công trình năng lượng', 'cap-dien'],
  ['Công trình cấp điện dạng điểm', 'cap-dien'],
  ['Hướng thoát nước', 'san-nen-thoat-mua'],
  ['Quy hoạch chiều cao', 'san-nen-thoat-mua'],
  ['Mạng lưới thoát nước dạng đường', 'san-nen-thoat-mua'],
  ['Điểm độ cao thoát nước', 'san-nen-thoat-mua'],
  ['Công trình thủy lợi dạng đường', 'san-nen-thoat-mua'],
  ['Công trình tiêu thoát nước', 'san-nen-thoat-mua'],
  ['Phân vùng lưu vực dạng vùng', 'san-nen-thoat-mua'],
  ['Hiện trạng phân lưu thoát nước dạng đường', 'san-nen-thoat-mua'],
  ['Mạng lưới thoát nước thải', 'thoat-nuoc-thai'],
  ['Điểm độ cao thoát nước thải', 'thoat-nuoc-thai'],
  ['Công trình xử lý nước thải dạng điểm', 'thoat-nuoc-thai'],
  ['Phân khu chất thải rắn', 'chat-thai-ran-nghia-trang'],
  ['Mạng lưới nghĩa trang', 'chat-thai-ran-nghia-trang'],
  ['Điểm xử lý chất thải rắn', 'chat-thai-ran-nghia-trang'],
  ['Mạng lưới thông tin liên lạc', 'thong-tin-lien-lac'],
  ['Mạng lưới trạm thông tin dạng điểm', 'thong-tin-lien-lac'],
  ['Hiện trạng sử dụng đất', 'sdd'],
  ['Chức năng sử dụng đất', 'sdd'],
  ['Công trình ngầm dạng đường', 'sdd'],
  ['Ranh giới quy hoạch dạng vùng', 'sdd'],
  ['mangLuoiNghiaTrang', 'chat-thai-ran-nghia-trang'],
  ['congTrinhThuyLoiL', 'san-nen-thoat-mua'],
  ['dinhViRanhGioi', 'sdd'],
  ['Đèn chiếu sáng', 'cap-dien'],
  ['Đường sắt cao tốc', 'giao-thong'],
  ['Đường đồng mức thiết kế', 'san-nen-thoat-mua'],
  ['Chỉ giới đường đỏ', 'sdd'],
  ['Hướng thoát nước thải', 'thoat-nuoc-thai'],
  ['Hướng thoát nước mưa', 'san-nen-thoat-mua']
];

cases.forEach(([name, sector]) => {
  assert.strictEqual(classifySector(name), sector, name);
});
assert.strictEqual(classifySector('Lớp lạ chưa có luật'), undefined);
assert.strictEqual(scaleOf('Quy hoạch giao thông (1-25.000)'), 25000);
assert.strictEqual(scaleOf('Hiện trạng (1:10.000)'), 10000);
assert.strictEqual(statusOf('Hiện trạng (1-25.000)'), 'hien-trang');
assert.strictEqual(statusOf('Quy hoạch cấp nước (1-10.000)'), 'quy-hoach');
assert.strictEqual(slug('Mạng lưới thoát nước thải'), 'mang-luoi-thoat-nuoc-thai');
console.log('ok', cases.length);
