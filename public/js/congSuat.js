// Quy mô / công suất / khối lượng theo đồ án HTKT.
// Trần: tổng QHC 1/10.000 không vượt QHC 1/25.000 thành phố;
// tổng QHPK trong một QHC 1/10.000 không vượt đồ án cha;
// tổng QHCT trong một QHPK không vượt đồ án cha.
// Ô trống là thiếu số. Số 0 là số đã nhập. Thiếu con hoặc thiếu cha thì không kết luận OK.
// Đơn vị lấy từ dòng dữ liệu. Bộ quy tắc rules/tuan-thu-cap-do chưa chốt đơn vị một số ngành.

import { catalogLevel } from './htktModel.js';
import { SHELL_V, withAssetVersion } from './gbaVersion.js';

export const CITY_QHC25_ID = 'qhc-hue-2045';
export const DRAFT_KEY = 'qh-cong-suat-draft-v1';

export const CAP_LABEL = {
  QHC25: 'QHC 1/25.000',
  QHC10: 'QHC 1/10.000',
  QHPK: 'QHPK 1/2.000',
  QHCT: 'QHCT 1/500'
};

const CAP_RANK = { QHC25: 0, QHC10: 1, QHPK: 2, QHCT: 3 };
const PARENT_CAP = { QHC10: 'QHC25', QHPK: 'QHC10', QHCT: 'QHPK' };

export const CAPACITY_METRICS = [
  { sector: 'giao-thong', chiTieu: 'khoi-luong', label: 'khối lượng giao thông', kind: 'khoi-luong', rule: null },
  { sector: 'cap-nuoc', chiTieu: 'cong-suat', label: 'công suất cấp nước', kind: 'cong-suat', rule: 'CN-03' },
  { sector: 'cap-dien', chiTieu: 'cong-suat', label: 'công suất trạm', kind: 'cong-suat', rule: 'CD-02' },
  { sector: 'san-nen-thoat-mua', chiTieu: 'cong-suat', label: 'công suất công trình tiêu', kind: 'cong-suat', rule: 'SN-05' },
  { sector: 'thoat-nuoc-thai', chiTieu: 'cong-suat', label: 'công suất trạm xử lý', kind: 'cong-suat', rule: 'NT-03' },
  { sector: 'chat-thai-ran-nghia-trang', chiTieu: 'quy-mo', label: 'quy mô chất thải rắn và nghĩa trang', kind: 'quy-mo', rule: 'CTR-02' },
  { sector: 'thong-tin-lien-lac', chiTieu: 'dung-luong', label: 'dung lượng tuyến trục', kind: 'dung-luong', rule: 'TT-02' }
];

const METRIC_BY_SECTOR = new Map(CAPACITY_METRICS.map(m => [m.sector, m]));

const FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

let state = emptyState();
const notices = new Map();

function emptyState() {
  return { schemes: [], sheetRows: [], sheetLinks: [], draftRows: [], draftLinks: [] };
}

export function metricFor(sector) {
  return METRIC_BY_SECTOR.get(sector) || null;
}

