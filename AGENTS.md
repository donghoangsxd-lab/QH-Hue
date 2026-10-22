# Quy tắc cho agent

Quy tắc nghiệp vụ và khoanh vùng file nằm ở `.cursorrules`. File này bổ sung ràng buộc ngân sách. Mọi thay đổi sau này phải tuân theo mục dưới.

## Ngân sách / Budget rules

Kiểm soát chi phí là ràng buộc cứng. Không triển khai tính năng đốt CPU, đọc GCS hoặc gọi API bên ngoài rồi mới báo sau.

### 1. Mọi mô tả PR phải có mục «Tác động chi phí»

Ước lượng so với hiện trạng, kể cả khi gần bằng không (ghi «không đáng kể» và vì sao):

- CPU máy chủ: Vercel Fluid Active CPU (chỉ tính lúc JS chạy, không tính lúc chờ I/O) và Cloud Run (tính cả thời gian chờ, gồm Earth Engine).
- GCS: Class A (ghi, liệt kê, sửa metadata, copy) và Class B (GET, HEAD). Bucket `hue-infra-data-us` ở Singapore.
- Băng thông (egress bucket, CDN, ảnh ô).
- API bên thứ ba: Earth Engine, Overpass, OSRM, Apps Script, và mọi lệnh gọi mới.

Đối chiếu hạn miễn phí:

- Vercel Hobby: 4 giờ Fluid Active CPU/tháng, 360 GB-giờ bộ nhớ, 1 triệu invocation.
- Cloud Run always-free: khoảng 180.000 vCPU-giây, 360.000 GiB-giây, 2 triệu request/tháng, chỉ `us-central1`, `us-east1`, `us-west1`. `asia-southeast1` tính tiền từ giây đầu.
- Cloudflare Workers free: 100.000 request/ngày, CPU 10 ms/request (thời gian chờ mạng không tính). Asset tĩnh: 25 MiB/file, 20.000 file/phiên bản trên gói free.

### 2. Ưu tiên file tĩnh đã tính sẵn

Đặt kết quả lên GCS hoặc CDN với `Cache-Control` dài. File có phiên bản trong đường dẫn hoặc `?v=`: `public, max-age=31536000, immutable`. File ghi đè cùng khóa: `max-age` ngắn, không `immutable`. Không tính lại trên máy chủ cho mỗi request nếu một file tĩnh làm được việc đó.

### 3. Báo owner trước khi làm

Tính năng thêm việc máy chủ trên mỗi request, hoặc nhân số lần đọc GCS (ô bản đồ, HTTP Range, HEAD/GET lặp), phải được owner chấp nhận trước khi viết code. Kèm ước lượng: số request mỗi lần mở lớp, phần nào là CPU, phần nào là Class B, và phần trăm hạn miễn phí. Không âm thầm triển khai rồi mới ghi vào PR.

### 4. Kiểm thử

Hạn chế gọi API production. Dùng mock, fixture đã lưu, preview có giới hạn, và ít ảnh chụp. Không mở vòng lặp Playwright hoặc `curl` vào `web-hatang-hue-4.vercel.app` để «cho chắc». Trong PR, ghi usage do chính lần test gây ra (số request production, có đụng GCS/GEE hay không).

### 5. Endpoint máy chủ

Mọi endpoint mới cần giới hạn tần suất và cache. GET công khai phải có `Cache-Control` với `s-maxage` khi dữ liệu cho phép; `no-store` chỉ cho vỏ HTML/JS/CSS, hàng admin và tham số `fresh`. Retry có trần (không nhân ba vòng khi 429 hoặc quá hạn). Không thêm cron trừ khi owner đã duyệt chi phí.
