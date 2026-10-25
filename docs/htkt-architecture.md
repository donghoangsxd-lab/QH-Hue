# Hệ thống hạ tầng kỹ thuật — một mạng, mỗi đồ án vẫn xem riêng

Chốt với Dong, 2026-10-24: tám tab HTKT gồm Tổng hợp đường ống; gỡ lớp cột đèn khỏi panel; họng cứu hỏa ở lại cấp nước; dung sai snap QHCT 0,5 m, QHPK 1 m, QHC 1/10.000 là 10 m, QHC 1/25.000 là 100 m; Chân Mây và tuyến thoát nước Bình Thành trên GCS được trỏ qua `/gcs/`, không tải khi mở trang; đồ án thiếu tuyến ống thì trỏ lớp cùng cấp và ghi «dữ liệu tự tổng hợp»; QHPK để hook `qhpk-htkt`. HTXH còn tám loại theo mã Sheet, quỹ đất, độ phủ, và bốn điểm HTKT để bật bán kính.

Tài liệu nghiên cứu bên dưới giữ số đếm catalog. Dung sai 2 m / 5 m ở mục 2 đã được thay bằng số chốt ở trên. Số liệu đếm ngày 2026-10-24 từ `public/data/chuyen-nganh/index.json`, `schemes.json` và GeoJSON local trong `data/chuyen-nganh/` (chỉ in tên lớp, kiểu hình, tên trường, số đối tượng, CRS, đồ án, mapid). Không GET GCS, không mở `infrastructure_hue.json`. CRS catalog: **EPSG:4326** (`index.json`, nguồn `gissonganh.hue.gov.vn/geditor.aspx`). File GeoJSON không có thành viên `crs`; tọa độ mẫu là kinh/vĩ độ Huế (khoảng 107,57°E, 16,39°N).

Khung năm panel (Hành chính, Quy hoạch, HTKT, HTXH, Kiến trúc) giữ nguyên. Đề xuất dưới đây chỉ nằm trong panel HTKT và phần điểm dùng chung với HTXH.

## 1. Hiện trạng

### Bảy nhóm và tab thứ tám

Bảy nhóm là `SECTORS` trong `public/js/facetStore.js` và catalog `index.json`. Sử dụng đất (`sdd`) không thuộc HTKT.

| Id | Tên | Alias `?nganh=` |
|---|---|---|
| `giao-thong` | Giao thông | `giaothong` |
| `cap-nuoc` | Cấp nước | `capnuoc` |
| `cap-dien` | Cấp điện | `capdien` |
| `san-nen-thoat-mua` | San nền và thoát nước mưa | `sannen` |
| `thoat-nuoc-thai` | Thoát nước thải | `thoatnuocthai` |
| `chat-thai-ran-nghia-trang` | Chất thải rắn và nghĩa trang | `ctr-nghiatrang` |
| `thong-tin-lien-lac` | Thông tin liên lạc (TTLL) | `ttll` |

Tab thứ tám **Tổng hợp đường ống** chưa có dữ liệu riêng. Đó là view tuyến của năm nhóm: giao thông, cấp nước, cấp điện, thoát nước (mưa + thải), TTLL. Chi tiết mục 2.

Dữ liệu vận hành có hai kiểu: **điểm công trình** và **tuyến**. Catalog còn **vùng** (mặt đường, công trình dạng vùng, phân khu CTR, phân ô san nền). Vùng được giữ trong mô hình để không bỏ hình, không gộp vào tuyến.

### Kho lớp đang tách theo đồ án

Mỗi đồ án một thư mục `data/chuyen-nganh/<slug>/<nhóm>/<hien-trang|quy-hoach>/*.geojson`. `schemes.json` là sổ đồ án (22 đồ án). `index.json` có 571 lớp, trong đó **422 lớp HTKT**. 420 file local, **57.962 đối tượng**. Hai lớp không đọc local:

