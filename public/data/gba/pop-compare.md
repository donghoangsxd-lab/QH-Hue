# So sánh phân bổ dân số: pixel raster và nhà ở GBA

Thí nghiệm, chưa thay công thức đang chạy trên bản đồ. Tổng dân mỗi phường, xã giữ nguyên số hành chính `danSo`.

## Cách tính

- **Cũ.** `services/geeService.js` lấy asset `Pixel-danso`, giữ pixel có giá trị > 0, đếm ở lưới 60 m (`POP_SCALE_M`), rồi chia đều dân số phường cho các pixel đó (`popRasterNormalized`). Độ phủ (`getWardCoverage`), mô phỏng ngập (`getFloodBins`) và ngập radar dùng đúng tỷ lệ pixel này. Thí nghiệm không có khóa GEE nên lập lại công thức trên mặt nạ **WorldPop GP 100 m năm 2020, Việt Nam** (pixel có dân > 0), cùng nguồn mở mà `getPopCheck` đang đối chiếu. Trị số WorldPop trong ô không được dùng làm trọng số — app cũng không dùng trị số đó để chia dân.
- **A.** Dân số phường chia đều cho 664.302 nhà ở sau bộ lọc GBA (thửa đất ở, loại OSM / hạ tầng 20 m / lô không phải ở, dấu chân dưới 20 m² và trên 500 m²).
- **B.** Cùng tập nhà ở, trọng số = diện tích dấu chân (m²) × (bậc chiều cao tương đối + 1). Bậc là tứ phân vị, không phải mét. Đây là trọng số đã ghi trên thẻ lô (`rp`).
- **Trường, y tế, công viên.** Công trình đã duyệt và có quy mô hiện trạng. Ô quy mô hiện trạng trống được app xếp là quy hoạch mới nên không vào độ phủ hiện trạng; thí nghiệm lọc giống vậy (524 trường, 32 cơ sở y tế, 35 công viên). Nhiều phường vì thế có 0 người ở cột y tế cùng phường. Bán kính là `constants.standardRadius`: trường đơn vị ở 1 km ở phường và 2 km ở xã, THPT 2 km, y tế đơn vị ở cùng mức đó, y tế cấp đô thị 2 km, vườn hoa 400 m, công viên khu vực 800 m, công viên đô thị 2 km. Cột “cùng phường” chỉ đếm dân của phường nằm trong vùng đệm của công trình thuộc chính phường đó, giống `computeSingleWardCoverage`. Cột “bắt chéo ranh” cộng dân trong vùng đệm dù công trình thuộc phường bên cạnh.
- **Ngập.** App làm tròn mét cao độ FABDEM và tính dân ở bậc thấp hơn mực nước (mặc định 5 m trong `floodSim.js`). Thí nghiệm dùng cùng quy tắc trên Copernicus GLO-30, cho cả ba cách chia, để lệch số chỉ còn do chỗ đặt dân. Cột FABDEM là số app trả về (`getFloodBins`), chỉ để thấy lệch nguồn cao độ, không phải cột A/B.
- **Lưới và lô.** Ô 150 m là lưới cường độ GBA. “Ô có nhà ở” = ô chứa ít nhất một nhà ở sau lọc. “Lô đất ở” = lô quy hoạch có chức năng ở. Một điểm rơi vào nhiều đồ án được tính vào từng lô trong file lô, nên không cộng file lô thành dân số thành phố. Cột phường không đếm trùng: điểm chỉ cần nằm trên một lô ở.
- Ngưỡng tô đậm: lệch tuyệt đối từ 15% và mẫu ít nhất 100 người. Dịch tâm tô khi từ 500 m.

## FAQ đang phát hành không đổi

Hai câu dùng dân số trong `public/data/faq.json` lấy `danSoNum` trên ranh, không lấy raster:

- Xã nào có mật độ dân số thấp nhất? Xã A Lưới 5: 8 người/km² (3.760 người / 464,40 km²).
- Phường nào có mật độ dân số cao nhất? Phường Thuận Hóa: 13.068 người/km² (98.923 người / 7,57 km²).

Danh sách ưu tiên công trình quy hoạch (40 phường có hạng mục, 245 hạng mục) đặt `popAdded` = dân số cả phường × tỷ lệ diện tích vùng đệm mới, có trần sức chứa. Ghi chú phương pháp trong file nói rõ không dùng lớp dân cư vệ tinh. Tổng `popAdded` công bố là 1.800.874 người. Ba cách chia lại dân trong không gian không đổi các câu này, vì tử số vẫn là dân số hành chính cả phường.

Nếu FAQ hỏi theo dân đã phân bổ lại, câu trả lời đổi như bảng dưới (thí nghiệm, chưa ghi vào `faq.json`).

| Câu hỏi | Cũ | A | B |
|---|---|---|---|
| Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ trường (kể cả trường xã bên cạnh)? | Phường Kim Long: 36.977 người | Phường Thủy Xuân: 19.056 người | Phường Thủy Xuân: 21.035 người |
| Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ y tế (kể cả trạm bên cạnh)? | Phường Thuận An: 64.689 người | Phường Thuận An: 64.689 người | Phường Thuận An: 64.689 người |
| Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ công viên? | Phường Phú Xuân: 73.140 người | Phường Phú Xuân: 80.517 người | Phường Phú Xuân: 77.257 người |
| Địa bàn nào có nhiều dân nhất ở cao độ dưới 5 m? | Phường Hóa Châu: 39.852 người | Phường Hóa Châu: 34.687 người | Phường Hóa Châu: 33.549 người |

