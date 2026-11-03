// Kernel dùng chung cho sáu trục đề xuất: auth, POST, nhánh Admin ghi thẳng / CanBo stage.
import { state } from './state.js';
import { geeApi } from './api.js';
import { officerCanEdit } from './urbanInputs.js';

export function isAdminEntry() {
  return state.currentUserRole === 'ADMIN' && !!state.authToken;
}

export function allowedEntryKeys() {
  if (isAdminEntry()) return null;
  return Array.isArray(state.entryUnits) ? state.entryUnits : [];
}

export function isEntrySignedIn() {
  return isAdminEntry() || (Array.isArray(state.entryUnits) && !!state.authToken);
}

export function entryOfficerName() {
  return (state.authUser && (state.authUser.name || state.authUser.email)) || '';
}

export async function postEntry(action, body = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false || data.error) {
    throw new Error(data.message || data.error || `Lỗi ${res.status}`);
  }
  return data;
}

/** unitKey null = không khóa đơn vị (Admin). */
export function assertOfficerUnit(unitKey) {
  if (officerCanEdit(unitKey || '')) return { ok: true };
  return { ok: false, message: 'Đăng nhập cán bộ hoặc quản trị, đúng đơn vị được giao.' };
}

/**
 * Admin chạy adminFn; người khác chạy stageFn (thường submitChoDuyet*).
 * Trả { staged, data }.
 */
export async function stageOrPublish({ adminFn, stageFn }) {
  if (isAdminEntry()) {
    const data = await adminFn();
    return { staged: false, data };
  }
  if (typeof stageFn !== 'function') throw new Error('Cần đăng nhập quản trị hoặc gửi hàng chờ.');
  const data = await stageFn();
  return { staged: true, data };
}