- QHC Chân Mây – Lăng Cô, mapid 23935: một lớp «Quy hoạch giao thông» `geomType: Mixed`, URL GCS `projects/qhc-chan-may-lang-co-a44cfad0/qh-giao-thong.json`. `scripts/build-chuyen-nganh.js` ghi 773 đối tượng; lần này không tải lại.
- QHCT Cụm công nghiệp Bình Thành: một lớp tuyến «Công trình tiêu thoát nước (dạng đường)» trên GCS `chuyen-nganh/v1/...`, không cộng vào 57.962.

Không có lớp HTKT cấp QHPK. Cấp trên catalog chỉ `QHC` và `QHCT`. Hai đồ án mapid **21817** tách bằng `catalogScheme`: `qhc-hue-2045` (1/25.000, 41 lớp) và `qhc-trung-tam` (1/10.000, 50 lớp). QHC Đô thị Phong Điền (`skipLayers`) có 0 lớp HTKT; KCN Phong Điền (priority 2) ghi đè trong ranh KCN.

`rules/tuan-thu-cap-do/` mới là quy tắc chữ, chưa có máy kiểm tra HTKT.

### Số lớp và số đối tượng theo nhóm

`phase` là `status` trên catalog (`hien-trang` = hiện trạng lúc lập đồ án, `quy-hoach` = quy hoạch). Hình khai báo khớp hình thật (0 lớp lệch).

| Nhóm | Phase | Điểm lớp / đối tượng | Tuyến lớp / đối tượng | Vùng lớp / đối tượng |
|---|---|---:|---:|---:|
| Giao thông | HT | 3 / 44 | 12 / 347 | 1 / 4 |
| Giao thông | QH | 14 / 774 | 65 / 16.320 | 19 / 2.025 |
| Cấp nước | HT | 2 / 29 | 4 / 798 | 0 |
| Cấp nước | QH | 16 / 770 | 18 / 2.769 | 0 |
| Cấp điện | HT | 4 / 56 | 6 / 251 | 0 |
| Cấp điện | QH | 28 / 8.277 | 29 / 1.698 | 4 / 188 |
| San nền, thoát mưa | HT | 4 / 38 | 4 / 69 | 1 / 8 |
| San nền, thoát mưa | QH | 36 / 4.701 | 52 / 11.219 | 9 / 175 |
| Thoát nước thải | HT | 2 / 27 | 2 / 92 | 0 |
| Thoát nước thải | QH | 16 / 2.935 | 18 / 1.896 | 1 / 425 |
| CTR, nghĩa trang | HT | 5 / 153 | 0 | 1 / 1 |
| CTR, nghĩa trang | QH | 12 / 213 | 0 | 2 / 6 |
| TTLL | HT | 3 / 45 | 3 / 27 | 0 |
| TTLL | QH | 13 / 776 | 12 / 806 | 0 |
| **Cộng** | | **158 / 18.838** | **225 / 36.292** | **38 / 2.832** |

Cộng thêm 1 lớp Mixed Chân Mây (chưa đếm). CTR không có tuyến. Điểm cấp điện phần lớn là cột đèn và đèn chiếu sáng (riêng «Cột đèn chiếu sáng» 4.995, «Đèn chiếu sáng» 1.876, «Công trình chiếu sáng» 740). San nền gồm cả đồng mức, hướng thoát, cao độ — không phải toàn bộ là ống.

Họ tên lớp (gộp cách viết `_P`, `_L`, dấu): giao thông có mạng đường bộ / sắt / thủy, cầu, bó vỉa, mặt cắt, tim đường, đầu mối, mặt đường; cấp nước có mạng ống, đầu mối, điểm đấu nối, họng PCCC; cấp điện có phân phối, chiếu sáng, trạm, năng lượng; thoát mưa có mạng mưa, hướng thoát, thủy lợi, đồng mức, lưu vực, phân ô san nền; thoát thải có mạng thải, hướng thoát, công trình xử lý, cao độ cống; CTR có nghĩa trang, điểm xử lý, phân khu; TTLL có cáp và trạm. Một lớp «Thông tin san nền_P» (28 điểm) đang nằm trong TTLL.

### Theo đồ án

