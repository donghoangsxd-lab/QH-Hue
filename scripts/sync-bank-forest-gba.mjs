#!/usr/bin/env node
// Đồng bộ public/data/gba/bank-forest.json với buildings.pmtiles đang phục vụ lớp chân công trình.
// Quy tắc: mỗi điểm cờ phải là tâm một dấu chân còn trong pmtiles (và không bị ẩn như mộ/cụm sườn).
// - Mở đường / cây xanh: giao lại với QHC 1/10.000 (sdd + mặt đường).
// - Hành lang / rừng: kế thừa từ bản bank-forest cũ khi tâm nhà khớp trong MATCH_M.
// Chạy: node scripts/sync-bank-forest-gba.mjs
// Tác động chi phí: offline (đọc pmtiles local hoặc tải ~43 MB Class B một lần); runtime vẫn chỉ GET file tĩnh.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { open as openFile } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as turf from '@turf/turf';
import {
  REASON_CORRIDOR, REASON_FOREST, REASON_ROAD, REASON_GREEN,
  isRoadLandCode, isGreenLandCode, parseBankRow, packBankRow
} from './bank-plan-kinds.mjs';
import { prepareGraveMask, isCemeteryGrave } from '../public/js/graveFilter.js';
import { parseHeightIndex, heightAt } from '../public/js/bldgHeight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'data', 'gba', 'bank-forest.json');
const CORRIDOR_LINE = path.join(ROOT, 'public', 'data', 'gba', 'river-corridor.json');
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
const CEMETERY = path.join(ROOT, 'public', 'data', 'gba', 'cemetery-mask.geojson');
const HEIGHTS = path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.bin');
const PMTILES_URL = process.env.GBA_PMTILES
  || 'https://storage.googleapis.com/hue-infra-data-us/gba/buildings.pmtiles';
const PMTILES_LOCAL = process.env.GBA_PMTILES_FILE
  || path.join(process.env.GBA_TMP || path.join(os.tmpdir(), 'gba'), 'buildings.pmtiles');

const Z = 16;
const LAYER = 'gba';
const CELL = 0.01;
const MATCH_M = 15;
const MATCH_DEG = MATCH_M / 111320;

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.fh = null;
  }
  getKey() { return this.filePath; }
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

