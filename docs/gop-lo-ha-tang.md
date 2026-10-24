# Gộp lô hạ tầng chạm ranh

Các lô hạ tầng cùng loại, cùng giai đoạn, cùng một đồ án, có ranh chạm nhau (kể cả khe số hóa không quá 4 m) là một công trình.

Áp dụng cho mọi loại lô hạ tầng: công viên, trường, y tế, bãi đỗ xe và các loại còn lại.

- Tên công trình ghi đủ mã các lô, cách nhau bằng dấu phẩy.
- Diện tích cộng các mảnh.
- Một ghim và một vòng bán kính phục vụ, đặt tại tâm diện tích. Thống kê và chấm điểm đếm một công trình.
- Polygon gốc giữ trên bản đồ. Không xóa lô.
- Không gộp lô của hai đồ án khác nhau. Không gộp hiện trạng với quy hoạch (cặp HT + QH vẫn theo quy tắc ghép giai đoạn sẵn có).
- Lô hạ tầng QHCT 1/500 không bị từ chối. Lô QHPK chỉ bỏ khỏi một lần ghép giai đoạn khi QHCT trùng vị trí, không bị xóa polygon. Quy tắc này không đổi.
- Cùng loại tính theo mã công trình sau dấu `→` trên layer (hoặc prefix / mã ID). Hậu tố cấp `_DT` / `_DV` không tách một công trình thành hai. Mầm non, tiểu học, THCS, THPT vẫn là các loại khác nhau.

Dung sai 4 m nằm ở `TOUCH_TOLERANCE_M` trong `public/js/touchGroups.js`.

## Dữ liệu đang có

`scripts/build-infra-touch-groups.mjs` đọc từng đồ án trên bucket (`projects/<slug>/hien-trang.json`, `su-dung-dat.json`) và `infrastructure_hue.json`, rồi ghi `public/data/infra-touch-groups.json`. File này đi theo bản Worker. Trình duyệt áp khi tải danh sách công trình. Không có request máy chủ mới, không đọc thêm GCS trên mỗi lượt mở bản đồ.

Máy chủ Cloud Run áp cùng file một lần trong cache ETag của `getRawDataList` (thống kê phường, độ phủ). Ảnh Cloud Run chỉ đổi khi chạy workflow Cloud Run bằng tay. Bản đồ, ghim, vòng bán kính, heatmap và biểu đồ đếm trên máy người dùng đúng ngay khi Worker phát hành.

## Lần nhập sau

`refreshParcels` gọi `groupInfraParcels` sau khi đã gán cấp trường và giai đoạn, trước khi khớp công trình có sẵn. Lô gốc trong phiên nhập không bị xóa, nên đổi cấp trường rồi phân tích lại vẫn tách hoặc gộp đúng. Lô chờ chọn cấp, lô bị từ chối, lô đất và lô vắt ranh không đưa vào nhóm.
