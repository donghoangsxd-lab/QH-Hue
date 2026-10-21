// Quyết định nạp bảng điểm: không hủy tác vụ đang chờ hoặc đang chạy, không đụng bảng đang dùng.
const TABLE = 'projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-diem';
const TABLE_NEW = `${TABLE}-new`;
const IMAGE = 'projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha';
const IMAGE_NEXT = `${IMAGE}-next`;
const KNOWN_TASK = 'R5VL6OZT';
const BUSY = new Set(['READY', 'RUNNING', 'UNKNOWN', 'STARTING']);

function isBusyState(state) {
  return BUSY.has(String(state || ''));
}

function otherTable(live) {
  return live === TABLE_NEW ? TABLE : TABLE_NEW;
}

function csvChanged(rec, fp) {
  if (!fp || !fp.md5) return false;
  if (!rec || !rec.ingestedMd5) return false;
  return rec.ingestedMd5 !== fp.md5 || String(rec.ingestedUpdated || '') !== String(fp.updated || '');
}

function taskBlob(t) {
  return [t && t.id, t && t.description, t && t.type, ...((t && t.sources) || []), ...((t && t.destinations) || [])].join(' ');
}

function isPopTableTask(t) {
  if (!t) return false;
  if (t.id === KNOWN_TASK) return true;
  return /pop-weights\.csv|Pixel-danso-nha-diem/i.test(taskBlob(t));
}

function pickActiveTask(tasks) {
  const rows = (tasks || []).filter(t => isPopTableTask(t) && isBusyState(t.state) && t.state !== 'STARTING');
  rows.sort((a, b) => (Number(b.updated) || Number(b.created) || 0) - (Number(a.updated) || Number(a.created) || 0));
  return rows[0] || null;
}

function assetOfTask(t) {
  return /Pixel-danso-nha-diem-new/i.test(taskBlob(t)) ? TABLE_NEW : TABLE;
}

function isPopImageTask(t) {
  if (!t || isPopTableTask(t)) return false;
  return /Pixel-danso-nha/i.test(taskBlob(t));
}

function pickActiveImage(tasks) {
  const rows = (tasks || []).filter(t => isPopImageTask(t) && isBusyState(t.state) && t.state !== 'STARTING');
  rows.sort((a, b) => (Number(b.updated) || Number(b.created) || 0) - (Number(a.updated) || Number(a.created) || 0));
  return rows[0] || null;
}

function imageAssetOfTask(t) {
  return /Pixel-danso-nha-next/i.test(taskBlob(t)) ? IMAGE_NEXT : IMAGE;
}

module.exports = {
  TABLE, TABLE_NEW, IMAGE, IMAGE_NEXT, KNOWN_TASK,
  isBusyState, otherTable, csvChanged, isPopTableTask, pickActiveTask, assetOfTask,
  isPopImageTask, pickActiveImage, imageAssetOfTask
};
