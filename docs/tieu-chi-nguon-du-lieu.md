# Tiêu chí chấm điểm đô thị và nguồn dữ liệu

Phân loại tiêu chí theo dữ liệu bản đồ đang có. Sáu đô thị một phần xã chấm bằng polygon trong `public/data/urban614.geojson` (`public/js/urbanPartGeom.js`).

Căn cứ webapp đang dùng là **Nghị quyết 111/2025/UBTVQH15** (hiệu lực 01/01/2026), hiện trạng theo Quyết định 614/QĐ-UBND, mục tiêu 16 đô thị theo Quyết định 756/QĐ-UBND. Nghị quyết 26/2022/UBTVQH15 không còn là bộ tiêu chí trong code. Loại II và III chấm Bảng 2A (23 tiêu chuẩn, tối đa 100). Loại I chấm Phụ lục I (15 tiêu chuẩn, đạt khi ≥ 10/15). Cả 16 đô thị áp Điều 8 khoản 2 điểm d (di sản UNESCO): mật độ dân số không xét; mức tối thiểu các tiêu chuẩn không thuộc nhóm cảnh quan còn 50%. **Bảng 2B chưa chấm** (1.II.10 để trống).

Đếm: **8 tiêu chí nhóm A, 13 nhóm B, 17 nhóm C** (38 tiêu chí). Bốn tỷ lệ thống kê chỉ nhập một lần ở cấp đô thị. Bốn tỷ lệ đo từ bản đồ được tính khi mở bảng chấm. Ô thiếu còn **130**.

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
| San nền, thoát nước mưa | đường thoát hiện trạng QHC 1/25.000 và 1/10.000 | `duongkinh`, `chieurong`, `loaiphanluu` | 2A.III.09 |
| Thoát nước thải | điểm XLNT hiện trạng và quy hoạch cùng hai đồ án | điểm `congsuat` | 2A.III.10 |
| Chất thải rắn, nghĩa trang | điểm hiện trạng và quy hoạch QHC 1/25.000, 1/10.000, Vinh Hưng | `dientich` (ha nếu &lt; 10.000); mã đất `NTD`, `NTR` | 2A.III.12 |
| Thông tin liên lạc | đường và điểm trạm hiện trạng | chiều dài; số trạm | Không có tiêu chí A/B. Số ở cuối bảng. |
| Sử dụng đất hiện trạng | `qhc-khu-cong-nghiep-phong-dien` `sdd/hien-trang` | `maloaidat`, `dientich` (m²) | 2A.III.21 khi lớp phủ ≥ 50% ranh |
| Phủ xanh tạm | `getForestStats&mode=cover` (ESA WorldCover, đã có trên API) | ha cây, bụi, cỏ, trồng trọt, đất ngập nước, rừng ngập mặn, mặt nước | 2A.III.21 khi lớp đất không đủ |

Phú Lộc và Vinh Hưng có hiện trạng sử dụng đất trên GCS. Bảng chấm không tải hai file đó. Số tự tính hiện cạnh giá trị, kèm «tạm thời» khi tuyến cống chưa có kích thước hoặc khi xanh lấy từ WorldCover. Ô cán bộ nhập ghi đè giá trị đem chấm; chú thích vẫn ghi số lớp và chữ «không dùng».

## Bảng tóm tắt

