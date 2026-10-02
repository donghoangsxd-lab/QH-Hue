// Bảng chỉ tiêu xây dựng đô thị tăng trưởng xanh (mặt sau bảng tổng hợp hạ tầng, uiComponents.js › setPart2Side):
// Thông tư 01/2018/TT-BXD, hợp nhất với Thông tư 09/2025/TT-BXD tại VBHN 97/2026/VBHN-TT-BXD — 24 chỉ tiêu, 4 nhóm
// (Phụ lục 1 danh mục, Phụ lục 2 khái niệm / phương pháp tính / kỳ công bố / nguồn số liệu).
// Chỉ tiêu có dữ liệu trong webapp được tính ngay (calc); còn lại là khung chờ số liệu báo cáo (GTX_REPORTED).
// Khu vực đô thị / nội thành = các phường thuộc bộ chỉ tiêu đô thị (profile 'DT', constants.wardProfile).
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico } from './utils.js';
import { loadRoadTypeLengths } from './wardRoads.js';
import { sarSeasons } from './satLayers.js';

export const GTX_REF = 'Thông tư 01/2018/TT-BXD (hợp nhất tại VBHN 97/2026/VBHN-TT-BXD)';
export const GTX_BASE_YEAR = 2015;
// 0209 ước tính từ vệ tinh: phường/xã có ít nhất chừng này người trong vùng ngập thực tế mùa lũ (Sentinel-1)
const GTX_FLOOD_MIN_POP = 100;

const GROUPS = { '01': 'Kinh tế', '02': 'Môi trường', '03': 'Xã hội', '04': 'Thể chế' };
const PERIOD_YEAR = 'Năm; 5 năm';
const SRC_REPORT = 'Báo cáo';
const SRC_SURVEY = 'Điều tra thống kê';

/**
 * annual = có trong báo cáo hằng năm (18 chỉ tiêu, Điều 5 khoản 5); kind: auto = webapp tự tính, sat = ước tính vệ tinh,
 * part = tính một phần, map = bản đồ hỗ trợ / đang phát triển, report = chờ số liệu báo cáo
 */
