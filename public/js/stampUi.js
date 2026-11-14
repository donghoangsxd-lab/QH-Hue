// UI tem đất dùng chung cho hoso / Batch TT16 / ĐCCB — khớp ≥ 2/3 tiêu chí (landStamp).
import { escapeHtml, fmtNum } from './utils.js';
import { stampLabel } from './landStamp.js';

const TIP_DEFAULT = 'Tem chưa tự khớp (≥ 2/3 tiêu chí: vị trí, ký hiệu, diện tích &lt; 1%).';
const HINT_DEFAULT = 'Chọn tem rồi bấm lô trên bản đồ. Mỗi lô một tem.';

/**
 * Khung danh sách tem chờ gán tay.
 * @param {object} opts
 * @param {Array} opts.pending
 * @param {string} [opts.pickId]
 * @param {string} [opts.tip]
 * @param {string} [opts.hint]
 * @param {string} [opts.extraClass]
 * @param {string} opts.pickAttr  ví dụ data-ho-stamp / data-stamp
 * @param {string} opts.skipAttr  ví dụ data-ho-stamp-skip / data-stamp-skip
 * @param {string} [opts.skipExtra] thuộc tính thêm trên nút Bỏ qua (adj: data-adj-imp)
 */
export function stampPendingBoxHtml(opts = {}) {
  const pending = opts.pending || [];
  if (!pending.length) return '';
  const cur = pending.find(s => s.id === opts.pickId) || pending[0];
  const pickAttr = opts.pickAttr || 'data-stamp';
  const skipAttr = opts.skipAttr || 'data-stamp-skip';
  const chips = pending.map(s => (
    `<button type="button" class="cad-stamp-chip${s.id === cur.id ? ' on' : ''}" ${pickAttr}="${escapeHtml(s.id)}">${escapeHtml(stampLabel(s))}</button>`
  )).join('');
  const skipExtra = opts.skipExtra ? ` ${opts.skipExtra}` : '';
  const cls = opts.extraClass ? `cad-stamp ${opts.extraClass}` : 'cad-stamp';
  return `<div class="${cls}">
    <b>${opts.tip || TIP_DEFAULT}</b>
    <span>${opts.hint || HINT_DEFAULT}</span>
    <div class="cad-stamp-list">${chips}</div>
    <div class="cad-stamp-now"><span>Đang gán: <b>${escapeHtml(stampLabel(cur))}</b></span>
      <button type="button" class="cad-clear"${skipExtra} ${skipAttr}="${escapeHtml(cur.id)}">Bỏ qua tem này</button></div>
  </div>`;
}

/** Dòng trạng thái khi chưa có pending (đã gán / chờ file đất / lỗi). */
export function stampStatusNoteHtml({ fileName, n, done, left, noFeatures, noStamps, asP = true }) {
  const name = escapeHtml(fileName || '');
  let body = '';
  if (noStamps) body = `File ký hiệu <b>${name}</b> không đọc được tem đất.`;
  else if (noFeatures) body = `Đã đọc ${fmtNum(n)} tem từ <b>${name}</b>. Chọn file sử dụng đất để gán vào lô.`;
  else body = `Tem đất: đã gán ${fmtNum(done)}/${fmtNum(n)} từ <b>${name}</b>.${left ? ` ${fmtNum(left)} lô chưa có tem.` : ''}`;
  if (asP) {
    const flag = noStamps ? ' lot-flag' : '';
    return `<p class="entry-note${flag}">${body}</p>`;
  }
  return body;
}
