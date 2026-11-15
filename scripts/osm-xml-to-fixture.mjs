/**
 * Chuyển OSM API XML (map?bbox=) → fixture Overpass JSON cho buildModel.
 * Usage: node scripts/osm-xml-to-fixture.mjs <xmlPath> [outJson]
 */
import fs from 'fs';

const xmlPath = process.argv[2];
const outPath = process.argv[3] || 'scripts/fixtures/osm-segment-leloi.json';
if (!xmlPath) {
  console.error('Usage: node scripts/osm-xml-to-fixture.mjs <xml> [out]');
  process.exit(2);
}
const xml = fs.readFileSync(xmlPath, 'utf8');
const nodes = new Map();
for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) {
  nodes.set(m[1], { lat: Number(m[2]), lon: Number(m[3]) });
}
const ways = [];
for (const wm of xml.matchAll(/<way id="(\d+)"[\s\S]*?<\/way>/g)) {
  const block = wm[0];
  const id = Number(wm[1]);
  const tags = {};
  for (const t of block.matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
  if (!tags.highway && !tags.leisure && !tags.landuse && !tags.natural) continue;
  const nds = [...block.matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]);
  const geometry = nds.map((ref) => nodes.get(ref)).filter(Boolean);
  if (geometry.length < 2) continue;
  ways.push({ type: 'way', id, tags, geometry });
}
const byHw = {};
for (const w of ways) {
  const k = w.tags.highway || w.tags.leisure || w.tags.landuse || 'other';
  byHw[k] = (byHw[k] || 0) + 1;
}
const osm = {
  osm3s: { timestamp_osm_base: new Date().toISOString() },
  elements: ways
};
fs.writeFileSync(outPath, JSON.stringify(osm));
console.log(JSON.stringify({
  nodes: nodes.size,
  ways: ways.length,
  byHw,
  named: ways.filter((w) => w.tags.name).slice(0, 15).map((w) => ({
    id: w.id,
    hw: w.tags.highway || w.tags.leisure,
    name: w.tags.name,
    n: w.geometry.length
  })),
  outPath
}, null, 2));