function cellKey(lng, lat, cell = CELL) {
  return `${Math.floor(lng / cell)}:${Math.floor(lat / cell)}`;
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

function distM(a, b) {
  const dlat = (a.lat - b.lat) * 111320;
  const dlng = (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dlat, dlng);
}

function hitKey(lng, lat) {
  return `${lng.toFixed(6)}:${lat.toFixed(6)}`;
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

function loadOldIndex() {
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const version = Number(old.v) || 1;
  const wards = old.wards || [];
  const grid = new Map();
  for (const row of old.pts || []) {
    const p = parseBankRow(row, version);
    const name = wards[p.ward]?.name || wards[p.ward] || 'Chưa rõ phường, xã';
    const pt = {
      lng: p.lng,
      lat: p.lat,
      ac: p.ac || 0,
      af: p.af || 0,
      ar: p.ar || 0,
      ag: p.ag || 0,
      reason: p.reason || 0,
      ward: typeof name === 'string' ? name : (name?.name || 'Chưa rõ phường, xã')
    };
    if (!pt.reason) continue;
    const key = cellKey(pt.lng, pt.lat, MATCH_DEG * 2);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(pt);
  }
  log(`điểm cũ để kế thừa hành lang/rừng: ${old.pts?.length || 0}`);
  return { old, grid };
}

function nearestOld(grid, lng, lat) {
  const cell = MATCH_DEG * 2;
  const x0 = Math.floor(lng / cell);
  const y0 = Math.floor(lat / cell);
  let best = null;
  let bestD = MATCH_M;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${x0 + dx}:${y0 + dy}`) || [];
      for (const pt of list) {
        const d = distM({ lng, lat }, pt);
        if (d <= bestD) {
          bestD = d;
          best = pt;
        }
      }
    }
  }
  return best;
}

function loadWardIndex() {
  const raw = JSON.parse(fs.readFileSync(WARDS, 'utf8'));
  const feats = (raw.features || []).map((f) => ({
    ...f,
    properties: { name: f.properties?.tenXa || f.properties?.name || '' }
  })).filter((f) => f.properties.name);
  return indexFeatures(feats);
}

function wardAt(wardGrid, lng, lat) {
  for (const f of candidates(wardGrid, lng, lat)) {
    if (pointInFeature(lng, lat, f)) return f.properties.name;
  }
  return 'Chưa rõ phường, xã';
}

function collectTiles(zones, old, corridorFc) {
  const tileSet = new Map();
  const addBbox = (bbox, maxSpan = 0.2) => {
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    if (!(span > 0) || span > maxSpan) return;
    for (const xy of tilesCovering(bbox)) tileSet.set(`${xy[0]}/${xy[1]}`, xy);
  };
  for (const f of [...zones.road, ...zones.green]) addBbox(turf.bbox(f), 0.15);
  for (const row of old.pts || []) {
    const lng = row[0];
    const lat = row[1];
    addBbox([lng - 0.002, lat - 0.002, lng + 0.002, lat + 0.002], 1);
  }
  // Vành quanh nét hành lang 50 m để bắt nhà còn trong pmtiles gần mép.
  const buffered = turf.buffer(corridorFc, 0.06, { units: 'kilometers', steps: 4 });
  if (buffered) addBbox(turf.bbox(buffered), 1);
  return tileSet;
}

async function main() {
  if (!fs.existsSync(OUT)) throw new Error(`Thiếu ${OUT}`);
  if (!fs.existsSync(SDD)) throw new Error(`Thiếu ${SDD}`);
  if (!fs.existsSync(CORRIDOR_LINE)) throw new Error(`Thiếu ${CORRIDOR_LINE}`);

  const zones = loadZones();
  const { old, grid: oldGrid } = loadOldIndex();
  const wardGrid = loadWardIndex();
  const corridorFc = JSON.parse(fs.readFileSync(CORRIDOR_LINE, 'utf8'));
  const graveMask = prepareGraveMask(
    fs.existsSync(CEMETERY) ? JSON.parse(fs.readFileSync(CEMETERY, 'utf8')) : null
  );
  const heightBuf = fs.readFileSync(HEIGHTS);
  const heightsIdx = parseHeightIndex(heightBuf.buffer.slice(heightBuf.byteOffset, heightBuf.byteOffset + heightBuf.byteLength));

  const file = await ensurePmtiles();
  const source = new NodeFileSource(file);
  const archive = new PMTiles(source);
  const roadGrid = indexFeatures(zones.road);
  const greenGrid = indexFeatures(zones.green);

  try {
    const header = await archive.getHeader();
    log(`pmtiles z${header.minZoom}–${header.maxZoom}`);
    const tileSet = collectTiles(zones, old, corridorFc);
    log(`ô z16 cần quét: ${tileSet.size}`);

    const hits = new Map();
    let tileN = 0;
    let featN = 0;
    let hiddenGrave = 0;
    for (const [x, y] of tileSet.values()) {
      tileN += 1;
      if (tileN % 300 === 0) log(`… ô ${tileN}/${tileSet.size}, dấu chân ${featN}, giữ ${hits.size}`);
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
        const area = ringAreaM2(ring);
        const h = heightAt(lng, lat, heightsIdx);
        if (isCemeteryGrave(graveMask, area, h, lng, lat)) {
          hiddenGrave += 1;
          continue;
        }

        let reason = 0;
        let ac = 0;
        let af = 0;
        let ar = 0;
        let ag = 0;

        for (const zf of candidates(roadGrid, lng, lat)) {
          if (pointInFeature(lng, lat, zf)) {
            reason |= REASON_ROAD;
            ar = Math.max(ar, Math.round(area));
            break;
          }
        }
        for (const zf of candidates(greenGrid, lng, lat)) {
          if (pointInFeature(lng, lat, zf)) {
            reason |= REASON_GREEN;
            ag = Math.max(ag, Math.round(area));
            break;
          }
        }

        const prev = nearestOld(oldGrid, lng, lat);
        if (prev) {
          if (prev.reason & REASON_CORRIDOR) {
            reason |= REASON_CORRIDOR;
            ac = Math.max(ac, prev.ac || 0);
          }
          if (prev.reason & REASON_FOREST) {
            reason |= (prev.reason & REASON_FOREST);
            af = Math.max(af, prev.af || 0);
          }
        }

        if (!reason) continue;
        const key = hitKey(lng, lat);
        const cur = hits.get(key) || {
          lng, lat, ac: 0, af: 0, ar: 0, ag: 0, reason: 0,
          ward: prev?.ward || wardAt(wardGrid, lng, lat)
        };
        cur.reason |= reason;
        cur.ac = Math.max(cur.ac, ac);
        cur.af = Math.max(cur.af, af);
        cur.ar = Math.max(cur.ar, ar);
        cur.ag = Math.max(cur.ag, ag);
        hits.set(key, cur);
      }
    }

    log(`dấu chân đã xem ${featN}, ẩn mộ/sườn ${hiddenGrave}, điểm giữ ${hits.size}`);

    const wards = {};
    let corridor = 0;
    let forest = 0;
    let both = 0;
    let road = 0;
    let green = 0;
    const packedSrc = [];
    for (const pt of hits.values()) {
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
    const packed = packedSrc.map((pt) => packBankRow({ ...pt, ward: indexOf[pt.ward] }));
    const ranked = [...names].sort((a, b) => {
      const sa = wards[a].corridor + wards[a].forest + wards[a].road + wards[a].green;
      const sb = wards[b].corridor + wards[b].forest + wards[b].road + wards[b].green;
      return sb - sa;
    });

    const payload = {
      v: 6,
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
        flagged: packed.length,
        exemptRoad: old.totals?.exemptRoad || 0,
        syncedGba: true
      },
      note: [
        'Mỗi điểm gắn tâm một dấu chân còn trong buildings.pmtiles (lớp chân công trình trên webapp),',
        'đã bỏ mộ/cụm sườn cùng luật hiển thị. Mở đường/cây xanh giao lại với QHC 1/10.000;',
        'hành lang/rừng kế thừa từ bản trước khi tâm nhà khớp ≤ 15 m.',
        'Tạo bằng scripts/sync-bank-forest-gba.mjs.'
      ].join(' '),
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

    fs.writeFileSync(OUT, JSON.stringify(payload));
    log(
      `xong: hành lang ${corridor}, rừng ${forest}, mở đường ${road}, cây xanh ${green}, `
      + `cờ ${packed.length}, tệp ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`
    );
    console.log(JSON.stringify(payload.totals));
  } finally {
    await source.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
