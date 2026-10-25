// Khung quy mô hạ tầng khi mở đồ án. Số vượt trần đã có thì không ghi.

import { escapeHtml } from './utils.js';
import { SECTORS } from './facetStore.js';
import { PIPE_SECTORS } from './htktModel.js';
import {
  CAPACITY_METRICS, capacityView, assessCapacityWrite, commitCapacityResult,
  clearSchemeDraft, setCapacityNotice, metricFor, checkSentence, schemeSlug, gateCapacityEntries,
  commitCapacityEntries
} from './congSuat.js';

function sectorsOf(sector, pipe) {
  if (pipe) return PIPE_SECTORS.slice();
  if (Array.isArray(sector)) return sector;
  if (sector && sector !== 'tong-hop-duong-ong') return [sector];
  return SECTORS.map(row => row.id);
}

export function capacityPanelHtml({ schemeId, schemeName, cap, sector, pipe = false } = {}) {
  const view = capacityView(schemeId, sectorsOf(sector, pipe), schemeName);
  const id = view.id || schemeId || '';
  const name = schemeName || view.name || id;
  const level = cap || view.cap || '';
  const lines = view.blocks.map(block => {
    const flags = block.checks.map(check => {
      const cls = check.status === 'ok' ? 'is-ok' : check.status === 'vuot' ? 'is-over' : 'is-gap';
      return `<p class="${cls}">${escapeHtml(checkSentence(check))}</p>`;
    }).join('');
    return `<p>${escapeHtml(block.sentence)}</p>${flags}`;
  }).join('');
  const fields = view.blocks.map(block => {
    const value = block.value == null ? '' : String(block.value);
    return `<label>${escapeHtml(block.metric.label)}
      <input data-cs-value data-cs-sector="${escapeHtml(block.metric.sector)}" data-cs-chi="${escapeHtml(block.metric.chiTieu)}" inputmode="decimal" value="${escapeHtml(value)}" aria-label="Giá trị ${escapeHtml(block.metric.label)}">
      <input data-cs-unit data-cs-sector="${escapeHtml(block.metric.sector)}" data-cs-chi="${escapeHtml(block.metric.chiTieu)}" value="${escapeHtml(block.unit)}" placeholder="Đơn vị" aria-label="Đơn vị ${escapeHtml(block.metric.label)}">
    </label>`;
  }).join('');
  const parentField = level === 'QHPK' || level === 'QHCT'
    ? `<label>Mã đồ án cha<input data-cs-parent value="${escapeHtml(view.parent || '')}" placeholder="${level === 'QHPK' ? 'mã QHC 1/10.000' : 'mã QHPK'}" aria-label="Mã đồ án cha"></label>`
    : (level === 'QHC10' ? '<p class="is-gap">Cộng vào trần QHC 1/25.000 thành phố.</p>' : '');
  const notice = view.notice ? `<p class="${view.notice.kind === 'vuot' ? 'is-over' : 'is-gap'}">${escapeHtml(view.notice.text)}</p>` : '';
  return `<section class="cn-capacity" data-cs-scheme="${escapeHtml(id)}" data-cs-name="${escapeHtml(name)}" data-cs-cap="${escapeHtml(level)}">
    <h4>Quy mô hạ tầng</h4>
    ${lines || '<p class="is-gap">Chưa có chỉ tiêu cho nhóm này.</p>'}
    ${notice}
    <details>
      <summary>Nhập số</summary>
      ${parentField}
      ${fields}
      <p class="cn-empty">Bản nháp lưu trên trình duyệt này. Số chính thức ghi tab CongSuatDoAn. Ô trống là chưa có số.</p>
      <button type="button" data-cs-clear>Xóa bản nháp của đồ án này</button>
    </details>
  </section>`;
}

function readEntries(section) {
  const schemeId = section.dataset.csScheme || '';
  const schemeName = section.dataset.csName || '';
  const cap = section.dataset.csCap || '';
  const parentInput = section.querySelector('[data-cs-parent]');
  const parentId = parentInput ? parentInput.value.trim() : '';
  const entries = [];
  section.querySelectorAll('[data-cs-value]').forEach(input => {
    const sector = input.dataset.csSector;
    const unitInput = section.querySelector(`[data-cs-unit][data-cs-sector="${sector}"][data-cs-chi="${input.dataset.csChi}"]`);
    entries.push({
      schemeId,
      schemeName,
      cap,
      parentId,
      sector,
      chiTieu: input.dataset.csChi,
      metric: metricFor(sector),
      giaTri: input.value,
      donVi: unitInput ? unitInput.value.trim() : '',
      clear: String(input.value || '').trim() === ''
    });
  });
  if (!entries.length && parentId) {
    const metric = CAPACITY_METRICS[0];
    entries.push({ schemeId, schemeName, cap, parentId, sector: metric.sector, metric, giaTri: '', donVi: '' });
  }
  return entries;
}