## Cả thành phố

| Chỉ tiêu | Cũ | A | B | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Dân trong vùng phục vụ trường (công trình cùng phường) | 836.134 | 1.228.491 | 1.240.218 | 404.084 | +48,3% |
| Dân trong vùng phục vụ y tế (công trình cùng phường) | 264.846 | 352.291 | 365.688 | 100.842 | +38,1% |
| Dân trong vùng phục vụ công viên (công trình cùng phường) | 146.880 | 160.729 | 171.567 | 24.687 | +16,8% |
| Dân ở cao độ làm tròn dưới 5 m (Copernicus GLO-30) | 471.223 | 313.487 | 290.009 | -181.214 | -38,5% |
| Dân nằm trong ô 150 m có ít nhất một nhà ở | 657.365 | 1.452.683 | 1.452.683 | 795.318 | +121,0% |
| Dân nằm trên lô quy hoạch đất ở | 236.268 | 852.369 | 881.410 | 645.142 | +273,1% |
| Dân trong vùng phục vụ trường (vùng đệm bắt chéo ranh) | 890.237 | 1.285.854 | 1.296.045 | 405.809 | +45,6% |
| Dân trong vùng phục vụ y tế (vùng đệm bắt chéo ranh) | 312.221 | 448.078 | 467.567 | 155.347 | +49,8% |
| Dân trong vùng phục vụ công viên (vùng đệm bắt chéo ranh) | 167.694 | 198.939 | 211.145 | 43.451 | +25,9% |
| Dân ở cao độ làm tròn dưới 2 m (Copernicus GLO-30) | 237.109 | 17.620 | 13.550 | -223.559 | -94,3% |
| Dân cao độ dưới 5 m theo app (FABDEM, chỉ cột cũ) | 736.532 | — | — | — | — |
| Dịch tâm dân toàn thành phố | — | 1748 m | 1748 m | — | — |

Pixel WorldPop trong ranh: 555.425 ô. Nhà ở: 664.302.
Đối chiếu Phường Phú Xuân với API `getWardCoverage` trên Pixel-danso: công viên 34.2% so với 31.9% dân, y tế 85.0% so với 85.4% dân. Mặt nạ WorldPop bám mặt nạ đang chạy ở nội thành; không khớp từng ô 60 m.

Đọc lệch toàn thành phố theo số người, không phải dân số tăng. A và B vẫn cộng đúng 1.452.683 người mỗi phường; cột “ô có nhà ở” và “lô đất ở” của A/B bằng cả dân số vì mọi người đã được đặt lên một nhà. Cột cũ thấp hơn là phần dân pixel đang nằm trên ruộng, mặt nước hoặc sườn núi, nơi ô 150 m không có nhà ở sau lọc.
Miền núi (A Lưới, Khe Tre, Nam Đông, Long Quảng) lệch vài trăm phần trăm vì pixel WorldPop phủ cả sườn cao, trong khi nhà ở nằm ở thung lũng: tâm dân dịch vài kilômét và cao độ trung bình theo dân thấp hơn pixel hàng trăm mét. Vùng đồng bằng ven phá thì lệch ngập lớn hơn lệch trường, vì pixel bờ nước thấp hơn nền nhà.

## Nơi lệch quá 15%

