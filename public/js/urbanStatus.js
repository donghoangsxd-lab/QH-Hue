// Hiện trạng đô thị TP. Huế từ 01/01/2026 theo Quyết định 614/QĐ-UBND ngày 10/02/2026 của UBND thành phố Huế
// (công bố theo Nghị quyết 111/2025/UBTVQH15 và Nghị định 35/2026/NĐ-CP).
// Phụ lục I: 14 đô thị chuyển tiếp — loại sau chuyển tiếp theo Điều 15 Nghị quyết 111.
// Phụ lục II: 21 phường đạt trình độ phát triển đô thị. Phường trong đô thị loại I, II hoặc thuộc quận mà nhập,
// điều chỉnh địa giới với đơn vị hành chính nông thôn thì chỉ đạt trình độ loại III (ghi chú cột 6 Phụ lục II).
// Phạm vi đô thị sau chuyển tiếp phải trùng phạm vi đã được công nhận (ghi chú Phụ lục I), nên không trùng hẳn
// ranh 40 phường, xã hiện nay; units là các phường, xã kế thừa, part = đô thị chỉ chiếm một phần đơn vị đó.

export const STATUS_REF = 'Quyết định 614/QĐ-UBND ngày 10/02/2026';
export const STATUS_DATE = '01/01/2026';

export const bareName = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[-–—]/g, ' ')
  .replace(/\s+/g, ' ').trim().toUpperCase()
  .replace(/^(PHUONG|XA)\s+/, '');

const UBND_TTH = 'của UBND tỉnh Thừa Thiên Huế (nay là UBND thành phố Huế)';

