// Kiểm tra ghép tên sheet 15-DA và cách gộp nhóm ranh khi server là nguồn chuẩn.
const assert = require('assert');

(async () => {
  const { investNameScore, matchInvestDetail, foldInvestName } = await import('../public/js/investMatch.js');
  const { mergeInvestGroups, editInvestGroups, settleInvestSync } = await import('../public/js/investGroups.js');

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
  assert.ok(investNameScore('05. DA khu đô thị Thanh Toàn', thanhBoundary) >= 0.68, 'mã số đầu 05. phải được gỡ');
  assert.ok(investNameScore('1. Khu đô thị Thanh Toàn', 'Dự án khu đô thị Thanh Toàn') >= 0.68, 'mã 1. đầu tên phải được gỡ');
  assert.ok(investNameScore('A51. Khu đô thị Thanh Toàn', thanhBoundary) >= 0.68, 'mã A51. vẫn được gỡ');
  assert.strictEqual(investNameScore('05. Khu du lịch Phú Vinh 1', '06. Khu du lịch Phú Vinh 2'), 0, 'gỡ mã đầu nhưng giữ số giai đoạn');
  assert.ok(investNameScore('05. Khu du lịch Phú Vinh 1', '6. Khu du lịch Phú Vinh 1') >= 0.68);
  assert.match(foldInvestName('Khu du lịch Phú Vinh 1'), /\b1\b/);
  assert.match(foldInvestName('1. Khu du lịch Phú Vinh 2'), /\b2\b/);
  assert.doesNotMatch(foldInvestName('1. Khu du lịch Phú Vinh 2'), /^1\b/);
  assert.doesNotMatch(foldInvestName('05. DA khu đô thị Thanh Toàn'), /^0*5\b/);

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

  const duongNo = matchInvestDetail(
    [
      { properties: { name: 'Khu du lịch sinh thái nghỉ dưỡng tại Phường Dương Nỗ, thành phố Huế' } },
      { properties: { name: 'Dự án thương mại dịch vụ tại Phường Dương Nỗ (Công ty CĐ Việt Nam nghiên cứu)' } }
    ],
    [
      { 'TÊN DỰ ÁN': 'Dự án thương mại dịch vụ tại phường Dương Nỗ', 'ĐỊA ĐIỂM': 'Phường Dương Nỗ' },
      { 'TÊN DỰ ÁN': 'Khu du lịch sinh thái nghỉ dưỡng tại phường Dương Nỗ', 'ĐỊA ĐIỂM': 'Phường Dương Nỗ' }
    ]
  );
  assert.strictEqual(duongNo[0].index, 1, 'Dương Nỗ nghỉ dưỡng khớp đúng dòng cùng tên');
  assert.strictEqual(duongNo[0].ambiguous, false);
  assert.strictEqual(duongNo[1].index, 0, 'Dương Nỗ thương mại khớp đúng dòng cùng tên');

  const thuyPhuong = matchInvestDetail(
    [
      { properties: { name: 'Khu đô thị sinh thái Thủy Phương tại phường Thủy Phương, thị xã Hương Thủy (tại cánh đồng Thanh Lam)-Đạt Phương' } },
      { properties: { name: 'Khu đô thị tại khu vực cánh đồng Thanh Lam (TNT)' } },
      { properties: { name: 'Khu đô thị Thủy Phương thuộc khu vực cánh đồng thanh lam-TDH' } }
    ],
    [
      { 'TÊN DỰ ÁN': 'Khu đô thị sinh thái Thủy Phương', 'ĐỊA ĐIỂM': 'Phường Thanh Thủy' },
      { 'TÊN DỰ ÁN': 'Khu đô thị Thủy Phương thuộc khu vực cánh đồng Thanh Lam', 'ĐỊA ĐIỂM': 'Phường Thanh Thủy' },
      { 'TÊN DỰ ÁN': 'Khu đô thị tại khu vực cánh đồng Thanh Lam', 'ĐỊA ĐIỂM': 'Phường Thanh Thủy' }
    ]
  );
  assert.strictEqual(thuyPhuong[0].index, 0, 'Thủy Phương sinh thái không bị Thanh Lam giành');
  assert.strictEqual(thuyPhuong[1].index, 2, 'Thanh Lam (TNT) khớp dòng Thanh Lam');
  assert.strictEqual(thuyPhuong[2].index, 1);

  const huongPhu = matchInvestDetail(
    [{ properties: { name: 'Hạ tầng kỹ thuật cụm công nghiệp Hương Phú, xã Khe Tre' } }],
    [
      { 'TÊN DỰ ÁN': 'Đầu tư dự án Hạ tầng kỹ thuật tại Cụm Công nghiệp Hương Phú', 'ĐỊA ĐIỂM': 'Xã Khe Tre' },
      { 'TÊN DỰ ÁN': 'Đầu tư dự án Hạ tầng kỹ thuật tại Cụm Công nghiệp Hương Phú', 'ĐỊA ĐIỂM': 'Xã Khe Tre' }
    ]
  );
  assert.strictEqual(huongPhu[0].ambiguous, false, 'hai dòng sheet trùng hệt thì chọn một');
  assert.strictEqual(huongPhu[0].index, 0, 'dòng trùng chọn chỉ số đứng trước');

  assert.strictEqual(investNameScore(
    'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV1 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3',
    'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV2 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3'
  ), 0, 'DV1 khác DV2');
  assert.ok(investNameScore(
    'Trung tâm dịch vụ Công nghệ thông tin tại lô DV1 Thuỷ Thanh',
    'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV1 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3'
  ) >= 0.68, 'DV1 giữ mã lô để khớp cùng lô');
  const dvLots = matchInvestDetail(
    [
      { properties: { name: 'Trung tâm dịch vụ Công nghệ thông tin tại lô DV1 Thuỷ Thanh' } },
      { properties: { name: 'Trung tâm dịch vụ Công nghệ thông tin tại lô DV2 Thuỷ Thanh' } },
      { properties: { name: 'Trung tâm dịch vụ Công nghệ thông tin tại lô DV3 Thuỷ Thanh' } }
    ],
    [
      { 'TÊN DỰ ÁN': 'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV3 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3' },
      { 'TÊN DỰ ÁN': 'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV1 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3' },
      { 'TÊN DỰ ÁN': 'Trung tâm phát triển dịch vụ Công nghệ thông tin tại lô DV2 thuộc Khu tái định cư Thuỷ Thanh giai đoạn 3' }
    ]
  );
  assert.deepStrictEqual(dvLots.map(d => d.index), [1, 2, 0], 'DV1 DV2 DV3 không tráo lô');
  assert.ok(investNameScore('khu đất DTM3, phường Phú Hậu', 'Dự án Thương mại dịch vụ tại khu đất DTM3, phường Phú Hậu (nay là Phường Phú Xuân, thành phố Huế)') >= 0.68);
  assert.ok(investNameScore('Dự án du lịch (có ký hiệu DDL3) tại phường Thuỷ Biều, TP Huế', 'Dự án Du lịch (có ký hiệu DDL3)') >= 0.68);
  assert.ok(investNameScore('B53. 40 Trần Thúc Nhẫn', 'Dự án Thương mại dịch vụ, khách sạn tại số 40 Trần Thúc Nhẫn') >= 0.68, 'số nhà 40 là token phân biệt');
  assert.ok(investNameScore('B23. Bảo tàng áo dài tư nhân tại phường Kim Long, thành phố Huế', 'Bảo tàng tư nhân áo dài Kim Long') >= 0.68);
  assert.ok(investNameScore('D22. Cửa hàng kết hợp kho xăng dầu phường Hương Sơ', 'Cửa hàng xăng dầu phường Hương An (Cửa hàng kết hợp kho xăng dầu Hương Sơ)') >= 0.68);
  assert.ok(investNameScore('Sân gôn Phường Kim Long, xã Bình Điền', 'Sân gôn tại phường Kim Long và xã Bình Điền') >= 0.68);
  assert.match(foldInvestName('A36. Các dự án CNTT (khu đất DV1)'), /\bdv1\b/);
  assert.match(foldInvestName('khu đất DTM3'), /\bdtm3\b/);
  assert.match(foldInvestName('Dự án Du lịch (có ký hiệu DDL3)'), /\bddl3\b/);
  assert.match(foldInvestName('B53. 40 Trần Thúc Nhẫn'), /\b40\b/);
  assert.doesNotMatch(foldInvestName('B53. 40 Trần Thúc Nhẫn'), /^b53\b/);

  assert.ok(investNameScore(
    'A78. Khu đô thị sinh thái khu vực xã Thủy Thanh và khu vực lân cận (Tập đoàn Hòa Phát 359ha)',
    'Khu đô thị sinh thái khu vực xã Thủy Thanh và khu vực lân cận'
  ) >= 0.68);
  assert.ok(investNameScore('KHu đô thị Triều Thuỷ (PA 2)', 'Khu đô thị mới Triều Thủy, xã Phú An, huyện Phú Vang') >= 0.68);
  assert.ok(investNameScore(
    'Khách sạn, resort tiêu chuẩn 5 sao tại phường Thuỷ Vân',
    'Khách sạn, resort tiêu chuẩn 5 sao (tại khu đất có ký hiệu DV-06 thuộc Khu B – Đô thị mới An Vân Dương)'
  ) >= 0.68);
  assert.ok(investNameScore(
    'Dự án xây dựng khu thương mại, kết hợp dịch vụ nhà hàng và khách sạn tại thị trấn Khe Tre, huyện Nam Đông',
    'Dự án xây dựng khu thương mại, kết hợp dịch vụ nhà hàng và khách sạn Khe Tre'
  ) >= 0.68);
  assert.ok(investNameScore('D7. Trung tâm TMDV Khánh Mỹ (ngã tư Tỉnh lộ 9 và Quốc lộ 1A)', 'Trung tâm thương mại dịch vụ Khánh Mỹ') >= 0.68);

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

  const untouched = { id: 'cd', keys: ['c', 'd'] };
  const pendingSibling = { id: 'ef', keys: ['e', 'f'], pending: true };
  const created = editInvestGroups([untouched, pendingSibling], ['a', 'b'], false, 'g-new');
  assert.strictEqual(created.find(g => g.id === 'cd').pending, undefined, 'nhóm không sửa không thành pending');
  assert.strictEqual(created.find(g => g.id === 'ef').pending, true, 'nhóm pending cũ giữ cờ');
  assert.deepStrictEqual(created.find(g => g.id === 'g-new').keys, ['a', 'b']);
  assert.strictEqual(created.find(g => g.id === 'g-new').pending, true);

  const split = editInvestGroups(
    [untouched, { id: 'abx', keys: ['a', 'b', 'x'] }],
    ['x'],
    true
  );
  assert.strictEqual(split.find(g => g.id === 'cd').pending, undefined);
  assert.deepStrictEqual(split.find(g => g.id === 'abx').keys, ['a', 'b']);
  assert.strictEqual(split.find(g => g.id === 'abx').pending, true, 'chỉ nhóm vừa bị tách là pending');
  assert.strictEqual(split.some(g => g.keys.includes('x')), false);

  const dropped = editInvestGroups([untouched, { id: 'ab', keys: ['a', 'b'] }], ['a', 'b'], true);
  assert.deepStrictEqual(dropped.map(g => g.id), ['cd']);
  assert.strictEqual(dropped[0].pending, undefined);

  const serverKept = [{ id: 'srv', keys: ['a', 'b'] }];
  const saved = settleInvestSync(
    serverKept,
    [{ id: 'ab', keys: ['a', 'b'], pending: true }, untouched],
    [{ keys: ['a', 'b'], clear: false }]
  );
  assert.deepStrictEqual(ids(saved.groups), ['a,b']);
  assert.strictEqual(saved.groups[0].pending, undefined, 'ghi server xong thì hết pending');
  assert.deepStrictEqual(saved.ops, []);

  const otherDeleted = settleInvestSync(
    [],
    [untouched, { id: 'ab', keys: ['a', 'b'], pending: true }],
    [{ keys: ['a', 'b'], clear: false }]
  );
  assert.deepStrictEqual(ids(otherDeleted.groups), ['a,b'], 'server xóa nhóm không pending; nhóm pending còn lệnh thì giữ');
  assert.strictEqual(otherDeleted.groups[0].pending, true);
  assert.strictEqual(otherDeleted.ops.length, 1);

  const stalePending = settleInvestSync(
    [],
    [{ id: 'cd', keys: ['c', 'd'], pending: true }],
    []
  );
  assert.deepStrictEqual(stalePending.groups, [], 'pending không kèm lệnh (bản cũ) không sống lại sau khi server đã xóa');

  const clearLeft = settleInvestSync(
    [{ id: 'abx', keys: ['a', 'b', 'x'] }],
    [{ id: 'ab', keys: ['a', 'b'], pending: true }],
    [{ keys: ['x'], clear: true }]
  );
  assert.strictEqual(clearLeft.ops.length, 1, 'tách chưa lên server thì còn lệnh gỡ');
  assert.deepStrictEqual(clearLeft.ops[0].keys, ['x']);

  console.log('test-invest-match: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