| Đồ án | Cấp | mapid | Tỷ lệ ghi | Lớp HT/QH | Đối tượng (điểm / tuyến / vùng) |
|---|---|---:|---:|---:|---:|
| QHC đô thị Thừa Thiên Huế 1/25.000 | QHC | 21817 | 25.000 | 18/23 | 1.073 / 2.691 / 19 |
| QHC đô thị trung tâm 1/10.000 | QHC | 21817 | 10.000 | 21/29 | 2.647 / 7.381 / 80 |
| QHC TT Phú Lộc | QHC | 20674 | — | 0/18 | 2.339 / 1.752 / 592 |
| QHC Khe Tre | QHC | 20778 | 2.000 | 0/13 | 1.055 / 929 / 136 |
| QHC Đô thị mới Vinh Hưng | QHC | 22906 | — | 7/21 | 3.592 / 3.507 / 204 |
| QHC KCN Phong Điền | QHC | 22880 | — | 2/22 | 1.998 / 3.193 / 222 |
| QHC Đô thị Phong Điền đến 2030 | QHC | — | — | 0 | 0 |
| QHC Chân Mây – Lăng Cô | QHC | 23935 | — | 0/1 | file GCS, xem trên |
| QHC xã Thượng Long | QHC | 20797 | 25.000 | 0/5 | 23 / 188 / 2 |
| QHC xã Hương Hữu | QHC | 20800 | 25.000 | 1/13 | 37 / 351 / 6 |
| QHC xã Hương Lộc | QHC | 20799 | 25.000 | 0/7 | 22 / 299 / 2 |
| QHC xã Thượng Nhật | QHC | 20805 | 25.000 | 1/12 | 117 / 498 / 4 |
| QHCT TĐC Phú Mỹ (Khu C) | QHCT | 20642 | 1.000 | 0/10 | 97 / 271 / 37 |
| QHCT TĐC Thủy Vân GD2 (Khu E) | QHCT | 20644 | 500 | 0/8 | 56 / 558 / 35 |
| QHCT Rú Chá | QHCT | 23967 | 500 | 1/21 | 108 / 403 / 63 |
| QHCT Khu nhà ở An Đông | QHCT | 20601 | 500 | 0/16 | 321 / 679 / 137 |
| QHCT Bãi tắm Thuận An | QHCT | 24981 | 500 | 0/23 | 189 / 400 / 36 |
| QHCT Tố Hữu | QHCT | 22861 | 500 | 0/20 | 1.432 / 8.735 / 562 |
| QHCT Nghĩa trang phía Nam | QHCT | 23953 | 2.000 | 5/26 | 577 / 2.055 / 76 |
| QHCT Trạm điều áp Phú Bài | QHCT | 23946 | 500 | 0/21 | 113 / 247 / 9 |
| QHCT Thanh Thủy | QHCT | 23954 | 500 | 0/26 | 2.522 / 1.067 / 89 |
| QHCT CCN Bình Thành | QHCT | 20768 | 500 | 1/30 | 520 / 1.088 / 521 |

Tỷ lệ lệch nhãn cấp: Khe Tre ghi QHC nhưng scale 2.000; Nghĩa trang phía Nam ghi QHCT nhưng scale 2.000; Phú Mỹ ghi 1.000. Nhiều QHC để trống scale. Gap catalog: 133 dòng HTKT, gần hết lý do «Không có lớp» (đồ án chưa đủ bảy ngành).

### Trường thuộc tính

Trường có mặt gần như mọi lớp (hồ sơ kiểu TT16): `madoituong`, `malienket`, `manhandang`, `mahoso`, `tendoituong`, `nhanbando`, `trangthai`, `trangthaiquyhoach`, `xdaidien`, `ydaidien`, `s_xdaidien`, `s_ydaidien`, `ghichu`, `ngaycapnhat`, `ngaythunhan`, `objectid`.

