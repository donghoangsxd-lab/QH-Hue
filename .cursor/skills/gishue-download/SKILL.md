---
name: gishue-download
description: >-
  Tải lớp quy hoạch từ WebGIS gisHue (gServer, geditor.aspx, gissonganh.hue.gov.vn) vào catalog tĩnh.
  Dùng khi người dùng giao task tải dữ liệu, mapid, lớp bản đồ, QHPK, QHC, QHCT, hoặc nhắc gisHue / gServer / geditor.
---

# Tải dữ liệu gisHue

Đọc skill này rồi chạy **một** lệnh. Không mở trình duyệt tay, không dò API, không bấm «Xuất shapefile». Không gọi `addFeature`, `updateFeature`, `deleteFeature`. Không in GeoJSON hay dump.

**Trình duyệt fallback:** chỉ Microsoft Edge headless (`msedge.exe`). Không dùng Chrome / Chromium / `CHROME_PATH`. Thiếu Edge thì báo lỗi hoặc đặt `EDGE_PATH` tới `msedge.exe`. Script liên quan: `gishue-import.mjs`, `gishue-raster-list.mjs`, `gishue-raster-tiles.mjs`.

Mở `.cursor/rules/modules.mdc`, chỉ đọc file nhóm MOD-07 và MOD-12 nếu lệnh thất bại. Không đọc GeoJSON, JSON nặng, PDF.

## Lệnh

```bash
node --experimental-websocket scripts/gishue-import.mjs --mapid <id> [--mapid <id> ...] [--dry-run] [--no-gcs] [--cache-sdd]
```

Thử trước khi ghi: thêm `--dry-run`. `--no-gcs`: không `putHeavy` lớp >5 MB (giữ cache; rút gọn rồi ghi `projects/` trước). `--cache-sdd`: chỉ tải lại lớp chức năng/hiện trạng sử dụng đất vào `.cache/gishue/<mapid>/` (kể cả map đã có trong `su-dung-dat-index`), không ghi catalog — dùng khi cache lần đầu thiếu SDD / thiếu `kyhieulodat`. Node 20 cần `--experimental-websocket` (Edge CDP). Lệnh tự lấy metadata, bỏ lớp sử dụng đất đã có trong `public/data/su-dung-dat-index.json` (trừ `--cache-sdd`), tải mọi lớp còn lại, đọc `geom` hoặc `s_geo`, chuyển VN-2000 sang WGS84, cắt lô dùng `scripts/clip-scheme-lots.mjs` (dung sai 5 m; chỉ cắt phần nhô quá 5 m; không bỏ lô nằm trong ranh). Map không có lớp ranh thì dùng ranh `projects/index` nếu đồ án đã gắn `mapid`. Ghi catalog như đồ án đã xuất bản (`public/data/chuyen-nganh/schemes.json`, `index.json`, `data/chuyen-nganh/<slug>/<ngành>/<hien-trang|quy-hoach>/`). Ngành lấy từ tên lớp (giao thông, sử dụng đất, san nền, …) nên lớp vào đúng tab Hạ tầng. Cache thô ở `.cache/gishue` (gitignore; profile Edge: `edge-*`). Chạy lại được.

Đọc đúng bảng tóm tắt trên stdout: tên đồ án, từng lớp (HT/QH, số đối tượng, bỏ, cắt, hình hỏng), dòng tổng. Nếu có `khop catalog` thì đồ án đã có, dừng, không mở PR dữ liệu. Nếu dòng bắt đầu bằng `!` thì đó là cảnh báo. Lệnh thoát khác 0 là lỗi.

Lớp GeoJSON hoặc zip trên 5 MB không commit. Lệnh ghi một lần lên GCS `chuyen-nganh/v1/` (Class A, `Cache-Control` immutable) và catalog trỏ URL công khai. File nhỏ hơn vẫn nằm trong git.

## Sau khi lệnh xong

Một PR gồm file catalog và lớp mới. Không chạy thêm lệnh chờ CI trong lúc sửa. Không đụng nhánh hay tab của agent khác.

**Pipeline rút gọn (chỉ đồ án QHC ~1/10.000 trở lên thô hơn, kiểu Chân Mây / Phú Lộc):** sau import thô, không dừng ở catalog nặng.

1. Khảo sát / `--dry-run`
2. Import thô → `.cache/gishue` + `data/chuyen-nganh/<slug>/`
3. `node scripts/build-qhc-<do-an>.mjs` (ví dụ `build-qhc-chan-may.mjs`, `build-qhc-phu-loc.mjs`, `build-qhc-vinh-hung.mjs`) → SDD/GT gọn (`PL-*`/`CM-*`/`VH-*`) + `public/data/qhc-…/`
4. Slim mạng QH chuyên ngành trên disk (cùng script bước 3)
5. `--upload` ghi `projects/<slug>/{su-dung-dat,hien-trang,qh-giao-thong}.json`
6. Không upload lại SDD thô lên `chuyen-nganh/v1/`; chỉ lớp catalog vẫn cần bản nặng
7. Khớp `index.json` / `su-dung-dat-index.json` / `projects/index` (`lands`)

