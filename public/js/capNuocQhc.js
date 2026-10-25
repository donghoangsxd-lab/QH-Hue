// Số liệu mục 9.3.5 thuyết minh QHC, gán vào điểm đầu mối QHC 1/25.000 theo madoituong.
// Ranh vùng là xã, phường hiện nay, không phải nét ranh quận trong bản vẽ QHC.
import { map, WARD_BOUNDS_EVENT, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { withAssetVersion } from './gbaVersion.js';

const FILE_MARK = 'qhc-do-thi-thua-thien-hue-1-25-000';
const FILE_TAIL = 'cong-trinh-dau-moi-cap-nuoc.geojson';
const PANE = 'capNuocVung';
const FMT = new Intl.NumberFormat('vi-VN');

let doc = null;
let loading = null;
let shown = false;
let zonesOn = true;
let picked = null;
let zoneId = null;
let listening = false;
const groups = new Map();
let pin = null;

const TRANG = { giu: 'Hiện có, giữ hoặc nâng', 'xay-moi': 'Xây mới', ngung: 'Ngừng sau 2022', 'quy-mo-nho': 'Quy mô nhỏ, gộp' };

function hosts() {
  return [map, planMap].filter(Boolean);
}

export function loadCapNuocDoc() {
  if (doc) return Promise.resolve(doc);
  if (!loading) {
    loading = fetch(withAssetVersion('data/htkt/cap-nuoc-qhc25.json'))
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => { doc = data; return data; })
      .catch(err => { loading = null; throw err; });
  }
  return loading;
}

export function initCapNuocMap() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(WARD_BOUNDS_EVENT, () => { if (shown && zonesOn) drawZones(); });
}

function isPlantLayer(layer) {
  const file = String(layer && layer.file || '');
  return file.includes(FILE_MARK) && file.endsWith(FILE_TAIL) && layer.kind === 'quy-hoach';
}

function byMa(ma) {
  if (!doc || ma == null || ma === '') return null;
  const key = String(ma);
  const main = (doc.nhaMay || []).find(row => row.ma != null && String(row.ma) === key);
  if (main) return main;
  const small = (doc.diemNho || []).find(row => String(row.ma) === key);
  if (!small) return null;
  const gop = (doc.nhaMay || []).find(row => row.id === 'quy-mo-nho');
  return { ...gop, id: `nho-${key}`, ma: key, ten: small.ten, tenLop: small.ten, nhom: 'quy-mo-nho', lng: small.lng, lat: small.lat, ghiChu: small.ghiChu || (gop && gop.ghiChu) };
}

export function capNuocPlant(layer, props) {
  if (!doc || !isPlantLayer(layer)) return null;
  return byMa(props && props.madoituong);
}

export function capNuocPointStyle(layer, props) {
  const plant = capNuocPlant(layer, props);
  if (!plant) return null;
  if (plant.nhom === 'quy-mo-nho') return { fill: '#7dd3fc', radius: 4 };
  if (plant.trangThai === 'xay-moi') return { fill: '#d97706', radius: 7 };
  if (plant.trangThai === 'ngung') return { fill: '#64748b', radius: 6 };
  return { fill: '#0369a1', radius: 7 };
}

function cell(row, year) {
  const nhan = row && row[`nhan${year}`];
  if (nhan) return nhan;
  const n = row && row[`cs${year}`];
  return n == null ? '—' : FMT.format(n);
}

function num(n) {
  return n == null ? '—' : FMT.format(n);
}

export function capNuocPopupExtra(layer, props) {
  const plant = capNuocPlant(layer, props);
  if (!plant) return '';
  const bits = [
    `2022: ${cell(plant, 2022)}`,
    `2030: ${cell(plant, 2030)}`,
    `2045: ${cell(plant, 2045)}`,
    doc.donVi
  ];
  let html = `<br><b>${escapeHtml(plant.ten)}</b>`;
  html += `<br>${escapeHtml(bits.join(' · '))}`;
  if (plant.nguon) html += `<br>Nguồn: ${escapeHtml(plant.nguon)}`;
  if (plant.phamVi) html += `<br>Phạm vi: ${escapeHtml(plant.phamVi)}`;
  if (plant.dienTich) html += `<br>Diện tích khu đất: ${escapeHtml(FMT.format(plant.dienTich))} m²`;
  if (plant.ghiChu) html += `<br>${escapeHtml(plant.ghiChu)}`;
  html += `<br><small>Mục 9.3.5 thuyết minh QHC. Mã đối tượng ${escapeHtml(String(plant.ma || ''))} trên lớp đầu mối QHC 1/25.000.</small>`;
  return html;
}

