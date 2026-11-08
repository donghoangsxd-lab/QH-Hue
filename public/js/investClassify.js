// Phân nhóm dự án kêu gọi đầu tư (sheet 15-DA) theo lĩnh vực / tên.
// groupId admin (override) luôn thắng quy tắc tự động.
// Sáu tab UI; id cũ nangluong/chungcu map về congnghiep/khudothi.
// Trong DVTM chia nhóm con để danh sách và lớp bản đồ nhẹ hơn.

export const INVEST_GROUPS = [
  { id: 'dvtm', label: 'Dịch vụ, thương mại', title: 'Dịch vụ, thương mại' },
  { id: 'congnghiep', label: 'Công nghiệp, năng lượng', title: 'Công nghiệp, năng lượng' },
  { id: 'khudothi', label: 'Đô thị, nhà ở', title: 'Đô thị, nhà ở' },
  { id: 'nongnghiep', label: 'Nông nghiệp', title: 'Nông nghiệp' },
  { id: 'vanhoaxahoi', label: 'Văn hóa - Y tế - Giáo dục', title: 'Văn hóa - Y tế - Giáo dục' },
  { id: 'khac', label: 'Dự án khác', title: 'Dự án khác' }
];

/** Id nhóm đã bỏ khỏi tab (vẫn chấp nhận từ chỉnh sửa cũ). */
export const INVEST_GROUP_LEGACY = {
  nangluong: 'congnghiep',
  chungcu: 'khudothi'
};

/** Nhóm con trong tab Dịch vụ, thương mại. Mặc định chỉ bật nhóm 1 (sân gôn) trên bản đồ. */
export const DVTM_SUBGROUPS = [
  { id: 'sangon', label: 'Sân gôn', title: 'Dự án sân gôn', icon: 'terrain' },
  { id: 'khachsan', label: 'Khách sạn', title: 'Dự án khách sạn', icon: 'tour' },
  { id: 'dulich', label: 'Khu du lịch', title: 'Dự án khu du lịch', icon: 'map' },
  { id: 'xang', label: 'Cửa hàng xăng dầu', title: 'Dự án cửa hàng xăng dầu', icon: 'pin' },
  { id: 'dvtm-khac', label: 'Thương mại dịch vụ khác', title: 'Dự án thương mại dịch vụ khác', icon: 'shop' }
];

export const DVTM_SUB_DEFAULT = 'sangon';

const GROUP_IDS = new Set(INVEST_GROUPS.map(g => g.id));
const DVTM_SUB_IDS = new Set(DVTM_SUBGROUPS.map(g => g.id));

export function normalizeInvestGroupId(id) {
  const raw = String(id || '');
  const mapped = INVEST_GROUP_LEGACY[raw] || raw;
  return GROUP_IDS.has(mapped) ? mapped : '';
}

export function isInvestGroupId(id) {
  return !!normalizeInvestGroupId(id);
}

export function isDvtmSubId(id) {
  return DVTM_SUB_IDS.has(String(id || ''));
}

export function investGroupLabel(id) {
  const key = normalizeInvestGroupId(id) || 'khac';
  return INVEST_GROUPS.find(g => g.id === key)?.label || 'Dự án khác';
}

export function dvtmSubLabel(id) {
  return DVTM_SUBGROUPS.find(g => g.id === id)?.label || DVTM_SUBGROUPS[DVTM_SUBGROUPS.length - 1].label;
}

function field(row, re) {
  if (!row) return '';
  const key = Object.keys(row).find(k => re.test(k) && !String(k).startsWith('_'));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

/**
 * Phân loại con trong DVTM theo tên.
 * Thứ tự: xăng dầu → sân gôn → khách sạn → khu du lịch → còn lại.
 */
export function classifyDvtmSub(row, name) {
  const ten = String(name || field(row, /tên dự án/i) || '').toLowerCase();
  const lv = field(row, /lĩnh vực/i).toLowerCase();
  if (/xăng|petrol|\bgas\b|cửa hàng xăng|kho xăng|trạm[^,]{0,12}xăng|chiết nạp/.test(ten)) return 'xang';
  if (/sân\s*gôn|sân\s*golf|\bgolf\b/.test(ten)) return 'sangon';
  if (/khách sạn|\bhotel\b/.test(ten)) return 'khachsan';
  if (/khu du lịch|du lịch sinh thái|ddl\s*\d|\bdu lịch\b|nghỉ dưỡng|\bresort\b/.test(ten)) return 'dulich';
  if (/^du lịch$/.test(lv)) return 'dulich';
  return 'dvtm-khac';
}

/**
 * row: dòng sheet (có thể null). name: tên dự án dự phòng.
 * override: groupId admin đã lưu (nếu hợp lệ / legacy thì trả về id chuẩn hóa).
 */
export function classifyInvestGroup(row, name, override) {
  const forced = normalizeInvestGroupId(override);
  if (forced) return forced;
  const lv = field(row, /lĩnh vực/i).toLowerCase();
  const ten = String(name || field(row, /tên dự án/i) || '').toLowerCase();

  if (/cảng biển/.test(lv) || /hạ tầng kỹ thuật/.test(lv)) return 'khac';
  if (/dịch vụ đô thị/.test(lv)) return 'khac';
  if (/công nghệ thông tin|cntt/.test(lv)) return 'khac';
  if (/;/.test(lv) && /bđs|bất động sản/.test(lv) && /thương mại|dịch vụ|du lịch/.test(lv)) return 'khac';

  // Nhà ở / đô thị theo tên: thắng lĩnh vực giáo dục–y tế–văn hóa (vd. nhà ở sinh viên).
  // Không dùng \\b quanh chữ có dấu (JS coi «ở» là non-word). Tránh khớp «khu nhà đất / nhà khách».
  if (/chung cư|nhà ở|ký túc\s*xá|noxh|căn hộ|nhà liền kề|nhà thấp tầng/.test(ten)) {
    return 'khudothi';
  }
  if (/^khu đô thị|^khu dân cư|khu tái định cư/.test(ten)) return 'khudothi';

  if (/năng lượng/.test(lv)) return 'congnghiep';
  if (/công nghiệp/.test(lv)) return 'congnghiep';
  if (/nông nghiệp/.test(lv)) return 'nongnghiep';
  if (/giáo dục|đào tạo|văn h[oó]a|thể thao|y tế/.test(lv)) return 'vanhoaxahoi';

  if (/bất động sản|^đô thị$/.test(lv) || /\bđô thị\b/.test(lv)) return 'khudothi';

  if (/thương mại|du lịch|dịch vụ|cảng biển/.test(lv) && !/dịch vụ đô thị|cảng biển/.test(lv)) return 'dvtm';
  if (/thương mại|du lịch|\bdịch vụ\b/.test(lv)) return 'dvtm';

  return 'khac';
}
