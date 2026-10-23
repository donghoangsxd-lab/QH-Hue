# Tiêu chí chấm điểm đô thị và nguồn dữ liệu

Phân loại chỉ để xem tiêu chí nào tính được từ bản đồ đang có. Không đổi cách chấm trong `public/js/urbanClass.js`.

Căn cứ webapp đang dùng là **Nghị quyết 111/2025/UBTVQH15** (hiệu lực 01/01/2026), hiện trạng theo Quyết định 614/QĐ-UBND, mục tiêu 16 đô thị theo Quyết định 756/QĐ-UBND. Nghị quyết 26/2022/UBTVQH15 không còn là bộ tiêu chí trong code. Loại II và III chấm Bảng 2A (23 tiêu chuẩn, tối đa 100). Loại I chấm Phụ lục I (15 tiêu chuẩn, đạt khi ≥ 10/15). Cả 16 đô thị áp Điều 8 khoản 2 điểm d (di sản UNESCO): mật độ dân số không xét; mức tối thiểu các tiêu chuẩn không thuộc nhóm cảnh quan còn 50%. **Bảng 2B chưa chấm** (1.II.10 để trống).

Đếm: **7 tiêu chí nhóm A, 16 nhóm B, 15 nhóm C** (38 tiêu chí).

## Đơn vị đủ dữ liệu không gian

Đủ để cộng cả xã, phường (ranh `projects/optimistic-yew-488501-s0/assets/Polygon-40xa`, bản tĩnh `public/data/ward-boundary.json`):

- Loại I: toàn thành phố, 40 xã-phường.
- Loại II: khu vực trung tâm (9 phường), Hương Thủy (3 phường).
- Loại III nguyên đơn vị: Hương Trà, Phong Điền, Hóa Châu, Mỹ Thượng, Chân Mây – Lăng Cô, Quảng Điền, A Lưới 2.

Chưa đủ: 6 đô thị mới chỉ là một phần xã (Vinh Thanh / Phú Vinh, Phú Đa / Phú Vang, Lộc Sơn / Hưng Lộc, Khe Tre, Phú Lộc, Vinh Hiền / Vinh Lộc). Không lấy dân số, diện tích hay chiều dài đường của cả xã.

Lớp chuyên ngành và sử dụng đất không phủ đều 16 đô thị. QHC 1/25.000 (catalog `qhc-hue-2045`) và QHC 1/10.000 (`qhc-trung-tam`) phủ đồ án tỉnh cũ và khu trung tâm. Phú Lộc, Khe Tre, Vinh Hưng, KCN Phong Điền là đồ án riêng. Không dùng các lớp này để chấm một đô thị nằm ngoài ranh đồ án.

`buildings.pmtiles`, thửa đất `cadastre/thuadat-2016.pmtiles` và chiều cao GBA không đi vào `urbanClass.js`.

## Bảng tóm tắt