function rowHtml(row) {
  const on = picked === row.id;
  const note = on ? `<tr class="cnu-note"><td colspan="4">${escapeHtml([TRANG[row.trangThai], row.nguon, row.phamVi, row.ghiChu].filter(Boolean).join(' · '))}</td></tr>` : '';
  return `<tr class="${on ? 'is-on' : ''}">
    <td><button type="button" data-cnu-plant="${escapeHtml(row.id)}">${escapeHtml(row.ten)}</button></td>
    <td>${escapeHtml(cell(row, 2022))}</td>
    <td>${escapeHtml(cell(row, 2030))}</td>
    <td>${escapeHtml(cell(row, 2045))}</td>
  </tr>${note}`;
}

export function capNuocDossierHtml() {
  if (!doc) return '<p class="cn-empty">Đang tải số liệu cấp nước.</p>';
  const nc = doc.nhuCau;
  const cs = doc.congSuat;
  const zones = (doc.vung || []).map(v => {
    const on = zoneId === v.id;
    return `<button type="button" class="cnu-zone${on ? ' is-on' : ''}" data-cnu-zone="${escapeHtml(v.id)}" style="--cnu:${v.mau}">${escapeHtml(v.ten)}</button>`;
  }).join('');
  const rows = (doc.nhaMay || []).map(rowHtml).join('');
  const small = (doc.diemNho || []).map(p => {
    const on = picked === `nho-${p.ma}`;
    return `<button type="button" class="cnu-small${on ? ' is-on' : ''}" data-cnu-plant="nho-${escapeHtml(p.ma)}">${escapeHtml(p.ten)}</button>`;
  }).join('');
  const zoneNote = zoneId ? (doc.vung || []).find(v => v.id === zoneId) : null;
  return `<section class="cnu" aria-label="Cấp nước theo thuyết minh QHC">
    <h3>Cấp nước đến năm 2045</h3>
    <p class="cnu-src">Mục 9.3.5 thuyết minh QHC, quyết định ${escapeHtml(doc.nguon.quyetDinh)}. Đơn vị ${escapeHtml(doc.donVi)}.</p>
    <div class="cnu-kpis">
      <div class="cnu-kpi"><span>Nhu cầu 2030</span><b>${num(nc.tongVung['2030'])}</b><small>QĐ 108 khoảng ${num(nc.qd108['2030'])}</small></div>
      <div class="cnu-kpi"><span>Nhu cầu 2045</span><b>${num(nc.tongVung['2045'])}</b><small>QĐ 108 khoảng ${num(nc.qd108['2045'])}</small></div>
      <div class="cnu-kpi"><span>Công suất nhà máy 2030</span><b>${num(cs.bang['2030'])}</b><small>Cộng cột 2022: ${num(cs.congO['2022'])}</small></div>
      <div class="cnu-kpi"><span>Công suất nhà máy 2045</span><b>${num(cs.bang['2045'])}</b><small>Cộng các ô: ${num(cs.congO['2045'])}</small></div>
    </div>
    <p class="cnu-src">${escapeHtml(cs.lech2045)}</p>
    <div class="cnu-legend" aria-hidden="true"><i class="is-giu"></i>Hiện có <i class="is-moi"></i>Xây mới <i class="is-ngung"></i>Ngừng <i class="is-nho"></i>Quy mô nhỏ</div>
    <button type="button" class="cnu-map${zonesOn ? ' is-on' : ''}" data-cnu-zones aria-pressed="${zonesOn}">${zonesOn ? 'Đang hiện phân vùng' : 'Hiện phân vùng cấp nước'}</button>
    <div class="cnu-zones" role="group" aria-label="Chín vùng nhu cầu">${zones}</div>
    ${zoneNote ? `<p class="cnu-src"><b>${escapeHtml(zoneNote.ten)}</b> · 2030 ${num(zoneNote.nhuCau2030)} · 2045 ${num(zoneNote.nhuCau2045)} · ${escapeHtml(zoneNote.nguon)}. Nhà máy: ${escapeHtml(zoneNote.nhaMay.join(', '))}.${zoneNote.ghiChu ? ` ${escapeHtml(zoneNote.ghiChu)}` : ''}</p>` : `<p class="cnu-src">${escapeHtml(doc.ranh)}</p>`}
    <div class="cnu-scroll">
      <table class="cnu-table">
        <caption>Bảng 83. Nhà máy nước chính</caption>
        <thead><tr><th>Nhà máy</th><th>2022</th><th>2030</th><th>2045</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <details class="cnu-more">
      <summary>30 điểm quy mô nhỏ trên lớp 1/25.000</summary>
      <div class="cnu-zones">${small}</div>
    </details>
    <details class="cnu-more">
      <summary>Nguồn, mạng lưới, chữa cháy</summary>
      <p>${escapeHtml(doc.luaChonNguon)}</p>
      <p>Sông: ${escapeHtml(doc.song.join(', '))}.</p>
      <p>Hồ: ${doc.ho.map(h => `${escapeHtml(h.ten)} (${escapeHtml(h.so)})`).join('; ')}.</p>
      <p>Suối, đập: ${escapeHtml(doc.suoi.join(', '))}.</p>
      <p>Xây mới: ${escapeHtml(doc.xayMoi.join(', '))}.</p>
      <p>Giữ hoặc nâng: ${escapeHtml(doc.giuNang.join(', '))}.</p>
      <p>${escapeHtml(doc.mang)}</p>
      <p>${escapeHtml(doc.chuaChay)}</p>
      <p>${escapeHtml(doc.ghiChu)}</p>
    </details>
  </section>`;
}

