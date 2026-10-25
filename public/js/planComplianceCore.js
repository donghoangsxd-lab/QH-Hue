// Đối chiếu lô với cấp trên trực tiếp theo public/data/tuan-thu-lo/principles.json.
// Không kết luận phù hợp khi thiếu mã, thiếu hình, hoặc nguyên tắc không áp dụng.
// Trần diện tích (CXCC-01): mẫu số là phần giao phạm vi đang xem với vùng neo, không phải diện tích riêng của lô dịch vụ.

const MIN_M2 = 0.5;

export const CONCLUSION = {
  'phu-hop': 'Phù hợp',
  'chua-phu-hop': 'Chưa phù hợp',
  'chua-du-du-lieu': 'Chưa đủ dữ liệu'
};

export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function compilePrinciples(doc) {
  if (doc && doc._compiled) return doc;
  const categories = {};
  Object.entries((doc && doc.categories) || {}).forEach(([id, cat]) => {
    categories[id] = {
      id,
      label: cat.label || id,
      also: Array.isArray(cat.also) ? cat.also.filter(x => x && x !== id) : [],
      landCodes: new Set((cat.landCodes || []).map(n => Number(n)).filter(n => Number.isInteger(n))),
      patternKeys: new Set((cat.patternKeys || []).map(k => String(k))),
      phrases: (cat.phrases || [])
        .map(p => foldText(p))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
    };
  });
  const labels = {};
  ((doc && doc.hierarchy) || []).forEach(row => {
    if (row && row.id) labels[row.id] = row.label || row.id;
  });
  return { ...doc, categories, levelLabels: labels, _compiled: true };
}

function blankClass() {
  return { categories: [], primary: null, unknown: true, ambiguous: false, identified: false, label: '' };
}

/** code: mã LAND_CODES; patternKey: khóa TT16; texts: nhãn đã có trên lô. */
export function classify(principles, input = {}) {
  const doc = compilePrinciples(principles);
  const cats = Object.values(doc.categories);
  const code = input.code == null || input.code === '' ? null : Number(input.code);
  const hasCode = Number.isInteger(code);
  const key = input.patternKey ? String(input.patternKey) : '';
  const byCode = [];
  const byKey = [];
  cats.forEach(cat => {
    if (hasCode && cat.landCodes.has(code)) byCode.push(cat.id);
    if (key && cat.patternKeys.has(key)) byKey.push(cat.id);
  });
  const ranked = byCode.length ? byCode : byKey;
  if (ranked.length) return finishClass(doc, [...new Set(ranked)]);
  const blob = foldText((input.texts || []).join(' '));
  if (!blob) {
    if (hasCode || key) return { ...blankClass(), unknown: false, identified: true };
    return blankClass();
  }
  let bestLen = 0;
  const phraseHits = [];
  cats.forEach(cat => {
    const phrase = cat.phrases.find(p => blob.includes(p));
    if (!phrase) return;
    if (phrase.length > bestLen) bestLen = phrase.length;
    phraseHits.push({ id: cat.id, len: phrase.length });
  });
  if (!phraseHits.length) {
    if (hasCode || key) return { ...blankClass(), unknown: false, identified: true };
    return blankClass();
  }
  const best = [...new Set(phraseHits.filter(h => h.len === bestLen).map(h => h.id))];
  if (best.length !== 1) return { ...blankClass(), ambiguous: true };
  return finishClass(doc, best);
}

function finishClass(doc, ids) {
  if (ids.length !== 1) return { ...blankClass(), ambiguous: true };
  const primary = ids[0];
  const cat = doc.categories[primary];
  const categories = [primary, ...cat.also.filter(id => doc.categories[id] && id !== primary)];
  return {
    categories,
    primary,
    unknown: false,
    ambiguous: false,
    identified: true,
    label: cat.label
  };
}

