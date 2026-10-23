# Hạ tầng chuyên ngành

Bộ dữ liệu hạ tầng chuyên ngành, gắn tab Hạ tầng. Mô hình bốn trục: [docs/bon-truc.md](bon-truc.md). CRS **EPSG:4326**.

Đường dẫn: `data/chuyen-nganh/<scheme>/<sector>/<hien-trang|quy-hoach>/` (GeoJSON đủ thuộc tính, zip shapefile UTF-8, `-ten-truong.txt`). Manifest: `public/data/chuyen-nganh/index.json`. Quan hệ đồ án: `public/data/chuyen-nganh/schemes.json`.

## Đồ án

| Slug | Tên | Cấp | mapid | Ưu tiên |
|---|---|---|---:|---:|
| qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1 | QHC đô thị Thừa Thiên Huế 1/25.000 | QHC | 21817 | 1 |
| qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72 | QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | QHC | 21817 | 1 |
| qhc-tt-phu-loc-19e96a86 | QHC TT Phú Lộc | QHC | 20674 | 1 |
| qhc-khe-tre-4a4803cd | QHC Khe Tre | QHC | 20778 | 1 |
| qhc-do-thi-moi-vinh-hung-8899f27b | QHC Đô thị mới Vinh Hưng | QHC | 22906 | 1 |
| qhc-khu-cong-nghiep-phong-dien-f997bd2c | QHC Khu công nghiệp Phong Điền | QHC | 22880 | 2 |
| qhc-do-thi-phong-dien-den-nam-2030-tam-nhin-den-nam-2045-5727c5b3 | QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045 | QHC | — | 1 |
| qhc-chan-may-lang-co-a44cfad0 | QHC Chân Mây - Lăng Cô | QHC | 23935 | 1 |

QHC Khu công nghiệp Phong Điền nằm trong QHC đô thị Phong Điền. Trong ranh KCN, KCN ghi đè Phong Điền (`overrides`, `overrideArea: ranh KCN`, priority 2 > 1). Không cắt dữ liệu.

Phạm vi Hành chính gắn trên đồ án (`area` trong `schemes.json`), không suy xã nằm trong đô thị. Phú Lộc: `xa:phu-loc`. Khe Tre: `dothi:khe-tre` (`catalogScheme` `qhc-khe-tre`). Vinh Hưng: `xa:vinh-loc`. KCN Phong Điền: `dothi:phong-dien` (không gộp vào đồ án Phong Điền). Chân Mây – Lăng Cô: `dothi:chan-may` (`catalogScheme` `qhc-chan-may`). Hai đồ án mapid 21817 giữ phạm vi theo tỷ lệ (1/25.000 toàn thành phố, 1/10.000 đô thị trung tâm). Tab Hạ tầng nhóm lớp theo từng đồ án trong ngành; đồ án địa phương hiện ở cả tab QHC 1/25.000 và 1/10.000, rồi bị lọc theo phạm vi đang chọn.

Hai thư mục mapid 21817 giữ slug lưu trữ. Catalog gắn `catalogScheme`: 1/25.000 → `qhc-hue-2045`, 1/10.000 → `qhc-trung-tam`. Lớp sử dụng đất của hai đồ án này là file tĩnh đã có (`data/qhc2045/dinhhuong.json`, `data/qhc2045/sdd.json`), không phát hành bản thô. Chỉ mục lớp đã có: `public/data/su-dung-dat-index.json`.

Metadata bản đồ gServer không có số quyết định. Số dưới đây lấy từ thuộc tính lớp ranh (ngày dạng M/D/YYYY của shapefile, đã đổi sang ISO). QHC TT Phú Lộc: nhiệm vụ 3134/QĐ-UBND ngày 2019-12-16, phê duyệt 1101/QĐ-UBND ngày 2020-04-17 (UBND tỉnh; 1/5 vùng ranh có giá trị). QHC Khe Tre: nhiệm vụ 1022/QĐ-UBND ngày 2016-05-16, phê duyệt 688/QĐ-UBND ngày 2020-03-13. QHC Đô thị mới Vinh Hưng: phê duyệt 193/QĐ-UBND ngày 2025-01-21 (UBND thành phố Huế). QHC Khu công nghiệp Phong Điền: trường có trên lớp ranh nhưng để trống. Hai đồ án mapid 21817: lô này chưa có lớp ranh quy hoạch.

## Catalog

