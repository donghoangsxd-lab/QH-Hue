// Ký hiệu điểm HTKT: giọt nước (ngành khác) + ký hiệu điểm GT theo TT16/2025/TT-BXD Phụ lục HTKT_GT_*.
import { foldName, isHydrantLayer } from './htktModel.js';

export const DROP_PATH = 'M35 2C16.8 2 2 16.8 2 35c0 21 24 41 31 57a2.2 2.2 0 004 0c7-16 31-36 31-57C68 16.8 53.2 2 35 2z';

// Glyph viewBox 24×24, đặt trong vòng trắng tâm giọt. C = màu ngành, E = viền đậm.
const GLYPH = {
  water: '<g fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5s5.2 5.4 5.2 9.1a5.2 5.2 0 0 1-10.4 0C6.8 8.9 12 3.5 12 3.5z"/><path d="M9.2 13.2c.8 1.4 2.2 2.1 2.8 2.1"/></g>',
  bolt: '<path fill="C" stroke="E" stroke-width="0.8" stroke-linejoin="round" d="M13.2 2.2 5.2 13.4h6L10.4 21.8 19 10.4h-6.2z"/>',
  road: '<g fill="none" stroke="C" stroke-width="2" stroke-linecap="round"><path d="M9 3.2 5.6 20.8M15 3.2l3.4 17.6"/><path d="M12 5.2v2.4M12 11v2.4M12 16.8v2.4"/></g>',
  parking: '<text x="12" y="17.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="C">P</text>',
  drain: '<g fill="none" stroke="C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.2h16M6.2 7.2c0 5.2 1.8 7.2 5.8 7.2s5.8-2 5.8-7.2"/><path d="M12 14.4v5.2M9.2 17.2 12 20.2l2.8-3"/></g>',
  wastewater: '<g fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"><rect x="5" y="8" width="14" height="10" rx="1.4"/><path d="M8 8V6.2h8V8M8 13h3.2M12.8 13H16"/><circle cx="12" cy="18.6" r="1.1" fill="C" stroke="none"/></g>',
  waste: '<g fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"><path d="M8.2 8.2h7.6l-.8 11.2H9z"/><path d="M7 8.2h10M10 8.2V6.4h4v1.8M10.8 11.2v5.2M13.2 11.2v5.2"/></g>',
  signal: '<g fill="none" stroke="C" stroke-width="2" stroke-linecap="round"><path d="M12 19.2v-5.2"/><path d="M8.4 14.2a5.2 5.2 0 0 1 7.2 0"/><path d="M5.8 11.4a8.4 8.4 0 0 1 12.4 0"/><circle cx="12" cy="19.2" r="1.15" fill="C" stroke="none"/></g>',
  energy: '<g fill="none" stroke="C" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.4"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.4 6.4l1.5 1.5M16.1 16.1l1.5 1.5M17.6 6.4l-1.5 1.5M7.9 16.1l-1.5 1.5"/></g>',
  hydrant: '<g fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"><path d="M9.2 8.2h5.6v9.4H9.2z"/><path d="M10.4 5.6h3.2v2.6h-3.2z"/><path d="M7.4 11.2H9.2M14.8 11.2h1.8M10.6 17.6v2.2h2.8v-2.2"/></g>',
  pin: '<g fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"><path d="M12 20.2s-5.4-4.6-5.4-8.4a5.4 5.4 0 0 1 10.8 0c0 3.8-5.4 8.4-5.4 8.4z"/><circle cx="12" cy="11.4" r="2"/></g>'
};