export function bboxOf(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const scan = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (c[0] < b[0]) b[0] = c[0];
      if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0];
      if (c[1] > b[3]) b[3] = c[1];
      return;
    }
    for (let i = 0; i < c.length; i++) scan(c[i]);
  };
  const g = geom && geom.type === 'Feature' ? geom.geometry : geom;
  if (!g) return null;
  if (g.type === 'GeometryCollection') (g.geometries || []).forEach(part => scan(part && part.coordinates));
  else scan(g.coordinates);
  return b[0] === Infinity ? null : b;
}

export function bboxHits(a, box) {
  return !!a && !!box && a[0] <= box[2] && a[2] >= box[0] && a[1] <= box[3] && a[3] >= box[1];
}

export function turfOps(turf) {
  const asFeature = (g) => {
    if (!g) return null;
    if (g.type === 'Feature') return g.geometry ? g : null;
    if (g.type === 'FeatureCollection') return null;
    return { type: 'Feature', properties: {}, geometry: g };
  };
  const asGeom = (f) => {
    if (!f) return null;
    if (f.type === 'Feature') return f.geometry || null;
    if (f.type === 'FeatureCollection') return null;
    return f.type ? f : null;
  };
  const pair = (method, a, b) => {
    const fa = asFeature(a);
    const fb = asFeature(b);
    if (!fa || !fb || typeof turf[method] !== 'function') return null;
    try {
      return asGeom(turf[method](fa, fb));
    } catch {
      try {
        if (typeof turf.featureCollection !== 'function') return null;
        return asGeom(turf[method](turf.featureCollection([fa, fb])));
      } catch {
        return null;
      }
    }
  };
  return {
    area(g) {
      const f = asFeature(g);
      if (!f) return 0;
      try { return Number(turf.area(f)) || 0; } catch { return 0; }
    },
    intersect(a, b) { return pair('intersect', a, b); },
    union(a, b) { return pair('union', a, b); }
  };
}

function overlapArea(geom, other, ops) {
  if (!geom || !other) return 0;
  const piece = ops.intersect(geom, other);
  const area = piece ? ops.area(piece) : 0;
  return area >= MIN_M2 ? area : 0;
}

export function pickContaining(geom, candidates, preferSlugs, ops) {
  const prefer = new Set((preferSlugs || []).filter(Boolean));
  let pool = candidates || [];
  let fallback = false;
  if (prefer.size) {
    const hit = pool.filter(c => (c.schemeSlugs || []).some(s => prefer.has(s)) && overlapArea(geom, c.geometry, ops) > 0);
    if (hit.length) pool = hit;
    else fallback = true;
  }
  let chosen = null;
  let best = 0;
  let bestAt = -1;
  pool.forEach((cand, index) => {
    const area = overlapArea(geom, cand.geometry, ops);
    if (area > best + 1e-6 || (area > 0 && Math.abs(area - best) <= 1e-6 && index >= bestAt)) {
      chosen = cand;
      best = area;
      bestAt = index;
    }
  });
  return { chosen: best > 0 ? chosen : null, fallback: fallback && !!chosen };
}

function levelLabel(doc, id) {
  return (doc.levelLabels && doc.levelLabels[id]) || id || '';
}

function parentLine(doc, row) {
  if (!row) return 'Chưa xác định';
  const name = row.schemeName ? ` (${row.schemeName})` : '';
  const fn = row.display || row.label || 'chưa rõ chức năng';
  return `${levelLabel(doc, row.level)} — ${fn}${name}`;
}

function allowText(doc, ids) {
  return (ids || []).map(id => (doc.categories[id] && doc.categories[id].label) || id).join(', ');
}

const PCT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const pctOf = (ratio) => `${PCT.format((Number(ratio) || 0) * 100)}%`;

function zoneOf(queryGeom, anchors, category, ops) {
  if (!queryGeom) return null;
  let acc = null;
  (anchors || []).forEach(row => {
    if (!row || !row.categories || !row.categories.includes(category)) return;
    const piece = ops.intersect(queryGeom, row.geometry);
    if (!piece || ops.area(piece) < MIN_M2) return;
    acc = acc ? (ops.union(acc, piece) || acc) : piece;
  });
  return acc;
}

