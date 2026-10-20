// Viền lô quy hoạch sáng hơn màu tô cùng tông; ô CARTO mờ không được coi là nền dùng được.
import { lightenTone, tt16SymbolStyle, landParcelStyle } from '../public/js/tt16Symbols.js';
import { cartoTileUsable } from '../public/js/basemap.js';

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dark = '#394c26';
const lit = lightenTone(dark);
const a = hsl(dark), b = hsl(lit);
assert(b.l > a.l + 0.2, `quốc phòng phải sáng hơn: ${dark} → ${lit}`);
assert(Math.abs(b.h - a.h) < 0.04, `giữ hue: ${a.h.toFixed(3)} → ${b.h.toFixed(3)}`);
assert(b.l < 0.8, `không trắng hóa: ${lit}`);

const green = lightenTone('#009900');
const g = hsl(green);
assert(g.h > 0.28 && g.h < 0.4, `xanh vẫn xanh: ${green} h=${g.h.toFixed(3)}`);

const pale = lightenTone('#c0c0c0');
assert(hsl(pale).l > hsl('#c0c0c0').l && hsl(pale).l < 0.9, `xám nhạt không mất trên nền sáng: ${pale}`);

const plan = tt16SymbolStyle('QP', '#394c26', 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(plan.fillColor === '#394c26', 'hoa văn/tô giữ màu gốc');
assert(plan.color !== plan.fillColor && plan.color === lit, `viền là màu đã làm sáng (${plan.color})`);
assert(plan.weight > 1.8 && plan.weight < 4, `nét dày hơn 1.8 nhưng dưới 4px che lô hẹp (${plan.weight})`);
assert(plan.casingColor && plan.casingWeight > plan.weight && plan.casingWeight < 4.4, 'quầng sáng mỏng dưới nét màu');
assert(!plan.dashArray, 'QHDD nét liền');

const pending = tt16SymbolStyle('QP', '#394c26', 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: false });
assert(pending.color === '#f87171' && pending.dashArray === '4,4', 'chờ duyệt vẫn viền đỏ nét đứt');
assert(pending.fillColor === '#394c26', 'tô chờ duyệt không đổi');

const ht = tt16SymbolStyle('QP', '#394c26', 'HT_DAT_Quocphong', { scenario: 'HT', detailed: false, approved: true });
assert(ht.weight === 1 && !ht.casingColor, 'hiện trạng giữ nét mảnh, không quầng quy hoạch');
assert(ht.color === lit, 'hiện trạng vẫn sáng viền để khỏi chìm');

const qhdh = tt16SymbolStyle('1-CV', '#66cc00', 'QHDH_DAT_HTXH_CayxanhCC', { scenario: 'QH', detailed: false });
assert(qhdh.dashArray && qhdh.casingColor, 'dài hạn giữ nét đứt và quầng');
assert(qhdh.fillColor === '#66cc00' && qhdh.color !== '#66cc00', 'cây xanh: tô gốc, viền sáng hơn');

const bare = landParcelStyle('QH_Dat_khac_khong_ma', { phase: 'QH', detailed: false });
assert(bare.casingColor && bare.weight > 1, 'lô không có khóa TT16 vẫn có viền quy hoạch sáng');

assert(cartoTileUsable(2049) === false, 'ô mờ CARTO ~2KB không dùng được');
assert(cartoTileUsable(18000) === true, 'ô Positron thật vẫn dùng được');

console.log('lot-outline: ok', { dark, lit, green, pale, weight: plan.weight, halo: plan.casingWeight });
