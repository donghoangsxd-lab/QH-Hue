// Đồ án trên bucket:
//   projects/index.json — danh mục + ranh tổng (để vẽ khung khi thu nhỏ) + diện tích lô đất theo phường × loại đất
//   projects/<slug>/hien-trang.json — bản đồ hiện trạng (lô HT)
//   projects/<slug>/su-dung-dat.json — chức năng sử dụng đất / bản đồ quy hoạch (lô QH)
//   projects/<slug>/diem-chuc-nang.json — điểm chức năng
//   projects/<slug>/ranh-gioi.json — ranh giới quy hoạch
//   projects/<slug>/quyet-dinh.pdf — PDF quyết định ≤ 1 MB. Link ngoài nằm ở projects/decisions.json (kind: link), chỉ gán sau khi máy chủ mở được link.
//   projects/<slug>/adjust/<id>.json|.pdf — hồ sơ điều chỉnh cục bộ, chỉ mục ở projects/adjustments.json
// File cũ projects/<slug>.json vẫn đọc được cho tới lần ghi tiếp theo, rồi tách vào thư mục và xóa.
// Slug: bỏ dấu, chữ thường, tối đa 60 ký tự, thêm 8 ký tự SHA-256 của Ten_QH (cùng tên → cùng thư mục).
// Đồ án chưa chuyển (legacy) vẫn nằm trong cad_parcels.json cho tới khi migrate xong.
const axios = require('axios');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const constants = require('../config/constants');
const gcsWrite = require('./gcsWrite');
const { getCadParcels, getRawDataList, invalidateCache } = require('./gcsService');

const INDEX_NAME = 'projects/index.json';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIGRATE_PAGE = 8;
const PROXY_MAX_CHARS = 4000000;
const SCRIPT_MAX_CHARS = 6000000;

let transport = null;
let indexCache = null; // { etag, data }
let decisionsCache = null; // { etag, generation, data }
let migrateJob = null; // { at, groups, wardFeatures }

function setTransport(fn) { transport = fn; }

function projectTitle(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(?:HT|QH)[\s_\-]+(.+)$/i);
  const name = String(m ? m[1] : base).replace(/-(?:ranh-gioi|diem-chuc-nang)$/i, '').trim();
  return name.slice(0, 120);
}

// Cột File của CAD_Polygon là tên file (HT-….dxf); cột Ten_QH và Kind PROJECT là tên đồ án
function asProjectName(file) {
  const name = String(file || '').trim();
  if (/\.(dxf|kml|kmz|geojson|json)$/i.test(name)) return projectTitle(name);
  return name;
}

function projectSlug(name) {
  const src = String(name || '').normalize('NFC').trim();
  const ascii = src.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  let base = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
  if (!base) base = 'do-an';
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

function vnStamp(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function bboxOf(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minX)) return null;
  const r = (n) => Math.round(n * 1e6) / 1e6;
  return [r(minX), r(minY), r(maxX), r(maxY)];
}

function addArea(bucket, ward, nhom, area) {
  if (!ward || !(Number(area) > 0)) return;
  const row = bucket[ward] || (bucket[ward] = {});
  const key = nhom || 'Đất khác';
  row[key] = Math.round(((row[key] || 0) + Number(area)) * 10) / 10;
}

function publicUrl(name) {
  return `${constants.GCS_PUBLIC_BASE}${name}`;
}

