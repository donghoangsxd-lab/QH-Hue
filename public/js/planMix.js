// Lát dưới 1% diện tích thửa là lệch ranh giữa địa chính và lô quy hoạch, không hiện trên biểu đồ và chú giải chính.
// Phần còn lại chuẩn hóa lại cho đủ 100%. rawPct giữ tỷ lệ đo gốc cho tooltip.
export const MIX_NOISE_PCT = 1;

export function presentLandMix(slices) {
  const list = [];
  for (const s of slices || []) {
    const area = Number(s && s.area);
    const pct = Number(s && s.pct);
    if (!(area > 0) || !Number.isFinite(pct)) continue;
    list.push({ ...s, area, pct });
  }
  const kept = list.filter(s => s.pct >= MIX_NOISE_PCT);
  const use = kept.length ? kept : list;
  const sum = use.reduce((n, s) => n + s.area, 0);
  return use.map(s => ({
    ...s,
    rawPct: s.pct,
    pct: sum > 0 ? (s.area / sum) * 100 : 0
  }));
}
