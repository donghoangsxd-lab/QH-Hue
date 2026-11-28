// Gộp ranh dự án kêu gọi đầu tư. Sau một lần tải server thành công, danh sách nhóm trên server là chuẩn.
// Chỉ nhóm local pending (máy này vừa sửa và còn lệnh chưa ghi) được giữ. Nhóm không pending mà server đã xóa thì bỏ.
// server không phải mảng: bản đóng gói hoặc mất mạng, giữ nguyên bản local.
// Ngoài nhóm Admin: stampNameInvestGroups gộp mọi ranh trùng tên (KML nhiều polygon) thành một dự án.

function keyList(keys) {
  const out = [];
  const seen = new Set();
  (Array.isArray(keys) ? keys : []).forEach(k => {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

function sigOf(keys) {
  return keyList(keys).slice().sort().join('\0');
}

function normalizeGroup(g, pending) {
  const keys = keyList(g && g.keys);
  if (keys.length < 2) return null;
  const out = { id: String((g && g.id) || keys[0]), keys };
  if (pending) out.pending = true;
  return out;
}

export function mergeInvestGroups(server, local) {
  const localGroups = (Array.isArray(local) ? local : [])
    .map(g => normalizeGroup(g, !!g?.pending))
    .filter(Boolean);
  if (!Array.isArray(server)) return localGroups;
  const serverGroups = server.map(g => normalizeGroup(g, false)).filter(Boolean);
  const used = new Set();
  serverGroups.forEach(g => g.keys.forEach(k => used.add(k)));
  const seen = new Set(serverGroups.map(g => sigOf(g.keys)));
  const extra = [];
  localGroups.forEach(g => {
    if (!g.pending || !g.keys.every(k => !used.has(k))) return;
    const sig = sigOf(g.keys);
    if (seen.has(sig)) return;
    seen.add(sig);
    g.keys.forEach(k => used.add(k));
    extra.push(g);
  });
  return serverGroups.concat(extra);
}

// Sửa lạc quan. Chỉ nhóm vừa bị cắt khóa, hoặc nhóm mới, mang pending. Nhóm không đụng tới giữ nguyên cờ.
export function editInvestGroups(groups, keys, clear, id) {
  const drop = new Set(keyList(keys));
  const next = [];
  (Array.isArray(groups) ? groups : []).forEach(g => {
    const norm = normalizeGroup(g, !!g?.pending);
    if (!norm) return;
    const kept = norm.keys.filter(k => !drop.has(k));
    if (kept.length < 2) return;
    if (kept.length === norm.keys.length) next.push(norm);
    else next.push({ id: norm.id, keys: kept, pending: true });
  });
  const fresh = keyList(keys);
  if (!clear && fresh.length >= 2) next.push({ id: String(id || fresh[0]), keys: fresh, pending: true });
  return next;
}

function normalizeOps(ops) {
  const out = [];
  (Array.isArray(ops) ? ops : []).forEach(op => {
    const keys = keyList(op && op.keys);
    const clear = !!(op && op.clear);
    if (!keys.length || (!clear && keys.length < 2)) return;
    out.push({ keys, clear });
  });
  return out;
}

// Ghép server với local, rồi bỏ lệnh đã có trên server. pending chỉ còn giá trị nếu còn lệnh tạo tương ứng
// (bản local cũ gắn pending cho mọi nhóm không được gửi lại).
export function settleInvestSync(server, local, ops) {
  const queued = normalizeOps(ops);
  const createSigs = new Set(queued.filter(op => !op.clear).map(op => sigOf(op.keys)));
  const localGroups = (Array.isArray(local) ? local : []).map(g => {
    if (!g || !g.pending || createSigs.has(sigOf(g.keys))) return g;
    return { id: g.id, keys: g.keys, pending: false };
  });
  const groups = mergeInvestGroups(server, localGroups);
  if (!Array.isArray(server)) return { groups, ops: queued };
  const serverGroups = server.map(g => normalizeGroup(g, false)).filter(Boolean);
  const used = new Set();
  const serverSigs = new Set();
  serverGroups.forEach(g => {
    serverSigs.add(sigOf(g.keys));
    g.keys.forEach(k => used.add(k));
  });
  const kept = queued.filter(op => (op.clear ? op.keys.some(k => used.has(k)) : !serverSigs.has(sigOf(op.keys))));
  return { groups, ops: kept };
}

/** Khóa gộp theo tên ranh: bỏ dấu, gộp khoảng trắng; bỏ hậu tố (mảnh N). */
export function investBoundGroupKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s*\((?:mảnh|manh|phần|phan)\s*\d+\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAutoNameInvestGroup(groupId) {
  return String(groupId || '').startsWith('name:');
}

/**
 * Gán groupId `name:…` cho các feature cùng tên chưa thuộc nhóm Admin.
 * Một dự án = nhiều polygon không liền kề khi KML tách Placemark trùng tên.
 */
export function stampNameInvestGroups(features) {
  const buckets = new Map();
  (Array.isArray(features) ? features : []).forEach(f => {
    if (!f?.properties || f.properties.groupId) return;
    const key = investBoundGroupKey(f.properties.name);
    if (!key) return;
    let list = buckets.get(key);
    if (!list) buckets.set(key, list = []);
    list.push(f);
  });
  let n = 0;
  buckets.forEach((list, key) => {
    if (list.length < 2) return;
    const gid = `name:${key}`;
    list.forEach(f => { f.properties.groupId = gid; });
    n += 1;
  });
  return n;
}
