// Dân số phương pháp B: trừ chung cư khỏi dân số phường, phần còn lại chia theo sàn nhà ở thấp tầng.
// Phương pháp cũ (pixel) chỉ Admin bật để so sánh. Hệ số hộ và m²/người sửa được.

export const POP_METHOD_EVENT = 'qh:pop-method';
const STORE = 'qh_pop_method';

export const POP_DEFAULTS = { hhSize: 3.3, m2PerPerson: 25, efficiency: 0.75 };

let pack = null;
let weights = null;
let spatialFaq = [];
let method = 'b';
let cfg = { ...POP_DEFAULTS };

export function popConfig() {
  return { ...cfg };
}

export function setPopConfig(next) {
  cfg = {
    hhSize: clamp(next && next.hhSize, 1, 8, POP_DEFAULTS.hhSize),
    m2PerPerson: clamp(next && next.m2PerPerson, 8, 80, POP_DEFAULTS.m2PerPerson),
    efficiency: clamp(next && next.efficiency, 0.4, 1, POP_DEFAULTS.efficiency)
  };
  announce('config');
}

function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function setPopData(nextPack, nextWeights, faq) {
  pack = nextPack || null;
  weights = nextWeights || null;
  spatialFaq = Array.isArray(faq) ? faq : [];
  if (pack) {
    cfg = {
      hhSize: clamp(pack.hhSize, 1, 8, cfg.hhSize),
      m2PerPerson: clamp(pack.m2PerPerson, 8, 80, cfg.m2PerPerson),
      efficiency: clamp(pack.efficiency, 0.4, 1, cfg.efficiency)
    };
  }
  announce('data');
}

export function popQuery() {
  return popMethod() === 'old' ? 'old' : 'b';
}

export function popItems() {
  return ((pack && pack.items) || []).filter(it => it && it.status !== 'quy_hoach');
}

export function popWards() {
  return (weights && weights.wards) || [];
}

export function spatialQuestions() {
  return method === 'b' ? spatialFaq : [];
}

export function popMethod() {
  return method;
}

export function setPopMethod(id) {
  method = id === 'old' ? 'old' : 'b';
  try { localStorage.setItem(STORE, method); } catch (e) { /* riêng tư */ }
  announce('method');
}

export function restorePopMethod() {
  let saved = 'b';
  try { saved = localStorage.getItem(STORE) || 'b'; } catch (e) { /* riêng tư */ }
  method = saved === 'old' ? 'old' : 'b';
}

function announce(kind) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(POP_METHOD_EVENT, { detail: { kind: kind || 'data' } }));
}

/** { pop, how } — dan = số dân đã biết, can = số căn × cỡ hộ, tang = tầng × dấu chân × hiệu suất / m², thieu = chưa đủ số */
export function apartmentPopulation(row, config = cfg) {
  const residents = Number(row && row.residents);
  if (Number.isFinite(residents) && residents > 0) return { pop: residents, how: 'dan' };
  const units = Number(row && row.units);
  if (Number.isFinite(units) && units > 0) return { pop: units * config.hhSize, how: 'can' };
  const floors = Number(row && row.floors);
  const footprint = Number(row && row.footprint);
  if (floors > 0 && footprint > 0 && config.m2PerPerson > 0) {
    return { pop: floors * footprint * config.efficiency / config.m2PerPerson, how: 'tang' };
  }
  return { pop: 0, how: 'thieu' };
}

export function howLabel(how) {
  if (how === 'dan') return 'số dân đã ghi';
  if (how === 'can') return 'số căn × cỡ hộ';
  if (how === 'tang') return 'số tầng × dấu chân × hiệu suất / m² mỗi người';
  return 'chưa đủ số tầng, số căn hoặc số dân';
}

function wardByName(name) {
  return popWards().find(w => w.name === name) || null;
}

