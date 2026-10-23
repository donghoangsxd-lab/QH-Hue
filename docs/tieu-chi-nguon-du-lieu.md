# Tiêu chí chấm điểm đô thị và nguồn dữ liệu

Phân loại tiêu chí theo dữ liệu bản đồ đang có. Sáu đô thị một phần xã chấm bằng polygon trong `public/data/urban614.geojson` (`public/js/urbanPartGeom.js`).

Căn cứ webapp đang dùng là **Nghị quyết 111/2025/UBTVQH15** (hiệu lực 01/01/2026), hiện trạng theo Quyết định 614/QĐ-UBND, mục tiêu 16 đô thị theo Quyết định 756/QĐ-UBND. Nghị quyết 26/2022/UBTVQH15 không còn là bộ tiêu chí trong code. Loại II và III chấm Bảng 2A (23 tiêu chuẩn, tối đa 100). Loại I chấm Phụ lục I (15 tiêu chuẩn, đạt khi ≥ 10/15). Cả 16 đô thị áp Điều 8 khoản 2 điểm d (di sản UNESCO): mật độ dân số không xét; mức tối thiểu các tiêu chuẩn không thuộc nhóm cảnh quan còn 50%. **Bảng 2B chưa chấm** (1.II.10 để trống).

Đếm: **7 tiêu chí nhóm A, 16 nhóm B, 15 nhóm C** (38 tiêu chí). Gắn lớp hiện trạng không chuyển nhóm và không giảm ô thiếu: thuộc tính hình học không phải chỉ tiêu pháp lý (không có dân được cấp nước, không có % xử lý, không có cấp đầu mối). Ô thiếu vẫn **510**.

## Đơn vị đủ dữ liệu không gian

Đủ để cộng cả xã, phường (ranh `projects/optimistic-yew-488501-s0/assets/Polygon-40xa`, bản tĩnh `public/data/ward-boundary.json`):

- Loại I: toàn thành phố, 40 xã-phường.
- Loại II: khu vực trung tâm (9 phường), Hương Thủy (3 phường).
- Loại III nguyên đơn vị: Hương Trà, Phong Điền, Hóa Châu, Mỹ Thượng, Chân Mây – Lăng Cô, Quảng Điền, A Lưới 2.

Sáu đô thị một phần xã có polygon riêng trong lớp hệ thống đô thị hiện trạng `public/data/urban614.geojson` (Quyết định 614, 14 đối tượng, dựng bởi `scripts/build-urban614.js`): Vinh Thanh 10,44 km² trong Phú Vinh, Phú Đa 29,84 km² trong Phú Vang, Lộc Sơn 18,82 km² trong Hưng Lộc, Khe Tre 4,34 km² trong Khe Tre, Phú Lộc 29,98 km² trong Phú Lộc, Vinh Hiền 19,59 km² trong Vinh Lộc. Cùng file còn Sịa, Lăng Cô, A Lưới, Thanh Hà; bốn đô thị 2030 tương ứng (Quảng Điền, Chân Mây – Lăng Cô, A Lưới 2, Hóa Châu) vẫn chấm cả xã-phường vì Quyết định 756 lấy cả đơn vị hành chính.

Lớp chuyên ngành và sử dụng đất không phủ đều 16 đô thị. QHC 1/25.000 (catalog `qhc-hue-2045`) và QHC 1/10.000 (`qhc-trung-tam`) phủ đồ án tỉnh cũ và khu trung tâm. Phú Lộc, Khe Tre, Vinh Hưng, KCN Phong Điền là đồ án riêng. Không dùng các lớp này để chấm một đô thị nằm ngoài ranh đồ án.

`buildings.pmtiles`, thửa đất `cadastre/thuadat-2016.pmtiles` và chiều cao GBA không đi vào `urbanClass.js`.

## Lớp hiện trạng khi mở bảng chấm

`renderUrbanClass` mới tải các file dưới đây. Mở bản đồ không tải. Cắt trên máy khách: đô thị có polygon cùng `id` trong `public/data/urban614.geojson` dùng polygon đó; đô thị không có (trung tâm, Hóa Châu, Mỹ Thượng, Chân Mây – Lăng Cô, Quảng Điền, A Lưới 2) dùng hợp ranh các xã-phường trong `units`. Xã-phường dùng `public/data/ward-boundary.json`. Chiều dài là tổng đoạn có điểm giữa nằm trong ranh (bước khoảng 400 m).

