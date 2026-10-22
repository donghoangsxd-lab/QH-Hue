// Đọc sheet HoSo, BanVe, VanBan trong file .xlsx trên máy. Không tải thư viện.
// SheetJS bản community khoảng 0,5–0,9 MB đã nén; file này chỉ vài chục KB và chỉ được tải khi hồ sơ có Excel.
import { readZip } from './kmlImport.js';

const SHEET_NAMES = ['HoSo', 'BanVe', 'VanBan'];
const MAX_ROWS = 40;

export function looksLikeMeta(path) {
  const s = String(path || '');
  return /HoSoScan/i.test(s) || /\d{2}(?:QHC|QPK|QCT)\d{7}/i.test(s);
}

function textOf(bytes) {
  return new TextDecoder().decode(bytes);
}

function sharedStrings(xml) {
  const out = [];
  const items = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  items.forEach(si => {
    const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]);
    out.push(decodeXml(parts.join('')));
  });
  return out;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/i);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellValue(tag, strings) {
  const ref = (tag.match(/\br="([^"]+)"/) || [, ''])[1];
  const type = (tag.match(/\bt="([^"]+)"/) || [, ''])[1];
  let value = '';
  if (type === 'inlineStr') {
    value = decodeXml((tag.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || [, ''])[1]);
  } else {
    value = decodeXml((tag.match(/<v>([\s\S]*?)<\/v>/) || [, ''])[1]);
    if (type === 's') value = strings[Number(value)] || '';
  }
  return { index: colIndex(ref), value: String(value || '').trim() };
}

function rowsOf(xml, strings) {
  const rows = [];
  const chunks = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
  chunks.slice(0, MAX_ROWS).forEach(row => {
    const cells = [];
    (row.match(/<c\b[\s\S]*?<\/c>/g) || []).forEach(tag => {
      const cell = cellValue(tag, strings);
      if (cell.index >= 0) cells[cell.index] = cell.value;
    });
    rows.push(cells);
  });
  return rows;
}

function sheetMap(workbookXml, relsXml) {
  const rels = {};
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
  const out = {};
  const pathOf = (target) => {
    const t = String(target || '').replace(/\\/g, '/').replace(/^\//, '');
    if (!t) return '';
    if (t.startsWith('xl/')) return t;
    return `xl/${t.replace(/^\.\//, '')}`;
  };
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const file = pathOf(rels[m[2]] || '');
    if (file) out[decodeXml(m[1])] = file;
  }
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*r:id="([^"]+)"[^>]*name="([^"]+)"/g)) {
    const sheet = decodeXml(m[2]);
    if (out[sheet]) continue;
    const file = pathOf(rels[m[1]] || '');
    if (file) out[sheet] = file;
  }
  return out;
}

function entryText(entries, name) {
  const hit = entries.find(e => e.name.replace(/\\/g, '/').toLowerCase() === name.toLowerCase());
  return hit ? hit.read() : null;
}

export async function readMetaWorkbook(bytes, path) {
  const name = String(path || 'Excel').split('/').pop();
  const raw = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const entries = readZip(raw, name);
  const bookXml = await entryText(entries, 'xl/workbook.xml');
  const relsXml = await entryText(entries, 'xl/_rels/workbook.xml.rels');
  if (!bookXml || !relsXml) {
    return { name, relevant: looksLikeMeta(path), error: looksLikeMeta(path) ? `${name}: không phải sổ Excel hợp lệ.` : '', sheets: {} };
  }
  const map = sheetMap(textOf(bookXml), textOf(relsXml));
  const names = Object.keys(map);
  const relevant = looksLikeMeta(path) || SHEET_NAMES.some(sheet => names.includes(sheet));
  if (!relevant) return { name, relevant: false, sheets: {} };
  const shared = await entryText(entries, 'xl/sharedStrings.xml');
  const strings = shared ? sharedStrings(textOf(shared)) : [];
  const sheets = {};
  for (const sheet of SHEET_NAMES) {
    const file = map[sheet];
    if (!file) continue;
    const xml = await entryText(entries, file);
    if (!xml) continue;
    const table = rowsOf(textOf(xml), strings);
    const headers = table[0] || [];
    const maCol = headers.findIndex(h => String(h || '').replace(/\s+/g, ' ').trim() === 'Mã hồ sơ');
    const maHoSo = [];
    if (maCol >= 0) {
      table.slice(1).forEach(row => {
        const val = row[maCol];
        if (val) maHoSo.push(val);
      });
    }
    sheets[sheet] = { headers, maHoSo };
  }
  return { name, relevant: true, sheets };
}
