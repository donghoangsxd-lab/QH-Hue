// Khớp thủ công loại hạ tầng khi file không đặt tên layer / thuộc tính theo quy ước mã loại:
// người dùng chọn trường nhận diện (Layer, Folder, thuộc tính...), rồi gán từng giá trị tìm được với 1 loại hạ tầng.
import { escapeHtml } from './utils.js';
import { layerToType } from './cadImport.js';

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
  ['YT', 'Bệnh viện, Trạm y tế'],
  ['YT_DT', 'Y tế – cấp đô thị'],
  ['VH', 'Nhà văn hóa, thể thao'],
  ['VH_DT', 'Văn hóa, thể thao – cấp đô thị'],
  ['TM', 'Chợ, Trung tâm thương mại'],
  ['TM_DT', 'Chợ, TTTM – cấp đô thị'],
  ['CSD', 'Cơ sở chưa sử dụng']
];
const VALID_CODES = new Set(TYPE_CODE_OPTIONS.map(([c]) => c));

// Hiển thị tối đa số giá trị; trường có nhiều giá trị hơn (tên riêng, mã số...) nên chọn trường khác
const MAX_VALUES = 80;
const EMPTY_KEY = '';
const MEMORY_KEY = 'qhhue.cadTypeMap';

// Gợi ý loại theo từ khóa trong giá trị (bỏ dấu, không phân biệt hoa thường); thứ tự quan trọng: THCS/THPT trước TH
const GUESS_RULES = [
  ['THPT', /\bthpt\b|trung hoc pho thong/],
  ['THCS', /\bthcs\b|trung hoc co so/],
  ['TH', /tieu hoc|\bth\b/],
  ['MN', /mam non|mau giao|nha tre|\bmn\b/],
  ['CV', /cong vien|cay xanh|vuon hoa|diem xanh|\bpark\b/],
  ['BDX', /bai do|do xe|bai xe|parking|tram sac/],
  ['YT', /y te|benh vien|tram y|phong kham/],
  ['VH', /van hoa|the thao|san van dong|\bnvh\b/],
  ['TM', /\bcho\b|thuong mai|\btttm\b|sieu thi/],
  ['CSD', /chua su dung|bo trong|dat trong|\bcsd\b/]
];
const URBAN_RE = /do thi|\bdt\b/;

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/[_\-.]+/g, ' ');

function guessCode(value) {
  const s = normalize(value);
  const hit = GUESS_RULES.find(([, re]) => re.test(s));
  if (!hit) return '';
  const urban = `${hit[0]}_DT`;
  return URBAN_RE.test(s) && VALID_CODES.has(urban) ? urban : hit[0];
}

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
const isUnknown = (ent) => !layerToType(ent.layer);

/**
 * Tạo trạng thái khớp thủ công cho các thực thể chưa nhận diện được loại; null nếu mọi thực thể đều đúng quy ước.
 * Trường mặc định: trường phân loại có giá trị trùng tên layer đang hiển thị (tên người dùng thấy trong cảnh báo) ở nhiều thực thể nhất.
 */
export function createManualMapping(entities) {
  const unknown = entities.filter(isUnknown);
  if (!unknown.length) return null;
  const stat = new Map();
  unknown.forEach(ent => {
    Object.entries(attrsOf(ent)).forEach(([key, val]) => {
      const s = stat.get(key) || { key, values: new Set(), filled: 0, sameAsLayer: 0 };
      if (val) { s.values.add(val); s.filled++; }
      if (val && val === ent.layer) s.sameAsLayer++;
      stat.set(key, s);
    });
  });
  const fields = [...stat.values()].filter(f => f.filled > 0)
    .map(f => ({ key: f.key, distinct: f.values.size, filled: f.filled, sameAsLayer: f.sameAsLayer }))
    .sort((a, b) => b.filled - a.filled || a.distinct - b.distinct);
  // Ưu tiên trường dạng phân loại (mọi lô đều có, số giá trị ít hơn số lô) — tên riêng từng lô khó khớp hàng loạt
  const categorical = fields.filter(f => f.filled === unknown.length && f.distinct > 1 && f.distinct < f.filled);
  const def = [...(categorical.length ? categorical : fields)]
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
    if (!val) return;
    const code = mem[normalize(val)] || guessCode(val);
    if (VALID_CODES.has(code)) {
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

/** Thực thể sau khi khớp: thực thể chưa nhận diện được mà có giá trị đã gán → thêm typeCode; layer hiển thị = giá trị đã khớp */
export function applyManualMapping(entities, mapping) {
  if (!mapping || !mapping.field || !mapping.codes.size) return entities;
  return entities.map(ent => {
    if (!isUnknown(ent)) return ent;
    const val = attrsOf(ent)[mapping.field] || EMPTY_KEY;
    const code = mapping.codes.get(val);
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
    <div class="cad-map-head">🔧 Khớp thủ công <b>${mapping.unknownCount}</b> đối tượng chưa nhận diện được loại</div>
    <label class="cad-map-field">Nhận diện theo <select id="cadMapField">${fieldOpts}</select></label>
    <div class="cad-map-list">${rows}${more > 0 ? `<div class="cad-more">… còn ${more} giá trị khác (bỏ qua) — nên chọn trường có ít giá trị hơn</div>` : ''}</div>
    <div class="cad-map-foot"><span>Đã khớp ${mappedLots}/${mapping.unknownCount} đối tượng${mapping.suggested.size ? ` · <b>${mapping.suggested.size}</b> gợi ý cần kiểm tra` : ''}</span>${mapping.codes.size ? '<button type="button" id="cadMapClear" class="cad-clear">Bỏ khớp</button>' : ''}</div>
  </div>`;
}
