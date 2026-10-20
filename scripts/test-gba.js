// Nhóm GBA là tương đối: thẻ không ghi mét chiều cao, có mật độ và giấy phép.
import { GBA_CLASSES, GBA_NOTE, gbaLotKey, gbaStatsHtml } from '../public/js/gbaStats.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(GBA_CLASSES.join('|') === 'Thấp|Trung bình|Cao|Rất cao', 'bốn nhóm');
assert(gbaLotKey('QHPK Kinh thành Huế', 'QH', 'L1') === 'QHPK Kinh thành Huế|QH|L1', 'khóa lô');
const html = gbaStatsHtml([120, 4500, 32.5, 2, 1.8]);
assert(html.includes('Mật độ xây dựng'), 'có mật độ');
assert(html.includes('Cao'), 'nhóm Cao');
assert(html.includes('lần mức trung vị'), 'chỉ số sàn tương đối');
assert(!/chiều cao[^<]{0,40}\d+([.,]\d+)?\s*m\b/i.test(html), 'không ghi mét chiều cao');
assert(gbaStatsHtml([0, 0, 0, null, 0]).includes('Không có dấu chân'), 'lô trống');
const both = gbaStatsHtml([120, 4500, 32.5, 2, 1.8, 80, 3000, 21.4, 46]);
assert(both.includes('Mật độ xây dựng mọi công trình'), 'mật độ toàn bộ');
assert(both.includes('Mật độ xây dựng nhà ở'), 'mật độ nhà ở');
assert(both.includes('46 người'), 'dân số theo sàn nhà ở');
assert(!/chiều cao[^<]{0,40}\d+([.,]\d+)?\s*m\b/i.test(both), 'nhà ở cũng không ghi mét chiều cao');
assert(GBA_NOTE.includes('CC BY-NC 4.0') && GBA_NOTE.includes('ODbL'), 'giấy phép');
assert(GBA_NOTE.includes('không dùng để quản lý'), 'không dùng khống chế chiều cao');
assert(GBA_NOTE.includes('Munich') && GBA_NOTE.includes('Google') && GBA_NOTE.includes('Microsoft'), 'nguồn');
console.log('gba: ok');
