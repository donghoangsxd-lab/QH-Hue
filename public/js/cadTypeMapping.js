// Khớp thủ công loại hạ tầng khi file không đặt tên layer / thuộc tính theo quy ước mã loại:
// người dùng chọn trường nhận diện (Layer, Folder, thuộc tính...), rồi gán từng giá trị tìm được với 1 loại hạ tầng.
import { escapeHtml, ico } from './utils.js';
import { layerToType, tt16Layer, SCHOOL_PICK, MARKET_PICK } from './cadImport.js';
import { landRule, landPatternKey, lotCodePrefix, lotCodePatternKey, TT16_STYLES, MANUAL_LAND_KEYS } from './tt16Symbols.js';

// Mã khớp "Đất ở": không phải hạ tầng — lô vẫn ghi sheet DXF, tên layer đổi để luôn tô màu đất ở
const LAND_O = 'DATO';
// Mã khớp "Đất chưa sử dụng" (đất bằng / đồi núi chưa sử dụng của bản đồ hiện trạng sử dụng đất): lô đất, ghi sheet DXF.
// Khác hẳn "Cơ sở chưa sử dụng" (CSD): cơ sở nhà đất đã có hạ tầng xung quanh nhưng bỏ trống — không được gộp.
const LAND_CSD = 'DATCSD';

// Mã loại cho ô chọn (khớp LAYER_PREFIXES; cấp đơn vị ở dùng mã gốc, cấp đô thị thêm _DT)
export const TYPE_CODE_OPTIONS = [
  ['CV', 'Công viên, điểm xanh, vườn hoa'],
  ['CV_DT', 'Công viên – cấp đô thị'],
  ['BDX', 'Bãi đỗ xe, trạm sạc xe điện'],
  ['BDX_DT', 'Bãi đỗ xe – cấp đô thị'],
  ['MN', 'Trường Mầm non'],
  ['TH', 'Trường Tiểu học'],
  ['THCS', 'Trường THCS'],
  ['THPT', 'Trường THPT (cấp đô thị)'],
  [SCHOOL_PICK, 'Đất giáo dục, trường học – chọn cấp từng lô (MN / TH / THCS / THPT)'],
  ['YT', 'Bệnh viện, Trạm y tế'],
  ['YT_DT', 'Y tế – cấp đô thị'],
  ['VH', 'Nhà văn hóa, thể thao'],
  ['VH_DT', 'Văn hóa, thể thao – cấp đô thị'],
  ['TM', 'Chợ, Trung tâm thương mại'],
  ['TM_DT', 'Chợ, TTTM – cấp đô thị'],
  [MARKET_PICK, 'Chợ, TTTM – chọn từng lô'],
  ['NT', 'Nghĩa trang, nhà tang lễ'],
  ['CSD', 'Cơ sở nhà đất chưa sử dụng (chỉ nhập từ DXF / KML)'],
  [LAND_CSD, 'Đất chưa sử dụng (BCS, DCS, NCS) – sheet DXF, không phải cơ sở'],
  [LAND_O, 'Đất ở – sheet DXF, màu đất ở']
];
// Loại đất TT16 ngoài hạ tầng (mặt nước, giao thông, cây xanh chuyên dụng...): lô đất ghi sheet DXF, tô theo ký hiệu đã chọn
const LAND_KEY_PREFIX = 'DAT:';
const LAND_TYPE_OPTIONS = MANUAL_LAND_KEYS.map(key => [`${LAND_KEY_PREFIX}${key}`, TT16_STYLES[key].label]);
const LAND_CODES = new Set([LAND_O, LAND_CSD]);
const VALID_CODES = new Set([...TYPE_CODE_OPTIONS, ...LAND_TYPE_OPTIONS].map(([c]) => c));

// Hiển thị tối đa số giá trị; trường có nhiều giá trị hơn (tên riêng, mã số...) nên chọn trường khác
const MAX_VALUES = 80;
const EMPTY_KEY = '';
const MEMORY_KEY = 'qhhue.cadTypeMap';

