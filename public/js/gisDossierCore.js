// Đối chiếu HoSoGIS với Phụ lục II Thông tư 16/2025/TT-BXD (khoản 6 và Phần 2–3).
// Phần 3 ghi là nội dung tham khảo: thiếu nhóm/lớp trong danh mục chỉ cảnh báo.
// Bảng in đánh số tới 70 lớp hiện trạng và 81 lớp quy hoạch nhưng khuyết số (HT: 42, 43, 51; QH: 52, 54).
// Bộ quy tắc dùng đúng các lớp được nêu tên, không thêm lớp cho đủ số đếm.

const PACKAGES = ['NenDiaHinh', 'HienTrang', 'QuyHoach', 'MocGioi'];

const HIEN_TRANG = {
  ViTriRanhGioi: ['TenDonViHanhChinh_P', 'RanhGioiHanhChinh_L', 'RanhGioiQuyHoach_A'],
  HienTrangSuDungDat: ['ChucNangCongTrinh_P', 'ChucNangSuDungDat_A', 'PhanVungSDDkhac_A'],
  HienTrangKhongGianKienTrucCanhQuan: ['CongTrinh_A', 'CongTrinh_L'],
  DanhGiaHienTrangDatXayDung: ['DuAnLienQuan_A', 'PhanVungDanhGia_A'],
  HienTrangGiaoThong: [
    'CongTrinhGiaoThong_P', 'CongTrinhGiaoThong_L', 'CongTrinhGiaoThong_A',
    'MangLuoiGiaoThongDuongBo_L', 'MangLuoiGiaoThongDuongBo_A',
    'MangLuoiGiaoThongDuongSat_L', 'MangLuoiGiaoThongDuongThuy_L', 'MangLuoiGiaoThongDuongKhong_L',
    'MangLuoiTuyenBus_L', 'BoViaDaiPhanCach_L', 'HuongDi_L', 'MatCatNgang_L'
  ],
  HienTrangCGDD_CGXDHanhLangHTKT: ['ChiGioiXayDung_L', 'ChiGioiDuongDo_L', 'HanhLangAnToan_L'],
  HienTrangChuanBiKyThuat: [
    'CaoDoNen_P', 'CongTrinhCBKT_P', 'CongTrinhCBKT_L', 'CongTrinhCBKT_A',
    'MangLuoiThoatNuocMua_L', 'CaoDoCongTNM_P', 'HuongThoatNuocMua_L', 'MatNuoc_A',
    'PhanLuuThoatNuocMua_L', 'PhanVungLuuVuc_A'
  ],
  HienTrangThoatNuocThaiVSMT: [
    'CaoDoCongThoatTNT_P', 'MangLuoiThoatNuocThai_L', 'HuongThoatNuocThai_L', 'PhanLuuThoatNuocThai_L',
    'CongTrinhTNTvaVSMT_P', 'CongTrinhTNTvaVSMT_L', 'CongTrinhTNTvaVSMT_A'
  ],
  HienTrangCapNuoc: ['MangLuoiCapNuoc_L', 'DiemDauNoi_P', 'PhanVungCapNuoc_A', 'CongtrinhCapNuocPCCC_P', 'CongtrinhCapNuocPCCC_A'],
  HienTrangCapDien: ['MangLuoiPhanPhoiDien_L', 'MangLuoiChieuSang_L', 'CongTrinhCapDien_P', 'CongTrinhCapDien_A', 'CongTrinhChieuSang_P', 'PhanVungCapDien_A'],
  HienTrangThongTinLienLac: ['MangLuoiCapThongTin_L', 'CongTrinhThongTin_P', 'CongTrinhThongTin_A', 'PhanVungPhucVu_A'],
  DanhGiaHienTrangMoiTruong: ['DanhGiaMoiTruong_P', 'DanhGiaMoiTruong_L', 'DanhGiaMoiTruong_A', 'DiemQuanTrac_P'],
  HienTrangCongTrinhNgam: ['CongTrinhNgam_A', 'CongTrinhNgam_L', 'CongTrinhNgam_P'],
  HienTrangNangLuong: ['MangLuoiNangLuong_L', 'CongTrinhNangLuong_P', 'CongTrinhNangLuong_A']
};

