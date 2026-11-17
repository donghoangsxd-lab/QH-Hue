// Tem đất trên lớp ký hiệu (file KH, hoặc block ngay trong file sử dụng đất): vòng tròn + chữ, hoặc block.
// Mục tiêu: mọi hatch nhận thuộc tính. Một tem → nhiều hatch chỉ khi cùng một layer, cạnh nhau,
// quanh tem, và tổng DT ≈ tem (lệch ≤ 10%). Tự pair Q3: tem trên hatch + DT; multi cùng layer;
// hoặc gần bao ≤ 50 m + khớp loại + DT.
import { lotCodePatternKey, landPatternKey } from './tt16Symbols.js';

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
  const ent = { layer: '0', x: NaN, y: NaN, r: NaN, h: NaN, text: '', chunks: [], tag: '', sx: NaN, sy: NaN, rot: 0 };
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    const [code, v] = tags[i];
    if (code === 8) ent.layer = v;
    else if (code === 10) ent.x = parseFloat(v);
    else if (code === 20) ent.y = parseFloat(v);
    else if (code === 41) ent.sx = parseFloat(v);
    else if (code === 42) ent.sy = parseFloat(v);
    else if (code === 50) ent.rot = parseFloat(v) || 0;
    else if (code === 40) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) { if (!Number.isFinite(ent.r)) ent.r = n; ent.h = n; }
    } else if (code === 1) ent.text = v;
    else if (code === 3) ent.chunks.push(v);
    else if (code === 2) ent.tag = v;
  }
  return [ent, i];
}

// CX1, TMDV, OD.1, CX-QT (sau khi bỏ khoảng quanh gạch).
const CODE_RE = /^[A-Za-z]{1,8}(?:[.\-][A-Za-z0-9]{1,8}|\d{0,4}[A-Za-z]?)?$/;
const RANGE_RE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;
// Tên tag sau khi bỏ dấu, khoảng trắng, gạch. Bỏ cột cận min/max (gServer ghi 0).
const ATTR_TAG = {
  code: /^(kyhieu|kihieu|kyhieulo|kyhieulodat|kyhieulod|malo|malodat|code|kh)$/,
  area: /^(dientich|dientichm2|dt|area)$/,
  coverage: /^(matdo|matdoxd|matdoxaydung|matdoxaydu|mdxd|md|coverage)$/,
  floors: /^(tangcao|sotang|sotangcao|tang|tc|floors|floor)$/,
  far: /^(heso|hesosdd|hesosudungdat|hesosudung|hssd|hssdd|hs|far)$/
};

function normTag(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')
    .replace(/(quyhoach|hientrang|qh|ht)$/, '');
}

function tagKey(tag) {
  const n = normTag(tag);
  if (!n || /(min|max|canduoi|cantren)$/.test(n)) return '';
  return Object.keys(ATTR_TAG).find(k => ATTR_TAG[k].test(n)) || '';
}

/** "CX - QT" → "CX-QT" để nhận ký hiệu và gom cụm chữ. */
export function normalizeStampText(s) {
  return String(s || '').trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
}

export function isLotCode(s) {
  const t = normalizeStampText(s).replace(/\s+/g, '');
  return !!t && t.length <= 16 && /[A-Za-z]/.test(t) && CODE_RE.test(t);
}

function numToken(s) {
  const raw = String(s || '').trim();
  if (!raw) return null;
  // Kiểu Việt: 4.994,4 / 2.509,6 (chấm nghìn, phẩy thập phân).
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) || /^\d+,\d+$/.test(raw)) {
    const t = raw.replace(/\./g, '').replace(',', '.');
    const value = Number(t);
    if (!Number.isFinite(value)) return null;
    return { raw: t, value, decimals: (t.split('.')[1] || '').length };
  }
  const t = raw.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return { raw: t, value, decimals: (t.split('.')[1] || '').length };
}

function rangeToken(s) {
  const m = String(s || '').trim().match(RANGE_RE);
  return m ? `${Number(m[1])}-${Number(m[2])}` : '';
}

function entityText(ent) {
  return plainDxf(`${(ent.chunks || []).join('')}${ent.text || ''}`);
}

function readAttribs(tags, i) {
  const attrs = [];
  while (i < tags.length && tags[i][0] === 0 && tags[i][1] === 'ATTRIB') {
    const [at, n] = readEntity(tags, i + 1);
    i = n;
    attrs.push({ tag: at.tag, text: entityText(at), x: at.x, y: at.y });
  }
  if (i < tags.length && tags[i][0] === 0 && tags[i][1] === 'SEQEND') i++;
  return [attrs, i];
}

function pushGeom(def, tags, i) {
  let x = NaN;
  for (; i < tags.length && tags[i][0] !== 0; i++) {
    if (tags[i][0] === 10) x = parseFloat(tags[i][1]);
    else if (tags[i][0] === 20 && Number.isFinite(x)) {
      const y = parseFloat(tags[i][1]);
      if (Number.isFinite(y)) def.pts.push([x, y]);
      x = NaN;
    }
  }
  return i;
}

// Điểm local của block → hệ bản vẽ. bx/by là điểm gốc block, sx/sy/rot của lần chèn.
function xform(x, y, tr) {
  let lx = (x - tr.bx) * tr.sx;
  let ly = (y - tr.by) * tr.sy;
  const r = tr.rot * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [tr.x + lx * c - ly * s, tr.y + lx * s + ly * c];
}

/** Bán kính (đơn vị bản vẽ) quanh neo tem. */
const STAMP_NEAR_INSERT_M = 200;
/** Đông/Bắc VN-2000 miền Trung — ATTRIB trong file KH Thủy Thanh đã WCS dù INSERT còn local UCS. */
const VN_E_RANGE = [350000, 900000];
const VN_N_RANGE = [1650000, 1950000];

function looksVn2000(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= VN_E_RANGE[0] && x <= VN_E_RANGE[1]
    && y >= VN_N_RANGE[0] && y <= VN_N_RANGE[1];
}

function nearInsert(x, y, ix, iy, maxD = STAMP_NEAR_INSERT_M) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(ix) && Number.isFinite(iy)
    && Math.hypot(x - ix, y - iy) <= maxD;
}

/**
 * ATTRIB sau INSERT: nếu đã là VN-2000 WCS thì giữ nguyên (không xform theo INSERT local).
 * Gần INSERT hoặc local trong định nghĩa block → xform khi cần.
 */
function worldAttrXY(a, tr) {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  if (looksVn2000(a.x, a.y)) return [a.x, a.y];
  if (looksVn2000(tr.x, tr.y) && nearInsert(a.x, a.y, tr.x, tr.y)) return [a.x, a.y];
  if (nearInsert(a.x, a.y, tr.x, tr.y)) return [a.x, a.y];
  return xform(a.x, a.y, tr);
}

function keepStampPt(x, y, tr) {
  return looksVn2000(x, y) || nearInsert(x, y, tr.x, tr.y);
}

/** Neo tem: ưu tiên INSERT nếu đã VN-2000; không thì tâm ATTRIB/điểm WCS. */
function stampAnchor(insert, attrs, pts) {
  if (looksVn2000(insert[0], insert[1])) return insert;
  const world = [];
  (attrs || []).forEach((a) => {
    if (looksVn2000(a.x, a.y)) world.push([a.x, a.y]);
  });
  (pts || []).forEach((p) => {
    if (p && looksVn2000(p[0], p[1])) world.push(p);
  });
  if (!world.length) return insert;
  return [
    world.reduce((s, p) => s + p[0], 0) / world.length,
    world.reduce((s, p) => s + p[1], 0) / world.length
  ];
}