// Cơ sở chưa sử dụng chỉ gợi ý khi tên nói rõ là cơ sở / nhà đất. "CSD" đứng riêng là mã nhóm đất chưa sử dụng
// trong kiểm kê đất đai (cùng BCS, DCS, NCS) nên không tính.
const CSD_FACILITY_RE = /co so (nha dat )?(chua su dung|bo trong|khong su dung|bo hoang)|nha dat (cong )?(chua su dung|bo trong|doi du|khong su dung|bo hoang)/;
const UNUSED_LAND_RE = /chua su dung|\b(bcs|dcs|ncs)\b|bo hoang|dat trong/;

// Gợi ý loại theo từ khóa trong giá trị (bỏ dấu, không phân biệt hoa thường); thứ tự quan trọng: THCS/THPT trước TH.
// Nhận cả cách đặt tên layer CAD trước TT 16/2025 ("N - QH - dat TDTT", "dat DVTM", "cay xanh dvo", "01-Green place").
// Trường học nhiều cấp và đất thương mại / dịch vụ gợi ý loại "chọn từng lô" vì 1 giá trị không đủ để quyết cho mọi lô.
// [mã, từ khóa, loại trừ]; giá trị trúng phần loại trừ thì xét tiếp luật sau ("Đất ở kết hợp dịch vụ" → đất ở)
const GUESS_RULES = [
  ['THPT', /\bthpt\b|trung hoc pho thong/],
  ['THCS', /\bthcs\b|trung hoc co so/],
  ['TH', /tieu hoc|\bth\b/],
  ['MN', /mam non|mau giao|nha tre|\bmn\b/],
  [SCHOOL_PICK, /truong hoc|giao duc|\bschool\b|education/],
  ['CV', /cong vien|cay xanh|vuon hoa|diem xanh|\bpark\b|green (place|land)|\bcxcc\b/,
    /cay xanh (su dung )?(han che|chuyen dung|cach ly|giao thong)|for transport/],
  ['BDX', /bai do|do xe|bai xe|parking|tram sac|\bbdx\b/],
  ['NT', /nghia trang|nghia dia|nha tang le|hoa tang|\bntr\b|\bntd\b|cemetery/],
  ['YT', /y te|benh vien|tram y|phong kham|health|hospital/],
  ['VH', /van hoa|the thao|\btdtt\b|san van dong|\bnvh\b|cultur|\bsport/],
  [MARKET_PICK, /\bcho\b|thuong mai|\btttm\b|sieu thi|\bdvtm\b|\btmdv\b|dich vu|commercial|\bmarket\b/,
    /hon hop|ket hop|du lich|dich vu cong cong|nha o/],
  ['CSD', CSD_FACILITY_RE],
  [LAND_CSD, UNUSED_LAND_RE],
  [LAND_O, /\bdat o\b|\bo (do thi|nong thon)\b|\bodt\b|\bont\b|lang xom|biet thu|lien ke|chinh trang|tai dinh cu|\btdc\b|nha o\b|nha vuon|\bnoxh\b|chung cu|nhom nha/,
    /cay xanh|cong vien|truong|y te|bai do|van hoa|the thao/]
];
const URBAN_RE = /do thi|\bdt\b|urban/;
const SCHOOL_CODES = new Set(['THPT', 'THCS', 'TH', 'MN']);

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/[_\-.]+/g, ' ');

// Khóa TT16 (landPatternKey / ký hiệu lô) → mã khớp; khóa không có ở đây và ngoài MANUAL_LAND_KEYS thì không gợi ý
const PATTERN_CODE = {
  '1-CV': 'CV', '2-BDX': 'BDX', '3-MN': 'MN', '4-TH': 'TH', '5-THCS': 'THCS', '6-THPT': 'THPT', '7-YT': 'YT',
  '8-VH': 'VH', TDTT: 'VH', '9-TM': MARKET_PICK, NTR: 'NT', 'O-NO': LAND_O, 'O-LX': LAND_O, DCS: LAND_CSD, SCHOOL: SCHOOL_PICK
};
const codeOfPattern = (key) => PATTERN_CODE[key] || (MANUAL_LAND_KEYS.includes(key) ? `${LAND_KEY_PREFIX}${key}` : '');

