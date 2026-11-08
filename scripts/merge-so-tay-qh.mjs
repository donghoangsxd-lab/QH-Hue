/**
 * Gộp 9 sheet sổ tay QH (1.P.Xuân → 9.A Lưới) thành bảng chuẩn kiểu Trang tính 7 (TT 24/2025),
 * với Ma_do_an / Ma_thanh_phan để cụm cha–con ĐCCB sort/filter dính nhau.
 *
 * Usage:
 *   node scripts/merge-so-tay-qh.mjs [--cache-dir DIR] [--out-dir DIR] [--fetch]
 *   node scripts/merge-so-tay-qh.mjs --verify-nam-giao
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPREADSHEET_ID = '1JxrqPmZ5tDuB0pE9Ot973aJotEEsWa8r';
const EXPORT_BASE = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=`;

const SHEETS = [
  { gid: '868426773', sheet: '1. P.Xuân', ma: 'PX', ten: 'Quận Phú Xuân' },
  { gid: '55137101', sheet: '2. T.Hóa (AVD)', ma: 'TH', ten: 'Quận Thuận Hóa' },
  { gid: '350356900', sheet: '3. H.Thủy', ma: 'HTh', ten: 'Thị xã Hương Thủy' },
  { gid: '163398060', sheet: '4. H.Trà', ma: 'HTr', ten: 'Thị xã Hương Trà' },
  { gid: '1610170874', sheet: '5. P.Điền', ma: 'PD', ten: 'Thị xã Phong Điền' },
  { gid: '2033226829', sheet: '6. Q.Điền', ma: 'QD', ten: 'Huyện Quảng Điền' },
  { gid: '306308910', sheet: '7. P.Vang', ma: 'PV', ten: 'Huyện Phú Vang' },
  { gid: '1628304773', sheet: '8. PLộc (CMây)', ma: 'PL', ten: 'Huyện Phú Lộc' },
  { gid: '1701591893', sheet: '9. A Lưới', ma: 'AL', ten: 'Huyện A Lưới' },
];

const HEADERS = [
  'Ma_do_an',
  'Ma_thanh_phan',
  'Loai_dong',
  'Don_vi_hanh_chinh',
  'Ma_DVHC_nguon',
  'Stt',
  'Stt_nguon',
  'Tên quy hoạch',
  'Loại quy hoạch',
  'Cấp độ quy hoạch',
  'Loại điều chỉnh quy hoạch',
  'Địa điểm quy hoạch',
  'Quy mô diện tích (ha)',
  'Số quyết định phê duyệt NVQH',
  'Cơ quan tổ chức lập NVQH',
  'Số quyết định phê duyệt quy hoạch',
  'Ngày phê duyệt',
  'Cơ quan tổ chức lập quy hoạch',
  'Cơ quan thẩm định quy hoạch',
  'Cơ quan phê duyệt quy hoạch',
  'Quy mô dân số dự báo (người)',
  'Thời hạn quy hoạch',
  'Quy định quản lý theo quy hoạch',
  'Kế hoạch thực hiện quy hoạch chung',
  'Quy chế quản lý kiến trúc trong phạm vi lập quy hoạch',
  'Cơ sở dữ liệu số cơ bản',
  'Cơ sở dữ liệu số pháp lý',
  'Cơ sở dữ liệu số địa lý (GIS)',
  'Sheet_nguon',
  'Quyet_dinh_goc',
  'So_lan_dccb_nguon',
  'Ghi_chu_nguon',
  'Link_GIS',
];

const REVIEW_HEADERS = [
  'Ly_do',
  'Sheet_nguon',
  'Don_vi_hanh_chinh',
  'Stt_nguon',
  'Ten',
  'Quyet_dinh',
  'Ngay',
  'Ma_do_an_gan',
  'So_lan_dccb_nguon',
  'So_dong_con_thuc_te',
];

function parseArgs(argv) {
  const out = {
    cacheDir: path.join(process.env.TEMP || '/tmp', 'so-tay-qh-hue'),
    outDir: path.join(__dirname, 'data', 'so-tay-qh-merge'),
    fetch: false,
    verifyNamGiao: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fetch') out.fetch = true;
    else if (a === '--verify-nam-giao') out.verifyNamGiao = true;
    else if (a === '--cache-dir') out.cacheDir = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}

function norm(s) {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDiacritics(s) {
  return norm(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function findHeaderIndex(rows) {
  return rows.findIndex((r) => norm(r[0]) === 'Stt' && /tên|ten/i.test(stripDiacritics(r[1] || '')));
}

function cell(row, i) {
  return norm(row[i]);
}

function findGisUrl(row) {
  for (let i = 8; i <= 14; i++) {
    const v = cell(row, i);
    if (/^https?:\/\//i.test(v)) return v;
  }
  return '';
}

function parseParentCode(stt) {
  const s = norm(stt);
  const m = s.match(/^([A-Za-zĐđPĐQ]{1,3})\.([ABC])\.(\d+)\s*$/i);
  if (!m) return null;
  return { prefix: m[1], group: m[2].toUpperCase(), num: Number(m[3]) };
}

function isSectionRow(stt, ten) {
  const s = norm(stt);
  const t = norm(ten);
  if (!s && !t) return true;
  if (/^TỔNG CỘNG$/i.test(t) || /^TONG CONG$/i.test(stripDiacritics(t))) return true;
  if (/quy ước|quy uoc/i.test(stripDiacritics(s + ' ' + t))) return true;
  if (/^CÁC QUY HOẠCH|^CAC QUY HOACH/i.test(stripDiacritics(t))) return true;
  if (/^Stt$/i.test(s)) return true;
  // Mục lục: I, II, I.B, II.A, (A), A. NGOÀI...
  if (/^[\(]?[IVX]+[\.\)]?([ABC]|\d+)?$/i.test(s)) return true;
  if (/^\([A-ZĐ]\)$/i.test(s)) return true;
  if (/^[A-ZĐ]\.\s/i.test(s) && !parseParentCode(s)) return true;
  if (!s && /^(QUY HOẠCH|QUY HOACH|NGOÀI|NGOAI|TRONG|KHU VỰC)/i.test(stripDiacritics(t))) return true;
  if (s && !ten && !parseParentCode(s)) return true;
  if (s && /^(QUY HOẠCH|QUY HOACH)/i.test(stripDiacritics(t)) && !parseParentCode(s)) return true;
  return false;
}

function classifyChild(ten) {
  const t = norm(ten);
  const flat = stripDiacritics(t);
  if (!flat || /^Khong co$/i.test(flat) || flat === '...') return 'skip';
  if (/^DCCB\b/i.test(flat) || /^Dieu chinh cuc bo\b/i.test(flat)) return 'dccb';
  if (/^Dinh chinh\b/i.test(flat) || /^DC\b/i.test(flat)) return 'dinh_chinh';
  // ĐCCB viết tắt / bổ sung nội dung thường là dòng con sổ tay
  if (/^Bo sung\b/i.test(flat)) return 'dccb';
  if (/^Dieu chinh\b/i.test(flat) && !/\bQH(C|PK|CT|CXD)\b/i.test(flat) && !/\bquy hoach\b/i.test(flat)) {
    return 'dccb';
  }
  return null;
}

function looksLikeParentTitle(ten) {
  const flat = stripDiacritics(ten);
  return /\b(QHPK|QHCT|QHC|QHCTXD|QHCXD|QH TMB|Quy hoach)\b/i.test(flat);
}

function inferLoaiQh(sectionLabel) {
  const flat = stripDiacritics(sectionLabel);
  if (/nong thon|xa\b|vung huyen|vung thi xa/i.test(flat)) return 'Nông thôn';
  if (/khu chuc nang|KCN|cum cong nghiep/i.test(flat)) return 'Khu chức năng';
  if (/do thi|phan khu|chi tiet/i.test(flat)) return 'Đô thị';
  return 'Đô thị';
}

function inferCapDo(group, ten) {
  const flat = stripDiacritics(ten);
  if (group === 'A' || /\bQHC\b|quy hoach chung|vung huyen|vung thi xa/i.test(flat)) return 'QHC';
  if (group === 'B' || /\bQHPK\b|QHCTXD \(ty le 1\/2000\)|phan khu/i.test(flat)) return 'QHPK';
  if (group === 'C' || /\bQHCT\b|chi tiet|1\/500/i.test(flat)) return 'QHCT';
  if (/1\/2000/i.test(flat)) return 'QHPK';
  if (/1\/500/i.test(flat)) return 'QHCT';
  return group === 'A' ? 'QHC' : group === 'C' ? 'QHCT' : 'QHPK';
}

function inferLoaiDieuChinh(loaiDong, ten) {
  if (loaiDong === 'dccb') return 'Cục bộ';
  if (loaiDong === 'dinh_chinh') return 'Đính chính';
  const flat = stripDiacritics(ten);
  if (/^Dieu chinh\b/i.test(flat) && !/^Dieu chinh cuc bo\b/i.test(flat)) return 'Tổng thể';
  return '';
}

function parseSoLan(raw) {
  const s = norm(raw).replace(/\./g, '').replace(',', '.');
  if (!s || s === '-' || s === '–') return null;
  const n = Number(s);
  // Sheet nguồn dùng số âm làm sentinel (thiếu / không đếm)
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function updateSectionContext(ctx, stt, ten) {
  const s = norm(stt);
  const t = norm(ten);
  const roman = s.match(/^(I{1,3}|IV|V|VI{0,3}|IX|X)\b/i);
  if (roman) {
    ctx.roman = roman[1].toUpperCase();
    ctx.sectionLabel = t || s;
    const g = s.match(/\b([ABC])\b/i);
    if (g) ctx.groupHint = g[1].toUpperCase();
  }
  if (/^\([A-ZĐ]\)$/i.test(s) || /^[A-ZĐ]\.\s/i.test(s)) {
    ctx.subsection = t || s;
  }
  if (/QUY HOẠCH PHÂN KHU|QHPK/i.test(t)) ctx.groupHint = 'B';
  if (/QUY HOẠCH CHI TIẾT|QHCT/i.test(t)) ctx.groupHint = 'C';
  if (/QUY HOẠCH CHUNG|QHC|VÙNG/i.test(t)) ctx.groupHint = 'A';
}

async function ensureCsv(meta, cacheDir, doFetch) {
  const file = path.join(cacheDir, `${meta.gid}.csv`);
  if (!doFetch && fs.existsSync(file) && fs.statSync(file).size > 100) return file;
  fs.mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(`${EXPORT_BASE}${meta.gid}`);
  if (!res.ok) throw new Error(`Fetch ${meta.gid} failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return file;
}

function emptyOutRow() {
  return Object.fromEntries(HEADERS.map((h) => [h, '']));
}

function parseSheet(meta, rows, seqState) {
  const hi = findHeaderIndex(rows);
  if (hi < 0) throw new Error(`Không thấy header Stt trong ${meta.sheet}`);

  const danhMuc = [];
  const review = [];
  const ctx = { roman: 'I', sectionLabel: '', groupHint: 'B', subsection: '' };
  let current = null;
  let sttDisplay = seqState.sttDisplay;

  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const stt = cell(row, 0);
    const ten = cell(row, 1);
    if (!stt && !ten) continue;

    if (isSectionRow(stt, ten)) {
      updateSectionContext(ctx, stt, ten);
      if (current) {
        pushMismatch(current, review, meta);
        current = null;
      }
      continue;
    }

    const parentCode = parseParentCode(stt);
    const childKind = !stt ? classifyChild(ten) : null;
    if (childKind === 'skip') continue;

    const numericStt = /^\d+$/.test(stt);
    const treatAsParent =
      parentCode ||
      (stt && ten && cell(row, 2)) ||
      (numericStt && ten && looksLikeParentTitle(ten)) ||
      (!stt && ten && cell(row, 2) && looksLikeParentTitle(ten) && !classifyChild(ten));

    if (treatAsParent && childKind == null) {
      if (current) pushMismatch(current, review, meta);

      let group = parentCode?.group || ctx.groupHint || 'B';
      // Stt dạng 3.3.1 vẫn là mã mục lục hợp lệ — không đưa CAN_REVIEW
      const dottedNumeric = /^\d+(\.\d+)+$/.test(stt);
      if (!parentCode && stt && !parseParentCode(stt) && !numericStt && !dottedNumeric) {
        review.push({
          Ly_do: 'stt_la',
          Sheet_nguon: meta.sheet,
          Don_vi_hanh_chinh: meta.ten,
          Stt_nguon: stt,
          Ten: ten,
          Quyet_dinh: cell(row, 2),
          Ngay: cell(row, 3),
          Ma_do_an_gan: '',
          So_lan_dccb_nguon: cell(row, 7),
          So_dong_con_thuc_te: '',
        });
      }

      const key = `${meta.ma}.${group}`;
      seqState.groupSeq[key] = (seqState.groupSeq[key] || 0) + 1;
      const maDoAn = `${meta.ma}.${group}.${pad3(seqState.groupSeq[key])}`;
      sttDisplay += 1;

      const soLan = parseSoLan(cell(row, 7));
      const qd = cell(row, 2);
      const gis = findGisUrl(row);
      const out = emptyOutRow();
      out.Ma_do_an = maDoAn;
      out.Ma_thanh_phan = `${maDoAn}.00`;
      out.Loai_dong = 'do_an';
      out.Don_vi_hanh_chinh = meta.ten;
      out.Ma_DVHC_nguon = meta.ma;
      out.Stt = String(sttDisplay);
      out.Stt_nguon = stt;
      out['Tên quy hoạch'] = ten;
      out['Loại quy hoạch'] = inferLoaiQh(ctx.sectionLabel);
      out['Cấp độ quy hoạch'] = inferCapDo(group, ten);
      out['Loại điều chỉnh quy hoạch'] = inferLoaiDieuChinh('do_an', ten);
      out['Địa điểm quy hoạch'] = ctx.subsection || meta.ten;
      out['Quy mô diện tích (ha)'] = cell(row, 5);
      out['Số quyết định phê duyệt quy hoạch'] = qd;
      out['Ngày phê duyệt'] = cell(row, 3);
      out['Cơ quan phê duyệt quy hoạch'] = cell(row, 4);
      out['Quy mô dân số dự báo (người)'] = cell(row, 6);
      out['Cơ sở dữ liệu số địa lý (GIS)'] = gis;
      out.Sheet_nguon = meta.sheet;
      out.Quyet_dinh_goc = qd;
      out.So_lan_dccb_nguon = soLan == null ? '' : String(soLan);
      out.Ghi_chu_nguon = cell(row, 9);
      out.Link_GIS = gis;
      danhMuc.push(out);

      current = {
        maDoAn,
        qd,
        soLan,
        childCount: 0,
        dccbCount: 0,
        ten,
        sttNguon: stt,
      };
      continue;
    }

    if (childKind) {
      if (!current) {
        review.push({
          Ly_do: 'con_khong_cha',
          Sheet_nguon: meta.sheet,
          Don_vi_hanh_chinh: meta.ten,
          Stt_nguon: '',
          Ten: ten,
          Quyet_dinh: cell(row, 2),
          Ngay: cell(row, 3),
          Ma_do_an_gan: '',
          So_lan_dccb_nguon: '',
          So_dong_con_thuc_te: '',
        });
        continue;
      }
      current.childCount += 1;
      if (childKind === 'dccb') current.dccbCount += 1;
      const part = pad2(current.childCount);
      const out = emptyOutRow();
      out.Ma_do_an = current.maDoAn;
      out.Ma_thanh_phan = `${current.maDoAn}.${part}`;
      out.Loai_dong = childKind;
      out.Don_vi_hanh_chinh = meta.ten;
      out.Ma_DVHC_nguon = meta.ma;
      out.Stt = '';
      out.Stt_nguon = '';
      out['Tên quy hoạch'] = ten;
      out['Loại quy hoạch'] = '';
      out['Cấp độ quy hoạch'] = '';
      out['Loại điều chỉnh quy hoạch'] = inferLoaiDieuChinh(childKind, ten);
      out['Số quyết định phê duyệt quy hoạch'] = cell(row, 2);
      out['Ngày phê duyệt'] = cell(row, 3);
      out['Cơ quan phê duyệt quy hoạch'] = cell(row, 4);
      out['Quy mô diện tích (ha)'] = cell(row, 5);
      out['Quy mô dân số dự báo (người)'] = cell(row, 6);
      out.Sheet_nguon = meta.sheet;
      out.Quyet_dinh_goc = current.qd;
      out.Ghi_chu_nguon = cell(row, 9);
      out.Link_GIS = findGisUrl(row);
      out['Cơ sở dữ liệu số địa lý (GIS)'] = out.Link_GIS;
      danhMuc.push(out);
      continue;
    }

    // Stt trống, tên không rõ ĐCCB/đính chính
    if (!stt && ten) {
      review.push({
        Ly_do: 'hang_mo_ho',
        Sheet_nguon: meta.sheet,
        Don_vi_hanh_chinh: meta.ten,
        Stt_nguon: '',
        Ten: ten,
        Quyet_dinh: cell(row, 2),
        Ngay: cell(row, 3),
        Ma_do_an_gan: current?.maDoAn || '',
        So_lan_dccb_nguon: current?.soLan ?? '',
        So_dong_con_thuc_te: current?.childCount ?? '',
      });
      continue;
    }

    review.push({
      Ly_do: 'khong_nhan_dien',
      Sheet_nguon: meta.sheet,
      Don_vi_hanh_chinh: meta.ten,
      Stt_nguon: stt,
      Ten: ten,
      Quyet_dinh: cell(row, 2),
      Ngay: cell(row, 3),
      Ma_do_an_gan: current?.maDoAn || '',
      So_lan_dccb_nguon: '',
      So_dong_con_thuc_te: '',
    });
  }

  if (current) pushMismatch(current, review, meta);
  seqState.sttDisplay = sttDisplay;
  return { danhMuc, review };
}

function pushMismatch(current, review, meta) {
  if (current.soLan == null) return;
  // Khớp nếu N bằng số ĐCCB hoặc bằng mọi dòng con (ĐCCB + đính chính)
  if (current.dccbCount === current.soLan || current.childCount === current.soLan) return;
  review.push({
    Ly_do: 'lech_so_dccb',
    Sheet_nguon: meta.sheet,
    Don_vi_hanh_chinh: meta.ten,
    Stt_nguon: current.sttNguon,
    Ten: current.ten,
    Quyet_dinh: current.qd,
    Ngay: '',
    Ma_do_an_gan: current.maDoAn,
    So_lan_dccb_nguon: String(current.soLan),
    So_dong_con_thuc_te: String(current.childCount),
  });
}

function buildThongKe(danhMuc) {
  const byDvhc = new Map();
  const byCap = new Map();
  let cha = 0;
  let con = 0;
  for (const r of danhMuc) {
    if (r.Loai_dong === 'do_an') cha += 1;
    else con += 1;
    byDvhc.set(r.Ma_DVHC_nguon, (byDvhc.get(r.Ma_DVHC_nguon) || 0) + 1);
    if (r.Loai_dong === 'do_an') {
      const c = r['Cấp độ quy hoạch'] || '(trống)';
      byCap.set(c, (byCap.get(c) || 0) + 1);
    }
  }
  const rows = [
    ['Chi_tieu', 'Gia_tri'],
    ['Tong_dong', String(danhMuc.length)],
    ['Tong_do_an_cha', String(cha)],
    ['Tong_dong_con', String(con)],
    ['So_cum_Ma_do_an', String(new Set(danhMuc.map((r) => r.Ma_do_an)).size)],
  ];
  for (const [k, v] of byDvhc) rows.push([`Dong_DVHC_${k}`, String(v)]);
  for (const [k, v] of byCap) rows.push([`DoAn_Cap_${k}`, String(v)]);
  return rows;
}

function verifyNamGiao(danhMuc) {
  const parent = danhMuc.find(
    (r) =>
      r.Loai_dong === 'do_an' &&
      /Nam Giao/i.test(r['Tên quy hoạch']) &&
      r.Ma_DVHC_nguon === 'TH',
  );
  if (!parent) {
    console.error('FAIL: không thấy đồ án Đàn Nam Giao');
    process.exitCode = 1;
    return;
  }
  const kids = danhMuc.filter(
    (r) => r.Ma_do_an === parent.Ma_do_an && r.Loai_dong !== 'do_an',
  );
  const ok =
    parent.Ma_do_an === 'TH.B.001' &&
    parent.Ma_thanh_phan === 'TH.B.001.00' &&
    kids.length === 6 &&
    kids.every((k, i) => k.Ma_thanh_phan === `TH.B.001.${pad2(i + 1)}`);
  console.log(
    JSON.stringify(
      {
        parent: {
          Ma_do_an: parent.Ma_do_an,
          Ma_thanh_phan: parent.Ma_thanh_phan,
          Stt_nguon: parent.Stt_nguon,
          So_lan: parent.So_lan_dccb_nguon,
        },
        kids: kids.map((k) => ({
          Ma_thanh_phan: k.Ma_thanh_phan,
          ten: k['Tên quy hoạch'],
          qd: k['Số quyết định phê duyệt quy hoạch'],
        })),
        ok,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  fs.mkdirSync(opts.outDir, { recursive: true });

  const danhMuc = [];
  const review = [];
  const seqState = { groupSeq: {}, sttDisplay: 0 };

  for (const meta of SHEETS) {
    const file = await ensureCsv(meta, opts.cacheDir, opts.fetch);
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const parsed = parseSheet(meta, rows, seqState);
    danhMuc.push(...parsed.danhMuc);
    review.push(...parsed.review);
    console.error(
      `${meta.sheet}: ${parsed.danhMuc.length} dong, ${parsed.review.length} review`,
    );
  }

  danhMuc.sort((a, b) =>
    a.Ma_thanh_phan < b.Ma_thanh_phan ? -1 : a.Ma_thanh_phan > b.Ma_thanh_phan ? 1 : 0,
  );

  if (opts.verifyNamGiao) {
    verifyNamGiao(danhMuc);
    return;
  }

  const danhRows = [HEADERS, ...danhMuc.map((r) => HEADERS.map((h) => r[h] ?? ''))];
  const reviewRows = [
    REVIEW_HEADERS,
    ...review.map((r) => REVIEW_HEADERS.map((h) => r[h] ?? '')),
  ];
  const thongKe = buildThongKe(danhMuc);

  fs.writeFileSync(path.join(opts.outDir, 'DANH_MUC.csv'), toCsv(danhRows));
  fs.writeFileSync(path.join(opts.outDir, 'CAN_REVIEW.csv'), toCsv(reviewRows));
  fs.writeFileSync(path.join(opts.outDir, 'THONG_KE.csv'), toCsv(thongKe));
  fs.writeFileSync(
    path.join(opts.outDir, 'DANH_MUC.json'),
    JSON.stringify({ headers: HEADERS, rows: danhMuc }, null, 2),
  );
  fs.writeFileSync(
    path.join(opts.outDir, 'CAN_REVIEW.json'),
    JSON.stringify({ headers: REVIEW_HEADERS, rows: review }, null, 2),
  );
  fs.writeFileSync(
    path.join(opts.outDir, 'meta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sheets: SHEETS,
        counts: {
          danhMuc: danhMuc.length,
          review: review.length,
          cha: danhMuc.filter((r) => r.Loai_dong === 'do_an').length,
          con: danhMuc.filter((r) => r.Loai_dong !== 'do_an').length,
        },
      },
      null,
      2,
    ),
  );

  console.error(
    `OK: ${danhMuc.length} DANH_MUC, ${review.length} CAN_REVIEW → ${opts.outDir}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