| Phường, xã | Chỉ tiêu | Cách | Cũ | Mới | % | Vì sao |
|---|---|---|---:|---:|---:|---|
| Phường Phú Xuân | Dân nằm trên lô quy hoạch đất ở | B | 47.662 | 118.328 | +148,3% | 15% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch +1.1 m so với pixel |
| Phường Phú Xuân | Dân nằm trên lô quy hoạch đất ở | A | 47.662 | 114.766 | +140,8% | 15% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch +1.1 m so với pixel |
| Phường Thuận Hóa | Dân nằm trên lô quy hoạch đất ở | B | 42.160 | 90.972 | +115,8% | cao độ trung bình theo dân của B lệch +0.8 m so với pixel |
| Xã Chân Mây - Lăng Cô | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 3.785 | 50.831 | +1242,9% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |
| Xã Chân Mây - Lăng Cô | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 3.785 | 50.831 | +1242,9% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |
| Phường Thuận Hóa | Dân nằm trên lô quy hoạch đất ở | A | 42.160 | 88.703 | +110,4% | cao độ trung bình theo dân của B lệch +0.8 m so với pixel |
| Xã Chân Mây - Lăng Cô | Dân nằm trên lô quy hoạch đất ở | A | 5.562 | 50.448 | +807,0% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |
| Xã Chân Mây - Lăng Cô | Dân nằm trên lô quy hoạch đất ở | B | 5.562 | 50.395 | +806,1% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |
| Xã Phú Lộc | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 9.417 | 50.929 | +440,8% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 276 m; tâm dân B dịch 2669 m |
| Xã Phú Lộc | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 9.417 | 50.929 | +440,8% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 276 m; tâm dân B dịch 2669 m |
| Phường Kim Long | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 8.876 | 48.999 | +452,0% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Phường Kim Long | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 8.876 | 48.999 | +452,0% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Phường Kim Long | Dân nằm trên lô quy hoạch đất ở | B | 4.628 | 41.426 | +795,2% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Xã Phú Lộc | Dân nằm trên lô quy hoạch đất ở | B | 2.461 | 38.787 | +1476,3% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 276 m; tâm dân B dịch 2669 m |
| Phường Phú Bài | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 2.241 | 38.410 | +1614,2% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường Phú Bài | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 2.241 | 38.410 | +1614,2% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường Kim Long | Dân nằm trên lô quy hoạch đất ở | A | 4.628 | 40.385 | +772,7% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Xã Phú Lộc | Dân nằm trên lô quy hoạch đất ở | A | 2.461 | 36.948 | +1401,5% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 276 m; tâm dân B dịch 2669 m |
| Phường Phong Thái | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 4.636 | 37.406 | +706,9% | 88% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 76 m; tâm dân B dịch 6425 m |
| Phường Phong Thái | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 4.636 | 37.406 | +706,9% | 88% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 76 m; tâm dân B dịch 6425 m |
| Xã Lộc An | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 7.690 | 39.217 | +410,0% | 80% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 232 m; tâm dân B dịch 6059 m |
| Xã Lộc An | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 7.690 | 39.217 | +410,0% | 80% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 232 m; tâm dân B dịch 6059 m |
| Phường Phú Xuân | Dân ở cao độ làm tròn dưới 5 m (Copernicus GLO-30) | B | 38.986 | 7.597 | -80,5% | 15% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch +1.1 m so với pixel |
| Phường Phú Bài | Dân nằm trên lô quy hoạch đất ở | B | 931 | 32.257 | +3364,9% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường An Cựu | Dân nằm trên lô quy hoạch đất ở | B | 15.370 | 46.557 | +202,9% | 34% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch -9.5 m so với pixel; tâm dân B dịch 1055 m |
| Phường Phong Thái | Dân nằm trên lô quy hoạch đất ở | B | 4.354 | 34.960 | +702,9% | 88% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 76 m; tâm dân B dịch 6425 m |
| Phường Phú Xuân | Dân ở cao độ làm tròn dưới 5 m (Copernicus GLO-30) | A | 38.986 | 8.513 | -78,2% | 15% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch +1.1 m so với pixel |
| Phường Phong Thái | Dân nằm trên lô quy hoạch đất ở | A | 4.354 | 34.657 | +695,9% | 88% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 76 m; tâm dân B dịch 6425 m |
| Phường Phú Bài | Dân nằm trên lô quy hoạch đất ở | A | 931 | 30.921 | +3221,3% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường Kim Long | Dân trong vùng phục vụ trường (công trình cùng phường) | B | 8.405 | 38.189 | +354,4% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Phường Thuận An | Dân nằm trên lô quy hoạch đất ở | B | 15.260 | 44.867 | +194,0% | 43% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; tâm dân B dịch 2385 m |
| Phường Kim Long | Dân trong vùng phục vụ trường (công trình cùng phường) | A | 8.405 | 37.532 | +346,5% | 82% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 44 m; tâm dân B dịch 4702 m |
| Phường Phú Bài | Dân trong vùng phục vụ trường (công trình cùng phường) | B | 1.905 | 30.615 | +1507,0% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường An Cựu | Dân nằm trên lô quy hoạch đất ở | A | 15.370 | 43.850 | +185,3% | 34% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; cao độ trung bình theo dân của B lệch -9.5 m so với pixel; tâm dân B dịch 1055 m |
| Phường Thuận An | Dân nằm trên lô quy hoạch đất ở | A | 15.260 | 43.093 | +182,4% | 43% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; tâm dân B dịch 2385 m |
| Phường Phú Bài | Dân trong vùng phục vụ trường (công trình cùng phường) | A | 1.905 | 29.564 | +1451,8% | 94% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 163 m; tâm dân B dịch 15187 m |
| Phường Thuận An | Dân nằm trong ô 150 m có ít nhất một nhà ở | B | 37.054 | 64.689 | +74,6% | 43% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; tâm dân B dịch 2385 m |
| Phường Thuận An | Dân nằm trong ô 150 m có ít nhất một nhà ở | A | 37.054 | 64.689 | +74,6% | 43% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; tâm dân B dịch 2385 m |
| Xã Chân Mây - Lăng Cô | Dân trong vùng phục vụ trường (công trình cùng phường) | A | 17.155 | 44.242 | +157,9% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |
| Xã Chân Mây - Lăng Cô | Dân trong vùng phục vụ trường (công trình cùng phường) | B | 17.155 | 44.150 | +157,4% | 93% dân pixel nằm ở ô 150 m không có nhà ở sau lọc; pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng 239 m; tâm dân B dịch 3151 m |

Còn 245 ô lệch nữa trong CSV.

## Bảng theo phường

