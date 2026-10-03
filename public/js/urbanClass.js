// Bảng theo dõi tiêu chí phân loại đô thị (trang 2 bảng tổng hợp, uiComponents.js › setPart2Page).
// Nghị quyết 111/2025/UBTVQH15 (hiệu lực 01/01/2026): loại I chấm đạt/không đạt theo Phụ lục I;
// loại II, III chấm điểm Bảng 2A Phụ lục II (tối đa 100, công nhận khi ≥ 75 và mỗi tiêu chí đạt điểm tối thiểu — Điều 9).
// Mục tiêu 2030: Quyết định 756/QĐ-UBND ngày 28/02/2026 (điều chỉnh quy hoạch thành phố 2021–2030, tầm nhìn 2050) — 16 đô thị.
// Huế là cố đô, di sản UNESCO: cả 16 đô thị áp Điều 8 khoản 2 điểm d (không cộng hệ số vùng hay miền núi — khoản 3).
// Không xem xét mật độ dân số trên diện tích tự nhiên (2A.II.04) và mật độ trên đất xây dựng cấp xã (2B.II.04); các tiêu chuẩn đó được điểm tối thiểu (Điều 9 khoản 4 điểm a).
// Loại I: đủ 10/15 tiêu chuẩn. Loại II, III: không gian, kiến trúc, cảnh quan giữ nguyên; mức tối thiểu tiêu chuẩn khác = 50%, chỉ khi chưa đạt mức quy định.
import { escapeHtml, fmtNum, ico } from './utils.js';
import { loadRoadTypeLengths, densityArea, loadBuiltAreas } from './wardRoads.js';

export const CLASS_REF = 'Nghị quyết 111/2025/UBTVQH15';
export const PLAN_REF = 'Quyết định 756/QĐ-UBND ngày 28/02/2026';

const N1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const N2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

// adjust: unesco = Điều 8 khoản 2 điểm d. Cả hệ thống Huế dùng một quy định này (khoản 3 không cộng điểm c vùng hay điểm c miền núi).
const HERITAGE = 'Thuộc thành phố cố đô, di sản UNESCO nên áp Điều 8 khoản 2 điểm d, không áp hệ số Bắc Trung Bộ hay miền núi.';
const URBANS = [
  { id: 'hue', name: 'Thành phố Huế', cls: 'I', adjust: 'unesco',
    note: 'Điều 15: Huế tiếp tục là đô thị loại I. Di sản UNESCO: cần tối thiểu 10/15 tiêu chuẩn (vai trò ≥ 4, đô thị hóa ≥ 2, hạ tầng ≥ 4) thay vì 12 (Điều 8 khoản 2 điểm d, Điều 9 khoản 3 điểm a).' },
  { id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II', adjust: 'unesco', unitKind: 'phường',
    units: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An'],
    note: `Đô thị liên phường loại II, khu vực cố đô. ${HERITAGE}` },
  { id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II', adjust: 'unesco', unitKind: 'phường',
    units: ['Thanh Thủy', 'Phú Bài', 'Hương Thủy'],
    note: `Đô thị liên phường loại II. ${HERITAGE}` },
  { id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'III', adjust: 'unesco', unitKind: 'phường, xã',
    units: ['Hương Trà', 'Kim Trà', 'Bình Điền'],
    note: `Đô thị liên phường, xã loại III. ${HERITAGE}` },
  { id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'III', adjust: 'unesco', unitKind: 'phường',
    units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'],
    note: `Đô thị liên phường loại III. ${HERITAGE}` },
  { id: 'hoa-chau', name: 'Đô thị Hóa Châu', cls: 'III', adjust: 'unesco', unitKind: 'phường', units: ['Hóa Châu'],
    note: `Đô thị trong 01 phường. Đánh giá toàn đô thị theo Phụ lục II (Điều 6 khoản 2 điểm a). ${HERITAGE}` },
  { id: 'my-thuong', name: 'Đô thị Mỹ Thượng', cls: 'III', adjust: 'unesco', unitKind: 'phường', units: ['Mỹ Thượng'],
    note: `Đô thị trong 01 phường. ${HERITAGE}` },
  { id: 'chan-may', name: 'Đô thị Chân Mây – Lăng Cô', cls: 'III', adjust: 'unesco', unitKind: 'xã', units: ['Chân Mây - Lăng Cô'],
    note: `Đô thị trong 01 xã. ${HERITAGE}` },
  { id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III', adjust: 'unesco', unitKind: 'xã', units: ['Quảng Điền'],
    note: `Đô thị trong 01 xã. ${HERITAGE}` },
  { id: 'a-luoi-2', name: 'Đô thị A Lưới 2', cls: 'III', adjust: 'unesco', unitKind: 'xã', units: ['A Lưới 2'],
    note: `Đô thị loại III trên xã miền núi. ${HERITAGE}` },
  { id: 'vinh-thanh', name: 'Đô thị mới Vinh Thanh', cls: 'III', adjust: 'unesco', partial: 'Phú Vinh',
    note: `Một phần xã Phú Vinh. Chưa có ranh giới đô thị trong webapp nên không lấy số liệu cả xã để chấm. ${HERITAGE}` },
  { id: 'phu-da', name: 'Đô thị mới Phú Đa', cls: 'III', adjust: 'unesco', partial: 'Phú Vang',
    note: `Một phần xã Phú Vang. Chưa tách ranh giới đô thị. ${HERITAGE}` },
  { id: 'loc-son', name: 'Đô thị mới Lộc Sơn', cls: 'III', adjust: 'unesco', partial: 'Hưng Lộc',
    note: `Một phần xã Hưng Lộc. Chưa tách ranh giới đô thị. ${HERITAGE}` },
  { id: 'khe-tre', name: 'Đô thị mới Khe Tre', cls: 'III', adjust: 'unesco', partial: 'Khe Tre',
    note: `Một phần xã Khe Tre (miền núi). Chưa tách ranh giới đô thị. ${HERITAGE}` },
  { id: 'phu-loc', name: 'Đô thị mới Phú Lộc', cls: 'III', adjust: 'unesco', partial: 'Phú Lộc',
    note: `Một phần xã Phú Lộc. Chưa tách ranh giới đô thị. ${HERITAGE}` },
  { id: 'vinh-hien', name: 'Đô thị mới Vinh Hiền', cls: 'III', adjust: 'unesco', partial: 'Vinh Lộc',
    note: `Một phần xã Vinh Lộc. Chưa tách ranh giới đô thị. ${HERITAGE}` }
];

