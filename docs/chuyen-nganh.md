# Hạ tầng chuyên ngành QHC đô thị Thừa Thiên Huế

Bộ dữ liệu hạ tầng 7 chuyên ngành, gắn tab Hạ tầng. Mô hình bốn trục: [docs/bon-truc.md](bon-truc.md).

Nguồn: [mapid 21817](https://gissonganh.hue.gov.vn/geditor.aspx?mapid=21817) (Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045). Tải bằng `qhFetchLayers` theo nhóm trên cây lớp, máy nhận `gserver-to-shp.js`. Hai nhóm giao thông quy hoạch đã có sẵn trên máy và được dùng lại. CRS **EPSG:4326** (WGS84), cùng hệ Leaflet và `scripts/build-qhc2045.js`.

Mỗi lớp: `data/chuyen-nganh/<tỷ lệ>/<chuyên ngành>/<hien-trang|quy-hoach>/<lớp>.geojson` (đủ thuộc tính), `.zip` shapefile UTF-8, và `-ten-truong.txt` (tên trường DBF 10 ký tự → tên gốc). Manifest: `public/data/chuyen-nganh/index.json`.

## Catalog

| Chuyên ngành | Tỷ lệ | Trạng thái | Lớp | Kiểu | Số đối tượng |
|---|---:|---|---|---|---:|
| Giao thông | 1/10.000 | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 18 |
| Giao thông | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 53 |
| Giao thông | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| Giao thông | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 7 |
| Giao thông | 1/10.000 | Hiện trạng | Hiện trạng mặt cắt | LineString | 63 |
| Giao thông | 1/10.000 | Quy hoạch | Bó vỉa | LineString | 1180 |
| Giao thông | 1/10.000 | Quy hoạch | Cầu giao thông dạng đường | LineString | 449 |
| Giao thông | 1/10.000 | Quy hoạch | Công trình đầu mối giao thông | Point | 58 |
| Giao thông | 1/10.000 | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 802 |
| Giao thông | 1/10.000 | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 13 |
| Giao thông | 1/10.000 | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 6 |
| Giao thông | 1/10.000 | Quy hoạch | Mặt cắt | LineString | 564 |
| Giao thông | 1/10.000 | Quy hoạch | Mặt đường bộ | Polygon | 76 |
| Giao thông | 1/25.000 | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 24 |
| Giao thông | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 98 |
| Giao thông | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| Giao thông | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 6 |
| Giao thông | 1/25.000 | Quy hoạch | Cầu giao thông dạng đường | LineString | 14 |
| Giao thông | 1/25.000 | Quy hoạch | Công trình đầu mối giao thông | Point | 125 |
| Giao thông | 1/25.000 | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 180 |
| Giao thông | 1/25.000 | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 10 |
| Giao thông | 1/25.000 | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 14 |
| Cấp nước | 1/10.000 | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 9 |
| Cấp nước | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 309 |
| Cấp nước | 1/10.000 | Quy hoạch | Công trình đầu mối cấp nước | Point | 15 |
| Cấp nước | 1/10.000 | Quy hoạch | Mạng lưới cấp nước | LineString | 598 |
| Cấp nước | 1/25.000 | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 20 |
| Cấp nước | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 485 |
| Cấp nước | 1/25.000 | Quy hoạch | Công trình đầu mối cấp nước | Point | 52 |
| Cấp nước | 1/25.000 | Quy hoạch | Mạng lưới cấp nước | LineString | 904 |
| Cấp điện | 1/10.000 | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 9 |
| Cấp điện | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 195 |
| Cấp điện | 1/10.000 | Quy hoạch | Công trình cấp điện dạng điểm | Point | 21 |
| Cấp điện | 1/10.000 | Quy hoạch | Công trình năng lượng | Point | 4 |
| Cấp điện | 1/10.000 | Quy hoạch | Mạng lưới phân phối điện | LineString | 112 |
| Cấp điện | 1/25.000 | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 18 |
| Cấp điện | 1/25.000 | Hiện trạng | Hiện trạng công trình năng lượng | Point | 15 |
| Cấp điện | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 35 |
| Cấp điện | 1/25.000 | Quy hoạch | Công trình cấp điện dạng điểm | Point | 51 |
| Cấp điện | 1/25.000 | Quy hoạch | Công trình năng lượng | Point | 28 |
| Cấp điện | 1/25.000 | Quy hoạch | Mạng lưới phân phối điện | LineString | 74 |
| San nền và thoát nước mưa | 1/10.000 | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 5 |
| San nền và thoát nước mưa | 1/10.000 | Hiện trạng | Hiện trạng công trình thủy lợi dạng đường | LineString | 17 |
| San nền và thoát nước mưa | 1/10.000 | Hiện trạng | Hiện trạng công trình tiêu thoát nước | Point | 13 |
| San nền và thoát nước mưa | 1/10.000 | Hiện trạng | Hiện trạng hướng thoát nước | LineString | 6 |
| San nền và thoát nước mưa | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới thoát nước dạng đường | LineString | 38 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 6 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 28 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Công trình tiêu thoát nước | Point | 874 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Điểm độ cao thoát nước | Point | 363 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Hướng thoát nước | LineString | 555 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 1533 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 3 |
| San nền và thoát nước mưa | 1/10.000 | Quy hoạch | Quy hoạch chiều cao | Point | 363 |
| San nền và thoát nước mưa | 1/25.000 | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 17 |
| San nền và thoát nước mưa | 1/25.000 | Hiện trạng | Hiện trạng phân lưu thoát nước dạng đường | LineString | 8 |
| San nền và thoát nước mưa | 1/25.000 | Hiện trạng | Hiện trạng phân lưu thoát nước dạng vùng | Polygon | 8 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 10 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 26 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Hướng thoát nước | LineString | 49 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 65 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 32 |
| San nền và thoát nước mưa | 1/25.000 | Quy hoạch | Phân vùng lưu vực dạng vùng | Polygon | 8 |
| Thoát nước thải | 1/10.000 | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 17 |
| Thoát nước thải | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 54 |
| Thoát nước thải | 1/10.000 | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 440 |
| Thoát nước thải | 1/10.000 | Quy hoạch | Điểm độ cao thoát nước thải | Point | 276 |
| Thoát nước thải | 1/10.000 | Quy hoạch | Mạng lưới thoát nước thải | LineString | 599 |
| Thoát nước thải | 1/25.000 | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 10 |
| Thoát nước thải | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 38 |
| Thoát nước thải | 1/25.000 | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 476 |
| Thoát nước thải | 1/25.000 | Quy hoạch | Mạng lưới thoát nước thải | LineString | 597 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Hiện trạng | Hiện trạng điểm xử lý chất thải rắn | Point | 4 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 17 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Hiện trạng | Hiện trạng phân khu chất thải rắn | Polygon | 1 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Quy hoạch | Điểm xử lý chất thải rắn | Point | 5 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Quy hoạch | Mạng lưới nghĩa trang | Point | 30 |
| Chất thải rắn và nghĩa trang | 1/10.000 | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| Chất thải rắn và nghĩa trang | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới chất thải rắn | Point | 7 |
| Chất thải rắn và nghĩa trang | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 65 |
| Chất thải rắn và nghĩa trang | 1/25.000 | Quy hoạch | Điểm xử lý chất thải rắn | Point | 17 |
| Chất thải rắn và nghĩa trang | 1/25.000 | Quy hoạch | Mạng lưới nghĩa trang | Point | 61 |
| Chất thải rắn và nghĩa trang | 1/25.000 | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| Thông tin liên lạc | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| Thông tin liên lạc | 1/10.000 | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 12 |
| Thông tin liên lạc | 1/10.000 | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 183 |
| Thông tin liên lạc | 1/10.000 | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 88 |
| Thông tin liên lạc | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| Thông tin liên lạc | 1/25.000 | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 27 |
| Thông tin liên lạc | 1/25.000 | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 42 |
| Thông tin liên lạc | 1/25.000 | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 50 |

## Khoảng trống

- 1/25.000 không có lớp cao độ nền hay quy hoạch chiều cao (san nền). Chỉ có hướng thoát nước (quy hoạch) và phân lưu / thủy lợi (hiện trạng).
- 1/10.000 hiện trạng không có lớp cao độ nền. Quy hoạch chiều cao chỉ có ở nhóm chuẩn bị kỹ thuật 1/10.000.
- Không có lớp chiếu sáng riêng trong nhóm điện (cây lớp gộp vào cung cấp năng lượng, điện, chiếu sáng).
- Hiện trạng 1/25.000 liệt kê hai lần «Hiện trạng phân lưu thoát nước dạng đường» cùng một bảng; script gộp còn một lớp (8 đối tượng).
- Bó vỉa 1/10.000: lần tải trước bỏ 8 dòng không có hình. Catalog đếm số hình đã ghi.
- Hiện trạng 1/10.000 không có lớp công trình năng lượng (có ở hiện trạng 1/25.000 và quy hoạch cả hai tỷ lệ).
- Hiện trạng 1/25.000 chất thải rắn chỉ có điểm, không có phân khu vùng.
- Hiện trạng công trình thủy lợi dạng đường 1/25.000 có 28 dòng trên gServer, tất cả thiếu hình.
- San nền và thoát nước mưa, 1/25.000, hiện trạng: «Hiện trạng công trình thủy lợi dạng đường» — Mọi dòng không có hình hợp lệ, đã bỏ.

## Lớp không xếp vào 7 chuyên ngành

| Tỷ lệ | Nhóm / trạng thái | Lớp | Số đối tượng | Lý do |
|---:|---|---|---:|---|
| 1/10.000 | Hiện trạng (1-10.000) | Hiện trạng sử dụng đất | 3746 | Không thuộc 7 chuyên ngành hạ tầng |
| 1/25.000 | Hiện trạng (1-25.000) | Hiện trạng sử dụng đất | 4659 | Không thuộc 7 chuyên ngành hạ tầng |
| 1/25.000 | Ranh giới quy hoạch (1:25.000) | Ranh giới quy hoạch dạng vùng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Ranh giới quy hoạch (1:25.000) | Ranh giới quy hoạch dạng đường | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Ranh giới quy hoạch (1:10.000) | Ranh giới quy hoạch dạng vùng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Ranh giới quy hoạch (1:10.000) | Ranh giới quy hoạch dạng đường | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch tổng mặt bằng sử dụng đất (1:10.000) | Chức năng sử dụng đất | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch tổng mặt bằng sử dụng đất (1:10.000) | Phân khu chức năng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch tổng mặt bằng sử dụng đất (1:10.000) | Sơ đồ tiểu vùng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch tổng mặt bằng sử dụng đất (1:10.000) | Điểm chức năng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000) | Quy hoạch vùng không gian | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000) | Không gian mặt nước | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000) | Không gian cây xanh | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000) | Quy hoạch đường không gian | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000) | Định hướng phát triển đô thị | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:10.000) | Quy hoạch vùng không gian | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:10.000) | Không gian cây xanh | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:10.000) | Không gian mặt nước | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:10.000) | Quy hoạch đường không gian | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch công trình ngầm (1:10.000) | Công trình ngầm dạng vùng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch công trình ngầm (1:10.000) | Công trình ngầm dạng đường | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/10.000 | Quy hoạch công trình ngầm (1:10.000) | Công trình ngầm dạng điểm | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Đánh giá môi trường chiến lược (1:25.000) | Đánh giá tổng hợp lựa chọn đất xây dựng dạng vùng | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |
| 1/25.000 | Đánh giá môi trường chiến lược (1:25.000) | Đánh giá tổng hợp lựa chọn đất xây dựng dạng điểm | — | Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu |

Các bản đồ scan (2A–3E, 7A–7F, 10A–10F) là nhóm không có lớp vector. «Hình ảnh các bản vẽ thiết kế đô thị» kiểu DATA, không có hình.

## Lưu trữ

Từng file GeoJSON và zip đều dưới 5 MB nên nằm trong git. Không đẩy GCS, không dựng pmtiles. Worker chỉ phục vụ `public/`: `public/data/chuyen-nganh/10000` và `25000` là symlink tới `data/chuyen-nganh/` (không nhân bản trong git). Lúc deploy CI, `scripts/stage-chuyen-nganh.mjs` bung symlink thành thư mục nếu biến `CI` bật.
