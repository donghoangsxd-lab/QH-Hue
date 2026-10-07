// Bộ đệm kết quả tính trên GEE lưu ở bucket (thư mục cache/): sống qua khởi động nguội / deploy, mọi instance Vercel dùng chung.
// Mọi mục đều khóa theo chữ ký dữ liệu (đã gồm phiên bản hiệu chỉnh dân cư) nên không cần xóa khi dữ liệu đổi: chữ ký lệch = bỏ qua.
//   cache/v1/cov/<HT|QH|NET...>-<md5 phường>.json : 1 file / phường / kịch bản (tránh ghi dồn vào 1 object, GCS ~1 lần ghi/giây/object)
//   cache/v1/candidates.json                       : số pixel dân cư phần còn trống của ứng viên + tổng pixel phường
// Service account không có quyền ghi → chỉ đệm trong bộ nhớ như trước.
const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');
const gcsWrite = require('./gcsWrite');

const PREFIX = 'cache/v1/';
const CANDIDATES_NAME = `${PREFIX}candidates.json`;
const CANDIDATES_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;

let writable = true;
const wardMemo = new Map();   // tên file → { at, entry | null }
let candidates = null;        // { at, generation, data: { counts: { sig: n }, wardPix: { "pop|phường": n } } }

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');
const wardFile = (key) => `${PREFIX}cov/${String(key).split(':')[0]}-${md5(key).slice(0, 16)}.json`;

async function readObject(name) {
  const res = await axios.get(`${constants.GCS_PUBLIC_BASE}${name}?v=${Date.now()}`, {
    timeout: 10000, maxContentLength: Infinity, validateStatus: () => true
  });
  if (res.status === 404) return { data: null, generation: '0' };
  if (res.status !== 200) throw new Error(`Đọc ${name} lỗi HTTP ${res.status}`);
  return { data: res.data, generation: String(res.headers['x-goog-generation'] || '') };
}

/** Generation mới khi ghi được; null khi không ghi được (thiếu quyền / lỗi); ném lỗi code GEN khi generation lệch */
async function writeObject(name, data, generation) {
  if (!writable) return null;
  try {
    return (await gcsWrite.putJson(name, JSON.stringify(data), generation)).generation;
  } catch (err) {
    if (err.code === 'NO_SA') {
      writable = false;
      console.warn('statsStore: service account không ghi được bucket, chỉ đệm trong bộ nhớ');
    } else if (err.code !== 'GEN') {
      console.warn(`statsStore: ghi ${name} lỗi:`, err.message);
    }
    if (err.code === 'GEN') throw err;
    return null;
  }
}

/** Kết quả đã lưu của 1 phường (key "HT:<phường>") nếu chữ ký khớp; null nếu chưa có / lệch / lỗi đọc */
async function getWardEntry(key, sig) {
  const name = wardFile(key);
  const memo = wardMemo.get(name);
  if (memo && memo.entry && memo.entry.sig === sig) return memo.entry;
  if (memo && Date.now() - memo.at < MISS_TTL_MS) return null;
  try {
    const { data } = await readObject(name);
    wardMemo.set(name, { at: Date.now(), entry: data });
    return data && data.sig === sig ? data : null;
  } catch (err) {
    console.warn('statsStore: đọc kết quả phường lỗi:', err.message);
    return null;
  }
}

/** Lưu kết quả 1 phường (entry phải có sig); không chặn khi lỗi */
async function putWardEntry(key, entry) {
  const name = wardFile(key);
  const data = { ...entry, at: Date.now() };
  wardMemo.set(name, { at: Date.now(), entry: data });
  try {
    await writeObject(name, data);
  } catch (err) {
    console.warn('statsStore: ghi kết quả phường lỗi:', err.message);
  }
}

async function loadCandidates(force = false) {
  if (!force && candidates && Date.now() - candidates.at < CANDIDATES_TTL_MS) return candidates;
  try {
    const { data, generation } = await readObject(CANDIDATES_NAME);
    candidates = {
      at: Date.now(), generation,
      data: { counts: (data && data.counts) || {}, wardPix: (data && data.wardPix) || {} }
    };
  } catch (err) {
    console.warn('statsStore: đọc số đếm ứng viên lỗi:', err.message);
    if (!candidates) candidates = { at: Date.now(), generation: '', data: { counts: {}, wardPix: {} } };
  }
  return candidates;
}

/** { counts: { sig: số pixel }, wardPix: { "pop|phường": số pixel } } đã lưu */
async function getCandidateCounts() {
  return (await loadCandidates()).data;
}

/**
 * Gộp số đếm mới vào file chung (đọc lại + ghi theo generation khi instance khác vừa ghi).
 * keep = tập chữ ký còn dùng: bỏ các mục ngoài tập (ứng viên đã đổi / đã xóa) để file không phình mãi.
 */
async function saveCandidateCounts(newCounts, newWardPix, keep = null) {
  if (!writable) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await loadCandidates(attempt > 0);
    const counts = { ...cur.data.counts, ...newCounts };
    let changed = Object.keys(newCounts).length + Object.keys(newWardPix).length > 0;
    if (keep) Object.keys(counts).forEach(k => {
      if (!keep.has(k)) { delete counts[k]; changed = true; }
    });
    if (!changed) return;
    const data = { counts, wardPix: { ...cur.data.wardPix, ...newWardPix }, at: Date.now() };
    try {
      const generation = await writeObject(CANDIDATES_NAME, data, cur.generation || undefined);
      if (generation) candidates = { at: Date.now(), generation, data };
      return;
    } catch (err) {
      if (err.code !== 'GEN') return;
    }
  }
}

module.exports = { getWardEntry, putWardEntry, getCandidateCounts, saveCandidateCounts, md5 };