async function readJson(name) {
  const res = await axios.get(`${publicUrl(name)}?v=${Date.now()}`, {
    timeout: name === INDEX_NAME ? 15000 : 55000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true
  });
  if (res.status === 404) return { missing: true, generation: '0', etag: null, data: null };
  if (res.status !== 200) {
    const err = new Error(`Đọc ${name} lỗi HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  return {
    missing: false,
    generation: String(res.headers['x-goog-generation'] || ''),
    etag: res.headers.etag || res.headers['last-modified'] || null,
    data: res.data
  };
}

async function writeText(name, text, generation) {
  try {
    const out = await gcsWrite.putJson(name, text, generation || undefined);
    return { via: 'direct', generation: out.generation };
  } catch (err) {
    const denied = err.code === 'NO_SA' || err.status === 401 || err.status === 403;
    if (!denied) throw err;
    if (!transport) throw err;
    if (text.length > SCRIPT_MAX_CHARS) {
      const tooBig = new Error('File đồ án lớn hơn 6 MB và service account chưa có quyền ghi bucket. Cấp roles/storage.objectAdmin cho service account GEE trên bucket hue-infra-data-us.');
      tooBig.status = 413;
      throw tooBig;
    }
    const ok = await transport({ op: 'put', name, content: text });
    if (!ok) {
      const fail = new Error('Không ghi được file đồ án lên bucket');
      fail.status = 502;
      throw fail;
    }
    return { via: 'script', generation: '' };
  }
}

async function removeName(name) {
  try {
    await gcsWrite.removeObject(name);
    return 'direct';
  } catch (err) {
    const denied = err.code === 'NO_SA' || err.status === 401 || err.status === 403;
    if (!denied) throw err;
    if (!transport) throw err;
    const ok = await transport({ op: 'del', name });
    if (!ok) {
      const fail = new Error('Không xóa được file đồ án trên bucket');
      fail.status = 502;
      throw fail;
    }
    return 'script';
  }
}

async function readIndex() {
  let etag = null;
  try {
    const head = await axios.head(`${publicUrl(INDEX_NAME)}?v=${Date.now()}`, { timeout: 5000, validateStatus: () => true });
    if (head.status === 404) {
      indexCache = null;
      return { missing: true, generation: '0', data: null };
    }
    etag = head.headers.etag || head.headers['last-modified'] || null;
    if (indexCache && etag && indexCache.etag === etag) {
      return { missing: false, generation: indexCache.generation, data: indexCache.data };
    }
  } catch (err) { /* HEAD lỗi thì GET */ }
  const got = await readJson(INDEX_NAME);
  if (!got.missing && got.data && got.data.v === 1 && Array.isArray(got.data.projects)) {
    indexCache = { etag: got.etag || etag, generation: got.generation, data: got.data };
  }
  return got;
}

function rememberIndex(data, generation) {
  indexCache = { etag: null, generation: generation || '', data };
}

async function updateIndex(mutator) {
  let via = 'direct';
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readIndex();
    const base = (!cur.missing && cur.data) ? cur.data : { v: 1, migrated: false, projects: [] };
    const next = mutator(base);
    next.v = 1;
    next.saved = Date.now();
    try {
      const written = await writeText(INDEX_NAME, JSON.stringify(next), cur.generation || undefined);
      via = written.via;
      rememberIndex(next, written.generation);
      return { index: next, via };
    } catch (err) {
      if (err.code !== 'GEN' || attempt === 2) throw err;
      indexCache = null;
    }
  }
  const err = new Error('Xung đột khi cập nhật danh mục đồ án');
  err.status = 409;
  throw err;
}

function entryOf(group) {
  const lands = group.parcels.filter(p => p.kind === 'DXF');
  const infraIds = new Set(group.parcels.filter(p => p.kind === 'INFRA').map(p => p.id));
  return {
    tenQH: group.tenQH,
    slug: projectSlug(group.tenQH),
    file: group.file || group.tenQH,
    wards: group.wards || [],
    infra: group.infraCount || infraIds.size,
    lands: group.landCount || lands.length,
    time: group.time || '',
    boundary: group.boundary || null,
    bbox: bboxOf(group.boundary),
    landArea: group.landArea || {},
    legacy: false,
    saved: Date.now()
  };
}

function emptyGroup(tenQH) {
  return {
    tenQH, file: tenQH, wards: [], boundary: null, time: '',
    infraCount: 0, landCount: 0, landArea: {}, parcels: [],
    infraIds: new Set(), landIds: new Set()
  };
}

function legacyCatalog(parcels) {
  const by = new Map();
  const get = (name) => {
    const tenQH = String(name || '').trim();
    if (!tenQH) return null;
    let g = by.get(tenQH);
    if (!g) by.set(tenQH, g = emptyGroup(tenQH));
    return g;
  };
  parcels.forEach(p => {
    if (!p) return;
    if (p.kind === 'PROJECT') {
      const g = get(p.id);
      if (!g) return;
      g.boundary = p.geometry || g.boundary;
      g.wards = String(p.ward || '').split(',').map(s => s.trim()).filter(Boolean);
      g.infraCount = p.infraCount || g.infraCount;
      g.landCount = p.landCount || g.landCount;
      g.time = p.time || g.time;
      g.file = p.id;
      return;
    }
    const g = get(asProjectName(p.file));
    if (!g || !p.geometry) return;
    if (p.kind === 'DXF') {
      g.landIds.add(p.id);
      addArea(g.landArea, p.ward, p.nhom, p.area);
      return;
    }
    g.infraIds.add(p.id);
  });
  return [...by.values()].map(g => ({
    tenQH: g.tenQH,
    slug: projectSlug(g.tenQH),
    file: g.file || g.tenQH,
    wards: g.wards,
    infra: g.infraCount || g.infraIds.size,
    lands: g.landCount || g.landIds.size,
    time: g.time,
    boundary: g.boundary,
    bbox: bboxOf(g.boundary),
    landArea: g.landArea,
    legacy: true,
    saved: 0
  })).filter(p => p.tenQH);
}

// Số công trình theo Ten_QH trên Sheet (dòng mảnh phường <ID>.2 đã gộp vào công trình chính) + khung bao các điểm
async function sheetProjects() {
  const by = new Map();
  let list = [];
  try { list = await getRawDataList(); } catch (err) { console.warn('Đọc danh sách công trình cho danh mục đồ án lỗi:', err.message); }
  list.forEach(it => {
    const name = String(it.tenQH || '').trim();
    if (!name || !Number.isFinite(it.lat) || !Number.isFinite(it.lng)) return;
    let g = by.get(name);
    if (!g) by.set(name, g = { ids: new Set(), box: [Infinity, Infinity, -Infinity, -Infinity] });
    g.ids.add(it.id);
    g.box = [Math.min(g.box[0], it.lng), Math.min(g.box[1], it.lat), Math.max(g.box[2], it.lng), Math.max(g.box[3], it.lat)];
  });
  return by;
}

// Đồ án chỉ có cột Ten_QH trên Sheet (chưa có ranh tổng / file lô): hiện trong danh mục, không có file để tải
function sheetOnlyEntry(name, g) {
  const r = (n) => Math.round(n * 1e6) / 1e6;
  return {
    tenQH: name, slug: projectSlug(name), file: name, wards: [], infra: g.ids.size, lands: 0, time: '',
    boundary: null, bbox: g.box.map(r), landArea: {}, legacy: false, sheetOnly: true, saved: 0
  };
}

async function catalog() {
  const stored = await readIndex();
  const saved = (!stored.missing && stored.data && Array.isArray(stored.data.projects)) ? stored.data.projects : [];
  const migrated = !!(stored.data && stored.data.migrated);
  const by = new Map();
  if (!migrated) {
    try {
      legacyCatalog(await getCadParcels()).forEach(p => by.set(p.tenQH, p));
    } catch (err) {
      console.warn('Đọc cad_parcels cho danh mục cũ lỗi:', err.message);
    }
  }
  const deleted = new Set();
  saved.forEach(p => {
    if (!p || !p.tenQH) return;
    if (p.deleted) { deleted.add(p.tenQH); by.delete(p.tenQH); return; }
    by.set(p.tenQH, { ...p, legacy: false });
  });
  const sheet = await sheetProjects();
  sheet.forEach((g, name) => {
    const cur = by.get(name);
    if (cur) {
      cur.infra = g.ids.size;
      if (!cur.bbox) cur.bbox = sheetOnlyEntry(name, g).bbox;
    } else {
      by.set(name, sheetOnlyEntry(name, g));
    }
  });
  const projects = [...by.values()].filter(p => p.tenQH && !p.deleted)
    .sort((a, b) => String(a.tenQH).localeCompare(String(b.tenQH), 'vi'));
  await attachDecisions(projects);
  return { base: constants.PROJECTS_GCS_BASE, migrated, projects };
}

// ============================ QUYẾT ĐỊNH PHÊ DUYỆT (PDF ≤ 1 MB) ============================

const DECISIONS_NAME = 'projects/decisions.json';
const DECISION_FILE = 'quyet-dinh.pdf';
const DECISION_MAX_BYTES = 1024 * 1024;

function decisionObject(slug) {
  return `projects/${slug}/${DECISION_FILE}`;
}

function decisionFileName(raw) {
  const base = String(raw || '').replace(/[\u0000-\u001f"\\]/g, '').trim().slice(0, 120);
  if (!base) return 'Quyet-dinh-phe-duyet.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function pdfOk(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.length <= DECISION_MAX_BYTES
    && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

function emptyDecisions() {
  return { v: 1, items: {} };
}

function rememberDecisions(data, generation) {
  decisionsCache = { etag: null, generation: generation || '', data };
}

async function readDecisions() {
  let etag = null;
  try {
    const head = await axios.head(`${publicUrl(DECISIONS_NAME)}?v=${Date.now()}`, { timeout: 5000, validateStatus: () => true });
    if (head.status === 404) {
      decisionsCache = null;
      return { missing: true, generation: '0', data: emptyDecisions() };
    }
    etag = head.headers.etag || head.headers['last-modified'] || null;
    if (decisionsCache && etag && decisionsCache.etag === etag) {
      return { missing: false, generation: decisionsCache.generation, data: decisionsCache.data };
    }
  } catch (err) { /* HEAD lỗi thì GET */ }
  const got = await readJson(DECISIONS_NAME);
  if (got.missing || !got.data || got.data.v !== 1 || !got.data.items || typeof got.data.items !== 'object') {
    return { missing: !!got.missing, generation: got.generation || '0', data: emptyDecisions() };
  }
  decisionsCache = { etag: got.etag || etag, generation: got.generation, data: got.data };
  return { missing: false, generation: got.generation, data: got.data };
}

async function updateDecisions(mutator) {
  let via = 'direct';
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readDecisions();
    const next = mutator(cur.data || emptyDecisions());
    next.v = 1;
    next.items = next.items && typeof next.items === 'object' ? next.items : {};
    next.saved = Date.now();
    try {
      const written = await writeText(DECISIONS_NAME, JSON.stringify(next), cur.missing ? '0' : (cur.generation || undefined));
      via = written.via;
      rememberDecisions(next, written.generation);
      return { decisions: next, via };
    } catch (err) {
      if (err.code !== 'GEN' || attempt === 2) throw err;
      decisionsCache = null;
    }
  }
  const err = new Error('Xung đột khi cập nhật quyết định phê duyệt');
  err.status = 409;
  throw err;
}

function decisionView(d) {
  const link = d.kind === 'link' && /^https?:\/\//i.test(String(d.url || ''));
  return {
    slug: d.slug,
    kind: link ? 'link' : 'pdf',
    url: link ? String(d.url) : '',
    name: link ? String(d.name || 'Quyết định phê duyệt').slice(0, 120) : decisionFileName(d.name),
    bytes: Number(d.bytes) || 0,
    at: Number(d.at) || 0,
    embed: link ? d.embed === true : true
  };
}

async function attachDecisions(projects) {
  try {
    const stored = await readDecisions();
    const items = stored.data.items || {};
    projects.forEach(p => {
      const d = items[p.tenQH];
      if (!d || !d.at || !SLUG_RE.test(String(d.slug || ''))) return;
      p.decision = decisionView(d);
    });
  } catch (err) {
    console.warn('Đọc quyết định phê duyệt lỗi:', err.message);
  }
}

async function writeBytes(name, buffer, contentType) {
  try {
    const out = await gcsWrite.putObject(name, buffer, contentType);
    return { via: 'direct', generation: out.generation };
  } catch (err) {
    const denied = err.code === 'NO_SA' || err.status === 401 || err.status === 403;
    if (!denied) throw err;
    if (!transport) throw err;
    const ok = await transport({ op: 'pdf', name, content: buffer.toString('base64') });
    if (!ok) {
      const fail = new Error('Không ghi được file PDF lên bucket');
      fail.status = 502;
      throw fail;
    }
    return { via: 'script', generation: '' };
  }
}

const REVIEW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function rejectReview(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function ipBlocked(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  }
  return true;
}

function hostBlocked(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal') return true;
  if (net.isIP(h)) return ipBlocked(h);
  return false;
}

async function publicUrlOf(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch (e) { rejectReview('Link không hợp lệ'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') rejectReview('Chỉ nhận link http hoặc https');
  if (url.username || url.password) rejectReview('Link không được kèm tài khoản');
  if (hostBlocked(url.hostname)) rejectReview('Link trỏ vào máy nội bộ');
  if (!net.isIP(url.hostname)) {
    let ips = [];
    try { ips = await dns.lookup(url.hostname, { all: true }); }
    catch (e) { rejectReview('Không phân giải được tên miền'); }
    if (!ips.length || ips.some(x => ipBlocked(x.address))) rejectReview('Link trỏ vào địa chỉ nội bộ');
  }
  return url;
}

function readHead(stream, limit = 8192) {
  return new Promise((resolve, reject) => {
    if (!stream || typeof stream.on !== 'function') { resolve(Buffer.alloc(0)); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => { stream.destroy(); finish(); }, 12000);
    stream.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      if (size < limit) chunks.push(buf.slice(0, limit - size));
      size += buf.length;
      if (size >= limit) { stream.destroy(); finish(); }
    });
    stream.on('end', finish);
    stream.on('error', (e) => { if (size > 0 || done) finish(); else { clearTimeout(timer); reject(e); } });
  });
}

function lengthOf(headers) {
  const range = String(headers['content-range'] || '');
  const total = range.match(/\/(\d+)\s*$/);
  if (total) return Number(total[1]);
  const n = Number(headers['content-length']);
  return Number.isFinite(n) ? n : 0;
}

function nameFrom(headers, url) {
  const cd = String(headers['content-disposition'] || '');
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  let name = '';
  try { name = decodeURIComponent(String((star && star[1]) || (plain && plain[1]) || '').trim()); }
  catch (e) { name = String((plain && plain[1]) || '').trim(); }
  if (!name) {
    try { name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || ''); }
    catch (e) { name = ''; }
  }
  return name.replace(/[\u0000-\u001f"\\]/g, '').trim().slice(0, 120);
}

function frameBlocked(headers) {
  const xfo = String(headers['x-frame-options'] || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;
  const csp = String(headers['content-security-policy'] || '').toLowerCase();
  return csp.includes('frame-ancestors') && !/frame-ancestors\s+\*/.test(csp);
}

function challengeCookie(buf) {
  const m = buf.toString('utf8').match(/document\.cookie\s*=\s*"([A-Za-z0-9_-]+)=([^";\s]+)"/);
  return m ? `${m[1]}=${m[2]}` : '';
}

async function probeOnce(url, cookie) {
  const headers = { 'User-Agent': REVIEW_UA, Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8', Range: 'bytes=0-4095' };
  if (cookie) headers.Cookie = cookie;
  const res = await axios.get(url.href, {
    headers,
    responseType: 'stream',
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: () => true
  });
  const head = await readHead(res.data);
  return { status: res.status, headers: res.headers || {}, head };
}

// Mở link (theo tối đa 5 chuyển hướng, vượt 1 lớp cookie chống máy). Chỉ chấp nhận PDF hoặc trang HTML đủ nội dung.
async function reviewDecisionLink(raw) {
  let current = await publicUrlOf(raw);
  let cookie = '';
  let challenged = false;
  for (let hop = 0; hop < 5; hop++) {
    let got;
    try { got = await probeOnce(current, cookie); }
    catch (e) { rejectReview('Không mở được link'); }
    const status = got.status;
    if (status >= 300 && status < 400 && got.headers.location) {
      current = await publicUrlOf(new URL(got.headers.location, current).href);
      continue;
    }
    if (status !== 200 && status !== 206) rejectReview(`Link trả về HTTP ${status}`);
    const type = String(got.headers['content-type'] || '').toLowerCase();
    const pdf = got.head.slice(0, 5).toString('latin1').startsWith('%PDF') || type.includes('application/pdf');
    if (!pdf && !cookie) {
      const nextCookie = challengeCookie(got.head);
      if (nextCookie) { cookie = nextCookie; challenged = true; hop -= 1; continue; }
    }
    const html = type.includes('text/html') && got.head.length > 800 && !challengeCookie(got.head);
    if (!pdf && !html) rejectReview('Link không phải file PDF hoặc trang xem quyết định');
    const name = nameFrom(got.headers, current) || (pdf ? 'Quyet-dinh.pdf' : 'Quyết định phê duyệt');
    const embed = !challenged && !frameBlocked(got.headers);
    let note = pdf ? 'File PDF' : 'Trang xem quyết định';
    if (challenged) note += '. Trang có lớp chặn tự động, chỉ mở được ở tab mới';
    else if (!embed) note += '. Trang không cho nhúng, mở ở tab mới';
    else note += '. Xem được ngay trong trang';
    return {
      ok: true,
      url: current.href,
      name,
      bytes: lengthOf(got.headers),
      contentType: type.split(';')[0] || (pdf ? 'application/pdf' : 'text/html'),
      embed,
      note
    };
  }
  rejectReview('Link chuyển hướng quá nhiều lần');
}

async function listedProject(tenQH) {
  const name = String(tenQH || '').trim();
  if (!name) rejectReview('Thiếu tên đồ án');
  const listed = await catalog();
  const entry = listed.projects.find(p => p && p.tenQH === name);
  if (!entry) rejectReview(`Chưa có đồ án «${name}» trong danh sách`, 404);
  const slug = String(entry.slug || projectSlug(name));
  if (!SLUG_RE.test(slug)) rejectReview('Mã đồ án không hợp lệ');
  return { name, slug };
}

async function saveDecision({ tenQH, fileName, buffer }) {
  if (!pdfOk(buffer)) {
    const err = new Error(buffer && buffer.length > DECISION_MAX_BYTES
      ? 'File quyết định lớn hơn 1 MB'
      : 'Chỉ nhận file PDF');
    err.status = buffer && buffer.length > DECISION_MAX_BYTES ? 413 : 400;
    throw err;
  }
  const { name, slug } = await listedProject(tenQH);
  const written = await writeBytes(decisionObject(slug), buffer, 'application/pdf');
  const at = Date.now();
  const meta = { kind: 'pdf', slug, name: decisionFileName(fileName), bytes: buffer.length, at, embed: true };
  const indexed = await updateDecisions(cur => {
    const items = { ...(cur.items || {}) };
    items[name] = meta;
    return { ...cur, items };
  });
  return { ...decisionView(meta), via: written.via || indexed.via, accessUrl: publicUrl(decisionObject(slug)) };
}

// Gán link chỉ sau khi reviewDecisionLink mở được trang. File PDF cũ trên bucket bị gỡ.
async function saveDecisionLink({ tenQH, url }) {
  const review = await reviewDecisionLink(url);
  const { name, slug } = await listedProject(tenQH);
  const at = Date.now();
  const meta = {
    kind: 'link', slug, url: review.url, name: review.name, bytes: review.bytes, at, embed: review.embed
  };
  const indexed = await updateDecisions(cur => {
    const items = { ...(cur.items || {}) };
    items[name] = meta;
    return { ...cur, items };
  });
  try { await removeName(decisionObject(slug)); } catch (err) { /* chưa có PDF trên bucket */ }
  return { ...decisionView(meta), via: indexed.via, note: review.note };
}

async function removeDecision(tenQH, fallbackSlug) {
  const name = String(tenQH || '').trim();
  const cur = await readDecisions();
  const item = cur.data.items && cur.data.items[name];
  const slug = (item && item.slug) || fallbackSlug || '';
  if (item) {
    await updateDecisions(base => {
      const items = { ...(base.items || {}) };
      delete items[name];
      return { ...base, items };
    });
  }
  if (SLUG_RE.test(String(slug))) {
    try { await removeName(decisionObject(slug)); } catch (err) { /* file chưa có */ }
  }
  return { slug: slug || '' };
}

async function readDecision(slug) {
  const key = String(slug || '');
  if (!SLUG_RE.test(key)) {
    const err = new Error('Mã đồ án không hợp lệ');
    err.status = 400;
    throw err;
  }
  const stored = await readDecisions();
  const items = stored.data.items || {};
  const meta = Object.keys(items).map(k => items[k]).find(d => d && d.slug === key && d.at);
  if (!meta) {
    const err = new Error('Đồ án chưa có quyết định phê duyệt');
    err.status = 404;
    throw err;
  }
  if (meta.kind === 'link') {
    const err = new Error('Quyết định này là link ngoài');
    err.status = 404;
    throw err;
  }
  const res = await axios.get(`${publicUrl(decisionObject(key))}?v=${meta.at}`, {
    timeout: 20000,
    responseType: 'arraybuffer',
    maxContentLength: DECISION_MAX_BYTES + 4096,
    validateStatus: () => true
  });
  if (res.status === 404) {
    const err = new Error('File quyết định không còn trên bucket');
    err.status = 404;
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`Đọc quyết định lỗi HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  return { buffer: Buffer.from(res.data), name: decisionFileName(meta.name), at: Number(meta.at) || 0 };
}

const ROLE_HT = 'hien-trang';
const ROLE_QH = 'su-dung-dat';
const ROLE_POINTS = 'diem-chuc-nang';
const ROLE_BOUNDARY = 'ranh-gioi';

function roleName(slug, role) {
  return `projects/${slug}/${role}.json`;
}

function legacyName(slug) {
  return `projects/${slug}.json`;
}

function parcelPhase(p) {
  return p && p.phase === 'QH' ? 'QH' : 'HT';
}

function namedPhase(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(HT|QH)(?![A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
}

function dxfNum(id) {
  const m = String(id || '').match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function dxfId(n) {
  return `DXF-${n < 1000 ? String(n).padStart(3, '0') : String(n)}`;
}

// Giữ lô giai đoạn kia. resetLands / resetInfra chỉ bỏ lô của đúng giai đoạn đang ghi.
function applyPhaseParcels(prev, phase, { resetLands, resetInfra, infraAdds, landAdds }) {
  const infra = new Map();
  const dxf = [];
  (prev || []).forEach(p => {
    if (!p || !p.geometry || parcelPhase(p) !== phase) return;
    if (p.kind === 'DXF') {
      if (!resetLands) dxf.push(p);
      return;
    }
    if (resetInfra) return;
    infra.set(String(p.id), p);
  });
  (infraAdds || []).forEach(row => {
    if (row && row.geometry && parcelPhase(row) === phase) infra.set(String(row.id), row);
  });
  (landAdds || []).forEach(row => {
    if (row && row.geometry && parcelPhase(row) === phase) dxf.push(row);
  });
  return [...infra.values(), ...dxf];
}

function roleDoc(role, name, slug, saved, body) {
  return { v: 2, role, tenQH: name, slug, saved, ...body };
}

async function writeRole(slug, role, doc) {
  return writeText(roleName(slug, role), JSON.stringify(doc));
}

async function readRoleDoc(slug, role) {
  const got = await readJson(roleName(slug, role));
  if (got.missing || !got.data || typeof got.data !== 'object') return null;
  return got.data;
}

async function readLegacyParcels(slug, tenQH) {
  const got = await readJson(legacyName(slug));
  if (got.missing || !got.data || got.data.tenQH !== tenQH || !Array.isArray(got.data.parcels)) {
    return { found: !got.missing && !!(got.data && Array.isArray(got.data.parcels)), parcels: [] };
  }
  return { found: true, parcels: got.data.parcels };
}

function splitPhases(parcels) {
  const ht = [];
  const qh = [];
  (parcels || []).forEach(p => {
    if (!p || !p.geometry) return;
    (parcelPhase(p) === 'QH' ? qh : ht).push(p);
  });
  return { ht, qh };
}

function countParcels(list) {
  let infra = 0;
  let lands = 0;
  (list || []).forEach(p => {
    if (!p) return;
    if (p.kind === 'DXF') lands += 1;
    else infra += 1;
  });
  return { infra, lands };
}

// infraReset: bỏ lô hạ tầng cũ của giai đoạn đó. landsReset 'HT'|'QH' chỉ xóa lô đất giai đoạn đó; true = cả hai.
// points: mảng thì ghi đè file điểm chức năng; null = không đụng file điểm.
async function saveChunk({ tenQH, fileName, items, lotIds, lands, landsReset, infraReset, registry, points }) {
  const name = String(tenQH || '').trim();
  if (!name) {
    const err = new Error('Thiếu tên đồ án');
    err.status = 400;
    throw err;
  }
  // Đồ án đã đổi tên giữ thư mục cũ: slug lấy từ danh mục, chỉ đồ án mới mới sinh slug theo tên
  const listed = await readIndex();
  const known = ((listed.data && listed.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  const slug = (known && known.slug) || projectSlug(name);
  const fromName = namedPhase(fileName);
  let resetLands = landsReset === 'HT' || landsReset === 'QH' || landsReset === true ? landsReset : false;
  if (resetLands === true && fromName) resetLands = fromName;
  let resetInfra = infraReset === 'HT' || infraReset === 'QH' ? infraReset : null;
  if (fromName && resetInfra && resetInfra !== fromName) resetInfra = fromName;

  const htDoc = await readRoleDoc(slug, ROLE_HT);
  const qhDoc = await readRoleDoc(slug, ROLE_QH);
  const hadDir = !!(htDoc || qhDoc);
  let ht = htDoc && Array.isArray(htDoc.parcels) ? htDoc.parcels : [];
  let qh = qhDoc && Array.isArray(qhDoc.parcels) ? qhDoc.parcels : [];
  let legacyFound = false;
  if (!hadDir) {
    const legacy = await readLegacyParcels(slug, name);
    legacyFound = legacy.found;
    const split = splitPhases(legacy.parcels);
    ht = split.ht;
    qh = split.qh;
  }

  const infraAdds = [];
  (items || []).forEach((it, i) => {
    const id = lotIds && lotIds[i];
    if (!id || !it) return;
    (it.stages || []).forEach(st => {
      if (!st || !st.geometry) return;
      const phase = st.phase === 'QH' ? 'QH' : 'HT';
      infraAdds.push({
        kind: 'INFRA', id: String(id), phase, layer: st.layer || '', area: st.area ?? null, geometry: st.geometry
      });
    });
  });
  const landAdds = [];
  let nextNum = [...ht, ...qh].reduce((m, p) => (p && p.kind === 'DXF' ? Math.max(m, dxfNum(p.id)) : m), 0);
  (lands || []).forEach(it => {
    if (!it || !it.geometry) return;
    nextNum += 1;
    const row = {
      kind: 'DXF',
      id: dxfId(nextNum),
      phase: it.phase === 'QH' ? 'QH' : 'HT',
      layer: it.layer || '',
      area: it.area ?? null,
      name: it.name || '',
      nhom: it.nhom || '',
      ward: it.ward || '',
      geometry: it.geometry
    };
    if (it.plan) row.plan = it.plan;
    landAdds.push(row);
  });

  const touch = (phase) => resetLands === true || resetLands === phase || resetInfra === phase
    || infraAdds.some(p => parcelPhase(p) === phase) || landAdds.some(p => parcelPhase(p) === phase);
  const touchHT = touch('HT') || !hadDir;
  const touchQH = touch('QH') || !hadDir;
  const savedAt = Date.now();
  if (touchHT) {
    ht = applyPhaseParcels(ht, 'HT', {
      resetLands: resetLands === true || resetLands === 'HT',
      resetInfra: resetInfra === 'HT',
      infraAdds, landAdds
    });
  }
  if (touchQH) {
    qh = applyPhaseParcels(qh, 'QH', {
      resetLands: resetLands === true || resetLands === 'QH',
      resetInfra: resetInfra === 'QH',
      infraAdds, landAdds
    });
  }

  let via = 'direct';
  if (touchQH) {
    const written = await writeRole(slug, ROLE_QH, roleDoc(ROLE_QH, name, slug, savedAt, { parcels: qh }));
    via = written.via;
  }
  if (touchHT) {
    const written = await writeRole(slug, ROLE_HT, roleDoc(ROLE_HT, name, slug, savedAt, { parcels: ht }));
    via = written.via;
  }
  if (Array.isArray(points)) {
    const written = await writeRole(slug, ROLE_POINTS, roleDoc(ROLE_POINTS, name, slug, savedAt, { points }));
    via = written.via;
  }
  if (legacyFound || registry) {
    try { await removeName(legacyName(slug)); } catch (err) { /* file cũ đã xóa hoặc chưa có */ }
  }

  const all = [...ht, ...qh];
  if (registry && registry.boundary && !registry.keepBoundary) {
    const written = await writeRole(slug, ROLE_BOUNDARY, roleDoc(ROLE_BOUNDARY, name, slug, savedAt, {
      boundary: registry.boundary, boundarySource: registry.boundarySource || 'auto'
    }));
    via = written.via;
  } else if (registry && registry.keepBoundary) {
    const existingBound = await readRoleDoc(slug, ROLE_BOUNDARY);
    if (!existingBound || !existingBound.boundary) {
      const stored = await readIndex();
      const prevEntry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
      if (prevEntry && prevEntry.boundary) {
        const written = await writeRole(slug, ROLE_BOUNDARY, roleDoc(ROLE_BOUNDARY, name, slug, savedAt, {
          boundary: prevEntry.boundary, boundarySource: prevEntry.boundarySource || 'auto'
        }));
        via = written.via;
      }
    }
  }
  if (registry) {
    const indexed = await updateIndex(cur => {
      const prevEntry = (cur.projects || []).find(p => p && p.tenQH === name && !p.deleted) || {};
      const projects = (cur.projects || []).filter(p => p.tenQH !== name);
      const keep = !!registry.keepBoundary;
      const boundary = keep ? (prevEntry.boundary || null) : (registry.boundary || null);
      const boundarySource = keep
        ? (prevEntry.boundarySource || (prevEntry.boundary ? 'auto' : null))
        : (registry.boundarySource || (boundary ? 'auto' : null));
      const counts = countParcels(all);
      const popHT = registry.popHT || prevEntry.popHT || 0;
      const popQH = registry.popQH || prevEntry.popQH || 0;
      projects.push({
        tenQH: name,
        slug,
        dir: true,
        file: fileName || prevEntry.file || name,
        wards: (registry.wards && registry.wards.length) ? registry.wards : (prevEntry.wards || []),
        infra: counts.infra,
        lands: counts.lands,
        time: vnStamp(savedAt),
        boundary,
        boundarySource,
        bbox: bboxOf(boundary),
        landArea: landAreaOf(all),
        ...(popHT ? { popHT } : {}),
        ...(popQH ? { popQH } : {}),
        legacy: false,
        saved: savedAt
      });
      projects.sort((a, b) => a.tenQH.localeCompare(b.tenQH, 'vi'));
      return { ...cur, projects };
    });
    via = indexed.via;
  }
  return { slug, via, lands: all.filter(p => p.kind === 'DXF').length };
}

async function patchBoundary({ tenQH, boundary, boundarySource }) {
  const name = String(tenQH || '').trim();
  if (!name || !boundary) {
    const err = new Error('Thiếu đồ án hoặc ranh giới');
    err.status = 400;
    throw err;
  }
  let slug = '';
  const source = boundarySource === 'auto' ? 'auto' : 'gis';
  const indexed = await updateIndex(cur => {
    const projects = (cur.projects || []).slice();
    const i = projects.findIndex(p => p && p.tenQH === name && !p.deleted);
    if (i < 0) {
      const err = new Error(`Chưa có đồ án «${name}» trong danh mục`);
      err.status = 404;
      throw err;
    }
    const prev = projects[i];
    slug = prev.slug || projectSlug(name);
    projects[i] = {
      ...prev,
      boundary,
      boundarySource: source,
      bbox: bboxOf(boundary),
      time: vnStamp(),
      legacy: false
    };
    return { ...cur, projects };
  });
  const savedAt = Date.now();
  const written = await writeRole(slug, ROLE_BOUNDARY, roleDoc(ROLE_BOUNDARY, name, slug, savedAt, {
    boundary, boundarySource: source
  }));
  return { slug, via: written.via || indexed.via };
}

const PLAN_FIELD_KEYS = ['floors', 'coverage', 'far'];

function landAreaOf(parcels) {
  const out = {};
  parcels.forEach(p => { if (p && p.kind === 'DXF') addArea(out, p.ward, p.nhom, p.area); });
  return out;
}

// true khi đổi loại đất hoặc diện tích (phải tính lại landArea trong danh mục)
function editLandFields(land, fields) {
  let statsChanged = false;
  if (fields.name !== undefined) land.name = fields.name;
  if (fields.nhom !== undefined) {
    statsChanged = land.nhom !== fields.nhom;
    land.nhom = fields.nhom;
  }
  if (fields.layer !== undefined) land.layer = fields.layer;
  if (fields.geometry) {
    statsChanged = statsChanged || Number(land.area) !== fields.area;
    land.geometry = fields.geometry;
    land.area = fields.area;
    land.lat = fields.lat;
    land.lng = fields.lng;
  }
  if (fields.plan) {
    const plan = { ...(land.plan || {}) };
    PLAN_FIELD_KEYS.forEach(k => {
      if (fields.plan[k] === undefined) return;
      if (fields.plan[k]) plan[k] = fields.plan[k];
      else delete plan[k];
    });
    if (Object.keys(plan).length) land.plan = plan;
    else delete land.plan;
  }
  return statsChanged;
}

// Admin sửa 1 lô đất (DXF) từ bảng thông tin: fields = { name?, nhom?, layer?, geometry? + area, lat, lng, plan?: { floors, coverage, far } }.
// Chuỗi rỗng trong plan xóa chỉ tiêu đó. Lô QH nằm ở su-dung-dat.json, lô HT ở hien-trang.json.
async function patchLand({ tenQH, id, phase, fields }) {
  const name = String(tenQH || '').trim();
  const want = phase === 'QH' ? 'QH' : 'HT';
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry) {
    const err = new Error(`Đồ án «${name}» còn ở file cũ (cad_parcels.json): bấm «Chuyển lô cũ lên bucket» trong panel Đồ án trước khi sửa lô`);
    err.status = 409;
    throw err;
  }
  const slug = entry.slug || projectSlug(name);
  const role = want === 'QH' ? ROLE_QH : ROLE_HT;
  let parcels = null;
  let land = null;
  let statsChanged = false;
  const savedAt = Date.now();
  const doc = await readRoleDoc(slug, role);
  if (doc && Array.isArray(doc.parcels)) {
    parcels = doc.parcels;
    land = parcels.find(p => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want);
  }
  if (!land && !entry.dir) {
    const legacy = await readLegacyParcels(slug, name);
    const split = splitPhases(legacy.parcels);
    const ht = split.ht;
    const qh = split.qh;
    parcels = want === 'QH' ? qh : ht;
    land = parcels.find(p => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want);
    if (land) {
      statsChanged = editLandFields(land, fields);
      const other = want === 'QH' ? ht : qh;
      const otherRole = want === 'QH' ? ROLE_HT : ROLE_QH;
      await writeRole(slug, otherRole, roleDoc(otherRole, name, slug, savedAt, { parcels: other }));
      await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels }));
      try { await removeName(legacyName(slug)); } catch (err) { /* file cũ đã xóa */ }
    }
  } else if (land) {
    statsChanged = editLandFields(land, fields);
    await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels }));
  }
  if (!land) {
    const err = new Error(`Không tìm thấy lô ${id} (${want}) trong file đồ án «${name}»`);
    err.status = 404;
    throw err;
  }
  const both = want === 'QH'
    ? [...((await readRoleDoc(slug, ROLE_HT)) || { parcels: [] }).parcels, ...parcels]
    : [...parcels, ...((await readRoleDoc(slug, ROLE_QH)) || { parcels: [] }).parcels];
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted
      ? { ...p, dir: true, saved: savedAt, ...(statsChanged ? { landArea: landAreaOf(both) } : {}) }
      : p))
  }));
  return {
    saved: savedAt,
    via: indexed.via,
    land: {
      id: land.id, phase: want, name: land.name || '', nhom: land.nhom || '', layer: land.layer || '', plan: land.plan || null,
      ...(fields.geometry ? { geometry: land.geometry, area: land.area, lat: land.lat, lng: land.lng } : {})
    }
  };
}

