# Chuyển máy chủ (chưa cắt tên miền)

Vercel `https://web-hatang-hue-4.vercel.app` vẫn là bản đang dùng. Repo này không tự deploy Cloud Run và không gọi `wrangler deploy`. Làm lần lượt các bước dưới. Chưa xóa project Vercel.

Project GCP đang gắn Earth Engine và bucket: `optimistic-yew-488501-s0`. Bucket: `hue-infra-data-us` (Singapore).

## Đã có trong repo

- `worker/index.js` và `wrangler.jsonc` (`main` + `run_worker_first` cho `/api/*`, `/gcs/*`, `/data/gba/buildings.pmtiles`). Vercel không đọc hai file này.
- `buildings.pmtiles` (~41 MiB sau khi gỡ NTD, bản phát hành 43.078.043 byte) vượt hạn 25 MiB/file của Workers. `public/.assetsignore` loại file đó. Worker đọc nó từ GCS.
- `/api/*` trên Worker chuyển tới Cloud Run khi đã đặt biến runtime `API_UPSTREAM`. Chưa đặt thì `/api` trả 503. Dấu chân trên `*.workers.dev` đi đường `/data/gba/buildings.pmtiles` (cùng origin), không đi `/api/pmtilesRange`.
- Cloud Run: `cloudrun/` (không có Dockerfile ở gốc repo), `scripts/deploy-cloudrun.sh`. Workflow **Cloud Run** chỉ chạy khi bấm tay (`workflow_dispatch`), không chạy trên mỗi push.
- Ba hàm `api/gee`, `api/osmClip`, `api/pmtilesRange` đã giới hạn theo IP trên Vercel (PR #98). Cloud Run và Worker đếm riêng, cùng các trần, không dùng chung bộ nhớ với hàm Vercel (chung store sẽ đếm mỗi request hai lần).

Trần mỗi phút mỗi IP: đọc JSON 600, ô `getSatTile` / `getPopRasterTile` 2000, OpenStreetMap 300, Range PMTiles và proxy GCS 2000. `OPTIONS` không tính trên Worker.

Nếu Cloudflare Workers Builds đang theo dõi nhánh `main`, lần merge có `wrangler.jsonc` mới sẽ tự deploy lên `https://qh-hue.donghoangsxd.workers.dev`. Khi đó `/api/gee` trả 503 cho đến khi có `API_UPSTREAM`. Bản Vercel không đổi. Muốn workers.dev giữ nguyên bản tĩnh thì tắt production deploy của integration trước khi merge, rồi tự `npx wrangler deploy` sau.

## 1. GCP — bật thanh toán và chặn $1

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và chọn project `optimistic-yew-488501-s0` (project của bucket `hue-infra-data-us` và asset Earth Engine).
2. Menu **Billing**. Nếu project chưa gắn tài khoản thanh toán thì **Link a billing account**.
3. **Billing → Budgets & alerts → Create budget**.
4. Scope: chỉ project `optimistic-yew-488501-s0`. Amount: **$1**. Ngưỡng email **50%**, **90%**, **100%**.
5. `asia-southeast1` không thuộc Cloud Run luôn miễn phí. Hạn miễn phí (khoảng 180.000 vCPU-giây, 360.000 GiB-giây, 2 triệu request/tháng) chỉ có ở `us-central1`, `us-east1`, `us-west1`. Script mặc định Singapore cho gần Huế và gần bucket. Muốn ở hạn miễn phí thì khi chạy đặt `REGION=us-central1` (độ trễ cao hơn, Earth Engine vẫn ở project này). Ngân sách $1 là chốt an toàn vì Cloud Run tính cả giây chờ Earth Engine.

## 2. Bật đúng ba API

Mở từng liên kết (đã gắn sẵn project), bấm **Enable**. Nếu nút là **Manage** thì API đã bật, không bấm lại.

- Cloud Run Admin API: https://console.cloud.google.com/apis/library/run.googleapis.com?project=optimistic-yew-488501-s0
- Cloud Build API: https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com?project=optimistic-yew-488501-s0
- Artifact Registry API: https://console.cloud.google.com/apis/library/artifactregistry.googleapis.com?project=optimistic-yew-488501-s0

Tên kỹ thuật: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`. Script deploy cũng gọi `gcloud services enable` cho ba API này.

## 3. Service account deploy

Không dùng khóa Earth Engine (`GEE_PRIVATE_KEY`) để deploy.

1. **IAM & Admin → Service Accounts → Create service account**.
2. Tên: `qh-hue-deploy`. Xong bước tên thì **Create and continue**.
3. Gán đúng các role:
   - Cloud Run Admin (`roles/run.admin`)
   - Service Account User (`roles/iam.serviceAccountUser`)
   - Cloud Build Editor (`roles/cloudbuild.builds.editor`)
   - Artifact Registry Administrator (`roles/artifactregistry.admin`)
4. **Done**. Mở account vừa tạo → **Keys → Add key → Create new key → JSON**. Tải file về, không commit.
5. Service account Cloud Build mặc định cần quyền đẩy ảnh. Lấy số project:

```bash
gcloud projects describe optimistic-yew-488501-s0 --format='value(projectNumber)'
```

Trong **IAM & Admin → IAM → Grant access**, thêm `SỐ_PROJECT@cloudbuild.gserviceaccount.com` với role Artifact Registry Writer (`roles/artifactregistry.writer`).

6. GitHub repo `donghoangsxd-lab/QH-Hue` → **Settings → Secrets and variables → Actions → New repository secret**:
   - `GCP_SA_KEY`: nguyên nội dung file JSON vừa tải
   - `GCP_PROJECT`: `optimistic-yew-488501-s0`

Không tạo secret `GEE_PRIVATE_KEY` trên GitHub.

## 4. Deploy Cloud Run

Cách bấm tay: GitHub → **Actions → Cloud Run → Run workflow**. Dịch vụ `qh-hue-api` đang chạy ở `us-central1`. Deploy lại phải điền `us-central1`. Để trống thì script dùng `asia-southeast1` và tạo một dịch vụ khác.

Hoặc trên máy đã `gcloud auth login` (không dán khóa vào lệnh):

```bash
export GCP_PROJECT=optimistic-yew-488501-s0
export REGION=us-central1
bash scripts/deploy-cloudrun.sh
```

Script đặt `min-instances=0`, `max-instances=3`, `concurrency=80`, 1 vCPU, 1 GiB, timeout 60 giây, cổng 8080. Không truyền `--set-env-vars` (lệnh đó xóa biến đã gắn khi deploy lại).

Lần đầu có thể lỗi nếu policy cấm public. Khi đó Console → **Cloud Run → qh-hue-api → Security → Authentication → Allow unauthenticated invocations**.

Biến môi trường gắn trên Console, không ghi vào git. Dịch vụ `qh-hue-api` đang ở vùng `us-central1`.

1. Mở [Cloud Run](https://console.cloud.google.com/run?project=optimistic-yew-488501-s0), chọn vùng **us-central1**, mở dịch vụ `qh-hue-api`.
2. Tab **Containers** → **Edit**.
3. Mục **Variables & Secrets** → **Variables**. Thêm hoặc sửa từng biến, rồi deploy revision mới.

Console mới không còn nút **Edit & deploy new revision**.

| Tên | Giá trị |
| --- | --- |
| `GEE_PRIVATE_KEY` | JSON service account Earth Engine đang dùng trên Vercel |
| `GAS_BASE_URL` | cùng giá trị Vercel |
| `GAS_SECRET` | cùng giá trị Vercel |
| `GOOGLE_CLIENT_ID` | cùng giá trị Vercel |
| `ALLOWED_ORIGINS` | `https://web-hatang-hue-4.vercel.app,https://qh-hue.donghoangsxd.workers.dev` |

`CRON_SECRET` không bắt buộc (cron đã tắt). `QH_GET_LIMIT` không cần đặt (mặc định 600 cho đọc JSON).

Kiểm tra một lần. Google frontend trên `*.run.app` giữ đường `/healthz` và trả 404 của Google trước khi request tới container. Dùng `/api/health`:

```bash
curl -fsS "$URL/api/health"
```

Phải ra `{"ok":true,"service":"qh-hue-api"}`. `$URL` là dòng `URL Cloud Run:` script in ra, không có dấu `/` cuối. Dịch vụ hiện tại: `https://qh-hue-api-dgwn67tqyq-uc.a.run.app` (hậu tố `uc` là `us-central1`).

## 5. Cloudflare Workers

Màn Import GitHub, nhánh `main`, sau khi `main` đã có `worker/index.js`:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler versions upload`
- Biến build: `NODE_VERSION` = `22`
- Biến Worker runtime (không phải biến build): `API_UPSTREAM` = URL Cloud Run, không có dấu `/` cuối

Không ghi `API_UPSTREAM` vào `wrangler.jsonc`.

Chưa có `API_UPSTREAM` thì trang tĩnh vẫn mở, `/api/gee` báo chưa cấu hình, dấu chân trên `*.workers.dev` vẫn lấy PMTiles qua Worker (Range từ GCS). `directTiles()` trên `web-hatang-hue-4.vercel.app` vẫn đọc thẳng GCS, không đi Worker.

Tên miền riêng (chỉ khi `https://qh-hue.donghoangsxd.workers.dev` đã đúng): Workers → **Custom domains**. Giữ domain Vercel đến lúc đó. Thêm origin mới vào `ALLOWED_ORIGINS` rồi deploy revision mới (không dùng `--set-env-vars`).

## 6. File dấu chân và Cache-Control trên bucket

Bản đã gỡ NTD không nằm trong git. Tải từ release `data-gba-20261026` rồi ghi đè object. Một lệnh `cp` là một Class A và gắn luôn cache. Không chạy `scripts/apply-gcs-cache.mjs --apply` cho riêng file này nếu `cp` đã đặt đúng metadata.

Trong Cloud Shell:

```bash
cd "$HOME"
curl -fL --retry 3 -o buildings.pmtiles \
  "https://github.com/donghoangsxd-lab/QH-Hue/releases/download/data-gba-20261026/buildings.pmtiles"
test "$(wc -c < buildings.pmtiles)" = "43078043"
echo "e52ba283dfae93344167b743ad9bfd17fede27fc4b40e0ac306b676e3a30a781  buildings.pmtiles" | sha256sum -c
gcloud storage cp buildings.pmtiles gs://hue-infra-data-us/gba/buildings.pmtiles \
  --cache-control="public, max-age=31536000, immutable" \
  --content-type="application/octet-stream"
gcloud storage objects describe gs://hue-infra-data-us/gba/buildings.pmtiles \
  --format="yaml(size,contentType,cacheControl,generation)"
```

`size` phải là `43078043`. Trình duyệt đã tải `?v=20261026` lúc bucket còn file cũ giữ bản đó tối đa 1 giờ (`max-age=3600` của object cũ), rồi nhận file mới.

Các object khác (thửa, PNG vệ tinh, `infrastructure_hue.json`): trên máy có `GEE_PRIVATE_KEY` (quyền ghi bucket). Liệt kê là Class A. `--apply` thêm một Class A mỗi object cần sửa.

```bash
export GEE_PRIVATE_KEY='...json...'
node scripts/apply-gcs-cache.mjs
node scripts/apply-gcs-cache.mjs --apply
```

Chính sách: `public, max-age=31536000, immutable` cho `cadastre/thuadat-2016.pmtiles`, `gba/buildings.pmtiles`, PNG `cache/sat/v1/`. `infrastructure_hue.json` là `public, max-age=60, must-revalidate`.

Apps Script: dán `apps-script/Code.gs` mới rồi **Deploy → Manage deployments → Edit → Version: New version → Deploy**, để lần đồng bộ Sheet sau không xóa Cache-Control của file danh sách.

Khi thay `buildings.pmtiles` lần sau, tăng `GBA_V` trong `public/js/gbaVersion.js` (file mới phải đổi query; `immutable` giữ URL cũ một năm).

## 7. Cắt

Chỉ trỏ DNS khi `https://qh-hue.donghoangsxd.workers.dev` đã có điểm hạ tầng, lớp thửa và dấu chân. Vercel để nguyên đến lúc đó.

## Chi phí khi đã bật (chưa bật thì bằng không)

- Cloud Run `min-instances=0`: không có request thì không tính vCPU. Trần 3 instance, 80 request đồng thời, 1 vCPU, 1 GiB, timeout 60 giây.
- Cloud Run tính cả thời gian chờ Earth Engine. Một request chờ 20 giây ≈ 20 vCPU-giây và 20 GiB-giây. Vài trăm request như vậy mỗi ngày ở Singapore có thể ăn hết ngân sách $1. Vì vậy Worker từ chối 429 trước khi gọi Cloud Run, và các GET đã có `s-maxage` được cache ở biên Worker.
- Workers free: 100.000 request/ngày, CPU 10 ms/request (thời gian chờ GCS không tính). File tĩnh vẫn do asset phục vụ, không vào `worker/index.js` trừ `/api/*`, `/gcs/*` và `buildings.pmtiles`.
- Vercel: PR này không thêm middleware, cron, hay đường gọi mới trên `web-hatang-hue-4.vercel.app`.
