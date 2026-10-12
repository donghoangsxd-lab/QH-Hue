// Quy hoạch chung (QHC): lớp quy hoạch trung gian, cấp dưới của Quy hoạch thành phố (Quyết định 756/QĐ-UBND — hệ thống đô thị
// sau 2030) và cấp trên của quy hoạch phân khu 1/2.000. QHC xác lập chỉ tiêu phân loại, nâng cấp đô thị
// (Nghị quyết 111/2025/UBTVQH15), là thước đo mức trưởng thành đô thị và căn cứ lập QHPK bên dưới.
// Nhu cầu lập quy hoạch (Sở Xây dựng):
//  - QHC thành phố Huế (loại I) cho toàn thành phố: vùng đô thị lõi trung tâm nghiên cứu ở tỷ lệ 1/10.000, các vùng còn lại 1/25.000.
//    Vùng lõi gồm khu vực trung tâm, Hương Thủy (loại II), Hương Trà (loại III) và mở rộng hết Hóa Châu, Mỹ Thượng (loại III,
//    sau này nhập khu vực trung tâm loại II); không lập QHC riêng, chỉ tiêu từng khu vực do QHC thành phố Huế quy định.
//  - Đô thị vệ tinh Phong Điền, Chân Mây (loại III) lập QHC riêng; QHC Chân Mây lập hết xã Vinh Lộc, Phú Lộc để mở rộng lên loại II.
//  - QHC đô thị loại III: Quảng Điền, A Lưới (lập hết xã A Lưới 3 để mở rộng), Phú Hồ, Phú Vinh, Phú Vang, Hưng Lộc, Khe Tre.
// Hồ sơ QHC tạm lưu tĩnh ở RECORDS (chưa đồng bộ Sheet/GCS); trường null = chưa có số liệu, giao diện ghi "chưa cập nhật".
// Ranh phạm vi dựng sẵn bằng scripts/build-general-plan.js (data/generalPlan.geojson, id = id mục hoặc CORE_ZONE_ID).
// Không phụ thuộc DOM / Leaflet: giao diện ở generalPlanUi.js, cách đo Bảng 2A truyền vào qua ctx.measure2A (urbanClass.js).
import { URBANS_VISION, VISION_REF, VISION_CLAUSE, visionLevel } from './urbanVision.js';
import { bareName, wardLevel614, URBANS_614 } from './urbanStatus.js';

// Cấp đồ án quyết định bộ ký hiệu (tab Chú giải). Mọi đồ án hiện có là QHPK 1/2.000; chỉ tên bắt đầu bằng "QHC"
// (không phải QHCT / QHCPK) hoặc "Quy hoạch chung" mới xếp vào QHC 1/10.000
export const PLAN_LEVELS = [
  { key: 'QHPK', label: 'QHPK 1/2.000', title: 'Quy hoạch phân khu tỷ lệ 1/2.000' },
  { key: 'QHC', label: 'QHC 1/10.000', title: 'Quy hoạch chung đô thị tỷ lệ 1/10.000' }
];
const QHC_NAME_RE = /^\s*(QHC(?![A-Z])|quy hoạch chung(\s|$))/i;
export const planLevelOf = (name) => (QHC_NAME_RE.test(String(name || '')) ? 'QHC' : 'QHPK');

export const GP_PARENT_REF = `${VISION_REF}, ${VISION_CLAUSE}`;
// detail = Ten_QH; projectLayer.js mở đồ án (phóng tới, thông tin ở panel dưới) và chỉ trong danh sách
export const OPEN_PROJECT_EVENT = 'qh:open-project';
// Phạm vi đô thị chọn ở mục Đô thị (generalPlanUi.js): detail = { id, name, geometry, city } hoặc null khi bỏ chọn
export const GP_SCOPE_EVENT = 'qh:gp-scope';
// Đô thị đang chọn ở lớp Hệ thống đô thị (urbanFocus.js): detail = khóa ('u:<id>' chọn trên bản đồ, 'gp:<id>' từ mục Đô thị) hoặc null
export const URBAN_FOCUS_EVENT = 'qh:urban-focus';
export const CORE_ZONE_ID = 'hue-core';