// Admin xóa 1 lô khỏi file đồ án: kind 'DXF' = lô đất (id + phase); 'INFRA' = ranh lô công trình mọi giai đoạn của id
// (dòng Sheet do Apps Script xóa). Lô đất không thấy → 404; ranh công trình không có (điểm, đồ án cũ) → removed 0.
async function deleteLot({ tenQH, id, kind, phase }) {
  const name = String(tenQH || '').trim();
  const infra = kind === 'INFRA';
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) {
    if (infra) return { removed: 0 };
    const err = new Error(`Đồ án «${name}» còn ở file cũ (cad_parcels.json): bấm «Chuyển lô cũ lên bucket» trong panel Đồ án trước khi xóa lô`);
    err.status = 409;
    throw err;
  }
  const slug = entry.slug || projectSlug(name);
  const want = phase === 'QH' ? 'QH' : 'HT';
  const match = infra
    ? (p) => p && p.kind === 'INFRA' && String(p.id) === id
    : (p) => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want;
  const savedAt = Date.now();
  const kept = {};
  let removed = 0;
  for (const role of [ROLE_HT, ROLE_QH]) {
    const doc = await readRoleDoc(slug, role);
    const parcels = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
    kept[role] = parcels.filter(p => !match(p));
    if (kept[role].length === parcels.length) continue;
    removed += parcels.length - kept[role].length;
    await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels: kept[role] }));
  }
  if (!removed) {
    if (infra) return { removed: 0 };
    const err = new Error(`Không tìm thấy lô ${id} (${want}) trong file đồ án «${name}»`);
    err.status = 404;
    throw err;
  }
  const all = [...kept[ROLE_HT], ...kept[ROLE_QH]];
  const counts = countParcels(all);
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted
      ? { ...p, saved: savedAt, infra: counts.infra, lands: counts.lands, landArea: landAreaOf(all) }
      : p))
  }));
  return { removed, saved: savedAt, via: indexed.via };
}

