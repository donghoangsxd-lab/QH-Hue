import assert from 'node:assert/strict';
import {
  classifyInvestGroup, classifyDvtmSub, isInvestGroupId, normalizeInvestGroupId,
  INVEST_GROUPS, DVTM_SUBGROUPS, DVTM_SUB_DEFAULT
} from '../public/js/investClassify.js';

assert.equal(INVEST_GROUPS.length, 7);
assert.equal(INVEST_GROUPS[0].id, 'dvtm');
assert.equal(INVEST_GROUPS[5].id, 'khac');
assert.equal(INVEST_GROUPS[6].id, 'dangnghien');
assert.equal(INVEST_GROUPS[6].label, 'Đang nghiên cứu');
assert.equal(INVEST_GROUPS[1].label, 'Công nghiệp, năng lượng');
assert.equal(INVEST_GROUPS[2].label, 'Đô thị, nhà ở');
assert.equal(INVEST_GROUPS[4].label, 'Văn hóa - Y tế - Giáo dục');
assert.ok(isInvestGroupId('nangluong'));
assert.ok(isInvestGroupId('dangnghien'));
assert.equal(normalizeInvestGroupId('nangluong'), 'congnghiep');
assert.equal(normalizeInvestGroupId('chungcu'), 'khudothi');
assert.equal(isInvestGroupId('dien'), false);
assert.equal(DVTM_SUBGROUPS.length, 5);
assert.equal(DVTM_SUB_DEFAULT, 'sangon');
assert.deepEqual(DVTM_SUBGROUPS.map(g => g.id), ['sangon', 'khachsan', 'dulich', 'xang', 'dvtm-khac']);

const row = (lv, ten) => ({ 'LĨNH VỰC': lv, 'TÊN DỰ ÁN': ten });

// Phân loại lĩnh vực không bao giờ trả về bucket vòng đời.
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ', 'X')), 'dvtm');
assert.notEqual(classifyInvestGroup(row('', 'Chưa rõ')), 'dangnghien');

assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Sân gôn Ngũ Hồ')), 'sangon');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Dự án sân Golf Thác Phướn')), 'sangon');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Dự án Khách sạn cao cấp tại Lê Lợi')), 'khachsan');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Khu du lịch nghỉ dưỡng Hồ Châu Sơn')), 'dulich');
assert.equal(classifyDvtmSub(row('Du lịch', 'Resort mẫu')), 'dulich');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ', 'Cửa hàng xăng dầu phường Hương An')), 'xang');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ', 'Kho xăng dầu, kho gas')), 'xang');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ và Du lịch', 'Khu đất TM')), 'dvtm-khac');
assert.equal(classifyDvtmSub(row('Dịch vụ', 'Bãi đỗ xe')), 'dvtm-khac');
assert.equal(classifyDvtmSub(row('Thương mại, Dịch vụ', 'Khách sạn cạnh sân gôn Kim Long')), 'sangon');

assert.equal(classifyInvestGroup(row('Cảng biển', 'Bến số 7, 8')), 'khac');
assert.equal(classifyInvestGroup(row('Hạ tầng kỹ thuật', 'HTKT mẫu')), 'khac');
assert.equal(classifyInvestGroup(row('Dịch vụ đô thị', 'Công viên nghĩa trang sinh thái')), 'khac');
assert.equal(classifyInvestGroup(row('Công nghệ thông tin', 'Trung tâm CNTT')), 'khac');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch; BĐS', 'Hỗn hợp')), 'khac');

assert.equal(classifyInvestGroup(row('Năng lượng', 'Nhà máy điện mặt trời')), 'congnghiep');
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

assert.equal(classifyInvestGroup(row('Bất động sản', 'Chung cư mẫu NOXH')), 'khudothi');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'X'), 'X', 'nangluong'), 'congnghiep');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'Y'), 'Y', 'chungcu'), 'khudothi');

// Nhà ở nổi trội hơn lĩnh vực giáo dục; trường học thuần vẫn VHXH.
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Khu nhà ở sinh viên (nhà ở cho thuê)')), 'khudothi');
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Ký túc xá sinh viên phía Nam')), 'khudothi');
assert.equal(classifyInvestGroup(row('Giáo dục và Đào tạo', 'Khu trường học chất lượng cao Thủy Dương')), 'vanhoaxahoi');
assert.equal(
  classifyInvestGroup(row('Giáo dục - đào tạo', 'Các dự án đầu tư cơ sở đào tạo và phát triển nguồn nhân lực chất lượng cao')),
  'vanhoaxahoi'
);

console.log('test-invest-classify: ok');