| Tiêu chí | Nhóm | Nguồn |
|---|---|---|
| 2A.I.01 Vai trò, vị trí theo quy hoạch | C | Nhận định cấp vùng / tỉnh / xã. Không có thuộc tính. |
| 2A.I.02 Vai trò đô thị trung tâm | C | Trụ sở, đầu mối kết nối: nhận định. |
| 2A.II.03 Quy mô dân số | A | Không lấy từ 7 lớp mạng. Đô thị đủ xã: `P = Σ Dan_So_Vector`. Sáu đô thị một phần: `P_xã × km² polygon / km² xã`. |
| 2A.II.04 Mật độ trên diện tích tự nhiên | A | Không lấy từ 7 lớp mạng. Đô thị đủ xã: `P / Σ Dien_Tich_Km2`. Sáu đô thị một phần: `P / km² polygon`. Điểm vẫn miễn. |
| 2A.II.05 Tỷ lệ lao động phi nông nghiệp | C | Số thống kê. Nhập một lần ở cấp đô thị, không theo xã. |
| 2A.III.06 Đầu mối giao thông | B | Điểm trong `hien-trang-tam/giao-thong.geojson` (tạm thời). Thiếu cấp vùng / tỉnh / xã. |
| 2A.III.07 Mật độ đường đô thị | A | Giá trị chấm: `(km main + km kiet) / km² đất xây dựng`. Đối chiếu tạm thời: km `nhom=mang` trong ranh, không thay mật độ. |
| 2A.III.08 Tỷ lệ dân được cấp nước sạch | C | Số thống kê. Nhập một lần ở cấp đô thị. Ống và `congsuat` không phải tỷ lệ dân. |
| 2A.III.09 Mật độ cống thoát nước chính | A | Km cống chính / đất xây dựng. Cấp 1 theo QCVN 07:2023/BXD mục 1.4.9; không có cấp thì ≥ 400 mm (mục 2.2.2) hoặc tuyến chưa ghi kích thước trên lớp mạng. |
| 2A.III.10 Công suất trạm XLNT / thiết kế | B | `congsuat` hiện trạng / `congsuat` quy hoạch. Một phần vì không tách vận hành. Chỉ thiết kế thì chưa ra %. |
| 2A.III.11 Tỷ lệ CTR xử lý đạt | C | Số thống kê. Nhập một lần ở cấp đô thị. Điểm CTR không có tỷ lệ xử lý. |
| 2A.III.12 Nghĩa trang xây theo quy hoạch | B | `dientich` điểm hiện trạng / quy hoạch, cộng polygon `NTD`/`NTR` nếu có. Thiếu một vế thì chưa ra %. |
| 2A.III.13 Nhà tang lễ | A | Không lấy từ 7 lớp mạng. Đếm `11-NT` đã duyệt, `ntKind = funeral`. |
| 2A.III.14 Giường bệnh / 10.000 dân | C | Số thống kê. Nhập một lần ở cấp đô thị. Điểm `7-YT` không có số giường. |
| 2A.III.15 Cơ sở giáo dục, đào tạo | B | Đếm được THPT đã duyệt (cận dưới). Không nằm trong 7 lớp mạng. Thiếu ĐH, CĐ, trung cấp, dạy nghề. |
| 2A.III.16 Công trình văn hóa | B | Đếm `8-VH` đã duyệt. Không nằm trong 7 lớp mạng. Cùng mã còn sân thể thao, chưa tách. |
| 2A.III.17 Công trình thể thao | B | Lọc tên trong `8-VH`. Không có lớp riêng trong 7 ngành. |
| 2A.III.18 Thương mại, dịch vụ | A | Không lấy từ 7 lớp mạng. Đếm `9-TM` đã duyệt (`TM_DT` + `TM_DV`). |
| 2A.III.19 Đất dịch vụ công cộng / người | B | `Σ size` của THPT, `7-YT`, `8-VH`, `9-TM` / P. Không lấy từ lớp sử dụng đất hiện trạng. |
| 2A.III.20 Không gian xanh ≥ 2 ha | B | Đếm `1-CV` có `size ≥ 20.000` m². Không lấy từ mã đất hiện trạng. |
| 2A.III.21 Tỷ lệ xanh trên diện tích tự nhiên | B | Lớp sử dụng đất khi phủ ≥ 50% ranh. Không đủ thì tạm thời ESA WorldCover, một lần khi mở bảng. |
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

