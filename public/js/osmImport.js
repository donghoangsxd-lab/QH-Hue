// Admin: tải điểm OpenStreetMap trong 40 phường/xã → máy chủ lọc trùng, gán phường, bán kính (action importOsmNetwork).
// Xe buýt, PCCC, nghĩa trang ghi chờ duyệt (TrangThai = FALSE). Thể thao ghi vào tab 8-VH đã duyệt (TrangThai = TRUE).
// Bảng loại thể thao khớp services/osmSports.js.
import { state } from './state.js';
import { geeApi, markDataWritten } from './api.js';
import { escapeHtml, ico, showToast, fmtNum, setStatusContent } from './utils.js';
import { wardNameAt } from './mapEngine.js';
import { queryOverpassHedged } from './serviceArea.js';

// Khung = constants.HUE_BOUNDS (lọc theo khung nhanh hơn nhiều so với lọc theo ranh hành chính trên Overpass)
const OSM_QUERY = `[out:json][timeout:90][bbox:15.9,106.9,16.9,108.3];
(
  node["highway"="bus_stop"];
  node["public_transport"="platform"]["bus"="yes"];
  nwr["amenity"="fire_station"];
  nwr["amenity"~"^(funeral_hall|crematorium)$"];
  nwr["landuse"="cemetery"];
  nwr["amenity"="grave_yard"];
  nwr["leisure"~"^(sports_centre|pitch|stadium|track|fitness_centre|swimming_pool|golf_course)$"];
);
out geom;`;
const FETCH_TIMEOUT_MS = 100000;
const HEDGE_MS = 25000;
const TYPE_LABELS = {
  "13-BUS": "Trạm dừng xe buýt",
  "10-PCCC": "Trụ sở cảnh sát PCCC",
  "11-NT": "Nhà tang lễ, nghĩa trang",
  "8-VH": "Nhà văn hóa, thể thao"
};
const LEISURE_VI = {
  sports_centre: 'Nhà thi đấu, trung tâm thể thao',
  pitch: 'Sân thể thao',
  stadium: 'Sân vận động',
  track: 'Đường chạy',
  fitness_centre: 'Cơ sở tập luyện',
  swimming_pool: 'Bể bơi',
  golf_course: 'Sân gôn'
};
const URBAN_LEISURE = new Set(['stadium', 'sports_centre', 'golf_course']);

let onImported = null;
let preview = null;   // { items, stats } của lần kiểm tra gần nhất
let busy = false;

const $ = (id) => document.getElementById(id);
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').trim().toUpperCase();

const isClosed = (g) => Array.isArray(g) && g.length >= 4
  && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

// Diện tích vòng kín (m²) trên mặt phẳng chiếu cục bộ
function ringArea(pts) {
  const lat0 = pts[0].lat, lon0 = pts[0].lon;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].lon - lon0) * kx * (pts[i].lat - lat0) * ky - (pts[i].lon - lon0) * kx * (pts[j].lat - lat0) * ky;
  }
  return Math.abs(a / 2);
}

function areaOf(el) {
  if (el.type === 'way') return isClosed(el.geometry) ? ringArea(el.geometry) : 0;
  if (el.type !== 'relation') return 0;
  return Math.max(0, (el.members || []).reduce((s, m) => {
    if (m.type !== 'way' || !isClosed(m.geometry)) return s;
    return s + (m.role === 'inner' ? -1 : 1) * ringArea(m.geometry);
  }, 0));
}

function centerOf(el) {
  if (el.type === 'node') return { lat: el.lat, lng: el.lon };
  const g = el.type === 'way' && Array.isArray(el.geometry) ? el.geometry.filter(Boolean) : [];
  if (g.length) {
    const pts = isClosed(g) ? g.slice(0, -1) : g;
    return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
  }
  if (el.type === 'relation') {
    const pts = [];
    (el.members || []).forEach(m => {
      if (m.role === 'inner' || !Array.isArray(m.geometry)) return;
      m.geometry.forEach(p => { if (p && Number.isFinite(p.lat)) pts.push(p); });
    });
    if (pts.length) {
      return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
    }
  }
  const b = el.bounds;
  return b ? { lat: (b.minlat + b.maxlat) / 2, lng: (b.minlon + b.maxlon) / 2 } : null;
}

