// Admin: kiểm tra sổ hạ tầng thửa đất 2016 rồi mới ghi Sheet (action importParcelInfra).
// Máy chủ đọc scripts/data/parcel-infra/rows.json, gán lại phường/xã theo ranh hiện hành, từ chối dòng thiếu diện tích hoặc tên.
import { state } from './state.js';
import { geeApi, markDataWritten } from './api.js';
import { escapeHtml, ico, showToast, fmtNum, setStatusContent } from './utils.js';

const BATCH = 200;
const TAB_LABELS = {
  '1-CV': 'Công viên',
  '3-MN': 'Mầm non',
  '4-TH': 'Tiểu học',
  '5-THCS': 'THCS',
  '6-THPT': 'THPT',
  '7-YT': 'Y tế',
  '8-VH': 'Văn hóa, thể thao',
  '9-TM': 'Chợ'
};

let onImported = null;
let preview = null;
let busy = false;

const $ = (id) => document.getElementById(id);

function setStatus(text, color = 'var(--text-muted)') {
  const el = $('parcelInfraStatus');
  if (!el) return;
  el.style.color = color;
  setStatusContent(el, text);
}

async function postImport(body) {
  if (!body.dryRun) markDataWritten();
  const res = await fetch(geeApi('action=importParcelInfra'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('Phiên Admin hết hạn — đăng nhập lại');
  if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  return data;
}

function summaryLine(summary, validation) {
  if (!summary && !validation) return '';
  const v = validation || summary && summary.validation;
  const ok = v && v.ok !== false && !(v.missingArea || v.missingWard || v.missingName);
  const check = ok
    ? `Đủ diện tích, phường/xã và tên trên ${fmtNum((v && v.rows) || 0)} dòng sẽ ghi.`
    : `Thiếu dữ liệu: ${fmtNum(v && v.missingArea || 0)} diện tích, ${fmtNum(v && v.missingWard || 0)} phường/xã, ${fmtNum(v && v.missingName || 0)} tên.`;
  if (!summary) return check;
  return `${check} Thửa ${fmtNum(summary.parcels || 0)}. Khớp OSM ${fmtNum(summary.matchedOsm || 0)}, thuộc tính ${fmtNum(summary.matchedAttribute || 0)}, Google ${fmtNum(summary.matchedGoogle || 0)}, chưa có tên ${fmtNum(summary.unnamed || 0)}. Trùng đã bỏ ${fmtNum(summary.duplicatesSkipped || 0)}. Ngoài ranh ${fmtNum(summary.outsideWard || 0)}. Diện tích thuộc tính thay hình học ${fmtNum(summary.geometryFallback || 0)}. Cấp trường chưa rõ ${fmtNum(summary.capChuaXacDinh || 0)}. Đào tạo ${fmtNum(summary.daoTao || 0)}. Google Places: ${escapeHtml(summary.googlePlaces || '')}.`;
}

function renderReport() {
  const box = $('parcelInfraReport');
  if (!box) return;
  if (!preview) { box.innerHTML = ''; return; }
  const stats = (preview.stats && preview.stats.byType) || {};
  const rows = Object.keys(TAB_LABELS).filter(t => stats[t] && stats[t].received).map(t => {
    const s = stats[t];
    return `<tr><td>${escapeHtml(TAB_LABELS[t])}</td><td>${fmtNum(s.received)}</td><td>${fmtNum(s.outside)}</td><td>${fmtNum(s.duplicate)}</td><td><b class="c-green">${fmtNum(s.accepted)}</b></td></tr>`;
  }).join('');
  const n = (preview.items || []).length;
  box.innerHTML = `${rows ? `<table class="cad-table osm-table"><thead><tr><th>Tab</th><th>Sổ</th><th>Ngoài ranh</th><th>Trùng</th><th>Ghi</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="cad-hint">Không có dòng mới sau khi đối chiếu.</div>'}
    <div class="cad-hint">${summaryLine(preview.summary, preview.validation)}</div>
    ${n ? `<button type="button" class="btn-submit" id="btnParcelInfraWrite"${busy ? ' disabled' : ''}>${ico('save')}GHI ${fmtNum(n)} DÒNG VÀO SHEET</button>` : ''}`;
  $('btnParcelInfraWrite')?.addEventListener('click', writePreview);
}

async function checkInventory() {
  if (busy) return;
  busy = true;
  preview = null;
  renderReport();
  $('btnParcelInfraCheck').disabled = true;
  try {
    setStatus('Đang kiểm tra sổ thửa với ranh 40 phường/xã và dữ liệu hiện có...', 'var(--accent-orange)');
    const res = await postImport({ dryRun: true, includeTraining: !!$('parcelIncludeTraining')?.checked });
    preview = { items: res.items || [], stats: res.stats || {}, summary: res.summary || null, validation: res.validation || null };
    const v = preview.validation || {};
    if (v.missingArea || v.missingWard || v.missingName) {
      setStatus(`Kiểm tra thất bại: thiếu diện tích ${fmtNum(v.missingArea || 0)}, phường/xã ${fmtNum(v.missingWard || 0)}, tên ${fmtNum(v.missingName || 0)}.`, 'var(--accent-red)');
    } else if (preview.items.length) {
      setStatus(`Có ${fmtNum(preview.items.length)} dòng đủ diện tích, phường/xã và tên. Kiểm tra chưa ghi Sheet.`, 'var(--accent-orange)');
    } else {
      setStatus('Không có dòng mới để ghi. Các dòng trong sổ đã có trên Sheet hoặc nằm ngoài ranh.', 'var(--accent-green)');
    }
  } catch (err) {
    setStatus(err.message || 'Không kiểm tra được sổ thửa', 'var(--accent-red)');
  } finally {
    busy = false;
    $('btnParcelInfraCheck').disabled = false;
    renderReport();
  }
}

async function writePreview() {
  if (busy || !preview || !preview.items.length) return;
  busy = true;
  renderReport();
  const items = preview.items;
  let created = 0;
  let skipped = 0;
  const sheets = [];
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      setStatus(`Đang ghi ${fmtNum(Math.min(i + BATCH, items.length))}/${fmtNum(items.length)} dòng...`, 'var(--accent-orange)');
      const res = await postImport({
        dryRun: false,
        includeTraining: !!$('parcelIncludeTraining')?.checked,
        items: items.slice(i, i + BATCH)
      });
      created += Number(res.created) || 0;
      skipped += Number(res.skipped) || 0;
      (res.sheets || []).forEach(s => { if (!sheets.includes(s)) sheets.push(s); });
    }
    if (!(created > 0)) throw new Error(`Sheet không thêm dòng nào. Bỏ qua ${fmtNum(skipped)} dòng.`);
    const where = sheets.length ? ` vào ${sheets.join(', ')}` : '';
    showToast(`Đã ghi ${fmtNum(created)} dòng${where}`, 'success');
    setStatus(`Đã ghi ${fmtNum(created)} dòng${where}. Bỏ qua ${fmtNum(skipped)} dòng đã có. Không dán thêm CSV của cùng sổ này.`, 'var(--accent-green)');
    preview = null;
    busy = false;
    if (onImported) await onImported();
  } catch (err) {
    const partial = created > 0 ? ` Đã ghi ${fmtNum(created)} dòng trước khi dừng.` : '';
    setStatus(`${err.message || 'Không ghi được Sheet.'}${partial}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderReport();
  }
}

export function initParcelInfraImport(opts = {}) {
  onImported = opts.onImported || null;
  $('btnParcelInfraCheck')?.addEventListener('click', checkInventory);
}
