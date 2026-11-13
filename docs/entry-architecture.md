# Kiến trúc luồng nhập (Đề xuất)

Sáu nút trong `#tabAdd` là lớp quản trị. Ba mẫu kỹ thuật H / P / O phục vụ không đều các nút. Chi tiết UI: [ui-spec.md](ui-spec.md), [bon-truc.md](bon-truc.md).

## Ba mẫu kỹ thuật

| Mẫu | Ý | Module chính | Hàng chờ / duyệt |
|-----|---|--------------|------------------|
| **H** Hồ sơ | PDF + bản vẽ (ranh, đất, mạng) | `entryFlows` `STEPS`, `drawingReaders`, `schemeLotClip`, `reviewPublish` | `cho-duyet/` → `applyPublication`; adjust riêng |
| **P** Điểm | Form tọa độ + thuộc tính | `submitInfraPoint`, Point schema (dự kiến) | Sheet `TrangThai=FALSE` → `approvePoint`, hoặc stage kind điểm |
| **O** OSM | Bulk Admin Overpass | `osmImport`, `importOsmNetwork` | `addPendingPoints` / TRUE theo rule VH — **không** nằm sáu nút đề xuất |

## Sáu trục (A–F)

| Trục | Sub-flow | Mẫu | Auth đề xuất | Admin thẳng |
|------|----------|-----|--------------|-------------|
| **A** Phát triển đô thị | Chỉ tiêu ĐVHC/đô thị | Field packet (`ENTRY_FIELDS`) | CanBo → stage `chi-tieu` | `saveUrbanInputs` |
| **B** Quy hoạch | Đồ án mới / bổ sung / điều chỉnh | H (+ adjust) | CanBo | `publishSchemeDraw` / decision / adjust |
| **C** HTKT | **C-net** mạng gắn đồ án | H network | CanBo | `putProjectNet` |
| **C** HTKT | **C-điểm** điểm hạ tầng lẻ | P (`domain: htkt`, mã 15–21) | `addPoint` → Sheet FALSE | `approvePoint` |
| **D** HTXH | Điểm công trình xã hội | P | Công khai rate-limit | `approvePoint` / Sheet |
| **E** Kiến trúc | Quy chế PDF | H pdf / `quy-che` | CanBo | `putKienTrucPdf` |
| **E** Kiến trúc | Công trình điểm | P | CanBo stage `kien-truc` | `addKienTruc` |
| **F** Dự án | **Đề xuất** meta hoặc ranh | `submitInvestProposal` | User Google → kind `du-an` | — |
| **F** Dự án | **Admin khởi tạo** | `saveInvestProject` | — | Có |
| **F** Dự án | **Admin từ phác thảo** | `createInvestFromSketch` → nhóm `dangnghien` | — | Có |

**F và C-điểm đã ship.** Schema điểm: `pointEntrySchema.js`. Bước hồ sơ: `entrySteps.js`. Facade chờ: `reviewQueue.js` (ChoDuyet + điểm FALSE).

## Role mạng HTKT (thoát nước)

- Nhập mới theo `SECTORS`: `san-nen-thoat-mua` → `ht/qh-san-nen`; `thoat-nuoc-thai` → `ht/qh-thoat-thai`.
- `ht/qh-thoat-nuoc` chỉ còn trong allowlist đọc lớp cũ trên GCS — xem `public/js/netRoles.js` và `services/netRoles.js`.
- Test: `scripts/test-entry-roles.mjs` (map client = server; mọi value map ∈ allowlist; `ENTRY_FIELDS` ⊆ `URBAN_FIELDS`).

## Checklist thêm field / luồng

**Field chỉ tiêu (A):** một dòng `ENTRY_FIELDS` → whitelist `URBAN_FIELDS` trong `api/gee.js` (test đỏ nếu thiếu) → UI `fieldsForScope` tự nhận.

**Field / loại điểm (C-điểm, D, E):** schema điểm + map Sheet/GAS/`gcsService` + (D) type-code OSM nếu cần.

**Bước hồ sơ (B, C-net):** StepDescriptor / `ENTRY_NET_ROLE` + allowlist `NET_ROLES` + kind trong `stageSpec` nếu kind mới.

**F đề xuất:** field meta invest + validate meta\|ranh + kind `du-an` trong `reviewPublish` / Apps Script `CHO_DUYET_KINDS` + rate-limit.

**Luồng mới ngoài sáu trục:** FlowDescriptor + adapter + kind — không sửa năm hàm `save*` ad hoc.

## Ba hàng chờ (không gộp bucket)

1. `cho-duyet/` + sheet ChoDuyet — hồ sơ CanBo, quy chế, (sắp) `du-an`.
2. Sheet điểm `TrangThai=FALSE` — HTXH (và C-điểm khi ship).
3. Adjust pending / `pending/cad/` — điều chỉnh cục bộ và CAD guest.

Facade Admin (phase sau) liệt kê cả ba, không gộp GCS prefix.
