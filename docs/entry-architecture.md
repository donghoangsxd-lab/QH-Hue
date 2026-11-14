# Kiến trúc luồng nhập (Đề xuất)

Sáu nút trong `#tabAdd` là lớp quản trị. Ba mẫu kỹ thuật H / P / O phục vụ không đều các nút. Chi tiết UI: [ui-spec.md](ui-spec.md), [bon-truc.md](bon-truc.md).

## Ba mẫu kỹ thuật

| Mẫu | Ý | Module chính | Hàng chờ / duyệt |
|-----|---|--------------|------------------|
| **H** Hồ sơ | PDF + bản vẽ (ranh, đất, mạng) | `entryFlows` `STEPS`, `drawingReaders` / `schemeIngest`, `schemeLotClip`, `reviewPublish` | `cho-duyet/` → `applyPublication`; adjust riêng |
| **P** Điểm | Form tọa độ + thuộc tính | `submitInfraPoint`, `pointEntrySchema` | Sheet `TrangThai=FALSE` → `approvePoint`, hoặc stage kind điểm |
| **O** Bulk Admin | CAD batch TT16, OSM, parcel, đường, ô dân | `cadImportUi`, `osmImport`, `parcelInfraImport`, roads/pop | `pending/cad/`, Sheet FALSE, GCS admin — **không** là đường chính Đồ án mới |

Ghi qua `stageOrPublish` (`entryKernel.js`) khi mẫu H: Admin → `adminFn`, CanBo → `stageFn`.

## Ma trận cửa (một ý nghiệp vụ → một cửa mặc định)

| Ý nghiệp vụ | Cửa UI mặc định | Parser | Action ghi | Không dùng làm đường chính |
|-------------|-----------------|--------|------------|----------------------------|
| Đồ án mới / bổ sung (checklist + DXF/KML/KMZ + KH) | `#hoSoBox` (B › mới/bổ sung) | `schemeIngest` / `drawingReaders` | `publishSchemeDraw` / `submitChoDuyet` | `#entryLegacy` (O batch) |
| Batch TT16 / SHP·GeoJSON / điểm chức năng / dân số | `#entryLegacy` «Batch TT16» | `cadImportUi` | `importCadBatch` / `submitCadPending` | Không thay checklist hoso |
| ĐCCB ghi hồ sơ | `#adjImportBox` | `adjustRecordFromDxf` | `submitAdjust` / `putAdjustDraw` | Form «Nhập hồ sơ» thứ hai trên Thẩm định (chỉ QCVN + prefill) |
| ĐCCB chấm QCVN | Thẩm định › Điều chỉnh | `runAdjust` | — (deep-link + prefill → adj) | Ghi thẳng từ review mà bỏ adj |
| Cân đối đất QCVN | Thẩm định › Cân đối | review DXF | — | Cắt `importReviewDossier` |
| Dossier CAD / pending | `#cadPendingBox` / `importReviewDossier` | `cadImportUi` | `importCadBatch` | — |
| Sổ tay ↔ GIS (meta) | Catalog B link / adopt | — | `saveSoTayEdits` | Nuốt DXF tại bảng |
| C-net mạng | `#htktBox` (cùng `saveHoSo`) | network draw | `putProjectNet` / cho-duyet | — |
| C-điểm / D / E-điểm | form điểm trục | schema | `addPoint` / `addKienTruc` | CAD scheme |
| E quy chế PDF | `flowKienTruc` | PDF | `putKienTrucPdf` / `submitChoDuyetPdf` | — |
| F đề xuất / Admin | `flowDuAn` / sketch | boundary optional | `submitInvestProposal` / `saveInvestProject` | `projects/<scheme>` đồ án QH |
| OSM / parcel / đường / ô dân | `#addAdmin` only | Overpass / rows / vẽ | import* / save* GCS | Sáu nút Đề xuất |

**Không gộp bucket:** `projects/` · `cho-duyet/` · `adjust/` · `so-tay-edits` · `pending/cad/` tách auth/ngân sách.

## Sáu trục (A–F)

