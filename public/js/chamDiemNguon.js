// Nguồn từng tiêu chuẩn NQ 111. tu_dong = có công thức từ dữ liệu đang có; tay = thiếu đầu vào, không suy diễn.
import { PHU_LUC_I, BANG_2A, BANG_2B, DIEM_CONG } from './chamDiemCatalog.js';

const tay = (id, lyDo) => ({ id, cheDo: 'tay', nguon: 'nhập tay', congThuc: '', lyDo });
const tu = (id, nguon, congThuc) => ({ id, cheDo: 'tu_dong', nguon, congThuc, lyDo: '' });

const ROW = [
  tay('1.I.01', 'Không có lớp khu chức năng cấp quốc gia hoặc quốc tế.'),
  tay('1.I.02', 'Không có danh sách sự kiện quốc tế ba năm.'),
  tay('1.I.03', 'Không có thu nhập bình quân đầu người của thành phố và cả nước.'),
  tay('1.I.04', 'Không có tốc độ GRDP và GDP ba năm.'),
  tay('1.I.05', 'Không có xếp hạng thu hút đầu tư.'),
  tay('1.I.06', 'Không có số cân đối ngân sách trung ương.'),
  tu('1.II.07', 'public/js/dvhcStats.js DVHC_CITY.pop', 'Đạt khi dân số thành phố ≥ 2.500.000 người.'),
  tu('1.II.08', 'dvhcStats.js và danh sách đô thị kỳ đang chọn', 'Dân số các đô thị loại II và III, mỗi phường một lần, chia dân số thành phố. Phần xã ước theo diện tích polygon là cận dưới: chỉ kết luận Đạt khi cận dưới đã ≥ 45%.'),
  tu('1.II.09', 'dvhcStats.js, đô thị loại II của kỳ đang chọn', 'Tổng dân số đô thị loại II. Đạt khi ≥ 600.000 người.'),
  tu('1.II.10', 'public/js/urbanStatus.js WARDS_614, Quyết định 614/QĐ-UBND', 'Số phường có trình độ loại II chia tổng số phường. Đạt khi ≥ 50%.'),
  tay('1.III.11', 'Điểm đầu mối giao thông không ghi cấp khu vực hay quốc tế.'),
  tay('1.III.12', 'Độ phủ xe buýt cần dân số raster trong 500 m (getNetworkCoverage). Tab không gọi thêm API đó.'),
  tay('1.III.13', 'Không có danh sách giải thưởng kiến trúc.'),
  tay('1.III.14', 'Không có hồ sơ đô thị thông minh hoặc chống chịu khí hậu.'),
  tay('1.III.15', 'Không có quyết định công nhận nông thôn mới.'),

  tay('2A.I.01', 'Quy hoạch không ghi vai trò là cấp vùng, cấp tỉnh hay cấp xã.'),
  tay('2A.I.02', 'Không có thuộc tính trụ sở hoặc đầu mối kết nối theo cấp.'),
  tu('2A.II.03', 'dvhcStats.js; đô thị một phần xã dùng PART_BOUNDS trong urbanPartGeom.js', 'Dân số thường trú các phường, xã trong phạm vi, đơn vị nghìn người. Một phần xã: dân số xã × km² polygon / km² xã, chỉ dùng khi đã chạm mức tối thiểu.'),
  tu('2A.II.04', 'dvhcStats.js dân số / km²', 'Mật độ trên diện tích tự nhiên. Điều 8.2.d không đưa vào điểm; số vẫn hiện để đối chiếu.'),
  tay('2A.II.05', 'Không có tỷ lệ lao động phi nông nghiệp.'),
  tay('2A.III.06', 'hien-trang-tam/giao-thong.geojson có điểm đầu mối nhưng không có cấp vùng, tỉnh, xã.'),
  tu('2A.III.07', 'getWardRoads (roads/v2) và getBuiltArea', 'Km đường chính và nội bộ chia km² đất xây dựng. Thiếu một phường hoặc thiếu đất xây dựng thì «—», không chia cho diện tích tự nhiên.'),
  tay('2A.III.08', 'Ống và công suất cấp nước không phải tỷ lệ dân được cấp nước sạch.'),
  tu('2A.III.09', 'Lớp thoát nước mưa QHC, hienTrangScore.js measures', 'Km cống chính / km² đất xây dựng. Thiếu đất xây dựng hoặc không có cống trong ranh thì «—».'),
  tu('2A.III.10', 'Điểm XLNT hiện trạng và quy hoạch, hienTrangScore.js', 'Công suất hiện trạng / công suất thiết kế × 100. Thiếu một vế thì «—». Cận dưới vì chưa tách vận hành.'),
  tay('2A.III.11', 'Điểm chất thải rắn không có tỷ lệ xử lý đạt.'),
  tu('2A.III.12', 'Điểm và mã NTD, NTR, hienTrangScore.js', 'Diện tích nghĩa trang hiện trạng / quy hoạch × 100. Thiếu một vế thì «—».'),
  tu('2A.III.13', 'Điểm hạ tầng đã duyệt, mã 11-NT, ntKind funeral', 'Đếm nhà tang lễ đã duyệt trong phạm vi.'),
  tay('2A.III.14', 'Điểm y tế 7-YT không có số giường bệnh.'),
  tu('2A.III.15', 'Điểm đã duyệt, layerType 6-THPT', 'Đếm THPT đã duyệt. Thiếu đại học, cao đẳng, trung cấp, dạy nghề nên chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tu('2A.III.16', 'Điểm đã duyệt mã 8-VH', 'Đếm công trình 8-VH đã duyệt trong phạm vi.'),
  tu('2A.III.17', 'Điểm 8-VH đã duyệt, lọc tên sân thể thao', 'Đếm công trình có tên thể thao. Chỉ kết luận khi số đếm đã chạm mức tối thiểu.'),
  tu('2A.III.18', 'Điểm đã duyệt mã 9-TM', 'Đếm chợ và thương mại đã duyệt trong phạm vi.'),
  tu('2A.III.19', 'Diện tích THPT, 7-YT, 8-VH, 9-TM đã duyệt / dân số dvhcStats', 'm²/người. Công trình chưa có diện tích không cộng. Chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tu('2A.III.20', 'Điểm 1-CV đã duyệt, size ≥ 20.000 m²', 'Đếm khu ≥ 2 ha. Công trình chưa rõ diện tích không đếm. Chỉ kết luận khi số đếm đã chạm mức tối thiểu nếu còn công trình thiếu diện tích.'),
  tu('2A.III.21', 'Mã đất xanh và mặt nước trong hienTrangScore khi phủ ≥ 50% ranh', 'Diện tích xanh / diện tích tự nhiên × 100. Phủ dưới một nửa ranh thì «—». Không gọi ESA WorldCover.'),
  tu('2A.III.22', 'Công viên cấp đô thị 1-CV / dân số dvhcStats', 'm²/người. Chỉ kết luận khi phần đã có diện tích chạm mức tối thiểu.'),
  tay('2A.III.23', 'File quy chế kiến trúc không ghi số năm đã thực hiện.'),

  tay('2B.I.01', 'dvhcStats chỉ có một mốc dân số, không có tỷ lệ tăng hàng năm.'),
  tay('2B.I.02', 'Không có thu nhập bình quân của phường và của thành phố.'),
  tay('2B.I.03', 'Không có tỷ lệ hộ nghèo đa chiều.'),
  tu('2B.II.04', 'dvhcStats dân số / getBuiltArea', 'Người/km² đất xây dựng. Thiếu đất xây dựng thì «—». Điều 8.2.d không đưa vào điểm.'),
  tay('2B.II.05', 'Chưa có diện tích đất xây dựng theo quy hoạch để chia cho hiện trạng.'),
  tay('2B.II.06', 'Không có tỷ trọng công nghiệp, xây dựng và dịch vụ.'),
  tay('2B.III.07', 'Chưa có lớp đất giao thông phủ đủ ranh để chia cho đất xây dựng.'),
  tay('2B.III.08', 'Chưa có diện tích đất giao thông theo người.'),
  tay('2B.III.09', 'Đường dây điện không ghi đoạn đã ngầm hóa.'),
  tay('2B.III.10', 'Công suất nhà máy không đổi được ra lít/người/ngày.'),
  tay('2B.III.11', 'Lớp cống không có tỷ lệ diện tích được thoát nước chống ngập.'),
  tay('2B.III.12', 'Không có tỷ lệ dân được thu gom và xử lý nước thải.'),
  tay('2B.III.13', 'Điểm chất thải rắn không có tỷ lệ thu gom.'),
  tay('2B.III.14', 'Không có tỷ lệ hộ phân loại chất thải tại nguồn.'),
  tay('2B.III.15', 'Không có tỷ lệ thi thể hỏa táng. Số nhà hỏa táng không phải tỷ lệ đó.'),
  tay('2B.III.16', 'Km đường dây không phải kWh/người/năm.'),
  tay('2B.III.17', 'Không có tỷ lệ đường được chiếu sáng.'),
  tay('2B.III.18', 'Không có tỷ lệ chiếu sáng tiết kiệm hoặc thông minh.'),
  tay('2B.III.19', 'Không có tỷ lệ hộ có cáp quang.'),
  tay('2B.III.20', 'public/data/gba/agg.json chỉ có sàn tương đối theo phân vị, không phải m² sàn.'),
  tu('2B.III.21', 'public/data/gba/apartments.json', 'Đếm nhà ở xã hội đã hoàn thành trong phường. Dự án quy hoạch trong noxh-plan.json không tính là đang xây dựng.'),
  tay('2B.III.22', 'Chưa có đất dân dụng theo mã sử dụng đất phủ đủ ranh.'),
  tu('2B.III.23', 'Diện tích 3-MN, 4-TH, 5-THCS, 7-YT, 8-VH, 9-TM đã duyệt / dân số', 'm²/người cấp đơn vị ở. Chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tay('2B.III.24', 'Điểm trường không có cờ đạt chuẩn quốc gia mức 1 hoặc mức 2.'),
  tu('2B.III.25', 'Điểm 4-TH đã duyệt và dân số dvhcStats', 'Một trường trên 6.000 người là mức tối đa; một trường trên 8.000 người là mức tối thiểu.'),
  tu('2B.III.26', 'Diện tích 3-MN, 4-TH, 5-THCS đã duyệt / dân số', 'm²/người. Chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tu('2B.III.27', 'Diện tích 8-VH đã duyệt / dân số', 'm²/người. Chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tu('2B.III.28', 'Diện tích 1-CV đã duyệt / dân số', 'm²/người. Chỉ kết luận khi cận dưới đã chạm mức tối thiểu.'),
  tu('2B.III.29', 'Điểm 1-CV đã duyệt, size ≥ 2.000 m²', 'Đếm khu ≥ 2.000 m². Thiếu diện tích thì không đếm khu đó.'),
  tay('2B.III.30', 'Không có danh sách tuyến phố văn minh đô thị.'),
  tu('2B.III.31', 'Điểm 8-VH đã duyệt có tên di tích hoặc di sản', 'Đếm công trình ghi di tích hoặc di sản. Chỉ kết luận khi số đếm đã chạm mức tối thiểu.'),
  tay('2B.III.32', 'Không có chứng nhận công trình xanh.'),
  tay('2B.III.33', 'Không có năm ban hành kế hoạch phát triển đô thị của phường.'),
  tay('2B.III.34', 'Không có tỷ lệ hồ sơ dịch vụ công trực tuyến.'),
  tay('2B.III.35', 'Không có kế hoạch và tỷ lệ tuyến phố đã chỉnh trang.'),
  tay('2B.III.36', 'Không có đề án đô thị thông minh cấp phường.'),
  tay('2B.III.37', 'Không có khảo sát mức độ hài lòng.'),

  tay('2B.C.01', 'Không có tăng thu ngân sách địa phương.'),
  tu('2B.C.02', 'Tên điểm hạ tầng đã duyệt', 'Đạt khi tên ghi cấp quốc gia hoặc cấp tỉnh. Không thấy thì «—», không kết luận không đạt.'),
  tay('2B.C.03', 'Không có tỷ lệ lao động trình độ cao.'),
  tay('2B.C.04', 'Không có lớp giao thông ngầm.'),
  tay('2B.C.05', 'Không có kế hoạch chuyển đổi nhiên liệu xe buýt.'),
  tu('2B.C.06', 'getWardRoads, chiều dài bike', 'Đạt khi có km đường xe đạp. Đã có chỉ mục mà bằng 0 thì không đạt. Chưa có chỉ mục thì «—».'),
  tay('2B.C.07', 'Không có lớp tuyến buýt trên từng đường chính.'),
  tu('2B.C.08', 'Tên điểm đã duyệt', 'Đạt khi tên ghi hồ điều hòa hoặc hồ điều tiết. Không thấy thì «—».'),
  tay('2B.C.09', 'Không có điểm nước uống tại vòi.'),
  tu('2B.C.10', 'Điểm XLNT trong hienTrangScore', 'Đạt khi có trạm trong ranh. Lớp đã cắt mà không có trạm thì không đạt.'),
  tay('2B.C.11', 'Không có kế hoạch vùng phát thải thấp.'),
  tay('2B.C.12', 'Không có chuỗi ngày chất lượng không khí.'),
  tay('2B.C.13', 'Không có điểm WiFi công cộng.'),
  tay('2B.C.14', 'Không có tỷ lệ phủ sóng 5G.'),
  tay('2B.C.15', 'Không có chương trình cải tạo khu dân cư từ 4.000 người.'),
  tay('2B.C.16', 'Có số THPT nhưng không có cờ đạt chuẩn quốc gia.'),
  tu('2B.C.17', 'Tên điểm đã duyệt', 'Đạt khi tên ghi đại học, viện hoặc trung tâm nghiên cứu. Không thấy thì «—».'),
  tay('2B.C.18', 'Không có lớp không gian xanh trên cao.'),
  tu('2B.C.19', 'Tên điểm đã duyệt', 'Đạt khi tên ghi nhà vệ sinh. Không thấy thì «—».'),
  tay('2B.C.20', 'Không có quyết định công nhận phường văn minh đô thị.'),
  tay('2B.C.21', 'Không có danh sách tuyến phố đã lập thiết kế đô thị.'),
  tay('2B.C.22', 'Không có danh sách giải thưởng công trình.'),
  tu('2B.C.23', 'Tên điểm đã duyệt', 'Đạt khi tên ghi di tích quốc gia hoặc di sản. Không thấy thì «—».'),
  tay('2B.C.24', 'Không có dự án tái sử dụng công trình công nghiệp.'),
  tay('2B.C.25', 'Không có số vụ tai nạn giao thông ba năm.'),
  tay('2B.C.26', 'Không có số vụ cháy nổ ba năm.')
];

const ALL = [...PHU_LUC_I, ...BANG_2A, ...BANG_2B, ...DIEM_CONG];
const byId = new Map(ROW.map(r => [r.id, r]));

export const CHAM_DIEM_NGUON = ALL.map(spec => {
  const row = byId.get(spec.id);
  if (!row) throw new Error(`Thiếu nguồn ${spec.id}`);
  return row;
});

export function nguonTieuChi(id) {
  return byId.get(id) || null;
}

export function tyLeTuDong() {
  const tong = CHAM_DIEM_NGUON.length;
  const auto = CHAM_DIEM_NGUON.filter(r => r.cheDo === 'tu_dong').length;
  const chuan = CHAM_DIEM_NGUON.filter(r => !r.id.startsWith('2B.C.')).length;
  const autoChuan = CHAM_DIEM_NGUON.filter(r => r.cheDo === 'tu_dong' && !r.id.startsWith('2B.C.')).length;
  return { auto, tong, tyLe: auto / tong, autoChuan, chuan, tyLeChuan: autoChuan / chuan };
}