Ba file `public/data/hien-trang-tam/` đã gộp, cờ `tam_thoi`. Bốn ngành còn lại chưa có file gộp. Trong một đơn vị, lớp tỷ lệ chi tiết hơn được giữ; đoạn của lớp thô có điểm giữa ngoài khung lớp chi tiết vẫn được cộng. Thủy lợi, hướng thoát nước và mặt cắt đường không đưa vào số đo.

| Lớp | File | Thuộc tính | Tiêu chí |
|---|---|---|---|
| Giao thông | `hien-trang-tam/giao-thong.geojson` | đường `nhom=mang`; điểm đầu mối; `nhom=duong-sat`, `duong-thuy` | 2A.III.07 (km đối chiếu, không thay mật độ OSM), 2A.III.06, 1.III.11, 1.III.12 |
| Cấp nước | `hien-trang-tam/cap-nuoc.geojson` | đường ống; điểm `congsuat` | 2A.III.08 |
| Cấp điện | `hien-trang-tam/cap-dien.geojson` | đường dây; điểm trạm | Không có tiêu chí A/B. Km và số trạm ở cuối bảng. |
| San nền, thoát nước mưa | đường thoát hiện trạng QHC 1/25.000 và 1/10.000 | chiều dài hình học | 2A.III.09 |
| Thoát nước thải | đường và điểm XLNT hiện trạng cùng hai đồ án | đường; điểm `congsuat` | 2A.III.10 |
| Chất thải rắn, nghĩa trang | điểm hiện trạng QHC 1/25.000, 1/10.000 và Vinh Hưng | số điểm | 2A.III.11, 2A.III.12 |
| Thông tin liên lạc | đường và điểm trạm hiện trạng | chiều dài; số trạm | Không có tiêu chí A/B. Số ở cuối bảng. |
| Sử dụng đất hiện trạng | `qhc-khu-cong-nghiep-phong-dien` `sdd/hien-trang` | `maloaidat`, `dientich` (m²) | 2A.III.21 |

Phú Lộc và Vinh Hưng có hiện trạng sử dụng đất trên GCS. Bảng chấm không tải hai file đó. Số tự tính hiện cạnh giá trị, kèm «tạm thời» với ba file đã gộp. Ô cán bộ nhập ghi đè giá trị đem chấm; chú thích vẫn ghi số lớp và chữ «không dùng».

## Bảng tóm tắt