| Đồ án | Ngành | Trạng thái | Lớp | Kiểu | Số đối tượng |
|---|---|---|---|---|---:|
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 24 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 98 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 6 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Quy hoạch | Cầu giao thông dạng đường | LineString | 14 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 125 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 180 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 10 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 14 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp nước | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 20 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp nước | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 485 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 52 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 904 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 18 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Hiện trạng | Hiện trạng công trình năng lượng | Point | 15 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 35 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Quy hoạch | Công trình cấp điện dạng điểm | Point | 51 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Quy hoạch | Công trình năng lượng | Point | 28 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 74 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 17 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng phân lưu thoát nước dạng đường | LineString | 8 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng phân lưu thoát nước dạng vùng | Polygon | 8 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 10 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 26 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 49 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 65 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 32 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng vùng | Polygon | 8 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thoát nước thải | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 10 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thoát nước thải | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 38 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 476 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 597 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới chất thải rắn | Point | 7 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 65 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 17 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Mạng lưới nghĩa trang | Point | 61 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 27 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 42 |
| QHC đô thị Thừa Thiên Huế 1/25.000 | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 50 |
| QHC đô thị Huế 2045 | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Sơ đồ phát triển không gian TP (trỏ `data/qhc2045/dinhhuong.json`) | Polygon | — |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 18 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 53 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 7 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Hiện trạng | Hiện trạng mặt cắt | LineString | 63 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Bó vỉa | LineString | 1180 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Cầu giao thông dạng đường | LineString | 449 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 58 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 802 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 13 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 6 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Mặt cắt | LineString | 564 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 76 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp nước | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 9 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp nước | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 309 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 15 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 598 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp điện | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 9 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 195 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp điện | Quy hoạch | Công trình cấp điện dạng điểm | Point | 21 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp điện | Quy hoạch | Công trình năng lượng | Point | 4 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 112 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 5 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng đường | LineString | 17 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình tiêu thoát nước | Point | 13 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng hướng thoát nước | LineString | 6 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng mạng lưới thoát nước dạng đường | LineString | 38 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 6 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 28 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 874 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Điểm độ cao thoát nước | Point | 363 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 555 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 1533 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 3 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 363 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thoát nước thải | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 17 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thoát nước thải | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 54 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 440 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thoát nước thải | Quy hoạch | Điểm độ cao thoát nước thải | Point | 276 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 599 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng điểm xử lý chất thải rắn | Point | 4 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 17 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng phân khu chất thải rắn | Polygon | 1 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 5 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Mạng lưới nghĩa trang | Point | 30 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Chất thải rắn và nghĩa trang | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 12 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 183 |
| QHC đô thị trung tâm Thừa Thiên Huế 1/10.000 | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 88 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | QH sử dụng đất (trung tâm) (trỏ `data/qhc2045/sdd.json`) | Polygon | — |
| QHC TT Phú Lộc | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 177 |
| QHC TT Phú Lộc | Giao thông | Quy hoạch | Đường sắt cao tốc | LineString | 1 |
| QHC TT Phú Lộc | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 203 |
| QHC TT Phú Lộc | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 592 |
| QHC TT Phú Lộc | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 1 |
| QHC TT Phú Lộc | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 160 |
| QHC TT Phú Lộc | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 33 |
| QHC TT Phú Lộc | Cấp điện | Quy hoạch | Đèn chiếu sáng | Point | 1876 |
| QHC TT Phú Lộc | Cấp điện | Quy hoạch | Mạng lưới điện chiếu sáng | LineString | 18 |
| QHC TT Phú Lộc | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 71 |
| QHC TT Phú Lộc | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 651 |
| QHC TT Phú Lộc | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước | LineString | 480 |
| QHC TT Phú Lộc | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 189 |
| QHC TT Phú Lộc | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 6 |
| QHC TT Phú Lộc | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 94 |
| QHC TT Phú Lộc | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 16 |
| QHC TT Phú Lộc | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 74 |
| QHC TT Phú Lộc | Thông tin liên lạc | Quy hoạch | Trạm thông tin | Point | 41 |
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng sử dụng đất | Polygon | 2863 |
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất (trỏ `projects/qhc-tt-phu-loc-19e96a86/su-dung-dat.json`) | Polygon | 1467 |
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Điểm chức năng | Point | 94 |
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đường ranh giới quy hoạch | LineString | 1 |
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 5 |
| QHC Khe Tre | Giao thông | Quy hoạch | Bó vĩa | LineString | 443 |
| QHC Khe Tre | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 74 |
| QHC Khe Tre | Giao thông | Quy hoạch | Mặt cắt | LineString | 77 |
| QHC Khe Tre | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 136 |
| QHC Khe Tre | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 13 |
| QHC Khe Tre | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 77 |
| QHC Khe Tre | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 12 |
| QHC Khe Tre | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 96 |
| QHC Khe Tre | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 452 |
| QHC Khe Tre | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa | LineString | 60 |
| QHC Khe Tre | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 578 |
| QHC Khe Tre | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 69 |
| QHC Khe Tre | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 33 |
| QHC Khe Tre | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất (trỏ `projects/qhc-khe-tre-4a4803cd/su-dung-dat.json`) | Polygon | 158 |
| QHC Khe Tre | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đánh giá môi trường chiến lược | Point | 5 |
| QHC Khe Tre | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch | LineString | 1 |
| QHC Khe Tre | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 1 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 2 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông | LineString | 45 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Quy hoạch | Bó vỉa | LineString | 282 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 19 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 41 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Quy hoạch | Mặt cắt | LineString | 54 |
| QHC Đô thị mới Vinh Hưng | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 204 |
| QHC Đô thị mới Vinh Hưng | Cấp nước | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 3 |
| QHC Đô thị mới Vinh Hưng | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 278 |
| QHC Đô thị mới Vinh Hưng | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 202 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Hiện trạng | Hiện trạng công trình cấp điện | Point | 14 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 11 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 21 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Quy hoạch | Cột đèn chiếu sáng | Point | 2979 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Quy hoạch | Mạng lưới chiếu sáng | LineString | 141 |
| QHC Đô thị mới Vinh Hưng | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 15 |
| QHC Đô thị mới Vinh Hưng | San nền và thoát nước mưa | Quy hoạch | congTrinhThuyLoiL | LineString | 2190 |
| QHC Đô thị mới Vinh Hưng | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 56 |
| QHC Đô thị mới Vinh Hưng | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước | LineString | 261 |
| QHC Đô thị mới Vinh Hưng | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 64 |
| QHC Đô thị mới Vinh Hưng | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 4 |
| QHC Đô thị mới Vinh Hưng | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 91 |
| QHC Đô thị mới Vinh Hưng | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng hệ thống nghĩa trang | Point | 60 |
| QHC Đô thị mới Vinh Hưng | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 61 |
| QHC Đô thị mới Vinh Hưng | Chất thải rắn và nghĩa trang | Quy hoạch | mangLuoiNghiaTrang | Point | 3 |
| QHC Đô thị mới Vinh Hưng | Thông tin liên lạc | Hiện trạng | Hiện trạng trạm thông tin liên lạc | Point | 6 |
| QHC Đô thị mới Vinh Hưng | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 171 |
| QHC Đô thị mới Vinh Hưng | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin | Point | 25 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng điểm chức năng | Point | 24 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng sử dụng đất | Polygon | 2433 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 101 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất (trỏ `projects/qhc-do-thi-moi-vinh-hung-8899f27b/su-dung-dat.json`) | Polygon | 321 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | dinhViRanhGioi | Point | 30 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đánh giá tổng hợp lựa chọn đất xây dựng | Polygon | 2436 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Điểm chức năng | Point | 22 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Không gian cây xanh | Polygon | 76 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Không gian mặt nước | Polygon | 28 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Phân khu chức năng | Polygon | 4 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch (Dạng đường) | LineString | 1 |
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch (Dạng vùng) | Polygon | 1 |
| QHC Khu công nghiệp Phong Điền | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông | LineString | 1 |
| QHC Khu công nghiệp Phong Điền | Giao thông | Quy hoạch | Bó vỉa | LineString | 666 |
| QHC Khu công nghiệp Phong Điền | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 71 |
| QHC Khu công nghiệp Phong Điền | Giao thông | Quy hoạch | Mặt cắt | LineString | 97 |
| QHC Khu công nghiệp Phong Điền | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 107 |
| QHC Khu công nghiệp Phong Điền | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 3 |
| QHC Khu công nghiệp Phong Điền | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 169 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 7 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 115 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Quy hoạch | Công trình cấp điện dạng vùng | Polygon | 115 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Quy hoạch | Cột đèn chiếu sáng | Point | 1750 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Quy hoạch | Mạng lưới điện chiếu sáng | LineString | 143 |
| QHC Khu công nghiệp Phong Điền | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 134 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 35 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 166 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 37 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước mưa | LineString | 295 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa | LineString | 1258 |
| QHC Khu công nghiệp Phong Điền | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 75 |
| QHC Khu công nghiệp Phong Điền | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 3 |
| QHC Khu công nghiệp Phong Điền | Thoát nước thải | Quy hoạch | Hướng thoát nước thải | LineString | 1 |
| QHC Khu công nghiệp Phong Điền | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 148 |
| QHC Khu công nghiệp Phong Điền | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 1 |
| QHC Khu công nghiệp Phong Điền | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin | Point | 16 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng sử dụng đất | Polygon | 43 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 265 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng | LineString | 32 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 168 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Phân khu chức năng | Polygon | 5 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch A | Polygon | 1 |
| QHC Khu công nghiệp Phong Điền | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch L | LineString | 1 |
| QHC Chân Mây - Lăng Cô | Giao thông | Quy hoạch | Quy hoạch giao thông | Mixed | 773 |

