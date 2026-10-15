// Tem đất trên lớp ký hiệu (file KH - ….dxf): vòng tròn + chữ, hoặc block có thuộc tính.
// Mỗi tem: ký hiệu lô, diện tích, mật độ xây dựng, tầng cao; hệ số sử dụng đất có thể không có.
// Tâm tem gán vào polygon chứa nó. Một polygon chứa từ 2 tem thì để người dùng gán lần lượt.

function readTags(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    tags.push([code, lines[i + 1].trim()]);
  }
  return tags;
}

function plainDxf(s) {
  return String(s || '')
    .replace(/\\P/gi, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\{[^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[dDcCpP]/g, m => (m[2].toLowerCase() === 'd' ? '°' : m[2].toLowerCase() === 'c' ? 'Ø' : ''))
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .trim();
}

function readEntity(tags, i) {
  const ent = { layer: '0', x: NaN, y: NaN, r: NaN, h: NaN, text: '', chunks: [], tag: '' };
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    const [code, v] = tags[i];
    if (code === 8) ent.layer = v;
    else if (code === 10) ent.x = parseFloat(v);
    else if (code === 20) ent.y = parseFloat(v);
    else if (code === 40) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) { if (!Number.isFinite(ent.r)) ent.r = n; ent.h = n; }
    } else if (code === 1) ent.text = v;
    else if (code === 3) ent.chunks.push(v);
    else if (code === 2) ent.tag = v;
  }
  return [ent, i];
}

const CODE_RE = /^[A-Za-z]{1,8}(?:[.\-]?\d{0,4}[A-Za-z]?)?$/;
const RANGE_RE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;
const ATTR_TAG = {
  code: /ky.?hieu|ki.?hieu|^ma(?:lo)?$|^code$/i,
  area: /dien.?tich|^dt$/i,
  coverage: /mat.?do|mdxd/i,
  floors: /tang.?cao|so.?tang|^tang$/i,
  far: /he.?so|hssdd|hesosdd/i
};

export function isLotCode(s) {
  const t = String(s || '').trim();
  return !!t && t.length <= 16 && !/\s/.test(t) && /[A-Za-z]/.test(t) && CODE_RE.test(t);
}

function numToken(s) {
  const t = String(s || '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return { raw: t, value, decimals: (t.split('.')[1] || '').length };
}

function rangeToken(s) {
  const m = String(s || '').trim().match(RANGE_RE);
  return m ? `${Number(m[1])}-${Number(m[2])}` : '';
}

/** TEXT / MTEXT / CIRCLE / INSERT+ATTRIB trong ENTITIES */
export function readStampEntities(text) {
  const tags = readTags(text);
  const texts = [];
  const circles = [];
  const blocks = [];
  let section = null;
  for (let i = 0; i < tags.length;) {
    const [code, v] = tags[i];
    if (code !== 0) { i++; continue; }
    if (v === 'SECTION') { section = tags[i + 1] && tags[i + 1][1]; i += 2; continue; }
    if (v === 'ENDSEC') { section = null; i++; continue; }
    if (section !== 'ENTITIES') { i++; continue; }
    if (v === 'TEXT' || v === 'MTEXT') {
      const [ent, n] = readEntity(tags, i + 1);
      i = n;
      const body = plainDxf(`${ent.chunks.join('')}${ent.text}`);
      if (body && Number.isFinite(ent.x) && Number.isFinite(ent.y)) {
        texts.push({ text: body, x: ent.x, y: ent.y, h: Number.isFinite(ent.h) ? ent.h : 0 });
      }
      continue;
    }
    if (v === 'CIRCLE') {
      const [ent, n] = readEntity(tags, i + 1);
      i = n;
      if (Number.isFinite(ent.x) && Number.isFinite(ent.y) && ent.r > 0) circles.push({ x: ent.x, y: ent.y, r: ent.r });
      continue;
    }
    if (v === 'INSERT') {
      const [ent, n] = readEntity(tags, i + 1);
      i = n;
      const attrs = [];
      while (i < tags.length && tags[i][0] === 0 && tags[i][1] === 'ATTRIB') {
        const [at, n2] = readEntity(tags, i + 1);
        i = n2;
        attrs.push({ tag: at.tag, text: plainDxf(at.text), x: at.x, y: at.y });
      }
      if (i < tags.length && tags[i][0] === 0 && tags[i][1] === 'SEQEND') i++;
      if (Number.isFinite(ent.x) && Number.isFinite(ent.y) && attrs.length) blocks.push({ x: ent.x, y: ent.y, attrs });
      continue;
    }
    for (i++; i < tags.length && tags[i][0] !== 0; i++);
  }
  return { texts, circles, blocks };
}

function explode(ent) {
  const h = ent.h > 0 ? ent.h : 2;
  const lines = ent.text.split(/\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line, li) => {
    const parts = line.split(/\s+/).filter(Boolean);
    parts.forEach((text, k) => out.push({ text, x: ent.x + k * h * 2.4, y: ent.y - li * h * 1.6, h }));
  });
  return out;
}