### Dân trong vùng phục vụ trường (công trình cùng phường)

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 836.134 | 1.228.491 | 1.240.218 | 404.084 | +48,3% |
| **Phường An Cựu** | 22.945 | 41.638 | 42.813 | 19.867 | +86,6% |
| Phường Dương Nỗ | 28.187 | 29.841 | 30.424 | 2.237 | +7,9% |
| **Phường Hóa Châu** | 32.514 | 36.991 | 37.777 | 5.263 | +16,2% |
| **Phường Hương An** | 14.307 | 22.798 | 24.582 | 10.274 | +71,8% |
| **Phường Hương Thủy** | 11.651 | 21.069 | 21.814 | 10.163 | +87,2% |
| **Phường Hương Trà** | 6.110 | 23.558 | 23.657 | 17.547 | +287,2% |
| **Phường Kim Long** | 8.405 | 37.532 | 38.189 | 29.784 | +354,4% |
| **Phường Kim Trà** | 16.911 | 22.492 | 21.412 | 4.501 | +26,6% |
| **Phường Mỹ Thượng** | 30.247 | 40.565 | 41.016 | 10.769 | +35,6% |
| **Phường Phong Dinh** | 6.027 | 16.434 | 14.933 | 8.906 | +147,8% |
| **Phường Phong Phú** | 5.140 | 13.388 | 13.550 | 8.409 | +163,6% |
| **Phường Phong Quảng** | 14.886 | 16.769 | 18.807 | 3.921 | +26,3% |
| **Phường Phong Thái** | 6.479 | 23.721 | 25.681 | 19.202 | +296,4% |
| **Phường Phong Điền** | 1.366 | 16.268 | 16.972 | 15.607 | +1142,9% |
| **Phường Phú Bài** | 1.905 | 29.564 | 30.615 | 28.710 | +1507,0% |
| Phường Phú Xuân | 130.247 | 130.247 | 130.247 | 0 | -0,0% |
| **Phường Thanh Thủy** | 17.648 | 33.898 | 35.120 | 17.472 | +99,0% |
| **Phường Thuận An** | 50.671 | 62.058 | 62.994 | 12.323 | +24,3% |
| Phường Thuận Hóa | 91.685 | 90.308 | 91.119 | -566 | -0,6% |
| **Phường Thủy Xuân** | 14.533 | 19.235 | 16.716 | 2.182 | +15,0% |
| **Phường Vỹ Dạ** | 37.409 | 45.927 | 47.447 | 10.039 | +26,8% |
| **Xã A Lưới 1** | 3.777 | 11.128 | 11.538 | 7.762 | +205,5% |
| **Xã A Lưới 2** | 8.094 | 20.030 | 20.240 | 12.146 | +150,1% |
| **Xã A Lưới 3** | 3.052 | 8.663 | 8.825 | 5.773 | +189,1% |
| **Xã A Lưới 4** | 3.343 | 10.054 | 9.896 | 6.553 | +196,0% |
| **Xã A Lưới 5** | 295 | 891 | 909 | 614 | +208,0% |
| **Xã Bình Điền** | 3.033 | 11.790 | 11.481 | 8.449 | +278,6% |
| **Xã Chân Mây - Lăng Cô** | 17.155 | 44.242 | 44.150 | 26.996 | +157,4% |
| **Xã Hưng Lộc** | 18.522 | 32.176 | 32.309 | 13.787 | +74,4% |
| **Xã Khe Tre** | 1.705 | 11.220 | 10.959 | 9.253 | +542,6% |
| **Xã Long Quảng** | 1.240 | 8.599 | 8.664 | 7.424 | +598,8% |
| **Xã Lộc An** | 13.068 | 37.051 | 37.503 | 24.436 | +187,0% |
| **Xã Nam Đông** | 1.556 | 9.018 | 9.039 | 7.483 | +480,8% |
| Xã Phú Hồ | 18.369 | 20.579 | 20.134 | 1.765 | +9,6% |
| **Xã Phú Lộc** | 19.031 | 42.834 | 42.557 | 23.526 | +123,6% |
| Xã Phú Vang | 35.689 | 37.629 | 37.953 | 2.263 | +6,3% |
| Xã Phú Vinh | 29.198 | 31.299 | 31.283 | 2.085 | +7,1% |
| Xã Quảng Điền | 41.358 | 41.667 | 41.722 | 364 | +0,9% |
| Xã Vinh Lộc | 33.981 | 36.187 | 36.252 | 2.270 | +6,7% |
| Xã Đan Điền | 34.394 | 39.131 | 38.920 | 4.526 | +13,2% |

### Dân trong vùng phục vụ y tế (công trình cùng phường)

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 264.846 | 352.291 | 365.688 | 100.842 | +38,1% |
| Phường An Cựu | 0 | 0 | 0 | 0 | +0,0% |
| Phường Dương Nỗ | 0 | 0 | 0 | 0 | +0,0% |
| Phường Hóa Châu | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Hương An** | 2.335 | 5.693 | 8.212 | 5.877 | +251,6% |
| **Phường Hương Thủy** | 2.237 | 3.013 | 3.303 | 1.066 | +47,7% |
| **Phường Hương Trà** | 3.867 | 12.410 | 13.367 | 9.500 | +245,7% |
| **Phường Kim Long** | 3.105 | 24.071 | 25.216 | 22.111 | +712,1% |
| Phường Kim Trà | 0 | 0 | 0 | 0 | +0,0% |
| Phường Mỹ Thượng | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Dinh | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Phú | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Quảng | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Phong Thái** | 2.392 | 11.840 | 12.531 | 10.139 | +423,9% |
| **Phường Phong Điền** | 145 | 3.890 | 4.534 | 4.388 | +3017,1% |
| Phường Phú Bài | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phú Xuân | 110.699 | 110.191 | 112.204 | 1.505 | +1,4% |
| Phường Thanh Thủy | 0 | 0 | 0 | 0 | +0,0% |
| Phường Thuận An | 0 | 0 | 0 | 0 | +0,0% |
| Phường Thuận Hóa | 96.764 | 96.383 | 96.588 | -177 | -0,2% |
| Phường Thủy Xuân | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Vỹ Dạ** | 21.591 | 33.760 | 35.215 | 13.623 | +63,1% |
| Xã A Lưới 1 | 0 | 0 | 0 | 0 | +0,0% |
| **Xã A Lưới 2** | 2.586 | 12.727 | 14.247 | 11.660 | +450,8% |
| Xã A Lưới 3 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 4 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 5 | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Bình Điền** | 715 | 6.482 | 6.370 | 5.655 | +791,2% |
| **Xã Chân Mây - Lăng Cô** | 2.608 | 11.425 | 12.292 | 9.684 | +371,3% |
| Xã Hưng Lộc | 0 | 0 | 0 | 0 | +0,0% |
| Xã Khe Tre | 0 | 0 | 0 | 0 | +0,0% |
| Xã Long Quảng | 0 | 0 | 0 | 0 | +0,0% |
| Xã Lộc An | 0 | 0 | 0 | 0 | +0,0% |
| Xã Nam Đông | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Hồ | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Lộc | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Phú Vang** | 4.192 | 4.574 | 3.508 | -685 | -16,3% |
| Xã Phú Vinh | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Quảng Điền** | 11.610 | 15.833 | 18.105 | 6.495 | +55,9% |
| Xã Vinh Lộc | 0 | 0 | 0 | 0 | +0,0% |
| Xã Đan Điền | 0 | 0 | 0 | 0 | +0,0% |