function shareOf(zone, parts, category, ops) {
  const zoneArea = zone ? ops.area(zone) : 0;
  if (!(zoneArea >= MIN_M2)) return { kind: 'gap', ratio: null, zoneArea: 0 };
  let service = 0;
  let unknown = 0;
  parts.forEach(part => {
    const geom = part.geom;
    if (!geom) return;
    const area = overlapArea(geom, zone, ops);
    if (!(area > 0)) return;
    if (part.unknown || part.ambiguous || !part.identified) unknown += area;
    else if ((part.categories || []).includes(category)) service += area;
  });
  return { service, unknown, zoneArea };
}

function shareKind(stat, maxRatio) {
  if (!(stat.zoneArea >= MIN_M2)) return { kind: 'gap', ratio: null };
  const minR = stat.service / stat.zoneArea;
  const maxR = (stat.service + stat.unknown) / stat.zoneArea;
  if (minR > maxRatio + 1e-9) return { kind: 'fail', ratio: minR };
  if (maxR <= maxRatio + 1e-9) return { kind: 'pass', ratio: minR };
  return { kind: 'gap', ratio: minR };
}

function anchorState(anchor, category) {
  if (!anchor) return 'missing';
  if (anchor.ambiguous || anchor.unknown || !anchor.identified) return 'missing';
  if ((anchor.categories || []).includes(category)) return 'match';
  return 'other';
}

function childVerdict(part, step) {
  if (!part || part.ambiguous || part.unknown || !part.identified) return 'gap';
  const allow = step.allow || [];
  if ((part.categories || []).some(id => allow.includes(id))) return 'pass';
  if (step.areaShare && (part.categories || []).includes(step.areaShare.category)) return 'share';
  return 'fail';
}

/**
 * parts: lô cấp đang xem. parents: lô cấp trên trực tiếp. anchors: ô vùng neo (QHC 1/10.000).
 * queryGeom: thửa, vùng đo hoặc ô điểm. ops: turfOps.
 */