function sportTitle(tags, kind) {
  const label = LEISURE_VI[kind];
  const name = String(tags['name:vi'] || tags.name || tags['name:en'] || '').trim();
  if (!name) return label;
  const f = fold(name).replace(/[^A-Z0-9]/g, '');
  const sport = /THETHAO|THEDUC|TDTT|SANVANDONG|SANGOLF|SANGON|SANBONG|NHATHIDAU|BEBOI|DUONGCHAY|TAPLUYEN|HOBOI|STADIUM|SWIMMING|GOLF|FITNESS|PITCH|SPORT/.test(f);
  return (sport && !f.includes('VANHOA') ? name : `${name} (${label})`).slice(0, 150);
}

/** Thẻ OSM → { type, name } hoặc null; tên được bổ sung từ khóa để constants.ntKind nhận đúng hình thức */
function classify(tags) {
  const t = tags || {};
  if (t.historic) return null;
  const name = String(t['name:vi'] || t.name || '').trim();
  const f = fold(name);
  if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes')) {
    return { type: '13-BUS', name: name || 'Trạm dừng xe buýt' };
  }
  if (t.amenity === 'fire_station') {
    // Trụ nước / bể nước chữa cháy bị gắn nhầm thẻ trụ sở
    if (f.includes('NUOC') && !f.includes('CANH SAT')) return null;
    return { type: '10-PCCC', name: name || 'Trụ sở cảnh sát PCCC' };
  }
  if (t.amenity === 'funeral_hall') return { type: '11-NT', name: f.includes('TANG LE') ? name : `Nhà tang lễ ${name}`.trim() };
  if (t.amenity === 'crematorium') return { type: '11-NT', name: f.includes('HOA TANG') ? name : `Cơ sở hỏa táng ${name}`.trim() };
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') {
    // Lăng mộ di tích (Lăng ..., Bửu Thành) không phải nghĩa trang
    if (/^(LANG|BUU THANH)\b/.test(f)) return null;
    return { type: '11-NT', name: /NGHIA (TRANG|DIA|TRUNG)|NTLS/.test(f) ? name : `Nghĩa trang ${name}`.trim(), area: true };
  }
  if (LEISURE_VI[t.leisure]) {
    if (t.disused === 'yes' || t.abandoned === 'yes' || t.demolished === 'yes' || t.razed === 'yes') return null;
    const kind = t.leisure;
    return {
      type: '8-VH',
      name: sportTitle(t, kind),
      area: true,
      nhom: URBAN_LEISURE.has(kind) ? 'Cấp đô thị' : 'Cấp DVO',
      kind,
      kindLabel: LEISURE_VI[kind]
    };
  }
  return null;
}

function selectedTypes() {
  return [...document.querySelectorAll('.osm-type:checked')].map(el => el.value);
}

