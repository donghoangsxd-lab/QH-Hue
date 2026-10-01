// Bộ gõ Telex tối giản cho ô nhập chữ (dùng được cả khi máy không cài Unikey / EVKey).
// Xử lý từng phím trên từ đang gõ: aa ââ ee oo aw ow uw (uow → ươ) dd, dấu s f r x j, z bỏ dấu; gõ lặp phím → trả lại chữ gốc.
// Máy đã bật Unikey: phím tới trình duyệt đã là chữ có dấu nên bộ gõ này không can thiệp.

const TONE_ROWS = {
  a: 'aáàảãạ', ă: 'ăắằẳẵặ', â: 'âấầẩẫậ', e: 'eéèẻẽẹ', ê: 'êếềểễệ', i: 'iíìỉĩị',
  o: 'oóòỏõọ', ô: 'ôốồổỗộ', ơ: 'ơớờởỡợ', u: 'uúùủũụ', ư: 'ưứừửữự', y: 'yýỳỷỹỵ'
};
const TONE_KEYS = { s: 1, f: 2, r: 3, x: 4, j: 5 };
const MODIFIED = 'ăâêôơư';
const CIRCUMFLEX = { a: 'â', e: 'ê', o: 'ô' };
const PLAIN = { ă: 'a', â: 'a', ê: 'e', ô: 'o', ơ: 'o', ư: 'u' };

// ký tự có dấu → { base, tone }
const DECOMPOSE = {};
Object.entries(TONE_ROWS).forEach(([base, row]) => [...row].forEach((ch, tone) => { DECOMPOSE[ch] = { base, tone }; }));

const isVowel = (b) => b in TONE_ROWS;
const WORD_RE = /[a-zA-ZđĐ\u00C0-\u1EF9]+$/;

function split(word) {
  return [...word].map(ch => {
    const lower = ch.toLowerCase();
    const d = DECOMPOSE[lower];
    return { base: d ? d.base : lower, tone: d ? d.tone : 0, upper: ch !== lower };
  });
}

function join(chars) {
  return chars.map(c => {
    const ch = isVowel(c.base) ? TONE_ROWS[c.base][c.tone] : c.base;
    return c.upper ? ch.toUpperCase() : ch;
  }).join('');
}

/** Chỉ số các nguyên âm của cụm nguyên âm cuối từ (bỏ u trong "qu", i trong "gi" + nguyên âm) */
function vowelGroup(chars) {
  let end = -1;
  for (let i = chars.length - 1; i >= 0; i--) if (isVowel(chars[i].base)) { end = i; break; }
  if (end < 0) return [];
  let start = end;
  while (start > 0 && isVowel(chars[start - 1].base)) start--;
  const idx = [];
  for (let i = start; i <= end; i++) idx.push(i);
  if (idx.length > 1 && start === 1 && ((chars[0].base === 'q' && chars[1].base === 'u') || (chars[0].base === 'g' && chars[1].base === 'i'))) idx.shift();
  return idx;
}

/** Vị trí đặt dấu thanh (kiểu cũ: hòa, thủy; có phụ âm cuối: hoàng, tuấn) */
function tonePos(chars) {
  const g = vowelGroup(chars);
  if (!g.length) return -1;
  const mod = g.filter(i => MODIFIED.includes(chars[i].base));
  if (mod.length) return mod[mod.length - 1];
  if (g.length === 1) return g[0];
  if (g.length === 3) return g[1];
  return g[g.length - 1] < chars.length - 1 ? g[1] : g[0];
}

function setTone(chars, tone) {
  chars.forEach(c => { c.tone = 0; });
  if (!tone) return true;
  const p = tonePos(chars);
  if (p < 0) return false;
  chars[p].tone = tone;
  return true;
}

const currentTone = (chars) => chars.reduce((t, c) => t || c.tone, 0);

/** Từ đang gõ + 1 phím → từ mới (không áp dụng được thì nối phím vào cuối) */
export function telexApply(word, key) {
  const k = key.toLowerCase();
  const upperKey = key !== k;
  const chars = split(word);
  const tone = currentTone(chars);
  const append = () => word + key;

  if (k in TONE_KEYS) {
    if (!vowelGroup(chars).length) return append();
    if (tone === TONE_KEYS[k]) { setTone(chars, 0); return join(chars) + key; }
    setTone(chars, TONE_KEYS[k]);
    return join(chars);
  }
  if (k === 'z') {
    if (!tone) return append();
    setTone(chars, 0);
    return join(chars);
  }
  if (k === 'd') {
    if (chars[0] && chars[0].base === 'd') { chars[0].base = 'đ'; return join(chars); }
    if (chars[0] && chars[0].base === 'đ') { chars[0].base = 'd'; return join(chars) + key; }
    return append();
  }

  const g = vowelGroup(chars);
  if (k in CIRCUMFLEX) {
    const i = [...g].reverse().find(j => PLAIN[chars[j].base] === k || chars[j].base === k);
    if (i === undefined) return append();
    if (chars[i].base === CIRCUMFLEX[k]) { chars[i].base = k; setTone(chars, tone); return join(chars) + key; }
    chars[i].base = CIRCUMFLEX[k];
    setTone(chars, tone);
    return join(chars);
  }
  if (k === 'w') {
    if (!g.length) {
      if (chars.length && !isVowel(chars[chars.length - 1].base)) return word + (upperKey ? 'Ư' : 'ư');
      return append();
    }
    const uo = g.findIndex((i, n) => n < g.length - 1 && 'uư'.includes(chars[i].base) && 'oơ'.includes(chars[g[n + 1]].base));
    let changed = false, reverted = false;
    if (uo >= 0) {
      const a = chars[g[uo]], b = chars[g[uo + 1]];
      if (a.base === 'ư' && b.base === 'ơ') { a.base = 'u'; b.base = 'o'; reverted = true; }
      else { a.base = 'ư'; b.base = 'ơ'; changed = true; }
    } else {
      const map = { a: 'ă', o: 'ơ', u: 'ư' };
      const back = { ă: 'a', ơ: 'o', ư: 'u' };
      const i = [...g].reverse().find(j => map[chars[j].base] || back[chars[j].base]);
      if (i !== undefined) {
        if (back[chars[i].base]) { chars[i].base = back[chars[i].base]; reverted = true; }
        else { chars[i].base = map[chars[i].base]; changed = true; }
      }
    }
    if (!changed && !reverted) return append();
    setTone(chars, tone);
    return join(chars) + (reverted ? key : '');
  }
  return append();
}

/**
 * Gắn Telex vào input / textarea: chặn phím gõ ở cuối 1 từ, thay từ bằng kết quả telexApply.
 * enabled() → false thì để trình duyệt gõ bình thường.
 */
export function attachTelex(el, enabled = () => true) {
  el.addEventListener('beforeinput', (e) => {
    if (!enabled() || e.inputType !== 'insertText' || !e.data || e.data.length !== 1 || e.isComposing) return;
    if (!/[a-zA-Z]/.test(e.data)) return;
    const start = el.selectionStart, end = el.selectionEnd;
    if (start !== end) return;
    const before = el.value.slice(0, start);
    const m = before.match(WORD_RE);
    const word = m ? m[0] : '';
    const next = telexApply(word, e.data);
    if (next === word + e.data) return;
    e.preventDefault();
    const head = before.slice(0, before.length - word.length);
    el.value = head + next + el.value.slice(end);
    const caret = head.length + next.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
