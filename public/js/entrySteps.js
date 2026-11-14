// Bước hồ sơ quy hoạch / mạng HTKT — một nguồn cho entryFlows.
import { SECTORS } from './facetStore.js';
import { ENTRY_NET_ROLE } from './netRoles.js';

const MB = 1024 * 1024;

export const HOSO_STEPS = [
  { id: 'qd', label: 'Quyết định', hint: 'Quyết định phê duyệt đồ án.', file: 'pdf', max: 2 * MB, accept: '.pdf' },
  { id: 'ql', label: 'Quy chế', hint: 'Quy chế theo đồ án. Khác quyết định phê duyệt.', file: 'pdf', max: 10 * MB, accept: '.pdf', docRole: 'quy-dinh' },
  { id: 'tm', label: 'Thuyết minh', file: 'pdf', max: 10 * MB, accept: '.pdf', docRole: 'thuyet-minh' },
  {
    id: 'ranh', label: 'Bản vẽ ranh giới quy hoạch', file: 'draw', draw: 'boundary', sector: '', phase: 'quy-hoach', role: 'ranh-hoso',
    hint: 'Ô RG — file RG - tên đồ án.dxf (hoặc KML/KMZ).'
  },
  {
    id: 'dat-ht', label: 'Hiện trạng sử dụng đất', file: 'draw', draw: 'land', sector: 'sdd', phase: 'hien-trang', role: 'ht-dat-hoso',
    hint: 'Ô HT + KH (tem đất, không bắt buộc) — cùng pattern Nhập DXF.'
  },
  {
    id: 'dat-qh', label: 'Quy hoạch sử dụng đất', file: 'draw', draw: 'land', sector: 'sdd', phase: 'quy-hoach', role: 'qh-dat-hoso',
    hint: 'Ô QH + KH (tem đất, không bắt buộc) — cùng pattern Nhập DXF.'
  }
];

export const PUBLISH_KIND = { ranh: 'ranh-gioi', 'dat-ht': 'hien-trang', 'dat-qh': 'su-dung-dat' };

export function buildNetSteps() {
  const steps = [];
  SECTORS.forEach(s => {
    ['hien-trang', 'quy-hoach'].forEach(phase => {
      const id = `${s.id}-${phase === 'hien-trang' ? 'ht' : 'qh'}`;
      steps.push({
        id,
        label: `${phase === 'hien-trang' ? 'Hiện trạng' : 'Quy hoạch'} — ${s.label}`,
        file: 'draw',
        draw: 'network',
        sector: s.id,
        phase,
        role: ENTRY_NET_ROLE[`${s.id}:${phase}`]
      });
    });
  });
  return steps;
}

export function allEntrySteps() {
  return [...HOSO_STEPS, ...buildNetSteps()];
}

export function visibleEntrySteps({ hoMode, netSector, stepList }) {
  const steps = stepList || allEntrySteps();
  if (hoMode === 'net') return steps.filter(s => s.draw === 'network' && s.sector === netSector);
  if (hoMode === 'adjust') return [];
  return steps.filter(s => s.draw !== 'network');
}

export const DRAW_SUPPORTS = {
  dxf: ['batch', 'hoso'],
  kml: ['batch', 'hoso'],
  kmz: ['batch', 'hoso'],
  geojson: ['batch'],
  shp: ['batch']
};