// Bảng 2A. kind: pop / dens để chọn hệ số Điều 8; landscape = nhóm không gian, kiến trúc, cảnh quan (không giảm khi áp 8.2.d).
// band theo đơn vị hiển thị (dân số = người). qual = tiêu chuẩn chữ, chưa chấm điểm.
const GROUP_2A = {
  I: 'I. Vai trò, vị trí và điều kiện phát triển kinh tế - xã hội — điểm tối thiểu 11,5 / tối đa 15',
  II: 'II. Mức độ đô thị hóa — điểm tối thiểu 15,5 / tối đa 20',
  III: 'III. Trình độ phát triển hạ tầng và tổ chức không gian đô thị — điểm tối thiểu 48 / tối đa 65'
};

const STD_2A = [
  { code: '2A.I.01', group: 'I', name: 'Vai trò, vị trí theo quy hoạch được phê duyệt (trung tâm tổng hợp hoặc chuyên ngành)',
    qual: { II: { hi: 'Cấp vùng', lo: 'Cấp tỉnh' }, III: { hi: 'Cấp tỉnh', lo: 'Cấp xã' } }, pts: { hi: 7, lo: 5.5 } },
  { code: '2A.I.02', group: 'I', name: 'Vai trò đô thị trung tâm: trụ sở, hạ tầng đã đầu tư, là trung tâm hoặc đầu mối kết nối',
    qual: { II: { hi: 'Cấp vùng', lo: 'Cấp tỉnh' }, III: { hi: 'Cấp tỉnh', lo: 'Cấp xã' } }, pts: { hi: 8, lo: 6 } },
  { code: '2A.II.03', group: 'II', calc: 'pop', kind: 'pop', name: 'Quy mô dân số đô thị', unit: 'người',
    band: { II: { hi: 500000, lo: 200000 }, III: { hi: 200000, lo: 20000 } }, pts: { hi: 7, lo: 5.5 },
    method: 'P = dân số thường trú + tạm trú (Phụ lục III). Webapp dùng dân số hiện trạng của các phường/xã, chưa tách tạm trú.' },
  { code: '2A.II.04', group: 'II', calc: 'dens', kind: 'dens', exempt: true, name: 'Mật độ dân số bình quân trên diện tích tự nhiên', unit: 'người/km²',
    band: { II: { hi: 1500, lo: 1000 }, III: { hi: 1000, lo: 500 } }, pts: { hi: 6, lo: 4.5 },
    method: 'D = P / diện tích tự nhiên (km²). Điều 8 khoản 2 điểm d: không xem xét tiêu chuẩn này với đô thị di sản; Điều 9 khoản 4 điểm a tính điểm tối thiểu. Mật độ trên đất xây dựng của cấp xã (2B.II.04) cũng không xem xét; webapp chưa chấm Bảng 2B.' },
  { code: '2A.II.05', group: 'II', name: 'Tỷ lệ lao động phi nông nghiệp', unit: '%',
    band: { II: { hi: 95, lo: 65 }, III: { hi: 65, lo: 55 } }, pts: { hi: 7, lo: 5.5 } },
  { code: '2A.III.06', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Đầu mối giao thông (cảng hàng không, cảng, ga, bến xe liên tỉnh)',
    qual: { II: { hi: 'Cấp vùng', lo: 'Cấp tỉnh' }, III: { hi: 'Cấp tỉnh', lo: 'Cấp xã' } }, pts: { hi: 4, lo: 3 } },
  { code: '2A.III.07', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', calc: 'roads', inherit: 'OSM', name: 'Mật độ đường giao thông đô thị', unit: 'km/km²',
    band: { II: { hi: 8, lo: 6 }, III: { hi: 6, lo: 4 } }, pts: { hi: 5, lo: 4 },
    method: 'G = tổng chiều dài đường đô thị / diện tích đất xây dựng đô thị. Kế thừa mạng lưới đường đang có: trục chính + khu vực + nội bộ (OpenStreetMap và tuyến Admin) / đất xây dựng Dynamic World. Không gồm đường xe đạp (chỉ tiêu 0206 là tỷ lệ riêng, không phải tiêu chuẩn này).' },
  { code: '2A.III.08', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Tỷ lệ dân số được cấp nước sạch tập trung', unit: '%',
    band: { II: { hi: 100, lo: 90 }, III: { hi: 95, lo: 85 } }, pts: { hi: 3, lo: 2 } },
  { code: '2A.III.09', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Mật độ đường cống thoát nước chính', unit: 'km/km²',
    band: { II: { hi: 4.5, lo: 3.5 }, III: { hi: 3.5, lo: 3 } }, pts: { hi: 3, lo: 2 } },
  { code: '2A.III.10', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Công suất vận hành trạm xử lý nước thải so với công suất thiết kế theo quy hoạch', unit: '%',
    band: { II: { hi: 80, lo: 60 }, III: { hi: 70, lo: 50 } }, pts: { hi: 1, lo: 0.75 } },
  { code: '2A.III.11', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Tỷ lệ chất thải rắn sinh hoạt được xử lý đạt yêu cầu môi trường', unit: '%',
    band: { II: { hi: 90, lo: 80 }, III: { hi: 80, lo: 70 } }, pts: { hi: 3, lo: 2 } },
  { code: '2A.III.12', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', name: 'Tỷ lệ diện tích nghĩa trang nhân dân được xây dựng theo quy hoạch', unit: '%',
    band: { II: { hi: 80, lo: 60 }, III: { hi: 70, lo: 50 } }, pts: { hi: 3, lo: 2 } },
  { code: '2A.III.13', group: 'III', sub: 'III.1 Hạ tầng kỹ thuật', calc: 'funeral', inherit: 'QCVN 12-NT', name: 'Nhà tang lễ', unit: 'cơ sở',
    band: { II: { hi: 2, lo: 1 }, III: { hi: 1, lo: 1 } }, pts: { hi: 3, lo: 2.5 },
    method: 'Đếm nhà tang lễ đã duyệt, cùng lớp 12-NT của quy chuẩn (QCVN 01:2026 Bảng 23). Loại III: mức tối thiểu là có dự án, mức tối đa là ≥ 1 cơ sở.' },
  { code: '2A.III.14', group: 'III', sub: 'III.2 Hạ tầng xã hội', name: 'Số giường bệnh (không gồm trạm y tế cấp xã)', unit: 'giường/10.000 dân',
    band: { II: { hi: 40, lo: 35 }, III: { hi: 35, lo: 30 } }, pts: { hi: 5, lo: 3.75 } },
  { code: '2A.III.15', group: 'III', sub: 'III.2 Hạ tầng xã hội', calc: 'edu', inherit: 'QCVN THPT', name: 'Cơ sở giáo dục, đào tạo', unit: 'cơ sở',
    band: { II: { hi: 25, lo: 10 }, III: { hi: 10, lo: 1 } }, pts: { hi: 5, lo: 3.75 },
    method: 'Gồm đại học, cao đẳng, THPT, trung cấp và dạy nghề. Kế thừa mã THPT đã duyệt — cận dưới. Mầm non, tiểu học, THCS là chỉ tiêu đơn vị ở, không cộng vào tiêu chuẩn này.' },
  { code: '2A.III.16', group: 'III', sub: 'III.2 Hạ tầng xã hội', calc: 'culture', inherit: 'QCVN 7-VH', name: 'Công trình văn hóa', unit: 'công trình',
    band: { II: { hi: 20, lo: 10 }, III: { hi: 10, lo: 2 } }, pts: { hi: 5, lo: 3.75 },
    method: 'Thư viện, bảo tàng, nhà hát, nhà văn hóa, di tích, tượng đài... Kế thừa mã 7-VH đã duyệt — cận dưới, vì cùng nhóm còn công trình thể thao (tiêu chuẩn 2A.III.17 chưa tách được).' },
  { code: '2A.III.17', group: 'III', sub: 'III.2 Hạ tầng xã hội', name: 'Công trình thể dục, thể thao', unit: 'công trình',
    band: { II: { hi: 10, lo: 5 }, III: { hi: 5, lo: 2 } }, pts: { hi: 4, lo: 3 },
    method: 'Chưa tách khỏi nhóm văn hóa – thể thao nên chưa chấm.' },
  { code: '2A.III.18', group: 'III', sub: 'III.2 Hạ tầng xã hội', calc: 'commerce', inherit: 'QCVN 8-TM', name: 'Công trình thương mại, dịch vụ', unit: 'công trình',
    band: { II: { hi: 10, lo: 5 }, III: { hi: 5, lo: 2 } }, pts: { hi: 3, lo: 2 },
    method: 'Chợ, siêu thị, trung tâm thương mại cấp đô thị. Kế thừa mã 8-TM đã duyệt.' },
  { code: '2A.III.19', group: 'III', sub: 'III.2 Hạ tầng xã hội', calc: 'service', inherit: 'QCVN THPT, 6-YT, 7-VH, 8-TM', name: 'Đất công trình dịch vụ – công cộng bình quân đầu người', unit: 'm²/người',
    band: { II: { hi: 3, lo: 2 }, III: { hi: 2, lo: 1.5 } }, pts: { hi: 3, lo: 2 },
    method: 'Tổng đất y tế, văn hóa, giáo dục, thể thao, thương mại / dân số. Kế thừa diện tích đã duyệt của THPT, 6-YT, 7-VH, 8-TM — cận dưới, chưa tách sân thể thao.' },
  { code: '2A.III.20', group: 'III', sub: 'III.3 Không gian, kiến trúc, cảnh quan', calc: 'green2', landscape: true, inherit: 'QCVN 1-CV · 0304',
    name: 'Không gian xanh sử dụng công cộng quy mô từ 2 ha', unit: 'khu',
    band: { II: { hi: 4, lo: 2 }, III: { hi: 2, lo: 1 } }, pts: { hi: 4, lo: 3 },
    method: 'Cùng danh sách công viên, vườn hoa mã 1-CV (chỉ tiêu 0304 đếm mọi công viên). Tiêu chuẩn này chỉ tính khu ≥ 20.000 m². Công trình chưa rõ diện tích không được tính — cận dưới. Chưa có lớp quảng trường, phố đi bộ.' },
  { code: '2A.III.21', group: 'III', sub: 'III.3 Không gian, kiến trúc, cảnh quan', landscape: true,
    name: 'Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên', unit: '%',
    band: { both: { hi: 35, lo: 25 } }, pts: { hi: 3, lo: 2 },
    method: 'Rừng, nông lâm nghiệp, cây xanh công cộng và phủ xanh khác trên diện tích tự nhiên. Chưa có lớp phủ xanh đủ để tính.' },
  { code: '2A.III.22', group: 'III', sub: 'III.3 Không gian, kiến trúc, cảnh quan', calc: 'greenCap', landscape: true, inherit: 'QCVN 1-CV · 0201',
    name: 'Đất cây xanh sử dụng công cộng trong khu vực dân dụng đô thị', unit: 'm²/người',
    band: { II: { hi: 8, lo: 6 }, III: { hi: 7, lo: 2.5 } }, pts: { hi: 3, lo: 2.5 },
    method: 'Cùng công viên mã 1-CV. Chỉ tiêu 0201 cộng cả vườn hoa đơn vị ở ở nội thành; tiêu chuẩn này chỉ lấy công viên cấp đô thị / dân số đô thị. Công viên chưa rõ diện tích làm cận dưới.' },
  { code: '2A.III.23', group: 'III', sub: 'III.3 Không gian, kiến trúc, cảnh quan', landscape: true,
    name: 'Quy chế quản lý kiến trúc đô thị',
    qual: { both: { hi: 'Đã thực hiện từ 03 năm trở lên', lo: 'Đã thực hiện từ 01 đến 03 năm' } }, pts: { hi: 5, lo: 4 } }
];

