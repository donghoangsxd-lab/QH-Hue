// Hệ thống đô thị dài hạn (sau năm 2030) theo Quyết định 756/QĐ-UBND ngày 28/02/2026 điều chỉnh Quy hoạch thành phố Huế
// thời kỳ 2021 - 2030, tầm nhìn đến năm 2050 — Điều 1 khoản 5 điểm a (Mục V khoản 1 "Phát triển hệ thống đô thị").
// Mọi đô thị sau 2030 ghép trọn phường, xã nên ranh dựng từ ranh 40 phường xã (scripts/build-urban-vision.js).
// Chỉ thể hiện trạng thái dài hạn; đô thị hiện hữu (Phú Đa, Vinh Thanh, Lộc Sơn...) xem bản đồ hiện trạng (urbanStatus.js).
// Văn bản không nêu trực tiếp, đọc theo cách đã thống nhất:
//  - khu vực A Lưới không ghi loại: giữ loại III của đô thị A Lưới 2;
//  - Phú Vinh, Phú Vang, Hưng Lộc, Khe Tre: cả xã đạt trình độ phát triển đô thị loại III nên đô thị mang tên xã, ranh theo cả xã;
//  - phường, xã thuộc khu vực đô thị loại II (nâng cấp hoặc mở rộng) tô trình độ loại II theo khu vực.
import { bareName } from './urbanStatus.js';

export const VISION_REF = 'Quyết định 756/QĐ-UBND ngày 28/02/2026';
export const VISION_STAGE = 'Sau năm 2030';
export const VISION_CLAUSE = 'Mục V khoản 1 (Điều 1 khoản 5 điểm a)';

// id giữ như đô thị đến 2030 (vinh-thanh, phu-da, loc-son...) vì ranh urbanVision.geojson tra theo id
export const URBANS_VISION = [
  { id: 'hue', name: 'Thành phố Huế', cls: 'I', city: true, scope: 'Toàn thành phố',
    change: 'Giữ đô thị loại I', core: ['Thuận Hóa', 'Phú Xuân'] },
  { id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II',
    units: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An', 'Hóa Châu', 'Mỹ Thượng'],
    change: 'Loại II, mở rộng đến phường Hóa Châu, Mỹ Thượng',
    // Ký hiệu đặt phía đông để không trùng ký hiệu Thành phố Huế trên Thuận Hóa, Phú Xuân
    core: ['Dương Nỗ', 'Mỹ Thượng', 'Thuận An'] },
  { id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II',
    units: ['Thanh Thủy', 'Phú Bài', 'Hương Thủy'], change: 'Giữ loại II' },
  { id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'II',
    units: ['Hương Trà', 'Kim Trà', 'Bình Điền'], change: 'Nâng từ loại III lên loại II', core: ['Hương Trà', 'Kim Trà'] },
  { id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'II',
    units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'], change: 'Nâng từ loại III lên loại II',
    core: ['Phong Thái', 'Phong Dinh'] },
  { id: 'chan-may', name: 'Khu vực đô thị Chân Mây', cls: 'II',
    units: ['Chân Mây - Lăng Cô', 'Vinh Lộc', 'Phú Lộc'], change: 'Nâng lên loại II' },
  { id: 'a-luoi', name: 'Khu vực đô thị A Lưới', cls: 'III',
    units: ['A Lưới 2', 'A Lưới 3'], change: 'Mở rộng sang xã A Lưới 3' },
  { id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III', units: ['Quảng Điền'], change: 'Giữ loại III' },
  { id: 'vinh-thanh', name: 'Đô thị Phú Vinh', cls: 'III', units: ['Phú Vinh'],
    change: 'Toàn xã Phú Vinh đạt trình độ phát triển đô thị loại III' },
  { id: 'phu-da', name: 'Đô thị Phú Vang', cls: 'III', units: ['Phú Vang'],
    change: 'Toàn xã Phú Vang đạt trình độ phát triển đô thị loại III' },
  { id: 'loc-son', name: 'Đô thị Hưng Lộc', cls: 'III', units: ['Hưng Lộc'],
    change: 'Toàn xã Hưng Lộc đạt trình độ phát triển đô thị loại III' },
  { id: 'khe-tre', name: 'Đô thị Khe Tre', cls: 'III', units: ['Khe Tre'],
    change: 'Toàn xã Khe Tre đạt trình độ phát triển đô thị loại III' }
];

URBANS_VISION.forEach(u => {
  u.scope = u.scope || `${u.units.length > 1 ? 'Gồm ' : ''}${u.units.join(', ')}`;
});

// Trình độ phát triển đô thị cấp phường, xã sau năm 2030
const WARD_LEVELS = {
  II: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An',
    'Thanh Thủy', 'Phú Bài', 'Hương Thủy', 'Hóa Châu', 'Mỹ Thượng', 'Hương Trà', 'Kim Trà', 'Bình Điền',
    'Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng', 'Chân Mây - Lăng Cô', 'Vinh Lộc', 'Phú Lộc'],
  III: ['Quảng Điền', 'A Lưới 2', 'A Lưới 3', 'Phú Hồ', 'Phú Vinh', 'Phú Vang', 'Hưng Lộc', 'Khe Tre']
};
const LEVEL_BY_KEY = new Map(Object.entries(WARD_LEVELS)
  .flatMap(([level, names]) => names.map(name => [bareName(name), { name, level }])));

export function visionLevel(wardName) {
  return LEVEL_BY_KEY.get(bareName(wardName)) || null;
}

/** Đô thị sau 2030 (trừ toàn thành phố) chứa phường, xã này. */
export function visionUrbansOf(wardName) {
  const b = bareName(wardName);
  if (!b) return [];
  return URBANS_VISION.filter(u => !u.city && u.units.some(n => bareName(n) === b));
}