const QUY_HOACH = {
  ViTriRanhGioi: ['TenDonViHanhChinh_P', 'RanhGioiHanhChinh_L', 'RanhGioiQuyHoach_A'],
  QuyHoachSuDungDat: ['ChucNangCongTrinh_P', 'ChucNangSuDungDat_A', 'PhanOQuyHoach_A', 'PhanKhuQuyHoach_A', 'PhanVungSDDkhac_A'],
  ThietkeDoThi: ['DiemNhanChinh_P', 'TuyenTKDT_L', 'KhuVucPhoiCanh_A'],
  QuyHoachKhongGianKienTrucCanhQuan: ['CongTrinh_A', 'CongTrinh_L', 'KhongGianKTCQ_A', 'KhongGianKTCQ_L', 'CayXanh_P'],
  QuyHoachGiaoThong: [
    'CongTrinhGiaoThong_P', 'CongTrinhGiaoThong_L', 'CongTrinhGiaoThong_A',
    'MangLuoiGiaoThongDuongBo_L', 'MangLuoiGiaoThongDuongBo_A',
    'MangLuoiGiaoThongDuongSat_L', 'MangLuoiGiaoThongDuongThuy_L', 'MangLuoiGiaoThongDuongKhong_L',
    'MangLuoiTuyenBus_L', 'BoViaDaiPhanCach_L', 'HuongDi_L', 'MatCatNgang_L',
    'DiemToaDoTimDuongChuyenHuongTimDuong_P', 'BanKinhBoViaBanKinhTimDuong_P'
  ],
  QuyHoachCGDD_CGXDHanhLangHTKT: ['ChiGioiXayDung_L', 'ChiGioiDuongDo_L', 'HanhLangAnToan_L'],
  QuyHoachChuanBiKyThuat: [
    'CaoDoNen_P', 'DongMucThietKe_L', 'ThongTinSanNen_P', 'PhanVungSanNen_A',
    'CongTrinhCBKT_P', 'CongTrinhCBKT_L', 'CongTrinhCBKT_A',
    'MangLuoiThoatNuocMua_L', 'CaoDoCongTNM_P', 'HuongThoatNuocMua_L', 'MatNuoc_A',
    'PhanLuuThoatNuocMua_L', 'PhanVungLuuVuc_A'
  ],
  QuyHoachThoatNuocThaiVSMT: [
    'CaoDoCongThoatTNT_P', 'MangLuoiThoatNuocThai_L', 'HuongThoatNuocThai_L', 'PhanLuuThoatNuocThai_L',
    'NutTinhToanTNT_P', 'CongTrinhTNTvaVSMT_P', 'CongTrinhTNTvaVSMT_L', 'CongTrinhTNTvaVSMT_A'
  ],
  QuyHoachCapNuoc: ['MangLuoiCapNuoc_L', 'DiemDauNoi_P', 'PhanVungCapNuoc_A', 'CongtrinhCapNuocPCCC_P', 'CongtrinhCapNuocPCCC_A'],
  QuyHoachCapDien: ['MangLuoiPhanPhoiDien_L', 'MangLuoiChieuSang_L', 'CongTrinhCapDien_P', 'CongTrinhCapDien_A', 'CongTrinhChieuSang_P', 'PhanVungCapDien_A'],
  QuyHoachThongTinLienLac: ['MangLuoiCapThongTin_L', 'CongTrinhThongTin_P', 'CongTrinhThongTin_A', 'PhanVungPhucVu_A'],
  GiaiPhapBaoVeMoiTruong: ['GiaiPhapBaoVeMoiTruong_P', 'GiaiPhapBaoVeMoiTruong_L', 'GiaiPhapBaoVeMoiTruong_A', 'DiemQuanTrac_P'],
  QuyHoachCongTrinhNgam: ['CongTrinhNgam_A', 'CongTrinhNgam_L', 'CongTrinhNgam_P'],
  QuyHoachNangLuong: ['MangLuoiNangLuong_L', 'CongTrinhNangLuong_P', 'CongTrinhNangLuong_A']
};

export const GIS_CATALOG = {
  NenDiaHinh: {},
  HienTrang: HIEN_TRANG,
  QuyHoach: QUY_HOACH,
  MocGioi: {
    MocGioiQuyHoach: ['MocGioiQuyHoach_P', 'MocGioiQuyHoach_L', 'MocGioiQuyHoach_A']
  }
};

// Sáu trường tối thiểu, Phụ lục II Phần 3 mục (4). min: số ký tự mã hồ sơ phải chứa được.
const FIELD_SPEC = [
  { name: 'maThongTinQH', len: 15, id: true },
  { name: 'maHoSoQH', len: 15, min: 12, id: true },
  { name: 'maDoiTuong', len: 100, id: true },
  { name: 'tenDoiTuong', len: 100 },
  { name: 'phanLoai', len: 250 },
  { name: 'ghiChu', len: 250, note: true }
];

const GEOM_LABEL = { A: 'vùng', P: 'điểm', L: 'đường' };

