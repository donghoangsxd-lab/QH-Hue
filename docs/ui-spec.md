# Đặc tả giao diện lõi

Hợp đồng đã thống nhất. Sửa layout, panel, chú giải, lớp nền hoặc danh sách trục thì giữ đúng file này. Kiểm tra: `scripts/test-core-ui.mjs`.

## Bố cục (desktop)

- Panel trục bên trái, cách mép 12px, cao gần hết màn hình, co lên khi mở bảng tổng hợp phía dưới. Khi panel thu, dải sáu trục bên trái là lối mở duy nhất; không có nút «>>» góc trên trái. Nút thu nằm trên hàng tiêu đề của panel.
- Cột nút công cụ bên phải. Nút Giới thiệu là ô vuông đầu cột, góc trên phải, nằm trong cột nút. Không nút nổi riêng. Menu chuột phải giữ nguyên.
- Hộp tiêu đề `#mapTitle` đứng sát mép phải panel trục (`12px + bề rộng panel + 16px`), rộng vừa chữ, không kéo tới cột nút. Mép trái không nhảy khi mở hoặc đóng panel trục hay bảng tổng hợp. Câu «BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ» một dòng, không cắt. Điện thoại (≤840px) giữ cột nút phải; tiêu đề nằm phía trên, sau panel hoặc dải trục bên trái. Nút Giới thiệu là ô đầu cột phải.
- Bảng tổng hợp thu thì mỏ `#btnExpandBottomPanel` nằm góc dưới phải, dạng tab (bo phía trên), cùng màu, cùng bề rộng và cùng mép phải với cột nút công cụ.
- Điện thoại giữ cột nút phải và panel dạng sheet bên trái, cùng phía với desktop. Bảng thông tin thửa, lô, đồ án và tra cứu điểm nằm sau dải trục bên trái, kể cả khi panel trục đang thu.
- Điện thoại ngang (máy đang xoay ngang, hoặc cao tối đa 560px): panel là sheet góc trái, không trải hết chiều ngang. Panel đang thu: sáu nút trục là cột dọc mép trái, cao vừa khung nhìn (chia đều sáu ô), không nằm ở đáy; nhãn không cắt bằng dấu ba chấm. Panel đang mở: ẩn cột sáu nút để bản đồ rộng thêm; đổi trục bằng droplist `#layerMag` trong panel. Nút công cụ tối thiểu 40px, cuộn nếu thiếu chỗ. Manifest PWA giữ `display` standalone và `orientation` landscape: Chrome Android khóa chiều ngang khi mở từ biểu tượng đã cài; sau khi deploy phải cài lại hoặc cập nhật biểu tượng thì khóa mới có hiệu lực. Safari iOS bỏ qua `orientation` của manifest. Lần mở thử khóa chiều ngang bằng Screen Orientation API khi trình duyệt cho phép, không xin toàn màn hình và không thông báo. Nếu khóa bị chặn thì bố cục theo hướng thật của máy, không xoay khung bằng CSS. Nút «Xoay màn hình» một lần chạm xin khóa chiều còn lại, không thông báo; trình duyệt không khóa thì giao diện vẫn theo hướng máy. Nút đó là mục cuối cột công cụ bên phải và luôn nằm trong khung nhìn; các nút phía trên cuộn khi thiếu chỗ. Nút «Cài ứng dụng» hiện trên điện thoại; desktop không hiện hai nút này. Trên iOS, nút mở các bước Chia sẻ → Thêm vào Màn hình chính, kèm biểu tượng ứng dụng.
- `viewport-fit=cover`. Thanh trạng thái và thanh điều hướng Android không che cột nút, cột trục, tiêu đề hay sheet: mép dùng `env(safe-area-inset-*)`. Điện thoại không xin toàn màn hình. Xoay máy hoặc bấm «Xoay màn hình» không hiện thông báo, banner hay hộp thoại.
- Thẻ thông tin lô và menu chuột phải không gỡ. Bảng lô đất quy hoạch: hai tab «Chỉ tiêu» và «Quy định»; tab Chỉ tiêu có lưới 2×2 (diện tích, mật độ XD, chiều cao tối đa, hệ số sử dụng) và dải chức năng sử dụng đất; tab Quy định mở quy chế / quyết định đã gắn và chỗ cho quy chế kiến trúc. Không sơ đồ lô liền kề. Bảng lô hạ tầng (và lô đất quy hoạch): không nút «Xem 3D»; không dòng «Chiều cao (ảnh vệ tinh)». Hai chức năng «Xem bán kính phục vụ» và «Xem mật độ xây dựng thực tế» là icon trên hàng công cụ, thứ tự trái → phải: bán kính phục vụ › mật độ xây dựng › chia sẻ vị trí › chỉ đường › chỉnh sửa › xóa lô › ẩn bảng › tắt bảng. Điện thoại: chạm giữ yên 1,5 giây thì mở đúng menu chuột phải của máy tính; ngón tay di chuyển thì hủy, không mở menu. Mục «Xem thông tin thửa đất»: chuyển droplist sang B. Hệ thống bản đồ quy hoạch, bật cấp quy hoạch chi tiết nhất còn dữ liệu tại điểm bấm, mở brief đồ án giao thửa (khi có) và bảng thửa kèm trang quy hoạch cấp đó trên bản đồ đúng cấp. Mục «Xem thông tin lô đất quy hoạch» (và submenu cấp): cũng chuyển sang trục B, bật đúng cấp đã chọn (hoặc cấp chi tiết nhất nếu bấm thẳng mục), mở brief/danh sách đồ án tương ứng và thẻ lô cùng kiểu khi bấm lô trên bản đồ. Rê chuột vào mục lô hiện menu phía sau, chỉ các cấp đang có lô tại điểm bấm: QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500. Bấm lô khi lớp thửa đang bật vẫn mở thông tin lô; lớp thửa vẽ dưới ô đất quy hoạch, viền thửa đang chọn không tô đè màu lô. Đánh giá sự phù hợp quy hoạch cấp trên là một nút icon trên từng lô; chức năng cấp trên, chỉ tiêu và kết luận chỉ hiện khi bấm nút đó. Máy tính, trục Quy hoạch: bấm tên đồ án trong danh sách hoặc bấm ranh trên bản đồ thì bảng thông tin đồ án (`.project-brief`) gắn vào `#planBriefSlot` ngay dưới hàng bốn cấp (`body.plan-brief-open`); danh sách đồ án còn lại ở `#planListPane` tự dịch xuống, không nổi trên bản đồ. Bấm một ô đất quy hoạch (QHPK/QHCT), vùng/lô QHC 1/25.000 hoặc 1/10.000, hoặc thửa / lô hạ tầng thì bảng thông tin gắn vào `#planInfoSlot` và phủ hết `#planListPane` (`body.plan-info-open`); `#planBriefSlot` nằm trên, không bị bảng lô đè. Thẻ QHC cùng khung hai tab Chỉ tiêu / Quy định và lưới chỉ tiêu 2×2 (ô theo trường có sẵn của từng cấp). Bảng lô trong panel cùng kiểu khung với bảng đồ án: viền cam, bo tròn bốn góc, nền tối. Không nút chữ «Xem mật độ xây dựng thực tế» khi đã có icon mật độ trên hàng công cụ. Bấm icon mật độ: hiện rõ dấu chân công trình trong ranh; phần chân lòi ngoài ranh lô (hoặc thửa) gạch chéo đỏ và không tính vào mật độ. Đóng bảng lô thì danh sách hiện lại dưới brief; đóng brief thì chỉ còn danh sách. Panel đang thu thì mở ra để xem bảng; đóng bảng thì trả lại trạng thái thu hoặc mở lúc trước. Khi panel trục đang thu, bảng thông tin đồ án, thửa và lô đứng sau dải sáu trục, không chui xuống dưới dải đó. Điện thoại và máy tính cùng bố cục trục Quy hoạch: bảng đồ án ở `#planBriefSlot` ngay dưới bốn tab cấp; bảng lô / thửa ở `#planInfoSlot` phủ `#planListPane` (`body.plan-info-open`), không đè droplist B hay bốn tab cấp. Không dùng `phone-info-dock` để mở bảng lô quy hoạch (tránh ẩn hàng cấp). Đóng bảng lô thì danh sách đồ án hiện lại dưới brief.

