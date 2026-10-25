# Quy mô hạ tầng theo đồ án

Mỗi đồ án giữ một số tổng cho từng ngành hạ tầng kỹ thuật đã có trên panel. Ô trống là chưa có số. Giao diện ghi «chưa có số» và «chưa đủ dữ liệu». Không điền số ước.

Trần lấy từ đồ án cha đúng một bậc:

- Mọi đồ án QHC 1/10.000 cộng lại, đối chiếu với QHC đô thị Thừa Thiên Huế 1/25.000 (`qhc-hue-2045`).
- Các QHPK 1/2.000 cùng một QHC 1/10.000 cộng lại, đối chiếu với đồ án cha đó.
- Các QHCT 1/500 cùng một QHPK cộng lại, đối chiếu với QHPK cha.

Đủ số và tổng không vượt trần thì «OK». Tổng đã biết vượt trần thì «vượt» kèm phần vượt, tên chỉ tiêu và đồ án cha; số mới không được ghi. Thiếu cha, thiếu con, thiếu số hoặc lệch đơn vị thì «chưa đủ dữ liệu», không kết luận đạt. Số 0 là số đã nhập. Đồ án QHC 1/25.000 cấp xã không phải trần thành phố.

Chỉ tiêu khớp quy tắc đã có, không thêm ngành:

| Ngành | Chỉ tiêu | Mã | Quy tắc |
|---|---|---|---|
| Giao thông | khối lượng giao thông | `khoi-luong` | Chưa có quy tắc tổng. Đơn vị do sheet |
| Cấp nước | công suất cấp nước | `cong-suat` | CN-03. Ví dụ đơn vị m³/ngày đêm khi thuyết minh chốt |
| Cấp điện | công suất trạm | `cong-suat` | CD-02. Đơn vị kVA hay MVA chưa chốt |
| San nền và thoát nước mưa | công suất công trình tiêu | `cong-suat` | SN-05 |
| Thoát nước thải | công suất trạm xử lý | `cong-suat` | NT-03 |
| Chất thải rắn và nghĩa trang | quy mô | `quy-mo` | CTR-02 |
| Thông tin liên lạc | dung lượng tuyến trục | `dung-luong` | TT-02. Cùng đơn vị mới được cộng |

## Sheet

Cùng sổ `HTXH-Hue-06.2026`.

Tab `CongSuatDoAn`, mẫu `docs/templates/cong-suat-do-an.csv`.

| Cột | Nội dung |
|---|---|
| `Ma_DoAn` | Slug sau `catalogScheme`, ví dụ `qhc-hue-2045`, `qhc-trung-tam` |
| `Ten_DoAn` | Tên trên sổ đồ án |
| `Cap` | `QHC25`, `QHC10`, `QHPK` hoặc `QHCT` |
| `Nhom_HTKT` | Id bảy ngành |
| `ChiTieu` | Mã ở bảng trên |
| `Ten_ChiTieu` | Tên chỉ tiêu |
| `DonVi` | Để trống nếu chưa chốt. Cùng một chỉ tiêu phải cùng đơn vị |
| `GiaTri` | Số. Ô trống = chưa có số |
| `Nguon` | Quyết định hoặc thuyết minh |
| `GhiChu` | Ghi chú ngắn |

Tab `CongSuatLienKet`, mẫu `docs/templates/cong-suat-lien-ket.csv`.

| Cột | Nội dung |
|---|---|
| `Ma_Con` | Slug đồ án con |
| `Ma_Cha` | Slug đồ án cha đúng một bậc |
| `GhiChu` | Ghi chú |

QHC 1/10.000 không cần dòng liên kết: hệ thống cộng vào `qhc-hue-2045`. QHCT đã có `parent` trong `public/data/chuyen-nganh/schemes.json` thì dùng cha đó. Dòng liên kết chỉ để bổ sung, ví dụ QHPK thuộc QHC 1/10.000 nào.

Xuất hai tab vào `public/data/htkt/cong-suat.json` (`rows`, `links`). Trình duyệt đọc file này, không gọi Sheet mỗi lần mở. Bản nháp trên trình duyệt chỉ để thử; xóa nháp thì trở lại file.

Đồ án mới nhập ở hồ sơ quy hoạch đi cùng cổng này. Có số mà vượt trần thì hồ sơ chưa ghi. Chưa đủ dữ liệu thì vẫn ghi hồ sơ và báo «chưa đủ dữ liệu».