// Phụ lục I Thông tư 16/2025/TT-BXD: tên phân lớp CAD, không phải mã địa chính TT 16/2021/TT-BTNMT.
// Cùng loại hồ sơ có vài tỷ lệ: lấy hợp các bảng của loại đó vì maHoSoQH không ghi tỷ lệ.
const QHC_10K = ['DAT_DD_Donvio', 'DAT_DD_Honhop', 'DAT_DD_DVCCdothi', 'DAT_DD_Coquandothi', 'DAT_DD_CayxanhCCdothi', 'DAT_DD_Giaothongdothi', 'DAT_DD_HTkhacdothi', 'DAT_NDD_Congnghiep', 'DAT_NDD_Daotao', 'DAT_NDD_Coquan', 'DAT_NDD_Dulich', 'DAT_NDD_Yte', 'DAT_NDD_Vanhoathethao', 'DAT_NDD_CayxanhSDHC', 'DAT_NDD_CayxanhCD', 'DAT_NDD_Ditich', 'DAT_NDD_DancuNT', 'DAT_NDD_Anninh', 'DAT_NDD_Quocphong', 'DAT_NNK_Nongnghiep', 'DAT_NNK_Rungdacdung', 'DAT_NNK_Rungphongho', 'DAT_NNK_Rungsanxuat', 'DAT_NNK_Thuysan', 'DAT_NNK_Chuasudung', 'DAT_NNK_Honuoc', 'DAT_NNK_Songsuoi', 'DAT_NNK_Matnuocbien'];
const QHC_5K = ['DAT_DD_Nhomnhao', 'DAT_DD_Honhop_Nhomo', 'DAT_DD_TruongTHPT', 'DAT_DD_Truonghoc', 'DAT_DD_DVCCdothi', 'DAT_DD_Coquandothi', 'DAT_DD_CayxanhCCdothi', 'DAT_DD_Giaothongdothi', 'DAT_DD_HTkhacdothi', 'DAT_NDD_Congnghiep', 'DAT_NDD_Daotao', 'DAT_NDD_Coquan', 'DAT_NDD_Dulich', 'DAT_NDD_Yte', 'DAT_NDD_Vanhoathethao', 'DAT_NDD_CayxanhSDHC', 'DAT_NDD_CayxanhCD', 'DAT_NDD_Ditich', 'DAT_NDD_Anninh', 'DAT_NDD_Quocphong', 'DAT_NNK_Nongnghiep', 'DAT_NNK_Rungdacdung', 'DAT_NNK_Rungphongho', 'DAT_NNK_Rungsanxuat', 'DAT_NNK_Thuysan', 'DAT_NNK_Chuasudung', 'DAT_NNK_Honuoc', 'DAT_NNK_Songsuoi', 'DAT_NNK_Matnuocbien'];
const QHC_KXD = ['DAT_KXD_Dancudothi', 'DAT_KXD_Dancunongthon', 'DAT_KXD_Honhop', 'DAT_KXD_Dichvucongcong', 'DAT_KXD_CayxanhCC', 'DAT_KXD_CayxanhSDHC', 'DAT_KXD_CayxanhCD', 'DAT_KXD_Congnghiep', 'DAT_KXD_Daotao', 'DAT_KXD_Coquantruso', 'DAT_KXD_Yte', 'DAT_KXD_Vanhoathethao', 'DAT_KXD_Dulich', 'DAT_KXD_Ditich', 'DAT_KXD_Anninh', 'DAT_KXD_Quocphong', 'DAT_KXD_Giaothong', 'DAT_KXD_HTKTkhac', 'DAT_NNK_Nongnghiep', 'DAT_NNK_Rungdacdung', 'DAT_NNK_Rungphongho', 'DAT_NNK_Rungsanxuat', 'DAT_NNK_Thuysan', 'DAT_NNK_Chuasudung', 'DAT_NNK_Honuoc', 'DAT_NNK_Songsuoi', 'DAT_NNK_Matnuocbien'];
const QHPK_CODES = ['DAT_O_Nhomnhao', 'DAT_O_Honhop_Nhomo', 'DAT_O_Langxom', 'DAT_HTXH_Yte', 'DAT_HTXH_Vanhoa', 'DAT_HTXH_TruongTHPT', 'DAT_HTXH_Truonghoc', 'DAT_HTXH_CayxanhCC', 'DAT_Cayxanhhanche', 'DAT_Cayxanhchuyendung', 'DAT_SX_Congnghiep', 'DAT_SX_Vatlieu', 'DAT_DaotaoNC', 'DAT_Coquan', 'DAT_Dichvu', 'DAT_Dulich', 'DAT_Ditich_tongiao', 'DAT_Anninh', 'DAT_Quocphong', 'DAT_HTKT_DuongGT', 'DAT_HTKT_Baidoxe', 'DAT_HTKT_Nghiatrang', 'DAT_NN_Nongnghiep', 'DAT_NN_Rungdacdung', 'DAT_NN_Rungphongho', 'DAT_NN_Rungsanxuat', 'DAT_NN_Thuysan', 'DAT_KHAC_Chuasudung', 'DAT_KHAC_Honuoc', 'DAT_KHAC_Songsuoi', 'DAT_KHAC_Matnuocbien'];
const QHCT_CODES = ['DAT_NO_Nhaolienke', 'DAT_NO_Nhaobietthu', 'DAT_NO_Nhaochungcu', 'DAT_NO_NhaochungcuHH', 'DAT_NO_Nhaonongthon', 'DAT_CTHTXH_Vanhoa', 'DAT_CTHTXH_Yte', 'DAT_CTHTXH_TruongTHPT', 'DAT_CTHTXH_Truonghoc', 'DAT_CTHTXH_Theducthethao', 'DAT_CTHTXH_CayxanhCC', 'DAT_CTHTXD_ThuongmaiDV', 'DAT_CTSX_Congnghiep', 'DAT_CT_Daotaonghiencuu', 'DAT_CT_Coquan', 'DAT_CT_Dichvu', 'DAT_CT_Dulich', 'DAT_CT_Ditichtongiao', 'DAT_CT_Cayxanhhanche', 'DAT_CT_Cayxanhchuyendung', 'DAT_CTHTKT_DuongGT', 'DAT_CTHTKT_Baidoxe', 'DAT_CTHTKT_Nghiatrang', 'DAT_CTHTKT_Hatangkhac', 'DAT_CT_Anninh', 'DAT_CT_Quocphong', 'DAT_NLK_Nongnghiep', 'DAT_NLK_Rungdacdung', 'DAT_NLK_Rungphongho', 'DAT_NLK_Rungsanxuat', 'DAT_NLK_Thuysan', 'DAT_NLK_Chuasudung', 'DAT_NLK_Honuoc', 'DAT_NLK_Songsuoi', 'DAT_NLK_Matnuocbien'];
const LAND_USE = {
  QHC: new Set([...QHC_10K, ...QHC_5K, ...QHC_KXD]),
  QPK: new Set(QHPK_CODES),
  QCT: new Set(QHCT_CODES)
};
const KIND_LABEL = { QHC: 'QHC', QPK: 'QHPK', QCT: 'QHCT' };

