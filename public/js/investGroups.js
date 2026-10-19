// Gộp ranh dự án kêu gọi đầu tư. Sau một lần tải server thành công, danh sách nhóm trên server là chuẩn.
// Chỉ giữ nhóm local đánh dấu pending (máy này vừa gộp / tách nhưng chưa ghi được lên server).
// server không phải mảng: bản đóng gói hoặc mất mạng, giữ nguyên bản local.

function normalizeGroup(g, pending) {
  if (!g || !Array.isArray(g.keys)) return null;
  const keys = [];
  const seen = new Set();
  g.keys.forEach(k => {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  });
  if (keys.length < 2) return null;
  const out = { id: String(g.id || keys[0]), keys };
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
  const seen = new Set(serverGroups.map(g => g.keys.slice().sort().join('\0')));
  const extra = [];
  localGroups.forEach(g => {
    if (!g.pending || !g.keys.every(k => !used.has(k))) return;
    const sig = g.keys.slice().sort().join('\0');
    if (seen.has(sig)) return;
    seen.add(sig);
    g.keys.forEach(k => used.add(k));
    extra.push(g);
  });
  return serverGroups.concat(extra);
}