const GROUP_I = {
  I: 'I. Vai trò, vị trí và điều kiện phát triển kinh tế - xã hội — cần ≥ 4/6 tiêu chuẩn',
  II: 'II. Mức độ đô thị hóa — cần ≥ 2/4 tiêu chuẩn',
  III: 'III. Trình độ phát triển hạ tầng và tổ chức không gian đô thị — cần ≥ 4/5 tiêu chuẩn'
};

const STD_I = [
  { code: '1.I.01', group: 'I', name: 'Đã đầu tư một khu chức năng hoặc thuộc khu chức năng cấp quốc gia, quốc tế' },
  { code: '1.I.02', group: 'I', name: 'Trung tâm tổ chức ≥ 2 sự kiện quốc tế cấp khu vực trở lên, bình quân 3 năm gần nhất' },
  { code: '1.I.03', group: 'I', name: 'Thu nhập bình quân đầu người cao hơn cả nước trong 3 năm gần nhất' },
  { code: '1.I.04', group: 'I', name: 'Tốc độ tăng GRDP 3 năm gần nhất đạt hoặc vượt tốc độ tăng GDP' },
  { code: '1.I.05', group: 'I', name: 'Thu hút đầu tư trong nước hoặc FDI thuộc nhóm 10 địa phương đứng đầu' },
  { code: '1.I.06', group: 'I', name: 'Không nhận bổ sung cân đối từ ngân sách trung ương' },
  { code: '1.II.07', group: 'II', calc: 'iPop', name: 'Quy mô dân số đô thị ≥ 2.500.000 người', target: '≥ 2.500.000 người' },
  { code: '1.II.08', group: 'II', calc: 'iRate', name: 'Tỷ lệ đô thị hóa từ 45%', target: '≥ 45%',
    method: 'Dân số các đô thị loại II, III được công nhận / dân số đô thị loại I. Webapp ước tính theo phạm vi QĐ 756, chưa gồm 6 đô thị một phần xã.' },
  { code: '1.II.09', group: 'II', calc: 'iPop2', name: 'Tổng quy mô dân số các đô thị loại II ≥ 600.000 người', target: '≥ 600.000 người' },
  { code: '1.II.10', group: 'II', name: '≥ 50% số phường đạt trình độ phát triển đô thị loại II', target: '≥ 50% số phường',
    method: 'Chấm theo Bảng 2B loại II. Webapp chưa chấm Bảng 2B.' },
  { code: '1.III.11', group: 'III', name: '≥ 2 đầu mối giao thông cấp khu vực và quốc tế, cửa ngõ, trung tâm kết nối vùng' },
  { code: '1.III.12', group: 'III', calc: 'iBus', inherit: 'QCVN 10-BUS · 0204', name: 'Giao thông hành khách công cộng bao phủ 100% đô thị loại II', target: '≥ 100% đô thị loại II',
    method: 'Đường sắt đô thị, xe buýt hoặc tàu thủy bao phủ 100% đô thị loại II. Kế thừa trạm dừng đã duyệt (QCVN 01:2026 Mục 2.8.3.3, mã 10-BUS). Chỉ tiêu 0204 là tỷ lệ hành khách, chưa có số liệu. Webapp đếm trạm trong phạm vi, chưa tính dân số trong 500 m, nên chưa kết luận đạt.' },
  { code: '1.III.13', group: 'III', name: '≥ 5 công trình, khu nhà ở, khu đô thị đạt giải thưởng quốc gia, quốc tế' },
  { code: '1.III.14', group: 'III', name: 'Đô thị thông minh mức độ 1, hoặc 50% đô thị loại II, III chống chịu khí hậu mức khá trở lên' },
  { code: '1.III.15', group: 'III', name: 'Hoàn thành nông thôn mới theo giai đoạn gần nhất đã được công nhận' }
];

