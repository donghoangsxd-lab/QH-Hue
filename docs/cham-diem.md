# Chấm điểm phân loại đô thị (Nghị quyết 111/2025/UBTVQH15)

Tab **Chấm điểm** trên trục Quản lý theo đơn vị hành chính đọc một bảng dài. Ứng dụng không suy ra số đo từ bản đồ và không điền giá trị mẫu. Ô trống hiện «—» và tính là chưa đánh giá, không tính là đạt.

## Cột

| Cột | Nội dung |
| --- | --- |
| `ma_don_vi` | Mã đơn vị, xem bảng mã bên dưới. Tên đầy đủ cũng được (ví dụ `Phường Kim Long` trùng `kim-long`). |
| `loai_don_vi` | `hue`, `dothi` hoặc `xa`. |
| `ma_tieu_chi` | Mã tiêu chuẩn: Phụ lục I `1.I.01`–`1.III.15` (15), Bảng 2A `2A.I.01`–`2A.III.23` (23), Bảng 2B `2B.I.01`–`2B.III.37` (37), điểm cộng `2B.C.01`–`2B.C.26` (26). |
| `ky` | Quý `2026-Q1` … `2026-Q4`, hoặc năm `2026`. Không ghi tháng. |
| `gia_tri` | Số đo hoặc mức chữ. Để trống nếu chưa có. |
| `nguon` | Nơi lấy số (văn bản, cơ quan). Có thể trống. |
| `ghi_chu` | Ghi chú. Có thể trống. Dấu phẩy trong ô thì đặt cả ô trong dấu ngoặc kép. |

Dòng sau cùng thắng nếu trùng `loai_don_vi` + `ma_don_vi` + `ky` + `ma_tieu_chi`.

## Mã đơn vị

Thành phố: `hue` / `hue`.

Đô thị (`dothi`), đúng mã trên tab Đô thị, gồm cả hai kỳ quy hoạch: `a-luoi`, `a-luoi-2`, `chan-may`, `hoa-chau`, `huong-thuy`, `huong-tra`, `khe-tre`, `loc-son`, `my-thuong`, `phong-dien`, `phu-da`, `phu-loc`, `quang-dien`, `trung-tam`, `vinh-hien`, `vinh-thanh`. Thành phố Huế không chấm Bảng 2A.

Phường, xã (`xa`), 40 mã: `an-cuu`, `duong-no`, `hoa-chau`, `huong-an`, `huong-thuy`, `huong-tra`, `kim-long`, `kim-tra`, `my-thuong`, `phong-dinh`, `phong-dien`, `phong-phu`, `phong-quang`, `phong-thai`, `phu-bai`, `phu-xuan`, `thanh-thuy`, `thuan-an`, `thuan-hoa`, `thuy-xuan`, `vy-da`, `a-luoi-1`, `a-luoi-2`, `a-luoi-3`, `a-luoi-4`, `a-luoi-5`, `binh-dien`, `chan-may-lang-co`, `dan-dien`, `hung-loc`, `khe-tre`, `long-quang`, `loc-an`, `nam-dong`, `phu-ho`, `phu-loc`, `phu-vang`, `phu-vinh`, `quang-dien`, `vinh-loc`.

## Cách ghi `gia_tri`

Giữ đơn vị trong bảng nghị quyết. Dân số ghi theo nghìn người (`500` nghĩa là 500 nghìn người), không đổi sang người.

- Phụ lục I và điểm cộng: `Đạt` hoặc `Không đạt`. Cũng nhận `co`, `1`, `true`, `x` và `khong`, `0`, `false`.
- Mức chữ: đúng cụm trong bảng (ví dụ `Cấp vùng`, `Cấp tỉnh`, `Có dự án`, `Đang xây dựng`). Có thể ghi `toi_da`, `toi_thieu`, `khong`.
- Số: dấu phẩy là thập phân (`4,5`). Dấu chấm nhóm nghìn (`8.000` = 8000).
- Ô trống: chưa đánh giá.

## Điểm và kết luận

Điều 9.4: đạt mức tối đa thì điểm tối đa, đúng mức tối thiểu thì điểm tối thiểu, giữa hai mức nội suy tuyến tính, dưới tối thiểu thì 0. Phần trăm thiếu = (ngưỡng − thực tế) / ngưỡng × 100 so với mức tối thiểu và mức tối đa; chỉ tiêu càng thấp càng tốt thì đảo chiều. Mức chữ: thiếu 0% hoặc 100%. Thiếu so với 75 điểm chỉ hiện khi bảng đã chấm đủ; nếu còn ô trống thì tổng điểm là «—».