**2A.III.09.** `km cống chính / km² đất xây dựng đô thị` (Nghị quyết 111, chú thích 2A.III.09). Cống chính là tuyến cấp 1 (QCVN 07:2023/BXD mục 1.4.9); quy chuẩn không nêu đường kính cho cấp 1. Lớp đồ án không có trường cấp: cộng tuyến có đường kính hoặc bề rộng ≥ 400 mm (mục 2.2.2, cống mưa ngoài đường phố) và tuyến `loaiphanluu = 1`. Tuyến trên lớp mạng thoát mưa chưa ghi kích thước vẫn được cộng và ghi tạm thời. Thủy lợi, hướng thoát và công trình tiêu không tính. Mẫu số đô thị đủ xã là đất xây dựng Dynamic World (`getBuiltArea`, cùng lần tải với mật độ đường). Đô thị một phần dùng diện tích polygon `urban614` vì đất xây dựng chưa cắt theo polygon. Ô `matDoCong` ghi đè.

**2A.III.13.** Đếm `11-NT` đã duyệt, `ntKind === 'funeral'`. Sáu đô thị một phần chỉ lấy điểm có tọa độ nằm trong polygon.

**2A.III.18.** Đếm `9-TM` đã duyệt. Sáu đô thị một phần chỉ lấy điểm nằm trong polygon.

**1.II.07.** Tổng `Dan_So_Vector` của 40 xã-phường. Đạt khi ≥ 2.500.000. Ô `tp:TP` / `danSo` chỉ đính chính.

**1.II.09.** Tổng dân số hai đô thị loại II (trung tâm và Hương Thủy), cùng công thức 2A.II.03. Đạt khi ≥ 600.000.

## Nhóm B — tính được một phần

**2A.III.06 và 1.III.11.** Điểm trong `public/data/hien-trang-tam/giao-thong.geojson` (cờ tạm thời, đã gộp từ hiện trạng các đồ án). Thiếu thuộc tính cấp (vùng, tỉnh, xã, khu vực, quốc tế). Không tự gán mức điểm từ tên điểm. Ô mức và ô đạt/chưa đạt vẫn thiếu.

**2A.III.10.** `congsuat` điểm XLNT hiện trạng / `congsuat` điểm XLNT quy hoạch của QHC 1/25.000 và 1/10.000. Lớp không có trường vận hành riêng, nên tỷ lệ là một phần: dưới ngưỡng thì chưa kết luận chưa đạt. Chỉ có công suất thiết kế, hoặc chỉ có hiện trạng, thì chưa ra phần trăm. Ô `xlnt` ghi đè.

**2A.III.12.** Diện tích nghĩa trang đã có / diện tích theo quy hoạch. Polygon mã `NTD` (hiện trạng) và `NTR` (quy hoạch) được cộng khi có trong lớp sử dụng đất. Lớp mạng nghĩa trang trong repo là điểm: `dientich` nhỏ hơn 10.000 được hiểu là ha (cùng cách với 9,5 ha của nhà máy phía nam sông Hương). Thiếu một vế thì chưa ra phần trăm. Ô `nghiaTrang` ghi đè.

**2A.III.15.** Webapp đếm THPT đã duyệt (`urbanResults.THPT`) và ghi là cận dưới. Sáu đô thị một phần chỉ đếm điểm trong polygon. Bộ tiêu chí còn đại học, cao đẳng, trung cấp, dạy nghề. Mầm non, tiểu học, THCS không được cộng.

**2A.III.16.** Đếm mọi `8-VH` đã duyệt (`VH_DT` + `VH_DV`). Sân thể thao cùng mã vẫn nằm trong số này.

**2A.III.17.** Lọc tên trong cùng danh sách `8-VH` (sân, nhà thi đấu, sân vận động, bể bơi, đường chạy, gôn, cơ sở tập). Kết quả chỉ tham khảo, `pts = null`. Không có lớp thể thao riêng.