// Phụ lục II Phần 1 mục 5b. Văn bản ghi sheet HoSo 19 cột nhưng liệt kê 20 mục.
export const META_COLUMNS = {
  HoSo: ['Mã hồ sơ', 'Mã thông tin quy hoạch', 'Tên đồ án', 'Loại quy hoạch', 'Tỷ lệ', 'Số quyết định phê duyệt nhiệm vụ quy hoạch', 'Ngày quyết định phê duyệt nhiệm vụ quy hoạch', 'Số quyết định phê duyệt quy hoạch', 'Ngày ra quyết định phê duyệt quy hoạch', 'Đơn vị tư vấn lập quy hoạch', 'Đơn vị ra quyết định phê duyệt quy hoạch', 'Tình trạng', 'Hệ tọa độ', 'Địa điểm', 'Chủ đầu tư', 'Thư mục', 'Có HoSoBASIC', 'Có HoSoGIS', 'Từ khóa', 'Ghi chú'],
  BanVe: ['Mã hồ sơ', 'Số hiệu bản vẽ', 'Tên rút gọn', 'Tên bản Vẽ', 'Số tờ', 'Tên thư mục', 'Tỷ lệ', 'Ghi chú'],
  VanBan: ['Mã hồ sơ', 'Mã văn bản/Tên file', 'Tên văn bản', 'Loại văn bản', 'Số hiệu văn bản', 'Trích yếu', 'Ngày ký', 'Đơn vị ban hành', 'Số trang', 'Ghi chú']
};

const CRS_NAME = {
  HUE_3: 'VN-2000, kinh tuyến trục 107°, múi 3°',
  HUE_107_45: 'VN-2000, kinh tuyến trục 107°45′',
  UTM48_6: 'VN-2000 UTM, múi 6°, kinh tuyến 105°',
  WGS84: 'WGS84',
  OTHER: 'hệ khác'
};
// Ví dụ Thông tư dùng 0 cho lần lập đầu; lời văn ghi 1. Cả hai đều được, có ghi chú một lần.
const MA_HO_SO = /^(\d{2})(QHC|QPK|QCT)(\d)(\d{2})(\d{4})$/;

const compact = (s) => String(s || '').replace(/\s+/g, '').normalize('NFC');
const keyOf = (s) => compact(s).toLowerCase();

const LAYER_INDEX = [];
for (const pkg of PACKAGES) {
  for (const [group, names] of Object.entries(GIS_CATALOG[pkg])) {
    names.forEach(name => LAYER_INDEX.push({ pkg, group, name, key: keyOf(name) }));
  }
}

export function packageIdOf(segment) {
  const base = String(segment || '').replace(/\.(gdb|gpkg)$/i, '');
  return PACKAGES.find(id => id.toLowerCase() === base.toLowerCase()) || '';
}

