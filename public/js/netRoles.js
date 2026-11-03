// Role bản vẽ mạng HTKT — khớp services/netRoles.js (test-entry-roles.mjs).
// San nền + thoát mưa → ht/qh-san-nen. Thoát nước thải → ht/qh-thoat-thai.
// ht/qh-thoat-nuoc chỉ đọc lớp cũ, không map từ SECTORS khi nhập mới.

export const ENTRY_NET_ROLE = {
  'giao-thong:hien-trang': 'ht-giao-thong',
  'giao-thong:quy-hoach': 'qh-giao-thong',
  'cap-nuoc:hien-trang': 'ht-cap-nuoc',
  'cap-nuoc:quy-hoach': 'qh-cap-nuoc',
  'cap-dien:hien-trang': 'ht-cap-dien',
  'cap-dien:quy-hoach': 'qh-cap-dien',
  'san-nen-thoat-mua:hien-trang': 'ht-san-nen',
  'san-nen-thoat-mua:quy-hoach': 'qh-san-nen',
  'thoat-nuoc-thai:hien-trang': 'ht-thoat-thai',
  'thoat-nuoc-thai:quy-hoach': 'qh-thoat-thai',
  'chat-thai-ran-nghia-trang:hien-trang': 'ht-chat-thai',
  'chat-thai-ran-nghia-trang:quy-hoach': 'qh-chat-thai',
  'thong-tin-lien-lac:hien-trang': 'ht-vien-thong',
  'thong-tin-lien-lac:quy-hoach': 'qh-vien-thong'
};

export const NET_ROLES = [
  'ht-giao-thong', 'qh-giao-thong',
  'ht-cap-nuoc', 'qh-cap-nuoc',
  'ht-thoat-nuoc', 'qh-thoat-nuoc',
  'ht-cap-dien', 'qh-cap-dien',
  'ht-san-nen', 'qh-san-nen',
  'ht-thoat-thai', 'qh-thoat-thai',
  'ht-chat-thai', 'qh-chat-thai',
  'ht-vien-thong', 'qh-vien-thong'
];
