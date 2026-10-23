# Quy tắc tuân thủ quy hoạch từ dưới lên

Bộ quy tắc để đối chiếu đồ án cấp dưới với đồ án cấp trên. Chỉ mô tả điều kiện. Không có chương trình kiểm tra và không có giao diện.

Thứ bậc: **QHC 1/25.000 > QHC 1/10.000 > QHPK 1/2.000 > QHCT 1/500**.

Mỗi đồ án chỉ đối chiếu với cấp trên gần nhất còn hiệu lực trong cùng phạm vi. Thiếu cấp trung gian thì đối chiếu lên cấp còn lại. Trong vùng `overrideArea` của `public/data/chuyen-nganh/schemes.json`, đồ án có `priority` lớn hơn thay thế đồ án nằm trong `overrides`. Ngoài vùng đó, đồ án con vẫn tuân thủ `parent`. Hai đồ án mapid 21817 không khai báo `parent`; thứ bậc của chúng lấy theo QHC 1/25.000 và QHC 1/10.000.

## Gốc theo từng trường

QHC 1/25.000 có thể không ghi chi tiết. Với từng trường, đi từ cấp cao nhất còn phủ vị trí xuống dưới. Giá trị khác rỗng đầu tiên là gốc. Thiếu, bằng 0 hoặc ghi «không xác định» thì bỏ qua cấp đó. QHC 1/10.000 thành gốc cho QHPK và QHCT khi QHC 1/25.000 không có số. Không lấy cấp thấp hơn để sửa một gốc đã có số. Cấp trên bỏ trống không phải lỗi của cấp đó.

Thông báo kiểm tra của mọi quy tắc so giá trị phải có câu: «Giá trị gốc lấy từ {referenceLevel}.» UT-01 và UT-02 chọn đồ án trước, không chọn giá trị trường.

Khối máy đọc: `referenceFallback` trong `rules.json`.

Tệp máy đọc: [`rules.json`](rules.json). Lược đồ: [`rules.schema.json`](rules.schema.json).

## Dung sai dùng chung

| Ngưỡng | Giá trị | Ghi chú |
|---|---|---|
| Vị trí theo cấp trên | QHC 1/25.000: 12,5 m; QHC 1/10.000: 5 m; QHPK: 1 m; QHCT: 0,25 m | 0,5 mm trên bản vẽ. Ngưỡng nội bộ. Cần xác minh |
| Lộ giới | 0,5 m | Làm tròn số liệu, không phải chỉ tiêu quy chuẩn. Cần xác minh |
| Cao độ | 0,1 m | Cần xác minh |
| Đường kính | 0 mm | So đúng số milimét |
| Diện tích | 2% | Phần vụn do dựng hình. Cần xác minh |
| Hướng dòng | 45° | Lệch trên 90° là đảo chiều. Cần xác minh |

## Số lượng

41 quy tắc: Giao thông 7, Cấp nước 4, Cấp điện 4, San nền và thoát nước mưa 5, Thoát nước thải 4, Chất thải rắn và nghĩa trang 4, Thông tin liên lạc 3, Sử dụng đất 6, Ranh giới 2, Ưu tiên đồ án 2.

Tình trạng dữ liệu trên kho hiện có:

| Tình trạng | Số | Ý nghĩa |
|---|---:|---|
| Đối chiếu được | 23 | Có gốc: ở QHC 1/25.000, hoặc ở QHC 1/10.000 khi cấp trên bỏ trống |
| Thiếu giá trị | 16 | Cả QHC 1/10.000 cũng trống, bằng 0, lệch mã, hoặc chưa chốt đơn vị |
| Thiếu trường | 2 | QHC 1/10.000 cũng không có cột hoặc lớp cần dùng |

Nhờ lấy QHC 1/10.000 làm gốc, thêm 9 quy tắc đối chiếu được: GT-06, SN-01, SN-02, NT-01, NT-02, NT-03, CTR-02, SD-05, SD-06. Trước đó là 14.

QHPK và QHCT chưa có trong `data/chuyen-nganh/`. Lô và bản vẽ của chúng nằm ở `projects/<slug>/` trên GCS. Lược đồ props bản vẽ chỉ có `quyMo`, `congSuat`, `loai`, `capDuong`, `loGioi`, `matCat`. Lô đất dùng `plan.floors`, `plan.coverage`, `plan.far`.