### Dân trong vùng phục vụ công viên (công trình cùng phường)

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 146.880 | 160.729 | 171.567 | 24.687 | +16,8% |
| **Phường An Cựu** | 2.058 | 2.616 | 3.373 | 1.315 | +63,9% |
| Phường Dương Nỗ | 0 | 0 | 0 | 0 | +0,0% |
| Phường Hóa Châu | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Hương An** | 3.285 | 8.001 | 8.229 | 4.944 | +150,5% |
| Phường Hương Thủy | 0 | 0 | 0 | 0 | +0,0% |
| Phường Hương Trà | 0 | 0 | 0 | 0 | +0,0% |
| Phường Kim Long | 0 | 0 | 0 | 0 | +0,0% |
| Phường Kim Trà | 0 | 0 | 0 | 0 | +0,0% |
| Phường Mỹ Thượng | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Dinh | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Phú | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Quảng | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phong Thái | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Phong Điền** | 94 | 3.421 | 4.005 | 3.911 | +4178,1% |
| Phường Phú Bài | 0 | 0 | 0 | 0 | +0,0% |
| Phường Phú Xuân | 44.587 | 36.502 | 39.246 | -5.341 | -12,0% |
| **Phường Thanh Thủy** | 438 | 1.645 | 1.663 | 1.225 | +279,5% |
| Phường Thuận An | 0 | 0 | 0 | 0 | +0,0% |
| Phường Thuận Hóa | 81.907 | 82.954 | 84.090 | 2.183 | +2,7% |
| Phường Thủy Xuân | 0 | 0 | 0 | 0 | +0,0% |
| **Phường Vỹ Dạ** | 10.286 | 16.289 | 20.029 | 9.743 | +94,7% |
| Xã A Lưới 1 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 2 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 3 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 4 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 5 | 0 | 0 | 0 | 0 | +0,0% |
| Xã Bình Điền | 0 | 0 | 0 | 0 | +0,0% |
| Xã Chân Mây - Lăng Cô | 0 | 0 | 0 | 0 | +0,0% |
| Xã Hưng Lộc | 0 | 0 | 0 | 0 | +0,0% |
| Xã Khe Tre | 0 | 0 | 0 | 0 | +0,0% |
| Xã Long Quảng | 0 | 0 | 0 | 0 | +0,0% |
| Xã Lộc An | 0 | 0 | 0 | 0 | +0,0% |
| Xã Nam Đông | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Hồ | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Lộc | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Vang | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Vinh | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Quảng Điền** | 4.225 | 9.300 | 10.931 | 6.707 | +158,7% |
| Xã Vinh Lộc | 0 | 0 | 0 | 0 | +0,0% |
| Xã Đan Điền | 0 | 0 | 0 | 0 | +0,0% |

