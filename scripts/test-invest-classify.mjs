import assert from 'node:assert/strict';
import {
  classifyInvestGroup, isInvestGroupId, normalizeInvestGroupId,
  INVEST_GROUPS
} from '../public/js/investClassify.js';

assert.equal(INVEST_GROUPS.length, 16);
assert.equal(INVEST_GROUPS[0].id, 'sangon');
assert.equal(INVEST_GROUPS[1].id, 'dulich_tm');
assert.equal(INVEST_GROUPS[2].id, 'khu_cn');
assert.equal(INVEST_GROUPS[3].id, 'cum_cn');
assert.equal(INVEST_GROUPS[4].id, 'cnc_dien');
assert.equal(INVEST_GROUPS[5].id, 'khu_dt');
assert.equal(INVEST_GROUPS[6].id, 'kdc_nt');
assert.equal(INVEST_GROUPS[7].id, 'noxh');
assert.equal(INVEST_GROUPS[8].id, 'chungcu_tm');
assert.equal(INVEST_GROUPS[14].id, 'khac');
assert.equal(INVEST_GROUPS[15].id, 'dangnghien');
assert.equal(INVEST_GROUPS[15].label, 'Đang nghiên cứu');
assert.equal(INVEST_GROUPS[10].label, 'Văn hóa - Y tế - Giáo dục');
assert.ok(isInvestGroupId('nangluong'));
assert.ok(isInvestGroupId('dangnghien'));
assert.ok(isInvestGroupId('dvtm'));
assert.equal(normalizeInvestGroupId('nangluong'), 'cnc_dien');
assert.equal(normalizeInvestGroupId('chungcu'), 'chungcu_tm');
assert.equal(normalizeInvestGroupId('dvtm'), 'dulich_tm');
assert.equal(normalizeInvestGroupId('congnghiep'), 'khu_cn');
assert.equal(normalizeInvestGroupId('khudothi'), 'khu_dt');
assert.equal(isInvestGroupId('dien'), false);

const row = (lv, ten) => ({ 'LĨNH VỰC': lv, 'TÊN DỰ ÁN': ten });

// Phân loại lĩnh vực không bao giờ trả về bucket vòng đời.
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ', 'X')), 'dulich_tm');
assert.notEqual(classifyInvestGroup(row('', 'Chưa rõ')), 'dangnghien');

assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Sân gôn Ngũ Hồ')), 'sangon');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Dự án sân Golf Thác Phướn')), 'sangon');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Dự án Khách sạn cao cấp tại Lê Lợi')), 'dulich_tm');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Khu du lịch nghỉ dưỡng Hồ Châu Sơn')), 'dulich_tm');
assert.equal(classifyInvestGroup(row('Du lịch', 'Resort mẫu')), 'dulich_tm');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ', 'Cửa hàng xăng dầu phường Hương An')), 'dulich_tm');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ', 'Khách sạn cạnh sân gôn Kim Long')), 'sangon');

assert.equal(classifyInvestGroup(row('Dịch vụ', 'Bãi đỗ xe')), 'baido');
assert.equal(classifyInvestGroup(row('Dịch vụ đô thị', 'Công viên nghĩa trang sinh thái')), 'congvien');
assert.equal(classifyInvestGroup(row('', 'Bến xe phía Nam')), 'benxe');

assert.equal(classifyInvestGroup(row('Cảng biển', 'Bến số 7, 8')), 'khac');
assert.equal(classifyInvestGroup(row('Hạ tầng kỹ thuật', 'HTKT mẫu')), 'khac');
assert.equal(classifyInvestGroup(row('Công nghệ thông tin', 'Trung tâm CNTT')), 'cnc_dien');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch; BĐS', 'Hỗn hợp')), 'khac');

assert.equal(classifyInvestGroup(row('Năng lượng', 'Nhà máy điện mặt trời')), 'cnc_dien');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'Cụm CN An Hòa')), 'cum_cn');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'KCN Quảng Vinh')), 'khu_cn');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'Nhà máy mẫu')), 'khu_cn');
assert.equal(classifyInvestGroup(row('Nông nghiệp', 'Trồng sen')), 'nongnghiep');
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Trường học')), 'vanhoaxahoi');
assert.equal(classifyInvestGroup(row('Văn hoá, thể thao', 'Bảo tàng')), 'vanhoaxahoi');
assert.equal(classifyInvestGroup(row('Y tế', 'Phòng khám')), 'vanhoaxahoi');

assert.equal(classifyInvestGroup(row('Bất động sản', 'Khu đô thị Phú Mỹ')), 'khu_dt');
assert.equal(classifyInvestGroup(row('Đô thị', 'Khu đô thị Chân Mây')), 'khu_dt');
assert.equal(classifyInvestGroup(row('Bất động sản', 'Khu dân cư nông thôn mới Lã Lã')), 'kdc_nt');
assert.equal(classifyInvestGroup(row('Bất động sản', 'Khu dân cư Đan Điền')), 'kdc_nt');
assert.equal(classifyInvestGroup(row('Thương mại, Dịch vụ và Du lịch', 'Khu đất TM')), 'dulich_tm');

assert.equal(classifyInvestGroup(row('Bất động sản', 'Chung cư mẫu NOXH')), 'noxh');
assert.equal(classifyInvestGroup(row('Bất động sản', 'Chung cư thương mại Lê Lợi')), 'chungcu_tm');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'X'), 'X', 'nangluong'), 'cnc_dien');
assert.equal(classifyInvestGroup(row('Công nghiệp', 'Y'), 'Y', 'chungcu'), 'chungcu_tm');

// Nhà ở nổi trội hơn lĩnh vực giáo dục; trường học thuần vẫn VHXH.
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Khu nhà ở sinh viên (nhà ở cho thuê)')), 'noxh');
assert.equal(classifyInvestGroup(row('Giáo dục - đào tạo', 'Ký túc xá sinh viên phía Nam')), 'noxh');
assert.equal(classifyInvestGroup(row('Giáo dục và Đào tạo', 'Khu trường học chất lượng cao Thủy Dương')), 'vanhoaxahoi');
assert.equal(
  classifyInvestGroup(row('Giáo dục - đào tạo', 'Các dự án đầu tư cơ sở đào tạo và phát triển nguồn nhân lực chất lượng cao')),
  'vanhoaxahoi'
);

console.log('test-invest-classify: ok');
