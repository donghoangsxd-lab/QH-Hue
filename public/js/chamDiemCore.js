// Chấm Nghị quyết 111/2025/UBTVQH15. Điều 9.4: tối đa → điểm tối đa, tối thiểu → điểm tối thiểu,
// giữa hai mức nội suy tuyến tính, dưới tối thiểu → 0. Huế chỉ áp Điều 8.2.d (Điều 8.3).
import { PHU_LUC_I, BANG_2A, BANG_2B, DIEM_CONG, KHUNG } from './chamDiemCatalog.js';

export const PASS_DIEM = 75;
export const PASS_TB_III = 48;
export const HUE_PASS = { tong: 10, I: 4, II: 2, III: 4 };
export const NOTE_CHUNG = 'Nội suy tuyến tính là cách hiểu Điều 9.4.a, vì nghị quyết không ghi công thức. Huế chỉ áp Điều 8.2.d (cố đô, di sản UNESCO), không áp hệ số vùng. Ô trống là «—»: chưa đánh giá, không tính là đạt.';

const NOTE = {
  '2B.I.03': 'Chỉ tiêu nghịch: dưới 2,5% (loại II) hoặc dưới 4% (loại III) là mức tối đa; 3% hoặc 5% là mức tối thiểu. Nội suy theo hướng ngược. Mức 50% của Điều 8.2.d không nới chỉ tiêu này vì sẽ chặt hơn ngưỡng gốc.',
  '2B.II.04': 'Mật độ trên 25.000 người/km² chỉ được điểm tối thiểu. Với Huế, Điều 8.2.d không xem xét tiêu chuẩn này và Điều 9.4.a tính điểm tối thiểu.',
  '2B.III.22': 'Trong khoảng 50–90 m²/người (loại II) hoặc 50–110 (loại III) được điểm tối đa; dưới 50 được điểm tối thiểu; vượt trần được 0. Không nội suy.',
  '2A.III.13': 'Loại III: mức tối thiểu là «Có dự án» (định tính), mức tối đa là từ 1 cơ sở.',
  '2B.III.21': 'Loại III: mức tối thiểu là «Đang xây dựng» (định tính).'
};

const LANDSCAPE = new Set([
  '2A.III.20', '2A.III.21', '2A.III.22', '2A.III.23',
  '2B.III.28', '2B.III.29', '2B.III.30', '2B.III.31', '2B.III.32'
]);
const EXEMPT = new Set(['2A.II.04', '2B.II.04']);

const BY_ID = new Map([...PHU_LUC_I, ...BANG_2A, ...BANG_2B, ...DIEM_CONG].map(s => [s.id, s]));
export const tieuChuan = (id) => BY_ID.get(id) || null;