// plan = id đô thị tương ứng đến 2030 trong urbanClass.js (Quyết định 756/QĐ-UBND)
export const URBANS_614 = [
  { id: 'hue', name: 'Đô thị Huế', cls: 'I', before: { name: 'Thành phố Huế', cls: 'I' },
    basis: 'Quyết định số 924/QĐ-TTg ngày 30/8/2024 của Thủ tướng Chính phủ',
    city: true, scope: 'Toàn thành phố', plan: 'hue' },
  { id: 'huong-thuy', name: 'Đô thị Hương Thủy', cls: 'III', before: { name: 'Thị xã Hương Thủy', cls: 'IV' },
    basis: 'Nghị quyết 08/NQ-CP ngày 09/02/2010 của Chính phủ',
    units: ['Thanh Thủy', 'Hương Thủy', 'Phú Bài'], scope: 'Phường Thanh Thủy, Hương Thủy, Phú Bài', plan: 'huong-thuy' },
  { id: 'huong-tra', name: 'Đô thị Hương Trà', cls: 'III', before: { name: 'Thị xã Hương Trà', cls: 'IV' },
    basis: 'Nghị quyết 99/NQ-CP ngày 15/11/2011 của Chính phủ',
    units: ['Hương Trà', 'Kim Trà', 'Bình Điền'], scope: 'Phường Hương Trà, Kim Trà, xã Bình Điền', plan: 'huong-tra' },
  { id: 'phong-dien', name: 'Đô thị Phong Điền', cls: 'III', before: { name: 'Thị xã Phong Điền', cls: 'IV' },
    basis: 'Nghị quyết 1314/NQ-UBTVQH15 ngày 30/11/2024 của UBTVQH',
    units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'],
    scope: 'Phường Phong Điền, Phong Thái, Phong Dinh, Phong Phú và phường Phong Hải cũ (nay thuộc Phong Quảng)', plan: 'phong-dien' },
  { id: 'loc-son', name: 'Đô thị Lộc Sơn', cls: 'III', before: { name: 'Thị trấn Lộc Sơn', cls: 'V' },
    basis: 'Nghị quyết 1314/NQ-UBTVQH15 ngày 30/11/2024 của UBTVQH',
    units: ['Hưng Lộc'], part: true, scope: 'Một phần xã Hưng Lộc (thị trấn Lộc Sơn cũ)', plan: 'loc-son' },
  { id: 'sia', name: 'Đô thị Sịa', cls: 'III', before: { name: 'Thị trấn Sịa', cls: 'V' },
    basis: `Quyết định 123/QĐ-UBND ngày 15/02/2010 ${UBND_TTH}`,
    units: ['Quảng Điền'], part: true, scope: 'Một phần xã Quảng Điền (thị trấn Sịa cũ)', plan: 'quang-dien' },
  { id: 'phu-da', name: 'Đô thị Phú Đa', cls: 'III', before: { name: 'Thị trấn Phú Đa', cls: 'V' },
    basis: `Quyết định số 1514/QĐ-UBND ngày 19/08/2010 ${UBND_TTH}`,
    units: ['Phú Vang'], part: true, scope: 'Một phần xã Phú Vang (thị trấn Phú Đa cũ)', plan: 'phu-da' },
  { id: 'phu-loc', name: 'Đô thị Phú Lộc', cls: 'III', before: { name: 'Thị trấn Phú Lộc', cls: 'V' },
    basis: `Quyết định số 126/QĐ-UBND ngày 15/10/2010 ${UBND_TTH}`,
    units: ['Phú Lộc'], part: true, scope: 'Một phần xã Phú Lộc (thị trấn Phú Lộc cũ)', plan: 'phu-loc' },
  { id: 'lang-co', name: 'Đô thị Lăng Cô', cls: 'III', before: { name: 'Thị trấn Lăng Cô', cls: 'V' },
    basis: `Quyết định số 127/QĐ-UBND ngày 15/01/2015 ${UBND_TTH}`,
    units: ['Chân Mây - Lăng Cô'], part: true, scope: 'Một phần xã Chân Mây - Lăng Cô (thị trấn Lăng Cô cũ)', plan: 'chan-may' },
  { id: 'khe-tre', name: 'Đô thị Khe Tre', cls: 'III', before: { name: 'Thị trấn Khe Tre', cls: 'V' },
    basis: `Quyết định số 28/QĐ-UBND ngày 15/01/2010 ${UBND_TTH}`,
    units: ['Khe Tre'], part: true, scope: 'Một phần xã Khe Tre (thị trấn Khe Tre cũ)', plan: 'khe-tre' },
  { id: 'a-luoi', name: 'Đô thị A Lưới', cls: 'III', before: { name: 'Thị trấn A Lưới', cls: 'V' },
    basis: `Quyết định số 121/QĐ-UBND ngày 15/01/2010 ${UBND_TTH}`,
    units: ['A Lưới 2'], part: true, scope: 'Một phần xã A Lưới 2 (thị trấn A Lưới cũ)', plan: 'a-luoi-2' },
  { id: 'vinh-hien', name: 'Đô thị Vinh Hiền', cls: 'III', before: { name: 'Đô thị Vinh Hiền', cls: 'V' },
    basis: `Quyết định số 257/QĐ-UBND ngày 19/01/2023 ${UBND_TTH}`,
    units: ['Vinh Lộc'], part: true, scope: 'Một phần xã Vinh Lộc (xã Vinh Hiền cũ)', plan: 'vinh-hien' },
  // Phụ lục II ghi xã Quảng Thành (đô thị loại V) nhập vào phường Hóa Châu
  { id: 'thanh-ha', name: 'Đô thị Thanh Hà', cls: 'III', before: { name: 'Đô thị Thanh Hà', cls: 'V' },
    basis: `Quyết định số 258/QĐ-UBND ngày 19/01/2023 ${UBND_TTH}`,
    units: ['Hóa Châu'], part: true, scope: 'Một phần phường Hóa Châu (xã Quảng Thành cũ)', plan: 'hoa-chau' },
  { id: 'vinh-thanh', name: 'Đô thị Vinh Thanh', cls: 'III', before: { name: 'Đô thị Vinh Thanh', cls: 'V' },
    basis: `Quyết định số 866/QĐ-UBND ngày 31/3/2020 ${UBND_TTH}`,
    units: ['Phú Vinh'], part: true, scope: 'Một phần xã Phú Vinh (xã Vinh Thanh cũ)', plan: 'vinh-thanh' }
];

