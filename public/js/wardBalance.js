// Cân đối đất dịch vụ công cộng cấp đơn vị ở từ khu vực lân cận (QCVN 01:2026/BXD Bảng 6, Chú thích 4):
// phường thiếu chỉ tiêu được tính thêm phần diện tích dư của công trình cùng loại thuộc phường/xã khác, cách ranh phường ≤ 2 km.
// Mỗi m² chỉ cho 1 nơi dùng, phần cho mượn không vượt phần dư của phường/xã có công trình; ưu tiên công trình gần nhất.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { escapeHtml, fmtNum } from './utils.js';

export const BALANCE_RADIUS_M = 2000;
export const BALANCE_REF = 'QCVN 01:2026/BXD Bảng 6, Chú thích 4';
const CATEGORIES = [
  { key: '3-MN', parts: ['3-MN'] },
  { key: '4-TH', parts: ['4-TH'] },
  { key: '5-THCS', parts: ['5-THCS'] },
  { key: 'DVCC_TOTAL', parts: ['YT_DV', 'VH_DV', 'TM_DV'] }
];
const LINK_COLOR = '#facc15';
const M_PER_DEG_LAT = 111320;

const shapeCache = new WeakMap();

function wardShape(name) {
  const w = (state.wardLabelsList || []).find(x => x.name === name);
  if (!w || !w.geometry) return null;
  if (!shapeCache.has(w)) {
    const feat = turf.feature(w.geometry);
    shapeCache.set(w, { feat, lines: turf.flatten(turf.polygonToLine(feat)).features, bbox: turf.bbox(feat) });
  }
  return shapeCache.get(w);
}

function nearBBox([minX, minY, maxX, maxY], lat, lng) {
  const dLat = BALANCE_RADIUS_M / M_PER_DEG_LAT;
  const dLng = dLat / Math.cos(lat * Math.PI / 180);
  return lng >= minX - dLng && lng <= maxX + dLng && lat >= minY - dLat && lat <= maxY + dLat;
}

function distToShape(pt, shape) {
  if (turf.booleanPointInPolygon(pt, shape.feat)) return 0;
  return Math.min(...shape.lines.map(l => turf.pointToLineDistance(pt, l, { units: 'meters' })));
}

const validPt = (it) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng));
const quotaOk = (q) => q != null && Number.isFinite(Number(q));

let memo = { list: null, sig: '', result: null };

/** Map tên phường → { [nhóm]: { borrowed, lent, links: [{ id, name, lat, lng, ward, dist, area }] } }; null khi chưa đủ dữ liệu */
export function wardBalance() {
  const list = state.wardStatsData || [];
  const wards = state.wardLabelsList || [];
  if (!list.length || !wards.some(w => w.geometry) || typeof turf === 'undefined') return null;
  const sig = `${wards.length}|${list.map(w => w.projectedPopulation).join(',')}`;
  if (memo.list === list && memo.sig === sig) return memo.result;

  const result = new Map();
  const slot = (ward, key) => {
    if (!result.has(ward)) result.set(ward, {});
    const s = result.get(ward);
    return s[key] || (s[key] = { borrowed: 0, lent: 0, links: [] });
  };

  CATEGORIES.forEach(cat => {
    const surplus = new Map();
    const facilities = [];
    const borrowers = [];
    list.forEach(w => {
      const unit = w.unitResults || {};
      const quota = unit[cat.key] ? unit[cat.key].quota : null;
      if (!quotaOk(quota)) return;
      const have = cat.parts.reduce((s, k) => s + Number(unit[k]?.currentArea || 0), 0);
      const bal = have - Number(quota) * (Number(w.projectedPopulation) || 0);
      if (bal > 0) {
        surplus.set(w.Ten_Phuong, bal);
        cat.parts.forEach(k => (unit[k]?.subItems || []).forEach(it => {
          if (Number(it.size) > 0 && validPt(it)) facilities.push({ it, ward: w.Ten_Phuong, left: Number(it.size) });
        }));
      } else if (bal < 0 && (w.profile || 'DT') === 'DT') {
        borrowers.push({ name: w.Ten_Phuong, need: -bal });
      }
    });

    const pairs = [];
    borrowers.forEach(b => {
      const shape = wardShape(b.name);
      if (!shape) return;
      facilities.forEach(f => {
        const lat = Number(f.it.lat), lng = Number(f.it.lng);
        if (!nearBBox(shape.bbox, lat, lng)) return;
        const d = distToShape(turf.point([lng, lat]), shape);
        if (d <= BALANCE_RADIUS_M) pairs.push({ b, f, d });
      });
    });
    pairs.sort((x, y) => x.d - y.d);
    pairs.forEach(({ b, f, d }) => {
      const take = Math.min(b.need, f.left, surplus.get(f.ward));
      if (take < 1) return;
      b.need -= take;
      f.left -= take;
      surplus.set(f.ward, surplus.get(f.ward) - take);
      const s = slot(b.name, cat.key);
      s.borrowed += take;
      s.links.push({ id: f.it.id, name: f.it.name, lat: Number(f.it.lat), lng: Number(f.it.lng), ward: f.ward, dist: Math.round(d), area: Math.round(take) });
      slot(f.ward, cat.key).lent += take;
    });
  });

  memo = { list, sig, result };
  return result;
}