| Tiêu chí | Nhóm | Nguồn |
|---|---|---|
| 2A.I.01 Vai trò, vị trí theo quy hoạch | C | Nhận định cấp vùng / tỉnh / xã. Không có thuộc tính. |
| 2A.I.02 Vai trò đô thị trung tâm | C | Trụ sở, đầu mối kết nối: nhận định. |
| 2A.II.03 Quy mô dân số | A | Không lấy từ 7 lớp mạng. Đô thị đủ xã: `P = Σ Dan_So_Vector`. Sáu đô thị một phần: `P_xã × km² polygon / km² xã`. |
| 2A.II.04 Mật độ trên diện tích tự nhiên | A | Không lấy từ 7 lớp mạng. Đô thị đủ xã: `P / Σ Dien_Tich_Km2`. Sáu đô thị một phần: `P / km² polygon`. Điểm vẫn miễn. |
| 2A.II.05 Tỷ lệ lao động phi nông nghiệp | C | Không có lớp việc làm. Dynamic World «built» không phải tỷ lệ này. |
| 2A.III.06 Đầu mối giao thông | B | Điểm trong `hien-trang-tam/giao-thong.geojson` (tạm thời). Thiếu cấp vùng / tỉnh / xã. |
| 2A.III.07 Mật độ đường đô thị | A | Giá trị chấm: `(km main + km kiet) / km² đất xây dựng`. Đối chiếu tạm thời: km `nhom=mang` trong ranh, không thay mật độ. |
| 2A.III.08 Tỷ lệ dân được cấp nước sạch | B | Ống và `congsuat` điểm trong `hien-trang-tam/cap-nuoc.geojson` (tạm thời). Thiếu dân được phục vụ. |
| 2A.III.09 Mật độ cống thoát nước chính | B | Đường thoát mưa hiện trạng đồ án (chưa gộp). Không phải kiểm kê cống chính. |
| 2A.III.10 Công suất trạm XLNT / thiết kế | B | Điểm XLNT hiện trạng, thuộc tính `congsuat`. Thiếu cặp vận hành và thiết kế. |
| 2A.III.11 Tỷ lệ CTR xử lý đạt | B | Điểm CTR hiện trạng. Thiếu tấn hoặc tỷ lệ xử lý. |
| 2A.III.12 Nghĩa trang xây theo quy hoạch | B | Điểm nghĩa trang hiện trạng. Thiếu tỷ lệ diện tích HT/QH. |
| 2A.III.13 Nhà tang lễ | A | Không lấy từ 7 lớp mạng. Đếm `11-NT` đã duyệt, `ntKind = funeral`. |
| 2A.III.14 Giường bệnh / 10.000 dân | C | Có điểm `7-YT`, không có số giường. |
| 2A.III.15 Cơ sở giáo dục, đào tạo | B | Đếm được THPT đã duyệt (cận dưới). Không nằm trong 7 lớp mạng. Thiếu ĐH, CĐ, trung cấp, dạy nghề. |
| 2A.III.16 Công trình văn hóa | B | Đếm `8-VH` đã duyệt. Không nằm trong 7 lớp mạng. Cùng mã còn sân thể thao, chưa tách. |
| 2A.III.17 Công trình thể thao | B | Lọc tên trong `8-VH`. Không có lớp riêng trong 7 ngành. |
| 2A.III.18 Thương mại, dịch vụ | A | Không lấy từ 7 lớp mạng. Đếm `9-TM` đã duyệt (`TM_DT` + `TM_DV`). |
| 2A.III.19 Đất dịch vụ công cộng / người | B | `Σ size` của THPT, `7-YT`, `8-VH`, `9-TM` / P. Không lấy từ lớp sử dụng đất hiện trạng. |
| 2A.III.20 Không gian xanh ≥ 2 ha | B | Đếm `1-CV` có `size ≥ 20.000` m². Không lấy từ mã đất hiện trạng. |
| 2A.III.21 Tỷ lệ xanh trên diện tích tự nhiên | B | `maloaidat` + `dientich` của hiện trạng sử dụng đất KCN Phong Điền. Không phủ cả thành phố. |
| 2A.III.22 Cây xanh công cộng / người | B | `Σ size` công viên cấp đô thị `CV_DT` / P. Không lấy từ 7 lớp mạng. |
| 2A.III.23 Quy chế quản lý kiến trúc | C | PDF quy chế không ghi số năm đã thực hiện. |
| 1.I.01 Khu chức năng cấp quốc gia, quốc tế | C | Có / không. Không có lớp. |
| 1.I.02 Sự kiện quốc tế | C | Có / không. |
| 1.I.03 Thu nhập bình quân | C | Số thống kê, không có trên bản đồ. |
| 1.I.04 Tốc độ GRDP | C | Số thống kê. |
| 1.I.05 Thu hút đầu tư | C | Xếp hạng địa phương. |
| 1.I.06 Cân đối ngân sách | C | Số ngân sách. |
| 1.II.07 Dân số đô thị loại I | A | Không lấy từ 7 lớp mạng. Tổng `Dan_So_Vector` của 40 xã-phường. Ngưỡng ≥ 2.500.000. |
| 1.II.08 Tỷ lệ đô thị hóa | B | (dân số loại II + loại III) / dân số thành phố. Không lấy từ lớp sử dụng đất. |
| 1.II.09 Dân số các đô thị loại II | A | Không lấy từ 7 lớp mạng. Dân số trung tâm + Hương Thủy. Ngưỡng ≥ 600.000. |
| 1.II.10 Phường đạt trình độ loại II | C | Cần Bảng 2B. Không có ô nhập (`khong-nhap`). |
| 1.III.11 Đầu mối cấp khu vực và quốc tế | B | Cùng điểm đầu mối tạm thời. Cấp khu vực / quốc tế là nhận định. |
| 1.III.12 GTCC phủ 100% đô thị loại II | B | Xe buýt: dân số raster trong bán kính điểm `13-BUS` đã duyệt. Km đường sắt và đường thủy tạm thời chỉ để đối chiếu. |
| 1.III.13 Giải thưởng công trình | C | Có / không. |
| 1.III.14 Đô thị thông minh hoặc chống chịu khí hậu | C | Có / không. |
| 1.III.15 Nông thôn mới | C | Quyết định công nhận, không có lớp. |

## Nhóm A — công thức

Mười đô thị loại II/III đủ xã và thành phố cộng nguyên đơn vị. Sáu đô thị một phần xã dùng polygon `urban614.geojson`.

**2A.II.03.** Đô thị đủ xã: `P = Σ Dan_So_Vector` của các xã-phường trong `urban.units`. `getWardStats` gán `Dan_So_Vector` từ thuộc tính `danSo` / `danSoNum` của `Polygon-40xa`. Sáu đô thị một phần: `P = Dan_So_Vector(xã) × km² polygon / Dien_Tich_Km2(xã)`. Dân số chỉ có theo xã, không có raster trong máy khách, nên đây là tỷ lệ diện tích. Lõi thị trấn thường đông hơn phần còn lại của xã, nên số này là cận dưới: đạt ngưỡng thì vẫn đạt; chưa đạt thì ghi «một phần», không kết luận chưa đạt. Ô `danSo` ghi đè ước lượng.