export const GP_STATUS = {
  unknown: 'Chưa cập nhật',
  none: 'Chưa lập',
  drafting: 'Đang lập',
  review: 'Đang thẩm định',
  approved: 'Đã phê duyệt',
  revising: 'Đang điều chỉnh'
};

export const GP_KINDS = {
  city: 'QHC thành phố',
  satellite: 'QHC đô thị vệ tinh',
  town: 'QHC đô thị loại III'
};

// vision = id đô thị sau 2030 trong urbanVision.js (đối chiếu QĐ 756); future = phạm vi lập rộng hơn đô thị hiện nay để mở rộng sau;
// scope614 = ranh phạm vi tạm lấy theo ranh đô thị hiện trạng (data/urban614.geojson) thay cho ghép phường, xã
const PLAN_DEFS = [
  { id: 'hue', kind: 'city', cls: 'I', short: 'Thành phố Huế', name: 'Quy hoạch chung thành phố Huế', vision: 'hue' },
  { id: 'phong-dien', kind: 'satellite', cls: 'III', short: 'Phong Điền', vision: 'phong-dien', scope614: 'phong-dien',
    units: ['Phong Điền', 'Phong Thái', 'Phong Dinh', 'Phong Phú', 'Phong Quảng'] },
  { id: 'chan-may', kind: 'satellite', cls: 'III', short: 'Chân Mây', vision: 'chan-may',
    units: ['Chân Mây - Lăng Cô', 'Vinh Lộc', 'Phú Lộc'],
    future: { cls: 'II', note: 'Lập đến hết xã Vinh Lộc, Phú Lộc để sau này mở rộng đô thị lên loại II' } },
  { id: 'quang-dien', kind: 'town', cls: 'III', short: 'Quảng Điền', vision: 'quang-dien', units: ['Quảng Điền'] },
  { id: 'a-luoi', kind: 'town', cls: 'III', short: 'A Lưới', vision: 'a-luoi', units: ['A Lưới 2', 'A Lưới 3'],
    future: { cls: 'III', note: 'Lập đến hết xã A Lưới 3 để sau này mở rộng đô thị (loại III)' } },
  { id: 'phu-ho', kind: 'town', cls: 'III', short: 'Phú Hồ', vision: null, units: ['Phú Hồ'] },
  { id: 'phu-vinh', kind: 'town', cls: 'III', short: 'Phú Vinh', vision: 'vinh-thanh', units: ['Phú Vinh'] },
  { id: 'phu-vang', kind: 'town', cls: 'III', short: 'Phú Vang', vision: 'phu-da', units: ['Phú Vang'] },
  { id: 'hung-loc', kind: 'town', cls: 'III', short: 'Hưng Lộc', vision: 'loc-son', units: ['Hưng Lộc'] },
  { id: 'khe-tre', kind: 'town', cls: 'III', short: 'Khe Tre', vision: 'khe-tre', units: ['Khe Tre'] }
];

// Khu vực đô thị trong vùng lõi QHC thành phố Huế (tỷ lệ 1/10.000)
const CORE_AREA_DEFS = [
  { id: 'trung-tam', cls: 'II', name: 'Khu vực đô thị trung tâm', vision: 'trung-tam',
    units: ['Kim Long', 'Thủy Xuân', 'An Cựu', 'Thuận Hóa', 'Vỹ Dạ', 'Hương An', 'Phú Xuân', 'Dương Nỗ', 'Thuận An'] },
  { id: 'hoa-chau', cls: 'III', name: 'Đô thị Hóa Châu', vision: 'trung-tam', units: ['Hóa Châu'],
    future: { cls: 'II', note: 'Sau này nhập vào khu vực đô thị trung tâm (loại II)' } },
  { id: 'my-thuong', cls: 'III', name: 'Đô thị Mỹ Thượng', vision: 'trung-tam', units: ['Mỹ Thượng'],
    future: { cls: 'II', note: 'Sau này nhập vào khu vực đô thị trung tâm (loại II)' } },
  { id: 'huong-thuy', cls: 'II', name: 'Khu vực đô thị Hương Thủy', vision: 'huong-thuy', units: ['Thanh Thủy', 'Phú Bài', 'Hương Thủy'] },
  { id: 'huong-tra', cls: 'III', name: 'Khu vực đô thị Hương Trà', vision: 'huong-tra', units: ['Hương Trà', 'Kim Trà', 'Bình Điền'] }
];