/** Dân chung cư, phần còn lại cho nhà thấp tầng, cờ vượt dân số phường */
export function wardSplit(name, config = cfg) {
  const ward = wardByName(name);
  const pop = ward ? Number(ward.pop) || 0 : 0;
  let apt = 0;
  popItems().forEach(it => {
    if (it.ward !== name) return;
    apt += apartmentPopulation(it, config).pop;
  });
  const warn = pop > 0 && apt > pop + 0.5;
  return {
    pop,
    apt,
    remain: Math.max(0, pop - apt),
    warn,
    lowW: ward ? Number(ward.lowW) || 0 : 0,
    ward
  };
}

function aptFlagPop(name, flag, config) {
  let n = 0;
  popItems().forEach(it => {
    if (it.ward !== name || !it[flag]) return;
    const elevOk = flag === 'flood' ? true : true;
    if (!elevOk) return;
    n += apartmentPopulation(it, config).pop;
  });
  return n;
}

/** Dân trong vùng phục vụ. group = school | health | park. cross = tính cả công trình phường bên cạnh */
export function servedPopulation(name, group, { cross = false, config = cfg } = {}) {
  const split = wardSplit(name, config);
  const ward = split.ward;
  if (!ward) return null;
  const key = cross ? `${group}X` : `${group}W`;
  const flag = cross ? `${group}X` : group;
  const w = Number(ward[key]) || 0;
  const low = split.lowW > 0 ? split.remain * w / split.lowW : 0;
  return low + aptFlagPop(name, flag, config);
}

/** Dân dưới mực nước. level mét, bậc cao độ làm tròn như mô phỏng (ngập khi bậc < mực) */
export function floodPopulation(level, config = cfg) {
  if (!weights) return null;
  const lv = Number(level);
  let pop = 0;
  let popAll = 0;
  const wards = [];
  popWards().forEach(ward => {
    const split = wardSplit(ward.name, config);
    popAll += split.pop;
    const floodW = (ward.bins || []).reduce((s, pair) => s + (Number(pair[0]) < lv ? Number(pair[1]) || 0 : 0), 0);
    const low = split.lowW > 0 ? split.remain * floodW / split.lowW : 0;
    let apt = 0;
    popItems().forEach(it => {
      if (it.ward !== ward.name || it.elev == null) return;
      if (Number(it.elev) < lv) apt += apartmentPopulation(it, config).pop;
    });
    const wp = low + apt;
    pop += wp;
    if (wp >= 1) wards.push({ name: ward.name, pop: wp, area: null });
  });
  wards.sort((a, b) => b.pop - a.pop);
  return { pop, popAll, wards };
}

export function cityApartmentSummary(config = cfg) {
  let apt = 0;
  let known = 0;
  let estimated = 0;
  let missing = 0;
  let verified = 0;
  const warns = [];
  popItems().forEach(it => {
    const row = apartmentPopulation(it, config);
    apt += row.pop;
    if (it.verified) verified += 1;
    if (row.how === 'dan' || row.how === 'can') known += 1;
    else if (row.how === 'tang') estimated += 1;
    else missing += 1;
  });
  const seen = new Set();
  popWards().forEach(w => {
    const split = wardSplit(w.name, config);
    if (split.warn && !seen.has(w.name)) {
      seen.add(w.name);
      warns.push(w.name);
    }
  });
  return {
    n: popItems().length,
    apt,
    verified,
    estimated: known + estimated,
    missing,
    warns
  };
}

export function wardPopNote(name, config = cfg) {
  const split = wardSplit(name, config);
  if (!split.ward) return '';
  const school = servedPopulation(name, 'school', { cross: false, config });
  const health = servedPopulation(name, 'health', { cross: false, config });
  const park = servedPopulation(name, 'park', { cross: false, config });
  const fmt = (n) => Math.round(n).toLocaleString('vi-VN');
  const warn = split.warn ? ' Chung cư ước tính vượt dân số phường, phần nhà thấp tầng để 0.' : '';
  return `Dân chung cư khoảng ${fmt(split.apt)} người, còn ${fmt(split.remain)} người ở nhà thấp tầng.${warn} Trong vùng phục vụ cùng phường: trường ${fmt(school)} , y tế ${fmt(health)} , công viên ${fmt(park)} người.`;
}
