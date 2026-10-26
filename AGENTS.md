# Quy tắc cho agent

## Chỉ mục module (luôn áp dụng)

Trước khi sửa: chọn nhóm MOD, mở `.cursor/rules/modules.mdc`, rg trong file của nhóm, chỉ đọc đoạn cần. Không đọc GeoJSON, JSON nặng, TIF, XLSX, PDF, pmtiles. Thêm, đổi chỗ hoặc xóa file thì sửa `modules.mdc` trong cùng PR. Đổi tên nhóm thì sửa cả mục này và `.cursor/rules/modules-index.mdc`.

01 khung · 02 UI chung · 03 thống kê phường · 04 state/QCVN · 05 bản đồ, ranh · 06 hiện trạng (marker, buffer, TT16) · 07 quy hoạch, đồ án · 08 heatmap, đẳng thời · 09 đo, in, 3D · 10 tra cứu, popup · 11 đề xuất điểm · 12 nhập CAD/OSM · 13 admin · 14 GCS ETag · 15 Apps Script · 16 dân số · 17 môi trường · 18 giao thông · 19 rate-limit · 20 Worker + Cloud Run + GCS · 21 hồ sơ GIS TT16 · 22 nhà, vi phạm, hành lang sông · 23 bốn trục (hành chính, quy hoạch, hạ tầng, kiến trúc)

Quy tắc nghiệp vụ (schema, QCVN, cache, ngôn ngữ) nằm ở `.cursorrules`. Mục dưới là ngân sách.

## Ngân sách / Budget rules

Kiểm soát chi phí là ràng buộc cứng. Không triển khai tính năng đốt CPU, đọc GCS hoặc gọi API bên ngoài rồi mới báo sau.

### 1. Mọi mô tả PR phải có mục «Tác động chi phí»

Ước lượng so với hiện trạng, kể cả khi gần bằng không (ghi «không đáng kể» và vì sao):

- CPU máy chủ: Cloud Run (tính cả thời gian chờ, gồm Earth Engine) và Cloudflare Workers (CPU 10 ms/request, thời gian chờ mạng không tính).
- GCS: Class A (ghi, liệt kê, sửa metadata, copy) và Class B (GET, HEAD). Bucket `hue-infra-data-us` ở Singapore.
- Băng thông (egress bucket, CDN, ảnh ô).
- API bên thứ ba: Earth Engine, Overpass, OSRM, Apps Script, và mọi lệnh gọi mới.

Đối chiếu hạn miễn phí:

- Cloud Run always-free: khoảng 180.000 vCPU-giây, 360.000 GiB-giây, 2 triệu request/tháng, chỉ `us-central1`, `us-east1`, `us-west1`. `asia-southeast1` tính tiền từ giây đầu.
- Cloudflare Workers free: 100.000 request/ngày, CPU 10 ms/request (thời gian chờ mạng không tính). Asset tĩnh: 25 MiB/file, 20.000 file/phiên bản trên gói free.

### 2. Ưu tiên file tĩnh đã tính sẵn

Đặt kết quả lên GCS hoặc CDN với `Cache-Control` dài. File có phiên bản trong đường dẫn hoặc `?v=`: `public, max-age=31536000, immutable`. File ghi đè cùng khóa: `max-age` ngắn, không `immutable`. Không tính lại trên máy chủ cho mỗi request nếu một file tĩnh làm được việc đó.

### 3. Báo owner trước khi làm

Tính năng thêm việc máy chủ trên mỗi request, hoặc nhân số lần đọc GCS (ô bản đồ, HTTP Range, HEAD/GET lặp), phải được owner chấp nhận trước khi viết code. Kèm ước lượng: số request mỗi lần mở lớp, phần nào là CPU, phần nào là Class B, và phần trăm hạn miễn phí. Không âm thầm triển khai rồi mới ghi vào PR.

### 4. Kiểm thử

Hạn chế gọi API production. Dùng mock, fixture đã lưu, preview có giới hạn, và ít ảnh chụp. Không mở vòng lặp Playwright hoặc `curl` vào `https://qh-hue.donghoangsxd.workers.dev` để «cho chắc». Trong PR, ghi usage do chính lần test gây ra (số request production, có đụng GCS/GEE hay không).

### 5. Endpoint máy chủ

Mọi endpoint mới cần giới hạn tần suất và cache. GET công khai phải có `Cache-Control` với `s-maxage` khi dữ liệu cho phép; `no-store` chỉ cho vỏ HTML/JS/CSS, hàng admin và tham số `fresh`. Retry có trần (không nhân ba vòng khi 429 hoặc quá hạn). Không thêm cron trừ khi owner đã duyệt chi phí.

## Cursor Cloud specific instructions

- Node 22 và Python 3 có sẵn. `npm ci` cài dependency khóa trong `package-lock.json`. `npm test` còn cần module Python `duckdb` (đã thử 1.4.2): `scripts/test-pop-filter.py` import `scripts/gba-residential.py`, file đó import `duckdb` ngay từ đầu. Cài bằng `python3 -m pip install --user 'duckdb==1.4.2'`.
- `npm run build` chỉ ghi `public/version.json` (đã gitignore).
- Chạy app local bằng Wrangler 4, cổng 8787, `--local --ip 0.0.0.0`. Bỏ khối `build` trong `wrangler.jsonc` lúc dev. Khối đó chạy `node scripts/stage-chuyen-nganh.mjs --materialize` và thay symlink git trong `public/data/chuyen-nganh` bằng bản sao khoảng 144MB. Máy dev đọc được symlink; đừng materialize nếu không deploy.
- Chưa đặt `API_UPSTREAM` thì `GET /api/gee` trả 503, thông báo chưa có URL Cloud Run. File tĩnh và bản đồ vẫn mở. Không gọi `https://qh-hue.donghoangsxd.workers.dev` để bù API.
- Cổng tĩnh 5500, 5501, 8080, 8000, 8766, 8791 khiến `geeApi()` trong `public/js/api.js` trỏ API production. Dev bằng Wrangler cổng 8787 thì `/api` ở máy local.
