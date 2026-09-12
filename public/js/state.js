/**
 * Quản lý trạng thái biến môi trường toàn cục cho ứng dụng Frontend
 */
export const state = {
  // Phân quyền người dùng: 'VIEWER' (mặc định) hoặc 'ADMIN'
  currentUserRole: "VIEWER",

  // Danh sách Email được phép phê duyệt với quyền Admin
  adminEmails: ["donghoangsxd@gmail.com", "admin.sxd@hue.gov.vn"],

  // Danh sách dữ liệu công trình hạ tầng đọc từ Backend
  rawDataList: [],

  // Dữ liệu ma trận thống kê 40 Phường/Xã
  wardStatsData: [],

  // Bán kính Buffer đệm hạ tầng mặc định (mét)
  globalBufferRadius: 500,

  // Bán kính tiếp cận Isochrone Giao thông mặc định (mét)
  isochroneRadius: 500,

  // Layer group lưu giữ các đa giác Isochrone giao thông
  isochroneLayerGroup: null,

  // Trạng thái các chế độ tương tác bản đồ
  isPickMode: false,
  isInspectMode: false,

  // Đo đạc khoảng cách / diện tích
  activeMeasureType: null,
  measurePoints: [],

  // Marker tạm thời trên bản đồ
  tempMarker: null
};

/**
 * Cập nhật quyền người dùng
 */
export function setUserRole(role) {
  state.currentUserRole = role;
}

/**
 * Cập nhật danh sách công trình hạ tầng
 */
export function setRawDataList(data) {
  state.rawDataList = Array.isArray(data) ? data : [];
}

/**
 * Cập nhật ma trận thống kê phường xã
 */
export function setWardStatsData(data) {
  state.wardStatsData = Array.isArray(data) ? data : [];
}

/**
 * Cập nhật bán kính Isochrone tiếp cận giao thông
 */
export function setIsochroneRadius(radius) {
  state.isochroneRadius = Number(radius) || 500;
}
