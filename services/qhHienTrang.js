// Phân loại lô nhập từ file QH-* (da_co / can_kiem_tra / chua_co).
// Kết quả không gian nằm trong public/data/gba/qh-hientrang.json.
// Quyết định quản trị và lô nhập sau lần phân loại ghi ở gba/qh-hientrang.json trên bucket (không sửa Sheet).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const constants = require('../config/constants');
const gcsWrite = require('./gcsWrite');

const OBJECT_NAME = 'gba/qh-hientrang.json';
const BUNDLED = path.join(__dirname, '..', 'public', 'data', 'gba', 'qh-hientrang.json');
const CLASSES = new Set(['da_co', 'can_kiem_tra', 'chua_co']);
const CACHE_MS = 60 * 1000;
let cache = null;

function asRow(row) {
  if (!Array.isArray(row) || !CLASSES.has(row[0])) return null;
  return [row[0], String(row[1] || '').slice(0, 400)];
}

function normalize(data) {
  const auto = {};
  const src = data && data.auto && typeof data.auto === 'object' ? data.auto : {};
  Object.keys(src).forEach(id => {
    const row = asRow(src[id]);
    if (row) auto[String(id)] = row;
  });
  const extra = {};
  const ex = data && data.extra && typeof data.extra === 'object' ? data.extra : {};
  Object.keys(ex).forEach(id => {
    const row = asRow(ex[id]);
    if (row) extra[String(id)] = row;
  });
  const overrides = {};
  const ov = data && data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
  Object.keys(ov).forEach(id => {
    const row = ov[id];
    if (!row || (row.cls !== 'da_co' && row.cls !== 'chua_co')) return;
    overrides[String(id)] = {
      cls: row.cls,
      at: String(row.at || ''),
      by: String(row.by || '').slice(0, 80)
    };
  });
  return {
    v: 1,
    builtAt: String((data && data.builtAt) || ''),
    rules: String((data && data.rules) || ''),
    auto,
    extra,
    overrides
  };
}

function readBundled() {
  return normalize(JSON.parse(fs.readFileSync(BUNDLED, 'utf8')));
}

// File bucket chỉ giữ quyết định và lô mới. Bản đóng gói mới hơn thì lấy lại auto, vẫn giữ quyết định.
function mergePack(bundled, remote) {
  const base = bundled || { v: 1, builtAt: '', rules: '', auto: {}, extra: {}, overrides: {} };
  if (!remote) return { ...base, extra: { ...(base.extra || {}) }, overrides: { ...(base.overrides || {}) } };
  const extra = { ...(remote.extra || {}) };
  const remoteNewer = String(remote.builtAt || '') >= String(base.builtAt || '')
    && remote.auto && Object.keys(remote.auto).length > Object.keys(base.auto).length;
  const auto = remoteNewer ? { ...remote.auto, ...extra } : { ...base.auto, ...extra };
  return {
    v: 1,
    builtAt: remoteNewer ? remote.builtAt : base.builtAt,
    rules: base.rules || remote.rules || '',
    auto,
    extra,
    overrides: { ...(remote.overrides || {}) }
  };
}

async function readRemote() {
  try {
    const r = await axios.get(`${constants.GBA_GCS_BASE}qh-hientrang.json?v=${Date.now()}`, {
      timeout: 12000,
      validateStatus: () => true
    });
    if (r.status === 404 || r.status === 400) return null;
    if (r.status !== 200 || !r.data || typeof r.data !== 'object') return null;
    return normalize(r.data);
  } catch (err) {
    return null;
  }
}

async function loadPack() {
  if (cache && cache.exp > Date.now()) return cache.pack;
  const pack = mergePack(readBundled(), await readRemote());
  cache = { exp: Date.now() + CACHE_MS, pack };
  return pack;
}

function clearCache() {
  cache = null;
}