**2A.II.04.** Đô thị đủ xã: `D = P / Σ Dien_Tich_Km2` (`WARD_AREA_KM2`). Sáu đô thị một phần: mẫu số là `properties.km2` của polygon, không phải diện tích cả xã. Tiêu chuẩn được miễn (điểm tối thiểu) kể cả sáu đô thị này.

**2A.III.07.** `G = (main + kiet) / đất xây dựng` từ `roads/v2/index.json` và `getBuiltArea` (Dynamic World, lưới 20 m). Sáu đô thị một phần không có chiều dài đường OSM cắt theo polygon, nên mật độ bằng mật độ xã chủ. Khi mở bảng, km `nhom=mang` của file tạm thời hiện cạnh số này và không thay giá trị đem chấm. Ô `matDoDuong` ghi đè.

**2A.III.13.** Đếm `11-NT` đã duyệt, `ntKind === 'funeral'`. Sáu đô thị một phần chỉ lấy điểm có tọa độ nằm trong polygon.

**2A.III.18.** Đếm `9-TM` đã duyệt. Sáu đô thị một phần chỉ lấy điểm nằm trong polygon.

**1.II.07.** Tổng `Dan_So_Vector` của 40 xã-phường. Đạt khi ≥ 2.500.000. Ô `tp:TP` / `danSo` chỉ đính chính.

**1.II.09.** Tổng dân số hai đô thị loại II (trung tâm và Hương Thủy), cùng công thức 2A.II.03. Đạt khi ≥ 600.000.

## Nhóm B — tính được một phần

**2A.III.06 và 1.III.11.** Điểm trong `public/data/hien-trang-tam/giao-thong.geojson` (cờ tạm thời, đã gộp từ hiện trạng các đồ án). Thiếu thuộc tính cấp (vùng, tỉnh, xã, khu vực, quốc tế). Không tự gán mức điểm từ tên điểm. Ô mức và ô đạt/chưa đạt vẫn thiếu.

**2A.III.08.** Đường và điểm `public/data/hien-trang-tam/cap-nuoc.geojson`. `congsuat` là số trên điểm công trình, không phải dân được đấu nối. Chiều dài ống không ra được phần trăm. Ô % vẫn thiếu; cán bộ nhập thì ghi đè.

**2A.III.09.** Đường thoát nước mưa hiện trạng của QHC 1/25.000 và 1/10.000, chưa có file gộp tạm thời. Thủy lợi và mũi tên hướng thoát không tính. Chưa đủ để ra km/km² cống chính. Ô vẫn thiếu.

**2A.III.10.** Điểm trạm xử lý nước thải hiện trạng, thuộc tính `congsuat`. Không có cặp công suất vận hành và công suất thiết kế. Ô % vẫn thiếu.

**2A.III.11.** Điểm chất thải rắn hiện trạng. Không có khối lượng hay tỷ lệ xử lý đạt. Ô % vẫn thiếu.

**2A.III.12.** Điểm nghĩa trang hiện trạng (1/25.000, 1/10.000 và Vinh Hưng). Không có tỷ lệ diện tích đã xây trên diện tích quy hoạch. Ô % vẫn thiếu.

**2A.III.15.** Webapp đếm THPT đã duyệt (`urbanResults.THPT`) và ghi là cận dưới. Sáu đô thị một phần chỉ đếm điểm trong polygon. Bộ tiêu chí còn đại học, cao đẳng, trung cấp, dạy nghề. Mầm non, tiểu học, THCS không được cộng.

**2A.III.16.** Đếm mọi `8-VH` đã duyệt (`VH_DT` + `VH_DV`). Sân thể thao cùng mã vẫn nằm trong số này.

**2A.III.17.** Lọc tên trong cùng danh sách `8-VH` (sân, nhà thi đấu, sân vận động, bể bơi, đường chạy, gôn, cơ sở tập). Kết quả chỉ tham khảo, `pts = null`. Không có lớp thể thao riêng.

**2A.III.19.** `(diện tích THPT + 7-YT + 8-VH + 9-TM) / P`. Sáu đô thị một phần cộng `size` của điểm nằm trong polygon và chia cho dân số ước. Dân số ước thấp làm m²/người cao, nên chưa cộng điểm cho đến khi cán bộ đính chính dân số.

