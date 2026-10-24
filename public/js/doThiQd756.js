// Danh mục đô thị và cột trình độ trên tab ĐVHC.
// Đến 2030 / sau 2030: QĐ 756/QĐ-UBND ngày 28/02/2026, Điều 1 khoản 5 điểm a (Mục V khoản 1).
// Hiện trạng: QĐ 614/QĐ-UBND ngày 10/02/2026, Phụ lục I (14 đô thị) và Phụ lục II (21 phường).
// Phạm vi sau chuyển tiếp trùng phạm vi đã công nhận. km² lấy properties.km2 của polygon đã trích,
// không cộng lại từ ranh xã khi đô thị chỉ chiếm một phần. Thiếu polygon thì chưa có ranh, không đoán.
import { DVHC_WARDS, DVHC_CITY } from './dvhcStats.js';
import { bareName, RURAL_RULE } from './urbanStatus.js';

const GP = 'data/generalPlan.geojson';
const VIS = 'data/urbanVision.geojson';
const U6 = 'data/urban614.geojson';

export const NOTE_2030 = '22 phường (12 loại II, 10 loại III); phấn đấu 2 xã Quảng Điền và A Lưới 2 đạt loại III.';
export const PLAN_FOOT = 'Theo QĐ 756; kế hoạch nâng loại có thể thay đổi theo nghiên cứu cụ thể';

export const PLAN_2030_II = [
  'Kim Long', 'Hương An', 'Phú Xuân', 'Vỹ Dạ', 'Thuận Hóa', 'An Cựu', 'Thủy Xuân', 'Dương Nỗ',
  'Thanh Thủy', 'Thuận An', 'Hương Thủy', 'Phú Bài'
];
export const PLAN_2030_III = [
  'Hóa Châu', 'Mỹ Thượng', 'Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng',
  'Hương Trà', 'Kim Trà', 'Chân Mây - Lăng Cô'
];
export const PLAN_2030_PD = [
  { name: 'Quảng Điền', note: 'Đô thị Sịa' },
  { name: 'A Lưới 2', note: 'Thị trấn A Lưới cũ' }
];

// before = trình độ trước 01/7/2025; level = trình độ sau chuyển tiếp (Phụ lục II).
export const HT_WARDS = [
  { name: 'Thuận Hóa', before: 'I', level: 'II' },
  { name: 'Phú Xuân', before: 'I', level: 'II' },
  { name: 'Kim Long', before: 'I', level: 'II' },
  { name: 'Vỹ Dạ', before: 'I', level: 'II' },
  { name: 'An Cựu', before: 'I', level: 'II' },
  { name: 'Thủy Xuân', before: 'I', level: 'II' },
  { name: 'Hương An', before: 'I', level: 'II' },
  { name: 'Dương Nỗ', before: 'I', level: 'II' },
  { name: 'Phong Điền', before: 'IV', level: 'III' },
  { name: 'Phong Thái', before: 'IV', level: 'III' },
  { name: 'Phong Dinh', before: 'IV', level: 'III' },
  { name: 'Phong Phú', before: 'IV', level: 'III' },
  { name: 'Phong Quảng', before: 'IV', level: 'III' },
  { name: 'Hương Trà', before: 'IV', level: 'III' },
  { name: 'Kim Trà', before: 'IV', level: 'III' },
  { name: 'Thanh Thủy', before: 'IV', level: 'III' },
  { name: 'Hương Thủy', before: 'IV', level: 'III' },
  { name: 'Phú Bài', before: 'IV', level: 'III' },
  { name: 'Thuận An', before: 'I', level: 'III', rural: true },
  { name: 'Hóa Châu', before: 'I', level: 'III', rural: true },
  { name: 'Mỹ Thượng', before: 'I', level: 'III', rural: true }
];

const UBND = 'của UBND tỉnh Thừa Thiên Huế (nay là UBND thành phố Huế)';

function mustWard(name) {
  const b = bareName(name);
  const key = Object.keys(DVHC_WARDS).find(k => bareName(k) === b);
  if (!key) throw new Error(`Không có trong 40 ĐVHC: ${name}`);
  return key;
}

function popOf(names) {
  return names.reduce((sum, name) => sum + DVHC_WARDS[mustWard(name)].pop, 0);
}

function group(cls, rows) {
  return { cls, title: `Loại ${cls} (${rows.length})`, rows };
}