## Giao thông

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| GT-01 | Lộ giới không thu hẹp | lỗi | Thiếu giá trị. Cột `logioi` có, nhưng QHC 1/25.000 và 1/10.000 đang bằng 0 |
| GT-02 | Lộ giới không vượt trần cấp trên | cảnh báo | Thiếu giá trị. `logioimax` bằng 0 trên hai đồ án tỷ lệ lớn |
| GT-03 | Không hạ cấp đường | lỗi | Đối chiếu được. Dùng cấp đã chuẩn hóa trong `giaothong25.json`, `giaothong10.json` |
| GT-04 | Mặt cắt không nhỏ hơn | cảnh báo | Thiếu giá trị. Có `kyhieumatcat`, chưa có bề rộng số (`matcat` rỗng) |
| GT-05 | Tim tuyến trong dung sai | lỗi | Đối chiếu được bằng hình học. `diemtoadotimduong` đang rỗng |
| GT-06 | Cao độ tim đường không thấp hơn khống chế | lỗi | Đối chiếu được. Gốc là 363 điểm cao độ của QHC 1/10.000 |
| GT-07 | Giữ nút giao đã xác định | cảnh báo | Đối chiếu được bằng giao cắt hình học. Chưa có lớp nút |

Ví dụ GT-01: đường lộ giới 36 m ở QHC không được thể hiện 24 m ở QHPK.

## Cấp nước

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| CN-01 | Ống đấu nối không lớn hơn tuyến nhận | lỗi | Đối chiếu được. `duongkinh` có số trên cả hai cấp QHC |
| CN-02 | Không thu nhỏ tuyến trục | lỗi | Đối chiếu được trên cặp QHC khi hai tuyến trùng tim |
| CN-03 | Công suất công trình đầu mối không giảm | lỗi | Thiếu giá trị. `congsuat` một phần bằng 0 |
| CN-04 | Giữ vị trí công trình đầu mối | lỗi | Đối chiếu được bằng điểm. Không áp dụng cho họng cứu hỏa |

Ví dụ CN-01: ống Ø600 ở QHCT không được đấu vào tuyến trục Ø400 ở QHC.

## Cấp điện

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| CD-01 | Cấp điện áp phù hợp tuyến nhận | lỗi | Thiếu giá trị. 1/25.000 ghi «Cao thế», 1/10.000 ghi mã 1, 2, 3. `dienap` rỗng |
| CD-02 | Công suất trạm không giảm và không vượt nguồn | lỗi | Thiếu giá trị. Có một phần `congsuat`, chưa chốt kVA hay MVA |
| CD-03 | Không thu hẹp hành lang an toàn | lỗi | Thiếu giá trị. Cột `hanhlangantoan` đang bằng 0 |
| CD-04 | Giữ vị trí trạm nguồn | lỗi | Đối chiếu được bằng điểm trạm |

## San nền và thoát nước mưa

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| SN-01 | Cao độ san nền không thấp hơn khống chế | lỗi | Đối chiếu được. Gốc là `caodothietke` của QHC 1/10.000 (363/363) |
| SN-02 | Đường kính cống mưa không thắt ở hạ lưu | lỗi | Đối chiếu được trên 536/1533 đoạn QHC 1/10.000 có đường kính khác 0 |
| SN-03 | Không đảo hướng thoát nước mưa | cảnh báo | Đối chiếu được bằng lớp `huong-thoat-nuoc` |
| SN-04 | Không chuyển lưu vực thoát mưa | lỗi | Thiếu giá trị. Có vùng ở 1/25.000, 1/10.000 mới có dạng đường |
| SN-05 | Công suất công trình tiêu không giảm | lỗi | Thiếu giá trị. `congsuat` đang bằng 0 |