const LEVEL_TEXT = { hi: 'Đạt mức tối đa', mid: 'Đạt mức tối thiểu', adj: 'Đạt sau giảm mức tối thiểu', skip: 'Không xem xét', no: 'Chưa đạt', part: 'Một phần, chưa chấm', wait: 'Chờ số liệu', na: 'Chưa tách ranh' };

const bare = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[-–—]/g, ' ')
  .replace(/\s+/g, ' ').trim().toUpperCase()
  .replace(/^(PHUONG|XA)\s+/, '');

const bandOf = (std, cls) => (std.band && (std.band.both || std.band[cls])) || null;
const qualOf = (std, cls) => (std.qual && (std.qual.both || std.qual[cls])) || null;

const densityExempt = (urban, std) => urban.adjust === 'unesco' && !!std.exempt;

function floorFactor(urban, std) {
  // Loại II, III di sản: cảnh quan giữ nguyên; tiêu chuẩn khác = 50% mức tối thiểu (Điều 8 khoản 2 điểm d).
  if (urban.adjust === 'unesco' && urban.cls !== 'I') return std.landscape ? 1 : 0.5;
  return 1;
}

function adjustedFloor(std, urban) {
  const b = bandOf(std, urban.cls);
  if (!b) return null;
  const factor = floorFactor(urban, std);
  if (!(factor < 1)) return b.lo;
  // Điều 9 khoản 4 điểm b: tiêu chuẩn đếm công trình, mức tối thiểu 1 thì vẫn cần 1; từ 2 trở lên thì giảm theo tỷ lệ, làm tròn, không dưới 1
  if (/cơ sở|công trình|khu/i.test(std.unit || '')) {
    if (b.lo <= 1) return b.lo;
    return Math.max(1, Math.round(b.lo * factor));
  }
  return b.lo * factor;
}

function bandScore(value, lo, hi, loPts, hiPts, factor) {
  const floor = lo * factor;
  if (value >= hi) return { pts: hiPts, level: 'hi' };
  if (hi !== lo && value >= lo) return { pts: loPts + (hiPts - loPts) * (value - lo) / (hi - lo), level: 'mid' };
  if (value + 1e-9 >= floor) return { pts: loPts, level: factor < 1 && value < lo ? 'adj' : 'mid' };
  return { pts: 0, level: 'no' };
}

function wardsOf(urban, wards) {
  if (urban.cls === 'I') return wards;
  const want = new Set((urban.units || []).map(bare));
  return wards.filter(w => want.has(bare(w.Ten_Phuong)));
}

function containsWard(urban, wardName) {
  if (!wardName || urban.cls === 'I') return false;
  const b = bare(wardName);
  if (urban.partial && bare(urban.partial) === b) return true;
  return (urban.units || []).some(u => bare(u) === b);
}

const urbanByWard = (wardName) => URBANS.find(u => containsWard(u, wardName)) || null;

function itemsOf(wards, pairs) {
  const out = [];
  wards.forEach(w => pairs.forEach(([bucket, key]) => {
    ((w[bucket] && w[bucket][key] && w[bucket][key].subItems) || []).forEach(s => out.push(s));
  }));
  return out;
}