Trường riêng theo nhóm: giao thông `loaiduong`, `caphangduongbo`, `logioi`, `matcat`, `tenduong`; cấp nước `loaiongcapnuoc`, `duongkinh`, `chatlieuong`; cấp điện `loaiduongday`, `capdienthe`, `dienap`, `tietdien`; thoát nước `diemdau`, `diemcuoi`, `dodoc`, `duongkinh`. `diemdau` và `diemcuoi` có cột trên một số lớp thoát nước nhưng **0/36.292 tuyến có giá trị**. `malienket` có khắp nơi, chưa kiểm tra được là cạnh đồ thị.

Mã chữ và mã số đang trộn. `trangthai` luôn là `"2"` (46.284 đối tượng đã đọc). `trangthaiquyhoach` chủ yếu `"2"` hoặc chữ «Quy hoạch», kèm «Hiện trạng», «Hiện có», «Ngắn hạn 2030», «Dài hạn 2045». `loaiduong` vừa là «Đường khu vực» vừa là số `5`, `2`, `3`. Cột này **không** phải `TrangThai` phê duyệt của Sheet HTXH.

### Lớp ngoài catalog chuyên ngành

Trong panel HTKT còn lớp nền, không nằm trong 422 lớp:

- OSM: `chk_roads`, `chk_osmRail`, `chk_osmWater` (ngành giao thông).
- Hiện trạng tạm `public/data/hien-trang-tam/` cho ba ngành, đã gắn `nguon_do_an`, `nguon_mapid`, `nguon_nam`, `nguon_ty_le`, `nhom`. Giao thông giữ 280 (bỏ 39 trùng), cấp điện 286 (bỏ 18), cấp nước 632 (bỏ 194). Quy tắc trong `scripts/hien-trang-tam.mjs`: tỷ lệ chi tiết hơn thắng, rồi năm phê duyệt, rồi `priority`, rồi slug; điểm trùng trong 100 m; tuyến trùng khi ≥ 60% điểm mẫu nằm trong 60 m; cùng đồ án không tự loại; trong ranh KCN bỏ đồ án bị ghi đè. Bốn ngành kia chưa có bản tạm.
- `chk_gt25` / `chk_gt10` là bộ giao thông gộp khác, không gắn 91 file catalog.

### Chỗ HTXH đang chứa nhầm HTKT

`chuyenNganh.js` (`isPointWork`) đưa **mọi lớp Point của bảy ngành** vào `#pointCatalog` trong panel HTXH. Tuyến và vùng ở lại HTKT. Hệ quả: 158 lớp, 18.838 điểm (trạm biến áp, nhà máy nước, cột đèn, trạm TTLL, hố ga, cao độ, nghĩa trang, …) đang nằm ở HTXH.

Trên Sheet HTXH (`PARCEL_INFRA_TYPES` trong `config/constants.js`), bốn loại điểm sau phục vụ bán kính và cần dùng được từ cả hai panel. Lần này không đếm số điểm Sheet vì không gọi GCS.

| Loại | Mã Sheet | UI HTXH | Trong catalog gisHue |
|---|---|---|---|
| Bãi đỗ xe, trạm sạc | `2-BDX` | `chk_c2` | Không có lớp riêng. 47 đối tượng có chữ «bãi đỗ / đỗ xe» trong thuộc tính lớp khác |
| Trạm dừng xe buýt | `13-BUS` | `chk_c11`, bán kính đi bộ 500 m | 0 đối tượng chữ «xe buýt» |
| Trụ sở cảnh sát PCCC | `10-PCCC` | `chk_c12`, bán kính 3 km phường / 5 km xã | 0 trụ sở. Có họng cứu hỏa: lớp «Công trình cấp nước PCCC_P» và khoảng 300 điểm chữ «cứu hỏa» trong cấp nước |
| Nghĩa trang | phần nghĩa trang của `11-NT` | `chk_nt_grave` | Có lớp điểm riêng trong `chat-thai-ran-nghia-trang` |

Nhà tang lễ (`chk_nt_funeral`) ở lại HTXH. Công viên, giáo dục, y tế, văn hóa, chợ ở lại HTXH. Họng cứu hỏa là phụ kiện mạng cấp nước, không phải trụ sở PCCC.

## 2. Mô hình thống nhất