## Khoảng trống

- Bó vỉa QHC trung tâm 1/10.000: lần tải trước bỏ 8 dòng không có hình.
- Bó vỉa QHC Khu công nghiệp Phong Điền: 668 dòng, 2 dòng không có hình, catalog giữ 666.
- Hiện trạng công trình thủy lợi dạng đường, QHC 1/25.000: 28 dòng trên gServer, tất cả thiếu hình.
- QHC đô thị Thừa Thiên Huế 1/25.000, San nền và thoát nước mưa, Hiện trạng: Hiện trạng công trình thủy lợi dạng đường — Mọi dòng không có hình hợp lệ, đã bỏ.
- QHC đô thị Thừa Thiên Huế 1/25.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Ranh giới quy hoạch dạng vùng / dạng đường — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị Huế 2045, Sử dụng đất: đã có `data/qhc2045/dinhhuong.json` (không tải bản thô mapid 21817).
- QHC đô thị Thừa Thiên Huế 1/25.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Sơ đồ tổ chức không gian, kiến trúc cảnh quan — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị Thừa Thiên Huế 1/25.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Đánh giá tổng hợp lựa chọn đất xây dựng — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị trung tâm Thừa Thiên Huế 1/10.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Ranh giới quy hoạch dạng vùng / dạng đường — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị trung tâm, Sử dụng đất: đã có `data/qhc2045/sdd.json`. Phần phân khu, tiểu vùng, điểm chức năng của nhóm này chưa tải.
- QHC đô thị trung tâm Thừa Thiên Huế 1/10.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Sơ đồ tổ chức không gian — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị trung tâm Thừa Thiên Huế 1/10.000, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Công trình ngầm dạng vùng / đường / điểm — Nhóm có trên cây mapid 21817, lô này chưa tải.