// Admin đổi loại công trình (Sheet đã cấp mã mới): lô INFRA mã id / id.N đổi sang newId / newId.N, layer mới nếu có
// (bảng thông tin đồ án đọc loại lô theo layer). Đồ án cũ (cad_parcels.json) hoặc không có lô của id → changed 0.
async function retypeInfraLot({ tenQH, id, newId, layer }) {
  const name = String(tenQH || '').trim();
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) return { changed: 0, saved: 0 };
  const slug = entry.slug || projectSlug(name);
  const suffixOf = (v) => {
    const s = String(v ?? '');
    if (s === id) return '';
    const rest = s.startsWith(`${id}.`) ? s.slice(id.length + 1) : '';
    return /^\d+$/.test(rest) ? `.${rest}` : null;
  };
  const savedAt = Date.now();
  let changed = 0;
  let via = 'direct';
  for (const role of [ROLE_HT, ROLE_QH]) {
    const doc = await readRoleDoc(slug, role);
    const parcels = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
    let hits = 0;
    const next = parcels.map(p => {
      const sfx = p && p.kind === 'INFRA' ? suffixOf(p.id) : null;
      if (sfx === null) return p;
      hits += 1;
      return { ...p, id: `${newId}${sfx}`, ...(layer ? { layer } : {}) };
    });
    if (!hits) continue;
    changed += hits;
    via = (await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels: next }))).via;
  }
  if (!changed) return { changed: 0, saved: 0 };
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted ? { ...p, saved: savedAt } : p))
  }));
  return { changed, saved: savedAt, via: indexed.via || via };
}