// Hồ sơ theo id. Trường điền khi có hồ sơ:
//  status: khóa GP_STATUS; decision: { no, date, by } quyết định phê duyệt; horizon: { base, target, vision } năm;
//  scale: tỷ lệ bản vẽ (mặc định 1/10.000); tenQH: tên đồ án QHC trong danh mục Quy hoạch khi đã nạp ranh lô;
//  targets: chỉ tiêu QHC xác lập cho năm mục tiêu — pop (người), builtHa (ha đất xây dựng đô thị), roads (km/km²),
//  service (m² đất dịch vụ công cộng/người), edu, commerce (công trình), greenCap (m² cây xanh công cộng/người), green2 (khu ≥ 2 ha).
// Khu vực vùng lõi chỉ có targets (do QHC thành phố Huế quy định); trạng thái, quyết định theo QHC thành phố Huế.
const rec = (extra = {}) => ({ status: 'unknown', decision: null, horizon: null, tenQH: null, targets: {}, ...extra });
const RECORDS = {
  hue: rec({ scale: '1/10.000 vùng lõi · 1/25.000 vùng còn lại' }),
  'phong-dien': rec(),
  'chan-may': rec(),
  'quang-dien': rec(),
  'a-luoi': rec(),
  'phu-ho': rec(),
  'phu-vinh': rec(),
  'phu-vang': rec(),
  'hung-loc': rec(),
  'khe-tre': rec(),
  'trung-tam': rec(),
  'hoa-chau': rec(),
  'my-thuong': rec(),
  'huong-thuy': rec(),
  'huong-tra': rec()
};

const visionOf = (id) => (id ? URBANS_VISION.find(u => u.id === id) || null : null);

function nowOf(units, city) {
  if (city) return URBANS_614.filter(u => u.city);
  const want = new Set(units.map(bareName));
  return URBANS_614.filter(u => !u.city && (u.units || []).some(n => want.has(bareName(n))));
}

function entry(def, r, parent = null) {
  const vision = visionOf(def.vision);
  const units = def.units || [];
  const city = def.kind === 'city';
  return {
    ...def,
    units,
    city,
    parent,
    vision,
    // Loại định hướng: theo phạm vi mở rộng nêu ở nhu cầu lập quy hoạch, không có thì theo đô thị sau 2030 (QĐ 756)
    target: (def.future && def.future.cls) || (vision && vision.cls) || def.cls,
    now: nowOf(units, city),
    scale: r.scale === undefined ? '1/10.000' : r.scale,
    status: parent ? parent.status : (GP_STATUS[r.status] ? r.status : 'unknown'),
    decision: parent ? null : r.decision,
    horizon: parent ? null : r.horizon,
    tenQH: parent ? null : r.tenQH,
    targets: r.targets || {}
  };
}

export const GENERAL_PLANS = PLAN_DEFS.map(def => ({
  ...entry(def, RECORDS[def.id] || rec()),
  name: def.name || `Quy hoạch chung đô thị ${def.short}`
}));

const CITY_PLAN = GENERAL_PLANS.find(p => p.city);

export const CORE_AREAS = CORE_AREA_DEFS.map(def => ({
  ...entry(def, RECORDS[def.id] || rec(), CITY_PLAN),
  short: def.name.replace(/^(Khu vực đô thị|Đô thị)\s+/, '').replace(/^trung tâm$/, 'Trung tâm'),
  scale: '1/10.000 (vùng lõi)'
}));

// Vùng lõi 1/10.000 và các vùng còn lại 1/25.000 của QHC thành phố Huế; units vùng còn lại tính theo bảng phường (outerUnits)
CITY_PLAN.zones = [
  { id: CORE_ZONE_ID, name: 'Vùng đô thị lõi trung tâm', scale: '1/10.000', units: CORE_AREAS.flatMap(a => a.units), areas: CORE_AREAS },
  { id: 'hue-outer', name: 'Các vùng còn lại', scale: '1/25.000' }
];

export const generalPlanOf = (id) => GENERAL_PLANS.find(p => p.id === id) || CORE_AREAS.find(a => a.id === id) || null;