**2A.III.19.** `(diện tích THPT + 7-YT + 8-VH + 9-TM) / P`. Sáu đô thị một phần cộng `size` của điểm nằm trong polygon và chia cho dân số ước. Dân số ước thấp làm m²/người cao, nên chưa cộng điểm cho đến khi cán bộ đính chính dân số.

**2A.III.20.** Đếm `1-CV` (cả `CV_DT` và `CV_DV`) có `size ≥ 20.000`. Sáu đô thị một phần chỉ đếm điểm trong polygon. Không rõ diện tích thì không đếm. Chưa có lớp quảng trường hay phố đi bộ.

**2A.III.21.** Nếu hiện trạng sử dụng đất phủ ít nhất một nửa diện tích ranh thì tỷ lệ là diện tích mã xanh và mặt nước (rừng, nông nghiệp, cây xanh, sông, mặt nước) chia diện tích tự nhiên. Repo mới có lớp KCN Phong Điền, không đơn vị nào đạt một nửa ranh, nên bảng dùng tạm ESA WorldCover (`getForestStats&mode=cover`, đã có trên API): cây, bụi, cỏ, trồng trọt, đất ngập nước, rừng ngập mặn và mặt nước, chia diện tích tự nhiên của các xã trong phạm vi. Đô thị một phần lấy tỷ lệ cả xã chủ. Ghi tạm thời. Không tải file sử dụng đất Phú Lộc và Vinh Hưng trên GCS. Quy hoạch sử dụng đất (`sdd.json`, `dinhhuong.json`) không dùng. Ô `khongGianXanh` ghi đè.

**2A.III.22.** `Σ size` của `CV_DT` nằm trong phạm vi / P. Sáu đô thị một phần dùng dân số ước ở mẫu số nên chưa cộng điểm, cùng lý do 2A.III.19.

**1.II.08.** `(dân số loại II + dân số loại III) / dân số thành phố × 100`. Sáu đô thị một phần cộng bằng ước theo tỷ lệ diện tích. Vì ước lượng là cận dưới, mức đạt giữ ở «một phần» cho đến khi có dân số nhập tay.

**1.III.12.** Với từng đô thị loại II: dân số raster nằm trong buffer bán kính quy chuẩn của điểm `13-BUS` đã duyệt, chia cho dân số raster của các phường (`getNetworkCoverage` trong `api/gee.js`). Bán kính lấy từ quy chuẩn điểm (webapp ghi 500 m đi bộ). Raster mặc định là phương pháp B, asset `Pixel-danso-nha`, trọng số `gs://hue-infra-data-us/gba/pop-weights.csv` — khác với `danSo` dùng cho 2A.II.03. Km `nhom=duong-sat` và `nhom=duong-thuy` của file giao thông tạm thời chỉ ghi chú, không cộng vào điều kiện đạt. Không có tỷ lệ hành khách (chỉ tiêu 0204). Không có trạm đã duyệt thì kết quả là 0%, không phải thiếu hình học.

## Nhóm C — chỉ nhập tay

2A.I.01, 2A.I.02, 2A.II.05, 2A.III.08, 2A.III.11, 2A.III.14, 2A.III.23, 1.I.01–1.I.06, 1.II.10, 1.III.13, 1.III.14, 1.III.15.

2A.II.05, 2A.III.08, 2A.III.11 và 2A.III.14 là số thống kê, nhập một lần ở cấp đô thị. Form xã, phường không còn bốn ô này. Ống cấp nước và điểm chất thải rắn vẫn hiện cạnh bảng để đối chiếu, không điền phần trăm. Điểm y tế (`7-YT`) không có số giường. File quy chế kiến trúc (`kien-truc/<đơn vị>/quy-che.pdf`) không có năm bắt đầu thực hiện. 1.II.10 không có ô trên form vì chưa có Bảng 2B.

## 130 ô thiếu