## Sáu trục

Droplist `#layerMag`: một tiêu đề 12px, chữ vàng nhạt (`--text-title`); bấm mở danh sách cùng cỡ chữ, cùng màu; nút thu cùng hàng. Thứ tự:

A. Quản lý phát triển đô thị
B. Hệ thống bản đồ quy hoạch
C. Hệ thống hạ tầng kỹ thuật
D. Hệ thống hạ tầng xã hội
E. Quản lý về kiến trúc
F. Dự án đầu tư

Hàng dưới tiêu đề: một ô tìm kiếm, một nút HT/QH, một nút bật/tắt cả nhóm. Trục Kiến trúc không có nút HT/QH (chỉ ô tìm và nút bật/tắt nhóm). Không ô tìm thứ hai. Panel ẩn khi tải trang. Lúc mở, nếu không có link chia sẻ: trục Quy hoạch, đúng một cấp QHC 1/25.000, ranh giới 40 phường/xã bật, khung vừa cả thành phố, ảnh nền Google vệ tinh. Không khôi phục lớp hay ảnh nền đã chọn lần trước. Không hàng chip «Lớp đang xem», không tab Bản đồ nền / Bản đồ môi trường trên thanh tiêu đề.

### Hành chính

Tab trên ô tìm kiếm: `Đơn vị hành chính`, rồi `Đô thị`, rồi `Chấm điểm`. Không ghi số lượng trên nhãn tab.

