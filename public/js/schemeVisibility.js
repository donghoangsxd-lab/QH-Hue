// Một nguồn sự thật: đồ án nào của cấp đang chọn được hiện ranh, nhãn và lô.
// Droplist, panel lớp và bản đồ đều đọc hàm này. Bỏ chọn một đồ án (hidden) hoặc tắt lớp ranh
// thì đồ án đó biến khỏi danh sách. Đồ án không có hình ranh không tính là ranh đã vẽ.
// level: 'QHC' | 'QHPK' | 'QHCT'. hidden / layerOff: Set tên đồ án (Ten_QH).
// hidden chỉ trong phiên hiện tại (projectLayer không ghi qh_hidden_projects).

export const NO_SCHEME_WARD = 'Chưa xác định phường, xã';

// Danh sách toàn thành phố: mỗi đồ án một dòng. Đồ án liên phường nằm ở phường đang chọn nếu có, không thì ở phường đứng đầu bảng chữ cái.
export function schemeHomeWard(wards, currentWard) {
  const list = (Array.isArray(wards) ? wards : []).map(w => String(w || '').trim()).filter(Boolean);
  if (!list.length) return NO_SCHEME_WARD;
  if (currentWard && list.includes(currentWard)) return currentWard;
  return [...list].sort((a, b) => a.localeCompare(b, 'vi'))[0];
}

// QHPK / QHCT: toàn thành phố thì liệt kê phẳng. Chỉ gom theo phường khi đang chọn phường hoặc phạm vi đô thị / xã.
export function groupSchemesByWard({ ward = null, areaType = null } = {}) {
  if (ward) return true;
  return areaType === 'xa' || areaType === 'dothi' || areaType === 'tdp';
}

export function enabledSchemes(projects, level, hidden, layerOff) {
  if (!level) return [];
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  const off = layerOff instanceof Set ? layerOff : new Set(layerOff || []);
  return (projects || []).filter(p => {
    if (!p || p.level !== level || !p.name) return false;
    if (hide.has(p.name) || off.has(p.name)) return false;
    return !!p.boundary;
  });
}

// Có ranh không phải đang mở nội thất. focused: Ten_QH đang chọn. lots: đồ án được tick.
// hidden: ranh bị tắt (nút mắt), không phải danh sách «đang đóng chi tiết».
export function schemeDetailOpen(name, focused, lots, hidden) {
  if (!name) return false;
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  if (hide.has(name)) return false;
  if (focused && name === focused) return true;
  const open = lots instanceof Set ? lots : new Set(lots || []);
  return open.has(name);
}
