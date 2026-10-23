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
| qhct-tdc-phu-my-khu-c-7bfa4d26 | QHCT TĐC Phú Mỹ (Khu C) | QHCT | 20642 | 3 |
| qhct-tdc-thuy-van-giai-doan-2-khu-e-33b92316 | QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | QHCT | 20644 | 3 |
| qhct-trong-rung-ngap-man-ru-cha-c09cda81 | QHCT Trồng rừng ngập mặn Rú Chá | QHCT | 23967 | 3 |
| qhct-khu-nha-o-an-dong-e03fe6e1 | QHCT Khu nhà ở An Đông | QHCT | 20601 | 3 |
| qhct-khu-dich-vu-bai-tam-thuan-an-51628c24 | QHCT Khu dịch vụ bãi tắm Thuận An | QHCT | 24981 | 3 |
| qhct-khu-dan-cu-va-tai-dinh-cu-duong-to-huu-b9e0890d | QHCT Khu dân cư và tái định cư đường Tố Hữu | QHCT | 22861 | 3 |
| qhct-nghia-trang-nhan-dan-phia-nam-7bbdf92c | QHCT Nghĩa trang Nhân dân phía Nam | QHCT | 23953 | 3 |
| qhct-tram-trung-chuyen-dieu-ap-phu-bai-36fb0207 | QHCT Trạm trung chuyển điều áp Phú Bài | QHCT | 23946 | 3 |
| qhct-khu-do-thi-sinh-thai-thanh-thuy-93bfd064 | QHCT Khu đô thị sinh thái Thanh Thủy | QHCT | 23954 | 3 |

QHC Khu công nghiệp Phong Điền nằm trong QHC đô thị Phong Điền. Trong ranh KCN, KCN ghi đè Phong Điền (`overrides`, `overrideArea: ranh KCN`, priority 2 > 1). Không cắt dữ liệu.

Phạm vi Hành chính gắn trên đồ án (`area` trong `schemes.json`), không suy xã nằm trong đô thị. Phú Lộc: `xa:phu-loc`. Khe Tre: `dothi:khe-tre` (`catalogScheme` `qhc-khe-tre`). Vinh Hưng: `xa:vinh-loc`. KCN Phong Điền: `dothi:phong-dien` (không gộp vào đồ án Phong Điền). Chân Mây – Lăng Cô: `dothi:chan-may` (`catalogScheme` `qhc-chan-may`). Hai đồ án mapid 21817 giữ phạm vi theo tỷ lệ (1/25.000 toàn thành phố, 1/10.000 đô thị trung tâm). Tab Hạ tầng nhóm lớp theo từng đồ án trong ngành; đồ án địa phương hiện ở cả tab QHC 1/25.000 và 1/10.000, rồi bị lọc theo phạm vi đang chọn.

QHCT 1/500 nằm trong QHPK hoặc QHC cha khi xác định được (`parent`, `overrides`, `overrideArea: ranh QHCT`, priority 3). Trong ranh QHCT, QHCT được ưu tiên hơn đồ án cha. Không cắt hình cha.

Lô đất hạ tầng (ghép danh sách hạ tầng trên Sheet): luôn ghi lô QHCT và ghép với dòng Sheet — sát ranh thửa thật hơn. Lô QHPK đã ghép trước đó chỉ gỡ ghép (đổi mã INFRA thành DXF, giữ polygon), không xóa và không từ chối lô QHCT. Mỗi lần gỡ ghi `docs/qhct-unpair.json` (mã lô QHPK, đồ án, mã lô QHCT, mã dòng hạ tầng). Chỉ mục ghép nằm ở khóa `pairings` của `public/data/su-dung-dat-index.json` (cùng file với chỉ mục lớp sử dụng đất, không ghi đè `layers`).

Metadata bản đồ gServer không có số quyết định. Số dưới đây lấy từ thuộc tính lớp ranh (ngày dạng M/D/YYYY của shapefile, đã đổi sang ISO). QHC TT Phú Lộc: nhiệm vụ 3134/QĐ-UBND ngày 2019-12-16, phê duyệt 1101/QĐ-UBND ngày 2020-04-17 (UBND tỉnh; 1/5 vùng ranh có giá trị). QHC Khe Tre: nhiệm vụ 1022/QĐ-UBND ngày 2016-05-16, phê duyệt 688/QĐ-UBND ngày 2020-03-13. QHC Đô thị mới Vinh Hưng: phê duyệt 193/QĐ-UBND ngày 2025-01-21 (UBND thành phố Huế). QHC Khu công nghiệp Phong Điền: trường có trên lớp ranh nhưng để trống. Hai đồ án mapid 21817: lô này chưa có lớp ranh quy hoạch.