function expandBlock(defs, name, tr, depth, attribs) {
  const texts = [];
  const attrs = [];
  const pts = [];
  if (Number.isFinite(tr.x) && Number.isFinite(tr.y) && keepStampPt(tr.x, tr.y, tr)) pts.push([tr.x, tr.y]);
  (attribs || []).forEach(a => {
    const xy = worldAttrXY(a, tr);
    const row = { tag: a.tag, text: a.text, x: xy ? xy[0] : a.x, y: xy ? xy[1] : a.y };
    attrs.push(row);
    if (xy && keepStampPt(xy[0], xy[1], tr)) pts.push(xy);
  });
  const def = defs.get(String(name || '').toLowerCase());
  if (!def || depth > 4) return { texts, attrs, pts };
  def.texts.forEach(t => {
    const [x, y] = xform(t.x, t.y, tr);
    texts.push({ text: t.text, x, y, h: (t.h > 0 ? t.h : 2) * Math.max(Math.abs(tr.sx), Math.abs(tr.sy), 1) });
    if (keepStampPt(x, y, tr)) pts.push([x, y]);
  });
  const taken = new Set(attrs.map(a => normTag(a.tag)));
  def.attdefs.forEach(a => {
    const [x, y] = xform(a.x, a.y, tr);
    if (keepStampPt(x, y, tr)) pts.push([x, y]);
    if (taken.has(normTag(a.tag))) return;
    attrs.push({ tag: a.tag, text: a.text, x, y });
  });
  def.inserts.forEach(ch => {
    const child = defs.get(String(ch.name || '').toLowerCase());
    const sub = expandBlock(defs, ch.name, {
      x: ch.x, y: ch.y, bx: child ? child.bx : 0, by: child ? child.by : 0,
      sx: ch.sx, sy: ch.sy, rot: ch.rot
    }, depth + 1, ch.attrs);
    const place = (x, y) => xform(x, y, tr);
    sub.texts.forEach(t => {
      const [x, y] = place(t.x, t.y);
      texts.push({ ...t, x, y });
      if (keepStampPt(x, y, tr)) pts.push([x, y]);
    });
    sub.attrs.forEach(a => {
      if (taken.has(normTag(a.tag))) return;
      const [x, y] = place(a.x, a.y);
      attrs.push({ ...a, x, y });
      taken.add(normTag(a.tag));
      if (keepStampPt(x, y, tr)) pts.push([x, y]);
    });
    sub.pts.forEach(([x, y]) => {
      const [wx, wy] = place(x, y);
      if (keepStampPt(wx, wy, tr)) pts.push([wx, wy]);
    });
  });
  return { texts, attrs, pts };
}

/** Neo bản đồ = stampAnchor; điểm phụ gần neo hoặc đã VN-2000. */
function candidatePoints(anchor, pts) {
  const out = [];
  const push = (p) => {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const ok = looksVn2000(p[0], p[1]) || nearInsert(p[0], p[1], anchor[0], anchor[1]);
    if (!ok) return;
    const eps = Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 180 ? 1e-7 : 0.05;
    if (out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < eps)) return;
    out.push(p);
  };
  push(anchor);
  (pts || []).forEach(push);
  return out.length ? out : (Number.isFinite(anchor[0]) && Number.isFinite(anchor[1]) ? [anchor] : []);
}

