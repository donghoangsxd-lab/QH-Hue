// Đồ án trên bucket:
//   projects/index.json — danh mục + ranh tổng + diện tích lô đất theo phường × loại đất (không có ranh từng lô)
//   projects/<slug>.json — ranh lô công trình (INFRA) và lô đất (DXF) của một đồ án
// Slug: bỏ dấu, chữ thường, tối đa 60 ký tự, thêm 8 ký tự SHA-256 của Ten_QH (cùng tên → cùng file).
// Đồ án chưa chuyển (legacy) vẫn nằm trong cad_parcels.json cho tới khi migrate xong.
const axios = require('axios');
const crypto = require('crypto');
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
let migrateJob = null; // { at, groups, wardFeatures }

function setTransport(fn) { transport = fn; }

function projectTitle(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(?:HT|QH)[\s_\-]+(.+)$/i);
  return String(m ? m[1] : base).slice(0, 120);
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
  return { base: constants.PROJECTS_GCS_BASE, migrated, projects };
}

function dxfNum(id) {
  const m = String(id || '').match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

async function saveChunk({ tenQH, fileName, items, lotIds, lands, landsReset, registry }) {
  const name = String(tenQH || '').trim();
  if (!name) {
    const err = new Error('Thiếu tên đồ án');
    err.status = 400;
    throw err;
  }
  const slug = projectSlug(name);
  const objectName = `projects/${slug}.json`;
  const got = await readJson(objectName);
  const prev = (!got.missing && got.data && got.data.tenQH === name && Array.isArray(got.data.parcels)) ? got.data.parcels : [];
  const infra = new Map();
  const dxf = [];
  prev.forEach(p => {
    if (!p || !p.geometry) return;
    if (p.kind === 'DXF') { if (!landsReset) dxf.push(p); return; }
    infra.set(`${p.phase === 'QH' ? 'QH' : 'HT'}|${p.id}`, p);
  });
  (items || []).forEach((it, i) => {
    const id = lotIds && lotIds[i];
    if (!id || !it) return;
    (it.stages || []).forEach(st => {
      if (!st || !st.geometry) return;
      const phase = st.phase === 'QH' ? 'QH' : 'HT';
      infra.set(`${phase}|${id}`, {
        kind: 'INFRA', id: String(id), phase, layer: st.layer || '', area: st.area ?? null, geometry: st.geometry
      });
    });
  });
  let nextNum = dxf.reduce((m, p) => Math.max(m, dxfNum(p.id)), 0);
  (lands || []).forEach(it => {
    if (!it || !it.geometry) return;
    nextNum += 1;
    const row = {
      kind: 'DXF',
      id: `DXF-${nextNum < 1000 ? String(nextNum).padStart(3, '0') : String(nextNum)}`,
      phase: it.phase === 'QH' ? 'QH' : 'HT',
      layer: it.layer || '',
      area: it.area ?? null,
      name: it.name || '',
      nhom: it.nhom || '',
      ward: it.ward || '',
      geometry: it.geometry
    };
    if (it.plan) row.plan = it.plan;
    dxf.push(row);
  });
  const savedAt = Date.now();
  const payload = { v: 1, tenQH: name, slug, saved: savedAt, parcels: [...infra.values(), ...dxf] };
  const written = await writeText(objectName, JSON.stringify(payload));
  let via = written.via;
  if (registry) {
    const indexed = await updateIndex(cur => {
      const projects = (cur.projects || []).filter(p => p.tenQH !== name);
      projects.push({
        tenQH: name,
        slug,
        file: fileName || name,
        wards: registry.wards || [],
        infra: registry.infra || 0,
        lands: registry.lands || 0,
        time: vnStamp(savedAt),
        boundary: registry.boundary || null,
        bbox: bboxOf(registry.boundary),
        landArea: registry.landArea || {},
        legacy: false,
        saved: savedAt
      });
      projects.sort((a, b) => a.tenQH.localeCompare(b.tenQH, 'vi'));
      return { ...cur, projects };
    });
    via = indexed.via;
  }
  return { slug, via, lands: dxf.length };
}

async function deleteProjectFiles(tenQH) {
  const name = String(tenQH || '').trim();
  const stored = await readIndex();
  const projects = (!stored.missing && stored.data && stored.data.projects) || [];
  const entry = projects.find(p => p.tenQH === name);
  const slug = (entry && entry.slug) || projectSlug(name);
  const objectName = `projects/${slug}.json`;
  let landCount = 0;
  try {
    const got = await readJson(objectName);
    if (!got.missing && got.data && Array.isArray(got.data.parcels)) {
      landCount = got.data.parcels.filter(p => p.kind === 'DXF').length;
    }
  } catch (err) { /* file chưa có */ }
  let via = 'direct';
  try { via = await removeName(objectName); } catch (err) { /* đồ án cũ chưa có file riêng */ }
  const indexed = await updateIndex(cur => {
    const projects = (cur.projects || []).filter(p => p.tenQH !== name);
    if (!cur.migrated) projects.push({ tenQH: name, deleted: true });
    return { ...cur, projects };
  });
  return { slug, landCount, via: indexed.via || via };
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
    const payload = { v: 1, tenQH: g.tenQH, slug: entry.slug, saved: entry.saved, parcels: g.parcels };
    const written = await writeText(`projects/${entry.slug}.json`, JSON.stringify(payload));
    via = written.via;
  }
  const next = start + slice.length;
  const done = next >= pending.length;
  if (!done) return { cursor: next, total: pending.length, done: false, via, projects: pending.length };
  const entries = pending.map(entryOf);
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
  const got = await readJson(`projects/${slug}.json`);
  if (got.missing || !got.data) return null;
  const text = JSON.stringify(got.data);
  if (text.length > PROXY_MAX_CHARS) {
    const err = new Error('File đồ án lớn hơn 4 MB — trình duyệt cần đọc thẳng bucket (bật CORS cho storage.googleapis.com).');
    err.status = 413;
    throw err;
  }
  return got.data;
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
  setTransport, projectTitle, projectSlug, catalog, saveChunk, deleteProjectFiles,
  migratePage, lotsBySlug, legacyLots, wardParcels
};
