#!/usr/bin/env bash
# Triển khai api lên Cloud Run. Không nhúng bí mật vào lệnh.
# Cần: gcloud đã đăng nhập, GCP_PROJECT, các API đã bật (xem MIGRATION.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${GCP_PROJECT:?Đặt GCP_PROJECT (id dự án Earth Engine / bucket hue-infra-data-us)}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-qh-hue-api}"
REPO="${REPO:-qh-hue}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Chưa có gcloud. Cài Google Cloud SDK rồi chạy lại." >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO}/api:${SHA}"

echo "Dự án: ${GCP_PROJECT}"
echo "Vùng:  ${REGION}"
echo "Ảnh:   ${IMAGE}"
echo "Lưu ý: asia-southeast1 không thuộc hạn mức Cloud Run luôn miễn phí (chỉ us-central1, us-east1, us-west1). Đặt REGION=us-central1 nếu muốn ở trong hạn mức đó."

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$GCP_PROJECT"

if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$GCP_PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location "$REGION" \
    --project "$GCP_PROJECT" \
    --description "Ảnh API bản đồ Huế"
fi

gcloud builds submit --project "$GCP_PROJECT" --config cloudrun/cloudbuild.yaml --substitutions "_IMAGE=${IMAGE}" .

gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 80 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 60 \
  --cpu-boost \
  --port 8080 \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format='value(status.url)')"
echo "URL Cloud Run: ${URL}"
echo "Kiểm tra: curl -fsS \"${URL}/api/health\""
echo "Không gọi /healthz trên run.app: Google frontend giữ đường này và trả 404."
echo "Đặt biến: Console → Cloud Run → vùng ${REGION} → ${SERVICE} → tab Containers → Edit → Variables & Secrets."
echo "Console mới không còn nút Edit & deploy new revision. Không ghi biến vào git."
echo "Không dùng --set-env-vars khi deploy lại: lệnh đó xóa biến cũ."
echo "  GEE_PRIVATE_KEY  GAS_BASE_URL  GAS_SECRET  GOOGLE_CLIENT_ID  ALLOWED_ORIGINS"
echo "ALLOWED_ORIGINS phải có https://qh-hue.donghoangsxd.workers.dev. Thêm tên miền riêng nếu có, cách nhau bởi dấu phẩy."
echo "Trên Cloudflare Workers đặt API_UPSTREAM=${URL}"