// before = mức trình độ phát triển cơ sở hạ tầng đô thị trước 01/7/2025; level = trình độ phát triển đô thị sau chuyển tiếp
export const WARDS_614 = [
  { name: 'Thuận Hóa', before: 'I', level: 'II', from: 'Phú Hội, Phú Nhuận, Vĩnh Ninh, Phường Đúc, Phước Vĩnh, Trường An (quận Thuận Hóa)' },
  { name: 'Phú Xuân', before: 'I', level: 'II', from: 'Gia Hội, Phú Hậu, Tây Lộc, Thuận Lộc, Thuận Hòa, Đông Ba (quận Phú Xuân)' },
  { name: 'Kim Long', before: 'I', level: 'II', from: 'Long Hồ, Hương Long, Kim Long (quận Phú Xuân)' },
  { name: 'Vỹ Dạ', before: 'I', level: 'II', from: 'Vỹ Dạ, Thủy Vân, Xuân Phú (quận Thuận Hóa)' },
  { name: 'An Cựu', before: 'I', level: 'II', from: 'An Tây, An Cựu, An Đông (quận Thuận Hóa)' },
  { name: 'Thủy Xuân', before: 'I', level: 'II', from: 'Thủy Biều, Thủy Xuân, Thủy Bằng (quận Thuận Hóa)' },
  { name: 'Hương An', before: 'I', level: 'II', from: 'Hương An, An Hòa, Hương Sơ (quận Phú Xuân)' },
  { name: 'Dương Nỗ', before: 'I', level: 'II', from: 'Không sắp xếp (quận Thuận Hóa)' },
  { name: 'Phong Điền', before: 'IV', level: 'III', from: 'Phường Phong Thu, xã Phong Mỹ, Phong Xuân (thị xã Phong Điền)' },
  { name: 'Phong Thái', before: 'IV', level: 'III', from: 'Phường Phong An, Phong Hiền, xã Phong Sơn (thị xã Phong Điền)' },
  { name: 'Phong Dinh', before: 'IV', level: 'III', from: 'Phường Phong Hòa, xã Phong Bình, Phong Chương (thị xã Phong Điền)' },
  { name: 'Phong Phú', before: 'IV', level: 'III', from: 'Phường Phong Phú, xã Phong Thạnh (thị xã Phong Điền)' },
  { name: 'Phong Quảng', before: 'IV', level: 'III', from: 'Phường Phong Hải (thị xã Phong Điền), xã Quảng Công, Quảng Ngạn (huyện Quảng Điền)' },
  { name: 'Hương Trà', before: 'IV', level: 'III', from: 'Tứ Hạ, Hương Văn, Hương Vân (thị xã Hương Trà)' },
  { name: 'Kim Trà', before: 'IV', level: 'III', from: 'Phường Hương Xuân, Hương Chữ, xã Hương Toàn (thị xã Hương Trà)' },
  { name: 'Thanh Thủy', before: 'IV', level: 'III', from: 'Phường Thủy Dương, Thủy Phương, xã Thủy Thanh (thị xã Hương Thủy)' },
  { name: 'Hương Thủy', before: 'IV', level: 'III', from: 'Phường Thủy Lương, Thủy Châu, xã Thủy Tân (thị xã Hương Thủy)' },
  { name: 'Phú Bài', before: 'IV', level: 'III', from: 'Phường Phú Bài, xã Thủy Phù, Dương Hòa, Phú Sơn (thị xã Hương Thủy)' },
  { name: 'Thuận An', before: 'I', level: 'III', rural: true, from: 'Phường Thuận An (quận Thuận Hóa), xã Phú Hải, Phú Thuận (huyện Phú Vang)' },
  { name: 'Hóa Châu', before: 'I', level: 'III', rural: true, from: 'Phường Hương Phong (quận Thuận Hóa), Hương Vinh (quận Phú Xuân), xã Quảng Thành (huyện Quảng Điền)' },
  { name: 'Mỹ Thượng', before: 'I', level: 'III', rural: true, from: 'Phường Phú Thượng (quận Thuận Hóa), xã Phú An, Phú Mỹ (huyện Phú Vang)' }
];

export const RURAL_RULE = 'Phường thuộc quận nhập với đơn vị hành chính nông thôn nên chỉ đạt trình độ phát triển đô thị loại III (ghi chú Phụ lục II).';

export function wardLevel614(wardName) {
  const b = bareName(wardName);
  return b ? WARDS_614.find(w => bareName(w.name) === b) || null : null;
}

/** Đô thị (trừ Đô thị Huế toàn thành phố) có phạm vi nằm trên phường, xã này. */
export function urbans614Of(wardName) {
  const b = bareName(wardName);
  if (!b) return [];
  return URBANS_614.filter(u => !u.city && (u.units || []).some(n => bareName(n) === b));
}

export const urbans614ByPlan = (planId) => URBANS_614.filter(u => u.plan === planId);
