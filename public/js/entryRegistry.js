// Hợp đồng sáu trục đề xuất. UI vẫn wire tay; descriptor để mở rộng C-điểm / F đề xuất và test.
// Chi tiết: docs/entry-architecture.md

export const ENTRY_FLOWS = [
  {
    id: 'flowPhatTrien',
    label: 'Phát triển đô thị',
    axis: 'A',
    subs: [
      { id: 'chi-tieu', sample: 'field', auth: 'canbo', queue: 'cho-duyet', stageKind: 'chi-tieu', adminAction: 'saveUrbanInputs' }
    ]
  },
  {
    id: 'flowQuyHoach',
    label: 'Quy hoạch',
    axis: 'B',
    subs: [
      { id: 'hoso-new', sample: 'H', auth: 'canbo', queue: 'cho-duyet' },
      { id: 'hoso-add', sample: 'H', auth: 'canbo', queue: 'cho-duyet' },
      { id: 'adjust', sample: 'H', auth: 'canbo', queue: 'adjust' }
    ]
  },
  {
    id: 'flowHtkt',
    label: 'Hạ tầng kỹ thuật',
    axis: 'C',
    subs: [
      { id: 'htkt-net', sample: 'H', auth: 'canbo', queue: 'cho-duyet', stageKind: 'ban-ve' },
      { id: 'htkt-diem', sample: 'P', auth: 'public', queue: 'sheet-false', domain: 'htkt', adminAction: 'addPoint' }
    ]
  },
  {
    id: 'flowHtxh',
    label: 'Hạ tầng xã hội',
    axis: 'D',
    subs: [
      { id: 'htxh-diem', sample: 'P', auth: 'public', queue: 'sheet-false', domain: 'htxh', adminAction: 'addPoint' }
    ]
  },
  {
    id: 'flowKienTruc',
    label: 'Kiến trúc',
    axis: 'E',
    subs: [
      { id: 'quy-che', sample: 'H', auth: 'canbo', queue: 'cho-duyet', stageKind: 'quy-che' },
      { id: 'cong-trinh', sample: 'P', auth: 'canbo', queue: 'cho-duyet', stageKind: 'kien-truc', domain: 'kien-truc' }
    ]
  },
  {
    id: 'flowDuAn',
    label: 'Dự án',
    axis: 'F',
    subs: [
      { id: 'du-an-de-xuat', sample: 'invest', auth: 'public', queue: 'cho-duyet', stageKind: 'du-an', adminAction: 'submitInvestProposal' },
      { id: 'du-an-admin', sample: 'invest', auth: 'admin', queue: 'none', adminAction: 'saveInvestProject' }
    ]
  }
];

export const FLOW_IDS = ENTRY_FLOWS.map(f => f.id);

export function entryFlowOf(id) {
  return ENTRY_FLOWS.find(f => f.id === id) || null;
}

export function plannedSubs() {
  return ENTRY_FLOWS.flatMap(f => f.subs.filter(s => s.planned).map(s => ({ flowId: f.id, ...s })));
}
