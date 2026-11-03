// Schema điểm đề xuất theo domain. HTXH khớp OSM TYPE_LABELS; HTKT mã riêng không nhồi form D.

export const HTXH_POINT_TYPES = [
  { code: '1-CV', label: '1. Công viên, điểm xanh, vườn hoa' },
  { code: '2-BDX', label: '2. Bãi đỗ xe, trạm sạc xe điện' },
  { code: '3-MN', label: '3. Trường Mầm non' },
  { code: '4-TH', label: '4. Trường Tiểu học' },
  { code: '5-THCS', label: '5. Trường THCS' },
  { code: '6-THPT', label: '6. Trường THPT' },
  { code: '7-YT', label: '7. Bệnh viện, Trạm y tế' },
  { code: '8-VH', label: '8. Nhà văn hóa, thể thao' },
  { code: '9-TM', label: '9. Chợ, Trung tâm thương mại' },
  { code: '10-PCCC', label: '10. Trụ sở cảnh sát PCCC' },
  { code: '11-NT', label: '11. Nhà tang lễ, nghĩa trang' },
  { code: '12-CSD', label: '12. Cơ sở chưa sử dụng' },
  { code: '13-BUS', label: '13. Trạm dừng xe buýt' }
];

/** Mã OSM Admin nhập — phải là tập con HTXH_POINT_TYPES. */
export const OSM_TYPE_CODES = ['13-BUS', '10-PCCC', '11-NT', '8-VH'];

export const HTKT_POINT_TYPES = [
  { code: '15-GT', label: 'Giao thông — công trình điểm', sector: 'giao-thong' },
  { code: '16-CN', label: 'Cấp nước — nhà máy, trạm bơm', sector: 'cap-nuoc' },
  { code: '17-CD', label: 'Cấp điện — trạm biến áp', sector: 'cap-dien' },
  { code: '18-SM', label: 'San nền / thoát mưa — công trình điểm', sector: 'san-nen-thoat-mua' },
  { code: '19-XL', label: 'Thoát nước thải — trạm XLNT', sector: 'thoat-nuoc-thai' },
  { code: '20-CTR', label: 'Chất thải rắn — điểm tập kết, xử lý', sector: 'chat-thai-ran-nghia-trang' },
  { code: '21-TT', label: 'Viễn thông — trạm, cột', sector: 'thong-tin-lien-lac' }
];

export const KT_POINT_TYPES = [
  { code: 'KT-GT', label: 'Công trình kiến trúc Pháp / có giá trị' }
];

export const POINT_DOMAINS = {
  htxh: { id: 'htxh', label: 'Hạ tầng xã hội', types: HTXH_POINT_TYPES, prefix: 'new', action: 'addPoint' },
  htkt: { id: 'htkt', label: 'Hạ tầng kỹ thuật', types: HTKT_POINT_TYPES, prefix: 'htkt', action: 'addPoint' },
  'kien-truc': { id: 'kien-truc', label: 'Kiến trúc', types: KT_POINT_TYPES, prefix: 'kt', action: 'addKienTruc' }
};

export const HTKT_POINT_CODES = HTKT_POINT_TYPES.map(t => t.code);

export function typesForDomain(domain) {
  return (POINT_DOMAINS[domain] && POINT_DOMAINS[domain].types) || [];
}

export function pointTypeOf(domain, code) {
  return typesForDomain(domain).find(t => t.code === code) || null;
}

export function typeOptionsHtml(domain, selected) {
  return typesForDomain(domain).map(t => {
    const on = selected ? t.code === selected : false;
    return `<option value="${t.code}"${on ? ' selected' : ''}>${t.label}</option>`;
  }).join('');
}

/** DOM id theo prefix form (new / htkt / kt). */
export function pointFieldIds(prefix) {
  return {
    type: `${prefix}Type`,
    nhom: `${prefix}NhomHaTang`,
    name: `${prefix}Name`,
    lat: `${prefix}Lat`,
    lng: `${prefix}Lng`,
    ward: `${prefix}Ward`,
    size: `${prefix}Size`,
    phase: `${prefix}Phase`,
    radius: `${prefix}Radius`,
    status: prefix === 'new' ? 'statusMsg' : `${prefix}Status`,
    submit: prefix === 'new' ? 'btnSubmitNewPoint' : `btnSubmit${prefix[0].toUpperCase()}${prefix.slice(1)}Point`
  };
}