function guessCode(value) {
  // Ký hiệu lô viết tắt ("CX4.14", "OB 1.22", "MN.02" = mặt nước) xét trước từ khóa (\bmn\b = mầm non trong tên)
  const lot = codeOfPattern(lotCodePatternKey(value));
  if (lot) return /.DT$/.test(lotCodePrefix(value)) && VALID_CODES.has(`${lot}_DT`) ? `${lot}_DT` : lot;
  const s = normalize(value);
  // Một giá trị gộp nhiều cấp trường (VD "Đất trường THCS_tiểu học_mầm non"): admin chọn cấp từng lô
  if (GUESS_RULES.filter(([code, re]) => SCHOOL_CODES.has(code) && re.test(s)).length > 1) return SCHOOL_PICK;
  const hit = GUESS_RULES.find(([, re, not]) => re.test(s) && !(not && not.test(s)));
  if (!hit) return codeOfPattern(landPatternKey(value));
  const urban = `${hit[0]}_DT`;
  return URBAN_RE.test(s) && VALID_CODES.has(urban) ? urban : hit[0];
}

// Lựa chọn CSD đã nhớ cho giá trị dạng "đất ... chưa sử dụng" (bản cũ tự gợi ý nhầm) bị bỏ, đoán lại theo từ khóa.
// allowCsd = false (GeoJSON / shapefile): không bao giờ gợi ý CSD.
const suggestOf = (val, mem, allowCsd) => {
  if (!val) return '';
  const s = normalize(val);
  let code = mem[s];
  if (code === 'CSD' && UNUSED_LAND_RE.test(s) && !CSD_FACILITY_RE.test(s)) code = '';
  code = code || guessCode(val);
  if (code === 'CSD' && !allowCsd) return '';
  return VALID_CODES.has(code) ? code : '';
};

// Tên trường thường chứa loại đất (gServer: chucnangsudungdat, DBF cắt còn chucnangsu; loaidat; autocad_la)
const CLASS_FIELD_RE = /chuc ?nang|loai ?dat|muc ?dich|layer|autocad|\blop\b/;
// Trường không bao giờ cho biết loại đất (so trên tên trường viết thường, bỏ "_"): tọa độ, chỉ tiêu tầng cao / mật độ / hệ số,
// diện tích, dân số, mã định danh, ngày tháng (gServer: xdaidien, s_ydaidien, tangcaomin, matdoxayd2, hesosudun, objectid...)
const NON_CLASS_FIELD_RE = /^s?[xy]daidien|^[xyz]$|toado|^(lat|lng|lon|long|latitude|longitude)$|kinhdo|vido|tangcao|matdo|heso|dientich|danso|objectid|^fid$|^id$|madoituon|malienket|mahoso|^ngay|^shape|perimeter|^area$|chieucao|caodo|tangham|sotang|trangthai|thoihan/;
const NUMERIC_RE = /^-?[\d\s.,]+$/;

function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function remember(value, code) {
  if (!value) return;
  const mem = loadMemory();
  const key = normalize(value);
  if (code) mem[key] = code; else delete mem[key];
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(mem)); } catch (e) { /* bộ nhớ đầy / bị chặn */ }
}

// DXF chỉ có tên layer; KML/GeoJSON có thêm thuộc tính do bộ đọc gom
const attrsOf = (ent) => ent.attrs || { Layer: ent.layer };
// Trường ký hiệu lô (mỗi lô 1 mã "CX4.14", "OB 1.22"): trường ảo "<trường>#kh" gom theo chữ viết tắt đầu (CX, OB...)
const CODE_GROUP = '#kh';
const isGroupKey = (key) => key.endsWith(CODE_GROUP);
const baseKey = (key) => (isGroupKey(key) ? key.slice(0, -CODE_GROUP.length) : key);
const rawOf = (ent, key) => attrsOf(ent)[baseKey(key)] || EMPTY_KEY;
const valueOf = (ent, key) => (isGroupKey(key) ? lotCodePrefix(rawOf(ent, key)) : rawOf(ent, key)) || EMPTY_KEY;
const fieldLabel = (key) => (isGroupKey(key) ? `${baseKey(key)} (nhóm ký hiệu lô)` : key);
// Layer TT16 (kể cả loại đất ngoài 10 nhóm, Truonghoc chờ chọn cấp) không đưa vào khớp thủ công
const isUnknown = (ent) => !tt16Layer(ent.layer) && !layerToType(ent.layer);