export function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function numVi(token) {
  const t = String(token ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  const n = t.includes(',')
    ? Number(t.replace(/\./g, '').replace(',', '.'))
    : (/^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t));
  return Number.isFinite(n) ? n : null;
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function gap(actual, threshold, reverse) {
  if (threshold == null || !Number.isFinite(threshold) || threshold === 0 || !Number.isFinite(actual)) return null;
  const raw = reverse ? (actual - threshold) / threshold : (threshold - actual) / threshold;
  return r2(Math.max(0, raw * 100));
}

function notesOf(spec) {
  const out = [];
  if (NOTE[spec.id]) out.push(NOTE[spec.id]);
  if ((spec.muc || []).some(m => m.gop)) out.push('Ô gộp: loại II và loại III cùng một mức.');
  return out;
}

function pack(spec, status, diem, thieuMin, thieuMax, notes) {
  return {
    id: spec.id,
    status,
    diem: diem == null ? null : r2(diem),
    thieuMin: thieuMin == null ? null : r2(thieuMin),
    thieuMax: thieuMax == null ? null : r2(thieuMax),
    notes: notes || notesOf(spec)
  };
}

function readMeasured(raw, spec) {
  const s = String(raw ?? '').trim();
  if (!s) return { empty: true };
  const f = fold(s);
  if (spec.kind === 'dat' || spec.kind === 'cong') {
    if (['dat', 'co', 'yes', 'true', '1', 'x'].includes(f)) return { pass: true };
    if (['khong', 'khong dat', 'no', 'false', '0'].includes(f)) return { pass: false };
    return { bad: true };
  }
  const textBand = (spec.muc || []).some(m => m.ii.op === 'text' || m.iii.op === 'text' || m.ii.op === 'range' || m.iii.op === 'range');
  if (textBand && (f === 'toi da' || f === 'max')) return { tier: 'max' };
  if (textBand && (f === 'toi thieu' || f === 'min')) return { tier: 'min' };
  if (textBand && (f === 'khong' || f === 'khong dat')) return { tier: 'none' };
  if (/^-?\d[\d.,]*$/.test(s.replace(/\s/g, ''))) return { n: numVi(s) };
  if (textBand) return { text: s };
  return { bad: true };
}

function facility(spec) {
  const f = fold(spec.donVi);
  return f.includes('co so') || f.includes('cong trinh') || f.includes('du an');
}

function floorOf(spec, loN, heritage) {
  if (!heritage || LANDSCAPE.has(spec.id) || loN == null) return loN;
  if (facility(spec)) return loN <= 1 ? loN : Math.max(1, Math.round(loN * 0.5));
  return loN * 0.5;
}

function bandOf(spec, cls) {
  const key = cls === 'II' ? 'ii' : 'iii';
  return {
    hi: spec.muc[0][key],
    lo: spec.muc[1] ? spec.muc[1][key] : null,
    over: spec.muc[2] ? spec.muc[2][key] : null,
    hiDiem: spec.muc[0].diem,
    loDiem: spec.muc[1] ? spec.muc[1].diem : null
  };
}

function scoreRange(spec, value, heritage) {
  const notes = notesOf(spec);
  const { hi, over } = bandOf(spec, value.cls);
  const loEdge = hi.n;
  const hiEdge = hi.n2;
  let n = value.n;
  if (n == null && value.tier === 'max') n = (loEdge + hiEdge) / 2;
  if (n == null && value.tier === 'min') n = loEdge - 1;
  if (n == null) return pack(spec, 'loi', null, null, null, notes.concat('Tiêu chuẩn khoảng cần một số.'));
  if (n + 1e-9 >= loEdge && n - 1e-9 <= hiEdge) return pack(spec, 'dat', spec.diemMax, 0, 0, notes);
  if (n < loEdge) {
    const cut = heritage && !LANDSCAPE.has(spec.id) ? loEdge * 0.5 : -Infinity;
    if (n + 1e-9 >= cut) return pack(spec, 'mot_phan', spec.diemMin, 0, gap(n, loEdge, false), notes);
    return pack(spec, 'khong', 0, gap(n, loEdge, false), gap(n, loEdge, false), notes.concat('Dưới 50% cận dưới của khoảng, Điều 8.2.d không còn điểm tối thiểu.'));
  }
  const edge = over && over.n != null ? over.n : hiEdge;
  const thieu = gap(n, edge, true);
  return pack(spec, 'khong', 0, thieu, thieu, notes);
}

function scoreReverse(spec, value) {
  const notes = notesOf(spec);
  const { hi, lo } = bandOf(spec, value.cls);
  const n = value.n;
  if (n == null) return pack(spec, 'loi', null, null, null, notes.concat('Chỉ tiêu nghịch cần một số.'));
  if (n < hi.n) return pack(spec, 'dat', spec.diemMax, 0, 0, notes);
  if (n <= lo.n + 1e-9) {
    const diem = lo.n === hi.n ? spec.diemMax : spec.diemMax + (n - hi.n) / (lo.n - hi.n) * (spec.diemMin - spec.diemMax);
    const status = diem + 1e-9 >= spec.diemMax ? 'dat' : 'mot_phan';
    return pack(spec, status, diem, 0, gap(n, hi.n, true), notes);
  }
  return pack(spec, 'khong', 0, gap(n, lo.n, true), gap(n, hi.n, true), notes);
}

function textHit(value, muc) {
  if (!muc) return false;
  if (value.text && fold(value.text) === fold(muc.raw)) return true;
  if (value.n != null && muc.op !== 'text' && muc.n != null && value.n + 1e-9 >= muc.n) return true;
  return false;
}

function scoreText(spec, value, heritage) {
  const notes = notesOf(spec);
  const { hi, lo } = bandOf(spec, value.cls);
  if (value.tier === 'max' || textHit(value, hi)) return pack(spec, 'dat', spec.diemMax, 0, 0, notes);
  if (value.tier === 'min' || textHit(value, lo)) return pack(spec, 'mot_phan', spec.diemMin, 0, 100, notes);
  if (value.n != null && hi.op !== 'text' && lo && lo.op !== 'text') return scoreNumber(spec, value, heritage);
  if (value.tier === 'none' || value.bad) return pack(spec, 'khong', 0, 100, 100, notes);
  return pack(spec, 'khong', 0, 100, 100, notes.concat('Giá trị không khớp mức chữ trong bảng.'));
}

function scoreNumber(spec, value, heritage) {
  const notes = notesOf(spec);
  const { hi, lo, over } = bandOf(spec, value.cls);
  const n = value.n;
  if (n == null) return pack(spec, 'loi', null, null, null, notes.concat('Tiêu chuẩn định lượng cần một số.'));
  if (over && over.op === 'gt' && over.n != null && n > over.n) {
    return pack(spec, 'mot_phan', spec.diemMin, 0, gap(n, over.n, true), notes.concat('Vượt ngưỡng trên: chỉ được điểm tối thiểu.'));
  }
  if (n + 1e-9 >= hi.n) return pack(spec, 'dat', spec.diemMax, 0, 0, notes);
  if (lo && lo.n != null && n + 1e-9 >= lo.n) {
    const diem = hi.n === lo.n ? spec.diemMax : spec.diemMin + (n - lo.n) / (hi.n - lo.n) * (spec.diemMax - spec.diemMin);
    const status = diem + 1e-9 >= spec.diemMax ? 'dat' : 'mot_phan';
    return pack(spec, status, diem, 0, gap(n, hi.n, false), notes);
  }
  const loN = lo && lo.n != null ? lo.n : hi.n;
  const floor = floorOf(spec, loN, heritage);
  if (heritage && !LANDSCAPE.has(spec.id) && floor != null && n + 1e-9 >= floor && n < loN) {
    const extra = facility(spec) && loN > 1
      ? 'Chưa đủ số công trình quy định; Điều 9.4.b giảm mức tối thiểu theo tỷ lệ, làm tròn, không dưới 1, nên được điểm tối thiểu.'
      : 'Chưa đạt mức quy định; Điều 8.2.d lấy 50% mức tối thiểu nên được điểm tối thiểu (Điều 9.4.a).';
    return pack(spec, 'dieu8', spec.diemMin, gap(n, loN, false), gap(n, hi.n, false), notes.concat(extra));
  }
  return pack(spec, 'khong', 0, gap(n, loN, false), gap(n, hi.n, false), notes);
}

export function scoreStandard(spec, cls, raw, { heritage = true } = {}) {
  if (!spec) return { id: '', status: 'loi', diem: null, thieuMin: null, thieuMax: null, notes: ['Không có tiêu chuẩn.'] };
  if (spec.kind === 'dat' || spec.kind === 'cong') {
    const v = readMeasured(raw, spec);
    if (v.empty) return pack(spec, 'chua', spec.kind === 'cong' ? 0 : null, null, null, []);
    if (v.bad) return pack(spec, 'loi', spec.kind === 'cong' ? 0 : null, null, null, ['Không đọc được giá trị. Ghi Đạt hoặc Không đạt.']);
    if (spec.kind === 'cong') return v.pass ? pack(spec, 'dat', 0.5, 0, 0, []) : pack(spec, 'khong', 0, 100, 100, []);
    return v.pass ? pack(spec, 'dat', null, 0, 0, []) : pack(spec, 'khong', null, 100, 100, []);
  }
  if (heritage && EXEMPT.has(spec.id)) {
    return pack(spec, 'mien', spec.diemMin, null, null, notesOf(spec).concat('Không xem xét. Giá trị đo, nếu có, không đưa vào điểm.'));
  }
  const v = readMeasured(raw, spec);
  if (v.empty) return pack(spec, 'chua', null, null, null, notesOf(spec));
  if (v.bad) return pack(spec, 'loi', null, null, null, notesOf(spec).concat('Không đọc được giá trị.'));
  v.cls = cls === 'II' ? 'II' : 'III';
  const { hi } = bandOf(spec, v.cls);
  if (hi.op === 'range') return scoreRange(spec, v, heritage);
  if (hi.op === 'lt') return scoreReverse(spec, v);
  if (hi.op === 'text' || (spec.muc[1] && spec.muc[1][v.cls === 'II' ? 'ii' : 'iii'].op === 'text') || v.tier || v.text) {
    return scoreText(spec, v, heritage);
  }
  return scoreNumber(spec, v, heritage);
}

function leafKey(spec) {
  return spec.sub || spec.nhom;
}

function sumBang(specs, bonuses, cls, valueOf, heritage, bang) {
  const items = specs.map(spec => scoreStandard(spec, cls, valueOf(spec.id), { heritage }));
  const byId = new Map(items.map(it => [it.id, it]));
  const leaf = {};
  const nhomDiem = { I: 0, II: 0, III: 0 };
  const nhomPending = { I: false, II: false, III: false };
  for (const spec of specs) {
    const it = byId.get(spec.id);
    const open = it.status === 'chua' || it.status === 'loi';
    if (open) nhomPending[spec.nhom] = true;
    if (it.diem == null) continue;
    const key = leafKey(spec);
    leaf[key] = r2((leaf[key] || 0) + it.diem);
    nhomDiem[spec.nhom] = r2(nhomDiem[spec.nhom] + it.diem);
  }
  const bonusItems = (bonuses || []).map(spec => {
    const it = scoreStandard({ ...spec, kind: 'cong' }, cls, valueOf(spec.id), { heritage });
    const met = it.status === 'dat';
    let ap = 0;
    if (met) {
      const cap = KHUNG['2B'][spec.cap] ? KHUNG['2B'][spec.cap][1] : 0;
      const cur = leaf[spec.cap] || 0;
      ap = r2(Math.min(spec.diem || 0.5, Math.max(0, cap - cur)));
      leaf[spec.cap] = r2(cur + ap);
      nhomDiem[spec.nhom] = r2(nhomDiem[spec.nhom] + ap);
    }
    return { ...it, diemAp: ap, met };
  });
  const khung = KHUNG[bang];
  for (const k of ['I', 'II', 'III']) {
    const max = khung[k][1];
    if (nhomDiem[k] > max) nhomDiem[k] = max;
  }
  let total = r2(nhomDiem.I + nhomDiem.II + nhomDiem.III);
  if (total > 100) total = 100;
  const complete = items.every(it => it.status !== 'chua' && it.status !== 'loi');
  const nhom = {};
  for (const k of ['I', 'II', 'III']) {
    nhom[k] = {
      diem: nhomPending[k] ? null : nhomDiem[k],
      min: khung[k][0],
      max: khung[k][1]
    };
  }
  const datNhom = ['I', 'II', 'III'].every(k => nhom[k].diem != null && nhom[k].diem + 1e-9 >= nhom[k].min);
  let ketLuan = 'chua';
  let thieu75 = null;
  if (complete) {
    ketLuan = datNhom && total + 1e-9 >= PASS_DIEM ? 'dat' : 'khong';
    thieu75 = r2(Math.max(0, PASS_DIEM - total));
  }
  return { items, bonusItems, nhom, total: complete ? total : null, complete, ketLuan, thieu75, leaf };
}

export function scoreHue(valueOf) {
  const items = PHU_LUC_I.map(spec => scoreStandard(spec, null, valueOf(spec.id)));
  const count = (nhom, status) => items.filter(it => it.status === status && tieuChuan(it.id).nhom === nhom).length;
  const complete = items.every(it => it.status === 'dat' || it.status === 'khong');
  const dat = items.filter(it => it.status === 'dat').length;
  const nhom = { I: count('I', 'dat'), II: count('II', 'dat'), III: count('III', 'dat') };
  let ketLuan = 'chua';
  if (complete) {
    ketLuan = dat >= HUE_PASS.tong && nhom.I >= HUE_PASS.I && nhom.II >= HUE_PASS.II && nhom.III >= HUE_PASS.III ? 'dat' : 'khong';
  }
  return { items, bonusItems: [], nhomDat: nhom, dat, tongChuan: items.length, complete, ketLuan, total: null, thieu75: null };
}

export function scoreDoThi(cls, valueOf, heritage = true) {
  return sumBang(BANG_2A, [], cls, valueOf, heritage, '2A');
}

export function scoreXa(cls, valueOf, heritage = true) {
  return sumBang(BANG_2B, DIEM_CONG, cls, valueOf, heritage, '2B');
}

export function passDoThi(bang, wards) {
  const tbReady = wards.length > 0 && wards.every(w => w.nhom && w.nhom.III && w.nhom.III.diem != null && w.complete);
  const tb = tbReady ? r2(wards.reduce((s, w) => s + w.nhom.III.diem, 0) / wards.length) : null;
  const wardsReady = wards.length > 0 && wards.every(w => w.complete);
  const xaDat = wardsReady ? wards.filter(w => w.ketLuan === 'dat').length : null;
  const ready = bang.complete && tbReady && wardsReady;
  let ketLuan = 'chua';
  if (ready) {
    ketLuan = bang.ketLuan === 'dat' && tb + 1e-9 >= PASS_TB_III && xaDat >= 1 ? 'dat' : 'khong';
  }
  return {
    ketLuan,
    diem: bang.total,
    thieu75: bang.thieu75,
    tbMucIII: tb,
    xaDat,
    ketLuan2A: bang.ketLuan
  };
}

export function buckets(pack) {
  const items = pack.items || [];
  return {
    khong: items.filter(it => it.status === 'khong'),
    dieu8: items.filter(it => it.status === 'dieu8'),
    motPhan: items.filter(it => it.status === 'mot_phan'),
    chua: items.filter(it => it.status === 'chua' || it.status === 'loi'),
    mien: items.filter(it => it.status === 'mien'),
    dat: items.filter(it => it.status === 'dat')
  };
}
