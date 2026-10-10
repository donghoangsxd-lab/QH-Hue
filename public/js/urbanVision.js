// Hệ thống đô thị dài hạn (sau năm 2030) theo Quyết định 756/QĐ-UBND ngày 28/02/2026 điều chỉnh Quy hoạch thành phố Huế
// thời kỳ 2021 - 2030, tầm nhìn đến năm 2050 — Điều 1 khoản 5 điểm a (Mục V khoản 1 "Phát triển hệ thống đô thị").
// Mọi đô thị sau 2030 ghép trọn phường, xã nên ranh dựng từ ranh 40 phường xã (scripts/build-urban-vision.js).
// inferred = văn bản không nêu trực tiếp, suy ra theo cách đọc đã thống nhất:
//  - khu vực A Lưới không ghi loại: giữ loại III của đô thị A Lưới 2;
//  - Vinh Thanh, Phú Đa, Lộc Sơn, Khe Tre: ranh theo cả xã vì sau 2030 cả xã đạt trình độ phát triển đô thị loại III;
//  - phường, xã thuộc khu vực đô thị loại II (nâng cấp hoặc mở rộng) tô trình độ loại II theo khu vực.
import { bareName } from './urbanStatus.js';

export const VISION_REF = 'Quyết định 756/QĐ-UBND ngày 28/02/2026';
export const VISION_STAGE = 'Sau năm 2030';
export const VISION_CLAUSE = 'Mục V khoản 1 (Điều 1 khoản 5 điểm a)';

// from2030 = id đô thị đến 2030 trong urbanClass.js được kế thừa hoặc gộp vào
export const URBANS_VISION = [
  { id: 'hue', name: 'Thành phố Huế', cls: 'I', city: true, scope: 'Toàn thành phố',
    change: 'Giữ đô thị loại I', from2030: ['hue'], core: ['Thuận Hóa', 'Phú Xuân'] },
  { id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II',
    units: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An', 'Hóa Châu', 'Mỹ Thượng'],
    change: 'Loại II, mở rộng đến phường Hóa Châu, Mỹ Thượng (gộp đô thị Hóa Châu, Mỹ Thượng)',
    // Ký hiệu đặt phía đông để không trùng ký hiệu Thành phố Huế trên Thuận Hóa, Phú Xuân
    from2030: ['trung-tam', 'hoa-chau', 'my-thuong'], core: ['Dương Nỗ', 'Mỹ Thượng', 'Thuận An'] },
  { id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II',
    units: ['Thanh Thủy', 'Phú Bài', 'Hương Thủy'], change: 'Giữ loại II', from2030: ['huong-thuy'] },
  { id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'II',
    units: ['Hương Trà', 'Kim Trà', 'Bình Điền'], change: 'Nâng từ loại III lên loại II', from2030: ['huong-tra'],
    core: ['Hương Trà', 'Kim Trà'] },
  { id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'II',
    units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'], change: 'Nâng từ loại III lên loại II',
    from2030: ['phong-dien'], core: ['Phong Thái', 'Phong Dinh'] },
  { id: 'chan-may', name: 'Khu vực đô thị Chân Mây', cls: 'II',
    units: ['Chân Mây - Lăng Cô', 'Vinh Lộc', 'Phú Lộc'],
    change: 'Nâng lên loại II, gộp đô thị Chân Mây – Lăng Cô, Phú Lộc, Vinh Hiền', from2030: ['chan-may', 'phu-loc', 'vinh-hien'] },
  { id: 'a-luoi', name: 'Khu vực đô thị A Lưới', cls: 'III',
    units: ['A Lưới 2', 'A Lưới 3'], change: 'Mở rộng đô thị A Lưới 2 sang xã A Lưới 3', from2030: ['a-luoi-2'],
    inferred: 'Văn bản không ghi loại của khu vực A Lưới; giữ loại III của đô thị A Lưới 2.' },
  { id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III',
    units: ['Quảng Điền'], change: 'Giữ loại III (đoạn sau 2030 không nhắc lại)', from2030: ['quang-dien'] },
  { id: 'vinh-thanh', name: 'Đô thị Vinh Thanh', cls: 'III', units: ['Phú Vinh'], change: 'Xã Phú Vinh đạt trình độ phát triển đô thị loại III',
    from2030: ['vinh-thanh'], inferred: 'Ranh theo cả xã Phú Vinh vì sau 2030 cả xã đạt trình độ phát triển đô thị loại III.' },
  { id: 'phu-da', name: 'Đô thị Phú Đa', cls: 'III', units: ['Phú Vang'], change: 'Xã Phú Vang đạt trình độ phát triển đô thị loại III',
    from2030: ['phu-da'], inferred: 'Ranh theo cả xã Phú Vang vì sau 2030 cả xã đạt trình độ phát triển đô thị loại III.' },
  { id: 'loc-son', name: 'Đô thị Lộc Sơn', cls: 'III', units: ['Hưng Lộc'], change: 'Xã Hưng Lộc đạt trình độ phát triển đô thị loại III',
    from2030: ['loc-son'], inferred: 'Ranh theo cả xã Hưng Lộc vì sau 2030 cả xã đạt trình độ phát triển đô thị loại III.' },
  { id: 'khe-tre', name: 'Đô thị Khe Tre', cls: 'III', units: ['Khe Tre'], change: 'Xã Khe Tre đạt trình độ phát triển đô thị loại III',
    from2030: ['khe-tre'], inferred: 'Ranh theo cả xã Khe Tre vì sau 2030 cả xã đạt trình độ phát triển đô thị loại III.' }
];