### Dân ở cao độ làm tròn dưới 5 m (Copernicus GLO-30)

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 471.223 | 313.487 | 290.009 | -181.214 | -38,5% |
| **Phường An Cựu** | 11.802 | 8.109 | 8.753 | -3.049 | -25,8% |
| **Phường Dương Nỗ** | 29.446 | 24.044 | 23.151 | -6.295 | -21,4% |
| **Phường Hóa Châu** | 39.852 | 34.687 | 33.549 | -6.303 | -15,8% |
| **Phường Hương An** | 21.033 | 12.156 | 11.983 | -9.049 | -43,0% |
| **Phường Hương Thủy** | 8.616 | 5.802 | 5.121 | -3.495 | -40,6% |
| **Phường Hương Trà** | 2.776 | 752 | 518 | -2.258 | -81,4% |
| **Phường Kim Long** | 5.657 | 1.069 | 1.135 | -4.522 | -79,9% |
| **Phường Kim Trà** | 20.020 | 10.458 | 9.505 | -10.515 | -52,5% |
| **Phường Mỹ Thượng** | 39.506 | 27.528 | 26.358 | -13.148 | -33,3% |
| Phường Phong Dinh | 10.371 | 11.559 | 10.638 | 267 | +2,6% |
| **Phường Phong Phú** | 4.104 | 5.686 | 5.306 | 1.202 | +29,3% |
| **Phường Phong Quảng** | 8.725 | 4.605 | 4.656 | -4.069 | -46,6% |
| **Phường Phong Thái** | 3.683 | 567 | 342 | -3.342 | -90,7% |
| **Phường Phong Điền** | 267 | 7 | 4 | -262 | -98,5% |
| **Phường Phú Bài** | 561 | 4.784 | 4.759 | 4.198 | +748,8% |
| **Phường Phú Xuân** | 38.986 | 8.513 | 7.597 | -31.389 | -80,5% |
| Phường Thanh Thủy | 8.399 | 11.113 | 9.656 | 1.257 | +15,0% |
| **Phường Thuận An** | 36.944 | 29.979 | 28.100 | -8.845 | -23,9% |
| **Phường Thuận Hóa** | 5.079 | 1.231 | 1.080 | -4.000 | -78,7% |
| **Phường Thủy Xuân** | 4.910 | 973 | 1.011 | -3.899 | -79,4% |
| **Phường Vỹ Dạ** | 35.031 | 15.779 | 13.665 | -21.366 | -61,0% |
| Xã A Lưới 1 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 2 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 3 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 4 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 5 | 0 | 0 | 0 | 0 | +0,0% |
| Xã Bình Điền | 38 | 8 | 7 | -31 | -81,2% |
| **Xã Chân Mây - Lăng Cô** | 10.515 | 9.902 | 8.625 | -1.890 | -18,0% |
| **Xã Hưng Lộc** | 2.421 | 3.667 | 4.131 | 1.710 | +70,7% |
| Xã Khe Tre | 0 | 0 | 0 | 0 | +0,0% |
| Xã Long Quảng | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Lộc An** | 3.575 | 6.710 | 5.955 | 2.380 | +66,6% |
| Xã Nam Đông | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Phú Hồ** | 15.772 | 10.442 | 8.526 | -7.246 | -45,9% |
| **Xã Phú Lộc** | 6.088 | 14.089 | 11.627 | 5.539 | +91,0% |
| **Xã Phú Vang** | 19.264 | 7.896 | 6.617 | -12.647 | -65,6% |
| **Xã Phú Vinh** | 8.794 | 1.269 | 992 | -7.802 | -88,7% |
| **Xã Quảng Điền** | 36.091 | 26.966 | 25.199 | -10.892 | -30,2% |
| **Xã Vinh Lộc** | 13.407 | 5.176 | 4.666 | -8.741 | -65,2% |
| **Xã Đan Điền** | 19.488 | 7.961 | 6.776 | -12.713 | -65,2% |

### Dân nằm trong ô 150 m có ít nhất một nhà ở

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 657.365 | 1.452.683 | 1.452.683 | 795.318 | +121,0% |
| **Phường An Cựu** | 36.751 | 55.305 | 55.305 | 18.554 | +50,5% |
| **Phường Dương Nỗ** | 17.588 | 31.692 | 31.692 | 14.104 | +80,2% |
| **Phường Hóa Châu** | 21.086 | 41.328 | 41.328 | 20.242 | +96,0% |
| **Phường Hương An** | 14.447 | 35.885 | 35.885 | 21.438 | +148,4% |
| **Phường Hương Thủy** | 12.791 | 29.192 | 29.192 | 16.401 | +128,2% |
| **Phường Hương Trà** | 7.134 | 33.523 | 33.523 | 26.389 | +369,9% |
| **Phường Kim Long** | 8.876 | 48.999 | 48.999 | 40.123 | +452,0% |
| **Phường Kim Trà** | 11.461 | 36.296 | 36.296 | 24.835 | +216,7% |
| **Phường Mỹ Thượng** | 24.260 | 44.736 | 44.736 | 20.476 | +84,4% |
| **Phường Phong Dinh** | 5.949 | 28.012 | 28.012 | 22.063 | +370,9% |
| **Phường Phong Phú** | 3.599 | 19.057 | 19.057 | 15.458 | +429,6% |
| **Phường Phong Quảng** | 11.676 | 25.728 | 25.728 | 14.052 | +120,4% |
| **Phường Phong Thái** | 4.636 | 37.406 | 37.406 | 32.770 | +706,9% |
| **Phường Phong Điền** | 1.260 | 27.862 | 27.862 | 26.602 | +2112,1% |
| **Phường Phú Bài** | 2.241 | 38.410 | 38.410 | 36.169 | +1614,2% |
| **Phường Phú Xuân** | 110.370 | 130.247 | 130.247 | 19.877 | +18,0% |
| **Phường Thanh Thủy** | 21.646 | 43.569 | 43.569 | 21.923 | +101,3% |
| **Phường Thuận An** | 37.054 | 64.689 | 64.689 | 27.635 | +74,6% |
| Phường Thuận Hóa | 90.796 | 98.923 | 98.923 | 8.127 | +9,0% |
| **Phường Thủy Xuân** | 22.615 | 43.373 | 43.373 | 20.758 | +91,8% |
| **Phường Vỹ Dạ** | 35.807 | 49.684 | 49.684 | 13.877 | +38,8% |
| **Xã A Lưới 1** | 880 | 12.403 | 12.403 | 11.523 | +1309,6% |
| **Xã A Lưới 2** | 3.150 | 20.496 | 20.496 | 17.346 | +550,6% |
| **Xã A Lưới 3** | 591 | 8.976 | 8.976 | 8.385 | +1417,6% |
| **Xã A Lưới 4** | 752 | 10.752 | 10.752 | 10.000 | +1329,0% |
| **Xã A Lưới 5** | 48 | 3.760 | 3.760 | 3.712 | +7769,8% |
| **Xã Bình Điền** | 1.077 | 15.229 | 15.229 | 14.152 | +1314,3% |
| **Xã Chân Mây - Lăng Cô** | 3.785 | 50.831 | 50.831 | 47.046 | +1242,9% |
| **Xã Hưng Lộc** | 8.190 | 32.586 | 32.586 | 24.396 | +297,9% |
| **Xã Khe Tre** | 536 | 12.882 | 12.882 | 12.346 | +2303,3% |
| **Xã Long Quảng** | 317 | 8.883 | 8.883 | 8.566 | +2704,7% |
| **Xã Lộc An** | 7.690 | 39.217 | 39.217 | 31.527 | +410,0% |
| **Xã Nam Đông** | 549 | 9.158 | 9.158 | 8.609 | +1567,9% |
| **Xã Phú Hồ** | 9.863 | 23.550 | 23.550 | 13.687 | +138,8% |
| **Xã Phú Lộc** | 9.417 | 50.929 | 50.929 | 41.512 | +440,8% |
| **Xã Phú Vang** | 23.661 | 39.250 | 39.250 | 15.589 | +65,9% |
| **Xã Phú Vinh** | 17.049 | 31.328 | 31.328 | 14.279 | +83,8% |
| **Xã Quảng Điền** | 24.794 | 41.798 | 41.798 | 17.004 | +68,6% |
| **Xã Vinh Lộc** | 24.035 | 36.350 | 36.350 | 12.315 | +51,2% |
| **Xã Đan Điền** | 18.940 | 40.389 | 40.389 | 21.449 | +113,2% |