const SECTOR_LOOK = {
  'giao-thong': { fill: '#0284c7', edge: '#0c4a6e', glyph: 'road' },
  'cap-nuoc': { fill: '#0369a1', edge: '#0c4a6e', glyph: 'water' },
  'cap-dien': { fill: '#dc2626', edge: '#7f1d1d', glyph: 'bolt' },
  'san-nen-thoat-mua': { fill: '#a16207', edge: '#713f12', glyph: 'drain' },
  'thoat-nuoc-thai': { fill: '#7c2d12', edge: '#451a03', glyph: 'wastewater' },
  'chat-thai-ran-nghia-trang': { fill: '#57534e', edge: '#292524', glyph: 'waste' },
  'thong-tin-lien-lac': { fill: '#7c3aed', edge: '#4c1d95', glyph: 'signal' },
  'tong-hop-duong-ong': { fill: '#0f766e', edge: '#134e4a', glyph: 'drain' },
  'khong-gian': { fill: '#f59e0b', edge: '#b45309', glyph: 'pin' }
};

const NHOM_LOOK = {
  'nang-luong': { fill: '#ea580c', edge: '#9a3412', glyph: 'energy' },
  'duong-sat': { fill: '#b45309', edge: '#78350f', glyph: 'road' },
  'duong-thuy': { fill: '#0f766e', edge: '#134e4a', glyph: 'drain' }
};

const WATER_STATUS = {
  'quy-mo-nho': { fill: '#38bdf8', edge: '#0369a1' },
  'xay-moi': { fill: '#d97706', edge: '#92400e' },
  ngung: { fill: '#64748b', edge: '#334155' },
  giu: { fill: '#0369a1', edge: '#0c4a6e' }
};

// ACI phụ lục TT16: 7 = đen trên nền sáng; 5 = xanh; 12 = đỏ (đường sắt).
const TT16_ACI = {
  7: '#1a1a1a',
  5: '#0000ff',
  12: '#dc2626'
};

/** Pictogram trong khung TT16 (viewBox 32×32). Không tự chế — theo bảng HTKT_GT_Benxe / Tramxang / Tuynen / Bencang / Duongsat. */
const TT16_PIC = {
  // HTKT_GT_Benxe — bến xe khách (xe bus nghiêng cạnh)
  benxe: '<g fill="none" stroke="C" stroke-width="1.6" stroke-linejoin="round"><rect x="7" y="11" width="18" height="9" rx="2.2"/><path d="M9 11V9.2h10.5c1.2 0 2.2.7 2.6 1.8"/><circle cx="11.2" cy="20.4" r="1.7"/><circle cx="20.8" cy="20.4" r="1.7"/><path d="M10 14h4.5M16.2 14h5"/></g>',
  // HTKT_GT_Benxe — bến xe tải
  benxe_tai: '<g fill="none" stroke="C" stroke-width="1.6" stroke-linejoin="round"><rect x="6.5" y="11.5" width="12" height="8" rx="1"/><path d="M18.5 13.5h4.2l2.3 3.2v3h-6.5z"/><circle cx="10.2" cy="21.2" r="1.7"/><circle cx="21.5" cy="21.2" r="1.7"/><path d="M8.2 14.2h7"/></g>',
  // HTKT_GT_Benxe — bãi đỗ xe
  parking: '<text x="16" y="21.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="C">P</text>',
  // HTKT_GT_Tramxang
  tramxang: '<g fill="none" stroke="C" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><rect x="9" y="8.5" width="9.5" height="14" rx="1.2"/><path d="M12 8.5V7h3.5v1.5"/><path d="M18.5 12h2.2c1.1 0 2 .9 2 2v4.5"/><circle cx="22.7" cy="19.2" r="1.3"/><path d="M11.2 12.2h5.2M11.2 15.2h5.2"/></g>',
  // HTKT_GT_Tuynen
  tuynen: '<g fill="none" stroke="C" stroke-width="2" stroke-linecap="round"><path d="M8 12h16M8 20h16M8 12v8M24 12v8"/></g>',
  // Neo dùng chung HTKT_GT_Bencang
  _anchor: '<g fill="none" stroke="C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="10.2" r="1.6"/><path d="M16 11.8v9.2"/><path d="M16 17.2c-3.2 0-5.2 2-5.2 4.2M16 17.2c3.2 0 5.2 2 5.2 4.2"/><path d="M12.2 14.5h7.6"/></g>',
  // Nhà ga / bến đỗ đường sắt — ghi chú «G»; ga ngầm «M»
  ga: '<text x="16" y="21.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="C">G</text>',
  ga_ngam: '<text x="16" y="21.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="C">M</text>'
};

