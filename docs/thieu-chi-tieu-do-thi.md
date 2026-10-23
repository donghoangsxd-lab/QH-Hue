# Số liệu còn thiếu để chấm phân loại đô thị

Nguồn đối chiếu: `urbanClass.js` (Nghị quyết 111/2025/UBTVQH15, Quyết định 756/QĐ-UBND). Bảng này là lúc chưa có số cán bộ nhập.

Tổng 696 ô (đơn vị × trường). Trong đó **510 ô thiếu**. 6 đô thị một phần xã lấy ranh từ public/data/urban614.geojson; dân số ước theo tỷ lệ diện tích, không còn ô thiếu cho ranh, dân số, diện tích và mật độ đường của các đô thị đó.

Trạng thái: Thiếu = cần nhập; Có sẵn = webapp đã tính từ bảng phường hoặc ranh; Miễn = không xem xét với đô thị di sản; Phụ thuộc = tính được nếu dữ liệu nền đủ, vẫn có ô nhập; Bổ sung = nên có, chưa chặn chấm; Không nhập = chưa có cách chấm (Bảng 2B).

| Đơn vị | Mã đơn vị | Trường | Mã tiêu chuẩn | Trạng thái | Ghi chú |
|---|---|---|---|---|---|
| Thành phố Huế | tp:TP | Dân số toàn thành phố | 1.II.07 | Có sẵn | Tổng dân số các phường, xã. Ô nhập chỉ để đính chính. |
| Thành phố Huế | tp:TP | Dân số tạm trú cộng thêm |  | Bổ sung | Webapp chưa tách tạm trú. |
| Thành phố Huế | tp:TP | Diện tích tự nhiên |  | Có sẵn | Tổng diện tích các phường, xã. |
| Thành phố Huế | tp:TP | Đã đầu tư khu chức năng cấp quốc gia hoặc quốc tế | 1.I.01 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Trung tâm tổ chức sự kiện quốc tế | 1.I.02 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Thu nhập bình quân cao hơn cả nước | 1.I.03 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Tốc độ tăng GRDP đạt hoặc vượt GDP | 1.I.04 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Thu hút đầu tư thuộc nhóm 10 địa phương đứng đầu | 1.I.05 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Không nhận bổ sung cân đối từ ngân sách trung ương | 1.I.06 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Ít nhất 2 đầu mối giao thông cấp khu vực và quốc tế | 1.III.11 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Ít nhất 5 công trình hoặc khu đô thị đạt giải thưởng | 1.III.13 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Đô thị thông minh mức 1 hoặc chống chịu khí hậu | 1.III.14 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Hoàn thành nông thôn mới giai đoạn gần nhất | 1.III.15 | Thiếu | Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính. |
| Thành phố Huế | tp:TP | Tỷ lệ phường đạt trình độ loại II | 1.II.10 | Không nhập | Cần Bảng 2B. Webapp chưa chấm Bảng 2B, không có ô nhập. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị trung tâm | dothi:trung-tam | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Thủy | dothi:huong-thuy | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Hương Trà | dothi:huong-tra | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Khu vực đô thị Phong Điền | dothi:phong-dien | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Đô thị Hóa Châu | dothi:hoa-chau | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Đô thị Hóa Châu | dothi:hoa-chau | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Đô thị Hóa Châu | dothi:hoa-chau | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị Hóa Châu | dothi:hoa-chau | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị Hóa Châu | dothi:hoa-chau | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Đô thị Hóa Châu | dothi:hoa-chau | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Hóa Châu | dothi:hoa-chau | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Mỹ Thượng | dothi:my-thuong | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Chân Mây – Lăng Cô | dothi:chan-may | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Đô thị Quảng Điền | dothi:quang-dien | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Đô thị Quảng Điền | dothi:quang-dien | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Đô thị Quảng Điền | dothi:quang-dien | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị Quảng Điền | dothi:quang-dien | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị Quảng Điền | dothi:quang-dien | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Đô thị Quảng Điền | dothi:quang-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị Quảng Điền | dothi:quang-dien | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Ranh giới đô thị |  | Có sẵn | Ghép từ ranh phường, xã trong phạm vi. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Dân số phần đô thị | 2A.II.03 | Có sẵn | Cộng dân số hiện trạng các phường, xã trong phạm vi. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Mật độ đường | 2A.III.07 | Phụ thuộc | Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị A Lưới 2 | dothi:a-luoi-2 | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Ranh giới đô thị |  | Có sẵn | Polygon vinh-thanh trong public/data/urban614.geojson, 10.44 km², trong xã Phú Vinh. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Phú Vinh × 10.44 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 10.44 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Thanh | dothi:vinh-thanh | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Ranh giới đô thị |  | Có sẵn | Polygon phu-da trong public/data/urban614.geojson, 29.84 km², trong xã Phú Vang. |
| Đô thị mới Phú Đa | dothi:phu-da | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Phú Vang × 29.84 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 29.84 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Phú Đa | dothi:phu-da | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Phú Đa | dothi:phu-da | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Phú Đa | dothi:phu-da | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Đa | dothi:phu-da | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Ranh giới đô thị |  | Có sẵn | Polygon loc-son trong public/data/urban614.geojson, 18.82 km², trong xã Hưng Lộc. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Hưng Lộc × 18.82 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 18.82 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Lộc Sơn | dothi:loc-son | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Ranh giới đô thị |  | Có sẵn | Polygon khe-tre trong public/data/urban614.geojson, 4.34 km², trong xã Khe Tre. |
| Đô thị mới Khe Tre | dothi:khe-tre | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Khe Tre × 4.34 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 4.34 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Khe Tre | dothi:khe-tre | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Khe Tre | dothi:khe-tre | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Khe Tre | dothi:khe-tre | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Khe Tre | dothi:khe-tre | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Ranh giới đô thị |  | Có sẵn | Polygon phu-loc trong public/data/urban614.geojson, 29.98 km², trong xã Phú Lộc. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Phú Lộc × 29.98 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 29.98 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Phú Lộc | dothi:phu-loc | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Ranh giới đô thị |  | Có sẵn | Polygon vinh-hien trong public/data/urban614.geojson, 19.59 km², trong xã Vinh Lộc. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Dân số xã Vinh Lộc × 19.59 km² / diện tích xã. Ô nhập để đính chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Diện tích tự nhiên | 2A.II.04 | Có sẵn | Diện tích polygon 19.59 km². Mật độ dân số vẫn được miễn với đô thị di sản. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Mật độ dân số | 2A.II.04 | Miễn | Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Dân số tạm trú cộng thêm |  | Bổ sung | Dân số phường chưa tách tạm trú. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Mật độ đường | 2A.III.07 | Phụ thuộc | Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Số giường bệnh | 2A.III.14 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Vai trò, vị trí theo quy hoạch được phê duyệt | 2A.I.01 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Vai trò đô thị trung tâm | 2A.I.02 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Đầu mối giao thông | 2A.III.06 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Đô thị mới Vinh Hiền | dothi:vinh-hien | Quy chế quản lý kiến trúc đô thị | 2A.III.23 | Thiếu | Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính. |
| Phường An Cựu | xa:an-cuu | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường An Cựu | xa:an-cuu | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường An Cựu | xa:an-cuu | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường An Cựu | xa:an-cuu | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Dương Nỗ | xa:duong-no | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Dương Nỗ | xa:duong-no | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Dương Nỗ | xa:duong-no | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hóa Châu | xa:hoa-chau | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hóa Châu | xa:hoa-chau | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hóa Châu | xa:hoa-chau | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương An | xa:huong-an | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương An | xa:huong-an | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương An | xa:huong-an | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương Thủy | xa:huong-thuy | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương Thủy | xa:huong-thuy | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Thủy | xa:huong-thuy | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương Trà | xa:huong-tra | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Hương Trà | xa:huong-tra | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Hương Trà | xa:huong-tra | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Kim Long | xa:kim-long | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Kim Long | xa:kim-long | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Long | xa:kim-long | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Kim Trà | xa:kim-tra | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Kim Trà | xa:kim-tra | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Kim Trà | xa:kim-tra | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Mỹ Thượng | xa:my-thuong | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Mỹ Thượng | xa:my-thuong | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Mỹ Thượng | xa:my-thuong | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Dinh | xa:phong-dinh | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Dinh | xa:phong-dinh | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Dinh | xa:phong-dinh | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Phú | xa:phong-phu | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Phú | xa:phong-phu | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Phú | xa:phong-phu | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Quảng | xa:phong-quang | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Quảng | xa:phong-quang | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Quảng | xa:phong-quang | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Thái | xa:phong-thai | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Thái | xa:phong-thai | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Thái | xa:phong-thai | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Điền | xa:phong-dien | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phong Điền | xa:phong-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phong Điền | xa:phong-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phú Bài | xa:phu-bai | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phú Bài | xa:phu-bai | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Bài | xa:phu-bai | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phú Xuân | xa:phu-xuan | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Phú Xuân | xa:phu-xuan | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Phú Xuân | xa:phu-xuan | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thanh Thủy | xa:thanh-thuy | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thanh Thủy | xa:thanh-thuy | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thanh Thủy | xa:thanh-thuy | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thuận An | xa:thuan-an | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thuận An | xa:thuan-an | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận An | xa:thuan-an | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thuận Hóa | xa:thuan-hoa | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thuận Hóa | xa:thuan-hoa | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thuận Hóa | xa:thuan-hoa | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thủy Xuân | xa:thuy-xuan | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Thủy Xuân | xa:thuy-xuan | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Thủy Xuân | xa:thuy-xuan | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Phường Vỹ Dạ | xa:vy-da | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Phường Vỹ Dạ | xa:vy-da | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Phường Vỹ Dạ | xa:vy-da | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 1 | xa:a-luoi-1 | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 1 | xa:a-luoi-1 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 1 | xa:a-luoi-1 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 2 | xa:a-luoi-2 | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 2 | xa:a-luoi-2 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 2 | xa:a-luoi-2 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 3 | xa:a-luoi-3 | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 3 | xa:a-luoi-3 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 3 | xa:a-luoi-3 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 4 | xa:a-luoi-4 | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 4 | xa:a-luoi-4 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 4 | xa:a-luoi-4 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 5 | xa:a-luoi-5 | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã A Lưới 5 | xa:a-luoi-5 | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã A Lưới 5 | xa:a-luoi-5 | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Bình Điền | xa:binh-dien | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Bình Điền | xa:binh-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Bình Điền | xa:binh-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Chân Mây - Lăng Cô | xa:chan-may-lang-co | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Đan Điền | xa:dan-dien | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Đan Điền | xa:dan-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Đan Điền | xa:dan-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Hưng Lộc | xa:hung-loc | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Hưng Lộc | xa:hung-loc | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Lộc Sơn: dân số cả xã × 18.82 km² / diện tích xã. |
| Xã Hưng Lộc | xa:hung-loc | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 18.82 km², polygon loc-son trong public/data/urban614.geojson. |
| Xã Hưng Lộc | xa:hung-loc | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Hưng Lộc | xa:hung-loc | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Khe Tre | xa:khe-tre | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Khe Tre | xa:khe-tre | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Khe Tre: dân số cả xã × 4.34 km² / diện tích xã. |
| Xã Khe Tre | xa:khe-tre | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 4.34 km², polygon khe-tre trong public/data/urban614.geojson. |
| Xã Khe Tre | xa:khe-tre | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Khe Tre | xa:khe-tre | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Long Quảng | xa:long-quang | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Long Quảng | xa:long-quang | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Long Quảng | xa:long-quang | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Lộc An | xa:loc-an | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Lộc An | xa:loc-an | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Lộc An | xa:loc-an | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Nam Đông | xa:nam-dong | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Nam Đông | xa:nam-dong | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Nam Đông | xa:nam-dong | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Hồ | xa:phu-ho | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Hồ | xa:phu-ho | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Hồ | xa:phu-ho | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Lộc | xa:phu-loc | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Lộc | xa:phu-loc | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Phú Lộc: dân số cả xã × 29.98 km² / diện tích xã. |
| Xã Phú Lộc | xa:phu-loc | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 29.98 km², polygon phu-loc trong public/data/urban614.geojson. |
| Xã Phú Lộc | xa:phu-loc | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Lộc | xa:phu-loc | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Vang | xa:phu-vang | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Vang | xa:phu-vang | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Phú Đa: dân số cả xã × 29.84 km² / diện tích xã. |
| Xã Phú Vang | xa:phu-vang | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 29.84 km², polygon phu-da trong public/data/urban614.geojson. |
| Xã Phú Vang | xa:phu-vang | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vang | xa:phu-vang | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Vinh | xa:phu-vinh | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Phú Vinh | xa:phu-vinh | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Vinh Thanh: dân số cả xã × 10.44 km² / diện tích xã. |
| Xã Phú Vinh | xa:phu-vinh | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 10.44 km², polygon vinh-thanh trong public/data/urban614.geojson. |
| Xã Phú Vinh | xa:phu-vinh | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Phú Vinh | xa:phu-vinh | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Quảng Điền | xa:quang-dien | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Quảng Điền | xa:quang-dien | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Quảng Điền | xa:quang-dien | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Dân số cả xã, phường | 2A.II.03 | Có sẵn | Cột dân số bảng phường. Ô nhập chỉ để đính chính. |
| Xã Vinh Lộc | xa:vinh-loc | Diện tích cả xã, phường | 2A.II.04 | Có sẵn | Cột diện tích bảng phường. Ô nhập chỉ để đính chính. |
| Xã Vinh Lộc | xa:vinh-loc | Dân số phần đô thị | 2A.II.03 | Phụ thuộc | Ước tại Đô thị mới Vinh Hiền: dân số cả xã × 19.59 km² / diện tích xã. |
| Xã Vinh Lộc | xa:vinh-loc | Diện tích phần đô thị | 2A.II.04 | Có sẵn | 19.59 km², polygon vinh-hien trong public/data/urban614.geojson. |
| Xã Vinh Lộc | xa:vinh-loc | Tỷ lệ lao động phi nông nghiệp | 2A.II.05 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Dân số được cấp nước sạch tập trung | 2A.III.08 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Mật độ đường cống thoát nước chính | 2A.III.09 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Công suất trạm xử lý nước thải so với thiết kế | 2A.III.10 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Chất thải rắn sinh hoạt được xử lý đạt yêu cầu | 2A.III.11 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Diện tích nghĩa trang xây dựng theo quy hoạch | 2A.III.12 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Số giường bệnh | 2A.III.14 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |
| Xã Vinh Lộc | xa:vinh-loc | Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên | 2A.III.21 | Thiếu | Cán bộ xã nhập. Đô thị cha dùng số của đô thị nếu đã có; chưa có thì còn thiếu khi chấm. |

