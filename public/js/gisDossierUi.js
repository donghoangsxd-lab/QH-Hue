// Chọn thư mục HoSoGIS trên máy (không gửi file lên server) và mở bảng kết quả ở nửa dưới màn hình.
import { readZip } from './kmlImport.js';
import { inspectGisFiles } from './gisDossierRead.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';

const VERDICT = {
  fail: ['Không đạt', 'c-red'],
  warn: ['Còn cảnh báo', 'c-orange'],
  ok: ['Đạt', 'c-green'],
  empty: ['Chưa đủ căn cứ', 'c-orange']
};
const LEVEL = { fail: 'Không đạt', warn: 'Cảnh báo', ok: 'Đạt' };

let api = null;
let picked = null;
let lastReport = null;
let lastFilter = 'all';

function $(id) { return document.getElementById(id); }

function fileOf(path, file) {
  return {
    path,
    size: file.size,
    read: async (start = 0, end = file.size) => new Uint8Array(await file.slice(start, end).arrayBuffer())
  };
}

async function walkDir(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    if (!name || name.startsWith('.') || name === '__MACOSX') continue;
    const path = prefix + name;
    if (handle.kind === 'directory') await walkDir(handle, `${path}/`, out);
    else out.push(fileOf(path, await handle.getFile()));
  }
}

function zipFiles(buf) {
  return readZip(buf, 'ZIP').filter(e => e.name && !e.name.endsWith('/')).map(e => {
    const path = e.name.replace(/\\/g, '/');
    let cache = null;
    const size = e.usize && e.usize !== 0xffffffff ? e.usize : e.size;
    return {
      path,
      size,
      read: async (start = 0, end = size) => {
        if (start === 0 && end <= 100) return e.read({ maxBytes: end });
        if (!cache) cache = await e.read();
        return cache.subarray(start, Math.min(cache.length, end));
      }
    };
  });
}

async function pickFolder() {
  if (typeof window.showDirectoryPicker === 'function') {
    const root = await window.showDirectoryPicker({ mode: 'read' });
    const files = [];
    await walkDir(root, '', files);
    return { label: root.name, files };
  }
  const input = $('gisDirFallback');
  if (!input) throw new Error('Trình duyệt chưa chọn được thư mục. Hãy nén HoSoGIS thành file .zip.');
  input.value = '';
  const list = await new Promise((resolve) => {
    const done = () => resolve([...input.files]);
    input.addEventListener('change', done, { once: true });
    input.click();
  });
  if (!list.length) return null;
  const files = list.map(f => fileOf(f.webkitRelativePath || f.name, f));
  const label = (files[0].path.split('/')[0]) || 'HoSoGIS';
  return { label, files };
}

function setPick(next) {
  picked = next;
  const el = $('gisPickLabel');
  const btn = $('btnGisCheck');
  if (el) {
    el.textContent = next
      ? `${next.label}: ${fmtNum(next.files.length)} tệp trên máy này, chưa gửi đi đâu.`
      : '';
  }
  if (btn) btn.disabled = !next || !next.files.length;
}

function rowCells(issue) {
  const lv = LEVEL[issue.level] || issue.level;
  const cls = issue.level === 'fail' ? 'c-red' : issue.level === 'warn' ? 'c-orange' : 'c-green';
  return `<td class="${cls}">${lv}</td><td>${escapeHtml(issue.pkg || '')}</td><td>${escapeHtml(issue.group || '')}</td><td>${escapeHtml(issue.layer || '')}</td><td>${escapeHtml(issue.text || '')}</td>`;
}

function layerRow(layer) {
  const lv = LEVEL[layer.level] || layer.level;
  const cls = layer.level === 'fail' ? 'c-red' : layer.level === 'warn' ? 'c-orange' : 'c-green';
  const geom = { A: 'Vùng', P: 'Điểm', L: 'Đường' }[layer.geom] || '—';
  return `<tr><td class="${cls}">${lv}</td><td>${escapeHtml(layer.pkg || '')}</td><td>${escapeHtml(layer.group || '')}</td><td>${escapeHtml(layer.name || '')}</td><td>${geom}</td><td>${layer.rows ? fmtNum(layer.rows) : '—'}</td></tr>`;
}

