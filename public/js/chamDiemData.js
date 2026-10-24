// Bảng dài: ma_don_vi, loai_don_vi, ma_tieu_chi, ky, gia_tri, nguon, ghi_chu.
import { bareName } from './urbanStatus.js';
import { CHAM_DIEM_SHEET_CSV } from './chamDiemConfig.js';

export function normMa(s) {
  return bareName(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\n') { pushField(); pushRow(); continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  const head = (rows.shift() || []).map(h => h.trim());
  const col = Object.fromEntries(head.map((h, n) => [h, n]));
  const cell = (r, name) => (r[col[name]] == null ? '' : String(r[col[name]]).trim());
  return rows.filter(r => r.some(c => String(c || '').trim())).map(r => ({
    ma_don_vi: cell(r, 'ma_don_vi'),
    loai_don_vi: cell(r, 'loai_don_vi'),
    ma_tieu_chi: cell(r, 'ma_tieu_chi'),
    ky: cell(r, 'ky'),
    gia_tri: cell(r, 'gia_tri'),
    nguon: cell(r, 'nguon'),
    ghi_chu: cell(r, 'ghi_chu')
  }));
}

export function indexRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r.ma_don_vi || !r.ma_tieu_chi || !r.ky) continue;
    map.set(`${r.loai_don_vi}|${normMa(r.ma_don_vi)}|${r.ky}|${r.ma_tieu_chi}`, r);
  }
  return map;
}

export function valueAt(index, loai, ma, ky, id) {
  const row = index.get(`${loai}|${normMa(ma)}|${ky}|${id}`);
  return row ? row.gia_tri : '';
}

export function parseKy(ky) {
  const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(String(ky || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), q: m[2] ? Number(m[2]) : 0, kind: m[2] ? 'quy' : 'nam', raw: String(ky).trim() };
}

export function kysOf(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!parseKy(r.ky) || seen.has(r.ky)) continue;
    seen.add(r.ky);
    out.push(r.ky);
  }
  return out.sort((a, b) => {
    const pa = parseKy(a);
    const pb = parseKy(b);
    return pa.y - pb.y || pa.q - pb.q || a.localeCompare(b);
  });
}

export async function loadChamDiemRows() {
  const remote = String(CHAM_DIEM_SHEET_CSV || '').trim();
  if (remote) {
    try {
      const res = await fetch(remote);
      if (res.ok) {
        const rows = parseCsv(await res.text());
        if (rows.length) return { rows, nguon: 'sheet' };
      }
    } catch (err) { /* dùng file tĩnh */ }
  }
  try {
    const res = await fetch(new URL('data/cham-diem/du-lieu.csv', document.baseURI).href);
    if (!res.ok) return { rows: [], nguon: 'trong' };
    return { rows: parseCsv(await res.text()), nguon: 'tep' };
  } catch (err) {
    return { rows: [], nguon: 'trong' };
  }
}
