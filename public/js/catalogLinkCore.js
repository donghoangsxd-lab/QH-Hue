/**
 * So sánh / ghép trường sổ tay ↔ meta bản đồ khi Admin gán ranh (không phụ thuộc Leaflet).
 */
import { escapeHtml } from './utils.js';
import { namesOfProject } from './projectNames.js';

export const LEVEL_TAB = { QHC: 'qhc10', QHPK: 'qhpk', QHCT: 'qhct' };

export function catalogLinkLevelTab(level) {
  const id = String(level || '').toUpperCase();
  return LEVEL_TAB[id] || 'qhpk';
}

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseVnNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function formatHa(ha) {
  if (!Number.isFinite(ha)) return '';
  return ha.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function mapAreaHa(tenQH, project, areaHaOf) {
  if (Number.isFinite(project?.areaHa)) return project.areaHa;
  if (typeof areaHaOf === 'function') {
    const n = areaHaOf(tenQH, project);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapDisplayName(tenQH, project) {
  if (project?.full) return String(project.full).trim();
  if (project?.short) return String(project.short).trim();
  const names = namesOfProject({ tenQH, ...(project || {}) });
  return String(names.tenDayDu || names.tenQH || tenQH || '').trim();
}

/**
 * @param {object} soTayItem
 * @param {string} tenQH
 * @param {object|null} project
 * @param {{ areaHaOf?: (tenQH: string, project: object|null) => number|null }} [opts]
 */
export function diffLinkFields(soTayItem, tenQH, project = null, opts = {}) {
  const sheet = soTayItem || {};
  const mapName = mapDisplayName(tenQH, project);
  const sheetName = String(sheet.ten || '').trim();
  const sheetHa = Number.isFinite(sheet.dienTichHa) ? sheet.dienTichHa : parseVnNumber(sheet.dienTichText);
  const mapHa = mapAreaHa(tenQH, project, opts.areaHaOf);
  const sheetPop = String(sheet.danSo || '').trim();
  const mapPop = String(project?.danSo || '').trim();

  const fields = [];
  if (sheetName || mapName) {
    if (fold(sheetName) !== fold(mapName)) {
      fields.push({ key: 'ten', label: 'Tên đồ án', sheet: sheetName, map: mapName });
    }
  }
  if (sheetHa != null || mapHa != null) {
    const a = sheetHa != null ? Math.round(sheetHa * 100) / 100 : null;
    const b = mapHa != null ? Math.round(mapHa * 100) / 100 : null;
    if (a != null && b != null && Math.abs(a - b) > 0.05) {
      fields.push({
        key: 'dienTich',
        label: 'Diện tích (ha)',
        sheet: formatHa(a),
        map: formatHa(b),
        sheetHa: a,
        mapHa: b
      });
    } else if (a == null && b != null) {
      fields.push({
        key: 'dienTich',
        label: 'Diện tích (ha)',
        sheet: '',
        map: formatHa(b),
        sheetHa: null,
        mapHa: b
      });
    }
  }
  if (sheetPop && mapPop && fold(sheetPop) !== fold(mapPop)) {
    fields.push({ key: 'danSo', label: 'Dân số', sheet: sheetPop, map: mapPop });
  }
  return fields;
}

export function buildLinkPatch(ma, soTayItem, tenQH, project, choices, opts = {}) {
  const sheet = soTayItem || {};
  const pick = choices || {};
  const mapName = mapDisplayName(tenQH, project);
  const mapHa = mapAreaHa(tenQH, project, opts.areaHaOf);
  const mapPop = String(project?.danSo || '').trim();

  const tenChoice = pick.ten || 'sheet';
  const areaChoice = pick.dienTich || 'sheet';
  const popChoice = pick.danSo || 'sheet';

  const ten = tenChoice === 'map' ? (mapName || sheet.ten || '') : (sheet.ten || mapName || '');
  let dienTichHa = Number.isFinite(sheet.dienTichHa) ? sheet.dienTichHa : parseVnNumber(sheet.dienTichText);
  let dienTichText = String(sheet.dienTichText || '').trim();
  if (areaChoice === 'map' && mapHa != null) {
    dienTichHa = mapHa;
    dienTichText = formatHa(mapHa);
  }
  const danSo = popChoice === 'map' && mapPop
    ? mapPop
    : String(sheet.danSo || '').trim();

  return {
    ma: String(ma || '').trim(),
    ten: String(ten || '').trim(),
    dienTichHa: Number.isFinite(dienTichHa) ? dienTichHa : null,
    dienTichText,
    danSo,
    quyetDinh: String(sheet.quyetDinh || '').trim(),
    dvhc: String(sheet.dvhc || sheet.diaDiem || '').trim()
  };
}

export function resolveFieldsHtml(fields) {
  if (!fields?.length) return '';
  return fields.map((f) => {
    const sheetVal = String(f.sheet || '').trim() || '—';
    const mapVal = String(f.map || '').trim() || '—';
    return `<fieldset class="catalog-resolve-field" data-resolve-key="${escapeHtml(f.key)}">
      <legend>${escapeHtml(f.label)}</legend>
      <label class="catalog-resolve-opt"><input type="radio" name="resolve-${escapeHtml(f.key)}" value="sheet" checked>
        <span class="catalog-resolve-src">Sổ tay</span>
        <span class="catalog-resolve-val" title="${escapeHtml(sheetVal)}">${escapeHtml(sheetVal)}</span>
      </label>
      <label class="catalog-resolve-opt"><input type="radio" name="resolve-${escapeHtml(f.key)}" value="map">
        <span class="catalog-resolve-src">Bản đồ</span>
        <span class="catalog-resolve-val" title="${escapeHtml(mapVal)}">${escapeHtml(mapVal)}</span>
      </label>
    </fieldset>`;
  }).join('');
}

export function readResolveChoices(root) {
  const out = {};
  if (!root) return out;
  root.querySelectorAll('[data-resolve-key]').forEach((fs) => {
    const key = fs.getAttribute('data-resolve-key');
    const checked = fs.querySelector('input[type="radio"]:checked');
    if (key && checked) out[key] = checked.value === 'map' ? 'map' : 'sheet';
  });
  return out;
}