const INDICATORS = [
  { code: '0101', name: 'Tỷ lệ chi sử dụng điện so với tổng chi tiêu của hộ', unit: '%', period: '2 năm', src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Tiền và giá trị hiện vật hộ chi cho dịch vụ điện / tổng chi tiêu của hộ × 100' },
  { code: '0102', name: 'Tỷ lệ thất thoát nước sạch', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: '(Lượng nước tại thiết bị đầu − lượng nước tại thiết bị cuối) / tổng lượng nước cấp tại nhà máy × 100' },
  { code: '0103', name: 'Tỷ lệ thu ngân sách nhà nước từ sử dụng tài nguyên tự nhiên', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Thu ngân sách từ thuế tài nguyên và các khoản thu từ đất / tổng thu ngân sách trên địa bàn × 100' },
  { code: '0104', name: 'Tỷ lệ đầu tư dự án mới thực hiện xây dựng đô thị tăng trưởng xanh', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Vốn các dự án đầu tư mới thuộc 8 hoạt động ưu tiên tăng trưởng xanh / tổng vốn dự án đầu tư mới × 100' },
  { code: '0105', name: 'Tỷ lệ công trình xây dựng nghiệm thu được cấp chứng chỉ công trình xanh', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số công trình đã nghiệm thu được cấp chứng chỉ công trình xanh / tổng số công trình được nghiệm thu × 100 (đối tượng khoản 3, 4 Điều 52 NĐ 06/2021/NĐ-CP)' },
  { code: '0201', name: 'Diện tích đất cây xanh công cộng bình quân đầu người khu vực nội thành, nội thị', unit: 'm²/người', period: '5 năm', src: SRC_SURVEY, annual: false, kind: 'auto', wardLevel: true,
    method: 'Tổng diện tích đất cây xanh sử dụng công cộng ngoài đơn vị ở (công viên, vườn hoa phục vụ một hay nhiều đơn vị ở, toàn đô thị, cấp vùng; kể cả mặt nước trong công viên nhưng quy đổi không quá 50%) / tổng dân số nội thành' },
  { code: '0202', name: 'Diện tích mặt nước tự nhiên đô thị suy giảm', unit: 'm²', period: PERIOD_YEAR, src: SRC_SURVEY, annual: true, kind: 'map', wardLevel: true,
    method: 'Diện tích mặt nước tự nhiên (ao, hồ, kênh mương, sông, suối, rạch) năm trước năm đánh giá − năm đánh giá',
    hint: 'Sẽ ước tính từ ảnh vệ tinh (JRC Global Surface Water + Dynamic World) theo phường' },
  { code: '0203', name: 'Tỷ lệ đường đô thị sử dụng thiết bị, công nghệ tiết kiệm năng lượng hoặc năng lượng tái tạo để chiếu sáng', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Chiều dài đường (từ đường khu vực trở lên) chiếu sáng tiết kiệm năng lượng / tổng chiều dài đường đô thị được chiếu sáng trong ranh giới các phường × 100' },
  { code: '0204', name: 'Tỷ lệ vận tải hành khách công cộng', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'map', minClass: 'II',
    method: 'Lượt khách đi phương tiện công cộng / (dân số toàn đô thị × hệ số đi lại bình quân) × 100 — chỉ áp dụng đô thị loại II trở lên',
    hint: 'Bản đồ hỗ trợ: vùng phủ 500 m trạm dừng xe buýt (mặt "Hệ thống giao thông")' },
  { code: '0205', name: 'Tỷ lệ phương tiện giao thông cá nhân hạn chế phát thải', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số ô tô hybrid, CNG, ô tô điện, xe máy điện, xe đạp điện, xe đạp… / tổng số phương tiện cá nhân × 100' },
  { code: '0206', name: 'Tỷ lệ đường giao thông dành riêng cho xe đạp', unit: '%', period: '5 năm', src: SRC_REPORT, annual: false, kind: 'auto', minClass: 'II', wardLevel: true,
    method: 'Tổng chiều dài đường xe đạp / tổng chiều dài đường đô thị × 100 — chỉ áp dụng đô thị loại II trở lên. Webapp: đường xe đạp OSM + tuyến Admin vẽ / (trục chính + khu vực + nội bộ)' },
  { code: '0207', name: 'Tỷ lệ chất thải rắn được thu gom, vận chuyển và xử lý đạt tiêu chuẩn, quy chuẩn kỹ thuật', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Chất thải rắn sinh hoạt được thu gom, vận chuyển, xử lý đạt chuẩn / tổng lượng chất thải rắn sinh hoạt × 100' },
  { code: '0208', name: 'Tỷ lệ nước thải được thu gom và xử lý đạt tiêu chuẩn, quy chuẩn kỹ thuật', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Lượng nước thải được thu gom và xử lý đạt chuẩn / (80% tổng công suất cấp nước sạch đô thị) × 100' },
  { code: '0209', name: 'Số đơn vị hành chính cấp phường, xã chịu thiệt hại trực tiếp do biến đổi khí hậu', unit: 'phường, xã', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'sat', wardLevel: true,
    method: 'Số phường, xã chịu thiệt hại trực tiếp do ngập lụt, triều cường, lũ quét, sạt lở đất, xâm nhập mặn trong năm (nguồn chính thức: báo cáo thiệt hại)' },
  { code: '0210', name: 'Số khu vực bị ô nhiễm môi trường nặng cần xử lý', unit: 'khu vực', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số khu vực có môi trường ô nhiễm nặng ảnh hưởng đời sống dân cư, cần xử lý cấp thiết' },
  { code: '0301', name: 'Tỷ lệ tăng dân số toàn đô thị so với tỷ lệ tăng diện tích đất phi nông nghiệp đô thị', unit: 'lần', period: '5 năm', src: SRC_SURVEY, annual: false, kind: 'map', wardLevel: true,
    method: '(Dân số cuối / đầu giai đoạn) / (diện tích đất phi nông nghiệp cuối / đầu giai đoạn)',
    hint: 'Sẽ ước tính từ dân số và đất xây dựng trên ảnh vệ tinh (như lớp "Vùng phát triển mới"), nguồn chính thức là kiểm kê đất đai' },
  { code: '0302', name: 'Tỷ lệ hộ có nhà ở kiên cố', unit: '%', period: '5 năm', src: SRC_REPORT, annual: false, kind: 'report',
    method: 'Số hộ có nhà ở kiên cố (cột, mái, tường bằng vật liệu bền chắc) / tổng số hộ × 100' },
  { code: '0303', name: 'Tỷ lệ dân số đô thị được cung cấp nước sạch', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Dân số được cấp nước sạch qua hệ thống cấp nước tập trung / tổng dân số đô thị × 100' },
  { code: '0304', name: 'Số lượng không gian công cộng', unit: 'không gian', period: '5 năm', src: SRC_SURVEY, annual: false, kind: 'part', wardLevel: true,
    method: 'Không gian sinh hoạt cộng đồng, công viên, vườn hoa, quảng trường, khu vực đi bộ (không gian mở có điểm vui chơi, giải trí)' },
  { code: '0401', name: 'Quy hoạch chung đô thị được lồng ghép các mục tiêu tăng trưởng xanh và biến đổi khí hậu', unit: 'có/không', period: '5 năm', src: SRC_REPORT, annual: false, kind: 'report',
    method: 'Quy hoạch chung đô thị đã phê duyệt có lồng ghép mục tiêu, chỉ tiêu, giải pháp tăng trưởng xanh và ứng phó biến đổi khí hậu' },
  { code: '0402', name: 'Chiến lược, kế hoạch hành động, chính sách cụ thể hướng tới tăng trưởng xanh và ứng phó biến đổi khí hậu', unit: 'văn bản', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số quyết định của UBND cấp tỉnh phê duyệt, ban hành chiến lược, kế hoạch hành động, chính sách hướng tới tăng trưởng xanh, ứng phó biến đổi khí hậu' },
  { code: '0403', name: 'Tỷ lệ các dịch vụ công trực tuyến', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số dịch vụ công trực tuyến mức độ 3 và 4 / tổng số dịch vụ công tại đô thị × 100' },
  { code: '0404', name: 'Tỷ lệ cán bộ quản lý đô thị các cấp đã được đào tạo, bồi dưỡng về tăng trưởng xanh', unit: '%', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số lượt cán bộ quản lý đô thị được đào tạo về tăng trưởng xanh / tổng số cán bộ quản lý đô thị × 100' },
  { code: '0405', name: 'Các chương trình nâng cao nhận thức cộng đồng về tăng trưởng xanh và biến đổi khí hậu', unit: 'chương trình', period: PERIOD_YEAR, src: SRC_REPORT, annual: true, kind: 'report',
    method: 'Số chương trình, kế hoạch, dự án, hoạt động tuyên truyền, giáo dục, nâng cao năng lực cộng đồng (báo cáo giai đoạn: lũy kế từ đầu giai đoạn)' }
];

// Số liệu báo cáo cấp thành phố: { '0102': { value: 18.5, year: 2025, base: 22.1, source: 'Công ty CP Cấp nước Thừa Thiên Huế' } }
const GTX_REPORTED = {};

const KIND_BADGE = {
  auto: ['gtx-auto', 'Tự tính', 'Webapp tính từ dữ liệu hạ tầng / mạng lưới đường hiện có'],
  sat: ['gtx-sat', 'Ước tính vệ tinh', 'Bằng chứng từ ảnh vệ tinh, không thay báo cáo chính thức'],
  part: ['gtx-part', 'Một phần', 'Mới tính được một phần đối tượng của chỉ tiêu'],
  map: ['gtx-map', 'Bản đồ hỗ trợ', 'Chưa có số liệu; bản đồ hỗ trợ hoặc đang phát triển'],
  report: ['gtx-report', 'Chờ báo cáo', 'Số liệu do các sở, ngành báo cáo (Sở Xây dựng tổng hợp)']
};

const NUM1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const NUM2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

// ---------- Dữ liệu nạp chậm: chiều dài đường theo phường, vùng ngập Sentinel-1 theo năm ----------
let roadsPromise = null;
let roads = null;
const sarPromises = new Map();
const sarResults = new Map();
let annualOnly = false;
let evalYear = null;

function loadRoads(force = false) {
  if (force) roadsPromise = null;
  if (!roadsPromise) {
    roadsPromise = loadRoadTypeLengths()
      .then(r => { roads = r; return r; })
      .catch(err => { roadsPromise = null; throw err; });
  }
  return roadsPromise;
}

function loadSar(year) {
  if (!sarPromises.has(year)) {
    sarPromises.set(year, fetch(geeApi(`action=getSarFloodStats&year=${year}`))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.wards)) throw new Error((d && d.message) || `HTTP ${r.status}`);
        sarResults.set(year, d);
        return d;
      })
      .catch(err => { sarPromises.delete(year); throw err; }));
  }
  return sarPromises.get(year);
}

const currentYear = () => evalYear || sarSeasons().def;

// ---------- Tính chỉ tiêu: trả { html, title } hoặc null (chưa có số liệu) ----------
const isUrban = (w) => w.profile === 'DT';
const parkBuckets = (w) => [w.urbanResults?.CV_DT, w.unitResults?.CV_DV].filter(Boolean);
const scopeOf = (ctx) => (ctx.ward ? [ctx.ward] : ctx.wards.filter(isUrban));
const scopeText = (ctx, list) => (ctx.ward ? ctx.ward.Ten_Phuong : `${list.length} phường nội thành`);
const pending = (text) => ({ html: `<span class="gtx-wait">${ico('clock')}${text}</span>` });

const CALC = {
  '0201'(ctx) {
    if (ctx.ward && !isUrban(ctx.ward)) return { html: '<span class="gtx-na">Ngoài khu vực nội thành</span>' };
    const list = scopeOf(ctx);
    let area = 0, pop = 0, parks = 0, unknown = 0;
    list.forEach(w => {
      pop += Number(w.Dan_So_Vector) || 0;
      parkBuckets(w).forEach(b => {
        area += Number(b.currentArea) || 0;
        (b.subItems || []).forEach(s => { parks++; if (!(Number(s.size) > 0)) unknown++; });
      });
    });
    if (!(pop > 0)) return null;
    const detail = `${scopeText(ctx, list)}: ${fmtNum(Math.round(area))} m² công viên, vườn hoa đã duyệt (${parks} công trình`
      + `${unknown ? `, ${unknown} chưa rõ diện tích` : ''}) / ${fmtNum(pop)} người.`;
    if (!(area > 0)) {
      return parks
        ? { html: `<span class="gtx-na">Chưa rõ diện tích (${parks} công viên)</span>`, title: `${detail} Cần nhập QuyMo_HT cho các công viên để tính.` }
        : null;
    }
    return {
      html: `<b>${unknown ? '≥ ' : ''}${NUM2.format(area / pop)}</b>`,
      title: `${detail}${unknown ? ' Giá trị là cận dưới do còn công viên chưa rõ diện tích.' : ''} Chưa tách mặt nước trong công viên để áp giới hạn quy đổi 50%.`
    };
  },
  '0206'(ctx) {
    if (!roads) return pending('Đang tải mạng lưới đường');
    const list = scopeOf(ctx);
    let bike = 0, total = 0, n = 0;
    list.forEach(w => {
      const r = roads[w.Ten_Phuong];
      if (!r) return;
      bike += Number(r.bike) || 0;
      total += (Number(r.main) || 0) + (Number(r.kiet) || 0);
      n++;
    });
    if (!(total > 0)) return null;
    return {
      html: `<b>${NUM2.format(bike / total * 100)}</b>`,
      title: `${scopeText(ctx, list)}${ctx.ward ? '' : ` (${n} có mạng lưới đường)`}: đường xe đạp ${NUM1.format(bike)} km / `
        + `tổng đường đô thị ${NUM1.format(total)} km (OpenStreetMap + tuyến Admin vẽ bổ sung)`
    };
  },
  '0209'(ctx) {
    const year = currentYear();
    const d = sarResults.get(year);
    if (!d) return pending(`Đang tải vùng ngập ${year}`);
    const hit = d.wards.filter(w => w.pop >= GTX_FLOOD_MIN_POP);
    const basis = `Vùng ngập thực tế mùa lũ 15/9–15/12/${year} (Sentinel-1); tính khi có ≥ ${GTX_FLOOD_MIN_POP} người trong vùng ngập.`;
    if (ctx.ward) {
      const w = d.wards.find(x => x.name === ctx.ward.Ten_Phuong);
      const pop = w ? w.pop : 0;
      return {
        html: pop >= GTX_FLOOD_MIN_POP ? `<b class="c-red">Có</b> <span class="wt-light">≈ ${fmtNum(Math.round(pop / 10) * 10)} người</span>` : '<b class="c-green">Không</b>',
        title: basis
      };
    }
    return {
      html: `<b>${hit.length}</b> <span class="wt-light">/ ${ctx.wards.length} (${year})</span>`,
      title: `${basis}\n${hit.slice(0, 12).map(w => `${w.name}: ≈ ${fmtNum(Math.round(w.pop / 10) * 10)} người`).join('\n')}${hit.length > 12 ? '\n…' : ''}`
    };
  },
  '0304'(ctx) {
    const list = scopeOf(ctx);
    const n = list.reduce((s, w) => s + parkBuckets(w).reduce((t, b) => t + (b.subItems || []).length, 0), 0);
    return {
      html: `<b>${fmtNum(n)}</b>`,
      title: `${scopeText(ctx, list)}: ${n} công viên, vườn hoa đã duyệt. Chưa có lớp dữ liệu quảng trường, phố đi bộ, không gian sinh hoạt cộng đồng.`
    };
  }
};

function valueCell(ind, ctx) {
  if (ctx.ward && !ind.wardLevel) return '<td class="gtx-val"><span class="gtx-na">Chỉ tính cấp TP</span></td>';
  const rep = !ctx.ward && GTX_REPORTED[ind.code];
  if (rep && rep.value != null) {
    return `<td class="gtx-val" title="${escapeHtml(`${rep.source || 'Báo cáo'}${rep.year ? `, năm ${rep.year}` : ''}`)}"><b>${escapeHtml(String(rep.value))}</b></td>`;
  }
  const r = CALC[ind.code] ? CALC[ind.code](ctx) : null;
  if (r) return `<td class="gtx-val"${r.title ? ` title="${escapeHtml(r.title)}"` : ''}>${r.html}</td>`;
  return `<td class="gtx-val"><span class="gtx-na"${ind.hint ? ` title="${escapeHtml(ind.hint)}"` : ''}>Chưa có số liệu</span></td>`;
}

function rowHtml(ind, idx, ctx) {
  const [cls, label, desc] = KIND_BADGE[ind.kind];
  const base = ctx.ward ? null : GTX_REPORTED[ind.code]?.base;
  const scope = ind.minClass ? ` Áp dụng đô thị loại ${ind.minClass} trở lên (Huế: đô thị loại I).` : '';
  return `<tr>
    <td>${idx}</td>
    <td class="gtx-code">${ind.code}</td>
    <td class="gtx-name" title="${escapeHtml(`${ind.method}.${scope}`)}">${escapeHtml(ind.name)}</td>
    <td>${escapeHtml(ind.unit)}</td>
    ${valueCell(ind, ctx)}
    <td>${base != null ? escapeHtml(String(base)) : '–'}</td>
    <td>${ind.period}</td>
    <td>${ind.annual ? ico('check') : ''}</td>
    <td>${ind.src}</td>
    <td><span class="gtx-badge ${cls}" title="${escapeHtml(ind.hint ? `${desc}. ${ind.hint}` : desc)}">${label}</span></td>
  </tr>`;
}

function hasValue(ind, ctx) {
  if (ctx.ward && !ind.wardLevel) return false;
  if (!ctx.ward && GTX_REPORTED[ind.code]?.value != null) return true;
  const r = CALC[ind.code] && CALC[ind.code](ctx);
  return !!r && !/gtx-(wait|na)/.test(r.html);
}

function tableHtml(ctx) {
  const list = annualOnly ? INDICATORS.filter(i => i.annual) : INDICATORS;
  const filled = list.filter(i => hasValue(i, ctx)).length;
  const place = ctx.ward ? ctx.ward.Ten_Phuong : 'TP Huế';
  const years = sarSeasons().years;
  let idx = 0, group = '';
  const rows = list.map(ind => {
    const g = ind.code.slice(0, 2);
    const head = g !== group ? `<tr class="gtx-group"><td colspan="10">${g}. ${GROUPS[g]}</td></tr>` : '';
    group = g;
    return head + rowHtml(ind, ++idx, ctx);
  }).join('');
  return `<div class="gtx-bar">
      <span class="gtx-summary" title="${escapeHtml(`${GTX_REF}. Nội thành, khu vực đô thị = các phường thuộc bộ chỉ tiêu đô thị. Năm cơ sở ${GTX_BASE_YEAR} (Điều 2 khoản 4).`)}">
        Có số liệu <b>${filled}/${list.length}</b> chỉ tiêu · ${escapeHtml(place)} · năm cơ sở ${GTX_BASE_YEAR}</span>
      <label class="gtx-pick" title="Năm đánh giá cho chỉ tiêu ước tính từ vệ tinh (0209)">Năm đánh giá
        <select data-gtx="year">${years.map(y => `<option value="${y}"${y === currentYear() ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
      <button type="button" class="bp-btn gtx-filter${annualOnly ? ' active' : ''}" data-gtx="annual" aria-pressed="${annualOnly}"
        title="Báo cáo hằng năm dùng 18 chỉ tiêu, không gồm 0201, 0206, 0301, 0302, 0304, 0401 (Điều 5 khoản 5)">18 chỉ tiêu BC hằng năm</button>
    </div>
    <div class="table-container">
      <table class="data-table gtx-table">
        <thead><tr>
          <th>STT</th><th>Mã</th><th>Chỉ tiêu</th><th>Đơn vị</th>
          <th title="Giá trị hiện tại của địa bàn đang chọn">${escapeHtml(place)}</th>
          <th title="Năm cơ sở để so sánh (Điều 2 khoản 4)">Năm ${GTX_BASE_YEAR}</th>
          <th>Kỳ công bố</th><th title="Có trong báo cáo hằng năm (18 chỉ tiêu)">BC năm</th>
          <th>Nguồn số liệu</th><th>Trạng thái</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/** Vẽ bảng vào el cho TP (wardName rỗng) hoặc 1 phường; tự vẽ lại khi số liệu nạp chậm về */
export function renderGreenGrowth(el, { wardName, wards }) {
  if (!el) return;
  const key = wardName || '';
  el.dataset.ward = key;
  const draw = () => {
    if (!el.isConnected || el.dataset.ward !== key) return;
    const ward = key ? wards.find(w => w.Ten_Phuong === key) : null;
    el.innerHTML = tableHtml({ ward, wards });
  };
  draw();
  const redraw = () => draw();
  if (!roads) loadRoads().then(redraw).catch(err => console.warn('Tăng trưởng xanh – mạng lưới đường lỗi:', err));
  const year = currentYear();
  if (!sarResults.has(year)) loadSar(year).then(redraw).catch(err => console.warn('Tăng trưởng xanh – vùng ngập lỗi:', err));
}

/** Sự kiện trong bảng (lọc 18 chỉ tiêu, đổi năm đánh giá); rerender = vẽ lại bảng của địa bàn đang chọn */
export function initGreenGrowthEvents(el, rerender) {
  el?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-gtx="annual"]')) return;
    annualOnly = !annualOnly;
    rerender();
  });
  el?.addEventListener('change', (e) => {
    if (!e.target.matches('select[data-gtx="year"]')) return;
    evalYear = Number(e.target.value) || null;
    rerender();
  });
}

/** Mạng lưới đường đổi (Admin lưu tuyến bổ sung): đọc lại chiều dài cho 0206 */
export function reloadGreenGrowthRoads() {
  roads = null;
  return loadRoads(true);
}