function validToken(name, layer) {
  if (!name || /\s/.test(name) || /[^\x00-\x7F]/.test(name)) return false;
  return layer
    ? /^[A-Z][A-Za-z0-9]*_[APL]$/.test(name)
    : /^[A-Z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(name);
}

function catalogHits(layerName) {
  const k = keyOf(layerName);
  return LAYER_INDEX.filter(row => row.key === k);
}

function bindFields(fields) {
  const used = new Set();
  const bound = {};
  for (const spec of FIELD_SPEC) {
    const exact = (fields || []).find(f => !used.has(f.name) && f.name.toLowerCase() === spec.name.toLowerCase());
    // Shapefile giữ tối đa 10 ký tự tên trường: maThongTinQH thành maThongTi, tenDoiTuong thành tenDoiTuon.
    const cut = exact ? null : (fields || []).find(f => !used.has(f.name)
      && f.name.length >= 8 && f.name.length < spec.name.length
      && spec.name.toLowerCase().startsWith(f.name.toLowerCase()));
    const hit = exact || cut;
    if (!hit) continue;
    used.add(hit.name);
    bound[spec.name] = { field: hit, how: exact ? 'exact' : 'cut' };
  }
  return bound;
}

function suffixOf(name) {
  const m = compact(name).match(/_([APL])$/i);
  return m ? m[1].toUpperCase() : '';
}

function joinCount(items, n = 6) {
  if (!items.length) return '';
  const head = items.slice(0, n).join(', ');
  return items.length > n ? `${head} và ${items.length - n} lớp khác` : head;
}

function fieldIssues(layer) {
  const out = [];
  if (!layer.fields) return out;
  const bound = bindFields(layer.fields);
  const where = layer.name;
  for (const spec of FIELD_SPEC) {
    const got = bound[spec.name];
    if (!got) {
      out.push({ level: 'fail', text: `Thiếu trường ${spec.name}` });
      continue;
    }
    if (got.how === 'cut') {
      out.push({ level: 'warn', text: `Trường ${spec.name} bị cắt còn "${got.field.name}" (shapefile chỉ giữ 10 ký tự). Nên nộp GeoPackage hoặc FileGDB để giữ nguyên tên.` });
    } else if (got.field.name !== spec.name) {
      out.push({ level: 'warn', text: `Trường ${got.field.name} khác cách viết của ${spec.name}` });
    }
    const type = String(got.field.type || '').toUpperCase();
    const textType = !type || type === 'C' || type === 'TEXT' || type.startsWith('VARCHAR') || type.startsWith('CHAR') || type === 'V' || type === 'W';
    if (!textType) out.push({ level: 'fail', text: `${spec.name} phải là TEXT, đang là ${got.field.type}` });
    const declared = Number(got.field.len) || 0;
    if (spec.min && declared && declared < spec.min) {
      out.push({ level: 'fail', text: `${spec.name} dài ${declared} ký tự, mã hồ sơ cần ít nhất ${spec.min}` });
    } else if (declared && declared < spec.len) {
      out.push({ level: 'warn', text: `${spec.name} khai báo ${declared} ký tự, Thông tư ghi ${spec.len}` });
    }
  }
  const values = layer.values;
  if (!values) return out.map(i => ({ ...i, pkg: layer.pkg, group: layer.group, layer: where }));
  for (const spec of FIELD_SPEC) {
    const stat = values[spec.name];
    if (!stat) continue;
    if (spec.id && stat.empty) {
      out.push({ level: 'fail', text: `${spec.name}: ${stat.empty} dòng để trống` });
    } else if (!spec.note && stat.empty) {
      out.push({ level: 'warn', text: `${spec.name}: ${stat.empty} dòng để trống` });
    }
    if (stat.bad) out.push({ level: 'fail', text: stat.bad });
    if (stat.warn) out.push({ level: 'warn', text: stat.warn });
  }
  if (values.mojibake) out.push({ level: 'warn', text: 'Có ký tự lỗi bảng mã. Kèm file .cpg UTF-8 (TCVN 6909).' });
  return out.map(i => ({ ...i, pkg: layer.pkg, group: layer.group, layer: where }));
}

function checkLayer(layer) {
  const issues = [];
  const name = layer.name || '';
  const suffix = suffixOf(name);
  const hits = catalogHits(name);
  const inPkg = hits.filter(h => h.pkg === layer.pkg);
  const hit = inPkg[0] || null;
  if (!suffix) {
    issues.push({ level: 'fail', pkg: layer.pkg, group: layer.group, layer: name, text: 'Tên lớp thiếu hậu tố _A (vùng), _P (điểm) hoặc _L (đường)' });
  } else if (layer.geom && layer.geom !== suffix) {
    issues.push({ level: 'fail', pkg: layer.pkg, group: layer.group, layer: name, text: `Hậu tố _${suffix} là ${GEOM_LABEL[suffix]}, file đang là ${GEOM_LABEL[layer.geom] || layer.geom}` });
  } else if (layer.geom === '') {
    issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: 'Lớp không có hình' });
  } else if (layer.multi) {
    issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: 'Kiểu MultiPoint. Thông tư quy ước điểm là P.' });
  }
  if (layer.geom == null && suffix) {
    issues.push({
      level: layer.source === 'shp' ? 'fail' : 'warn', pkg: layer.pkg, group: layer.group, layer: name,
      text: layer.source === 'shp' ? 'Thiếu file .shp hoặc không đọc được kiểu hình' : 'Chưa đọc được kiểu hình trong GeoPackage, mới đối chiếu hậu tố tên lớp'
    });
  }
  if (layer.partial) issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: 'File .dbf lớn, mới đọc phần đầu' });
  if (hit) {
    if (compact(name) !== hit.name) {
      issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: `Khác cách viết trong bảng Phụ lục: ${hit.name}` });
    }
    if (layer.group && keyOf(layer.group) !== keyOf(hit.group)) {
      issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: `Đang ở nhóm ${layer.group}, bảng Phụ lục ghi ${hit.group}` });
    }
  } else if (hits.length && layer.pkg && hits.every(h => h.pkg !== layer.pkg)) {
    const pkgs = [...new Set(hits.map(h => h.pkg))].join(', ');
    issues.push({ level: 'warn', pkg: layer.pkg, group: layer.group, layer: name, text: `Tên lớp thuộc danh mục ${pkgs}, đang nằm trong ${layer.pkg}` });
  } else if (!hits.length && layer.pkg !== 'NenDiaHinh') {
    if (validToken(compact(name), true) && (!layer.geom || !suffix || layer.geom === suffix)) {
      issues.push({ level: 'ok', pkg: layer.pkg, group: layer.group, layer: name, text: 'Lớp phát sinh, đúng quy tắc đặt tên (Phần 1, mục 6.b)' });
    } else {
      issues.push({ level: 'fail', pkg: layer.pkg, group: layer.group, layer: name, text: 'Tên lớp không có trong danh mục và không đúng quy tắc <TênLớp>_<A|P|L>' });
    }
  } else if (layer.pkg === 'NenDiaHinh' && !validToken(compact(name), true)) {
    issues.push({ level: 'fail', pkg: layer.pkg, group: layer.group, layer: name, text: 'Lớp nền địa hình không đúng quy tắc đặt tên' });
  }
  if (hit && !layer.group && layer.source === 'shp') {
    issues.push({ level: 'warn', pkg: layer.pkg, group: '', layer: name, text: `Không có thư mục nhóm. Bảng Phụ lục xếp lớp này vào ${hit.group}` });
  }
  issues.push(...fieldIssues(layer));
  if (!issues.some(i => i.level === 'fail' || i.level === 'warn' || i.level === 'ok')) {
    issues.push({ level: 'ok', pkg: layer.pkg, group: layer.group, layer: name, text: 'Đúng tên, kiểu hình và sáu trường tối thiểu' });
  }
  const level = issues.some(i => i.level === 'fail') ? 'fail' : issues.some(i => i.level === 'warn') ? 'warn' : 'ok';
  return { level, issues: issues.filter(i => i.level !== 'ok' || issues.length === 1) };
}

