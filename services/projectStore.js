// Đồ án trên bucket:
//   projects/index.json — danh mục + ranh tổng (để vẽ khung khi thu nhỏ) + diện tích lô đất theo phường × loại đất
//   projects/<slug>/hien-trang.json — bản đồ hiện trạng (lô HT)
//   projects/<slug>/su-dung-dat.json — chức năng sử dụng đất / bản đồ quy hoạch (lô QH)
//   projects/<slug>/diem-chuc-nang.json — điểm chức năng
//   projects/<slug>/ranh-gioi.json — ranh giới quy hoạch
//   projects/<slug>/quyet-dinh.pdf — PDF quyết định đã duyệt (admin ghi thẳng, tối đa 10 MB).
//   projects/<slug>/vb-<id>.pdf — văn bản kèm đã duyệt (quyết định đính chính / phê duyệt thêm, quy chế, thuyết minh), tối đa 8 file, cùng decisions.json.
//   Link ngoài nằm ở projects/decisions.json (kind: link), chỉ gán sau khi máy chủ mở được link.
//   projects/<slug>/ht-|qh-giao-thong|cap-nuoc|thoat-nuoc|cap-dien.json — bản vẽ hạ tầng riêng đồ án (bật/tắt, chưa nối mạng toàn thành phố).
//   cho-duyet/<hmac 32 hex>.pdf — PDF quyết định người dùng gửi (tối đa 2 MB). Chỉ mục projects/decision-proposals.json không ghi đường dẫn.
//   projects/<slug>/quyet-dinh-cho.pdf — đường cũ, chỉ đọc khi duyệt nốt rồi xóa.
//   projects/<slug>/adjust/<id>.json|.pdf — hồ sơ điều chỉnh cục bộ, chỉ mục ở projects/adjustments.json
// File cũ projects/<slug>.json vẫn đọc được cho tới lần ghi tiếp theo, rồi tách vào thư mục và xóa.
// Slug: bỏ dấu, chữ thường, tối đa 60 ký tự, thêm 8 ký tự SHA-256 của Ten_QH (cùng tên → cùng thư mục).
// Đồ án chưa chuyển (legacy) vẫn nằm trong cad_parcels.json cho tới khi migrate xong.
const axios = require('axios');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const constants = require('../config/constants');
const pdfLimits = require('./pdfLimits');
const gcsWrite = require('./gcsWrite');
const { pendingDecisionObject } = require('./pdfPaths');
const { getCadParcels, getRawDataList, invalidateCache } = require('./gcsService');

const INDEX_NAME = 'projects/index.json';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIGRATE_PAGE = 8;
const PROXY_MAX_CHARS = 4000000;
const SCRIPT_MAX_CHARS = 6000000;

let transport = null;
let indexCache = null; // { etag, data }
let splitProjectNameFn = null;

async function splitProjectName(tenQH) {
  if (!splitProjectNameFn) {
    ({ splitProjectName: splitProjectNameFn } = await import('../public/js/projectNames.js'));
  }
  return splitProjectNameFn(tenQH);
}

function withProjectNames(entry, pair) {
  if (!entry) return entry;
  const tenDayDu = String(entry.tenDayDu || '').trim();
  const tenRutGon = String(entry.tenRutGon || '').trim();
  return {
    ...entry,
    tenDayDu: tenDayDu || pair.tenDayDu,
    tenRutGon: tenRutGon || pair.tenRutGon
  };
}
let decisionsCache = null; // { etag, generation, data }
let proposalsCache = null; // { etag, generation, data }
let migrateJob = null; // { at, groups, wardFeatures }

function setTransport(fn) { transport = fn; }

function projectTitle(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(?:RG|HT|QH)[\s_\-]+(.+)$/i);
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
  for (let i = 0; i < projects.length; i++) {
    projects[i] = withProjectNames(projects[i], await splitProjectName(projects[i].tenQH));
  }
  await attachDecisions(projects);
  await attachProposals(projects);
  return { base: constants.PROJECTS_GCS_BASE, migrated, projects };
}

// ============================ QUYẾT ĐỊNH PHÊ DUYỆT (admin 10 MB, người dùng 2 MB) ============================

const DECISIONS_NAME = 'projects/decisions.json';
const DECISION_FILE = 'quyet-dinh.pdf';
const PROPOSALS_NAME = 'projects/decision-proposals.json';
const PROPOSAL_FILE = 'quyet-dinh-cho.pdf';
const STAGED_RE = /^[a-f0-9]{32}$/;
// Văn bản kèm theo đồ án. id 8 ký tự hex, file projects/<slug>/vb-<id>.pdf
// quy-dinh = quy chế theo đồ án (file cũ giữ mã này). Kind ChoDuyet quy-che là quy chế kiến trúc theo đơn vị.
const DOC_ROLES = { 'phe-duyet': 'Quyết định phê duyệt', 'dinh-chinh': 'Quyết định đính chính', 'quy-dinh': 'Quy chế', 'thuyet-minh': 'Thuyết minh' };

function docRoleLabel(role) {
  return DOC_ROLES[role] || '';
}
const DOC_MAX = 8;
const DOC_ID_RE = /^[a-f0-9]{8}$/;

function docObject(slug, id) {
  return `projects/${slug}/vb-${id}.pdf`;
}

function newDocId() {
  return crypto.randomBytes(4).toString('hex');
}

function docView(d, slug) {
  if (!d || !DOC_ID_RE.test(String(d.id || '')) || !Object.prototype.hasOwnProperty.call(DOC_ROLES, d.role)) return null;
  const link = d.kind === 'link' && /^https?:\/\//i.test(String(d.url || ''));
  return {
    id: d.id,
    role: d.role,
    slug: slug || d.slug || '',
    kind: link ? 'link' : 'pdf',
    url: link ? String(d.url) : '',
    name: decisionFileName(d.name),
    bytes: Number(d.bytes) || 0,
    at: Number(d.at) || 0,
    embed: link ? d.embed === true : true
  };
}

function docsView(item) {
  const slug = item && item.slug;
  return (item && Array.isArray(item.docs) ? item.docs : []).map(d => docView(d, slug)).filter(d => d && d.at);
}

function decisionObject(slug) {
  return `projects/${slug}/${DECISION_FILE}`;
}