function row(fields) {
  const item = {
    qd756: true,
    pop: null,
    km2: null,
    geom: null,
    strive: false,
    core: null,
    missing: false,
    cityPlan: false,
    hue: false,
    members: [],
    host: '',
    cls: 'III',
    ...fields
  };
  if (!item.tip) item.tip = tipOf(item);
  return item;
}

function tipOf(item) {
  const lines = [`${item.name} — loại ${item.cls}`];
  if (item.before) lines.push(`Loại trước chuyển tiếp: ${item.before}. ${item.basis || ''}`.trim());
  if (item.members.length) lines.push(`Gồm: ${item.members.join(', ')}`);
  if (item.host) lines.push(`Nằm trong ${item.host}`);
  if (item.core) lines.push(`Lõi: ${item.core}`);
  if (item.strive) lines.push('Phấn đấu');
  if (item.note) lines.push(item.note);
  if (item.missing) lines.push('Chưa có ranh');
  else if (item.geom) lines.push(`Ranh ${item.geom.file} #${item.geom.id}`);
  else if (item.cityPlan) lines.push('Ranh thành phố');
  return lines.filter(Boolean).join('\n');
}

const CENTER_9 = ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An'];
const CENTER_11 = [...CENTER_9, 'Hóa Châu', 'Mỹ Thượng'];
const HUONG_THUY = ['Thanh Thủy', 'Phú Bài', 'Hương Thủy'];
const HUONG_TRA = ['Hương Trà', 'Kim Trà', 'Bình Điền'];
const PHONG_DIEN = ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'];
const CHAN_MAY = ['Chân Mây - Lăng Cô', 'Vinh Lộc', 'Phú Lộc'];

const city2030 = row({
  id: 'hue', name: 'Thành phố Huế', cls: 'I', city: true, cityPlan: true, hue: true,
  km2: DVHC_CITY.km2,
  note: 'Đô thị loại I theo QĐ 756. Diện tích là toàn thành phố (dvhcStats).'
});

const citySau = row({
  id: 'hue', name: 'Thành phố Huế', cls: 'I', city: true, cityPlan: true, hue: true,
  km2: DVHC_CITY.km2,
  note: 'QĐ 756 không nhắc lại sau 2030; giữ đô thị loại I (diễn giải). Diện tích là toàn thành phố (dvhcStats).'
});

export const DOTHI_2030 = [
  group('I', [city2030]),
  group('II', [
    row({
      id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II', strive: true,
      members: CENTER_9, geom: { file: GP, id: 'trung-tam' }, km2: 247.77,
      note: 'Phấn đấu loại II. Ranh 9 phường (generalPlan #trung-tam), chưa gồm Hóa Châu và Mỹ Thượng.'
    }),
    row({
      id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II', strive: true,
      members: HUONG_THUY, geom: { file: GP, id: 'huong-thuy' }, km2: 428.97,
      note: 'Phấn đấu loại II. Ba phường đủ phạm vi khu vực.'
    })
  ]),
  group('III', [
    row({
      id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'III',
      members: HUONG_TRA, geom: { file: GP, id: 'huong-tra' }, km2: 393.79
    }),
    row({
      id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'III',
      members: PHONG_DIEN, geom: { file: VIS, id: 'phong-dien' }, km2: 972.79,
      note: 'Năm phường đủ khu vực. Không dùng ranh thị xã cũ (generalPlan / urban614 #phong-dien).'
    }),
    row({
      id: 'hoa-chau', name: 'Đô thị Hóa Châu', cls: 'III',
      members: ['Hóa Châu'], geom: { file: GP, id: 'hoa-chau' }, km2: 34.67,
      note: 'Cả phường Hóa Châu. Không lấy lõi Thanh Hà.'
    }),
    row({
      id: 'my-thuong', name: 'Đô thị Mỹ Thượng', cls: 'III',
      members: ['Mỹ Thượng'], geom: { file: GP, id: 'my-thuong' }, km2: 29.2
    }),
    row({
      id: 'chan-may', name: 'Đô thị Chân Mây – Lăng Cô', cls: 'III', missing: true,
      members: ['Chân Mây - Lăng Cô'],
      note: 'Xã định hướng lên phường. urban614 #lang-co chỉ là thị trấn Lăng Cô cũ, không phải cả xã.'
    }),
    row({
      id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III', strive: true,
      host: 'xã Quảng Điền', geom: { file: U6, id: 'sia' }, km2: 11.67,
      note: 'Phấn đấu loại III. Ranh Đô thị Sịa (thị trấn Sịa cũ), không lấy cả xã Quảng Điền.'
    }),
    row({
      id: 'a-luoi-2', name: 'Đô thị A Lưới 2', cls: 'III', strive: true,
      host: 'xã A Lưới 2', geom: { file: U6, id: 'a-luoi' }, km2: 14.17,
      note: 'Phấn đấu loại III. Ranh thị trấn A Lưới cũ, không lấy cả xã A Lưới 2.'
    }),
    row({
      id: 'vinh-thanh', name: 'Đô thị Vinh Thanh', cls: 'III',
      host: 'xã Phú Vinh', geom: { file: U6, id: 'vinh-thanh' }, km2: 10.44
    }),
    row({
      id: 'phu-da', name: 'Đô thị Phú Đa', cls: 'III',
      host: 'xã Phú Vang', geom: { file: U6, id: 'phu-da' }, km2: 29.84
    }),
    row({
      id: 'loc-son', name: 'Đô thị Lộc Sơn', cls: 'III',
      host: 'xã Hưng Lộc', geom: { file: U6, id: 'loc-son' }, km2: 18.82
    }),
    row({
      id: 'khe-tre', name: 'Đô thị Khe Tre', cls: 'III',
      host: 'xã Khe Tre', geom: { file: U6, id: 'khe-tre' }, km2: 4.34
    }),
    row({
      id: 'phu-loc', name: 'Đô thị Phú Lộc', cls: 'III',
      host: 'xã Phú Lộc', geom: { file: U6, id: 'phu-loc' }, km2: 29.98
    }),
    row({
      id: 'vinh-hien', name: 'Đô thị Vinh Hiền', cls: 'III',
      host: 'xã Vinh Lộc', geom: { file: U6, id: 'vinh-hien' }, km2: 19.59
    })
  ])
];

