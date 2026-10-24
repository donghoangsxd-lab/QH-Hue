// Giá trị tự tính khi ô bảng trống. Thiếu đầu vào thì value null, không điền 0 và không kết luận đạt.
import { DVHC_CITY, DVHC_WARDS } from './dvhcStats.js';
import { PART_BOUNDS, partGeomReady, pointInFeature, partFeature } from './urbanPartGeom.js';
import { bareName, wardLevel614 } from './urbanStatus.js';
import { dothiUnits, fullWardName } from './chamDiemUnits.js';
import { fold, scoreStandard, tieuChuan } from './chamDiemCore.js';
import { nguonTieuChi } from './chamDiemNguon.js';
import { isApproved } from './utils.js';
import { layerType } from './state.js';
import { measures } from './hienTrangScore.js';

let noxhItems = null;

export function installNoxhForTest(items) {
  noxhItems = items || [];
}

export async function loadNoxhCounts() {
  if (noxhItems) return noxhItems;
  const base = new URL('../data/gba/', import.meta.url);
  const read = async (file, status) => {
    try {
      const res = await fetch(new URL(file, base));
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(it => ({
        id: it.id,
        ward: it.ward || '',
        status,
        lat: it.lat,
        lng: it.lng
      }));
    } catch (err) {
      return [];
    }
  };
  const [done, plan] = await Promise.all([
    read('apartments.json', 'hoan_thanh'),
    read('noxh-plan.json', 'quy_hoach')
  ]);
  noxhItems = [...done, ...plan];
  return noxhItems;
}

function wardRow(maOrTen) {
  const name = fullWardName(maOrTen) || (DVHC_WARDS[maOrTen] ? maOrTen : null);
  if (!name || !DVHC_WARDS[name]) return null;
  return { name, ...DVHC_WARDS[name] };
}

function popKm(unit) {
  if (unit.loai === 'hue') return { pop: DVHC_CITY.pop, km2: DVHC_CITY.km2, chat: 'du', ghiChu: 'Dân số và diện tích danh sách 40 phường, xã.' };
  if (unit.loai === 'xa') {
    const row = wardRow(unit.ten || unit.ma);
    if (!row) return { pop: null, km2: null, chat: 'thieu', ghiChu: 'Không có dân số phường, xã.' };
    return { pop: row.pop, km2: row.km2, chat: 'du', ghiChu: row.name };
  }
  if (unit.partial) {
    const host = wardRow(unit.members[0] && (unit.members[0].ten || unit.members[0].ma));
    const box = PART_BOUNDS[unit.id];
    if (!host || !box) return { pop: null, km2: null, chat: 'thieu', ghiChu: 'Thiếu dân số xã chủ hoặc diện tích polygon.' };
    return {
      pop: host.pop * box.km2 / host.km2,
      km2: box.km2,
      chat: 'can_duoi',
      ghiChu: `Ước ${host.name}: dân số × ${box.km2} / ${host.km2} km² (PART_BOUNDS).`
    };
  }
  let pop = 0;
  let km2 = 0;
  const names = (unit.members || []).map(m => wardRow(m.ten || m.ma));
  if (!names.length || names.some(r => !r)) return { pop: null, km2: null, chat: 'thieu', ghiChu: 'Thiếu dân số một phường trong phạm vi.' };
  names.forEach(r => { pop += r.pop; km2 += r.km2; });
  return { pop, km2, chat: 'du', ghiChu: `${names.length} phường, xã trong dvhcStats.js.` };
}

function urbanizedPop(period) {
  const seen = new Set();
  let pop = 0;
  let estimated = false;
  for (const town of dothiUnits(period || '2030')) {
    if (town.partial) {
      const host = town.members[0];
      if (!host || seen.has(host.ma)) continue;
      const pk = popKm(town);
      if (pk.pop == null) return null;
      seen.add(host.ma);
      pop += pk.pop;
      estimated = true;
      continue;
    }
    for (const m of town.members) {
      if (seen.has(m.ma)) continue;
      const row = wardRow(m.ten || m.ma);
      if (!row) return null;
      seen.add(m.ma);
      pop += row.pop;
    }
  }
  return { pop, estimated };
}