function paintSection(section, flash) {
  const schemeId = section.dataset.csScheme;
  if (flash) setCapacityNotice(schemeId, flash.text, flash.kind);
  else setCapacityNotice(schemeId, '');
  const html = capacityPanelHtml({
    schemeId,
    schemeName: section.dataset.csName,
    cap: section.dataset.csCap,
    sector: [...section.querySelectorAll('[data-cs-value]')].map(input => input.dataset.csSector)
  });
  section.outerHTML = html;
}

export function applyCapacityForm(section) {
  const entries = readEntries(section);
  const sentences = [];
  let blocked = null;
  entries.forEach(entry => {
    const result = assessCapacityWrite(entry);
    if (!result.accept) {
      blocked = result;
      return;
    }
    commitCapacityResult(result, entry);
    sentences.push(...result.sentences);
  });
  if (blocked) {
    paintSection(section, { text: blocked.sentences.join(' '), kind: 'vuot' });
    return blocked;
  }
  paintSection(section, null);
  return { accept: true, sentences };
}

export function hosoCapacityHtml(draft = {}) {
  const values = draft.values || {};
  const fields = CAPACITY_METRICS.map(metric => {
    const row = values[metric.sector] || {};
    return `<label>${escapeHtml(metric.label)}
      <input data-ho-cs="${escapeHtml(metric.sector)}" data-ho-chi="${escapeHtml(metric.chiTieu)}" inputmode="decimal" value="${escapeHtml(row.giaTri || '')}" aria-label="Giá trị ${escapeHtml(metric.label)}">
      <input data-ho-unit="${escapeHtml(metric.sector)}" value="${escapeHtml(row.donVi || '')}" placeholder="Đơn vị" aria-label="Đơn vị ${escapeHtml(metric.label)}">
    </label>`;
  }).join('');
  return `<details class="cn-capacity">
    <summary>Quy mô hạ tầng của đồ án</summary>
    <label>Mã đồ án<input id="hoCsId" value="${escapeHtml(draft.id || '')}" placeholder="Để trống thì lấy từ tên đồ án" aria-label="Mã đồ án"></label>
    <label>Mã đồ án cha<input id="hoCsParent" value="${escapeHtml(draft.parent || '')}" placeholder="QHC 1/10.000 hoặc QHPK" aria-label="Mã đồ án cha"></label>
    ${fields}
    <p class="cn-empty">Khi ghi số, hệ thống đối chiếu trần cấp trên. Vượt trần thì chưa lưu. Thiếu số thì ghi «chưa đủ dữ liệu», không tính là đạt.</p>
  </details>`;
}

export function readHosoCapacity(root) {
  const box = root || document;
  const values = {};
  box.querySelectorAll('[data-ho-cs]').forEach(input => {
    values[input.dataset.hoCs] = {
      giaTri: input.value,
      donVi: (box.querySelector(`[data-ho-unit="${input.dataset.hoCs}"]`) || {}).value || ''
    };
  });
  return {
    id: (box.querySelector('#hoCsId') || {}).value || '',
    parent: (box.querySelector('#hoCsParent') || {}).value || '',
    values
  };
}

export function gateHosoCapacity({ name, cap, draft }) {
  const schemeId = String((draft && draft.id) || '').trim() || schemeSlug(name);
  const parentId = String((draft && draft.parent) || '').trim();
  const entries = CAPACITY_METRICS.map(metric => {
    const row = (draft && draft.values && draft.values[metric.sector]) || {};
    return {
      schemeId,
      schemeName: name,
      cap,
      parentId,
      sector: metric.sector,
      metric,
      giaTri: row.giaTri || '',
      donVi: row.donVi || ''
    };
  }).filter(row => String(row.giaTri).trim() !== '');
  if (!entries.length && parentId) {
    entries.push({
      schemeId,
      schemeName: name,
      cap,
      parentId,
      sector: CAPACITY_METRICS[0].sector,
      metric: CAPACITY_METRICS[0],
      giaTri: '',
      donVi: ''
    });
  }
  const gate = gateCapacityEntries(entries);
  return { ...gate, schemeId, entries };
}

export function storeHosoCapacity(gate, entries) {
  return commitCapacityEntries(gate, entries);
}

export function initCapacityEditor() {
  if (typeof document === 'undefined' || document.documentElement.dataset.csBound) return;
  document.documentElement.dataset.csBound = '1';
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.matches('[data-cs-value], [data-cs-unit], [data-cs-parent]')) return;
    const section = t.closest('[data-cs-scheme]');
    if (section) applyCapacityForm(section);
  });
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-cs-clear]') : null;
    if (!btn) return;
    const section = btn.closest('[data-cs-scheme]');
    if (!section) return;
    clearSchemeDraft(section.dataset.csScheme);
    paintSection(section, { text: 'Đã xóa bản nháp trên trình duyệt này.', kind: 'thieu' });
  });
}

export function mountCapacityHosts() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-cs-host]').forEach(host => {
    host.innerHTML = capacityPanelHtml({
      schemeId: host.dataset.csHost,
      schemeName: host.dataset.csName || '',
      cap: host.dataset.csCap || '',
      sector: SECTORS.map(row => row.id)
    });
  });
}