| Tiêu chí | Nhóm | Nguồn |
|---|---|---|
| 2A.I.01 Vai trò, vị trí theo quy hoạch | C | Nhận định cấp vùng / tỉnh / xã. Không có thuộc tính. |
| 2A.I.02 Vai trò đô thị trung tâm | C | Trụ sở, đầu mối kết nối: nhận định. |
| 2A.II.03 Quy mô dân số | A | `P = Σ Dan_So_Vector`. Thuộc tính `danSo` trên `Polygon-40xa`. Sáu đô thị một phần xã: chưa tính. |
| 2A.II.04 Mật độ trên diện tích tự nhiên | A | `D = P / Σ Dien_Tich_Km2` (`WARD_AREA_KM2`). Điểm bị miễn, vẫn tính được số. |
| 2A.II.05 Tỷ lệ lao động phi nông nghiệp | C | Không có lớp việc làm. Dynamic World «built» không phải tỷ lệ này. |
| 2A.III.06 Đầu mối giao thông | B | Điểm đầu mối QHC 1/25.000 (HT 24, QH 125). Thiếu cấp vùng / tỉnh / xã. |
| 2A.III.07 Mật độ đường đô thị | A | `(km main + km kiet) / km² đất xây dựng`. `roads/v2/index.json` và `getBuiltArea`. |
| 2A.III.08 Tỷ lệ dân được cấp nước sạch | B | Tuyến cấp nước chuyên ngành. Thiếu dân được phục vụ. |
| 2A.III.09 Mật độ cống thoát nước chính | B | Vài tuyến thoát nước mưa hiện trạng. Không phải kiểm kê cống chính. |
| 2A.III.10 Công suất trạm XLNT / thiết kế | B | Điểm trạm xử lý. Thiếu công suất vận hành và thiết kế. |
| 2A.III.11 Tỷ lệ CTR xử lý đạt | B | Điểm và vùng chất thải rắn. Thiếu tấn hoặc tỷ lệ xử lý. |
| 2A.III.12 Nghĩa trang xây theo quy hoạch | B | Điểm nghĩa trang và mã đất NTD/NTR trong đồ án. Thiếu tỷ lệ diện tích HT/QH. |
| 2A.III.13 Nhà tang lễ | A | Đếm `11-NT` đã duyệt, `ntKind = funeral`, trong `infrastructure_hue.json`. |
| 2A.III.14 Giường bệnh / 10.000 dân | C | Có điểm `7-YT`, không có số giường. |
| 2A.III.15 Cơ sở giáo dục, đào tạo | B | Đếm được THPT đã duyệt (cận dưới). Thiếu ĐH, CĐ, trung cấp, dạy nghề. |
| 2A.III.16 Công trình văn hóa | B | Đếm `8-VH` đã duyệt. Cùng mã còn sân thể thao, chưa tách. |
| 2A.III.17 Công trình thể thao | B | Lọc tên trong `8-VH`. Tham khảo, chưa tính điểm. Không có lớp riêng. |
| 2A.III.18 Thương mại, dịch vụ | A | Đếm `9-TM` đã duyệt (`TM_DT` + `TM_DV`). |
| 2A.III.19 Đất dịch vụ công cộng / người | B | `Σ size` của THPT, `7-YT`, `8-VH`, `9-TM` / P. Nhiều điểm thiếu diện tích. |
| 2A.III.20 Không gian xanh ≥ 2 ha | B | Đếm `1-CV` có `size ≥ 20.000` m². Thiếu diện tích thì bỏ. Thiếu quảng trường, phố đi bộ. |
| 2A.III.21 Tỷ lệ xanh trên diện tích tự nhiên | B | Đất cây xanh / rừng / nông nghiệp chỉ trong ranh đồ án đã phát hành. |
| 2A.III.22 Cây xanh công cộng / người | B | `Σ size` công viên cấp đô thị `CV_DT` / P. Cùng lỗ hổng diện tích. |
| 2A.III.23 Quy chế quản lý kiến trúc | C | PDF quy chế không ghi số năm đã thực hiện. |
| 1.I.01 Khu chức năng cấp quốc gia, quốc tế | C | Có / không. Không có lớp. |
| 1.I.02 Sự kiện quốc tế | C | Có / không. |
| 1.I.03 Thu nhập bình quân | C | Số thống kê, không có trên bản đồ. |
| 1.I.04 Tốc độ GRDP | C | Số thống kê. |
| 1.I.05 Thu hút đầu tư | C | Xếp hạng địa phương. |
| 1.I.06 Cân đối ngân sách | C | Số ngân sách. |
| 1.II.07 Dân số đô thị loại I | A | Tổng `Dan_So_Vector` của 40 xã-phường. Ngưỡng ≥ 2.500.000. |
| 1.II.08 Tỷ lệ đô thị hóa | B | (dân số loại II + loại III đủ ranh) / dân số thành phố. Bỏ 6 đô thị chưa có ranh. |
| 1.II.09 Dân số các đô thị loại II | A | Dân số trung tâm + Hương Thủy. Ngưỡng ≥ 600.000. |
| 1.II.10 Phường đạt trình độ loại II | C | Cần Bảng 2B. Không có ô nhập (`khong-nhap`). |
| 1.III.11 Đầu mối cấp khu vực và quốc tế | B | Cùng điểm đầu mối QHC. Cấp khu vực / quốc tế là nhận định. |
| 1.III.12 GTCC phủ 100% đô thị loại II | B | Xe buýt: dân số raster trong bán kính điểm `13-BUS` đã duyệt. Đường sắt, đường thủy và tỷ lệ hành khách chưa vào điều kiện đạt. |
| 1.III.13 Giải thưởng công trình | C | Có / không. |
| 1.III.14 Đô thị thông minh hoặc chống chịu khí hậu | C | Có / không. |
| 1.III.15 Nông thôn mới | C | Quyết định công nhận, không có lớp. |