### Dân nằm trên lô quy hoạch đất ở

| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |
|---|---:|---:|---:|---:|---:|
| Thành phố Huế | 236.268 | 852.369 | 881.410 | 645.142 | +273,1% |
| **Phường An Cựu** | 15.370 | 43.850 | 46.557 | 31.187 | +202,9% |
| **Phường Dương Nỗ** | 8.269 | 27.322 | 28.113 | 19.844 | +240,0% |
| **Phường Hóa Châu** | 5.630 | 21.346 | 23.931 | 18.301 | +325,1% |
| **Phường Hương An** | 8.983 | 31.339 | 32.042 | 23.059 | +256,7% |
| **Phường Hương Thủy** | 6.624 | 26.856 | 27.125 | 20.501 | +309,5% |
| **Phường Hương Trà** | 2.200 | 17.464 | 16.743 | 14.543 | +661,2% |
| **Phường Kim Long** | 4.628 | 40.385 | 41.426 | 36.799 | +795,2% |
| **Phường Kim Trà** | 6.506 | 32.178 | 32.494 | 25.988 | +399,5% |
| **Phường Mỹ Thượng** | 9.615 | 25.930 | 27.333 | 17.719 | +184,3% |
| **Phường Phong Dinh** | 4.657 | 25.324 | 25.688 | 21.030 | +451,6% |
| **Phường Phong Phú** | 3.221 | 17.836 | 18.010 | 14.789 | +459,1% |
| **Phường Phong Quảng** | 3.131 | 8.207 | 11.381 | 8.250 | +263,4% |
| **Phường Phong Thái** | 4.354 | 34.657 | 34.960 | 30.605 | +702,9% |
| **Phường Phong Điền** | 913 | 24.117 | 24.513 | 23.600 | +2584,0% |
| **Phường Phú Bài** | 931 | 30.921 | 32.257 | 31.326 | +3364,9% |
| **Phường Phú Xuân** | 47.662 | 114.766 | 118.328 | 70.666 | +148,3% |
| **Phường Thanh Thủy** | 1.082 | 2.296 | 1.666 | 584 | +53,9% |
| **Phường Thuận An** | 15.260 | 43.093 | 44.867 | 29.608 | +194,0% |
| **Phường Thuận Hóa** | 42.160 | 88.703 | 90.972 | 48.812 | +115,8% |
| **Phường Thủy Xuân** | 9.475 | 35.371 | 35.774 | 26.299 | +277,6% |
| **Phường Vỹ Dạ** | 18.001 | 39.287 | 41.498 | 23.497 | +130,5% |
| Xã A Lưới 1 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 2 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 3 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 4 | 0 | 0 | 0 | 0 | +0,0% |
| Xã A Lưới 5 | 0 | 0 | 0 | 0 | +0,0% |
| Xã Bình Điền | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Chân Mây - Lăng Cô** | 5.562 | 50.448 | 50.395 | 44.833 | +806,1% |
| Xã Hưng Lộc | 15 | 16 | 18 | 3 | +21,6% |
| **Xã Khe Tre** | 47 | 3.790 | 3.969 | 3.922 | +8304,7% |
| Xã Long Quảng | 0 | 0 | 0 | 0 | +0,0% |
| Xã Lộc An | 0 | 0 | 0 | 0 | +0,0% |
| Xã Nam Đông | 0 | 0 | 0 | 0 | +0,0% |
| Xã Phú Hồ | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Phú Lộc** | 2.461 | 36.948 | 38.787 | 36.327 | +1476,3% |
| Xã Phú Vang | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Phú Vinh** | 2.843 | 6.405 | 7.643 | 4.799 | +168,8% |
| Xã Quảng Điền | 0 | 0 | 0 | 0 | +0,0% |
| **Xã Vinh Lộc** | 5.287 | 11.906 | 12.605 | 7.318 | +138,4% |
| **Xã Đan Điền** | 1.380 | 11.607 | 12.313 | 10.933 | +792,0% |

### Dịch tâm dân

