// Chỉ đọc index.json và schemes.json (không đọc GeoJSON).
// Đồ án thiếu tuyến ống: trỏ file tuyến của đồ án cùng cấp có nhiều đối tượng nhất.
// Không ghi đè file gốc. QHPK không có lớp cùng cấp thì để hook, không bịa tuyến.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  PIPE_SECTORS, SNAP_TOLERANCE_M, SYNTH_LABEL, QHPK_HOOK_ID,
  catalogLevel, foldName, isCotDenLayer, isPipeLine, gcsObjectPath
} from '../public/js/htktModel.js';
import { GENERAL_PLANS } from '../public/js/generalPlan.js';

const index = JSON.parse(readFileSync(new URL('../public/data/chuyen-nganh/index.json', import.meta.url), 'utf8'));
const schemes = JSON.parse(readFileSync(new URL('../public/data/chuyen-nganh/schemes.json', import.meta.url), 'utf8')).schemes || [];
const layers = index.layers || [];

const bySlug = new Map();
schemes.forEach(row => {
  if (!row || !row.slug) return;
  bySlug.set(row.slug, row);
  if (row.catalogScheme) bySlug.set(row.catalogScheme, row);
});

function canon(slug) {
  const row = bySlug.get(slug);
  if (!row) return slug || '';
  return row.catalogScheme || row.slug;
}

function schemeName(id) {
  const row = bySlug.get(id);
  return (row && row.name) || id;
}

function schemeLevel(row) {
  return catalogLevel(row.level, row.scale);
}

const prepared = layers
  .filter(layer => layer && layer.sector && layer.sector !== 'sdd')
  .map(layer => ({
    ...layer,
    scheme: canon(layer.scheme),
    level: catalogLevel(layer.level, layer.scale)
  }))
  .filter(layer => layer.level && layer.scheme);

function pipeLayers(scheme, level, sector) {
  return prepared.filter(layer => layer.scheme === scheme && layer.level === level && layer.sector === sector && isPipeLine(layer));
}

function donorFor(scheme, level, sector) {
  const scores = new Map();
  prepared.forEach(layer => {
    if (layer.level !== level || layer.sector !== sector || layer.scheme === scheme) return;
    if (!isPipeLine(layer)) return;
    const prev = scores.get(layer.scheme) || { n: 0, known: false };
    const count = Number(layer.featureCount);
    if (Number.isFinite(count)) {
      prev.n += count;
      prev.known = true;
    }
    scores.set(layer.scheme, prev);
  });
  const ranked = [...scores.entries()].sort((a, b) => {
    if (a[1].known !== b[1].known) return a[1].known ? -1 : 1;
    if (b[1].n !== a[1].n) return b[1].n - a[1].n;
    return a[0].localeCompare(b[0]);
  });
  return ranked.length ? ranked[0][0] : '';
}

function planAlias(row) {
  if (!row || row.parent) return '';
  const name = foldName(row.name);
  const hit = GENERAL_PLANS.find(plan => !plan.city && name.includes(foldName(plan.short)));
  return hit ? `qhc-${hit.id}` : '';
}

function pushSynth(scheme, aliases, level, sector) {
  if (!scheme || !level || level === 'QHPK') return;
  if (pipeLayers(scheme, level, sector).length) return;
  const donor = donorFor(scheme, level, sector);
  if (!donor) return;
  const files = [...new Set(pipeLayers(donor, level, sector).map(layer => layer.file).filter(Boolean))];
  if (!files.length) return;
  synth.push({
    scheme,
    aliases: [...new Set(aliases.filter(Boolean))],
    level,
    sector,
    pipe: true,
    donorScheme: donor,
    donorName: schemeName(donor),
    files,
    label: SYNTH_LABEL
  });
}

const synth = [];
schemes.forEach(row => {
  const scheme = canon(row.slug);
  const level = schemeLevel(row);
  const aliases = [row.slug, row.catalogScheme, planAlias(row)];
  PIPE_SECTORS.forEach(sector => pushSynth(scheme, aliases, level, sector));
});

const covered = new Set(synth.flatMap(row => [row.scheme, ...(row.aliases || [])]));
schemes.forEach(row => covered.add(canon(row.slug)));
GENERAL_PLANS.filter(plan => !plan.city).forEach(plan => {
  const scheme = `qhc-${plan.id}`;
  if (covered.has(scheme)) return;
  PIPE_SECTORS.forEach(sector => pushSynth(scheme, [scheme], 'QHC10', sector));
  covered.add(scheme);
});

const parents = [...new Set(schemes.map(row => row.parent).filter(id => String(id || '').startsWith('qhpk-')))].sort();
const gcs = prepared
  .filter(layer => gcsObjectPath(layer.file) && PIPE_SECTORS.includes(layer.sector))
  .map(layer => ({
    scheme: layer.scheme,
    level: layer.level,
    sector: layer.sector,
    name: layer.name,
    geomType: layer.geomType,
    featureCount: Number.isFinite(Number(layer.featureCount)) ? Number(layer.featureCount) : null,
    file: layer.file
  }));

const cotDen = prepared.filter(isCotDenLayer).map(layer => ({
  scheme: layer.scheme,
  name: layer.name,
  geomType: layer.geomType,
  featureCount: Number.isFinite(Number(layer.featureCount)) ? Number(layer.featureCount) : null,
  file: layer.file
}));

const doc = {
  version: 1,
  snapM: SNAP_TOLERANCE_M,
  label: SYNTH_LABEL,
  qhpkHook: {
    id: QHPK_HOOK_ID,
    level: 'QHPK',
    status: 'pending',
    note: 'Chưa có lớp HTKT cấp QHPK. Script bổ sung gắn lớp vào hook này, không tự tổng hợp.',
    parents,
    layers: []
  },
  gcs,
  cotDenHidden: cotDen.length,
  synth
};

const dir = new URL('../public/data/htkt/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('synth.json', dir), `${JSON.stringify(doc, null, 2)}\n`);

const missingSchemes = new Set(synth.map(row => row.scheme));
console.log(JSON.stringify({
  synthRows: synth.length,
  schemes: missingSchemes.size,
  qhpkParents: parents.length,
  gcs: gcs.map(row => ({ name: row.name, sector: row.sector, n: row.featureCount })),
  cotDen: cotDen.length
}));