- ĐVHC: dòng Thành phố Huế không số, đậm, nền vàng nhạt; 40 đơn vị đánh số 1–40. Tên hiện rút gọn: «TP Huế», «P. …», «X. …». Tooltip và ô tìm vẫn dùng tên đầy đủ, và tìm được cả dạng rút gọn. Cột một hàng, không xuống dòng: số, tên, dân số, km², và đúng một cột loại theo nút HT/QH trên thanh công cụ. Nút hiện trạng (`data-view-mode="HT"`) → cột «Loại HT» (QĐ 614, tooltip: loại trước chuyển tiếp), chú thích `Theo QĐ 614; loại trước chuyển tiếp`. Nút quy hoạch (`data-view-mode="QH"`) → cột «Loại 2030» (QĐ 756: I / II / III / `PĐ III`, tooltip đúng câu `Phấn đấu đạt loại III`), chú thích `Theo QĐ 756; kế hoạch nâng loại có thể thay đổi theo nghiên cứu cụ thể`. Thiếu mức thì «—» mờ. Không hiện cả hai cột cùng lúc. Không thêm bộ lọc theo cột này. Nút hiện trạng hiện bản đồ phân loại đô thị hiện trạng (QĐ 614) trên ảnh nền. Nút quy hoạch hiện bản đồ phân loại đô thị theo quy hoạch đã có (QĐ 756) trên cùng ảnh nền, không bật QHC 1/25.000 và không mở bản đồ đồ án. Cả ba tab Đơn vị hành chính, Đô thị và Chấm điểm dùng chung hai nút này. Mở panel này thì nút hiện trạng đang bật, lớp Hệ thống đô thị, tắt mọi cấp QHC/QHPK/QHCT, và khung vừa cả thành phố. Hàng ô tìm và nút HT/QH giữ đủ chiều cao, không bị danh sách đè. Sang panel khác thì trả lại chế độ xem lúc trước. Không có camera trên link thì mới phóng khung thành phố.
- Nút chia đôi màn hình trên cột công cụ mở menu hai lựa chọn: Đồng tâm (hai bản đồ chồng khít, kéo thanh trượt) và Lệch tâm (mỗi bản đồ giữa nửa màn hình của nó). Đang chia đôi thì bấm lại nút để tắt; trên tiêu đề vẫn đổi được Đồng tâm / Lệch tâm. Khi đang ở trục A, chia đôi tự so sánh hệ thống đô thị hiện trạng (trái, QĐ 614) với hệ thống đô thị theo quy hoạch (phải, QĐ 756), không gắn nền QHC 1/25.000 và không hiện droplist chọn cấp từng bên.
- Bấm một dòng (đơn vị, đô thị, hoặc Thành phố Huế) phóng tới và tô cả ranh. Thành phố tô viền ngoài.
- Ba tab `Đơn vị hành chính`, `Đô thị` và `Chấm điểm` cùng một hàng, không có `(40)` hay `(25)`, chữ không chồng, không cắt. Hẹp thì cuộn ngang.
- Chấm điểm: ba mức Huế (Phụ lục I, đạt hoặc không đạt), Đô thị (Bảng 2A, cùng danh sách quy hoạch của tab Đô thị, trừ Thành phố Huế), Phường và xã (Bảng 2B, 40 đơn vị). Mỗi đơn vị có tổng điểm hoặc số tiêu chuẩn đạt, kết luận Điều 9.3, danh sách tiêu chuẩn chưa đạt kèm phần trăm thiếu, biểu đồ theo quý và năm, bản đồ tô theo điểm. Thiếu số liệu thì «—» và «chưa đánh giá», không tính là đạt. Số liệu lấy từ CSV, không bịa. Ô trống được tự tính khi đã có công thức trong dữ liệu bản đồ; cạnh nhãn «tự tính» là giá trị đo. Ô có số trong bảng thì ghi đè và hiện nhãn «ghi đè».
- Đô thị: không nút «Hệ thống đô thị» (trùng ô Phân loại đô thị). Cùng nút HT/QH với ĐVHC: HT chỉ danh sách Hiện trạng; QH chỉ Quy hoạch, hai tab `Đến 2030` và `Sau 2030` ngay đầu danh sách. Không hiện cả hai trạng thái cùng lúc. Tên «Thành phố Huế», «Phường …», «Xã …» rút gọn như ĐVHC; «Đô thị …» và «Khu vực đô thị …» giữ nguyên. Tooltip và tìm kiếm giữ tên đầy đủ. Mỗi danh sách đang hiện đánh số Huế là dòng 1, các đô thị sau tiếp tục. Tab ĐVHC vẫn để Thành phố Huế không số. Nhóm `Loại I`, `Loại II`, `Loại III`. Nhãn `(phấn đấu)`, `(lõi: …)`, `(chưa có ranh)` nằm cuối tên, không bị cắt. Bấm dòng có ranh thì phóng và tô polygon đó. Dòng quy hoạch Thành phố Huế tô ranh thành phố. Dòng chưa có ranh không vẽ. Mỗi dòng lưới dân số / km².

