# Đặc tả giao diện lõi

Hợp đồng đã thống nhất. Sửa layout, panel, chú giải, lớp nền hoặc danh sách trục thì giữ đúng file này. Kiểm tra: `scripts/test-core-ui.mjs`.

## Bố cục (desktop)

- Panel trục bên trái, cách mép 12px, cao gần hết màn hình, co lên khi mở bảng tổng hợp phía dưới. Khi panel thu, dải năm trục bên trái là lối mở duy nhất; không có nút «>>» góc trên trái. Nút thu nằm trên hàng tiêu đề của panel.
- Cột nút công cụ bên phải. Nút Giới thiệu là ô vuông đầu cột, góc trên phải. Menu chuột phải giữ nguyên.
- Hộp tiêu đề `#mapTitle` đứng trong khoảng trống giữa panel trục và cột nút: mép trái `12px + bề rộng panel + 16px`, mép phải `12px + ô nút + 16px`, canh giữa khoảng đó. Vị trí không nhảy khi mở hoặc đóng panel trục hay bảng tổng hợp. Câu «BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ» một dòng, không cắt. Điện thoại (≤840px) giữ cột nút trái và tiêu đề phía trên cột nút.
- Bảng tổng hợp thu thì mỏ `#btnExpandBottomPanel` nằm góc dưới phải, dạng tab (bo phía trên), cùng màu, cùng bề rộng và cùng mép phải với cột nút công cụ.
- Điện thoại giữ cột nút trái và panel dạng sheet. Không áp gương desktop vào media điện thoại.
- Thẻ thông tin lô và menu chuột phải không gỡ.

## Năm trục

Droplist `#layerMag`: một tiêu đề 12px; bấm mở danh sách cùng cỡ chữ; nút thu cùng hàng. Thứ tự:

1. Quản lý phát triển đô thị
2. Hệ thống bản đồ quy hoạch
3. Hệ thống hạ tầng kỹ thuật
4. Hệ thống hạ tầng xã hội
5. Quản lý lĩnh vực kiến trúc

Hàng dưới tiêu đề: một ô tìm kiếm, một nút HT/QH, một nút bật/tắt cả nhóm. Không ô tìm thứ hai. Panel ẩn khi tải trang. Không hàng chip «Lớp đang xem», không tab Bản đồ nền / Bản đồ môi trường trên thanh tiêu đề.

### Hành chính

Tab trên ô tìm kiếm: `Đơn vị hành chính`, rồi `Đô thị`. Không ghi số lượng trên nhãn tab.

- ĐVHC: dòng Thành phố Huế không số, đậm, nền vàng nhạt; 40 đơn vị đánh số 1–40. Tên hiện rút gọn: «TP Huế», «P. …», «X. …». Tooltip và ô tìm vẫn dùng tên đầy đủ, và tìm được cả dạng rút gọn. Cột một hàng, không xuống dòng: số, tên, dân số, km², và đúng một cột loại theo nút HT/QH trên thanh công cụ. Nút hiện trạng (`data-view-mode="HT"`) → cột «Loại HT» (QĐ 614, tooltip: loại trước chuyển tiếp), chú thích `Theo QĐ 614; loại trước chuyển tiếp`. Nút quy hoạch (`data-view-mode="QH"`, mặc định) → cột «Loại 2030» (QĐ 756: I / II / III / `PĐ III`, tooltip đúng câu `Phấn đấu đạt loại III`), chú thích `Theo QĐ 756; kế hoạch nâng loại có thể thay đổi theo nghiên cứu cụ thể`. Thiếu mức thì «—» mờ. Không hiện cả hai cột cùng lúc. Không thêm bộ lọc theo cột này. Hai nút vẫn đổi cả bản đồ hiện trạng / quy hoạch như trước.
- Bấm một dòng (đơn vị, đô thị, hoặc Thành phố Huế) phóng tới và tô cả ranh. Thành phố tô viền ngoài.
- Hai tab `Đơn vị hành chính` và `Đô thị` cùng một hàng, không có `(40)` hay `(25)`, chữ không chồng, không cắt ở bề rộng panel.
- Đô thị: không nút «Hệ thống đô thị» (trùng ô Phân loại đô thị). Cùng nút HT/QH với ĐVHC: HT chỉ danh sách Hiện trạng; QH chỉ Quy hoạch, hai tab `Đến 2030` và `Sau 2030` ngay đầu danh sách. Không hiện cả hai trạng thái cùng lúc. Tên «Thành phố Huế», «Phường …», «Xã …» rút gọn như ĐVHC; «Đô thị …» và «Khu vực đô thị …» giữ nguyên. Tooltip và tìm kiếm giữ tên đầy đủ. Mỗi danh sách đang hiện đánh số Huế là dòng 1, các đô thị sau tiếp tục. Tab ĐVHC vẫn để Thành phố Huế không số. Nhóm `Loại I`, `Loại II`, `Loại III`. Nhãn `(phấn đấu)`, `(lõi: …)`, `(chưa có ranh)` nằm cuối tên, không bị cắt. Bấm dòng có ranh thì phóng và tô polygon đó. Dòng quy hoạch Thành phố Huế tô ranh thành phố. Dòng chưa có ranh không vẽ. Mỗi dòng lưới dân số / km².

### Quy hoạch

Ngay dưới hàng tìm kiếm, một hàng bốn tab vừa khít: QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500. Mở panel thì QHC 1/25.000 đang bật. Bấm cấp chưa mở để bật thêm. Bấm cấp đang mở nhưng chưa xem thì chuyển sang xem cấp đó. Bấm lại cấp đang xem thì tắt nếu còn cấp khác. Mỗi cấp đang bật gắn danh sách đồ án của cấp đó phía dưới. Không dòng «Phạm vi: Toàn thành phố».