function missingGroups(pkg, layers) {
  const groups = GIS_CATALOG[pkg];
  const present = new Set(layers.filter(l => l.pkg === pkg).map(l => keyOf(l.group)));
  const out = [];
  for (const [group, names] of Object.entries(groups)) {
    const found = new Set(layers.filter(l => l.pkg === pkg && (keyOf(l.group) === keyOf(group) || catalogHits(l.name).some(h => h.pkg === pkg && h.group === group))).map(l => keyOf(l.name)));
    if (!found.size && !present.has(keyOf(group))) {
      out.push({ group, missing: names, partial: false });
    } else {
      const missing = names.filter(n => !found.has(keyOf(n)));
      if (missing.length) out.push({ group, missing, partial: true });
    }
  }
  return out;
}

export function planKindOf(code) {
  const m = String(code || '').trim().match(/^\d{2}(QHC|QPK|QCT)/);
  return m ? m[1] : '';
}

export function landUseDomain(kinds) {
  const known = [...kinds].filter(k => LAND_USE[k]);
  const use = known.length ? known : Object.keys(LAND_USE);
  const set = new Set();
  use.forEach(k => LAND_USE[k].forEach(code => set.add(code)));
  return {
    set,
    label: known.length ? known.map(k => KIND_LABEL[k]).join(', ') : 'Phụ lục I',
    guessed: !known.length
  };
}

function isLandLayer(layer) {
  return keyOf(layer.name) === 'chucnangsudungdat_a' && (layer.pkg === 'HienTrang' || layer.pkg === 'QuyHoach');
}

export function phanLoaiIssues(layer, domain) {
  if (!isLandLayer(layer)) return [];
  const where = { pkg: layer.pkg, group: layer.group || '', layer: layer.name };
  const list = Array.isArray(layer.phanLoai) ? layer.phanLoai : [];
  if (!list.length) {
    if (layer.source === 'gpkg') {
      return [{ ...where, level: 'warn', text: 'Chưa đọc được giá trị phanLoai trong GeoPackage.' }];
    }
    return [];
  }
  const ht = layer.pkg === 'HienTrang';
  const bad = [];
  const prefix = [];
  list.forEach(raw => {
    const val = String(raw || '').trim();
    if (!val) return;
    const marked = val.startsWith('HT_');
    const bare = marked ? val.slice(3) : val;
    const known = domain.set.has(bare);
    if (ht) {
      if (marked && known) return;
      if (!marked && known) { prefix.push(val); return; }
    } else if (!marked && known) return;
    else if (marked && known) { prefix.push(val); return; }
    bad.push(val);
  });
  const out = [];
  if (bad.length) {
    out.push({
      ...where, level: 'fail',
      text: `phanLoai không thuộc Phụ lục I (${domain.label}): ${bad.slice(0, 4).join(', ')}. Không dùng mã địa chính.`
    });
  }
  if (prefix.length) {
    out.push({
      ...where, level: 'warn',
      text: ht
        ? `phanLoai thiếu tiền tố HT_ của lớp hiện trạng: ${prefix.slice(0, 4).join(', ')}.`
        : `phanLoai của lớp quy hoạch không dùng tiền tố HT_: ${prefix.slice(0, 4).join(', ')}.`
    });
  }
  return out;
}

export function crsIssues(layers) {
  const rows = (layers || []).filter(l => l && l.source !== 'qgz');
  if (!rows.length) return [];
  const known = [];
  const missing = [];
  rows.forEach(layer => {
    const id = layer.crs || '';
    if (!id) missing.push(layer.name || 'lớp');
    else known.push({ name: layer.name || 'lớp', pkg: layer.pkg || '', crs: id });
  });
  const out = [];
  const uniq = [...new Set(known.map(row => row.crs))];
  if (uniq.length > 1) {
    const bits = uniq.map(id => {
      const names = known.filter(row => row.crs === id).slice(0, 3).map(row => row.pkg ? `${row.pkg}/${row.name}` : row.name).join(', ');
      return `${CRS_NAME[id] || id} (${names})`;
    });
    out.push({ level: 'warn', pkg: '', group: '', layer: '', text: `Các lớp không cùng một hệ tọa độ: ${bits.join('; ')}.` });
  }
  uniq.filter(id => id !== 'HUE_3').forEach(id => {
    out.push({
      level: 'warn', pkg: '', group: '', layer: '',
      text: uniq.length === 1
        ? `Các lớp cùng hệ ${CRS_NAME[id] || id}. Hồ sơ tại Huế cần VN-2000, kinh tuyến trục 107°, múi 3°.`
        : `Có lớp dùng ${CRS_NAME[id] || id}. Hệ chung phải là VN-2000, kinh tuyến trục 107°, múi 3°.`
    });
  });
  if (missing.length && known.length) {
    out.push({ level: 'warn', pkg: '', group: '', layer: '', text: `Thiếu hệ tọa độ ở ${missing.length} lớp, ví dụ ${missing.slice(0, 4).join(', ')}.` });
  } else if (missing.length && !known.length) {
    out.push({ level: 'warn', pkg: '', group: '', layer: '', text: 'Chưa đọc được hệ tọa độ VN-2000 của các lớp.' });
  }
  return out;
}

function normHead(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().normalize('NFC');
}