function decisionFileName(raw) {
  const base = String(raw || '').replace(/[\u0000-\u001f"\\]/g, '').trim().slice(0, 120);
  if (!base) return 'Quyet-dinh-phe-duyet.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function pdfOk(buffer, maxBytes) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.length <= maxBytes
    && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

function rejectPdf(buffer, maxBytes) {
  const admin = maxBytes > pdfLimits.PDF_USER_MAX_BYTES;
  const tooBig = buffer && buffer.length > maxBytes;
  const err = new Error(tooBig ? pdfLimits.tooBigMessage(admin) : (buffer && buffer.length >= 5 ? 'Chỉ nhận file PDF.' : 'File PDF rỗng.'));
  err.status = tooBig ? 413 : 400;
  throw err;
}

function stagedObject(token) {
  if (!STAGED_RE.test(String(token || ''))) {
    const err = new Error('Mã file tải lên không hợp lệ.');
    err.status = 400;
    throw err;
  }
  return `projects/_pdf-in/${token}.pdf`;
}

async function discardStaged(name) {
  try { await gcsWrite.removeObject(name); } catch (err) { /* file tạm không còn */ }
}

// File admin đã PUT lên projects/_pdf-in. Kiểm tra cỡ, loại, magic %PDF rồi chép sang đích.
function saPdfError(err) {
  if (!err || err.code !== 'NO_SA') return err;
  const next = new Error('Tải PDF lớn hơn 2 MB cần service account ghi bucket (GEE_PRIVATE_KEY, quyền roles/storage.objectAdmin trên hue-infra-data-us).');
  next.status = 500;
  return next;
}

async function takeStagedPdf(token, destName, maxBytes) {
  const src = stagedObject(token);
  let meta;
  try { meta = await gcsWrite.objectMeta(src); }
  catch (err) { throw saPdfError(err); }
  if (!meta) {
    const err = new Error('Không thấy file PDF vừa tải. Chọn lại file.');
    err.status = 404;
    throw err;
  }
  if (meta.size > maxBytes) {
    await discardStaged(src);
    const err = new Error(pdfLimits.tooBigMessage(maxBytes > pdfLimits.PDF_USER_MAX_BYTES));
    err.status = 413;
    throw err;
  }
  if (meta.contentType && !/^application\/pdf\b/i.test(meta.contentType)) {
    await discardStaged(src);
    const err = new Error('Chỉ nhận file PDF.');
    err.status = 400;
    throw err;
  }
  let head;
  try { head = await gcsWrite.readBytes(src, 0, 4); }
  catch (err) { throw saPdfError(err); }
  if (head.length < 4 || head.toString('ascii', 0, 4) !== '%PDF') {
    await discardStaged(src);
    const err = new Error('Chỉ nhận file PDF.');
    err.status = 400;
    throw err;
  }
  try { await gcsWrite.rewriteObject(src, destName); }
  catch (err) { throw saPdfError(err); }
  await discardStaged(src);
  return meta.size;
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
      if (!d || !SLUG_RE.test(String(d.slug || ''))) return;
      const docs = docsView(d);
      if (docs.length) p.docs = docs;
      if (!d.at) return;
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

// Quyết định gắn cho lớp bản đồ dùng chung (không thuộc danh mục đồ án): khóa "lop:<mã>" trong decisions.json,
// PDF ở projects/lop-<mã>/quyet-dinh.pdf. Mã trùng data-layer-decision trong index.html.
const LAYER_DECISIONS = {
  'do-thi-hien-trang': 'Phân loại đô thị · hiện trạng',
  'do-thi-quy-hoach': 'Phân loại đô thị · quy hoạch',
  'qhc-2045': 'QHC đô thị Huế 2045'
};

function layerTarget(layer) {
  const id = String(layer || '');
  if (!Object.prototype.hasOwnProperty.call(LAYER_DECISIONS, id)) rejectReview('Lớp này không gắn được quyết định phê duyệt');
  return { name: `lop:${id}`, slug: `lop-${id}` };
}

function decisionTarget({ tenQH, layer }) {
  return layer ? layerTarget(layer) : listedProject(tenQH);
}

async function layerDecisions() {
  const items = (await readDecisions()).data.items || {};
  const out = {};
  Object.keys(LAYER_DECISIONS).forEach(id => {
    const d = items[`lop:${id}`];
    if (d && d.at) out[id] = decisionView(d);
  });
  return { titles: LAYER_DECISIONS, items: out };
}

async function removeLayerDecision(layer) {
  const { name, slug } = layerTarget(layer);
  return removeDecision(name, slug);
}

async function saveDecision({ tenQH, layer, fileName, buffer, stagedToken, maxBytes }) {
  const limit = maxBytes || pdfLimits.PDF_ADMIN_MAX_BYTES;
  const { name, slug } = await decisionTarget({ tenQH, layer });
  const dest = decisionObject(slug);
  let bytes = 0;
  let via = 'direct';
  if (stagedToken) {
    bytes = await takeStagedPdf(stagedToken, dest, limit);
  } else {
    if (!pdfOk(buffer, limit)) rejectPdf(buffer, limit);
    const written = await writeBytes(dest, buffer, 'application/pdf');
    via = written.via;
    bytes = buffer.length;
  }
  const at = Date.now();
  const meta = { kind: 'pdf', slug, name: decisionFileName(fileName), bytes, at, embed: true };
  const indexed = await updateDecisions(cur => {
    const items = { ...(cur.items || {}) };
    const prev = items[name];
    items[name] = { ...meta, docs: prev && Array.isArray(prev.docs) ? prev.docs : [] };
    return { ...cur, items };
  });
  return { ...decisionView(meta), via: via || indexed.via, accessUrl: publicUrl(decisionObject(slug)) };
}

// Gán link chỉ sau khi reviewDecisionLink mở được trang. File PDF cũ trên bucket bị gỡ.
async function saveDecisionLink({ tenQH, layer, url }) {
  const target = await decisionTarget({ tenQH, layer });
  const review = await reviewDecisionLink(url);
  const { name, slug } = target;
  const at = Date.now();
  const meta = {
    kind: 'link', slug, url: review.url, name: review.name, bytes: review.bytes, at, embed: review.embed
  };
  const indexed = await updateDecisions(cur => {
    const items = { ...(cur.items || {}) };
    const prev = items[name];
    items[name] = { ...meta, docs: prev && Array.isArray(prev.docs) ? prev.docs : [] };
    return { ...cur, items };
  });
  try { await removeName(decisionObject(slug)); } catch (err) { /* chưa có PDF trên bucket */ }
  return { ...decisionView(meta), via: indexed.via, note: review.note };
}

async function removeDecision(tenQH, fallbackSlug, opts = {}) {
  const keepDocs = opts.keepDocs !== false;
  const name = String(tenQH || '').trim();
  const cur = await readDecisions();
  const item = cur.data.items && cur.data.items[name];
  const slug = (item && item.slug) || fallbackSlug || '';
  const docs = item && Array.isArray(item.docs) ? item.docs : [];
  if (item) {
    await updateDecisions(base => {
      const items = { ...(base.items || {}) };
      if (keepDocs && docs.length && SLUG_RE.test(String(item.slug || slug))) {
        items[name] = { slug: item.slug || slug, docs };
      } else {
        delete items[name];
      }
      return { ...base, items };
    });
  }
  if (SLUG_RE.test(String(slug))) {
    try { await removeName(decisionObject(slug)); } catch (err) { /* file chưa có */ }
    if (!keepDocs) {
      for (const d of docs) {
        if (!d || d.kind === 'link' || !DOC_ID_RE.test(String(d.id || ''))) continue;
        try { await removeName(docObject(slug, d.id)); } catch (err) { /* file chưa có */ }
      }
    }
  }
  return { slug: slug || '' };
}

async function fetchStoredPdf(objectName, at, fileName) {
  const res = await axios.get(`${publicUrl(objectName)}?v=${at}`, {
    timeout: 20000,
    responseType: 'arraybuffer',
    maxContentLength: pdfLimits.PDF_PROXY_MAX_BYTES + 8192,
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
  return { buffer: Buffer.from(res.data), name: decisionFileName(fileName), at: Number(at) || 0 };
}

async function readDecision(slug, docId) {
  const key = String(slug || '');
  if (!SLUG_RE.test(key)) {
    const err = new Error('Mã đồ án không hợp lệ');
    err.status = 400;
    throw err;
  }
  const stored = await readDecisions();
  const items = stored.data.items || {};
  const meta = Object.keys(items).map(k => items[k]).find(d => d && d.slug === key);
  const wantDoc = String(docId || '');
  if (wantDoc) {
    if (!DOC_ID_RE.test(wantDoc)) rejectReview('Mã văn bản không hợp lệ');
    const doc = meta && (meta.docs || []).find(d => d && d.id === wantDoc && d.at);
    if (!doc) rejectReview('Không có văn bản này trong hồ sơ đồ án', 404);
    if (doc.kind === 'link') rejectReview('Văn bản này là link ngoài', 404);
    return deliverStoredPdf(docObject(key, wantDoc), doc.at, doc.name, doc.bytes);
  }
  if (!meta || !meta.at) rejectReview('Đồ án chưa có quyết định phê duyệt', 404);
  if (meta.kind === 'link') rejectReview('Quyết định này là link ngoài', 404);
  return deliverStoredPdf(decisionObject(key), meta.at, meta.name, meta.bytes);
}

function deliverStoredPdf(objectName, at, fileName, bytes) {
  const url = `${publicUrl(objectName)}?v=${at || 0}`;
  if (Number(bytes) > pdfLimits.PDF_PROXY_MAX_BYTES) {
    return { direct: true, url, name: decisionFileName(fileName), at: Number(at) || 0 };
  }
  return fetchStoredPdf(objectName, at, fileName);
}

async function saveProjectDoc({ tenQH, role, fileName, buffer, url, replaceId, stagedToken, fixedId }) {
  if (!Object.prototype.hasOwnProperty.call(DOC_ROLES, role)) rejectReview('Loại văn bản không hợp lệ');
  // fixedId giữ cùng mã khi duyệt lại một hồ sơ chờ, không thêm văn bản thứ hai.
  const fixed = DOC_ID_RE.test(String(fixedId || '')) ? String(fixedId) : '';
  const swap = !fixed && DOC_ID_RE.test(String(replaceId || '')) ? String(replaceId) : '';
  const { name, slug } = await listedProject(tenQH);
  const cur = await readDecisions();
  const prev = cur.data.items && cur.data.items[name];
  const existing = docsView(prev || {});
  if (swap && !existing.some(d => d.id === swap)) rejectReview('Không có văn bản này trong hồ sơ đồ án', 404);
  const id = fixed || swap || newDocId();
  const replacing = existing.some(d => d.id === id);
  if (!replacing && existing.length >= DOC_MAX) rejectReview(`Mỗi đồ án tối đa ${DOC_MAX} văn bản kèm theo`);
  let meta;
  let via = 'direct';
  if (url) {
    const review = await reviewDecisionLink(url);
    meta = {
      id, role, kind: 'link', url: review.url, name: review.name,
      bytes: review.bytes, at: Date.now(), embed: review.embed
    };
  } else {
    const dest = docObject(slug, id);
    let docBytes = 0;
    if (stagedToken) {
      docBytes = await takeStagedPdf(stagedToken, dest, pdfLimits.PDF_ADMIN_MAX_BYTES);
      via = 'direct';
    } else {
      if (!pdfOk(buffer, pdfLimits.PDF_ADMIN_MAX_BYTES)) rejectPdf(buffer, pdfLimits.PDF_ADMIN_MAX_BYTES);
      const written = await writeBytes(dest, buffer, 'application/pdf');
      via = written.via;
      docBytes = buffer.length;
    }
    meta = { id, role, kind: 'pdf', name: decisionFileName(fileName), bytes: docBytes, at: Date.now(), embed: true };
  }
  const indexed = await updateDecisions(c => {
    const items = { ...(c.items || {}) };
    const old = items[name] && typeof items[name] === 'object' ? items[name] : {};
    const list = Array.isArray(old.docs) ? old.docs.slice() : [];
    const at = list.findIndex(d => d && d.id === id);
    if (at >= 0) list[at] = meta;
    else list.push(meta);
    items[name] = { ...old, slug, docs: list };
    return { ...c, items };
  });
  const prevDoc = existing.find(d => d.id === id);
  if (url && prevDoc && prevDoc.kind !== 'link') {
    try { await removeName(docObject(slug, id)); } catch (err) { /* chưa có PDF */ }
  }
  const item = indexed.decisions.items[name];
  return { doc: docView(meta, slug), docs: docsView(item), via: via || indexed.via };
}

async function removeProjectDoc(tenQH, id) {
  if (!DOC_ID_RE.test(String(id || ''))) rejectReview('Mã văn bản không hợp lệ');
  const { name, slug } = await listedProject(tenQH);
  let removed = null;
  const indexed = await updateDecisions(c => {
    const items = { ...(c.items || {}) };
    const old = items[name];
    if (!old || !Array.isArray(old.docs)) return c;
    const list = old.docs.filter(d => {
      if (d && d.id === id) { removed = d; return false; }
      return true;
    });
    if (!removed) return c;
    const next = { ...old, docs: list };
    const still = next.at || list.length;
    if (still) items[name] = next;
    else delete items[name];
    return { ...c, items };
  });
  if (!removed) rejectReview('Không có văn bản này trong hồ sơ đồ án', 404);
  if (removed.kind !== 'link' && SLUG_RE.test(slug)) {
    try { await removeName(docObject(slug, id)); } catch (err) { /* file chưa có */ }
  }
  const item = indexed.decisions.items && indexed.decisions.items[name];
  return { docs: item ? docsView(item) : [] };
}

// ============================ QUYẾT ĐỊNH CHỜ DUYỆT (người dùng gửi PDF tối đa 2 MB) ============================

function proposalObject(slug) {
  return pendingDecisionObject(slug);
}

function legacyProposalObject(slug) {
  return `projects/${slug}/${PROPOSAL_FILE}`;
}

function proposalNames(slug) {
  const names = [legacyProposalObject(slug)];
  try { names.unshift(proposalObject(slug)); } catch (err) { /* chưa có khóa thì chỉ đụng đường cũ */ }
  return names;
}

function emptyProposals() {
  return { v: 1, items: {} };
}

function proposalView(d) {
  return {
    name: decisionFileName(d.name),
    bytes: Number(d.bytes) || 0,
    at: Number(d.at) || 0
  };
}

async function readProposals() {
  let etag = null;
  try {
    const head = await axios.head(`${publicUrl(PROPOSALS_NAME)}?v=${Date.now()}`, { timeout: 5000, validateStatus: () => true });
    if (head.status === 404) {
      proposalsCache = null;
      return { missing: true, generation: '0', data: emptyProposals() };
    }
    etag = head.headers.etag || head.headers['last-modified'] || null;
    if (proposalsCache && etag && proposalsCache.etag === etag) {
      return { missing: false, generation: proposalsCache.generation, data: proposalsCache.data };
    }
  } catch (err) { /* HEAD lỗi thì GET */ }
  const got = await readJson(PROPOSALS_NAME);
  if (got.missing || !got.data || got.data.v !== 1 || !got.data.items || typeof got.data.items !== 'object') {
    return { missing: !!got.missing, generation: got.generation || '0', data: emptyProposals() };
  }
  proposalsCache = { etag: got.etag || etag, generation: got.generation, data: got.data };
  return { missing: false, generation: got.generation, data: got.data };
}

async function updateProposals(mutator) {
  let via = 'direct';
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readProposals();
    const next = mutator(cur.data || emptyProposals());
    next.v = 1;
    next.items = next.items && typeof next.items === 'object' ? next.items : {};
    next.saved = Date.now();
    try {
      const written = await writeText(PROPOSALS_NAME, JSON.stringify(next), cur.missing ? '0' : (cur.generation || undefined));
      via = written.via;
      proposalsCache = { etag: null, generation: written.generation || '', data: next };
      return { proposals: next, via };
    } catch (err) {
      if (err.code !== 'GEN' || attempt === 2) throw err;
      proposalsCache = null;
    }
  }
  const err = new Error('Xung đột khi cập nhật file quyết định chờ duyệt');
  err.status = 409;
  throw err;
}

async function attachProposals(projects) {
  try {
    const stored = await readProposals();
    const items = stored.data.items || {};
    projects.forEach(p => {
      const d = items[p.tenQH];
      if (!d || !d.at || !SLUG_RE.test(String(d.slug || ''))) return;
      p.proposal = proposalView(d);
    });
  } catch (err) {
    console.warn('Đọc quyết định chờ duyệt lỗi:', err.message);
  }
}

async function saveDecisionProposal({ tenQH, fileName, buffer }) {
  if (!pdfOk(buffer, pdfLimits.PDF_USER_MAX_BYTES)) rejectPdf(buffer, pdfLimits.PDF_USER_MAX_BYTES);
  const { name, slug } = await listedProject(tenQH);
  const cur = await readProposals();
  if (cur.data.items && cur.data.items[name]) rejectReview('Đồ án đang có file quyết định chờ admin duyệt', 409);
  const dest = proposalObject(slug);
  await writeBytes(dest, buffer, 'application/pdf');
  try { await gcsWrite.patchCacheControl(dest, 'private, no-store'); } catch (err) { /* metadata không chặn lần ghi */ }
  try { await removeName(legacyProposalObject(slug)); } catch (err) { /* đường cũ không còn */ }
  const meta = { slug, name: decisionFileName(fileName), bytes: buffer.length, at: Date.now() };
  await updateProposals(base => {
    const items = { ...(base.items || {}) };
    if (items[name]) rejectReview('Đồ án đang có file quyết định chờ admin duyệt', 409);
    items[name] = meta;
    return { ...base, items };
  });
  return proposalView(meta);
}

async function readDecisionProposal(tenQH) {
  const name = String(tenQH || '').trim();
  const stored = await readProposals();
  const meta = stored.data.items && stored.data.items[name];
  if (!meta || !meta.at || !SLUG_RE.test(String(meta.slug || ''))) rejectReview('Không có file quyết định chờ duyệt', 404);
  let status = 404;
  for (const objectName of proposalNames(meta.slug)) {
    const res = await axios.get(`${publicUrl(objectName)}?v=${meta.at}`, {
      timeout: 20000,
      responseType: 'arraybuffer',
      maxContentLength: pdfLimits.PDF_USER_MAX_BYTES + 4096,
      validateStatus: () => true
    });
    status = res.status;
    if (res.status === 200) {
      return { buffer: Buffer.from(res.data), name: decisionFileName(meta.name), at: Number(meta.at) || 0 };
    }
    if (res.status !== 404) break;
  }
  if (status === 404) rejectReview('File quyết định chờ duyệt không còn trên bucket', 404);
  rejectReview(`Đọc file chờ duyệt lỗi HTTP ${status}`, 502);
}

async function clearProposal(tenQH, fallbackSlug) {
  const name = String(tenQH || '').trim();
  const cur = await readProposals();
  const item = cur.data.items && cur.data.items[name];
  const slug = (item && item.slug) || fallbackSlug || '';
  if (item) {
    await updateProposals(base => {
      const items = { ...(base.items || {}) };
      delete items[name];
      return { ...base, items };
    });
  }
  if (SLUG_RE.test(String(slug))) {
    for (const objectName of proposalNames(slug)) {
      try { await removeName(objectName); } catch (err) { /* file chưa có */ }
    }
  }
  return { slug: slug || '' };
}

async function approveDecisionProposal(tenQH) {
  const { name, slug } = await listedProject(tenQH);
  const stored = await readProposals();
  const meta = stored.data.items && stored.data.items[name];
  if (!meta || !meta.at || !SLUG_RE.test(String(meta.slug || ''))) rejectReview('Không có file quyết định chờ duyệt', 404);
  const dest = decisionObject(slug);
  let copied = false;
  let bytes = Number(meta.bytes) || 0;
  try {
    for (const src of proposalNames(slug)) {
      const info = await gcsWrite.objectMeta(src);
      if (!info) continue;
      await gcsWrite.rewriteObject(src, dest);
      bytes = info.size || bytes;
      copied = true;
      break;
    }
  } catch (err) {
    if (err.code !== 'NO_SA' && err.status !== 401 && err.status !== 403) throw err;
    copied = false;
  }
  let saved;
  if (copied) {
    const at = Date.now();
    const row = { kind: 'pdf', slug, name: decisionFileName(meta.name), bytes, at, embed: true };
    const indexed = await updateDecisions(cur => {
      const items = { ...(cur.items || {}) };
      const prev = items[name];
      items[name] = { ...row, docs: prev && Array.isArray(prev.docs) ? prev.docs : [] };
      return { ...cur, items };
    });
    saved = { ...decisionView(row), via: indexed.via, accessUrl: publicUrl(dest) };
  } else {
    const file = await readDecisionProposal(name);
    saved = await saveDecision({
      tenQH: name, fileName: file.name, buffer: file.buffer, maxBytes: pdfLimits.PDF_USER_MAX_BYTES
    });
  }
  await clearProposal(name, slug);
  return saved;
}

async function rejectDecisionProposal(tenQH) {
  const { name, slug } = await listedProject(tenQH);
  const cur = await readProposals();
  if (!cur.data.items || !cur.data.items[name]) rejectReview('Không có file quyết định chờ duyệt', 404);
  await clearProposal(name, slug);
  return { slug };
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
  // Đồ án đã đổi tên giữ thư mục cũ: slug lấy từ danh mục, chỉ đồ án mới mới sinh slug theo tên.
  // Đồ án khác từng mang tên này rồi đổi tên vẫn giữ slug đó → sinh slug khác, tránh ghi đè thư mục của nó.
  const listed = await readIndex();
  const listedProjects = (listed.data && listed.data.projects) || [];
  const known = listedProjects.find(p => p && p.tenQH === name && !p.deleted);
  let slug = known && known.slug;
  if (!slug) {
    const taken = new Set(listedProjects.filter(p => p && !p.deleted && p.slug && p.tenQH !== name).map(p => p.slug));
    slug = projectSlug(name);
    for (let n = 2; taken.has(slug); n++) slug = projectSlug(`${name}#${n}`);
  }
  const fromName = namedPhase(fileName);
  let resetLands = landsReset === 'HT' || landsReset === 'QH' || landsReset === true ? landsReset : false;
  if (resetLands === true && fromName) resetLands = fromName;
  let resetInfra = infraReset === 'HT' || infraReset === 'QH' || infraReset === 'BOTH' ? infraReset : null;
  if (fromName && resetInfra && resetInfra !== fromName && resetInfra !== 'BOTH') resetInfra = fromName;

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
    if (it.lotCode) row.lotCode = String(it.lotCode).slice(0, 40);
    if (Number(it.stampArea) > 0) row.stampArea = Math.round(Number(it.stampArea));
    landAdds.push(row);
  });

  const touch = (phase) => resetLands === true || resetLands === phase || resetInfra === phase || resetInfra === 'BOTH'
    || infraAdds.some(p => parcelPhase(p) === phase) || landAdds.some(p => parcelPhase(p) === phase);
  const touchHT = touch('HT') || !hadDir;
  const touchQH = touch('QH') || !hadDir;
  const savedAt = Date.now();
  if (touchHT) {
    ht = applyPhaseParcels(ht, 'HT', {
      resetLands: resetLands === true || resetLands === 'HT',
      resetInfra: resetInfra === 'HT' || resetInfra === 'BOTH',
      infraAdds, landAdds
    });
  }
  if (touchQH) {
    qh = applyPhaseParcels(qh, 'QH', {
      resetLands: resetLands === true || resetLands === 'QH',
      resetInfra: resetInfra === 'QH' || resetInfra === 'BOTH',
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
    const pair = await splitProjectName(name);
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
        tenDayDu: String(registry.tenDayDu || prevEntry.tenDayDu || '').trim() || pair.tenDayDu,
        tenRutGon: String(registry.tenRutGon || prevEntry.tenRutGon || '').trim() || pair.tenRutGon,
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
// sameLayer: áp cho mọi lô cùng giai đoạn, cùng layer (trước khi sửa) với lô id; không kèm geometry.
async function patchLand({ tenQH, id, phase, fields, sameLayer = false }) {
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
  let targets = [];
  let statsChanged = false;
  const savedAt = Date.now();
  const editAll = () => {
    const layer = land.layer || '';
    targets = sameLayer
      ? parcels.filter(p => p && p.kind === 'DXF' && parcelPhase(p) === want && (p.layer || '') === layer)
      : [land];
    return targets.reduce((changed, p) => editLandFields(p, fields) || changed, false);
  };
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
      statsChanged = editAll();
      const other = want === 'QH' ? ht : qh;
      const otherRole = want === 'QH' ? ROLE_HT : ROLE_QH;
      await writeRole(slug, otherRole, roleDoc(otherRole, name, slug, savedAt, { parcels: other }));
      await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels }));
      try { await removeName(legacyName(slug)); } catch (err) { /* file cũ đã xóa */ }
    }
  } else if (land) {
    statsChanged = editAll();
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
  const out = (p) => ({
    id: p.id, phase: want, name: p.name || '', nhom: p.nhom || '', layer: p.layer || '', plan: p.plan || null,
    ...(fields.geometry ? { geometry: p.geometry, area: p.area, lat: p.lat, lng: p.lng } : {})
  });
  return {
    saved: savedAt,
    via: indexed.via,
    land: out(land),
    ...(sameLayer ? { lands: targets.map(out) } : {})
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
  const want = phase === 'QH' ? 'QH' : 'HT';
  const match = infra
    ? (p) => p && p.kind === 'INFRA' && String(p.id) === id
    : (p) => p && p.kind === 'DXF' && p.id === id && parcelPhase(p) === want;
  const out = await dropParcels(entry, name, match);
  if (!out.removed && !infra) {
    const err = new Error(`Không tìm thấy lô ${id} (${want}) trong file đồ án «${name}»`);
    err.status = 404;
    throw err;
  }
  return out;
}

// Gỡ nhiều lô INFRA (kèm mảnh id.N) trong một lần ghi mỗi file vai trò
async function deleteInfraLots({ tenQH, ids }) {
  const name = String(tenQH || '').trim();
  const want = new Set((ids || []).map(String));
  if (!want.size) return { removed: 0 };
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) return { removed: 0 };
  return dropParcels(entry, name, (p) => p && p.kind === 'INFRA' && want.has(String(p.id).replace(/\.\d+$/, '')));
}

async function dropParcels(entry, name, match) {
  const slug = entry.slug || projectSlug(name);
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
  if (!removed) return { removed: 0 };
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

// Gỡ ghép lô QHPK khỏi danh sách hạ tầng: INFRA → DXF mã mới, giữ nguyên polygon.
// Đồ án cũ (không dir) hoặc không thấy lô: changed 0, missing true — lô QHCT vẫn được ghép.
async function unpairInfraLot({ tenQH, id, ids }) {
  const name = String(tenQH || '').trim();
  const bases = [...new Set((ids && ids.length ? ids : [id]).filter(Boolean).map((v) => String(v).replace(/\.\d+$/, '')))];
  if (!name || !bases.length) return { changed: 0, missing: true, newIds: [] };
  let entry;
  try {
    entry = await dirEntry(name, 'gỡ ghép lô');
  } catch (err) {
    if (err.status === 409 || err.status === 404) return { changed: 0, missing: true, newIds: [] };
    throw err;
  }
  const slug = entry.slug || projectSlug(name);
  const { unpairLotRows } = require('./planInfraSync');
  const docs = {};
  let max = 0;
  for (const role of [ROLE_HT, ROLE_QH]) {
    const doc = await readRoleDoc(slug, role);
    docs[role] = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
    docs[role].forEach((p) => {
      if (p && p.kind === 'DXF') max = Math.max(max, dxfNum(p.id));
    });
  }
  const savedAt = Date.now();
  let changed = 0;
  const newIds = [];
  for (const role of [ROLE_HT, ROLE_QH]) {
    let parcels = docs[role];
    let roleChanged = 0;
    bases.forEach((baseId) => {
      const step = unpairLotRows(parcels, baseId, max);
      if (!step.changed) return;
      max = step.nextNum;
      roleChanged += step.changed;
      parcels = step.parcels;
      newIds.push(...step.ids.map((row) => ({ ...row, role })));
    });
    if (!roleChanged) continue;
    changed += roleChanged;
    docs[role] = parcels;
    await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { parcels }));
  }
  if (!changed) return { changed: 0, missing: false, newIds };
  const all = [...docs[ROLE_HT], ...docs[ROLE_QH]];
  const counts = countParcels(all);
  const indexed = await updateIndex((cur) => ({
    ...cur,
    projects: (cur.projects || []).map((p) => (p && p.tenQH === name && !p.deleted
      ? { ...p, saved: savedAt, infra: counts.infra, lands: counts.lands, landArea: landAreaOf(all) }
      : p))
  }));
  return { changed, missing: false, newIds, saved: savedAt, via: indexed.via };
}

// Gắn nhiều lô DXF của một đồ án vào mã Sheet trong một lần ghi.
async function linkInfraLots({ tenQH, pairs }) {
  const name = String(tenQH || '').trim();
  const list = (pairs || []).filter((p) => p && p.id && p.newId && String(p.id) !== String(p.newId));
  if (!name || !list.length) return { changed: 0 };
  const entry = await dirEntry(name, 'ghép lô');
  const slug = entry.slug || projectSlug(name);
  const doc = await readRoleDoc(slug, ROLE_QH);
  const parcels = doc && Array.isArray(doc.parcels) ? doc.parcels : [];
  const byId = new Map(list.map((p) => [String(p.id), p]));
  const used = new Set();
  let changed = 0;
  const next = parcels.map((p) => {
    if (!p || p.kind !== 'DXF' || parcelPhase(p) !== 'QH') return p;
    const hit = byId.get(String(p.id));
    if (!hit || used.has(String(hit.newId))) return p;
    used.add(String(hit.newId));
    changed += 1;
    return {
      kind: 'INFRA', id: String(hit.newId), phase: 'QH', layer: hit.layer || p.layer || '',
      area: p.area ?? null, geometry: p.geometry, name: p.name || ''
    };
  });
  if (!changed) return { changed: 0 };
  const savedAt = Date.now();
  await writeRole(slug, ROLE_QH, roleDoc(ROLE_QH, name, slug, savedAt, { parcels: next }));
  const other = (await readRoleDoc(slug, ROLE_HT)) || { parcels: [] };
  const all = [...next, ...(other.parcels || [])];
  const counts = countParcels(all);
  const indexed = await updateIndex((cur) => ({
    ...cur,
    projects: (cur.projects || []).map((p) => (p && p.tenQH === name && !p.deleted
      ? { ...p, saved: savedAt, infra: counts.infra, lands: counts.lands, landArea: landAreaOf(all) }
      : p))
  }));
  return { changed, saved: savedAt, via: indexed.via };
}

// Lớp chính của đồ án = 1 file role (khớp PROJECT_LAYERS ở public/js/projectFiles.js)
const LAYER_ROLES = [ROLE_QH, ROLE_POINTS, ROLE_BOUNDARY, ROLE_HT];
// Bản vẽ riêng từng đồ án. Khớp NET_LAYERS. Ba role *-hoso là file cũ, không lên lớp.
// Form nhập của quản trị ghi su-dung-dat, hien-trang hoặc ranh-gioi (publishSchemeDraw).
// ht-thoat-nuoc giữ nguyên. Nước thải dùng ht-thoat-thai / qh-thoat-thai.
const NET_ROLES = [
  'ht-giao-thong', 'qh-giao-thong', 'ht-cap-nuoc', 'qh-cap-nuoc', 'ht-thoat-nuoc', 'qh-thoat-nuoc', 'ht-cap-dien', 'qh-cap-dien',
  'ht-san-nen', 'qh-san-nen', 'ht-thoat-thai', 'qh-thoat-thai', 'ht-chat-thai', 'qh-chat-thai', 'ht-vien-thong', 'qh-vien-thong',
  'ht-dat-hoso', 'qh-dat-hoso', 'ranh-hoso'
];
const NET_GEOM = new Set(['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);
const NET_MAX_FEATURES = 4000;
const NET_MAX_CHARS = 1500000;

function clipText(v, n) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
}

function cleanCoord(c) {
  if (!Array.isArray(c) || c.length < 2) return null;
  const x = Number(c[0]);
  const y = Number(c[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  return [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
}

function cleanLine(coords) {
  const pts = (Array.isArray(coords) ? coords : []).map(cleanCoord).filter(Boolean);
  return pts.length >= 2 ? pts : null;
}

function closeRing(coords) {
  const pts = (Array.isArray(coords) ? coords : []).map(cleanCoord).filter(Boolean);
  if (pts.length >= 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push([a[0], a[1]]);
  }
  return pts.length >= 4 ? pts : null;
}

function cleanGeom(g) {
  if (!g || !NET_GEOM.has(g.type)) return null;
  if (g.type === 'Point') {
    const xy = cleanCoord(g.coordinates);
    return xy ? { type: 'Point', coordinates: xy } : null;
  }
  if (g.type === 'LineString') {
    const pts = cleanLine(g.coordinates);
    return pts ? { type: 'LineString', coordinates: pts } : null;
  }
  if (g.type === 'MultiLineString') {
    const lines = (g.coordinates || []).map(cleanLine).filter(Boolean);
    return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
  }
  if (g.type === 'Polygon') {
    const rings = (g.coordinates || []).map(closeRing).filter(Boolean);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  const polys = (g.coordinates || []).map(poly => (Array.isArray(poly) ? poly.map(closeRing).filter(Boolean) : [])).filter(rings => rings.length);
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
}

const NET_AXIS = ['scheme', 'level', 'sector', 'kind', 'areaType', 'areaCode', 'areaParent', 'step', 'nhan'];
const NET_PROP_KEYS = ['quyMo', 'congSuat', 'loai', 'capDuong', 'loGioi', 'matCat', ...NET_AXIS];

function cleanNetProps(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const put = (key, n) => {
    const v = clipText(p[key], n);
    if (v) out[key] = v;
  };
  put('quyMo', 40);
  put('congSuat', 40);
  put('loai', 80);
  put('capDuong', 80);
  put('loGioi', 40);
  put('matCat', 80);
  NET_AXIS.forEach(key => put(key, key === 'scheme' || key === 'nhan' ? 120 : 40));
  let extra = 0;
  Object.keys(p).forEach(key => {
    if (extra >= 12 || NET_PROP_KEYS.includes(key) || out[key]) return;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(key)) return;
    const v = clipText(p[key], 80);
    if (!v) return;
    out[key] = v;
    extra += 1;
  });
  return out;
}

function cleanNetFeatures(features) {
  if (!Array.isArray(features)) rejectReview('Thiếu danh sách đối tượng bản vẽ');
  if (features.length > NET_MAX_FEATURES) rejectReview(`Bản vẽ nhiều hơn ${NET_MAX_FEATURES} đối tượng`);
  const out = [];
  features.forEach(f => {
    const geometry = cleanGeom(f && f.geometry);
    if (!geometry) return;
    const row = { id: `f${out.length + 1}`, name: clipText(f.name, 120), geometry };
    const props = cleanNetProps(f.props);
    if (Object.keys(props).length) row.props = props;
    out.push(row);
  });
  if (!out.length) rejectReview('Không có điểm, đường hoặc vùng hợp lệ (tọa độ kinh độ, vĩ độ)');
  if (JSON.stringify(out).length > NET_MAX_CHARS) rejectReview('Bản vẽ lớn hơn 1,5 MB');
  return out;
}

async function saveNet({ tenQH, role, features }) {
  if (!NET_ROLES.includes(role)) rejectReview('Lớp bản vẽ không hợp lệ');
  const name = String(tenQH || '').trim();
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted);
  if (!entry || !entry.dir) {
    rejectReview(`Đồ án «${name}» chưa có thư mục trên bucket. Nhập lớp sử dụng đất trước khi thêm bản vẽ hạ tầng.`, 409);
  }
  const slug = entry.slug || projectSlug(name);
  if (!SLUG_RE.test(slug)) rejectReview('Mã đồ án không hợp lệ');
  const clean = cleanNetFeatures(features);
  const savedAt = Date.now();
  const written = await writeRole(slug, role, roleDoc(role, name, slug, savedAt, { features: clean }));
  const nets = { ...(entry.nets || {}), [role]: clean.length };
  const indexed = await updateIndex(cur => ({
    ...cur,
    projects: (cur.projects || []).map(p => (p && p.tenQH === name && !p.deleted ? { ...p, saved: savedAt, nets } : p))
  }));
  return { saved: savedAt, count: clean.length, via: indexed.via || written.via };
}

function layerGone(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

// Admin xóa 1 lớp chính của đồ án. Lớp lô (HT / QH) ghi file rỗng để giữ thư mục đồ án; điểm chức năng, ranh giới xóa file.
// Xóa ranh vẫn giữ bbox trong danh mục để lô còn được tải theo khung nhìn. Dòng công trình trên Sheet giữ nguyên.
async function deleteLayer({ tenQH, role }) {
  const name = String(tenQH || '').trim();
  if (!LAYER_ROLES.includes(role) && !NET_ROLES.includes(role)) {
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
  if (NET_ROLES.includes(role)) {
    const doc = await readRoleDoc(slug, role);
    removed = doc && Array.isArray(doc.features) ? doc.features.length : 0;
    if (!removed) throw layerGone(`Đồ án «${name}» chưa có bản vẽ này`);
    await removeName(roleName(slug, role));
    const nets = { ...(entry.nets || {}) };
    delete nets[role];
    Object.assign(patch, { nets });
  } else if (role === ROLE_HT || role === ROLE_QH) {
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
  const names = [ROLE_HT, ROLE_QH, ROLE_POINTS, ROLE_BOUNDARY, ...NET_ROLES].map(role => roleName(slug, role));
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
  try { await removeDecision(name, slug, { keepDocs: false }); } catch (err) { console.warn(`Gỡ quyết định đồ án «${name}»:`, err.message); }
  try { await clearProposal(name, slug); } catch (err) { console.warn(`Gỡ quyết định chờ duyệt «${name}»:`, err.message); }
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
  const pair = await splitProjectName(newName);
  const indexed = await updateIndex(cur => {
    const projects = (cur.projects || [])
      .filter(p => !(p && p.deleted && p.tenQH === newName))
      .map(p => {
        if (!p || p.tenQH !== oldName || p.deleted) return p;
        slug = p.slug || projectSlug(oldName);
        return { ...p, tenQH: newName, tenDayDu: pair.tenDayDu, tenRutGon: pair.tenRutGon, slug };
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
  const proposals = await readProposals();
  if (proposals.data.items && proposals.data.items[oldName]) {
    await updateProposals(cur => {
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
    const code = String(props.KyHieu || '').trim();
    if (code) row.lotCode = code;
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
        if (p.lotCode) row.lotCode = p.lotCode;
        if (p.stampArea) row.stampArea = p.stampArea;
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
// projects/<slug>/adjust/<id>.json — ranh + lô đất mới; projects/<slug>/adjust/<id>.pdf — QĐ (người dùng 2 MB, admin 10 MB)
// projects/<slug>/adjust/<id>.scan — ảnh tờ bản vẽ scan (WebP/PNG/JPEG ≤ 2 MB); thông số định vị (3 góc ảnh) nằm trong chỉ mục
const ADJUST_INDEX = 'projects/adjustments.json';
const ADJUST_ID_RE = /^[a-f0-9]{16}$/;
const ADJUST_SCAN_MAX_BYTES = 2 * 1024 * 1024;
// Tờ A3 rộng hơn ranh điều chỉnh nhiều lần: góc ảnh được phép nằm ngoài khung TP. Huế trong khoảng này (độ)
const SCAN_MARGIN_DEG = 0.1;
const SCAN_GCP_MAX = 12;
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

function cleanPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const out = {};
  ['floors', 'coverage', 'far'].forEach(k => {
    const s = cleanText(plan[k], 20);
    if (s) out[k] = s;
  });
  return Object.keys(out).length ? out : null;
}

// Diện tích trắc địa (m²), cùng công thức turf.area ở trình duyệt: vòng ngoài trừ các lỗ
const AREA_EARTH_R = 6378137;
function ringAreaM2(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
    total += (p3[0] - p1[0]) * rad * Math.sin(p2[1] * rad);
  }
  return Math.abs(total * AREA_EARTH_R * AREA_EARTH_R / 2);
}

function geometryAreaM2(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.reduce((sum, rings) => sum + rings.reduce((s, r, i) => s + (i ? -ringAreaM2(r) : ringAreaM2(r)), 0), 0);
}

function cleanAdjustLot(l) {
  const geometry = cleanPolygonGeometry(l && l.geometry);
  if (!geometry) return null;
  const row = {
    geometry,
    layer: cleanText(l.layer, 120),
    // Khóa ký hiệu TT16 (tt16Symbols.js) để vẽ hoa văn; srcLayer: tên layer gốc khi người nhập chọn loại đất thủ công
    pattern: /^[A-Za-z0-9-]{1,12}$/.test(String(l.pattern || '')) ? String(l.pattern) : '',
    srcLayer: cleanText(l.srcLayer, 120),
    landKey: /^[a-z0-9_]{1,40}$/.test(String(l.landKey || '')) ? String(l.landKey) : '',
    subKey: /^[a-z0-9_]{1,20}$/.test(String(l.subKey || '')) ? String(l.subKey) : '',
    label: cleanText(l.label, 100),
    tone: /^#[0-9a-fA-F]{6}$/.test(String(l.tone || '')) ? String(l.tone) : '',
    area: Math.max(0, Math.round(Number(l.area) || 0))
  };
  const name = cleanText(l.name, 150);
  const nhom = cleanText(l.nhom, 40);
  const plan = cleanPlan(l.plan);
  const lotCode = cleanText(l.lotCode, 40);
  const stampArea = Math.round(Number(l.stampArea) || 0);
  if (name) row.name = name;
  if (nhom) row.nhom = nhom;
  if (plan) row.plan = plan;
  if (lotCode) row.lotCode = lotCode;
  if (stampArea > 0) row.stampArea = stampArea;
  return row;
}

const ADJUST_EDIT_KEYS = ['name', 'nhom', 'layer', 'pattern', 'label', 'tone', 'landKey', 'subKey', 'geometry', 'plan'];

// Chuỗi rỗng trong plan xóa chỉ tiêu đó. Đổi ranh thì tính lại diện tích; không gửi ranh thì giữ diện tích đã lưu
function mergeAdjustLot(lot, fields) {
  const next = { ...lot };
  ['name', 'nhom', 'layer', 'pattern', 'srcLayer', 'landKey', 'subKey', 'label', 'tone'].forEach(k => {
    if (fields[k] !== undefined) next[k] = fields[k];
  });
  if (fields.geometry) {
    const geometry = cleanPolygonGeometry(fields.geometry);
    if (!geometry) return null;
    const area = geometryAreaM2(geometry);
    if (!(area > 0) || area > 1e8) return null;
    next.geometry = geometry;
    next.area = Math.round(area);
  }
  if (fields.plan && typeof fields.plan === 'object') {
    const plan = { ...(next.plan || {}) };
    ['floors', 'coverage', 'far'].forEach(k => {
      if (fields.plan[k] === undefined) return;
      const s = cleanText(fields.plan[k], 20);
      if (s) plan[k] = s;
      else delete plan[k];
    });
    if (Object.keys(plan).length) next.plan = plan;
    else delete next.plan;
  }
  return next;
}

function adjustView(it) {
  return {
    id: it.id, tenQH: it.tenQH, slug: it.slug, status: it.status, title: it.title || '', codes: it.codes || [],
    boundary: it.boundary, bbox: it.bbox, lots: it.lots || 0, at: it.at || 0, stamp: it.stamp || '',
    sender: it.sender || '', note: it.note || '', verdict: it.verdict || '', pdf: it.pdf || null,
    scan: it.scan || null, approvedAt: it.approvedAt || 0
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

async function attachAdjustPdf({ id, fileName, buffer, stagedToken, admin }) {
  if (!ADJUST_ID_RE.test(String(id || ''))) throw adjustError('Mã hồ sơ không hợp lệ', 400);
  const limit = admin ? pdfLimits.PDF_ADMIN_MAX_BYTES : pdfLimits.PDF_USER_MAX_BYTES;
  if (stagedToken && !admin) throw adjustError('Chỉ admin tải được PDF lớn hơn 2 MB.', 403);
  const it = (await readAdjustIndex()).data.items.find(x => x.id === id);
  if (!it) throw adjustError('Không có hồ sơ điều chỉnh này', 404);
  if (!admin && (it.status !== 'pending' || it.pdf || Date.now() - (it.at || 0) > ADJUST_PDF_WINDOW_MS)) {
    throw adjustError('Chỉ gắn PDF ngay sau khi gửi hồ sơ', 403);
  }
  const dest = adjustObject(it.slug, id, 'pdf');
  let bytes = 0;
  if (stagedToken) bytes = await takeStagedPdf(stagedToken, dest, limit);
  else {
    if (!pdfOk(buffer, limit)) rejectPdf(buffer, limit);
    await writeBytes(dest, buffer, 'application/pdf');
    bytes = buffer.length;
  }
  const pdf = { name: decisionFileName(fileName), bytes, at: Date.now() };
  await updateAdjustIndex(cur => ({ ...cur, items: cur.items.map(x => (x.id === id ? { ...x, pdf } : x)) }));
  return pdf;
}

function scanType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > ADJUST_SCAN_MAX_BYTES) return '';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return '';
}

function scanLatLng(p) {
  const b = constants.HUE_BOUNDS;
  if (!Array.isArray(p)) return null;
  const lat = Number(p[0]), lng = Number(p[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < b.minLat - SCAN_MARGIN_DEG || lat > b.maxLat + SCAN_MARGIN_DEG
    || lng < b.minLng - SCAN_MARGIN_DEG || lng > b.maxLng + SCAN_MARGIN_DEG) return null;
  return [r7(lat), r7(lng)];
}

// { w, h, tl, tr, bl: [lat, lng] góc ảnh, gcps: [{ px: [x, y], ll: [lat, lng] }], rms: m }
function cleanGeoref(g) {
  if (!g || typeof g !== 'object') return null;
  const w = Math.round(Number(g.w)), h = Math.round(Number(g.h));
  if (!(w >= 16 && w <= 12000 && h >= 16 && h <= 12000)) return null;
  const tl = scanLatLng(g.tl), tr = scanLatLng(g.tr), bl = scanLatLng(g.bl);
  if (!tl || !tr || !bl) return null;
  const gcps = (Array.isArray(g.gcps) ? g.gcps : []).slice(0, SCAN_GCP_MAX).map(p => {
    const x = Number(p && p.px && p.px[0]), y = Number(p && p.px && p.px[1]);
    const ll = scanLatLng(p && p.ll);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > w || y > h || !ll) return null;
    return { px: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], ll };
  }).filter(Boolean);
  // 'fit': người dùng kéo, xoay ảnh khớp ranh nên không có điểm khống chế; 'gcp': affine giải từ ≥ 3 cặp điểm
  const mode = g.mode === 'fit' ? 'fit' : 'gcp';
  if (mode === 'gcp' && gcps.length < 3) return null;
  return {
    w, h, tl, tr, bl, mode,
    gcps: mode === 'fit' ? [] : gcps,
    rms: mode === 'fit' ? 0 : Math.max(0, Math.round((Number(g.rms) || 0) * 100) / 100)
  };
}

/**
 * Gắn ảnh tờ bản vẽ scan + thông số định vị. Không kèm ảnh: Admin chỉ cập nhật định vị cho ảnh đã có (ghép lại).
 * Người gửi chưa đăng nhập chỉ gắn một lần cho hồ sơ vừa tạo, như PDF.
 */
async function attachAdjustScan({ id, fileName, buffer, georef, admin }) {
  if (!ADJUST_ID_RE.test(String(id || ''))) throw adjustError('Mã hồ sơ không hợp lệ', 400);
  const geo = cleanGeoref(georef);
  if (!geo) throw adjustError('Thông số định vị ảnh không hợp lệ', 400);
  const it = (await readAdjustIndex()).data.items.find(x => x.id === id);
  if (!it) throw adjustError('Không có hồ sơ điều chỉnh này', 404);
  if (!admin && (it.status !== 'pending' || it.scan || Date.now() - (it.at || 0) > ADJUST_PDF_WINDOW_MS)) {
    throw adjustError('Chỉ gắn ảnh scan ngay sau khi gửi hồ sơ', 403);
  }
  let file;
  if (buffer) {
    const type = scanType(buffer);
    if (!type) {
      throw adjustError(buffer.length > ADJUST_SCAN_MAX_BYTES ? 'Ảnh scan lớn hơn 2 MB' : 'Chỉ nhận ảnh WebP, PNG hoặc JPEG', buffer.length > ADJUST_SCAN_MAX_BYTES ? 413 : 400);
    }
    try {
      await gcsWrite.putObject(adjustObject(it.slug, id, 'scan'), buffer, type);
    } catch (err) {
      if (err.code === 'NO_SA' || err.status === 401 || err.status === 403) throw adjustError('Máy chủ chưa có quyền ghi ảnh lên bucket', 502);
      throw err;
    }
    file = { name: cleanText(fileName, 120) || 'ban-ve-scan', bytes: buffer.length, type, at: Date.now() };
  } else {
    if (!admin || !it.scan) throw adjustError('Chưa có ảnh scan để định vị lại', 400);
    file = { name: it.scan.name, bytes: it.scan.bytes, type: it.scan.type, at: it.scan.at };
  }
  const scan = { ...file, ...geo, georefAt: Date.now() };
  await updateAdjustIndex(cur => ({ ...cur, items: cur.items.map(x => (x.id === id ? { ...x, scan } : x)) }));
  return scan;
}

async function readAdjustScan(id, { admin }) {
  const it = await findAdjustment(id, admin);
  if (!it.scan) throw adjustError('Hồ sơ không kèm ảnh scan', 404);
  const res = await axios.get(`${publicUrl(adjustObject(it.slug, it.id, 'scan'))}?v=${it.scan.at || 0}`, {
    timeout: 20000, responseType: 'arraybuffer', maxContentLength: ADJUST_SCAN_MAX_BYTES + 4096, validateStatus: () => true
  });
  if (res.status !== 200) throw adjustError(res.status === 404 ? 'Ảnh scan không còn trên bucket' : `Đọc ảnh scan lỗi HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  const buffer = Buffer.from(res.data);
  return { buffer, type: scanType(buffer) || it.scan.type || 'application/octet-stream' };
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
  const objectName = adjustObject(it.slug, it.id, 'pdf');
  const url = `${publicUrl(objectName)}?v=${it.pdf.at || 0}`;
  if (Number(it.pdf.bytes) > pdfLimits.PDF_PROXY_MAX_BYTES) {
    return { direct: true, url, name: decisionFileName(it.pdf.name) };
  }
  const res = await axios.get(url, {
    timeout: 20000, responseType: 'arraybuffer', maxContentLength: pdfLimits.PDF_PROXY_MAX_BYTES + 8192, validateStatus: () => true
  });
  if (res.status !== 200) throw adjustError(res.status === 404 ? 'File PDF không còn trên bucket' : `Đọc PDF lỗi HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  return { buffer: Buffer.from(res.data), name: decisionFileName(it.pdf.name) };
}

/** Admin sửa 1 lô trong file hồ sơ: lớp, loại đất, chỉ tiêu, ranh. Không đụng lô đồ án bên ngoài */
async function patchAdjustLot({ id, index, fields }) {
  if (!fields || typeof fields !== 'object' || !ADJUST_EDIT_KEYS.some(k => fields[k] !== undefined)) {
    throw adjustError('Thiếu thông tin cần sửa', 400);
  }
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) throw adjustError('Không xác định được lô đất', 400);
  for (let attempt = 0; attempt < 3; attempt++) {
    const it = await findAdjustment(id, true);
    const objectName = adjustObject(it.slug, it.id, 'json');
    const got = await readJson(objectName);
    if (got.missing || !got.data || !Array.isArray(got.data.lots)) throw adjustError('File hồ sơ không còn trên bucket', 404);
    if (i >= got.data.lots.length) throw adjustError('Lô đất không còn trong hồ sơ', 404);
    const merged = mergeAdjustLot(got.data.lots[i], fields);
    const clean = merged && cleanAdjustLot(merged);
    if (!clean) throw adjustError('Thông tin lô không hợp lệ hoặc ranh nằm ngoài TP. Huế', 400);
    const lots = got.data.lots.slice();
    lots[i] = clean;
    const text = JSON.stringify({ ...got.data, lots });
    if (text.length > ADJUST_DOC_MAX_CHARS) throw adjustError('Hồ sơ lớn hơn 1,5 MB sau khi sửa ranh', 413);
    try {
      await writeText(objectName, text, got.generation || undefined);
    } catch (err) {
      if (err.code === 'GEN' && attempt < 2) continue;
      if (err.code === 'GEN') throw adjustError('Hồ sơ vừa được sửa ở phiên khác, bấm Lưu lại', 409);
      throw err;
    }
    const at = Date.now();
    const stamp = vnStamp(at);
    try {
      await updateAdjustIndex(cur => ({
        ...cur, items: cur.items.map(x => (x.id === id ? { ...x, at, stamp } : x))
      }));
    } catch (err) { /* lô đã ghi; mốc thời gian trên danh sách cập nhật lần mở sau */ }
    return { lot: clean, index: i, at, stamp };
  }
  throw adjustError('Không ghi được lô điều chỉnh', 409);
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
  for (const ext of ['json', 'pdf', 'scan']) {
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
    if (p.lotCode) row.lotCode = p.lotCode;
    if (p.stampArea) row.stampArea = p.stampArea;
    return row;
  });
  if (JSON.stringify(parcels).length + JSON.stringify(lands).length > PROXY_MAX_CHARS) {
    const err = new Error('Ranh lô theo phường lớn hơn 4 MB');
    err.status = 413;
    throw err;
  }
  return { parcels, lands };
}

const KIEN_TRUC_UNIT = /^(tp:TP|dothi:[a-z0-9]+(?:-[a-z0-9]+)*|xa:[a-z0-9]+(?:-[a-z0-9]+)*)$/;

function kienTrucObject(unitKey) {
  return `kien-truc/${String(unitKey).replace(':', '-').toLowerCase()}/quy-che.pdf`;
}

async function stampShortCache(name) {
  try {
    const { cacheControlFor } = await import('../config/gcsCachePolicy.mjs');
    const cc = cacheControlFor(name);
    if (cc) await gcsWrite.patchCacheControl(name, cc);
  } catch (err) { /* metadata cache không chặn lần ghi */ }
}

async function saveKienTrucPdf({ unitKey, fileName, buffer, stagedToken }) {
  if (!KIEN_TRUC_UNIT.test(String(unitKey || ''))) {
    const err = new Error('Đơn vị không hợp lệ');
    err.status = 400;
    throw err;
  }
  const dest = kienTrucObject(unitKey);
  let bytes = 0;
  let via = 'direct';
  if (stagedToken) {
    bytes = await takeStagedPdf(stagedToken, dest, pdfLimits.PDF_ADMIN_MAX_BYTES);
  } else {
    if (!pdfOk(buffer, pdfLimits.PDF_ADMIN_MAX_BYTES)) rejectPdf(buffer, pdfLimits.PDF_ADMIN_MAX_BYTES);
    const written = await writeBytes(dest, buffer, 'application/pdf');
    via = written.via;
    bytes = buffer.length;
  }
  await stampShortCache(dest);
  return { name: decisionFileName(fileName), bytes, url: `${publicUrl(dest)}?v=${Date.now()}`, via };
}

// Quản trị (hoặc lúc duyệt hàng chờ): bản vẽ sử dụng đất / ranh thành lớp đồ án.
// Đồ án đã có lớp cùng vai trò trong su-dung-dat-index.json, hoặc file lô đã có polygon, thì không ghi thêm.
async function publishSchemeDraw({ tenQH, kind, features }) {
  const dedupe = require('./landDedupe');
  const name = String(tenQH || '').trim();
  if (!name) rejectReview('Thiếu tên đồ án');
  const stored = await readIndex();
  const entry = ((stored.data && stored.data.projects) || []).find(p => p && p.tenQH === name && !p.deleted) || null;
  const slug = entry && (entry.slug || projectSlug(name));
  const index = dedupe.loadLandIndex();
  if (kind === ROLE_QH || kind === ROLE_HT) {
    const phase = kind === ROLE_QH ? 'QH' : 'HT';
    const role = phase === 'QH' ? 'quy-hoach' : 'hien-trang';
    if (dedupe.schemeHasLand(index, { tenQH: name, slug }, role)) return { skipped: true, reason: 'da-co' };
    if (slug && SLUG_RE.test(slug)) {
      const doc = await readRoleDoc(slug, kind);
      if (dedupe.dxfCount(doc, phase) > 0) return { skipped: true, reason: 'da-co' };
    }
    const lands = dedupe.landsFromFeatures(features, phase).map(row => {
      const geometry = cleanGeom(row.geometry);
      return geometry ? { ...row, geometry } : null;
    }).filter(Boolean);
    if (!lands.length) rejectReview('Bản vẽ sử dụng đất cần vùng (polygon)');
    const saved = await saveChunk({
      tenQH: name,
      fileName: name,
      lands,
      landsReset: phase,
      registry: { keepBoundary: true }
    });
    return { skipped: false, slug: saved.slug, lands: saved.lands };
  }
  if (kind === ROLE_BOUNDARY) {
    const raw = dedupe.boundaryFromFeatures(features);
    const boundary = raw && cleanGeom(raw);
    if (!boundary) rejectReview('Ranh giới cần vùng (polygon)');
    if (entry && entry.boundary) return { skipped: true, reason: 'da-co-ranh' };
    if (slug && SLUG_RE.test(slug)) {
      const doc = await readRoleDoc(slug, ROLE_BOUNDARY);
      if (doc && doc.boundary) return { skipped: true, reason: 'da-co-ranh' };
    }
    if (entry && entry.dir) {
      const done = await patchBoundary({ tenQH: name, boundary, boundarySource: 'gis' });
      return { skipped: false, slug: done.slug };
    }
    const saved = await saveChunk({
      tenQH: name,
      fileName: name,
      lands: [],
      registry: { boundary, boundarySource: 'gis', keepBoundary: false }
    });
    return { skipped: false, slug: saved.slug };
  }
  rejectReview('Lớp bản vẽ không hợp lệ');
}

module.exports = {
  setTransport, projectTitle, projectSlug, splitProjectName, catalog, saveChunk, patchBoundary, patchLand, deleteLot, deleteInfraLots, retypeInfraLot, readLand, landToInfra, unpairInfraLot, linkInfraLots, deleteLayer, deleteProjectFiles, renameProject, publishSchemeDraw,
  saveDecision, saveDecisionLink, reviewDecisionLink, removeDecision, readDecision, layerDecisions, removeLayerDecision,
  saveProjectDoc, removeProjectDoc, docRoleLabel, saveNet, saveKienTrucPdf,
  saveDecisionProposal, readDecisionProposal, approveDecisionProposal, rejectDecisionProposal,
  migratePage, lotsBySlug, legacyLots, wardParcels, applyPhaseParcels, namedPhase,
  saveAdjustment, attachAdjustPdf, attachAdjustScan, listAdjustments, readAdjustment, readAdjustPdf, readAdjustScan,
  patchAdjustLot, approveAdjustment, removeAdjustment
};
