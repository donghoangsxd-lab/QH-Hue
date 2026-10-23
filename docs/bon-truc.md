# Bốn trục

Hành chính, quy hoạch, hạ tầng, kiến trúc dùng chung một kho lớp. Tài liệu catalog file: [chuyen-nganh.md](chuyen-nganh.md).

## Trục

1. **Hành chính** là phạm vi, chọn trước. `{type, code, parent}` với `type` là `tp`, `dothi`, `xa`, `tdp`. Thành phố mã `TP`, parent null. Đô thị và xã là anh em, parent `TP`. Tổ dân phố thêm sau bằng bản ghi `areas[]` trong manifest, không sửa code và không có UI. Ranh không tải thêm: `public/data/ward-boundary.json` (40 `tenXa`, mã = slug tên gọn), `urban614.geojson`, `urbanVision.geojson`, `generalPlan.geojson`. Thanh tiêu đề giữ nguyên; chọn đô thị trên thanh đó ghi vào cùng phạm vi.
2. **Quy hoạch** là cấp QHC25 / QHC10 / QHPK / QHCT, rồi đồ án, rồi lớp (sử dụng đất và «Hiện trạng khi lập đồ án» của đồ án). Tab trong panel lớp. Cây đồ án cũ (`#projectList`) giữ nguyên. `25000` → đồ án `qhc-hue-2045`, phạm vi thành phố. `10000` → đồ án `qhc-trung-tam`, phạm vi `{type:'dothi', code:'trung-tam', parent:'TP'}`.
3. **Hạ tầng** là 7 chuyên ngành, không gồm sử dụng đất. Id kebab trong catalog (`giao-thong` … `thong-tin-lien-lac`). `?nganh=` nhận cả id ngắn (`giaothong`, `capnuoc`, `capdien`, `sannen`, `thoatnuocthai`, `ctr-nghiatrang`, `ttll`). Trong một ngành: lọc cấp (mặc định QHC 1/25.000), mọi đồ án của cấp, huy hiệu Có dữ liệu / Chưa có, nhóm «Hiện trạng khi lập đồ án» và «Quy hoạch», Bật tất cả, chú giải. GeoJSON chỉ tải khi bật. `chk_gt25` / `chk_gt10` là bộ giao thông gộp khác, không gắn vào 91 file.
4. **Kiến trúc** là khung. Quy chế theo khu vực (`public/data/kien-truc/quy-che.json`) và công trình điểm (`cong-trinh.json`). Cả hai `items: []`. UI ghi «Chưa có dữ liệu». Chưa nhập liệu.

Hiện trạng thực tế không phải trục. Kho chung `level = null`, `kind = 'hien-trang'`, hiện thành mục «Dữ liệu hiện trạng» trên từng tab, lọc theo phạm vi và theo trục. Đường / đường sắt / đường thủy (`chk_roads`, `chk_osmRail`, `chk_osmWater`) thuộc ngành giao thông. Thửa địa chính thuộc quy hoạch. Dấu chân nhà thuộc kiến trúc. Vi phạm hiện ở quy hoạch và kiến trúc. `status` của lớp catalog là hiện trạng lúc lập đồ án, không phải kho này.

Phạm vi hẹp vẫn hiện lớp gắn thành phố. Không suy ra xã nằm trong đô thị (xã có parent `TP`).

## Liên kết và lần mở

- `?kv=` = `TP` | `dothi:<id>` | `xa:<code>` | `tdp:<code>`.
- `?truc=` = `hanhchinh` | `hatang` | `kientruc` (quy hoạch là mặc định, không ghi).
- `?nganh=` khi đang ở hạ tầng.
- `?tt=` bị xóa. Không còn công tắc trạng thái toàn cục.
- Lần đầu: phạm vi Toàn thành phố, bản đồ khít TP Huế, 40 ranh phường nét sẵn có và nhãn bật, tab Quy hoạch, nhóm QHC 1/25.000 mở, sơ đồ phát triển không gian (`chk_qhc25`) bật, mọi lớp hiện trạng và chuyên ngành tắt, nền đường phố (positron) nếu máy chưa lưu ảnh nền. Sidebar thu, điện thoại chỉ còn bản đồ và hàng 4 icon.
- Link chia sẻ khôi phục đúng tham số của link. Máy đã dùng khôi phục `localStorage` khóa `qh_axes_v1` khi URL không có tham số chia sẻ hay `kv` / `nganh` / `truc`. Link thắng localStorage. Ảnh nền vẫn nhớ riêng (`qhhue.basemap`); link không mang ảnh nền.

## Phục vụ file

`index.json` ghi đè tại chỗ, cache 300 giây. GeoJSON chuyên ngành cache 1 ngày, không `immutable`. Kiến trúc cache 300 giây. Không endpoint mới, không đọc GCS. Wrangler bung symlink GeoJSON lúc deploy (`--materialize`). Lớp catalog có sẵn `scheme` hoặc `level` thì kho dùng đúng trường đó, không suy lại từ tỷ lệ.
