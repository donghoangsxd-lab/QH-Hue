// Tách Ten_QH thành tên đầy đủ (TenDayDu) và tên rút gọn (TenRutGon).
// Ten_QH giữ làm khóa đồng bộ Sheet / bucket / bản đồ. Cùng quy tắc với splitProjectName trong apps-script/Code.gs.

const KIND_LABEL = {
  QHCT: 'Quy hoạch chi tiết',
  QHC: 'Quy hoạch chung',
  QHPK: 'Quy hoạch phân khu'
};

const KIND_RULES = [
  { re: /^qhct\s*\(\s*1\s*\/\s*2\.?000\s*\)\s*/i, kind: 'QHCT', scale: '1/2.000' },
  { re: /^qhct\b[\s.:–—-]*/i, kind: 'QHCT', scale: '' },
  { re: /^qhc(?![a-zđ])[\s.:–—-]*/i, kind: 'QHC', scale: '' },
  { re: /^qhpk\b[\s.:–—_]*/i, kind: 'QHPK', scale: '' }
];

const SMALL_WORDS = new Set(['và', 'của', 'các', 'tại', 'thuộc', 'cho', 'với', 'theo', 'đến', 'trên', 'trong', 'về']);
const SHORT_MAX = 46;

const NAME_OVERRIDE = {
  saigoncm: {
    tenDayDu: 'Quy hoạch phân khu Khu phi thuế quan Sài Gòn – Chân Mây',
    tenRutGon: 'Phi thuế quan SG–CM'
  },
  'qhp~1': { tenDayDu: 'QHP~1', tenRutGon: 'QHP~1' }
};