URBANS_VISION.forEach(u => {
  u.scope = u.scope || `${u.units.length > 1 ? 'Gồm ' : ''}${u.units.join(', ')}`;
});

// Trình độ phát triển đô thị cấp phường, xã: by2030 theo đoạn "Đến năm 2030", level theo đoạn "Sau năm 2030"
const W = (level, by2030, basis, inferred = false) => ({ level, by2030, basis, inferred });
const B2030_II = 'Đến 2030: 12 phường đạt trình độ phát triển đô thị loại II';
const B2030_UP = 'Đến 2030: nâng từ loại III lên loại II';
const BV_III = 'Sau 2030: phát triển xã đạt trình độ phát triển đô thị loại III';
const BV_CENTER = 'Thuộc khu vực đô thị trung tâm (loại II) mở rộng sau 2030';
const BV_UP = (area) => `Thuộc khu vực đô thị ${area} nâng lên loại II sau 2030`;

const WARD_LEVELS = {
  'Kim Long': W('II', 'II', B2030_II), 'Thủy Xuân': W('II', 'II', B2030_II), 'An Cựu': W('II', 'II', B2030_II),
  'Thuận Hóa': W('II', 'II', B2030_II), 'Vỹ Dạ': W('II', 'II', B2030_II), 'Hương An': W('II', 'II', B2030_II),
  'Phú Xuân': W('II', 'II', B2030_II), 'Dương Nỗ': W('II', 'II', B2030_II),
  'Thuận An': W('II', 'II', B2030_UP), 'Thanh Thủy': W('II', 'II', B2030_UP), 'Phú Bài': W('II', 'II', B2030_UP), 'Hương Thủy': W('II', 'II', B2030_UP),
  'Hóa Châu': W('II', 'III', BV_CENTER, true), 'Mỹ Thượng': W('II', 'III', BV_CENTER, true),
  'Hương Trà': W('II', 'III', BV_UP('Hương Trà'), true), 'Kim Trà': W('II', 'III', BV_UP('Hương Trà'), true),
  'Bình Điền': W('II', null, BV_UP('Hương Trà'), true),
  'Phong Điền': W('II', 'III', BV_UP('Phong Điền'), true), 'Phong Thái': W('II', 'III', BV_UP('Phong Điền'), true),
  'Phong Dinh': W('II', 'III', BV_UP('Phong Điền'), true), 'Phong Phú': W('II', 'III', BV_UP('Phong Điền'), true),
  'Phong Quảng': W('II', 'III', BV_UP('Phong Điền'), true),
  'Chân Mây - Lăng Cô': W('II', 'III', BV_UP('Chân Mây'), true), 'Vinh Lộc': W('II', null, BV_UP('Chân Mây'), true),
  'Phú Lộc': W('II', null, BV_UP('Chân Mây'), true),
  'Quảng Điền': W('III', 'III', 'Đến 2030: phấn đấu đạt trình độ phát triển đô thị loại III'),
  'A Lưới 2': W('III', 'III', 'Đến 2030: phấn đấu đạt trình độ phát triển đô thị loại III'),
  'A Lưới 3': W('III', null, 'Thuộc khu vực đô thị A Lưới (loại III) sau 2030', true),
  'Phú Hồ': W('III', null, BV_III), 'Phú Vinh': W('III', null, BV_III), 'Phú Vang': W('III', null, BV_III),
  'Hưng Lộc': W('III', null, BV_III), 'Khe Tre': W('III', null, BV_III)
};
const LEVEL_BY_KEY = new Map(Object.entries(WARD_LEVELS).map(([name, v]) => [bareName(name), { name, ...v }]));

export function visionLevel(wardName) {
  return LEVEL_BY_KEY.get(bareName(wardName)) || null;
}

/** Đô thị sau 2030 (trừ toàn thành phố) chứa phường, xã này. */
export function visionUrbansOf(wardName) {
  const b = bareName(wardName);
  if (!b) return [];
  return URBANS_VISION.filter(u => !u.city && u.units.some(n => bareName(n) === b));
}
