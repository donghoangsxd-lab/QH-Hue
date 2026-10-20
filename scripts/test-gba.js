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
assert(GBA_NOTE.includes('CC BY-NC 4.0') && GBA_NOTE.includes('ODbL'), 'giấy phép');
assert(GBA_NOTE.includes('không dùng để quản lý'), 'không dùng khống chế chiều cao');
assert(GBA_NOTE.includes('Munich') && GBA_NOTE.includes('Google') && GBA_NOTE.includes('Microsoft'), 'nguồn');
console.log('gba: ok');
