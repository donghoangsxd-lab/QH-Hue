// UI tem đất dùng chung cho hoso / Batch TT16 / ĐCCB — khớp ≥ 2/3 tiêu chí (landStamp).
import { escapeHtml, fmtNum } from './utils.js';
import { stampLabel, stampPendingWhy } from './landStamp.js';

const HINT_DEFAULT = 'Bấm + rồi chọn lô chấm đỏ trên bản đồ (có thể nhiều lô cùng loại nếu tổng diện tích khớp tem ± 1%). ? xem lỗi · × xóa tem.';

/**
 * Khung danh sách tem chờ gán tay — bảng thẳng cột, 3 nút ? / × / +.
 * @param {object} opts
 * @param {Array} opts.pending
 * @param {string} [opts.pickId]
 * @param {object} [opts.draft]  stampId → string[] khóa lô đang chọn
 * @param {Array} [opts.lots]    để ? giải thích lỗi
 * @param {string} [opts.title]
 * @param {string} [opts.hint]
 * @param {string} [opts.extraClass]
 * @param {string} opts.pickAttr
 * @param {string} opts.skipAttr
 * @param {string} [opts.whyAttr]
 * @param {string} [opts.plusAttr]
 * @param {string} [opts.skipExtra]
 * @param {string} [opts.whyExtra]
 * @param {string} [opts.plusExtra]
 */
export function stampPendingBoxHtml(opts = {}) {
  const pending = opts.pending || [];
  if (!pending.length) return '';
  const cur = pending.find(s => s.id === opts.pickId) || pending[0];
  const draft = opts.draft || {};
  const n = pending.length;
  const title = opts.title
    || `Có ${fmtNum(n)} tem chưa ghép được tự động do phát hiện lỗi. Cần ghép thủ công:`;
  const pickAttr = opts.pickAttr || 'data-stamp';
  const skipAttr = opts.skipAttr || 'data-stamp-skip';
  const whyAttr = opts.whyAttr || 'data-stamp-why';
  const plusAttr = opts.plusAttr || 'data-stamp-plus';
  const skipExtra = opts.skipExtra ? ` ${opts.skipExtra}` : '';
  const whyExtra = opts.whyExtra ? ` ${opts.whyExtra}` : '';
  const plusExtra = opts.plusExtra ? ` ${opts.plusExtra}` : '';
  const lots = opts.lots || [];

  const rows = pending.map(s => {
    const on = s.id === cur.id;
    const keys = draft[s.id] || [];
    const plusOn = on && keys.length > 0;
    const why = escapeHtml(stampPendingWhy(s, lots));
    return `<tr class="cad-stamp-row${on ? ' on' : ''}" ${pickAttr}="${escapeHtml(s.id)}">
      <td class="cad-stamp-code">${escapeHtml(s.code || 'Tem')}</td>
      <td class="cad-stamp-num">${escapeHtml(s.areaRaw || '—')}</td>
      <td class="cad-stamp-num">${s.floors != null && s.floors !== '' ? escapeHtml(String(s.floors)) : '—'}</td>
      <td class="cad-stamp-num">${s.coverage != null && s.coverage !== '' ? `${escapeHtml(String(s.coverage))}%` : '—'}</td>
      <td class="cad-stamp-num">${s.far != null && s.far !== '' ? escapeHtml(String(s.far)) : '—'}</td>
      <td class="cad-stamp-acts">
        <button type="button" class="cad-stamp-btn cad-stamp-why" title="${why}" aria-label="Xem lỗi" ${whyExtra} ${whyAttr}="${escapeHtml(s.id)}">?</button>
        <button type="button" class="cad-stamp-btn cad-stamp-del" title="Xóa tem khỏi danh sách" aria-label="Xóa tem" ${skipExtra} ${skipAttr}="${escapeHtml(s.id)}">×</button>
        <button type="button" class="cad-stamp-btn cad-stamp-plus${plusOn ? ' is-on' : ''}" title="${plusOn ? 'Bấm để xác nhận gán' : 'Chọn tem rồi bấm lô trên bản đồ'}" aria-label="Gán tem" ${plusExtra} ${plusAttr}="${escapeHtml(s.id)}">+</button>
      </td>
    </tr>`;
  }).join('');

  const draftKeys = draft[cur.id] || [];
  const now = draftKeys.length
    ? `Đang gán: <b>${escapeHtml(stampLabel(cur))}</b> — đã chọn ${fmtNum(draftKeys.length)} lô`
    : `Đang gán: <b>${escapeHtml(stampLabel(cur))}</b> — bấm + rồi chọn lô chấm đỏ`;

  const cls = opts.extraClass ? `cad-stamp ${opts.extraClass}` : 'cad-stamp';
  return `<div class="${cls}">
    <b class="cad-stamp-title">${escapeHtml(title)}</b>
    <span class="cad-stamp-hint">${opts.hint || HINT_DEFAULT}</span>
    <div class="cad-stamp-scroll">
      <table class="cad-stamp-table">
        <thead><tr>
          <th>Ký hiệu</th><th>Diện tích</th><th>Tầng</th><th>Mật độ</th><th>HSSD</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="cad-stamp-now"><span>${now}</span></div>
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