### Nơi lưu trữ (bắt buộc — thống nhất từ 2026-11)

| Cấp | Số đồ án (trần làm việc) | Nơi giữ geom / lô chính | Ghi chú |
|---|---|---|---|
| **QHC** (quy hoạch chung) | **Tối đa ~40** | **Dữ liệu tĩnh** trong repo + deploy Worker: `data/chuyen-nganh/`, `public/data/qhc-*/`, catalog; pipeline `build-qhc-*.mjs` | Được rút gọn hình học (xem bảng dưới). Không vượt ~40 đồ án tĩnh — tránh phình asset Cloudflare. |
| **QHPK** 1/2.000 | ~100 | **Bucket GCS** (`projects/<slug>/…`, lớp nặng `chuyen-nganh/v1/` khi cần) | **Không** commit geom đầy đủ vào `public/` / không pipeline slim kiểu QHC. App tải khi mở đồ án. |
| **QHCT** 1/500 | ~400 | **Bucket GCS** (cùng cách QHPK) | Cùng QHPK: chỉ bucket, lazy-load. |

Catalog / `schemes.json` / `index.json` vẫn liệt kê mọi cấp; khác nhau là **file hình học nằm đâu**. QHPK/QHCT: `file`/`ref` trỏ URL GCS hoặc `projects/…` trên bucket — không nhét hàng trăm GeoJSON vào git.

### Ràng buộc hình học (bắt buộc)

Theo tỷ lệ đồ án — **không** lẫn quy tắc:

| Cấp / tỷ lệ | `turf.simplify` / truncate đỉnh | Ghi chú |
|---|---|---|
| **QHC ~1/10.000** (và QHC thô hơn, vd. đồ án địa phương kiểu mapid Chân Mây / Phú Lộc) | **Được** — sai số hình học lớn chấp nhận được khi xem/quản lý | Script `build-qhc-*.mjs` (`TOL` ~0.00002) |
| **QHC 1/25.000** | **Được** (cùng tinh thần tỷ lệ nhỏ) | `build-qhc2045.js` và tương tự |
| **QHPK 1/2.000** | **Cấm** simplify hàng loạt | Giữ geom đầy đủ trên **bucket**; tối đa bỏ prop rác |
| **QHCT 1/500** | **Cấm** simplify hàng loạt | Cùng QHPK |

Cắt lô theo ranh (`SCHEME_EDGE_M` = 5 m trong `clip-scheme-lots`) **không** phải simplify — vẫn dùng được ở mọi cấp. Không viết `build-qhpk-*` / `build-qhct-*` copy pipeline slim của QHC. Không gọi `simplify` trên lớp QHPK/QHCT trong import hay post-process.

### Màu lô SDD / `projects/*/su-dung-dat.json` (bắt buộc)

App tô lô bằng TT16 từ trường **`layer`** (chuỗi tên chức năng tiếng Việt), không phải mã số.

| Trường gisHue | Dùng làm `layer`? | Ghi chú |
|---|---|---|
| `chucnangsudungdat` / `chucnangsu` (cột bị cắt tên) | **Có** — ưu tiên | Ví dụ «Đất nhóm nhà ở», «Đất giao thông» |
| `tendoituong`, `ghichu` (nếu là nhãn đất) | Có — fallback | |
| `loaidat` **thuần số** (`17`, `42`, …) | **Cấm** | TT16 không khớp → cả đồ án một màu xám/đen (lỗi kiểu QHPK Thanh Toàn) |
| `kyhieulodat` | `lotCode` / `name`, không thay `layer` | |

Khi ghi hoặc rebuild `projects/<slug>/su-dung-dat.json` (và `hien-trang.json` lô):

1. `layer` = nhãn chữ; nếu chỉ còn `loaidat` số thì `'Khác'` (hoặc dictionary nhãn), **không** ghi số vào `layer`.
2. Code đường tô: `services/landDedupe.js` `landLayerOf`, `public/js/linkedLots.js` `parcelsFromCollection`, `scripts/register-qhct.js` `lotLayer`, pipeline `build-qhc-*.mjs`.
3. Đồ án cũ đã đen trên bucket: `node scripts/fix-numeric-sdd-layers.mjs` (dry-run) rồi `--upload` — rebuild từ `.cache/gishue/<mapid>/*chucnang*|sudungdat*.json`, bump `projects/index.json` `saved`/`lands`. Một đồ án: `scripts/fix-qhpk-thanh-toan-sdd.mjs`.
4. Sau import QHPK/QHCT, nếu mở đồ án mà SDD một màu tối: nghi `layer` số → chạy fix ở (3), không đoán style CSS.
5. Sửa **chỉ trên GCS** (`projects/…`) thì **không** cần commit/push git; commit khi đổi script/skill/catalog repo.

Chỉ khi lệnh thoát lỗi mới đọc `scripts/gserver-page-fetch.js`, `scripts/gserver-to-shp.js`, `scripts/clip-scheme-lots.mjs`. Không tự mở geditor.