### Quy hoạch

Ngay dưới hàng tìm kiếm, một hàng bốn tab vừa khít: QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500. Mỗi tab có `(số)` đồ án nhập của cấp đó khi số > 0 (ví dụ `QHPK 1/2.000 (78)`). Mở panel thì QHC 1/25.000 đang bật. Mỗi lúc chỉ một cấp bật: bấm cấp khác thì bật cấp đó và tắt ba cấp còn lại. Bấm QHC 1/10.000 khi đang xem QHC 1/25.000 giữ nguyên khung nhìn, không phóng ra toàn thành phố. Không vẽ viền chọn. Cấp đang bật có nền cam `--accent-orange`. Pane Quy hoạch ít padding ngang (`2px`). Dưới tab: `#planBriefSlot` (thông tin đồ án khi mở) rồi `#planListPane` (danh sách đồ án; bảng lô phủ vùng này khi mở). Brief và bảng lô cùng bề ngang pane: viền cam đều bốn cạnh, bo góc, không thanh inset / dải tối mép trái. Danh sách chỉ gồm đồ án (và dòng lớp tĩnh QHC nếu có) của cấp đang bật; không hàng tiêu đề trùng tên tab, không badge số và không nút mắt trong danh sách. Muốn xem đồ án cấp khác thì chuyển cấp rồi bật từng đồ án trong nhóm đó. Nút mắt cuối thanh tìm (`#btnAxisAll`) bật hoặc tắt cả lớp và đồ án của cấp đang xem; không đổi khung nhìn, không phóng toàn thành phố. Không dòng «Phạm vi: Toàn thành phố». Không mục «Dữ liệu hiện trạng» trong danh sách cấp và đồ án. Không dòng «Đồ án QHCT 1/500» riêng dưới tab. Thửa đất địa chính 2016 và Công trình vi phạm chỉ ở Lớp nền. Dòng «QH giao thông» (toàn thành phố và trung tâm) kết thúc bằng icon «Đường sắt» cùng hàng: bật hoặc tắt lớp đường sắt. Không tách thành nút cả dòng hay dòng con.