export function assessCompliance(input) {
  const doc = compilePrinciples(input.principles);
  const ops = input.ops;
  const childLevel = input.childLevel;
  const rules = (doc.rules || [])
    .map(rule => ({ rule, step: (rule.steps || []).find(s => s.childLevel === childLevel) }))
    .filter(row => row.step && row.rule && row.rule.anchor);
  const parts = input.parts || [];
  if (!rules.length) {
    return parts.map(() => ({
      status: 'chua-du-du-lieu',
      parentText: 'Chưa xác định',
      compareText: 'Chưa có nguyên tắc cho cấp này.',
      failed: []
    }));
  }
  const prepared = rules.map(({ rule, step }) => {
    const category = rule.anchor.category;
    const zone = step.areaShare ? zoneOf(input.queryGeom, input.anchors || [], category, ops) : null;
    const stat = step.areaShare ? shareOf(zone, parts, step.areaShare.category, ops) : null;
    const share = step.areaShare && Number.isFinite(Number(step.areaShare.maxRatio))
      ? shareKind(stat, Number(step.areaShare.maxRatio))
      : null;
    return { rule, step, share };
  });
  return parts.map(part => {
    const geom = part.geom;
    const votes = prepared.map(({ rule, step, share }) => {
      if (!geom) {
        return { kind: 'gap', rule, step, parent: null, text: `${rule.id}: chưa có hình lô để đối chiếu.` };
      }
      const parentPick = pickContaining(geom, input.parents || [], part.parentSlugs, ops);
      const parent = parentPick.chosen;
      const sameAnchor = parent && parent.level === rule.anchor.level;
      const anchorPick = sameAnchor
        ? parentPick
        : pickContaining(geom, input.anchors || [], part.anchorSlugs, ops);
      const anchor = anchorPick.chosen;
      const gate = anchorState(anchor, rule.anchor.category);
      const note = parentPick.fallback || anchorPick.fallback
        ? 'Đồ án cha đã khai báo không có lô giao vùng này; đối chiếu theo hình học. '
        : '';
      if (!parent) {
        return {
          kind: 'gap', rule, step, parent: null,
          text: `${note}Chưa thấy lô ${levelLabel(doc, step.directParent)} chứa lô này.`
        };
      }
      if (gate === 'missing') {
        return {
          kind: 'gap', rule, step, parent,
          text: `${note}${rule.id}: chưa rõ chức năng ${levelLabel(doc, rule.anchor.level)} tại lô. Không kết luận phù hợp.`
        };
      }
      if (gate === 'other') {
        const shown = (anchor && (anchor.display || anchor.label)) || 'cấp trên';
        const anchorName = (doc.categories[rule.anchor.category] && doc.categories[rule.anchor.category].label) || rule.anchor.category;
        return {
          kind: 'skip', rule, step, parent,
          text: `${note}${rule.id}: ${levelLabel(doc, rule.anchor.level)} là «${shown}», không phải ${anchorName}. Chưa có nguyên tắc cho trường hợp này.`
        };
      }
      const verdict = childVerdict(part, step);
      const allowed = allowText(doc, step.allow);
      const name = part.display || 'Lô';
      const cap = step.areaShare ? ` Dịch vụ trên vùng này: ${shareLine(share, step)}.` : '';
      if (verdict === 'gap') {
        return {
          kind: 'gap', rule, step, parent,
          text: `${note}${rule.id}: chưa xác định được chức năng «${name}». Không kết luận phù hợp.${cap}`
        };
      }
      if (verdict === 'fail') {
        return {
          kind: 'fail', rule, step, parent, failed: ['chức năng'],
          text: `${note}${rule.id}: «${name}» không thuộc nhóm được phép (${allowed}). Không đạt: chức năng.${cap}`
        };
      }
      if (verdict === 'share') {
        if (!share || share.kind === 'gap') {
          return {
            kind: 'gap', rule, step, parent,
            text: `${note}${rule.id}: chưa đủ dữ liệu để chốt tỷ lệ dịch vụ (trần ${pctOf(step.areaShare.maxRatio)}). Không kết luận phù hợp.`
          };
        }
        if (share.kind === 'fail') {
          return {
            kind: 'fail', rule, step, parent, failed: ['dịch vụ'],
            text: `${note}${rule.id}: dịch vụ chiếm ${pctOf(share.ratio)} vùng cây xanh công cộng trên phạm vi đang xem, vượt trần ${pctOf(step.areaShare.maxRatio)}. Không đạt: dịch vụ.`
          };
        }
        return {
          kind: 'pass', rule, step, parent,
          text: `${note}${rule.id}: dịch vụ chiếm ${pctOf(share.ratio)} vùng cây xanh công cộng trên phạm vi đang xem (trần ${pctOf(step.areaShare.maxRatio)}).`
        };
      }
      return {
        kind: 'pass', rule, step, parent,
        text: `${note}${rule.id}: «${name}» thuộc nhóm được phép (${allowed}).${cap}`
      };
    });
    return combineVotes(doc, votes);
  });
}

function shareLine(share, step) {
  const cap = pctOf(step.areaShare.maxRatio);
  if (!share || share.kind === 'gap' || share.ratio == null) return `chưa đủ dữ liệu (trần ${cap})`;
  if (share.kind === 'fail') return `${pctOf(share.ratio)} (vượt trần ${cap})`;
  return `${pctOf(share.ratio)} (trần ${cap})`;
}

function combineVotes(doc, votes) {
  const active = votes.filter(v => v.kind !== 'skip');
  const chosen = active.find(v => v.kind === 'fail')
    || active.find(v => v.kind === 'gap')
    || active.find(v => v.kind === 'pass')
    || votes[0];
  const status = chosen.kind === 'pass' ? 'phu-hop' : chosen.kind === 'fail' ? 'chua-phu-hop' : 'chua-du-du-lieu';
  const failed = [];
  votes.forEach(v => (v.failed || []).forEach(name => { if (!failed.includes(name)) failed.push(name); }));
  const parent = (chosen && chosen.parent)
    || votes.map(v => v.parent).find(Boolean)
    || null;
  return {
    status,
    parentText: parentLine(doc, parent),
    compareText: votes.map(v => v.text).filter(Boolean).join(' '),
    failed
  };
}
