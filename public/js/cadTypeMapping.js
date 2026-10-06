// Khớp thủ công loại hạ tầng khi file không đặt tên layer / thuộc tính theo quy ước mã loại:
// người dùng chọn trường nhận diện (Layer, Folder, thuộc tính...), rồi gán từng giá trị tìm được với 1 loại hạ tầng.
import { escapeHtml, ico } from './utils.js';
import { layerToType, tt16Layer, SCHOOL_PICK, MARKET_PICK } from './cadImport.js';
import { landRule } from './tt16Symbols.js';

// Mã khớp "Đất ở": không phải hạ tầng — lô vẫn ghi sheet DXF, tên layer đổi để luôn tô màu đất ở
const LAND_O = 'DATO';

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
  [SCHOOL_PICK, 'Trường học – chọn cấp từng lô'],
  ['YT', 'Bệnh viện, Trạm y tế'],
  ['YT_DT', 'Y tế – cấp đô thị'],
  ['VH', 'Nhà văn hóa, thể thao'],
  ['VH_DT', 'Văn hóa, thể thao – cấp đô thị'],
  ['TM', 'Chợ, Trung tâm thương mại'],
  ['TM_DT', 'Chợ, TTTM – cấp đô thị'],
  [MARKET_PICK, 'Chợ, TTTM – chọn từng lô'],
  ['CSD', 'Cơ sở chưa sử dụng'],
  [LAND_O, 'Đất ở – sheet DXF, màu đất ở']
];
const VALID_CODES = new Set(TYPE_CODE_OPTIONS.map(([c]) => c));

// Hiển thị tối đa số giá trị; trường có nhiều giá trị hơn (tên riêng, mã số...) nên chọn trường khác
const MAX_VALUES = 80;
const EMPTY_KEY = '';
const MEMORY_KEY = 'qhhue.cadTypeMap';

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
  ['YT', /y te|benh vien|tram y|phong kham|health|hospital/],
  ['VH', /van hoa|the thao|\btdtt\b|san van dong|\bnvh\b|cultur|\bsport/],
  [MARKET_PICK, /\bcho\b|thuong mai|\btttm\b|sieu thi|\bdvtm\b|\btmdv\b|dich vu|commercial|\bmarket\b/,
    /hon hop|ket hop|du lich|dich vu cong cong|nha o/],
  ['CSD', /chua su dung|bo trong|dat trong|\bcsd\b/],
  [LAND_O, /\bdat o\b|\bo (do thi|nong thon)\b|\bodt\b|\bont\b|lang xom|biet thu|lien ke|chinh trang|tai dinh cu|\btdc\b|nha o\b|nha vuon|\bnoxh\b|chung cu|nhom nha/,
    /cay xanh|cong vien|truong|y te|bai do|van hoa|the thao/]
];
const URBAN_RE = /do thi|\bdt\b|urban/;
const SCHOOL_CODES = new Set(['THPT', 'THCS', 'TH', 'MN']);

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/[_\-.]+/g, ' ');

function guessCode(value) {
  const s = normalize(value);
  // Một giá trị gộp nhiều cấp trường (VD "Đất trường THCS_tiểu học_mầm non"): admin chọn cấp từng lô
  if (GUESS_RULES.filter(([code, re]) => SCHOOL_CODES.has(code) && re.test(s)).length > 1) return SCHOOL_PICK;
  const hit = GUESS_RULES.find(([, re, not]) => re.test(s) && !(not && not.test(s)));
  if (!hit) return '';
  const urban = `${hit[0]}_DT`;
  return URBAN_RE.test(s) && VALID_CODES.has(urban) ? urban : hit[0];
}

const suggestOf = (val, mem) => {
  const code = val ? mem[normalize(val)] || guessCode(val) : '';
  return VALID_CODES.has(code) ? code : '';
};

// Tên trường thường chứa loại đất (gServer: chucnangsudungdat, DBF cắt còn chucnangsu; loaidat; autocad_la)
const CLASS_FIELD_RE = /chuc ?nang|loai ?dat|muc ?dich|layer|autocad|\blop\b/;

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
// Layer TT16 (kể cả loại đất ngoài 10 nhóm, Truonghoc chờ chọn cấp) không đưa vào khớp thủ công
const isUnknown = (ent) => !tt16Layer(ent.layer) && !layerToType(ent.layer);

/**
 * Tạo trạng thái khớp thủ công cho các thực thể chưa nhận diện được loại; null nếu mọi thực thể đều đúng quy ước.
 * Trường mặc định: trường gợi ý được loại cho nhiều lô nhất (từ khóa / lần khớp trước); hòa thì trường có tên loại đất,
 * rồi trường trùng tên layer đang hiển thị, rồi trường ít giá trị hơn. Không trường nào gợi ý được: trường phân loại như trên.
 */