## Catalog

| Đồ án | Ngành | Trạng thái | Lớp | Kiểu | Số đối tượng |
|---|---|---|---|---|---:|
| QHC đô thị TTHuế 2045 (Trung tâm) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | QH sử dụng đất (trung tâm) | Polygon | undefined |
| QHC đô thị Huế 2045 | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Sơ đồ phát triển không gian TP | Polygon | undefined |
| QHC đô thị Huế 2045 | Giao thông | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 24 |
| QHC đô thị Huế 2045 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 98 |
| QHC đô thị Huế 2045 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| QHC đô thị Huế 2045 | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 6 |
| QHC đô thị Huế 2045 | Giao thông | Quy hoạch | Cầu giao thông dạng đường | LineString | 14 |
| QHC đô thị Huế 2045 | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 125 |
| QHC đô thị Huế 2045 | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 180 |
| QHC đô thị Huế 2045 | Giao thông | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 10 |
| QHC đô thị Huế 2045 | Giao thông | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 14 |
| QHC đô thị Huế 2045 | Cấp nước | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 20 |
| QHC đô thị Huế 2045 | Cấp nước | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 485 |
| QHC đô thị Huế 2045 | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 52 |
| QHC đô thị Huế 2045 | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 904 |
| QHC đô thị Huế 2045 | Cấp điện | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 18 |
| QHC đô thị Huế 2045 | Cấp điện | Hiện trạng | Hiện trạng công trình năng lượng | Point | 15 |
| QHC đô thị Huế 2045 | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 35 |
| QHC đô thị Huế 2045 | Cấp điện | Quy hoạch | Công trình cấp điện dạng điểm | Point | 51 |
| QHC đô thị Huế 2045 | Cấp điện | Quy hoạch | Công trình năng lượng | Point | 28 |
| QHC đô thị Huế 2045 | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 74 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 17 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng phân lưu thoát nước dạng đường | LineString | 8 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Hiện trạng | Hiện trạng phân lưu thoát nước dạng vùng | Polygon | 8 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 10 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 26 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 49 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 65 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 32 |
| QHC đô thị Huế 2045 | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng vùng | Polygon | 8 |
| QHC đô thị Huế 2045 | Thoát nước thải | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 10 |
| QHC đô thị Huế 2045 | Thoát nước thải | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 38 |
| QHC đô thị Huế 2045 | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 476 |
| QHC đô thị Huế 2045 | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 597 |
| QHC đô thị Huế 2045 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới chất thải rắn | Point | 7 |
| QHC đô thị Huế 2045 | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 65 |
| QHC đô thị Huế 2045 | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 17 |
| QHC đô thị Huế 2045 | Chất thải rắn và nghĩa trang | Quy hoạch | Mạng lưới nghĩa trang | Point | 61 |
| QHC đô thị Huế 2045 | Chất thải rắn và nghĩa trang | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| QHC đô thị Huế 2045 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| QHC đô thị Huế 2045 | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 27 |
| QHC đô thị Huế 2045 | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 42 |
| QHC đô thị Huế 2045 | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 50 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Hiện trạng | Hiện trạng công trình đầu mối giao thông | Point | 18 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường bộ | LineString | 53 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường sắt | LineString | 1 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Hiện trạng | Hiện trạng mạng lưới giao thông đường thủy | LineString | 7 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Hiện trạng | Hiện trạng mặt cắt | LineString | 63 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Bó vỉa | LineString | 1180 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Cầu giao thông dạng đường | LineString | 449 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 58 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ | LineString | 802 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Mạng lưới giao thông đường sắt | LineString | 13 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Mạng lưới giao thông đường thủy | LineString | 6 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Mặt cắt | LineString | 564 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 76 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp nước | Hiện trạng | Hiện trạng công trình đầu mối cấp nước | Point | 9 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp nước | Hiện trạng | Hiện trạng mạng lưới cấp nước | LineString | 309 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 15 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 598 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp điện | Hiện trạng | Hiện trạng công trình cấp điện dạng điểm | Point | 9 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp điện | Hiện trạng | Hiện trạng mạng lưới phân phối điện | LineString | 195 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp điện | Quy hoạch | Công trình cấp điện dạng điểm | Point | 21 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp điện | Quy hoạch | Công trình năng lượng | Point | 4 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 112 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng điểm | Point | 5 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình thủy lợi dạng đường | LineString | 17 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Hiện trạng | Hiện trạng công trình tiêu thoát nước | Point | 13 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Hiện trạng | Hiện trạng hướng thoát nước | LineString | 6 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Hiện trạng | Hiện trạng mạng lưới thoát nước dạng đường | LineString | 38 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng điểm | Point | 6 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Công trình thủy lợi dạng đường | LineString | 28 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 874 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Điểm độ cao thoát nước | Point | 363 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 555 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước dạng đường | LineString | 1533 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Phân vùng lưu vực dạng đường | LineString | 3 |
| QHC đô thị TTHuế 2045 (Trung tâm) | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 363 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thoát nước thải | Hiện trạng | Hiện trạng công trình xử lý nước thải dạng điểm | Point | 17 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thoát nước thải | Hiện trạng | Hiện trạng mạng lưới thoát nước thải | LineString | 54 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải dạng điểm | Point | 440 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thoát nước thải | Quy hoạch | Điểm độ cao thoát nước thải | Point | 276 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 599 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng điểm xử lý chất thải rắn | Point | 4 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng mạng lưới nghĩa trang | Point | 17 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Hiện trạng | Hiện trạng phân khu chất thải rắn | Polygon | 1 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 5 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Quy hoạch | Mạng lưới nghĩa trang | Point | 30 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Chất thải rắn và nghĩa trang | Quy hoạch | Phân khu chất thải rắn | Polygon | 3 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới thông tin liên lạc | LineString | 13 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thông tin liên lạc | Hiện trạng | Hiện trạng mạng lưới trạm thông tin dạng điểm | Point | 12 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 183 |
| QHC đô thị TTHuế 2045 (Trung tâm) | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin dạng điểm | Point | 88 |
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
| QHC TT Phú Lộc | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 1467 |
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
| QHC Khe Tre | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 158 |
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
| QHC Đô thị mới Vinh Hưng | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 321 |
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
| QHCT TĐC Phú Mỹ (Khu C) | Giao thông | Quy hoạch | Bó vỉa | LineString | 175 |
| QHCT TĐC Phú Mỹ (Khu C) | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 7 |
| QHCT TĐC Phú Mỹ (Khu C) | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 37 |
| QHCT TĐC Phú Mỹ (Khu C) | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 1 |
| QHCT TĐC Phú Mỹ (Khu C) | Cấp nước | Quy hoạch | Điểm tính toán cấp nước | Point | 17 |
| QHCT TĐC Phú Mỹ (Khu C) | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 12 |
| QHCT TĐC Phú Mỹ (Khu C) | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước | Point | 67 |
| QHCT TĐC Phú Mỹ (Khu C) | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 5 |
| QHCT TĐC Phú Mỹ (Khu C) | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước | LineString | 72 |
| QHCT TĐC Phú Mỹ (Khu C) | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 12 |
| QHCT TĐC Phú Mỹ (Khu C) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 30 |
| QHCT TĐC Phú Mỹ (Khu C) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng | LineString | 32 |
| QHCT TĐC Phú Mỹ (Khu C) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 78 |
| QHCT TĐC Phú Mỹ (Khu C) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đường ranh giới quy hoạch | LineString | 2 |
| QHCT TĐC Phú Mỹ (Khu C) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 2 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Giao thông | Quy hoạch | Bó vỉa | LineString | 243 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 44 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Giao thông | Quy hoạch | Mặt cắt | LineString | 26 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 35 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Cấp nước | Quy hoạch | Công tình đầu mối cấp nước | Point | 4 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 186 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 59 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 52 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 147 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 13 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Định vị ranh giới | Point | 26 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch | LineString | 1 |
| QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 1 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Bó vĩa dải phân cách_L | LineString | 131 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Công trình giao thông_L | LineString | 10 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Điểm tọa độ tim đường chuyển hướng tim đường_P | Point | 23 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_A | Polygon | 63 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_L | LineString | 34 |
| QHCT Trồng rừng ngập mặn Rú Chá | Giao thông | Quy hoạch | Mặt cắt ngang_L | LineString | 126 |
| QHCT Trồng rừng ngập mặn Rú Chá | Cấp nước | Quy hoạch | Mạng lưới cấp nước_L | LineString | 13 |
| QHCT Trồng rừng ngập mặn Rú Chá | Cấp điện | Quy hoạch | Công trình cấp điện_P | Point | 5 |
| QHCT Trồng rừng ngập mặn Rú Chá | Cấp điện | Quy hoạch | Công trình chiếu sáng_P | Point | 25 |
| QHCT Trồng rừng ngập mặn Rú Chá | Cấp điện | Quy hoạch | Mạng lưới chiếu sáng_L | LineString | 6 |
| QHCT Trồng rừng ngập mặn Rú Chá | Cấp điện | Quy hoạch | Mạng lưới phân phối điện_L | LineString | 5 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Hiện trạng | Công trình chuẩn bị kỹ thuật_P | Point | 3 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Quy hoạch | Cao độ nền_P | Point | 23 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_P | Point | 14 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Quy hoạch | Đồng mức thiết kế_L | LineString | 60 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước mưa_L | LineString | 4 |
| QHCT Trồng rừng ngập mặn Rú Chá | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa_L | LineString | 5 |
| QHCT Trồng rừng ngập mặn Rú Chá | Thoát nước thải | Quy hoạch | Công trình thoát mước thải vsmt_P | Point | 7 |
| QHCT Trồng rừng ngập mặn Rú Chá | Thoát nước thải | Quy hoạch | Hướng thoát nước thải_L | LineString | 2 |
| QHCT Trồng rừng ngập mặn Rú Chá | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải_L | LineString | 3 |
| QHCT Trồng rừng ngập mặn Rú Chá | Thông tin liên lạc | Quy hoạch | Công trình thông tin_P | Point | 8 |
| QHCT Trồng rừng ngập mặn Rú Chá | Thông tin liên lạc | Quy hoạch | Mạng lưới cáp thông tin_L | LineString | 4 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Chức năng sử dụng đất_A | Polygon | 114 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất_A | Polygon | 117 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_A | Polygon | 1 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_L | LineString | 1 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_P | Point | 16 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới nghiên cứu quy hoạch_L | LineString | 1 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_A | Polygon | 1 |
| QHCT Trồng rừng ngập mặn Rú Chá | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_L | LineString | 1 |
| QHCT Khu nhà ở An Đông | Giao thông | Quy hoạch | Bó vỉa | LineString | 309 |
| QHCT Khu nhà ở An Đông | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 51 |
| QHCT Khu nhà ở An Đông | Giao thông | Quy hoạch | Mặt cắt | LineString | 58 |
| QHCT Khu nhà ở An Đông | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 2 |
| QHCT Khu nhà ở An Đông | Cấp điện | Quy hoạch | Công trình cấp điện | Polygon | 65 |
| QHCT Khu nhà ở An Đông | Cấp điện | Quy hoạch | Cột đèn chiếu sáng | Point | 105 |
| QHCT Khu nhà ở An Đông | Cấp điện | Quy hoạch | Điểm công trình cấp điện | Point | 3 |
| QHCT Khu nhà ở An Đông | Cấp điện | Quy hoạch | Mạng lưới điện chiếu sáng | LineString | 54 |
| QHCT Khu nhà ở An Đông | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 45 |
| QHCT Khu nhà ở An Đông | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 61 |
| QHCT Khu nhà ở An Đông | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 54 |
| QHCT Khu nhà ở An Đông | San nền và thoát nước mưa | Quy hoạch | Phân lô san nền | Polygon | 36 |
| QHCT Khu nhà ở An Đông | San nền và thoát nước mưa | Quy hoạch | Phân ô san nền | Polygon | 34 |
| QHCT Khu nhà ở An Đông | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 32 |
| QHCT Khu nhà ở An Đông | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 181 |
| QHCT Khu nhà ở An Đông | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 47 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 74 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng | LineString | 24 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 68 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Cơ cấu phân lô | Polygon | 310 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Định vị ranh giới | Point | 38 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đường ranh giới quy hoạch | LineString | 1 |
| QHCT Khu nhà ở An Đông | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch | Polygon | 1 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Bó vĩa dải phân cách_L | LineString | 115 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Công trình giao thông_P | Point | 16 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Điểm tọa độ tim đường chuyển hướng tim đường_P | Point | 11 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_A | Polygon | 36 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_L | LineString | 25 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Giao thông | Quy hoạch | Mặt cắt ngang_L | LineString | 24 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp nước | Quy hoạch | Công trình cấp nước PCCC_P | Point | 16 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp nước | Quy hoạch | Mạng lưới cấp nước_L | LineString | 31 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp điện | Quy hoạch | Công trình cấp điện_P | Point | 1 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp điện | Quy hoạch | Công trình chiếu sáng_P | Point | 93 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp điện | Quy hoạch | Mạng lưới chiếu sáng_L | LineString | 9 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Cấp điện | Quy hoạch | Mạng lưới phân phối điện_L | LineString | 17 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Cao độ nền_P | Point | 10 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_L | LineString | 53 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_P | Point | 21 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Đồng mức thiết kế_L | LineString | 21 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước mưa_L | LineString | 32 |
| QHCT Khu dịch vụ bãi tắm Thuận An | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa_L | LineString | 19 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Thoát nước thải | Quy hoạch | Công trình thoát mước thải vsmt_P | Point | 2 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Thoát nước thải | Quy hoạch | Hướng thoát nước thải_L | LineString | 7 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải_L | LineString | 7 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Thông tin liên lạc | Quy hoạch | Công trình thông tin_P | Point | 19 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Thông tin liên lạc | Quy hoạch | Mạng lưới cáp thông tin_L | LineString | 40 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Chức năng sử dụng đất_A | Polygon | 69 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ_L | LineString | 9 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng_L | LineString | 13 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất_A | Polygon | 26 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_A | Polygon | 1 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_L | LineString | 1 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_P | Point | 38 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_A | Polygon | 1 |
| QHCT Khu dịch vụ bãi tắm Thuận An | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_L | LineString | 1 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Giao thông | Quy hoạch | Bó vỉa | LineString | 6709 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 47 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 308 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Giao thông | Quy hoạch | Mặt cắt | LineString | 148 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 553 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 38 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 219 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 51 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp điện | Quy hoạch | Cột đèn chiếu sáng | Point | 130 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp điện | Quy hoạch | Mạng lưới điện chiếu sáng | LineString | 20 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 180 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước dạng điểm | Point | 248 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 58 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa | LineString | 869 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | San nền và thoát nước mưa | Quy hoạch | Phân lô san nền | Polygon | 9 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 504 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Thoát nước thải | Quy hoạch | Công trình xử lý nước thải | Point | 350 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải | LineString | 33 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 191 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin | Point | 64 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng sử dụng đất | Polygon | 46 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng | LineString | 303 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 814 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Công trình xây dựng ngầm | Polygon | 40 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Cơ cấu phân lô | Polygon | 206 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đường ranh giới quy hoạch | LineString | 1 |
| QHCT Khu dân cư và tái định cư đường Tố Hữu | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Hiện trạng | Mạng lưới giao thông đường bộ_A | Polygon | 4 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Hiện trạng | Mạng lưới giao thông đường bộ_L | LineString | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Bó vĩa dải phân cách_L | LineString | 101 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Công trình giao thông_L | LineString | 11 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Điểm tọa độ tim đường chuyển hướng tim đường_P | Point | 57 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_A | Polygon | 45 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_L | LineString | 41 |
| QHCT Nghĩa trang Nhân dân phía Nam | Giao thông | Quy hoạch | Mặt cắt ngang_L | LineString | 435 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp nước | Hiện trạng | Mạng lưới cấp nước_L | LineString | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp nước | Quy hoạch | Công trình cấp nước PCCC_P | Point | 84 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp nước | Quy hoạch | Mạng lưới cấp nước_L | LineString | 10 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp điện | Hiện trạng | Mạng lưới phân phối điện_L | LineString | 2 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp điện | Quy hoạch | Công trình cấp điện_P | Point | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp điện | Quy hoạch | Công trình chiếu sáng_P | Point | 262 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp điện | Quy hoạch | Mạng lưới chiếu sáng_L | LineString | 30 |
| QHCT Nghĩa trang Nhân dân phía Nam | Cấp điện | Quy hoạch | Mạng lưới phân phối điện_L | LineString | 4 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Cao độ nền_P | Point | 58 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_L | LineString | 930 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_P | Point | 25 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Đồng mức thiết kế_L | LineString | 147 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Hướng độ dốc lòng đường_L | LineString | 74 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước mưa_L | LineString | 88 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa_L | LineString | 129 |
| QHCT Nghĩa trang Nhân dân phía Nam | San nền và thoát nước mưa | Quy hoạch | Phân vùng san nền_A | Polygon | 27 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thoát nước thải | Quy hoạch | Công trình thoát mước thải vsmt_P | Point | 60 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thoát nước thải | Quy hoạch | Hướng thoát nước thải_L | LineString | 15 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải_L | LineString | 33 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thông tin liên lạc | Hiện trạng | Mạng lưới cáp thông tin_L | LineString | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thông tin liên lạc | Quy hoạch | Công trình thông tin_P | Point | 2 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thông tin liên lạc | Quy hoạch | Mạng lưới cáp thông tin_L | LineString | 2 |
| QHCT Nghĩa trang Nhân dân phía Nam | Thông tin liên lạc | Quy hoạch | Thông tin san nền_P | Point | 28 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Chức năng sử dụng đất_A | Polygon | 22 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ_L | LineString | 16 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng_L | LineString | 16 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất_A | Polygon | 89 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_A | Polygon | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_L | LineString | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_P | Point | 23 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_A | Polygon | 1 |
| QHCT Nghĩa trang Nhân dân phía Nam | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_L | LineString | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Giao thông | Quy hoạch | Bó vỉa | LineString | 25 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Giao thông | Quy hoạch | Công trình đầu mối giao thông | Point | 12 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Giao thông | Quy hoạch | Mạng lưới giao thông | LineString | 6 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Giao thông | Quy hoạch | Mặt cắt | LineString | 70 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Giao thông | Quy hoạch | Mặt đường bộ | Polygon | 9 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp nước | Quy hoạch | Công trình đầu mối cấp nước | Point | 9 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp nước | Quy hoạch | Mạng lưới cấp nước | LineString | 32 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp điện | Quy hoạch | Công trình cấp điện | Point | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp điện | Quy hoạch | Cột đèn chiếu sáng | Point | 31 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp điện | Quy hoạch | Mạng lưới điện chiếu sáng | LineString | 11 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Cấp điện | Quy hoạch | Mạng lưới phân phối điện | LineString | 2 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước dạng điểm | Point | 29 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Công trình tiêu thoát nước dạng đường | LineString | 9 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Điểm độ cao thoát nước | Point | 10 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Đường đồng mức thiết kế | LineString | 23 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Hướng thoát nước | LineString | 41 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước | LineString | 26 |
| QHCT Trạm trung chuyển điều áp Phú Bài | San nền và thoát nước mưa | Quy hoạch | Quy hoạch chiều cao | Point | 12 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Chất thải rắn và nghĩa trang | Quy hoạch | Điểm xử lý chất thải rắn | Point | 7 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Thông tin liên lạc | Quy hoạch | Mạng lưới thông tin liên lạc | LineString | 2 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Thông tin liên lạc | Quy hoạch | Mạng lưới trạm thông tin | Point | 2 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Định vị ranh giới hiện trạng | Point | 6 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Hiện trạng sử dụng đất | Polygon | 16 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Ranh giới hiện trạng dạng đường | LineString | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Ranh giới hiện trạng dạng vùng | Polygon | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ | LineString | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng | LineString | 4 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất | Polygon | 15 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Định vị ranh giới | Point | 8 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Đường ranh giới quy hoạch | LineString | 1 |
| QHCT Trạm trung chuyển điều áp Phú Bài | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Vùng ranh giới quy hoạch | Polygon | 1 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Bán kính bó vĩa, bán kính tim đường_P | Point | 142 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Bó vĩa dải phân cách_L | LineString | 101 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Công trình giao thông_L | LineString | 25 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Điểm tọa độ tim đường chuyển hướng tim đường_P | Point | 71 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_A | Polygon | 51 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Mạng lưới giao thông đường bộ_L | LineString | 78 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Giao thông | Quy hoạch | Mặt cắt ngang_L | LineString | 57 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp nước | Quy hoạch | Công trình cấp nước PCCC_P | Point | 100 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp nước | Quy hoạch | Điểm đấu nối_P | Point | 116 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp nước | Quy hoạch | Mạng lưới cấp nước_L | LineString | 97 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp điện | Quy hoạch | Công trình cấp điện_P | Point | 208 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp điện | Quy hoạch | Công trình chiếu sáng_P | Point | 360 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp điện | Quy hoạch | Mạng lưới chiếu sáng_L | LineString | 35 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Cấp điện | Quy hoạch | Mạng lưới phân phối điện_L | LineString | 130 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Cao độ cống thoát nước mưa_P | Point | 98 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Cao độ nền_P | Point | 67 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_L | LineString | 3 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Công trình chuẩn bị kỹ thuật_P | Point | 533 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Đồng mức thiết kế_L | LineString | 154 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Mạng lưới thoát nước mưa_L | LineString | 272 |
| QHCT Khu đô thị sinh thái Thanh Thủy | San nền và thoát nước mưa | Quy hoạch | Phân vùng san nền_A | Polygon | 38 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Thoát nước thải | Quy hoạch | Cao độ cống thoát nước thải_P | Point | 62 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Thoát nước thải | Quy hoạch | Công trình thoát mước thải vsmt_P | Point | 345 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Thoát nước thải | Quy hoạch | Mạng lưới thoát nước thải_L | LineString | 64 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Thông tin liên lạc | Quy hoạch | Công trình thông tin_P | Point | 420 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Thông tin liên lạc | Quy hoạch | Mạng lưới cáp thông tin_L | LineString | 51 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Hiện trạng | Chức năng sử dụng đất_A | Polygon | 55 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới đường đỏ_L | LineString | 44 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chỉ giới xây dựng_L | LineString | 71 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Chức năng sử dụng đất_A | Polygon | 193 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Công trình ngầm_A | Polygon | 32 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_A | Polygon | 1 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Mốc giới quy hoạch_P | Point | 14 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Phân ô quy hoạch_A | Polygon | 934 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_A | Polygon | 1 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_A | Polygon | 1 |
| QHCT Khu đô thị sinh thái Thanh Thủy | Sử dụng đất, ranh và lớp quy hoạch khác | Quy hoạch | Ranh giới quy hoạch_L | LineString | 1 |