export function gisReportHtml(report, filter, sizeHtml) {
  const [title, cls] = VERDICT[report.verdict] || VERDICT.fail;
  const show = (level) => filter === 'all' || filter === level;
  const issues = report.issues.filter(i => show(i.level)).slice(0, 300);
  const layers = report.layers.filter(l => show(l.level)).slice(0, 400);
  const pkgs = report.packages.map(p => {
    const st = !p.found ? 'Thiếu' : p.unreadable ? `Có ${p.form}, chưa mở được` : `Có${p.form ? ` · ${p.form}` : ''}`;
    const c = !p.found ? 'c-red' : p.unreadable ? 'c-orange' : 'c-green';
    return `<span><b>${escapeHtml(p.id)}</b> <em class="${c}">${escapeHtml(st)}</em></span>`;
  }).join('');
  const code = report.codes.length ? report.codes.slice(0, 4).join(', ') : 'chưa đọc được';
  const slug = String(report.label || 'HoSoGIS').replace(/[^\w.-]+/g, '_').slice(0, 48);
  const filt = (id, label) => `<button type="button" class="bp-btn${filter === id ? ' on' : ''}" data-gis-filter="${id}">${label}</button>`;
  const issueTable = filter === 'ok' ? '' : `<h4>Việc cần xem</h4>
    <div class="ward-table-scroll-container"><table class="ward-table gis-issues">
      <thead><tr><th>Mức</th><th>Gói</th><th>Nhóm</th><th>Lớp</th><th>Nội dung</th></tr></thead>
      <tbody>${issues.length ? issues.map(i => `<tr>${rowCells(i)}</tr>`).join('') : '<tr><td colspan="5">Không có mục ở mức này.</td></tr>'}</tbody>
    </table></div>`;
  return `<div id="projectReviewSheet" class="review-sheet" data-pdf="Kiem-tra-GIS-${slug}">
    <div class="bp-part-head review-head">
      <b class="bp-part-title">HỒ SƠ GIS · ${escapeHtml(report.label)}</b>
      <div class="review-head-btns review-noprint">
        ${filt('all', 'Tất cả')}
        ${filt('fail', `Không đạt ${fmtNum(report.counts.fail)}`)}
        ${filt('warn', `Cảnh báo ${fmtNum(report.counts.warn)}`)}
        ${filt('ok', 'Lớp đạt')}
        ${sizeHtml || ''}
        <button type="button" class="bp-btn" id="btnReviewPrint">${ico('printer')}In PDF</button>
        <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
      </div>
    </div>
    <div class="review-top">
      <div class="review-card">
        <div class="review-card-title">Kết quả <b class="${cls}">${title}</b></div>
        <div class="review-kv">
          <span>Không đạt</span><span class="c-red"><b>${fmtNum(report.counts.fail)}</b></span>
          <span>Cảnh báo</span><span class="c-orange"><b>${fmtNum(report.counts.warn)}</b></span>
          <span>Lớp đã đọc</span><span><b>${fmtNum(report.counts.layers)}</b></span>
          <span>Mã hồ sơ</span><span>${escapeHtml(code)}</span>
        </div>
        <small class="review-card-foot">Phụ lục II Thông tư 16/2025/TT-BXD. Thiếu chuyên đề ở Phần 3 chỉ là cảnh báo. Không chấm chất lượng đo đạc và không chấm ký hiệu Phụ lục I.</small>
      </div>
      <div class="review-card">
        <div class="review-card-title">Bốn cơ sở dữ liệu</div>
        <div class="gis-pkgs">${pkgs}</div>
        <small class="review-card-foot">File chỉ đọc trên máy này. Shapefile bỏ qua phần tọa độ. File Geodatabase (.gdb) cần xuất GeoPackage hoặc shapefile để chấm bên trong.</small>
      </div>
    </div>
    ${issueTable}
    <h4>Lớp đã đọc</h4>
    <div class="ward-table-scroll-container"><table class="ward-table">
      <thead><tr><th>Mức</th><th>Gói</th><th>Nhóm</th><th>Lớp</th><th>Hình</th><th>Dòng</th></tr></thead>
      <tbody>${layers.length ? layers.map(layerRow).join('') : '<tr><td colspan="6">Chưa đọc được lớp nào.</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function paint(filter) {
  if (!lastReport || !api) return;
  lastFilter = filter;
  const host = $('projectReviewHost');
  if (!host) return;
  const top = host.scrollTop;
  host.innerHTML = gisReportHtml(lastReport, filter, api.sizeHtml());
  host.scrollTop = top;
}

export function handleGisClick(target) {
  const btn = target.closest('[data-gis-filter]');
  if (!btn || !lastReport) return false;
  paint(btn.dataset.gisFilter);
  return true;
}

async function runCheck() {
  if (!picked || !picked.files.length) { showToast('Chọn thư mục HoSoGIS hoặc file .zip', 'error'); return; }
  if (api && api.hasSession() && !confirm('Đóng bảng thẩm định đang mở để xem kết quả kiểm tra GIS?')) return;
  const btn = $('btnGisCheck');
  if (btn) btn.disabled = true;
  const status = $('gisPickLabel');
  try {
    const report = await inspectGisFiles(picked.files, picked.label, (msg) => { if (status) status.textContent = msg; });
    lastReport = report;
    lastFilter = 'all';
    api.replaceSheet(gisReportHtml(report, 'all', api.sizeHtml()));
    api.closePanel();
    const [title] = VERDICT[report.verdict] || VERDICT.fail;
    showToast(`${title}: ${fmtNum(report.counts.fail)} mục không đạt, ${fmtNum(report.counts.warn)} cảnh báo`);
  } catch (e) {
    showToast(e.message || 'Không đọc được hồ sơ GIS', 'error');
  } finally {
    if (btn) btn.disabled = !picked;
    if (status && picked) status.textContent = `${picked.label}: ${fmtNum(picked.files.length)} tệp trên máy này, chưa gửi đi đâu.`;
  }
}

export function initGisDossier(hooks) {
  api = hooks;
  document.querySelectorAll('input[name="reviewMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const gis = radio.value === 'gis';
      const dxf = $('reviewDxfPane');
      const pane = $('reviewGisPane');
      if (dxf) dxf.hidden = gis;
      if (pane) pane.hidden = !gis;
    });
  });
  $('btnGisFolder')?.addEventListener('click', async () => {
    try {
      const next = await pickFolder();
      if (next) setPick(next);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      showToast(e.message || 'Không chọn được thư mục', 'error');
    }
  });
  $('gisZip')?.addEventListener('change', async () => {
    const file = $('gisZip').files && $('gisZip').files[0];
    const nameEl = $('gisZipName');
    if (!file) return;
    if (nameEl) nameEl.textContent = file.name;
    if (file.size > 600 * 1024 * 1024) {
      showToast('File zip lớn hơn 600 MB. Chọn thư mục trên máy thay vì nén.', 'error');
      return;
    }
    try {
      showToast('Đang mở file zip…');
      const buf = await file.arrayBuffer();
      const files = zipFiles(buf);
      setPick({ label: file.name.replace(/\.zip$/i, ''), files });
    } catch (e) {
      showToast(e.message || 'Không đọc được file zip', 'error');
    }
  });
  $('btnGisCheck')?.addEventListener('click', runCheck);
}