function clusterEps(items) {
  const hs = items.map(t => t.h).filter(v => v > 0).sort((a, b) => a - b);
  if (hs.length) return Math.max(hs[Math.floor(hs.length / 2)] * 8, 4);
  if (items.length < 2) return 12;
  const nn = items.map((t, i) => {
    let best = Infinity;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      best = Math.min(best, Math.hypot(t.x - items[j].x, t.y - items[j].y));
    }
    return best;
  }).sort((a, b) => a - b);
  return Math.max(nn[Math.floor(nn.length / 2)] * 3.2, 6);
}

function cluster(items, eps) {
  const parent = items.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) <= eps) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const id = find(i);
    const g = groups.get(id) || [];
    g.push(it);
    groups.set(id, g);
  });
  return [...groups.values()];
}

function splitByCode(items) {
  const codes = items.filter(t => isLotCode(t.text));
  if (codes.length <= 1) return [items];
  const groups = codes.map(c => [c]);
  items.forEach(t => {
    if (codes.includes(t)) return;
    let best = 0;
    let bestD = Infinity;
    codes.forEach((c, i) => {
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    groups[best].push(t);
  });
  return groups;
}

function linesOf(items) {
  const h = items.map(t => t.h).filter(v => v > 0).sort((a, b) => a - b);
  const tol = Math.max((h.length ? h[Math.floor(h.length / 2)] : 1) * 0.55, 0.4);
  const lines = [];
  items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(t => {
    const line = lines.find(l => Math.abs(l.y - t.y) <= tol);
    if (line) line.items.push(t);
    else lines.push({ y: t.y, items: [t] });
  });
  lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

// Hai số cùng hàng: số ≥ 50 (hoặc số tròn 30–100 khi số kia ≤ 30) là mật độ %; số còn lại là tầng cao.
// Khi không tách được bằng giá trị thì trái = mật độ, phải = tầng cao.
function classifyPair(left, right) {
  const roundish = (n) => n >= 30 && n <= 100 && n % 5 === 0;
  if (right >= 50 && right <= 100 && left <= 40) return { floors: left, coverage: right };
  if (left >= 50 && left <= 100 && right <= 40) return { floors: right, coverage: left };
  if (roundish(right) && left <= 30) return { floors: left, coverage: right };
  if (roundish(left) && right <= 30) return { floors: right, coverage: left };
  return { coverage: left, floors: right };
}

function numText(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

function pickArea(nums) {
  const rich = nums.filter(n => n.decimals >= 2);
  if (rich.length) return rich.slice().sort((a, b) => b.decimals - a.decimals || b.value - a.value)[0];
  const alone = nums.filter(n => nums.filter(m => m.li === n.li).length === 1 && n.value >= 20);
  return alone.sort((a, b) => b.value - a.value)[0] || null;
}

function pairOf(nums) {
  const by = new Map();
  nums.forEach(n => {
    const g = by.get(n.li) || [];
    g.push(n);
    by.set(n.li, g);
  });
  for (const g of by.values()) {
    if (g.length >= 2 && g.every(n => n.decimals === 0 && n.value <= 150)) {
      return g.slice().sort((a, b) => a.x - b.x).slice(0, 2);
    }
  }
  return null;
}

function parseItems(items, x, y) {
  const lines = linesOf(items);
  let code = '';
  let floors = '';
  const nums = [];
  lines.forEach((line, li) => {
    line.items.forEach(t => {
      if (!code && isLotCode(t.text)) { code = t.text.toUpperCase(); return; }
      const range = rangeToken(t.text);
      if (range && !floors) { floors = range; return; }
      const n = numToken(t.text);
      if (n) nums.push({ ...n, li, x: t.x });
    });
  });
  const area = pickArea(nums);
  const rest = nums.filter(n => n !== area);
  const pair = pairOf(rest);
  let coverage = '';
  if (pair) {
    const got = classifyPair(pair[0].value, pair[1].value);
    if (!floors) floors = numText(got.floors);
    coverage = numText(got.coverage);
  }
  const used = new Set(pair || []);
  const farNum = rest.find(n => !used.has(n) && n.decimals >= 1 && n.value > 0 && n.value <= 20);
  const anchor = items.reduce((s, t) => [s[0] + t.x, s[1] + t.y], [0, 0]);
  const stamp = {
    code,
    areaRaw: area ? area.raw : '',
    floors: floors ? String(floors) : '',
    coverage,
    far: farNum ? farNum.raw : '',
    x: Number.isFinite(x) ? x : anchor[0] / items.length,
    y: Number.isFinite(y) ? y : anchor[1] / items.length
  };
  return stamp.code || stamp.areaRaw || stamp.floors || stamp.coverage || stamp.far ? stamp : null;
}

function stampFromBlock(block) {
  const got = {};
  block.attrs.forEach(a => {
    const key = Object.keys(ATTR_TAG).find(k => ATTR_TAG[k].test(String(a.tag || '').replace(/[\s_]+/g, '')));
    if (key && a.text) got[key] = a.text.trim();
  });
  if (!got.code && !got.area && !got.coverage && !got.floors) return null;
  const area = numToken(got.area);
  const floors = rangeToken(got.floors) || (numToken(got.floors) ? numToken(got.floors).raw : String(got.floors || '').trim());
  const coverage = numToken(got.coverage);
  const far = numToken(got.far);
  return {
    code: isLotCode(got.code) ? got.code.toUpperCase() : String(got.code || '').trim().slice(0, 16),
    areaRaw: area ? area.raw : '',
    floors: floors && floors !== '0' ? floors : '',
    coverage: coverage && coverage.value !== 0 ? numText(coverage.value) : '',
    far: far && far.value !== 0 ? far.raw : '',
    x: block.x,
    y: block.y
  };
}

/** DXF lớp ký hiệu → tem { code, areaRaw, floors, coverage, far, x, y } trong hệ tọa độ bản vẽ */
export function parseLandStampDxf(text) {
  const { texts, circles, blocks } = readStampEntities(text);
  const flat = texts.flatMap(explode);
  const stamps = [];
  const used = new Set();
  blocks.forEach(b => {
    const s = stampFromBlock(b);
    if (s) stamps.push(s);
  });
  const groups = [];
  if (circles.length) {
    circles.sort((a, b) => a.r - b.r);
    circles.forEach(c => {
      const inside = [];
      flat.forEach((t, i) => {
        if (used.has(i)) return;
        if (Math.hypot(t.x - c.x, t.y - c.y) <= c.r * 1.15) { inside.push(t); used.add(i); }
      });
      if (inside.length) groups.push({ items: inside, x: c.x, y: c.y });
    });
  }
  const left = flat.filter((_, i) => !used.has(i));
  if (left.length) cluster(left, clusterEps(left)).forEach(items => groups.push({ items, x: NaN, y: NaN }));
  groups.forEach(g => {
    splitByCode(g.items).forEach(items => {
      const s = parseItems(items, g.x, g.y);
      if (s) stamps.push(s);
    });
  });
  return stamps;
}

export function projectStamps(stamps, toLatLng) {
  return (stamps || []).map(s => {
    const [lat, lng] = toLatLng(s.x, s.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { ...s, lat, lng, id: `${s.code || ''}|${lat.toFixed(5)}|${lng.toFixed(5)}` };
  }).filter(Boolean);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function contains(lng, lat, polys) {
  return (polys || []).some(poly => {
    if (!poly || !poly[0] || poly[0].length < 3 || !pointInRing(lng, lat, poly[0])) return false;
    for (let k = 1; k < poly.length; k++) if (pointInRing(lng, lat, poly[k])) return false;
    return true;
  });
}

/**
 * lots: { key, area, rings } — rings là mảng polygon GeoJSON [lng, lat].
 * assign: { stampId: lotKey } do người dùng chọn. skip: tem bỏ qua.
 * Một lô chỉ nhận một tem. Lô có từ 2 tem thì cả nhóm vào pending.
 */
export function matchStamps(stamps, lots, opt = {}) {
  const assign = opt.assign || {};
  const skip = new Set(opt.skip || []);
  const used = new Set();
  const taken = new Set();
  const assigned = [];
  const claim = (stamp, key, how) => {
    if (!stamp || !key || used.has(key) || taken.has(stamp.id) || skip.has(stamp.id)) return false;
    if (!(lots || []).some(l => l.key === key)) return false;
    used.add(key);
    taken.add(stamp.id);
    assigned.push({ stamp, key, how });
    return true;
  };
  (stamps || []).forEach(s => { if (assign[s.id]) claim(s, assign[s.id], 'user'); });
  const hits = (stamps || []).filter(s => !taken.has(s.id) && !skip.has(s.id)).map(s => ({
    stamp: s,
    lots: (lots || []).filter(l => !used.has(l.key) && contains(s.lng, s.lat, l.rings)).sort((a, b) => (a.area || 0) - (b.area || 0))
  }));
  const by = new Map();
  hits.forEach(h => {
    const lot = h.lots[0];
    if (!lot) return;
    const g = by.get(lot.key) || [];
    g.push(h);
    by.set(lot.key, g);
  });
  const pending = [];
  by.forEach((group, key) => {
    if (group.length === 1) claim(group[0].stamp, key, 'auto');
    else group.forEach(h => pending.push(h.stamp));
  });
  hits.forEach(h => {
    if (!h.lots.length && !taken.has(h.stamp.id)) pending.push(h.stamp);
  });
  return { assigned, pending };
}

/** Diện tích ghi trên tem → m². So với diện tích polygon để phân biệt ha (5.230) và m² (5.230 = 5230). */
export function stampAreaM2(raw, lotM2) {
  const s = String(raw || '').trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const dec = (s.split('.')[1] || '').length;
  const cands = [n];
  if (dec >= 3 && n < 500) cands.push(n * 10000);
  if (dec === 3 && n >= 1) cands.push(Number(s.replace(/\./g, '')));
  if (!(lotM2 > 0)) {
    if (dec >= 3 && n < 500) return Math.round(n * 10000);
    if (n >= 20) return Math.round(n);
    return null;
  }
  let best = null;
  let bestR = Infinity;
  cands.forEach(c => {
    if (!(c > 0)) return;
    const r = Math.abs(c - lotM2) / lotM2;
    if (r < bestR) { bestR = r; best = c; }
  });
  if (best != null && bestR <= 0.4) return Math.round(best);
  if (dec >= 3 && n < 500) return Math.round(n * 10000);
  if (n >= 20) return Math.round(n);
  return null;
}

export function stampLabel(s) {
  if (!s) return 'Tem';
  const bits = [s.code || 'Tem'];
  if (s.areaRaw) bits.push(s.areaRaw);
  if (s.floors) bits.push(`${s.floors} tầng`);
  if (s.coverage) bits.push(`mật độ ${s.coverage}%`);
  if (s.far) bits.push(`HSSD ${s.far}`);
  return bits.join(' · ');
}