Một lớp chuẩn cho mỗi **nhóm × kiểu hình × phase**:

`htkt / <group> / <point|line|polygon> / <hien-trang|quy-hoach>`

Mười bốn lớp điểm+tuyến (7 nhóm × 2), cộng lớp vùng ở nhóm nào có vùng. Đối tượng vẫn mang `ma_do_an`. Lọc `ma_do_an = <slug>` trả lại đúng bộ của một đồ án, kể cả đối tượng bị đồ án khác ghi đè trên bản tổng hợp. File gốc trong `data/chuyen-nganh/` không sửa.

### Trường chuẩn

| Trường | Nội dung |
|---|---|
| `group` | Một trong bảy id |
| `subtype` | Họ trong nhóm: `mang-duong-bo`, `mang-ong`, `cot-den`, `nghia-trang`, `dong-muc`, … suy từ tên lớp, rồi từ `loaiduong` / `loaicongtrinh` khi giá trị là chữ |
| `ma_do_an` | Slug trong `schemes.json`. Alias `qhc-hue-2045`, `qhc-trung-tam` quy về slug dài |
| `source` | `{ mapid, file, layerName }`. Mapid 21817 không đủ để tách hai đồ án; bắt buộc kèm slug |
| `cap_quy_hoach` | `QHC25`, `QHC10`, `QHPK`, `QHCT`. Suy từ `level` và scale, không lấy nhãn scale khi lệch (Khe Tre, Nghĩa trang phía Nam) |
| `nam` | Năm `decisionDate` trên sổ đồ án. Thiếu quyết định thì để trống, không lấy `ngaycapnhat` shapefile làm năm phê duyệt |
| `phase` | `hien-trang` hoặc `quy-hoach` |
| `status` | Trên view tổng hợp: `hien-hanh` hoặc `bi-ghi-de`. Khi lọc một `ma_do_an`, mọi đối tượng của đồ án đó hiện như bộ riêng |

Giữ nguyên thuộc tính gốc trong `src` (có `madoituong`). Khóa ổn định: `ma_do_an + file gốc + madoituong`, vì `madoituong` có thể trùng giữa các đồ án. `trangthai` mã `"2"` không map sang `status`.

Sổ đồ án là `public/data/chuyen-nganh/schemes.json` (slug, tên, level, mapid, scale, parent, overrides, overrideArea, priority, area, decision, decisionDate). Lớp chuẩn chỉ lưu `ma_do_an` và join sổ khi vẽ. Đồ án chưa có lớp vẫn nằm trong sổ để UI hiện «Chưa có».

### Giải trùng giữa đồ án

Hai chế độ, cùng một lớp chuẩn:

1. **Một đồ án.** `ma_do_an` khớp. Không áp ghi đè, không xóa trùng với đồ án khác. Đây là cách kiểm tra một đồ án.
2. **Tổng hợp thành phố.** Cùng `group`, cùng `phase`, cùng họ `subtype`. Không trộn hiện trạng với quy hoạch. Không trộn nhóm (đường sắt không xóa đường bộ, ống nước không xóa cáp).

Thứ tự giữ trên bản tổng hợp:

1. Trong `overrideArea` của đồ án con, con thắng và đối tượng cha trong ranh nhận `status = bi-ghi-de` (ẩn trên tổng hợp, còn khi mở cha). Đã có: QHCT priority 3 ghi đè cha trong ranh QHCT; KCN Phong Điền priority 2 ghi đè QHC Phong Điền trong ranh KCN. Không cắt hình cha.
2. Ngoài ranh ghi đè, xếp theo cấp **QHCT > QHPK > QHC**. Cùng cấp thì tỷ lệ chi tiết hơn (mẫu số nhỏ hơn), rồi `nam` mới hơn, rồi `priority`, rồi slug. Cấp đi trước số scale để Khe Tre (QHC, scale 2.000) không đè một QHPK thật.
3. Trùng hình, cùng họ: điểm trong 100 m; tuyến khi ít nhất 60% điểm mẫu nằm trong 60 m. Ngưỡng này đang chạy ở hiện trạng tạm ba ngành. Cùng một `ma_do_an` không tự loại.