/**
 * Tạo trạng thái khớp thủ công cho các thực thể chưa nhận diện được loại; null nếu mọi thực thể đều đúng quy ước.
 * Trường mặc định: điểm = tỷ lệ lô gợi ý được loại × độ đa dạng loại gợi ý (tránh trường dồn gần hết lô vào 1 loại);
 * hòa thì trường có tên loại đất, rồi trường trùng tên layer, rồi trường ít giá trị hơn. Không trường nào gợi ý được: trường phân loại.
 * Bỏ khỏi danh sách: trường tọa độ / chỉ tiêu / diện tích / mã định danh, trường toàn số, trường 1 giá trị (khi còn trường khác).
 * allowCsd = false: file nhập đồng loạt (GeoJSON / shapefile) không được gán Cơ sở chưa sử dụng.
 */
export function createManualMapping(entities, { allowCsd = true } = {}) {
  const unknown = entities.filter(isUnknown);
  if (!unknown.length) return null;
  const stat = new Map();
  const add = (key, val, ent) => {
    const s = stat.get(key) || { key, counts: new Map(), filled: 0, sameAsLayer: 0 };
    if (val) { s.counts.set(val, (s.counts.get(val) || 0) + 1); s.filled++; }
    if (val && val === ent.layer) s.sameAsLayer++;
    stat.set(key, s);
  };
  unknown.forEach(ent => {
    Object.entries(attrsOf(ent)).forEach(([key, val]) => {
      add(key, val, ent);
      const head = lotCodePrefix(val);
      if (head) add(key + CODE_GROUP, head, ent);
    });
  });
  // Trường ảo chỉ giữ khi phần lớn giá trị là ký hiệu lô và gom được bớt giá trị
  [...stat.values()].filter(f => isGroupKey(f.key)).forEach(f => {
    const base = stat.get(baseKey(f.key));
    if (!base || f.filled < base.filled * 0.8 || f.counts.size >= base.counts.size) stat.delete(f.key);
  });
  const mem = loadMemory();
  const candidates = [...stat.values()].filter(f => f.filled > 0 && !NON_CLASS_FIELD_RE.test(baseKey(f.key).toLowerCase().replace(/[\s_]+/g, '')));
  const numericLots = (f) => [...f.counts].reduce((s, [v, n]) => s + (NUMERIC_RE.test(v) ? n : 0), 0);
  // Trường mã số (loaidat = 1..14, chú giải nằm ngoài file) chỉ giữ khi không còn trường chữ nào để người dùng tự gán
  const texty = candidates.filter(f => numericLots(f) < f.filled * 0.9);
  let fields = texty.length ? texty : candidates;
  // Trường 1 giá trị (Layer = tên file, chỉ tiêu cố định) không phân biệt được loại đất; chỉ giữ khi không còn trường khác
  if (fields.some(f => f.counts.size > 1)) fields = fields.filter(f => f.counts.size > 1);
  fields = fields.map(f => {
    const byCode = new Map();
    let covered = 0;
    if (f.counts.size <= MAX_VALUES) {
      f.counts.forEach((n, val) => {
        const code = suggestOf(val, mem, allowCsd);
        if (!code) return;
        covered += n;
        byCode.set(code, (byCode.get(code) || 0) + n);
      });
    }
    // Số loại hiệu dụng 1/Σp² (1 = mọi lô gợi ý cùng 1 loại); từ 2 loại trở lên tính đủ điểm
    const simpson = covered ? [...byCode.values()].reduce((s, n) => s + (n / covered) ** 2, 0) : 1;
    const variety = Math.min(1, 1 / simpson / 2);
    return {
      key: f.key, distinct: f.counts.size, filled: f.filled, sameAsLayer: f.sameAsLayer,
      named: CLASS_FIELD_RE.test(normalize(baseKey(f.key))) ? 1 : 0,
      covered, score: covered / unknown.length * variety
    };
  }).sort((a, b) => b.score - a.score || b.filled - a.filled || a.distinct - b.distinct);
  const byGuess = fields.filter(f => f.covered > 0)
    .sort((a, b) => b.score - a.score || b.covered - a.covered || b.named - a.named || b.sameAsLayer - a.sameAsLayer || a.distinct - b.distinct);
  // Ưu tiên trường dạng phân loại (mọi lô đều có, số giá trị ít hơn số lô) — tên riêng từng lô khó khớp hàng loạt
  const categorical = fields.filter(f => f.filled === unknown.length && f.distinct > 1 && f.distinct < f.filled);
  const def = byGuess[0] || [...(categorical.length ? categorical : fields)]
    .sort((a, b) => b.sameAsLayer - a.sameAsLayer || a.distinct - b.distinct)[0];
  const mapping = { unknownCount: unknown.length, fields, field: null, values: [], codes: new Map(), suggested: new Set(), allowCsd };
  if (def) selectField(mapping, def.key, entities);
  return mapping;
}