### Hạ tầng kỹ thuật

Tám nhóm: bảy ngành (giao thông, cấp nước, thoát nước mưa, thoát nước thải, cấp điện, thông tin liên lạc, chất thải rắn và nghĩa trang) rồi Tổng hợp đường ống. Trong mỗi nhóm có điểm công trình, tuyến mạng và vùng. Tổng hợp đường ống chỉ hiện tuyến của giao thông, cấp nước, cấp điện, thoát nước và thông tin liên lạc. Lớp cột đèn không hiện. Họng cứu hỏa ở lại cấp nước. Ô giả lập bán kính giữ nguyên. Môi trường không nằm trong trục này: tab «Lớp môi trường» ghim đáy panel. Không quỹ đất. Đồ án thiếu tuyến thì ghi «dữ liệu tự tổng hợp». Cấp QHPK chưa có lớp thì để hook, không bịa tuyến. Mở đồ án thì hiện quy mô từng ngành đã có số và kết quả đối chiếu trần cấp trên: OK, vượt (kèm mức vượt), hoặc chưa đủ dữ liệu. Ô trống không tính là đạt. Số vượt trần đã có thì không ghi.

### Hạ tầng xã hội

Ba droplist cùng kiểu HTKT: Loại công trình (đủ loại điểm gồm bãi đỗ xe, PCCC, xe buýt, nghĩa trang, nhà tang lễ), Cấp phục vụ (Tất cả / vùng / đô thị / đơn vị ở / nhóm nhà ở — chỉ hiện cấp có dữ liệu của loại đang chọn; lọc danh sách khi chọn), Phạm vi (Thành phố Huế và đủ 40 phường/xã). Danh sách công trình đánh số thứ tự, cùng font và khoảng cách dòng với danh sách kiến trúc (`.project-row`); mỗi dòng tên + phường/xã + diện tích cuối dòng, thiếu diện tích thì `-`. Bấm một dòng phóng tới công trình. Chú giải: mỗi loại một hàng biểu tượng + nút ● vùng phủ + checkbox bật lớp; cuối danh sách là Bản đồ độ phủ hạ tầng (`#chk_heat`, thanh độ trong suốt, `#heatLegend`). không ký hiệu chức năng sử dụng đất. Ô lớp điểm ẩn trong panel (`#xahoiLayerSource`); bật/tắt qua Chú giải. Mục Quỹ đất và công trình (ranh lô) ở đây; cơ sở chưa sử dụng bật trong Chú giải. Chung cư và dự án kêu gọi đầu tư nằm ở trục Dự án đầu tư. Ô giả lập bán kính giữ nguyên.

### Kiến trúc

Hai tab: Quy chế kiến trúc và Công trình có giá trị. Tab công trình có tiêu đề «Danh mục công trình kiến trúc Pháp (Quyết định số 1152/QĐ-UBND)», nút mở PDF và nút quản trị tải PDF lên bucket. Danh sách như đồ án: nhóm đóng mở, dòng đánh số, ô hiện trên bản đồ, tên xuống dòng, nút ảnh (quản trị, tối đa 3 ảnh × 2 MB) và nút thông tin. Ảnh đã tải nằm ngay dưới tên, phía trên dòng Địa điểm. Nút PDF chỉ mở file khi đã ghi lên bucket, không xoay chờ. Tên công trình không kèm phường. Dòng Địa điểm nối địa chỉ với phường hoặc xã đủ chữ, ví dụ «03 Lê Lợi, phường Thuận Hóa». Không dòng quyết định trong từng công trình. Bấm tên trong danh sách thì phóng tới điểm. Bấm giọt nước trên bản đồ thì mở panel, tab Công trình có giá trị và hồ sơ thông tin của công trình đó. Trên bản đồ là giọt nước kèm tên phía dưới, không hộp thoại. Thu xa hơn mức 16 thì ẩn tên để khỏi chồng lên công trình; công trình đang chọn vẫn giữ tên. Không nút Hiện trạng / Quy hoạch sau ô tìm kiếm. Không dòng phạm vi. Không chú giải. Không mục «Dữ liệu hiện trạng»: Công trình xây dựng (GBA) và Công trình vi phạm chỉ ở Lớp nền.