## Nhóm A — công thức

Chỉ áp cho 10 đô thị loại II/III đủ ranh và cho thành phố. Sáu đô thị một phần xã trả về «chưa tách ranh» cho đến khi có polygon hoặc cán bộ nhập số phần đô thị.

**2A.II.03.** `P = Σ Dan_So_Vector` của các xã-phường trong `urban.units` (`wardsOf` trong `urbanClass.js`). `getWardStats` gán `Dan_So_Vector` từ thuộc tính `danSo` / `danSoNum` của `Polygon-40xa` (`loadEvaluatedWards` trong `api/gee.js`). Thiếu thuộc tính thì code lấy 10.000 — đó là mốc dự phòng, không phải điều tra. Ô `danSo` trên form chỉ đính chính; `danSoTamTru` cộng thêm nếu cán bộ nhập. Không dùng WorldPop, GHSL, hay phương pháp dân số theo sàn nhà.

**2A.II.04.** `D = P / Σ Dien_Tich_Km2`. Diện tích lấy `config/constants.js` → `WARD_AREA_KM2`, không có thì thuộc tính `dienTich` của polygon, rồi diện tích hình học. Mọi đô thị Huế được miễn tiêu chuẩn này: đủ ranh thì ghi điểm tối thiểu và không xét ngưỡng; đô thị chưa có ranh thì điểm để trống. Số vẫn tính được trên 10 đô thị đủ ranh và trên từng xã-phường.

**2A.III.07.** `G = (main + kiet) / đất xây dựng`. Tử số: `roads/v2/index.json` (OSM, đã cắt theo ranh phường) cộng `roads/v2/custom.json`. `main` = trục chính + đường khu vực có tên; `kiet` = nội bộ. Đường xe đạp không cộng. Mẫu số: `action=getBuiltArea` — nhãn `built` của `GOOGLE/DYNAMICWORLD/V1` mùa khô gần nhất, cộng đất `bare` đang san nền sát khu built, lưới 20 m (`services/satService.js`, `builtNow`). Thiếu đất xây dựng thì không chia cho diện tích tự nhiên. `buildings.pmtiles` không phải mẫu số.

**2A.III.13.** Đếm điểm mạng lưới `11-NT`, `TrangThai` đã duyệt, `ntKind === 'funeral'`, tọa độ rơi trong xã-phường của đô thị. Nguồn `infrastructure_hue.json` (bucket `hue-infra-data-us`), gom ở `network.nt` của thống kê phường.

**2A.III.18.** Đếm công trình `9-TM` đã duyệt trong `urbanResults.TM_DT` và `unitResults.TM_DV` (cùng file hạ tầng, gán phường theo tọa độ, có tách phần diện tích lô vắt ranh).

**1.II.07.** Tổng `Dan_So_Vector` của 40 xã-phường. Đạt khi ≥ 2.500.000. Ô `tp:TP` / `danSo` chỉ đính chính.

**1.II.09.** Tổng dân số hai đô thị loại II (trung tâm và Hương Thủy), cùng công thức 2A.II.03. Đạt khi ≥ 600.000.

## Nhóm B — tính được một phần

**2A.III.06 và 1.III.11.** Lớp điểm «công trình đầu mối giao thông»: QHC 1/25.000 hiện trạng 24 điểm, quy hoạch 125 điểm; 1/10.000 hiện trạng 18, quy hoạch 58 (`docs/chuyen-nganh.md`, `public/data/chuyen-nganh/index.json`). Thiếu thuộc tính cấp (vùng, tỉnh, xã, khu vực, quốc tế). Không tự gán mức điểm từ tên điểm.

