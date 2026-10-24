// Bán kính công trình quy hoạch (đồ án): chỉ số có trong tab Sheet BanKinhQuyHoach.
// Bản tĩnh public/data/htkt/ban-kinh-quy-hoach.json. Ô trống → null, giao diện ghi «—».
import { subtypeOf } from './htktModel.js';
import { withAssetVersion } from './gbaVersion.js';

let rows = [];

export function setPlanRadii(list) {
  rows = Array.isArray(list) ? list : [];
}

export function getPlanRadii() {
  return rows;
}

export function planRadiusM(list, layer) {
  if (!layer) return null;
  const sub = subtypeOf(layer);
  const hit = (list || []).find(row => row
    && row.maDoAn === layer.scheme
    && row.nhom === layer.sector
    && row.subtype === sub);
  if (!hit || hit.banKinh == null || String(hit.banKinh).trim() === '') return null;
  const n = Number(String(hit.banKinh).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function formatRadius(meters) {
  if (meters == null || !Number.isFinite(Number(meters))) return '—';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(meters))} m`;
}

export async function loadPlanRadii(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return rows;
  try {
    const href = typeof document !== 'undefined'
      ? withAssetVersion('data/htkt/ban-kinh-quy-hoach.json')
      : 'data/htkt/ban-kinh-quy-hoach.json';
    const res = await doFetch(href);
    if (!res.ok) return rows;
    const doc = await res.json();
    setPlanRadii(doc && doc.rows);
  } catch (err) {
    setPlanRadii([]);
  }
  return rows;
}