Ô không có lớp (ngành × hiện trạng/quy hoạch):

- QHC TT Phú Lộc — Giao thông — Hiện trạng
- QHC TT Phú Lộc — Cấp nước — Hiện trạng
- QHC TT Phú Lộc — Cấp điện — Hiện trạng
- QHC TT Phú Lộc — San nền và thoát nước mưa — Hiện trạng
- QHC TT Phú Lộc — Thoát nước thải — Hiện trạng
- QHC TT Phú Lộc — Chất thải rắn và nghĩa trang — Hiện trạng
- QHC TT Phú Lộc — Thông tin liên lạc — Hiện trạng
- QHC Khe Tre — Giao thông — Hiện trạng
- QHC Khe Tre — Cấp nước — Hiện trạng
- QHC Khe Tre — Cấp điện — Hiện trạng
- QHC Khe Tre — San nền và thoát nước mưa — Hiện trạng
- QHC Khe Tre — Thoát nước thải — Hiện trạng
- QHC Khe Tre — Chất thải rắn và nghĩa trang — Hiện trạng
- QHC Khe Tre — Chất thải rắn và nghĩa trang — Quy hoạch
- QHC Khe Tre — Thông tin liên lạc — Hiện trạng
- QHC Khe Tre — Sử dụng đất, ranh và lớp quy hoạch khác — Hiện trạng
- QHC Đô thị mới Vinh Hưng — San nền và thoát nước mưa — Hiện trạng
- QHC Đô thị mới Vinh Hưng — Thoát nước thải — Hiện trạng
- QHC Khu công nghiệp Phong Điền — Cấp nước — Hiện trạng
- QHC Khu công nghiệp Phong Điền — San nền và thoát nước mưa — Hiện trạng
- QHC Khu công nghiệp Phong Điền — Thoát nước thải — Hiện trạng
- QHC Khu công nghiệp Phong Điền — Chất thải rắn và nghĩa trang — Hiện trạng
- QHC Khu công nghiệp Phong Điền — Thông tin liên lạc — Hiện trạng

## Hiện trạng tạm thời