async function dirEntry(name, verb) {
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) {
    const err = new Error(`Đồ án «${name}» còn ở file cũ (cad_parcels.json): bấm «Chuyển lô cũ lên bucket» trong panel Đồ án trước khi ${verb}`);
    err.status = 409;
    throw err;
  }
  return entry;
}

/** Bản sao 1 lô đất (DXF) trong file đồ án; không thấy → 404 */
async function readLand({ tenQH, id, phase }) {
  const name = String(tenQH || '').trim();
  const want = phase === 'QH' ? 'QH' : 'HT';
  const entry = await dirEntry(name, 'chuyển lô');
  const doc = await readRoleDoc(entry.slug || projectSlug(name), want === 'QH' ? ROLE_QH : ROLE_HT);
  const land = doc && Array.isArray(doc.parcels)
    ? doc.parcels.find(p => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want)
    : null;
  if (!land) {
    const err = new Error(`Không tìm thấy lô ${id} (${want}) trong file đồ án «${name}»`);
    err.status = 404;
    throw err;
  }
  return JSON.parse(JSON.stringify(land));
}

// Admin chuyển lô đất thành công trình (Sheet đã cấp mã newId): lô DXF thay bằng lô INFRA cùng ranh, cùng vị trí trong file
async function landToInfra({ tenQH, id, phase, newId, layer }) {
  const name = String(tenQH || '').trim();
  const want = phase === 'QH' ? 'QH' : 'HT';
  const entry = await dirEntry(name, 'chuyển lô');
  const slug = entry.slug || projectSlug(name);
  const role = want === 'QH' ? ROLE_QH : ROLE_HT;
  const doc = await readRoleDoc(slug, role);
  const parcels = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
  const i = parcels.findIndex(p => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want);
  if (i < 0) {
    const err = new Error(`Không tìm thấy lô ${id} (${want}) trong file đồ án «${name}»`);
    err.status = 404;
    throw err;
  }
  const land = parcels[i];
  const lot = { kind: 'INFRA', id: String(newId), phase: want, layer: layer || land.layer || '', area: land.area ?? null, geometry: land.geometry };
  parcels[i] = lot;
  const savedAt = Date.now();
  await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels }));
  const other = (await readRoleDoc(slug, want === 'QH' ? ROLE_HT : ROLE_QH)) || { parcels: [] };
  const all = [...parcels, ...(other.parcels || [])];
  const counts = countParcels(all);
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted
      ? { ...p, saved: savedAt, infra: counts.infra, lands: counts.lands, landArea: landAreaOf(all) }
      : p))
  }));
  return { saved: savedAt, via: indexed.via, lot };
}