export function outerUnits(wards = []) {
  const core = new Set(CITY_PLAN.zones[0].units.map(bareName));
  return wards.map(w => w.Ten_Phuong).filter(n => n && !core.has(bareName(n)));
}

/** QHC riêng hoặc khu vực vùng lõi chứa phường, xã này (không tính QHC thành phố Huế vì phủ mọi đơn vị). */
export function generalPlansOfWard(wardName) {
  const b = bareName(wardName);
  if (!b) return [];
  return [...GENERAL_PLANS.filter(p => !p.city), ...CORE_AREAS].filter(p => p.units.some(n => bareName(n) === b));
}

/** Phường, xã thuộc phạm vi; toàn thành phố lấy từ bảng thống kê phường. */
export function scopeUnits(plan, wards = []) {
  return plan.city ? wards.map(w => w.Ten_Phuong).filter(Boolean) : plan.units;
}

function inScope(plan, projectWards) {
  if (plan.city) return true;
  const want = new Set(plan.units.map(bareName));
  return (projectWards || []).some(w => want.has(bareName(w)));
}

/** Đồ án QHPK 1/2.000 trong phạm vi QHC hoặc khu vực (đồ án liên phường chỉ cần chạm 1 đơn vị). */
export function childProjects(plan, catalog = []) {
  return catalog.filter(p => planLevelOf(p.tenQH) === 'QHPK' && inScope(plan, p.wards));
}

/** Đồ án QHC đã nạp trong danh mục Quy hoạch: khớp tenQH, không có thì tên đồ án cấp QHC chứa tên đô thị. */
export function planProjectOf(plan, catalog = []) {
  if (plan.parent) return null;
  const qhc = catalog.filter(p => planLevelOf(p.tenQH) === 'QHC');
  if (plan.tenQH) return qhc.find(p => p.tenQH === plan.tenQH) || null;
  const key = bareName(plan.short);
  return qhc.find(p => bareName(p.tenQH).includes(key)) || null;
}

export function qhpkCoverage(plan, catalog = [], wards = []) {
  const units = scopeUnits(plan, wards);
  const covered = new Set();
  childProjects(plan, catalog).forEach(p => (p.wards || []).forEach(w => covered.add(bareName(w))));
  return { covered: units.filter(u => covered.has(bareName(u))).length, total: units.length };
}

// ---------- Chỉ số trưởng thành đô thị ----------
// Mỗi chỉ tiêu: hiện trạng / mục tiêu. Mục tiêu lấy chỉ tiêu QHC (targets) nếu đã có, không thì mức tối đa Bảng 2A
// Nghị quyết 111 của loại đô thị định hướng (target — đo mức sẵn sàng nâng cấp). Chỉ tiêu chưa có số liệu không tính vào điểm.
// code = mã tiêu chuẩn Bảng 2A dùng lại cách đo ở urbanClass.js; calc = đo riêng trong module này.
export const MATURITY_GROUPS = [
  { id: 'scale', name: 'Quy mô và mức độ đô thị hóa', items: [
    { id: 'pop', code: '2A.II.03', name: 'Dân số đô thị', unit: 'người' },
    { id: 'urbanWards', calc: 'urbanWards', name: 'Phường, xã đạt trình độ phát triển đô thị', unit: 'đơn vị',
      method: 'Hiện trạng: đơn vị trong Phụ lục II QĐ 614. Mục tiêu: đơn vị được định hướng đạt trình độ phát triển đô thị sau 2030 (QĐ 756).' }
  ] },
  { id: 'tech', name: 'Hạ tầng kỹ thuật', items: [
    { id: 'roads', code: '2A.III.07', name: 'Mật độ đường giao thông đô thị', unit: 'km/km²' }
  ] },
  { id: 'social', name: 'Hạ tầng xã hội', items: [
    { id: 'service', code: '2A.III.19', name: 'Đất dịch vụ công cộng bình quân', unit: 'm²/người' },
    { id: 'edu', code: '2A.III.15', name: 'Cơ sở giáo dục, đào tạo', unit: 'cơ sở' },
    { id: 'commerce', code: '2A.III.18', name: 'Công trình thương mại, dịch vụ', unit: 'công trình' }
  ] },
  { id: 'green', name: 'Cây xanh, không gian công cộng', items: [
    { id: 'greenCap', code: '2A.III.22', name: 'Cây xanh công cộng bình quân', unit: 'm²/người' },
    { id: 'green2', code: '2A.III.20', name: 'Khu xanh công cộng từ 2 ha', unit: 'khu' }
  ] },
  { id: 'plan', name: 'Quy hoạch và quản lý phát triển', items: [
    { id: 'qhc', calc: 'qhcApproved', name: 'Quy hoạch chung được phê duyệt' },
    { id: 'qhpk', calc: 'qhpkCover', name: 'Phường, xã đã có QHPK 1/2.000', unit: 'đơn vị',
      method: 'Đơn vị trong phạm vi có ít nhất 1 đồ án QHPK 1/2.000 trong danh mục Quy hoạch.' },
    { id: 'arch', name: 'Quy chế quản lý kiến trúc đô thị', method: 'Chưa có danh mục quy chế đã ban hành.' }
  ] }
];