`status = bi-ghi-de` là cờ hiển thị, không xóa bản ghi. Bản một đồ án và bản tổng hợp đọc cùng file.

### Thông mạch

Hiện chưa có mạng: không có id nút, `diemdau`/`diemcuoi` rỗng. Bước kiểm tra đề xuất, chạy lúc build, không chặn phát hành:

- Bắt dính (snap) **đầu cuối tuyến trong cùng nhóm, cùng phase, cùng `ma_do_an`**. Không snap khác nhóm.
- Dung sai đã chốt: QHCT 0,5 m, QHPK 1 m, QHC 1/10.000 là 10 m, QHC 1/25.000 là 100 m.
- Báo cáo: đầu tuyến không gặp nút, đoạn ngắn hơn dung sai, thành phần rời, điểm công trình đầu mối cách tuyến cùng nhóm xa hơn dung sai.
- Trên view tổng hợp, chỉ nối các đối tượng `hien-hanh` sau giải trùng, để không nối ống của hai đời đồ án.

### Tổng hợp đường ống

Không có file thứ sáu. Là bộ lọc tuyến `hien-hanh` của năm nhóm:

| Nhóm lấy | Subtype lấy | Để ngoài |
|---|---|---|
| Giao thông | Mạng đường bộ, sắt, thủy, cầu, tim đường | Bó vỉa, mặt cắt, mặt đường (vùng), đầu mối (điểm) |
| Cấp nước | Mạng ống | Điểm nhà máy, họng, đấu nối |
| Cấp điện | Đường dây phân phối và chiếu sáng | Cột đèn, trạm, vùng trạm |
| Thoát nước | Mạng mưa (`san-nen-thoat-mua`) và mạng thải | Đồng mức, hướng thoát, cao độ, phân ô san nền, điểm xử lý |
| TTLL | Cáp | Trạm |

CTR và san nền (cao độ, phân ô) không vào view này. Màu theo `group`. Lọc `ma_do_an` vẫn áp được: một đồ án xem năm mạng cùng lúc, không giải trùng với đồ án khác.

## 3. Pipeline

Script đề xuất `scripts/build-htkt.mjs` (chưa viết trong PR này):

1. Đọc `schemes.json` và GeoJSON gốc. Không ghi đè gốc, không ghi đè `index.json`.
2. Gán `group` theo thư mục, `subtype` theo bảng tên lớp (có test khóa).
3. Ghi `data/htkt/v1/<group>/<geom>-<phase>.geojson` với trường chuẩn và `src`.
4. Với tuyến lớn, ghi thêm `data/htkt/v1/htkt.pmtiles`, mỗi nhóm-kiểu hình một layer, để bản đồ kéo theo Range. GeoJSON vẫn là bản đủ thuộc tính.
5. Ghi `data/htkt/v1/manifest.json`: số đối tượng, số `bi-ghi-de`, báo cáo snap, danh sách lớp chưa map subtype.
6. Hai file chỉ có trên GCS (Chân Mây, một lớp Bình Thành) tải một lần lúc build, không tải khi người dùng mở bản đồ.
7. Phát hành GCS theo tiền tố có phiên bản, `Cache-Control: public, max-age=31536000, immutable`. Không endpoint mới. `hien-trang-tam` giữ đến khi bản tổng hợp khớp số kept của ba ngành.

Lọc một đồ án là lọc thuộc tính trên file đã build, không tạo 22 bản sao.

## 4. Giao diện panel HTKT

Khung droplist năm panel, ô tìm, nút HT/QH, nút cả nhóm, `#isoSlotHaTang` giữ nguyên. `#axisEnvFold` là tab Lớp môi trường đáy panel. Thay dải bảy nút trong `#browseNganh` bằng tám tab: bảy nhóm, rồi **Tổng hợp đường ống**.

Trong mỗi tab:

