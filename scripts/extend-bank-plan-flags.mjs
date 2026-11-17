#!/usr/bin/env node
// Bổ sung cờ mở đường (8) và cây xanh công viên (16) vào public/data/gba/bank-forest.json.
// Nguồn vùng: QHC 1/10.000 sdd.json (mã 32/41 và 5/15/16/33) + mặt đường QH mat-duong-bo.geojson.
// Dấu chân: buildings.pmtiles (tải một lần vào %TEMP%/gba nếu chưa có).
// Chạy: node scripts/extend-bank-plan-flags.mjs
// Tác động chi phí: một lần tải ~43 MB Class B GCS (hoặc đọc file local) + CPU máy local; không thêm request runtime.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as turf from '@turf/turf';
import { open as openFile } from 'node:fs/promises';
import {
  REASON_ROAD, REASON_GREEN, REASON_FOREST, REASON_CORRIDOR,
  isRoadLandCode, isGreenLandCode, parseBankRow, packBankRow
} from './bank-plan-kinds.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'data', 'gba', 'bank-forest.json');
const SDD = path.join(ROOT, 'public', 'data', 'qhc2045', 'sdd.json');
const MAT_DUONG = path.join(
  ROOT,
  'data',
  'chuyen-nganh',
  'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72',
  'giao-thong',
  'quy-hoach',
  'mat-duong-bo.geojson'
);
const WARDS = path.join(ROOT, 'public', 'data', 'ward-boundary.json');
const PMTILES_URL = process.env.GBA_PMTILES
  || 'https://storage.googleapis.com/hue-infra-data-us/gba/buildings.pmtiles';
const PMTILES_LOCAL = process.env.GBA_PMTILES_FILE
  || path.join(process.env.GBA_TMP || path.join(os.tmpdir(), 'gba'), 'buildings.pmtiles');
