// Đồng bộ dòng ĐCCB sổ tay (catalog/so-tay-edits.json) với hồ sơ điều chỉnh (adjustments.json).
// Khóa chung: child.adjustId = id hex 16 của hồ sơ điều chỉnh.
const gcsWrite = require('./gcsWrite');

const SO_TAY_EDITS = 'catalog/so-tay-edits.json';
const ADJUST_ID_RE = /^[a-f0-9]{16}$/;
const MAX_CHARS = 1500000;

function emptyPack() {
  return { v: 1, saved: 0, projects: [], dccb: [], links: [], patches: [] };
}

async function readPack() {
  try {
    const got = await gcsWrite.readJson(SO_TAY_EDITS);
    if (got && got.data && typeof got.data === 'object') {
      const d = got.data;
      return {
        v: 1,
        saved: Number(d.saved) || 0,
        projects: Array.isArray(d.projects) ? d.projects : [],
        dccb: Array.isArray(d.dccb) ? d.dccb : [],
        links: Array.isArray(d.links) ? d.links : [],
        patches: Array.isArray(d.patches) ? d.patches : []
      };
    }
  } catch (err) { /* chưa có overlay */ }
  return emptyPack();
}

async function writePack(pack, callAppsScript) {
  const payload = {
    v: 1,
    saved: Date.now(),
    projects: pack.projects || [],
    dccb: pack.dccb || [],
    links: pack.links || [],
    patches: pack.patches || []
  };
  const content = JSON.stringify(payload);
  if (content.length > MAX_CHARS) {
    const err = new Error('Dữ liệu sổ tay bổ sung quá lớn');
    err.status = 413;
    throw err;
  }
  if (typeof callAppsScript === 'function') {
    const result = await callAppsScript({ action: 'saveSoTayEdits' }, { action: 'saveSoTayEdits', content });
    if (result && result.saved !== true) {
      const err = new Error('Không ghi được ĐCCB vào sổ tay');
      err.status = 502;
      throw err;
    }
    return payload;
  }
  await gcsWrite.putJson(SO_TAY_EDITS, content);
  return payload;
}

/**
 * Ghi hoặc cập nhật một dòng ĐCCB theo adjustId (không nhân đôi).
 * child: { id?, ten, quyetDinh?, ngay?, coQuan?, ghiChu?, adjustId }
 */
async function upsertDccbByAdjustId({ ma, child, callAppsScript }) {
  const code = String(ma || '').trim();
  const adjustId = String(child && child.adjustId || '').trim();
  const ten = String(child && child.ten || '').trim();
  if (!code || !ten) {
    const err = new Error('Thiếu mã đồ án hoặc tên ĐCCB');
    err.status = 400;
    throw err;
  }
  if (!ADJUST_ID_RE.test(adjustId)) {
    const err = new Error('Mã hồ sơ điều chỉnh không hợp lệ');
    err.status = 400;
    throw err;
  }
  const pack = await readPack();
  const dccb = pack.dccb.slice();
  const hit = dccb.findIndex((row) => String(row?.child?.adjustId || '') === adjustId);
  const nextChild = {
    id: String(child.id || '').trim() || `${code}.adj.${adjustId.slice(0, 4)}`,
    loaiDong: 'dccb',
    ten,
    quyetDinh: String(child.quyetDinh || '').trim().slice(0, 80),
    ngay: String(child.ngay || '').trim().slice(0, 20),
    coQuan: String(child.coQuan || '').trim().slice(0, 80),
    dienTichText: '',
    danSo: '',
    ghiChu: String(child.ghiChu || '').trim().slice(0, 120),
    adjustId
  };
  if (hit >= 0) {
    dccb[hit] = { ma: String(dccb[hit].ma || code).trim() || code, child: { ...dccb[hit].child, ...nextChild, adjustId } };
  } else {
    dccb.push({ ma: code, child: nextChild });
  }
  pack.dccb = dccb;
  await writePack(pack, callAppsScript);
  return nextChild;
}

module.exports = {
  SO_TAY_EDITS,
  ADJUST_ID_RE,
  readPack,
  writePack,
  upsertDccbByAdjustId,
  emptyPack
};
