// Phân nhóm dự án kêu gọi đầu tư (sheet 15-DA) theo lĩnh vực / tên.
// groupId admin (override) luôn thắng quy tắc tự động (sau khi map legacy).
// Droplist F: «Toàn bộ dự án» (all) rồi từng nhóm chi tiết.

/** Tab droplist: hiện mọi dự án / mọi ranh (không phải nhóm admin). */
export const INVEST_TAB_ALL = 'all';

export const INVEST_GROUPS = [
  { id: 'sangon', label: 'Sân gôn', title: 'Sân gôn' },
  { id: 'dulich_tm', label: 'Khu du lịch và thương mại', title: 'Khu du lịch và thương mại' },
  { id: 'khu_cn', label: 'Khu công nghiệp', title: 'Khu công nghiệp' },
  { id: 'cum_cn', label: 'Cụm công nghiệp', title: 'Cụm công nghiệp' },
  { id: 'cnc_dien', label: 'Công nghệ cao và Nhà máy điện', title: 'Công nghệ cao và Nhà máy điện' },
  { id: 'khu_dt', label: 'Khu đô thị', title: 'Khu đô thị' },
  { id: 'kdc_nt', label: 'Khu dân cư nông thôn', title: 'Khu dân cư nông thôn' },
  { id: 'noxh', label: 'Nhà ở xã hội', title: 'Nhà ở xã hội' },
  { id: 'chungcu_tm', label: 'Chung cư thương mại', title: 'Chung cư thương mại' },
  { id: 'nongnghiep', label: 'Nông nghiệp', title: 'Nông nghiệp' },
  { id: 'vanhoaxahoi', label: 'Văn hóa - Y tế - Giáo dục', title: 'Văn hóa - Y tế - Giáo dục' },
  { id: 'benxe', label: 'Bến xe', title: 'Bến xe' },
  { id: 'baido', label: 'Bãi đỗ xe', title: 'Bãi đỗ xe' },
  { id: 'congvien', label: 'Công viên', title: 'Công viên' },
  { id: 'khac', label: 'Dự án khác', title: 'Dự án khác' },
  // Bucket vòng đời (phác thảo → dự án); không suy ra từ lĩnh vực / tên.
  { id: 'dangnghien', label: 'Đang nghiên cứu', title: 'Đang nghiên cứu' }
];

/**
 * Id nhóm cũ (tab thô hoặc nhóm con DVTM) → nhóm chi tiết gần nhất.
 * Admin override cũ vẫn mở được; dữ liệu mới phân lại theo tên/lĩnh vực khi không có override.
 */
export const INVEST_GROUP_LEGACY = {
  dvtm: 'dulich_tm',
  congnghiep: 'khu_cn',
  khudothi: 'khu_dt',
  nangluong: 'cnc_dien',
  chungcu: 'chungcu_tm',
  khachsan: 'dulich_tm',
  dulich: 'dulich_tm',
  xang: 'dulich_tm',
  'dvtm-khac': 'dulich_tm'
};

const GROUP_IDS = new Set(INVEST_GROUPS.map(g => g.id));

export function normalizeInvestGroupId(id) {
  const raw = String(id || '');
  const mapped = INVEST_GROUP_LEGACY[raw] || raw;
  return GROUP_IDS.has(mapped) ? mapped : '';
}

export function isInvestGroupId(id) {
  return !!normalizeInvestGroupId(id);
}

export function investGroupLabel(id) {
  const key = normalizeInvestGroupId(id) || 'khac';
  return INVEST_GROUPS.find(g => g.id === key)?.label || 'Dự án khác';
}

function field(row, re) {
  if (!row) return '';
  const key = Object.keys(row).find(k => re.test(k) && !String(k).startsWith('_'));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
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

  // Tên cụ thể trước lĩnh vực (ưu tiên tách từ «Dự án khác» / nhóm thô cũ).
  // Không dùng \\b quanh chữ có dấu (JS coi «ư/ộ» là non-word).
  if (/sân\s*gôn|sân\s*golf|golf/.test(ten)) return 'sangon';
  if (/bến\s*xe/.test(ten)) return 'benxe';
  if (/bãi\s*đỗ|bãi\s*đậu|đỗ\s*xe|đậu\s*xe|bãi\s*xe/.test(ten)) return 'baido';
  if (/công\s*viên/.test(ten)) return 'congvien';

  if (/nhà\s*máy\s*điện|điện\s*mặt\s*trời|điện\s*gió|nhiệt\s*điện/.test(ten)) return 'cnc_dien';
  if (/cụm\s*công\s*nghiệp|ccn\b/.test(ten)) return 'cum_cn';
  if (/khu\s*công\s*nghiệp|kcn\b/.test(ten)) return 'khu_cn';

  if (/nhà\s*ở\s*xã\s*hội|noxh|nhà\s*ở\s*cho\s*thuê|ký\s*túc\s*xá/.test(ten)) return 'noxh';
  if (/chung\s*cư|căn\s*hộ/.test(ten)) return 'chungcu_tm';
  if (/khu\s*dân\s*cư\s*nông\s*thôn|dân\s*cư\s*nông\s*thôn/.test(ten)) return 'kdc_nt';
  if (/khu\s*dân\s*cư/.test(ten) && !/đô\s*thị/.test(ten)) return 'kdc_nt';
  if (/khu\s*đô\s*thị|kdt\b|khu\s*tái\s*định\s*cư/.test(ten)) return 'khu_dt';
  if (/nhà\s*ở|nhà\s*liền\s*kề|nhà\s*thấp\s*tầng/.test(ten)) return 'khu_dt';

  if (/khách\s*sạn|hotel|khu\s*du\s*lịch|nghỉ\s*dưỡng|resort|thương\s*mại|siêu\s*thị|trung\s*tâm\s*thương\s*mại|cửa\s*hàng\s*xăng|kho\s*xăng|petrol/.test(ten)) {
    return 'dulich_tm';
  }

  // Lĩnh vực trước «công nghệ cao» chung (nông nghiệp / y tế CNC vẫn về đúng ngành).
  if (/nông nghiệp/.test(lv)) return 'nongnghiep';
  if (/giáo dục|đào tạo|văn h[oó]a|thể thao|y tế/.test(lv)) return 'vanhoaxahoi';
  if (/năng lượng/.test(lv)) return 'cnc_dien';
  if (/công nghệ thông tin|cntt/.test(lv)) return 'cnc_dien';
  if (/công\s*nghệ\s*cao|khu\s*công\s*nghệ|công\s*nghệ\s*số|phần\s*mềm|công nghệ thông tin/.test(ten)) {
    return 'cnc_dien';
  }
  if (/công nghiệp/.test(lv)) {
    if (/cụm/.test(ten) || /cụm/.test(lv)) return 'cum_cn';
    return 'khu_cn';
  }
  // Lĩnh vực hỗn hợp (nhiều ngành nối ;) giữ «Dự án khác» trừ khi tên đã khớp nhóm cụ thể ở trên.
  if (/;/.test(lv) && /bđs|bất động sản/.test(lv) && /thương mại|dịch vụ|du lịch/.test(lv)) return 'khac';
  if (/bất động sản|^đô thị$/.test(lv) || /đô thị/.test(lv)) return 'khu_dt';
  if (/thương mại|du lịch|dịch vụ/.test(lv) && !/dịch vụ đô thị/.test(lv)) return 'dulich_tm';

  if (/cảng biển|hạ tầng kỹ thuật|dịch vụ đô thị/.test(lv)) return 'khac';

  return 'khac';
}