async function fetchOsmItems(types) {
  const data = await queryOverpassHedged(OSM_QUERY, FETCH_TIMEOUT_MS, HEDGE_MS);
  const wardsReady = (state.wardLabelsList || []).some(w => w.geometry);
  const items = [];
  (data.elements || []).forEach(el => {
    const c = classify(el.tags);
    if (!c || !types.includes(c.type)) return;
    const pt = centerOf(el);
    if (!pt) return;
    // Bỏ trước phần ngoài 40 phường/xã (Đà Nẵng, Quảng Trị trong khung) cho nhẹ lượt gửi; máy chủ kiểm tra lại
    if (wardsReady && !wardNameAt(pt.lat, pt.lng)) return;
    const ref = `OSM:${el.type}/${el.id}`;
    const item = {
      type: c.type, name: c.name, lat: Number(pt.lat.toFixed(6)), lng: Number(pt.lng.toFixed(6)),
      size: c.area ? Math.round(areaOf(el)) : 0, ref
    };
    if (c.type === '8-VH') {
      const addr = String(el.tags['addr:full'] || [el.tags['addr:housenumber'], el.tags['addr:street']].filter(Boolean).join(' ') || '').trim();
      item.nhom = c.nhom;
      item.kind = c.kind;
      item.note = [`Nguồn: OSM (${ref})`, `Loại: ${c.kindLabel}`, addr ? `Địa chỉ OSM: ${addr.slice(0, 120)}` : ''].filter(Boolean).join('. ');
    }
    items.push(item);
  });
  return items;
}