Ba file `public/data/hien-trang-tam/giao-thong.geojson`, `cap-dien.geojson`, `cap-nuoc.geojson` là lớp hiện trạng toàn thành phố, tạm thời. Nhãn trên tab Hạ tầng: «Hiện trạng (tạm thời, tổng hợp từ các đồ án)». Mỗi đối tượng giữ thuộc tính gốc và thêm `nguon_do_an`, `nguon_ten`, `nguon_mapid`, `nguon_nam`, `nguon_ty_le`, `nguon_lop`, `tam_thoi: true`. Sinh lại bằng `node scripts/build-hien-trang-tam.mjs`. Thay bằng dữ liệu chính thức: ghi đè đúng ba file đó.

Quy tắc chồng lấn: ưu tiên đồ án chi tiết hơn (mẫu số nhỏ hơn; đồ án không ghi tỷ lệ xếp như 1/5.000, không ghi 5000 vào `nguon_ty_le`). Cùng tỷ lệ thì năm phê duyệt mới hơn, rồi `priority`, rồi slug. Điểm trùng trong 100 m cùng nhóm. Đường trùng khi ít nhất 60% điểm mẫu nằm trong 60 m đường đã giữ, cùng nhóm (đường bộ, đường sắt, đường thủy, mặt cắt, năng lượng không xóa lẫn nhau). Cùng một đồ án không tự loại. Vùng không khử trùng. Trong ranh KCN thì bỏ đối tượng của đồ án bị ghi đè, kể cả khi không trùng hình. Không đục cả lớp thô trong khung đồ án chi tiết.

QHC Chân Mây – Lăng Cô (mapid 23935) chỉ có quy hoạch giao thông, file bản vẽ trên GCS `projects/qhc-chan-may-lang-co-a44cfad0/qh-giao-thong.json` (773 đối tượng), không đưa vào lớp tạm. Các ngành khác của đồ án này chưa có.

Số đối tượng giữ lại (đếm theo đồ án nguồn):

| Ngành | Giữ | Đường | Điểm | Bỏ trùng | 1/25.000 | 1/10.000 | Vinh Hưng | KCN | Chưa có hiện trạng |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Giao thông | 280 | 243 | 37 | 39 | 90/129 | 142/142 | 47/47 | 1/1 | Phú Lộc, Khe Tre, Phong Điền, Chân Mây |
| Cấp điện | 286 | 235 | 51 | 18 | 50/68 | 204/204 | 25/25 | 7/7 | Phú Lộc, Khe Tre, Phong Điền, Chân Mây |
| Cấp nước | 632 | 610 | 22 | 194 | 311/505 | 318/318 | 3/3 | — | Phú Lộc, Khe Tre, KCN, Phong Điền, Chân Mây |

Giao thông chưa phủ: Xã A Lưới 5, Xã Phú Vinh, Xã A Lưới 1, Xã Phú Hồ, Xã Nam Đông, Xã A Lưới 3 (15 đối tượng ngoài ranh phường). Cấp điện chưa phủ: Xã Long Quảng, Xã Đan Điền, Xã Khe Tre, Xã Phú Vang, Xã Phú Hồ, Phường Phong Quảng, Xã Lộc An, Xã Nam Đông, Phường Phong Dinh, Xã A Lưới 2, Xã Phú Lộc, Xã Quảng Điền, Xã A Lưới 3. Cấp nước chưa phủ: Xã A Lưới 5, Xã A Lưới 4. Chi tiết: `public/data/hien-trang-tam/coverage.json`.

## Lưu trữ

File trên 5 MB nằm trên GCS `hue-infra-data-us/chuyen-nganh/v1/`, `Cache-Control: public, max-age=31536000, immutable`. Không dựng pmtiles (chưa có tippecanoe; lớp lớn là polygon sử dụng đất). Hai object sử dụng đất mapid 21817 vẫn nằm trên bucket, manifest không trỏ tới chúng.
- https://storage.googleapis.com/hue-infra-data-us/chuyen-nganh/v1/qhc-tt-phu-loc-19e96a86/sdd/hien-trang/hien-trang-su-dung-dat.geojson (geojson 5499576, zip 1117459)
- https://storage.googleapis.com/hue-infra-data-us/chuyen-nganh/v1/qhc-do-thi-moi-vinh-hung-8899f27b/sdd/hien-trang/hien-trang-su-dung-dat.geojson (geojson 5373719, zip 1395528)
- https://storage.googleapis.com/hue-infra-data-us/chuyen-nganh/v1/qhc-do-thi-moi-vinh-hung-8899f27b/sdd/quy-hoach/danh-gia-tong-hop-lua-chon-dat-xay-dung.geojson (geojson 5455563, zip 1353638)

Worker chỉ phục vụ `public/`. `scripts/stage-chuyen-nganh.mjs` symlink từng thư mục đồ án từ `data/chuyen-nganh/` sang `public/data/chuyen-nganh/` (không nhân bản trong git) và bung thành bản sao lúc deploy.
