// Áp kết quả phân loại lô QH khi máy chủ chưa gắn cờ qhApplied.
// Cùng quy tắc với services/qhHienTrang.js: da_co thành hiện trạng, không sửa Sheet.

function effective(pack, id) {
  const row = pack && pack.auto && pack.auto[id];
  const extra = pack && pack.extra && pack.extra[id];
  const chosen = extra || row;
  const o = pack && pack.overrides && pack.overrides[id];
  if (o && (o.cls === 'da_co' || o.cls === 'chua_co')) {
    const base = chosen ? chosen[1] : '';
    const reason = o.cls === 'da_co'
      ? (base ? `Quản trị xác nhận đã có. ${base}` : 'Quản trị xác nhận đã có.')
      : 'Quản trị xác nhận chưa có.';
    return { cls: o.cls, reason, override: true, auto: chosen ? chosen[0] : '' };
  }
  if (!chosen) return null;
  return { cls: chosen[0], reason: chosen[1] || '', override: false, auto: chosen[0] };
}

export function applyQhClassification(raw, plan, pack) {
  const auto = { ...(pack && pack.auto), ...(pack && pack.extra) };
  const merged = { ...(pack || {}), auto };
  const stay = [];
  const promoted = [];
  (plan || []).forEach(it => {
    if (!it || it.planChange !== 'new') { stay.push(it); return; }
    const eff = effective(merged, it.id);
    if (!eff || eff.cls !== 'da_co') { stay.push(it); return; }
    const size = it.sizeQH != null ? it.sizeQH : it.size;
    promoted.push({
      ...it,
      size: size || 0,
      sizeHT: size,
      planChange: 'keep',
      qhProven: true,
      qhReason: eff.reason,
      qhClass: 'da_co'
    });
  });
  const have = new Set((raw || []).map(it => it.id));
  return { raw: (raw || []).concat(promoted.filter(it => !have.has(it.id))), plan: stay };
}

export function reviewFromPack(pack, points) {
  const byId = new Map((points || []).map(it => [it.id, it]));
  const auto = { ...(pack && pack.auto), ...(pack && pack.extra) };
  const merged = { ...(pack || {}), auto };
  const items = [];
  Object.keys(auto).forEach(id => {
    const eff = effective(merged, id);
    if (!eff || (eff.cls !== 'can_kiem_tra' && !eff.override)) return;
    const it = byId.get(id);
    if (!it) return;
    items.push({
      id,
      name: it.name || '',
      type: it.type,
      ward: it.ward || '',
      lat: it.lat,
      lng: it.lng,
      cls: eff.cls,
      auto: eff.auto,
      reason: eff.reason,
      override: !!eff.override
    });
  });
  items.sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name), 'vi'));
  return items;
}