export const DOTHI_SAU = [
  group('I', [citySau]),
  group('II', [
    row({
      id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II',
      members: CENTER_11, geom: { file: VIS, id: 'trung-tam' }, km2: 311.63,
      note: 'Mở rộng đến phường Hóa Châu và Mỹ Thượng.'
    }),
    row({
      id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II',
      members: HUONG_THUY, geom: { file: VIS, id: 'huong-thuy' }, km2: 428.97,
      note: 'QĐ 756 không nhắc lại sau 2030; giữ loại II (diễn giải).'
    }),
    row({
      id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'II', strive: true,
      members: HUONG_TRA, geom: { file: VIS, id: 'huong-tra' }, km2: 393.79,
      note: 'Phấn đấu nâng lên loại II.'
    }),
    row({
      id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'II', strive: true,
      members: PHONG_DIEN, geom: { file: VIS, id: 'phong-dien' }, km2: 972.79,
      note: 'Phấn đấu nâng lên loại II.'
    }),
    row({
      id: 'chan-may', name: 'Khu vực đô thị Chân Mây', cls: 'II', strive: true,
      members: CHAN_MAY, geom: { file: VIS, id: 'chan-may' }, km2: 440.86,
      note: 'Phấn đấu loại II. Gồm xã Chân Mây – Lăng Cô, Vinh Lộc và Phú Lộc. Lõi Phú Lộc nằm trong khu vực này.'
    })
  ]),
  group('III', [
    row({
      id: 'a-luoi', name: 'Khu vực đô thị A Lưới', cls: 'III',
      members: ['A Lưới 2', 'A Lưới 3'], geom: { file: VIS, id: 'a-luoi' }, km2: 252.84,
      note: 'QĐ 756 không ghi loại khu vực A Lưới; giữ loại III (diễn giải).'
    }),
    row({
      id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III', core: 'Sịa',
      host: 'xã Quảng Điền', geom: { file: U6, id: 'sia' }, km2: 11.67,
      note: 'Giữ lõi Đô thị Sịa, không mở ra cả xã (diễn giải).'
    }),
    row({
      id: 'phu-vinh', name: 'Phú Vinh', cls: 'III', core: 'Vinh Thanh', missing: true,
      host: 'xã Phú Vinh',
      note: 'Chưa có ranh mở rộng sau lõi Vinh Thanh. Không lấy cả xã Phú Vinh.'
    }),
    row({
      id: 'phu-vang', name: 'Phú Vang', cls: 'III', core: 'Phú Đa', missing: true,
      host: 'xã Phú Vang',
      note: 'Chưa có ranh mở rộng sau lõi Phú Đa. Không lấy cả xã Phú Vang.'
    }),
    row({
      id: 'hung-loc', name: 'Hưng Lộc', cls: 'III', core: 'Lộc Sơn', missing: true,
      host: 'xã Hưng Lộc',
      note: 'Diễn giải cùng kiểu Vinh Thanh → Phú Vinh: lõi Lộc Sơn, chưa có ranh mở rộng. Không lấy cả xã.'
    }),
    row({
      id: 'phu-ho', name: 'Phú Hồ', cls: 'III', missing: true,
      host: 'xã Phú Hồ',
      note: 'QĐ 756 nêu xã Phú Hồ đạt loại III. Không có polygon ngoài ranh cả xã.'
    }),
    row({
      id: 'khe-tre', name: 'Khe Tre', cls: 'III', missing: true,
      host: 'xã Khe Tre',
      note: 'QĐ 756 nêu cả xã đạt loại III. Không lấy cả xã; thị trấn cũ không phải ranh sau 2030.'
    })
  ])
];