**2A.III.20.** Đếm `1-CV` (cả `CV_DT` và `CV_DV`) có `size ≥ 20.000`. Sáu đô thị một phần chỉ đếm điểm trong polygon. Không rõ diện tích thì không đếm. Chưa có lớp quảng trường hay phố đi bộ.

**2A.III.21.** Hiện trạng sử dụng đất trong repo chỉ có lớp KCN Phong Điền (`maloaidat`, `dientich`). Hai lớp Phú Lộc và Vinh Hưng nằm trên GCS, không tải khi mở bảng. Mã trong KCN không phải tỷ lệ cây xanh trên diện tích tự nhiên của đô thị. Ô % vẫn thiếu. Quy hoạch sử dụng đất (`sdd.json`, `dinhhuong.json`) không dùng cho chỉ tiêu hiện trạng này.

**2A.III.22.** `Σ size` của `CV_DT` nằm trong phạm vi / P. Sáu đô thị một phần dùng dân số ước ở mẫu số nên chưa cộng điểm, cùng lý do 2A.III.19.

**1.II.08.** `(dân số loại II + dân số loại III) / dân số thành phố × 100`. Sáu đô thị một phần cộng bằng ước theo tỷ lệ diện tích. Vì ước lượng là cận dưới, mức đạt giữ ở «một phần» cho đến khi có dân số nhập tay.

**1.III.12.** Với từng đô thị loại II: dân số raster nằm trong buffer bán kính quy chuẩn của điểm `13-BUS` đã duyệt, chia cho dân số raster của các phường (`getNetworkCoverage` trong `api/gee.js`). Bán kính lấy từ quy chuẩn điểm (webapp ghi 500 m đi bộ). Raster mặc định là phương pháp B, asset `Pixel-danso-nha`, trọng số `gs://hue-infra-data-us/gba/pop-weights.csv` — khác với `danSo` dùng cho 2A.II.03. Km `nhom=duong-sat` và `nhom=duong-thuy` của file giao thông tạm thời chỉ ghi chú, không cộng vào điều kiện đạt. Không có tỷ lệ hành khách (chỉ tiêu 0204). Không có trạm đã duyệt thì kết quả là 0%, không phải thiếu hình học.

## Nhóm C — chỉ nhập tay

2A.I.01, 2A.I.02, 2A.II.05, 2A.III.14, 2A.III.23, 1.I.01–1.I.06, 1.II.10, 1.III.13, 1.III.14, 1.III.15.

Điểm y tế (`7-YT`) cho biết có cơ sở, không cho số giường. File quy chế kiến trúc (`kien-truc/<đơn vị>/quy-che.pdf`) không có năm bắt đầu thực hiện. 1.II.10 không có ô trên form vì chưa có Bảng 2B.

## 510 ô thiếu và việc tự điền

`gapRows()` lúc chưa có số cán bộ: 696 ô, **510 ô thiếu** (trước khi dùng polygon hiện trạng là 546). Ranh, dân số, diện tích và mật độ đường của sáu đô thị một phần xã ra khỏi danh sách thiếu: 36 ô (6 ranh, 6 dân số đô thị, 6 diện tích đô thị, 6 mật độ đường, 6 dân số phần xã, 6 diện tích phần xã).

Cơ cấu 510 ô còn lại không đổi sau khi gắn lớp hiện trạng: số km và số điểm không thay các ô tỷ lệ.

| Khối | Số ô | Nhóm tiêu chí |
|---|---:|---|
| 8 tỷ lệ trên 15 đô thị loại II/III và 40 xã-phường (55 × 8) | 440 | B hoặc C: 2A.II.05, 08, 09, 10, 11, 12, 14, 21 |
| 4 tiêu chí chữ trên 15 đô thị loại II/III | 60 | C hoặc B: 2A.I.01, I.02, III.06, III.23 |
| 10 câu có/không của loại I | 10 | C |

Dân số sáu đô thị là trạng thái phụ thuộc (ước theo tỷ lệ diện tích). Diện tích và ranh là có sẵn. Mật độ đường là phụ thuộc (bằng mật độ xã chủ).

Việc nên làm trên form Hành chính:

1. Giữ ô nhập cho nhóm C.
2. Ô `danSo` của sáu đô thị chỉ để đính chính ước lượng, không bắt buộc để chấm.
3. Muốn giảm mạnh mà không bịa số: bỏ 8 tỷ lệ khỏi form từng xã (320 ô) và chỉ giữ một lần trên mỗi đô thị. Các ô đô thị tương ứng (120 ô) vẫn là B hoặc C.
