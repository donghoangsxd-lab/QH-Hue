# Bộ nguyên tắc tuân thủ lô đất

Máy kiểm tra đọc [`public/data/tuan-thu-lo/principles.json`](../../public/data/tuan-thu-lo/principles.json). Lược đồ: [`principles.schema.json`](../../public/data/tuan-thu-lo/principles.schema.json). Giao diện bảng «Thông tin quy hoạch» gọi `annotateCompliance` trong `public/js/planCompliance.js`. Phần thuần không phụ thuộc bản đồ nằm ở `public/js/planComplianceCore.js`.

Ba kết luận: **Phù hợp**, **Chưa phù hợp**, **Chưa đủ dữ liệu**. Thiếu mã, thiếu hình, hoặc chưa có nguyên tắc cho đúng chức năng cấp trên thì không ghi phù hợp.

Cấp trên trực tiếp: QHCT lấy lô QHPK chứa nó; QHPK lấy ô QHC 1/10.000 chứa nó. Có `parent` trong `public/data/chuyen-nganh/schemes.json` thì ưu tiên đúng đồ án cha khi đồ án đó có lô giao vùng. Không có lô của `parent` thì dùng `links` trong `public/data/htkt/cong-suat.json` (tab CongSuatLienKet: `child`/`parent` hoặc `Ma_Con`/`Ma_Cha`). Không có cả hai thì lấy lô cấp trên theo hình học. Với QHCT, ô QHC neo cũng ưu tiên cha đã khai báo của lô QHPK (cùng thứ tự). Lô công trình (không phải lô đất) không dùng làm chức năng cấp trên.

## Nguyên tắc CXCC-01

Ô QHC 1/10.000 là đất cây xanh công cộng khi khớp mã **5** (`LAND_CODES` trong `public/js/qhc2045.js`, khóa `C-CXDT`).

- QHPK trong ô đó chỉ được **cây xanh** hoặc **bãi đỗ xe**.
- QHCT chỉ xét khi có lô QHPK cha và ô QHC tại lô vẫn là cây xanh công cộng. Được cây xanh, bãi đỗ xe, công trình hạ tầng. **Dịch vụ** không quá 5% phần giao giữa phạm vi đang xem (thửa, vùng đo hoặc ô điểm) và vùng cây xanh công cộng. Mẫu số là vùng đó, không phải từng lô dịch vụ.

Ánh xạ mã và khóa ký hiệu ghi trong `sources` của từng nhóm trong JSON. Không thêm mã đất không có trong `LAND_CODES` hoặc `tt16Symbols.js`.

Khóa ký hiệu hoặc mã đất nhận ra được nhưng không nằm trong nhóm được phép thì **chưa phù hợp** (không đạt: chức năng). Chữ tự do không khớp nhóm nào và không có khóa thì **chưa đủ dữ liệu**.

## Thêm một nguyên tắc

1. Nhóm chức năng mới: thêm vào `categories`. `landCodes` lấy từ `LAND_CODES`. `patternKeys` lấy từ khóa `TT16_STYLES` / `landPatternKey`. `phrases` là cụm tiếng Việt đã có trên nhãn. `also` kéo nhóm rộng hơn (mã 5 là cây xanh công cộng nên cũng là cây xanh). Ghi `sources`.
2. Thêm một phần tử `rules`. `id` duy nhất. `anchor` là ô cấp trên phải khớp thì nguyên tắc mới áp dụng (`level` + `category`).
3. Mỗi `steps[]` là một cấp dưới: `childLevel` (`QHPK` hoặc `QHCT`), `directParent` là cấp ngay trên, `allow` là id nhóm được phép.
4. Trần diện tích, nếu có: `areaShare.category`, `areaShare.maxRatio` (0,05 = 5%), `areaShare.basis`. Basis `phan-thua-trong-vung-neo` là phần giao phạm vi đang xem với vùng neo. Thiếu số thì máy không suy ra 0 và không kết luận phù hợp.
5. Chức năng cấp trên khác `anchor` thì nguyên tắc này bỏ qua. Không còn nguyên tắc nào khác thì bảng ghi chưa đủ dữ liệu, kèm tên chức năng cấp trên.
6. Chạy `node scripts/test-plan-compliance.mjs`.

Tầng cao, mật độ xây dựng, hệ số sử dụng đất chưa có trong bộ này: hai cấp phải cùng có `plan.floors`, `plan.coverage`, `plan.far` rồi hãy thêm bước so trần. Đồ án QHPK trong sổ `schemes.json` hiện thường chỉ là slug `parent` của QHCT, chưa có bản ghi riêng: điền bản ghi (slug, tên, `parent` trỏ QHC 1/10.000) thì máy ưu tiên đúng đồ án cha thay vì chỉ cắt hình. Chưa có bản ghi QHPK thì thêm một dòng CongSuatLienKet (`Ma_Con` là slug QHPK, `Ma_Cha` là slug QHC 1/10.000) và xuất vào `links` của `cong-suat.json`.