export function metaSheetIssues(book, gisCodes) {
  const base = { pkg: '', group: 'Siêu dữ liệu', layer: book.name || '' };
  if (!book || !book.relevant) return [];
  if (book.error) return [{ ...base, level: 'fail', text: book.error }];
  const out = [];
  const sheetCodes = new Set();
  for (const [sheet, cols] of Object.entries(META_COLUMNS)) {
    const got = book.sheets && book.sheets[sheet];
    if (!got) {
      out.push({ ...base, level: 'fail', text: `Thiếu sheet ${sheet}.` });
      continue;
    }
    const headers = (got.headers || []).map(normHead).filter(Boolean);
    const missing = cols.filter(col => !headers.includes(normHead(col)));
    if (missing.length) out.push({ ...base, level: 'fail', text: `Sheet ${sheet} thiếu cột: ${missing.join('; ')}.` });
    const orderOk = !missing.length && cols.every((col, i) => normHead(headers[i] || '') === normHead(col));
    if (!missing.length && !orderOk) {
      out.push({ ...base, level: 'warn', text: `Sheet ${sheet} đủ cột nhưng chưa đúng thứ tự Phụ lục II.` });
    }
    const bad = (got.maHoSo || []).map(v => String(v || '').trim()).filter(v => v && !MA_HO_SO.test(v));
    (got.maHoSo || []).forEach(v => { if (MA_HO_SO.test(String(v || '').trim())) sheetCodes.add(String(v).trim()); });
    if (bad.length) {
      out.push({ ...base, level: 'fail', text: `Sheet ${sheet}, mã hồ sơ chưa đúng mẫu, ví dụ ${bad.slice(0, 3).join(', ')}.` });
    }
  }
  const gis = new Set(gisCodes || []);
  if (gis.size && sheetCodes.size && ![...sheetCodes].some(code => gis.has(code))) {
    out.push({ ...base, level: 'warn', text: 'Mã hồ sơ trong Excel không trùng mã đọc được trên các lớp.' });
  }
  return out;
}

function applyLevel(layer, issue) {
  if (issue.level === 'fail') layer.level = 'fail';
  else if (issue.level === 'warn' && layer.level !== 'fail') layer.level = 'warn';
}

/**
 * inventory: { label, packages, layers, presentation, errors, workbooks }
 * layer: { pkg, group, name, geom, source, fields, values, crs, phanLoai }
 */