export function schemeSlug(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function parseCapacity(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const norm = s.replace(/\s/g, '');
  let n;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(norm)) n = Number(norm.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d+,\d+$/.test(norm)) n = Number(norm.replace(',', '.'));
  else n = Number(norm.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function formatQty(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return FMT.format(Number(n));
}

export function canonicalId(scheme) {
  if (!scheme) return '';
  if (typeof scheme === 'string') return scheme;
  return String(scheme.catalogScheme || scheme.id || scheme.slug || '');
}

export function capOfScheme(scheme) {
  if (!scheme) return null;
  if (scheme.cap && CAP_RANK[scheme.cap] != null) return scheme.cap;
  const fromLevel = catalogLevel(scheme.level, scheme.scale);
  if (fromLevel) return fromLevel;
  return capFromId(canonicalId(scheme));
}

export function capFromId(id) {
  const s = String(id || '');
  if (!s) return null;
  if (s === CITY_QHC25_ID) return 'QHC25';
  if (s.startsWith('qhpk-')) return 'QHPK';
  if (s.startsWith('qhct-')) return 'QHCT';
  return null;
}

function over(sum, ceiling) {
  return sum - ceiling > 1e-6;
}

export function buildCapacityGraph(schemes, extraLinks = []) {
  const nodes = new Map();
  const alias = new Map();

  function addNode(row, stub) {
    const id = canonicalId(row);
    if (!id) return null;
    const cap = capOfScheme(row) || capFromId(id);
    const prev = nodes.get(id);
    const node = prev || { id, name: row.name || id, cap, stub: !!stub, children: [], parent: null };
    if (row.name) node.name = row.name;
    if (cap) node.cap = cap;
    if (prev && !stub) node.stub = false;
    nodes.set(id, node);
    if (row.slug) alias.set(String(row.slug), id);
    if (row.catalogScheme) alias.set(String(row.catalogScheme), id);
    alias.set(id, id);
    return node;
  }

  (schemes || []).forEach(row => { if (row) addNode(row, !!row.stub); });
  if (!nodes.has(CITY_QHC25_ID)) {
    addNode({
      id: CITY_QHC25_ID,
      slug: CITY_QHC25_ID,
      name: 'QHC đô thị Thừa Thiên Huế 1/25.000',
      cap: 'QHC25',
      level: 'QHC25'
    }, true);
  }

  function resolve(raw) {
    if (!raw) return '';
    const key = String(raw);
    return alias.get(key) || key;
  }

  function ensure(raw) {
    const id = resolve(raw);
    if (!id) return '';
    if (!nodes.has(id)) addNode({ id, slug: id, name: id, cap: capFromId(id), level: capFromId(id) }, true);
    return id;
  }

  (schemes || []).forEach(row => { if (row && row.parent) ensure(row.parent); });

  const parentOf = new Map();
  const explicit = new Set();

  function link(childId, parentId) {
    const child = nodes.get(childId);
    const parent = nodes.get(parentId);
    if (!child || !parent || childId === parentId) return false;
    const expect = PARENT_CAP[child.cap];
    if (!expect || parent.cap !== expect) return false;
    parentOf.set(childId, parentId);
    return true;
  }

  (extraLinks || []).forEach(row => {
    if (!row || row.placeholder) return;
    const cid = ensure(row.child);
    const pid = ensure(row.parent);
    if (link(cid, pid)) explicit.add(cid);
  });

  (schemes || []).forEach(row => {
    if (!row || !row.parent) return;
    const id = resolve(canonicalId(row));
    if (!id || explicit.has(id)) return;
    const node = nodes.get(id);
    if (!node || (node.cap !== 'QHPK' && node.cap !== 'QHCT')) return;
    link(id, resolve(row.parent));
  });

  nodes.forEach(node => {
    if (node.cap !== 'QHC10' || explicit.has(node.id)) return;
    link(node.id, CITY_QHC25_ID);
  });

  nodes.forEach(node => { node.children = []; node.parent = parentOf.get(node.id) || null; });
  parentOf.forEach((pid, cid) => {
    const parent = nodes.get(pid);
    if (parent && !parent.children.includes(cid)) parent.children.push(cid);
  });
  nodes.forEach(node => {
    node.children.sort((a, b) => (nodes.get(a).name || a).localeCompare(nodes.get(b).name || b, 'vi'));
  });

  return { nodes, alias, cityId: CITY_QHC25_ID, resolve };
}

export function indexCapacityRows(rows, alias) {
  const map = new Map();
  const resolve = raw => {
    const key = String(raw || '');
    return (alias && alias.get(key)) || key;
  };
  (rows || []).forEach(row => {
    if (!row) return;
    const id = resolve(row.maDoAn);
    const nhom = String(row.nhom || '');
    const chi = String(row.chiTieu || '');
    if (!id || !nhom || !chi) return;
    const key = `${id}|${nhom}|${chi}`;
    if (row.cleared) {
      map.delete(key);
      return;
    }
    const value = parseCapacity(row.giaTri);
    map.set(key, {
      id,
      nhom,
      chiTieu: chi,
      value,
      unit: String(row.donVi || '').trim(),
      tenChiTieu: row.tenChiTieu || ''
    });
  });
  return map;
}

function rowAt(index, id, metric) {
  if (!metric) return null;
  return index.get(`${id}|${metric.sector}|${metric.chiTieu}`) || null;
}

function unitBit(unit) {
  return unit ? ` ${unit}` : '';
}

export function totalSentence(name, metric, value, unit, indicator) {
  const head = `Tổng ${metric.label} của đồ án ${name}`;
  if (value == null) return `${head}: chưa có số`;
  const extra = indicator && indicator !== metric.label ? ` (${indicator})` : '';
  return `${head}: ${formatQty(value)}${unitBit(unit)}${extra}`;
}

export function rollupCheck({ title, metric, parent, children, index }) {
  const parentRow = parent ? rowAt(index, parent.id, metric) : null;
  const parentValue = parentRow ? parentRow.value : null;
  const listed = (children || []).map(node => {
    const row = rowAt(index, node.id, metric);
    return { id: node.id, name: node.name || node.id, value: row ? row.value : null, unit: row ? row.unit : '' };
  });
  const base = {
    title,
    metric,
    parentId: parent ? parent.id : '',
    parentName: parent ? parent.name : '',
    parentCap: parent ? parent.cap : '',
    parentValue,
    unit: parentRow ? parentRow.unit : '',
    indicator: parentRow ? parentRow.tenChiTieu || '' : '',
    sum: null,
    delta: null,
    headroom: null,
    missing: [],
    status: 'thieu',
    label: 'chưa đủ dữ liệu',
    reason: ''
  };
  if (!parent) return { ...base, reason: 'khong-cha' };
  if (parentValue == null) return { ...base, reason: 'cha' };
  if (parentValue < 0) return { ...base, reason: 'am' };
  if (!listed.length) return { ...base, reason: 'khong-con' };
  const bad = listed.filter(row => row.value != null && row.value < 0);
  if (bad.length) return { ...base, reason: 'am', missing: bad.map(row => ({ id: row.id, name: row.name })) };
  const units = new Set();
  if (base.unit) units.add(base.unit);
  listed.forEach(row => { if (row.value != null && row.unit) units.add(row.unit); });
  const blankUnit = listed.some(row => row.value != null && !row.unit);
  if (units.size > 1 || (units.size === 1 && blankUnit)) return { ...base, reason: 'don-vi' };
  const unit = base.unit || [...units][0] || '';
  const missing = listed.filter(row => row.value == null).map(row => ({ id: row.id, name: row.name }));
  const known = listed.filter(row => row.value != null);
  const sum = known.reduce((acc, row) => acc + row.value, 0);
  const shared = { ...base, unit, sum, missing };
  if (over(sum, parentValue)) {
    return { ...shared, status: 'vuot', label: 'vượt', delta: sum - parentValue, reason: missing.length ? 'thieu-con' : '' };
  }
  if (missing.length) return { ...shared, reason: 'thieu-con' };
  return { ...shared, status: 'ok', label: 'OK', headroom: parentValue - sum, reason: '' };
}

export function checkSentence(check) {
  const metric = check.metric ? check.metric.label : 'chỉ tiêu';
  const parentBit = check.parentName ? ` của đồ án ${check.parentName}` : '';
  const head = `${check.title} — ${metric}${parentBit}`;
  const unit = unitBit(check.unit);
  const indicator = check.indicator && check.indicator !== metric ? ` (${check.indicator})` : '';
  if (check.status === 'ok') {
    return `${head}: OK. Tổng ${formatQty(check.sum)}${unit}, trần ${formatQty(check.parentValue)}${unit}${indicator}, còn ${formatQty(check.headroom)}${unit}.`;
  }
  if (check.status === 'vuot') {
    const gap = check.missing && check.missing.length ? ` Còn ${check.missing.length} đồ án chưa có số.` : '';
    return `${head}: vượt ${formatQty(check.delta)}${unit}. Tổng ${formatQty(check.sum)}${unit}, trần ${formatQty(check.parentValue)}${unit}${indicator}.${gap}`;
  }
  if (check.reason === 'khong-con') return `${head}: chưa đủ dữ liệu. Chưa có đồ án con liên kết.`;
  if (check.reason === 'khong-cha') return `${head}: chưa đủ dữ liệu. Chưa liên kết đồ án cha.`;
  if (check.reason === 'khong-phai-tran') return `${head}: chưa đủ dữ liệu. Đồ án này không phải trần QHC 1/25.000 thành phố.`;
  if (check.reason === 'cha') return `${head}: chưa đủ dữ liệu. Đồ án cha chưa có số.`;
  if (check.reason === 'don-vi') return `${head}: chưa đủ dữ liệu. Không cùng đơn vị.`;
  if (check.reason === 'am') return `${head}: chưa đủ dữ liệu. Giá trị âm không dùng để đối chiếu.`;
  if (check.missing && check.missing.length) {
    const names = check.missing.map(row => row.name).join(', ');
    return `${head}: chưa đủ dữ liệu. Thiếu số: ${names}.`;
  }
  return `${head}: chưa đủ dữ liệu.`;
}

function childNodes(graph, parent) {
  return (parent.children || []).map(id => graph.nodes.get(id)).filter(Boolean);
}

export function checksForScheme(schemeId, graph, index, metric) {
  const node = graph.nodes.get(schemeId);
  if (!metric) return [];
  if (!node) {
    return [rollupCheck({
      title: 'Đối chiếu với cấp trên',
      metric,
      parent: null,
      children: [],
      index
    })];
  }
  const checks = [];
  if (node.cap === 'QHC25' && node.id !== graph.cityId) {
    return [{
      title: 'Đối chiếu trần thành phố',
      metric,
      parentId: graph.cityId,
      parentName: (graph.nodes.get(graph.cityId) || {}).name || '',
      parentCap: 'QHC25',
      parentValue: null,
      unit: '',
      sum: null,
      delta: null,
      headroom: null,
      missing: [],
      status: 'thieu',
      label: 'chưa đủ dữ liệu',
      reason: 'khong-phai-tran'
    }];
  }
  const parent = node.parent ? graph.nodes.get(node.parent) : null;
  if (parent) {
    const childCap = node.cap;
    checks.push(rollupCheck({
      title: `Đối chiếu ${CAP_LABEL[childCap] || childCap} với ${CAP_LABEL[parent.cap] || parent.cap}`,
      metric,
      parent,
      children: childNodes(graph, parent),
      index
    }));
  } else if (node.cap !== 'QHC25') {
    checks.push(rollupCheck({
      title: `Đối chiếu ${CAP_LABEL[node.cap] || node.cap} với cấp trên`,
      metric,
      parent: null,
      children: [],
      index
    }));
  }
  const childCap = { QHC25: 'QHC10', QHC10: 'QHPK', QHPK: 'QHCT' }[node.cap];
  if (childCap && (node.cap !== 'QHC25' || node.id === graph.cityId)) {
    checks.push(rollupCheck({
      title: `Đối chiếu ${CAP_LABEL[childCap]} với ${CAP_LABEL[node.cap]}`,
      metric,
      parent: node,
      children: childNodes(graph, node),
      index
    }));
  }
  return checks;
}

export function combineChecks(checks) {
  const list = checks || [];
  const vuot = list.filter(row => row.status === 'vuot');
  if (vuot.length) return { status: 'vuot', label: 'vượt', checks: list };
  if (!list.length || list.some(row => row.status !== 'ok')) return { status: 'thieu', label: 'chưa đủ dữ liệu', checks: list };
  return { status: 'ok', label: 'OK', checks: list };
}

function stackedRows(sheet, draft) {
  return (sheet || []).concat(draft || []);
}

export function activeRows() {
  return stackedRows(state.sheetRows, state.draftRows);
}

export function activeLinks() {
  const map = new Map();
  (state.sheetLinks || []).concat(state.draftLinks || []).forEach(row => {
    if (!row || row.placeholder || !row.child) return;
    if (row.cleared) map.delete(String(row.child));
    else map.set(String(row.child), { child: String(row.child), parent: String(row.parent || '') });
  });
  return [...map.values()].filter(row => row.parent);
}

export function activeGraph() {
  return buildCapacityGraph(state.schemes, activeLinks());
}

export function capacityView(schemeId, sectors, schemeName) {
  const graph = activeGraph();
  const index = indexCapacityRows(activeRows(), graph.alias);
  const id = graph.resolve(schemeId) || String(schemeId || '');
  const node = graph.nodes.get(id);
  const name = schemeName || (node && node.name) || schemeId || id;
  const metrics = (sectors || []).map(metricFor).filter(Boolean);
  const blocks = metrics.map(metric => {
    const row = rowAt(index, id, metric);
    const checks = checksForScheme(id, graph, index, metric);
    const combined = combineChecks(checks);
    return {
      metric,
      value: row ? row.value : null,
      unit: row ? row.unit : '',
      sentence: totalSentence(name, metric, row ? row.value : null, row ? row.unit : '', row ? row.tenChiTieu : ''),
      checks,
      status: combined.status,
      label: combined.label
    };
  });
  return { id, name, cap: node ? node.cap : '', parent: node ? node.parent : null, blocks, notice: notices.get(id) || null };
}

export function setCapacityNotice(id, text, kind) {
  if (!id) return;
  if (!text) notices.delete(id);
  else notices.set(id, { text, kind: kind || 'thieu' });
}

function parentCapOf(parentId, schemes) {
  const graph = buildCapacityGraph(schemes, []);
  const id = graph.resolve(parentId) || String(parentId || '');
  const node = graph.nodes.get(id);
  if (node && node.cap) return { id, cap: node.cap };
  return { id, cap: capFromId(id) };
}

export function assessCapacityWrite(ctx) {
  const schemeId = String(ctx.schemeId || '').trim();
  const cap = ctx.cap || capOfScheme({ level: ctx.level, scale: ctx.scale, slug: schemeId, cap: ctx.cap });
  const metric = ctx.metric || metricFor(ctx.sector);
  if (!schemeId || !metric) {
    return {
      accept: false,
      status: 'thieu',
      label: 'chưa đủ dữ liệu',
      schemeId,
      link: null,
      linkError: 'Thiếu mã đồ án hoặc ngành.',
      sentences: ['Thiếu mã đồ án hoặc ngành.'],
      checks: []
    };
  }
  const proposed = parseCapacity(ctx.giaTri);
  const invalid = ctx.giaTri != null && String(ctx.giaTri).trim() !== '' && (proposed == null || proposed < 0);
  const schemes = (ctx.schemes || state.schemes || []).map(row => ({ ...row }));
  if (schemeId && !schemes.some(row => canonicalId(row) === schemeId || row.slug === schemeId)) {
    schemes.push({
      slug: schemeId,
      name: ctx.schemeName || schemeId,
      cap,
      level: cap,
      parent: null,
      stub: true
    });
  }
  let link = null;
  let linkError = '';
  const expect = PARENT_CAP[cap];
  if (cap === 'QHC10') link = { child: schemeId, parent: CITY_QHC25_ID };
  else if (expect) {
    const parentRaw = String(ctx.parentId || '').trim();
    if (parentRaw) {
      const found = parentCapOf(parentRaw, schemes);
      if (!found.cap) linkError = 'Chưa xác định được cấp của đồ án cha.';
      else if (found.cap !== expect) linkError = `Đồ án cha phải là cấp ${CAP_LABEL[expect]}.`;
      else link = { child: schemeId, parent: found.id };
    }
  }
  if (invalid) {
    return {
      accept: false,
      status: 'thieu',
      label: 'chưa đủ dữ liệu',
      schemeId,
      link: null,
      linkError: '',
      sentences: ['Giá trị không hợp lệ. Nhập số không âm hoặc để trống.'],
      checks: []
    };
  }
  if (linkError) {
    return {
      accept: false,
      status: 'thieu',
      label: 'chưa đủ dữ liệu',
      schemeId,
      link: null,
      linkError,
      sentences: [linkError],
      checks: []
    };
  }
  const links = (ctx.links || activeLinks()).filter(row => row.child !== schemeId);
  if (link) links.push(link);
  const graph = buildCapacityGraph(schemes, links);
  const id = graph.resolve(schemeId) || schemeId;
  const wrote = ctx.clear === true || (ctx.giaTri != null && String(ctx.giaTri).trim() !== '');
  const rows = (ctx.rows || activeRows()).filter(row => {
    if (!wrote) return true;
    const rid = graph.resolve(row.maDoAn) || row.maDoAn;
    return !(rid === id && row.nhom === metric.sector && row.chiTieu === metric.chiTieu);
  });
  if (wrote && proposed == null) rows.push({ maDoAn: id, nhom: metric.sector, chiTieu: metric.chiTieu, cleared: true });
  else if (wrote) rows.push({ maDoAn: id, nhom: metric.sector, chiTieu: metric.chiTieu, giaTri: proposed, donVi: String(ctx.donVi || '').trim() });
  const index = indexCapacityRows(rows, graph.alias);
  const checks = checksForScheme(id, graph, index, metric);
  const combined = combineChecks(checks);
  const sentences = checks.map(checkSentence);
  const parentRaw = String(ctx.parentId || '').trim();
  if (cap === 'QHC10' && parentRaw && parentRaw !== CITY_QHC25_ID) {
    sentences.unshift('QHC 1/10.000 được cộng vào trần QHC 1/25.000 thành phố.');
  }
  return {
    accept: combined.status !== 'vuot',
    status: combined.status,
    label: combined.label,
    schemeId: id,
    link,
    linkError: '',
    sentences,
    checks
  };
}

export function gateCapacityEntries(entries) {
  const list = (entries || []).filter(row => row && (String(row.giaTri || '').trim() !== '' || String(row.parentId || '').trim() !== ''));
  if (!list.length) return { accept: true, status: 'thieu', label: 'chưa đủ dữ liệu', sentences: [], results: [] };
  const results = [];
  let rows = activeRows().slice();
  let links = activeLinks().slice();
  let blocked = false;
  list.forEach(entry => {
    const result = assessCapacityWrite({ ...entry, rows, links, schemes: state.schemes });
    results.push(result);
    if (!result.accept) {
      blocked = true;
      return;
    }
    const metric = entry.metric || metricFor(entry.sector);
    rows = rows.filter(row => !(row.maDoAn === result.schemeId && row.nhom === metric.sector && row.chiTieu === metric.chiTieu));
    const proposed = parseCapacity(entry.giaTri);
    if (proposed == null) rows.push({ maDoAn: result.schemeId, nhom: metric.sector, chiTieu: metric.chiTieu, cleared: true });
    else rows.push({ maDoAn: result.schemeId, nhom: metric.sector, chiTieu: metric.chiTieu, giaTri: proposed, donVi: entry.donVi || '' });
    if (result.link) {
      links = links.filter(row => row.child !== result.link.child);
      links.push(result.link);
    }
  });
  const sentences = results.flatMap(row => row.sentences);
  if (blocked) return { accept: false, status: 'vuot', label: 'vượt', sentences, results };
  if (results.some(row => row.status !== 'ok')) return { accept: true, status: 'thieu', label: 'chưa đủ dữ liệu', sentences, results };
  return { accept: true, status: 'ok', label: 'OK', sentences, results };
}

function storageOf(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (err) { return null; }
}

export function readDraft(storage) {
  const box = storageOf(storage);
  if (!box) return { rows: [], links: [] };
  try {
    const doc = JSON.parse(box.getItem(DRAFT_KEY) || '');
    return {
      rows: Array.isArray(doc && doc.rows) ? doc.rows : [],
      links: Array.isArray(doc && doc.links) ? doc.links : []
    };
  } catch (err) {
    return { rows: [], links: [] };
  }
}

function writeDraft(storage) {
  const box = storageOf(storage);
  if (!box) return;
  box.setItem(DRAFT_KEY, JSON.stringify({ rows: state.draftRows, links: state.draftLinks }));
}

export function setCapacityState(next) {
  state = { ...emptyState(), ...state, ...next };
}

export function commitCapacityResult(result, entry, storage) {
  if (!result || !result.accept) return false;
  const metric = entry.metric || metricFor(entry.sector);
  const id = result.schemeId;
  const wrote = entry.clear === true || (entry.giaTri != null && String(entry.giaTri).trim() !== '');
  if (wrote && metric) {
    state.draftRows = state.draftRows.filter(row => !(row.maDoAn === id && row.nhom === metric.sector && row.chiTieu === metric.chiTieu));
    const proposed = parseCapacity(entry.giaTri);
    if (proposed == null) state.draftRows.push({ maDoAn: id, nhom: metric.sector, chiTieu: metric.chiTieu, cleared: true });
    else {
      state.draftRows.push({
        maDoAn: id,
        tenDoAn: entry.schemeName || '',
        cap: entry.cap || '',
        nhom: metric.sector,
        chiTieu: metric.chiTieu,
        tenChiTieu: metric.label,
        donVi: String(entry.donVi || '').trim(),
        giaTri: proposed,
        nguon: 'nháp trình duyệt'
      });
    }
  }
  if (result.link) {
    state.draftLinks = state.draftLinks.filter(row => row.child !== result.link.child);
    state.draftLinks.push(result.link);
  }
  writeDraft(storage);
  return true;
}

export function commitCapacityEntries(gate, entries, storage) {
  if (!gate || !gate.accept) return false;
  (entries || []).forEach((entry, i) => {
    const result = gate.results[i];
    if (result) commitCapacityResult(result, entry, null);
  });
  writeDraft(storage);
  return true;
}

export function clearSchemeDraft(schemeId, storage) {
  const id = String(schemeId || '');
  state.draftRows = state.draftRows.filter(row => row.maDoAn !== id);
  state.draftLinks = state.draftLinks.filter(row => row.child !== id);
  notices.delete(id);
  writeDraft(storage);
}

export function applyCapacityDoc(doc, schemesDoc) {
  const rows = doc && Array.isArray(doc.rows) ? doc.rows : [];
  const links = doc && Array.isArray(doc.links) ? doc.links : [];
  const schemes = schemesDoc && Array.isArray(schemesDoc.schemes) ? schemesDoc.schemes : [];
  const draft = readDraft();
  state = {
    schemes,
    sheetRows: rows,
    sheetLinks: links,
    draftRows: draft.rows,
    draftLinks: draft.links
  };
  return state;
}

export async function loadCongSuat(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;
  const href = (file, version) => {
    if (typeof document === 'undefined') return file;
    const u = new URL(file, document.baseURI);
    u.searchParams.set('v', version);
    return u.href;
  };
  try {
    const [valueRes, schemeRes] = await Promise.all([
      doFetch(href('data/htkt/cong-suat.json', SHELL_V)),
      doFetch(typeof document !== 'undefined' ? withAssetVersion('data/chuyen-nganh/schemes.json') : 'data/chuyen-nganh/schemes.json')
    ]);
    if (!valueRes || !valueRes.ok || !schemeRes || !schemeRes.ok) return false;
    applyCapacityDoc(await valueRes.json(), await schemeRes.json());
    return true;
  } catch (err) {
    return false;
  }
}