function areaOf(wards, pairs) {
  return wards.reduce((s, w) => s + pairs.reduce((t, [bucket, key]) => t + (Number(w[bucket]?.[key]?.currentArea) || 0), 0), 0);
}

const popOf = (wards) => wards.reduce((s, w) => s + (Number(w.Dan_So_Vector) || 0), 0);
const areaKmOf = (wards) => wards.reduce((s, w) => s + (Number(w.Dien_Tich_Km2) || 0), 0);

function measure(calc, urban, wards, roads) {
  const list = wardsOf(urban, wards);
  const pop = popOf(list);
  const missing = (urban.units || []).length - list.length;
  if (urban.cls !== 'I' && missing > 0) return { pending: true, note: `Thiếu số liệu ${missing} đơn vị trong phạm vi đô thị` };
  if (calc === 'pop') {
    return { value: pop, note: `${fmtNum(pop)} người trên ${list.length} đơn vị. ${STD_2A.find(s => s.calc === 'pop').method}` };
  }
  if (calc === 'dens') {
    const km = areaKmOf(list);
    if (!(km > 0)) return { pending: true, note: 'Chưa có diện tích tự nhiên' };
    return { value: pop / km, note: `${fmtNum(pop)} người / ${N1.format(km)} km²` };
  }
  if (calc === 'roads') {
    if (!roads) return { pending: true, note: 'Đang tải mạng lưới đường' };
    let km = 0, built = 0, have = 0, natural = 0, wait = false;
    list.forEach(w => {
      const t = roads[w.Ten_Phuong];
      const a = densityArea(w.Ten_Phuong, Number(w.Dien_Tich_Km2) || 0);
      if (!t) return;
      if (!a) { wait = true; return; }
      have++;
      km += (Number(t.main) || 0) + (Number(t.kiet) || 0);
      built += a.km2;
      if (!a.built) natural++;
    });
    if (wait || have < list.length || natural || !(built > 0)) {
      return {
        pending: true,
        note: wait ? 'Đang tải diện tích đất xây dựng' : (natural
          ? 'Chưa đủ đất xây dựng theo Dynamic World, không chấm mật độ trên diện tích tự nhiên'
          : `Mới có mạng lưới đường ${have}/${list.length} đơn vị`)
      };
    }
    return { value: km / built, note: `${N1.format(km)} km đường đô thị / ${N1.format(built)} km² đất xây dựng` };
  }
  if (calc === 'funeral') {
    const n = list.reduce((s, w) => s + ((w.network && w.network.nt) || []).filter(it => it.ntKind === 'funeral').length, 0);
    return { value: n, note: 'Nhà tang lễ đã duyệt trong phạm vi đô thị' };
  }
  if (calc === 'edu') {
    const n = itemsOf(list, [['urbanResults', 'THPT']]).length;
    return { value: n, partial: true, note: STD_2A.find(s => s.calc === 'edu').method };
  }
  if (calc === 'culture') {
    const n = itemsOf(list, [['urbanResults', 'VH_DT'], ['unitResults', 'VH_DV']]).length;
    return { value: n, partial: true, note: STD_2A.find(s => s.calc === 'culture').method };
  }
  if (calc === 'commerce') {
    const n = itemsOf(list, [['urbanResults', 'TM_DT'], ['unitResults', 'TM_DV']]).length;
    return { value: n, note: STD_2A.find(s => s.calc === 'commerce').method };
  }
  if (calc === 'service') {
    const pairs = [['urbanResults', 'THPT'], ['urbanResults', 'YT_DT'], ['unitResults', 'YT_DV'], ['urbanResults', 'VH_DT'], ['unitResults', 'VH_DV'], ['urbanResults', 'TM_DT'], ['unitResults', 'TM_DV']];
    const rows = itemsOf(list, pairs);
    const unknown = rows.some(s => !(Number(s.size) > 0));
    if (!(pop > 0)) return { pending: true, note: 'Chưa có dân số' };
    return { value: areaOf(list, pairs) / pop, partial: true, note: `${STD_2A.find(s => s.calc === 'service').method}${unknown ? ' Có công trình chưa rõ diện tích.' : ''}` };
  }
  if (calc === 'green2') {
    const rows = itemsOf(list, [['urbanResults', 'CV_DT'], ['unitResults', 'CV_DV']]);
    const unknown = rows.filter(s => !(Number(s.size) > 0)).length;
    const n = rows.filter(s => Number(s.size) >= 20000).length;
    return { value: n, partial: unknown > 0, note: `${n} khu ≥ 2 ha${unknown ? `; ${unknown} công trình chưa rõ diện tích` : ''}` };
  }
  if (calc === 'greenCap') {
    const rows = itemsOf(list, [['urbanResults', 'CV_DT']]);
    const unknown = rows.some(s => !(Number(s.size) > 0));
    if (!(pop > 0)) return { pending: true, note: 'Chưa có dân số' };
    return { value: areaOf(list, [['urbanResults', 'CV_DT']]) / pop, partial: unknown, note: STD_2A.find(s => s.calc === 'greenCap').method };
  }
  return null;
}

function judge(std, urban, m) {
  if (densityExempt(urban, std)) return { level: 'skip', pts: urban.partial ? null : std.pts.lo };
  if (urban.partial) return { level: 'na', pts: null };
  if (!std.calc) return { level: 'wait', pts: null };
  if (!m || m.pending || m.value == null) return { level: 'wait', pts: null };
  if (std.code === '2A.III.13' && urban.cls === 'III' && m.value < 1) return { level: 'wait', pts: null };
  const b = bandOf(std, urban.cls);
  if (!b) return { level: 'wait', pts: null };
  const floor = adjustedFloor(std, urban);
  const scored = bandScore(m.value, b.lo, b.hi, std.pts.lo, std.pts.hi, b.lo ? floor / b.lo : 1);
  if (m.partial && scored.level === 'no') return { level: 'part', pts: null };
  return { ...scored, lower: !!m.partial };
}

function targetText(std, urban, which) {
  if (densityExempt(urban, std)) return 'Không xem xét';
  const q = qualOf(std, urban.cls);
  if (q) return q[which];
  const b = bandOf(std, urban.cls);
  if (!b) return '—';
  const n = which === 'hi' ? b.hi : adjustedFloor(std, urban);
  const unit = std.unit ? ` ${std.unit}` : '';
  const cut = which === 'lo' && n < b.lo ? ` (${N0pct(n / b.lo)} mức quy định)` : '';
  return `${fmtNum(n)}${unit}${cut}`;
}

