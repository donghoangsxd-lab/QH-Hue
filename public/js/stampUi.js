// UI tem đất dùng chung cho hoso / Batch TT16 / ĐCCB — tự pair trên-hatch+tên / gần 50m; một tem → nhiều hatch.
import { escapeHtml, fmtNum } from './utils.js';
import { stampLabel, stampPendingWhy } from './landStamp.js';

const HINT_DEFAULT = 'Đường xanh đứt = gợi ý hatch cùng loại cạnh nhau, tổng DT ≈ tem. Bấm + (nạp gợi ý), chỉnh lô đỏ rồi OK. ? xem lỗi · × xóa tem.';

/**
 * Khung danh sách tem chờ gán tay — bảng thẳng cột, 3 nút ? / × / +, OK ghi nháp.
 * @param {object} opts
 * @param {Array} opts.pending
 * @param {string} [opts.pickId]
 * @param {boolean} [opts.assignMode] đang ở chế độ chọn lô trên bản đồ
 * @param {object} [opts.draft]  stampId → string[] khóa lô đang chọn
 * @param {Array} [opts.lots]    để ? giải thích lỗi
 * @param {string} [opts.title]
 * @param {string} [opts.hint]
 * @param {string} [opts.extraClass]
 * @param {string} opts.pickAttr
 * @param {string} opts.skipAttr
 * @param {string} [opts.whyAttr]
 * @param {string} [opts.plusAttr]
 * @param {string} [opts.okAttr]
 * @param {string} [opts.skipExtra]
 * @param {string} [opts.whyExtra]
 * @param {string} [opts.plusExtra]
 * @param {string} [opts.okExtra]
 */
export function stampPendingBoxHtml(opts = {}) {
  const pending = opts.pending || [];
  if (!pending.length) return '';
  const cur = pending.find(s => s.id === opts.pickId) || pending[0];
  const draft = opts.draft || {};
  const assignMode = !!opts.assignMode;
  const n = pending.length;
  const title = opts.title
    || `Có ${fmtNum(n)} tem chưa ghép được tự động do phát hiện lỗi. Cần ghép thủ công:`;
  const pickAttr = opts.pickAttr || 'data-stamp';
  const skipAttr = opts.skipAttr || 'data-stamp-skip';
  const whyAttr = opts.whyAttr || 'data-stamp-why';
  const plusAttr = opts.plusAttr || 'data-stamp-plus';
  const okAttr = opts.okAttr || 'data-stamp-ok';
  const skipExtra = opts.skipExtra ? ` ${opts.skipExtra}` : '';
  const whyExtra = opts.whyExtra ? ` ${opts.whyExtra}` : '';
  const plusExtra = opts.plusExtra ? ` ${opts.plusExtra}` : '';
  const okExtra = opts.okExtra ? ` ${opts.okExtra}` : '';
  const lots = opts.lots || [];

  const rows = pending.map(s => {
    const on = s.id === cur.id;
    const keys = draft[s.id] || [];
    const plusOn = on && (assignMode || keys.length > 0);
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
        <button type="button" class="cad-stamp-btn cad-stamp-plus${plusOn ? ' is-on' : ''}" title="${assignMode && on ? 'Đang chọn lô trên bản đồ' : 'Bắt đầu chọn lô trên bản đồ'}" aria-label="Chọn lô" ${plusExtra} ${plusAttr}="${escapeHtml(s.id)}">+</button>
      </td>
    </tr>`;
  }).join('');

  const draftKeys = draft[cur.id] || [];
  let now = `Tem: <b>${escapeHtml(stampLabel(cur))}</b>`;
  if (assignMode && cur.id === opts.pickId) {
    now += draftKeys.length
      ? ` — đã chọn ${fmtNum(draftKeys.length)} lô đỏ · bấm OK để ghi`
      : ' — rê chuột lô đỏ (viền sáng), bấm để chọn · xong bấm OK';
  } else {
    now += ' — bấm + để chọn lô trên bản đồ';
  }

  const okDisabled = !(assignMode && draftKeys.length);
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
    <div class="cad-stamp-now">
      <span>${now}</span>
      <button type="button" class="cad-stamp-ok"${okDisabled ? ' disabled' : ''} title="Ghi gán tem vào lô đã chọn" ${okExtra} ${okAttr}="${escapeHtml(cur.id)}">OK</button>
    </div>
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