function darken(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#334155';
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function propBlob(layer, props) {
  return foldName([
    props && props.loaicongtrinh,
    props && props.tencongtrinh,
    props && props.tendoituong,
    props && props.ghichu,
    props && props.loai,
    props && props.trinhbaydulieu,
    layer && layer.name
  ].filter(Boolean).join(' '));
}

/**
 * Phân loại điểm GT theo TT16 Phụ lục 1 (HTKT_GT_*).
 * Chỉ trả loại có ký hiệu điểm trong bảng; nút giao / sân bay / cửa khẩu không có → ''.
 * Mã loaicongtrinh: schema gisHue QHC/QHPK Huế.
 */
export function gtTt16Kind(layer, props = {}) {
  if (!layer || layer.sector !== 'giao-thong') return '';
  const code = String(props.loaicongtrinh || '').trim();
  const t = propBlob(layer, props);

  if (code === '18' || /tram[-_ ]?xang|cay[-_ ]?xang|xang[-_ ]?dau|petrol|gas[-_ ]?station/.test(t)) {
    return 'tramxang';
  }
  if (/tuy[-_ ]?nen|ham[-_ ]?duong|\btunnel\b/.test(t)) return 'tuynen';

  if (code === '4' || /bai[-_ ]?do[-_ ]?xe|do[-_ ]?xe|parking|\bbdx\b/.test(t)) return 'parking';

  if (code === '2' || code === '5' || /ben[-_ ]?xe|\bbus\b/.test(t)) {
    if (/tai|hang|container|truck/.test(t) && !/khach/.test(t)) return 'benxe_tai';
    return 'benxe';
  }

  if (code === '1' || (/\bga\b|nha[-_ ]?ga|\bdepot\b/.test(t) && !/cang|ben[-_ ]?xe|bai[-_ ]?do/.test(t))) {
    if (/ngam|metro|subway|tau[-_ ]?dien[-_ ]?ngam/.test(t)) return 'ga_ngam';
    return 'ga';
  }

  if (code === '13' || /cang[-_ ]?can|dry[-_ ]?port/.test(t)) return 'bencang_cangcan';
  if (code === '11' || /cang[-_ ]?hanh[-_ ]?khach|ben[-_ ]?hanh[-_ ]?khach/.test(t)) return 'bencang_2';
  if (/cang[-_ ]?hang[-_ ]?hoa|ben[-_ ]?hang[-_ ]?hoa/.test(t)) return 'bencang_3';
  if (/chuyen[-_ ]?dung/.test(t) && /cang|ben/.test(t)) return 'bencang_4';
  if (code === '15' || /ben[-_ ]?pha|ben[-_ ]?thuyen|ben[-_ ]?do|\bthuyen\b|thuy[-_ ]?noi[-_ ]?dia|ferry|wharf|jetty/.test(t)) {
    return 'bencang_pha';
  }
  if (code === '10' || (/cang/.test(t) && !/hang[-_ ]?khong|san[-_ ]?bay/.test(t))) return 'bencang_1';

  return '';
}

function tt16Frame(kind, color, { dashed = false } = {}) {
  const stroke = dashed ? `stroke="${color}" stroke-width="1.8" stroke-dasharray="3.5 2.2" fill="#fff"` : `stroke="${color}" stroke-width="1.8" fill="#fff"`;
  if (kind === 'bencang_3' || kind === 'bencang_cangcan') {
    return `<rect x="3.5" y="3.5" width="25" height="25" rx="1" ${stroke}/>`;
  }
  if (kind === 'bencang_4') {
    return `<path d="M16 3.2 28.5 27.5H3.5Z" ${stroke}/>`;
  }
  if (kind === 'bencang_pha') {
    return `<path d="M16 3.5 28.5 16 16 28.5 3.5 16Z" ${stroke}/>`;
  }
  return `<circle cx="16" cy="16" r="13.2" ${stroke}/>`;
}

function tt16Inner(kind, color) {
  if (kind.startsWith('bencang')) {
    const num =
      kind === 'bencang_1' ? '1'
        : kind === 'bencang_2' ? '2'
          : kind === 'bencang_3' ? '3'
            : kind === 'bencang_4' ? '4'
              : '';
    const anchor = TT16_PIC._anchor.replaceAll('C', color);
    const hatch = kind === 'bencang_cangcan'
      ? `<path d="M3.5 16h25" stroke="${color}" stroke-width="1.4"/>`
      : '';
    const label = num
      ? `<text x="24.2" y="11.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7.5" font-weight="700" fill="${color}">${num}</text>`
      : '';
    return `${hatch}${anchor}${label}`;
  }
  const pic = TT16_PIC[kind];
  return pic ? pic.replaceAll('C', color) : '';
}

function tt16Color(kind) {
  if (kind === 'ga' || kind === 'ga_ngam') return TT16_ACI[12];
  if (kind.startsWith('bencang')) return TT16_ACI[5];
  return TT16_ACI[7];
}

/** SVG ký hiệu điểm TT16 (tâm = tọa độ). */
export function htktTt16Svg(kind, { dashed = false, className = 'htkt-tt16' } = {}) {
  if (!kind) return '';
  const color = tt16Color(kind);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="${className}" aria-hidden="true">${tt16Frame(kind, color, { dashed })}${tt16Inner(kind, color)}</svg>`;
}

function facilityGlyph(layer, props) {
  // Điểm GT có ký hiệu TT16 → không dùng glyph giọt nước tự chế.
  if (gtTt16Kind(layer, props)) return '';
  const t = propBlob(layer, props);
  if (/bai[-_ ]?do[-_ ]?xe|do[-_ ]?xe|parking|\bbdx\b/.test(t)) return 'parking';
  return '';
}

function subtypeGlyph(layer) {
  const n = foldName(`${layer && layer.name || ''} ${layer && layer.file || ''}`);
  if (/nang[-_ ]?luong|dien[-_ ]?mat[-_ ]?troi|nang[-_ ]?luong[-_ ]?tai[-_ ]?tao/.test(n)) return 'energy';
  if (/xu[-_ ]?ly[-_ ]?nuoc[-_ ]?thai|tram[-_ ]?xu[-_ ]?ly|wwtp/.test(n)) return 'wastewater';
  if (/chat[-_ ]?thai|rac|nghia[-_ ]?trang|tang[-_ ]?le/.test(n)) return 'waste';
  if (/tram[-_ ]?thong[-_ ]?tin|vien[-_ ]?thong|bts|anten/.test(n)) return 'signal';
  if (/thuy[-_ ]?loi|tieu[-_ ]?thoat|ho[-_ ]?dieu[-_ ]?hoa/.test(n)) return 'drain';
  if (/dau[-_ ]?moi[-_ ]?giao[-_ ]?thong|ben[-_ ]?xe|cau|cang/.test(n)) return 'road';
  if (/cap[-_ ]?dien|tram[-_ ]?bien|tram[-_ ]?dien/.test(n)) return 'bolt';
  if (/cap[-_ ]?nuoc|nha[-_ ]?may[-_ ]?nuoc|dau[-_ ]?moi[-_ ]?cap[-_ ]?nuoc/.test(n)) return 'water';
  return '';
}

/** Màu / glyph cho một điểm HTKT (có thể gắn style cấp nước từ capNuocPointStyle). */
export function htktPointLook(layer, props = {}, styled = null) {
  const tt16 = gtTt16Kind(layer, props);
  if (tt16) {
    const radius = styled && styled.radius;
    const scale = radius != null && radius <= 4 ? 0.82 : radius != null && radius >= 7 ? 1.05 : 1;
    return {
      fill: tt16Color(tt16),
      edge: tt16Color(tt16),
      glyph: `tt16:${tt16}`,
      tt16,
      dashed: !!(layer && layer.kind === 'quy-hoach'),
      scale
    };
  }
  const sector = layer && layer.sector;
  const base = SECTOR_LOOK[sector] || { fill: '#64748b', edge: '#334155', glyph: 'pin' };
  const nhom = NHOM_LOOK[props && props.nhom];
  let fill = (styled && styled.fill) || (nhom && nhom.fill) || base.fill;
  let edge = (nhom && nhom.edge) || base.edge;
  const facility = facilityGlyph(layer, props);
  let glyph = facility || (nhom && nhom.glyph) || subtypeGlyph(layer) || base.glyph;
  if (facility === 'parking') {
    fill = '#0284c7';
    edge = '#0c4a6e';
  }
  if (isHydrantLayer(layer)) {
    fill = '#dc2626';
    edge = '#7f1d1d';
    glyph = 'hydrant';
  }
  if (styled && styled.fill) edge = darken(styled.fill);
  const radius = styled && styled.radius;
  const scale = radius != null && radius <= 4 ? 0.82 : radius != null && radius >= 7 ? 1.05 : 1;
  return { fill, edge, glyph, scale };
}

export function htktDropSvg(look, className = 'htkt-drop') {
  const fill = look?.fill || '#64748b';
  const edge = look?.edge || darken(fill);
  const key = look?.glyph && GLYPH[look.glyph] ? look.glyph : 'pin';
  const glyph = GLYPH[key].replaceAll('C', fill).replaceAll('E', edge);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 96" class="${className}" aria-hidden="true">
    <path d="${DROP_PATH}" fill="${fill}" stroke="${edge}" stroke-width="1.5"/>
    <circle cx="35" cy="35" r="26" fill="#fff"/>
    <g transform="translate(23 23)">${glyph}</g>
  </svg>`;
}

/** Leaflet divIcon; điểm GT có loại TT16 → vòng/khung chuẩn, còn lại giọt nước. */
export function htktPointIcon(layer, props, styled) {
  const look = htktPointLook(layer, props, styled);
  const scale = look.scale || 1;
  if (look.tt16) {
    const s = Math.round(30 * scale);
    const html = htktTt16Svg(look.tt16, { dashed: look.dashed, className: 'htkt-tt16' });
    return L.divIcon({
      className: 'htkt-pin htkt-pin-tt16',
      html: `<div style="width:${s}px;height:${s}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">${html}</div>`,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)]
    });
  }
  const w = Math.round(26 * scale);
  const h = Math.round(36 * scale);
  const html = look.glyph === 'parking'
    ? `<img src="./icons/Parking.png" alt="" width="${w}" height="${h}" style="display:block;width:${w}px;height:${h}px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))"/>`
    : htktDropSvg(look);
  return L.divIcon({
    className: look.glyph === 'parking' ? 'htkt-pin htkt-pin-png' : 'htkt-pin',
    html,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
    popupAnchor: [0, -Math.round(h * 0.72)]
  });
}

export function htktSectorLook(sectorId) {
  return SECTOR_LOOK[sectorId] || { fill: '#64748b', edge: '#334155', glyph: 'pin' };
}

export function htktWaterStatusLook(status) {
  return WATER_STATUS[status] || WATER_STATUS.giu;
}

export function htktWaterStatusDrop(status, className = 'htkt-drop htkt-legend-drop') {
  const st = htktWaterStatusLook(status);
  return htktDropSvg({ ...st, glyph: 'water' }, className);
}
