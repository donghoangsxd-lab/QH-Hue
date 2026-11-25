// Phân quyền admin cấp 1 (full) / cấp 2 (theo trục A–F).
import { state } from './state.js';

const AXIS_LABEL = {
  hanhchinh: 'Hành chính',
  quyhoach: 'Quy hoạch',
  htkt: 'Hạ tầng kỹ thuật',
  htxh: 'Hạ tầng xã hội',
  kientruc: 'Kiến trúc',
  dautu: 'Dự án đầu tư'
};

export function isFullAdmin() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

export function isAxisAdmin() {
  return state.currentUserRole === 'AXIS_ADMIN' && !!state.authToken;
}

export function isAnyAdmin() {
  return isFullAdmin() || isAxisAdmin();
}

export function canAdminAxis(axis) {
  if (isFullAdmin()) return true;
  if (!isAxisAdmin()) return false;
  return Array.isArray(state.adminAxes) && state.adminAxes.includes(axis);
}

export function adminAxisLabel(axis) {
  return AXIS_LABEL[axis] || axis || '';
}

export function adminAxesLabel() {
  const axes = Array.isArray(state.adminAxes) ? state.adminAxes : [];
  return axes.map(adminAxisLabel).filter(Boolean).join(', ');
}