## Khoảng trống

- Bó vỉa QHC trung tâm 1/10.000: lần tải trước bỏ 8 dòng không có hình.
- Bó vỉa QHC Khu công nghiệp Phong Điền: 668 dòng, 2 dòng không có hình, catalog giữ 666.
- Hiện trạng công trình thủy lợi dạng đường, QHC 1/25.000: 28 dòng trên gServer, tất cả thiếu hình.
- QHC đô thị Huế 2045, San nền và thoát nước mưa, Hiện trạng: Hiện trạng công trình thủy lợi dạng đường — Mọi dòng không có hình hợp lệ, đã bỏ.
- QHC đô thị Huế 2045, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Sơ đồ phát triển không gian TP — Đã có lớp sử dụng đất data/qhc2045/dinhhuong.json.
- QHC đô thị TTHuế 2045 (Trung tâm), Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: QH sử dụng đất (trung tâm) — Đã có lớp sử dụng đất data/qhc2045/sdd.json.
- QHC đô thị Huế 2045, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Ranh giới quy hoạch dạng vùng / dạng đường — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị Huế 2045, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Sơ đồ tổ chức không gian, kiến trúc cảnh quan — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị Huế 2045, Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Đánh giá tổng hợp lựa chọn đất xây dựng — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị TTHuế 2045 (Trung tâm), Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Ranh giới quy hoạch dạng vùng / dạng đường — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị TTHuế 2045 (Trung tâm), Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Chức năng sử dụng đất, phân khu, tiểu vùng, điểm chức năng — Phần sử dụng đất đã có tại data/qhc2045/sdd.json. Phần còn lại của nhóm chưa tải..
- QHC đô thị TTHuế 2045 (Trung tâm), Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Sơ đồ tổ chức không gian — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHC đô thị TTHuế 2045 (Trung tâm), Sử dụng đất, ranh và lớp quy hoạch khác, Quy hoạch: Công trình ngầm dạng vùng / đường / điểm — Nhóm có trên cây mapid 21817, lô này chưa tải.
- QHCT Nghĩa trang Nhân dân phía Nam, Thông tin liên lạc, Quy hoạch: Thông tin san nền_P — Bỏ 1 đối tượng có tọa độ ngoài vùng Huế.
- QHCT Khu dịch vụ bãi tắm Thuận An, San nền và thoát nước mưa, Quy hoạch: Hướng thoát nước mưa_L — Bỏ 11 đối tượng có tọa độ ngoài vùng Huế.

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
- QHCT TĐC Phú Mỹ (Khu C) — Giao thông — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Cấp nước — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Cấp điện — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Cấp điện — Quy hoạch
- QHCT TĐC Phú Mỹ (Khu C) — San nền và thoát nước mưa — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Thoát nước thải — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Thoát nước thải — Quy hoạch
- QHCT TĐC Phú Mỹ (Khu C) — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT TĐC Phú Mỹ (Khu C) — Thông tin liên lạc — Hiện trạng
- QHCT TĐC Phú Mỹ (Khu C) — Thông tin liên lạc — Quy hoạch
- QHCT TĐC Phú Mỹ (Khu C) — Sử dụng đất, ranh và lớp quy hoạch khác — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Giao thông — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Cấp nước — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Cấp điện — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Cấp điện — Quy hoạch
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — San nền và thoát nước mưa — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Thoát nước thải — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Thoát nước thải — Quy hoạch
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Thông tin liên lạc — Hiện trạng
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Thông tin liên lạc — Quy hoạch
- QHCT TĐC Thủy Vân giai đoạn 2 (Khu E) — Sử dụng đất, ranh và lớp quy hoạch khác — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Giao thông — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Cấp nước — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Cấp điện — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Thoát nước thải — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Trồng rừng ngập mặn Rú Chá — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Trồng rừng ngập mặn Rú Chá — Thông tin liên lạc — Hiện trạng
- QHCT Khu nhà ở An Đông — Giao thông — Hiện trạng
- QHCT Khu nhà ở An Đông — Cấp nước — Hiện trạng
- QHCT Khu nhà ở An Đông — Cấp nước — Quy hoạch
- QHCT Khu nhà ở An Đông — Cấp điện — Hiện trạng
- QHCT Khu nhà ở An Đông — San nền và thoát nước mưa — Hiện trạng
- QHCT Khu nhà ở An Đông — Thoát nước thải — Hiện trạng
- QHCT Khu nhà ở An Đông — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Khu nhà ở An Đông — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Khu nhà ở An Đông — Thông tin liên lạc — Hiện trạng
- QHCT Khu nhà ở An Đông — Thông tin liên lạc — Quy hoạch
- QHCT Khu nhà ở An Đông — Sử dụng đất, ranh và lớp quy hoạch khác — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Giao thông — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Cấp nước — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Cấp điện — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — San nền và thoát nước mưa — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Thoát nước thải — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Khu dịch vụ bãi tắm Thuận An — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Khu dịch vụ bãi tắm Thuận An — Thông tin liên lạc — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Giao thông — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Cấp nước — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Cấp điện — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — San nền và thoát nước mưa — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Thoát nước thải — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Khu dân cư và tái định cư đường Tố Hữu — Thông tin liên lạc — Hiện trạng
- QHCT Nghĩa trang Nhân dân phía Nam — San nền và thoát nước mưa — Hiện trạng
- QHCT Nghĩa trang Nhân dân phía Nam — Thoát nước thải — Hiện trạng
- QHCT Nghĩa trang Nhân dân phía Nam — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Nghĩa trang Nhân dân phía Nam — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Trạm trung chuyển điều áp Phú Bài — Giao thông — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — Cấp nước — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — Cấp điện — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — San nền và thoát nước mưa — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — Thoát nước thải — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — Thoát nước thải — Quy hoạch
- QHCT Trạm trung chuyển điều áp Phú Bài — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Trạm trung chuyển điều áp Phú Bài — Thông tin liên lạc — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Giao thông — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Cấp nước — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Cấp điện — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — San nền và thoát nước mưa — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Thoát nước thải — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Chất thải rắn và nghĩa trang — Hiện trạng
- QHCT Khu đô thị sinh thái Thanh Thủy — Chất thải rắn và nghĩa trang — Quy hoạch
- QHCT Khu đô thị sinh thái Thanh Thủy — Thông tin liên lạc — Hiện trạng