function ensurePane(host) {
  if (!host.getPane(PANE)) {
    const pane = host.createPane(PANE);
    pane.style.zIndex = '350';
  }
}

function clearDraw() {
  groups.forEach(group => group.remove());
  groups.clear();
  if (pin) { pin.remove(); pin = null; }
}

function zonePopup(zone) {
  return `<b>${escapeHtml(zone.ten)}</b><br>Nhu cầu 2030: ${num(zone.nhuCau2030)} ${escapeHtml(doc.donVi)}<br>Nhu cầu 2045: ${num(zone.nhuCau2045)} ${escapeHtml(doc.donVi)}<br>Nguồn: ${escapeHtml(zone.nguon)}<br>Nhà máy: ${escapeHtml(zone.nhaMay.join(', '))}`;
}

function drawZones() {
  clearDraw();
  if (!shown || !zonesOn || !doc || typeof L === 'undefined') return;
  const byName = new Map();
  (state.wardLabelsList || []).forEach(w => { if (w && w.geometry && w.name) byName.set(w.name, w.geometry); });
  const plant = findPicked();
  const hot = new Set(plant && plant.vung ? plant.vung : []);
  hosts().forEach(host => {
    ensurePane(host);
    const group = L.layerGroup();
    (doc.vung || []).forEach(zone => {
      const features = (zone.xa || []).map(name => byName.get(name)).filter(Boolean).map(geometry => ({
        type: 'Feature', geometry, properties: { id: zone.id }
      }));
      if (!features.length) return;
      const emphasize = hot.has(zone.id) || zoneId === zone.id;
      const dim = plant && hot.size && !hot.has(zone.id);
      group.addLayer(L.geoJSON({ type: 'FeatureCollection', features }, {
        pane: PANE,
        style: {
          color: zone.mau,
          weight: emphasize ? 2.4 : 1,
          fillColor: zone.mau,
          fillOpacity: dim ? 0.05 : emphasize ? 0.4 : 0.2
        },
        onEachFeature: (f, layer) => { layer.bindPopup(zonePopup(zone)); }
      }));
    });
    group.addTo(host);
    groups.set(host, group);
  });
  if (plant && Number.isFinite(plant.lat) && Number.isFinite(plant.lng) && map) {
    pin = L.circleMarker([plant.lat, plant.lng], {
      radius: 11, color: '#fff', weight: 2, fillColor: '#b91c1c', fillOpacity: 0.95
    }).addTo(map);
  }
}

export function syncCapNuoc(on) {
  shown = !!on;
  if (!shown) {
    clearDraw();
    return;
  }
  if (zonesOn) drawZones();
  else clearDraw();
}

function findPicked() {
  if (!doc || !picked) return null;
  if (picked.startsWith('nho-')) return byMa(picked.slice(4));
  return (doc.nhaMay || []).find(row => row.id === picked) || null;
}

export function pickCapNuocPlant(id) {
  picked = picked === id ? null : id;
  zoneId = null;
  const plant = findPicked();
  if (plant && map && Number.isFinite(plant.lat) && Number.isFinite(plant.lng)) {
    flyToVisible([plant.lat, plant.lng], 13);
  }
}

export function pickCapNuocZone(id) {
  zoneId = zoneId === id ? null : id;
  picked = null;
  const zone = (doc && doc.vung || []).find(v => v.id === zoneId);
  if (!zone || typeof L === 'undefined' || !map) return;
  const names = new Set(zone.xa || []);
  const bounds = L.latLngBounds([]);
  (state.wardLabelsList || []).forEach(w => {
    if (!names.has(w.name) || !w.geometry) return;
    const b = L.geoJSON(w.geometry).getBounds();
    if (b.isValid()) bounds.extend(b);
  });
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
}

export function toggleCapNuocZones() {
  zonesOn = !zonesOn;
}

export function capNuocPlantLayer(layers) {
  return (layers || []).find(layer => isPlantLayer(layer)) || null;
}