## Cách giao một cán bộ mỗi xã, phường

Tab `CanBo` trên cùng Google Sheet: Họ tên, SĐT, Đơn vị công tác (droplist `mã — tên`), Email, Trạng thái TRUE/FALSE. Email TRUE chỉ gửi đúng đơn vị của mình. Quản trị không bị khóa. Đăng nhập vẫn là nút Google sẵn có, không thêm nhà cung cấp và không cron.

Máy chủ đối chiếu email lúc ghi. Quản trị ghi thẳng bản công bố. Cán bộ ghi hàng chờ: tab `ChoDuyet` (cho_duyet / da_duyet / tu_choi) và object `cho-duyet/` trên bucket. Duyệt hoặc từ chối chỉ khi quản trị bấm trong mục Quản trị. Bản chờ không lên bản đồ công khai.

Commit trong repo và bản quản trị tải sử dụng đất hoặc ranh là bản công bố. Nếu `su-dung-dat-index.json` hoặc file đồ án đã có lớp cùng vai trò thì không thêm bản sao.

Tab chỉ tiêu đề xuất: `ChiTieuDoThi`. Tab công trình kiến trúc đề xuất: `KienTruc`. Cả hai không thuộc 14 nhóm hạ tầng nên không đẩy vào `infrastructure_hue.json`.
