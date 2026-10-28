import assert from 'node:assert/strict';
import {
  classifyInvestGroup, classifyDvtmSub, isInvestGroupId, INVEST_GROUPS,
  DVTM_SUBGROUPS, DVTM_SUB_DEFAULT
} from '../public/js/investClassify.js';

assert.equal(INVEST_GROUPS.length, 8);
assert.equal(INVEST_GROUPS[0].id, 'dvtm');
assert.equal(INVEST_GROUPS[7].id, 'khac');
assert.ok(isInvestGroupId('nangluong'));
assert.equal(isInvestGroupId('dien'), false);
assert.equal(DVTM_SUBGROUPS.length, 3);
assert.equal(DVTM_SUB_DEFAULT, 'khachsan');
assert.deepEqual(DVTM_SUBGROUPS.map(g => g.id), ['khachsan', 'xang', 'dvtm-khac']);

const row = (lv, ten) => ({ 'LĨNH VỰC': lv, 'TÊN DỰ ÁN': ten });

assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Khu du lịch nghỉ dưỡng Hồ Châu Sơn')), 'khachsan');
assert.equal(classifyDvtmSub(row('Du lịch', 'Resort mẫu')), 'khachsan');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ', 'Cửa hàng xăng dầu phường Hương An')), 'xang');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ', 'Kho xăng dầu, kho gas')), 'xang');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Khu đất TM')), 'dvtm-khac');
assert.equal(classifyDvtmSub(row('Dịch vụ', 'Bãi đỗ xe')), 'dvtm-khac');

assert.equal(classifyInvestGroup(row('Cảng biển', 'Bến số 7, 8')), 'khac');
assert.equal(classifyInvestGroup(row('Hạ tầng kỹ thuật', 'HTKT mẫu')), 'khac');
assert.equal(classifyInvestGroup(row('Dịch vụ đô thị', 'Công viên nghĩa trang sinh thái')), 'khac');
assert.equal(classifyInvestGroup(row('Công nghệ thông tin', 'Trung tâm CNTT')), 'khac');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch; BĐS', 'Hỗn hợp')), 'khac');

assert.equal(classifyInvestGroup(row('Năng lượng', 'Nhà máy điện mặt trời')), 'nangluong');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'Cụm CN')), 'congnghiep');
assert.equal(classifyInvestGroup(row('Nông nghiệp', 'Trồng sen')), 'nongnghiep');
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Trường học')), 'vanhoaxahoi');
assert.equal(classifyInvestGroup(row('Văn hoá, thể thao', 'Bảo tàng')), 'vanhoaxahoi');
assert.equal(classifyInvestGroup(row('Y tế', 'Phòng khám')), 'vanhoaxahoi');

assert.equal(classifyInvestGroup(row('Bất động sản', 'Khu đô thị Phú Mỹ')), 'khudothi');
assert.equal(classifyInvestGroup(row('Đô thị', 'Khu đô thị Chân Mây')), 'khudothi');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Khu đất TM')), 'dvtm');
assert.equal(classifyInvestGroup(row('Du lịch', 'Resort')), 'dvtm');
assert.equal(classifyInvestGroup(row('Dịch vụ', 'Bãi đỗ xe')), 'dvtm');

assert.equal(classifyInvestGroup(row('Bất động sản', 'Chung cư mẫu NOXH')), 'chungcu');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'X'), 'X', 'nangluong'), 'nangluong');

console.log('test-invest-classify: ok');