### Dự án đầu tư

Ngay sau Kiến trúc. Tiêu đề droplist `F. Dự án đầu tư (N dự án)` (số tổng cập nhật theo dữ liệu), cùng cỡ chữ 12px với các trục kia. Không dòng ô lớp «Dự án kêu gọi đầu tư» dưới tab; lớp `chk_invest` ẩn, tắt khi mở trang (kể cả Ctrl+F5), tự bật khi mở trục F. Ngay dưới hàng tìm kiếm, tám tab nhóm cùng kiểu cấp quy hoạch (`.level-pick-btn`, nền cam `--accent-orange` khi đang chọn), lưới hai hàng bốn cột (`#levelPickDt`), mỗi lúc một tab. Nhãn: DVTM, Công nghiệp, Năng lượng, Đô thị, Chung cư, Nông nghiệp, VHXH, Dự án khác — mỗi nút kèm `(số)` dự án trong nhóm; `title` đủ tên nhóm. Mặc định DVTM. Danh sách phía dưới chỉ của tab đang chọn. Lớp ranh chỉ vẽ dự án thuộc tab đang chọn. Tab DVTM chia 5 nhóm con (Sân gôn; Khách sạn; Khu du lịch; Cửa hàng xăng dầu; Thương mại dịch vụ khác): mỗi nhóm một hàng tiêu đề, cuối hàng nút mắt bật/tắt lớp bản đồ và nút mở/thu danh sách; mặc định chỉ mở và bật nhóm Sân gôn để giảm lag. Tab Chung cư thêm lớp `chk_c14` (NOXH) và danh sách NOXH phía trên danh sách 15-DA; số trên tab Chung cư gồm cả NOXH. Dự án sheet 15-DA xếp theo lĩnh vực; không rõ thì Dự án khác; admin chuyển nhóm, sửa thông tin, tải ranh KML/DXF. Dự án chỉ có tên, chưa có ranh, vẫn trong danh sách (nhãn «Chưa có ranh»). Mỗi dự án một dòng cùng kiểu công trình kiến trúc Pháp; cuối dòng hiện diện tích (cột sheet, không có thì đo ranh, thiếu thì `-`) rồi nút mở thông tin. Không lặp hai lớp này ở Hạ tầng xã hội.

## Đổi trục

Sang Quy hoạch, Hạ tầng kỹ thuật, Hạ tầng xã hội, Kiến trúc hoặc Dự án đầu tư thì phạm vi về toàn thành phố. Xóa lọc phường/xã đang chọn ở Hành chính, xóa tô ranh và khung phóng theo đơn vị đó. Không mang phạm vi đó sang trục khác. Ở lại Hành chính thì giữ đơn vị đang chọn.

## Chú giải và lớp nền

Ghim đáy panel. Một hàng không xuống dòng, đúng ba tab: Chú giải, Lớp nền, Lớp môi trường. Không chip cấp (ví dụ QHPK 1/2.000) trên hàng này. Mỗi lúc một khung, cao một phần ba panel. Trên điện thoại khung đó cao khoảng một phần ba màn hình (`33dvh`) và cuộn được. Bấm tab thì đổi khung. Chú giải ẩn trên Hành chính và Kiến trúc (khi đó còn Lớp nền và Lớp môi trường). Trục Dự án đầu tư hiện Chú giải: chỉ ký hiệu lớp đang bật (giọt nước chung cư, ranh dự án kêu gọi), không ký hiệu sử dụng đất. Tiêu đề nhóm ký hiệu sử dụng đất trong Chú giải (Phát triển đô thị, Công cộng, …) cỡ 10px. Chú giải theo cấp đang bật, gồm ký hiệu, mục Hiển thị lô đất (độ trong suốt) và Viền lô theo giai đoạn.

