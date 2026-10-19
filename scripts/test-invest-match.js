// Kiểm tra ghép tên sheet 15-DA và cách gộp nhóm ranh khi server là nguồn chuẩn.
const assert = require('assert');

(async () => {
  const { investNameScore, matchInvestDetail } = await import('../public/js/investMatch.js');
  const { mergeInvestGroups } = await import('../public/js/investGroups.js');

  const thanhSheet = 'DA khu đô thị Thanh Toàn';
  const thanhBoundary = 'Dự án Khu đô thị sinh thái Thanh Toàn';
  assert.ok(investNameScore(thanhSheet, thanhBoundary) >= 0.68, 'Thanh Toàn phải khớp');

  const foldedCase = investNameScore('du an KHU DO THI THANH TOAN', 'Dự án khu đô thị mới Thanh Toàn');
  assert.ok(foldedCase >= 0.68, 'không dấu / hoa / từ mới vẫn khớp');

  assert.strictEqual(investNameScore('Khu du lịch Phú Vinh 1', 'Khu du lịch Phú Vinh 2'), 0, 'Phú Vinh 1 khác 2');
  assert.strictEqual(investNameScore('Khu dân cư Phú An (Gold Center)', 'Khu dân cư Phú Thượng thuộc Khu C - Đô thị mới An Vân Dương'), 0);
  assert.strictEqual(investNameScore('Khu đô thị Thủy Thanh', 'Khu du lịch nghỉ dưỡng Thanh Thuỷ'), 0);
  assert.strictEqual(investNameScore('ĐMT Bình Điền (35MW)', 'Trung tâm nghỉ dưỡng Bình Điền'), 0);
  assert.strictEqual(investNameScore('Khu đất thương mại dịch vụ tại đường tránh Huế (vị trí 01)', 'Khu đất thương mại dịch vụ tại đường tránh Huế (vị trí 02)'), 0);
  assert.strictEqual(investNameScore('Dự án sản xuất nông nghiệp công nghệ cao Quảng Lợi 2', 'Dự án sản xuất nông nghiệp công nghệ cao Quảng Thái 2'), 0);

  const thuy = 'Khu đô thị sinh thái Thủy Phương – Thủy Dương (thuộc khu vực Khu đô thị sinh thái Thanh Toàn)';
  assert.strictEqual(investNameScore(thanhSheet, thuy), 0, 'phần trong ngoặc thuộc Thanh Toàn không kéo theo Thủy Phương');

  assert.strictEqual(investNameScore('CCN Thuỷ Châu', thanhBoundary), 0, 'CCN Thuỷ Châu không phải Thanh Toàn');
  assert.strictEqual(investNameScore(
    'Khu đô thị sinh thái Thủy Phương tại phường Thủy Phương, thị xã Hương Thủy (tại cánh đồng Thanh Lam)-Đạt Phương',
    'Siêu thị Hương Thuỷ'
  ), 0, 'Thủy Phương không khớp siêu thị Hương Thuỷ');
  assert.strictEqual(investNameScore('Bến xe thị xã Hương Trà', 'Khu đô thị mới Trung tâm phường Hương Trà'), 0);
  assert.strictEqual(investNameScore('Logistics Kim Trà', 'Trung tâm Dịch vụ Logistics'), 0);
  assert.strictEqual(investNameScore('Khu liên hiệp y tế công nghệ cao tại xã Phong An', 'Khu liên hiệp y tế công nghệ cao Phong Thái'), 0);
  assert.ok(investNameScore('ĐMT Điền Hương 95MW (phường Phong Phú)', 'Nhà máy điện mặt trời Điền Hương') >= 0.68);
  assert.ok(investNameScore('Khu đô thị phía Bắc 1', 'Khu đô thị phía Bắc 1, phường Hương An và Phường Kim Trà, thành phố Huế') >= 0.68);
  assert.ok(investNameScore('Chợ Tứ Hạ', 'Dự án đầu tư nâng cấp, mở rộng chợ Tứ Hạ') >= 0.68);

  const longSheet = 'Khu đô thị sinh thái Thanh Toàn (Dự án Khu đô thị phía Bắc Tố Hữu – Sân bay)';
  const longBoundary = 'Dự án Khu đô thị sinh thái Thanh Toàn (Dự án Khu đô thị phía Bắc Tố Hữu - Sân Bay)';
  assert.ok(investNameScore(longSheet, longBoundary) >= 0.68, 'tên dài có ngoặc vẫn khớp');
  assert.ok(investNameScore(thanhSheet, longBoundary) >= 0.68, 'tên ngắn sheet khớp ranh tên dài');

  const rows = [
    { 'TÊN DỰ ÁN': 'Khu đô thị Thanh Toàn' },
    { 'TÊN DỰ ÁN': 'DA khu đô thị sinh thái Thanh Toàn' },
    { 'TÊN DỰ ÁN': 'Khu du lịch Phú Vinh 1' },
    { 'TÊN DỰ ÁN': 'Khu du lịch Phú Vinh 2' }
  ];
  const features = [
    { properties: { name: 'Dự án Khu đô thị Thanh Toàn' } },
    { properties: { name: 'Khu du lịch Phú Vinh 1' } },
    { properties: { name: 'Khu du lịch Phú Vinh 2' } },
    { properties: { name: thuy } }
  ];
  const detail = matchInvestDetail(features, rows);
  assert.strictEqual(detail[0].index, -1, 'hai dòng Thanh Toàn sát nhau thì không ghép');
  assert.strictEqual(detail[0].ambiguous, true);
  assert.strictEqual(detail[1].index, 2);
  assert.strictEqual(detail[2].index, 3);
  assert.strictEqual(detail[3].index, -1);
  assert.strictEqual(detail[3].ambiguous, false);

  const one = matchInvestDetail(
    [{ properties: { name: thanhBoundary } }, { properties: { name: 'Dự án Khu đô thị sinh thái Thanh Toàn (mảnh 2)' } }],
    [{ 'TÊN DỰ ÁN': thanhSheet }]
  );
  assert.strictEqual(one[0].index, 0);
  assert.strictEqual(one[1].index, 0, 'một dòng sheet gắn được nhiều ranh');

  const ab = { id: 'g1', keys: ['a', 'b'] };
  const cd = { id: 'g2', keys: ['c', 'd'] };
  const ids = (list) => list.map(g => g.keys.join(','));
  assert.deepStrictEqual(ids(mergeInvestGroups([ab], [{ ...ab }])), ['a,b']);
  assert.deepStrictEqual(ids(mergeInvestGroups([], [{ ...ab }])), [], 'nhóm local cũ không pending bị bỏ khi server rỗng');
  assert.deepStrictEqual(ids(mergeInvestGroups([], [{ ...ab, pending: true }])), ['a,b']);
  assert.deepStrictEqual(ids(mergeInvestGroups(null, [ab])), ['a,b'], 'không có danh sách server thì giữ local');
  assert.deepStrictEqual(ids(mergeInvestGroups([cd], [{ ...ab, pending: true }])), ['c,d', 'a,b']);
  assert.deepStrictEqual(ids(mergeInvestGroups([ab], [{ ...ab, pending: true }])), ['a,b']);
  assert.deepStrictEqual(ids(mergeInvestGroups([], [{ keys: ['a', 'b'] }])), []);

  console.log('test-invest-match: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