const N0pct = (f) => `${Math.round(f * 100)}%`;

function typeIFacts(wards) {
  const pop = popOf(wards);
  const popUrban = (u) => popOf(wardsOf(u, wards));
  const pop2 = URBANS.filter(u => u.cls === 'II').reduce((s, u) => s + popUrban(u), 0);
  const popFull = URBANS.filter(u => u.cls === 'II' || (u.cls === 'III' && !u.partial)).reduce((s, u) => s + popUrban(u), 0);
  const bus2 = URBANS.filter(u => u.cls === 'II').map(u => ({
    name: u.name.replace('Khu vực đô thị ', ''),
    n: wardsOf(u, wards).reduce((s, w) => s + ((w.network && w.network.bus) || []).length, 0)
  }));
  return { pop, pop2, rate: pop > 0 ? popFull / pop * 100 : null, bus2 };
}

function judgeI(std, facts) {
  if (std.calc === 'iPop') {
    const ok = facts.pop >= 2500000;
    return { level: ok ? 'hi' : 'no', text: `${fmtNum(facts.pop)} người`, note: 'Dân số hiện trạng toàn thành phố, chưa tách thường trú và tạm trú.' };
  }
  if (std.calc === 'iPop2') {
    const ok = facts.pop2 >= 600000;
    return { level: ok ? 'hi' : 'no', text: `${fmtNum(facts.pop2)} người`, note: 'Tổng dân số hiện trạng khu vực trung tâm và Hương Thủy.' };
  }
  if (std.calc === 'iBus') {
    const rows = facts.bus2 || [];
    if (!rows.length) return { level: 'wait', text: '—', note: std.method };
    return {
      level: 'part',
      text: rows.map(r => `${r.name} ${fmtNum(r.n)} trạm`).join(' · '),
      note: std.method
    };
  }
  if (std.calc === 'iRate') {
    if (facts.rate == null) return { level: 'wait', text: '—' };
    const ok = facts.rate >= 45;
    return {
      level: ok ? 'hi' : 'part',
      text: `≥ ${N1.format(facts.rate)}%`,
      note: std.method
    };
  }
  return { level: 'wait', text: '—', note: std.method || '' };
}

const levelCls = (level) => (level === 'hi' ? 'c-green' : (level === 'no' ? 'c-red' : (level === 'skip' || level === 'wait' || level === 'na' ? 'uc-skip' : 'c-orange')));

function scopeLabel(urban) {
  if (urban.cls === 'I') return 'Toàn thành phố';
  if (urban.partial) return `Một phần xã ${urban.partial}`;
  return `${urban.units.length} ${urban.unitKind}`;
}

function scopeTitle(urban) {
  if (urban.cls === 'I') return 'Phạm vi đô thị loại I là toàn thành phố. 15 đô thị còn lại nằm trong thành phố.';
  if (urban.partial) return urban.note;
  return `${(urban.units || []).join(', ')}.\n${urban.note}`;
}

let roadsPromise = null;
let roads = null;
let mode = 'auto';
let seenKey = null;

function loadRoads(force = false) {
  if (force) roadsPromise = null;
  if (!roadsPromise) {
    roadsPromise = loadRoadTypeLengths()
      .then(r => { roads = r; return r; })
      .catch(err => { roadsPromise = null; throw err; });
  }
  return roadsPromise;
}

const measured = new Map();

function readMeasure(std, urban, wards) {
  const key = `${urban.id}:${std.calc}`;
  if (!measured.has(key)) measured.set(key, measure(std.calc, urban, wards, roads));
  return measured.get(key);
}

function overviewCells(urban, wards) {
  if (urban.cls === 'I') {
    const facts = typeIFacts(wards);
    const popCls = facts.pop >= 2500000 ? 'c-green' : 'c-red';
    const dash = '<td class="uc-val" title="Phụ lục I không có tiêu chuẩn mật độ. Với cấp xã trong thành phố, Điều 8 khoản 2 điểm d cũng không xem xét mật độ dân số."><span class="gtx-na">—</span></td>';
    const rate = facts.rate == null ? '—' : `≥ ${N1.format(facts.rate)}%`;
    const rateCls = facts.rate >= 45 ? 'c-green' : 'c-orange';
    return {
      cells: `<td class="uc-val" title="Mục tiêu 1.II.07: ≥ 2.500.000 người"><b class="${popCls}">${fmtNum(facts.pop)}</b> <span class="c-muted">/ 2.500.000</span></td>${dash}${dash}${dash}${dash}`,
      track: `<span class="${facts.pop2 >= 600000 ? 'c-green' : 'c-red'}">Loại II ${fmtNum(facts.pop2)}</span> <span class="c-muted">/ 600.000</span><br><span class="${rateCls}" title="${escapeHtml(STD_I.find(s => s.code === '1.II.08').method)}">Đô thị hóa ${rate}</span>`
    };
  }
  const codes = ['2A.II.03', '2A.II.04', '2A.III.07', '2A.III.20', '2A.III.22'];
  const bits = [];
  let pts = 0, max = 0, met = 0, evaluated = 0, pending = false;
  STD_2A.forEach(std => {
    if (!std.calc || urban.partial) return;
    const m = readMeasure(std, urban, wards);
    const j = judge(std, urban, m);
    if (j.level === 'wait' && m && m.pending) pending = true;
    if (j.pts == null) return;
    pts += j.pts; max += std.pts.hi; evaluated++;
    if (j.level === 'hi' || j.level === 'mid' || j.level === 'adj' || j.level === 'skip') met++;
  });
  const cells = codes.map(code => {
    const std = STD_2A.find(s => s.code === code);
    const b = bandOf(std, urban.cls);
    const tip = `${std.name}. Mục tiêu ${targetText(std, urban, 'hi')}. Mức tối thiểu ${targetText(std, urban, 'lo')}. ${std.method || ''}`;
    if (densityExempt(urban, std)) {
      const m = urban.partial ? null : readMeasure(std, urban, wards);
      const measured = m && m.value != null ? ` Số đo tham khảo: ${fmtNum(m.value)} ${std.unit}.` : '';
      return `<td class="uc-val" title="${escapeHtml(`${tip}${measured} Tính ${fmtNum(std.pts.lo)} điểm tối thiểu, không chấm đạt hay chưa đạt.`)}"><span class="uc-skip">Không xem xét</span></td>`;
    }
    if (urban.partial) return `<td class="uc-val" title="${escapeHtml(tip)}"><span class="gtx-na">—</span></td>`;
    const m = readMeasure(std, urban, wards);
    const j = judge(std, urban, m);
    if (!m || m.pending || m.value == null) return `<td class="uc-val" title="${escapeHtml(m?.note || tip)}"><span class="gtx-wait">${ico('clock')}</span></td>`;
    const mark = j.lower ? '≥ ' : '';
    return `<td class="uc-val" title="${escapeHtml(`${tip}\n${m.note || ''}\n${LEVEL_TEXT[j.level]}`)}"><b class="${levelCls(j.level)}">${mark}${fmtNum(m.value)}</b> <span class="c-muted">/ ${fmtNum(b.hi)}</span></td>`;
  }).join('');
  const track = urban.partial
    ? '<span class="gtx-na">Chưa tách ranh</span>'
    : (evaluated
      ? `<b title="${escapeHtml(`Đã chấm ${evaluated} tiêu chuẩn webapp tính được, tối đa ${N1.format(max)} điểm của các tiêu chuẩn đó. Ngưỡng công nhận cả Bảng 2A là 75/100.${pending ? ' Mật độ đường hoặc số liệu khác vẫn đang tải.' : ''}`)}">${N1.format(pts)} đ</b> <span class="c-muted">${met}/${evaluated}</span>`
      : `<span class="gtx-wait">${ico('clock')}</span>`);
  return { cells, track };
}

