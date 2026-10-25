#!/bin/bash
# Đẩy QĐ 614 và QĐ 108 lên gs://hue-infra-data-us/docs/.
# Chạy trong GitHub Actions sau google-github-actions/auth (secret GCP_SA_KEY) và setup-gcloud.
# pull_request không nhận secret này. File có thể đã gỡ khỏi tip: lấy từ commit đã thêm.
set -euo pipefail

bucket=hue-infra-data-us
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

upload_one() {
  local file="$1" object="$2" bytes="$3"
  local tmp remote code
  tmp=$(mktemp)
  if [[ -f "public/docs/$file" ]]; then
    cp "public/docs/$file" "$tmp"
  else
    local commit
    commit=$(git log -1 --diff-filter=A --format=%H -- "public/docs/$file" || true)
    if [[ -z "$commit" ]]; then
      echo "Không thấy public/docs/$file trong git" >&2
      exit 1
    fi
    git show "$commit:public/docs/$file" > "$tmp"
  fi
  local size head
  size=$(wc -c < "$tmp" | tr -d ' ')
  head=$(head -c 5 "$tmp" || true)
  if [[ "$size" != "$bytes" || "$head" != "%PDF-" ]]; then
    echo "$file không khớp PDF $bytes byte (đang $size)" >&2
    exit 1
  fi
  remote=$(gcloud storage objects describe "gs://$bucket/$object" --format='value(size)' 2>/dev/null || true)
  if [[ "$remote" == "$bytes" ]]; then
    echo "skip $object $remote"
  else
    gcloud storage cp "$tmp" "gs://$bucket/$object" \
      --content-type=application/pdf \
      --cache-control="public, max-age=86400"
    echo "put $object $bytes"
  fi
  rm -f "$tmp"
  code=$(curl -sS -o /tmp/qh-pdf-head.bin -w '%{http_code}' -r 0-4 "https://storage.googleapis.com/$bucket/$object")
  echo "anon $object $code"
  test "$code" = "206" -o "$code" = "200"
  test "$(head -c 5 /tmp/qh-pdf-head.bin)" = "%PDF-"
  rm -f /tmp/qh-pdf-head.bin
}

upload_one 614-QD-UBND.pdf docs/614-QD-UBND.pdf 710578
upload_one 108-QD-TTg.pdf docs/108-QD-TTg.pdf 3401128