// Lớp chính của đồ án = 1 file role (khớp PROJECT_LAYERS ở public/js/projectFiles.js)
const LAYER_ROLES = [ROLE_QH, ROLE_POINTS, ROLE_BOUNDARY, ROLE_HT];

function layerGone(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

// Admin xóa 1 lớp chính của đồ án. Lớp lô (HT / QH) ghi file rỗng để giữ thư mục đồ án; điểm chức năng, ranh giới xóa file.
// Xóa ranh vẫn giữ bbox trong danh mục để lô còn được tải theo khung nhìn. Dòng công trình trên Sheet giữ nguyên.
async function deleteLayer({ tenQH, role }) {
  const name = String(tenQH || '').trim();
  if (!LAYER_ROLES.includes(role)) {
    const err = new Error('Lớp dữ liệu không hợp lệ');
    err.status = 400;
    throw err;
  }
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) {
    const err = new Error(`Đồ án «${name}» còn ở file cũ (cad_parcels.json): bấm «Chuyển lô cũ lên bucket» trong panel Đồ án trước khi xóa lớp`);
    err.status = 409;
    throw err;
  }
  const slug = entry.slug || projectSlug(name);
  const savedAt = Date.now();
  const patch = { saved: savedAt };
  let removed = 0;
  let counts = null;
  if (role === ROLE_HT || role === ROLE_QH) {
    const doc = await readRoleDoc(slug, role);
    removed = doc && Array.isArray(doc.parcels) ? doc.parcels.length : 0;
    if (!removed) throw layerGone(`Lớp đã trống trong đồ án «${name}»`);
    await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels: [] }));
    const other = await readRoleDoc(slug, role === ROLE_HT ? ROLE_QH : ROLE_HT);
    const rest = other && Array.isArray(other.parcels) ? other.parcels : [];
    counts = countParcels(rest);
    Object.assign(patch, { infra: counts.infra, lands: counts.lands, landArea: landAreaOf(rest) });
  } else if (role === ROLE_POINTS) {
    const doc = await readRoleDoc(slug, ROLE_POINTS);
    if (!doc) throw layerGone(`Đồ án «${name}» chưa có lớp điểm chức năng`);
    removed = Array.isArray(doc.points) ? doc.points.length : 0;
    await removeName(roleName(slug, ROLE_POINTS));
  } else {
    const doc = await readRoleDoc(slug, ROLE_BOUNDARY);
    if (!doc && !entry.boundary) throw layerGone(`Đồ án «${name}» chưa có ranh giới`);
    if (doc) await removeName(roleName(slug, ROLE_BOUNDARY));
    removed = 1;
    Object.assign(patch, { boundary: null, boundarySource: null, bbox: entry.bbox || bboxOf(entry.boundary) });
  }
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted ? { ...p, ...patch } : p))
  }));
  return { removed, saved: savedAt, via: indexed.via, counts };
}

async function deleteProjectFiles(tenQH) {
  const name = String(tenQH || '').trim();
  const stored = await readIndex();
  const projects = (!stored.missing && stored.data && stored.data.projects) || [];
  const entry = projects.find(p => p.tenQH === name);
  const slug = (entry && entry.slug) || projectSlug(name);
  let landCount = 0;
  const names = [ROLE_HT, ROLE_QH, ROLE_POINTS, ROLE_BOUNDARY].map(role => roleName(slug, role));
  names.push(legacyName(slug));
  for (const objectName of names) {
    try {
      if (objectName.endsWith(`/${ROLE_HT}.json`) || objectName.endsWith(`/${ROLE_QH}.json`) || objectName === legacyName(slug)) {
        const got = await readJson(objectName);
        if (!got.missing && got.data && Array.isArray(got.data.parcels)) {
          landCount += got.data.parcels.filter(p => p.kind === 'DXF').length;
        }
      }
    } catch (err) { /* file chưa có */ }
  }
  let via = 'direct';
  for (const objectName of names) {
    try { via = await removeName(objectName); } catch (err) { /* file chưa có */ }
  }
  try { await removeDecision(name, slug); } catch (err) { console.warn(`Gỡ quyết định đồ án «${name}»:`, err.message); }
  const indexed = await updateIndex(cur => {
    const projects = (cur.projects || []).filter(p => p.tenQH !== name);
    if (!cur.migrated) projects.push({ tenQH: name, deleted: true });
    return { ...cur, projects };
  });
  return { slug, landCount, via: indexed.via || via };
}

/**
 * Đổi Ten_QH trong danh mục (projects/index.json) và khóa quyết định phê duyệt; thư mục projects/<slug>/ giữ nguyên.
 * Gọi lại sau khi đã đổi (Sheet lỗi giữa chừng) thì bỏ qua phần bucket. Đồ án còn ở cad_parcels.json phải chuyển lên bucket trước.
 */
async function renameProject(from, to) {
  const oldName = String(from || '').trim();
  const newName = String(to || '').trim();
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!oldName || !newName) throw fail(400, 'Thiếu tên đồ án');
  if (oldName === newName) throw fail(400, 'Tên mới trùng tên cũ');
  const stored = await readIndex();
  const list = (stored.data && stored.data.projects) || [];
  const live = (name) => list.find(p => p && p.tenQH === name && !p.deleted);
  if (live(oldName) && live(newName)) throw fail(409, `Đã có đồ án «${newName}», chọn tên khác`);
  if (!live(oldName)) {
    const cat = await catalog();
    const entry = cat.projects.find(p => p.tenQH === oldName);
    if (entry && entry.legacy) throw fail(409, `Đồ án «${oldName}» còn ở file cũ (cad_parcels.json): bấm «Chuyển lô cũ lên bucket» trước khi đổi tên`);
    if (cat.projects.some(p => p.tenQH === newName && !live(newName))) throw fail(409, `Đã có đồ án «${newName}», chọn tên khác`);
    return { slug: '', bucket: false, via: 'direct' };
  }
  let slug = '';
  const indexed = await updateIndex(cur => {
    const projects = (cur.projects || [])
      .filter(p => !(p && p.deleted && p.tenQH === newName))
      .map(p => {
        if (!p || p.tenQH !== oldName || p.deleted) return p;
        slug = p.slug || projectSlug(oldName);
        return { ...p, tenQH: newName, slug };
      });
    if (!cur.migrated) projects.push({ tenQH: oldName, deleted: true });
    projects.sort((a, b) => String(a.tenQH).localeCompare(String(b.tenQH), 'vi'));
    return { ...cur, projects };
  });
  const decisions = await readDecisions();
  if (decisions.data.items && decisions.data.items[oldName]) {
    await updateDecisions(cur => {
      const items = { ...(cur.items || {}) };
      if (items[oldName]) {
        items[newName] = items[oldName];
        delete items[oldName];
      }
      return { ...cur, items };
    });
  }
  return { slug, bucket: true, via: indexed.via };
}

function planOf(props) {
  const pick = (v) => String(v || '').trim();
  const plan = { floors: pick(props.TangCao), coverage: pick(props.MatDoXD), far: pick(props.HeSoSDD) };
  return plan.floors || plan.coverage || plan.far ? plan : null;
}

function parcelFromFeature(ft) {
  const props = ft.properties || {};
  const kind = String(props.Kind || '').toUpperCase() === 'DXF' ? 'DXF' : 'INFRA';
  const phase = String(props.GiaiDoan || '').toUpperCase() === 'QH' ? 'QH' : 'HT';
  const row = {
    kind,
    id: String(props.ID_DoiTuong || '').trim(),
    phase,
    layer: String(props.Layer || ''),
    area: Number(props.DienTich) || null,
    geometry: ft.geometry
  };
  if (!row.id || !row.geometry) return null;
  if (kind === 'DXF') {
    row.name = String(props.Ten || '');
    row.nhom = String(props.Nhom || '');
    row.ward = String(props.XaPhuong || '');
    const plan = planOf(props);
    if (plan) row.plan = plan;
  }
  return row;
}

async function migrationGroups() {
  if (migrateJob && Date.now() - migrateJob.at < 10 * 60 * 1000) return migrateJob;
  const res = await axios.get(`${constants.CAD_GCS_URL}?v=${Date.now()}`, {
    timeout: 55000, maxContentLength: Infinity, maxBodyLength: Infinity, validateStatus: () => true
  });
  if (res.status === 404) {
    migrateJob = { at: Date.now(), groups: [], wardFeatures: [] };
    return migrateJob;
  }
  if (res.status !== 200) {
    const err = new Error(`Không đọc được cad_parcels.json (HTTP ${res.status})`);
    err.status = 502;
    throw err;
  }
  const features = (res.data && res.data.features) || [];
  const by = new Map();
  const wardFeatures = [];
  const get = (tenQH) => {
    const name = String(tenQH || '').trim();
    if (!name) return null;
    let g = by.get(name);
    if (!g) by.set(name, g = emptyGroup(name));
    return g;
  };
  features.forEach(ft => {
    if (!ft || !ft.geometry) return;
    const props = ft.properties || {};
    const kind = String(props.Kind || '').toUpperCase();
    const file = String(props.File || '').trim();
    if (kind === 'PROJECT') {
      const g = get(props.ID_DoiTuong);
      if (!g) return;
      g.boundary = ft.geometry;
      g.wards = String(props.XaPhuong || '').split(',').map(s => s.trim()).filter(Boolean);
      g.infraCount = Number(props.SoCongTrinh) || 0;
      g.landCount = Number(props.SoLoDat) || 0;
      g.time = String(props.ThoiGianNhap || '');
      g.file = file || g.tenQH;
      return;
    }
    if (file) {
      const g = get(asProjectName(file));
      const row = g && parcelFromFeature(ft);
      if (!row) return;
      g.parcels.push(row);
      if (row.kind === 'DXF') addArea(g.landArea, row.ward, row.nhom, row.area);
      return;
    }
    wardFeatures.push(ft);
  });
  migrateJob = { at: Date.now(), groups: [...by.values()], wardFeatures };
  return migrateJob;
}

