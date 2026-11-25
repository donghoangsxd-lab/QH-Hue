// Chỉ mục công khai ranh dự án đang chờ duyệt — mọi client đọc để hiện trạng và chặn ghi đè.
const gcsWrite = require('./gcsWrite');
const constants = require('../config/constants');
const { forgetTextFile } = require('./gcsService');

const NAME = 'invest_bound_pending.json';
const MAX_ITEMS = 80;
const MAX_CHARS = 900000;

function normKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseStore(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return { v: 1, items };
}

async function readStore() {
  try {
    const got = await gcsWrite.readJson(NAME);
    if (!got || got.data == null) return { store: { v: 1, items: [] }, generation: undefined };
    if (typeof got.data === 'string') {
      try { return { store: parseStore(JSON.parse(got.data)), generation: got.generation }; }
      catch { return { store: { v: 1, items: [] }, generation: got.generation }; }
    }
    return { store: parseStore(got.data), generation: got.generation };
  } catch (err) {
    if (err && (err.status === 404 || err.code === 404)) return { store: { v: 1, items: [] }, generation: undefined };
    throw err;
  }
}

async function writeStore(store, generation) {
  const text = JSON.stringify({ v: 1, saved: Date.now(), items: store.items || [] });
  if (text.length > MAX_CHARS) {
    const err = new Error('Chỉ mục ranh chờ duyệt quá lớn');
    err.status = 413;
    throw err;
  }
  await gcsWrite.putJson(NAME, text, generation);
  try { await gcsWrite.patchCacheControl(NAME, 'public, max-age=30'); } catch { /* metadata không chặn */ }
  if (constants.INVEST_BOUND_PENDING_URL) forgetTextFile(constants.INVEST_BOUND_PENDING_URL);
}

function findByKey(items, key) {
  const needle = normKey(key);
  if (!needle) return null;
  return (items || []).find(it => normKey(it.key) === needle || normKey(it.tenQH) === needle) || null;
}

async function assertNoPending(key) {
  const { store } = await readStore();
  const hit = findByKey(store.items, key);
  if (!hit) return;
  const err = new Error(hit.replace
    ? 'Dự án đang có đề xuất thay ranh chờ duyệt. Không gửi thêm.'
    : 'Dự án đang có đề xuất ranh chờ duyệt. Không gửi thêm.');
  err.status = 409;
  throw err;
}

async function upsertPending(row) {
  const key = String(row.key || row.tenQH || '').trim();
  if (!key || !row.id || !row.geometry) {
    const err = new Error('Thiếu khóa hoặc ranh đề xuất');
    err.status = 400;
    throw err;
  }
  const { store, generation } = await readStore();
  const needle = normKey(key);
  if (store.items.some(it => it.id !== row.id && (normKey(it.key) === needle || normKey(it.tenQH) === needle))) {
    const err = new Error('Dự án đang có đề xuất ranh chờ duyệt. Không gửi thêm.');
    err.status = 409;
    throw err;
  }
  const next = {
    id: String(row.id),
    key,
    tenQH: String(row.tenQH || key).slice(0, 200),
    name: String(row.name || '').slice(0, 80),
    email: String(row.email || '').slice(0, 120),
    time: row.time || new Date().toISOString(),
    replace: !!row.replace,
    geometry: row.geometry
  };
  store.items = store.items.filter(it => it.id !== next.id && normKey(it.key) !== needle && normKey(it.tenQH) !== needle);
  store.items.unshift(next);
  if (store.items.length > MAX_ITEMS) store.items = store.items.slice(0, MAX_ITEMS);
  await writeStore(store, generation);
  return next;
}

async function removePendingById(id) {
  const want = String(id || '');
  if (!want) return false;
  const { store, generation } = await readStore();
  const before = store.items.length;
  store.items = store.items.filter(it => it.id !== want);
  if (store.items.length === before) return false;
  await writeStore(store, generation);
  return true;
}

async function removePendingByKey(key) {
  const needle = normKey(key);
  if (!needle) return false;
  const { store, generation } = await readStore();
  const before = store.items.length;
  store.items = store.items.filter(it => normKey(it.key) !== needle && normKey(it.tenQH) !== needle);
  if (store.items.length === before) return false;
  await writeStore(store, generation);
  return true;
}

module.exports = {
  NAME,
  normKey,
  readStore,
  assertNoPending,
  upsertPending,
  removePendingById,
  removePendingByKey,
  findByKey
};
