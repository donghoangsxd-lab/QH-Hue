// Tem đất trên lớp ký hiệu (file KH, hoặc block ngay trong file sử dụng đất): vòng tròn + chữ, hoặc block.
// Mỗi tem: ký hiệu lô, diện tích, mật độ xây dựng, tầng cao; hệ số sử dụng đất có thể không có.
// Gán theo điểm chèn, rồi tâm khung block, rồi điểm gần lô trong vài mét. Nhiều block trên một lô thì gộp chỉ tiêu nếu không mâu thuẫn.

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

const CODE_RE = /^[A-Za-z]{1,8}(?:[.\-]?\d{0,4}[A-Za-z]?)?$/;
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

function expandBlock(defs, name, tr, depth, attribs) {
  const texts = [];
  const attrs = attribs.map(a => ({ ...a }));
  const pts = [];
  if (Number.isFinite(tr.x) && Number.isFinite(tr.y)) pts.push([tr.x, tr.y]);
  attrs.forEach(a => { if (Number.isFinite(a.x) && Number.isFinite(a.y)) pts.push([a.x, a.y]); });
  const def = defs.get(String(name || '').toLowerCase());
  if (!def || depth > 4) return { texts, attrs, pts };
  def.texts.forEach(t => {
    const [x, y] = xform(t.x, t.y, tr);
    texts.push({ text: t.text, x, y, h: (t.h > 0 ? t.h : 2) * Math.max(Math.abs(tr.sx), Math.abs(tr.sy), 1) });
    pts.push([x, y]);
  });
  const taken = new Set(attrs.map(a => normTag(a.tag)));
  def.attdefs.forEach(a => {
    const [x, y] = xform(a.x, a.y, tr);
    pts.push([x, y]);
    if (taken.has(normTag(a.tag))) return;
    attrs.push({ tag: a.tag, text: a.text, x, y });
  });
  def.pts.forEach(([x, y]) => pts.push(xform(x, y, tr)));
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
      pts.push([x, y]);
    });
    sub.attrs.forEach(a => {
      if (taken.has(normTag(a.tag))) return;
      const [x, y] = place(a.x, a.y);
      attrs.push({ ...a, x, y });
      taken.add(normTag(a.tag));
      pts.push([x, y]);
    });
    sub.pts.forEach(([x, y]) => pts.push(place(x, y)));
  });
  return { texts, attrs, pts };
}

function contentCentroid(pts, insert) {
  const rest = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])
    && (Math.abs(p[0] - insert[0]) > 1e-6 || Math.abs(p[1] - insert[1]) > 1e-6));
  if (!rest.length) return null;
  const xs = rest.map(p => p[0]);
  const ys = rest.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function candidatePoints(insert, pts) {
  const out = [];
  const push = (p) => {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const eps = Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 180 ? 1e-7 : 0.05;
    if (out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < eps)) return;
    out.push(p);
  };
  push(insert);
  push(contentCentroid(pts, insert));
  pts.forEach(push);
  return out;
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
      blocks.push({
        x: ent.x, y: ent.y, attrs: blown.attrs, texts: blown.texts,
        points: candidatePoints([ent.x, ent.y], blown.pts)
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
    const key = tagKey(a.tag);
    if (key && a.text) got[key] = a.text.trim();
  });
  if (!got.code && !got.area && !got.coverage && !got.floors && !got.far) return null;
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

/** DXF lớp ký hiệu → tem { code, areaRaw, floors, coverage, far, x, y } trong hệ tọa độ bản vẽ */
export function parseLandStampDxf(text) {
  const { texts, circles, blocks } = readStampEntities(text);
  const flat = texts.flatMap(explode);
  const stamps = [];
  const used = new Set();
  blocks.forEach(b => {
    const fromAttr = stampFromBlock(b);
    const fromText = (b.texts && b.texts.length) ? parseItems(b.texts.flatMap(explode), NaN, NaN) : null;
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
    const raw = (s.points && s.points.length) ? s.points : [[s.x, s.y]];
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

const STAMP_TOL_M = 12;

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

function nearestLot(stamp, lots, tol) {
  let best = null;
  let bestD = tol;
  candPoints(stamp).forEach(p => {
    lots.forEach(lot => {
      const d = distToLot(p.lng, p.lat, lot.rings);
      if (d <= bestD) { bestD = d; best = lot; }
    });
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

/**
 * lots: { key, area, rings } — rings là mảng polygon GeoJSON [lng, lat].
 * assign: { stampId: lotKey } do người dùng chọn. skip: tem bỏ qua.
 * Một lô một bộ chỉ tiêu. Nhiều tem không mâu thuẫn thì gộp; mâu thuẫn thì để người dùng gán.
 * tolM: mét, tem nằm sát mép lô (mặc định 12).
 */
export function matchStamps(stamps, lots, opt = {}) {
  const assign = opt.assign || {};
  const skip = new Set(opt.skip || []);
  const tol = Number.isFinite(opt.tolM) ? opt.tolM : STAMP_TOL_M;
  const used = new Set();
  const taken = new Set();
  const assigned = [];
  const claim = (stamp, key, how) => {
    if (!stamp || !key || used.has(key) || skip.has(stamp.id)) return false;
    const ids = stamp.members || [stamp.id];
    if (ids.some(id => taken.has(id) || skip.has(id))) return false;
    if (!(lots || []).some(l => l.key === key)) return false;
    used.add(key);
    ids.forEach(id => taken.add(id));
    assigned.push({ stamp, key, how });
    return true;
  };
  (stamps || []).forEach(s => { if (assign[s.id]) claim(s, assign[s.id], 'user'); });
  const free = () => (lots || []).filter(l => !used.has(l.key));
  const hits = (stamps || []).filter(s => !taken.has(s.id) && !skip.has(s.id)).map(s => {
    const open = free();
    const inside = open.filter(l => bestHit(s, l) === 'in').sort((a, b) => (a.area || 0) - (b.area || 0));
    const hole = open.filter(l => bestHit(s, l) === 'hole').sort((a, b) => (a.area || 0) - (b.area || 0));
    return { stamp: s, lot: inside[0] || hole[0] || null, how: inside[0] ? 'auto' : hole[0] ? 'hole' : '' };
  });
  const by = new Map();
  hits.forEach(h => {
    if (!h.lot) return;
    const g = by.get(h.lot.key) || [];
    g.push(h);
    by.set(h.lot.key, g);
  });
  const pending = [];
  const give = (group, key, how) => {
    if (group.length === 1) { claim(group[0].stamp, key, how); return; }
    const merged = mergeGroup(group);
    if (merged && claim(merged, key, 'merge')) return;
    group.forEach(h => pending.push(h.stamp));
  };
  by.forEach((group, key) => give(group, key, group[0].how || 'auto'));
  const near = [];
  hits.forEach(h => {
    if (h.lot || taken.has(h.stamp.id) || skip.has(h.stamp.id)) return;
    const lot = nearestLot(h.stamp, free(), tol);
    if (!lot) { pending.push(h.stamp); return; }
    const g = near.find(n => n.key === lot.key);
    if (g) g.group.push(h);
    else near.push({ key: lot.key, group: [h] });
  });
  near.forEach(n => give(n.group, n.key, 'near'));
  const unmatchedLots = (lots || []).filter(l => !used.has(l.key)).map(l => l.key);
  return { assigned, pending, unmatchedLots };
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