function effective(pack, id) {
  const row = pack && pack.auto && pack.auto[id];
  const o = pack && pack.overrides && pack.overrides[id];
  if (o && (o.cls === 'da_co' || o.cls === 'chua_co')) {
    const base = row ? row[1] : '';
    const reason = o.cls === 'da_co'
      ? (base ? `Quản trị xác nhận đã có. ${base}` : 'Quản trị xác nhận đã có.')
      : 'Quản trị xác nhận chưa có.';
    return { cls: o.cls, reason, override: true, auto: row ? row[0] : '' };
  }
  if (!row) return null;
  return { cls: row[0], reason: row[1] || '', override: false, auto: row[0] };
}

// Lô da_co (kể cả quản trị xác nhận) được tính như hiện trạng: không sửa Sheet, chỉ đổi bản sao trong bộ nhớ.
function apply(list, pack) {
  if (!pack || !pack.auto) return list || [];
  return (list || []).map(it => {
    if (!it || it.planChange !== 'new') return it;
    const eff = effective(pack, it.id);
    if (!eff || eff.cls !== 'da_co') return it;
    const size = it.sizeQH != null ? it.sizeQH : it.size;
    return {
      ...it,
      size: size || 0,
      sizeHT: size,
      planChange: 'keep',
      qhProven: true,
      qhReason: eff.reason,
      qhClass: 'da_co'
    };
  });
}

function isQhImport(it) {
  return !!(it && it.planChange === 'new' && String(it.note || '').startsWith('Nhập từ file'));
}

// Giữ kết quả không gian đã chốt. Lô QH nhập sau lần đó vào hàng cần kiểm tra, không ghi đè quyết định quản trị.
function reclassify(pack, items) {
  const extra = { ...(pack.extra || {}) };
  const known = new Set([...Object.keys(pack.auto || {}), ...Object.keys(extra)]);
  const live = new Set((items || []).map(it => it.id));
  let added = 0;
  let dropped = 0;
  Object.keys(extra).forEach(id => {
    if (!live.has(id)) {
      delete extra[id];
      dropped += 1;
    }
  });
  (items || []).forEach(it => {
    if (!isQhImport(it) || known.has(it.id)) return;
    extra[it.id] = ['can_kiem_tra', 'Lô nhập sau lần phân loại không gian. Cần kiểm tra.'];
    added += 1;
  });
  return { extra, added, dropped };
}

async function writeRemote(pack) {
  const body = JSON.stringify({
    v: 1,
    builtAt: pack.builtAt || '',
    overrides: pack.overrides || {},
    extra: pack.extra || {}
  });
  await gcsWrite.putJson(OBJECT_NAME, body);
  clearCache();
}

function reviewRows(pack, items) {
  const byId = new Map((items || []).map(it => [it.id, it]));
  const ids = new Set([
    ...Object.keys((pack && pack.auto) || {}),
    ...Object.keys((pack && pack.overrides) || {})
  ]);
  const rows = [];
  ids.forEach(id => {
    const eff = effective(pack, id);
    if (!eff || (eff.cls !== 'can_kiem_tra' && !eff.override)) return;
    const it = byId.get(id);
    if (!it) return;
    rows.push({
      id,
      name: it.name || '',
      type: it.type,
      ward: it.ward || '',
      lat: it.lat,
      lng: it.lng,
      cls: eff.cls,
      auto: eff.auto,
      reason: eff.reason,
      override: !!eff.override
    });
  });
  rows.sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name), 'vi'));
  return rows;
}

function countClasses(pack) {
  const c = { da_co: 0, can_kiem_tra: 0, chua_co: 0 };
  Object.keys((pack && pack.auto) || {}).forEach(id => {
    const eff = effective(pack, id);
    if (eff && c[eff.cls] != null) c[eff.cls] += 1;
  });
  return c;
}

module.exports = {
  OBJECT_NAME,
  loadPack,
  clearCache,
  apply,
  effective,
  reclassify,
  writeRemote,
  reviewRows,
  mergePack,
  normalize,
  isQhImport,
  countClasses
};