## Thoát nước thải

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| NT-01 | Đường kính cống thải không thắt ở hạ lưu | lỗi | Đối chiếu được trên 419/599 đoạn QHC 1/10.000 có đường kính khác 0 |
| NT-02 | Hướng dòng cùng chiều cấp trên | cảnh báo | Đối chiếu được trên 355/599 đoạn QHC 1/10.000 có `dodoc` khác 0 |
| NT-03 | Công suất trạm xử lý không giảm | lỗi | Đối chiếu được trên 12/440 trạm QHC 1/10.000 có công suất khác 0 |
| NT-04 | Không chuyển lưu vực về trạm khác | lỗi | Thiếu trường. Chưa có vùng lưu vực nước thải; `nguontiepnhan` rỗng |

## Chất thải rắn và nghĩa trang

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| CTR-01 | Giữ vị trí khu xử lý và nghĩa trang | lỗi | Đối chiếu được bằng điểm và vùng |
| CTR-02 | Quy mô không giảm | lỗi | Đối chiếu được phần diện tích. QHC 1/10.000 có số khi cấp trên trống. `congsuat` vẫn bằng 0 |
| CTR-03 | Khoảng cách ly không nhỏ hơn | lỗi | Thiếu trường khoảng cách ly và chưa chốt ngưỡng mét |
| CTR-04 | Không hạ cấp nghĩa trang | cảnh báo | Thiếu giá trị. Có mã `capnghiatrang` 3 và 4, chưa có chú giải thứ bậc |

## Thông tin liên lạc

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| TT-01 | Giữ vị trí trạm thông tin | lỗi | Đối chiếu được bằng điểm |
| TT-02 | Dung lượng tuyến trục không giảm | lỗi | Thiếu giá trị. `dungluong` bằng 0; chỉ so khi cùng đơn vị FO hoặc cùng số đôi trong `tenduongday` |
| TT-03 | Tuyến đã ngầm hóa không chuyển thành nổi | lỗi | Đối chiếu được khi cả hai bên ghi Nổi hoặc Ngầm |

## Sử dụng đất

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| SD-01 | Chức năng đất thuộc nhóm cấp trên cho phép | lỗi | Đối chiếu được phần đã cấm trong `codebooks.landUse`. Cặp chưa liệt kê là cảnh báo |
| SD-02 | Mật độ xây dựng không vượt trần | lỗi | Thiếu giá trị trên hai QHC tỷ lệ lớn. Có `matdoxaydung` và `plan.coverage` ở một số đồ án |
| SD-03 | Tầng cao không vượt trần | lỗi | Thiếu giá trị trên hai QHC tỷ lệ lớn. Có `tangcao` và `plan.floors` ở một số đồ án |
| SD-04 | Hệ số sử dụng đất không vượt trần | lỗi | Thiếu giá trị trên hai QHC tỷ lệ lớn. Có `hesosudungdat` và `plan.far` ở một số đồ án |
| SD-05 | Đất cây xanh công cộng không giảm | lỗi | Đối chiếu được với QHPK, QHCT. Gốc là mã 5 của QHC 1/10.000 |
| SD-06 | Đất công cộng không giảm | lỗi | Đối chiếu được với QHPK, QHCT. Gốc là mã 2 của QHC 1/10.000 |

Mã chức năng lấy từ `LAND_CODES` trong `public/js/qhc2045.js`. Vùng 1/25.000 lấy từ `cats.zones` của `public/data/qhc2045/dinhhuong.json`.

## Ranh giới

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| RG-01 | Ranh cấp dưới nằm trong ranh cấp trên | lỗi | Thiếu giá trị. Một số đồ án địa phương có polygon. Hai đồ án mapid 21817 chưa có lớp ranh |
| RG-02 | Mỗi đồ án cấp dưới thuộc một ranh cấp trên | lỗi | Thiếu giá trị. Chưa đủ ranh QHPK và QHCT trong git |

## Ưu tiên đồ án

| Mã | Quy tắc | Mức | Dữ liệu |
|---|---|---|---|
| UT-01 | Trong vùng ghi đè lấy đồ án priority cao hơn | lỗi | Đối chiếu được. KCN Phong Điền priority 2 ghi đè đô thị Phong Điền trong ranh KCN |
| UT-02 | Ngoài vùng ghi đè vẫn tuân thủ đồ án cha | lỗi | Đối chiếu được với đồ án đã ghi `parent`. Hai QHC tỷ lệ lớn so theo thứ bậc, không theo `parent` |