function reachMin(spec, cls, raw) {
  const scored = scoreStandard(spec, cls, raw);
  return scored.status === 'dat' || scored.status === 'mot_phan' || scored.status === 'dieu8' || scored.status === 'mien';
}

function out(value, chat, ghiChu) {
  return { value, chat, ghiChu };
}

function numOut(spec, cls, value, chat, ghiChu) {
  if (value == null || !Number.isFinite(Number(value))) return out(null, 'thieu', ghiChu);
  const raw = String(Math.round(Number(value) * 1000) / 1000);
  if (chat === 'can_duoi' && !reachMin(spec, cls, raw)) {
    return out(null, 'thieu', `${ghiChu} Cận dưới chưa chạm mức tối thiểu, chưa kết luận.`);
  }
  return out(raw, chat, ghiChu);
}

function pointsOf(unit, ctx) {
  if (!ctx || ctx.points == null) return null;
  if (unit.partial) {
    const feat = partGeomReady() ? partFeature(unit.id) : null;
    if (!feat) return { list: null, ghiChu: 'Chưa có polygon đô thị một phần xã để cắt điểm.' };
    return {
      list: ctx.points.filter(p => isApproved(p.status) && pointInFeature(feat, p.lng, p.lat)),
      ghiChu: 'Điểm đã duyệt nằm trong polygon hiện trạng.'
    };
  }
  const names = new Set();
  if (unit.loai === 'hue') Object.keys(DVHC_WARDS).forEach(n => names.add(bareName(n)));
  else if (unit.loai === 'xa') names.add(bareName(unit.ten));
  else (unit.members || []).forEach(m => {
    const row = wardRow(m.ten || m.ma);
    if (row) names.add(bareName(row.name));
  });
  return {
    list: ctx.points.filter(p => isApproved(p.status) && names.has(bareName(p.ward))),
    ghiChu: 'Điểm hạ tầng đã duyệt trong phạm vi.'
  };
}

function typed(list, pred) {
  return (list || []).filter(pred);
}

function sizes(list) {
  let sum = 0;
  let unknown = 0;
  list.forEach(it => {
    const s = Number(it.size) || Number(it.sizeHT) || 0;
    if (s > 0) sum += s;
    else unknown += 1;
  });
  return { sum, unknown };
}

const sportName = (name) => {
  const s = fold(name).replace(/[^a-z0-9]/g, '');
  return /thethao|theduc|tdtt|sanvandong|sangolf|sanbong|nhathidau|beboi|duongchay|tapluyen|hoboi|stadium|swimming|golf|fitness/.test(s) && !s.includes('vanhoa');
};

const urbanPark = (it) => layerType(it) === '1-CV' && (fold(it.nhomHaTang || '').includes('cap do thi') || /^CV_DT/i.test(String(it.id || '')));

function perPerson(spec, cls, list, pop, chat, ghiChu) {
  if (!(pop > 0)) return out(null, 'thieu', 'Chưa có dân số.');
  const area = sizes(list);
  const next = area.unknown ? 'can_duoi' : chat;
  const note = `${ghiChu} ${area.sum} m² / ${Math.round(pop)} người${area.unknown ? `; ${area.unknown} công trình chưa có diện tích` : ''}.`;
  return numOut(spec, cls, area.sum / pop, next, note);
}

function countOut(spec, cls, n, unknown, ghiChu) {
  const chat = unknown ? 'can_duoi' : 'du';
  return numOut(spec, cls, n, chat, ghiChu);
}

function datToken(ok) {
  return ok ? 'Đạt' : 'Không đạt';
}

function nameHit(list, re) {
  return (list || []).some(it => re.test(fold(it.name || '')));
}