export function assessGis(inventory) {
  const issues = [];
  const packages = PACKAGES.map(id => {
    const got = (inventory.packages && inventory.packages[id]) || { found: false, form: '', unreadable: false };
    return { id, ...got };
  });
  for (const id of ['HienTrang', 'QuyHoach']) {
    const p = packages.find(x => x.id === id);
    if (!p.found) issues.push({ level: 'fail', pkg: id, group: '', layer: '', text: `Thiếu gói ${id}` });
  }
  for (const id of ['NenDiaHinh', 'MocGioi']) {
    const p = packages.find(x => x.id === id);
    if (!p.found) issues.push({ level: 'warn', pkg: id, group: '', layer: '', text: `Chưa thấy gói ${id}. Thông tư gồm bốn cơ sở dữ liệu; mốc giới và nền địa hình có thể nộp kèm sau.` });
  }
  packages.filter(p => p.found && p.unreadable).forEach(p => {
    issues.push({ level: 'warn', pkg: p.id, group: '', layer: '', text: `${p.id}.${p.form || 'gdb'} chưa mở được lớp bên trong trên trình duyệt. Xuất GeoPackage hoặc shapefile (mỗi lớp một bộ .shp .dbf .prj) để chấm tên lớp và thuộc tính.` });
  });
  (inventory.errors || []).forEach(text => issues.push({ level: 'fail', pkg: '', group: '', layer: '', text }));
  (inventory.warnings || []).forEach(text => issues.push({ level: 'warn', pkg: '', group: '', layer: '', text }));

  const layers = [];
  for (const layer of inventory.layers || []) {
    const judged = checkLayer(layer);
    const row = { ...layer, level: judged.level };
    layers.push(row);
    judged.issues.forEach(i => issues.push(i));
  }

  const codeBag = new Set(inventory.codes || []);
  (inventory.layers || []).forEach(layer => (layer.codes || []).forEach(code => codeBag.add(code)));
  const kinds = new Set();
  codeBag.forEach(code => { const k = planKindOf(code); if (k) kinds.add(k); });
  const domain = landUseDomain(kinds);
  const landLayers = layers.filter(isLandLayer);
  if (landLayers.length && domain.guessed) {
    issues.push({ level: 'warn', pkg: '', group: '', layer: '', text: 'Chưa đọc được loại quy hoạch trong maHoSoQH. phanLoai được đối chiếu với toàn bộ Phụ lục I.' });
  } else if (kinds.size > 1 && landLayers.length) {
    issues.push({ level: 'warn', pkg: '', group: '', layer: '', text: `Hồ sơ có nhiều loại quy hoạch (${[...kinds].map(k => KIND_LABEL[k]).join(', ')}). phanLoai được đối chiếu theo các loại đã gặp.` });
  }
  landLayers.forEach(layer => {
    phanLoaiIssues(layer, domain).forEach(issue => {
      applyLevel(layer, issue);
      issues.push(issue);
    });
  });
  crsIssues(layers).forEach(issue => issues.push(issue));
  (inventory.workbooks || []).forEach(book => {
    metaSheetIssues(book, [...codeBag]).forEach(issue => issues.push(issue));
  });

  const dataLayers = (inventory.layers || []).filter(l => l.source !== 'qgz');
  for (const id of ['HienTrang', 'QuyHoach', 'MocGioi']) {
    const p = packages.find(x => x.id === id);
    if (!p.found || p.unreadable) continue;
    const own = dataLayers.filter(l => l.pkg === id);
    if (!own.length) {
      issues.push({ level: 'fail', pkg: id, group: '', layer: '', text: `Gói ${id} không có lớp dữ liệu đọc được` });
      continue;
    }
    const gaps = missingGroups(id, dataLayers);
    const absent = gaps.filter(row => !row.partial);
    if (absent.length) {
      issues.push({
        level: 'warn', pkg: id, group: '', layer: '',
        text: `Chưa có ${absent.length} nhóm tham khảo: ${absent.map(row => row.group).join(', ')}. Phần 3 không bắt buộc đủ.`
      });
    }
    gaps.filter(row => row.partial).forEach(row => {
      issues.push({
        level: 'warn', pkg: id, group: row.group, layer: '',
        text: `Nhóm ${row.group} còn thiếu ${row.missing.length} lớp tham khảo: ${joinCount(row.missing)}`
      });
    });
    const groupNames = [...new Set(own.map(l => l.group).filter(Boolean))];
    groupNames.forEach(group => {
      if (Object.keys(GIS_CATALOG[id]).some(g => keyOf(g) === keyOf(group))) {
        const canon = Object.keys(GIS_CATALOG[id]).find(g => keyOf(g) === keyOf(group));
        if (canon && group !== canon) {
          issues.push({ level: 'warn', pkg: id, group, layer: '', text: `Tên nhóm ${group} khác cách viết trong bảng: ${canon}` });
        }
      } else if (!validToken(group, false)) {
        issues.push({ level: 'fail', pkg: id, group, layer: '', text: `Tên nhóm "${group}" không đúng quy tắc: tiếng Việt không dấu, viết liền, hoa chữ cái đầu mỗi từ` });
      } else {
        issues.push({ level: 'ok', pkg: id, group, layer: '', text: `Nhóm phát sinh ${group}, đúng quy tắc đặt tên` });
      }
    });
  }

  const codes = new Set();
  let zeroRev = false;
  for (const layer of dataLayers) {
    for (const code of (layer.codes || [])) {
      codes.add(code);
      if (/^(?:\d{2})(?:QHC|QPK|QCT)0/.test(code)) zeroRev = true;
    }
  }
  for (const code of inventory.codes || []) {
    codes.add(code);
    if (/^(?:\d{2})(?:QHC|QPK|QCT)0/.test(code)) zeroRev = true;
  }
  if (codes.size > 1) {
    issues.push({ level: 'warn', pkg: '', group: '', layer: '', text: `Nhiều mã maHoSoQH trong cùng hồ sơ: ${[...codes].slice(0, 6).join(', ')}` });
  }
  if (zeroRev) {
    issues.push({ level: 'warn', pkg: '', group: '', layer: '', text: 'Mã lần lập là 0. Ví dụ Thông tư dùng 0, lời văn ghi lần đầu là 1 — cần người nộp xác nhận.' });
  }

  const presentFiles = inventory.presentation || [];
  if (!presentFiles.length) {
    issues.push({ level: 'warn', pkg: '', group: '', layer: '', text: 'Chưa thấy tệp trình bày (.qgz, .aprx, .ppkx, .mxd, .mpk)' });
  } else {
    presentFiles.forEach(f => {
      if (f.note) issues.push({ level: 'warn', pkg: '', group: '', layer: f.name, text: f.note });
    });
  }

  const ranked = issues.filter(i => i.level !== 'ok');
  const failN = ranked.filter(i => i.level === 'fail').length;
  const warnN = ranked.filter(i => i.level === 'warn').length;
  const unreadable = packages.some(p => p.found && p.unreadable) && !dataLayers.length;
  let verdict = 'ok';
  if (failN) verdict = 'fail';
  else if (!dataLayers.length && unreadable) verdict = 'empty';
  else if (!dataLayers.length) verdict = 'fail';
  else if (warnN) verdict = 'warn';

  return {
    label: inventory.label || 'HoSoGIS',
    verdict,
    codes: [...codes],
    packages,
    layers,
    issues: ranked,
    counts: { fail: failN, warn: warnN, layers: layers.length }
  };
}

export function checkMaHoSo(value) {
  return MA_HO_SO.test(String(value || '').trim());
}

/** maDoiTuong = <maHoSoQH>-<Tên lớp>-<ObjectID>. Lệch tên lớp ở giữa chỉ cảnh báo. */
export function checkMaDoiTuong(value, maHoSo, layerName) {
  const raw = String(value || '').trim();
  const parts = raw.split('-');
  if (parts.length < 3) return { level: 'fail', text: 'không theo mẫu <maHoSoQH>-<Tên lớp>-<ObjectID>' };
  const code = parts[0];
  const oid = parts[parts.length - 1];
  const mid = parts.slice(1, -1).join('-');
  if (maHoSo && code !== maHoSo) return { level: 'fail', text: 'không bắt đầu bằng maHoSoQH của dòng' };
  if (!checkMaHoSo(code)) return { level: 'fail', text: 'đoạn mã hồ sơ không đúng mẫu' };
  if (!/^\d+$/.test(oid)) return { level: 'warn', text: 'đoạn ObjectID không phải số' };
  const base = compact(layerName).replace(/_([APL])$/i, '');
  if (mid !== compact(layerName) && mid !== base) return { level: 'warn', text: 'tên lớp ở giữa không khớp tên lớp' };
  return null;
}

export { FIELD_SPEC, PACKAGES, bindFields };
