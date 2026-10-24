---
name: gishue-download
description: >-
  Tải lớp quy hoạch từ WebGIS gisHue (gServer, geditor.aspx, gissonganh.hue.gov.vn) vào catalog tĩnh.
  Dùng khi người dùng giao task tải dữ liệu, mapid, lớp bản đồ, QHPK, QHC, QHCT, hoặc nhắc gisHue / gServer / geditor.
---

# Tải dữ liệu gisHue

Đọc skill này rồi chạy **một** lệnh. Không mở trình duyệt, không dò API, không bấm «Xuất shapefile». Không gọi `addFeature`, `updateFeature`, `deleteFeature`. Không in GeoJSON hay dump.

Mở `.cursor/rules/modules.mdc`, chỉ đọc file nhóm MOD-07 và MOD-12 nếu lệnh thất bại. Không đọc GeoJSON, JSON nặng, PDF.

## Lệnh

```bash
node scripts/gishue-import.mjs --mapid <id> [--mapid <id> ...]
```

Thử trước khi ghi: thêm `--dry-run`. Lệnh tự lấy metadata, bỏ lớp sử dụng đất đã có trong `public/data/su-dung-dat-index.json`, tải mọi lớp còn lại, đọc `geom` hoặc `s_geo`, chuyển VN-2000 sang WGS84, cắt lô dùng `scripts/clip-scheme-lots.mjs` (dung sai 5 m; chỉ cắt phần nhô quá 5 m; không bỏ lô nằm trong ranh), ghi catalog như đồ án đã xuất bản (`public/data/chuyen-nganh/schemes.json`, `index.json`, `data/chuyen-nganh/<slug>/<ngành>/<hien-trang|quy-hoach>/`). Ngành lấy từ tên lớp (giao thông, sử dụng đất, san nền, …) nên lớp vào đúng tab Hạ tầng. Cache thô ở `.cache/gishue` (gitignore). Chạy lại được.

Đọc đúng bảng tóm tắt trên stdout: tên đồ án, từng lớp (HT/QH, số đối tượng, bỏ, cắt, hình hỏng), dòng tổng. Nếu có `khop catalog` thì đồ án đã có, dừng, không mở PR dữ liệu. Nếu dòng bắt đầu bằng `!` thì đó là cảnh báo. Lệnh thoát khác 0 là lỗi.

Lớp GeoJSON hoặc zip trên 5 MB không commit. Lệnh ghi một lần lên GCS `chuyen-nganh/v1/` (Class A, `Cache-Control` immutable) và catalog trỏ URL công khai. File nhỏ hơn vẫn nằm trong git.

## Sau khi lệnh xong

Một PR gồm file catalog và lớp mới. Không chạy thêm lệnh chờ CI trong lúc sửa. Không đụng nhánh hay tab của agent khác.

Chỉ khi lệnh thoát lỗi mới đọc `scripts/gserver-page-fetch.js`, `scripts/gserver-to-shp.js`, `scripts/clip-scheme-lots.mjs`. Không tự mở geditor.