function overviewHtml(wards, wardName) {
  const outside = wardName ? !urbanByWard(wardName) : false;
  const banner = outside
    ? `<div class="uc-note">${ico('info')} ${escapeHtml(wardName)} không thuộc 15 đô thị loại II, III đến năm 2030. Bảng dưới là cả hệ thống.</div>`
    : '';
  const rows = URBANS.map((urban, i) => {
    const here = containsWard(urban, wardName);
    const view = overviewCells(urban, wards);
    return `<tr class="${here ? 'uc-here' : ''}">
      <td>${i + 1}</td>
      <td class="uc-name"><button type="button" class="uc-link" data-uc="${urban.id}" title="Xem đủ tiêu chuẩn">${escapeHtml(urban.name)}</button></td>
      <td><b class="uc-${urban.cls}">${urban.cls === 'I' ? 'I' : urban.cls}</b></td>
      <td class="uc-scope" title="${escapeHtml(scopeTitle(urban))}">${escapeHtml(scopeLabel(urban))}</td>
      ${view.cells}
      <td class="uc-val">${view.track}</td>
    </tr>`;
  }).join('');
  return `${banner}<div class="uc-bar">
      <span class="uc-summary" title="${escapeHtml(`${PLAN_REF}: đến 2030 có 16 đô thị (1 loại I, 2 loại II, 13 loại III). Tiêu chuẩn ${CLASS_REF}. Xanh = đạt mức tối đa, vàng = đạt mức tối thiểu hoặc sau Điều 8, đỏ = chưa đạt. Bấm tên đô thị để xem đủ tiêu chuẩn.`)}">
        <b>16 đô thị</b> đến 2030 · di sản UNESCO · QĐ 756</span>
        <span class="uc-legend"><span class="c-green">Đạt tối đa</span><span class="c-orange">Đạt tối thiểu</span><span class="uc-skip">Không xem xét</span><span class="c-red">Chưa đạt</span></span>
    </div>
    <div class="table-container">
      <table class="data-table uc-table">
        <thead><tr>
          <th>STT</th><th>Đô thị</th><th>Loại</th><th>Phạm vi</th>
          <th title="Loại I: 1.II.07 ≥ 2.500.000 người. Loại II, III: 2A.II.03">Dân số</th>
          <th title="2A.II.04. Đô thị di sản không xem xét mật độ này và được điểm tối thiểu. Loại I không có tiêu chuẩn mật độ trong Phụ lục I.">Mật độ</th>
          <th title="2A.III.07, km đường đô thị / km² đất xây dựng">Mật độ đường</th>
          <th title="2A.III.20, số khu ≥ 2 ha">Xanh ≥ 2 ha</th>
          <th title="2A.III.22, m² đất cây xanh cấp đô thị / người">Cây xanh</th>
          <th title="Điểm các tiêu chuẩn webapp đã chấm / số tiêu chuẩn đạt mức tối thiểu. Ngưỡng công nhận Bảng 2A là 75 điểm">Theo dõi</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function detailRows2A(urban, wards) {
  let group = '', sub = '';
  return STD_2A.map((std, i) => {
    const head = std.group !== group
      ? `<tr class="uc-group"><td colspan="8">${escapeHtml(GROUP_2A[std.group])}</td></tr>` : '';
    group = std.group;
    const subHead = std.sub && std.sub !== sub
      ? `<tr class="uc-sub"><td colspan="8">${escapeHtml(std.sub)}</td></tr>` : '';
    sub = std.sub || sub;
    const m = std.calc && !urban.partial ? readMeasure(std, urban, wards) : null;
    const j = judge(std, urban, m);
    const now = urban.partial ? '—' : (!std.calc ? '—' : (m && m.pending ? '…' : (m && m.value != null ? fmtNum(m.value) : '—')));
    const pts = j.pts == null ? '—' : `${j.lower ? '≥ ' : ''}${N2.format(j.pts)}`;
    const tip = [std.method, m && m.note, urban.note].filter(Boolean).join('\n');
    return `${head}${subHead}<tr>
      <td>${i + 1}</td>
      <td class="uc-code">${std.code}</td>
      <td class="uc-name" title="${escapeHtml(tip)}">${escapeHtml(std.name)}${inheritHtml(std)}</td>
      <td>${escapeHtml(targetText(std, urban, 'hi'))}</td>
      <td title="${escapeHtml(factorNote(urban, std))}">${escapeHtml(targetText(std, urban, 'lo'))}</td>
      <td class="uc-val">${now === '…' ? `<span class="gtx-wait">${ico('clock')}</span>` : escapeHtml(now)}</td>
      <td class="uc-val">${escapeHtml(pts)}</td>
      <td class="${levelCls(j.level)}">${LEVEL_TEXT[j.level]}</td>
    </tr>`;
  }).join('');
}

function inheritHtml(std) {
  return std.inherit ? `<span class="uc-src">${escapeHtml(std.inherit)}</span>` : '';
}

function factorNote(urban, std) {
  if (densityExempt(urban, std)) return 'Không xem xét (Điều 8 khoản 2 điểm d). Được điểm tối thiểu, không nội suy theo số đo (Điều 9 khoản 4 điểm a).';
  const f = floorFactor(urban, std);
  if (!(f < 1) || std.qual) return 'Mức để được điểm tối thiểu. Giữa mức tối thiểu và mức tối đa được nội suy (Điều 9 khoản 4 điểm a).';
  return `Mức tối thiểu tính điểm = ${N0pct(f)} mức trong Bảng 2A, chỉ khi chưa đạt mức quy định. ${urban.note}`;
}

function detailRowsI(wards) {
  const facts = typeIFacts(wards);
  let group = '';
  return STD_I.map((std, i) => {
    const head = std.group !== group
      ? `<tr class="uc-group"><td colspan="6">${escapeHtml(GROUP_I[std.group])}</td></tr>` : '';
    group = std.group;
    const j = judgeI(std, facts);
    return `${head}<tr>
      <td>${i + 1}</td>
      <td class="uc-code">${std.code}</td>
      <td class="uc-name" title="${escapeHtml(j.note || std.method || '')}">${escapeHtml(std.name)}${inheritHtml(std)}</td>
      <td>${escapeHtml(std.target || 'Đạt / không đạt')}</td>
      <td class="uc-val">${j.text === '—' ? '<span class="gtx-na">—</span>' : escapeHtml(j.text)}</td>
      <td class="${levelCls(j.level)}">${j.level === 'hi' ? 'Đạt' : (j.level === 'part' ? 'Chưa kết luận' : LEVEL_TEXT[j.level] || 'Chờ số liệu')}</td>
    </tr>`;
  }).join('');
}

const HERITAGE_RULE = 'Điều 8 khoản 2 điểm d đang áp dụng: không xem xét mật độ dân số trên diện tích tự nhiên và mật độ trên đất xây dựng của cấp xã (được điểm tối thiểu); không gian, kiến trúc, cảnh quan giữ mức của loại đô thị; mức tối thiểu các tiêu chuẩn khác = 50%.';

function ruleNote(urban) {
  if (urban.cls === 'I') return `Đã áp dụng điều khoản di sản: loại I cần tối thiểu 10/15 tiêu chuẩn (vai trò ≥ 4/6, đô thị hóa ≥ 2/4, hạ tầng ≥ 4/5), thay cho 12 tiêu chuẩn (Điều 9 khoản 3 điểm a). ${HERITAGE_RULE}`;
  if (urban.partial) return `${urban.note} ${HERITAGE_RULE}`;
  const multi = urban.units.length > 1;
  const scope = multi
    ? 'Đô thị nhiều đơn vị: ≥ 75 điểm Bảng 2A và mỗi tiêu chí đạt điểm tối thiểu; điểm trung bình mục III Bảng 2B ≥ 48; ít nhất 1 đơn vị ≥ 75 điểm Bảng 2B (Điều 6 khoản 2 điểm b, Điều 9 khoản 3 điểm b). Webapp chưa chấm Bảng 2B.'
    : 'Đô thị trong 1 đơn vị hành chính: đánh giá trên toàn phạm vi theo Phụ lục II (Điều 6 khoản 2 điểm a). Đơn vị đạt trình độ phát triển khi ≥ 75 điểm Bảng 2B (Điều 9 khoản 3 điểm c). Webapp chưa chấm Bảng 2B.';
  return `${HERITAGE_RULE} ${scope}`;
}

function detailHtml(urban, wards) {
  const table = urban.cls === 'I'
    ? `<table class="data-table uc-table"><thead><tr>
        <th>STT</th><th>Mã</th><th>Tiêu chuẩn</th><th>Mục tiêu</th><th>Hiện trạng</th><th>Mức đạt</th>
      </tr></thead><tbody>${detailRowsI(wards)}</tbody></table>`
    : `<table class="data-table uc-table"><thead><tr>
        <th>STT</th><th>Mã</th><th>Tiêu chuẩn</th><th>Mục tiêu 2030</th><th>Mức tối thiểu</th><th>Hiện trạng</th><th>Điểm</th><th>Mức đạt</th>
      </tr></thead><tbody>${detailRows2A(urban, wards)}</tbody></table>`;
  return `<div class="uc-bar">
      <button type="button" class="bp-btn" data-uc="all">${ico('chev-left')}16 đô thị</button>
      <span class="uc-summary"><b class="uc-${urban.cls}">Loại ${urban.cls}</b> ${escapeHtml(urban.name)} · ${escapeHtml(scopeLabel(urban))}</span>
    </div>
    <div class="uc-note" title="${escapeHtml(urban.note)}">${ico('info')} ${escapeHtml(ruleNote(urban))}</div>
    <div class="table-container">${table}</div>`;
}

function paint(el, wardName, wards) {
  measured.clear();
  const picked = mode !== 'auto' && mode !== 'all' ? URBANS.find(u => u.id === mode) : null;
  const autoUrban = mode === 'auto' && wardName ? urbanByWard(wardName) : null;
  const urban = picked || autoUrban;
  el.innerHTML = urban ? detailHtml(urban, wards) : overviewHtml(wards, wardName);
}

/** Vẽ bảng vào el. wardName rỗng = toàn thành phố. */
export function renderUrbanClass(el, { wardName, wards }) {
  if (!el) return;
  const key = wardName || '';
  if (key !== seenKey) { seenKey = key; mode = 'auto'; }
  el.dataset.ward = key;
  loadBuiltAreas();
  const draw = () => {
    if (!el.isConnected || el.dataset.ward !== key) return;
    paint(el, key, wards);
  };
  draw();
  if (!roads) loadRoads().then(draw).catch(err => console.warn('Phân loại đô thị – mạng lưới đường lỗi:', err));
}

export function initUrbanClassEvents(el, rerender) {
  el?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-uc]');
    if (!btn) return;
    mode = btn.dataset.uc === 'all' ? 'all' : btn.dataset.uc;
    rerender();
  });
}

export function reloadUrbanClassRoads() {
  roads = null;
  return loadRoads(true);
}