## Hiện trạng tạm thời

Ba file `public/data/hien-trang-tam/giao-thong.geojson`, `cap-dien.geojson`, `cap-nuoc.geojson` là lớp hiện trạng toàn thành phố, tạm thời. Nhãn trên tab Hạ tầng: «Hiện trạng (tạm thời, tổng hợp từ các đồ án)». Mỗi đối tượng giữ thuộc tính gốc và thêm `nguon_do_an`, `nguon_ten`, `nguon_mapid`, `nguon_nam`, `nguon_ty_le`, `nguon_lop`, `tam_thoi: true`. Sinh lại bằng `node scripts/build-hien-trang-tam.mjs`. Thay bằng dữ liệu chính thức: ghi đè đúng ba file đó.

Quy tắc chồng lấn: ưu tiên đồ án chi tiết hơn (mẫu số nhỏ hơn; đồ án không ghi tỷ lệ xếp như 1/5.000, không ghi 5000 vào `nguon_ty_le`). Cùng tỷ lệ thì năm phê duyệt mới hơn, rồi `priority`, rồi slug. Điểm trùng trong 100 m cùng nhóm. Đường trùng khi ít nhất 60% điểm mẫu nằm trong 60 m đường đã giữ, cùng nhóm (đường bộ, đường sắt, đường thủy, mặt cắt, năng lượng không xóa lẫn nhau). Cùng một đồ án không tự loại. Vùng không khử trùng. Trong ranh KCN thì bỏ đối tượng của đồ án bị ghi đè, kể cả khi không trùng hình. Không đục cả lớp thô trong khung đồ án chi tiết.

QHC Chân Mây – Lăng Cô (mapid 23935) chỉ có quy hoạch giao thông, file bản vẽ trên GCS `projects/qhc-chan-may-lang-co-a44cfad0/qh-giao-thong.json` (773 đối tượng), không đưa vào lớp tạm. Các ngành khác của đồ án này chưa có. Số liệu phủ: `public/data/hien-trang-tam/coverage.json`.

## Lưu trữ

Từng file GeoJSON và zip đều dưới 5 MB, nằm trong git. Không đẩy file lớp lên GCS, không dựng pmtiles. Đồ án chưa có trong `projects/index.json` được thêm dạng mục danh mục (không có ranh lô).

Worker chỉ phục vụ `public/`. `scripts/stage-chuyen-nganh.mjs` symlink từng thư mục đồ án từ `data/chuyen-nganh/` sang `public/data/chuyen-nganh/` (không nhân bản trong git) và bung thành bản sao lúc deploy.