/** Kết quả cân đối của 1 nhóm (khóa unitResults) tại 1 phường; khóa 'ALL' = cộng mọi nhóm */
export function balanceSlot(wardName, key) {
  const r = wardBalance();
  const s = r && r.get(wardName);
  if (!s) return null;
  if (key !== 'ALL') return s[key] || null;
  const all = { borrowed: 0, lent: 0, links: [] };
  Object.values(s).forEach(v => { all.borrowed += v.borrowed; all.lent += v.lent; all.links.push(...v.links); });
  return all;
}

/** Dòng phụ dưới ô Quy mô: mức đạt sau cân đối (phường mượn) hoặc phần đã cho phường lân cận dùng */
export function balanceScaleHtml(slot, have, req) {
  if (!slot) return '';
  const parts = [];
  if (slot.borrowed >= 1 && req > 0) {
    const pct = Math.min(100, Math.round(((have + slot.borrowed) / req) * 100));
    const title = `${BALANCE_REF}: tính thêm ${fmtNum(Math.round(slot.borrowed))} m² dư của ${slot.links.length} công trình cùng loại thuộc phường/xã lân cận, cách ranh phường ≤ 2 km`;
    parts.push(`<span class="bal-note ${pct >= 100 ? 'c-green' : 'c-orange'}" title="${title}">CT4: ${pct}%</span>`);
  }
  if (slot.lent >= 1) {
    parts.push(`<span class="bal-lent" title="${BALANCE_REF}: phần dư đã tính cân đối cho phường lân cận thiếu chỉ tiêu (không dùng lại cho phường khác)">cho mượn ${fmtNum(Math.round(slot.lent))} m²</span>`);
  }
  return parts.length ? `<br>${parts.join(' ')}` : '';
}

let balanceLayer = null;
let balanceWard = null;

export function clearBalanceMap() {
  if (balanceLayer) balanceLayer.remove();
  balanceLayer = null;
  balanceWard = null;
}

/** Bật/tắt lớp cân đối của 1 phường: vòng 2 km quanh ranh, đường nối công trình được tính cân đối tới điểm gần nhất trên ranh */
export function toggleBalanceMap(wardName) {
  if (balanceWard === wardName) {
    clearBalanceMap();
    return false;
  }
  clearBalanceMap();
  const slot = balanceSlot(wardName, 'ALL');
  const shape = wardShape(wardName);
  if (!map || !slot || !slot.links.length || !shape) return false;
  balanceLayer = L.layerGroup().addTo(map);
  balanceWard = wardName;
  const ring = L.geoJSON(turf.buffer(shape.feat, BALANCE_RADIUS_M / 1000, { units: 'kilometers' }), {
    style: { color: LINK_COLOR, weight: 1.5, dashArray: '6,6', fill: false },
    interactive: false
  }).addTo(balanceLayer);
  const merged = new Map();
  slot.links.forEach(l => {
    const k = `${l.lat},${l.lng}`;
    if (merged.has(k)) merged.get(k).area += l.area;
    else merged.set(k, { ...l });
  });
  merged.forEach(l => {
    const pt = turf.point([l.lng, l.lat]);
    if (l.dist > 0) {
      const near = shape.lines
        .map(line => turf.nearestPointOnLine(line, pt, { units: 'meters' }))
        .reduce((a, b) => (a.properties.dist <= b.properties.dist ? a : b));
      const [nLng, nLat] = near.geometry.coordinates;
      L.polyline([[l.lat, l.lng], [nLat, nLng]], { color: LINK_COLOR, weight: 2, dashArray: '4,4', interactive: false }).addTo(balanceLayer);
    }
    L.circleMarker([l.lat, l.lng], { radius: 8, color: LINK_COLOR, weight: 2, fillColor: LINK_COLOR, fillOpacity: 0.2 })
      .bindTooltip(`<b>${escapeHtml(l.name || 'Công trình')}</b><br>${escapeHtml(l.ward)} · tính cân đối ${fmtNum(l.area)} m² · cách ranh ${fmtNum(l.dist)} m`)
      .addTo(balanceLayer);
  });
  map.fitBounds(ring.getBounds(), { padding: [20, 20] });
  return true;
}

export const isBalanceMapOn = (wardName) => balanceWard === wardName;