async function postImport(items, dryRun) {
  if (!dryRun) markDataWritten();
  const res = await fetch(geeApi('action=importOsmNetwork'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify({ items, dryRun })
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('Phiên Admin hết hạn — đăng nhập lại');
  if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  return data;
}

function tallyStats(stats) {
  return Object.values(stats || {}).reduce((s, row) => ({
    received: s.received + (Number(row.received) || 0),
    outside: s.outside + (Number(row.outside) || 0),
    duplicate: s.duplicate + (Number(row.duplicate) || 0)
  }), { received: 0, outside: 0, duplicate: 0 });
}

function setStatus(text, color = 'var(--text-muted)') {
  const el = $('osmStatus');
  if (!el) return;
  el.style.color = color;
  setStatusContent(el, text);
}

function writeLabel(items) {
  const n = items.length;
  const approved = items.filter(it => it.type === '8-VH').length;
  if (approved === n) return `GHI ${fmtNum(n)} CÔNG TRÌNH VH-TT (ĐÃ DUYỆT)`;
  if (approved) return `GHI ${fmtNum(n)} ĐIỂM (${fmtNum(approved)} VH-TT ĐÃ DUYỆT)`;
  return `GHI ${fmtNum(n)} ĐIỂM CHỜ DUYỆT`;
}

function renderReport() {
  const box = $('osmReport');
  if (!box) return;
  if (!preview) { box.innerHTML = ''; return; }
  const { stats, items } = preview;
  const rows = Object.keys(TYPE_LABELS).filter(t => stats[t] && stats[t].received).map(t => {
    const s = stats[t];
    return `<tr><td>${escapeHtml(TYPE_LABELS[t])}</td><td>${fmtNum(s.received)}</td><td>${fmtNum(s.outside)}</td><td>${fmtNum(s.duplicate)}</td><td><b class="c-green">${fmtNum(s.accepted)}</b></td></tr>`;
  }).join('');
  box.innerHTML = rows
    ? `<table class="cad-table osm-table"><thead><tr><th>Loại</th><th>OSM</th><th title="Ngoài 40 phường/xã hoặc tọa độ lỗi">Ngoài ranh</th><th title="Đã có trong dữ liệu (cùng mã OSM hoặc cùng loại ở rất gần)">Trùng</th><th>Mới</th></tr></thead><tbody>${rows}</tbody></table>
      ${items.length ? `<button type="button" class="btn-submit" id="btnOsmWrite"${busy ? ' disabled' : ''}>${ico('save')}${escapeHtml(writeLabel(items))}</button>` : ''}`
    : `<div class="cad-hint">OpenStreetMap không có điểm thuộc loại đã chọn trong 40 phường/xã.</div>`;
  $('btnOsmWrite')?.addEventListener('click', writePreview);
}

async function checkOsm() {
  if (busy) return;
  const types = selectedTypes();
  if (!types.length) { setStatus('⚠️ Chọn ít nhất 1 loại', 'var(--accent-red)'); return; }
  busy = true;
  preview = null;
  renderReport();
  $('btnOsmCheck').disabled = true;
  try {
    setStatus('⏳ Đang tải dữ liệu OpenStreetMap (có thể mất 15–60 giây khi máy chủ OSM bận)...', 'var(--accent-orange)');
    const items = await fetchOsmItems(types);
    if (!items.length) {
      preview = { items: [], stats: {} };
      setStatus('Không tìm thấy điểm OSM phù hợp trong 40 phường/xã.');
      return;
    }
    setStatus(`⏳ Đối chiếu ${fmtNum(items.length)} điểm OSM với dữ liệu hiện có...`, 'var(--accent-orange)');
    const res = await postImport(items, true);
    preview = { items: res.items || [], stats: res.stats || {}, sent: items };
    const tally = tallyStats(preview.stats);
    if (preview.items.length) {
      const vh = preview.items.filter(it => it.type === '8-VH').length;
      const hint = vh === preview.items.length
        ? 'Công trình thể thao ghi vào tab 8-VH, TrangThai = TRUE.'
        : (vh ? 'Thể thao ghi đã duyệt vào tab 8-VH; loại khác vẫn chờ duyệt.' : 'Bấm Ghi điểm chờ duyệt phía dưới.');
      setStatus(`Có ${fmtNum(preview.items.length)} điểm mới. ${hint} Kiểm tra chưa ghi vào Sheet.`, 'var(--accent-orange)');
    } else if (tally.duplicate > 0 && tally.outside === 0) {
      setStatus('✓ Dữ liệu đã có đủ các điểm OSM, không có điểm mới.', 'var(--accent-green)');
    } else if (!tally.received) {
      setStatus('Không tìm thấy điểm OSM phù hợp trong 40 phường/xã.');
    } else {
      setStatus(`Không có điểm mới để ghi: ${fmtNum(tally.outside)} ngoài ranh, ${fmtNum(tally.duplicate)} trùng.`, 'var(--accent-orange)');
    }
  } catch (err) {
    setStatus(`❌ ${err.message || 'Không tải được dữ liệu OpenStreetMap'}`, 'var(--accent-red)');
  } finally {
    busy = false;
    $('btnOsmCheck').disabled = false;
    renderReport();
  }
}

async function writePreview() {
  if (busy || !preview || !preview.items.length) return;
  busy = true;
  renderReport();
  setStatus(`⏳ Đang ghi ${fmtNum(preview.items.length)} điểm vào Sheet...`, 'var(--accent-orange)');
  try {
    const res = await postImport(preview.sent, false);
    if (!(Number(res.created) > 0)) {
      const skip = Number(res.skipped) > 0 ? ` Bỏ qua ${fmtNum(res.skipped)} điểm.` : '';
      throw new Error(`Sheet không thêm dòng nào.${skip}`);
    }
    const where = (res.sheets || []).length ? ` vào tab ${(res.sheets || []).join(', ')}` : '';
    const vh = (preview.items || []).some(it => it.type === '8-VH');
    showToast(`✓ Đã ghi ${fmtNum(res.created)} điểm${where}`, 'success');
    setStatus(vh
      ? `✓ Đã ghi ${fmtNum(res.created)} điểm${where}. Thể thao ở tab 8-VH với TrangThai = TRUE; xe buýt, PCCC, nghĩa trang vẫn chờ duyệt.`
      : `✓ Đã ghi ${fmtNum(res.created)} điểm (TrangThai = FALSE)${where}. Kéo thanh tab Sheet sang phải nếu chưa thấy 13-BUS, 10-PCCC, 11-NT.`,
    'var(--accent-green)');
    preview = null;
    busy = false;
    if (onImported) await onImported();
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'var(--accent-red)');
  } finally {
    busy = false;
    renderReport();
  }
}

/** opts.onImported: tải lại dữ liệu sau khi máy chủ ghi Sheet */
export function initOsmImport(opts = {}) {
  onImported = opts.onImported || null;
  $('btnOsmCheck')?.addEventListener('click', checkOsm);
}
