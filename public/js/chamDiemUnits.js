// Danh sách chấm điểm trùng tab Đô thị (quy hoạch Đến 2030 / Sau 2030) và 40 phường, xã.
import { URBANS } from './urbanClass.js';
import { URBANS_VISION } from './urbanVision.js';
import { DVHC_WARDS, DVHC_CITY } from './dvhcStats.js';
import { areaCodeFromName } from './facetStore.js';
import { normMa } from './chamDiemData.js';

const periodOf = (period) => (period === 'vision' ? URBANS_VISION : URBANS);

function membersOf(urban) {
  const names = urban.units && urban.units.length ? urban.units : (urban.partial ? [urban.partial] : []);
  return names.map(ten => ({ ten, ma: normMa(ten) }));
}

export function hueUnit() {
  return { id: 'hue', ma: 'hue', ten: DVHC_CITY.name, cls: 'I', loai: 'hue' };
}

export function dothiUnits(period) {
  return periodOf(period).filter(u => u.id !== 'hue' && !u.city).map(u => ({
    id: u.id,
    ma: normMa(u.id),
    ten: u.name,
    cls: u.cls === 'II' ? 'II' : 'III',
    loai: 'dothi',
    partial: !!u.partial,
    members: membersOf(u)
  }));
}

export function xaUnits(period) {
  const towns = dothiUnits(period);
  return Object.keys(DVHC_WARDS).map(ten => {
    const ma = areaCodeFromName(ten);
    const hits = towns.filter(t => t.members.some(m => m.ma === ma));
    const cls = hits.some(t => t.cls === 'II') ? 'II' : 'III';
    return {
      id: ma,
      ma,
      ten,
      cls,
      loai: 'xa',
      towns: hits.map(t => t.ten),
      note: hits.length ? '' : 'Chưa thuộc đô thị trong danh sách đang chọn; chấm Bảng 2B theo loại III.'
    };
  }).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));
}

export function fullWardName(maOrName) {
  const ma = normMa(maOrName);
  return Object.keys(DVHC_WARDS).find(ten => normMa(ten) === ma) || null;
}