async function migratePage(cursor) {
  const job = await migrationGroups();
  const stored = await readIndex();
  const skip = new Set();
  ((stored.data && stored.data.projects) || []).forEach(p => {
    if (p && (p.deleted || p.legacy === false)) skip.add(p.tenQH);
  });
  const pending = job.groups.filter(g => !skip.has(g.tenQH));
  const start = Math.max(0, Math.round(Number(cursor) || 0));
  const slice = pending.slice(start, start + MIGRATE_PAGE);
  let via = 'direct';
  for (const g of slice) {
    const entry = entryOf(g);
    entry.dir = true;
    const savedAt = entry.saved;
    const split = splitPhases(g.parcels);
    const qhWrite = await writeRole(entry.slug, ROLE_QH, roleDoc(ROLE_QH, g.tenQH, entry.slug, savedAt, { parcels: split.qh }));
    const htWrite = await writeRole(entry.slug, ROLE_HT, roleDoc(ROLE_HT, g.tenQH, entry.slug, savedAt, { parcels: split.ht }));
    via = htWrite.via || qhWrite.via;
    if (g.boundary) {
      const bound = await writeRole(entry.slug, ROLE_BOUNDARY, roleDoc(ROLE_BOUNDARY, g.tenQH, entry.slug, savedAt, {
        boundary: g.boundary, boundarySource: 'auto'
      }));
      via = bound.via;
    }
    try { await removeName(legacyName(entry.slug)); } catch (err) { /* chưa có file gộp */ }
  }
  const next = start + slice.length;
  const done = next >= pending.length;
  if (!done) return { cursor: next, total: pending.length, done: false, via, projects: pending.length };
  const entries = pending.map(g => ({ ...entryOf(g), dir: true }));
  const indexed = await updateIndex(cur => {
    const fresh = new Map(entries.map(e => [e.tenQH, e]));
    (cur.projects || []).forEach(p => { if (p && p.legacy === false && !p.deleted) fresh.set(p.tenQH, p); });
    const projects = [...fresh.values()].sort((a, b) => a.tenQH.localeCompare(b.tenQH, 'vi'));
    return { ...cur, migrated: true, projects };
  });
  const slim = { type: 'FeatureCollection', features: job.wardFeatures };
  const slimWrite = await writeText('cad_parcels.json', JSON.stringify(slim));
  invalidateCache();
  migrateJob = null;
  return {
    cursor: next, total: pending.length, done: true, via: slimWrite.via || indexed.via || via,
    projects: pending.length, wardParcels: job.wardFeatures.length
  };
}

async function lotsBySlug(slug) {
  if (!SLUG_RE.test(slug) || slug.length > 80) return null;
  const ht = await readRoleDoc(slug, ROLE_HT);
  const qh = await readRoleDoc(slug, ROLE_QH);
  let parcels = null;
  let points = [];
  let saved = 0;
  let tenQH = '';
  if (ht || qh) {
    parcels = [...((ht && ht.parcels) || []), ...((qh && qh.parcels) || [])];
    saved = Math.max(Number(ht && ht.saved) || 0, Number(qh && qh.saved) || 0);
    tenQH = (ht && ht.tenQH) || (qh && qh.tenQH) || '';
    try {
      const pts = await readRoleDoc(slug, ROLE_POINTS);
      if (pts && Array.isArray(pts.points)) points = pts.points;
    } catch (err) { console.warn(`Đọc điểm chức năng ${slug} lỗi:`, err.message); }
  } else {
    const got = await readJson(legacyName(slug));
    if (got.missing || !got.data) return null;
    parcels = Array.isArray(got.data.parcels) ? got.data.parcels : [];
    saved = got.data.saved || 0;
    tenQH = got.data.tenQH || '';
  }
  const payload = { v: 2, tenQH, slug, saved, parcels, points };
  if (JSON.stringify(payload).length > PROXY_MAX_CHARS) {
    const err = new Error('File đồ án lớn hơn 4 MB — trình duyệt cần đọc thẳng bucket (bật CORS cho storage.googleapis.com).');
    err.status = 413;
    throw err;
  }
  return payload;
}

async function legacyLots(tenQH) {
  const name = String(tenQH || '').trim();
  if (!name) return null;
  const parcels = (await getCadParcels()).filter(p => p && p.kind !== 'PROJECT' && asProjectName(p.file) === name && p.geometry);
  const payload = {
    v: 1, tenQH: name, slug: projectSlug(name), saved: 0,
    parcels: parcels.map(p => {
      const row = {
        kind: p.kind === 'DXF' ? 'DXF' : 'INFRA',
        id: p.id, phase: p.phase === 'QH' ? 'QH' : 'HT',
        layer: p.layer || '', area: p.area ?? null, geometry: p.geometry
      };
      if (row.kind === 'DXF') {
        row.name = p.name || '';
        row.nhom = p.nhom || '';
        row.ward = p.ward || '';
        if (p.plan) row.plan = p.plan;
      }
      return row;
    })
  };
  if (JSON.stringify(payload).length > PROXY_MAX_CHARS) {
    const err = new Error(`Đồ án «${name}» còn ở file cũ và lớn hơn 4 MB. Bấm «Chuyển lô cũ lên bucket» trong panel Đồ án (nên bật versioning trước).`);
    err.status = 413;
    throw err;
  }
  return payload;
}

// ============================ ĐIỀU CHỈNH CỤC BỘ ============================
// projects/adjustments.json — chỉ mục { v, items: [meta] }, gồm cả hồ sơ chờ duyệt (status pending | approved)
// projects/<slug>/adjust/<id>.json — ranh + lô đất mới; projects/<slug>/adjust/<id>.pdf — QĐ / bản vẽ scan ≤ 2 MB
const ADJUST_INDEX = 'projects/adjustments.json';
const ADJUST_ID_RE = /^[a-f0-9]{16}$/;
const ADJUST_PDF_MAX_BYTES = 2 * 1024 * 1024;
const ADJUST_DOC_MAX_CHARS = 1500000;
const ADJUST_PENDING_MAX = 40;
const ADJUST_LOTS_MAX = 400;
// Người gửi chưa đăng nhập chỉ gắn PDF cho hồ sơ vừa tạo, chưa có PDF, trong khoảng thời gian này
const ADJUST_PDF_WINDOW_MS = 15 * 60 * 1000;
let adjustCache = null; // { etag, generation, data }

function adjustError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function adjustObject(slug, id, ext) {
  return `projects/${slug}/adjust/${id}.${ext}`;
}

function emptyAdjust() {
  return { v: 1, items: [] };
}

async function readAdjustIndex() {
  let etag = null;
  try {
    const head = await axios.head(`${publicUrl(ADJUST_INDEX)}?v=${Date.now()}`, { timeout: 5000, validateStatus: () => true });
    if (head.status === 404) {
      adjustCache = null;
      return { missing: true, generation: '0', data: emptyAdjust() };
    }
    etag = head.headers.etag || head.headers['last-modified'] || null;
    if (adjustCache && etag && adjustCache.etag === etag) {
      return { missing: false, generation: adjustCache.generation, data: adjustCache.data };
    }
  } catch (err) { /* HEAD lỗi thì GET */ }
  const got = await readJson(ADJUST_INDEX);
  if (got.missing || !got.data || got.data.v !== 1 || !Array.isArray(got.data.items)) {
    return { missing: !!got.missing, generation: got.generation || '0', data: emptyAdjust() };
  }
  adjustCache = { etag: got.etag || etag, generation: got.generation, data: got.data };
  return { missing: false, generation: got.generation, data: got.data };
}

async function updateAdjustIndex(mutator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readAdjustIndex();
    const next = mutator({ ...cur.data, items: [...(cur.data.items || [])] });
    next.v = 1;
    next.saved = Date.now();
    try {
      const written = await writeText(ADJUST_INDEX, JSON.stringify(next), cur.missing ? '0' : (cur.generation || undefined));
      adjustCache = { etag: null, generation: written.generation || '', data: next };
      return { data: next, via: written.via };
    } catch (err) {
      if (err.code !== 'GEN' || attempt === 2) throw err;
      adjustCache = null;
    }
  }
  throw adjustError('Xung đột khi cập nhật danh sách điều chỉnh cục bộ', 409);
}

const r7 = (n) => Math.round(n * 1e7) / 1e7;

function cleanRing(ring) {
  const b = constants.HUE_BOUNDS;
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 20000) return null;
  const out = [];
  for (const c of ring) {
    if (!Array.isArray(c)) return null;
    const lng = Number(c[0]), lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null;
    out.push([r7(lng), r7(lat)]);
  }
  return out;
}

function cleanPolygonGeometry(g) {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!polys.length || polys.length > 200) return null;
  const out = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) return null;
    const rings = poly.map(cleanRing);
    if (rings.some(r => !r)) return null;
    out.push(rings);
  }
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

