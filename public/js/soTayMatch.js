// Ghép đồ án sổ tay (qh-so-tay.json) với catalog webapp theo tên + quy mô diện tích.

const STOP = new Set([
  'va', 'tai', 'thuoc', 'khu', 'vuc', 'phuong', 'xa', 'thi', 'tran', 'huyen', 'quan',
  'thanh', 'pho', 'tp', 'hue', 'do', 'thi', 'cac', 'tren', 'dia', 'ban', 'nay',
  'mo', 'rong', 'den', 'nam', 'dai', 'han', 'tam', 'nhin', 'ty', 'le'
]);

function deaccent(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

export function foldPlanName(value) {
  let s = deaccent(value);
  s = s
    .replace(/\bqhctxd\b/g, 'qhct')
    .replace(/\bqhc xd\b/g, 'qhc')
    .replace(/\bqhpkxd\b/g, 'qhpk')
    .replace(/\bqh\s*tmb\b/g, 'qhtmb')
    .replace(/\b(1\s*\/\s*2\.?000|1\s*\/\s*500|1\s*\/\s*10\.?000|1\s*\/\s*25\.?000)\b/g, ' ')
    .replace(/\b(ty le|tyle)\b/g, ' ')
    .replace(/\b(quy hoach phan khu|quy hoach chi tiet|quy hoach chung|dieu chinh)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const toks = s.split(' ').filter((t) => t && !STOP.has(t) && t.length > 1);
  return toks.join(' ');
}

export function tokenSet(folded) {
  return new Set(String(folded || '').split(' ').filter(Boolean));
}

export function nameScore(a, b) {
  const fa = foldPlanName(a);
  const fb = foldPlanName(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  if (fa.includes(fb) || fb.includes(fa)) {
    const shorter = fa.length < fb.length ? fa : fb;
    const longer = fa.length < fb.length ? fb : fa;
    return 0.72 + 0.28 * (shorter.length / longer.length);
  }
  const ta = tokenSet(fa);
  const tb = tokenSet(fb);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

/** So sánh diện tích ha; null nếu thiếu một phía. */
export function areaScore(haA, haB) {
  const a = Number(haA);
  const b = Number(haB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const rel = Math.abs(a - b) / Math.max(a, b);
  if (rel <= 0.08) return 1;
  if (rel <= 0.18) return 0.75;
  if (rel <= 0.35) return 0.4;
  return 0;
}

export function levelCompatible(sheetCap, webLevel) {
  const a = String(sheetCap || '').toUpperCase();
  const b = String(webLevel || '').toUpperCase();
  if (!a || !b) return true;
  if (a === b) return true;
  // Sheet hay ghi QHCTXD 1/2000 là QHPK
  if ((a === 'QHPK' && b === 'QHCT') || (a === 'QHCT' && b === 'QHPK')) return true;
  return false;
}

/**
 * Ghép từng dòng sổ tay với catalog webapp.
 * @returns {{ matches: Map<string, object>, orphans: object[] }}
 */
export function matchSoTayToCatalog(sheetItems, catalogProjects, opts = {}) {
  const minName = opts.minName ?? 0.55;
  const projects = (catalogProjects || []).filter((p) => p && p.tenQH && !p.sheetOnly);
  const used = new Set();
  const matches = new Map();

  const scored = [];
  for (const item of sheetItems || []) {
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const ns = nameScore(item.ten, p.tenQH);
      if (ns < minName) continue;
      if (!levelCompatible(item.cap, opts.levelOf?.(p) || p.level)) continue;
      const webHa = opts.areaHaOf?.(p);
      const as = areaScore(item.dienTichHa, webHa);
      let score = ns;
      if (as != null) score = ns * 0.7 + as * 0.3;
      else score = ns * 0.92;
      scored.push({ ma: item.ma, idx: i, score, ns, as, item, project: p });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  for (const hit of scored) {
    if (matches.has(hit.ma) || used.has(hit.idx)) continue;
    if (hit.score < minName) continue;
    matches.set(hit.ma, {
      project: hit.project,
      score: hit.score,
      nameScore: hit.ns,
      areaScore: hit.as
    });
    used.add(hit.idx);
  }

  const orphans = projects
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !used.has(i))
    .map(({ p }) => p);

  return { matches, orphans };
}

export const STATUS = {
  du: { id: 'du', label: 'Đủ trên bản đồ', short: 'Đủ', color: '#22c55e' },
  thieu: { id: 'thieu', label: 'Thiếu một phần', short: 'Thiếu', color: '#f59e0b' },
  chi_so_tay: { id: 'chi_so_tay', label: 'Chưa có trên bản đồ', short: 'Chưa lên bản đồ', color: '#94a3b8' },
  chi_ban_do: { id: 'chi_ban_do', label: 'Chưa có trong sổ tay', short: 'Ngoài sổ tay', color: '#38bdf8' }
};

export function classifyPlanStatus(sheetItem, match, hasBoundary) {
  if (!sheetItem && match) {
    return {
      status: 'chi_ban_do',
      missing: hasBoundary ? [] : ['ranh']
    };
  }
  if (sheetItem && !match) {
    const missing = [];
    if (!sheetItem.dienTichHa) missing.push('dien_tich');
    if (!sheetItem.quyetDinh) missing.push('quyet_dinh');
    if (!sheetItem.linkGis) missing.push('gis');
    return { status: 'chi_so_tay', missing };
  }
  const missing = [];
  if (!hasBoundary) missing.push('ranh');
  if (sheetItem && !sheetItem.quyetDinh) missing.push('quyet_dinh');
  if (sheetItem && !sheetItem.linkGis) missing.push('gis');
  if (sheetItem && sheetItem.dienTichHa == null) missing.push('dien_tich');
  if (missing.includes('ranh') || missing.length >= 2) {
    return { status: 'thieu', missing };
  }
  if (missing.length) return { status: 'thieu', missing };
  return { status: 'du', missing: [] };
}

export function missingLabel(keys) {
  const map = {
    ranh: 'thiếu ranh',
    quyet_dinh: 'thiếu quyết định',
    gis: 'thiếu GIS',
    dien_tich: 'thiếu diện tích'
  };
  return (keys || []).map((k) => map[k] || k).join(', ');
}