export function createManualMapping(entities) {
  const unknown = entities.filter(isUnknown);
  if (!unknown.length) return null;
  const stat = new Map();
  unknown.forEach(ent => {
    Object.entries(attrsOf(ent)).forEach(([key, val]) => {
      const s = stat.get(key) || { key, counts: new Map(), filled: 0, sameAsLayer: 0 };
      if (val) { s.counts.set(val, (s.counts.get(val) || 0) + 1); s.filled++; }
      if (val && val === ent.layer) s.sameAsLayer++;
      stat.set(key, s);
    });
  });
  const mem = loadMemory();
  const fields = [...stat.values()].filter(f => f.filled > 0)
    .map(f => ({
      key: f.key, distinct: f.counts.size, filled: f.filled, sameAsLayer: f.sameAsLayer,
      named: CLASS_FIELD_RE.test(normalize(f.key)) ? 1 : 0,
      covered: f.counts.size > MAX_VALUES ? 0 : [...f.counts].reduce((s, [val, n]) => s + (suggestOf(val, mem) ? n : 0), 0)
    }))
    .sort((a, b) => b.filled - a.filled || a.distinct - b.distinct);
  const byGuess = fields.filter(f => f.covered > 0)
    .sort((a, b) => b.covered - a.covered || b.named - a.named || b.sameAsLayer - a.sameAsLayer || a.distinct - b.distinct);
  // Ưu tiên trường dạng phân loại (mọi lô đều có, số giá trị ít hơn số lô) — tên riêng từng lô khó khớp hàng loạt
  const categorical = fields.filter(f => f.filled === unknown.length && f.distinct > 1 && f.distinct < f.filled);
  const def = byGuess[0] || [...(categorical.length ? categorical : fields)]
    .sort((a, b) => b.sameAsLayer - a.sameAsLayer || a.distinct - b.distinct)[0];
  const mapping = { unknownCount: unknown.length, fields, field: null, values: [], codes: new Map(), suggested: new Set() };
  if (def) selectField(mapping, def.key, entities);
  return mapping;
}

/** Đổi trường nhận diện: liệt kê giá trị (nhiều lô trước), điền sẵn gợi ý từ lần khớp trước / từ khóa */
export function selectField(mapping, key, entities) {
  const counts = new Map();
  entities.filter(isUnknown).forEach(ent => {
    const val = attrsOf(ent)[key] || EMPTY_KEY;
    counts.set(val, (counts.get(val) || 0) + 1);
  });
  mapping.field = key;
  mapping.values = [...counts].map(([val, n]) => ({ val, n })).sort((a, b) => b.n - a.n || a.val.localeCompare(b.val, 'vi'));
  mapping.codes = new Map();
  mapping.suggested = new Set();
  const mem = loadMemory();
  mapping.values.slice(0, MAX_VALUES).forEach(({ val }) => {
    const code = suggestOf(val, mem);
    if (code) {
      mapping.codes.set(val, code);
      mapping.suggested.add(val);
    }
  });
}

/** Gán loại cho giá trị thứ idx ('' = bỏ qua); nhớ lựa chọn cho các lần nhập sau */
export function setCode(mapping, idx, code) {
  const item = mapping.values[idx];
  if (!item) return;
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
 *  Đất ở không thêm typeCode (vẫn là lô đất sheet DXF), chỉ đổi layer cho landRule nhận ra. */
export function applyManualMapping(entities, mapping) {
  if (!mapping || !mapping.field || !mapping.codes.size) return entities;
  return entities.map(ent => {
    if (!isUnknown(ent)) return ent;
    const val = attrsOf(ent)[mapping.field] || EMPTY_KEY;
    const code = mapping.codes.get(val);
    if (code === LAND_O) {
      const name = val || ent.layer;
      return { ...ent, layer: (landRule(name) || {}).key === 'o' ? name : `Đất ở - ${name}` };
    }
    return code ? { ...ent, layer: val || ent.layer, typeCode: code } : ent;
  });
}

function codeOptions(selected) {
  return `<option value="">— Bỏ qua —</option>${TYPE_CODE_OPTIONS.map(([code, label]) =>
    `<option value="${code}"${code === selected ? ' selected' : ''}>${code} · ${escapeHtml(label)}</option>`).join('')}`;
}

/** Khung khớp thủ công trong báo cáo nhập file */
export function manualMappingHtml(mapping) {
  if (!mapping) return '';
  const mappedLots = mapping.values.reduce((s, { val, n }) => s + (mapping.codes.has(val) ? n : 0), 0);
  const fieldOpts = mapping.fields.map(f => `<option value="${escapeHtml(f.key)}"${f.key === mapping.field ? ' selected' : ''}>${escapeHtml(f.key)} · ${f.distinct} giá trị${f.filled < mapping.unknownCount ? `, ${f.filled}/${mapping.unknownCount} lô có` : ''}</option>`).join('');
  const shown = mapping.values.slice(0, MAX_VALUES);
  const rows = shown.map(({ val, n }, idx) => {
    const code = mapping.codes.get(val) || '';
    const sug = mapping.suggested.has(val);
    return `<div class="cad-map-row${code ? ' mapped' : ''}">
      <span class="cad-map-val" title="${escapeHtml(val || '(trống)')}">${val ? escapeHtml(val) : '<i>(trống)</i>'} <small>${n} lô</small>${sug ? '<em title="Điền sẵn theo từ khóa hoặc lần khớp trước — kiểm tra lại">gợi ý</em>' : ''}</span>
      <select class="cad-map-type" data-k="${idx}" aria-label="Loại hạ tầng cho ${escapeHtml(val || 'giá trị trống')}">${codeOptions(code)}</select>
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