`gapRows()` lúc chưa có số cán bộ: **130 ô thiếu**. Trước khi đo bốn tỷ lệ từ bản đồ và rút bốn tỷ lệ thống kê khỏi form xã, danh sách thiếu là 510.

| Khối | Số ô | Nhóm tiêu chí |
|---|---:|---|
| 4 tỷ lệ thống kê trên 15 đô thị loại II/III | 60 | C: 2A.II.05, 08, 11, 14 |
| 4 tiêu chí chữ trên 15 đô thị loại II/III | 60 | C hoặc B: 2A.I.01, I.02, III.06, III.23 |
| 10 câu có/không của loại I | 10 | C |

Bốn tỷ lệ đo được (09, 10, 12, 21) trên 15 đô thị và 40 xã-phường là phụ thuộc, không tính vào ô thiếu. Cán bộ vẫn ghi đè được. Nơi lớp không ra được tỷ lệ, bảng chấm để trống và ghi lý do, không chấm 0.

## Độ phủ bốn tỷ lệ đo được

Số dưới đây cắt trên máy, mẫu số mật độ cống trong bảng chấm là đất xây dựng khi mở bảng (không phải diện tích tự nhiên). Chiều dài là km cống chính trong ranh.

| Đô thị | Cống chính | XLNT hiện trạng / thiết kế | Nghĩa trang HT / QH | Xanh từ lớp đất |
|---|---|---|---|---|
| Trung tâm | 78,8 km | 82,2%, một phần | 30,3% (điểm, ha) | chưa đủ lớp, WorldCover |
| Hương Thủy | 33,9 km | chỉ thiết kế | 14,5% (điểm, ha) | chưa đủ lớp, WorldCover |
| Hương Trà | 39,9 km | chỉ thiết kế | có quy hoạch, thiếu ha hiện trạng | chưa đủ lớp, WorldCover |
| Phong Điền | 75,9 km | chỉ thiết kế | có quy hoạch, thiếu ha hiện trạng | 1,7 ha mặt nước KCN, phủ 0,7% ranh |
| Hóa Châu | 18 km | chỉ thiết kế | không có ha | chưa đủ lớp, WorldCover |
| Mỹ Thượng | 12,1 km | không có điểm có số | không có ha | chưa đủ lớp, WorldCover |
| Chân Mây – Lăng Cô | 0,8 km | 100%, một phần | có quy hoạch, thiếu ha hiện trạng | chưa đủ lớp, WorldCover |
| Quảng Điền | 4,7 km | không có điểm có số | không có ha | chưa đủ lớp, WorldCover |
| A Lưới 2 | 4,5 km | chỉ thiết kế | không có ha | chưa đủ lớp, WorldCover |
| Vinh Thanh | 0,3 km | không có điểm có số | không có ha | chưa đủ lớp, WorldCover |
| Phú Đa | 5,1 km | chỉ thiết kế | có quy hoạch, thiếu ha hiện trạng | chưa đủ lớp, WorldCover |
| Lộc Sơn | dưới 0,1 km | không có điểm có số | có quy hoạch, thiếu ha hiện trạng | chưa đủ lớp, WorldCover |
| Khe Tre | dưới 0,1 km | không có điểm có số | không có ha | chưa đủ lớp, WorldCover |
| Phú Lộc | 8 km | không có điểm có số | có quy hoạch, thiếu ha hiện trạng | chưa đủ lớp, WorldCover |
| Vinh Hiền | 6,3 km | không có điểm có số | không có ha | chưa đủ lớp, WorldCover |

40 xã-phường: 38 có km cống chính (không có: Nam Đông, Hương Thủy); 2 có cả `congsuat` hiện trạng và thiết kế (An Cựu, Chân Mây - Lăng Cô); 18 chỉ có thiết kế; 1 có đủ ha nghĩa trang hai vế trên cùng xã (Kim Long). Không xã nào có lớp sử dụng đất phủ một nửa ranh, nên 2A.III.21 của xã lấy tạm WorldCover khi mở bảng.