/** Đổi trường nhận diện: liệt kê giá trị (nhiều lô trước), điền sẵn gợi ý từ lần khớp trước / từ khóa */
export function selectField(mapping, key, entities) {
  const counts = new Map();
  entities.filter(isUnknown).forEach(ent => {
    const val = valueOf(ent, key);
    counts.set(val, (counts.get(val) || 0) + 1);
  });
  mapping.field = key;
  mapping.values = [...counts].map(([val, n]) => ({ val, n })).sort((a, b) => b.n - a.n || a.val.localeCompare(b.val, 'vi'));
  mapping.codes = new Map();
  mapping.suggested = new Set();
  const mem = loadMemory();
  mapping.values.slice(0, MAX_VALUES).forEach(({ val }) => {
    const code = suggestOf(val, mem, mapping.allowCsd);
    if (code) {
      mapping.codes.set(val, code);
      mapping.suggested.add(val);
    }
  });
}

/** Gán loại cho giá trị thứ idx ('' = bỏ qua); nhớ lựa chọn cho các lần nhập sau */
export function setCode(mapping, idx, code) {
  const item = mapping.values[idx];
  if (!item || (code === 'CSD' && !mapping.allowCsd)) return;
  if (VALID_CODES.has(code)) mapping.codes.set(item.val, code); else mapping.codes.delete(item.val);
  mapping.suggested.delete(item.val);
  remember(item.val, VALID_CODES.has(code) ? code : '');
}

export function clearCodes(mapping) {
  mapping.values.forEach(({ val }) => { if (mapping.codes.has(val)) remember(val, ''); });
  mapping.codes.clear();
  mapping.suggested.clear();
}

/** Thực thể sau khi khớp: thực thể chưa nhận diện được mà có giá trị đã gán → thêm typeCode; layer hiển thị = giá trị đã khớp.
 *  Đất ở / đất chưa sử dụng không thêm typeCode (vẫn là lô đất sheet DXF), chỉ đổi layer cho landRule nhận ra. */
export function applyManualMapping(entities, mapping) {
  if (!mapping || !mapping.field || !mapping.codes.size) return entities;
  return entities.map(ent => {
    if (!isUnknown(ent)) return ent;
    const code = mapping.codes.get(valueOf(ent, mapping.field));
    // Nhóm ký hiệu: khớp theo nhóm (CX) nhưng giữ mã lô gốc (CX4.14) làm tên layer
    const val = rawOf(ent, mapping.field);
    if (code === LAND_O) {
      const name = val || ent.layer;
      return { ...ent, layer: (landRule(name) || {}).key === 'o' ? name : `Đất ở - ${name}` };
    }
    if (code === LAND_CSD) return asUnusedLand(ent, val || ent.layer);
    if (code && code.startsWith(LAND_KEY_PREFIX)) return asLandType(ent, val, code.slice(LAND_KEY_PREFIX.length));
    return code ? { ...ent, layer: val || ent.layer, typeCode: code } : ent;
  });
}