Huế (Điều 9.3.a, chỉ Điều 8.2.d): đạt khi đủ 10/15 tiêu chuẩn, trong đó tiêu chí I ≥ 4, II ≥ 2, III ≥ 4.

Đô thị loại II, III (Điều 9.3.b): tổng Bảng 2A ≥ 75, mỗi tiêu chí đạt mức tối thiểu, điểm trung bình mục III của phường và xã thành viên ≥ 48, và ít nhất một phường hoặc xã đạt Bảng 2B (≥ 75 và mỗi tiêu chí đạt mức tối thiểu). Thiếu một số bắt buộc thì kết luận là chưa đánh giá.

Phường, xã (Điều 9.3.c): mỗi tiêu chí ≥ mức tối thiểu và tổng ≥ 75. Điểm cộng 0,5 mỗi tiêu chuẩn, không vượt trần nhóm, không làm hỏng kết luận khi còn trống.

Huế áp Điều 8.2.d: mật độ (`2A.II.04`, `2B.II.04`) không xem xét và được điểm tối thiểu. Tiêu chuẩn cảnh quan, kiến trúc (`2A.III.20`–`2A.III.23`, `2B.III.28`–`2B.III.32`) giữ nguyên ngưỡng. Tiêu chuẩn khác: dưới mức tối thiểu nhưng còn ≥ 50% mức đó (công trình, cơ sở, dự án thì giảm số lượng theo Điều 9.4.b, làm tròn, không dưới 1) được điểm tối thiểu. Tỷ lệ hộ nghèo không được nới theo 50%.

Ghi chú trên từng tiêu chuẩn: `2B.I.03` nghịch; `2B.II.04` trên 25.000 người/km² chỉ điểm tối thiểu khi không phải trường hợp miễn; `2B.III.22` trong khoảng thì điểm tối đa, dưới 50 thì điểm tối thiểu, vượt trần thì 0; ô gộp dùng chung mức loại II và III; loại III của `2A.III.13` mức tối thiểu là «Có dự án»; loại III của `2B.III.21` mức tối thiểu là «Đang xây dựng». Nội suy tuyến tính là cách hiểu Điều 9.4.a.

## Tự tính

Ô trống được điền từ dữ liệu đã có trong webapp. Ô có `gia_tri` thì ghi đè và nhãn trên giao diện là «ghi đè». Giá trị tự tính mang nhãn «tự tính». Thiếu đầu vào thì vẫn «—», không thay bằng 0 và không tính là đạt.

Công thức và lý do nhập tay nằm ở `public/js/chamDiemNguon.js`. Phần tự tính dùng `dvhcStats.js` (dân số, diện tích), `urbanStatus.js` (Quyết định 614), điểm hạ tầng đã duyệt, `public/data/gba/apartments.json`, lớp hiện trạng qua `hienTrangScore.js`, và khi mở tab thì một lần `getWardRoads` cùng `getBuiltArea`. Không gọi WorldCover. Cận dưới (thiếu đại học, thiếu diện tích công trình, ước phần xã) chỉ được chấm khi đã chạm mức tối thiểu.

Những tiêu chuẩn còn lại phải nhập tay vì repo không có chuỗi thống kê tương ứng: thu nhập, GRDP, hộ nghèo, lao động, giường bệnh, tỷ lệ dân được cấp nước, tỷ lệ chất thải, chiếu sáng, internet, sự hài lòng, năm quy chế kiến trúc, giải thưởng. `agg.json` chỉ có sàn nhà tương đối, không dùng làm m² sàn.

## File và Google Sheet

Mẫu trống kỳ `2026-Q1`, đủ mọi đơn vị × tiêu chuẩn (2.903 dòng, chưa có số đo):

- `data/cham-diem/du-lieu.csv`
- `public/data/cham-diem/du-lieu.csv` (bản ứng dụng đọc)

Hai file phải giống nhau. Sửa tiêu chuẩn trong `data/cham-diem/tieu-chi.json` rồi chạy `node scripts/build-cham-diem.mjs`. Lệnh này sinh lại catalog và mẫu trống; số đã nhập trong CSV sẽ mất, nên chép số liệu ra trước.

Muốn lấy số từ Google Sheet: mở bảng, Tệp → Chia sẻ → Xuất bản lên web → CSV, rồi dán URL vào `CHAM_DIEM_SHEET_CSV` trong `public/js/chamDiemConfig.js`. Để trống (mặc định) thì không gọi Sheet, chỉ đọc file trong repo. Không ghi bí mật vào hằng số này. Tab chỉ tải một lần khi mở.
