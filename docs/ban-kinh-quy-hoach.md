# Bán kính phục vụ — công trình quy hoạch

Bán kính công trình hiện trạng trên các tab Sheet hiện có (công viên, trường học, y tế, văn hóa, chợ, bãi đỗ xe, xe buýt, PCCC, nghĩa trang) vẫn lấy từ cấu hình QCVN đang chạy: `standardRadius` / `defaultRadius` trong `config/constants.js`. Cột `BanKinh` của các tab đó chỉ để đối chiếu, không thay bán kính vẽ.

Công trình trên đồ án (lớp catalog hạ tầng kỹ thuật, phase quy hoạch và hiện trạng khi lập đồ án) chưa có bán kính trong Sheet. Không điền số ước. Giao diện ghi «—» cho đến khi tab mới có số.

## Tab mới

Tên tab: `BanKinhQuyHoach`, cùng sổ `HTXH-Hue-06.2026`.

Mẫu cột: `docs/templates/ban-kinh-quy-hoach.csv`.

| Cột | Nội dung |
|---|---|
| `Ma_DoAn` | Slug đồ án sau khi quy về `catalogScheme` (ví dụ `qhc-hue-2045`, `qhc-chan-may`) |
| `Ten_DoAn` | Tên trên sổ đồ án |
| `Cap` | `QHC25`, `QHC10`, `QHPK` hoặc `QHCT` |
| `Nhom_HTKT` | Một trong bảy id ngành: `giao-thong`, `cap-nuoc`, `cap-dien`, `san-nen-thoat-mua`, `thoat-nuoc-thai`, `chat-thai-ran-nghia-trang`, `thong-tin-lien-lac` |
| `Subtype` | Tên file lớp, bỏ `.geojson` / `.json` |
| `Ten_Lop` | Tên lớp trên catalog |
| `BanKinh_m` | Mét. Ô trống = chưa có số, bản đồ ghi «—» |
| `Nguon` | Quyết định, thuyết minh hoặc ô Sheet đã duyệt |
| `GhiChu` | Ghi chú ngắn |

Họng cứu hỏa nằm ở ngành cấp nước, không ghi sang trụ sở PCCC. Lớp cột đèn không còn trên panel; không khai báo bán kính cho lớp đó.

## Bản tĩnh

Xuất tab ra `public/data/htkt/ban-kinh-quy-hoach.json`:

```json
{ "tab": "BanKinhQuyHoach", "source": "Google Sheet", "rows": [] }
```

Mỗi dòng: `maDoAn`, `tenDoAn`, `cap`, `nhom`, `subtype`, `tenLop`, `banKinh`, `nguon`, `ghiChu`. `banKinh` là số mét hoặc `null`. File hiện không có dòng nào. Trình duyệt chỉ đọc file này, không gọi Sheet mỗi lần mở lớp.