function htUrban(fields) {
  return row({ hue: false, ...fields, pop: fields.pop ?? null });
}

export const HT_GROUPS = [
  group('I', [
    htUrban({
      id: 'ht-hue', name: 'Đô thị Huế', cls: 'I', hue: true, missing: true,
      before: 'I (Thành phố Huế)',
      basis: 'Quyết định số 924/QĐ-TTg ngày 30/8/2024 của Thủ tướng Chính phủ',
      note: 'Phạm vi đã công nhận không có polygon. urban614 #hue là hợp 40 đơn vị hiện nay, không dùng.'
    })
  ]),
  group('III', [
    htUrban({
      id: 'ht-huong-thuy', name: 'Đô thị Hương Thủy',
      before: 'IV (thị xã Hương Thủy)',
      basis: 'Nghị quyết 08/NQ-CP ngày 09/02/2010 của Chính phủ',
      members: HUONG_THUY, pop: popOf(HUONG_THUY),
      geom: { file: U6, id: 'huong-thuy' }, km2: 428.97
    }),
    htUrban({
      id: 'ht-huong-tra', name: 'Đô thị Hương Trà',
      before: 'IV (thị xã Hương Trà)',
      basis: 'Nghị quyết 99/NQ-CP ngày 15/11/2011 của Chính phủ',
      members: HUONG_TRA, pop: popOf(HUONG_TRA),
      geom: { file: U6, id: 'huong-tra' }, km2: 393.79
    }),
    htUrban({
      id: 'ht-phong-dien', name: 'Đô thị Phong Điền',
      before: 'IV (thị xã Phong Điền)',
      basis: 'Nghị quyết 1314/NQ-UBTVQH15 ngày 30/11/2024 của UBTVQH',
      geom: { file: U6, id: 'phong-dien' }, km2: 949.14,
      note: 'Ranh thị xã đã công nhận, không phủ hết phường Phong Quảng nên không cộng dân số hiện nay.'
    }),
    htUrban({
      id: 'ht-loc-son', name: 'Đô thị Lộc Sơn',
      before: 'V (thị trấn Lộc Sơn)',
      basis: 'Nghị quyết 1314/NQ-UBTVQH15 ngày 30/11/2024 của UBTVQH',
      host: 'xã Hưng Lộc', geom: { file: U6, id: 'loc-son' }, km2: 18.82
    }),
    htUrban({
      id: 'ht-sia', name: 'Đô thị Sịa',
      before: 'V (thị trấn Sịa)',
      basis: `Quyết định 123/QĐ-UBND ngày 15/02/2010 ${UBND}`,
      host: 'xã Quảng Điền', geom: { file: U6, id: 'sia' }, km2: 11.67
    }),
    htUrban({
      id: 'ht-phu-da', name: 'Đô thị Phú Đa',
      before: 'V (thị trấn Phú Đa)',
      basis: `Quyết định số 1514/QĐ-UBND ngày 19/08/2010 ${UBND}`,
      host: 'xã Phú Vang', geom: { file: U6, id: 'phu-da' }, km2: 29.84
    }),
    htUrban({
      id: 'ht-phu-loc', name: 'Đô thị Phú Lộc',
      before: 'V (thị trấn Phú Lộc)',
      basis: `Quyết định số 126/QĐ-UBND ngày 15/10/2010 ${UBND}`,
      host: 'xã Phú Lộc', geom: { file: U6, id: 'phu-loc' }, km2: 29.98
    }),
    htUrban({
      id: 'ht-lang-co', name: 'Đô thị Lăng Cô',
      before: 'V (thị trấn Lăng Cô)',
      basis: `Quyết định số 127/QĐ-UBND ngày 15/01/2015 ${UBND}`,
      host: 'xã Chân Mây - Lăng Cô', geom: { file: U6, id: 'lang-co' }, km2: 96.93
    }),
    htUrban({
      id: 'ht-khe-tre', name: 'Đô thị Khe Tre',
      before: 'V (thị trấn Khe Tre)',
      basis: `Quyết định số 28/QĐ-UBND ngày 15/01/2010 ${UBND}`,
      host: 'xã Khe Tre', geom: { file: U6, id: 'khe-tre' }, km2: 4.34
    }),
    htUrban({
      id: 'ht-a-luoi', name: 'Đô thị A Lưới',
      before: 'V (thị trấn A Lưới)',
      basis: `Quyết định số 121/QĐ-UBND ngày 15/01/2010 ${UBND}`,
      host: 'xã A Lưới 2', geom: { file: U6, id: 'a-luoi' }, km2: 14.17
    }),
    htUrban({
      id: 'ht-vinh-hien', name: 'Đô thị Vinh Hiền',
      before: 'V (đô thị Vinh Hiền)',
      basis: `Quyết định số 257/QĐ-UBND ngày 19/01/2023 ${UBND}`,
      host: 'xã Vinh Lộc', geom: { file: U6, id: 'vinh-hien' }, km2: 19.59
    }),
    htUrban({
      id: 'ht-thanh-ha', name: 'Đô thị Thanh Hà',
      before: 'V (đô thị Thanh Hà)',
      basis: `Quyết định số 258/QĐ-UBND ngày 19/01/2023 ${UBND}`,
      host: 'phường Hóa Châu', geom: { file: U6, id: 'thanh-ha' }, km2: 10.84
    }),
    htUrban({
      id: 'ht-vinh-thanh', name: 'Đô thị Vinh Thanh',
      before: 'V (đô thị Vinh Thanh)',
      basis: `Quyết định số 866/QĐ-UBND ngày 31/3/2020 ${UBND}`,
      host: 'xã Phú Vinh', geom: { file: U6, id: 'vinh-thanh' }, km2: 10.44
    })
  ])
];