**2A.III.08.** Tuyến cấp nước: 1/25.000 hiện trạng 485 đoạn, quy hoạch 904; 1/10.000 hiện trạng 309. Không có dân số đấu nối hay tỷ lệ phục vụ. Chiều dài ống không ra được phần trăm.

**2A.III.09.** Thoát nước mưa hiện trạng rất thưa: 1/25.000 có 8 đường «phân lưu»; 1/10.000 có 38 đường. Quy hoạch dày hơn (1/10.000: 1.533 đoạn) nhưng tiêu chí là cống chính hiện trạng trên đất xây dựng. Chưa đủ để ra km/km².

**2A.III.10.** Điểm trạm xử lý nước thải (1/25.000: hiện trạng 10, quy hoạch 476). Không có cặp công suất vận hành và công suất thiết kế.

**2A.III.11.** Điểm chất thải rắn và vài vùng phân khu (1/25.000 hiện trạng 7 điểm, quy hoạch 3 vùng). Không có khối lượng hay tỷ lệ xử lý đạt.

**2A.III.12.** Điểm nghĩa trang chuyên ngành (1/25.000 hiện trạng 65, quy hoạch 61) và mã đất `NTD` / `NTR` trong `public/js/tt16Symbols.js` trên lớp sử dụng đất của từng đồ án. `11-NT` trong hạ tầng có `size` nhưng nhiều điểm trống, và đó không phải tỷ lệ diện tích đã xây trên diện tích quy hoạch của cả đô thị.

**2A.III.15.** Webapp đếm THPT đã duyệt (`urbanResults.THPT`) và ghi là cận dưới. Bộ tiêu chí còn đại học, cao đẳng, trung cấp, dạy nghề. Mầm non, tiểu học, THCS không được cộng.

**2A.III.16.** Đếm mọi `8-VH` đã duyệt (`VH_DT` + `VH_DV`). Sân thể thao cùng mã vẫn nằm trong số này.

**2A.III.17.** Lọc tên trong cùng danh sách `8-VH` (sân, nhà thi đấu, sân vận động, bể bơi, đường chạy, gôn, cơ sở tập). Kết quả chỉ tham khảo, `pts = null`. Không có lớp thể thao riêng.

**2A.III.19.** `(diện tích THPT + 7-YT + 8-VH + 9-TM) / P`, đơn vị m²/người, lấy `currentArea` các nhóm trên. Điểm không có `size` bị bỏ qua nên là cận dưới. Chưa gồm cơ sở giáo dục ngoài THPT, chưa tách sân thể thao.

**2A.III.20.** Đếm `1-CV` (cả `CV_DT` và `CV_DV`) có `size ≥ 20.000`. Không rõ diện tích thì không đếm. Chưa có lớp quảng trường hay phố đi bộ.

**2A.III.21.** Đất cây xanh, rừng, nông nghiệp nằm trong `data/qhc2045/sdd.json` (trung tâm), `data/qhc2045/dinhhuong.json` (sơ đồ 1/25.000), và `projects/<đồ án>/su-dung-dat.json` của Phú Lộc, Khe Tre, Vinh Hưng. Không có lớp phủ xanh toàn thành phố. Mã `C-CXDT` là cây xanh đô thị trong đồ án, không phải tỷ lệ trên diện tích tự nhiên cả xã.

**2A.III.22.** `Σ size` của `CV_DT` (công viên cấp đô thị, mã `1-CV`) / P. Không cộng vườn hoa đơn vị ở. Điểm thiếu `size` làm cận dưới.

**1.II.08.** `(dân số loại II + dân số loại III không đánh dấu partial) / dân số thành phố × 100`. Đạt mức hiển thị khi ≥ 45%, nhưng mức «đạt» bị giữ ở một phần vì thiếu 6 đô thị. Không ước dân số phần xã.