- Công tắc **Điểm / Tuyến / Vùng**. Tab đường ống khóa ở Tuyến và chỉ bật năm nhóm ống.
- Danh đồ án của tab đó: mặc định «Tổng hợp đã giải trùng», cộng từng đồ án có lớp (huy hiệu Có dữ liệu / Chưa có giữ như hiện tại). Chọn một đồ án thì tắt giải trùng.
- Phase vẫn đi cùng nút HT/QH sẵn có của panel, không thêm công tắc trạng thái toàn cục.

HTXH:

- Gỡ `#pointCatalog` khỏi việc nhận mọi điểm bảy ngành.
- Giữ công viên, giáo dục, y tế, văn hóa, chợ, nhà tang lễ.
- Bốn loại bãi đỗ xe, trạm xe buýt, trụ sở PCCC, nghĩa trang vẫn bật bán kính trên HTXH, đọc **cùng id** lớp điểm HTKT (`subtype` tương ứng), không nhân bản. Nguồn Sheet (`2-BDX`, `13-BUS`, `10-PCCC`, `11-NT`) giữ đến khi đối chiếu xong với catalog, vì catalog chưa có lớp bãi đỗ, bến xe buýt và trụ sở PCCC.

## 5. Các bước chuyển và khối lượng

Không ước ngày. Việc nằm ở script local và hai chỗ UI (`chuyenNganh.js`, `#browseNganh` / `#pointCatalog`). Không thêm request máy chủ mỗi lần mở lớp.

1. Khóa sổ: điền scale đang trống, đánh dấu scale lệch cấp, ghi QHPK cha (đang chỉ có slug `parent`, chưa có lớp HTKT), quyết định lúc nào Phong Điền và Chân Mây vào bản local.
2. Bảng `subtype` từ tên lớp, kèm test trên `index.json` (không sửa GeoJSON).
3. `build-htkt.mjs` ra `data/htkt/v1/`, đối chiếu 57.962 đối tượng local và số kept của hiện trạng tạm.
4. Báo cáo snap. Lỗi thông mạch thành manifest, lớp vẫn vẽ được.
5. View tổng hợp và lọc `ma_do_an` trên cùng file.
6. Tám tab trong panel HTKT. HTXH chỉ còn bốn subtype điểm HTKT cho bán kính, cộng hạ tầng xã hội.
7. Khi bản tổng hợp khớp hiện trạng tạm ba ngành, tắt ba lớp `ht-tam-*`. File tạm và file gốc vẫn để đó.

Rủi ro nằm ở bảng subtype và dung sai snap, nên chốt mục 6 trước khi viết script. Chi phí dự kiến của pipeline: build một lần trên máy, một lần ghi GCS (Class A theo số file phiên bản), người dùng đọc file tĩnh (Class B như GeoJSON chuyên ngành hôm nay). Không tính lại trên Cloud Run.

## 6. Câu hỏi cho Dong

1. Tab đường ống có loại bó vỉa, mặt cắt, đồng mức, hướng thoát, cột đèn như bảng mục 2, hay lấy mọi tuyến của năm nhóm?
2. Bốn loại bán kính HTXH: giữ điểm Sheet làm nguồn đã duyệt, catalog gisHue chỉ là lớp quy hoạch đối chiếu, hay nhập Sheet vào cùng `subtype`?
3. Họng cứu hỏa ở lại cấp nước, không đưa sang trụ sở PCCC. Đúng chưa?
4. Dung sai snap 0,5 / 1 / 2 / 5 m theo cấp có dùng được với sai số bản vẽ gisHue không?
5. Đồ án thiếu `decisionDate` (nhiều QHC xã, KCN) xếp hạng bằng priority rồi slug. Có bổ sung năm không?
6. QHPK chưa có lớp HTKT. Tab cấp QHPK để trống đến khi có mapid, hay ẩn?
7. Cột đèn (hàng nghìn điểm) là subtype của cấp điện hay một nhóm phụ trong tab cấp điện để khỏi nuốt các trạm?
8. Chân Mây (GCS, 773 đối tượng theo script cũ) và lớp tuyến Bình Thành trên GCS có đưa vào bản build đầu không?