// Loại I không chấm Bảng 2A; chỉ dân số có ngưỡng định lượng (1.II.07)
const CITY_REF = { pop: 2500000 };

const levelOf = (ratio) => (ratio == null ? 'wait' : ratio >= 1 ? 'hi' : ratio >= 0.5 ? 'mid' : 'no');

function measureItem(item, plan, ctx) {
  const wards = ctx.wards || [];
  const own = plan.targets[item.id];
  if (item.code) {
    const r = ctx.measure2A ? ctx.measure2A(item.code, { id: `gp-${plan.id}`, cls: plan.city ? 'I' : plan.target, units: plan.units }, wards) : null;
    const m = r && r.m;
    const ref = plan.city ? (CITY_REF[item.id] ?? null) : (r ? r.hi : null);
    const out = { ref, refSrc: ref == null ? null : (plan.city ? 'Phụ lục I' : `Bảng 2A loại ${plan.target}`), own: own ?? null };
    if (!m || m.pending || m.value == null) return { ...out, value: null, note: (m && m.note) || '' };
    return { ...out, value: m.value, lower: !!m.partial, note: m.note || '' };
  }
  if (item.calc === 'urbanWards') {
    const units = scopeUnits(plan, wards);
    return {
      value: units.filter(n => wardLevel614(n)).length,
      ref: units.filter(n => visionLevel(n)).length, refSrc: 'QĐ 756',
      own: own ?? null, note: item.method
    };
  }
  if (item.calc === 'qhpkCover') {
    const c = qhpkCoverage(plan, ctx.catalog, wards);
    return { value: c.total ? c.covered : null, ref: c.total || null, refSrc: 'Phạm vi', own: null, note: item.method };
  }
  if (item.calc === 'qhcApproved') {
    const note = plan.parent ? `Theo ${plan.parent.name}.` : '';
    if (plan.status === 'unknown') return { value: null, ref: 1, own: null, note: `${note} Chưa cập nhật hồ sơ QHC.`.trim() };
    return { value: plan.status === 'approved' ? 1 : 0, ref: 1, own: null, text: GP_STATUS[plan.status], note };
  }
  return { value: null, ref: null, own: null, note: item.method || '' };
}

/** Chấm chỉ số trưởng thành. ctx = { wards, catalog, measure2A(code, scope, wards) → { m, hi } } */
export function maturityOf(plan, ctx = {}) {
  let sum = 0, nGroups = 0, evaluated = 0, total = 0;
  const groups = MATURITY_GROUPS.map(g => {
    const items = g.items.map(item => {
      const r = measureItem(item, plan, ctx);
      const target = r.own ?? r.ref;
      const ratio = r.value != null && target > 0 ? Math.min(1, r.value / target) : null;
      return { item, ...r, target, targetSrc: r.own != null ? 'QHC' : r.refSrc, ratio, level: levelOf(ratio) };
    });
    const done = items.filter(i => i.ratio != null);
    total += items.length;
    evaluated += done.length;
    const pct = done.length ? done.reduce((s, i) => s + i.ratio, 0) / done.length : null;
    if (pct != null) { sum += pct; nGroups++; }
    return { group: g, items, pct, level: levelOf(pct) };
  });
  const pct = nGroups ? sum / nGroups : null;
  return { groups, pct, level: levelOf(pct), evaluated, total };
}