function cleanText(raw, max) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').slice(0, max);
}

function cleanAdjustLot(l) {
  const geometry = cleanPolygonGeometry(l && l.geometry);
  if (!geometry) return null;
  return {
    geometry,
    layer: cleanText(l.layer, 120),
    landKey: /^[a-z0-9_]{1,40}$/.test(String(l.landKey || '')) ? String(l.landKey) : '',
    subKey: /^[a-z0-9_]{1,20}$/.test(String(l.subKey || '')) ? String(l.subKey) : '',
    label: cleanText(l.label, 100),
    tone: /^#[0-9a-fA-F]{6}$/.test(String(l.tone || '')) ? String(l.tone) : '',
    area: Math.max(0, Math.round(Number(l.area) || 0))
  };
}

function adjustView(it) {
  return {
    id: it.id, tenQH: it.tenQH, slug: it.slug, status: it.status, title: it.title || '', codes: it.codes || [],
    boundary: it.boundary, bbox: it.bbox, lots: it.lots || 0, at: it.at || 0, stamp: it.stamp || '',
    sender: it.sender || '', note: it.note || '', verdict: it.verdict || '', pdf: it.pdf || null,
    approvedAt: it.approvedAt || 0
  };
}

/** Hồ sơ điều chỉnh cục bộ mới: Admin ghi thẳng (approved), người dùng vào hàng chờ (pending) */
async function saveAdjustment({ tenQH, boundary, lots, codes, title, sender, note, verdict, approved, by }) {
  const bound = cleanPolygonGeometry(boundary);
  if (!bound) throw adjustError('Ranh điều chỉnh không hợp lệ hoặc nằm ngoài TP. Huế', 400);
  if (!Array.isArray(lots) || !lots.length) throw adjustError('Hồ sơ chưa có lô đất trong ranh điều chỉnh', 400);
  if (lots.length > ADJUST_LOTS_MAX) throw adjustError(`Tối đa ${ADJUST_LOTS_MAX} lô đất mỗi hồ sơ`, 413);
  const clean = lots.map(cleanAdjustLot);
  if (clean.some(l => !l)) throw adjustError('Có lô đất sai hình học hoặc nằm ngoài TP. Huế', 400);
  const { name, slug } = await listedProject(tenQH);
  if (!approved) {
    const cur = await readAdjustIndex();
    if (cur.data.items.filter(x => x.status === 'pending').length >= ADJUST_PENDING_MAX) {
      throw adjustError('Hàng chờ duyệt điều chỉnh cục bộ đang đầy, vui lòng thử lại sau', 503);
    }
  }
  const id = crypto.randomBytes(8).toString('hex');
  const text = JSON.stringify({ v: 1, id, tenQH: name, boundary: bound, lots: clean });
  if (text.length > ADJUST_DOC_MAX_CHARS) throw adjustError('Hình ranh và lô đất lớn hơn 1,5 MB, hãy giản lược đỉnh trong CAD', 413);
  await writeText(adjustObject(slug, id, 'json'), text);
  const at = Date.now();
  const meta = {
    id, tenQH: name, slug, status: approved ? 'approved' : 'pending',
    title: cleanText(title, 300),
    codes: (Array.isArray(codes) ? codes : []).slice(0, 60).map(c => cleanText(c, 30)).filter(Boolean),
    boundary: bound, bbox: bboxOf(bound), lots: clean.length, at, stamp: vnStamp(at),
    sender: cleanText(sender, 80), note: cleanText(note, 300), verdict: cleanText(verdict, 40), pdf: null
  };
  if (approved) { meta.approvedAt = at; meta.by = cleanText(by, 120); }
  const saved = await updateAdjustIndex(cur => ({ ...cur, items: [...cur.items, meta] }));
  return { ...adjustView(meta), via: saved.via };
}

function pdfBytesOk(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.length <= ADJUST_PDF_MAX_BYTES
    && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

async function attachAdjustPdf({ id, fileName, buffer, admin }) {
  if (!ADJUST_ID_RE.test(String(id || ''))) throw adjustError('Mã hồ sơ không hợp lệ', 400);
  if (!pdfBytesOk(buffer)) {
    throw adjustError(buffer && buffer.length > ADJUST_PDF_MAX_BYTES ? 'File PDF lớn hơn 2 MB' : 'Chỉ nhận file PDF', buffer && buffer.length > ADJUST_PDF_MAX_BYTES ? 413 : 400);
  }
  const it = (await readAdjustIndex()).data.items.find(x => x.id === id);
  if (!it) throw adjustError('Không có hồ sơ điều chỉnh này', 404);
  if (!admin && (it.status !== 'pending' || it.pdf || Date.now() - (it.at || 0) > ADJUST_PDF_WINDOW_MS)) {
    throw adjustError('Chỉ gắn PDF ngay sau khi gửi hồ sơ', 403);
  }
  await writeBytes(adjustObject(it.slug, id, 'pdf'), buffer, 'application/pdf');
  const pdf = { name: decisionFileName(fileName), bytes: buffer.length, at: Date.now() };
  await updateAdjustIndex(cur => ({ ...cur, items: cur.items.map(x => (x.id === id ? { ...x, pdf } : x)) }));
  return pdf;
}

async function listAdjustments({ admin }) {
  const items = (await readAdjustIndex()).data.items || [];
  return items.filter(x => x && ADJUST_ID_RE.test(String(x.id)) && (admin || x.status === 'approved')).map(adjustView);
}

async function findAdjustment(id, admin) {
  if (!ADJUST_ID_RE.test(String(id || ''))) throw adjustError('Mã hồ sơ không hợp lệ', 400);
  const it = (await readAdjustIndex()).data.items.find(x => x.id === id);
  if (!it || (!admin && it.status !== 'approved')) throw adjustError('Không có hồ sơ điều chỉnh này', 404);
  return it;
}

async function readAdjustment(id, { admin }) {
  const it = await findAdjustment(id, admin);
  const got = await readJson(adjustObject(it.slug, it.id, 'json'));
  if (got.missing || !got.data || !Array.isArray(got.data.lots)) throw adjustError('File hồ sơ không còn trên bucket', 404);
  return { ...adjustView(it), lots: got.data.lots };
}

async function readAdjustPdf(id, { admin }) {
  const it = await findAdjustment(id, admin);
  if (!it.pdf) throw adjustError('Hồ sơ không kèm file PDF', 404);
  const res = await axios.get(`${publicUrl(adjustObject(it.slug, it.id, 'pdf'))}?v=${it.pdf.at || 0}`, {
    timeout: 20000, responseType: 'arraybuffer', maxContentLength: ADJUST_PDF_MAX_BYTES + 4096, validateStatus: () => true
  });
  if (res.status !== 200) throw adjustError(res.status === 404 ? 'File PDF không còn trên bucket' : `Đọc PDF lỗi HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  return { buffer: Buffer.from(res.data), name: decisionFileName(it.pdf.name) };
}

async function approveAdjustment(id, by) {
  await findAdjustment(id, true);
  const at = Date.now();
  await updateAdjustIndex(cur => ({
    ...cur, items: cur.items.map(x => (x.id === id ? { ...x, status: 'approved', approvedAt: at, by: cleanText(by, 120) } : x))
  }));
  return { id, approvedAt: at };
}

async function removeAdjustment(id) {
  const it = await findAdjustment(id, true);
  await updateAdjustIndex(cur => ({ ...cur, items: cur.items.filter(x => x.id !== id) }));
  for (const ext of ['json', 'pdf']) {
    try { await removeName(adjustObject(it.slug, it.id, ext)); } catch (err) { /* file chưa có */ }
  }
  return { id };
}

// Ranh lô không thuộc đồ án nào: lô công trình theo phường + lô đất DXF cũ chưa gắn Ten_QH
async function wardParcels() {
  const all = (await getCadParcels()).filter(p => p && p.kind !== 'PROJECT' && !p.file && p.geometry);
  const parcels = all.filter(p => p.kind !== 'DXF').map(p => ({
    id: p.id, phase: p.phase === 'QH' ? 'QH' : 'HT', layer: p.layer || '', area: p.area ?? null, geometry: p.geometry
  }));
  const lands = all.filter(p => p.kind === 'DXF').map(p => {
    const row = {
      kind: 'DXF', id: p.id, phase: p.phase === 'QH' ? 'QH' : 'HT', layer: p.layer || '', area: p.area ?? null,
      name: p.name || '', nhom: p.nhom || '', ward: p.ward || '', geometry: p.geometry
    };
    if (p.plan) row.plan = p.plan;
    return row;
  });
  if (JSON.stringify(parcels).length + JSON.stringify(lands).length > PROXY_MAX_CHARS) {
    const err = new Error('Ranh lô theo phường lớn hơn 4 MB');
    err.status = 413;
    throw err;
  }
  return { parcels, lands };
}

module.exports = {
  setTransport, projectTitle, projectSlug, catalog, saveChunk, patchBoundary, patchLand, deleteLot, retypeInfraLot, readLand, landToInfra, deleteLayer, deleteProjectFiles, renameProject,
  saveDecision, saveDecisionLink, reviewDecisionLink, removeDecision, readDecision,
  migratePage, lotsBySlug, legacyLots, wardParcels, applyPhaseParcels, namedPhase,
  saveAdjustment, attachAdjustPdf, listAdjustments, readAdjustment, readAdjustPdf, approveAdjustment, removeAdjustment
};