function keywordBonus(list, re, ghiChu) {
  if (!list) return out(null, 'thieu', 'Chưa nạp điểm hạ tầng.');
  if (nameHit(list, re)) return out('Đạt', 'du', ghiChu);
  return out(null, 'thieu', `${ghiChu} Không thấy trong điểm đã duyệt, chưa kết luận không đạt.`);
}

function schoolRatio(pop, schools) {
  if (!(pop > 0)) return null;
  if (schools * 6000 + 1e-9 >= pop) return 'toi_da';
  if (schools * 8000 + 1e-9 >= pop) return 'toi_thieu';
  return 'khong';
}

function htMeasures(unit, ctx) {
  if (!ctx || !ctx.ht) return null;
  return measures(ctx.ht, {
    builtKm2: ctx.builtKm2,
    builtExact: ctx.builtExact !== false && !unit.partial,
    naturalKm2: popKm(unit).km2
  });
}

export function giaTriTuDong(id, unit, ctx = {}) {
  const spec = tieuChuan(id);
  const src = nguonTieuChi(id);
  if (!spec || !src || src.cheDo !== 'tu_dong' || !unit) return out(null, 'thieu', '');
  const cls = unit.cls === 'II' ? 'II' : 'III';
  const pk = popKm(unit);
  const bag = pointsOf(unit, ctx);
  const list = bag && bag.list;

  if (id === '1.II.07') {
    return out(datToken(DVHC_CITY.pop >= 2500000), 'du', `Dân số thành phố ${DVHC_CITY.pop} người.`);
  }
  if (id === '1.II.08') {
    const got = urbanizedPop(ctx.period);
    if (!got || !(DVHC_CITY.pop > 0)) return out(null, 'thieu', 'Chưa đủ dân số đô thị.');
    const pct = got.pop / DVHC_CITY.pop * 100;
    if (got.estimated && pct < 45) return out(null, 'thieu', `Cận dưới ${pct.toFixed(1)}% chưa đủ 45%, chưa kết luận.`);
    return out(datToken(pct >= 45), got.estimated ? 'can_duoi' : 'du', `Tỷ lệ đô thị hóa ${pct.toFixed(1)}%.`);
  }
  if (id === '1.II.09') {
    let pop = 0;
    for (const town of dothiUnits(ctx.period || '2030')) {
      if (town.cls !== 'II') continue;
      const part = popKm(town);
      if (part.pop == null) return out(null, 'thieu', part.ghiChu);
      pop += part.pop;
    }
    return out(datToken(pop >= 600000), 'du', `Dân số đô thị loại II ${Math.round(pop)} người.`);
  }
  if (id === '1.II.10') {
    const phuong = Object.keys(DVHC_WARDS).filter(n => n.startsWith('Phường '));
    const dat = phuong.filter(n => (wardLevel614(n) || {}).level === 'II').length;
    const pct = phuong.length ? dat / phuong.length * 100 : 0;
    return out(datToken(pct >= 50), 'du', `${dat}/${phuong.length} phường trình độ loại II theo Quyết định 614 (${pct.toFixed(1)}%).`);
  }
  if (id === '2A.II.03') return numOut(spec, cls, pk.pop == null ? null : pk.pop / 1000, pk.chat, pk.ghiChu);
  if (id === '2A.II.04' || id === '2B.II.04') {
    if (id === '2B.II.04') {
      if (!(ctx.builtKm2 > 0) || pk.pop == null) return out(null, 'thieu', 'Chưa có km² đất xây dựng hoặc dân số.');
      return numOut(spec, cls, pk.pop / ctx.builtKm2, unit.partial ? 'can_duoi' : 'du', `Dân số / ${ctx.builtKm2} km² đất xây dựng. ${pk.ghiChu}`);
    }
    if (!(pk.km2 > 0) || pk.pop == null) return out(null, 'thieu', pk.ghiChu);
    return numOut(spec, cls, pk.pop / pk.km2, pk.chat, `${Math.round(pk.pop)} người / ${pk.km2} km². ${pk.ghiChu}`);
  }
  if (id === '2A.III.07') {
    if (ctx.roadKm == null || !(ctx.builtKm2 > 0)) return out(null, 'thieu', 'Chưa đủ km đường hoặc đất xây dựng.');
    return numOut(spec, cls, ctx.roadKm / ctx.builtKm2, unit.partial ? 'can_duoi' : 'du', `${ctx.roadKm} km / ${ctx.builtKm2} km² đất xây dựng.`);
  }
  if (id === '2A.III.09' || id === '2A.III.10' || id === '2A.III.12' || id === '2A.III.21') {
    const pack = htMeasures(unit, ctx);
    const cell = pack && pack[id];
    if (!cell || cell.value == null || cell.pending) return out(null, 'thieu', (cell && cell.text) || 'Chưa cắt được lớp hiện trạng trong ranh.');
    return numOut(spec, cls, cell.value, cell.partial || unit.partial ? 'can_duoi' : 'du', cell.text || '');
  }
  if (id === '2B.III.21') {
    const rows = ctx.noxh != null ? ctx.noxh : noxhItems;
    if (rows == null) return out(null, 'thieu', 'Chưa đọc apartments.json.');
    const names = new Set();
    if (unit.loai === 'xa') names.add(bareName(unit.ten));
    else (unit.members || []).forEach(m => {
      const row = wardRow(m.ten || m.ma);
      if (row) names.add(bareName(row.name));
    });
    const owned = rows.filter(it => names.has(bareName(it.ward)));
    if (unit.partial) return out(null, 'thieu', 'Nhà ở xã hội ghi theo xã, chưa cắt phần đô thị.');
    const n = owned.filter(it => it.status === 'hoan_thanh').length;
    const plan = owned.filter(it => it.status === 'quy_hoach').length;
    return numOut(spec, cls, n, 'du', `${n} dự án đã hoàn thành${plan ? `; ${plan} dự án quy hoạch không tính là đang xây dựng` : ''}.`);
  }
  if (id === '2B.C.06') {
    if (ctx.bikeKm == null) return out(null, 'thieu', 'Chưa có chỉ mục đường.');
    return out(datToken(ctx.bikeKm > 0), 'du', `${ctx.bikeKm} km đường xe đạp.`);
  }
  if (id === '2B.C.10') {
    if (!ctx.ht) return out(null, 'thieu', 'Chưa cắt lớp XLNT.');
    const n = Number(ctx.ht.wwtp) || 0;
    const cap = Number(ctx.ht.opCap) || 0;
    return out(datToken(n > 0 || cap > 0), 'du', n > 0 || cap > 0 ? `${n} trạm trong ranh.` : 'Không có trạm XLNT trong ranh.');
  }

  if (!list) return out(null, 'thieu', (bag && bag.ghiChu) || 'Chưa nạp điểm hạ tầng.');
  const note = bag.ghiChu;

  if (id === '2A.III.13') {
    const n = typed(list, it => layerType(it) === '11-NT' && it.ntKind === 'funeral').length;
    return countOut(spec, cls, n, 0, `${note} ${n} nhà tang lễ.`);
  }
  if (id === '2A.III.15') {
    const n = typed(list, it => layerType(it) === '6-THPT').length;
    return countOut(spec, cls, n, 1, `${note} ${n} THPT, chưa gồm đại học và dạy nghề.`);
  }
  if (id === '2A.III.16') {
    const n = typed(list, it => layerType(it) === '8-VH').length;
    return countOut(spec, cls, n, 0, `${note} ${n} công trình 8-VH.`);
  }
  if (id === '2A.III.17') {
    const n = typed(list, it => layerType(it) === '8-VH' && sportName(it.name)).length;
    return countOut(spec, cls, n, 1, `${note} ${n} công trình có tên thể thao.`);
  }
  if (id === '2A.III.18') {
    const n = typed(list, it => layerType(it) === '9-TM').length;
    return countOut(spec, cls, n, 0, `${note} ${n} công trình 9-TM.`);
  }
  if (id === '2A.III.19') {
    const rows = typed(list, it => ['6-THPT', '7-YT', '8-VH', '9-TM'].includes(layerType(it)));
    return perPerson(spec, cls, rows, pk.pop, 'can_duoi', note);
  }
  if (id === '2A.III.20') {
    const parks = typed(list, it => layerType(it) === '1-CV');
    const unknown = parks.filter(it => !((Number(it.size) || 0) > 0)).length;
    const n = parks.filter(it => Number(it.size) >= 20000).length;
    return countOut(spec, cls, n, unknown, `${note} ${n} khu ≥ 2 ha.`);
  }
  if (id === '2A.III.22') {
    return perPerson(spec, cls, typed(list, urbanPark), pk.pop, 'can_duoi', `${note} Công viên cấp đô thị.`);
  }
  if (id === '2B.III.23') {
    const rows = typed(list, it => ['3-MN', '4-TH', '5-THCS', '7-YT', '8-VH', '9-TM'].includes(layerType(it)));
    return perPerson(spec, cls, rows, pk.pop, 'can_duoi', note);
  }
  if (id === '2B.III.25') {
    const n = typed(list, it => layerType(it) === '4-TH').length;
    const token = schoolRatio(pk.pop, n);
    if (!token) return out(null, 'thieu', 'Chưa có dân số.');
    return out(token, 'du', `${n} trường tiểu học, dân số ${Math.round(pk.pop || 0)}.`);
  }
  if (id === '2B.III.26') {
    const rows = typed(list, it => ['3-MN', '4-TH', '5-THCS'].includes(layerType(it)));
    return perPerson(spec, cls, rows, pk.pop, 'can_duoi', note);
  }
  if (id === '2B.III.27') {
    return perPerson(spec, cls, typed(list, it => layerType(it) === '8-VH'), pk.pop, 'can_duoi', note);
  }
  if (id === '2B.III.28') {
    return perPerson(spec, cls, typed(list, it => layerType(it) === '1-CV'), pk.pop, 'can_duoi', note);
  }
  if (id === '2B.III.29') {
    const parks = typed(list, it => layerType(it) === '1-CV');
    const unknown = parks.filter(it => !((Number(it.size) || 0) > 0)).length;
    const n = parks.filter(it => Number(it.size) >= 2000).length;
    return countOut(spec, cls, n, unknown, `${note} ${n} khu ≥ 2.000 m².`);
  }
  if (id === '2B.III.31') {
    const n = typed(list, it => layerType(it) === '8-VH' && /di tich|di san/.test(fold(it.name || ''))).length;
    return countOut(spec, cls, n, 1, `${note} ${n} công trình ghi di tích hoặc di sản.`);
  }
  if (id === '2B.C.02') return keywordBonus(list, /cap quoc gia|cap tinh/, note);
  if (id === '2B.C.08') return keywordBonus(list, /ho dieu hoa|ho dieu tiet|bot bien/, note);
  if (id === '2B.C.17') return keywordBonus(list, /dai hoc|vien nghien cuu|trung tam nghien cuu/, note);
  if (id === '2B.C.19') return keywordBonus(list, /nha ve sinh/, note);
  if (id === '2B.C.23') return keywordBonus(list, /di tich quoc gia|di san/, note);
  return out(null, 'thieu', src.lyDo || src.congThuc);
}

export function chonGiaTri(sheet, auto) {
  const text = String(sheet ?? '').trim();
  if (text) return { value: text, nguon: 'ghi_de', ghiChu: 'Ô trong bảng ghi đè số tự tính.' };
  if (auto && auto.value != null && auto.value !== '') return { value: String(auto.value), nguon: 'tu_tinh', ghiChu: auto.ghiChu || '' };
  return { value: '', nguon: 'trong', ghiChu: (auto && auto.ghiChu) || '' };
}
