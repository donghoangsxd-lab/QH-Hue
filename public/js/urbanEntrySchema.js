// Chỉ tiêu cán bộ nhập cho phân loại / nâng cấp đô thị (Nghị quyết 111/2025/UBTVQH15).
// Số «có sẵn» lấy từ bảng phường (dân số, diện tích). Đô thị một phần xã không được dùng số cả xã.
import { WARD_NAMES, areaCodeFromName } from './facetStore.js';
import { bareName } from './urbanStatus.js';
import { PART_BOUNDS } from './urbanPartGeom.js';

export const ENTRY_STORE_KEY = 'qh_urban_entry_v1';
export const OFFICER_STORE_KEY = 'qh_entry_officer_v1';
export const CHI_TIEU_SHEET = 'ChiTieuDoThi';
export const KIEN_TRUC_SHEET = 'KienTruc';

const QUAL = [
  { value: 'hi', label: 'Mức tối đa' },
  { value: 'lo', label: 'Mức tối thiểu' },
  { value: 'no', label: 'Chưa đạt' }
];
const YESNO = [
  { value: 'yes', label: 'Đạt' },
  { value: 'no', label: 'Chưa đạt' }
];

// override: không thay tiêu chuẩn chữ; measure() dùng khi có số. score 2a/I: ô chấm khi cán bộ đã nhập.
export const ENTRY_FIELDS = [
  { key: 'danSo', label: 'Dân số (thường trú và tạm trú)', unit: 'người', kind: 'num', scopes: ['tp', 'dothi', 'xa'], override: true, code: '2A.II.03' },
  { key: 'danSoTamTru', label: 'Dân số tạm trú cộng thêm', unit: 'người', kind: 'num', scopes: ['tp', 'dothi', 'xa'], override: true, optional: true, code: '' },
  { key: 'dienTich', label: 'Diện tích tự nhiên', unit: 'km²', kind: 'num', scopes: ['tp', 'dothi', 'xa'], override: true, code: '2A.II.04' },
  { key: 'matDoDuong', label: 'Mật độ đường giao thông', unit: 'km/km²', kind: 'num', scopes: ['dothi', 'xa'], override: true, optional: true, code: '2A.III.07' },
  { key: 'ldPhiNong', label: 'Tỷ lệ lao động phi nông nghiệp', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.II.05' },
  { key: 'nuocSach', label: 'Dân số được cấp nước sạch tập trung', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.08' },
  { key: 'matDoCong', label: 'Mật độ đường cống thoát nước chính', unit: 'km/km²', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.09' },
  { key: 'xlnt', label: 'Công suất trạm xử lý nước thải so với thiết kế', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.10' },
  { key: 'ctr', label: 'Chất thải rắn sinh hoạt được xử lý đạt yêu cầu', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.11' },
  { key: 'nghiaTrang', label: 'Diện tích nghĩa trang xây dựng theo quy hoạch', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.12' },
  { key: 'giuongBenh', label: 'Số giường bệnh', unit: 'giường/10.000 dân', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.14' },
  { key: 'khongGianXanh', label: 'Tỷ lệ diện tích không gian xanh trên diện tích tự nhiên', unit: '%', kind: 'num', scopes: ['dothi', 'xa'], code: '2A.III.21' },
  { key: 'vaiTro', label: 'Vai trò, vị trí theo quy hoạch được phê duyệt', kind: 'qual', scopes: ['dothi'], options: QUAL, code: '2A.I.01' },
  { key: 'trungTam', label: 'Vai trò đô thị trung tâm', kind: 'qual', scopes: ['dothi'], options: QUAL, code: '2A.I.02' },
  { key: 'dauMoiGt', label: 'Đầu mối giao thông', kind: 'qual', scopes: ['dothi'], options: QUAL, code: '2A.III.06' },
  { key: 'quyCheKt', label: 'Quy chế quản lý kiến trúc đô thị', kind: 'qual', scopes: ['dothi'], options: QUAL, code: '2A.III.23' },
  { key: 'i01', label: 'Đã đầu tư khu chức năng cấp quốc gia hoặc quốc tế', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.01' },
  { key: 'i02', label: 'Trung tâm tổ chức sự kiện quốc tế', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.02' },
  { key: 'i03', label: 'Thu nhập bình quân cao hơn cả nước', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.03' },
  { key: 'i04', label: 'Tốc độ tăng GRDP đạt hoặc vượt GDP', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.04' },
  { key: 'i05', label: 'Thu hút đầu tư thuộc nhóm 10 địa phương đứng đầu', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.05' },
  { key: 'i06', label: 'Không nhận bổ sung cân đối từ ngân sách trung ương', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.I.06' },
  { key: 'i11', label: 'Ít nhất 2 đầu mối giao thông cấp khu vực và quốc tế', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.III.11' },
  { key: 'i13', label: 'Ít nhất 5 công trình hoặc khu đô thị đạt giải thưởng', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.III.13' },
  { key: 'i14', label: 'Đô thị thông minh mức 1 hoặc chống chịu khí hậu', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.III.14' },
  { key: 'i15', label: 'Hoàn thành nông thôn mới giai đoạn gần nhất', kind: 'yesno', scopes: ['tp'], options: YESNO, code: '1.III.15' }
];

export const MANUAL_2A = Object.fromEntries(
  ENTRY_FIELDS.filter(f => f.code && f.code.startsWith('2A.') && !f.override).map(f => [f.code, { key: f.key, qual: f.kind === 'qual' }])
);
export const MANUAL_I = Object.fromEntries(
  ENTRY_FIELDS.filter(f => f.code && f.code.startsWith('1.')).map(f => [f.code, f.key])
);

// Khớp URBANS trong urbanClass.js (Quyết định 756). partial = tên xã chứa một phần đô thị.
export const EVAL_URBANS = [
  { id: 'hue', name: 'Thành phố Huế', cls: 'I', key: 'tp:TP' },
  { id: 'trung-tam', name: 'Khu vực đô thị trung tâm', cls: 'II', key: 'dothi:trung-tam' },
  { id: 'huong-thuy', name: 'Khu vực đô thị Hương Thủy', cls: 'II', key: 'dothi:huong-thuy' },
  { id: 'huong-tra', name: 'Khu vực đô thị Hương Trà', cls: 'III', key: 'dothi:huong-tra' },
  { id: 'phong-dien', name: 'Khu vực đô thị Phong Điền', cls: 'III', key: 'dothi:phong-dien' },
  { id: 'hoa-chau', name: 'Đô thị Hóa Châu', cls: 'III', key: 'dothi:hoa-chau' },
  { id: 'my-thuong', name: 'Đô thị Mỹ Thượng', cls: 'III', key: 'dothi:my-thuong' },
  { id: 'chan-may', name: 'Đô thị Chân Mây – Lăng Cô', cls: 'III', key: 'dothi:chan-may' },
  { id: 'quang-dien', name: 'Đô thị Quảng Điền', cls: 'III', key: 'dothi:quang-dien' },
  { id: 'a-luoi-2', name: 'Đô thị A Lưới 2', cls: 'III', key: 'dothi:a-luoi-2' },
  { id: 'vinh-thanh', name: 'Đô thị mới Vinh Thanh', cls: 'III', key: 'dothi:vinh-thanh', partial: 'Phú Vinh' },
  { id: 'phu-da', name: 'Đô thị mới Phú Đa', cls: 'III', key: 'dothi:phu-da', partial: 'Phú Vang' },
  { id: 'loc-son', name: 'Đô thị mới Lộc Sơn', cls: 'III', key: 'dothi:loc-son', partial: 'Hưng Lộc' },
  { id: 'khe-tre', name: 'Đô thị mới Khe Tre', cls: 'III', key: 'dothi:khe-tre', partial: 'Khe Tre' },
  { id: 'phu-loc', name: 'Đô thị mới Phú Lộc', cls: 'III', key: 'dothi:phu-loc', partial: 'Phú Lộc' },
  { id: 'vinh-hien', name: 'Đô thị mới Vinh Hiền', cls: 'III', key: 'dothi:vinh-hien', partial: 'Vinh Lộc' }
];

const STATUS_LABEL = {
  thieu: 'Thiếu',
  'co-san': 'Có sẵn',
  mien: 'Miễn',
  'phu-thuoc': 'Phụ thuộc',
  'bo-sung': 'Bổ sung',
  'khong-nhap': 'Không nhập'
};

export function fieldByKey(key) {
  return ENTRY_FIELDS.find(f => f.key === key) || null;
}

export function fieldsForScope(scope) {
  return ENTRY_FIELDS.filter(f => f.scopes.includes(scope));
}

const LAYER_NOTE = {
  ldPhiNong: 'Không có lớp việc làm trong 7 lớp hiện trạng. Cán bộ nhập.',
  nuocSach: 'Lớp cấp nước tạm thời chỉ có chiều dài ống và congsuat điểm, không có dân được phục vụ. Ô % vẫn thiếu; cán bộ nhập để ghi đè.',
  matDoCong: 'Lớp san nền hiện trạng chưa phải kiểm kê cống chính và chưa có file gộp. Ô km/km² vẫn thiếu.',
  xlnt: 'Điểm XLNT hiện trạng có congsuat, không có cặp vận hành/thiết kế. Ô % vẫn thiếu.',
  ctr: 'Điểm CTR hiện trạng không có tỷ lệ xử lý đạt. Ô % vẫn thiếu.',
  nghiaTrang: 'Điểm nghĩa trang hiện trạng không có tỷ lệ diện tích đã xây trên quy hoạch. Ô % vẫn thiếu.',
  giuongBenh: 'Điểm y tế không nằm trong 7 lớp mạng và không có số giường.',
  khongGianXanh: 'Hiện trạng sử dụng đất trong repo chỉ phủ KCN Phong Điền. Không suy tỷ lệ xanh cả đô thị. Ô % vẫn thiếu.',
  vaiTro: 'Không có thuộc tính vai trò trên lớp hiện trạng.',
  trungTam: 'Không có thuộc tính vai trò trung tâm trên lớp hiện trạng.',
  dauMoiGt: 'Điểm đầu mối tạm thời không có cấp vùng, tỉnh, xã. Ô mức vẫn thiếu.',
  quyCheKt: 'PDF quy chế không ghi số năm đã thực hiện.'
};

function entryNote(key) {
  return LAYER_NOTE[key] || 'Chưa có số liệu trong webapp. Cán bộ nhập ở luồng Hành chính.';
}

function row(unit, unitKey, field, code, status, note, key = '') {
  return { unit, unitKey, field, code: code || '', status, label: STATUS_LABEL[status] || status, note, key };
}

function urbanFieldRows(u) {
  const out = [];
  const partial = !!u.partial;
  if (u.cls === 'I') {
    out.push(row(u.name, u.key, 'Dân số toàn thành phố', '1.II.07', 'co-san', 'Tổng dân số các phường, xã. Ô nhập chỉ để đính chính.', 'danSo'));
    out.push(row(u.name, u.key, 'Dân số tạm trú cộng thêm', '', 'bo-sung', 'Webapp chưa tách tạm trú.', 'danSoTamTru'));
    out.push(row(u.name, u.key, 'Diện tích tự nhiên', '', 'co-san', 'Tổng diện tích các phường, xã.', 'dienTich'));
    ENTRY_FIELDS.filter(f => f.scopes.includes('tp') && f.kind === 'yesno').forEach(f => {
      const note = f.key === 'i11'
        ? 'Điểm đầu mối tạm thời không ghi cấp khu vực hoặc quốc tế. Ô đạt/chưa đạt vẫn nhập tay.'
        : 'Tiêu chuẩn chữ Phụ lục I, chưa có nguồn tính.';
      out.push(row(u.name, u.key, f.label, f.code, 'thieu', note, f.key));
    });
    out.push(row(u.name, u.key, 'Tỷ lệ phường đạt trình độ loại II', '1.II.10', 'khong-nhap', 'Cần Bảng 2B. Webapp chưa chấm Bảng 2B, không có ô nhập.'));
    return out;
  }
  const bound = partial ? PART_BOUNDS[u.id] : null;
  out.push(row(u.name, u.key, 'Ranh giới đô thị', '', bound || !partial ? 'co-san' : 'thieu',
    bound ? `Polygon ${u.id} trong public/data/urban614.geojson, ${bound.km2} km², trong xã ${u.partial}.`
      : (partial ? `Một phần xã ${u.partial}. Chưa có ranh riêng.` : 'Ghép từ ranh phường, xã trong phạm vi.')));
  out.push(row(u.name, u.key, 'Dân số phần đô thị', '2A.II.03', bound ? 'phu-thuoc' : (partial ? 'thieu' : 'co-san'),
    bound ? `Dân số xã ${u.partial} × ${bound.km2} km² / diện tích xã. Ô nhập để đính chính.`
      : (partial ? 'Không lấy dân số cả xã. Cán bộ nhập dân số phần đô thị.' : 'Cộng dân số hiện trạng các phường, xã trong phạm vi.'), 'danSo'));
  out.push(row(u.name, u.key, 'Diện tích tự nhiên', '2A.II.04', bound || !partial ? 'co-san' : 'thieu',
    bound ? `Diện tích polygon ${bound.km2} km². Mật độ dân số vẫn được miễn với đô thị di sản.`
      : (partial ? 'Không lấy diện tích cả xã.' : 'Cộng diện tích các phường, xã. Mật độ trên diện tích tự nhiên được miễn với đô thị di sản.'), 'dienTich'));
  out.push(row(u.name, u.key, 'Mật độ dân số', '2A.II.04', 'mien', 'Điều 8 khoản 2 điểm d: không xem xét, tính điểm tối thiểu.'));
  out.push(row(u.name, u.key, 'Dân số tạm trú cộng thêm', '', 'bo-sung', 'Dân số phường chưa tách tạm trú.', 'danSoTamTru'));
  out.push(row(u.name, u.key, 'Mật độ đường', '2A.III.07', bound || !partial ? 'phu-thuoc' : 'thieu',
    bound ? 'Bằng mật độ đường của xã chủ: chiều dài đường và đất xây dựng chỉ có theo xã. Ô nhập để đính chính.'
      : (partial ? 'Chưa có ranh nên không chia mạng đường. Có ô nhập.' : 'Tính từ OpenStreetMap và đất xây dựng nếu đủ. Ô nhập dùng khi thiếu.'), 'matDoDuong'));
  ENTRY_FIELDS.filter(f => f.code && f.code.startsWith('2A.') && !f.override).forEach(f => {
    out.push(row(u.name, u.key, f.label, f.code, 'thieu', entryNote(f.key), f.key));
  });
  return out;
}

function wardFieldRows(name) {
  const code = areaCodeFromName(name);
  const key = `xa:${code}`;
  const host = EVAL_URBANS.find(u => u.partial && bareName(u.partial) === bareName(name));
  const out = [
    row(name, key, 'Dân số cả xã, phường', '2A.II.03', 'co-san', 'Cột dân số bảng phường. Ô nhập chỉ để đính chính.', 'danSo'),
    row(name, key, 'Diện tích cả xã, phường', '2A.II.04', 'co-san', 'Cột diện tích bảng phường. Ô nhập chỉ để đính chính.', 'dienTich')
  ];
  if (host) {
    const bound = PART_BOUNDS[host.id];
    out.push(row(name, key, 'Dân số phần đô thị', '2A.II.03', bound ? 'phu-thuoc' : 'thieu',
      bound ? `Ước tại ${host.name}: dân số cả xã × ${bound.km2} km² / diện tích xã.` : `Nhập tại ${host.name}, không dùng dân số cả xã.`));
    out.push(row(name, key, 'Diện tích phần đô thị', '2A.II.04', bound ? 'co-san' : 'thieu',
      bound ? `${bound.km2} km², polygon ${host.id} trong public/data/urban614.geojson.` : `Nhập tại ${host.name}, không dùng diện tích cả xã.`));
  }
  ENTRY_FIELDS.filter(f => f.scopes.includes('xa') && !f.override).forEach(f => {
    out.push(row(name, key, f.label, f.code, 'thieu', entryNote(f.key), f.key));
  });
  return out;
}

export function gapRows() {
  return [...EVAL_URBANS.flatMap(urbanFieldRows), ...WARD_NAMES.flatMap(wardFieldRows)];
}

export function gapCounts() {
  const rows = gapRows();
  const count = (status, pred) => rows.filter(r => r.status === status && (!pred || pred(r))).length;
  return {
    rows: rows.length,
    thieu: count('thieu'),
    partialDanSo: EVAL_URBANS.filter(u => u.partial).length,
    wards: WARD_NAMES.length
  };
}

function esc(s) {
  return String(s || '').replace(/\|/g, '/');
}

export function gapMarkdown() {
  const rows = gapRows();
  const counts = gapCounts();
  const lines = [
    '# Số liệu còn thiếu để chấm phân loại đô thị',
    '',
    'Nguồn đối chiếu: `urbanClass.js` (Nghị quyết 111/2025/UBTVQH15, Quyết định 756/QĐ-UBND). Bảng này là lúc chưa có số cán bộ nhập.',
    '',
    `Tổng ${counts.rows} ô (đơn vị × trường). Trong đó **${counts.thieu} ô thiếu**. ${counts.partialDanSo} đô thị một phần xã lấy ranh từ public/data/urban614.geojson; dân số ước theo tỷ lệ diện tích, không còn ô thiếu cho ranh, dân số, diện tích và mật độ đường của các đô thị đó. Lớp hiện trạng (kể cả file tạm thời giao thông, cấp điện, cấp nước) cho biết chiều dài và số điểm khi mở bảng chấm, không điền các ô tỷ lệ còn thiếu.`,
    '',
    'Trạng thái: Thiếu = cần nhập; Có sẵn = webapp đã tính từ bảng phường hoặc ranh; Miễn = không xem xét với đô thị di sản; Phụ thuộc = tính được nếu dữ liệu nền đủ, vẫn có ô nhập; Bổ sung = nên có, chưa chặn chấm; Không nhập = chưa có cách chấm (Bảng 2B).',
    '',
    '| Đơn vị | Mã đơn vị | Trường | Mã tiêu chuẩn | Trạng thái | Ghi chú |',
    '|---|---|---|---|---|---|'
  ];
  rows.forEach(r => {
    lines.push(`| ${esc(r.unit)} | ${esc(r.unitKey)} | ${esc(r.field)} | ${esc(r.code)} | ${r.label} | ${esc(r.note)} |`);
  });
  lines.push(
    '',
    '## Cách giao một cán bộ mỗi xã, phường',
    '',
    'Tab `CanBo` trên cùng Google Sheet: Họ tên, SĐT, Đơn vị công tác (droplist `mã — tên`), Email, Trạng thái TRUE/FALSE. Email TRUE chỉ gửi đúng đơn vị của mình. Quản trị không bị khóa. Đăng nhập vẫn là nút Google sẵn có, không thêm nhà cung cấp và không cron.',
    '',
    'Máy chủ đối chiếu email lúc ghi. Quản trị ghi thẳng bản công bố. Cán bộ ghi hàng chờ: tab `ChoDuyet` (cho_duyet / da_duyet / tu_choi) và object `cho-duyet/` trên bucket. Duyệt hoặc từ chối chỉ khi quản trị bấm trong mục Quản trị. Bản chờ không lên bản đồ công khai.',
    '',
    'Commit trong repo và bản quản trị tải sử dụng đất hoặc ranh là bản công bố. Nếu `su-dung-dat-index.json` hoặc file đồ án đã có lớp cùng vai trò thì không thêm bản sao.',
    '',
    `Tab chỉ tiêu đề xuất: \`${CHI_TIEU_SHEET}\`. Tab công trình kiến trúc đề xuất: \`${KIEN_TRUC_SHEET}\`. Cả hai không thuộc 14 nhóm hạ tầng nên không đẩy vào \`infrastructure_hue.json\`.`,
    ''
  );
  return lines.join('\n');
}