Lớp nền độc lập với trục, dùng được trên mọi trục. Không chứa Hiển thị lô đất hay Viền lô theo giai đoạn. Khung Lớp nền và Lớp môi trường cuộn được. Ô chọn đứng đầu mục Lớp nền, đủ hai lựa chọn:

- Google vệ tinh
- Bản đồ đường phố

Không ô mốc Wayback. Không khối quyết định phê duyệt trong Lớp nền (QĐ 614 và QĐ 756 nằm ở tab Đô thị). Thửa đất địa chính 2016 và Công trình vi phạm nằm trong khung này, không lặp ở danh sách quy hoạch.

Lớp môi trường dùng được trên mọi trục: địa hình, thoát nước, lưu vực, mô phỏng ngập, ngập Sentinel-1, nhiệt độ bề mặt, NDVI, ưu tiên trồng cây, rừng, công trình chịu rủi ro.

## Token

Một bộ biến cho mọi trục và chú giải, trong `public/css/style.css`:

- `--axis-font`, `--axis-fs-header` 12px, `--axis-fs-row` 12px, `--axis-fs-chip` 11px
- `--axis-row-h` 22px, `--axis-head-h` 24px, `--axis-chip-h` 22px
- `--axis-color`, `--axis-color-strong`, `--axis-color-muted`, `--axis-bg-active`, `--axis-bg-hover`
- Thanh cuộn danh sách trục và khung đáy 5px, cùng tông tối, sát mép phải panel
- Tiêu đề và chip một hàng; danh sách giãn hết chiều cao phần còn lại

## Danh sách và ranh

- Lưới đô thị: số, tên, dân số, km². Lưới ĐVHC thêm đúng một cột loại (Loại HT hoặc Loại 2030). Thiếu số thì «—», không bịa. Huế trong tab Đô thị có số 1; Thành phố Huế trong tab ĐVHC không số. Danh sách không hiện tiền tố «Thành phố Huế», «Phường », «Xã »; dạng rút gọn là «TP Huế», «P. », «X. ».
- Ranh trong giữa các phường/xã: nét vàng `#fde68a` đọc được trên viền đậm `#1e293b` sát mép, không quầng, không bóng, không blur. Mỗi cạnh chung chỉ vẽ một lần. Quầng sáng chỉ có trên vành ngoài thành phố (lớp `city-outline-glow`). Chọn một đơn vị vẫn tô nền đỏ nhạt và một viền đỏ; đổi đơn vị hoặc rời trục thì xóa tô đó.
- Dòng Thành phố Huế: đậm, nền `#fef3c7`.

## Số liệu không bịa

Chỉ số có trong repo. Dân số và diện tích ĐVHC lấy `dvhcStats.js`. Danh sách Đô thị theo QĐ 756 và QĐ 614 lấy km² từ `properties.km2` của polygon được dẫn trong `doThiQd756.js` (đã tính sẵn, không cộng lại trên máy chủ). Thành phố Huế ở kỳ quy hoạch dùng km² toàn thành phố trong `dvhcStats`. Hiện trạng Đô thị Huế không có polygon phạm vi đã công nhận, nên dùng ranh thành phố `urban614` #hue và km² `properties.km2` của polygon đó. Dân số hiện trạng chỉ cộng khi phạm vi đã công nhận phủ trọn các đơn vị hiện nay (Hương Thủy, Hương Trà).