| Trục | Sub-flow | Mẫu | Auth đề xuất | Admin thẳng |
|------|----------|-----|--------------|-------------|
| **A** Phát triển đô thị | Chỉ tiêu ĐVHC/đô thị | Field packet (`ENTRY_FIELDS`) | CanBo → stage `chi-tieu` | `saveUrbanInputs` |
| **B** Quy hoạch | Đồ án mới / bổ sung | H-scheme (`#hoSoBox`) | CanBo | `publishSchemeDraw` / decision |
| **B** Quy hoạch | Điều chỉnh cục bộ | H-adjust (`#adjImportBox`) | CanBo | `submitAdjust` |
| **B** Quy hoạch | Batch TT16 (Admin) | O-scheme (`#entryLegacy`) | — | `importCadBatch` |
| **C** HTKT | **C-net** mạng gắn đồ án | H network | CanBo | `putProjectNet` |
| **C** HTKT | **C-điểm** điểm hạ tầng lẻ | P (`domain: htkt`, mã 15–21) | `addPoint` → Sheet FALSE | `approvePoint` |
| **D** HTXH | Điểm công trình xã hội | P | Công khai rate-limit | `approvePoint` / Sheet |
| **E** Kiến trúc | Quy chế PDF | H pdf / `quy-che` | CanBo | `putKienTrucPdf` |
| **E** Kiến trúc | Công trình điểm | P | CanBo stage `kien-truc` | `addKienTruc` |
| **F** Dự án | **Đề xuất** meta hoặc ranh | `submitInvestProposal` | User Google → kind `du-an` | — |
| **F** Dự án | **Admin khởi tạo** | `saveInvestProject` | — | Có |
| **F** Dự án | **Admin từ phác thảo** | `createInvestFromSketch` → nhóm `dangnghien` | — | Có |

Schema điểm: `pointEntrySchema.js`. Bước hồ sơ: `entrySteps.js`. Ingest vẽ: `schemeIngest.js`. Facade chờ: `reviewQueue.js` (ChoDuyet + điểm FALSE).

## Role mạng HTKT (thoát nước)

- Nhập mới theo `SECTORS`: `san-nen-thoat-mua` → `ht/qh-san-nen`; `thoat-nuoc-thai` → `ht/qh-thoat-thai`.
- `ht/qh-thoat-nuoc` chỉ còn trong allowlist đọc lớp cũ trên GCS — xem `public/js/netRoles.js` và `services/netRoles.js`.
- Test: `scripts/test-entry-roles.mjs` (map client = server; mọi value map ∈ allowlist; `ENTRY_FIELDS` ⊆ `URBAN_FIELDS`).

## Checklist thêm field / luồng

**Field chỉ tiêu (A):** một dòng `ENTRY_FIELDS` → whitelist `URBAN_FIELDS` trong `api/gee.js` (test đỏ nếu thiếu) → UI `fieldsForScope` tự nhận.

**Field / loại điểm (C-điểm, D, E):** schema điểm + map Sheet/GAS/`gcsService` + (D) type-code OSM nếu cần.

**Bước hồ sơ (B, C-net):** StepDescriptor / `ENTRY_NET_ROLE` + allowlist `NET_ROLES` + kind trong `stageSpec` nếu kind mới; ghi qua `stageOrPublish`.

**F đề xuất:** field meta invest + validate meta\|ranh + kind `du-an` trong `reviewPublish` / Apps Script `CHO_DUYET_KINDS` + rate-limit.

**Luồng mới ngoài sáu trục:** FlowDescriptor + adapter + kind — không sửa năm hàm `save*` ad hoc. O (OSM/parcel/roads/pop) không nhét vào ChoDuyet.

## Ba hàng chờ (không gộp bucket)

1. `cho-duyet/` + sheet ChoDuyet — hồ sơ CanBo, quy chế, `du-an`.
2. Sheet điểm `TrangThai=FALSE` — HTXH và C-điểm.
3. Adjust pending / `pending/cad/` — điều chỉnh cục bộ và CAD guest.

Facade Admin liệt kê cả ba, không gộp GCS prefix.

## PR2+ — khóa funnel P (C-điểm / D / E) và ghi chú O

**P — một submit:** C-điểm, D (HTXH), E-điểm đều qua `submitInfraPoint` + `pointEntrySchema` (tách `domain` / mã nhóm / bán kính QCVN trong schema). Không mở form ad hoc thứ hai; Sheet `TrangThai=FALSE` rồi Admin `approvePoint`.

**E PDF / F:** `putKienTrucPdf` / `submitChoDuyetPdf` và invest stage bắt buộc `stageOrPublish` (cùng kernel H), không `if (isAdmin)` rời ngoài kernel.

**CAD pending:** mọi chỗ **gửi** (`submitCadPending`, kể cả từ thẩm định) giữ; chỗ **mở/ghi** Admin thống nhất `#cadPendingBox` / `importCadBatch` (dossier và guest drop cùng bucket).

**O nền (chỉ `#addAdmin`):** đường, ô dân, OSM, parcel — parser riêng, **không** gộp với B/`cho-duyet`. Facade Admin chỉ liệt kê / deep-link duyệt Sheet FALSE, không nhét O vào ChoDuyet.

**Catalog meta:** `saveSoTayEdits` chỉ; sau adopt/link/dccb → toast + nút mở Bổ sung hoặc Điều chỉnh (`tenQH`), không auto-ingest DXF.