export const HT_URBANS = HT_GROUPS.flatMap(g => g.rows);

const HT_BY = new Map(HT_WARDS.map(w => [bareName(w.name), w]));
const PLAN_II = new Map(PLAN_2030_II.map(name => [bareName(name), 'II']));
const PLAN_III = new Map(PLAN_2030_III.map(name => [bareName(name), 'III']));
const PLAN_PD = new Map(PLAN_2030_PD.map(w => [bareName(w.name), w]));
const CHAN_MAY_KEY = bareName('Chân Mây - Lăng Cô');

export function wardMarks(name) {
  if (name === DVHC_CITY.name || bareName(name) === bareName(DVHC_CITY.name)) {
    return {
      ht: 'I',
      htTitle: 'Loại trước chuyển tiếp: I. Quyết định số 924/QĐ-TTg ngày 30/8/2024 của Thủ tướng Chính phủ',
      plan: 'I',
      planTitle: 'Đô thị Huế loại I theo QĐ 756',
      note: ''
    };
  }
  const b = bareName(name);
  const ht = HT_BY.get(b);
  const pd = PLAN_PD.get(b);
  const plan = pd ? 'PĐ III' : (PLAN_II.get(b) || PLAN_III.get(b) || '—');
  let planTitle = '';
  if (pd) planTitle = 'Phấn đấu đạt loại III';
  else if (b === CHAN_MAY_KEY) planTitle = 'Xã định hướng nâng lên phường';
  else if (plan !== '—') planTitle = 'Theo QĐ 756';
  const htTitle = ht
    ? `Loại trước chuyển tiếp: ${ht.before}${ht.rural ? `. ${RURAL_RULE}` : ''}`
    : '';
  return { ht: ht ? ht.level : '—', htTitle, plan, planTitle, note: pd ? pd.note : '' };
}

function checkBare(names, label) {
  const seen = new Set();
  for (const name of names) {
    const b = bareName(name);
    if (seen.has(b)) throw new Error(`Trùng ${label}: ${name}`);
    seen.add(b);
    mustWard(name);
  }
}

checkBare(PLAN_2030_II, '2030 II');
checkBare(PLAN_2030_III, '2030 III');
checkBare(PLAN_2030_PD.map(w => w.name), '2030 phấn đấu');
checkBare(HT_WARDS.map(w => w.name), 'HT phường');
for (const list of [DOTHI_2030, DOTHI_SAU, HT_GROUPS]) {
  for (const g of list) {
    for (const item of g.rows) {
      if (item.members.length) checkBare(item.members, item.id);
    }
  }
}