/** TEXT / MTEXT / CIRCLE / INSERT trong ENTITIES. Block lồng và chữ trong định nghĩa block được bung ra. */
export function readStampEntities(text) {
  const tags = readTags(text);
  const texts = [];
  const circles = [];
  const blocks = [];
  const defs = new Map();
  let section = null;
  for (let i = 0; i < tags.length;) {
    const [code, v] = tags[i];
    if (code !== 0) { i++; continue; }
    if (v === 'SECTION') { section = tags[i + 1] && tags[i + 1][1]; i += 2; continue; }
    if (v === 'ENDSEC') { section = null; i++; continue; }
    if (section === 'BLOCKS' && v === 'BLOCK') {
      const [head, n] = readEntity(tags, i + 1);
      i = n;
      const def = {
        name: head.tag, bx: Number.isFinite(head.x) ? head.x : 0, by: Number.isFinite(head.y) ? head.y : 0,
        texts: [], attdefs: [], inserts: [], pts: []
      };
      while (i < tags.length && !(tags[i][0] === 0 && tags[i][1] === 'ENDBLK')) {
        if (tags[i][0] !== 0) { i++; continue; }
        const type = tags[i][1];
        if (type === 'TEXT' || type === 'MTEXT') {
          const [ent, n2] = readEntity(tags, i + 1);
          i = n2;
          const body = entityText(ent);
          if (body && Number.isFinite(ent.x) && Number.isFinite(ent.y)) {
            def.texts.push({ text: body, x: ent.x, y: ent.y, h: Number.isFinite(ent.h) ? ent.h : 0 });
            def.pts.push([ent.x, ent.y]);
          }
        } else if (type === 'ATTDEF' || type === 'ATTRIB') {
          const [ent, n2] = readEntity(tags, i + 1);
          i = n2;
          def.attdefs.push({ tag: ent.tag, text: entityText(ent), x: ent.x, y: ent.y });
          if (Number.isFinite(ent.x) && Number.isFinite(ent.y)) def.pts.push([ent.x, ent.y]);
        } else if (type === 'INSERT') {
          const [ent, n2] = readEntity(tags, i + 1);
          const [attrs, n3] = readAttribs(tags, n2);
          i = n3;
          const sx = Number.isFinite(ent.sx) && ent.sx !== 0 ? ent.sx : 1;
          def.inserts.push({
            name: ent.tag, x: ent.x, y: ent.y, sx, sy: Number.isFinite(ent.sy) && ent.sy !== 0 ? ent.sy : sx,
            rot: ent.rot || 0, attrs
          });
        } else i = pushGeom(def, tags, i + 1);
      }
      if (i < tags.length && tags[i][0] === 0 && tags[i][1] === 'ENDBLK') {
        i++;
        for (; i < tags.length && tags[i][0] !== 0; i++);
      }
      if (def.name) defs.set(def.name.toLowerCase(), def);
      continue;
    }
    if (section !== 'ENTITIES') { i++; continue; }
    if (v === 'TEXT' || v === 'MTEXT') {
      const [ent, n] = readEntity(tags, i + 1);
      i = n;
      const body = entityText(ent);
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
      const [attrs, n2] = readAttribs(tags, n);
      i = n2;
      if (!Number.isFinite(ent.x) || !Number.isFinite(ent.y)) continue;
      const sx = Number.isFinite(ent.sx) && ent.sx !== 0 ? ent.sx : 1;
      const def = defs.get(String(ent.tag || '').toLowerCase());
      const blown = expandBlock(defs, ent.tag, {
        x: ent.x, y: ent.y, bx: def ? def.bx : 0, by: def ? def.by : 0,
        sx, sy: Number.isFinite(ent.sy) && ent.sy !== 0 ? ent.sy : sx, rot: ent.rot || 0
      }, 0, attrs);
      const anchor = stampAnchor([ent.x, ent.y], blown.attrs, blown.pts);
      blocks.push({
        x: anchor[0], y: anchor[1], attrs: blown.attrs, texts: blown.texts,
        points: candidatePoints(anchor, blown.pts)
      });
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
// Tem quy hoạch thường trái = tầng cao, phải = mật độ (kể cả mật độ thấp như 5%).
function classifyPair(left, right) {
  const roundish = (n) => n >= 30 && n <= 100 && n % 5 === 0;
  if (right >= 50 && right <= 100 && left <= 40) return { floors: left, coverage: right };
  if (left >= 50 && left <= 100 && right <= 40) return { floors: right, coverage: left };
  if (roundish(right) && left <= 30) return { floors: left, coverage: right };
  if (roundish(left) && right <= 30) return { floors: right, coverage: left };
  return { floors: left, coverage: right };
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
      const text = normalizeStampText(t.text);
      if (!code && isLotCode(text)) {
        code = text.replace(/\s+/g, '').toUpperCase();
        return;
      }
      const range = rangeToken(text);
      if (range && !floors) { floors = range; return; }
      const n = numToken(text);
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
    const key = tagKey(a.tag);
    if (key && a.text) got[key] = normalizeStampText(a.text);
  });
  if (!got.code && !got.area && !got.coverage && !got.floors && !got.far) return null;
  const area = numToken(got.area);
  const floors = rangeToken(got.floors) || (numToken(got.floors) ? numToken(got.floors).raw : String(got.floors || '').trim());
  const coverage = numToken(got.coverage);
  const far = numToken(got.far);
  const codeNorm = normalizeStampText(got.code).replace(/\s+/g, '');
  return {
    code: isLotCode(codeNorm) ? codeNorm.toUpperCase() : codeNorm.slice(0, 16),
    areaRaw: area ? area.raw : '',
    floors: floors && floors !== '0' ? floors : '',
    coverage: coverage && coverage.value !== 0 ? numText(coverage.value) : '',
    far: far && far.value !== 0 ? far.raw : '',
    x: block.x,
    y: block.y,
    points: block.points
  };
}

function fillStamp(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  const out = { ...base, points: base.points || extra.points };
  ['code', 'areaRaw', 'floors', 'coverage', 'far'].forEach(k => { if (!out[k] && extra[k]) out[k] = extra[k]; });
  return out.code || out.areaRaw || out.floors || out.coverage || out.far ? out : null;
}

/** ATTRIB không đặt tên tag (cùng tag "1") → đọc theo vị trí chữ trong tem như TEXT. */
function attrTextItems(block) {
  return (block.attrs || []).map(a => {
    const text = normalizeStampText(a.text);
    if (!text || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    return { text, x: a.x, y: a.y, h: 2 };
  }).filter(Boolean);
}

/** DXF lớp ký hiệu → tem { code, areaRaw, floors, coverage, far, x, y } trong hệ tọa độ bản vẽ */
export function parseLandStampDxf(text) {
  const { texts, circles, blocks } = readStampEntities(text);
  const flat = texts.flatMap(explode);
  const stamps = [];
  const used = new Set();
  blocks.forEach(b => {
    const fromAttr = stampFromBlock(b);
    const textSrc = [...(b.texts || []), ...attrTextItems(b)];
    const fromText = textSrc.length ? parseItems(textSrc.flatMap(explode), NaN, NaN) : null;
    const s = fillStamp(fromAttr, fromText);
    if (!s) return;
    s.points = b.points;
    s.x = b.x;
    s.y = b.y;
    stamps.push(s);
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
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
    // Luôn neo INSERT trước; điểm phụ chỉ khi gần INSERT (lọc gốc block / ATTRIB local).
    const raw = candidatePoints([s.x, s.y], s.points || []);
    const cands = [];
    raw.forEach(([x, y]) => {
      const [lat, lng] = toLatLng(x, y);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (cands.some(p => Math.abs(p.lat - lat) < 1e-7 && Math.abs(p.lng - lng) < 1e-7)) return;
      cands.push({ lat, lng });
    });
    if (!cands.length) return null;
    return { ...s, lat: cands[0].lat, lng: cands[0].lng, cands, id: `${s.code || ''}|${cands[0].lat.toFixed(5)}|${cands[0].lng.toFixed(5)}` };
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

function ringHit(lng, lat, poly) {
  if (!poly || !poly[0] || poly[0].length < 3 || !pointInRing(lng, lat, poly[0])) return '';
  for (let k = 1; k < poly.length; k++) if (pointInRing(lng, lat, poly[k])) return 'hole';
  return 'in';
}

function lotHit(lng, lat, polys) {
  let hole = false;
  for (const poly of polys || []) {
    const hit = ringHit(lng, lat, poly);
    if (hit === 'in') return 'in';
    if (hit === 'hole') hole = true;
  }
  return hole ? 'hole' : '';
}

function candPoints(stamp) {
  return (stamp.cands && stamp.cands.length) ? stamp.cands : [{ lng: stamp.lng, lat: stamp.lat }];
}

function bestHit(stamp, lot) {
  let hole = false;
  for (const p of candPoints(stamp)) {
    const hit = lotHit(p.lng, p.lat, lot.rings);
    if (hit === 'in') return 'in';
    if (hit === 'hole') hole = true;
  }
  return hole ? 'hole' : '';
}

/** Cạnh gần (legacy / score); tự pair gần bao dùng STAMP_NEAR_AUTO_M. */
const STAMP_TOL_M = 12;
/** Tâm tem cách đường bao hatch ≤ (m) + khớp loại + DT → tự pair. */
export const STAMP_NEAR_AUTO_M = 50;

function meters(lng1, lat1, lng2, lat2) {
  const k = 111320;
  const cos = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot((lng2 - lng1) * k * cos, (lat2 - lat1) * k);
}

function distToLot(lng, lat, polys) {
  let best = Infinity;
  for (const poly of polys || []) {
    for (const ring of poly || []) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0];
        const ay = ring[j][1];
        const bx = ring[i][0];
        const by = ring[i][1];
        const abx = (bx - ax) * Math.cos(lat * Math.PI / 180);
        const aby = by - ay;
        const L = abx * abx + aby * aby;
        const t = L ? Math.max(0, Math.min(1, (((lng - ax) * Math.cos(lat * Math.PI / 180)) * abx + (lat - ay) * aby) / L)) : 0;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        best = Math.min(best, meters(lng, lat, px, py));
      }
    }
  }
  return best;
}

function minDistToLot(stamp, lot) {
  let best = Infinity;
  candPoints(stamp).forEach(p => {
    best = Math.min(best, distToLot(p.lng, p.lat, lot.rings));
  });
  return best;
}

function sameField(a, b) {
  return String(a || '') === String(b || '');
}

function mergeGroup(group) {
  const out = { code: '', areaRaw: '', floors: '', coverage: '', far: '', members: [] };
  for (const h of group) {
    const s = h.stamp;
    out.members.push(s.id);
    for (const k of ['code', 'areaRaw', 'floors', 'coverage', 'far']) {
      if (!s[k]) continue;
      if (!out[k]) out[k] = s[k];
      else if (!sameField(out[k], s[k])) return null;
    }
  }
  const first = group[0].stamp;
  out.lat = first.lat;
  out.lng = first.lng;
  out.cands = first.cands;
  out.id = out.members.join('+');
  return out;
}

/** Sai số diện tích khi gán tay / cảnh báo UI (1%). */
export const STAMP_AREA_TOL = 0.01;
/** Sai số diện tích tự pair / gộp hatch cạnh (10%). */
export const STAMP_AUTO_AREA_TOL = 0.10;

const TYPE_FAMILY = {
  '1-CV': 'green', 'CX-HC': 'green', 'CX-CD': 'green',
  '2-BDX': 'parking',
  '9-TM': 'commerce', 'CC-DV': 'commerce',
  'O-NO': 'housing', 'O-LX': 'housing', 'O-HH': 'housing',
  '3-MN': 'school', '4-TH': 'school', '5-THCS': 'school', '6-THPT': 'school', SCHOOL: 'school',
  '7-YT': 'health', '8-VH': 'culture', TDTT: 'culture',
  'CQ': 'office', 'DT-TG': 'worship', 'NTR': 'cemetery', 'DCS': 'vacant'
};

function foldCompact(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// Tiền tố ký hiệu tem → gợi ý chữ trong tên layer khi landPatternKey chưa đủ (vd. layer "CAY 1").
const PREFIX_LAYER_RE = [
  [/^CX|^CV/, /CAY|CX|CONGVIEN|VUONHOA|GREEN|PARK|DIEMXANH/],
  [/^P\d|^P$|^BDX|^BX/, /BAI|DOXE|PARKING|BDX|\bBX\b/],
  [/^TM|^TMDV|^DVTM|^DV|^TTTM/, /THUONGMAI|DICHVU|TMDV|DVTM|CONGCONG|TTTM|SIEUTHI|\bCHO\b/],
  [/^MN/, /MAMNON|MAUGIAO|NHATRE|\bMN\b/],
  [/^THCS/, /THCS|TRUNGHOCCOSO/],
  [/^THPT/, /THPT|TRUNGHOCPHOTHONG/],
  [/^TH/, /TIEUHOC|\bTH\b/],
  [/^YT/, /YTE|BENHVIEN|TRAMY/],
  [/^VH|^TDTT/, /VANHOA|THETHAO|TDTT/],
  [/^O|^NO|^OB|^OL|^OH/, /NHAO|DATO|ODT|ONT|LANGXOM|CHUNGCU/]
];

function stampTypeKey(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  return lotCodePatternKey(c) || landPatternKey(c) || '';
}

function lotTypeKey(lot) {
  if (lot && lot.typeKey) return lot.typeKey;
  return landPatternKey(lot && lot.layer, (lot && (lot.name || lot.lotCode)) || '') || '';
}

/** Ký hiệu tem có cùng nhóm loại đất với layer / typeKey của hatch. */
export function stampNameMatch(stamp, lot) {
  const code = String(stamp && stamp.code || '').trim();
  if (!code || !lot) return false;
  const a = stampTypeKey(code);
  const b = lotTypeKey(lot);
  if (a && b) {
    if (a === b) return true;
    if (TYPE_FAMILY[a] && TYPE_FAMILY[a] === TYPE_FAMILY[b]) return true;
  }
  const layer = foldCompact(lot.layer || '') + foldCompact(lot.name || '');
  if (!layer) return false;
  const head = foldCompact(code);
  for (const [pre, re] of PREFIX_LAYER_RE) {
    if (pre.test(head) && re.test(layer)) return true;
  }
  const pref = (head.match(/^[A-Z]+/) || [''])[0];
  return !!(pref && pref.length >= 2 && layer.includes(pref));
}

export function stampAreaMatch(stamp, lot, tol = STAMP_AREA_TOL) {
  if (!stamp || !lot || !(lot.area > 0)) return false;
  const m2 = stampAreaM2(stamp.areaRaw, lot.area);
  if (!(m2 > 0)) return false;
  return Math.abs(m2 - lot.area) / lot.area <= tol;
}

/** Bbox lô (cache trên object lot). */
function lotBboxOf(lot) {
  if (!lot) return null;
  if (lot._bbox) return lot._bbox;
  lot._bbox = lotLngLatBbox(lot);
  return lot._bbox;
}

/** Tem có nằm trong (hoặc sát) bbox lô không — pad theo mét. */
function stampInLotBbox(stamp, lot, padM = 30) {
  const b = lotBboxOf(lot);
  if (!b || !stamp || !Number.isFinite(stamp.lng) || !Number.isFinite(stamp.lat)) return false;
  const midLat = (b[1] + b[3]) / 2;
  const k = 111320;
  const cos = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const dLng = padM / (k * cos);
  const dLat = padM / k;
  return stamp.lng >= b[0] - dLng && stamp.lng <= b[2] + dLng
    && stamp.lat >= b[1] - dLat && stamp.lat <= b[3] + dLat;
}

/** Khoảng cách tâm lô ↔ tem (m); cache tâm trên lot. */
function centroidDistM(stamp, lot) {
  if (!stamp || !lot || !Number.isFinite(stamp.lng) || !Number.isFinite(stamp.lat)) return Infinity;
  if (lot._cx == null) {
    const c = lotCentroidLngLat(lot);
    lot._cx = c ? c[0] : NaN;
    lot._cy = c ? c[1] : NaN;
  }
  if (!Number.isFinite(lot._cx)) return Infinity;
  return meters(stamp.lng, stamp.lat, lot._cx, lot._cy);
}

function scoreLot(stamp, lot, tol, areaTol) {
  // Tên / DT rẻ; PIP + khoảng cách cạnh chỉ khi tem gần bbox (tránh 370×500×đỉnh → treo).
  const name = stampNameMatch(stamp, lot);
  const area = stampAreaMatch(stamp, lot, areaTol);
  let hit = '';
  let near = false;
  let pos = false;
  const pad = Math.max(tol * 3, 60);
  if (stampInLotBbox(stamp, lot, pad)) {
    hit = bestHit(stamp, lot);
    if (hit === 'in' || hit === 'hole') pos = true;
    else near = minDistToLot(stamp, lot) <= tol;
    pos = pos || near;
  }
  const n = (pos ? 1 : 0) + (name ? 1 : 0) + (area ? 1 : 0);
  const parts = [];
  if (hit === 'in') parts.push('pos');
  else if (hit === 'hole') parts.push('hole');
  else if (near) parts.push('near');
  if (name) parts.push('name');
  if (area) parts.push('area');
  return { lot, pos, name, area, n, hit, near, how: parts.join('+') };
}

/** Trọng số khoảng cách trong điểm Q3: score = |ΔDT| + ε·dist(m). */
export const Q3_DIST_WEIGHT = 0.01;
/** Hatch «quanh tem» khi gộp multi (m, bbox/tâm). */
export const STAMP_MULTI_AROUND_M = 150;

function layerKeyOf(lot) {
  return foldCompact(lot && lot.layer || '');
}

/** Cùng một layer hatch (ràng buộc chặt multi — không gom họ loại lỏng). */
export function lotsSameLayer(a, b) {
  const ka = layerKeyOf(a);
  const kb = layerKeyOf(b);
  return !!(ka && kb && ka === kb);
}

/** Tem nằm trên hatch? PIP chỉ khi gần bbox. */
function stampOnLotHit(stamp, lot, padM = 60) {
  if (!stampInLotBbox(stamp, lot, padM)) return '';
  const hit = bestHit(stamp, lot);
  return (hit === 'in' || hit === 'hole') ? hit : '';
}

function areaDiffM2(stamp, lot) {
  if (!lot || !(lot.area > 0)) return Infinity;
  const stampM2 = stampAreaM2(stamp && stamp.areaRaw, lot.area);
  if (!(stampM2 > 0)) return Infinity;
  return Math.abs(lot.area - stampM2);
}

/** Điểm Q3: lệch diện tích (m²) + 0.01 × khoảng cách tâm. */
export function q3PairScore(stamp, lot) {
  return areaDiffM2(stamp, lot) + Q3_DIST_WEIGHT * centroidDistM(stamp, lot);
}

/** Hatch quanh vị trí tem (bbox pad hoặc tâm ≤ aroundM). */
function lotAroundStamp(stamp, lot, aroundM) {
  if (!stamp || !lot) return false;
  if (stampInLotBbox(stamp, lot, aroundM)) return true;
  return centroidDistM(stamp, lot) <= aroundM;
}

/**
 * Một tem → nhiều hatch (chặt):
 * (1) cùng một layer với seed, (2) biên cạnh nhau (gap ≤ gapM),
 * (3) mọi hatch quanh vị trí tem, (4) tổng DT ≈ tem (± areaTol).
 * Không có DT trên tem → chỉ seed. Không đạt → [].
 */
function growKeysFromSeed(stamp, seed, openLots, areaTol, gapM = 15, aroundM = STAMP_MULTI_AROUND_M) {
  if (!stamp || !seed) return [];
  const seedKey = String(seed.key);
  const layer = layerKeyOf(seed);
  if (!layer) {
    const stampM2 = stampAreaM2(stamp.areaRaw, seed.area);
    if (!(stampM2 > 0)) return [seedKey];
    return stampAreaVsLots(stamp, [seed], [seedKey], areaTol).ok ? [seedKey] : [];
  }
  const same = (openLots || []).filter(l => {
    if (String(l.key) === seedKey) return true;
    if (!lotsSameLayer(seed, l)) return false;
    return lotAroundStamp(stamp, l, aroundM);
  });
  const comp = [];
  const q = [seed];
  const vis = new Set([seedKey]);
  while (q.length) {
    const u = q.shift();
    comp.push(u);
    same.forEach(v => {
      const vk = String(v.key);
      if (vis.has(vk) || !lotBboxOf(u) || !lotBboxOf(v)) return;
      if (bboxGapM(lotBboxOf(u), lotBboxOf(v)) > gapM) return;
      vis.add(vk);
      q.push(v);
    });
  }
  const stampM2 = stampAreaM2(stamp.areaRaw, seed.area);
  if (!(stampM2 > 0)) return [seedKey];
  const solo = stampAreaVsLots(stamp, [seed], [seedKey], areaTol);
  if (solo.ok) return [seedKey];

  const others = comp
    .filter(l => String(l.key) !== seedKey)
    .sort((a, b) => q3PairScore(stamp, a) - q3PairScore(stamp, b));
  const pool = [seed, ...others];
  const n = pool.length;
  if (n <= 12) {
    let best = null;
    const total = 1 << n;
    for (let mask = 1; mask < total; mask++) {
      if (!(mask & 1)) continue;
      const keys = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) keys.push(String(pool[i].key));
      const cmp = stampAreaVsLots(stamp, pool, keys, areaTol);
      if (!cmp.ok) continue;
      if (!best
        || keys.length < best.keys.length
        || (keys.length === best.keys.length && cmp.ratio < best.ratio)) {
        best = { keys, ratio: cmp.ratio };
      }
    }
    return best ? best.keys : [];
  }
  const keys = [seedKey];
  for (const lot of others) {
    keys.push(String(lot.key));
    const cmp = stampAreaVsLots(stamp, pool, keys, areaTol);
    if (cmp.ok) return keys.slice();
    if (cmp.stampM2 > 0 && cmp.lotM2 > cmp.stampM2 * (1 + areaTol)) keys.pop();
  }
  return [];
}

/**
 * Chọn 1+ hatch cho một tem (dùng giải thích / gợi ý).
 * Q3: trên hatch + DT → score ΔDT+dist; multi cùng layer cạnh quanh tem; rồi gần 50 m.
 * @returns {{ keys: string[], how: string, lot: object|null }}
 */
function preferAssign(stamp, openLots, nearM, areaTol) {
  if (!stamp || !(openLots || []).length) return { keys: [], how: '', lot: null };
  const scored = openLots.map(l => scoreLot(stamp, l, nearM, areaTol));
  const onHits = scored.filter(s => s.hit === 'in' || s.hit === 'hole');

  // (1) Q3 solo: tem trên hatch + DT ±10% — chọn score nhỏ nhất.
  const onArea = onHits
    .filter(s => stampAreaMatch(stamp, s.lot, areaTol))
    .sort((a, b) => q3PairScore(stamp, a.lot) - q3PairScore(stamp, b.lot));
  if (onArea.length) {
    const best = onArea[0];
    const parts = [best.hit === 'hole' ? 'hole' : 'pos', 'area'];
    if (best.name) parts.push('name');
    return { keys: [String(best.lot.key)], how: parts.join('+'), lot: best.lot };
  }

  // (2) Multi: seed = hatch chứa tem, gộp cạnh cùng layer quanh tem đến ± DT.
  if (onHits.length) {
    const seeds = onHits
      .slice()
      .sort((a, b) => {
        const la = layerKeyOf(a.lot) ? 0 : 1;
        const lb = layerKeyOf(b.lot) ? 0 : 1;
        if (la !== lb) return la - lb;
        return q3PairScore(stamp, a.lot) - q3PairScore(stamp, b.lot);
      });
    for (const s of seeds) {
      const seed = s.lot;
      const stampM2 = stampAreaM2(stamp.areaRaw, seed.area);
      if (!(stampM2 > 0)) continue;
      const keys = growKeysFromSeed(stamp, seed, openLots, areaTol);
      if (keys.length < 2) continue;
      const cmp = stampAreaVsLots(stamp, openLots, keys, areaTol);
      if (!cmp.ok) continue;
      return {
        keys,
        how: (s.hit === 'hole' ? 'hole' : 'pos') + '+area+multi',
        lot: seed
      };
    }
    // (2b) Tem trên hatch + khớp loại, không có DT trên tem → một hatch.
    const onNamed = onHits
      .filter(s => s.name && !(stampAreaM2(stamp.areaRaw, s.lot.area) > 0))
      .sort((a, b) => centroidDistM(stamp, a.lot) - centroidDistM(stamp, b.lot));
    if (onNamed.length) {
      const best = onNamed[0];
      return {
        keys: [String(best.lot.key)],
        how: (best.hit === 'hole' ? 'hole' : 'pos') + '+name',
        lot: best.lot
      };
    }
    return { keys: [], how: '', lot: null };
  }

  // (3) ≤ 50 m tới bao + khớp loại + DT → một hatch.
  const nearTrio = scored
    .filter(s => s.near && s.name && s.area && s.hit !== 'in' && s.hit !== 'hole')
    .sort((a, b) => {
      const da = minDistToLot(stamp, a.lot);
      const db = minDistToLot(stamp, b.lot);
      return da - db || q3PairScore(stamp, a.lot) - q3PairScore(stamp, b.lot);
    });
  if (nearTrio.length === 1) {
    return { keys: [String(nearTrio[0].lot.key)], how: 'near+name+area', lot: nearTrio[0].lot };
  }
  if (nearTrio.length > 1) {
    const best = nearTrio[0];
    const second = nearTrio[1];
    const d0 = minDistToLot(stamp, best.lot);
    const d1 = minDistToLot(stamp, second.lot);
    if (d0 + 1 < d1 || q3PairScore(stamp, best.lot) + 1 < q3PairScore(stamp, second.lot)) {
      return { keys: [String(best.lot.key)], how: 'near+name+area', lot: best.lot };
    }
    return { keys: [], how: '', lot: null };
  }
  return { keys: [], how: '', lot: null };
}

/** Chuẩn hóa gán tay: một khóa hoặc mảng khóa lô. */
export function assignKeysOf(val) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return [String(val)];
}

/** Lô thiếu toàn bộ thuộc tính tem (ký hiệu lô, tầng, mật độ, HSSD) — không tính tên layer hatch.
 * Nhận props phẳng (GeoJSON / form nhập) hoặc lô đã chuẩn hóa (`plan.floors|coverage|far`). */
export function lotMissingStampAttrs(props) {
  const p = props || {};
  const plan = p.plan && typeof p.plan === 'object' ? p.plan : {};
  const code = String(p.lotCode || p.kyHieu || p.KyHieu || '').trim();
  const floors = String(p.TangCao || p.floors || plan.floors || '').trim();
  const cov = String(p.MatDoXD || p.coverage || plan.coverage || '').trim();
  const far = String(p.HeSoSDD || p.far || plan.far || '').trim();
  return !code && !floors && !cov && !far;
}

/** Hai lô cùng nhóm loại đất (để gán một tem cho nhiều lô). */
export function lotsSameLandType(a, b) {
  if (!a || !b) return false;
  const ka = lotTypeKey(a);
  const kb = lotTypeKey(b);
  if (ka && kb) {
    if (ka === kb) return true;
    if (TYPE_FAMILY[ka] && TYPE_FAMILY[ka] === TYPE_FAMILY[kb]) return true;
  }
  const la = foldCompact(a.layer || '');
  const lb = foldCompact(b.layer || '');
  return !!(la && lb && la === lb);
}

/**
 * So diện tích tem với tổng diện tích các lô (m²).
 * @returns {{ stampM2: number|null, lotM2: number, ratio: number|null, ok: boolean }}
 */
export function stampAreaVsLots(stamp, lots, keys, tol = STAMP_AREA_TOL) {
  const list = (lots || []).filter(l => keys.includes(String(l.key)));
  const lotM2 = list.reduce((s, l) => s + (Number(l.area) || 0), 0);
  const stampM2 = stampAreaM2(stamp && stamp.areaRaw, lotM2);
  if (!(stampM2 > 0) || !(lotM2 > 0)) {
    return { stampM2: stampM2 || null, lotM2, ratio: null, ok: false };
  }
  const ratio = Math.abs(stampM2 - lotM2) / stampM2;
  return { stampM2, lotM2, ratio, ok: ratio <= tol };
}

/** Tem → hatch gợi ý: bán kính tìm lô gần (m). */
export const STAMP_HINT_NEAR_M = 150;
/** Hai hatch coi là cạnh nhau nếu khe bbox ≤ (m). */
export const STAMP_HINT_GAP_M = 15;

function lotLngLatBbox(lot) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of lot.rings || []) {
    for (const ring of poly || []) {
      for (const pt of ring || []) {
        if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
        if (pt[0] < minLng) minLng = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[0] > maxLng) maxLng = pt[0];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function bboxGapM(a, b) {
  if (!a || !b) return Infinity;
  const midLat = ((a[1] + a[3]) + (b[1] + b[3])) / 4;
  const k = 111320;
  const cos = Math.cos(midLat * Math.PI / 180);
  const gapX = Math.max(0, Math.max(b[0] - a[2], a[0] - b[2])) * k * cos;
  const gapY = Math.max(0, Math.max(b[1] - a[3], a[1] - b[3])) * k;
  return Math.hypot(gapX, gapY);
}

/** Tâm gần đúng của hatch (trung bình đỉnh vòng ngoài) → [lng, lat]. */
export function lotCentroidLngLat(lot) {
  const ring = lot?.rings?.[0]?.[0];
  if (!ring || ring.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  ring.forEach(pt => {
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
    sx += pt[0];
    sy += pt[1];
    n += 1;
  });
  if (!n) return null;
  return [sx / n, sy / n];
}

function pickKeysMatchingArea(stamp, pool, tol) {
  if (!pool.length) return [];
  const n = pool.length;
  if (n <= 10) {
    let best = null;
    for (let mask = 1; mask < (1 << n); mask++) {
      const keys = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) keys.push(String(pool[i].key));
      const cmp = stampAreaVsLots(stamp, pool, keys, tol);
      if (!cmp.ok) continue;
      if (!best
        || keys.length < best.keys.length
        || (keys.length === best.keys.length && cmp.ratio < best.ratio)) {
        best = { keys, ratio: cmp.ratio };
      }
    }
    return best ? best.keys : [];
  }
  const keys = [];
  for (const lot of pool) {
    keys.push(String(lot.key));
    const cmp = stampAreaVsLots(stamp, pool, keys, tol);
    if (cmp.ok) return keys.slice();
    if (cmp.stampM2 > 0 && cmp.lotM2 > cmp.stampM2 * (1 + tol)) keys.pop();
  }
  return [];
}

/**
 * Gợi ý ghép tem → 1+ hatch chưa gán.
 * Luật cứng: tem đang nằm trên hatch nào thì chỉ gợi ý hatch đó (và hatch cạnh
 * cùng loại nếu cần gộp DT) — tuyệt đối không nhảy sang lô cách hàng trăm mét.
 * @returns {string[]} khóa lô
 */
export function suggestStampLotKeys(stamp, lots, opt = {}) {
  const areaTol = Number.isFinite(opt.areaTol) ? opt.areaTol : STAMP_AUTO_AREA_TOL;
  const nearM = Number.isFinite(opt.nearM) ? opt.nearM : STAMP_HINT_NEAR_M;
  const gapM = Number.isFinite(opt.gapM) ? opt.gapM : STAMP_HINT_GAP_M;
  if (!stamp || !(lots || []).length) return [];

  const enriched = (lots || []).map(l => {
    const bbox = lotBboxOf(l);
    let on = false;
    // PIP chỉ khi tem gần bbox — tránh quét đỉnh mọi hatch.
    if (stampInLotBbox(stamp, l, 30)) {
      const hit = bestHit(stamp, l);
      on = hit === 'in' || hit === 'hole';
    }
    return {
      ...l,
      _bbox: bbox,
      _dist: centroidDistM(stamp, l),
      _named: stampNameMatch(stamp, l),
      _on: on
    };
  });

  const growFrom = (seed, pool) => {
    const keys = growKeysFromSeed(stamp, seed, pool, areaTol, gapM);
    if (keys.length) return keys;
    const soft = [String(seed.key)];
    pool
      .filter(v => String(v.key) !== String(seed.key)
        && lotsSameLayer(seed, v)
        && lotAroundStamp(stamp, v, STAMP_MULTI_AROUND_M)
        && seed._bbox && v._bbox && bboxGapM(seed._bbox, v._bbox) <= gapM)
      .sort((a, b) => a._dist - b._dist)
      .slice(0, 5)
      .forEach(v => soft.push(String(v.key)));
    return soft;
  };

  // (1) Tem nằm trên hatch → ưu tiên DT tương đương, rồi cùng loại; không nhảy lô xa.
  const onLots = enriched
    .filter(l => l._on)
    .sort((a, b) => {
      const ca = stampAreaVsLots(stamp, [a], [String(a.key)], areaTol);
      const cb = stampAreaVsLots(stamp, [b], [String(b.key)], areaTol);
      const oa = ca.ok ? 0 : 1;
      const ob = cb.ok ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const na = a._named ? 0 : 1;
      const nb = b._named ? 0 : 1;
      if (na !== nb) return na - nb;
      const ra = ca.ratio == null ? 99 : ca.ratio;
      const rb = cb.ratio == null ? 99 : cb.ratio;
      return ra - rb || (a.area || 0) - (b.area || 0);
    });
  if (onLots.length) {
    const seed = onLots[0];
    // Solo DT đã khớp → chỉ gợi ý đúng lô chứa tem.
    if (stampAreaMatch(stamp, seed, areaTol)) return [String(seed.key)];
    // Multi chặt: cùng layer seed, quanh tem (growKeysFromSeed tự lọc layer + cạnh).
    const pool = enriched.filter(l =>
      String(l.key) === String(seed.key)
      || (lotsSameLayer(seed, l) && lotAroundStamp(stamp, l, STAMP_MULTI_AROUND_M)));
    return growFrom(seed, pool);
  }

  // (2) Không nằm trên hatch nào: chỉ lô gần (bbox/tâm ≤ nearM), ưu tiên cùng loại.
  const nearOk = (l) => l._dist <= nearM || stampInLotBbox(stamp, l, nearM);
  let pool = enriched.filter(l => l._named && nearOk(l));
  if (!pool.length) pool = enriched.filter(nearOk);
  if (!pool.length) return [];

  const seeds = pool.slice().sort((a, b) => a._dist - b._dist);
  const seen = new Set();
  for (const seed of seeds) {
    if (seen.has(String(seed.key))) continue;
    const comp = [];
    const q = [seed];
    const vis = new Set([String(seed.key)]);
    while (q.length) {
      const u = q.shift();
      comp.push(u);
      pool.forEach(v => {
        const vk = String(v.key);
        if (vis.has(vk) || !u._bbox || !v._bbox) return;
        if (bboxGapM(u._bbox, v._bbox) > gapM) return;
        if (seed._named && !v._named) return;
        vis.add(vk);
        q.push(v);
      });
    }
    comp.forEach(l => seen.add(String(l.key)));
    const keys = pickKeysMatchingArea(stamp, comp.sort((a, b) => a._dist - b._dist), areaTol);
    if (keys.length) return keys;
  }
  return growFrom(seeds[0], pool);
}

/**
 * Gợi ý cho từng tem pending; mỗi lô chỉ thuộc một gợi ý.
 * @returns {Record<string, string[]>} stampId → keys
 */
export function suggestPendingStampHints(pending, freeLots, opt = {}) {
  const hints = {};
  const claimed = new Set();
  (pending || []).forEach(stamp => {
    if (!stamp?.id) return;
    const avail = (freeLots || []).filter(l => !claimed.has(String(l.key)));
    const keys = suggestStampLotKeys(stamp, avail, opt);
    if (!keys.length) return;
    hints[stamp.id] = keys;
    keys.forEach(k => claimed.add(String(k)));
  });
  return hints;
}

/** Giải thích vì sao tem không tự khớp (Q3 trên-hatch+DT / multi cùng layer / gần 50m). */
export function stampPendingWhy(stamp, lots, opt = {}) {
  const nearM = Number.isFinite(opt.tolM) ? opt.tolM : STAMP_NEAR_AUTO_M;
  const areaTol = Number.isFinite(opt.areaTol) ? opt.areaTol : STAMP_AUTO_AREA_TOL;
  if (!stamp) return 'Không có tem.';
  if (!(lots || []).length) return 'Chưa có lô đất để ghép.';
  const pref = preferAssign(stamp, lots, nearM, areaTol);
  if (pref.keys.length) {
    return `Có thể ghép ${pref.keys.length} hatch (${pref.how}) — chạy lại match hoặc gán tay.`;
  }
  const near = (lots || []).filter(l => stampInLotBbox(stamp, l, 120) || stampNameMatch(stamp, l));
  const pool = near.length ? near : lots;
  const scored = pool.map(l => scoreLot(stamp, l, nearM, areaTol)).sort((a, b) => b.n - a.n);
  const best = scored[0];
  if (!best || best.n === 0) {
    return 'Không có hatch chứa tem hoặc gần tem (≤ 50 m) để gán thuộc tính.';
  }
  if ((best.hit === 'in' || best.hit === 'hole') && !best.area) {
    return 'Tem đang nằm trên hatch nhưng diện tích lệch > 10% và chưa gộp được hatch cùng layer cạnh quanh tem — chọn thêm/bớt lô tay.';
  }
  if (best.near && best.name && !best.area) {
    return 'Tem gần hatch cùng loại nhưng diện tích lệch > 10% — gán tay hoặc chọn thêm hatch cạnh.';
  }
  if (best.name && best.area && !best.pos) {
    return 'Khớp ký hiệu + diện tích nhưng tem cách bao hatch > 50 m — kéo gần hoặc gán tay.';
  }
  if (best.n === 1) {
    const only = best.pos ? 'chỉ vị trí' : best.name ? 'chỉ ký hiệu' : 'chỉ diện tích';
    return `Chưa đủ điều kiện tự pair (${only}). Cần gán thủ công.`;
  }
  const ties = scored.filter(s => s.n === best.n && s.n >= 2);
  if (ties.length > 1) {
    return `Có ${ties.length} hatch cùng mức khớp — chọn tay trên bản đồ (một tem có thể gán nhiều hatch).`;
  }
  return 'Không tự ghép được. Cần gán thủ công (một tem → một hoặc nhiều hatch).';
}

/**
 * lots: { key, area, rings, layer?, name?, lotCode?, typeKey? }.
 * assign / skip: gán tay (assign[id] = key | key[]).
 * Ghép: (1) greedy Q3 tem-trên-hatch + DT, (2) multi cùng layer cạnh quanh tem,
 * (3) gần bao ≤ 50 m + tên + DT.
 */
export function matchStamps(stamps, lots, opt = {}) {
  const assign = opt.assign || {};
  const skip = new Set(opt.skip || []);
  const nearM = Number.isFinite(opt.tolM) ? opt.tolM : STAMP_NEAR_AUTO_M;
  const areaTol = Number.isFinite(opt.areaTol) ? opt.areaTol : STAMP_AUTO_AREA_TOL;
  const used = new Set();
  const taken = new Set();
  const assigned = [];
  const pending = [];
  const claim = (stamp, keysIn, how) => {
    const keys = assignKeysOf(keysIn);
    if (!stamp || !keys.length || skip.has(stamp.id)) return false;
    if (keys.some(k => used.has(String(k)))) return false;
    const ids = stamp.members || [stamp.id];
    if (ids.some(id => taken.has(id) || skip.has(id))) return false;
    if (!keys.every(k => (lots || []).some(l => String(l.key) === String(k)))) return false;
    keys.forEach(k => used.add(String(k)));
    ids.forEach(id => taken.add(id));
    assigned.push({ stamp, key: keys[0], keys, how });
    return true;
  };
  (stamps || []).forEach(s => {
    const a = assign[s.id];
    if (a != null && a !== '' && !(Array.isArray(a) && !a.length)) claim(s, a, 'user');
  });

  const free = () => (lots || []).filter(l => !used.has(String(l.key)));
  const openStamps = () => (stamps || []).filter(s => !taken.has(s.id) && !skip.has(s.id));
  const pad = Math.max(nearM * 3, 60);

  // —— Pass 1 (Q3): ứng viên tem ∈ hatch + DT ±tol → greedy min(|ΔDT| + 0.01·dist) ——
  {
    let table = [];
    openStamps().forEach(stamp => {
      free().forEach(lot => {
        const hit = stampOnLotHit(stamp, lot, pad);
        if (!hit) return;
        if (!stampAreaMatch(stamp, lot, areaTol)) return;
        table.push({ stamp, lot, hit, score: q3PairScore(stamp, lot) });
      });
    });
    while (table.length) {
      let best = null;
      for (const item of table) {
        if (!best || item.score < best.score) best = item;
      }
      if (!best) break;
      const how = (best.hit === 'hole' ? 'hole' : 'pos') + '+area'
        + (stampNameMatch(best.stamp, best.lot) ? '+name' : '');
      claim(best.stamp, [String(best.lot.key)], how);
      const sid = best.stamp.id;
      const lk = String(best.lot.key);
      table = table.filter(x => x.stamp.id !== sid && String(x.lot.key) !== lk
        && !taken.has(x.stamp.id) && !used.has(String(x.lot.key)));
    }
  }

  // —— Pass 1b: gộp nhiều block tem cùng nằm trên một hatch (ATTRIB tách) ——
  {
    let guard = 0;
    while (guard++ < 200) {
      let progressed = false;
      for (const row of assigned) {
        const lot = (lots || []).find(l => String(l.key) === String(row.key));
        if (!lot) continue;
        const extras = openStamps().filter(s => stampOnLotHit(s, lot, pad));
        if (!extras.length) continue;
        const tryMerge = (extraList) => {
          const merged = mergeGroup([{ stamp: row.stamp }, ...extraList.map(s => ({ stamp: s }))]);
          if (!merged) return false;
          extraList.forEach(s => {
            (s.members || [s.id]).forEach(id => taken.add(id));
            taken.add(s.id);
          });
          row.stamp = merged;
          row.how = 'merge';
          return true;
        };
        if (tryMerge(extras)) {
          progressed = true;
          continue;
        }
        for (const ex of extras) {
          if (tryMerge([ex])) {
            progressed = true;
            break;
          }
        }
      }
      // Hatch trống: nhiều tem trên đó gộp được + DT khớp → nhận luôn.
      free().forEach(lot => {
        const on = openStamps().filter(s => stampOnLotHit(s, lot, pad));
        if (on.length < 2) return;
        const merged = mergeGroup(on.map(s => ({ stamp: s })));
        if (!merged) return;
        if (!stampAreaMatch(merged, lot, areaTol) && stampAreaM2(merged.areaRaw, lot.area) > 0) return;
        // Có DT thì phải khớp; không DT vẫn gộp nếu mọi tem trên hatch (legacy hole/name).
        if (stampAreaM2(merged.areaRaw, lot.area) > 0 && !stampAreaMatch(merged, lot, areaTol)) return;
        if (claim(merged, [String(lot.key)], 'merge')) progressed = true;
      });
      if (!progressed) break;
    }
  }

  // —— Pass 2: multi — 1 tem thừa + nhiều hatch thừa cùng layer cạnh quanh tem ——
  {
    let guard = 0;
    while (guard++ < 500) {
      const left = openStamps();
      if (!left.length) break;
      let progressed = false;
      for (const stamp of left) {
        const open = free();
        const seeds = open
          .map(lot => ({ lot, hit: stampOnLotHit(stamp, lot, pad) }))
          .filter(x => x.hit)
          .sort((a, b) => {
            const la = layerKeyOf(a.lot) ? 0 : 1;
            const lb = layerKeyOf(b.lot) ? 0 : 1;
            if (la !== lb) return la - lb;
            return q3PairScore(stamp, a.lot) - q3PairScore(stamp, b.lot);
          });
        for (const { lot: seed, hit } of seeds) {
          const keys = growKeysFromSeed(stamp, seed, open, areaTol);
          if (keys.length < 2) continue;
          const cmp = stampAreaVsLots(stamp, open, keys, areaTol);
          if (!cmp.ok) continue;
          if (claim(stamp, keys, (hit === 'hole' ? 'hole' : 'pos') + '+area+multi')) {
            progressed = true;
            break;
          }
        }
        if (progressed) break;
      }
      if (!progressed) break;
    }
  }

  // —— Pass 2.5: tem trên hatch + khớp loại, không có DT → greedy theo khoảng cách ——
  {
    let table = [];
    openStamps().forEach(stamp => {
      free().forEach(lot => {
        const hit = stampOnLotHit(stamp, lot, pad);
        if (!hit) return;
        if (!stampNameMatch(stamp, lot)) return;
        if (stampAreaM2(stamp.areaRaw, lot.area) > 0) return;
        table.push({ stamp, lot, hit, score: centroidDistM(stamp, lot) });
      });
    });
    while (table.length) {
      let best = null;
      for (const item of table) {
        if (!best || item.score < best.score) best = item;
      }
      if (!best) break;
      claim(best.stamp, [String(best.lot.key)], (best.hit === 'hole' ? 'hole' : 'pos') + '+name');
      const sid = best.stamp.id;
      const lk = String(best.lot.key);
      table = table.filter(x => x.stamp.id !== sid && String(x.lot.key) !== lk
        && !taken.has(x.stamp.id) && !used.has(String(x.lot.key)));
    }
  }

  // —— Pass 3: gần bao ≤ 50 m + tên + DT (tem không nằm trên hatch nào còn trống) ——
  {
    let guard = 0;
    while (guard++ < 500) {
      const open = free();
      const left = openStamps();
      if (!left.length) break;
      const cands = [];
      left.forEach(stamp => {
        const onAny = open.some(lot => stampOnLotHit(stamp, lot, pad));
        if (onAny) return; // còn trên hatch trống → để pending / không near-jump
        open.forEach(lot => {
          const sc = scoreLot(stamp, lot, nearM, areaTol);
          if (sc.near && sc.name && sc.area && sc.hit !== 'in' && sc.hit !== 'hole') {
            cands.push({ stamp, lot, score: q3PairScore(stamp, lot) });
          }
        });
      });
      if (!cands.length) break;
      cands.sort((a, b) => a.score - b.score);
      const best = cands[0];
      if (!claim(best.stamp, [String(best.lot.key)], 'near+name+area')) break;
    }
  }

  openStamps().forEach(s => pending.push(s));
  const seenPend = new Set();
  const pendingUnique = pending.filter(s => {
    if (!s || seenPend.has(s.id)) return false;
    seenPend.add(s.id);
    return true;
  });
  const unmatchedLots = (lots || []).filter(l => !used.has(String(l.key))).map(l => l.key);
  return { assigned, pending: pendingUnique, unmatchedLots };
}

/**
 * Diện tích ghi trên tem → m².
 * Tem QH ghi ha (0.9 / 0,9 / 0.90 / 1.34 / 5.23) hoặc m² (4994.4);
 * có hatch thì chọn phương án gần diện tích lô nhất (sai số ≤ 40%).
 * Không phụ thuộc «phải đủ 3 chữ số thập phân» mới nhân 10.000.
 */
export function stampAreaM2(raw, lotM2) {
  let text = String(raw || '').trim().replace(/\s/g, '');
  const asHa = /ha$/i.test(text);
  const asM2 = /m2|m²$/i.test(text);
  text = text.replace(/ha$/i, '').replace(/m2$/i, '').replace(/m²$/i, '');
  const tok = numToken(text);
  const s = tok ? tok.raw : text.replace(',', '.');
  const n = tok ? tok.value : Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const dec = (s.split('.')[1] || '').length;
  const cands = [];
  if (asHa) cands.push(n * 10000);
  else if (asM2) cands.push(n);
  else {
    cands.push(n);
    // Mọi số < 100 đều thử ha→m² (0.9 → 9000), không cần đủ 3 thập phân.
    if (n < 100) cands.push(n * 10000);
    // Kiểu Việt 5.230 có thể là 5230 m² (chấm nghìn).
    if (dec === 3 && n >= 1) cands.push(Number(s.replace(/\./g, '')));
  }
  if (!(lotM2 > 0)) {
    if (asHa || (!asM2 && n < 100 && dec >= 1)) return Math.round(n * 10000);
    if (asM2 || n >= 20) return Math.round(n);
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
  if (asHa || (!asM2 && n < 100 && dec >= 1)) return Math.round(n * 10000);
  if (asM2 || n >= 20) return Math.round(n);
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