**1.III.12.** Với từng đô thị loại II: dân số raster nằm trong buffer bán kính quy chuẩn của điểm `13-BUS` đã duyệt, chia cho dân số raster của các phường (`getNetworkCoverage` trong `api/gee.js`). Bán kính lấy từ quy chuẩn điểm (webapp ghi 500 m đi bộ). Raster mặc định là phương pháp B, asset `Pixel-danso-nha`, trọng số `gs://hue-infra-data-us/gba/pop-weights.csv` — khác với `danSo` dùng cho 2A.II.03. Đường sắt và đường thủy OpenStreetMap chỉ được ghi chú, không cộng vào điều kiện đạt. Không có tỷ lệ hành khách (chỉ tiêu 0204). Không có trạm đã duyệt thì kết quả là 0%, không phải thiếu hình học.

## Nhóm C — chỉ nhập tay

2A.I.01, 2A.I.02, 2A.II.05, 2A.III.14, 2A.III.23, 1.I.01–1.I.06, 1.II.10, 1.III.13, 1.III.14, 1.III.15.

Điểm y tế (`7-YT`) cho biết có cơ sở, không cho số giường. File quy chế kiến trúc (`kien-truc/<đơn vị>/quy-che.pdf`) không có năm bắt đầu thực hiện. 1.II.10 không có ô trên form vì chưa có Bảng 2B.

## 546 ô thiếu và việc tự điền

`gapRows()` lúc chưa có số cán bộ: 696 ô, **546 ô thiếu**. Các tiêu chí nhóm A ở trên đã nằm ngoài 546 (trạng thái có sẵn, phụ thuộc, hoặc miễn), trừ phần sáu đô thị chưa có ranh.

Cơ cấu 546 ô:

| Khối | Số ô | Nhóm tiêu chí |
|---|---:|---|
| 8 tỷ lệ trên 15 đô thị loại II/III và 40 xã-phường (55 × 8) | 440 | B hoặc C: 2A.II.05, 08, 09, 10, 11, 12, 14, 21 |
| 4 tiêu chí chữ trên 15 đô thị loại II/III | 60 | C hoặc B: 2A.I.01, I.02, III.06, III.23 |
| Dân số phần đô thị (6 đô thị + 6 xã chủ) | 12 | A nhưng thiếu ranh |
| Diện tích phần đô thị (6 + 6) | 12 | A nhưng thiếu ranh; điểm mật độ vẫn miễn |
| Mật độ đường của 6 đô thị một phần | 6 | A nhưng thiếu ranh |
| Ranh 6 đô thị một phần | 6 | Chưa có polygon |
| 10 câu có/không của loại I | 10 | C |

Tự điền các tiêu chí nhóm A **không cắt được phần lớn 546 ô**. Phần cắt được hôm nay là 0: dân số, diện tích và mật độ đường của đô thị đủ ranh đã không nằm trong danh sách thiếu; sáu đô thị một phần không được điền bằng số cả xã.

Việc nên làm trên form Hành chính:

1. Giữ ô nhập cho nhóm C. Không suy tỷ lệ phi nông nghiệp từ ảnh vệ tinh hay từ thửa đất.
2. Không điền sẵn 2A.II.03, 2A.II.04, 2A.III.07 cho sáu đô thị một phần. Khi có polygon đô thị, ba tiêu chí này (18 ô số) cùng 6 ô ranh và 12 ô phần xã mới tính được — khoảng 36 ô.
3. Khóa ô ghi đè `danSo`, `dienTich`, `matDoDuong` trên đơn vị đã có số từ bản đồ, để cán bộ không gõ lại. Việc này không giảm 546.
4. Muốn giảm mạnh mà không bịa số: bỏ 8 tỷ lệ khỏi form từng xã (320 ô) và chỉ giữ một lần trên mỗi đô thị. Đó là đổi chỗ nhập, không phải tự tính. Các ô đô thị tương ứng (120 ô) vẫn là B hoặc C.

2A.III.13, 15, 16, 17, 18, 19, 20, 22 đã được `urbanClass.js` đếm hoặc tính cận dưới. Chúng không có ô trong 546. Đưa vào form Hành chính không bớt ô thiếu.