const Z = 16;
const LAYER = 'gba';
const CELL = 0.01;

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function lngLatOf(z, x, y, px, py, extent) {
  const n = 2 ** z;
  const gx = x + px / extent;
  const gy = y + py / extent;
  const lng = (gx / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * (180 / Math.PI);
  return [lng, lat];
}

function tilesCovering(bbox) {
  const [west, south, east, north] = bbox;
  const n = 2 ** Z;
  const latY = (lat) => {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  };
  const x0 = Math.max(0, Math.floor(((west + 180) / 360) * n));
  const x1 = Math.min(n - 1, Math.floor(((east + 180) / 360) * n));
  const y0 = Math.max(0, latY(north));
  const y1 = Math.min(n - 1, latY(south));
  const out = [];
  if (x1 < x0 || y1 < y0) return out;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

function cellKey(lng, lat) {
  return `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
}

function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const mlat = 110540;
  const mlng = 111320 * Math.cos(ring[0][1] * Math.PI / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] * mlng) * (ring[i][1] * mlat) - (ring[i][0] * mlng) * (ring[j][1] * mlat);
  }
  return Math.abs(sum) / 2;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0]) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPoly(lng, lat, coords) {
  if (!coords?.[0] || !pointInRing(lng, lat, coords[0])) return false;
  for (let h = 1; h < coords.length; h++) {
    if (pointInRing(lng, lat, coords[h])) return false;
  }
  return true;
}

function pointInFeature(lng, lat, feature) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') return pointInPoly(lng, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((c) => pointInPoly(lng, lat, c));
  return false;
}

function indexFeatures(features) {
  const grid = new Map();
  for (const f of features) {
    const bbox = turf.bbox(f);
    const x0 = Math.floor(bbox[0] / CELL);
    const x1 = Math.floor(bbox[2] / CELL);
    const y0 = Math.floor(bbox[1] / CELL);
    const y1 = Math.floor(bbox[3] / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(f);
      }
    }
  }
  return grid;
}

function candidates(grid, lng, lat) {
  return grid.get(cellKey(lng, lat)) || [];
}

function loadZones() {
  const sdd = JSON.parse(fs.readFileSync(SDD, 'utf8'));
  const road = [];
  const green = [];
  for (const f of sdd.features || []) {
    const code = f.properties?.c;
    if (isRoadLandCode(code)) road.push(f);
    if (isGreenLandCode(code)) green.push(f);
  }
  if (fs.existsSync(MAT_DUONG)) {
    const mat = JSON.parse(fs.readFileSync(MAT_DUONG, 'utf8'));
    for (const f of mat.features || []) {
      if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') road.push(f);
    }
  }
  log(`vùng mở đường ${road.length}, cây xanh ${green.length}`);
  return { road, green };
}

function loadWardIndex() {
  const raw = JSON.parse(fs.readFileSync(WARDS, 'utf8'));
  const feats = (raw.features || []).map((f) => {
    const name = f.properties?.tenXa || f.properties?.name || '';
    return { ...f, properties: { name } };
  }).filter((f) => f.properties.name);
  return indexFeatures(feats);
}

function wardAt(wardGrid, lng, lat) {
  for (const f of candidates(wardGrid, lng, lat)) {
    if (pointInFeature(lng, lat, f)) return f.properties.name;
  }
  return 'Chưa rõ phường, xã';
}

/** Nguồn PMTiles cho Node (FileSource của thư viện chỉ nhận File trình duyệt). */
class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.fh = null;
  }
  getKey() {
    return this.filePath;
  }
  async ensure() {
    if (!this.fh) this.fh = await openFile(this.filePath, 'r');
    return this.fh;
  }
  async close() {
    if (this.fh) {
      await this.fh.close();
      this.fh = null;
    }
  }
  async getBytes(offset, length) {
    const fh = await this.ensure();
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    const slice = buf.subarray(0, bytesRead);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
  }
}

async function ensurePmtiles() {
  if (fs.existsSync(PMTILES_LOCAL) && fs.statSync(PMTILES_LOCAL).size > 1e6) {
    log(`dùng pmtiles local ${PMTILES_LOCAL}`);
    return PMTILES_LOCAL;
  }
  fs.mkdirSync(path.dirname(PMTILES_LOCAL), { recursive: true });
  log(`tải buildings.pmtiles → ${PMTILES_LOCAL}`);
  const res = await fetch(PMTILES_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải pmtiles`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(PMTILES_LOCAL, buf);
  log(`đã tải ${(buf.length / 1e6).toFixed(1)} MB`);
  return PMTILES_LOCAL;
}

function hitKey(lng, lat) {
  return `${lng.toFixed(6)}:${lat.toFixed(6)}`;
}

async function scanBuildings(zones) {
  const file = await ensurePmtiles();
  const source = new NodeFileSource(file);
  const archive = new PMTiles(source);
  try {
    const header = await archive.getHeader();
    log(`pmtiles z${header.minZoom}–${header.maxZoom}, bounds ${header.minLon},${header.minLat}…${header.maxLon},${header.maxLat}`);
    const roadGrid = indexFeatures(zones.road);
    const greenGrid = indexFeatures(zones.green);
    const tileSet = new Map();
    let skippedHuge = 0;
    for (const f of [...zones.road, ...zones.green]) {
      const bbox = turf.bbox(f);
      const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
      // Bỏ đa giác lỗi (bbox quá lớn) kẻo quét cả thành phố nhiều lần.
      if (!(span > 0) || span > 0.15) {
        skippedHuge += 1;
        continue;
      }
      for (const [x, y] of tilesCovering(bbox)) {
        tileSet.set(`${x}/${y}`, [x, y]);
      }
    }
    if (skippedHuge) log(`bỏ ${skippedHuge} đa giác bbox bất thường`);
    log(`ô z16 cần quét: ${tileSet.size}`);
    const hits = new Map();
    let tileN = 0;
    let featN = 0;
    for (const [x, y] of tileSet.values()) {
      tileN += 1;
      if (tileN % 200 === 0) log(`… ô ${tileN}/${tileSet.size}, dấu chân ${featN}, hit ${hits.size}`);
      let data;
      try {
        const got = await archive.getZxy(Z, x, y);
        data = got?.data;
      } catch {
        continue;
      }
      if (!data) continue;
      const layer = new VectorTile(new Pbf(new Uint8Array(data))).layers[LAYER];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        featN += 1;
        const feat = layer.feature(i);
        const ringsPx = feat.loadGeometry().map((r) => r.map((pt) => [pt.x, pt.y]));
        const ringPx = ringsPx[0] || [];
        if (ringPx.length < 3) continue;
        const extent = layer.extent || 4096;
        const ring = ringPx.map(([px, py]) => lngLatOf(Z, x, y, px, py, extent));
        let sx = 0;
        let sy = 0;
        for (const [lng, lat] of ring) { sx += lng; sy += lat; }
        const lng = sx / ring.length;
        const lat = sy / ring.length;
        let road = false;
        let green = false;
        for (const zf of candidates(roadGrid, lng, lat)) {
          if (pointInFeature(lng, lat, zf)) { road = true; break; }
        }
        for (const zf of candidates(greenGrid, lng, lat)) {
          if (pointInFeature(lng, lat, zf)) { green = true; break; }
        }
        if (!road && !green) continue;
        const area = ringAreaM2(ring);
        const key = hitKey(lng, lat);
        const cur = hits.get(key) || { lng, lat, ar: 0, ag: 0, reason: 0, area };
        if (road) {
          cur.reason |= REASON_ROAD;
          cur.ar = Math.max(cur.ar, Math.round(area));
        }
        if (green) {
          cur.reason |= REASON_GREEN;
          cur.ag = Math.max(cur.ag, Math.round(area));
        }
        hits.set(key, cur);
      }
    }
    log(`công trình chạm mở đường / cây xanh: ${hits.size} (đã xem ${featN} dấu chân)`);
    return hits;
  } finally {
    await source.close();
  }
}

function mergePack(old, planHits, wardGrid, zones) {
  const version = Number(old.v) || 1;
  const wardNames = (old.wards || []).map((w) => w.name);
  const byKey = new Map();

  for (const row of old.pts || []) {
    const p = parseBankRow(row, version);
    const name = wardNames[p.ward] || 'Chưa rõ phường, xã';
    const key = hitKey(p.lng, p.lat);
    byKey.set(key, {
      lng: p.lng,
      lat: p.lat,
      ac: p.ac,
      af: p.af,
      ar: p.ar || 0,
      ag: p.ag || 0,
      reason: p.reason,
      ward: name
    });
  }

  for (const hit of planHits.values()) {
    const key = hitKey(hit.lng, hit.lat);
    const cur = byKey.get(key);
    if (cur) {
      cur.reason |= hit.reason;
      if (hit.reason & REASON_ROAD) cur.ar = Math.max(cur.ar || 0, hit.ar || 0);
      if (hit.reason & REASON_GREEN) cur.ag = Math.max(cur.ag || 0, hit.ag || 0);
    } else {
      byKey.set(key, {
        lng: hit.lng,
        lat: hit.lat,
        ac: 0,
        af: 0,
        ar: hit.ar || 0,
        ag: hit.ag || 0,
        reason: hit.reason,
        ward: wardAt(wardGrid, hit.lng, hit.lat)
      });
    }
  }

  const wards = {};
  let corridor = 0;
  let forest = 0;
  let both = 0;
  let road = 0;
  let green = 0;
  const packedSrc = [];
  for (const pt of byKey.values()) {
    if (!pt.reason) continue;
    const name = pt.ward || 'Chưa rõ phường, xã';
    const slot = wards[name] || (wards[name] = {
      corridor: 0, forest: 0, both: 0, road: 0, green: 0
    });
    const inC = !!(pt.reason & REASON_CORRIDOR);
    const inF = !!(pt.reason & REASON_FOREST);
    const inR = !!(pt.reason & REASON_ROAD);
    const inG = !!(pt.reason & REASON_GREEN);
    if (inC && inF) {
      both += 1;
      slot.both += 1;
      slot.corridor += 1;
      slot.forest += 1;
      corridor += 1;
      forest += 1;
    } else if (inC) {
      corridor += 1;
      slot.corridor += 1;
    } else if (inF) {
      forest += 1;
      slot.forest += 1;
    }
    if (inR) { road += 1; slot.road += 1; }
    if (inG) { green += 1; slot.green += 1; }
    packedSrc.push({
      ...pt,
      ac: inC ? pt.ac : 0,
      af: inF ? pt.af : 0,
      ar: inR ? pt.ar : 0,
      ag: inG ? pt.ag : 0,
      ward: name
    });
  }

  const names = Object.keys(wards).sort((a, b) => a.localeCompare(b, 'vi'));
  const indexOf = Object.fromEntries(names.map((n, i) => [n, i]));
  const packed = packedSrc.map((pt) => packBankRow({
    ...pt,
    ward: indexOf[pt.ward]
  }));
  const ranked = [...names].sort((a, b) => {
    const sa = wards[a].corridor + wards[a].forest + wards[a].road + wards[a].green;
    const sb = wards[b].corridor + wards[b].forest + wards[b].road + wards[b].green;
    return sb - sa;
  });

  const flagged = packed.length;
  return {
    v: 5,
    buildings: old.buildings || 0,
    waterPolygons: old.waterPolygons || 0,
    forestPolygons: old.forestPolygons || 0,
    roadPolygons: zones.road.length,
    greenPolygons: zones.green.length,
    totals: {
      corridor,
      forest,
      both,
      road,
      green,
      flagged,
      exemptRoad: old.totals?.exemptRoad || 0
    },
    note: [
      old.note || '',
      'Bổ sung: công trình nằm trên đất giao thông quy hoạch (mã 32/41 và mặt đường QH 1/10.000) — báo hiệu mở đường;',
      'và trên đất cây xanh / công viên quy hoạch (mã 5, 15, 16, 33).',
      'Nguồn vùng: QHC đô thị 1/10.000. Diện tích ar/ag là ước lượng dấu chân khi tâm nằm trong ô.'
    ].filter(Boolean).join(' '),
    wards: names.map((name) => ({
      name,
      corridor: wards[name].corridor,
      forest: wards[name].forest,
      both: wards[name].both,
      road: wards[name].road,
      green: wards[name].green
    })),
    wardRank: ranked,
    pts: packed
  };
}

async function main() {
  if (!fs.existsSync(OUT)) throw new Error(`Thiếu ${OUT}`);
  if (!fs.existsSync(SDD)) throw new Error(`Thiếu ${SDD}`);
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const zones = loadZones();
  const wardGrid = loadWardIndex();
  const planHits = await scanBuildings(zones);
  const next = mergePack(old, planHits, wardGrid, zones);
  fs.writeFileSync(OUT, JSON.stringify(next));
  log(
    `xong: hành lang ${next.totals.corridor}, rừng ${next.totals.forest}, `
    + `mở đường ${next.totals.road}, cây xanh ${next.totals.green}, `
    + `cờ ${next.totals.flagged}, tệp ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`
  );
  console.log(JSON.stringify(next.totals));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