UT-01 áp dụng trước mọi quy tắc khác.

## Căn cứ

Căn cứ đầy đủ nằm ở `legalBasis` của từng quy tắc. Các văn bản được gọi tên khi nhận được văn bản: Luật Quy hoạch đô thị và nông thôn năm 2024, QCVN 01:2021/BXD, QCVN 07:2023/BXD, TCVN 33:2006, TCVN 7957:2008, Nghị định 14/2014/NĐ-CP. Số điều, số bảng và bản còn hiệu lực đều ghi «cần xác minh» trong JSON. Không lấy số bảng của QCVN 01:2026/BXD mà kho mã đang trích để gán cho QCVN 01:2021/BXD.

`priority` trong `schemes.json` là quy ước của kho, không phải điều khoản luật.

## Trường đang dùng

| Nội dung | Tên trường trong lớp chuyên ngành | Tên trên lô hoặc bản vẽ đồ án |
|---|---|---|
| Lộ giới | `logioi`, `logioimin`, `logioimax` | `loGioi` |
| Cấp đường | `caphangduongbo`; lớp tĩnh dùng `c` | `capDuong` |
| Mặt cắt | `kyhieumatcat`, `matcat`; lớp tĩnh dùng `s` | `matCat` |
| Đường kính | `duongkinh` | chưa có trường riêng; chỉ parse số milimét từ `quyMo` nếu có |
| Cao độ | `caodothietke`, `caodonenthietke`, `caododuong`, `caodotunhien` | chưa có |
| Công suất | `congsuat` | `congSuat` |
| Cấp điện | `capdienthe`, `dienap` | chưa có |
| Hành lang điện | `hanhlangantoan` | chưa có |
| Hướng, độ dốc | hình học `huong-thoat-nuoc`, `dodoc`, `diemdau`, `diemcuoi` | chưa có |
| Chức năng đất | `chucnangsudungdat`; lớp tĩnh dùng `c` | `chucNang`, `kyHieu`, `lotCode` |
| Mật độ, tầng, hệ số | `matdoxaydung`, `tangcao`, `hesosudungdat` | `plan.coverage`, `plan.floors`, `plan.far` |
| Cây xanh, công cộng | mã 5 và mã 2; lớp `L = x` | theo nhãn chức năng |
| Viễn thông | `loaitramtttc`, `loaiduongday`, `tenduongday`, `dungluong` | chưa có |
| Nghĩa trang, CTR | `tennghiatrang`, `capnghiatrang`, `dientich`, `congsuat` | chưa có |
| Ranh, ưu tiên | lớp `*ranh-gioi*`, `boundaryFile` | `parent`, `overrides`, `priority`, `overrideArea` |

## Thêm hoặc sửa một quy tắc

1. Thêm một phần tử vào `rules` của `rules.json`. Giữ `id` duy nhất, dạng `GT-08`.
2. `sector` phải nằm trong mảng `sectors`.
3. `severity` chỉ nhận `lỗi` hoặc `cảnh báo`.
4. `condition.operator` dùng toán tử đã có trong lược đồ. `condition.formula` viết bằng chữ, nêu trường, phép so và dung sai. `onMissing` luôn là `bo-qua`. Không viết lại bước chọn gốc trong từng quy tắc: mọi quy tắc dùng `referenceFallback`.
5. Trường đo đặt `treatZeroAsMissing: true`.
6. `message` của quy tắc so giá trị phải có «Giá trị gốc lấy từ {referenceLevel}.» `legalBasis` chỉ ghi văn bản nhận được. Chưa rõ số điều hoặc số bảng thì ghi «cần xác minh». Không bịa số điều.
7. `dataNotes.status` chọn một trong ba: `doi-chieu-duoc`, `thieu-gia-tri`, `thieu-truong`. Ghi trường đang có và trường còn thiếu.
8. Sửa bảng tương ứng trong tệp này cho khớp.
9. Kiểm tra JSON với `rules.schema.json`.
10. Thêm tệp mới thì ghi đường dẫn vào `.cursor/rules/modules.mdc`, nhóm MOD-07, trong cùng thay đổi.