function squash(s) {
  return String(s || '').normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function foldKey(s) {
  return squash(s).toLowerCase();
}

function capFirst(s) {
  const t = squash(s);
  if (!t) return '';
  return t.charAt(0).toLocaleUpperCase('vi') + t.slice(1);
}

function titleCaseIfShouting(s) {
  if (!s || s !== s.toUpperCase() || !/\p{L}/u.test(s)) return s;
  return s.toLocaleLowerCase('vi').split(' ').map((w, i) => {
    const bare = w.replace(/^[("«]+|[)"».,]+$/g, '');
    if (i && SMALL_WORDS.has(bare)) return w.toLocaleLowerCase('vi');
    return w.charAt(0).toLocaleUpperCase('vi') + w.slice(1);
  }).join(' ');
}

function restoreRomans(s) {
  return s.replace(/(^|[\s,;/(–—-])(i{1,3}|iv|vi{0,3}|ix|x)(?=$|[\s,;/)–—-])/gi, (m, pre, num) => pre + num.toUpperCase());
}

function fixSpell(s) {
  return s
    .replace(/Thuỷ/g, 'Thủy').replace(/thuỷ/g, 'thủy')
    .replace(/\bPhia\b/g, 'Phía').replace(/\bphia\b/g, 'phía')
    .replace(/(^|[\s–])Tay\b/g, '$1Tây')
    .replace(/\bthue\b/gi, (m) => (m[0] === 'T' ? 'Thuế' : 'thuế'))
    .replace(/di lịch/gi, 'du lịch')
    .replace(/\bSG\s*[-–]\s*CM\b/g, 'Sài Gòn – Chân Mây')
    .replace(/\bHue\b/g, 'Huế')
    .replace(/\s+[–—-]\s*$/g, '')
    .replace(/(\S)\s*-\s*(\S)/g, '$1 – $2');
}

function unwrapSlug(raw) {
  const s = squash(raw);
  if (!/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(s)) return s;
  return s
    .replace(/_/g, ' ')
    .replace(/([a-zà-ỹ])([A-ZĐ])/g, '$1 $2')
    .replace(/([A-ZĐ]+)([A-ZĐ][a-zà-ỹ])/g, '$1 $2');
}

function expandTt(rest) {
  return /^phú lộc\b/i.test(rest.trim()) ? 'thị trấn' : 'trung tâm';
}

function expandBody(body) {
  let s = body.replace(/\bXD\b/g, 'xây dựng');
  s = s.replace(/\bKCN\b/g, 'khu công nghiệp');
  s = s.replace(/\bKDL\b/g, 'khu du lịch');
  s = s.replace(/\bKĐT\b/g, 'khu đô thị');
  s = s.replace(/\bĐTM\b/g, 'đô thị mới');
  s = s.replace(/\bTP\b/g, 'thành phố');
  s = s.replace(/\bTT\b/g, (m, offset, str) => expandTt(str.slice(offset + m.length)));
  s = s.replace(/^(?:qh|qhc|qhct|qhpk)\s+(?:chi tiết\s+)?/i, '');
  if (/^[A-Za-zĐ]$/.test(s)) s = `khu ${s.toUpperCase()}`;
  else if (/^[A-Za-zĐ]\s*[–,]/.test(s)) s = `khu ${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  return squash(s);
}

function buildFull(kind, scale, body) {
  const label = KIND_LABEL[kind] || '';
  let rest = expandBody(body);
  if (!rest) return label || '';
  if (/quy hoạch\s+(chi tiết|phân khu|chung)/i.test(rest)) return capFirst(restoreRomans(rest));
  let lead = '';
  const adj = rest.match(/^(điều chỉnh(?:\s+cục bộ)?)\s+/i);
  if (adj) {
    lead = `${capFirst(adj[1])} `;
    rest = rest.slice(adj[0].length);
  }
  rest = capFirst(rest);
  const scaleTxt = scale ? ` tỷ lệ ${scale}` : '';
  return capFirst(restoreRomans(squash(`${lead}${label}${scaleTxt} ${rest}`)));
}

function swapPrefix(s, from, to) {
  const low = s.toLocaleLowerCase('vi');
  const f = from.toLocaleLowerCase('vi');
  if (!low.startsWith(f)) return s;
  const next = s.charAt(f.length);
  if (next && !/[\s,–—-]/.test(next)) return s;
  return to + s.slice(f.length);
}

function compressShort(s) {
  const rules = [
    ['khu dịch vụ du lịch', 'KDL'],
    ['khu công nghiệp', 'KCN'],
    ['khu du lịch', 'KDL'],
    ['khu đô thị', 'KĐT'],
    ['khu trung tâm', 'TT'],
    ['trung tâm', 'TT'],
    ['khu phi thuế quan', 'Phi thuế quan']
  ];
  return rules.reduce((out, [from, to]) => swapPrefix(out, from, to), s);
}

function endingPlace(body) {
  const core = squash(body).split(/\s+thuộc\s+/i)[0].split(/\s+tại\s+/i)[0];
  const m = core.match(/(?:^|[\s–,])([A-ZĐ][\p{L}']+(?:\s+[A-ZĐ][\p{L}']+){1,2})\s*$/u);
  if (!m) return '';
  const place = m[1].replace(/^(?:Phường|Xã|Thị trấn|Khu)\s+/u, '');
  if (/^(?:Khu|Phường|Xã|Quy hoạch|Xây|Dựng|Dịch|Vụ|Phụ|Trợ)$/iu.test(place)) return '';
  return place;
}

function placeNames(text) {
  return [...String(text || '').matchAll(/(?:phường|xã|thị trấn)\s+([\p{L}]+(?:\s+[\p{L}]+){0,1})/giu)]
    .map(m => capFirst(m[1].replace(/\s+và$/i, '').trim()))
    .filter(n => n && !/^(?:và|các|khu)$/i.test(n));
}

function clip(s) {
  s = squash(s);
  if (s.length <= SHORT_MAX) return s;
  const cut = s.slice(0, SHORT_MAX);
  const at = cut.lastIndexOf(' ');
  return (at > 16 ? cut.slice(0, at) : cut).trim();
}

function buildShort(body, scale, shouted) {
  const adjusted = /^(điều chỉnh|Điều chỉnh)\b/.test(body);
  let s = squash(body)
    .replace(/\bXD\b/g, 'xây dựng')
    .replace(/^(?:qh|qhc|qhct|qhpk)\s+(?:chi tiết\s+)?/i, '')
    .replace(/^(điều chỉnh\s+)?(cục bộ\s+)?/i, '')
    .replace(/^(quy hoạch\s+)?(phân khu|chi tiết|chung)\s*/i, '')
    .replace(/^[\s,;:–—-]+/, '')
    .replace(/^(xây dựng\s+)?/i, '')
    .replace(/^tỷ lệ\s+1\s*\/\s*[\d.]+\s*/i, '')
    .replace(/\s+đến năm\s+.*/i, '')
    .replace(/\s*\(\s*1\s*\/\s*[\d.]+\s*\)/g, '')
    .replace(/\s*\((?![^)]*20\d{2})[^)]*\)/g, '');
  const year = (s.match(/\(\s*20\d{2}\s*\)/) || [''])[0];
  s = squash(s.replace(/\s*\(\s*20\d{2}\s*\)/g, ''));
  const placeAt = s.match(/\btại\s+((?:phường|xã|thị trấn)\s+.+)$/i);
  s = s.split(/\s+thuộc\s+/i)[0];
  s = s.split(/\s+tại\s+/i)[0];
  s = squash(s).replace(/^[\s,;:–—-]+/, '');
  const bits = s.split(/\s*,\s*/);
  if (bits.length > 1 && bits[0].length > 12 && !/^[IVX\d]+$/i.test(bits[1]) && !/^\d/.test(bits[1])) {
    const ward = bits.slice(1).join(', ').match(/phường\s+([\p{L}]+(?:\s+[\p{L}]+){0,1})/iu);
    s = ward ? `${bits[0]} – ${capFirst(ward[1].trim())}` : bits[0];
  }
  s = s.split(/\s+kết hợp\s+/i)[0];
  s = s.split(/\s+và các\s+/i)[0];
  s = s.split(/\s+hàng hóa\s+/i)[0];
  s = s.replace(/\s+trục trung tâm(?:\s+khu\s+du\s+lịch)?\s+/i, ' ');
  s = s.replace(/\s+–\s+phường\s+/gi, ' – ');
  const dash = s.split(/\s+–\s+/);
  if (dash.length > 1 && /^(khu|phường|xã|thị trấn|thành phố)(?=\s|$)/i.test(dash[1]) && dash[0].length >= 8) s = dash[0];
  s = squash(s).replace(/^khu vực\s+/i, '').replace(/^phường\s+/i, '').replace(/\s+và phường\s+/gi, ' – ').replace(/^Khu (phía\s+)/i, '$1').replace(/^[\s,;:–—-]+/, '');
  if (/sân g[oô]n/i.test(body)) {
    const places = [...new Set(placeNames(body))];
    if (places.length) s = `Sân gôn ${places.join(' – ')}`;
    else if (s.length > 28) {
      const golfAt = s.match(/sân g[oô]n\b.*/i);
      if (golfAt) s = capFirst(golfAt[0]);
    }
  }
  if (/^[A-Za-zĐ]$/.test(s)) s = `Khu ${s.toUpperCase()}`;
  else if (/^[A-Za-zĐ]\s*,/.test(s)) {
    const rest = squash(s.replace(/^[A-Za-zĐ]\s*,\s*/, ''));
    s = `Khu ${s.charAt(0).toUpperCase()}${rest ? ` – ${rest}` : ''}`;
  } else if (/^[A-Za-zĐ]\s*–/.test(s)) s = `Khu ${capFirst(s)}`;
  else s = capFirst(s);
  s = compressShort(s);
  if (/thuộc\s+khu đô thị mới\s+an vân dương/i.test(body) && !/an vân dương/i.test(s)) s = `${s} – An Vân Dương`;
  const tail = shouted ? '' : endingPlace(body);
  const tailLast = tail ? tail.split(/\s+/).pop() : '';
  if (tail && tailLast && !s.toLocaleLowerCase('vi').includes(tailLast.toLocaleLowerCase('vi'))) {
    if (/nghỉ dưỡng$/i.test(s)) s = s.replace(/nghỉ dưỡng$/i, tail);
    else if (`${s} – ${tail}`.length <= SHORT_MAX) s = `${s} – ${tail}`;
  }
  if (placeAt) {
    const missing = [...new Set(placeNames(placeAt[1]))].filter(n => !s.toLocaleLowerCase('vi').includes(n.toLocaleLowerCase('vi')));
    if (missing.length) {
      s = s.replace(/\s+sinh thái và nghỉ dưỡng ven biển$/i, ' ven biển');
      s = `${s} – ${missing.join(' – ')}`;
    }
  }
  const y = year.replace(/[()\s]/g, '');
  const marks = [y, scale].filter(Boolean);
  if (marks.length) s = `${s} (${marks.join(', ')})`;
  if (adjusted && !/điều chỉnh/i.test(s)) s = `${s} (điều chỉnh)`;
  return clip(s);
}

export function splitProjectName(raw) {
  const original = squash(raw);
  if (!original) return { tenDayDu: '', tenRutGon: '' };
  const preset = NAME_OVERRIDE[foldKey(original)];
  if (preset) return { tenDayDu: preset.tenDayDu, tenRutGon: preset.tenRutGon };

  let s = unwrapSlug(original)
    .replace(/^\d+[.)]?\s+/, '')
    .replace(/^\d+\s+(?=điều chỉnh|quy hoạch)/i, '');
  const shouted = s === s.toUpperCase() && /\p{L}/u.test(s);
  s = restoreRomans(fixSpell(titleCaseIfShouting(s)));

  let kind = '';
  let scale = '';
  let body = s;
  for (const rule of KIND_RULES) {
    const m = body.match(rule.re);
    if (!m) continue;
    kind = rule.kind;
    scale = rule.scale;
    body = body.slice(m[0].length);
    break;
  }
  body = squash(body);
  const tenDayDu = kind ? buildFull(kind, scale, body) : capFirst(restoreRomans(fixSpell(body || original)));
  const tenRutGon = buildShort(body || original, scale, shouted) || tenDayDu || original;
  return { tenDayDu: tenDayDu || original, tenRutGon };
}

export function namesOfProject(entry) {
  const tenQH = squash(entry && (entry.tenQH || entry.name));
  const split = splitProjectName(tenQH);
  return {
    tenQH,
    tenDayDu: squash(entry && entry.tenDayDu) || split.tenDayDu,
    tenRutGon: squash(entry && entry.tenRutGon) || split.tenRutGon
  };
}