| Phường, xã | A so với pixel | B so với pixel |
|---|---:|---:|
| Thành phố Huế | 1748 m | 1748 m |
| Phường An Cựu | 1019 m | 1055 m |
| Phường Dương Nỗ | 111 m | 232 m |
| Phường Hóa Châu | 380 m | 687 m |
| Phường Hương An | 1766 m | 1987 m |
| Phường Hương Thủy | 1650 m | 1594 m |
| Phường Hương Trà | 7696 m | 7625 m |
| Phường Kim Long | 4676 m | 4702 m |
| Phường Kim Trà | 1849 m | 1722 m |
| Phường Mỹ Thượng | 1179 m | 1327 m |
| Phường Phong Dinh | 2305 m | 1978 m |
| Phường Phong Phú | 1367 m | 1297 m |
| Phường Phong Quảng | 657 m | 509 m |
| Phường Phong Thái | 6353 m | 6425 m |
| Phường Phong Điền | 13011 m | 13402 m |
| Phường Phú Bài | 14831 m | 15187 m |
| Phường Phú Xuân | 135 m | 100 m |
| Phường Thanh Thủy | 2517 m | 2368 m |
| Phường Thuận An | 2248 m | 2385 m |
| Phường Thuận Hóa | 186 m | 125 m |
| Phường Thủy Xuân | 2945 m | 2942 m |
| Phường Vỹ Dạ | 625 m | 809 m |
| Xã A Lưới 1 | 389 m | 405 m |
| Xã A Lưới 2 | 3100 m | 3304 m |
| Xã A Lưới 3 | 3795 m | 3925 m |
| Xã A Lưới 4 | 3243 m | 2737 m |
| Xã A Lưới 5 | 8531 m | 8428 m |
| Xã Bình Điền | 4376 m | 4317 m |
| Xã Chân Mây - Lăng Cô | 2407 m | 3151 m |
| Xã Hưng Lộc | 5496 m | 5633 m |
| Xã Khe Tre | 5571 m | 5744 m |
| Xã Long Quảng | 7028 m | 6975 m |
| Xã Lộc An | 6193 m | 6059 m |
| Xã Nam Đông | 5307 m | 5406 m |
| Xã Phú Hồ | 766 m | 327 m |
| Xã Phú Lộc | 2611 m | 2669 m |
| Xã Phú Vang | 500 m | 192 m |
| Xã Phú Vinh | 405 m | 851 m |
| Xã Quảng Điền | 102 m | 129 m |
| Xã Vinh Lộc | 421 m | 157 m |
| Xã Đan Điền | 1378 m | 1514 m |

File lô lệch quá 15% và ít nhất 100 người: 4667 lô (đếm trùng nếu lô chồng đồ án). Xem `pop-compare-lots.csv`.

## Nên dùng cách nào

Nên chọn **B** khi chuyển các chỉ tiêu không gian (dân trong vùng phục vụ, dân vùng ngập, dân trên lưới và lô) sang nhà ở. B giữ đúng dân số hành chính từng phường, chỉ đặt dân lên dấu chân đã qua bộ lọc ở, và cho nhà rộng hơn, bậc cao hơn một phần dân lớn hơn. A cũng đúng tổng phường nhưng coi một nhà khoảng 25 m² ngang một khối chung cư; thành phố chỉ giữ vài trăm dấu chân lớn trên thửa đất ở, nên A đánh giá thấp các khối đó.

Trên toàn thành phố, B lệch so với pixel khoảng +48,3% ở vùng phục vụ trường (cùng phường), +16,8% ở công viên, -38,5% ở cao độ dưới 5 m. Có 78 cặp phường–chỉ tiêu trường, y tế, công viên hoặc ngập 5 m lệch từ 15%. Trung vị phần dân pixel nằm ngoài ô có nhà ở là 72%: raster đang “phủ” ruộng và sườn đồi mà dãy nhà không nằm ở đó, nên vùng phục vụ tròn nuốt thêm dân pixel và bỏ sót dân nhà ở.

Chưa thay code đang chạy. Ở Phú Xuân, mặt nạ WorldPop cho công viên và y tế sát API Pixel-danso, nhưng lưới app là 60 m còn thí nghiệm là 100 m. Ngập không được lấy số B thay số trên thanh mô phỏng: app FABDEM đang khoảng 737 nghìn người dưới 5 m, cùng công thức pixel trên Copernicus là khoảng 471 nghìn, B trên Copernicus là khoảng 290 nghìn. Lệch nguồn cao độ và lệch chỗ đặt dân cùng cỡ nhau. Cần một lần chạy lại trên GEE với chính asset Pixel-danso và FABDEM trước khi đổi `popRasterNormalized`. FAQ mật độ và `popAdded` của công trình quy hoạch giữ công thức hiện tại: hai chỗ đó cố ý dùng dân cả phường và tỷ lệ diện tích.

Không nên dùng A làm phương án chính. A hữu ích như phép thử độ nhạy: nơi A và B cùng lệch pixel hơn 15% thì nguyên nhân là vị trí nhà ở, không phải bậc chiều cao. Nơi chỉ B lệch, nguyên nhân là vài dấu chân lớn hoặc bậc cao tập trung dân.

## Việc chưa làm trong thí nghiệm này

Chưa đổi `geeService.js`, độ phủ, FAQ hay thẻ thống kê. Chưa ghi đè asset Pixel-danso. Ngập radar Sentinel-1 (`getSarFloodStats`) cần mặt nạ GEE nên không lập lại; bậc cao độ là chỉ tiêu ngập so được trên cả ba cách chia. Vùng phục vụ bám đường (Dijkstra) không nằm trong thí nghiệm — bán kính ở đây là vùng đệm tròn QCVN, cùng kiểu với độ phủ và FAQ ưu tiên.
