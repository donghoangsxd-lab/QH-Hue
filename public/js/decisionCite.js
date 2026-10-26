// Số và ngày quyết định để hiện trên dòng hồ sơ: «123/QĐ-UBND ngày 21/01/2025».
// Không bịa số khi tên file không có. Ngày ISO (catalog) hoặc dd/mm/yyyy trong tên file.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function vnDate(raw) {
  const iso = String(raw || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = String(raw || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (!dmy) return '';
  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  return `${pad2(day)}/${pad2(month)}/${dmy[3]}`;
}

function agencyOf(raw) {
  let token = String(raw || '').trim();
  if (/^qd/i.test(token)) token = `QĐ${token.slice(2)}`;
  if (!token || /^QĐ$/i.test(token)) return 'QĐ-UBND';
  if (token.startsWith('QĐ')) return token;
  return `QĐ-${token}`;
}

function genericName(raw) {
  const t = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return t === 'quyet dinh phe duyet' || t === 'quyet dinh' || t === 'quyet dinh phe duyet pdf';
}

/** «1101/QĐ-UBND» + ngày (ISO hoặc trong chuỗi) → «1101/QĐ-UBND ngày 17/04/2020». Không có số thì chuỗi rỗng. */
export function formatDecisionCite(numberText, dateText) {
  const text = String(numberText || '').replace(/\.pdf$/i, '').trim();
  const hit = text.match(/(\d{1,6})\s*\/\s*([A-Za-zĐđ][A-Za-z0-9Đđ-]*)/);
  if (!hit) return '';
  const cite = `${hit[1]}/${agencyOf(hit[2])}`;
  const when = vnDate(dateText) || vnDate(text);
  return when ? `${cite} ngày ${when}` : cite;
}

/** Tên file PDF. Có số thì thành câu trích; không thì giữ tên (trừ nhãn mặc định). */
export function citeFromFileName(name) {
  const text = String(name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  if (!text || genericName(text)) return '';
  return formatDecisionCite(text, text) || text;
}

/**
 * Ưu tiên câu đủ số và ngày. Tên file đã có số thắng catalog.
 * Catalog (schemes.json: decision, decisionDate) lấp khi file chỉ mang tên chung.
 */
export function pickDecisionCite({ fileName = '', schemeDecision = '', schemeDate = '' } = {}) {
  const fromFile = citeFromFileName(fileName);
  const fromScheme = formatDecisionCite(schemeDecision, schemeDate);
  const full = (s) => /\d+\/QĐ/.test(s) && /ngày \d{2}\/\d{2}\/\d{4}/.test(s);
  if (full(fromFile)) return fromFile;
  if (full(fromScheme)) return fromScheme;
  if (/\d+\/QĐ/.test(fromFile)) return fromFile;
  if (fromScheme) return fromScheme;
  return fromFile;
}