### Hạ tầng kỹ thuật

Bảy ngành, lớp tuyến và vùng, môi trường, ô giả lập bán kính. Không quỹ đất.

### Hạ tầng xã hội

Công trình điểm, hạ tầng xã hội, và cả mục Quỹ đất và công trình (ranh lô, cơ sở chưa sử dụng, chung cư, dự án kêu gọi đầu tư). Ô giả lập bán kính.

### Kiến trúc

Quy chế và công trình. Không dòng phạm vi. Không chú giải.

## Đổi trục

Sang Quy hoạch, Hạ tầng kỹ thuật, Hạ tầng xã hội hoặc Kiến trúc thì phạm vi về toàn thành phố. Xóa lọc phường/xã đang chọn ở Hành chính, xóa tô ranh và khung phóng theo đơn vị đó. Không mang phạm vi đó sang trục khác. Ở lại Hành chính thì giữ đơn vị đang chọn.

## Chú giải và lớp nền

Ghim đáy panel, chú giải trên lớp nền. Hai hàng tiêu đề luôn hiện. Mở một mục chiếm một phần ba chiều cao panel; mở cả hai thì hai phần ba; nở từ đáy lên. Chú giải ẩn trên Hành chính và Kiến trúc.

Lớp nền độc lập với trục, dùng được trên mọi trục. Đủ năm lựa chọn, ô chọn đứng đầu mục Lớp nền:

- Google vệ tinh
- Esri World Imagery
- Esri Wayback (ô mốc chỉ tải khi chọn Wayback)
- Sentinel-2 Cloudless 2025
- Bản đồ đường phố

## Token

Một bộ biến cho mọi trục và chú giải, trong `public/css/style.css`:

- `--axis-font`, `--axis-fs-header` 12px, `--axis-fs-row` 12px, `--axis-fs-chip` 11px
- `--axis-row-h` 22px, `--axis-head-h` 24px, `--axis-chip-h` 22px
- `--axis-color`, `--axis-color-strong`, `--axis-color-muted`, `--axis-bg-active`, `--axis-bg-hover`
- Thanh cuộn panel 5px, cùng tông panel
- Tiêu đề và chip một hàng; danh sách giãn hết chiều cao phần còn lại

## Danh sách và ranh

- Lưới đô thị: số, tên, dân số, km². Lưới ĐVHC thêm đúng một cột loại (Loại HT hoặc Loại 2030). Thiếu số thì «—», không bịa. Huế trong tab Đô thị có số 1; Thành phố Huế trong tab ĐVHC không số. Danh sách không hiện tiền tố «Thành phố Huế», «Phường », «Xã »; dạng rút gọn là «TP Huế», «P. », «X. ».
- Ranh trong giữa các phường/xã: một nét mảnh `#334155`, không quầng, không bóng, không nét đôi. Mỗi cạnh chung chỉ vẽ một lần. Quầng sáng chỉ có trên vành ngoài thành phố (lớp `city-outline-glow`). Chọn một đơn vị vẫn tô nền đỏ nhạt và một viền đỏ; đổi đơn vị hoặc rời trục thì xóa tô đó.
- Dòng Thành phố Huế: đậm, nền `#fef3c7`.

## Số liệu không bịa

Chỉ số có trong repo. Dân số và diện tích ĐVHC lấy `dvhcStats.js`. Danh sách Đô thị theo QĐ 756 và QĐ 614 lấy km² từ `properties.km2` của polygon được dẫn trong `doThiQd756.js` (đã tính sẵn, không cộng lại trên máy chủ). Thành phố Huế ở kỳ quy hoạch dùng km² toàn thành phố trong `dvhcStats`. Hiện trạng Đô thị Huế không có polygon phạm vi đã công nhận, nên dùng ranh thành phố `urban614` #hue và km² `properties.km2` của polygon đó. Dân số hiện trạng chỉ cộng khi phạm vi đã công nhận phủ trọn các đơn vị hiện nay (Hương Thủy, Hương Trà).

Đô thị cấp xã đến 2030 (Vinh Thanh, Phú Đa, Lộc Sơn, Khe Tre, Phú Lộc, Vinh Hiền, Quảng Điền, A Lưới 2) dùng polygon lõi trong `urban614`, không lấy ranh cả xã. Đô thị Hóa Châu đến 2030 là cả phường (`generalPlan` #hoa-chau), không phải lõi Thanh Hà. Đô thị Chân Mây – Lăng Cô đến 2030 dùng ranh GIS đồ án QHC Chân Mây - Lăng Cô (`dothi-chan-may.geojson`), không dùng thị trấn Lăng Cô và không dùng ranh ba xã của KVĐT Chân Mây. Sau 2030, Phú Vinh, Phú Vang, Hưng Lộc và Khe Tre dùng polygon cả xã trong `urbanVision` (id `vinh-thanh`, `phu-da`, `loc-son`, `khe-tre`). Phú Hồ không có id trong `urbanVision`; dùng `generalPlan` #phu-ho. Chỉ để «(chưa có ranh)» khi không còn polygon trong các lớp đô thị đã có.

Không có trong repo, cột để «—»:

- Dân số dự báo đến 2030 và sau 2030.
- Dân số đô thị chỉ chiếm một phần đơn vị (không ước theo tỷ lệ dân). Dân số phạm vi đã công nhận của Đô thị Huế hiện trạng không có số riêng.
- km² khi chưa có polygon đúng phạm vi.
- km² và dân số của «Các vùng còn lại» (`hue-outer`).