Đô thị cấp xã đến 2030 (Vinh Thanh, Phú Đa, Lộc Sơn, Khe Tre, Phú Lộc, Vinh Hiền, Quảng Điền, A Lưới 2) dùng polygon lõi trong `urban614`, không lấy ranh cả xã. Đô thị Hóa Châu đến 2030 là cả phường (`generalPlan` #hoa-chau), không phải lõi Thanh Hà. Đô thị Chân Mây – Lăng Cô đến 2030 dùng ranh GIS đồ án QHC Chân Mây - Lăng Cô (`dothi-chan-may.geojson`), không dùng thị trấn Lăng Cô và không dùng ranh ba xã của KVĐT Chân Mây. Sau 2030, Phú Vinh, Phú Vang, Hưng Lộc và Khe Tre dùng polygon cả xã trong `urbanVision` (id `vinh-thanh`, `phu-da`, `loc-son`, `khe-tre`). Phú Hồ không có id trong `urbanVision`; dùng `generalPlan` #phu-ho. Chỉ để «(chưa có ranh)» khi không còn polygon trong các lớp đô thị đã có.

Không có trong repo, cột để «—»:

- Dân số dự báo đến 2030 và sau 2030.
- Dân số đô thị chỉ chiếm một phần đơn vị (không ước theo tỷ lệ dân). Dân số phạm vi đã công nhận của Đô thị Huế hiện trạng không có số riêng.
- km² khi chưa có polygon đúng phạm vi.
- km² và dân số của «Các vùng còn lại» (`hue-outer`).

## Bảng nổi

Cột trái của bản đồ xếp dọc, không đè nhau: ghi chú đô thị, thẻ trình diễn, thông tin đồ án, rồi tra cứu điểm. Bảng thửa, bảng lô quy hoạch và bảng lô thuộc nhóm hạ tầng nằm trong panel trục, không đứng cột này. Bảng dự án kêu gọi đầu tư chiếm cột đó; các bảng kia sang phải bảng đó. Cột phải của bản đồ chỉ mở một bảng một lúc: thẩm định, hỏi đáp, phác thảo, đề xuất, xuất bản đồ, Street View, khung 3D chưa phóng to. Bảng xuất bản đồ nằm trong khoảng trống, phía trên bảng tổng hợp. Mở bảng mới thì bảng cũ ở cột đó đóng. Không đè panel trục, cột nút, tiêu đề hay bảng tổng hợp. Phóng to được phủ lên: bảng tổng hợp toàn màn hình, tờ thẩm định, khung 3D phóng to, hộp thoại phủ kín.

## Phác thảo

Hình chỉ trong phiên làm việc (bộ nhớ trang), không ghi máy chủ. Bấm một đường, đa giác, mũi tên, vòng tròn hoặc chữ để chọn. Hình đang chọn có viền sáng. Phím Delete xóa hình đó. Chuột phải trên hình mở menu phác thảo, có «Điều chỉnh» và mục xóa hình; chuột phải chỗ khác vẫn là menu bản đồ. «Điều chỉnh» hiện núm đỉnh và núm giữa cạnh (chèn đỉnh). Kéo núm bằng chuột hoặc chạm: bản đồ không kéo theo khi đang giữ núm; hình và số đo cập nhật ngay. Chuột phải núm đỉnh: «Xóa đỉnh» (đường giữ ít nhất 2 đỉnh, đa giác ít nhất 3). Xong bằng Enter, bấm vùng trống trên bản đồ, hoặc mục «Xong». Esc hủy và trả hình về lúc bắt đầu chỉnh. Backspace khi đang chấm vẫn xóa đỉnh vừa chấm. Tọa độ đã ghi nằm lại đúng phiên đó.

## Đo khoảng cách và diện tích

Phép đo chỉ nằm trong phiên làm việc, không ghi máy chủ. Chấm đỉnh trên bản đồ; nháy đúp hoặc Enter kết thúc nét (đường ít nhất 2 đỉnh, vùng ít nhất 3). Bấm một phép đo đã kết thúc để chọn (nét dày hơn, viền trắng). Phím Delete xóa phép đo đang chọn. Chuột phải trên phép đo mở menu «Điều chỉnh»; chuột phải chỗ khác vẫn là menu bản đồ. «Điều chỉnh» dùng cùng núm đỉnh với phác thảo. Kéo núm: bản đồ không kéo theo; hình và số đo cập nhật ngay. Chuột phải núm đỉnh: «Xóa đỉnh» (đường giữ ít nhất 2 đỉnh, vùng ít nhất 3). Enter, bấm vùng trống hoặc «Xong» ghi. Esc hủy và trả phép đo về lúc bắt đầu chỉnh. Bấm lại nút đo đang bật để xóa mọi phép đo và tắt công cụ. Khi đang chấm, đỉnh gần con trỏ vẫn xóa bằng chuột phải; Backspace xóa đỉnh vừa chấm.
