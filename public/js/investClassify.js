// Phân nhóm dự án kêu gọi đầu tư (sheet 15-DA) theo lĩnh vực / tên.
// groupId admin (override) luôn thắng quy tắc tự động.

export const INVEST_GROUPS = [
  { id: 'dvtm', label: 'DVTM', title: 'Thương mại, dịch vụ và du lịch' },
  { id: 'congnghiep', label: 'Công nghiệp', title: 'Công nghiệp' },
  { id: 'nangluong', label: 'Năng lượng', title: 'Năng lượng' },
  { id: 'khudothi', label: 'Khu đô thị', title: 'Khu đô thị' },
  { id: 'chungcu', label: 'Chung cư', title: 'Chung cư' },
  { id: 'nongnghiep', label: 'Nông nghiệp', title: 'Nông nghiệp' },
  { id: 'vanhoaxahoi', label: 'Văn hóa xã hội', title: 'Văn hóa xã hội' },
  { id: 'khac', label: 'Dự án khác', title: 'Dự án khác' }
];

const GROUP_IDS = new Set(INVEST_GROUPS.map(g => g.id));

export function isInvestGroupId(id) {
  return GROUP_IDS.has(String(id || ''));
}

export function investGroupLabel(id) {
  return INVEST_GROUPS.find(g => g.id === id)?.label || 'Dự án khác';
}

function field(row, re) {
  if (!row) return '';
  const key = Object.keys(row).find(k => re.test(k) && !String(k).startsWith('_'));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

/**
 * row: dòng sheet (có thể null). name: tên dự án dự phòng.
 * override: groupId admin đã lưu (nếu hợp lệ thì trả về luôn).
 */
export function classifyInvestGroup(row, name, override) {
  if (isInvestGroupId(override)) return override;
  const lv = field(row, /lĩnh vực/i).toLowerCase();
  const ten = String(name || field(row, /tên dự án/i) || '').toLowerCase();

  if (/cảng biển/.test(lv) || /hạ tầng kỹ thuật/.test(lv)) return 'khac';
  if (/dịch vụ đô thị/.test(lv)) return 'khac';
  if (/công nghệ thông tin|cntt/.test(lv)) return 'khac';
  if (/;/.test(lv) && /bđs|bất động sản/.test(lv) && /thương mại|dịch vụ|du lịch/.test(lv)) return 'khac';

  if (/năng lượng/.test(lv)) return 'nangluong';
  if (/công nghiệp/.test(lv)) return 'congnghiep';
  if (/nông nghiệp/.test(lv)) return 'nongnghiep';
  if (/giáo dục|đào tạo|văn h[oó]a|thể thao|y tế/.test(lv)) return 'vanhoaxahoi';

  if (/chung cư|nhà ở xã hội|\bnoxh\b/.test(ten)) return 'chungcu';

  if (/bất động sản|^đô thị$/.test(lv) || /\bđô thị\b/.test(lv)) return 'khudothi';
  if (/^khu đô thị|^khu dân cư/.test(ten)) return 'khudothi';

  if (/thương mại|du lịch|dịch vụ|cảng biển/.test(lv) && !/dịch vụ đô thị|cảng biển/.test(lv)) return 'dvtm';
  if (/thương mại|du lịch|\bdịch vụ\b/.test(lv)) return 'dvtm';

  return 'khac';
}
