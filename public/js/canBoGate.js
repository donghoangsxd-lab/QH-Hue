// Đối chiếu email tab CanBo. Cùng luật với apps-script/Code.gs (canBoUnitsFor_).
import { CANBO_UNITS, canBoLabel } from './canBoUnits.js';

export function unitIdOf(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return '';
  const cut = raw.split(' — ')[0].trim();
  return cut;
}

export function statusOn(value) {
  return value === true || String(value == null ? '' : value).trim().toUpperCase() === 'TRUE';
}

export function unitsForEmail(rows, email) {
  const want = String(email || '').trim().toLowerCase();
  const units = [];
  let name = '';
  (rows || []).forEach(row => {
    const mail = String(row.email || '').trim().toLowerCase();
    if (!want || mail !== want || !statusOn(row.status)) return;
    const id = unitIdOf(row.unit);
    if (!id || units.includes(id)) return;
    if (!name) name = String(row.name || '').trim();
    units.push(id);
  });
  return { name, units };
}

export function canBoLabels() {
  return CANBO_UNITS.map(canBoLabel);
}