// Giữ tên gốc khi đã nhận đúng loại; không thì "<tên> → <khóa>" (máy chủ giữ 60 ký tự nên rút tên còn 45)
function asLandType(ent, val, key) {
  const rest = { ...ent, asLand: true };
  delete rest.typeCode;
  if (landPatternKey(ent.layer, ent.name) === key) return rest;
  if (val && landPatternKey(val) === key) return { ...rest, layer: val };
  return { ...rest, layer: `${String(val || ent.layer).slice(0, 45)} → ${key}` };
}

/** Lô đất chưa sử dụng: bỏ mã loại, đổi tên layer để không bị nhận là hạ tầng và landRule xếp vào "Đất chưa sử dụng" */
export function asUnusedLand(ent, name = ent.layer) {
  const rest = { ...ent };
  delete rest.typeCode;
  return { ...rest, asLand: true, layer: (landRule(name) || {}).key === 'csd' ? name : `Đất chưa sử dụng - ${name}` };
}

function codeOptions(selected, allowCsd) {
  const opt = (code, text) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(text)}</option>`;
  const infra = TYPE_CODE_OPTIONS.filter(([code]) => !LAND_CODES.has(code) && (allowCsd || code !== 'CSD'))
    .map(([code, label]) => opt(code, `${code} · ${label}`)).join('');
  const land = [...TYPE_CODE_OPTIONS.filter(([code]) => LAND_CODES.has(code)), ...LAND_TYPE_OPTIONS]
    .map(([code, label]) => opt(code, label)).join('');
  return `<option value="">— Bỏ qua (tự nhận loại đất theo tên) —</option>`
    + `<optgroup label="Hạ tầng">${infra}</optgroup><optgroup label="Lô đất – sheet DXF, không tính hạ tầng">${land}</optgroup>`;
}

/** Khung khớp thủ công trong báo cáo nhập file */
export function manualMappingHtml(mapping) {
  if (!mapping) return '';
  const mappedLots = mapping.values.reduce((s, { val, n }) => s + (mapping.codes.has(val) ? n : 0), 0);
  const fieldOpts = mapping.fields.map(f => `<option value="${escapeHtml(f.key)}"${f.key === mapping.field ? ' selected' : ''}>${escapeHtml(fieldLabel(f.key))} · ${f.distinct} giá trị${f.filled < mapping.unknownCount ? `, ${f.filled}/${mapping.unknownCount} lô có` : ''}</option>`).join('');
  const shown = mapping.values.slice(0, MAX_VALUES);
  const rows = shown.map(({ val, n }, idx) => {
    const code = mapping.codes.get(val) || '';
    const sug = mapping.suggested.has(val);
    return `<div class="cad-map-row${code ? ' mapped' : ''}">
      <span class="cad-map-val" title="${escapeHtml(val || '(trống)')}">${val ? escapeHtml(val) : '<i>(trống)</i>'} <small>${n} lô</small>${sug ? '<em title="Điền sẵn theo từ khóa hoặc lần khớp trước — kiểm tra lại">gợi ý</em>' : ''}</span>
      <select class="cad-map-type" data-k="${idx}" aria-label="Loại hạ tầng cho ${escapeHtml(val || 'giá trị trống')}">${codeOptions(code, mapping.allowCsd)}</select>
    </div>`;
  }).join('');
  const more = mapping.values.length - shown.length;
  return `<div class="cad-map">
    <div class="cad-map-head">${ico('tool')}Khớp thủ công <b>${mapping.unknownCount}</b> đối tượng chưa nhận diện được loại</div>
    <label class="cad-map-field">Nhận diện theo <select id="cadMapField">${fieldOpts}</select></label>
    <div class="cad-map-list">${rows}${more > 0 ? `<div class="cad-more">… còn ${more} giá trị khác (bỏ qua) — nên chọn trường có ít giá trị hơn</div>` : ''}</div>
    <div class="cad-map-foot"><span>Đã khớp ${mappedLots}/${mapping.unknownCount} đối tượng${mapping.suggested.size ? ` · <b>${mapping.suggested.size}</b> gợi ý cần kiểm tra` : ''}</span>${mapping.codes.size ? '<button type="button" id="cadMapClear" class="cad-clear">Bỏ khớp</button>' : ''}</div>
  </div>`;
}
