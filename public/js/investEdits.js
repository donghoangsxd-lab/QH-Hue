// Ghép hiệu chỉnh admin (invest_edits) lên danh sách sheet 15-DA phía client —
// tránh chờ Cloud Run trên đường tải lạnh trục F.
import { sheetProjectName } from './investMatch.js';

const GROUP_IDS = new Set([
  'dvtm', 'congnghiep', 'nangluong', 'khudothi', 'chungcu', 'nongnghiep', 'vanhoaxahoi', 'khac'
]);

export function sheetSig(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  if (!n) return '0';
  const a = sheetProjectName(list[0]);
  const mid = sheetProjectName(list[n >> 1]);
  const b = sheetProjectName(list[n - 1]);
  return `${n}|${a}|${mid}|${b}`;
}

export function parseInvestEditsStore(data) {
  if (!data || typeof data !== 'object') return { items: [], groups: [] };
  const items = [];
  (Array.isArray(data.items) ? data.items : []).forEach(it => {
    if (items.length >= 400) return;
    if (!it || !it.key || !it.fields || typeof it.fields !== 'object') return;
    const row = {
      key: String(it.key || '').trim().slice(0, 200),
      match: String(it.match || '').trim().slice(0, 200),
      fields: it.fields
    };
    const groupId = String(it.groupId || '').trim();
    if (GROUP_IDS.has(groupId)) row.groupId = groupId;
    if (it.geometry && (it.geometry.type === 'Polygon' || it.geometry.type === 'MultiPolygon')) {
      row.geometry = it.geometry;
    } else if (it.geometry === null) {
      row.geometry = null;
    }
    items.push(row);
  });
  const groups = [];
  (Array.isArray(data.groups) ? data.groups : []).forEach(g => {
    if (groups.length >= 200) return;
    const keys = [];
    const seen = new Set();
    (Array.isArray(g && g.keys) ? g.keys : []).forEach(k => {
      const key = String(k || '').trim().slice(0, 400);
      if (!key || seen.has(key) || keys.length >= 40) return;
      seen.add(key);
      keys.push(key);
    });
    if (keys.length < 2) return;
    groups.push({ id: String(g.id || '').trim().slice(0, 40) || (`g${groups.length}`), keys });
  });
  return { items, groups };
}

/** Cùng logic merge phía api/gee.js applyInvestEdits — trả rows + boundaries. */
export function applyInvestEditsClient(base, items) {
  const data = base
    ? { headers: Array.isArray(base.headers) ? base.headers.slice() : [], rows: (base.rows || []).map(r => ({ ...r })) }
    : { headers: [], rows: [] };
  const boundaries = [];
  (items || []).forEach(it => {
    const key = it.key;
    const match = it.match || '';
    let row = data.rows.find(r => r && r._alias === key);
    if (!row && match) row = data.rows.find(r => sheetProjectName(r) === match);
    if (!row && !match) row = data.rows.find(r => sheetProjectName(r) === key);
    if (!row) {
      row = {};
      data.rows.push(row);
    }
    const map = row._map;
    Object.keys(row).forEach(k => { if (!String(k).startsWith('_')) delete row[k]; });
    Object.assign(row, it.fields);
    row._alias = key;
    if (map) row._map = map;
    if (it.groupId) row._groupId = it.groupId;
    Object.keys(it.fields || {}).forEach(k => { if (!data.headers.includes(k)) data.headers.push(k); });
    if (it.geometry) boundaries.push({ key, match, geometry: it.geometry });
  });
  data.boundaries = boundaries;
  return data;
}

export function editsWorthApplying(store) {
  return !!(store && ((store.items && store.items.length) || (store.groups && store.groups.length)));
}
